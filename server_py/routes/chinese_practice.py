"""语文练习路由 — 汉字信息 / 造句 / 多音字 / 联想"""

import asyncio
import json
import logging
import os
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, ValidationError

from config import Config
from services.deepseek import BudgetExceededError, DeepSeekService
from utils.pinyin import parse_pinyin

logger = logging.getLogger(__name__)

router = APIRouter()

cfg: Config = None  # type: ignore
svc: DeepSeekService = None  # type: ignore
char_map: dict[str, dict] = {}  # char -> raw json from char_info.json
pinyin_map: dict[str, str] = {}  # char -> pinyin string

sentence_cache: dict[str, dict] = {}
SENTENCE_CACHE_PATH = "data/word_sentences.json"

# 同词并发生成去重：同一词的多个请求只调一次 LLM（不同词可并行）
_sentence_locks: dict[str, asyncio.Lock] = {}


def _sentence_lock(word: str) -> asyncio.Lock:
    lock = _sentence_locks.get(word)
    if lock is None:
        lock = asyncio.Lock()
        _sentence_locks[word] = lock
    return lock


def init(config: Config):
    global cfg, svc, char_map, pinyin_map, sentence_cache
    cfg = config
    svc = DeepSeekService(config.deepseek, "chinese_practice")

    # 加载 char_info.json
    char_info_path = os.path.join("data", "char_info.json")
    if os.path.exists(char_info_path):
        try:
            with open(char_info_path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.warning("char_info.json 读取失败: %s", e)
            data = []
        if isinstance(data, dict):
            raw_items = list(data.values())
        elif isinstance(data, list):
            raw_items = data
        else:
            raw_items = []
        for item in raw_items:
            try:
                entry = CharInfoEntry.model_validate(item)
            except ValidationError:
                logger.warning("char_info 坏条目跳过: %s", item.get("char", "?"))
                continue
            if entry.char:
                char_map[entry.char] = entry.model_dump()

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


_sentence_save_lock = threading.Lock()


def _save_sentence_cache():
    with _sentence_save_lock:
        os.makedirs(os.path.dirname(SENTENCE_CACHE_PATH), exist_ok=True)
        with open(SENTENCE_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(sentence_cache, f, ensure_ascii=False, indent=2)


class WordInfoRequest(BaseModel):
    char: str


class CharInfoEntry(BaseModel):
    """char_info.json 条目（extra 忽略；坏条目加载时跳过不崩启动）"""

    model_config = ConfigDict(extra="ignore")

    char: str = ""
    radical: str = ""
    decomposition: list[str] = []
    stroke_count: int = 0
    structure: str = ""
    words: list[str] = []
    sentence: str = ""


class PolyphoneChar(BaseModel):
    pronunciations: list[str] = []
    words: dict[str, list[str]] = {}
    primary: str = ""


class PolyphoneData(BaseModel):
    version: int = 0
    description: str = ""
    chars: dict[str, PolyphoneChar] = {}

class WordInfoLLM(BaseModel):
    """LLM fallback 解析模型：与 local 分支同构，字段缺省/类型不符由 pydantic 容错"""

    char: str = ""
    radical: str = ""
    decomposition: list[str] = []
    stroke_count: int = 0
    structure: str = ""
    words: list[str] = []
    sentence: str = ""


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
        except BudgetExceededError:
            raise  # 预算守卫拒绝 → 全局 429 统一提示
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
        try:
            parsed = WordInfoLLM.model_validate_json(reply)
        except ValidationError:
            logger.warning("word_info LLM 输出非预期结构，降级最小结构: %s", char)
            return {
                "char": char, "radical": "", "decomposition": [], "stroke_count": 0,
                "structure": "", "words": [], "sentence": "", "pinyin": None,
                "source": "llm", "raw": reply,
            }
        return {
            **parsed.model_dump(),
            "pinyin": None,
            "source": "llm",
        }
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429 统一提示
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SentenceGenerateRequest(BaseModel):
    word: str


@router.post("/llm/sentence-generate")
async def sentence_generate(req: SentenceGenerateRequest):
    word = req.word

    # 查缓存（不加锁，读缓存是线程安全的快路径）
    if word in sentence_cache:
        item = sentence_cache[word]
        return {"word": word, "sentence": item.get("sentence", ""), "source": item.get("source", "cache")}

    # 同词并发去重：只让一个请求调 LLM，其余等待后直接读缓存
    async with _sentence_lock(word):
        if word in sentence_cache:
            item = sentence_cache[word]
            return {"word": word, "sentence": item.get("sentence", ""), "source": item.get("source", "cache")}

        # 调 LLM（同步阻塞 → 用 to_thread 不阻塞事件循环，多词可并行）
        prompt = (
            f'为词语"{word}"造一个不超过15字的简单句子，适合小学生理解。\n'
            '只输出JSON：{"sentence": "句子"}'
        )
        try:
            reply = await asyncio.to_thread(
                svc.chat, "你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "sentence_generate"
            )
            try:
                res = json.loads(reply)
                sentence = res.get("sentence", "")
            except json.JSONDecodeError:
                sentence = ""

            item = {"sentence": sentence, "source": "llm"}
            sentence_cache[word] = item
            _save_sentence_cache()

            return {"word": word, "sentence": sentence, "source": "llm"}
        except BudgetExceededError:
            raise  # 预算守卫拒绝 → 全局 429 统一提示
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
    """多音字数据（模型校验后返回；文件缺失/损坏返回 []）"""
    polyphone_path = os.path.join("data", "polyphone_chars.json")
    if os.path.exists(polyphone_path):
        try:
            with open(polyphone_path, encoding="utf-8") as f:
                data = json.load(f)
            return PolyphoneData.model_validate(data).model_dump()
        except (json.JSONDecodeError, ValidationError) as e:
            logger.warning("polyphone_chars.json 校验失败，返回空: %s", e)
    return []
