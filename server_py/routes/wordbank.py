"""词库查询路由"""

import json
import logging
import os
import threading

from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, model_validator

logger = logging.getLogger(__name__)

router = APIRouter()


class WordBankEntry(BaseModel):
    """词条。兼容两种格式（extra 字段忽略，杜绝 `**dict` 展开 TypeError）：
    - 旧格式（中文词库）：text/tags/type/pinyin
    - 新格式（英文词库）：text/ipa/ipa_uk/letter/phonemes/phonemes_uk/emoji/difficulty
    """

    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def _drop_none(cls, data):
        """历史数据兼容：emoji 等字段存在 null 值，删掉键让其落到字段默认值，
        避免校验报错，也保证响应不输出 null。"""
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if v is not None}
        return data

    text: str
    tags: list[str] = []
    type: str = "word"
    pinyin: str = ""
    ipa: str = ""
    ipa_uk: str = ""
    letter: str = ""
    phonemes: list[str] = []
    phonemes_uk: list[str] = []
    emoji: str = ""
    difficulty: int = 1
    translation: str = ""


class WordBank:
    def __init__(self):
        self.version = 1
        self.chars: list[WordBankEntry] = []
        self.words: list[WordBankEntry] = []


# ── 响应模型：与客户端契约逐字段一致（防裸 dict 字段漂移） ──

class WordBankItem(BaseModel):
    text: str
    tags: list[str]
    type: str
    pinyin: str
    ipa: str
    ipa_uk: str
    letter: str
    phonemes: list[str]
    phonemes_uk: list[str]
    emoji: str
    difficulty: int
    translation: str


class WordBankQueryResponse(BaseModel):
    total: int
    items: list[WordBankItem]


class TagCount(BaseModel):
    tag: str
    count: int


class WordBankStatsResponse(BaseModel):
    total_chars: int
    total_words: int
    stats: list[TagCount]


class WordBankHandler:
    def __init__(self, data_dir: str):
        self._lock = threading.Lock()
        self._path = os.path.join(data_dir, "wordbank.json")
        self._bank = WordBank()
        self._load()

    def _load(self):
        if not os.path.exists(self._path):
            self._bank = WordBank()
            return
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
            bank = WordBank()
            bank.version = data.get("version", 1)
            bank.chars = [WordBankEntry.model_validate(c) for c in data.get("chars", [])]
            bank.words = [WordBankEntry.model_validate(w) for w in data.get("words", [])]
            self._bank = bank
        except Exception as e:
            logger.warning("加载词库失败: %s", e)
            self._bank = WordBank()

    def _all_entries(self) -> list[WordBankEntry]:
        with self._lock:
            return self._bank.chars + self._bank.words

    def _save(self):
        with self._lock:
            data = {
                "version": self._bank.version,
                "chars": [c.model_dump() for c in self._bank.chars],
                "words": [w.model_dump() for w in self._bank.words],
            }
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            with open(self._path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)


handler: WordBankHandler = None  # type: ignore


def init(data_dir: str):
    global handler
    handler = WordBankHandler(data_dir)


@router.get("/wordbank/stats", response_model=WordBankStatsResponse)
async def wordbank_stats():
    entries = handler._all_entries()
    counts: dict[str, int] = {}
    for e in entries:
        for tag in e.tags:
            counts[tag] = counts.get(tag, 0) + 1

    tag_counts = [TagCount(tag=k, count=v) for k, v in counts.items()]
    stats = sorted(tag_counts, key=lambda x: x.tag)
    chars = len(handler._bank.chars)
    words = len(handler._bank.words)

    return {"total_chars": chars, "total_words": words, "stats": stats}


@router.get("/wordbank/query")
async def wordbank_query(grade: str = "", semester: str = "", type: str = "", limit: int = Query(100, ge=1, le=1000)):
    entries = handler._all_entries()
    filtered: list[WordBankEntry] = []

    for e in entries:
        ok = True
        if grade and semester:
            tag = grade + semester
            if tag not in e.tags:
                ok = False
        if ok and type:
            if e.type != type:
                ok = False
        if ok:
            filtered.append(e)

    # 按 tags 长度排序（更多 tag 优先）
    filtered.sort(key=lambda x: len(x.tags), reverse=True)

    return {"total": len(filtered), "items": filtered[:limit]}


@router.get("/wordbank/search", response_model=WordBankQueryResponse)
async def wordbank_search(q: str = "", limit: int = Query(20, ge=1, le=500)):
    if not q:
        return {"total": 0, "items": []}

    entries = handler._all_entries()
    results = []
    for e in entries:
        if q in e.text:
            results.append(e)

    results.sort(key=lambda x: (-len(x.tags), x.text))
    return {"total": len(results), "items": results[:limit]}


class AddWordRequest(BaseModel):
    text: str
    type: Literal["chars", "words"] = "chars"  # "chars" or "words"
    tags: list[str] = []
    pinyin: str = ""


@router.post("/wordbank/add-word")
async def wordbank_add_word(req: AddWordRequest):
    entry = WordBankEntry(text=req.text, tags=req.tags, type=req.type, pinyin=req.pinyin)

    with handler._lock:
        target = handler._bank.chars if req.type == "chars" else handler._bank.words
        for i, e in enumerate(target):
            if e.text == req.text:
                target[i] = entry
                handler._save()
                return {"status": "updated"}
        target.append(entry)
        handler._save()
        return {"status": "added"}
