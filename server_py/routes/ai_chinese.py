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
from database import CharClickRow, CharUnknownMarkRow, QuestSessionRow, UserImport
from database import ChineseUnitKnowledgeRow, ChineseReadingItemRow, ChineseQuestionItemRow, ChineseEssayKnowledgeRow, ChineseTextbookPageRow, WikiPageRow, KnowledgeRelationRow, ChineseRecitationItemRow
from prompts_aihomework import render_analyze
from routes.auth import get_current_user
from services.deepseek import BudgetExceededError, DeepSeekService
from services.free_llm import get_service as get_free_llm_service

logger = logging.getLogger(__name__)

router = APIRouter()

# 项目根目录（server_py，即 routes 的上级），所有 data/* 路径统一基于绝对路径，避免依赖进程 cwd
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_BASE = os.path.join(BASE_DIR, "data")

cfg: Config = None  # type: ignore
svc: DeepSeekService = None  # type: ignore

IMAGE_DIR = os.path.join(DATA_BASE, "ai_chinese_images")
CACHE_DIR = os.path.join(DATA_BASE, "ai_chinese_cache")
SENTENCE_AUDIO_DIR = os.path.join(DATA_BASE, "ai_chinese_sentence_audio")
PROBLEM_IMAGE_DIR = os.path.join(DATA_BASE, "ai_chinese_problems")
UPLOAD_DATA_DIR = os.path.join(DATA_BASE, "uploads")  # 裁剪区域小图复用 uploads 静态路由

MAX_QUESTION_LEN = 18000  # 应用层上限（预算守卫 max_input_chars=20000 内留余量）

# 识图模型：必须用多模态模型。当前 ark_chat.model（deepseek-v4-flash-ga）是纯文本推理模型，
# 不支持图片输入（会 400 → 回退本地 OCR ~44s 慢）。识图 override 到 doubao-seed-2-1-turbo-260628（统一豆包识图模型）。
MULTIMODAL_MODEL = "doubao-seed-2-1-turbo-260628"

# 图片处理工具（拆分自胖路由，见 utils/ai_image_utils.py）
from utils.ai_image_utils import auto_orient as _auto_orient
# 缓存工具（拆分自胖路由，见 utils/ai_cache_utils.py）
from utils.ai_cache_utils import read_cache as _read_cache, write_cache as _write_cache
# 文本处理工具（拆分自胖路由，见 utils/ai_text_utils.py）
from utils.ai_text_utils import (
    extract_json_array as _extract_json_array,
    extract_blocks as _extract_blocks,
    extract_html_tables as _extract_html_tables,
    merge_table_blocks as _merge_table_blocks,
    extract_page_bounds as _extract_page_bounds,
    reorder_title_first as _reorder_title_first,
    mark_poetry as _mark_poetry,
    mark_ordered_indent as _mark_ordered_indent,
    detect_complex_layout as _detect_complex_layout,
    detect_pp_strength as _detect_pp_strength,
    clean_ocr_text as _clean_ocr_text,
    fix_mojibake as _fix_mojibake,
    dedupe_lines as _dedupe_lines,
    recover_text_from_json as _recover_text_from_json,
    split_questions as _split_questions,
    split_sentences as _split_sentences,
)



def _resolve_image_path(path: str) -> str:
    """解析入库的原图路径：兼容三种存储方式——
    1) 相对 server_py 工作目录（data/... 或 课本照片_xxx/...）
    2) 相对 server_py 的 data/ 子目录
    3) 桌面文件夹（课本照片_20260812 / 手机照片_20260812）绝对路径
    返回可访问路径；都找不到返回原值（由调用方 isfile 判定）。"""
    if not path:
        return path
    p = (path or "").replace("\\", "/")
    candidates = [p]
    if not os.path.isabs(p):
        candidates.append(os.path.join(os.getcwd(), p))
        candidates.append(os.path.join(os.getcwd(), "data", p))
        candidates.append(os.path.join(os.path.expanduser("~"), "Desktop", p))
    for c in candidates:
        if os.path.isfile(c):
            return c
    return path


