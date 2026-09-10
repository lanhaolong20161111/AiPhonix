"""火山引擎 ARK 免费 LLM 服务（送的 token 专用）

多模态推理（文本 + 图片），走 OpenAI Responses 兼容 API：
- 文本：直接发 prompt
- 图片：本地文件转 base64 data URI 内联（内网服务端文件无法被云端直接访问）

配置：config.yaml 的 ark_chat 段，或环境变量 ARK_API_KEY / ARK_CHAT_MODEL。
"""

import base64
import logging
import os
from typing import Optional

from config import ArkChatConfig
from volcenginesdkarkruntime import Ark

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "doubao-seed-2-1-turbo-260628"
BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

_MIME_BY_EXT = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


class ArkChatService:
    def __init__(self, config: ArkChatConfig):
        self.config = config
        self._client: Optional[Ark] = None
        self.last_usage: Optional[dict] = None  # 最近一次调用的 token 用量

    @property
    def enabled(self) -> bool:
        """是否已配置 API Key（config 或环境变量）"""
        return bool(self.config.api_key or os.environ.get("ARK_API_KEY", ""))

    def _get_client(self) -> Ark:
        if self._client is None:
            self._client = Ark(
                base_url=BASE_URL,
                api_key=self.config.api_key or os.environ.get("ARK_API_KEY", ""),
                timeout=180,  # 推理模型（deepseek-v4-flash-ga 等）复杂题推理耗时可达 30-90s+，放宽到 180s
                # 避免 90s 超时后回退付费 DeepSeek 反而更慢/超时（analyze 曾因 90s 超时 + 回退导致 500）
                max_retries=0,  # 禁用 SDK 内部重试（默认重试会把超时放大成数倍）
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

    def chat(
        self,
        prompt: str,
        system_prompt: str = "",
        image_paths: list[str] | None = None,
        max_tokens: int = 2048,
        model_override: str = "",
        disable_thinking: bool = False,
    ) -> str:
        """文本 / 文本+图片 推理，返回模型输出文本。

        system_prompt 非空时以 system 角色消息发出（业务链路原始语义）；
        max_tokens 映射到 max_output_tokens，防止免费模型长推理输出失控。
        model_override 非空时覆盖模型（如识图用多模态模型，文本分析用推理模型）。
        disable_thinking=True 时传 thinking=disabled 关闭深度思考（**纯文字提取场景实测快 ~8 倍**，
        且输出更稳定；仅用于识图，推理模型场景不得关闭）。
        Raises:
            ValueError: 未配置 API Key
        """
        if not self.enabled:
            raise ValueError("服务端未配置 ARK_API_KEY（火山引擎免费 token）")

        client = self._get_client()
        model = model_override or self.config.model or os.environ.get("ARK_CHAT_MODEL", DEFAULT_MODEL)

        content = self._build_content(prompt, image_paths or [])
        messages: list[dict] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": content})

        # 推理模型（deepseek-v4-flash-ga 等）推理 token 消耗大且不稳定：
        # max_output_tokens 可能被推理耗尽导致 content 为空/截断（finish_reason=length）
        # → 放宽 max_output_tokens 重试一次。
        text = ""
        for attempt in (0, 1):
            kwargs: dict = {"model": model, "input": messages}
            if disable_thinking:
                kwargs["thinking"] = {"type": "disabled"}  # 识图纯提取：关闭深度思考（实测提速 ~8 倍）
            resp = client.responses.create(
                max_output_tokens=max_tokens if attempt == 0 else max_tokens * 3,
                **kwargs,
            )
            # OpenAI Responses 兼容：优先 output_text 字段
            raw_text = getattr(resp, "output_text", None)
            if raw_text is None:
                parts = []
                for item in getattr(resp, "output", []) or []:
                    for c in getattr(item, "content", []) or []:
                        if getattr(c, "type", "") == "output_text":
                            parts.append(getattr(c, "text", ""))
                raw_text = "".join(parts)
            text = raw_text or ""
            finish = str(getattr(resp, "finish_reason", "") or "")
            # 截断的判定：finish=length 说明 max_output_tokens 用尽（content 可能空也可能被切半）
            truncated = finish == "length"
            if text and not truncated:
                break
            if attempt == 0:
                logger.warning(
                    "Ark 推理模型输出截断/为空（finish=%s len=%s max=%s），放宽到 %s 重试（model=%s）",
                    finish, len(text), max_tokens, max_tokens * 3, model,
                )
                continue
            break

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
        # 用 config.yaml 的 ark_chat 段（model = 文本分析默认模型 deepseek-v4-flash-ga-260731）；
        # 识图等需要多模态的场景由调用方传 model_override=doubao-seed-2-1-turbo-260628。
        _service = ArkChatService(ArkChatConfig())
    return _service
