"""LLM 聊天代理路由"""

import json
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import Config
from services.deepseek import DeepSeekService, get_call_logs, clear_call_logs

logger = logging.getLogger(__name__)

router = APIRouter()

# 全局变量，由 main 注入
cfg: Config = None  # type: ignore
svc: DeepSeekService = None  # type: ignore


def init(config: Config):
    global cfg, svc
    cfg = config
    svc = DeepSeekService(config.deepseek, "llm_chat")


class ChatRequest(BaseModel):
    message: str
    mode: str = ""
    prompt: str = ""


@router.post("/llm/chat")
async def llm_chat(req: ChatRequest):
    system_prompt = req.prompt
    if not system_prompt:
        prompt_map = {
            "chinese": cfg.llm_prompts.chinese_teaching,
            "quiz": cfg.llm_prompts.quiz_generate,
            "english": cfg.llm_prompts.english_teaching,
        }
        system_prompt = prompt_map.get(req.mode, cfg.llm_prompts.default)

    max_tokens = 4096 if req.mode == "quiz" else 2048

    try:
        reply = svc.chat(system_prompt, req.message, max_tokens, req.mode or "chat")
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM 调用失败: {e}")


@router.get("/llm/logs")
async def llm_logs():
    logs = get_call_logs()
    total_calls = len(logs)
    total_tokens = 0
    total_cost = 0.0
    success_count = 0
    for l in logs:
        total_tokens += l.total_tokens
        total_cost += l.cost_yuan
        if l.success:
            success_count += 1

    return {
        "total_calls": total_calls,
        "success": success_count,
        "failed": total_calls - success_count,
        "total_tokens": total_tokens,
        "total_cost": total_cost,
        "logs": [{
            "time": l.time,
            "caller": l.caller,
            "model": l.model,
            "prompt_tokens": l.prompt_tokens,
            "comp_tokens": l.comp_tokens,
            "total_tokens": l.total_tokens,
            "cost_yuan": l.cost_yuan,
            "duration_ms": l.duration_ms,
            "success": l.success,
            "error": l.error,
        } for l in logs],
    }


@router.post("/llm/logs/clear")
async def llm_logs_clear():
    clear_call_logs()
    return {"status": "ok"}
