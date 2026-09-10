"""AiPhonix 文本处理工具（从 routes/ai_chinese.py 胖路由拆分出来的自包含函数）。

这些函数只依赖标准库（re/json），不依赖路由模块的全局变量（cfg/svc/IMAGE_DIR 等）。
ai_chinese.py 的版本和 ai_homework.py 不同（数学版 _clean_ocr_text 多了 LaTeX 清理），
因此本模块只放 ai_chinese 版本；ai_homework 保留自己的实现。
"""

import json
import logging
import re

logger = logging.getLogger(__name__)


# ── JSON / blocks 解析 ──

def extract_json_array(text: str) -> list:
    """从模型输出提取 JSON 数组；失败返回 []。"""
    try:
        _c = (text or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        s, e = _c.find("["), _c.rfind("]")
        if s >= 0 and e > s:
            _c = _c[s : e + 1]
        data = json.loads(_c)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def extract_blocks(reply: str) -> list[dict]:
    """从 LLM 排版 JSON 中解析 blocks；解析失败返回空列表（退化为纯文本展示）
    block 内附带 lines：按图片上的视觉行切分（每行含文本与缩进级别），逐字点读按行渲染。"""
    try:
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        data = json.loads(_c)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, dict):
        return []
    blocks = []
    for b in data.get("blocks", []) or []:
        if not isinstance(b, dict):
            continue
        text = str(b.get("text", "") or "").strip()
        if not text:
            continue
        btype = str(b.get("type", "") or "").strip()
        if btype not in {"title", "heading", "body", "question", "option", "note"}:
            btype = "body"
        align = str(b.get("align", "") or "").strip()
        if align not in {"left", "center", "right"}:
            align = "left"
        # 多音字注音：{字: 带声调拼音}，仅用于 TTS 朗读
        poly = {}
        p = b.get("polyphones", {}) or {}
        if isinstance(p, dict):
            for k, v in p.items():
                ks = str(k or "").strip()
                vs = str(v or "").strip()
                if ks and len(ks) == 1 and vs:
                    poly[ks] = vs
        # 行结构：图片上每一视觉行一个 {text, indent}（indent=缩进级别 0/1/2）
        lines = []
        for ln in (b.get("lines", []) or []):
            if isinstance(ln, dict):
                lt = str(ln.get("text", "") or "").strip()
                if lt:
                    indent = int(ln.get("indent", 0) or 0)
                    indent = 0 if indent < 0 else min(indent, 3)
                    lines.append({"text": lt, "indent": indent})
        if not lines:
            lines = [{"text": text, "indent": 0}]
        blocks.append({"type": btype, "text": text, "align": align, "lines": lines, "polyphones": poly})
    return blocks


def extract_html_tables(text: str) -> tuple[str, list[str]]:
    """从 OCR 文本中提取 HTML 表格（<table>…</table>），原地替换为占位符。
    返回 (占位后文本, 表格 HTML 列表，顺序与占位符一致)。"""
    tables: list[str] = []
    def sub(m: re.Match) -> str:
        tables.append(m.group(0))
        return f"\n[TABLE]{len(tables) - 1}\n"
    replaced = re.sub(r"<table[^>]*>.*?</table>", sub, text, flags=re.IGNORECASE | re.S)
    return replaced, tables


def merge_table_blocks(blocks: list[dict], tables: list[str]) -> list[dict]:
    """把 relayout 结果里含 [TABLEi] 占位符的 body 块替换为对应的 table HTML 块，保持顺序。"""
    if not tables:
        return blocks
    out: list[dict] = []
    for b in blocks:
        text = str(b.get("text") or "")
        hit = None
        for m in re.finditer(r"\[TABLE\](\d+)", text):
            idx = int(m.group(1))
            if 0 <= idx < len(tables):
                hit = (m.start(), m.end(), idx)
        if hit is None:
            out.append(b)
            continue
        start, end, idx = hit
        before = text[:start].strip()
        after = text[end:].strip()
        if before:
            out.append({**b, "text": before, "lines": [{"text": before, "indent": 0}], "type": "body" if b.get("type") != "table" else "body"})
        out.append({"type": "table", "text": tables[idx], "align": "left",
                    "lines": [{"text": tables[idx], "indent": 0}], "polyphones": {}})
        if after:
            out.append({**b, "text": after, "lines": [{"text": after, "indent": 0}], "type": "body"})
    return out


