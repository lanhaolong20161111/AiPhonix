"""火山引擎 ARK 文生图服务 — volcengine SDK"""

import logging
import os
from typing import Optional

from config import ArkImageConfig
from volcenginesdkarkruntime import Ark

logger = logging.getLogger(__name__)


class ArkImageService:
    def __init__(self, config: ArkImageConfig):
        self.config = config
        self._client: Optional[Ark] = None

    def _get_client(self) -> Ark:
        if self._client is None:
            self._client = Ark(
                base_url="https://ark.cn-beijing.volces.com/api/v3",
                api_key=self.config.api_key or os.environ.get("ARK_API_KEY", ""),
            )
        return self._client

    def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        size: str = "2K",
        n: int = 1,
        stream: bool = False,
        watermark: bool = True,
    ) -> list[dict]:
        """调用火山引擎文生图 API"""
        client = self._get_client()
        model = self.config.model or os.environ.get("ARK_MODEL_ID", "")

        if not model:
            raise ValueError("请在 config.yaml 中设置 ark_image.model（端点 ID）")

        kwargs = dict(
            model=model,
            prompt=prompt,
            size=size,
            stream=stream,
            watermark=watermark,
        )
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt

        try:
            resp = client.images.generate(**kwargs)
            images = []
            if resp.data:
                for item in resp.data:
                    images.append({
                        "url": getattr(item, "url", ""),
                        "b64_image": getattr(item, "b64_image", ""),
                    })
            logger.info("ARK 文生图成功: prompt=%s, images=%d", prompt[:50], len(images))
            return images
        except Exception as e:
            logger.error("ARK 文生图失败: %s", e, exc_info=True)
            raise

    def close(self):
        if self._client:
            self._client.close()


_service: Optional[ArkImageService] = None


def init(config: ArkImageConfig):
    global _service
    _service = ArkImageService(config)


def get_service() -> ArkImageService:
    if _service is None:
        raise RuntimeError("ArkImageService 未初始化")
    return _service
