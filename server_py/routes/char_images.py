"""汉字图片路由 — 存储/查询识字表图片"""

import json
import logging
import os
import re
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pypinyin import pinyin as _pypinyin, Style

logger = logging.getLogger(__name__)

router = APIRouter()

DATA_DIR = "data"
INDEX_FILE = os.path.join(DATA_DIR, "char_image_index.json")
IMAGE_DIR = os.path.join(DATA_DIR, "char_images")

_index: list[dict] = []
_index_map: dict[str, dict] = {}  # char -> entry
_pinyin_cache: dict[str, str] = {}  # char -> pinyin


def init(*args):
    """初始化：加载索引"""
    global _index, _index_map
    _index = []
    _index_map = {}

    # 确保目录存在
    os.makedirs(IMAGE_DIR, exist_ok=True)

    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE, encoding="utf-8") as f:
            data = json.load(f)
        _index = data.get("items", [])
        for item in _index:
            _index_map[item["char"]] = item

    logger.info("汉字图片索引已加载: %d 条", len(_index))


def _get_pinyin(char: str) -> str:
    """获取汉字的拼音（带声调），多字用空格分隔；纯英文/无汉字返回空串（英词/英句不显示拼音）"""
    if not char or not re.search(r'[\u4e00-\u9fff]', char):
        return ""
    if char in _pinyin_cache:
        return _pinyin_cache[char]
    try:
        result = ' '.join(p[0] for p in _pypinyin(char, style=Style.TONE))
        _pinyin_cache[char] = result
        return result
    except Exception:
        return char


def _save_index():
    """持久化索引"""
    os.makedirs(os.path.dirname(INDEX_FILE), exist_ok=True)
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "total": len(_index), "items": _index},
                  f, ensure_ascii=False, indent=2)


# ── API ──

@router.get("/char-images")
async def list_char_images(
    grade: str = "",
    semester: str = "",
    type_: str = "",
    q: str = "",
    limit: int = 500,
):
    """查询汉字图片列表，支持按年级/学期/类型/关键词筛选"""
    result = _index
    if grade:
        result = [e for e in result if e.get("grade") == grade]
    if semester:
        result = [e for e in result if e.get("semester") == semester]
    if type_:
        result = [e for e in result if e.get("type") == type_]
    if q:
        ql = q.lower()
        result = [
            e for e in result
            if ql in e.get("char", "").lower()
            or ql in e.get("image", "").lower()
        ]
    total_before_limit = len(result)
    if limit > 0:
        result = result[:limit]
    # 添加拼音
    for item in result:
        if "pinyin" not in item:
            item["pinyin"] = _get_pinyin(item.get("char", ""))
    return {"total": total_before_limit, "items": result}


# ── 反馈（必须在 {char} 路由之前）──

FEEDBACK_FILE = os.path.join(DATA_DIR, "char_image_feedback.json")

def _load_feedback() -> list:
    if os.path.exists(FEEDBACK_FILE):
        with open(FEEDBACK_FILE, encoding="utf-8") as f:
            return json.load(f)
    return []

def _save_feedback(items: list):
    os.makedirs(os.path.dirname(FEEDBACK_FILE), exist_ok=True)
    with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

@router.post("/char-images/feedback")
async def submit_feedback(body: dict):
    """提交图片反馈（幂等：同 char+grade+semester+type 覆盖旧记录，不追加）"""
    from datetime import datetime
    entry = {
        "char": body.get("char", ""),
        "grade": body.get("grade", ""),
        "semester": body.get("semester", ""),
        "type": body.get("type", ""),
        "learning_status": body.get("learning_status"),
        "needs_regen": body.get("needs_regen", False),
        "timestamp": datetime.now().isoformat(),
    }
    feedbacks = _load_feedback()
    existing = next(
        (x for x in feedbacks
         if x.get("char") == entry["char"]
         and x.get("grade") == entry["grade"]
         and x.get("semester") == entry["semester"]
         and x.get("type") == entry["type"]),
        None,
    )
    if existing:
        # 字段级合并：learning_status 新值非 None 才覆盖；needs_regen 一旦 true 保持 true
        if entry["learning_status"] is not None:
            existing["learning_status"] = entry["learning_status"]
        existing["needs_regen"] = bool(existing.get("needs_regen")) or bool(entry["needs_regen"])
        existing["timestamp"] = entry["timestamp"]
    else:
        feedbacks.append(entry)
    _save_feedback(feedbacks)
    logger.info("反馈已保存(幂等): char=%s status=%s regen=%s",
                entry["char"], entry["learning_status"], entry["needs_regen"])
    return {"status": "ok"}


@router.get("/char-images/feedback")
async def list_feedback():
    """查看所有反馈"""
    return {"total": len(_load_feedback()), "items": _load_feedback()}


@router.get("/char-images/{char}")
async def get_char_image(char: str):
    """查询某个汉字的图片信息"""
    entry = _index_map.get(char)
    if not entry:
        raise HTTPException(status_code=404, detail=f"汉字 '{char}' 没有图片")
    result = dict(entry)
    if "pinyin" not in result:
        result["pinyin"] = _get_pinyin(result.get("char", ""))
    return result


@router.get("/char-images/file/{filename}")
async def serve_char_image(filename: str):
    """提供图片文件"""
    file_path = os.path.join(IMAGE_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(file_path, media_type="image/png")


# ── 录音 ──

AUDIO_DIR = os.path.join(DATA_DIR, "char_audio")

@router.post("/char-images/audio")
async def upload_audio(char: str = Form(...), file: UploadFile = File(...)):
    """上传录音文件"""
    content = await file.read()
    if not char or not content:
        raise HTTPException(status_code=400, detail="缺少 char 或音频文件")
    os.makedirs(AUDIO_DIR, exist_ok=True)
    # 用 char 做文件名，防特殊字符
    safe_name = char.replace("/", "_").replace("\\", "_").replace(":", "_")
    file_path = os.path.join(AUDIO_DIR, f"{safe_name}.mp3")
    with open(file_path, "wb") as f:
        f.write(content)
    logger.info("录音已保存: %s (%d bytes)", safe_name, len(content))
    return {"status": "ok", "filename": f"{safe_name}.mp3"}


@router.get("/char-images/audio/{char}/exists")
async def audio_exists(char: str):
    """查询录音文件是否存在"""
    safe_name = char.replace("/", "_").replace("\\", "_").replace(":", "_")
    file_path = os.path.join(AUDIO_DIR, f"{safe_name}.mp3")
    return {"exists": os.path.exists(file_path)}


@router.get("/char-images/audio/{filename}")
async def serve_audio(filename: str):
    """提供录音文件"""
    # 安全检查：防止路径穿越
    safe = os.path.basename(filename)
    file_path = os.path.join(AUDIO_DIR, safe)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="录音不存在")
    return FileResponse(file_path, media_type="audio/mpeg")
