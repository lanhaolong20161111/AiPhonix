"""英语词汇/句子路由（静态 JSON 返回）"""

import json
import logging
import os

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/english/vocabulary")
async def english_vocabulary():
    path = os.path.join("data", "english_vocabulary.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="词汇数据未找到")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/english/sentences")
async def english_sentences():
    path = os.path.join("data", "english_sentences.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="句子数据未找到")
    with open(path, encoding="utf-8") as f:
        return json.load(f)
