# -*- coding: utf-8 -*-
"""数学闯关：LangGraph 状态机图。

用 LangGraph 编排闯关问答流程：
- 节点：生成计划 / 提问 / 判题 / 子问题降解 / 讲解 / 推进
- 条件边：按答案正确性、降解级数、步骤类型分流
- checkpointer：每次节点执行后的 State 都落库（支持会话历史 + 回溯到选错时刻重做）
- thread_id = quest 会话 id；checkpoint_id 用于回溯
"""

import json
import logging
import re
import sqlite3
import threading
from typing import TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import StateGraph, START, END

logger = logging.getLogger(__name__)

_CHECKPOINT_DB = "data/langgraph_checkpoints.sqlite"
_conn = None
_saver = None
_lock = threading.Lock()
_svc = None  # DeepSeekService（由 ai_homework.init 注入）


class QuestState(TypedDict, total=False):
    question: str
    plan: list  # LLM 生成的步骤（含答案，仅服务端）
    plan_seed: list  # 错题回练：直接用给定步骤子集（不重新 LLM 生成）
    step_index: int
    sub_level: int
    sub_json: dict  # 当前子问题（含答案）
    history: list  # 作答历史 [{step, answer, correct, kind}]
    answer_index: int  # 本次学生输入
    correct: bool
    feedback: str
    concept_explain: str
    sub_question: dict  # 发给客户端的子问题（不含答案）
    sub_back_to_original: bool
    done: bool
    response: dict  # 组装好的客户端响应


# ── 提示词（与旧版一致） ──

QUEST_PLAN_PROMPT = """你是小学数学「闯关教练」。请根据题目生成一个闯关计划，引导学生一步步自己理解并解出这道题。
要求：
1) **步骤尽量多、尽量细（8~14 步）**，按顺序：概念确认（如本题有抽象概念）→ 读懂题 → 找关键数量 → 建数量关系 → 列算式 → 总结口诀。
   **宁可多拆小步，也不要跳步**；例如「读懂题」可拆成"讲的是谁的事？"和"最后问什么？"两步，
   「找关键数量」每个关键数量一步，「建关系」把方向/基准/数量关系各拆一步，「列算式」先问"先算什么"再问"算式怎么列"。
2) 每步一个问题（一句话说清），2~3 个选项（其中一个正确），选项要具体（用题目里的实体、数字、算式）。
3) 概念确认步骤：识别本题里学生可能不懂的抽象概念（如 速度/倍数/进率/工程效率/往返），问题如「你知道『几倍』是什么意思吗？」，
   选项固定为 ["知道","不确定","不知道"]，answer_index=0；
   concept 字段用一两句**大白话 + 具象生活例子**解释（如倍数→"你有2颗糖，我有你的3倍就是6颗"）。
4) 列算式步骤：选项是算式（如 "45×3"），不是最终结果；**不要在任何步骤给出最终答案**。
5) 每步 explain：学生答错时的引导话术（回指题目原文某句 / 生活类比 / 提示找哪个量），**不给答案**，30 字内。
6) 总结步骤：输出一句这类题的口诀（如「A是B的几倍→找到基准量B，A=B×倍数」），options 放口诀确认选项。

只输出 JSON（不要 markdown 包裹，无多余空格换行）：
{{"steps":[{{"type":"concept|understand|extract|relation|formula|summary","question":"问题","options":["..",".."],"answer_index":0,"explain":"引导","concept":"概念解释(仅concept步)"}}]}}
题目：{question}"""

