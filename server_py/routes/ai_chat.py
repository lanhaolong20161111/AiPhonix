"""AI 语数英对话路由 — 带跨会话学生画像的多轮问答

- 前端 useAiChat 调用本接口 /ai-chat/ask（JWT 取 user_id）
- 每次回答：读学生画像 → 注入 system prompt（个性化）→ 调 LLM
  → 解析回复尾部的「【画像】易错/掌握」标记回写画像 → 返回回复
- 画像表 student_profiles（按 user_id + module 一条），跨会话持久
"""

import asyncio
import json
import logging
import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from database import StudentProfile, AiChatSession, get_session
from routes.auth import get_current_user
from services.deepseek import BudgetExceededError, DeepSeekService
from services.free_llm import get_service as get_free_llm_service

logger = logging.getLogger(__name__)

# 多模态模型（免费火山 Ark，支持文本+图片）——统一 doubao-seed-2-1-turbo-260628
MODEL_MULTIMODAL = "doubao-seed-2-1-turbo-260628"

router = APIRouter()

svc: DeepSeekService = None  # type: ignore

# 画像阈值
_MAX_MISTAKES = 15
_MAX_MASTERED = 10

_MODULE_LABEL = {
    "chinese": "语文",
    "math": "数学",
    "english": "英语",
}

_SYSTEM_BY_MODULE = {
    "chinese": "你是一位温柔、耐心的小学语文老师。请用简体中文、用小学生能懂的话回答问题，适当鼓励，可以举例。",
    "math": "你是一位小学（低年级）数学老师。请用简体中文、简单易懂的方式讲解数学题，可以板书思路、一步步引导，多鼓励。",
    "english": "你是一位儿童英语老师。请用简体中文为主、适当夹带英文，用 6-12 岁孩子能懂的方式讲解英语，注意发音和简单词句。",
}


class ChatHistoryItem(BaseModel):
    role: str  # user / assistant
    content: str


class AskRequest(BaseModel):
    module: str = "chinese"
    message: str
    history: list[ChatHistoryItem] = []
    # 可选：本轮附带的服务端图片相对路径（/api/v1/uploads/file/xxx），走多模态问答
    image_url: str = ""
    # 会话 id：有则续聊（后端读历史），无则新开会话
    session_id: str = ""


class AskResponse(BaseModel):
    reply: str
    session_id: str = ""
    # D 工具结果：朗读音频 URL（可选）
    tts_url: str = ""
    # D 工具结果：查词得到的词条信息（可选）
    word_info: str = ""


# ── 画像读写（SQLite 表） ──


async def _load_profile(session: AsyncSession, user_id: int, module: str) -> dict:
    try:
        row = await session.scalar(
            select(StudentProfile).where(
                StudentProfile.user_id == user_id, StudentProfile.module == module
            )
        )
        if row is None:
            return {}
        return {
            "session_count": row.session_count,
            "last_content": row.last_content,
            "mistakes": json.loads(row.mistakes or "[]"),
            "mastered": json.loads(row.mastered or "[]"),
        }
    except Exception:
        logger.exception("读取学生画像失败 user=%s module=%s", user_id, module)
        return {}


async def _save_profile(session: AsyncSession, user_id: int, module: str, profile: dict) -> None:
    try:
        row = await session.scalar(
            select(StudentProfile).where(
                StudentProfile.user_id == user_id, StudentProfile.module == module
            )
        )
        if row is None:
            row = StudentProfile(user_id=user_id, module=module)
            session.add(row)
        row.session_count = profile.get("session_count", row.session_count)
        row.last_content = profile.get("last_content", row.last_content)
        row.mistakes = json.dumps(profile.get("mistakes", []), ensure_ascii=False)
        row.mastered = json.dumps(profile.get("mastered", []), ensure_ascii=False)
        await session.commit()
    except Exception:
        logger.exception("保存学生画像失败 user=%s module=%s", user_id, module)


def _profile_prompt(profile: dict) -> str:
    """把画像渲染成 prompt 片段（空画像返回空串）"""
    parts = []
    if profile.get("session_count"):
        parts.append(f"- 该科目已练习次数：{profile['session_count']}")
    if profile.get("last_content"):
        parts.append(f"- 上次练习主题：{profile['last_content']}")
    mistakes = profile.get("mistakes") or []
    if mistakes:
        parts.append("- 该生常犯错误（可针对性巩固）：" + "；".join(mistakes[-8:]))
    mastered = profile.get("mastered") or []
    if mastered:
        parts.append("- 该生已掌握主题（可适当进阶）：" + "；".join(mastered[-5:]))
    return "\n".join(parts)