def _auto_crop_white(image_path: str) -> str:
    """自动裁剪图片四周的白色/近白边（拍照时页面留白/背景）。

    逐边向内扫描，找到非白像素边界后裁剪；结果带缓存（存 IMAGE_DIR/crop_<md5>.jpg）。
    若图片无白边或处理失败，返回原路径。
    """
    try:
        from PIL import Image as PILImage
        import hashlib as _hl

        key = _hl.md5(image_path.encode("utf-8")).hexdigest()[:16]
        out = os.path.join(IMAGE_DIR, f"crop_{key}.jpg")
        if os.path.isfile(out):
            return out

        with PILImage.open(image_path) as im:
            im = im.convert("RGB")
            w, h = im.size
            if w < 100 or h < 100:
                return image_path
            # 降采样到最长边 800 检测边界（加速），坐标等比映射回原图
            scale = min(1.0, 800.0 / max(w, h))
            small = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), PILImage.Resampling.LANCZOS)
            px = small.load()
            sw, sh = small.size
            # 近白阈值：RGB 各通道 > 200 视为背景（手机拍照白边通常浅灰/米白 210~245）
            def _is_white(x, y):
                r, g, b = px[x, y]
                return r > 200 and g > 200 and b > 200
            def _row_white(y):
                cnt = 0
                for x in range(0, sw, 3):
                    if _is_white(x, y): cnt += 1
                return cnt / max(1, (sw + 2) // 3) >= 0.85
            def _col_white(x):
                cnt = 0
                for y in range(top, bottom + 1, 3):
                    if _is_white(x, y): cnt += 1
                return cnt / max(1, (bottom - top + 2) // 3) >= 0.85
            # 上边界（从中间内容区向上确认到边缘：先找到内容起始行，白边在其上）
            # 直接从上往下扫：连续白行视为白边
            top = 0
            while top < sh - 2 and _row_white(top):
                top += 1
            # 下边界
            bottom = sh - 1
            while bottom > top + 2 and _row_white(bottom):
                bottom -= 1
            # 左边界
            left = 0
            while left < sw - 2 and _col_white(left):
                left += 1
            # 右边界
            right = sw - 1
            while right > left + 2 and _col_white(right):
                right -= 1
            # 至少裁剪 1.5% 才算有效，避免过度裁剪内容边缘
            def _back(v):
                return int(round(v / scale))
            crop_box = (_back(left), _back(top), _back(right + 1), _back(bottom + 1))
            cw = crop_box[2] - crop_box[0]
            ch = crop_box[3] - crop_box[1]
            # 保护性裁剪：裁后面积 ≥ 原图 40% 且裁掉至少 2%（有真实白边才裁，防误裁页面内容）
            if cw < w * 0.4 or ch < h * 0.4 or (cw >= w * 0.98 and ch >= h * 0.98):
                return image_path
            cropped = im.crop(crop_box)
            cropped.save(out, "JPEG", quality=85)
            return out
    except Exception as e:
        logger.warning("白边裁剪失败: %s", e)
        return image_path


def init(config: Config):
    global cfg, svc
    cfg = config
    svc = DeepSeekService(config.deepseek, "ai_chinese")
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


@router.post("/ai-chinese/save-problem")
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


@router.get("/ai-chinese/my-imports", response_model=dict)
async def my_chinese_imports(user=Depends(get_current_user)):
    """进入语文页的大纲：当前用户所有已识别的课文/题目（kind=problem，倒序）。
    topic 从 payload 解析用于分类分组。"""
    from sqlalchemy import select
    async with async_session() as s:
        rows = (
            await s.execute(
                select(UserImport)
                .where(UserImport.user_id == user.id, UserImport.kind == "problem", UserImport.status == "active")
                .order_by(UserImport.updated_at.desc())
            )
        ).scalars().all()
    items = []
    for r in rows:
        topic = ""
        try:
            p = json.loads(r.payload or "{}") or {}
            if isinstance(p, dict):
                topic = str(p.get("topic", "") or "").strip()
        except (json.JSONDecodeError, TypeError):
            pass
        items.append({
            "id": r.id,
            "text": (r.text or "")[:2000],
            "topic": topic,
            "payload": r.payload or "",
            "created_at": r.updated_at.strftime("%m-%d %H:%M") if r.updated_at else "",
        })
    return {"items": items}


@router.get("/ai-chinese/problem-image/{import_id}")
async def my_chinese_problem_image(import_id: int, user=Depends(get_current_user)):
    """返回已识别记录的原题照片（校验归属）"""
    from sqlalchemy import select
    async with async_session() as s:
        row = (
            await s.execute(
                select(UserImport).where(
                    UserImport.id == import_id,
                    UserImport.user_id == user.id,
                    UserImport.kind == "problem",
                )
            )
        ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    image_path = ""
    try:
        p = json.loads(row.payload or "{}") or {}
        if isinstance(p, dict):
            image_path = str(p.get("image_path", "") or "").strip()
    except (json.JSONDecodeError, TypeError):
        pass
    if not image_path:
        raise HTTPException(status_code=404, detail="无原图")
    image_path = _resolve_image_path(image_path)
    if not image_path or not os.path.isfile(image_path):
        raise HTTPException(status_code=404, detail="无原图")
    return FileResponse(_auto_crop_white(image_path), media_type="image/jpeg")


@router.get("/ai-chinese/outline-image/{source}/{item_id}")
async def chinese_outline_image(source: str, item_id: int, user=Depends(get_current_user)):
    """大纲条目的来源原图（课本页/单元知识），供图文对照"""
    from sqlalchemy import select
    if source == "textbook":
        model = ChineseTextbookPageRow
    elif source == "unit_knowledge":
        model = ChineseUnitKnowledgeRow
    else:
        raise HTTPException(status_code=422, detail="未知来源")
    async with async_session() as s:
        row = (await s.execute(select(model).where(model.id == item_id))).scalar_one_or_none()
    if row is None or not getattr(row, "image_path", ""):
        raise HTTPException(status_code=404, detail="无原图")
    image_path = _resolve_image_path(str(row.image_path).strip())
    if not image_path or not os.path.isfile(image_path):
        raise HTTPException(status_code=404, detail="无原图")
    return FileResponse(image_path, media_type="image/jpeg")


@router.post("/ai-chinese/sentence-audio")
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


@router.get("/ai-chinese/sentence-audio/{audio_hash}")
async def get_sentence_audio(audio_hash: str, user=Depends(get_current_user)):
    """播放某句的学生录音"""
    path = os.path.join(SENTENCE_AUDIO_DIR, f"{audio_hash}.m4a")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="还没有该句的录音")
    return FileResponse(path, media_type="audio/mp4")


@router.get("/ai-chinese/sentence-audio/{audio_hash}/exists")
async def sentence_audio_exists(audio_hash: str, user=Depends(get_current_user)):
    """查询某句是否已有录音"""
    return {"exists": os.path.exists(os.path.join(SENTENCE_AUDIO_DIR, f"{audio_hash}.m4a"))}


# ── 识别/解析缓存：同一张图、同一道题不重复调 LLM ──
# key = 内容 SHA-256（图片字节 / 题目文本），value = 对应响应 JSON 落盘。
# 命中缓存直接返回，服务端重启也不丢；不同用户共享（结果只取决于内容本身）。


# ── 数据模型 ──

class TextBlockLine(BaseModel):
    """排版块内的一行：图片上同一水平线的文字（保持左右顺序）+ 缩进级别"""

    text: str = ""
    indent: int = 0  # 0=顶格 1≈两汉字 2≈四汉字


class TextBlock(BaseModel):
    """识别出的一个排版块（标题/正文/题号/选项 + 对齐方式），用于客户端按图片排版展示"""

    type: str = "body"  # title / heading / body / question / option / note / image
    text: str = ""
    align: str = "left"  # left / center / right
    lines: list[TextBlockLine] = []  # 视觉行（按行渲染时用）
    polyphones: dict[str, str] = {}  # 多音字 → 正确拼音（带声调），用于 TTS 朗读
    bbox: list[int] | None = None  # PP-StructureV3 坐标渲染：相对原图 0~1000 [left, top, right, bottom]
    order: int | None = None  # PP 阅读顺序（小→大；图片块为 None）


class PageBounds(BaseModel):
    """页面内容边界（0~1000 相对坐标），用于裁剪原图去除白边/背景"""

    left: float = 0.0
    top: float = 0.0
    right: float = 1000.0
    bottom: float = 1000.0


class ParseImageResponse(BaseModel):
    text: str = ""  # 完整识别文本（向后兼容）
    questions: list[str] = []  # 拆分后的题目列表（多题时逐题，单题时即 [text]）
    blocks: list[TextBlock] = []  # 排版块（LLM 识别时记录；OCR 回退为空）
    page_bounds: PageBounds | None = None  # 页面内容边界（LLM 估算，用于裁剪原图）
    crops: list[CropItem] = []  # 页面按题目/区域裁剪的小图（Vision 检测 bbox，前端附图对照）


class CropItem(BaseModel):
    """一个由 Vision-API 按题目/区域裁剪出的区域块"""

    id: int = 0
    title: str = ""  # 该区域标题（如"四、照样子填表"）
    image: str = ""  # 可直接访问的裁剪图 URL（/api/v1/uploads/file/xxx.jpg）
    bbox: list[int] = []  # 原图像素坐标 [x1, y1, x2, y2]


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


# 区域切割专用压缩：最长边明显大于识图（题目多/竖长图时 800px 会让题号和边界看不清、
# 坐标误差放大数倍）。区域检测需要看清题号才能锚定切分，这里用更高分辨率省 token 的更少。
REGION_IMG_MAX_EDGE = 1400


def _compress_image_for_regions(image_path: str) -> str:
    """区域切割专用：等比压缩到 REGION_IMG_MAX_EDGE，保证题号清晰以便按题号锚定切分。"""
    try:
        from PIL import Image as PILImage

        with PILImage.open(image_path) as opened:
            im = opened.convert("RGB")
            im.thumbnail((REGION_IMG_MAX_EDGE, REGION_IMG_MAX_EDGE), PILImage.Resampling.LANCZOS)
            out = os.path.join(IMAGE_DIR, os.path.splitext(os.path.basename(image_path))[0] + ".region.jpg")
            im.save(out, "JPEG", quality=90)
            return out
    except Exception as e:
        logger.warning("区域切割压缩失败，使用原图: %s", e)
        return image_path


VISION_REGION_PROMPT = """任务：按题号切分试卷大题（阅读顺序规则）
阅读顺序：模拟人类阅读。单栏从上到下；双栏先完整读完左栏全部大题，再右栏；表格先行后列。
不要把浏览器UI、窗口标题识别为题目内容。

1. 图上是试卷/练习页面，从上到下有几个大题，每个大题以题号开头（如 一、二、三… 或 1. 2. 3.…）。
2. 找到每个大题的题号，以及该题号这行文字的顶边 y 坐标。
3. 规则：
   - 只找最外层大题题号（一/二/三 或 1/2/3），忽略小题号、选项号 A/B/C、(1)(2)(3) 等
   - 一个题号行内可有多道并列小题（横排），算同一个大题，一个题号
   - 严格按上面阅读顺序输出（单栏从上到下；双栏先左栏后右栏）
4. 坐标系：图片左上角为原点，y 向下为正，像素坐标
5. 输出严格 JSON 数组，每项：{"y":题号行顶边y, "title":"题号及开头几个字，如 一、看拼音写词语"}
6. 只返回纯 JSON。
输出样例（3 个大题）：
[{"y":152,"title":"一、看拼音写词语"},{"y":600,"title":"二、比一比再组词"},{"y":980,"title":"三、按要求写句子"}]"""


async def _detect_regions(image_path: str, is_table: bool) -> list[dict]:
    """方案：行级题号正则硬切（不依赖视觉模型数题/给坐标）。
    1) 纯像素行分割 → 得到每个"文字行"的精确 [top,bottom]。
    2) 逐行裁出小图，用多模态模型读该行文本（单行识别快且准）。
    3) 用正则识别"大题标题行"（一、二、… / 1. / 第X部分）。
    4) 每块：从题号标题行顶部开始，到下一个题号标题行之前的最后一行结束。
       内容很短的题也能正确收尾，绝不把下一题标题切进本块、也不把本块标题切丢。
    返回 crops 列表：[{id, title, image, bbox}]；失败返回 []（不阻断识别）。"""
    try:
        svc_free = get_free_llm_service()
        if not svc_free.enabled:
            return []
        from PIL import Image as PILImage
        import re as _re

        os.makedirs(UPLOAD_DATA_DIR, exist_ok=True)
        crops = []
        with PILImage.open(image_path) as img:
            img = img.convert("RGB")
            ow, oh = img.size
            gray = img.convert("L")
            pix = gray.load()
            wpx, hpx = gray.size

            # ── 1) 纯像素行分割：找出每个"文字行"的 [top,bottom] ──
            row_ink = [sum(1 for xx in range(wpx) if pix[xx, yy] < 230) for yy in range(hpx)]
            ink_th = max(2, wpx // 130)
            text_rows: list[tuple[int, int]] = []  # [(top, bottom)]
            cur_start = -1
            for yy in range(hpx):
                if row_ink[yy] > ink_th:
                    if cur_start < 0:
                        cur_start = yy
                else:
                    if cur_start >= 0 and yy - cur_start >= 8:
                        text_rows.append((cur_start, yy - 1))
                    cur_start = -1
            if cur_start >= 0 and hpx - cur_start >= 8:
                text_rows.append((cur_start, hpx - 1))
            if not text_rows:
                return []

            # ── 2) 逐行读文本：识别真正的"大题标题行" ──
            # 大题题号正则：优先汉字题号（一、二、…）；第X部分
            _cn = r"[一二三四五六七八九十百]+"
            cn_heading_re = _re.compile(rf"^\s*{_cn}[、．\.]")
            part_heading_re = _re.compile(rf"^\s*第{_cn}部分")
            # 若整页没有汉字大题题号，才退化用数字题号（1、/1.）作大题边界
            digit_heading_re = _re.compile(r"^\s*\d{1,2}[、．\.]")

            MIN_LINE_H = 16  # 太矮的行视为分割噪声，不单独读/切

            async def _read_line_text(crop_img, top: int, bottom: int) -> str:
                if bottom - top < MIN_LINE_H:
                    return ""
                crop_img = crop_img.crop((0, top, ow, bottom))
                tmp = os.path.join(UPLOAD_DATA_DIR, f"line_{os.urandom(4).hex()}.png")
                crop_img.save(tmp)
                try:
                    t = await asyncio.to_thread(
                        svc_free.chat,
                        "识别这张图里的这一行文字，只输出文字本身，不要任何解释、不要加行号。",
                        image_paths=[tmp], max_tokens=100,
                        model_override=MULTIMODAL_MODEL, disable_thinking=True,
                    )
                    return (t or "").strip()
                finally:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass

            # 过滤太矮的行
            rows = []
            for (t, b) in text_rows:
                if b - t < MIN_LINE_H:
                    continue
                rows.append({"top": t, "bottom": b, "title": "", "is_heading": False})

            # 读出每行文本（并发调用，避免逐行串行导致分钟级耗时）
            titles = await asyncio.gather(*[_read_line_text(img, r["top"], r["bottom"]) for r in rows])
            for r, t in zip(rows, titles):
                r["title"] = t

            # 先按汉字题号判定；若无汉字题号，则整页改按其数字题号判定
            headings = [r for r in rows if cn_heading_re.match(r["title"]) or part_heading_re.match(r["title"])]
            if not headings:
                headings = [r for r in rows if digit_heading_re.match(r["title"])]
            for r in rows:
                r["is_heading"] = r in headings
            if not headings:
                return []  # 没识别到任何大题题号 → 不切割（回退整页）

            for hi, h in enumerate(headings):
                top = h["top"]
                if hi + 1 < len(headings):
                    nxt_top = headings[hi + 1]["top"]
                    # 取"下一标题行之上"最后一个非题号内容行的 bottom
                    bottom = next(
                        (r["bottom"] for r in reversed(rows)
                         if r["top"] < nxt_top and not r["is_heading"]
                         and r["bottom"] < nxt_top),
                        h["bottom"],
                    )
                    if bottom > nxt_top:
                        bottom = nxt_top - 2
                else:
                    bottom = oh
                if bottom <= top:
                    continue
                crop = img.crop((0, top, ow, bottom))
                fname = f"crop_{uuid.uuid4().hex}.jpg"
                crop.save(os.path.join(UPLOAD_DATA_DIR, fname), "JPEG", quality=90)
                crops.append({
                    "id": len(crops) + 1,
                    "title": (h["title"] or "")[:40],
                    "image": f"/api/v1/uploads/file/{fname}",
                    "bbox": [0, top, ow, bottom],
                })
        return crops
    except Exception as e:
        logger.warning("区域切割失败（跳过附图）: %s", e)
        return []


async def _ark_extract_text(image_path: str) -> str:
    """Ark 免费多模态识图（失败抛异常，由调用方回退 OCR）；识图前先压缩降 token"""
    svc_free = get_free_llm_service()
    if not svc_free.enabled:
        raise RuntimeError("免费 AI 服务未配置（缺少 ARK_API_KEY）")
    prompt = (
        "你是小学作业题目提取器。图片中可能有一道或多道题目，"
        "必须把图片里的**所有**题目完整、准确地转写为纯文本，一道都不能漏，"
        "保留数字、单位与数量关系。\n"
        "输出格式：每道题以【题N】开头（N=1,2,3…，按图片中的顺序），换行写题目内容，"
        "题与题之间空一行。只输出题目文本本身，不要任何解释、不要解题、不要评论。"
    )
    compressed = _compress_image(image_path)
    return await asyncio.to_thread(
        svc_free.chat, prompt, image_paths=[compressed], max_tokens=4096,
        model_override=MULTIMODAL_MODEL, disable_thinking=True,
    )


# 排版块：LLM 记录图片上的视觉结构（标题/正文/题号/选项/对齐），客户端按此渲染还原排版
_ORDERED_PREFIX = re.compile(
    r"^(?:[（(]?\d+[）).、．]|[①-⑳]|一、|二、|三、|四、|五、|六、|七、|八、|九、|十、|"
    r"[一二三四五六七八九十]+[、.)．]|[◆◇●○□■△▲★☆])"
)


# ── 复杂版面特征检测：表格/方格/序号/特殊符号/下划线/括号 → 走 PP-StructureV3 ──

# 命中规则要精确：只路由真正需要 PP 强排版还原的复杂版面，普通课文/诗歌（含①注脚、
# 书名号/引号等常见标点）不误伤。因此：
#  - ①-⑳ 只有**成排出现**（≥3 个，如 ①②③ 连排）才算序号列表
#  - 括号仅当包含算式/选项（数学题特征）
#  - 菱形/实心方块等图形符号单独出现即命中（课文里罕见，通常是条目符）
#  - 算式（数字×数字 / 数字±数字）、下划线填空、长横线 → 命中
_COMPLEX_NUMERAL_ROW = re.compile(r"[①-⑳].{0,20}[①-⑳].{0,20}[①-⑳]")  # ①②③ 成排序号
_COMPLEX_FORMULA = re.compile(
    r"\d+\s*[×xX÷+－−=＝]\s*\d+|\d+\s*[×xX÷+－−=＝]|"      # 算式
    r"[(（][^（()）]{0,20}[(（]"                              # 多重括号（选项/小题）
    r"|（\s*\d+\s*）"                                        # （数字）题号
)
# 数学应用题特征：数字+单位/量词（数学卷面；语文课文即使有数字也不至于集中出现）
_COMPLEX_MATH = re.compile(
    r"\d+\s*(元|块|个|米|分米|厘米|毫米|千米|千克|克|升|毫升|小时|时|分|秒|页|盒|箱|本|只|辆|条|道|份|人|排|层|名|岁|角|倍)"
)
_COMPLEX_SYMBOL = re.compile(r"[◆◇●○□■△▲★☆►▷]")            # 图形符号/条目符
_COMPLEX_UNDERLINE = re.compile(r"[_＿]{2,}|_{3,}|＿＿{2,}|——{2,}|———")  # 下划线填空/长横线
_COMPLEX_BOX = re.compile(r"\[\s*\]|［\s*］|（\s*）|□\s*$")    # 勾选框/方格
_COMPLEX_TABLE = re.compile(r"[|｜]")                          # 表格竖线


# PP-StructureV3 强项特征：表格/方格/下划线填空/菱形条目符/几何图形符号
# （PP 对线性文字卷面反而会拆散选项/段落粘连，只在真正需要排版还原的场景用它）
_PP_STRENGTH_SYMBOL = re.compile(r"[◆◇●○□■]")
_PP_STRENGTH_GEOMETRY = re.compile(
    r"(三角形|正方形|长方形|圆形|圆柱体|正方体|长方体|梯形|平行四边形|周长|面积|平移|旋转|轴对称|按对称轴|格子图|方格图)"
)


async def _pp_structure_extract(image_path: str) -> tuple[str, list[dict]]:
    """PP-StructureV3 识别：返回 (纯文本, 排版块列表)。

    PP 的 block_order 是物理位置（按列）非阅读顺序，且内容为检测框碎片。
    因此：先按 order 拼原始文本 → 交给 Ark LLM 重新整理阅读顺序/分段 → 输出结构化 blocks。
    失败时退化返回按 order 拼接的原始文本（blocks 为空）。
    """
    from services.pp_structure import get_service as get_pp_service
    service = get_pp_service()
    pages = await service.parse_layout(image_path)
    if not pages:
        return "", []
    texts: list[str] = []
    for page in pages:
        pruned = page.get("pruned_result") or page.get("prunedResult") or {}
        res_list = pruned.get("parsing_res_list") or []
        ordered: list[dict] = []
        for item in res_list:
            content = str(item.get("block_content") or "").strip()
            label = str(item.get("block_label") or "text")
            order = item.get("block_order")
            if label == "image" or not content or order is None:
                continue
            ordered.append({"order": int(order), "content": content})
        ordered.sort(key=lambda x: x["order"])
        texts.append("\n".join(it["content"] for it in ordered))
    raw_text = "\n\n".join(texts).strip()
    if not raw_text:
        return "", []

    # 交给 Ark LLM 整理阅读顺序/分段（用 _deepseek_relayout 的 prompt，走免费通道）
    blocks: list[dict] = []
    try:
        from services.free_llm import get_service as get_free_llm_svc
        free = get_free_llm_svc()
        if free.enabled:
            prompt = DEEPSEEK_RELAYOUT_PROMPT.format(text=raw_text[:8000])
            reply = await asyncio.to_thread(
                free.chat, prompt, "你是一个只输出JSON的小学语文排版整理器。", None, 4096,
                model_override=MULTIMODAL_MODEL, disable_thinking=True,
            )
            blocks = _extract_blocks(reply or "")
    except Exception as e:
        logger.warning("PP 文本整理失败，用原始顺序: %s", e)
        blocks = []

    if blocks:
        cleaned = []
        for b in blocks:
            bt = _clean_ocr_text(b["text"]).strip()
            if not bt:
                continue
            lines = []
            for ln in b.get("lines", []):
                lt = _clean_ocr_text(ln.get("text", "")).strip()
                if lt:
                    lines.append({"text": lt, "indent": ln.get("indent", 0)})
            if not lines:
                lines = [{"text": bt, "indent": 0}]
            if b["type"] == "body" and lines and lines[0].get("indent", 0) == 0:
                lines[0]["indent"] = 1
            cleaned.append({"type": b["type"], "text": bt, "align": b["align"], "lines": lines, "polyphones": b.get("polyphones", {}) or {}})
        _reorder_title_first(cleaned)
        _mark_poetry(cleaned)
        _mark_ordered_indent(cleaned)
        text = "\n\n".join(b["text"] for b in cleaned).strip()
        return text or raw_text, cleaned

    # LLM 整理失败：返回按 order 拼接的原始文本（blocks 为空，前端走纯文本展示）
    return raw_text, []


DEEPSEEK_RELAYOUT_PROMPT = """你是小学语文排版整理器。下面是一段从课本照片识别出来的文字（可能含乱码残留、重复行、段落粘连）。
请把它整理成清晰的课文结构，输出 JSON（不要 markdown 包裹）：
1) **修复**：纠正明显的乱码/错字（如把被误识别的字符还原）；删除`内容完全重复且明显是识别错误产生的重复行`（如整行被输出两遍），但**真实课文中本就重复的行保留，不得为了去重而删行**。
2) **分段**：按内容把文字拆成若干段落块（每个自然段/独立内容一个块）：
   - 大标题 → type=title
   - 小标题/单元名/页眉/页码 → type=heading
   - 题目（含题号） → type=question
   - 选项行 → type=option
   - 正文段落 → type=body
   - 旁批/注脚/提示/贴士 → type=note
3) **逐行保真（最重要）**：图片上是一行，lines 里就是一条 text，一条 line 对应图上的一行，**禁止把两行合并成一行、禁止把一行拆成两行、禁止删行**；每条 line 的 text 内容 = 图上该行原样（含该行所有汉字、拼音、标点、下划线、空格位置）。lines 按原图从上到下顺序输出，不要重排。
   正文 body 块首行 indent=1（首行空两格），续行 indent=0；其余类型 indent=0。
4) align：大标题 center，页码 right，正文 left。
5) **多音字注音（polyphones）**：块内出现读错会明显的多音字，在 polyphones 里给出语境下正确的带声调拼音
   （如「还:hái」「着:zhe」「长:cháng」「地:dì」）；只标确定的多音字，非多音字与不确定的不标；
   没有多音字的块 polyphones 留空。
输出格式：{{"blocks":[{{"type":"title|heading|body|question|option|note","text":"...","align":"left|center|right","lines":[{{"text":"行","indent":0}}],"polyphones":{{"字":"带声调拼音"}}}}]}}
只输出 JSON，不要解释。
文本：{text}"""


# 用户实测最优的 OCR 提示词：豆包「严格原样排版」（纯文本输出，不做题/不解释）。
# 排版保真度高于旧版 JSON 排版提示词（实测）；结构化 blocks 交给 _deepseek_relayout 整理。
DOUBAO_OCR_PROMPT = """任务：图片文字逐行保真转录（每一行与图片一致）
【第一步·先看整体】先判断图片方向：横放/倒置/倾斜先在脑中纠正到正向，再按正向读（不要按颠倒顺序读）。

【核心硬性规则——逐行保真】
1. 图片上有几行文字，你就输出几行；【每一行都单独占一行输出】。
2. 禁止合并行：图片上两行就是两行，绝不能并成一行；禁止拆分行：一行就是一行，不能拆成两行。
3. 每行的字符数必须与图片上那一行严格一致：全部汉字、拼音字母、声调、标点、括号、数字、下划线_______、√、①等，一个不漏，也不得多字。宁可模糊也按原样抄，不脑补、不改写、不加字。
4. 空白的填空横线按原样输出下划线________（几格就几个下划线），保留该行空格位置。

【拼音与汉字】
5. 汉字上方的注音拼音【必须逐行转写】，拼音行和汉字行各自独立成行、各自行内字符数与图一致。如拼音在上、汉字在下就是两行，顺序不变。

【排版与范围】
6. 缩进/居中对齐尽量保留（可用每行前的空格表达相对缩进）。
7. 只输出识别的文本本身，不要任何解释、不要做题、不要加"识别结果："之类前缀。

【最后自检】输出前，数一遍：你输出的总行数是否等于图片上的总行数？是否每行字数都与图上一致？发现不一致就修正后再输出。"""

# 表格专用 OCR 提示词：检测到图片含表格时使用，强化 markdown 表格还原（跨行/跨列合并、文字原样、不多余文字）
DOUBAO_TABLE_OCR_PROMPT = """任务：识别图片内容，文字与表格混排时分别还原。文字照常按阅读顺序输出；**表格部分单独用 HTML <table> 输出**，且要还原跨行/跨列合并。
0、先判断图片方向：横放/倒置请先在脑中纠正到正向再读。
输出规则：
1. 图片里的普通文字（标题、段落、题目、说明）按原顺序正常输出，换行分段尽量还原，不额外解释、不做题。
2. 图片里遇到的**表格**：单独输出一段 HTML <table>，放在该表格对应文字位置，且：
   - 用 <table> <tr> <td>/<th> 组织，每行的列数要一致（列数=图片最细列数）
   - **跨行合并**用 rowspan，**跨列合并**用 colspan（如 表头“音序查字法”跨2列 → <th colspan="2">）
   - 两行表头也两行输出（大表头 + 子表头子列），子表头挂在对应大表头列下
   - 文字100%原样，不删减选项/括号/√/①②③
3. 一张图里可能没有表格（纯文字），或既有文字又有表格——按图片实际来，没表格就不要输出 <table>。
4. 除表格用 HTML 外，其余文字直接用文本输出，不要把所有内容包在 HTML 里。
不要额外解释，只输出识别内容。"""


def _deepseek_relayout(text: str) -> list[dict]:
    """deepseek 兜底排版：把豆包识别的原始文本（去乱码/去重后）整理成 blocks JSON。
    返回 blocks 列表；失败返回空列表。"""
    try:
        prompt = DEEPSEEK_RELAYOUT_PROMPT.format(text=text[:8000])
        reply = svc.chat("你是一个只输出JSON的小学语文排版整理器。", prompt, 4096, "ai_chinese_relayout", disable_thinking=True)
    except BudgetExceededError:
        raise
    blocks = _extract_blocks(reply or "")
    if not blocks:
        return []
    # 复用清洗：去残留标记 + 段落首行缩进兜底
    cleaned = []
    for b in blocks:
        bt = _clean_ocr_text(b["text"]).strip()
        if not bt:
            continue
        lines = []
        for ln in b.get("lines", []):
            lt = _clean_ocr_text(ln.get("text", "")).strip()
            if lt:
                lines.append({"text": lt, "indent": ln.get("indent", 0)})
        if not lines:
            lines = [{"text": bt, "indent": 0}]
        if b["type"] == "body" and lines and lines[0].get("indent", 0) == 0:
            lines[0]["indent"] = 1
        cleaned.append({"type": b["type"], "text": bt, "align": b["align"], "lines": lines, "polyphones": b.get("polyphones", {}) or {}})
    _mark_poetry(cleaned)
    _mark_ordered_indent(cleaned)
    return cleaned


async def _ark_extract_blocks(image_path: str, is_table: bool = False) -> tuple[str, list[dict], dict | None]:
    """豆包识图（严格原样排版提示词）+ deepseek 排版：返回 (纯文本, 排版块列表)。
    排版整理失败时退化为纯文本（blocks 为空）。is_table=True 时使用表格专用提示词。"""
    svc_free = get_free_llm_service()
    if not svc_free.enabled:
        raise RuntimeError("免费 AI 服务未配置（缺少 ARK_API_KEY）")
    # 逐行保真需要看清小字/拼音/下划线 —— 用更高的识别分辨率（而不是普通识图 800px）
    compressed = _compress_image_for_regions(image_path)
    prompt = DOUBAO_TABLE_OCR_PROMPT if is_table else DOUBAO_OCR_PROMPT
    reply = await asyncio.to_thread(
        svc_free.chat, prompt, image_paths=[compressed], max_tokens=4096,
        model_override=MULTIMODAL_MODEL, disable_thinking=True,
    )
    # 豆包纯文本 OCR 结果 → 交给 Ark 免费 LLM（doubao-seed-2-1-turbo-260628）整理为结构化 blocks
    # （前端逐字点读/块级评测用）；免费排版失败再兜底付费 deepseek（有预算守卫）。
    raw_text = _clean_ocr_text(reply or "").strip()
    raw_text = _dedupe_lines(raw_text).strip()
    if not raw_text:
        return "", [], None

    # 表格模式：从 OCR 结果提取 <table>…</table> 作为 table 块，其余文字占位后 relayout，保持顺序
    tables: list[str] = []
    if is_table:
        raw_text, tables = _extract_html_tables(raw_text)
    text = raw_text

    try:
        from services.free_llm import get_service as get_free_llm_svc
        free = get_free_llm_svc()
        if free.enabled:
            prompt = DEEPSEEK_RELAYOUT_PROMPT.format(text=text[:8000])
            relayout_reply = await asyncio.to_thread(
                free.chat, prompt, "你是一个只输出JSON的小学语文排版整理器。", None, 4096,
                model_override=MULTIMODAL_MODEL, disable_thinking=True,
            )
            ds_blocks = _merge_table_blocks(_extract_blocks(relayout_reply or ""), tables)
            if ds_blocks:
                return text, ds_blocks, None
    except Exception as e:
        logger.warning("豆包 OCR 免费排版失败，改走 deepseek 兜底: %s", e)
    try:
        ds_blocks = _merge_table_blocks(_deepseek_relayout(text), tables)
        if ds_blocks:
            return text, ds_blocks, None
    except BudgetExceededError:
        raise
    except Exception as e:
        logger.warning("deepseek 排版兜底失败，用纯文本: %s", e)
    # 兜底：表格块在前 + 剩余文字作为一个 body
    if tables:
        out = [{"type": "table", "text": t, "align": "left", "lines": [{"text": t, "indent": 0}], "polyphones": {}} for t in tables]
        pure = raw_text.strip()
        if pure:
            out.append({"type": "body", "text": pure, "align": "left", "lines": [{"text": pure, "indent": 0}], "polyphones": {}})
        return text, out, None
    return text, [], None


async def _ocr_fallback(image_path: str) -> str:
    """回退路径：EasyOCR 通用识别"""
    from routes.uploads import _recognize_sync

    return await asyncio.to_thread(_recognize_sync, image_path)


@router.post("/ai-chinese/parse-image", response_model=ParseImageResponse)
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
            cached_text = _clean_ocr_text(_recover_text_from_json(str(cached.get("text", "")))).strip()
            cached_text = _dedupe_lines(cached_text).strip()
            cached_qs = [str(q) for q in cached.get("questions", []) if q]
            return ParseImageResponse(
                text=cached_text,
                questions=cached_qs if cached_qs else ([cached_text] if cached_text else []),
                blocks=[TextBlock(**b) for b in cached.get("blocks", []) if isinstance(b, dict)],
                page_bounds=PageBounds(**cached["page_bounds"]) if cached.get("page_bounds") else None,
                crops=[CropItem(**c) for c in (cached.get("crops") or []) if isinstance(c, dict)],
            )

    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(IMAGE_DIR, fname)
    with open(path, "wb") as f:
        f.write(data)
    # 图片方向自动校正（EXIF Orientation → 旋转像素为正向），避免手机横/倒图导致识图错乱
    path = await asyncio.to_thread(_auto_orient, path)

    # 预分类：截图先裁剪 UI 残留（去浏览器/手机状态栏干扰）
    cls = None
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
    blocks: list[dict] = []
    page_bounds: dict | None = None
    ark_err: str | None = None
    ocr_err: str | None = None
    t_start = __import__("time").monotonic()
    try:
        is_table = bool(cls and getattr(cls, "has_table", False))
        t_ark = __import__("time").monotonic()
        text, blocks, page_bounds = await _ark_extract_blocks(path, is_table=is_table)
        logger.info("Ark 识图耗时 %.2fs, 文本长度 %d", __import__("time").monotonic() - t_ark, len(text or ""))
    except Exception as e:
        ark_err = f"{type(e).__name__}: {e}"
        logger.warning("Ark 识图失败，回退 OCR: %s", ark_err)
        try:
            t_ocr = __import__("time").monotonic()
            text = await _ocr_fallback(path)
            logger.info("OCR 回退耗时 %.2fs, 文本长度 %d", __import__("time").monotonic() - t_ocr, len(text or ""))
        except Exception as e2:
            ocr_err = f"{type(e2).__name__}: {e2}"
            logger.warning("OCR 回退也失败: %s", ocr_err)

    # PP-StructureV3 路由已停用（实测效果不佳，用户确认先不用 PaddleOCR 服务）
    text = _clean_ocr_text(text or "").strip()
    text = _recover_text_from_json(text).strip()
    if not text:
        diag = "豆包识图:" + (ark_err or "成功但无文本") + " | OCR回退:" + (ocr_err or "成功但无文本")
        logger.error("parse-image 识别失败 [%s] 总耗时 %.2fs 图=%s", diag, __import__("time").monotonic() - t_start, os.path.basename(path))
        detail = "图片识别失败（诊断：" + diag + "）"
        raise HTTPException(status_code=422, detail=detail)
    questions = _split_questions(text)
    logger.info("parse-image 识别到 %d 道题", len(questions))
    # 页面区域裁剪（Vision 检测 bbox → 裁剪每区小图，供前端附图对照）
    crops = []
    try:
        crops = await _detect_regions(path, bool(cls and getattr(cls, "has_table", False)))
    except Exception as e:
        logger.warning("区域裁剪失败（跳过附图）: %s", e)
    _write_cache(cache_file, {"text": text, "questions": questions, "blocks": blocks, "page_bounds": page_bounds, "crops": crops})
    return ParseImageResponse(
        text=text,
        questions=questions,
        blocks=[TextBlock(**b) for b in blocks],
        page_bounds=PageBounds(**page_bounds) if page_bounds else None,
        crops=[CropItem(**c) for c in crops],
    )


# ── 关键信息标注：本地切分句子 + LLM 标注 ──

# ── 语文好词好句标注（依据本年级学习重点） ──

CHINESE_HIGHLIGHT_PROMPT = """你是小学语文老师。下面是一篇课文/短文。请依据【{grade}】年级语文学习重点，标注值得学习的：
1) words：好词（值得积累的词语/成语，如四字词语、优美动词形容词；需是文中出现的原词）
2) sentences：好句（优美、有修辞、值得仿写或背诵的句子；按文中完整句原文）
每个词/句给出简短理由（10 字内）。
只输出 JSON（不要 markdown 包裹）：{{"words":[{{"text":"词语","reason":"理由"}}],"sentences":[{{"text":"完整句子","reason":"理由"}}]}}
文本：{text}"""


class ChineseHighlightRequest(BaseModel):
    text: str = ""


class ChineseHighlightItem(BaseModel):
    text: str = ""
    reason: str = ""


class ChineseHighlightResponse(BaseModel):
    words: list[ChineseHighlightItem] = []
    sentences: list[ChineseHighlightItem] = []


@router.post("/ai-chinese/highlight", response_model=ChineseHighlightResponse)
async def chinese_highlight(req: ChineseHighlightRequest, user=Depends(get_current_user)):
    """语文好词好句标注：LLM 按学生本年级学习重点，标出文中好词/好句。"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    if len(text) > MAX_QUESTION_LEN:
        raise HTTPException(status_code=422, detail="文本过长")
    grade = (user.grade or "").strip() or "三年级"
    prompt = CHINESE_HIGHLIGHT_PROMPT.format(grade=grade, text=text)
    try:
        reply = svc.chat("你是一个只输出JSON的小学语文老师。", prompt, 2048, "ai_chinese_highlight", disable_thinking=True)
    except BudgetExceededError:
        raise
    words: list[ChineseHighlightItem] = []
    sentences: list[ChineseHighlightItem] = []
    try:
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        data = json.loads(_c)
        if isinstance(data, dict):
            for w in data.get("words", []) or []:
                if isinstance(w, dict) and str(w.get("text", "") or "").strip():
                    words.append(ChineseHighlightItem(text=str(w["text"]).strip(), reason=str(w.get("reason", "") or "").strip()))
            for s in data.get("sentences", []) or []:
                if isinstance(s, dict) and str(s.get("text", "") or "").strip():
                    sentences.append(ChineseHighlightItem(text=str(s["text"]).strip(), reason=str(s.get("reason", "") or "").strip()))
    except (json.JSONDecodeError, TypeError):
        logger.warning("好词好句解析失败: %s", reply[:200])
    return ChineseHighlightResponse(words=words[:20], sentences=sentences[:8])


# ── 多音字标注：识别后独立调用，可靠返回多音字 → 正确拼音（用于 TTS 发音） ──

CHINESE_POLYPHONES_PROMPT = """你是小学语文老师。下面是一段课文/题目文本。请找出其中**每个多音字**在当前句子中的**正确读音**。
规则：
1) 只标注**多音字**（有两个或以上读音的字），非多音字不要标；
2) 读音必须是该字在**当前上下文**中的正确读音，带声调（如 行在"行动"中读 xíng、在"银行"中读 háng；地在"土地"中读 dì、在"轻轻地"中读 de；着重读 zhuó、重读 chóng 等）；
3) 同一个字在同一段里不同位置读音不同，也要分别标注（用该字 + 所在词，如 "音乐":"yuè"、"快乐":"lè"）。
只输出 JSON（不要 markdown 包裹）：{{"polyphones":{{"字":"拼音"}}}}
文本：{text}"""


class ChinesePolyphonesRequest(BaseModel):
    text: str = ""


class ChinesePolyphonesResponse(BaseModel):
    polyphones: dict[str, str] = {}


@router.post("/ai-chinese/polyphones", response_model=ChinesePolyphonesResponse)
async def chinese_polyphones(req: ChinesePolyphonesRequest, user=Depends(get_current_user)):
    """多音字标注：LLM 专注找多音字并给出当前上下文正确拼音，供 TTS 逐字点读注音。"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    if len(text) > MAX_QUESTION_LEN:
        raise HTTPException(status_code=422, detail="文本过长")
    prompt = CHINESE_POLYPHONES_PROMPT.format(text=text)
    try:
        reply = svc.chat("你是一个只输出JSON的小学语文老师。", prompt, 1024, "ai_chinese_polyphones", disable_thinking=True)
    except BudgetExceededError:
        raise
    result: dict[str, str] = {}
    try:
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        data = json.loads(_c)
        if isinstance(data, dict):
            p = data.get("polyphones", {}) or {}
            if isinstance(p, dict):
                for k, v in p.items():
                    ks = str(k or "").strip()
                    vs = str(v or "").strip()
                    if ks and len(ks) == 1 and vs:
                        result[ks] = vs
    except (json.JSONDecodeError, TypeError):
        logger.warning("多音字标注解析失败: %s", (reply or "")[:200])
    return ChinesePolyphonesResponse(polyphones=result)