QUEST_SUB_PROMPT = """你是小学数学闯关教练。学生答错了闯关中的这一步。请生成一个【更简单 / 更具体】的子问题帮他建立理解。
规则：
1) 抽象概念 → 用具象生活例子提问（如 倍数→"你有2颗糖，我有你的3倍，我有几颗？"；速度→"1小时走60千米，2小时走多远？"）。
2) 综合步骤 → 拆成单一小步骤（只问其中一件事）。
3) 第 N 次降解（N 越大越简单，N>=2 时给"最简"问法，选项只剩 2 个、答案一目了然）。
4) 一个子问题，2~3 个选项，给出正确答案下标和简短讲解（30 字内）。
只输出 JSON（不要 markdown 包裹）：{{"question":"...","options":["..",".."],"answer_index":0,"explain":"..."}}
题目：{question}
原步骤问题：{step_question}
学生错选：{student_answer}
本次是第 {level} 次降解。"""


# ── 工具函数 ──

def _chat(prompt: str, system: str, max_tokens: int = 1024, caller: str = "quest") -> str:
    if _svc is None:
        raise RuntimeError("quest_graph 未初始化（缺少 svc）")
    return _svc.chat(system, prompt, max_tokens, caller, disable_thinking=True)


def _parse_plan(reply: str) -> list[dict]:
    _c = (reply or "").strip()
    if _c.startswith("```"):
        _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
        _c = re.sub(r"\s*```\s*$", "", _c)
    data = json.loads(_c)
    steps: list[dict] = []
    if isinstance(data, dict) and isinstance(data.get("steps"), list):
        for s in data["steps"]:
            if not isinstance(s, dict):
                continue
            q = str(s.get("question", "") or "").strip()
            opts = [str(o).strip() for o in s.get("options", []) if isinstance(o, str) and str(o).strip()]
            if not q or len(opts) < 2:
                continue
            ai = int(s.get("answer_index", 0))
            ai = max(0, min(ai, len(opts) - 1))
            steps.append({
                "type": str(s.get("type", "") or "understand"),
                "question": q,
                "options": opts,
                "answer_index": ai,
                "explain": str(s.get("explain", "") or "").strip(),
                "concept": str(s.get("concept", "") or "").strip(),
            })
    return steps


def _llm_plan(question: str) -> list[dict]:
    reply = _chat(QUEST_PLAN_PROMPT.format(question=question), "你是一个只输出JSON的数学闯关教练。", 4096, "quest_plan")
    steps = _parse_plan(reply)
    if not steps:
        logger.warning("闯关计划生成失败，重试一次")
        reply = _chat(QUEST_PLAN_PROMPT.format(question=question), "你是一个只输出JSON的数学闯关教练。", 8192, "quest_plan")
        steps = _parse_plan(reply)
    return steps


def _llm_sub(question: str, step: dict, student_answer: str, level: int) -> dict:
    default = {"question": "再试一次：回到题目里找一找关键的那句话。", "options": ["好的", "重新看题目"], "answer_index": 0, "explain": "提示：把题目再读一遍。"}
    try:
        reply = _chat(
            QUEST_SUB_PROMPT.format(question=question, step_question=step.get("question", ""), student_answer=student_answer, level=level),
            "你是一个只输出JSON的数学闯关教练。", 1024, "quest_sub",
        )
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        data = json.loads(_c)
        q = str(data.get("question", "") or "").strip()
        opts = [str(o).strip() for o in data.get("options", []) if isinstance(o, str) and str(o).strip()]
        if q and len(opts) >= 2:
            ai = int(data.get("answer_index", 0))
            ai = max(0, min(ai, len(opts) - 1))
            return {"question": q, "options": opts, "answer_index": ai, "explain": str(data.get("explain", "") or "").strip() or "提示：再想想。"}
    except Exception as e:
        logger.warning("子问题生成失败，用默认: %s", e)
    return default


def _praise(step_type: str) -> str:
    return {
        "concept": "✓ 理解到位！",
        "understand": "✓ 读懂了题意，很好！",
        "extract": "✓ 数字找得准！",
        "relation": "✓ 关系找对了，这是这类题最关键的一步！",
        "formula": "✓ 算式列对了！",
        "summary": "🎉 总结到位，闯关成功！",
    }.get(step_type, "✓ 回答正确！")