def _parse_profile_tags(reply: str) -> tuple[str, list[str], list[str]]:
    """从回复中解析 `【画像】易错：...；掌握：...` 标记，返回 (干净回复, 新易错, 新掌握)"""
    m = re.search(r"【画像】\s*(.*)$", reply, re.S)
    if not m:
        return reply, [], []
    tag = m.group(1)
    clean = reply[: m.start()].strip()
    mistakes: list[str] = []
    mastered: list[str] = []
    # 易错 / 掌握 两段
    err_match = re.search(r"易错[:：]\s*(.+)", tag)
    mas_match = re.search(r"掌握[:：]\s*(.+)", tag)
    if err_match:
        mistakes = [x.strip() for x in re.split(r"[；;、，,]", err_match.group(1)) if x.strip()][:4]
    if mas_match:
        mastered = [x.strip() for x in re.split(r"[；;、，,]", mas_match.group(1)) if x.strip()][:4]
    return clean, mistakes, mastered


# ── API ──


def _resolve_upload_path(image_url: str) -> str:
    """把 /api/v1/uploads/file/xxx.jpg 解析为 server_py/data/uploads/xxx.jpg；非法返回空"""
    name = image_url.rsplit("/", 1)[-1]
    if not name or ".." in name or "/" in name:
        return ""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "uploads", name)
    return path if os.path.isfile(path) else ""


async def _load_chat_messages(session: AsyncSession, session_id: str, user_id: int) -> tuple[str | None, list[dict]]:
    """按 session_id + user_id 读会话消息；无则返回 (None, [])"""
    row = await session.scalar(
        select(AiChatSession).where(
            AiChatSession.session_id == session_id, AiChatSession.user_id == user_id
        )
    )
    if row is None:
        return None, []
    try:
        msgs = json.loads(row.messages or "[]")
    except Exception:
        msgs = []
    return row.module, msgs


async def _touch_chat_session(session: AsyncSession, session_id: str, user_id: int, module: str,
                              messages: list[dict]) -> None:
    """创建或更新会话（messages 为最新完整历史）"""
    try:
        row = await session.scalar(
            select(AiChatSession).where(
                AiChatSession.session_id == session_id, AiChatSession.user_id == user_id
            )
        )
        if row is None:
            row = AiChatSession(session_id=session_id, user_id=user_id, module=module)
            session.add(row)
        row.messages = json.dumps(messages[-30:], ensure_ascii=False)  # 最多保留 30 条
        row.module = module
        await session.commit()
    except Exception:
        logger.exception("保存对话会话失败 session=%s", session_id)


def _parse_tool_tags(reply: str) -> tuple[str, str, str]:
    """从回复解析工具标记：`【朗读】文本` 和 `【查词】词`。
    返回 (干净回复, 朗读文本, 查词词条)"""
    speak = ""
    word = ""
    for m in re.finditer(r"【朗读】\s*([^\n【】]+)", reply):
        speak = (speak + " " + m.group(1).strip()).strip()
    for m in re.finditer(r"【查词】\s*([^\n【】]+)", reply):
        word = m.group(1).strip()
    # 移除工具标记行，保留干净回复
    clean = re.sub(r"【(朗读|查词)】[^\n]*\n?", "", reply).strip()
    return clean, speak, word


def _lookup_word(q: str) -> str:
    """查词库（中文词库 web/public/chinese_wordbank.json）返回词条信息；无则空"""
    try:
        path = os.path.join("..", "web", "public", "chinese_wordbank.json")
        if not os.path.isfile(path):
            path = os.path.join("web", "public", "chinese_wordbank.json")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        hits = []
        for w in (data.get("words") or []):
            if q in (w.get("text") or ""):
                p = w.get("pinyin") or ""
                hits.append(f"{w['text']}（{p}）" if p else w["text"])
            if len(hits) >= 5:
                break
        return "；".join(hits) if hits else ""
    except Exception:
        return ""


def _auto_speak_text(reply: str, word_q: str, max_len: int = 40) -> str:
    """自动提取一个简短朗读片段：优先学生问的词；否则取回答第一句（截断）。"""
    # 优先朗读学生刚问的字/词（教学重点）
    if word_q and word_q.strip():
        return word_q.strip()
    if not reply:
        return ""
    # 取第一句（按句号/感叹号/问号/换行切分）
    import re as _re
    first = _re.split(r"[。！？!?\n]+", reply, maxsplit=1)[0].strip()
    # 去除可能残留的 `【`标注、markdown 星号、编号
    first = first.replace("*", "").replace("**", "").strip(" #-·0123456789.")
    if not first:
        return ""
    first = first[:max_len]
    return first or ""


