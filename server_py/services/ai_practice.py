"""ai陪我练 — LangGraph 多轮引导对话服务

图结构（human-in-the-loop）：
    START → planner（生成引导计划）→ asker（interrupt 提问等学生）
         → grader（评估纠正/表扬，先 return 更新 state）→ 条件边：
              done → END；否则 → asker（再提问）

设计要点：
- grader 先 return（correction/praise 写入 state），asker 再 interrupt 暂停——
  保证客户端在"提问暂停"时能拿到上一轮评估结果
- 每轮一次 LLM 调用（评估 + 生成下一问合并），免费火山 Ark 优先
- checkpointer 持久化（SQLite），会话中断可续聊
"""

import asyncio
import json
import logging
import os
import re
from typing import TypedDict

import aiosqlite
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command, interrupt

from config import DeepSeekConfig
from services.deepseek import DeepSeekService

logger = logging.getLogger(__name__)

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_CHECKPOINT_DB = os.path.join(_DATA_DIR, "ai_practice_checkpoints.sqlite")

MAX_TURNS = 20  # 单会话最大轮数（防失控）


# ── 图状态 ──

class AiPracticeState(TypedDict):
    content_type: str          # char | word | sentence | article
    content: str               # 导入的主题文本
    task: str                  # 任务类型
    plan: list                 # planner 生成的步骤列表 [{goal, hint}]
    step_index: int            # 当前进行到第几步
    history: list              # [{role, text}] 完整对话历史
    last_answer: str           # 学生最新回答（asker 恢复时写入）
    correction: str            # 最新纠正（grader 写入）
    praise: str                # 最新表扬（grader 写入）
    next_question: str         # 下一问（grader 生成，asker interrupt 用）
    done: bool


# ── LLM 调用（免费优先自动生效）──

def _extract_json(text: str) -> dict | None:
    """从 LLM 回复中提取 JSON（容错 markdown 围栏/前后噪声）"""
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    candidate = m.group(1).strip() if m else text.strip()
    # 截取第一个 { 到最后一个 }
    s, e = candidate.find("{"), candidate.rfind("}")
    if s >= 0 and e > s:
        candidate = candidate[s : e + 1]
    try:
        return json.loads(candidate)
    except Exception:
        return None


_PLANNER_SYSTEM = """你是小学英语 AI 陪练的设计师。根据学生导入的学习主题，设计一份循序渐进的引导对话计划。

规则：
1. 计划包含 3~5 个步骤，从易到难逐步引导，覆盖认读、理解、运用
2. 每个步骤给出该步骤的学习目标（goal）和给学生的引导提示（hint，一句话）
3. 步骤要具体、可执行，围绕导入内容本身设计，不要泛泛而谈
4. 只输出 JSON，格式：{"steps": [{"goal": "目标", "hint": "引导提示"}...]}"""


def _planner_prompt(content_type: str, content: str, task: str) -> str:
    type_name = {"char": "字", "word": "词", "sentence": "句子", "article": "文章"}.get(content_type, content_type)
    return (
        f"学习主题类型：{type_name}\n"
        f"学习内容：{content}\n"
        f"任务类型：{task or '（未指定，按该类型常见训练方式设计）'}\n"
        "请输出引导计划。"
    )


_GRADER_SYSTEM = """你是小学英语 AI 陪练老师。学生正在按计划学习一个主题，你需要：
1. 评估学生最新一次回答是否达成当前步骤目标（对照学生年龄给出宽松、鼓励的评判）
2. 如果回答有明显错误，用学生能懂的语言给出简短纠正（中英结合，指出正确说法）
3. 如果回答基本正确，给出具体的表扬（指出好在哪，不要泛泛夸）
4. 给出下一步引导问题（围绕计划推进；若这是最后一步且学生已完成，done=true 并给出总结语）
5. 学生答对当前问题后应推进到下一步骤，不要停留在原地；所有步骤完成即结束对话（done=true）

只输出 JSON，格式：
{"correct": true/false, "feedback": "纠正或表扬，一句话", "next_question": "下一个问题或总结语", "done": true/false}"""


def _grader_prompt(state: AiPracticeState) -> str:
    steps: list = state["plan"]
    step_idx: int = state["step_index"]
    history_lines = []
    for h in state["history"][-8:]:  # 最近 8 条，控制上下文
        role = "老师" if h["role"] == "ai" else "学生"
        history_lines.append(f"{role}：{h['text']}")
    plan_text = "\n".join(
        f"第{i+1}步({ '当前' if i == step_idx else '' })：{s.get('goal', '')} —— {s.get('hint', '')}"
        for i, s in enumerate(steps)
    )
    return (
        f"学习内容：{state['content']}\n"
        f"引导计划：\n{plan_text}\n"
        f"对话历史：\n" + "\n".join(history_lines) + "\n"
        f"学生最新回答：{state['last_answer']}\n"
        "请评估并给出下一步。"
    )


# ── 图节点 ──