def _public_step(plan: list[dict], idx: int) -> dict:
    s = plan[idx]
    return {"index": idx, "type": s["type"], "question": s["question"], "options": s["options"]}


# ── 图节点 ──

def generate_plan(state: QuestState) -> dict:
    if state.get("plan_seed"):
        plan = state["plan_seed"]
    else:
        plan = _llm_plan(state["question"])
        if not plan:
            raise RuntimeError("闯关计划生成失败")
    return {"plan": plan, "step_index": 0, "sub_level": 0, "sub_json": None, "history": [], "done": False}


def ask(state: QuestState) -> dict:
    """展示当前步骤（起始 / 推进后 / 回到原题）"""
    plan = state["plan"]
    idx = state["step_index"]
    return {
        "response": {
            "correct": False,
            "done": state.get("done", False),
            "feedback": "",
            "concept_explain": "",
            "sub_question": None,
            "sub_back_to_original": False,
            "current_step": idx,
            "total_steps": len(plan),
            "next_step": _public_step(plan, idx) if idx < len(plan) else None,
        }
    }


def grade(state: QuestState) -> dict:
    """判题（原题或子问题），写 history"""
    plan = state["plan"]
    idx = state["step_index"]
    step = plan[idx]
    ans = max(0, min(int(state.get("answer_index", 0)), len(step.get("options", [])) - 1))
    selected = step["options"][ans]
    history = list(state.get("history", []))
    sub_json = state.get("sub_json")
    if sub_json:
        sub_ok = ans == sub_json["answer_index"]
        history.append({"step": idx, "answer": selected, "correct": sub_ok, "kind": "sub"})
        return {"history": history, "correct": sub_ok, "answer_index": -1}
    correct = ans == step["answer_index"]
    history.append({"step": idx, "answer": selected, "correct": correct})
    return {"history": history, "correct": correct, "answer_index": -1}


def degrade(state: QuestState) -> dict:
    """答错 → 生成更简单的子问题（level 递增）"""
    plan = state["plan"]
    idx = state["step_index"]
    step = plan[idx]
    history = state.get("history", [])
    last = history[-1] if history else {}
    level = state.get("sub_level", 0) + 1
    sub = _llm_sub(state["question"], step, last.get("answer", ""), level)
    return {
        "sub_json": sub,
        "sub_level": level,
        "response": {
            "correct": False, "done": False,
            "feedback": "别急，先回答一个更简单的问题：",
            "concept_explain": "",
            "sub_question": {"index": -1, "type": "sub", "question": sub["question"], "options": sub["options"]},
            "sub_back_to_original": False,
            "current_step": idx, "total_steps": len(plan), "next_step": None,
        },
    }


def concept_degrade(state: QuestState) -> dict:
    """概念步答错 → 讲解 + 具象子问题"""
    plan = state["plan"]
    idx = state["step_index"]
    step = plan[idx]
    history = state.get("history", [])
    last = history[-1] if history else {}
    sub = _llm_sub(state["question"], step, last.get("answer", ""), 1)
    return {
        "sub_json": sub,
        "sub_level": 1,
        "response": {
            "correct": False, "done": False,
            "feedback": "没关系，先了解一下这个概念，再用生活里的例子确认：",
            "concept_explain": step.get("concept", "") or step.get("explain", ""),
            "sub_question": {"index": -1, "type": "sub", "question": sub["question"], "options": sub["options"]},
            "sub_back_to_original": False,
            "current_step": idx, "total_steps": len(plan), "next_step": None,
        },
    }


def explain(state: QuestState) -> dict:
    """降解 3 次仍错 → 给讲解（回原题重试）"""
    plan = state["plan"]
    idx = state["step_index"]
    sub = state.get("sub_json") or {}
    explain_text = sub.get("explain", "") or "提示：再想想，回题目里找一找。"
    return {
        "sub_json": None,
        "sub_level": 0,
        "response": {
            "correct": False, "done": False,
            "feedback": explain_text,
            "concept_explain": explain_text,
            "sub_question": None, "sub_back_to_original": False,
            "current_step": idx, "total_steps": len(plan), "next_step": None,
        },
    }


