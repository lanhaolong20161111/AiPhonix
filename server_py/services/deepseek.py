"""DeepSeek LLM 服务 — OpenAI 兼容 API"""

import json
import os
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

import httpx

from config import DeepSeekConfig

COST_PER_M_INPUT = 0.5
COST_PER_M_OUTPUT = 2.0
MAX_LOGS = 100000
LOG_FILE = "data/llm_call_logs.json"


@dataclass
class LLMCallLog:
    time: str = ""
    caller: str = ""
    model: str = ""
    system_prompt: str = ""
    user_prompt: str = ""
    prompt_tokens: int = 0
    comp_tokens: int = 0
    total_tokens: int = 0
    cost_yuan: float = 0.0
    duration_ms: int = 0
    success: bool = False
    error: str = ""


_call_logs: list[LLMCallLog] = []


def _load_logs():
    global _call_logs
    if os.path.exists(LOG_FILE):
        try:
            with open(LOG_FILE, encoding="utf-8") as f:
                data = json.load(f)
                _call_logs = [LLMCallLog(**item) for item in data]
        except Exception:
            _call_logs = []


def _save_logs():
    data = [asdict(log) for log in _call_logs]
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_call_logs() -> list[LLMCallLog]:
    return list(_call_logs)


def clear_call_logs():
    _call_logs.clear()
    _save_logs()


def _append_log(log: LLMCallLog):
    _call_logs.append(log)
    if len(_call_logs) > MAX_LOGS:
        _call_logs[:] = _call_logs[-MAX_LOGS:]
    _save_logs()


_load_logs()


class DeepSeekService:
    def __init__(self, config: DeepSeekConfig, caller: str = ""):
        self.config = config
        self.client = httpx.Client(timeout=120.0)
        self.caller = caller

    def chat(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 2048,
        caller: str = "",
    ) -> str:
        """调用 DeepSeek Chat，返回回复文本"""
        caller = caller or self.caller
        start = time.time()

        log = LLMCallLog(
            time=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            caller=caller,
            model=self.config.model,
            system_prompt=system_prompt[:200],
            user_prompt=user_prompt[:500],
        )

        try:
            payload = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": max_tokens,
                "temperature": 0.7,
            }

            url = f"{self.config.base_url.rstrip('/')}/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
            }

            resp = self.client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            pt = usage.get("prompt_tokens", 0)
            ct = usage.get("completion_tokens", 0)

            log.prompt_tokens = pt
            log.comp_tokens = ct
            log.total_tokens = pt + ct
            log.cost_yuan = (pt / 1_000_000 * COST_PER_M_INPUT) + (ct / 1_000_000 * COST_PER_M_OUTPUT)

            if not content:
                log.success = False
                log.error = "empty content"
                _append_log(log)
                return ""

            log.success = True
            _append_log(log)
            return content

        except Exception as e:
            log.success = False
            log.error = str(e)
            _append_log(log)
            raise

    def close(self):
        self.client.close()
