"""腾讯 SOE 语音评测路由"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import Config
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


@router.post("/soe/evaluate")
async def soe_evaluate(req: SOERequest):
    try:
        result = svc.evaluate(req.ref_text, req.audio_base64, req.engine)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SOE 评测失败: {e}")
