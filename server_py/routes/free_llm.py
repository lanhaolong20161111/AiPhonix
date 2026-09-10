"""免费 LLM 路由 — 火山引擎送 token 专属模块

导入中心一键生成优先调用这里（绕开付费 DeepSeek 预算守卫，零成本）。

- POST /api/v1/free-llm/chat — 文本 / 文本+图片 推理
  图片以本服务相对 URL 传入（如 /api/v1/uploads/file/xxx.jpg），
  服务端读本地文件转 base64 内联给火山引擎（内网文件云端无法直接访问）。
"""

import asyncio
import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_session
from routes.auth import get_current_user
from services.free_llm import get_service

logger = logging.getLogger(__name__)

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "uploads")
TIMEOUT_SECONDS = 90


class FreeLlmRequest(BaseModel):
    prompt: str
    image_urls: list[str] = []  # 本服务相对路径，如 /api/v1/uploads/file/xxx.jpg


class FreeLlmResponse(BaseModel):
    text: str


def _resolve_local_path(image_url: str) -> str:
    """/api/v1/uploads/file/xxx.jpg → data/uploads/xxx.jpg；不合法返回空"""
    name = image_url.rsplit("/", 1)[-1]
    if not name or ".." in name or "/" in name:
        return ""
    path = os.path.join(UPLOAD_DIR, name)
    return path if os.path.isfile(path) else ""


@router.post("/free-llm/chat", response_model=FreeLlmResponse)
async def free_llm_chat(
    req: FreeLlmRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
    """免费 LLM 推理（文本 / 文本+图片），需登录（JWT）"""
    if not req.prompt.strip():
        raise HTTPException(status_code=422, detail="prompt 不能为空")

    service = get_service()
    if not service.enabled:
        raise HTTPException(
            status_code=503,
            detail="免费 AI 服务未配置（服务端缺少 ARK_API_KEY）",
        )

    image_paths = [_resolve_local_path(u) for u in (req.image_urls or [])]

    try:
        # SDK 是同步调用，丢到线程池；外层套超时防止免费模型卡死
        text = await asyncio.wait_for(
            asyncio.to_thread(service.chat, req.prompt, image_paths=image_paths),
            timeout=TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="免费 AI 响应超时，请稍后重试")
    except Exception as e:  # 网络/鉴权/限流等
        logger.warning("free-llm chat failed: %s", e)
        raise HTTPException(status_code=502, detail=f"免费 AI 调用失败：{e}")

    return FreeLlmResponse(text=text)