def extract_page_bounds(reply: str) -> dict | None:
    """从 LLM 排版 JSON 中解析 page_bounds（页面内容边界，0~1000 相对坐标）。
    返回 {left, top, right, bottom}；解析失败或无该字段返回 None。"""
    try:
        _c = (reply or "").strip()
        if _c.startswith("```"):
            _c = re.sub(r"^```(?:json)?\s*", "", _c, flags=re.IGNORECASE)
            _c = re.sub(r"\s*```\s*$", "", _c)
        data = json.loads(_c)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    pb = data.get("page_bounds", {}) or {}
    if not isinstance(pb, dict):
        return None
    try:
        left = float(pb.get("left", 0))
        top = float(pb.get("top", 0))
        right = float(pb.get("right", 1000))
        bottom = float(pb.get("bottom", 1000))
    except (TypeError, ValueError):
        return None
    # 校验：页面占满整图（约 0..1000）视为无白边，返回 None
    if left <= 1 and top <= 1 and right >= 999 and bottom >= 999:
        return None
    # 防止越界/反向
    left = max(0.0, min(1000.0, left))
    top = max(0.0, min(1000.0, top))
    right = max(left + 1.0, min(1000.0, right))
    bottom = max(top + 1.0, min(1000.0, bottom))
    return {"left": left, "top": top, "right": right, "bottom": bottom}


# ── blocks 排版修正 ──

def reorder_title_first(blocks: list[dict]) -> None:
    """排版顺序修正：把大标题（type=title）移到最前。

    多栏卷面被 LLM 按物理位置拆分时，标题可能落在中间/末尾；
    阅读顺序标题应在前。非标题块保持相对顺序。"""
    if len(blocks) < 2:
        return
    title_idx = next((i for i, b in enumerate(blocks) if b.get("type") == "title"), None)
    if title_idx is None or title_idx == 0:
        return
    title = blocks.pop(title_idx)
    blocks.insert(0, title)


def mark_poetry(blocks: list[dict]) -> None:
    """检测古诗/诗句块并修正排版：多行、每行较短、行末带诗词标点的块，
    判定为诗句——align 置 center，每行缩进 1（诗句居中排布而非顶格）。"""
    for b in blocks:
        lines = b.get("lines") or []
        if len(lines) < 2 or b.get("type") in {"title", "heading", "option", "note"}:
            continue
        # 诗句特征：≥2 行，每行字数 3~14，多数行以诗句标点结尾
        text_len = [len((l.get("text") or "").replace(" ", "")) for l in lines]
        if any(n < 2 or n > 16 for n in text_len):
            continue
        punct_end = sum(1 for l in lines if (l.get("text") or "").rstrip().endswith(("，", "。", "、", "！", "？", ",")))
        if punct_end < max(1, len(lines) - 1):
            continue
        b["align"] = "center"
        for l in lines:
            l["indent"] = 1  # 居中缩进（客户端按第一行 indent 居中显示）
        # 标题通常单独成行，可能被并进诗块首行——分离
        b["text"] = "\n".join(l.get("text", "") for l in lines)


_ORDERED_PREFIX = re.compile(
    r"^(?:[（(]?\d+[）).、．]|[①-⑳]|一、|二、|三、|四、|五、|六、|七、|八、|九、|十、|"
    r"[一二三四五六七八九十]+[、.)．]|[◆◇●○□■△▲★☆])"
)


def mark_ordered_indent(blocks: list[dict]) -> None:
    """有序号（①②③、1.、一、）或菱形/符号开头的行 → 缩进为列表项（indent≥1），
    使序号/条目视觉上与正文区分开。"""
    for b in blocks:
        if b.get("type") in {"title", "heading", "note"}:
            continue
        lines = b.get("lines") or []
        for l in lines:
            t = (l.get("text") or "").strip()
            if not t or not (_ORDERED_PREFIX.match(t)):
                continue
            if int(l.get("indent", 0) or 0) < 1:
                l["indent"] = 1


# ── 复杂版面特征检测 ──

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


