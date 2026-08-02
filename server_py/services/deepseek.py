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
BUDGET_FILE = "data/llm_budget.json"


class BudgetExceededError(ValueError):
    """预算守卫拒绝调用时抛出（输入超长 / 日累计超限 / 单次预估超限）"""
    pass


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


def _finish_log(log: LLMCallLog, start: float):
    """记录耗时后写入日志文件"""
    log.duration_ms = int((time.time() - start) * 1000)
    _append_log(log)


# ── 预算守卫：每日累计费用（持久化，重启不丢） ──

_day_cost: dict = {}


def _today() -> str:
    return time.strftime("%Y-%m-%d")


def _load_budget():
    global _day_cost
    try:
        if os.path.exists(BUDGET_FILE):
            with open(BUDGET_FILE, encoding="utf-8") as f:
                data = json.load(f)
            if data.get("date") == _today():
                _day_cost = data
            else:
                _day_cost = {"date": _today(), "total_cost": 0.0, "calls": 0}
        else:
            _day_cost = {"date": _today(), "total_cost": 0.0, "calls": 0}
    except Exception:
        _day_cost = {"date": _today(), "total_cost": 0.0, "calls": 0}


def _save_budget():
    try:
        os.makedirs(os.path.dirname(BUDGET_FILE), exist_ok=True)
        with open(BUDGET_FILE, "w", encoding="utf-8") as f:
            json.dump(_day_cost, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def get_day_cost() -> dict:
    if _day_cost.get("date") != _today():
        _load_budget()
    return dict(_day_cost)


def _record_cost(cost: float):
    if _day_cost.get("date") != _today():
        _load_budget()
    _day_cost["total_cost"] = round(_day_cost.get("total_cost", 0.0) + cost, 6)
    _day_cost["calls"] = _day_cost.get("calls", 0) + 1
    _save_budget()


_load_budget()


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
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )

        # ── 预算守卫（调用前拒绝） ──
        input_len = len(system_prompt) + len(user_prompt)
        if input_len > self.config.max_input_chars:
            log.success = False
            log.error = f"budget: input {input_len} chars exceeds limit {self.config.max_input_chars}"
            _finish_log(log, start)
            raise BudgetExceededError(log.error)
        day = get_day_cost()
        if day["total_cost"] >= self.config.max_cost_per_day:
            log.success = False
            log.error = (f"budget: daily cost {day['total_cost']:.4f} yuan "
                         f"exceeds limit {self.config.max_cost_per_day}")
            _finish_log(log, start)
            raise BudgetExceededError(log.error)
        # 最坏情况单次费用预估：输入按字符估算 + 输出按 max_tokens 全量计
        est_input_tokens = input_len
        est_cost = (est_input_tokens * COST_PER_M_INPUT + max_tokens * COST_PER_M_OUTPUT) / 1_000_000
        if est_cost > self.config.max_cost_per_call:
            log.success = False
            log.error = (f"budget: estimated cost {est_cost:.4f} yuan "
                         f"exceeds per-call limit {self.config.max_cost_per_call}")
            _finish_log(log, start)
            raise BudgetExceededError(log.error)

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
                _finish_log(log, start)
                return ""

            log.success = True
            _finish_log(log, start)
            _record_cost(log.cost_yuan)
            return content

        except Exception as e:
            log.success = False
            log.error = str(e)
            _finish_log(log, start)
            raise

    def close(self):
        self.client.close()
