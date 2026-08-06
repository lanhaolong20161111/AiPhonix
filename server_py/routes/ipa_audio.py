"""国际音标音频路由 — 提供 data/ipa_audio/ 目录下的 48 个音标 aac"""

import logging
import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter()

DATA_DIR = "data"
IPA_AUDIO_DIR = os.path.join(DATA_DIR, "ipa_audio")


def init(*args):
    os.makedirs(IPA_AUDIO_DIR, exist_ok=True)
    logger.info("音标音频目录: %s", IPA_AUDIO_DIR)


@router.get("/ipa-audio")
async def serve_ipa_audio(file: str):
    """提供国际音标音频文件（客户端 assets/ipa/ 的服务端镜像）。

    file 参数为文件名，如 `æ.aac`、`tʃ.aac`。只允许单个文件名 + .aac 后缀，
    basename 防路径穿越。
    """
    safe = os.path.basename(file)  # 防路径穿越
    if not safe.endswith(".aac"):
        raise HTTPException(status_code=400, detail="只支持 aac")
    file_path = os.path.join(IPA_AUDIO_DIR, safe)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="音频不存在")
    return FileResponse(file_path, media_type="audio/aac")