def back_to_original(state: QuestState) -> dict:
    """子问题答对 → 提示回到原题再试"""
    plan = state["plan"]
    idx = state["step_index"]
    return {
        "sub_json": None,
        "sub_level": 0,
        "response": {
            "correct": False, "done": False,
            "feedback": "✓ 很好！你已经理解了这个概念。现在回到原来的问题，再试一次。",
            "concept_explain": "",
            "sub_question": None, "sub_back_to_original": True,
            "current_step": idx, "total_steps": len(plan), "next_step": None,
        },
    }


def advance(state: QuestState) -> dict:
    """答对 → 推进下一步（或完成）"""
    plan = state["plan"]
    idx = state["step_index"] + 1
    done = idx >= len(plan)
    return {
        "step_index": idx,
        "sub_json": None,
        "sub_level": 0,
        "done": done,
        "response": {
            "correct": True,
            "done": done,
            "feedback": _praise(plan[idx - 1]["type"]) if not done else "🎉 闯关成功！",
            "concept_explain": "",
            "sub_question": None, "sub_back_to_original": False,
            "current_step": min(idx, len(plan) - 1) if not done else idx - 1,
            "total_steps": len(plan),
            "next_step": _public_step(plan, idx) if not done else None,
        },
    }


# ── 入口分流 + 判题分流 ──

def entry_route(state: QuestState) -> str:
    if not state.get("plan"):
        return "generate_plan"
    if state.get("answer_index", -1) >= 0:
        return "grade"
    return "ask"  # replay 恢复 / 无作答输入 → 展示当前问题


def grade_route(state: QuestState) -> str:
    plan = state.get("plan", [])
    idx = state.get("step_index", 0)
    step = plan[idx] if plan and idx < len(plan) else {}
    if state.get("sub_json"):
        # 正在答子问题
        if state.get("correct"):
            return "back_to_original"
        if state.get("sub_level", 0) >= 3:
            return "explain"
        return "degrade"
    if state.get("correct"):
        return "advance"
    if step.get("type") == "concept":
        return "concept_degrade"
    return "degrade"


def _build_graph():
    g = StateGraph(QuestState)
    g.add_node("generate_plan", generate_plan)
    g.add_node("ask", ask)
    g.add_node("grade", grade)
    g.add_node("degrade", degrade)
    g.add_node("concept_degrade", concept_degrade)
    g.add_node("explain", explain)
    g.add_node("back_to_original", back_to_original)
    g.add_node("advance", advance)

    g.add_conditional_edges(START, entry_route, {
        "generate_plan": "generate_plan",
        "grade": "grade",
        "ask": "ask",
    })
    g.add_edge("generate_plan", "ask")
    g.add_conditional_edges("grade", grade_route, {
        "back_to_original": "back_to_original",
        "explain": "explain",
        "degrade": "degrade",
        "advance": "advance",
        "concept_degrade": "concept_degrade",
    })
    for n in ("ask", "degrade", "concept_degrade", "explain", "back_to_original", "advance"):
        g.add_edge(n, END)
    return g


def init(svc):
    """由 ai_homework.init 注入 LLM 服务；初始化 checkpointer（幂等）"""
    global _svc, _conn, _saver
    _svc = svc
    if _saver is None:
        _conn = sqlite3.connect(_CHECKPOINT_DB, check_same_thread=False)
        _saver = SqliteSaver(_conn)


def _config(thread_id: str, checkpoint_id: str = "") -> dict:
    c: dict = {"configurable": {"thread_id": thread_id}}
    if checkpoint_id:
        c["configurable"]["checkpoint_id"] = checkpoint_id
    return c


