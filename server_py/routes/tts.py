"""百度 TTS 语音合成路由"""

import logging

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from config import Config
from services.baidutts import BaiduTTSService

logger = logging.getLogger(__name__)

router = APIRouter()

svc: BaiduTTSService = None  # type: ignore


def init(config: Config):
    global svc
    svc = BaiduTTSService(
        config.baidu_tts.app_id,
        config.baidu_tts.api_key,
        config.baidu_tts.secret_key,
        config.baidu_tts.cache_dir,
    )


class TTSRequest(BaseModel):
    text: str
    speaker: str = "0"
    speed: int = 5


@router.post("/tts/synthesize")
async def tts_synthesize(req: TTSRequest):
    try:
        audio = svc.synthesize(req.text, req.speaker, req.speed)
        return Response(content=audio, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS 合成失败: {e}")
