"""题库生成路由（带缓存）"""

import json
import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import Config
from services.deepseek import DeepSeekService

logger = logging.getLogger(__name__)

router = APIRouter()

cfg: Config = None  # type: ignore
svc: DeepSeekService = None  # type: ignore


def init(config: Config):
    global cfg, svc
    cfg = config
    svc = DeepSeekService(config.deepseek, "quiz")


class QuizRequest(BaseModel):
    subtitle_text: str
    video_name: str
    count: int = 30


def _clean_subtitle(text: str) -> str:
    """精简字幕：去时间戳、序号、空行"""
    lines = []
    for line in text.split("\n"):
        line = line.strip()
        # 跳过时间戳行 (00:00:01,000 --> 00:00:04,000)
        if "-->" in line:
            continue
        # 跳过纯数字行（序号）
        if line.isdigit():
            continue
        if line:
            lines.append(line)
    return "\n".join(lines)


def _extract_json_array(text: str) -> str:
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        return text[start:end + 1]
    return text


def _generate_quiz(subtitle_text: str, count: int, caller: str) -> str:
    """调 LLM 生成题库"""
    cleaned = _clean_subtitle(subtitle_text)
    if len(cleaned) > 4000:
        cleaned = cleaned[:4000]

    system_prompt = cfg.llm_prompts.quiz_generate
    user_prompt = (
        f"从字幕中提取{count}条英语填空题，适合中国儿童学习。\n"
        "要求：日常实用、含中英文、难度1-5、按易到难排列。\n"
        "只输出JSON数组：\n"
        '[{"english":"原句","chinese":"中文","difficulty":1-5,"display":"用___填空","blankAnswer":"答案"}]\n\n'
        f"字幕：\n{cleaned}"
    )

    reply = svc.chat(system_prompt, user_prompt, 4096, caller)
    reply = _extract_json_array(reply)

    # 验证 JSON 有效性
    try:
        json.loads(reply)
    except json.JSONDecodeError:
        # 重试一次
        reply2 = svc.chat(
            system_prompt,
            user_prompt + "\n务必只输出JSON数组，不要其他文字。",
            4096,
            f"{caller}_retry",
        )
        reply2 = _extract_json_array(reply2)
        try:
            json.loads(reply2)
            reply = reply2
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="LLM 返回格式错误")

    return reply


@router.post("/llm/quiz")
async def llm_quiz(req: QuizRequest):
    cache_path = f"data/quiz_cache_{req.video_name}.json"
    count = req.count if req.count > 0 else 30

    # 检查缓存
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                data = f.read()
            json.loads(data)
            return {"source": "cache", "items": json.loads(data)}
        except json.JSONDecodeError:
            logger.warning("quiz 缓存损坏，重新生成: %s", req.video_name)

    reply = _generate_quiz(req.subtitle_text, count, "quiz_generate")

    # 写缓存
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(reply)
    except Exception as e:
        logger.warning("写入缓存失败: %s", e)

    return {"source": "llm", "items": json.loads(reply)}


class QuizGenerateRequest(BaseModel):
    subtitle_text: str
    video_name: str
    count: int = 30


@router.post("/llm/quiz-generate")
async def llm_quiz_generate(req: QuizGenerateRequest):
    """强制重新生成（忽略缓存）"""
    count = req.count if req.count > 0 else 30
    reply = _generate_quiz(req.subtitle_text, count, "quiz_generate_cached")
    return {"source": "llm", "items": json.loads(reply)}