async def _planner(state: AiPracticeState) -> dict:
    if state.get("plan"):
        return {}
    svc = _graph_svc
    assert svc is not None
    raw = await asyncio.to_thread(
        svc.chat, _PLANNER_SYSTEM, _planner_prompt(state["content_type"], state["content"], state["task"]),
        max_tokens=1024, caller="ai_practice_planner",
    )
    data = _extract_json(raw)
    steps = data.get("steps", []) if data else []
    if not steps:
        # LLM 失败兜底：默认三步计划
        steps = [
            {"goal": "认读内容", "hint": "请先读一读"},
            {"goal": "理解内容", "hint": "说说你理解了什么"},
            {"goal": "运用内容", "hint": "用学到的说一句话"},
        ]
    return {"plan": steps, "step_index": 0}


async def _asker(state: AiPracticeState) -> dict:
    """生成问题 → interrupt 等待学生回答；恢复时把回答写入 state"""
    if not state.get("history"):
        # 首问模板（不调 LLM）
        steps: list = state["plan"]
        goal = steps[min(state["step_index"], len(steps) - 1)].get("goal", "继续练习")
        hint = steps[min(state["step_index"], len(steps) - 1)].get("hint", "")
        question = f"我们开始吧！今天学习：{state['content']}\n第一步目标：{goal}。{hint}"
    else:
        question = state.get("next_question") or "继续说，试试看？"

    answer = interrupt(question)
    if answer is None or not str(answer).strip():
        # 首次 invoke：把问题返回给客户端
        return {"next_question": question}
    return {"last_answer": str(answer).strip()}


async def _grader(state: AiPracticeState) -> dict:
    """评估学生回答：纠正/表扬 + 下一问 + 是否完成（一次 LLM 调用）"""
    svc = _graph_svc
    assert svc is not None
    history: list = list(state.get("history", []))
    answer: str = state["last_answer"]
    history.append({"role": "user", "text": answer})
    s = dict(state)
    s["history"] = history
    raw = await asyncio.to_thread(
        svc.chat, _GRADER_SYSTEM, _grader_prompt(s),
        max_tokens=1024, caller="ai_practice_grade",
    )
    data = _extract_json(raw) or {}
    feedback = str(data.get("feedback", "很好！")).strip()
    next_q = str(data.get("next_question", "")).strip()
    done = bool(data.get("done", False)) or len(history) >= MAX_TURNS * 2

    correction = feedback if data.get("correct") is False else ""
    praise = feedback if data.get("correct") is not False else ""

    if done or not next_q:
        closing = next_q or "太棒了！今天的练习完成啦 🎉"
        history.append({"role": "ai", "text": closing})
        return {
            "history": history,
            "correction": correction,
            "praise": praise,
            "next_question": closing,
            "done": True,
        }
    history.append({"role": "ai", "text": next_q})
    return {
        "history": history,
        "correction": correction,
        "praise": praise,
        "next_question": next_q,
        "done": False,
    }


def _route(state: AiPracticeState) -> str:
    return END if state.get("done") else "asker"


# ── 图构建 ──

_graph_svc: DeepSeekService | None = None
_graph = None
_saver = None


async def build_graph(config: DeepSeekConfig) -> None:
    """构建 LangGraph（幂等，服务启动时调用一次）"""
    global _graph_svc, _graph, _saver
    if _graph is not None:
        return
    _graph_svc = DeepSeekService(config, "ai_practice")

    g = StateGraph(AiPracticeState)
    g.add_node("planner", _planner)
    g.add_node("asker", _asker)
    g.add_node("grader", _grader)
    g.add_edge(START, "planner")
    g.add_edge("planner", "asker")
    g.add_edge("asker", "grader")
    g.add_conditional_edges("grader", _route, {"asker": "asker", END: END})
    # 直接持有 aiosqlite 连接（from_conn_string 的临时 CM 会被 GC 导致连接关闭）
    conn = await aiosqlite.connect(_CHECKPOINT_DB)
    _saver = AsyncSqliteSaver(conn)
    _graph = g.compile(checkpointer=_saver)


def _thread_id(session_id: int) -> dict:
    return {"configurable": {"thread_id": f"ai_practice_{session_id}"}}


def _question_from(result: dict) -> str:
    """从图 invoke 结果中取当前问题：
    - interrupt 暂停时 → result['__interrupt__'][0].value
    - 节点 return 时（done）→ result['next_question']"""
    interrupts = result.get("__interrupt__")
    if interrupts:
        return str(interrupts[0].value)
    return str(result.get("next_question", ""))


async def start_session(session_id: int, content_type: str, content: str, task: str) -> str:
    """创建会话并返回第一个问题"""
    assert _graph is not None, "ai_practice graph 未初始化"
    result = await _graph.ainvoke(
        {
            "content_type": content_type,
            "content": content,
            "task": task,
            "plan": [],
            "step_index": 0,
            "history": [],
            "last_answer": "",
            "correction": "",
            "praise": "",
            "next_question": "",
            "done": False,
        },
        config=_thread_id(session_id),
    )
    return _question_from(result)


async def send_answer(session_id: int, answer: str) -> dict:
    """发送学生回答，返回 {correction, praise, question, done}"""
    assert _graph is not None, "ai_practice graph 未初始化"
    result = await _graph.ainvoke(
        Command(resume=answer),
        config=_thread_id(session_id),
    )
    return {
        "correction": str(result.get("correction", "")),
        "praise": str(result.get("praise", "")),
        "question": _question_from(result),
        "done": bool(result.get("done", False)),
    }