def invoke(thread_id: str, inputs: dict, checkpoint_id: str = "") -> dict:
    """执行图一步（同步，内部加锁 + 从最新 checkpoint 继续）"""
    g = _build_graph().compile(checkpointer=_saver)
    cfg = _config(thread_id, checkpoint_id)
    with _lock:
        g.invoke(inputs, cfg)
        state = g.get_state(cfg)
    return dict(state.values)


def start(question: str, thread_id: str) -> dict:
    """开始闯关：生成计划并返回第 1 步（steps 全量给客户端，不含答案）"""
    with _lock:
        g = _build_graph().compile(checkpointer=_saver)
        cfg = _config(thread_id)
        g.invoke({"question": question, "answer_index": -1}, cfg)
        state = g.get_state(cfg)
    st = dict(state.values)
    plan = st.get("plan", [])
    return {
        "session_id": int(thread_id),
        "total_steps": len(plan),
        "current_step": 0,
        "steps": [_public_step(plan, i) for i in range(len(plan))],
        "question": question,
    }


def answer(thread_id: str, answer_index: int) -> dict:
    """作答一步，返回响应"""
    st = invoke(thread_id, {"answer_index": answer_index})
    return st.get("response", {})


def history(thread_id: str) -> list[dict]:
    """会话历史：从 checkpoint 提取每步作答（含对错与可回溯的 checkpoint_id）。
    返回按作答顺序去重后的列表（同一步多次作答合并，answer_count 记录次数）。"""
    with _lock:
        g = _build_graph().compile(checkpointer=_saver)
        cfg = _config(thread_id)
        raw: list[dict] = []
        for h in g.get_state_history(cfg):
            vals = dict(h.values)
            hist = vals.get("history", [])
            if not hist:
                continue
            cid = (h.config.get("configurable", {}) or {}).get("checkpoint_id", "")
            raw.append({
                "checkpoint_id": cid,
                "history": hist,
                "step_index": vals.get("step_index", 0),
                "total_steps": len(vals.get("plan", [])),
            })
        # 去重：保留每个「历史长度」的最后一次 checkpoint（同一步作答的最终状态）
        raw.sort(key=lambda x: len(x["history"]))
        seen: dict[str, dict] = {}
        for item in raw:
            key = json.dumps(item["history"], ensure_ascii=False)
            seen[key] = item
        merged: list[dict] = []
        for item in seen.values():
            hist = item["history"]
            last = hist[-1]
            # 该步作答次数（原题 + 子问题合计，按 step 分组）
            answers_for_step = [h for h in hist if h.get("step") == item["step_index"]]
            merged.append({
                "checkpoint_id": item["checkpoint_id"],
                "step_index": item["step_index"],
                "total_steps": item["total_steps"],
                "last_answer": last.get("answer", ""),
                "last_correct": bool(last.get("correct", False)),
                "sub_used": last.get("kind", "") == "sub",
                "answer_count": len(answers_for_step),
            })
        merged.sort(key=lambda x: x["step_index"])
        return merged


def replay(thread_id: str, checkpoint_id: str) -> dict:
    """回溯：恢复到指定 checkpoint（选错时刻），重新展示该步供学生重做"""
    st = invoke(thread_id, {"answer_index": -1}, checkpoint_id)
    plan = st.get("plan", [])
    idx = st.get("step_index", 0)
    st["response"] = {
        "correct": False, "done": st.get("done", False),
        "feedback": "🔙 回到这里重做：再选一次，看看这次是不是答对了。",
        "concept_explain": "",
        "sub_question": None, "sub_back_to_original": False,
        "current_step": idx,
        "total_steps": len(plan),
        "next_step": _public_step(plan, idx) if plan and idx < len(plan) else None,
    }
    return st["response"]


def _raw_state(thread_id: str) -> dict:
    """读取线程最新 State（不执行图，无副作用）"""
    with _lock:
        g = _build_graph().compile(checkpointer=_saver)
        cfg = _config(thread_id)
        state = g.get_state(cfg)
    return dict(state.values)