# ── 段落高亮标注：识别文本解析时按学习重点做高亮（核心句/优美词句/重点词）+ 学习提示 ──

HIGHLIGHT_MARK_PROMPT = """任务：对下面小学语文段落做高亮标注，适配三年级、注意力容易分散的学生。硬性规则
1.原文完整保留，一个字都不改。
2.标记总量严格控制：单段最多3处高亮，宁可少标，绝不整段铺满标记。
3.标记分类（只用加粗，避免过多彩色造成视觉疲劳）：
   - core（核心句）：段落主旨、总起句、总结句
   - beautiful（优美词句）：景物描写、动作神态、比喻拟人等修辞
   - word（重点词）：生字、高频好词，可以摘抄积累
4.禁止连续大面积标记，两处高亮之间必须保留至少5个普通汉字。
5.每处高亮给一句非常简短、口语化的理由，告诉孩子为什么值得重点看，不用专业术语。
输出 JSON（不要 markdown 包裹）：
{{"text":"原文完整文本（一字不改）","highlights":[{{"type":"core|beautiful|word","phrase":"必须是原文中的连续子串","reason":"口语化简短理由"}}],"tip":"整段【学习提示】，口语化、简短，解释每处为什么值得看"}}
段落：
{text}"""


class HighlightMarkRequest(BaseModel):
    text: str = ""