@router.post("/ai-chat/ask", response_model=AskResponse)
async def ai_chat_ask(req: AskRequest, session: AsyncSession = Depends(get_session),
                       user=Depends(get_current_user)):
    message = (req.message or "").strip()
    image_url = (req.image_url or "").strip()
    module = req.module if req.module in _MODULE_LABEL else "chinese"
    session_id = (req.session_id or "").strip() or f"ai_{user.id}_{module}_{uuid.uuid4().hex[:10]}"

    # 0) 会话：读历史消息（断点续聊）。兼容旧前端仍传 history 的情况。
    sess_module, sess_messages = await _load_chat_messages(session, session_id, user.id)
    if sess_module:
        module = sess_module
    # 历史消息：有会话则用会话记录；否则用请求携带的 history 兜底
    history_messages = sess_messages if sess_messages else [
        {"role": h.role, "content": h.content} for h in req.history if h.content
    ]

    # 1) 读画像
    profile = await _load_profile(session, user.id, module)
    profile_text = _profile_prompt(profile)

    # 2) 拼接对话上下文（会话历史 + 当前消息）
    history_lines = [f"{'学生' if m['role']=='user' else '老师'}：{m['content']}" for m in history_messages[-10:]]
    context = "\n".join(history_lines)
    user_prompt = f"{context}\n学生：{message}" if context else f"学生：{message}"

    # 3) 构建 system（模块角色 + 画像）+ 图片 + 画像/工具标记指令
    system = _SYSTEM_BY_MODULE.get(module, _SYSTEM_BY_MODULE["chinese"])
    if profile_text:
        system += f"\n\n【该学生的历史画像】\n{profile_text}\n请结合画像个性化解答：巩固易错点、可适当进阶、避免重复已掌握的低阶问题。"
    if image_url:
        system += "\n\n【本轮附带一张图片】请先看图，再结合学生的问题/对话给出讲解。"
    system += (
        "\n\n【输出约定】在回答末尾若能识别学生的薄弱点或掌握点，另起一行按格式输出（没有可不输出）："
        "【画像】易错：知识点1；掌握：知识点2\n"
        "若回答涉及需要发音/朗读的内容（字、词、句、课文），请在回答中单独输出一行：【朗读】要朗读的文本（优先放需要学的字/词/短句，10 字以内最佳）。\n"
        "若学生问到某个词语的意思/拼音/用法，可在回答末尾输出一行：【查词】词语。"
    )

    # 4) 调 LLM（有图走免费多模态，无图走文本 DeepSeek）
    image_path = _resolve_upload_path(image_url) if image_url else ""
    if image_path:
        try:
            ark = get_free_llm_service()
            raw = await asyncio.wait_for(
                asyncio.to_thread(
                    ark.chat, user_prompt, system_prompt=system,
                    image_paths=[image_path], max_tokens=1024,
                    model_override=MODEL_MULTIMODAL,
                ),
                timeout=90,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="AI 响应超时，请稍后重试")
        except Exception as e:
            logger.warning("ai_chat 多模态调用失败（module=%s）: %s", module, e)
            raise HTTPException(status_code=502, detail=f"AI 调用失败：{e}")
    else:
        raw = ""
        try:
            raw = await asyncio.to_thread(
                svc.chat, system, user_prompt,
                max_tokens=1024, caller=f"ai_chat_{module}",
            )
        except BudgetExceededError:
            raise

    # 5) 解析画像标记 + 工具标记
    reply, new_mistakes, new_mastered = _parse_profile_tags(raw)
    reply, speak_text, word_q = _parse_tool_tags(reply)
    reply = (reply or raw).strip() or "（AI 暂时没有回应，请再试一次）"

    # D 工具：查词库
    word_info = ""
    if word_q:
        info = _lookup_word(word_q)
        if info:
            word_info = f"{word_q}：{info}"

    # D 工具：朗读。AI 未显式给出【朗读】时，自动提取一个简短朗读片段，
    # 保证每个回答尽量都能附上「🔊 朗读」。
    if not speak_text.strip():
        speak_text = _auto_speak_text(reply, word_q)

    # 6) 回写画像
    updated = _merge_profile(profile, message or "（看图）", new_mistakes, new_mastered)
    await _save_profile(session, user.id, module, updated)

    # 7) 保存会话（追加本轮 user + assistant）
    messages = history_messages + [{"role": "user", "content": message or "（图片）"}, {"role": "assistant", "content": reply}]
    await _touch_chat_session(session, session_id, user.id, module, messages)

    return AskResponse(reply=reply, session_id=session_id, tts_url=speak_text, word_info=word_info)


def _merge_profile(profile: dict, message: str, new_mistakes: list[str], new_mastered: list[str]) -> dict:
    mistakes = list(dict.fromkeys(profile.get("mistakes", []) + new_mistakes))[-_MAX_MISTAKES:]
    mastered = list(dict.fromkeys(profile.get("mastered", []) + new_mastered))[-_MAX_MASTERED:]
    return {
        "session_count": int(profile.get("session_count", 0)) + 1,
        "last_content": message[:200],
        "mistakes": mistakes,
        "mastered": mastered,
    }


def init(config: Config):
    global svc
    svc = DeepSeekService(config.deepseek, "ai_chat")
