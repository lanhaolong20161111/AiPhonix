"""词库查询路由"""

import json
import logging
import os
import threading

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class WordBankEntry:
    def __init__(self, text: str, tags: list[str], type: str, pinyin: str = ""):
        self.text = text
        self.tags = tags
        self.type = type
        self.pinyin = pinyin


class WordBank:
    def __init__(self):
        self.version = 1
        self.chars: list[WordBankEntry] = []
        self.words: list[WordBankEntry] = []


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
            bank.chars = [WordBankEntry(**c) for c in data.get("chars", [])]
            bank.words = [WordBankEntry(**w) for w in data.get("words", [])]
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
                "chars": [{"text": c.text, "tags": c.tags, "type": c.type, "pinyin": c.pinyin} for c in self._bank.chars],
                "words": [{"text": w.text, "tags": w.tags, "type": w.type, "pinyin": w.pinyin} for w in self._bank.words],
            }
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            with open(self._path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)


handler: WordBankHandler = None  # type: ignore


def init(data_dir: str):
    global handler
    handler = WordBankHandler(data_dir)


@router.get("/wordbank/stats")
async def wordbank_stats():
    entries = handler._all_entries()
    counts = {}
    for e in entries:
        for tag in e.tags:
            counts[tag] = counts.get(tag, 0) + 1

    stats = sorted([{"tag": k, "count": v} for k, v in counts.items()], key=lambda x: x["tag"])
    chars = len(handler._bank.chars)
    words = len(handler._bank.words)

    return {"total_chars": chars, "total_words": words, "stats": stats}


@router.get("/wordbank/query")
async def wordbank_query(grade: str = "", semester: str = "", type: str = "", limit: int = 100):
    entries = handler._all_entries()
    filtered = []

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
            filtered.append({"text": e.text, "tags": e.tags, "type": e.type, "pinyin": e.pinyin})

    # 按 tags 长度排序（更多 tag 优先）
    filtered.sort(key=lambda x: len(x["tags"]), reverse=True)

    return {"total": len(filtered), "items": filtered[:limit]}


@router.get("/wordbank/search")
async def wordbank_search(q: str = "", limit: int = 20):
    if not q:
        return {"total": 0, "items": []}

    entries = handler._all_entries()
    results = []
    for e in entries:
        if q in e.text:
            results.append({"text": e.text, "tags": e.tags, "type": e.type, "pinyin": e.pinyin})

    results.sort(key=lambda x: (-len(x["tags"]), x["text"]))
    return {"total": len(results), "items": results[:limit]}


class AddWordRequest(BaseModel):
    text: str
    type: str = "chars"  # "chars" or "words"
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
