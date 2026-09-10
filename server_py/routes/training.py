"""训练任务配置 + 每日完成度路由（方向 3：服务端下发配置 + 方向 2：真实完成度回传）。

- GET/PUT /api/v1/training/plan    家长配置的服务端存取（一人一份，透传客户端 JSON）
- POST/GET /api/v1/training/progress 学生真实完成度上报（upsert by plan_item_id + date）与家长查询
全部挂 get_current_user（Bearer JWT），按用户隔离。
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from routes.auth import get_current_user
from database import PracticeSessionRow, TrainingPlanRow, User, get_session

logger = logging.getLogger(__name__)

router = APIRouter()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ───────────────────────── 任务配置 ─────────────────────────

class PlanItemIn(BaseModel):
    id: str
    feature: str = ""
    done: bool = False
    doneAt: int | None = None
    lastResult: dict | None = None
    # 家长对该训练项的配置（如认字选哪个年级批次：{"grades": ["一年级上", ...]}）
    config: dict | None = None


class TrainingPlanIn(BaseModel):
    id: str = ""
    title: str = "今日任务"
    items: list[PlanItemIn] = []
    createdAt: int = 0
    updatedAt: int = 0


@router.get("/training/plan")
async def get_training_plan(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """拉取当前用户的训练任务包（无则 plan=null）。"""
    row = await session.scalar(select(TrainingPlanRow).where(TrainingPlanRow.user_id == user.id))
    if not row or not row.items_json:
        return {"plan": None}
    try:
        plan = json.loads(row.items_json)
    except json.JSONDecodeError:
        return {"plan": None}
    return {"plan": plan}


@router.put("/training/plan")
async def save_training_plan(
    body: TrainingPlanIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """保存/覆盖当前用户的训练任务包（家长端调用，服务端为准）。"""
    items_json = json.dumps(body.model_dump(), ensure_ascii=False)
    row = await session.scalar(select(TrainingPlanRow).where(TrainingPlanRow.user_id == user.id))
    if row:
        row.title = body.title
        row.items_json = items_json
        await session.flush()
    else:
        session.add(TrainingPlanRow(user_id=user.id, title=body.title, items_json=items_json))
        await session.flush()
    await session.commit()
    return {"status": "ok", "plan": body.model_dump()}


# ───────────────────────── 每日完成度 ─────────────────────────

class ProgressIn(BaseModel):
    plan_item_id: str = ""
    feature: str = ""
    date: str = ""  # YYYY-MM-DD，空则取今天
    count: int = 0
    correct: int | None = None
    score: float | None = None
    duration_ms: int = 0
    done_at: int = 0
    metrics: dict | None = None


@router.post("/training/progress")
async def submit_progress(
    body: ProgressIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """学生完成一次真实训练后上报（同任务同日 upsert 覆盖，幂等）。"""
    if not body.plan_item_id:
        raise HTTPException(status_code=400, detail="plan_item_id 必填")
    date = body.date or _today()
    row: PracticeSessionRow | None = await session.scalar(
        select(PracticeSessionRow).where(
            PracticeSessionRow.user_id == user.id,
            PracticeSessionRow.plan_item_id == body.plan_item_id,
            PracticeSessionRow.date == date,
        )
    )
    metrics_json = json.dumps(body.metrics or {}, ensure_ascii=False)
    if row:
        row.feature = body.feature
        row.status = "done"
        row.count = body.count
        row.correct = body.correct
        row.score = body.score
        row.duration_ms = body.duration_ms
        row.metrics_json = metrics_json
        await session.flush()
    else:
        session.add(PracticeSessionRow(
            user_id=user.id,
            plan_item_id=body.plan_item_id,
            feature=body.feature,
            date=date,
            status="done",
            count=body.count,
            correct=body.correct,
            score=body.score,
            duration_ms=body.duration_ms,
            metrics_json=metrics_json,
        ))
        await session.flush()
    await session.commit()
    return {"status": "ok", "date": date}


@router.get("/training/progress")
async def get_progress(
    date: str = "",
    start: str = "",
    end: str = "",
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """家长查询每日完成度：?date=YYYY-MM-DD 单日，或 ?start=&end= 区间。"""
    q = select(PracticeSessionRow).where(PracticeSessionRow.user_id == user.id)
    if date:
        q = q.where(PracticeSessionRow.date == date)
    if start:
        q = q.where(PracticeSessionRow.date >= start)
    if end:
        q = q.where(PracticeSessionRow.date <= end)
    rows = (await session.scalars(q.order_by(PracticeSessionRow.date.desc()))).all()

    return {
        "total": len(rows),
        "sessions": [{
            "plan_item_id": r.plan_item_id,
            "feature": r.feature,
            "date": r.date,
            "status": r.status,
            "count": r.count,
            "correct": r.correct,
            "score": r.score,
            "duration_ms": r.duration_ms,
            "metrics": json.loads(r.metrics_json) if r.metrics_json else {},
        } for r in rows],
    }
