"""口述作文 (Oral Writing) 路由 — 选题 + LLM 结构/提示/评分/润饰"""

import json
import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import Config
from services.deepseek import BudgetExceededError, DeepSeekService

logger = logging.getLogger(__name__)

router = APIRouter()

svc: DeepSeekService = None  # type: ignore
_essays: list[dict] = []


def init(config: Config):
    global svc
    svc = DeepSeekService(config.deepseek, "essays")
    _load_essays()


def _load_essays():
    global _essays
    path = os.path.join(os.path.dirname(__file__), "..", "data", "essays.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            _essays = json.load(f)
        logger.info("已加载 %d 篇作文题目", len(_essays))
    else:
        logger.warning("essays.json 不存在，作文列表为空")
        _essays = []


# ---- 数据模型 ----

class StructureRequest(BaseModel):
    title: str
    content: str
    gradeLevel: int = 2


class StructureResponse(BaseModel):
    sections: list[dict]


class HintRequest(BaseModel):
    title: str
    content: str
    sectionLabel: str
    sectionGuide: str
    studentText: str
    hintType: str
    stuckDurationMs: int = 0


class HintResponse(BaseModel):
    hint: str


class ScoreRequest(BaseModel):
    title: str
    content: str
    sections: list[dict]
    sectionTexts: list[str]
    finalText: str


class ScoreResponse(BaseModel):
    feedback: str


class FormatRequest(BaseModel):
    sections: list[dict]
    sectionTexts: list[str]


class FormatResponse(BaseModel):
    formatted: str


# ---- 路由 ----

@router.get("/essays")
async def list_essays():
    """获取所有作文题目"""
    return {"essays": _essays}


@router.get("/essays/{essay_id}")
async def get_essay(essay_id: int):
    """获取单个作文题目"""
    for e in _essays:
        if e.get("id") == essay_id:
            return {"essay": e}
    raise HTTPException(status_code=404, detail="作文题目不存在")


@router.post("/essays/structure", response_model=StructureResponse)
async def generate_structure(req: StructureRequest):
    """LLM 生成作文段落结构"""
    prompt = (
        "你是写作结构设计师。给定一个作文题目，请生成一个 3-4 段的写作框架。\n"
        "每个段落需要：label（短标题，2-4字）和 guide（一句话引导，≤15字）。\n"
        "输出纯 JSON 数组，格式：\n"
        '[{"label":"开头","guide":"一句话介绍主题"},{"label":"细节","guide":"描述具体的样子或特点"}]\n'
        "要求：label 简洁好记，guide 是指引不是答案。"
    )
    user_msg = f"题目：{req.title}\n内容：{req.content}\n年级：{req.gradeLevel}年级"
    try:
        reply = svc.chat(prompt, user_msg, max_tokens=2048, caller="essay_structure")
        sections = _parse_json_array(reply)
        if not sections:
            sections = [
                {"label": "开头", "guide": "说说这个题目"},
                {"label": "内容", "guide": "多说一些细节"},
                {"label": "故事", "guide": "讲一件相关的事"},
                {"label": "感受", "guide": "你心里怎么想的"},
            ]
        return StructureResponse(sections=sections)
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429 统一提示
    except Exception as e:
        logger.error("生成结构失败: %s", e)
        return StructureResponse(sections=[
            {"label": "开头", "guide": "介绍这个主题"},
            {"label": "内容", "guide": "说说具体内容"},
            {"label": "结尾", "guide": "总结你的想法"},
        ])


@router.post("/essays/hint", response_model=HintResponse)
async def generate_hint(req: HintRequest):
    """LLM 生成写作提示"""
    hint_type_labels = {
        "有点累了": "学生有点累了，请给一句鼓励的话，不要提写作建议。",
        "找不到词": "学生找不到合适的词语，请给2-3个相关的词语或短句提示。",
        "开不了头": "学生开不了头，请给一个非常简短的开头方向或第一句话的思路。",
        "没想法": "学生没想法，请给1-2个具体的内容方向提示。",
        "帮我提示一下": "请根据上下文给出一个紧凑的提示，帮助学生继续往下说。",
    }
    hint_instruction = hint_type_labels.get(req.hintType, f"学生遇到困难「{req.hintType}」，请给出一个紧凑的提示。")

    prompt = (
        "你是面向小学生的写作思维教练。请根据作文题目、当前段落要求、学生已说内容，"
        "生成一个紧凑的写作提示。\n"
        "要求：\n"
        "1. 控制在25字以内；\n"
        "2. 只给学生「脚手架」，不替他写句子；\n"
        "3. 不要重复学生已经说过的内容；\n"
        "4. 语气温暖鼓励。\n\n"
        f"作文题目：{req.title}\n"
        f"题目要求：{req.content}\n"
        f"当前段落：{req.sectionLabel} — {req.sectionGuide}\n"
        f"学生在该段已说：{req.studentText if req.studentText else '（还没开始）'}\n"
        f"学生卡住时长：{req.stuckDurationMs // 1000}秒"
    )
    user_msg = hint_instruction
    try:
        reply = svc.chat(prompt, user_msg, max_tokens=512, caller="essay_hint")
        return HintResponse(hint=reply.strip())
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429 统一提示
    except Exception as e:
        logger.error("生成提示失败: %s", e)
        return HintResponse(hint="慢慢来，想到什么就说什么。加油！")


@router.post("/essays/score", response_model=ScoreResponse)
async def score_essay(req: ScoreRequest):
    """LLM 评分与反馈"""
    section_detail = ""
    for i, (sec, text) in enumerate(zip(req.sections, req.sectionTexts)):
        prefix_num = ["①", "②", "③", "④", "⑤"][i] if i < 5 else f"{i+1}."
        char_count = len(text) if text else 0
        section_detail += f"{prefix_num}{sec.get('label','?')}（{sec.get('guide','')}）：{char_count}字\n"
        if text:
            section_detail += f"  内容：{text[:100]}\n"

    prompt = (
        "你是小学生写作教练。基于以下信息给成长型反馈：\n"
        "1. 不要只给分数，要给出具体的进步点和改进建议\n"
        "2. 表扬写得好的段落和用词\n"
        "3. 指出哪段可以写得更丰富\n"
        "4. 语气温暖鼓励，像教练而不是老师\n"
        "5. 总字数控制在180字以内\n"
    )
    user_msg = (
        f"题目：{req.title}\n"
        f"题目要求：{req.content}\n\n"
        f"段落结构与字数：\n{section_detail}\n"
        f"全文：\n{req.finalText[:500]}\n\n"
        f"请给出成长型反馈。"
    )
    try:
        reply = svc.chat(prompt, user_msg, max_tokens=1024, caller="essay_score")
        return ScoreResponse(feedback=reply.strip())
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429 统一提示
    except Exception as e:
        logger.error("评分失败: %s", e)
        return ScoreResponse(feedback="评分服务暂时不可用，请稍后重试。")


@router.post("/essays/format", response_model=FormatResponse)
async def format_essay(req: FormatRequest):
    """LLM 润饰作文文本"""
    section_text = ""
    for i, (sec, text) in enumerate(zip(req.sections, req.sectionTexts)):
        prefix_num = ["①", "②", "③", "④", "⑤"][i] if i < 5 else f"{i+1}."
        section_text += f"[{prefix_num}{sec.get('label','?')}] {sec.get('guide','')}\n"
        section_text += (text if text else "（学生没有说话）") + "\n\n"

    prompt = (
        "你是中文写作润饰助手。请对学生口述作文做以下处理，不要修改学生原意：\n\n"
        "1. 学生说话已经被分成几个段落（用 ①②③ 标记）。请对每个段落内部做润饰：加入标点、合并零散句子，"
        "但**不要把 A 段的内容挪到 B 段**。\n"
        "2. 每段用 ① ② ③ 开头，后面空两个中文字符再开始正文\n"
        "3. 对明显不符合中文表达习惯的地方做轻微修正，用【】标记修正处\n"
        "4. 保持学生用词风格，不添加新内容\n"
        "5. 如果某段学生没有说话，直接写\"（本段没有内容）\"\n\n"
        "输出纯文本，不要JSON，不要解释。"
    )
    user_msg = f"请按以下段落结构润饰：\n\n{section_text}"
    try:
        reply = svc.chat(prompt, user_msg, max_tokens=2048, caller="essay_format")
        return FormatResponse(formatted=reply.strip())
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429 统一提示
    except Exception as e:
        logger.error("润饰失败: %s", e)
        # fallback: 返回原始文本
        fallback = "\n\n".join(
            f"{['①','②','③','④','⑤'][i] if i < 5 else f'{i+1}.'}　{(t if t else '（本段没有内容）')}"
            for i, t in enumerate(req.sectionTexts)
        )
        return FormatResponse(formatted=fallback)


def _parse_json_array(text: str) -> list:
    """从 LLM 回复中提取 JSON 数组"""
    import re
    text = text.strip()
    # 去掉 markdown 代码块标记
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    # 尝试从文本中提取 [...]
    m = re.search(r'\[.*?\]', text, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group())
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass
    return []