class HighlightMarkItem(BaseModel):
    type: str = "word"  # core / beautiful / word
    phrase: str = ""
    reason: str = ""


class HighlightMarkResponse(BaseModel):
    text: str = ""  # 原文（一字不改）
    highlights: list[HighlightMarkItem] = []
    tip: str = ""


@router.post("/ai-chinese/highlight-mark", response_model=HighlightMarkResponse)
async def chinese_highlight_mark(req: HighlightMarkRequest, user=Depends(get_current_user)):
    """段落高亮解析：LLM 按学习重点标注核心句/优美词句/重点词，附口语化学习提示。

    原文一律以请求文本为准（一字不改），LLM 返回的 phrase 只有是原文连续子串才采纳。
    """
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    if len(text) > MAX_QUESTION_LEN:
        raise HTTPException(status_code=422, detail="文本过长")
    prompt = HIGHLIGHT_MARK_PROMPT.format(text=text[:4000])
    try:
        reply = svc.chat("你是一个只输出JSON的小学语文老师。", prompt, 2048, "ai_chinese_highlight_mark", disable_thinking=True)
    except BudgetExceededError:
        raise
    highlights: list[dict] = []
    tip = ""
    try:
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        data = json.loads(_c)
        if isinstance(data, dict):
            tip = str(data.get("tip") or "").strip()
            for h in (data.get("highlights") or [])[:3]:
                if not isinstance(h, dict):
                    continue
                ph = str(h.get("phrase") or "").strip()
                ht = str(h.get("type") or "word").strip()
                if ht not in {"core", "beautiful", "word"}:
                    ht = "word"
                reason = str(h.get("reason") or "").strip()
                if ph and ph in text:
                    highlights.append({"type": ht, "phrase": ph, "reason": reason})
    except (json.JSONDecodeError, TypeError):
        logger.warning("高亮标注解析失败: %s", (reply or "")[:200])
    items = [HighlightMarkItem(**h) for h in highlights[:3]]
    return HighlightMarkResponse(text=text, highlights=items, tip=tip[:300])


# ── 语文页分类归档 + 查询（单元/课文/类型/页码/知识点/题型） ──

CHINESE_CLASSIFY_PROMPT = """你是小学语文教研员。下面是从语文课本/练习册拍摄页面识别的文本。
请判断并输出：
1) unit：属于哪个单元（如"第一单元"；从课文内容推断，不确定填"未分类"）
2) lesson：对应的课文标题（如"《大青树下的小学》"；不属于单篇课文则空字符串）
3) category：页面类型，**必须**是以下之一：单元知识清单 / 写作指导 / 单元学习任务 / 课文作业 / 语文园地 / 习作 / 识字加油站 / 口语交际 / 阅读 / 单元页
4) page_types：**该页出现的所有板块标记列表**（可多个，按出现顺序），从以下枚举选：课文正文 / 课后练习 / 生字表 / 词语表 / 语文园地 / 交流平台 / 日积月累 / 口语交际 / 识字加油站 / 词句段运用 / 书写提示 / 梳理与交流 / 背诵 / 默写 / 阅读 / 习作 / 单元页 / 目录 / 其他。
   注意：一页语文园地可能同时包含"词句段运用"和"日积月累"等多个板块，**全部列出**；只要页面中出现了"日积月累""词句段运用""书写提示"等关键词，就一定要纳入对应标记。
5) page：页码（从文本中找"第N页"/页脚角标；找不到留空字符串）
6) knowledge_points：知识点列表（3~8 个，如"读准字音""多音字""形近字""成语积累""词语搭配""标重音""古诗背诵""标点符号""写作结构"）
7) question_types：这页的考题方式/题型列表（3~8 个，如"成语填空""选词填空""给句子标重音""补全古诗""形近字组词""看拼音写词语""仿写句子"）

只输出 JSON（不要 markdown 包裹）：{{"unit":"..","lesson":"..","category":"..","page_types":["..",".."],"page":"..","knowledge_points":[".."],"question_types":[".."]}}
文本：{text}"""


class ChineseClassifyRequest(BaseModel):
    text: str = ""


class ChineseClassifyResponse(BaseModel):
    unit: str = ""
    lesson: str = ""
    category: str = ""
    page_types: list[str] = []
    page: str = ""
    knowledge_points: list[str] = []
    question_types: list[str] = []


