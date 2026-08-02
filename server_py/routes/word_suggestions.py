"""字词联想路由（LLM 生成 + 服务端缓存 + 静态数据 fallback）"""

import json
import logging
import os
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import Config
from services.deepseek import BudgetExceededError, DeepSeekService

logger = logging.getLogger(__name__)

router = APIRouter()

cfg: Config = None  # type: ignore
svc: DeepSeekService = None  # type: ignore
cache: dict[str, list[str]] = {}
cache_lock = threading.Lock()
CACHE_PATH = "data/word_suggestions.json"

# 静态字词联想数据
FALLBACK_WORDS: list[dict] = []


def init(config: Config):
    global cfg, svc, cache, FALLBACK_WORDS
    cfg = config
    svc = DeepSeekService(config.deepseek, "word_suggestions")

    # 加载缓存
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                cache[item["char"]] = item["words"]
            logger.info("[WordCache] 已加载 %d 条字词联想缓存", len(data))
        except Exception:
            pass

    # 加载静态数据（用于 fallback）
    fallback_path = os.path.join("data", "word_suggestions.json")
    if os.path.exists(fallback_path):
        try:
            with open(fallback_path, encoding="utf-8") as f:
                FALLBACK_WORDS = json.load(f)
        except Exception:
            FALLBACK_WORDS = []


def _save_cache():
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    data = [{"char": k, "words": v} for k, v in cache.items()]
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _get_fallback_words(char: str) -> list[str]:
    for item in FALLBACK_WORDS:
        if item.get("char") == char:
            words = item.get("words", [])
            return words[:5] if len(words) > 5 else words
    return [char]


class WordSuggestionsRequest(BaseModel):
    char: str


@router.post("/llm/word-suggestions")
async def word_suggestions(req: WordSuggestionsRequest):
    char = req.char

    # 查缓存
    with cache_lock:
        if char in cache:
            return {"char": char, "words": cache[char], "source": "cache"}

    # 优先从静态数据取组词
    words = _get_fallback_words(char)

    if len(words) < 3:
        # 词不够才调 LLM 补充
        prompt = (
            f'为小学一年级学生生成汉字"{char}"的常用词语，要求：\n'
            "- 只输出3-5个最常见、最简单的词语\n"
            "- 每个词不超过4个字\n"
            "- 直接输出JSON数组，不要其他文字\n"
            f'["词1","词2","词3"]'
        )
        try:
            reply = svc.chat("你是一个只输出JSON的小学语文助手。", prompt, 500, "word_suggestions")
            try:
                llm_words = json.loads(reply)
                if isinstance(llm_words, list) and len(llm_words) > 0:
                    words = llm_words
            except json.JSONDecodeError:
                pass
        except BudgetExceededError:
            raise  # 预算守卫拒绝 → 全局 429 统一提示
        except Exception:
            pass

    if len(words) > 5:
        words = words[:5]

    # 写缓存
    with cache_lock:
        cache[char] = words
    _save_cache()

    return {"char": char, "words": words, "source": "llm"}
