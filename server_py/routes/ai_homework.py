"""AI 作业：数学应用题练习（拍照识题 → 关键信息提示 → 思路评判）

与 AI 陪我练的关系：本模块是「题目练习」专用模式——复用 free_llm（Ark 多模态识图）、
DeepSeek（关键信息标注/思路评判）与 EasyOCR（回退），单题一练，不建 LangGraph 会话。
题目本身由客户端存到 user_imports（kind=problem），练习时按 payload 加载结构化数据。
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError

from config import Config
from database import async_session
from database import CharClickRow, QuestSessionRow, UserImport
from prompts_aihomework import render_analyze
from routes.auth import get_current_user
from services.deepseek import BudgetExceededError, DeepSeekService
from services.free_llm import get_service as get_free_llm_service

logger = logging.getLogger(__name__)

router = APIRouter()

cfg: Config = None  # type: ignore
svc: DeepSeekService = None  # type: ignore

# 项目根目录（server_py，即 routes 的上级），所有 data/* 路径统一基于绝对路径，避免依赖进程 cwd
_DATA_BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

IMAGE_DIR = os.path.join(_DATA_BASE, "ai_homework_images")
CACHE_DIR = os.path.join(_DATA_BASE, "ai_homework_cache")
SENTENCE_AUDIO_DIR = os.path.join(_DATA_BASE, "ai_homework_sentence_audio")
PROBLEM_IMAGE_DIR = os.path.join(_DATA_BASE, "ai_homework_problems")

MAX_QUESTION_LEN = 2000  # 与预算守卫 max_input_chars 保持安全距离

# 识图模型：必须用多模态模型。当前 ark_chat.model（deepseek-v4-flash-ga）是纯文本推理模型，
# 不支持图片输入（会 400 → 回退本地 OCR ~44s 慢）。识图 override 到 doubao-seed-2-1-turbo-260628（统一豆包识图模型）。
MULTIMODAL_MODEL = "doubao-seed-2-1-turbo-260628"


# 图片处理工具（拆分自胖路由，见 utils/ai_image_utils.py）
from utils.ai_image_utils import auto_orient as _auto_orient
# 缓存工具（拆分自胖路由，见 utils/ai_cache_utils.py）
from utils.ai_cache_utils import read_cache as _read_cache, write_cache as _write_cache
# 句子切分（两文件实现相同，共享 utils 版本）
from utils.ai_text_utils import split_sentences as _split_sentences



def init(config: Config):
    global cfg, svc
    cfg = config
    svc = DeepSeekService(config.deepseek, "ai_homework")
    os.makedirs(IMAGE_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(SENTENCE_AUDIO_DIR, exist_ok=True)
    os.makedirs(PROBLEM_IMAGE_DIR, exist_ok=True)
    from services import quest_graph
    quest_graph.init(svc)  # 闯关 LangGraph 注入 LLM 服务 + 初始化 checkpoint


# ── 学生句子朗读录音（麦克风 → 服务端存储，按句子文本哈希） ──

def _sentence_audio_path(sentence: str) -> str:
    h = hashlib.md5(sentence.strip().encode("utf-8")).hexdigest()
    return os.path.join(SENTENCE_AUDIO_DIR, f"{h}.m4a")


@router.post("/ai-homework/save-problem")
async def save_problem(
    file: UploadFile | None = File(default=None),  # 原题照片（可空）
    question: str = Form(...),
    payload: str = Form(default=""),  # 解析内容 JSON（sentences/quantities/relations/questions）
    user=Depends(get_current_user),
):
    """保存一道题到「我的学习」：原图（可选）+ 识别文字 + 解析内容。
    图片存文件，payload 注入 image_path 后入库（同一 user+kind=problem+text 覆盖）。"""
    q = (question or "").strip()
    if not q:
        raise HTTPException(status_code=422, detail="题目不能为空")
    image_path = ""
    if file is not None:
        data = await file.read()
        if data:
            fname = f"{uuid.uuid4().hex}.jpg"
            image_path = os.path.join(PROBLEM_IMAGE_DIR, fname)
            with open(image_path, "wb") as f:
                f.write(data)
            image_path = await asyncio.to_thread(_auto_orient, image_path)
            image_path = image_path.replace("\\", "/")
    # payload 注入图片路径（供「我的学习」查看原图）
    try:
        payload_dict = json.loads(payload or "{}") if payload else {}
        if not isinstance(payload_dict, dict):
            payload_dict = {}
    except (json.JSONDecodeError, TypeError):
        payload_dict = {}
    if image_path:
        payload_dict["image_path"] = image_path
    payload_json = json.dumps(payload_dict, ensure_ascii=False) if payload_dict else payload
    try:
        from sqlalchemy import select
        async with async_session() as s:
            existing = (
                await s.execute(select(UserImport).where(
                    UserImport.user_id == user.id, UserImport.kind == "problem", UserImport.text == q
                ))
            ).scalar_one_or_none()
            if existing:
                existing.payload = payload_json
                existing.status = "active"
                row_id = existing.id
            else:
                row = UserImport(user_id=user.id, kind="problem", text=q, payload=payload_json, status="active")
                s.add(row)
                await s.commit()
                await s.refresh(row)
                row_id = row.id
            await s.commit()
    except Exception as e:
        logger.warning("save-problem 入库失败: %s", e)
        raise HTTPException(status_code=500, detail="保存失败，请稍后重试")
    logger.info("save-problem ok: id=%s 图片=%s", row_id, bool(image_path))
    return {"status": "ok", "id": row_id}


@router.post("/ai-homework/sentence-audio")
async def upload_sentence_audio(
    sentence: str = Form(...),
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """保存学生对某句的朗读录音（按句子文本哈希命名，覆盖式）"""
    if not sentence.strip():
        raise HTTPException(status_code=422, detail="句子不能为空")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="录音为空")
    path = _sentence_audio_path(sentence)
    with open(path, "wb") as f:
        f.write(data)
    logger.info("sentence-audio 保存: %s (%d bytes)", os.path.basename(path), len(data))
    return {"status": "ok", "hash": os.path.splitext(os.path.basename(path))[0]}


@router.get("/ai-homework/sentence-audio/{audio_hash}")
async def get_sentence_audio(audio_hash: str, user=Depends(get_current_user)):
    """播放某句的学生录音"""
    path = os.path.join(SENTENCE_AUDIO_DIR, f"{audio_hash}.m4a")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="还没有该句的录音")
    return FileResponse(path, media_type="audio/mp4")


@router.get("/ai-homework/sentence-audio/{audio_hash}/exists")
async def sentence_audio_exists(audio_hash: str, user=Depends(get_current_user)):
    """查询某句是否已有录音"""
    return {"exists": os.path.exists(os.path.join(SENTENCE_AUDIO_DIR, f"{audio_hash}.m4a"))}


# ── 识别/解析缓存：同一张图、同一道题不重复调 LLM ──
# key = 内容 SHA-256（图片字节 / 题目文本），value = 对应响应 JSON 落盘。
# 命中缓存直接返回，服务端重启也不丢；不同用户共享（结果只取决于内容本身）。


# ── 数据模型 ──

class ParseImageResponse(BaseModel):
    text: str = ""  # 完整识别文本（向后兼容）
    questions: list[str] = []  # 拆分后的题目列表（多题时逐题，单题时即 [text]）


class AnalyzeRequest(BaseModel):
    question: str = ""
    force_refresh: bool = False  # 跳过缓存强制 LLM 重跑


class SentenceInfo(BaseModel):
    """题目中的一个句子及其关键信息标注"""

    text: str
    is_key: bool = False
    highlight: str = ""  # 关键信息内容（如「牛肉月饼：4 个」）；非关键句为空


class QuantityItem(BaseModel):
    """数量实体（线段图的一条线段）：谁 + 数值 + 单位"""

    name: str = ""  # 实体名（小明 / 小红 / 苹果…）
    value: float | None = None  # 已知数值；未知（题目所求）为 null
    unit: str = ""  # 单位（个/元/只…）


class QuantityRelation(BaseModel):
    """数量关系（线段图标注）：a 相对 b 的关系"""

    a: str = ""  # 主体（如 小红；total 时表示"一共"，可为空）
    b: str = ""  # 基准（如 小明；total 时不使用）
    type: str = "more"  # more=多 / less=少 / times=是…倍 / total=求和（一共）
    amount: float = 0  # more/less 为差值；times 为倍数；total 不使用
    parts: list[str] = []  # total 时的分量名列表（如 ["小明", "小红"]）


class AnalyzeResponse(BaseModel):
    topic: str = ""
    sentences: list[SentenceInfo] = []
    total_key_points: int = 0
    quantities: list[QuantityItem] = []  # 线段图实体（LLM 提取，可能为空）
    relations: list[QuantityRelation] = []  # 线段图关系标注（可能为空）
    questions: list[QuestionItem] = []  # 题目里的所有问题（面向问题倒推；可能为空）


class QuestionItem(BaseModel):
    """题目中的一个问题（面向问题倒推）：原文 + 目标量 + 依赖量 + 求解方向"""

    text: str = ""  # 问题原文（如『足球有几个？』）
    target: str = ""  # 要求解的量（实体名，尽量对应 quantities 的 name）
    needs: list[str] = []  # 回答此问需要先知道的量（实体名；可能依赖前一问的结果）
    hint: str = ""  # 求解方向简述（不给答案，不剧透）


class EvaluateRequest(BaseModel):
    question: str = ""
    answer: str = ""  # 学生口述/输入的思路


class EvaluateResponse(BaseModel):
    verdict: str = ""  # correct | partial | wrong
    feedback: str = ""
    suggestion: str = ""  # 下一步思路引导（不给解题过程）


class StepItem(BaseModel):
    """分步解题的一步：目的 + 算式 + 中间结果 + 逻辑讲解 + 线段绘制指令 + 依据的关键条件"""

    purpose: str = ""  # 这一步想算什么（为什么算它）
    formula: str = ""  # 算式文字（如「(340-240)÷(10-9)」）
    result: str = ""  # 中间结果（数字字符串，或结论文字如「不能」）
    result_unit: str = ""  # 结果单位（千米/时、千米…；结论步为空）
    explain: str = ""  # 为什么这样算（数量关系逻辑，不说教）
    draw: dict | None = None  # 线段绘制指令 {label, value, unit, color, note}；结论步为 null
    source: str = ""  # 这一步主要依据的关键条件（题目原句或摘要；结论步可为空）


class StepsRequest(BaseModel):
    question: str = ""
    target: str = ""  # 可选：当前问题的目标量（引导 LLM 聚焦这一问）


class StepsResponse(BaseModel):
    steps: list[StepItem] = []


# ── 识题：图片 → 题目文本 ──

# 识图 token 优化：火山多模态按图片分辨率计 input token（实测 4000×3000 原图 ≈1351 token）。
# 压缩到最长边 IMG_MAX_EDGE 后 token 显著下降，识别率基本不受影响（印刷题 800px 足够清晰，
# 实测 1600px→800px 提速约 20% 且传输体积降 ~80%）。手写题若识别差可临时调回 1600。
IMG_MAX_EDGE = 800
IMG_QUALITY = 70


def _compress_image(image_path: str) -> str:
    """等比压缩图片到最长边 IMG_MAX_EDGE（JPEG 质量 85），返回新路径；压缩失败返回原路径。

    用于识图前降 input token：压缩后的图另存为 .compressed.jpg，不覆盖原图（缓存仍按原始字节）。
    """
    try:
        from PIL import Image as PILImage

        with PILImage.open(image_path) as opened:
            im = opened.convert("RGB")
            im.thumbnail((IMG_MAX_EDGE, IMG_MAX_EDGE), PILImage.Resampling.LANCZOS)
            out = os.path.join(IMAGE_DIR, os.path.splitext(os.path.basename(image_path))[0] + ".compressed.jpg")
            im.save(out, "JPEG", quality=IMG_QUALITY)
            return out
    except Exception as e:
        logger.warning("图片压缩失败，使用原图: %s", e)
        return image_path


async def _ark_extract_text(image_path: str) -> str:
    """豆包免费多模态识图（失败抛异常，由调用方回退 OCR）；识图前先压缩降 token。
    用用户实测最优的「豆包严格原样排版」提示词（纯文本输出，保留原图排版）。"""
    svc_free = get_free_llm_service()
    if not svc_free.enabled:
        raise RuntimeError("免费 AI 服务未配置（缺少 ARK_API_KEY）")
    prompt = (
        "任务：精确识别小学数学课本照片，原样还原课本全部文字、数字、算式、填空横线，"
        "区分标题、例题、对话框、竖式计算，不要脑补答案，图片里面空着的方框、横线就原样保留为空。\n"
        "输出结构：\n"
        "1. 原文原样转录，竖式完整抄写，竖式里面空白格子保留□符号。\n"
        "2. 不要改写题目，不要解题，只做识别转录。"
    )
    compressed = _compress_image(image_path)
    return await asyncio.to_thread(
        svc_free.chat, prompt, image_paths=[compressed], max_tokens=4096,
        model_override=MULTIMODAL_MODEL, disable_thinking=True,
    )


async def _ocr_fallback(image_path: str) -> str:
    """回退路径：EasyOCR 通用识别"""
    from routes.uploads import _recognize_sync

    return await asyncio.to_thread(_recognize_sync, image_path)


def _clean_ocr_text(s: str) -> str:
    """清理识别文本中的乱码/占位方块字符（� ▯ █ 等替换符），不碰合法中文/标点。

    注意：保留 □（U+25A1）——数学竖式里的空白格子用 □ 表示，不能当乱码删掉。
    """
    t = re.sub(r"[\ufffd\u25af\u2588\u258c\u2580\u2590]", "", s or "")
    # 清理误输出的 LaTeX/Markdown/HTML 标记（如 $^{①}$ → ①）
    t = re.sub(r"\$+\^{?([^$]*?)\}?\$+", r"\1", t)
    t = re.sub(r"\$+", "", t)
    t = re.sub(r"\\text\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"\1/\2", t)
    t = re.sub(r"<sub>([^<]*)</sub>", r"\1", t, flags=re.IGNORECASE)
    t = re.sub(r"<sup>([^<]*)</sup>", r"\1", t, flags=re.IGNORECASE)
    # 数学 LaTeX → 纯文本（竖式 \begin{array}...\end{array 还原成文本对齐，填空 \underline 还原成横线）
    t = re.sub(r"\\div", "÷", t)
    t = re.sub(r"\\times", "×", t)
    t = re.sub(r"\\underline\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\\begin\{array\}\{[^{}]*\}", "", t)
    t = re.sub(r"\\end\{array\}", "", t)
    t = re.sub(r"\\hline", "----", t)
    t = re.sub(r"\\\\", "\n", t)
    t = re.sub(r"\\ ", " ", t)
    # 清理 markdown 标题/代码块围栏（竖式可能被模型包进 ``` 代码块）
    t = re.sub(r"^[ \t]{0,3}#{1,6}[ \t]*", "", t, flags=re.MULTILINE)
    t = re.sub(r"^[ \t]*```[a-zA-Z0-9]*[ \t]*$", "", t, flags=re.MULTILINE)
    # 清理 PP-StructureV3 输出中的 HTML 图片/div 标记（数学题无插图需要）
    t = re.sub(r"<img[^>]*/?>", "", t, flags=re.IGNORECASE)
    t = re.sub(r"<div[^>]*>", "", t, flags=re.IGNORECASE)
    t = re.sub(r"</div>", "", t, flags=re.IGNORECASE)
    t = re.sub(r"<[^>]+>", "", t, flags=re.IGNORECASE)
    return t


def _split_questions(text: str) -> list[str]:
    """把识别文本拆成题目列表：优先【题N】标记，其次空行/行首题号，兜底整段一题。"""
    import re

    text = _clean_ocr_text(text or "").strip()
    if not text:
        return []

    # 1) 【题N】标记（Ark prompt 强制格式）
    marked = re.split(r"【\s*题\s*\d+\s*】", text)
    if len(marked) > 1:
        out = [m.strip() for m in marked if m.strip()]
        if out:
            return out

    # 2) 行首题号拆分（含文本开头题号、圈号①②③、（1）（2）等）
    #    放在空行分隔之前：数学练习/试卷优先按题号一题一题拆，避免模型偶发空行把整段切开
    _Q_PREFIX = re.compile(
        r"^\s*(?:"
        r"\d+\s*[.、．)）]|"  # 1. 2、3）4．
        r"[（(]\s*\d+\s*[）)]|"  # （1）(2)
        r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|"
        r"[一二三四五六七八九十]+[、.．]"  # 一、二、
        r")"
    )
    out: list[str] = []
    buf: list[str] = []
    for ln in text.split("\n"):
        if _Q_PREFIX.match(ln) and buf:
            joined = "\n".join(buf).strip()
            if joined:
                out.append(joined)
            buf = []
        buf.append(ln)
    if buf:
        joined = "\n".join(buf).strip()
        if joined:
            out.append(joined)
    if len(out) > 1:
        return out

    # 3) 空行分隔
    parts = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(parts) > 1:
        return parts

    return [text]


@router.post("/ai-homework/parse-image", response_model=ParseImageResponse)
async def parse_image(
    file: UploadFile = File(...),
    no_cache: bool = False,  # true = 跳过缓存强制重新识别（识别成功后覆盖缓存）
    user=Depends(get_current_user),
):
    """拍照识题：Ark 多模态优先，失败回退 OCR；返回全部题目列表（多题逐题）
    同一张图片（字节一致）默认命中缓存，不重复调 LLM；no_cache=true 强制重识。"""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="图片为空")

    # 缓存命中：同一张图不重复识别（no_cache=true 时跳过）
    img_hash = hashlib.sha256(data).hexdigest()
    cache_file = os.path.join(CACHE_DIR, f"parse_{img_hash}.json")
    if not no_cache:
        cached = _read_cache(cache_file)
        if cached is not None:
            logger.info("parse-image 缓存命中: %s", img_hash[:8])
            return ParseImageResponse(
                text=str(cached.get("text", "")),
                questions=[str(q) for q in cached.get("questions", []) if q],
            )

    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(IMAGE_DIR, fname)
    with open(path, "wb") as f:
        f.write(data)
    # 图片方向自动校正（EXIF Orientation → 旋转像素为正向）
    path = await asyncio.to_thread(_auto_orient, path)

    # 预分类：截图先裁剪 UI 残留；分类信息记录供日志/后续路由
    try:
        from utils.image_classify import classify_image, crop_to_box
        cls = await asyncio.to_thread(classify_image, path)
        logger.info("图片预分类: %s (%s)", os.path.basename(path), cls.to_dict())
        if cls.is_screenshot and cls.crop_box:
            cropped = await asyncio.to_thread(crop_to_box, path, cls.crop_box)
            if cropped != path:
                logger.info("截图已裁剪 UI 残留: %s -> %s", os.path.basename(path), os.path.basename(cropped))
                path = cropped
    except Exception as e:
        logger.warning("图片预分类跳过: %s", e)

    text = ""
    try:
        text = await _ark_extract_text(path)
    except Exception as e:
        logger.warning("Ark 识图失败，回退 OCR: %s", e)
        try:
            text = await _ocr_fallback(path)
        except Exception as e2:
            logger.warning("OCR 回退也失败: %s", e2)

    # PP-StructureV3 路由已停用（实测效果不佳，用户确认先不用 PaddleOCR 服务）
    text = _clean_ocr_text(text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="未能从图片中识别出题目，请换一张更清晰的图")
    questions = _split_questions(text)
    logger.info("parse-image 识别到 %d 道题", len(questions))
    _write_cache(cache_file, {"text": text, "questions": questions})
    return ParseImageResponse(text=text, questions=questions)


# ── 关键信息标注：本地切分句子 + LLM 标注 ──

@router.post("/ai-homework/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest, user=Depends(get_current_user)):
    """切分题目句子并标注关键信息（只给条件，不给解题过程/答案）
    同一道题（文本一致）直接命中缓存，不重复调 LLM。"""
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="题目不能为空")
    if len(question) > MAX_QUESTION_LEN:
        raise HTTPException(status_code=422, detail=f"题目过长（最多 {MAX_QUESTION_LEN} 字）")

    # 缓存命中：同一道题不重复解析（force_refresh=true 跳过——人工模板提交后需立即重跑验证）
    q_hash = hashlib.sha256(question.encode("utf-8")).hexdigest()
    cache_file = os.path.join(CACHE_DIR, f"analyze_{q_hash}.json")
    cached = _read_cache(cache_file)
    if cached is not None and not req.force_refresh:
        logger.info("analyze 缓存命中: %s", q_hash[:8])
        return AnalyzeResponse(
            topic=str(cached.get("topic", "")),
            sentences=[SentenceInfo(**s) for s in cached.get("sentences", []) if isinstance(s, dict)],
            total_key_points=int(cached.get("total_key_points", 0)),
            quantities=[QuantityItem(**q) for q in cached.get("quantities", []) if isinstance(q, dict)],
            relations=[QuantityRelation(**r) for r in cached.get("relations", []) if isinstance(r, dict)],
            questions=[QuestionItem(**q) for q in cached.get("questions", []) if isinstance(q, dict)],
        )

    sentences = _split_sentences(question)
    prompt = render_analyze(question, sentences)  # 动态提示词：大模型直接读题提取，不依赖本地题型模板
    try:
        # max_tokens 8192：推理模型（deepseek-v4-flash-ga）复杂题推理 token 大，4096 会被推理耗光
        # 导致 content 空/截断 → 触发放宽重试（总耗时翻倍）。8192 让一次调用即可完成。
        # disable_thinking=True：analyze 是结构化提取任务，实测快 ~5 倍且质量不降（关系提取更完整）。
        reply = svc.chat("你是一个只输出JSON的数学应用题分析助手。", prompt, 8192, "ai_homework_analyze", disable_thinking=True)
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429

    # 解析标注与数量关系（容错：旧格式顶层为数组、字段缺失、数值非法时全部降级）
    marks: list[dict] = []
    quantities: list[dict] = []
    relations: list[dict] = []
    questions_raw: list[dict] = []
    try:
        # 容错：剥离 LLM 常见的 markdown 代码块包裹（```json ... ```）后再解析
        _candidate = reply.strip()
        if _candidate.startswith("```"):
            _candidate = re.sub(r"^```(?:json)?\s*", "", _candidate, flags=re.IGNORECASE)
            _candidate = re.sub(r"\s*```\s*$", "", _candidate)
        data = json.loads(_candidate)
        if isinstance(data, list):
            marks = list(data)  # 旧格式：顶层数组 = 句子标注
        elif isinstance(data, dict):
            marks_raw = data.get("marks")
            if isinstance(marks_raw, list):
                marks = [m for m in marks_raw if isinstance(m, dict)]
            if isinstance(data.get("quantities"), list):
                quantities = [q for q in data["quantities"] if isinstance(q, dict)]
            if isinstance(data.get("relations"), list):
                relations = [r for r in data["relations"] if isinstance(r, dict)]
            if isinstance(data.get("questions"), list):
                questions_raw = [q for q in data["questions"] if isinstance(q, dict)]
    except json.JSONDecodeError:
        logger.warning("analyze LLM 输出非 JSON（len=%s），降级为无标注:\n%s", len(reply), reply)

    out: list[SentenceInfo] = []
    for i, s in enumerate(sentences):
        m = marks[i] if i < len(marks) and isinstance(marks[i], dict) else {}
        is_key = bool(m.get("is_key", False))
        highlight = str(m.get("highlight", "") or "")
        if not is_key:
            highlight = ""
        out.append(SentenceInfo(text=s, is_key=is_key, highlight=highlight))

    # 数量实体：value 必须是数字（含 null），否则丢弃该条
    q_out: list[QuantityItem] = []
    for q in quantities:
        name = str(q.get("name", "") or "").strip()
        if not name:
            continue
        raw = q.get("value")
        value: float | None = None
        if raw is not None:
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue  # 非法数值：跳过该实体
        unit = str(q.get("unit", "") or "").strip()
        q_out.append(QuantityItem(name=name, value=value, unit=unit))

    # 关系：amount 必须是数字，否则跳过
    r_out: list[QuantityRelation] = []
    for r in relations:
        a = str(r.get("a", "") or "").strip()
        b = str(r.get("b", "") or "").strip()
        rtype = str(r.get("type", "") or "")
        if rtype not in ("more", "less", "times", "total"):
            continue
        if rtype == "total":
            parts = [str(p).strip() for p in r.get("parts", []) if isinstance(p, str) and str(p).strip()]
            if not parts:
                continue  # total 必须带分量，否则无意义
            r_out.append(QuantityRelation(a=a, b=b, type=rtype, amount=0, parts=parts))
            continue
        if not a or not b:
            continue
        try:
            amount = float(r.get("amount", 0))
        except (TypeError, ValueError):
            continue
        r_out.append(QuantityRelation(a=a, b=b, type=rtype, amount=amount))

    # ── 兜底：题目含"一共/总共/合计/共有"时保证 total 关系存在且 a 指向未知实体 ──

    if re.search(r"一共|总共|合计|共有|总共有", question):
        known_items = [q for q in q_out if q.value is not None]
        unknown_items = [q for q in q_out if q.value is None]
        if len(known_items) >= 2:
            total_rels = [r for r in r_out if r.type == "total"]
            if not total_rels:
                # LLM 没建 total 关系：未知实体优先（可能建了"一共/总数"实体但没建关系），没有则补一个"一共"
                target = unknown_items[0] if unknown_items else None
                if target is None:
                    unit = known_items[0].unit
                    target = QuantityItem(name="一共", value=None, unit=unit)
                    q_out.append(target)
                if target.value is None:
                    r_out.append(QuantityRelation(
                        a=target.name, b="", type="total", amount=0,
                        parts=[k.name for k in known_items],
                    ))
                    logger.info("analyze 兜底补 total 关系: %s = %s", target.name, known_items)
            else:
                tr = total_rels[0]
                # 修正 a 指向：必须匹配某个未知实体，否则改指第一个未知实体（LLM 常把 a 写成"一共"而实体叫"苹果总数"）
                a_ok = any(tr.a == u.name or tr.a in u.name or u.name in tr.a for u in unknown_items)
                if not a_ok and unknown_items:
                    tr.a = unknown_items[0].name
                # parts 为空时补全（LLM 可能漏了 parts）
                if not tr.parts:
                    tr.parts = [k.name for k in known_items]
                logger.info("analyze 兜底修正 total 关系: a=%s parts=%s", tr.a, tr.parts)

    resp = AnalyzeResponse(
        topic="数学应用题",
        sentences=out,
        total_key_points=sum(1 for s in out if s.is_key),
        quantities=q_out,
        relations=r_out,
        questions=[
            QuestionItem(
                text=str(q.get("text", "") or "").strip(),
                target=str(q.get("target", "") or "").strip(),
                needs=[str(x).strip() for x in q.get("needs", []) if isinstance(x, str) and x.strip()],
                hint=str(q.get("hint", "") or "").strip(),
            )
            for q in questions_raw
            if str(q.get("text", "") or "").strip()
        ],
    )
    _write_cache(cache_file, resp.model_dump())
    return resp


# ── 认读画像：字被点击发音次数（点击越多 → 越不会认读） ──

class CharClickRequest(BaseModel):
    chars: list[str] = []  # 本次点击朗读的汉字（批量上报，每项单字）


class CharClickStatsItem(BaseModel):
    char: str = ""
    count: int = 0


class CharClickStatsResponse(BaseModel):
    total_chars: int = 0  # 已记录的不同字数量
    total_clicks: int = 0  # 累计点击次数
    items: list[CharClickStatsItem] = []  # 按次数降序（画像：排前面的越不会认读）


@router.post("/ai-homework/char-click", response_model=dict)
async def record_char_click(req: CharClickRequest, user=Depends(get_current_user)):
    """记录学生点击某字发音的次数（幂等累加；批量上报，单次请求多字）。"""
    chars = [str(c).strip() for c in req.chars if c and isinstance(c, str)]
    chars = [c for c in chars if c]  # 已 strip，空过滤
    if not chars:
        raise HTTPException(status_code=422, detail="chars 不能为空")
    if len(chars) > 200:
        raise HTTPException(status_code=422, detail="单次上报过多（最多 200 字）")
    try:
        from sqlalchemy import select

        async with async_session() as s:
            for ch in chars[:50]:  # 上限 50 防滥用（一次点击 = 一个字，实际远小于此）
                row = (
                    await s.execute(
                        select(CharClickRow).where(
                            CharClickRow.user_id == user.id, CharClickRow.char == ch
                        )
                    )
                ).scalar_one_or_none()
                if row is not None:
                    row.click_count += 1
                else:
                    s.add(CharClickRow(user_id=user.id, char=ch, click_count=1))
            await s.commit()
    except Exception as e:
        logger.warning("char-click 入库失败: %s", e)
        raise HTTPException(status_code=500, detail="记录失败，请稍后重试")
    return {"status": "ok", "recorded": len(chars[:50])}


@router.get("/ai-homework/char-click/stats", response_model=CharClickStatsResponse)
async def char_click_stats(user=Depends(get_current_user)):
    """认读画像：该学生点击发音次数从高到低（点得越多的字越不会认读）。"""
    try:
        from sqlalchemy import func, select

        async with async_session() as s:
            rows = (
                await s.execute(
                    select(CharClickRow.char, CharClickRow.click_count)
                    .where(CharClickRow.user_id == user.id)
                    .order_by(CharClickRow.click_count.desc(), CharClickRow.id.asc())
                )
            ).all()
            total_clicks = (
                await s.execute(
                    select(func.sum(CharClickRow.click_count)).where(CharClickRow.user_id == user.id)
                )
            ).scalar_one()
        return CharClickStatsResponse(
            total_chars=len(rows),
            total_clicks=int(total_clicks or 0),
            items=[CharClickStatsItem(char=str(r[0]), count=int(r[1])) for r in rows[:200]],
        )
    except Exception as e:
        logger.warning("char-click stats 查询失败: %s", e)
        return CharClickStatsResponse()


# ── 闯关：LangGraph 编排（生成计划 / 判题 / 子问题降解 / 讲解 / 推进 / 历史 / 回溯） ──

class QuestStepData(BaseModel):
    """发给客户端的一步（不含答案，防止剧透）"""
    index: int = 0
    type: str = ""  # concept/understand/extract/relation/formula/summary
    question: str = ""
    options: list[str] = []


class QuestStartResponse(BaseModel):
    session_id: int = 0
    total_steps: int = 0
    current_step: int = 0
    steps: list[QuestStepData] = []
    question: str = ""


class QuestAnswerRequest(BaseModel):
    session_id: int = 0
    answer_index: int = -1  # 学生选的选项下标


class QuestAnswerResponse(BaseModel):
    correct: bool = False
    done: bool = False  # 全部完成
    feedback: str = ""  # 答对表扬 / 答错引导
    concept_explain: str = ""  # 概念讲解
    sub_question: QuestStepData | None = None  # 答错降解出的简化子问题
    sub_back_to_original: bool = False  # 子问题答对 → 回到原题
    current_step: int = 0
    total_steps: int = 0
    next_step: QuestStepData | None = None


class QuestHistoryItem(BaseModel):
    checkpoint_id: str = ""
    step_index: int = 0
    total_steps: int = 0
    last_answer: str = ""  # 该步最近一次作答内容
    last_correct: bool = False
    sub_used: bool = False  # 该步是否走了解题（子问题）
    answer_count: int = 0  # 该步作答次数（含子问题）


class QuestHistoryResponse(BaseModel):
    session_id: int = 0
    items: list[QuestHistoryItem] = []


class QuestReplayRequest(BaseModel):
    session_id: int = 0
    checkpoint_id: str = ""


class QuestSessionSummary(BaseModel):
    session_id: int = 0
    question: str = ""
    current_step: int = 0
    total_steps: int = 0
    created_at: str = ""


class QuestSessionsResponse(BaseModel):
    items: list[QuestSessionSummary] = []


class QuestReportItem(BaseModel):
    index: int = 0
    type: str = ""
    question: str = ""
    attempts: int = 0
    wrong: int = 0
    sub_used: int = 0
    passed: bool = False


class QuestReportResponse(BaseModel):
    total_steps: int = 0
    attempts: int = 0
    passed_steps: int = 0
    done: bool = False
    summary: str = ""
    wrong_steps: list[QuestReportItem] = []
    steps: list[QuestReportItem] = []


def _get_quest_thread(session_id: int, user_id: int):
    """校验会话归属并返回 thread_id（= session_id 字符串）"""
    from sqlalchemy import select
    return f"{session_id}"


@router.post("/ai-homework/quest/start", response_model=QuestStartResponse)
async def quest_start(req: AnalyzeRequest, user=Depends(get_current_user)):
    """闯关开始：LangGraph 生成计划（thread_id = 会话 id），返回全部步骤（不含答案）。"""
    from services import quest_graph
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=422, detail="题目不能为空")
    if len(question) > MAX_QUESTION_LEN:
        raise HTTPException(status_code=422, detail="题目过长")
    try:
        from sqlalchemy import select
        async with async_session() as s:
            session = QuestSessionRow(user_id=user.id, question=question, status="active")
            s.add(session)
            await s.commit()
            await s.refresh(session)
            sid = session.id
    except Exception as e:
        logger.warning("闯关会话保存失败: %s", e)
        raise HTTPException(status_code=500, detail="会话保存失败，请重试")
    try:
        result = await asyncio.to_thread(quest_graph.start, question, str(sid))
    except Exception as e:
        logger.warning("闯关计划生成失败: %s", e)
        raise HTTPException(status_code=502, detail="闯关计划生成失败，请重试")
    return QuestStartResponse(
        session_id=sid, total_steps=result["total_steps"], current_step=0,
        steps=[QuestStepData(**s) for s in result["steps"]], question=question,
    )


@router.post("/ai-homework/quest/step", response_model=QuestAnswerResponse)
async def quest_step(req: QuestAnswerRequest, user=Depends(get_current_user)):
    """闯关作答：LangGraph 判题 → 推进/降解/讲解；答错自动降解子问题（抽象概念 → 具象生活例子）。"""
    from services import quest_graph
    # 校验会话归属
    try:
        from sqlalchemy import select
        async with async_session() as s:
            row = (
                await s.execute(select(QuestSessionRow).where(
                    QuestSessionRow.id == req.session_id, QuestSessionRow.user_id == user.id
                ))
            ).scalar_one_or_none()
            if row is None:
                raise HTTPException(status_code=404, detail="闯关会话不存在")
    except HTTPException:
        raise
    try:
        resp = await asyncio.to_thread(quest_graph.answer, str(req.session_id), req.answer_index)
    except Exception as e:
        logger.warning("闯关 step 处理失败: %s", e)
        raise HTTPException(status_code=500, detail="作答处理失败，请重试")
    # 同步 DB：进度与完成状态（供续闯列表/家长报告）
    try:
        from sqlalchemy import select
        async with async_session() as s:
            row = (
                await s.execute(select(QuestSessionRow).where(
                    QuestSessionRow.id == req.session_id, QuestSessionRow.user_id == user.id
                ))
            ).scalar_one_or_none()
            if row is not None:
                row.step_index = resp.get("current_step", row.step_index)
                if resp.get("done"):
                    row.status = "done"
                await s.commit()
    except Exception as e:
        logger.warning("闯关状态同步失败: %s", e)
    return QuestAnswerResponse(**resp)


@router.get("/ai-homework/quest/sessions", response_model=QuestSessionsResponse)
async def quest_sessions(user=Depends(get_current_user)):
    """最近未完成的闯关会话（用于「继续上次闯关」）"""
    from sqlalchemy import select
    async with async_session() as s:
        rows = (
            await s.execute(
                select(QuestSessionRow)
                .where(QuestSessionRow.user_id == user.id, QuestSessionRow.status == "active")
                .order_by(QuestSessionRow.id.desc())
                .limit(5)
            )
        ).scalars().all()
    items = []
    for r in rows:
        items.append(QuestSessionSummary(
            session_id=r.id, question=r.question[:80],
            current_step=r.step_index, total_steps=0,
            created_at=str(r.created_at) if r.created_at else "",
        ))
    return QuestSessionsResponse(items=items)


@router.post("/ai-homework/quest/continue", response_model=QuestAnswerResponse)
async def quest_continue(req: QuestReplayRequest, user=Depends(get_current_user)):
    """续闯：恢复到最近状态，展示当前步问题"""
    from services import quest_graph
    try:
        from sqlalchemy import select
        async with async_session() as s:
            row = (
                await s.execute(select(QuestSessionRow).where(
                    QuestSessionRow.id == req.session_id, QuestSessionRow.user_id == user.id
                ))
            ).scalar_one_or_none()
            if row is None:
                raise HTTPException(status_code=404, detail="闯关会话不存在")
    except HTTPException:
        raise
    try:
        resp = await asyncio.to_thread(quest_graph.resume, str(req.session_id))
    except Exception as e:
        logger.warning("闯关续闯失败: %s", e)
        raise HTTPException(status_code=500, detail="续闯失败，请重试")
    return QuestAnswerResponse(**resp)


@router.post("/ai-homework/quest/retry-errors", response_model=QuestStartResponse)
async def quest_retry_errors(req: QuestReplayRequest, user=Depends(get_current_user)):
    """错题回练：取该会话答错的步骤生成新线程（复用原题，不重新 LLM 生成计划）"""
    from services import quest_graph
    from sqlalchemy import select
    async with async_session() as s:
        row = (
            await s.execute(select(QuestSessionRow).where(
                QuestSessionRow.id == req.session_id, QuestSessionRow.user_id == user.id
            ))
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="闯关会话不存在")
        question = row.question
    try:
        seed = await asyncio.to_thread(_retry_errors_seed, str(req.session_id))
    except Exception as e:
        logger.warning("错题回练生成失败: %s", e)
        raise HTTPException(status_code=500, detail="错题回练生成失败，请重试")
    if not seed:
        raise HTTPException(status_code=422, detail="没有答错的步骤，不需要回练")
    # 新会话（新 thread）
    try:
        async with async_session() as s:
            ns = QuestSessionRow(user_id=user.id, question=question, status="active")
            s.add(ns)
            await s.commit()
            await s.refresh(ns)
            new_id = ns.id
    except Exception as e:
        logger.warning("错题回练会话创建失败: %s", e)
        raise HTTPException(status_code=500, detail="会话创建失败，请重试")
    try:
        result = await asyncio.to_thread(quest_graph.start_retry, str(new_id), question, seed)
    except Exception as e:
        logger.warning("错题回练启动失败: %s", e)
        raise HTTPException(status_code=500, detail="错题回练启动失败，请重试")
    return QuestStartResponse(
        session_id=new_id, total_steps=result["total_steps"], current_step=0,
        steps=[QuestStepData(**s) for s in result["steps"]], question=question,
    )


@router.get("/ai-homework/quest/report/{session_id}", response_model=QuestReportResponse)
async def quest_report(session_id: int, user=Depends(get_current_user)):
    """掌握报告：从 checkpoint 历史统计每步对错/降解 + 一句话总结"""
    from services import quest_graph
    from sqlalchemy import select
    async with async_session() as s:
        row = (
            await s.execute(select(QuestSessionRow).where(
                QuestSessionRow.id == session_id, QuestSessionRow.user_id == user.id
            ))
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="闯关会话不存在")
    try:
        rep = await asyncio.to_thread(quest_graph.report, str(session_id))
    except Exception as e:
        logger.warning("掌握报告生成失败: %s", e)
        raise HTTPException(status_code=500, detail="报告生成失败，请重试")
    items = [QuestReportItem(**s) for s in rep.get("steps", [])]
    return QuestReportResponse(
        total_steps=rep.get("total_steps", 0),
        attempts=rep.get("attempts", 0),
        passed_steps=rep.get("passed_steps", 0),
        done=rep.get("done", False),
        summary=rep.get("summary", ""),
        wrong_steps=[QuestReportItem(**s) for s in rep.get("wrong_steps", [])],
        steps=items,
    )


def _retry_errors_seed(thread_id: str) -> list:
    """从会话历史提取答错过的步骤（原题答错），返回步骤子集作为回练计划"""
    from services import quest_graph
    st = quest_graph._raw_state(thread_id)
    plan = st.get("plan", [])
    history = st.get("history", [])
    wrong_idx = {h["step"] for h in history if not h.get("correct") and h.get("kind") != "sub"}
    if not wrong_idx:
        return []
    return [dict(plan[i]) for i in sorted(wrong_idx) if i < len(plan)]


@router.get("/ai-homework/quest/history/{session_id}", response_model=QuestHistoryResponse)
async def quest_history(session_id: int, user=Depends(get_current_user)):
    """会话历史：从 LangGraph checkpoint 提取每步作答（含对错与回溯用 checkpoint_id）。"""
    from services import quest_graph
    try:
        from sqlalchemy import select
        async with async_session() as s:
            row = (
                await s.execute(select(QuestSessionRow).where(
                    QuestSessionRow.id == session_id, QuestSessionRow.user_id == user.id
                ))
            ).scalar_one_or_none()
            if row is None:
                raise HTTPException(status_code=404, detail="闯关会话不存在")
    except HTTPException:
        raise
    items = await asyncio.to_thread(quest_graph.history, str(session_id))
    return QuestHistoryResponse(session_id=session_id, items=[QuestHistoryItem(**i) for i in items])


@router.post("/ai-homework/quest/replay", response_model=QuestAnswerResponse)
async def quest_replay(req: QuestReplayRequest, user=Depends(get_current_user)):
    """回溯：恢复到指定 checkpoint（选错时刻），重新展示该步让学生重做，看是否有改观。"""
    from services import quest_graph
    try:
        from sqlalchemy import select
        async with async_session() as s:
            row = (
                await s.execute(select(QuestSessionRow).where(
                    QuestSessionRow.id == req.session_id, QuestSessionRow.user_id == user.id
                ))
            ).scalar_one_or_none()
            if row is None:
                raise HTTPException(status_code=404, detail="闯关会话不存在")
    except HTTPException:
        raise
    if not req.checkpoint_id:
        raise HTTPException(status_code=422, detail="缺少 checkpoint_id")
    try:
        resp = await asyncio.to_thread(quest_graph.replay, str(req.session_id), req.checkpoint_id)
    except Exception as e:
        logger.warning("闯关回溯失败: %s", e)
        raise HTTPException(status_code=500, detail="回溯失败，请重试")
    return QuestAnswerResponse(**resp)


# ── 思路评判 ──

@router.post("/ai-homework/evaluate", response_model=EvaluateResponse)
async def evaluate(req: EvaluateRequest, user=Depends(get_current_user)):
    """评判学生思路：肯定或纠正，只点评思路不演示计算"""
    question = req.question.strip()
    answer = req.answer.strip()
    if not question:
        raise HTTPException(status_code=422, detail="题目不能为空")
    if not answer:
        raise HTTPException(status_code=422, detail="请先说出你的思路")
    if len(question) > MAX_QUESTION_LEN or len(answer) > 2000:
        raise HTTPException(status_code=422, detail="内容过长")

    prompt = (
        "你是小学数学老师。学生口述了解题思路，请判断思路是否正确并给出反馈。\n"
        "规则：1) 只点评思路本身（先算什么、再算什么、用了什么数量关系），不演算、不给答案数字；\n"
        "2) 思路正确则肯定并表扬；3) 部分正确则指出哪一步对、哪一步需要重新想；\n"
        "4) 完全错误则温和引导，提示重新读关键条件，但绝不替学生解题。\n"
        "只输出JSON：{\"verdict\": \"correct|partial|wrong\", \"feedback\": \"对学生的直接反馈（简洁、鼓励性、中文）\", \"suggestion\": \"下一步思考方向（一句话，不给过程）\"}\n\n"
        f"题目：{question}\n学生思路：{answer}"
    )
    try:
        reply = svc.chat(
            "你是一个只输出JSON、只点评思路不演示解题的小学数学老师。",
            prompt, 4096, "ai_homework_evaluate",
        )
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429

    try:
        _candidate = reply.strip()
        if _candidate.startswith("```"):
            _candidate = re.sub(r"^```(?:json)?\s*", "", _candidate, flags=re.IGNORECASE)
            _candidate = re.sub(r"\s*```\s*$", "", _candidate)
        data = json.loads(_candidate)
        verdict = str(data.get("verdict", "partial"))
        if verdict not in ("correct", "partial", "wrong"):
            verdict = "partial"
        return EvaluateResponse(
            verdict=verdict,
            feedback=str(data.get("feedback", "") or "老师听清了你的思路！"),
            suggestion=str(data.get("suggestion", "") or ""),
        )
    except (json.JSONDecodeError, ValueError, TypeError, ValidationError):
        logger.warning("evaluate LLM 输出异常: %.200s", reply)
        return EvaluateResponse(
            verdict="partial",
            feedback="老师刚才走神了，请再说一遍你的思路～",
            suggestion="",
        )


# ── 分步解题引导：LLM 生成分步解题链（闯关式引导的幕后数据） ──

@router.post("/ai-homework/steps", response_model=StepsResponse)
async def generate_steps(req: StepsRequest, user=Depends(get_current_user)):
    """把题目拆成【分步解题步骤】：每步 = 目的 + 算式 + 中间结果 + 逻辑讲解。

    进入"倒推挑战"的分步模式时按需调用（4-6s，token 少）；失败返回空列表，
    客户端回退到 QuestionItem.hint 一句话提示模式。带磁盘缓存（题目+目标量）。
    """
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="题目不能为空")
    target = req.target.strip()

    cache_key = hashlib.sha256(f"{question}|{target}".encode("utf-8")).hexdigest()
    cache_file = os.path.join(CACHE_DIR, f"steps_{cache_key}.json")
    cached = _read_cache(cache_file)
    if cached is not None:
        logger.info("steps 缓存命中: %s", cache_key[:8])
        steps = cached.get("steps", [])
        return StepsResponse(steps=[StepItem(**s) for s in steps if isinstance(s, dict)])

    target_line = f"\n（注意：当前要解决的是『{target}』这个问题，解题链以算出它为目标）" if target else ""
    prompt = (
        "你是小学数学老师。把这道题拆成【分步解题步骤】，每步是一个独立的小目标：\n"
        "先分析要求什么，再想需要什么条件，一步一步列算式算出中间结果，最后得出结论。\n"
        "对每一步输出：purpose=这一步想算什么（为什么算它，写清这一步在整个解题链中的作用），"
        "formula=算式文字（完整算式，带单位和运算过程，如『(340-240)÷(10-9)=100（千米/时）』），"
        "result=这一步的中间结果（数字字符串；结论步填最终答案，可能是『能』『不能』『不够』等文字），"
        "result_unit=结果单位（千米/时、千米、个等；结论步填空字符串），"
        "explain=为什么这样算（讲清数量关系逻辑，两句话：先说根据哪个条件，再说这样算得到什么），\n"
        "from=这一步主要依据的关键条件（用题目原句或它的简短摘要，如『10:00时距南宁340千米』；结论步可为空）。\n"
        "最后一步是结论步：purpose 写『回答问题』，result 写最终结论，explain 写结论依据（引用关键条件）。\n"
        "【步骤要详细】步骤数量一般 3-5 步，宁可拆细不要合并：凡是有独立中间结果的计算（求差、求倍、求速度、"
        "求单份等）都必须单独成步；每步的 formula 写完整算式（含数字、运算、单位），explain 讲清这一步为什么这样算、"
        "依据哪个条件、得到什么含义。\n"
        '只输出JSON：{"steps": [{"purpose": "...", "formula": "...", "result": "100", "result_unit": "千米/时", '
        '"explain": "...", "from": "10:00时距南宁340千米"}]}'
        f"{target_line}\n题目：{question}"
    )
    try:
        reply = svc.chat(
            "你是一个只输出JSON的小学数学老师。",
            prompt, 4096, "ai_homework_steps",
        )
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429

    steps_out: list[StepItem] = []
    try:
        _candidate = reply.strip()
        if _candidate.startswith("```"):
            _candidate = re.sub(r"^```(?:json)?\s*", "", _candidate, flags=re.IGNORECASE)
            _candidate = re.sub(r"\s*```\s*$", "", _candidate)
        data = json.loads(_candidate)
        raw = data.get("steps", []) if isinstance(data, dict) else data
        if isinstance(raw, list):
            for s in raw:
                if not isinstance(s, dict):
                    continue
                purpose = str(s.get("purpose", "") or "").strip()
                if not purpose:
                    continue
                steps_out.append(StepItem(
                    purpose=purpose,
                    formula=str(s.get("formula", "") or "").strip(),
                    result=str(s.get("result", "") or "").strip(),
                    result_unit=str(s.get("result_unit", "") or "").strip(),
                    explain=str(s.get("explain", "") or "").strip(),
                    draw=s.get("draw") if isinstance(s.get("draw"), dict) else None,
                    source=str(s.get("source", "") or s.get("from", "") or "").strip(),
                ))
    except (json.JSONDecodeError, TypeError, ValidationError):
        logger.warning("steps LLM 输出异常（len=%s），返回空步骤: %.200s", len(reply), reply)

    if steps_out:
        _write_cache(cache_file, {"steps": [s.model_dump() for s in steps_out]})
    return StepsResponse(steps=steps_out)


# ── 问题列表提取（轻量异步补充）：与 analyze 拆开，核心分析先出、问题列表后补 ──

class QuestionsRequest(BaseModel):
    question: str = ""


@router.post("/ai-homework/questions", response_model=AnalyzeResponse)
async def extract_questions(req: QuestionsRequest, user=Depends(get_current_user)):
    """只提取题目里的所有问题（text/target/needs/hint），供 analyze 后异步补充。

    独立轻量调用（实测 3-5s、~360 token），避免和核心分析（marks/quantities/relations）
    一起输出导致推理加深变慢（完整合一 19.7s → 拆开核心 9s + questions 4s）。
    """
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="题目不能为空")

    cache_file = os.path.join(CACHE_DIR, f"questions_{hashlib.sha256(question.encode('utf-8')).hexdigest()}.json")
    cached = _read_cache(cache_file)
    if cached is not None:
        logger.info("questions 缓存命中")
        raw = cached.get("questions", [])
        return AnalyzeResponse(questions=[QuestionItem(**q) for q in raw if isinstance(q, dict)])

    prompt = (
        "找出这道数学题里的【所有问题】（问题=要求学生求解的内容，一句多问/追问都算，一个不能漏）。\n"
        '输出 JSON：{"questions":[{"text":"问题原文","target":"要求解的量","needs":["需要先知道的量"],"hint":"求解方向，不给答案"}]}\n'
        "【输出精简】JSON 无多余空格。\n题目：" + question
    )
    try:
        reply = svc.chat("你是一个只输出JSON的小学数学老师。", prompt, 4096, "ai_homework_questions")
    except BudgetExceededError:
        raise

    q_out: list[QuestionItem] = []
    try:
        _candidate = reply.strip()
        if _candidate.startswith("```"):
            _candidate = re.sub(r"^```(?:json)?\s*", "", _candidate, flags=re.IGNORECASE)
            _candidate = re.sub(r"\s*```\s*$", "", _candidate)
        data = json.loads(_candidate)
        raw = data.get("questions", []) if isinstance(data, dict) else []
        for q in raw:
            if not isinstance(q, dict):
                continue
            text = str(q.get("text", "") or "").strip()
            if not text:
                continue
            q_out.append(QuestionItem(
                text=text,
                target=str(q.get("target", "") or "").strip(),
                needs=[str(x).strip() for x in q.get("needs", []) if isinstance(x, str) and x.strip()],
                hint=str(q.get("hint", "") or "").strip(),
            ))
    except (json.JSONDecodeError, TypeError, ValidationError):
        logger.warning("questions LLM 输出异常（len=%s）: %.200s", len(reply), reply)

    if q_out:
        _write_cache(cache_file, {"questions": [q.model_dump() for q in q_out]})
    return AnalyzeResponse(questions=q_out)


# ── 搭积木学习：LLM 动态积木建议 + 学生搭图提交审核 ──

class BlockSuggestItem(BaseModel):
    """LLM 按题目动态建议的积木：渲染原语 + 名称 + 默认参数 + 使用说明"""

    type: str = ""  # 渲染原语（客户端白名单）：line / rect / circle / text / brace / multi-segment
    name: str = ""  # 积木名（显示在组件栏，如「倍数条」）
    description: str = ""  # 用途说明（一句话）
    params: dict[str, str] = Field(default_factory=dict)  # 默认参数（color/segments/…）
    usage: str = ""  # 使用说明（学生拿到后怎么搭）


class BlockSuggestRequest(BaseModel):
    question: str = Field(default="", max_length=MAX_QUESTION_LEN)


class BlockSuggestResponse(BaseModel):
    blocks: list[BlockSuggestItem] = []


class BuildBlockItem(BaseModel):
    """学生画布上的一个积木（客户端序列化后提交）：类型 + 内容 + 语义描述"""

    kind: str = ""  # segment / dashed_segment / value_label / node_circle / text / brace / dynamic
    label: str = ""  # 实体名 / 文本内容（大括号标签）
    value: str = ""  # 数值字符串（未知量留空）
    unit: str = ""
    color: str = ""
    segments: int = 0  # segment 平均切割份数（>1 = 平均切成 N 份，总量不变）
    times: int = 0  # segment 倍数复制拼接（>1 = N 段等长拼接，N 倍关系）
    extra: float = 0  # segment 增加的长度（>0 = 端部绿色虚线延长段，单位与 value 相同）
    extra_dir: str = ""  # 增长方向："left" 向左 / "right" 向右
    direction: str = ""  # brace 的开口方向：down / up / left / right
    type: str = ""  # dynamic 积木的 type
    note: str = ""  # 客户端生成的语义描述（LLM 审核的主要依据）


class BuildReviewRequest(BaseModel):
    question: str = Field(default="", max_length=MAX_QUESTION_LEN)
    blocks: list[BuildBlockItem] = []


class BuildReviewIssue(BaseModel):
    message: str = ""  # 问题描述
    fix: str = ""  # 怎么改（具体、温和、不给答案数字）


class BuildReviewResponse(BaseModel):
    passed: bool = False
    feedback: str = ""  # 对学生的整体反馈
    issues: list[BuildReviewIssue] = []
    suggestions: list[str] = []  # 改进建议（每句一条）


@router.post("/ai-homework/blocks-suggest", response_model=BlockSuggestResponse)
async def suggest_blocks(req: BlockSuggestRequest, user=Depends(get_current_user)):
    """按题目建议动态积木：内置积木（线段/虚线/大括号×4/节点圆/数值标签/自由文本）表达不了的
    结构（倍数条、平均分、合并节点等）由 LLM 现造积木定义，客户端注册进组件栏。
    同一道题缓存（动态积木只取决于题目内容）。"""
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="题目不能为空")

    cache_file = os.path.join(CACHE_DIR, f"blocks_{hashlib.sha256(question.encode('utf-8')).hexdigest()}.json")
    cached = _read_cache(cache_file)
    if cached is not None:
        logger.info("blocks-suggest 缓存命中")
        raw = cached.get("blocks", [])
        return BlockSuggestResponse(blocks=[BlockSuggestItem(**b) for b in raw if isinstance(b, dict)])

    prompt = (
        "你是小学数学线段图设计助手。学生正在用积木搭这道题的数量关系图，"
        "内置积木有：线段、虚线线段、四种大括号（↓↑←→）、节点圆、数值标签、自由文本。\n"
        "请严格按下面的判定标准，找出题目需要哪些【内置积木表达不了】的结构：\n"
        "- 是…的几倍/倍 关系（如『科技书的本数是故事书的3倍』）→ **必须生成** 倍数条（multi-segment，"
        "segments=倍数），因为内置线段只能表示长度比例，表达不了『分成几段、每段相等』的倍数语义；\n"
        "- 平均分成几份/平均分（如『把90个苹果平均分给3个班』）→ **必须生成** 均分条（multi-segment，segments=份数）；\n"
        "- 两个量合并成总数 → 内置大括号已足够，**不要生成**；\n"
        "- 多几个/少几个的差值比较 → 内置虚线线段已足够，**不要生成**；\n"
        "- 两个量都是未知、只给关系（如『甲是乙的一半』）→ 生成半段条（multi-segment，segments=2）。\n"
        "其余情况如果确实没有倍数/均分等结构，返回空列表（别硬造）。最多返回 3 个，只返回真正必要的。\n"
        '输出 JSON：{"blocks":[{"type":"multi-segment|line|rect|circle|text|brace","name":"积木名（如 倍数条）",'
        '"description":"用途一句话","params":{"color":"默认颜色 green/blue/red/black","segments":"分段数(仅multi-segment)","unit":"单位(如有)"},'
        '"usage":"学生拿到后怎么搭（一句话）"}]}\n'
        "【输出精简】JSON 无多余空格。\n题目：" + question
    )
    try:
        reply = svc.chat("你是一个只输出JSON的小学数学线段图设计助手。", prompt, 4096, "ai_homework_blocks")
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429

    def _parse_blocks(raw_reply: str) -> list[BlockSuggestItem]:
        """解析 LLM 输出为积木列表（白名单过滤 + 非法项丢弃），失败/为空返回空列表"""
        out: list[BlockSuggestItem] = []
        _candidate = raw_reply.strip()
        if _candidate.startswith("```"):
            _candidate = re.sub(r"^```(?:json)?\s*", "", _candidate, flags=re.IGNORECASE)
            _candidate = re.sub(r"\s*```\s*$", "", _candidate)
        try:
            data = json.loads(_candidate)
        except json.JSONDecodeError:
            return out
        raw = data.get("blocks", []) if isinstance(data, dict) else []
        for b in raw:
            if not isinstance(b, dict):
                continue
            btype = str(b.get("type", "") or "").strip()
            if btype not in ("multi-segment", "line", "rect", "circle", "text", "brace"):
                continue  # 只收客户端可渲染的白名单原语
            name = str(b.get("name", "") or "").strip()
            if not name:
                continue
            params = b.get("params")
            out.append(BlockSuggestItem(
                type=btype,
                name=name,
                description=str(b.get("description", "") or "").strip(),
                params={str(k): str(v) for k, v in params.items()} if isinstance(params, dict) else {},
                usage=str(b.get("usage", "") or "").strip(),
            ))
        return out

    blocks_out = _parse_blocks(reply)
    if not blocks_out:
        # 推理模型偶发输出空：重试一次，避免组件栏拿不到动态积木
        logger.info("blocks-suggest 首次结果为空，重试一次")
        try:
            reply2 = svc.chat("你是一个只输出JSON的小学数学线段图设计助手。", prompt, 4096, "ai_homework_blocks")
            blocks_out = _parse_blocks(reply2)
        except BudgetExceededError:
            raise

    if blocks_out:
        _write_cache(cache_file, {"blocks": [b.model_dump() for b in blocks_out]})
    return BlockSuggestResponse(blocks=blocks_out)


@router.post("/ai-homework/build-review", response_model=BuildReviewResponse)
async def review_build(req: BuildReviewRequest, user=Depends(get_current_user)):
    """审核学生搭的积木图是否满足题目要求：量齐不齐、未知量标没标、数量关系对不对。
    个性化提交，不缓存。"""
    question = req.question.strip()
    blocks = [b for b in req.blocks if b.kind.strip()]  # 只保留有类型的积木
    if not question:
        raise HTTPException(status_code=422, detail="题目不能为空")
    if not blocks:
        raise HTTPException(status_code=422, detail="画布还是空的，先搭几个积木再提交吧")

    # 画布积木 → 供 LLM 审阅的结构化清单（note 是客户端生成的语义描述，LLM 据此判断）
    block_lines = []
    for i, b in enumerate(blocks, 1):
        parts = [f"kind={b.kind}", f"label={b.label}"]
        if b.value:
            parts.append(f"value={b.value}{b.unit}")
        if b.direction:
            parts.append(f"direction={b.direction}")
        if b.type:
            parts.append(f"type={b.type}")
        if b.segments > 1:
            parts.append(f"segments={b.segments}（平均切成N份，总量不变）")
        if b.times > 1:
            parts.append(f"times={b.times}（N段等长复制拼接，N倍关系）")
        if b.extra > 0:
            parts.append(f"extra={b.extra}（{'向左' if b.extra_dir == 'left' else '向右'}绿色虚线延长段，表示增加/多出）")
        if b.note:
            parts.append(f"语义={b.note}")
        block_lines.append(f"{i}. " + "，".join(parts))

    prompt = (
        "你是小学数学线段图老师。学生用积木搭了一张数量关系图，请审核它是否满足题目要求。\n"
        "积木含义：segment=线段（表示一个量，label=名称，value=数值，空=未知量）；"
        "segment 的 segments=N 表示平均切成 N 份（总量不变）；times=N 表示 N 段等长复制拼接（N 倍关系）；"
        "extra=N 表示端部绿色虚线延长段（增加/多出的量，extra_dir 说明向左还是向右）；"
        "dashed_segment=虚线线段（表示差值/关系标注）；"
        "brace=大括号（框住几个量表示合并/一共，direction 是开口方向，label 是标注文字）；"
        "node_circle=节点圆（label=名称）；value_label=数值标签；text=自由文本；"
        "person=小人（表示一个人，label=名字，通常放在线段端点表示谁的量）；"
        "dynamic=自定义积木（type 说明结构）。\n"
        "审核要点：1) 题目里的每个已知量是否都有对应积木、数值是否正确；"
        "2) 题目所求的未知量是否用空数值线段/节点圆标出；"
        "3) 数量关系表达是否正确（大括号合并=相加、虚线=差值、倍数结构=分段）；"
        "4) 有没有画错、多余或遗漏的量。\n"
        "只点评图与题目的对应关系，不替学生算答案数字（未知量就说是未知量，别给出数字）。\n"
        '输出 JSON：{"passed": true或false, "feedback":"对学生的整体反馈（简洁鼓励，中文，一句话）",'
        '"issues":[{"message":"问题描述（具体指出哪个积木/哪个量）","fix":"怎么改（温和、具体、不给答案数字）"}],'
        '"suggestions":["改进建议（每句一条，最多3条）"]}\n'
        "passed=true 时 issues 给空列表。\n\n"
        f"题目：{question}\n\n学生搭的积木图：\n" + "\n".join(block_lines)
    )
    try:
        reply = svc.chat(
            "你是一个只输出JSON、只点评图不替学生算答案的小学数学线段图老师。",
            prompt, 4096, "ai_homework_build_review",
        )
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429

    try:
        _candidate = reply.strip()
        if _candidate.startswith("```"):
            _candidate = re.sub(r"^```(?:json)?\s*", "", _candidate, flags=re.IGNORECASE)
            _candidate = re.sub(r"\s*```\s*$", "", _candidate)
        data = json.loads(_candidate)
        if not isinstance(data, dict):
            raise ValueError("非对象")
        issues_raw = data.get("issues", [])
        issues = [
            BuildReviewIssue(
                message=str(x.get("message", "") or "").strip(),
                fix=str(x.get("fix", "") or "").strip(),
            )
            for x in issues_raw
            if isinstance(x, dict) and str(x.get("message", "") or "").strip()
        ]
        suggestions_raw = data.get("suggestions", [])
        suggestions = [str(s).strip() for s in suggestions_raw if isinstance(s, str) and str(s).strip()]
        return BuildReviewResponse(
            passed=bool(data.get("passed", False)),
            feedback=str(data.get("feedback", "") or "老师看过了，再对照题目检查一下～"),
            issues=issues,
            suggestions=suggestions,
        )
    except (json.JSONDecodeError, ValueError, TypeError, ValidationError):
        logger.warning("build-review LLM 输出异常（len=%s）: %.200s", len(reply), reply)
        return BuildReviewResponse(
            passed=False,
            feedback="老师刚才走神了，请再提交一次～",
            issues=[],
            suggestions=[],
        )


# ── 搭积木自动搭建：LLM 提取线段图初始指令（已知/未知量 + 关系 + 差值 + 大括号） ──

class AutoSegmentItem(BaseModel):
    """一条数量线段：名称 + 数值（未知量 null）+ 单位"""

    label: str = ""
    value: float | None = None
    unit: str = ""
    is_unknown: bool = False


class AutoDiff(BaseModel):
    """差值对比：a 比 b 多/少（text 为差值描述，value 为差值数值）"""

    a: str = ""
    b: str = ""
    text: str = ""  # 如「多6千克」
    value: float = 0


class AutoTimes(BaseModel):
    """倍数关系：a 是 b 的几倍"""

    a: str = ""
    b: str = ""


class AutoBrace(BaseModel):
    """底部大括号（一共/总数）：label 标注文字，parts 分量名称"""

    label: str = ""
    parts: list[str] = []


class AutoBuildResult(BaseModel):
    """线段图初始搭建指令"""

    segments: list[AutoSegmentItem] = []  # 全部已知量 + 未知量
    relation: str = "none"  # total=整体-部分 / diff=差值对比 / times=倍数关系 / none
    diff: AutoDiff | None = None  # relation=diff 时
    times: AutoTimes | None = None  # relation=times 时
    brace: AutoBrace | None = None  # 需要"一共"大括号时


@router.post("/ai-homework/build-auto", response_model=AutoBuildResult)
async def auto_build(req: AnalyzeRequest, user=Depends(get_current_user)):
    """大模型提取线段图初始搭建指令：全部已知量/未知量、关系类型（整体-部分/差值/倍数）、
    差值文本、是否需要底部大括号。客户端据此自动生成初始线段（可继续手工调整）。
    同一道题缓存。"""
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="题目不能为空")

    cache_file = os.path.join(CACHE_DIR, f"build_{hashlib.sha256(question.encode('utf-8')).hexdigest()}.json")
    cached = _read_cache(cache_file)
    if cached is not None:
        logger.info("build-auto 缓存命中")
        return AutoBuildResult(**cached)

    prompt = (
        "你是小学数学线段图构建助手。根据题目输出线段图【初始搭建指令】：\n"
        "1) segments：题目里的每个数量一条（label=名称，value=数值，unit=单位；"
        "题目所求的未知量 value=null、is_unknown=true）。所有已知量和未知量必须全部列出，一个不漏；\n"
        "2) relation：判断数量关系类型——total=整体-部分（求和/一共）、diff=差值对比（多/少）、"
        "times=倍数关系（是…的几倍）、none=其他；\n"
        "3) relation=diff 时输出 diff：{a=较大的量名称, b=较小的量名称, text=差值描述（如「多6千克」）, "
        "value=差值数值}；\n"
        "4) relation=times 时输出 times：{a=较大的量名称, b=基准量名称}；\n"
        "5) 题目需要表示『一共/总数』（如『一共多少个』『总共有多少』）时输出 brace："
        "{label=大括号标注文字（如「一共？个」）, parts=[参与求和的分量名称列表]}。\n"
        "【输出精简】JSON 无多余空格。\n"
        '只输出JSON：{"segments":[{"label":"...","value":数字或null,"unit":"..."}],"relation":"total|diff|times|none",'
        '"diff":{"a":"...","b":"...","text":"...","value":数字},"times":{"a":"...","b":"..."},'
        '"brace":{"label":"...","parts":["..."]}}\n题目：' + question
    )
    try:
        reply = svc.chat("你是一个只输出JSON的小学数学线段图构建助手。", prompt, 4096, "ai_homework_build_auto")
    except BudgetExceededError:
        raise  # 预算守卫拒绝 → 全局 429

    def _parse(raw_reply: str) -> AutoBuildResult:
        _candidate = raw_reply.strip()
        if _candidate.startswith("```"):
            _candidate = re.sub(r"^```(?:json)?\s*", "", _candidate, flags=re.IGNORECASE)
            _candidate = re.sub(r"\s*```\s*$", "", _candidate)
        data = json.loads(_candidate)
        if not isinstance(data, dict):
            raise ValueError("非对象")
        segs: list[AutoSegmentItem] = []
        for s in data.get("segments", []):
            if not isinstance(s, dict):
                continue
            label = str(s.get("label", "") or "").strip()
            if not label:
                continue
            raw_v = s.get("value")
            value: float | None = None
            if raw_v is not None:
                try:
                    value = float(raw_v)
                except (TypeError, ValueError):
                    continue
            segs.append(AutoSegmentItem(
                label=label,
                value=value,
                unit=str(s.get("unit", "") or "").strip(),
                is_unknown=bool(s.get("is_unknown", False)) or value is None,
            ))
        segs = segs[:10]
        relation = str(data.get("relation", "none") or "none")
        if relation not in ("total", "diff", "times", "none"):
            relation = "none"
        diff = None
        d = data.get("diff")
        if isinstance(d, dict) and relation == "diff":
            try:
                diff = AutoDiff(
                    a=str(d.get("a", "") or "").strip(),
                    b=str(d.get("b", "") or "").strip(),
                    text=str(d.get("text", "") or "").strip(),
                    value=float(d.get("value", 0) or 0),
                )
            except (TypeError, ValueError):
                diff = None
        times = None
        t = data.get("times")
        if isinstance(t, dict) and relation == "times":
            times = AutoTimes(
                a=str(t.get("a", "") or "").strip(),
                b=str(t.get("b", "") or "").strip(),
            )
        brace = None
        br = data.get("brace")
        if isinstance(br, dict):
            parts = [str(p).strip() for p in br.get("parts", []) if isinstance(p, str) and str(p).strip()]
            brace = AutoBrace(
                label=str(br.get("label", "") or "").strip(),
                parts=parts,
            )
        return AutoBuildResult(segments=segs, relation=relation, diff=diff, times=times, brace=brace)

    try:
        result = _parse(reply)
    except (json.JSONDecodeError, ValueError, TypeError):
        logger.warning("build-auto LLM 输出异常（len=%s）: %.200s", len(reply), reply)
        result = AutoBuildResult()
    if not result.segments:
        # 推理模型偶发空输出：重试一次
        logger.info("build-auto 首次结果为空，重试一次")
        try:
            reply2 = svc.chat("你是一个只输出JSON的小学数学线段图构建助手。", prompt, 4096, "ai_homework_build_auto")
            result = _parse(reply2)
        except BudgetExceededError:
            raise
        except (json.JSONDecodeError, ValueError, TypeError):
            result = AutoBuildResult()
    if result.segments:
        _write_cache(cache_file, result.model_dump())
    return result