@router.post("/ai-chinese/classify", response_model=ChineseClassifyResponse)
async def chinese_classify(req: ChineseClassifyRequest, user=Depends(get_current_user)):
    """语文页结构化分类：单元 / 课文 / 类型 / 页码 / 知识点 / 考题方式。"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    prompt = CHINESE_CLASSIFY_PROMPT.format(text=text[:3000])
    try:
        reply = svc.chat("你是一个只输出JSON的小学语文教研员。", prompt, 2048, "ai_chinese_classify", disable_thinking=True)
    except BudgetExceededError:
        raise
    data: dict = {}
    try:
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        data = json.loads(_c) if isinstance(json.loads(_c), dict) else {}
    except (json.JSONDecodeError, TypeError):
        logger.warning("语文分类解析失败: %s", (reply or "")[:200])
    def _list(key):
        v = data.get(key, []) or []
        return [str(x).strip() for x in v if isinstance(x, str) and str(x).strip()][:10]
    return ChineseClassifyResponse(
        unit=str(data.get("unit", "") or "").strip() or "未分类",
        lesson=str(data.get("lesson", "") or "").strip(),
        category=str(data.get("category", "") or "").strip(),
        page_types=_list("page_types"),
        page=str(data.get("page", "") or "").strip(),
        knowledge_points=_list("knowledge_points"),
        question_types=_list("question_types"),
    )


@router.get("/ai-chinese/units", response_model=list)
async def chinese_units(
    unit: str = "",
    lesson: str = "",
    category: str = "",
    q: str = "",
    limit: int = 200,
    user=Depends(get_current_user),
):
    """语文知识索引查询：按单元/课文/类型/关键词过滤，供客户端与 LLM 查询。"""
    from sqlalchemy import select
    async with async_session() as s:
        stmt = select(ChineseUnitKnowledgeRow).order_by(ChineseUnitKnowledgeRow.id.desc())
        if unit:
            stmt = stmt.where(ChineseUnitKnowledgeRow.unit == unit)
        if lesson:
            stmt = stmt.where(ChineseUnitKnowledgeRow.lesson == lesson)
        if category:
            stmt = stmt.where(ChineseUnitKnowledgeRow.category == category)
        if q:
            stmt = stmt.where(ChineseUnitKnowledgeRow.content.contains(q))
        stmt = stmt.limit(min(limit, 500))
        rows = (await s.execute(stmt)).scalars().all()
    def _load(j):
        try:
            return json.loads(j or "[]")
        except Exception:
            return []
    return [{
        "id": r.id, "unit": r.unit, "lesson": r.lesson, "category": r.category,
        "page": r.page, "content": r.content[:2000],
        "knowledge_points": _load(r.knowledge_points),
        "question_types": _load(r.question_types),
        "image_path": r.image_path or "",
    } for r in rows]


# ── 阅读理解题目提取 + 索引查询 ──

CHINESE_READING_PROMPT = """你是小学语文教研员。下面是一页语文练习/试卷的识别文本。请提取其中所有的【阅读理解】题目（短文阅读大题）。
输出 JSON：{{"items":[{{"passage":"短文原文（若该题带短文；没有短文则空字符串）","question":"题目完整文本（含所有小题）","type":"题型归类，必须是以下之一：概括主要内容/理解词句/修辞手法/信息提取/字词理解/拓展运用/其他","answer":"参考答案（简短，供讲解使用；拿不准留空）"}}]}}
如果没有阅读理解题，输出 {{"items":[]}}
文本：{text}"""


@router.get("/ai-chinese/recitations", response_model=list)
async def chinese_recitations(
    unit: str = "",
    kind: str = "",
    q: str = "",
    limit: int = 100,
    user=Depends(get_current_user),
):
    """背诵索引查询：日积月累/读读背背的古诗、名言警句，按单元·类型·关键词过滤。"""
    from sqlalchemy import select
    async with async_session() as s:
        stmt = select(ChineseRecitationItemRow).order_by(ChineseRecitationItemRow.id.asc())
        if unit:
            stmt = stmt.where(ChineseRecitationItemRow.unit == unit)
        if kind:
            stmt = stmt.where(ChineseRecitationItemRow.kind == kind)
        if q:
            stmt = stmt.where(ChineseRecitationItemRow.content.contains(q) | ChineseRecitationItemRow.title.contains(q))
        stmt = stmt.limit(min(limit, 500))
        rows = (await s.execute(stmt)).scalars().all()
    return [{
        "id": r.id, "unit": r.unit, "title": r.title, "author": r.author,
        "kind": r.kind, "content": r.content, "source_ref": r.source_ref,
        "page": r.page, "image_path": r.image_path,
    } for r in rows]


# ── 拼音练习关卡：从课文/单元知识清单提取词语+拼音，供拼音评测（SOE eval_mode=8） ──

CHINESE_PINYIN_LEVEL_PROMPT = """你是小学语文老师。下面是从课本/单元知识清单提取的汉字与拼音资料（含"诵（sòng）"这类注音、课文原文、词语表）。
请从中选出 {count} 个适合拼音朗读练习的**双字词**（也可含单个难读字），输出 JSON（不要 markdown 包裹）：
{{"words":[{{"hanzi":"词语汉字","pinyin":"完整带声调拼音，如 niú nǎi"}}]}}
要求：
1) 每个词的拼音要**逐字、完整、带声调**（如 凉爽→liáng shuǎng、绒球→róng qiú）；
2) 优先选学生刚学过的生字词，声调要准确；
3) 共 {count} 个词，不重复。
资料：{materials}"""


class PinyinLevelRequest(BaseModel):
    unit: str = ""       # 指定单元（可选）
    count: int = 5       # 本关词数（SOE 拼音模式 ≤30 个拼音，默认 5 词=~10 拼音）


class PinyinPart(BaseModel):
    """一个拼音音节的组成部分（声母/介母/韵母；整体认读音节整体一项）"""
    text: str = ""       # 如 "sh" / "ī" / "r" / "ùn"
    label: str = ""      # shengmu / jiemu / yunmu / zhengtiren
    audio: str = ""      # 对应音频文件路径（如 声母/sh.mp3），用于单独发音


class PinyinWord(BaseModel):
    hanzi: str = ""
    pinyin: str = ""     # 完整带声调拼音（空格分隔每个字）
    parts: list[PinyinPart] = []  # 拆分：按声母/介母/韵母/整体认读音节


class PinyinLevelResponse(BaseModel):
    unit: str = ""
    words: list[PinyinWord] = []


# 声母、介母、韵母、整体认读音节
_SHENGMU = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"]
_JIEMU = ["i", "u", "ü"]
_ZHENGTI = ["zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"]

# 韵母 → 声调音频目录
_DANYUN = {"a", "e", "i", "o", "u", "v"}  # 单韵母（v=ü）
_FUYUN = {"ai", "ei", "ao", "ou", "ie", "iu", "er"}  # 复韵母
_BIYUN = {"an", "en", "in", "ang", "eng", "ing", "ong"}  # 鼻韵母
_TEYUN = {"ian", "uan"}  # 特殊韵母
_TONE_NUM = {"ā": "1", "á": "2", "ǎ": "3", "à": "4",
             "ē": "1", "é": "2", "ě": "3", "è": "4",
             "ī": "1", "í": "2", "ǐ": "3", "ì": "4",
             "ō": "1", "ó": "2", "ǒ": "3", "ò": "4",
             "ū": "1", "ú": "2", "ǔ": "3", "ù": "4",
             "ǖ": "1", "ǘ": "2", "ǚ": "3", "ǜ": "4"}


def _strip_tone(s: str) -> str:
    """去掉声调符号返回无声调拼音（ü→v 以匹配音频文件名）"""
    return (s.replace("ā", "a").replace("á", "a").replace("ǎ", "a").replace("à", "a")
             .replace("ē", "e").replace("é", "e").replace("ě", "e").replace("è", "e")
             .replace("ī", "i").replace("í", "i").replace("ǐ", "i").replace("ì", "i")
             .replace("ō", "o").replace("ó", "o").replace("ǒ", "o").replace("ò", "o")
             .replace("ū", "u").replace("ú", "u").replace("ǔ", "u").replace("ù", "u")
             .replace("ǖ", "v").replace("ǘ", "v").replace("ǚ", "v").replace("ǜ", "v"))


def _tone_of(s: str) -> int:
    """返回音节声调（1-4，轻声/无调 0）"""
    for ch in s:
        if ch in _TONE_NUM:
            return int(_TONE_NUM[ch])
    return 0


def _yunmu_audio(yunmu_text: str) -> str:
    """韵母部件 → 音频文件路径（带声调用声调目录，否则韵母目录）"""
    base = _strip_tone(yunmu_text)
    tone = _tone_of(yunmu_text)
    if base in _DANYUN:
        return "单韵母声调/%s%d.mp3" % (base, tone) if tone else "韵母/%s.mp3" % base
    if base in _FUYUN:
        return "复韵母声调/%s%d.mp3" % (base, tone) if tone else "韵母/%s.mp3" % base
    if base in _BIYUN:
        return "鼻韵母声调/%s%d.mp3" % (base, tone) if tone else "韵母/%s.mp3" % base
    if base in _TEYUN:
        return "特殊韵母声调/%s%d.mp3" % (base, tone) if tone else "韵母/%s.mp3" % base
    return "韵母/%s.mp3" % base


def _zhengtiren_audio(text: str) -> str:
    """整体认读音节 → 音频（优先带调整体认读声调，否则整体认读音节）"""
    base = _strip_tone(text)
    tone = _tone_of(text)
    return "整体认读声调/%s%d.mp3" % (base, tone) if tone else "整体认读音节/%s.mp3" % base


def _split_syllable(syl: str) -> list[PinyinPart]:
    """拆分单个拼音音节为 声母/介母/韵母 或 整体认读音节，并给出音频路径。"""
    if not syl:
        return []
    no_tone = _strip_tone(syl)
    # 整体认读音节：整体一项
    for z in _ZHENGTI:
        if no_tone == z:
            return [PinyinPart(text=syl, label="zhengtiren", audio=_zhengtiren_audio(syl))]
    # 声母（最长匹配）
    shengmu = ""
    for sm in _SHENGMU:
        if no_tone.startswith(sm) and len(sm) > len(shengmu):
            shengmu = sm
    parts = []
    sm_text = syl[:len(shengmu)] if shengmu else ""
    if sm_text:
        parts.append(PinyinPart(text=sm_text, label="shengmu", audio="声母/%s.mp3" % shengmu))
    # 剩余：介母 + 韵母（仅三拼音节如 iang/uang/üan 拆介母，剩余≥3 字母）
    rest_text = syl[len(shengmu):]
    rest_plain = _strip_tone(rest_text)
    if rest_text and len(rest_plain) >= 3 and rest_plain[0] in _JIEMU:
        jiemu = rest_text[0]
        # 介母单独读其单韵母音（如 u 读 u、i 读 i、ü 读 v）
        jiemu_plain = "v" if rest_plain[0] == "ü" else rest_plain[0]
        parts.append(PinyinPart(text=jiemu, label="jiemu", audio="单韵母声调/%s1.mp3" % jiemu_plain))
        rest_text = rest_text[1:]
        # 韵母部分
        if rest_text:
            parts.append(PinyinPart(text=rest_text, label="yunmu", audio=_yunmu_audio(rest_text)))
    elif rest_text:
        parts.append(PinyinPart(text=rest_text, label="yunmu", audio=_yunmu_audio(rest_text)))
    if not parts:
        parts.append(PinyinPart(text=syl, label="zhengtiren", audio=_zhengtiren_audio(syl)))
    return parts


def _split_pinyin_word(pinyin: str) -> list[PinyinPart]:
    """把整词拼音（空格分隔多个音节）拆成按字顺序的部件列表"""
    out = []
    for syl in pinyin.split():
        out.extend(_split_syllable(syl))
    return out


@router.post("/ai-chinese/pinyin-level", response_model=PinyinLevelResponse)
async def chinese_pinyin_level(req: PinyinLevelRequest, user=Depends(get_current_user)):
    """生成一关拼音练习：从单元知识清单（含字音注音）+ 课文文本中选词，LLM 输出汉字+带声调拼音。"""
    count = min(max(req.count, 1), 8)
    try:
        from sqlalchemy import select
        async with async_session() as s:
            # 单元知识清单（含"诵（sòng）"等注音）优先
            stmt = select(ChineseUnitKnowledgeRow.content).where(ChineseUnitKnowledgeRow.content.isnot(None))
            if req.unit:
                stmt = stmt.where(ChineseUnitKnowledgeRow.unit == req.unit)
            uk_rows = (await s.execute(stmt.limit(12))).scalars().all()
            # 课文正文
            t_stmt = select(ChineseTextbookPageRow.content).where(
                ChineseTextbookPageRow.page_type == "课文正文",
                ChineseTextbookPageRow.content.isnot(None),
            )
            if req.unit:
                t_stmt = t_stmt.where(ChineseTextbookPageRow.unit == req.unit)
            tb_rows = (await s.execute(t_stmt.limit(6))).scalars().all()
    except Exception as e:
        logger.warning("拼音关卡取资料失败: %s", e)
        return PinyinLevelResponse(unit=req.unit, words=[])
    materials = "\n".join([(r or "")[:800] for r in uk_rows] + [(r or "")[:500] for r in tb_rows])
    if len(materials) > 3000:
        materials = materials[:3000]
    if not materials.strip():
        return PinyinLevelResponse(unit=req.unit, words=[])
    prompt = CHINESE_PINYIN_LEVEL_PROMPT.format(count=count, materials=materials)
    try:
        data = _chat_json(
            "你是一个只输出JSON的小学语文老师。", prompt, 1024, "ai_chinese_pinyin_level",
            lambda d: bool(d.get("words")),
        )
    except BudgetExceededError:
        raise
    words = []
    for w in (data.get("words", []) or [])[:count]:
        if isinstance(w, dict):
            hanzi = str(w.get("hanzi", "") or "").strip()
            pinyin = str(w.get("pinyin", "") or "").strip()
            if hanzi and pinyin:
                words.append(PinyinWord(hanzi=hanzi, pinyin=pinyin, parts=_split_pinyin_word(pinyin)))
    return PinyinLevelResponse(unit=req.unit, words=words)


class ChineseReadingExtractRequest(BaseModel):
    text: str = ""


class ChineseReadingItem(BaseModel):
    passage: str = ""
    question: str = ""
    type: str = ""
    answer: str = ""


class ChineseReadingExtractResponse(BaseModel):
    items: list[ChineseReadingItem] = []


@router.post("/ai-chinese/reading-extract", response_model=ChineseReadingExtractResponse)
async def chinese_reading_extract(req: ChineseReadingExtractRequest, user=Depends(get_current_user)):
    """从练习页文本中提取阅读理解题（短文+题目+题型+参考答案）"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    prompt = CHINESE_READING_PROMPT.format(text=text[:4000])
    try:
        data = _chat_json("你是一个只输出JSON的小学语文教研员。", prompt, 2048, "ai_chinese_reading",
                          lambda d: bool(d.get("items")))
    except BudgetExceededError:
        raise
    items: list[ChineseReadingItem] = []
    for it in (data.get("items", []) or []):
        if isinstance(it, dict) and str(it.get("question", "") or "").strip():
                items.append(ChineseReadingItem(
                    passage=str(it.get("passage", "") or "").strip(),
                    question=str(it["question"]).strip(),
                    type=str(it.get("type", "") or "其他").strip(),
                    answer=str(it.get("answer", "") or "").strip(),
                ))
    return ChineseReadingExtractResponse(items=items[:10])