def resume(thread_id: str) -> dict:
    """续闯：恢复到最近状态，展示当前步问题"""
    st = invoke(thread_id, {"answer_index": -1})
    plan = st.get("plan", [])
    idx = st.get("step_index", 0)
    if st.get("done"):
        return {"correct": True, "done": True, "feedback": "这个闯关已经完成啦，可以错题回练或开始新的。",
                "concept_explain": "", "sub_question": None, "sub_back_to_original": False,
                "current_step": idx, "total_steps": len(plan), "next_step": None}
    return {
        "correct": False, "done": False,
        "feedback": "↩ 上次闯到这里，继续吧！",
        "concept_explain": "",
        "sub_question": None, "sub_back_to_original": False,
        "current_step": idx, "total_steps": len(plan),
        "next_step": _public_step(plan, idx) if idx < len(plan) else None,
    }


def start_retry(thread_id: str, question: str, seed_plan: list) -> dict:
    """错题回练：用答错步骤子集作为新计划，开新线程（不重新 LLM 生成）"""
    with _lock:
        g = _build_graph().compile(checkpointer=_saver)
        cfg = _config(thread_id)
        g.invoke({"question": question, "plan_seed": seed_plan, "answer_index": -1}, cfg)
        state = g.get_state(cfg)
    st = dict(state.values)
    plan = st.get("plan", [])
    return {
        "session_id": int(thread_id),
        "total_steps": len(plan),
        "current_step": 0,
        "steps": [_public_step(plan, i) for i in range(len(plan))],
        "question": question,
    }


def report(thread_id: str) -> dict:
    """掌握报告：从最新 state 的历史统计每步对错与降解情况"""
    st = invoke(thread_id, {"answer_index": -1})
    plan = st.get("plan", [])
    history = st.get("history", [])
    per_step: dict[int, dict] = {}
    for h in history:
        idx = h.get("step", 0)
        d = per_step.setdefault(idx, {"attempts": 0, "correct": 0, "wrong": 0, "sub_used": 0, "last_correct": False})
        d["attempts"] += 1
        d["sub_used"] += 1 if h.get("kind") == "sub" else 0
        if h.get("correct"):
            d["correct"] += 1
            d["last_correct"] = True
        else:
            d["wrong"] += 1
            d["last_correct"] = False
    steps: list[dict] = []
    first_wrong = 0
    for idx in range(len(plan)):
        d = per_step.get(idx, {"attempts": 0, "correct": 0, "wrong": 0, "sub_used": 0, "last_correct": False})
        ok = d["attempts"] == 0 or d["last_correct"]
        if not ok:
            first_wrong += 1
        steps.append({
            "index": idx,
            "type": plan[idx]["type"],
            "question": plan[idx]["question"],
            "attempts": d["attempts"],
            "wrong": d["wrong"],
            "sub_used": d["sub_used"],
            "passed": ok,
        })
    total_attempts = sum(s["attempts"] for s in steps)
    wrong_steps = [s for s in steps if not s["passed"]]
    return {
        "total_steps": len(plan),
        "attempts": total_attempts,
        "passed_steps": len(plan) - len(wrong_steps),
        "wrong_steps": wrong_steps,
        "done": bool(st.get("done")),
        "summary": _summary_text(steps),
    }


def _summary_text(steps: list[dict]) -> str:
    passed = sum(1 for s in steps if s["passed"])
    total = len(steps)
    wrong_types = [s for s in steps if not s["passed"]]
    if not steps:
        return "还没有作答记录。"
    if passed == total:
        return "全部通过！每一步都能自己答对，这个题型掌握得很扎实。"
    if total - passed <= 2:
        return "基本掌握！只有一小步还需要巩固，重做一遍就更稳了。"
    return "还需要多练：有 %d 步第一次没答对，建议错题回练再走一遍。" % (total - passed)
