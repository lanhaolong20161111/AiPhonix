"""AiPhonix 本地 JSON 缓存工具（从胖路由拆分，函数体与 routes/ai_chinese.py 原实现一致）。"""

import json
import logging
import os

logger = logging.getLogger(__name__)


def read_cache(cache_file: str) -> dict | None:
    try:
        with open(cache_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def write_cache(cache_file: str, data: dict) -> None:
    try:
        tmp = cache_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, cache_file)
    except OSError:
        logger.warning("缓存写入失败: %s", cache_file)