@router.get("/ai-chinese/reading-items", response_model=list)
async def chinese_reading_items(
    unit: str = "",
    lesson: str = "",
    qtype: str = "",
    q: str = "",
    limit: int = 200,
    user=Depends(get_current_user),
):
    """阅读理解题索引查询：按单元/课文/题型/关键词过滤，供客户端与 LLM 查询出题。"""
    from sqlalchemy import select
    async with async_session() as s:
        stmt = select(ChineseReadingItemRow).order_by(ChineseReadingItemRow.id.desc())
        if unit:
            stmt = stmt.where(ChineseReadingItemRow.unit == unit)
        if lesson:
            stmt = stmt.where(ChineseReadingItemRow.lesson == lesson)
        if qtype:
            stmt = stmt.where(ChineseReadingItemRow.question_type == qtype)
        if q:
            stmt = stmt.where(ChineseReadingItemRow.question.contains(q))
        stmt = stmt.limit(min(limit, 500))
        rows = (await s.execute(stmt)).scalars().all()
    return [{
        "id": r.id, "unit": r.unit, "lesson": r.lesson, "category": r.category,
        "page": r.page, "passage": r.passage[:2000], "question": r.question[:2000],
        "question_type": r.question_type, "answer": r.answer[:500],
    } for r in rows]


# ── 题目提取(scanned) + LLM 相似生成(generated) + 索引查询 ──

QUESTION_CATEGORIES = ["字音", "字词书写", "词语运用", "句子", "积累背诵", "阅读理解", "写作表达", "单元任务", "综合"]

CHINESE_QUESTIONS_EXTRACT_PROMPT = """你是小学语文教研员。下面是一页语文练习/试卷的识别文本。请把其中的**每道题目**拆成一条，逐题提取。
输出 JSON：{{"items":[{{"category":"题目类别，必须是以下之一：字音/字词书写/词语运用/句子/积累背诵/阅读理解/写作表达/单元任务/综合","question":"该题的完整题目原文（含小题，尽量完整）","answer":"答案（练习册有答案就抄录；没有就根据题目给出参考答案，拿不准留空）"}}]}}
规则：
- 一个完整大题（如"三、把成语补充完整"含多个小题）算一条，question 含所有小题；
- 没有具体题干的说明文字（如"本单元复习要点"）不提取；
- 阅读理解大题归入"阅读理解"类。
文本：{text}"""

CHINESE_QUESTIONS_GENERATE_PROMPT = """你是小学语文出题老师。请参考下面的【示例题目】和【单元/课文】，出 {count} 道与示例**同类型、同难度**的相似新题（改变内容但不改变题型与结构）。
输出 JSON：{{"items":[{{"category":"{category}","question":"新题目完整原文","answer":"参考答案"}}]}}
要求：
- 题目要具体可作答，面向三年级学生；
- 如果示例含课文内容，新题结合该单元课文；否则用常见生活/课文素材；
- 不要与示例完全相同。
示例题目：
{examples}
单元：{unit}  课文：{lesson}"""


class ChineseQuestionsExtractRequest(BaseModel):
    text: str = ""


class ChineseQuestionData(BaseModel):
    category: str = ""
    question: str = ""
    answer: str = ""


class ChineseQuestionsExtractResponse(BaseModel):
    items: list[ChineseQuestionData] = []


class ChineseQuestionsGenerateRequest(BaseModel):
    category: str = "字音"
    examples: list[str] = []  # 同类别示例题（真实题）
    unit: str = ""
    lesson: str = ""
    count: int = 3


@router.post("/ai-chinese/questions-extract", response_model=ChineseQuestionsExtractResponse)
async def chinese_questions_extract(req: ChineseQuestionsExtractRequest, user=Depends(get_current_user)):
    """从练习页文本逐题提取题目（9 类）"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    prompt = CHINESE_QUESTIONS_EXTRACT_PROMPT.format(text=text[:4000])
    try:
        data = _chat_json("你是一个只输出JSON的小学语文教研员。", prompt, 4096, "ai_chinese_qextract",
                          lambda d: bool(d.get("items")))
    except BudgetExceededError:
        raise
    items: list[ChineseQuestionData] = []
    for it in (data.get("items", []) or []):
        if isinstance(it, dict) and str(it.get("question", "") or "").strip():
            cat = str(it.get("category", "") or "综合").strip()
            if cat not in QUESTION_CATEGORIES:
                cat = "综合"
            items.append(ChineseQuestionData(
                category=cat,
                question=str(it["question"]).strip(),
                answer=str(it.get("answer", "") or "").strip(),
            ))
    return ChineseQuestionsExtractResponse(items=items[:20])


@router.post("/ai-chinese/questions-generate", response_model=ChineseQuestionsExtractResponse)
async def chinese_questions_generate(req: ChineseQuestionsGenerateRequest, user=Depends(get_current_user)):
    """LLM 生成相似考题（同题型同难度，内容换新）"""
    examples = [e for e in req.examples if e and e.strip()][:4]
    if not examples:
        raise HTTPException(status_code=422, detail="缺少示例题目")
    count = max(1, min(req.count, 8))
    cat = req.category if req.category in QUESTION_CATEGORIES else "综合"
    prompt = CHINESE_QUESTIONS_GENERATE_PROMPT.format(
        category=cat, count=count, examples="\n".join(examples[:4]),
        unit=req.unit or "（未分类）", lesson=req.lesson or "",
    )
    try:
        reply = svc.chat("你是一个只输出JSON的小学语文出题老师。", prompt, 4096, "ai_chinese_qgen", disable_thinking=True)
    except BudgetExceededError:
        raise
    items: list[ChineseQuestionData] = []
    try:
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        data = json.loads(_c)
        for it in (data.get("items", []) or []) if isinstance(data, dict) else []:
            if isinstance(it, dict) and str(it.get("question", "") or "").strip():
                items.append(ChineseQuestionData(
                    category=cat,
                    question=str(it["question"]).strip(),
                    answer=str(it.get("answer", "") or "").strip(),
                ))
    except (json.JSONDecodeError, TypeError):
        logger.warning("生成题解析失败: %s", (reply or "")[:200])
    return ChineseQuestionsExtractResponse(items=items[:count])


@router.get("/ai-chinese/questions", response_model=list)
async def chinese_questions(
    category: str = "",
    unit: str = "",
    lesson: str = "",
    source: str = "",  # scanned / generated
    q: str = "",
    limit: int = 200,
    user=Depends(get_current_user),
):
    """考题索引查询：按类别/单元/课文/来源/关键词过滤（客户端与 LLM 出题用）"""
    from sqlalchemy import select
    async with async_session() as s:
        stmt = select(ChineseQuestionItemRow).order_by(ChineseQuestionItemRow.id.desc())
        if category:
            stmt = stmt.where(ChineseQuestionItemRow.category == category)
        if unit:
            stmt = stmt.where(ChineseQuestionItemRow.unit == unit)
        if lesson:
            stmt = stmt.where(ChineseQuestionItemRow.lesson == lesson)
        if source:
            stmt = stmt.where(ChineseQuestionItemRow.source == source)
        if q:
            stmt = stmt.where(ChineseQuestionItemRow.question.contains(q))
        stmt = stmt.limit(min(limit, 500))
        rows = (await s.execute(stmt)).scalars().all()
    return [{
        "id": r.id, "category": r.category, "question": r.question[:2000], "answer": r.answer[:500],
        "unit": r.unit, "lesson": r.lesson, "page": r.page, "source": r.source,
    } for r in rows]


# ── 同步作文知识库：范文+讲解页提取与查询 ──

CHINESE_ESSAY_ENRICH_PROMPT = """你是小学作文教研员。下面是一篇三年级同步作文页的识别文本。请提取：
1) model_essay：范文/优秀作文的**正文全文**（如果有完整的学生作文；只有题目和指导没有作文正文则空字符串）
2) good_words：好词好句列表（值得积累的词语和优美句子，各 3~8 条，逐条）
只输出 JSON（不要 markdown 包裹）：{{"model_essay":"..","good_words":[".."]}}
文本：{text}"""

CHINESE_ESSAY_PROMPT = """你是小学作文教研员。下面是从三年级上册【同步作文】指导/范文页识别的文本。请提取关键信息：
1) unit：单元（如"第一单元"；从课文/内容推断，不确定填"未分类"）
2) title：作文题目（如"猜猜他是谁"；找不到留空）
3) topic：写作对象/主题（一句话）
4) requirement：习作要求原文（题目的写作要求，尽量完整）
5) guide：讲解/指导要点列表（如"写作对象：写一个熟悉的同学""注意事项：不能写名字""怎么写作：抓一两个特点"等，逐条）
6) goals：习作目标列表（"我的习作目标"下的条目，逐条）
只输出 JSON（不要 markdown 包裹）：{{"unit":"..","title":"..","topic":"..","requirement":"..","guide":[".."],"goals":[".."]}}
文本：{text}"""


class ChineseEssayExtractRequest(BaseModel):
    text: str = ""


class ChineseEssayEnrichResponse(BaseModel):
    model_essay: str = ""
    good_words: list[str] = []


@router.post("/ai-chinese/essay-enrich", response_model=ChineseEssayEnrichResponse)
async def chinese_essay_enrich(req: ChineseEssayExtractRequest, user=Depends(get_current_user)):
    """作文页补充提取：范文正文 + 好词好句"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    prompt = CHINESE_ESSAY_ENRICH_PROMPT.format(text=text[:4000])
    try:
        reply = svc.chat("你是一个只输出JSON的小学作文教研员。", prompt, 2048, "ai_chinese_essay_enrich", disable_thinking=True)
    except BudgetExceededError:
        raise
    data: dict = {}
    try:
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        parsed = json.loads(_c)
        if isinstance(parsed, dict):
            data = parsed
    except (json.JSONDecodeError, TypeError):
        logger.warning("作文补充解析失败: %s", (reply or "")[:200])
    good = data.get("good_words", []) or []
    return ChineseEssayEnrichResponse(
        model_essay=str(data.get("model_essay", "") or "").strip(),
        good_words=[str(x).strip() for x in good if isinstance(x, str) and str(x).strip()][:10],
    )


class ChineseEssayData(BaseModel):
    unit: str = ""
    title: str = ""
    topic: str = ""
    requirement: str = ""
    guide: list[str] = []
    goals: list[str] = []


