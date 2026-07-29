"""语文练习路由 — 汉字信息 / 造句 / 多音字 / 联想"""

import json
import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import Config
from services.deepseek import DeepSeekService
from utils.pinyin import parse_pinyin

logger = logging.getLogger(__name__)

router = APIRouter()

cfg: Config = None  # type: ignore
svc: DeepSeekService = None  # type: ignore
char_map: dict[str, dict] = {}  # char -> raw json from char_info.json
pinyin_map: dict[str, str] = {}  # char -> pinyin string

sentence_cache: dict[str, dict] = {}
SENTENCE_CACHE_PATH = "data/word_sentences.json"


def init(config: Config):
    global cfg, svc, char_map, pinyin_map, sentence_cache
    cfg = config
    svc = DeepSeekService(config.deepseek, "chinese_practice")

    # 加载 char_info.json
    char_info_path = os.path.join("data", "char_info.json")
    if os.path.exists(char_info_path):
        with open(char_info_path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            char_map = {k: v for k, v in data.items()}
        elif isinstance(data, list):
            for item in data:
                if "char" in item:
                    char_map[item["char"]] = item

    # 加载拼音映射
    wordbank_path = os.path.join("..", "app", "src", "main", "assets", "chinese_wordbank.json")
    if os.path.exists(wordbank_path):
        with open(wordbank_path, encoding="utf-8") as f:
            data = json.load(f)
        for entry in data.get("chars", []):
            if "pinyin" in entry and entry["pinyin"]:
                pinyin_map[entry["text"]] = entry["pinyin"]

    # 加载造句缓存
    _load_sentence_cache()


def _load_sentence_cache():
    global sentence_cache
    if os.path.exists(SENTENCE_CACHE_PATH):
        try:
            with open(SENTENCE_CACHE_PATH, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                sentence_cache = data
        except Exception:
            sentence_cache = {}


def _save_sentence_cache():
    os.makedirs(os.path.dirname(SENTENCE_CACHE_PATH), exist_ok=True)
    with open(SENTENCE_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(sentence_cache, f, ensure_ascii=False, indent=2)


class WordInfoRequest(BaseModel):
    char: str


@router.post("/llm/word-info")
async def word_info(req: WordInfoRequest):
    char = req.char

    # 1. 查静态数据
    info = char_map.get(char)
    if info:
        # 生成例句（需要 LLM）
        sentence = ""
        prompt = (
            f'为汉字"{char}"造一个不超过12字的简单句子，适合小学生理解。\n'
            '只输出JSON：{"sentence": "句子"}'
        )
        try:
            reply = svc.chat("你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "word_info")
            try:
                res = json.loads(reply)
                sentence = res.get("sentence", "")
            except json.JSONDecodeError:
                pass
        except Exception:
            pass

        if not sentence:
            words = info.get("words", [])
            if words:
                sentence = f"我们来学习 {char} 这个字。"
            else:
                sentence = f"这是汉字 {char}。"

        # 拼音信息
        pinyin_info = None
        raw_pinyin = pinyin_map.get(char)
        if raw_pinyin:
            try:
                pinyin_info = parse_pinyin(raw_pinyin)
            except Exception:
                pass

        return {
            "char": info.get("char", char),
            "radical": info.get("radical", ""),
            "decomposition": info.get("decomposition", []),
            "stroke_count": info.get("stroke_count", 0),
            "structure": info.get("structure", ""),
            "words": info.get("words", []),
            "sentence": sentence,
            "pinyin": pinyin_info,
            "source": "local",
        }

    # 2. fallback: 调 LLM
    prompt = (
        f'你是一位小学语文教学专家。请为汉字"{char}"返回以下信息，只输出JSON：\n'
        '{\n'
        f'  "char": "{char}",\n'
        '  "radical": "偏旁部首",\n'
        '  "stroke_count": 笔画数,\n'
        '  "structure": "结构",\n'
        '  "words": ["组词1", "组词2", "组词3"],\n'
        '  "sentence": "包含该字的简单例句(不超过12字)"\n'
        '}'
    )
    try:
        reply = svc.chat("你是一个只输出JSON的语文教学助手。", prompt, 2000, "word_info_batch")
        return {"char": char, "raw": reply, "source": "llm"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SentenceGenerateRequest(BaseModel):
    word: str


@router.post("/llm/sentence-generate")
async def sentence_generate(req: SentenceGenerateRequest):
    word = req.word

    # 查缓存
    if word in sentence_cache:
        item = sentence_cache[word]
        return {"word": word, "sentence": item.get("sentence", ""), "source": item.get("source", "cache")}

    # 调 LLM
    prompt = (
        f'为词语"{word}"造一个不超过15字的简单句子，适合小学生理解。\n'
        '只输出JSON：{"sentence": "句子"}'
    )
    try:
        reply = svc.chat("你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "sentence_generate")
        try:
            res = json.loads(reply)
            sentence = res.get("sentence", "")
        except json.JSONDecodeError:
            sentence = ""

        item = {"sentence": sentence, "source": "llm"}
        sentence_cache[word] = item
        _save_sentence_cache()

        return {"word": word, "sentence": sentence, "source": "llm"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SentenceBatchSaveRequest(BaseModel):
    sentences: dict[str, dict]  # {word: {"sentence": "...", "source": "..."}}


@router.post("/llm/sentence-batch-save")
async def sentence_batch_save(req: SentenceBatchSaveRequest):
    added = 0
    for word, item in req.sentences.items():
        if item.get("sentence"):
            sentence_cache[word] = item
            added += 1
    _save_sentence_cache()
    return {"added": added, "total": len(sentence_cache)}


@router.get("/chinese/polyphone")
async def chinese_polyphone():
    """多音字数据"""
    polyphone_path = os.path.join("data", "polyphone_chars.json")
    if os.path.exists(polyphone_path):
        with open(polyphone_path, encoding="utf-8") as f:
            data = json.load(f)
        return data
    return []