def detect_complex_layout(text: str) -> bool:
    """检测识别文本是否含表格/方格/序号/特殊符号/下划线/括号等复杂版面特征。

    命中则交由 PP-StructureV3 重新识别（真实排版还原），否则用 Ark 结果。
    """
    if not text:
        return False
    if text.count("|") >= 4 or text.count("｜") >= 4:
        return True  # 表格（markdown 竖线分隔）
    if _COMPLEX_NUMERAL_ROW.search(text):
        return True
    if _COMPLEX_FORMULA.search(text):
        return True
    if _COMPLEX_MATH.search(text):
        return True
    if _COMPLEX_SYMBOL.search(text):
        return True
    if _COMPLEX_UNDERLINE.search(text):
        return True
    if _COMPLEX_BOX.search(text):
        return True
    return False


# PP-StructureV3 强项特征：表格/方格/下划线填空/菱形条目符/几何图形符号
# （PP 对线性文字卷面反而会拆散选项/段落粘连，只在真正需要排版还原的场景用它）
_PP_STRENGTH_SYMBOL = re.compile(r"[◆◇●○□■]")
_PP_STRENGTH_GEOMETRY = re.compile(
    r"(三角形|正方形|长方形|圆形|圆柱体|正方体|长方体|梯形|平行四边形|周长|面积|平移|旋转|轴对称|按对称轴|格子图|方格图)"
)


def detect_pp_strength(text: str) -> bool:
    """检测是否命中 PP-StructureV3 强项场景。

    只路由 PP 真正优于 Ark 的场景：
    - 表格（markdown 竖线，Ark 会拍平）
    - 勾选框/方格（□【】）
    - 成排序号（① ② ③ 排列题）
    - 几何图形题（定位图形与文字关系）
    下划线填空/菱形/普通符号 **不触发**——Ark 线性识别也能处理，且 PP 会拆碎文本（实测）。
    """
    if not text:
        return False
    if text.count("|") >= 4 or text.count("｜") >= 4:
        return True  # 表格
    if _COMPLEX_BOX.search(text):
        return True  # 勾选框/方格
    if _COMPLEX_NUMERAL_ROW.search(text):
        return True  # ①②③ 成排（排列题/填表题）
    if _PP_STRENGTH_GEOMETRY.search(text):
        return True  # 几何题
    if _PP_STRENGTH_SYMBOL.search(text):
        return True  # 菱形/方块条目符（卷面明确标号）
    return False


# ── OCR 文本清洗 ──

