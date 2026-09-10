"""用户导入数据同步 API（按用户隔离）

客户端导入管道：提示词 → 用户 LLM → 本地加工 → 本地存储 → 同步到这里。
- POST /api/v1/user-imports/batch — 批量 upsert（同一 user_id + kind + text 更新，否则新增）
- GET  /api/v1/user-imports — 拉取自己的导入数据（换设备/重装恢复）
- DELETE /api/v1/user-imports/{id} — 删除自己的某条

安全要点：user_id 一律从 JWT token 取（get_current_user），不信任客户端传值。
"""
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import UserImport, User, get_session
from routes.auth import get_current_user

router = APIRouter()


# ── 请求模型 ──
class UserImportItem(BaseModel):
    kind: str = "word"  # word / char / article / sentence / quiz / answer / problem（problem=AI 作业数学应用题，payload 存题目结构化 JSON）
    text: str = ""
    pinyin: str = ""
    meaning: str = ""
    tags: list[str] = []
    payload: str = ""  # JSON 字符串（article 正文 / quiz 明细）
    status: str = "active"


class UserImportBatchRequest(BaseModel):
    items: list[UserImportItem]


# ── 响应模型 ──
def _to_dict(row: UserImport) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "text": row.text,
        "pinyin": row.pinyin,
        "meaning": row.meaning,
        "tags": json.loads(row.tags) if row.tags else [],
        "payload": row.payload,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


@router.post("/user-imports/batch")
async def batch_upsert(
    req: UserImportBatchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """批量 upsert 用户导入数据（同一 user_id + kind + text 视为同一条目）"""
    if not req.items:
        return {"status": "ok", "added": 0, "updated": 0, "total": 0}

    added, updated = 0, 0
    new_rows: list[UserImport] = []  # 新增行（flush 后才有 id）
    for item in req.items:
        text = (item.text or "").strip()
        if not text:
            continue

        # 查找已有条目（user + kind + text）
        result = await session.execute(
            select(UserImport).where(
                UserImport.user_id == current_user.id,
                UserImport.kind == item.kind,
                UserImport.text == text,
            )
        )
        existing = result.scalar_one_or_none()
        tags_json = json.dumps(item.tags, ensure_ascii=False) if item.tags else ""

        if existing:
            existing.pinyin = item.pinyin or existing.pinyin
            existing.meaning = item.meaning or existing.meaning
            existing.tags = tags_json or existing.tags
            existing.payload = item.payload or existing.payload
            existing.status = item.status or "active"
            updated += 1
        else:
            row = UserImport(
                user_id=current_user.id,
                kind=item.kind,
                text=text,
                pinyin=item.pinyin,
                meaning=item.meaning,
                tags=tags_json,
                payload=item.payload,
                status=item.status or "active",
            )
            session.add(row)
            new_rows.append(row)
            added += 1

    await session.commit()
    # 新增行 flush 出服务端 id（返回给客户端做删除同步）
    for row in new_rows:
        await session.refresh(row)

    # 回读 id 映射（含本次新增与已有条目，按 kind+text）
    result = await session.execute(
        select(UserImport).where(UserImport.user_id == current_user.id)
    )
    id_by_key = {f"{r.kind}\u0000{r.text}": str(r.id) for r in result.scalars().all()}

    # 总数统计
    result = await session.execute(
        select(UserImport).where(
            UserImport.user_id == current_user.id,
            UserImport.status != "deleted",
        )
    )
    total = len(result.scalars().all())
    items = [
        {"id": id_by_key.get(f"{item.kind}\u0000{(item.text or '').strip()}", ""), "kind": item.kind, "text": (item.text or "").strip()}
        for item in req.items if (item.text or "").strip()
    ]
    return {"status": "ok", "added": added, "updated": updated, "total": total, "items": items}


@router.get("/user-imports")
async def list_imports(
    kind: Optional[str] = Query(None, description="按类型过滤：word/char/article/sentence/quiz/answer"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """拉取当前用户的导入数据"""
    query = select(UserImport).where(
        UserImport.user_id == current_user.id,
        UserImport.status != "deleted",
    )
    if kind:
        query = query.where(UserImport.kind == kind)
    query = query.order_by(UserImport.created_at.desc())

    result = await session.execute(query)
    rows = result.scalars().all()
    return {"status": "ok", "items": [_to_dict(r) for r in rows]}


@router.delete("/user-imports/{import_id}")
async def delete_import(
    import_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """删除当前用户的某条导入数据（仅能删自己的）"""
    result = await session.execute(
        select(UserImport).where(
            UserImport.id == import_id,
            UserImport.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    await session.execute(delete(UserImport).where(UserImport.id == import_id))
    await session.commit()
    return {"status": "deleted"}
