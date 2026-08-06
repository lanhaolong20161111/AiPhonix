"""拼音音频路由 — 提供 pinyin_audio/ 目录下的声母/韵母/整体认读音节/声调 mp3"""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter()

DATA_DIR = "data"
PINYIN_AUDIO_DIR = os.path.join(DATA_DIR, "pinyin_audio")

# 允许的子目录（与下载脚本的目录名一一对应）
ALLOWED_KINDS = {
    "声母",
    "韵母",
    "整体认读音节",
    "单韵母声调",
    "复韵母声调",
    "鼻韵母声调",
    "整体认读声调",
    "特殊韵母声调",
}


def init(*args):
    os.makedirs(PINYIN_AUDIO_DIR, exist_ok=True)
    logger.info("拼音音频目录: %s", PINYIN_AUDIO_DIR)


@router.get("/pinyin-audio")
async def serve_pinyin_audio(file: str):
    """提供拼音音频文件。

    file 参数为相对路径，如 `声母/b.mp3`、`复韵母声调/ai1.mp3`、`整体认读音节/zhi.mp3`。
    只允许白名单子目录 + basename 校验，防止路径穿越。
    """
    parts = file.split("/")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="file 格式应为 目录/文件名")
    kind, name = parts
    if kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail=f"不允许的目录: {kind}")
    safe = os.path.basename(name)  # 防路径穿越
    if not safe.endswith(".mp3"):
        raise HTTPException(status_code=400, detail="只支持 mp3")
    file_path = os.path.join(PINYIN_AUDIO_DIR, kind, safe)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="音频不存在")
    return FileResponse(file_path, media_type="audio/mpeg")
