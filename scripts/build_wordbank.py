"""
解析字词表附件 → 生成结构化 wordbank.json
分类：年级/上下/识写词语
连续汉字=拆单字，逗号分隔=词语
"""
import json, re
from pathlib import Path
from collections import defaultdict

ATTACH = Path(r"C:\Users\lhl20\Desktop\android_cli_demos\.reasonix\attachments")
OUT = Path(r"C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\app\src\main\assets\wordbank.json")

SOURCES = [
    # === 一年级上册 ===
    {"file": "clipboard-20260724-220507.059901-000011.txt", "grade": "一年级", "semester": "上", "type": "识字"},
    {"file": "clipboard-20260724-220507.084656-000012.txt", "grade": "一年级", "semester": "上", "type": "识字"},
    # === 一年级下册 ===
    {"file": "clipboard-20260724-220506.976524-000009.txt", "grade": "一年级", "semester": "下", "type": "识字"},
    {"file": "clipboard-20260724-220506.994257-000010.txt", "grade": "一年级", "semester": "下", "type": "识写"},
    # === 二年级上册 ===
    {"file": "clipboard-20260724-220506.947578-000007.txt", "grade": "二年级", "semester": "上", "type": "写字"},
    {"file": "clipboard-20260724-220506.788154-000004.txt", "grade": "二年级", "semester": "上", "type": "词语"},
    # === 二年级下册 ===
    {"file": "clipboard-20260724-220506.957380-000008.txt", "grade": "二年级", "semester": "下", "type": "识字"},
    {"file": "clipboard-20260724-220506.810567-000005.txt", "grade": "二年级", "semester": "下", "type": "写字"},
    {"file": "clipboard-20260724-220506.840778-000006.txt", "grade": "二年级", "semester": "下", "type": "识字"},
    # === 三年级上册 ===
    {"file": "clipboard-20260724-220506.731963-000001.txt", "grade": "三年级", "semester": "上", "type": "词语"},
    {"file": "clipboard-20260724-220506.742455-000002.txt", "grade": "三年级", "semester": "上", "type": "写字"},
    {"file": "clipboard-20260724-220506.773250-000003.txt", "grade": "三年级", "semester": "上", "type": "识字"},
]

def is_hanzi(ch):
    return '\u4e00' <= ch <= '\u9fff'

def has_comma(line):
    return ',' in line or '，' in line or '、' in line

def extract_items(text):
    """从文本中提取 {字} 或 [词语]，保留原始分组"""
    chars, words = [], []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('='):
            continue
        if has_comma(line):
            # 逗号分隔 = 词语
            for part in re.split(r'[,，、\s]+', line):
                p = part.strip()
                if len(p) >= 1 and any(is_hanzi(c) for c in p):
                    words.append(p)
        else:
            # 无逗号 = 连续汉字，逐个拆分
            for ch in line:
                if is_hanzi(ch):
                    chars.append(ch)
    return chars, words

char_tags = defaultdict(set)
word_tags = defaultdict(set)

for src in SOURCES:
    path = ATTACH / src["file"]
    if not path.exists():
        print(f"  [SKIP] {src['file']}")
        continue
    text = path.read_text("utf-8")
    chars, words = extract_items(text)
    tags = [f"{src['grade']}{src['semester']}", src["type"]]

    for ch in chars:
        char_tags[ch].add(f"{src['grade']}{src['semester']}")
        char_tags[ch].add(src["type"])
    for w in words:
        word_tags[w].add(f"{src['grade']}{src['semester']}")
        word_tags[w].add(src["type"])

    print(f"  {src['grade']+src['semester']+' '+src['type']:25s}  字={len(chars):4d}  词={len(words):4d}")

# 构建输出
data = {
    "version": 1,
    "chars": [{"text": c, "tags": sorted(t)} for c, t in sorted(char_tags.items())],
    "words": [{"text": w, "tags": sorted(t)} for w, t in sorted(word_tags.items())],
}

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(str(OUT), "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\n{'='*50}")
print(f"  汉字: {len(data['chars'])} 个")
print(f"  词语: {len(data['words'])} 条")
print(f"  输出: {OUT}")