@router.post("/ai-chinese/essay-extract", response_model=ChineseEssayData)
async def chinese_essay_extract(req: ChineseEssayExtractRequest, user=Depends(get_current_user)):
    """同步作文页解析：题目/单元/要求/指导要点/习作目标"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    prompt = CHINESE_ESSAY_PROMPT.format(text=text[:4000])
    try:
        data = _chat_json("你是一个只输出JSON的小学作文教研员。", prompt, 2048, "ai_chinese_essay",
                          lambda d: bool(d.get("title") or d.get("requirement") or d.get("guide") or d.get("topic")))
    except BudgetExceededError:
        raise
    def _list(key):
        v = data.get(key, []) or []
        return [str(x).strip() for x in v if isinstance(x, str) and str(x).strip()][:10]
    return ChineseEssayData(
        unit=str(data.get("unit", "") or "").strip() or "未分类",
        title=str(data.get("title", "") or "").strip(),
        topic=str(data.get("topic", "") or "").strip(),
        requirement=str(data.get("requirement", "") or "").strip(),
        guide=_list("guide"),
        goals=_list("goals"),
    )


@router.get("/ai-chinese/essays", response_model=list)
async def chinese_essays(
    unit: str = "",
    title: str = "",
    q: str = "",
    limit: int = 200,
    user=Depends(get_current_user),
):
    """作文知识库查询：按单元/题目/关键词过滤（练习作文时取参考）"""
    from sqlalchemy import select
    async with async_session() as s:
        stmt = select(ChineseEssayKnowledgeRow).order_by(ChineseEssayKnowledgeRow.id.desc())
        if unit:
            stmt = stmt.where(ChineseEssayKnowledgeRow.unit == unit)
        if title:
            stmt = stmt.where(ChineseEssayKnowledgeRow.title == title)
        if q:
            stmt = stmt.where(ChineseEssayKnowledgeRow.content.contains(q))
        stmt = stmt.limit(min(limit, 500))
        rows = (await s.execute(stmt)).scalars().all()
    def _load(j):
        try:
            return json.loads(j or "[]")
        except Exception:
            return []
    return [{
        "id": r.id, "unit": r.unit, "title": r.title, "topic": r.topic,
        "requirement": r.requirement[:2000], "guide": _load(r.guide), "goals": _load(r.goals),
        "page": r.page, "content": r.content[:2000],
        "model_essay": (r.model_essay or "")[:3000], "good_words": _load(r.good_words),
        "image_path": r.image_path or "",
    } for r in rows]


# ── 知识库问答：LLM 决定查哪张表 → 查库 → 综合回答（带来源） ──


# ── 语文课本页：元信息提取 + 查询 ──

def _chat_json(system: str, prompt: str, max_tokens: int, caller: str, parse_fn) -> dict:
    """LLM 输出 JSON + 结构校验；失败或校验不过自动重试一次（Validator 层）"""
    for attempt in (0, 1):
        reply = svc.chat(system, prompt, max_tokens, caller, disable_thinking=True)
        try:
            _c = (reply or "").strip()
            if _c.startswith("```"):
                _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
                _c = re.sub(r"\s*```\s*$", "", _c)
            data = json.loads(_c)
            if isinstance(data, dict) and parse_fn(data):
                return data
            logger.warning("%s 校验不过（attempt=%d）: %s", caller, attempt, (reply or "")[:150])
        except (json.JSONDecodeError, TypeError):
            logger.warning("%s 非 JSON（attempt=%d）: %s", caller, attempt, (reply or "")[:150])
    return {}

CHINESE_TEXTBOOK_PROMPT = """你是小学语文教研员。下面是从【三年级上册语文课本】某一页识别的文本。请提取这页的元信息：
1) page：课本页码（从文本页脚/角标找"第X页"或阿拉伯数字页码；找不到留空）
2) unit：所属单元（如"第一单元"；从课文/内容推断，不确定填"未分类"）
3) lesson：课文标题（如《大青树下的小学》；课文正文页/该课内容页填课文名，非课文页（单元页/语文园地等）留空）
4) page_type：页面类型，**必须**是以下之一：课文正文 / 生字表 / 词语表 / 语文园地 / 口语交际 / 习作 / 单元页 / 目录 / 课后练习 / 其他
5) knowledge_points：这页的知识点（3~8 个，如"多音字""形近字""比喻句""背诵课文"；无则空列表）
只输出 JSON（不要 markdown 包裹）：{{"page":"..","unit":"..","lesson":"..","page_type":"..","knowledge_points":[".."]}}
文本：{text}"""


class ChineseTextbookExtractRequest(BaseModel):
    text: str = ""


class ChineseTextbookData(BaseModel):
    page: str = ""
    unit: str = ""
    lesson: str = ""
    page_type: str = ""
    knowledge_points: list[str] = []


@router.post("/ai-chinese/textbook-extract", response_model=ChineseTextbookData)
async def chinese_textbook_extract(req: ChineseTextbookExtractRequest, user=Depends(get_current_user)):
    """课本页元信息提取：页码/单元/课文/页面类型/知识点"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="文本不能为空")
    prompt = CHINESE_TEXTBOOK_PROMPT.format(text=text[:4000])
    try:
        data = _chat_json("你是一个只输出JSON的小学语文教研员。", prompt, 2048, "ai_chinese_textbook",
                          lambda d: bool(d.get("page_type") or d.get("lesson") or d.get("unit") or d.get("page")))
    except BudgetExceededError:
        raise
    kps = data.get("knowledge_points", []) or []
    return ChineseTextbookData(
        page=str(data.get("page", "") or "").strip(),
        unit=str(data.get("unit", "") or "").strip() or "未分类",
        lesson=str(data.get("lesson", "") or "").strip(),
        page_type=str(data.get("page_type", "") or "其他").strip(),
        knowledge_points=[str(x).strip() for x in kps if isinstance(x, str) and str(x).strip()][:10],
    )


@router.get("/ai-chinese/outline", response_model=dict)
async def chinese_outline(user=Depends(get_current_user)):
    """语文页进入大纲：按 单元→课文→具体条目 组织已入库知识。
    来源合并：课本页(chinese_textbook_pages) + 单元知识/作业/写作指导(chinese_unit_knowledge)。
    未分类单元/课文归入「未分类」。"""
    from sqlalchemy import select
    async with async_session() as s:
        tbs = (await s.execute(
            select(ChineseTextbookPageRow).order_by(ChineseTextbookPageRow.page.asc())
        )).scalars().all()
        uks = (await s.execute(
            select(ChineseUnitKnowledgeRow).order_by(ChineseUnitKnowledgeRow.id.asc())
        )).scalars().all()

    # 单元排序：一~八单元在前，未分类最后
    def _unit_key(u: str):
        u = (u or "").strip()
        order = {"第一单元": 1, "第二单元": 2, "第三单元": 3, "第四单元": 4,
                 "第五单元": 5, "第六单元": 6, "第七单元": 7, "第八单元": 8}
        return order.get(u, 99)

    units: dict[str, dict[str, list[dict]]] = {}  # unit -> lesson -> items

    def _add(unit: str, lesson: str, item: dict):
        unit = (unit or "").strip() or "未分类"
        lesson = (lesson or "").strip() or "（课文未分类）"
        units.setdefault(unit, {}).setdefault(lesson, []).append(item)

    for r in tbs:
        _add(r.unit, r.lesson, {
            "id": r.id, "source": "textbook", "type": r.page_type or "课本",
            "title": f"第{r.page}页 · {r.page_type}" if r.page else (r.page_type or "课本"),
            "snippet": _clean_ocr_text(r.content or "")[:80].replace("\n", " "),
        })
    for r in uks:
        _add(r.unit, r.lesson, {
            "id": r.id, "source": "unit_knowledge", "type": r.category or "知识",
            "title": r.category or "知识",
            "snippet": _clean_ocr_text(r.content or "")[:80].replace("\n", " "),
        })

    result = []
    for unit, lessons in sorted(units.items(), key=lambda kv: (_unit_key(kv[0]), kv[0])):
        lesson_list = []
        for lesson, items in sorted(lessons.items(), key=lambda kv: kv[0]):
            lesson_list.append({"lesson": lesson, "items": items})
        result.append({"unit": unit, "lessons": lesson_list})
    return {"units": result}


