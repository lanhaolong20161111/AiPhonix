"""腾讯 SOE 语音评测路由"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from database import SpeechEvalRecord, get_session
from services.soe import TencentSOEService

logger = logging.getLogger(__name__)

router = APIRouter()

svc: TencentSOEService = None  # type: ignore


def init(config: Config):
    global svc
    svc = TencentSOEService(
        config.tencent.app_id,
        config.tencent.secret_id,
        config.tencent.secret_key,
    )


class SOERequest(BaseModel):
    ref_text: str
    audio_base64: str
    engine: str = ""
    user_id: int = 0  # 0 = 未登录评测
    eval_mode: str = ""  # 兼容旧参数（"0"/"1"/"2"/"8"）
    scene: str = ""  # 被测对象类型：word / sentence / paragraph / pinyin（推荐，决定 eval_mode）
    source: str = ""  # 来源字卡/词（评测上下文 char/词），用于历史跳转定位


@router.post("/soe/evaluate")
async def soe_evaluate(req: SOERequest, session: AsyncSession = Depends(get_session)):
    try:
        result = svc.evaluate(req.ref_text, req.audio_base64, req.engine, req.eval_mode, req.scene)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SOE 评测失败: {e}")

    # 记录评测明细（写库失败不阻断评测结果返回，仅告警）
    try:
        engine = result.get("engine", "")
        language = "zh" if "zh" in engine else (
            "zh" if any("\u4e00" <= c <= "\u9fff" for c in req.ref_text) else "en"
        )
        # eval_type 用 scene（被测对象类型）标记，区分 字/词/句/段/拼音；
        # 旧调用只传 eval_mode 数字时按 0/1/2/8 映射回场景名，都不传则按文本启发式
        eval_type = req.scene or ""
        if not eval_type and req.eval_mode:
            eval_type = {"0": "word", "1": "sentence", "2": "paragraph", "8": "pinyin"}.get(req.eval_mode, "")
        if not eval_type:
            eval_type = "sentence" if " " in req.ref_text else "word"
        record = SpeechEvalRecord(
            user_id=req.user_id,
            language=language,
            eval_type=eval_type,
            ref_text=req.ref_text[:500],
            source=req.source[:255],
            engine=engine,
            total_accuracy=result.get("pron_accuracy", 0.0),
            total_fluency=result.get("pron_fluency", 0.0),
            total_completion=result.get("pron_completion", 0.0),
            suggested_score=result.get("suggested_score", 0.0),
            details=json.dumps(result.get("words", []), ensure_ascii=False),
        )
        session.add(record)
        await session.commit()
        logger.info("[SOE] 已记录评测: user=%d lang=%s type=%s ref=%s",
                    req.user_id, language, eval_type, req.ref_text[:30])
    except Exception as e:
        logger.warning("[SOE] 评测记录写入失败: %s", e)

    return result


class RecordsQuery(BaseModel):
    user_id: int = 0
    language: str = ""  # zh / en，空 = 全部
    eval_type: str = ""  # word / sentence，空 = 全部
    limit: int = 50
    offset: int = 0


@router.post("/soe/records")
async def get_soe_records(req: RecordsQuery, session: AsyncSession = Depends(get_session)):
    """查询语音评测历史记录（按时间倒序），供 AI 优化学习方案使用"""
    stmt = select(SpeechEvalRecord).order_by(SpeechEvalRecord.created_at.desc())
    if req.user_id > 0:
        stmt = stmt.where(SpeechEvalRecord.user_id == req.user_id)
    if req.language:
        stmt = stmt.where(SpeechEvalRecord.language == req.language)
    if req.eval_type:
        stmt = stmt.where(SpeechEvalRecord.eval_type == req.eval_type)
    stmt = stmt.offset(req.offset).limit(min(req.limit, 200))

    rows = (await session.execute(stmt)).scalars().all()
    records = []
    for r in rows:
        try:
            details = json.loads(r.details) if r.details else []
        except Exception:
            details = []
        records.append({
            "id": r.id,
            "user_id": r.user_id,
            "language": r.language,
            "eval_type": r.eval_type,
            "ref_text": r.ref_text,
            "source": r.source or "",
            "engine": r.engine,
            "total_accuracy": r.total_accuracy,
            "total_fluency": r.total_fluency,
            "total_completion": r.total_completion,
            "suggested_score": r.suggested_score,
            "units": details,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return {"total": len(records), "records": records}


@router.delete("/soe/records/{record_id}")
async def delete_soe_record(record_id: int, session: AsyncSession = Depends(get_session)):
    """删除单条语音评测记录"""
    from sqlalchemy import delete as sql_delete
    stmt = sql_delete(SpeechEvalRecord).where(SpeechEvalRecord.id == record_id)
    result = await session.execute(stmt)
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"ok": True, "deleted": record_id}


class BatchDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/soe/records/batch-delete")
async def batch_delete_soe_records(body: BatchDeleteRequest, session: AsyncSession = Depends(get_session)):
    """批量删除语音评测记录"""
    from sqlalchemy import delete as sql_delete
    if not body.ids:
        return {"ok": True, "deleted": 0}
    stmt = sql_delete(SpeechEvalRecord).where(SpeechEvalRecord.id.in_(body.ids))
    result = await session.execute(stmt)
    await session.commit()
    return {"ok": True, "deleted": result.rowcount}