def clean_ocr_text(s: str) -> str:
    """清理识别文本中的乱码/占位方块字符（模型偶发输出 � □ ▯ █ 等替换符），不碰合法中文/标点。

    注：不再删除独立成行的拼音注音——用户要求 OCR 保留拼音且排版与图片一致。"""
    t = fix_mojibake(s or "")
    t = re.sub(r"[\ufffd\u25a1\u25af\u2588\u258c\u2580\u2590]", "", t)
    # 清理误输出的 LaTeX/Markdown/HTML 标记（如 $^{①}$ → ①）
    t = re.sub(r"\$+\^{?([^$]*?)\}?\$+", r"\1", t)
    t = re.sub(r"\$+", "", t)
    t = re.sub(r"\\text\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"\1/\2", t)
    t = re.sub(r"<sub>([^<]*)</sub>", r"\1", t, flags=re.IGNORECASE)
    t = re.sub(r"<sup>([^<]*)</sup>", r"\1", t, flags=re.IGNORECASE)
    return t


def fix_mojibake(s: str) -> str:
    """修复 UTF-8 字节被误当 Latin-1 解码的乱码（mojibake）。
    特征：文本含大量 `æ å ä ç` 等 Latin-1 扩展字符且不含中文——尝试 latin-1→utf-8 还原。"""
    t = s or ""
    if not t:
        return t
    # 中文字符占比判断是否需要修复
    zh = sum(1 for c in t if "\u4e00" <= c <= "\u9fff")
    if zh > 0 and len(t) > 0:
        # 已有中文，判断是否部分行乱码：乱码行特征 = 含 æ/å/ä/ç/è/ï/Å 等且不含中文
        lines = t.split("\n")
        fixed = []
        for ln in lines:
            has_zh = any("\u4e00" <= c <= "\u9fff" for c in ln)
            looks_mojibake = (
                not has_zh
                and len(ln) > 2
                and any(c in ln for c in "æåäçèïÉÅæçñîâ")
            )
            if looks_mojibake:
                try:
                    fixed.append(ln.encode("latin-1").decode("utf-8"))
                except (UnicodeEncodeError, UnicodeDecodeError):
                    fixed.append(ln)
            else:
                fixed.append(ln)
        return "\n".join(fixed)
    # 整段无中文但含大量 Latin-1 扩展字符 → 整段修复
    latin_ext = sum(1 for c in t if c in "æåäçèïÉÅæçñîâàáâã")
    if latin_ext >= 3:
        try:
            return t.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return t
    return t


def dedupe_lines(s: str) -> str:
    """删除文本中重复的行（LLM 偶发把每行输出两遍导致内容重复）。
    兼容连续重复与隔空行重复（如"标题 / 空行 / 标题"）。"""
    lines = (s or "").split("\n")
    out: list[str] = []
    # 记录最近的非空行（用于识别隔空行重复）
    last_nonempty: str | None = None
    for ln in lines:
        stripped = ln.strip()
        if stripped == "":
            out.append(ln)
            continue
        if stripped == last_nonempty:
            continue  # 与上一个非空行相同 → 跳过
        out.append(ln)
        last_nonempty = stripped
    return "\n".join(out)


def recover_text_from_json(s: str) -> str:
    """兜底：识别文本若是残留的 JSON 串（含 blocks/type/text 字段），提取其中的纯文本。
    旧缓存/LLM 未按格式输出时，text 可能整段是 JSON——从 blocks[].text 或顶层 text 提取。
    若 JSON 被截断无法解析，用正则抓取所有 "text":"..." 值拼接。"""
    t = (s or "").strip()
    if not t.startswith("{") and not t.startswith("["):
        return s
    try:
        data = json.loads(t)
    except (json.JSONDecodeError, TypeError):
        # 截断/损坏的 JSON：正则兜底抓取 text 字段值
        if '"text"' in t or '"blocks"' in t:
            vals = re.findall(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', t)
            vals = [v.encode("utf-8").decode("unicode_escape", errors="ignore") if "\\" in v else v for v in vals]
            vals = [v.strip() for v in vals if v.strip()]
            if vals:
                return "\n\n".join(vals)
        return s
    if isinstance(data, dict) and data.get("blocks"):
        parts = []
        for b in data["blocks"]:
            if isinstance(b, dict):
                bt = str(b.get("text", "") or "").strip()
                if bt:
                    parts.append(bt)
        if parts:
            return "\n\n".join(parts)
        if data.get("text"):
            return str(data["text"])
    if isinstance(data, dict) and data.get("text"):
        return str(data["text"])
    if isinstance(data, list):
        parts = []
        for b in data:
            if isinstance(b, dict) and b.get("text"):
                parts.append(str(b["text"]))
        if parts:
            return "\n\n".join(parts)
    return s


# ── 题目/句子拆分 ──

def split_questions(text: str) -> list[str]:
    """把识别文本拆成题目列表：优先【题N】标记，其次空行/行首题号，兜底整段一题。"""
    text = clean_ocr_text(text or "").strip()
    if not text:
        return []

    # 1) 【题N】标记（Ark prompt 强制格式）
    marked = re.split(r"【\s*题\s*\d+\s*】", text)
    if len(marked) > 1:
        out = [m.strip() for m in marked if m.strip()]
        if out:
            return out

    # 2) 空行分隔
    parts = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(parts) > 1:
        return parts

    # 3) 行首题号（阿拉伯数字 / （1） / 中文数字）
    numbered = re.split(r"\n\s*(?=\d+\s*[.、)]|（\d+）|[一二三四五六七八九十]+[、.])", text)
    if len(numbered) > 1:
        out = [p.strip() for p in numbered if p.strip()]
        if out:
            return out

    return [text]


def split_sentences(question: str) -> list[str]:
    """按【句子】切分：以句号/问号/感叹号为边界（一句话 = 包含 。？！ 的完整句，
    逗号不断句）。便于逐句朗读与关键条件定位。"""
    parts = re.split(r"(?<=[。！？?!])", question)
    out = [p.strip() for p in parts if p.strip()]
    if not out:
        out = [question.strip()]
    return out
