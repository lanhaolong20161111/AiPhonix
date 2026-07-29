"""火山引擎文生图路由"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.ark_image import get_service

logger = logging.getLogger(__name__)
router = APIRouter()


class ImageGenRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    size: str = "2K"
    n: int = 1
    stream: bool = False
    watermark: bool = True


class ImageGenResponse(BaseModel):
    images: list[dict]
    total: int


@router.post("/image-generations", response_model=ImageGenResponse)
async def generate_image(req: ImageGenRequest):
    """调用火山引擎文生图"""
    try:
        service = get_service()
        images = service.generate(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            size=req.size,
            n=req.n,
            stream=req.stream,
            watermark=req.watermark,
        )
        return ImageGenResponse(images=images, total=len(images))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("文生图失败: %s", e)
        raise HTTPException(status_code=500, detail=f"生成失败: {e}")
