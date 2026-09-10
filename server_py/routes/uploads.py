"""移动端上传采集路由：拍照图片 + 文本，存储备用（供后续练习内容使用）"""

import asyncio
import logging
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import UploadRecord, get_session, async_session

logger = logging.getLogger(__name__)

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "uploads")
MAX_FILE_MB = 20


# 图片处理工具（拆分自胖路由，见 utils/ai_image_utils.py）
from utils.ai_image_utils import auto_orient as _auto_orient

# ── EasyOCR 单例（懒加载，后台线程使用）──
_reader = None
_reader_lock = asyncio.Lock()


def _get_reader():
    global _reader
    if _reader is None:
        import easyocr

        # ch_sim + en：中文简体 + 英文，gpu=False 走 CPU
        _reader = easyocr.Reader(["ch_sim", "en"], gpu=False)
    return _reader


def _recognize_sync(path: str) -> str:
    """同步 OCR（在后台线程执行），失败返回空串"""
    reader = _get_reader()
    results = reader.readtext(path, detail=0)
    return "\n".join(results)


async def _do_ocr(record_id: int, path: str):
    """后台任务：识别图片文本并回写 upload_records.ocr_text"""
    try:
        text = await asyncio.to_thread(_recognize_sync, path)
    except Exception as e:
        logger.warning("[uploads] OCR 失败 record=%d: %s", record_id, e)
        return
    try:
        async with async_session() as session:
            rec = await session.get(UploadRecord, record_id)
            if rec is not None:
                rec.ocr_text = text
                await session.commit()
                logger.info("[uploads] OCR 完成 record=%d len=%d", record_id, len(text))
    except Exception as e:
        logger.warning("[uploads] OCR 结果写库失败 record=%d: %s", record_id, e)


# ── 端点 ──


@router.post("/uploads/photo")
async def upload_photo(
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    file: UploadFile = File(...),
    note: str = Form(""),
    origin: str = Form(""),
    uploader: str = Form(""),
):
    """拍照/选图上传：原图落盘 data/uploads/，后台 EasyOCR 识别文本备用"""
    data = await file.read()
    if len(data) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"图片超过 {MAX_FILE_MB}MB 限制")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"):
        ext = ".jpg"
    file_name = f"{uuid.uuid4().hex}{ext}"

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, file_name)
    with open(path, "wb") as f:
        f.write(data)
    # 图片方向自动校正（EXIF Orientation → 旋转像素为正向），保证 OCR 识别方向正确
    path = await asyncio.to_thread(_auto_orient, path)

    record = UploadRecord(
        kind="photo",
        file_name=file_name,
        note=note[:500],
        source="web",
        uploader=uploader[:64],
        origin=origin[:256],
    )
    session.add(record)
    await session.commit()
    record_id = record.id

    background.add_task(_do_ocr, record_id, path)

    return {
        "id": record_id,
        "kind": "photo",
        "file_name": file_name,
        "url": f"/api/v1/uploads/file/{file_name}",
        "note": note,
        "origin": origin,
        "status": "ok",
    }


class TextUploadRequest(BaseModel):
    text: str
    note: str = ""
    origin: str = ""
    uploader: str = ""


@router.post("/uploads/text")
async def upload_text(req: TextUploadRequest, session: AsyncSession = Depends(get_session)):
    """文本上传：直接入库存储备用"""
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="文本内容为空")
    record = UploadRecord(
        kind="text",
        content=req.text[:10000],
        note=req.note[:500],
        source="web",
        uploader=req.uploader[:64],
        origin=req.origin[:256],
    )
    session.add(record)
    await session.commit()
    return {
        "id": record.id,
        "kind": "text",
        "content": req.text,
        "note": req.note,
        "origin": req.origin,
        "status": "ok",
    }


@router.get("/uploads")
async def list_uploads(
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
):
    """上传记录列表（按时间倒序）"""
    stmt = (
        select(UploadRecord)
        .order_by(UploadRecord.created_at.desc())
        .offset(max(offset, 0))
        .limit(min(max(limit, 1), 200))
    )
    rows = (await session.execute(stmt)).scalars().all()
    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "kind": r.kind,
            "file_name": r.file_name,
            "url": f"/api/v1/uploads/file/{r.file_name}" if r.file_name else "",
            "content": r.content,
            "ocr_text": r.ocr_text,
            "note": r.note,
            "source": r.source,
            "uploader": r.uploader,
            "origin": r.origin,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return {"total": len(items), "items": items}


@router.get("/uploads/file/{file_name}")
async def get_upload_file(file_name: str):
    """提供上传的图片文件"""
    path = os.path.join(UPLOAD_DIR, os.path.basename(file_name))
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path)
