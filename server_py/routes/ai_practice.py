"""ai陪我练 路由 — LangGraph 多轮引导对话 + 结果页数据

- POST /ai-practice/sessions            创建会话（导入主题）→ 返回第一个问题
- POST /ai-practice/sessions/{id}/chat  发送学生回答 → 返回评估 + 下一个问题
- GET  /ai-practice/sessions            历史列表（个人中心）
- GET  /ai-practice/sessions/{id}       会话详情（结果页：回答 vs 纠正对比）

需要登录（JWT），会话按用户隔离。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from database import AiPracticeSessionRow, AiPracticeTurnRow, get_session
from routes.auth import get_current_user
from services import ai_practice as ai_svc

logger = logging.getLogger(__name__)

router = APIRouter()

CONTENT_TYPES = {"char", "word", "sentence", "article"}
MAX_CONTENT_LEN = 2000


async def init(config: Config):
    """初始化 LangGraph（幂等）"""
    await ai_svc.build_graph(config.deepseek)
    logger.info("ai陪我练 LangGraph 已初始化")


# ---- 数据模型 ----

class CreateSessionRequest(BaseModel):
    content: str
    content_type: str = "sentence"  # char | word | sentence | article
    task: str = ""  # 认读/造句/问答/翻译/考题（空=按类型默认）


class ChatRequest(BaseModel):
    text: str


class TurnOut(BaseModel):
    role: str
    text: str
    correction: str = ""
    praise: str = ""
    audio_path: str = ""
    created_at: str = ""


# ---- 路由 ----

@router.post("/ai-practice/sessions")
async def create_session(
    req: CreateSessionRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
    """创建 ai陪我练 会话，返回第一个引导问题"""
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="学习内容不能为空")
    if len(content) > MAX_CONTENT_LEN:
        raise HTTPException(status_code=422, detail=f"学习内容过长（最多 {MAX_CONTENT_LEN} 字）")
    if req.content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="content_type 必须是 char/word/sentence/article 之一")

    row = AiPracticeSessionRow(
        user_id=user.id,
        content_type=req.content_type,
        content=content,
        task=req.task.strip()[:32],
        status="active",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    try:
        question = await ai_svc.start_session(
            row.id, user.id, row.content_type, row.content, row.task
        )
    except Exception as e:
        logger.exception("ai陪我练 创建会话失败 session=%s", row.id)
        await session.delete(row)
        await session.commit()
        raise HTTPException(status_code=502, detail=f"AI 初始化失败：{e}")

    # 保存首问
    turn = AiPracticeTurnRow(session_id=row.id, role="ai", text=question)
    session.add(turn)
    await session.commit()

    return {
        "session_id": row.id,
        "content": row.content,
        "content_type": row.content_type,
        "task": row.task,
        "question": question,
    }


@router.post("/ai-practice/sessions/{session_id}/chat")
async def chat(
    session_id: int,
    req: ChatRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
    """发送学生回答，返回纠正/表扬 + 下一个问题"""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="回答不能为空")
    if len(text) > MAX_CONTENT_LEN:
        raise HTTPException(status_code=422, detail="回答过长")

    row = await session.scalar(
        select(AiPracticeSessionRow).where(
            AiPracticeSessionRow.id == session_id,
            AiPracticeSessionRow.user_id == user.id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if row.status != "active":
        raise HTTPException(status_code=409, detail="会话已结束")

    try:
        result = await ai_svc.send_answer(session_id, user.id, text)
    except Exception as e:
        logger.exception("ai陪我练 对话失败 session=%s", session_id)
        raise HTTPException(status_code=502, detail=f"AI 响应失败：{e}")

    # 保存学生回答 + AI 回复（回答与纠正成对，结果页对比展示）
    user_turn = AiPracticeTurnRow(
        session_id=session_id, role="user", text=text,
        correction=result["correction"], praise=result["praise"],
    )
    ai_turn = AiPracticeTurnRow(session_id=session_id, role="ai", text=result["question"])
    session.add_all([user_turn, ai_turn])
    if result["done"]:
        row.status = "done"
    await session.commit()

    return {
        "correction": result["correction"],
        "praise": result["praise"],
        "question": result["question"],
        "done": result["done"],
    }


@router.get("/ai-practice/sessions")
async def list_sessions(
    session: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
    """会话历史列表（个人中心）"""
    rows = await session.execute(
        select(AiPracticeSessionRow)
        .where(AiPracticeSessionRow.user_id == user.id)
        .order_by(AiPracticeSessionRow.id.desc())
        .limit(100)
    )
    out = []
    for r in rows.scalars():
        turn_count = await session.scalar(
            select(func.count(AiPracticeTurnRow.id)).where(
                AiPracticeTurnRow.session_id == r.id
            )
        )
        out.append(
            {
                "session_id": r.id,
                "content": r.content,
                "content_type": r.content_type,
                "task": r.task,
                "status": r.status,
                "turn_count": turn_count or 0,
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
        )
    return {"sessions": out}


@router.get("/ai-practice/sessions/{session_id}")
async def get_session_detail(
    session_id: int,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
    """会话详情（对话 + 结果对比）"""
    row = await session.scalar(
        select(AiPracticeSessionRow).where(
            AiPracticeSessionRow.id == session_id,
            AiPracticeSessionRow.user_id == user.id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    turns = await session.execute(
        select(AiPracticeTurnRow)
        .where(AiPracticeTurnRow.session_id == session_id)
        .order_by(AiPracticeTurnRow.id)
    )
    return {
        "session_id": row.id,
        "content": row.content,
        "content_type": row.content_type,
        "task": row.task,
        "status": row.status,
        "plan": row.plan_json,
        "turns": [
            {
                "role": t.role,
                "text": t.text,
                "correction": t.correction,
                "praise": t.praise,
                "audio_path": t.audio_path,
                "created_at": t.created_at.isoformat() if t.created_at else "",
            }
            for t in turns.scalars()
        ],
    }
