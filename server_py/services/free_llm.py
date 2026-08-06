"""火山引擎 ARK 免费 LLM 服务（送的 token 专用）

多模态推理（文本 + 图片），走 OpenAI Responses 兼容 API：
- 文本：直接发 prompt
- 图片：本地文件转 base64 data URI 内联（内网服务端文件无法被云端直接访问）

配置：config.yaml 的 ark_chat 段，或环境变量 ARK_API_KEY / ARK_CHAT_MODEL。
"""

import base64
import logging
import os
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "doubao-seed-evolving"
BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

_MIME_BY_EXT = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


@dataclass
class ArkChatConfig:
    api_key: str = ""
    model: str = DEFAULT_MODEL


class ArkChatService:
    def __init__(self, config: ArkChatConfig):
        self.config = config
        self._client = None
        self.last_usage: Optional[dict] = None  # 最近一次调用的 token 用量

    @property
    def enabled(self) -> bool:
        """是否已配置 API Key（config 或环境变量）"""
        return bool(self.config.api_key or os.environ.get("ARK_API_KEY", ""))

    def _get_client(self):
        if self._client is None:
            from volcenginesdkarkruntime import Ark

            self._client = Ark(
                base_url=BASE_URL,
                api_key=self.config.api_key or os.environ.get("ARK_API_KEY", ""),
                timeout=30,  # 免费模型 30s 内不出结果即回退付费链路（避免客户端超时）
                max_retries=0,  # 禁用 SDK 内部重试（默认重试会把 30s 放大成 90s）
            )
        return self._client

    def _build_content(self, prompt: str, image_paths: list[str]) -> list[dict]:
        content: list[dict] = [{"type": "input_text", "text": prompt}]
        for path in image_paths or []:
            if not path or not os.path.exists(path):
                continue
            with open(path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            ext = os.path.splitext(path)[1].lstrip(".").lower()
            mime = _MIME_BY_EXT.get(ext, "image/jpeg")
            content.append({"type": "input_image", "image_url": f"data:{mime};base64,{b64}"})
        return content

    def chat(self, prompt: str, system_prompt: str = "", image_paths: list[str] | None = None, max_tokens: int = 2048) -> str:
        """文本 / 文本+图片 推理，返回模型输出文本。

        system_prompt 非空时以 system 角色消息发出（业务链路原始语义）；
        max_tokens 映射到 max_output_tokens，防止免费模型长推理输出失控。
        Raises:
            ValueError: 未配置 API Key
        """
        if not self.enabled:
            raise ValueError("服务端未配置 ARK_API_KEY（火山引擎免费 token）")

        client = self._get_client()
        model = self.config.model or os.environ.get("ARK_CHAT_MODEL", DEFAULT_MODEL)

        content = self._build_content(prompt, image_paths or [])
        messages: list[dict] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": content})
        resp = client.responses.create(
            model=model,
            input=messages,
            max_output_tokens=max_tokens,
        )

        # OpenAI Responses 兼容：优先 output_text 字段
        text = getattr(resp, "output_text", None)
        if text is None:
            parts = []
            for item in getattr(resp, "output", []) or []:
                for c in getattr(item, "content", []) or []:
                    if getattr(c, "type", "") == "output_text":
                        parts.append(getattr(c, "text", ""))
            text = "".join(parts)

        # 记录本次 token 用量（供调用日志；模型对象字段差异时留空）
        try:
            usage = getattr(resp, "usage", None)
            self.last_usage = {
                "input_tokens": getattr(usage, "input_tokens", 0),
                "output_tokens": getattr(usage, "output_tokens", 0),
            }
        except Exception:
            self.last_usage = None
        return text or ""


_service: Optional[ArkChatService] = None


def init(config: ArkChatConfig):
    global _service
    _service = ArkChatService(config)


def get_service() -> ArkChatService:
    global _service
    if _service is None:
        _service = ArkChatService(ArkChatConfig())
    return _service