@router.get("/ai-chinese/outline-item", response_model=dict)
async def chinese_outline_item(
    source: str = "textbook",
    item_id: int = 0,
    user=Depends(get_current_user),
):
    """大纲某条目的完整内容（含原图路径），供进入复习"""
    from sqlalchemy import select
    if source == "textbook":
        model = ChineseTextbookPageRow
    elif source == "unit_knowledge":
        model = ChineseUnitKnowledgeRow
    else:
        raise HTTPException(status_code=422, detail="未知来源")
    async with async_session() as s:
        row = (await s.execute(select(model).where(model.id == item_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="条目不存在")
    return {
        "source": source,
        "id": row.id,
        "unit": getattr(row, "unit", "") or "",
        "lesson": getattr(row, "lesson", "") or "",
        "type": (getattr(row, "page_type", "") or getattr(row, "category", "")) or "",
        "page": getattr(row, "page", "") or "",
        "content": (getattr(row, "content", "") or "").strip(),
        "image_path": getattr(row, "image_path", "") or "",
    }


@router.get("/ai-chinese/textbook", response_model=list)
async def chinese_textbook(
    page: str = "",
    unit: str = "",
    lesson: str = "",
    ptype: str = "",
    q: str = "",
    limit: int = 200,
    user=Depends(get_current_user),
):
    """课本页查询：按页码/单元/课文/页面类型/关键词过滤"""
    from sqlalchemy import select
    async with async_session() as s:
        stmt = select(ChineseTextbookPageRow).order_by(ChineseTextbookPageRow.page.asc())
        if page:
            stmt = stmt.where(ChineseTextbookPageRow.page == page)
        if unit:
            stmt = stmt.where(ChineseTextbookPageRow.unit == unit)
        if lesson:
            stmt = stmt.where(ChineseTextbookPageRow.lesson.contains(lesson.strip("《》 ")))
        if ptype:
            stmt = stmt.where(ChineseTextbookPageRow.page_type == ptype)
        if q:
            stmt = stmt.where(ChineseTextbookPageRow.content.contains(q))
        stmt = stmt.limit(min(limit, 500))
        rows = (await s.execute(stmt)).scalars().all()
    def _load(j):
        try:
            return json.loads(j or "[]")
        except Exception:
            return []
    return [{
        "id": r.id, "page": r.page, "unit": r.unit, "lesson": r.lesson,
        "page_type": r.page_type, "content": r.content[:2000],
        "knowledge_points": _load(r.knowledge_points),
        "image_path": r.image_path or "",
    } for r in rows]


# ── 课本页码识别：多模态专门找页面角标页码 ──

PAGE_NUMBER_PROMPT = (
    "这张图片是小学语文课本的一页。请找出这一页角落/页脚印刷的页码数字。"
    "只输出数字本身（如 12、34），不要任何其他文字。如果图中没有页码数字，输出 0。"
)


@router.post("/ai-chinese/page-number")
async def chinese_page_number(file: UploadFile = File(...), user=Depends(get_current_user)):
    """识别课本页页码（多模态专门找角标数字）"""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="图片为空")
    fname = f"{uuid.uuid4().hex}.jpg"
    path = os.path.join(IMAGE_DIR, fname)
    with open(path, "wb") as f:
        f.write(data)
    path = await asyncio.to_thread(_auto_orient, path)
    svc_free = get_free_llm_service()
    if not svc_free.enabled:
        raise HTTPException(status_code=503, detail="识图服务未配置")
    try:
        compressed = await asyncio.to_thread(_compress_image, path)
        reply = await asyncio.to_thread(
            svc_free.chat, PAGE_NUMBER_PROMPT, image_paths=[compressed],
            max_tokens=16, model_override=MULTIMODAL_MODEL, disable_thinking=True,
        )
    except Exception as e:
        logger.warning("页码识别失败: %s", e)
        return {"page": ""}
    page = (reply or "").strip()
    if not page.isdigit():
        page = ""
    return {"page": page}


# ── LLM-Wiki 词条：查询 / 人工修正 ──

@router.get("/wiki/pages", response_model=list)
async def wiki_pages(
    ptype: str = "",
    unit: str = "",
    lesson: str = "",
    q: str = "",
    limit: int = 200,
    user=Depends(get_current_user),
):
    """Wiki 词条列表：按类型/单元/课文/关键词过滤"""
    from sqlalchemy import select
    async with async_session() as s:
        stmt = select(WikiPageRow).order_by(WikiPageRow.id.desc())
        if ptype:
            stmt = stmt.where(WikiPageRow.page_type == ptype)
        if unit:
            stmt = stmt.where(WikiPageRow.unit == unit)
        if lesson:
            stmt = stmt.where(WikiPageRow.lesson.contains(lesson.strip("《》 ")))
        if q:
            stmt = stmt.where(WikiPageRow.title.contains(q) | WikiPageRow.content.contains(q))
        stmt = stmt.limit(min(limit, 500))
        rows = (await s.execute(stmt)).scalars().all()
    def _load(j):
        try:
            return json.loads(j or "[]")
        except Exception:
            return []
    return [{
        "id": r.id, "title": r.title, "page_type": r.page_type,
        "content": (r.content or "")[:1500], "unit": r.unit, "lesson": r.lesson,
        "source_ref": r.source_ref, "links": _load(r.links),
    } for r in rows]


@router.get("/wiki/pages/{page_id}", response_model=dict)
async def wiki_page_detail(page_id: int, user=Depends(get_current_user)):
    """Wiki 词条详情（全文 + 关联词条）"""
    from sqlalchemy import select
    async with async_session() as s:
        row = (
            await s.execute(select(WikiPageRow).where(WikiPageRow.id == page_id))
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="词条不存在")
        links = []
        try:
            link_ids = json.loads(row.links or "[]")
        except Exception:
            link_ids = []
        if link_ids:
            link_rows = (await s.execute(select(WikiPageRow).where(WikiPageRow.id.in_(link_ids)))).scalars().all()
            links = [{"id": l.id, "title": l.title, "page_type": l.page_type} for l in link_rows]
    def _load(j):
        try:
            return json.loads(j or "[]")
        except Exception:
            return []
    return {
        "id": row.id, "title": row.title, "page_type": row.page_type,
        "content": row.content, "unit": row.unit, "lesson": row.lesson,
        "source_ref": row.source_ref, "links": links,
    }


class WikiPageUpdateRequest(BaseModel):
    title: str = ""
    content: str = ""
    unit: str = ""
    lesson: str = ""
    links: list[int] = []


@router.put("/wiki/pages/{page_id}", response_model=dict)
async def wiki_page_update(page_id: int, req: WikiPageUpdateRequest, user=Depends(get_current_user)):
    """人工修正词条（OCR 错字 / 错误解析 / 补充内容）"""
    from sqlalchemy import select
    async with async_session() as s:
        row = (
            await s.execute(select(WikiPageRow).where(WikiPageRow.id == page_id))
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="词条不存在")
        if req.title.strip():
            row.title = req.title.strip()
        if req.content.strip():
            row.content = req.content.strip()
        if req.unit.strip():
            row.unit = req.unit.strip()
        if req.lesson.strip():
            row.lesson = req.lesson.strip()
        if req.links:
            row.links = json.dumps([int(x) for x in req.links], ensure_ascii=False)
        await s.commit()
    return {"status": "ok", "id": page_id}


# ── 知识图谱关系 + 全文搜索（FTS5） ──

@router.get("/knowledge/relations", response_model=list)
async def knowledge_relations(
    node_id: int = 0,
    relation: str = "",
    limit: int = 300,
    user=Depends(get_current_user),
):
    """知识关系查询：按节点/关系过滤"""
    from sqlalchemy import select
    async with async_session() as s:
        stmt = select(KnowledgeRelationRow)
        if node_id:
            stmt = stmt.where((KnowledgeRelationRow.from_id == node_id) | (KnowledgeRelationRow.to_id == node_id))
        if relation:
            stmt = stmt.where(KnowledgeRelationRow.relation == relation)
        stmt = stmt.limit(min(limit, 500))
        rows = (await s.execute(stmt)).scalars().all()
    return [{"id": r.id, "from": r.from_id, "relation": r.relation, "to": r.to_id} for r in rows]


@router.get("/knowledge/graph/{node_id}", response_model=dict)
async def knowledge_graph(node_id: int, user=Depends(get_current_user)):
    """某知识节点的邻接图：节点信息 + 出边 + 入边"""
    from sqlalchemy import select
    async with async_session() as s:
        node = (await s.execute(select(WikiPageRow).where(WikiPageRow.id == node_id))).scalar_one_or_none()
        if node is None:
            raise HTTPException(status_code=404, detail="节点不存在")
        edges = (await s.execute(select(KnowledgeRelationRow).where(
            (KnowledgeRelationRow.from_id == node_id) | (KnowledgeRelationRow.to_id == node_id)
        ))).scalars().all()
        out_edges, in_edges = [], []
        for e in edges:
            if e.from_id == node_id:
                out_edges.append({"relation": e.relation, "to": e.to_id})
            else:
                in_edges.append({"relation": e.relation, "from": e.from_id})
    return {
        "node": {"id": node.id, "title": node.title, "page_type": node.page_type, "content": (node.content or "")[:500]},
        "out_edges": out_edges, "in_edges": in_edges,
    }


@router.get("/search", response_model=list)
async def chinese_search(
    q: str = "",
    ptype: str = "",  # textbook/homework/question/reading/essay/wiki
    limit: int = 50,
    user=Depends(get_current_user),
):
    """全文搜索（FTS5 trigram，支持中文子串）：跨库关键词检索"""
    q = (q or "").strip()
    if not q or len(q) < 2:
        return []
    try:
        from sqlalchemy import text as sa_text
        pattern = '"' + q.replace('"', '') + '"'
        async with async_session() as s:
            rows = (await s.execute(sa_text(
                "SELECT src_type, src_id, snippet(chinese_fts, 0, '【', '】', '…', 24) AS snip "
                "FROM chinese_fts WHERE chinese_fts MATCH :p ORDER BY rank LIMIT :lim"
            ), {"p": pattern, "lim": min(limit, 100)})).all()
        out = []
        for stype, sid, snip in rows:
            if ptype and stype != ptype:
                continue
            item = _search_title(stype, sid)
            out.append({"id": sid, "ptype": stype, "title": item, "snippet": snip or ""})
        return out[:min(limit, 100)]
    except Exception as e:
        logger.warning("搜索失败: %s", e)
        return []


def _search_title(stype: str, sid: int) -> str:
    """按来源类型查标题"""
    import sqlite3 as _sq
    try:
        c = _sq.connect(os.path.join(BASE_DIR, "app.db"))
        if stype == "wiki":
            t = c.execute("SELECT title FROM wiki_pages WHERE id=?", (sid,)).fetchone()
            c.close()
            return (t[0] if t else "") or "词条"
        if stype == "textbook":
            t = c.execute("SELECT page, lesson, page_type FROM chinese_textbook_pages WHERE id=?", (sid,)).fetchone()
            c.close()
            return "课本%s页 %s" % (t[0] or "?", t[1] or t[2] or "") if t else "课本页"
        if stype == "homework":
            t = c.execute("SELECT unit, lesson, category FROM chinese_unit_knowledge WHERE id=?", (sid,)).fetchone()
            c.close()
            return "%s %s %s" % (t[0] or "", t[1] or "", t[2] or "") if t else "练习页"
        if stype == "question":
            t = c.execute("SELECT question, category FROM chinese_question_items WHERE id=?", (sid,)).fetchone()
            c.close()
            return ((t[0] or "")[:40] or t[1] or "题") if t else "题目"
        if stype == "reading":
            t = c.execute("SELECT question, question_type FROM chinese_reading_items WHERE id=?", (sid,)).fetchone()
            c.close()
            return ((t[0] or "")[:40] or t[1] or "阅读题") if t else "阅读题"
        if stype == "essay":
            t = c.execute("SELECT title FROM chinese_essay_knowledge WHERE id=?", (sid,)).fetchone()
            c.close()
            return (t[0] if t else "") or "作文"
        c.close()
    except Exception:
        pass
    return ""


# ── 文本问答（简化版）：直接基于传入文本回答，无 planner ──

TEXT_ASK_PROMPT = """你是小学语文老师。请基于下面的【课文/资料原文】回答学生的问题。
要求：
1) 回答要结合原文、具体准确，可直接引用原文句子；
2) 回答末尾另起一行输出【关键字】标签，列出回答中最重要的 3~6 个词语（用于界面高亮，如"多音字、形近字、比喻句"），格式：【关键字】词1、词2、词3；
3) 不超过 350 字。
【课文/资料原文】
{context}
【学生问题】
{question}"""


class TextAskRequest(BaseModel):
    context: str = ""   # 选定的课文/页面文本
    question: str = ""
    title: str = ""     # 来源标题（可选，返回用）


class TextAskResponse(BaseModel):
    answer: str = ""
    keywords: list[str] = []
    source_title: str = ""


@router.post("/ai-chinese/text-ask", response_model=TextAskResponse)
async def chinese_text_ask(req: TextAskRequest, user=Depends(get_current_user)):
    """基于传入文本直接问答（简化版，无检索规划）"""
    context = (req.context or "").strip()
    question = (req.question or "").strip()
    if not context:
        raise HTTPException(status_code=422, detail="缺少原文文本")
    if not question:
        raise HTTPException(status_code=422, detail="问题不能为空")
    if len(question) > 200:
        raise HTTPException(status_code=422, detail="问题过长")
    context_trunc = context[:4000]
    prompt = TEXT_ASK_PROMPT.format(context=context_trunc, question=question)
    try:
        raw = svc.chat("你是一个只输出文字回答的小学语文老师。", prompt, 2048, "ai_chinese_text_ask", disable_thinking=True).strip()
    except BudgetExceededError:
        raise
    answer = raw
    keywords: list[str] = []
    m = re.search(r"【关键字】\s*([^\n【】]+)", raw or "")
    if m:
        keywords = [k.strip() for k in m.group(1).replace("，", ",").split(",") if k.strip()][:6]
        answer = (raw[:m.start()] + raw[m.end():]).strip()
    return TextAskResponse(answer=answer[:1000], keywords=keywords, source_title=req.title[:80])


# ── 知识库问答：问题 → 全文检索 → LLM 综合回答（核心问答） ──

KB_ASK_PROMPT = """你是小学语文老师。下面是【课本/知识库】里检索到的相关片段（可能含课文、练习题、知识点）。请根据这些片段回答学生的问题。
要求：
1) 只依据给定片段回答，片段没有的不要编造；
2) 回答要具体、准确，适合小学生理解；
3) 回答末尾另起一行输出【关键字】标签（3~6 个词，如"多音字、比喻句"），格式：【关键字】词1、词2；
4) 若片段与问题无关，回答"没找到相关内容，换个问法试试"。
【检索到的片段】
{context}
【学生问题】
{question}"""


class KbAskRequest(BaseModel):
    question: str = ""


@router.post("/ai-chinese/kb-ask", response_model=TextAskResponse)
async def chinese_kb_ask(req: KbAskRequest, user=Depends(get_current_user)):
    """知识库问答：问题 → 全文检索相关页面 → LLM 综合回答，返回答案与来源。"""
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=422, detail="问题不能为空")
    if len(question) > 200:
        raise HTTPException(status_code=422, detail="问题过长")
    # 1) 全文检索（跨 wiki/课本/练习/题/阅读/作文）
    results = await chinese_search(q=question, limit=8, user=user)
    if not results:
        return TextAskResponse(answer="没找到相关内容，换个问法试试", keywords=[], source_title="")
    # 2) 拼片段
    chunks = []
    titles = []
    for r in results[:6]:
        titles.append(r.get("title") or "")
        snip = (r.get("snippet") or "").strip()
        if snip:
            chunks.append("%s：%s" % (r.get("title") or r.get("ptype") or "", snip))
    context = "\n".join(chunks)[:3000]
    prompt = KB_ASK_PROMPT.format(context=context, question=question)
    try:
        raw = svc.chat("你是一个只输出文字回答的小学语文老师。", prompt, 2048, "ai_chinese_kb_ask", disable_thinking=True).strip()
    except BudgetExceededError:
        raise
    answer = raw
    keywords: list[str] = []
    m = re.search(r"【关键字】\s*([^\n【】]+)", raw or "")
    if m:
        keywords = [k.strip() for k in m.group(1).replace("，", ",").split(",") if k.strip()][:6]
        answer = (raw[:m.start()] + raw[m.end():]).strip()
    src = "、".join(dict.fromkeys(t for t in titles if t))[:100]
    return TextAskResponse(answer=answer[:1000], keywords=keywords, source_title=src)


@router.post("/ai-chinese/analyze", response_model=AnalyzeResponse)
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
        reply = svc.chat("你是一个只输出JSON的数学应用题分析助手。", prompt, 8192, "ai_chinese_analyze", disable_thinking=True)
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


@router.post("/ai-chinese/char-click", response_model=dict)
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


# ── 生字标记：学生主动标记"不会认的字" ──

class MarkUnknownCharsRequest(BaseModel):
    chars: list[str] = []  # 本次标记的不会认的字
    lesson: str = ""       # 所属课文/块来源（可选）


@router.post("/ai-chinese/mark-unknown-chars", response_model=dict)
async def mark_unknown_chars(req: MarkUnknownCharsRequest, user=Depends(get_current_user)):
    """批量标记学生不会认的生字（幂等 upsert：重复标记刷新时间）。"""
    chars = [str(c).strip() for c in req.chars if c and isinstance(c, str) and len(str(c).strip()) == 1]
    if not chars:
        raise HTTPException(status_code=422, detail="chars 不能为空")
    chars = chars[:100]
    lesson = (req.lesson or "").strip()[:60]
    try:
        from sqlalchemy import select
        async with async_session() as s:
            for ch in chars:
                row = (await s.execute(select(CharUnknownMarkRow).where(
                    CharUnknownMarkRow.user_id == user.id, CharUnknownMarkRow.char == ch
                ))).scalar_one_or_none()
                if row is not None:
                    if lesson:
                        row.lesson = lesson
                else:
                    s.add(CharUnknownMarkRow(user_id=user.id, char=ch, lesson=lesson))
            await s.commit()
    except Exception as e:
        logger.warning("mark-unknown-chars 入库失败: %s", e)
        raise HTTPException(status_code=500, detail="标记失败，请稍后重试")
    return {"status": "ok", "marked": len(chars)}


class UnknownCharsResponse(BaseModel):
    chars: list[str] = []


@router.get("/ai-chinese/unknown-chars", response_model=UnknownCharsResponse)
async def get_unknown_chars(user=Depends(get_current_user)):
    """该学生标记的所有不会认的生字。"""
    try:
        from sqlalchemy import select
        async with async_session() as s:
            rows = (await s.execute(select(CharUnknownMarkRow.char).where(
                CharUnknownMarkRow.user_id == user.id
            ).order_by(CharUnknownMarkRow.updated_at.desc()))).scalars().all()
    except Exception as e:
        logger.warning("unknown-chars 查询失败: %s", e)
        return UnknownCharsResponse(chars=[])
    return UnknownCharsResponse(chars=list(rows))


@router.get("/ai-chinese/char-click/stats", response_model=CharClickStatsResponse)
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


@router.post("/ai-chinese/quest/start", response_model=QuestStartResponse)
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


@router.post("/ai-chinese/quest/step", response_model=QuestAnswerResponse)
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


@router.get("/ai-chinese/quest/sessions", response_model=QuestSessionsResponse)
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


@router.post("/ai-chinese/quest/continue", response_model=QuestAnswerResponse)
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


@router.post("/ai-chinese/quest/retry-errors", response_model=QuestStartResponse)
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


@router.get("/ai-chinese/quest/report/{session_id}", response_model=QuestReportResponse)
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


@router.get("/ai-chinese/quest/history/{session_id}", response_model=QuestHistoryResponse)
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


@router.post("/ai-chinese/quest/replay", response_model=QuestAnswerResponse)
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

@router.post("/ai-chinese/evaluate", response_model=EvaluateResponse)
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
            prompt, 4096, "ai_chinese_evaluate",
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

@router.post("/ai-chinese/steps", response_model=StepsResponse)
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
            prompt, 4096, "ai_chinese_steps",
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


@router.post("/ai-chinese/questions", response_model=AnalyzeResponse)
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
        reply = svc.chat("你是一个只输出JSON的小学数学老师。", prompt, 4096, "ai_chinese_questions")
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

