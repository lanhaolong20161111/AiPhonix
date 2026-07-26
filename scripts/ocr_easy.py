"""
EasyOCR 识别一年级字词表图片
- 从上到下逐行识别（按 Y 排序）
- 仅提取汉字（过滤拼音、数字）
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import easyocr

def is_hanzi(ch):
    return '\u4e00' <= ch <= '\u9fff'

def sort_boxes(results):
    """
    按 Y 坐标分组→按 X 排序→重组为行
    results = [(box, text, conf), ...] 或 [(box, text), ...]
    """
    items = []
    for r in results:
        if len(r) == 3:
            box, text, conf = r
        else:
            box, text = r
            conf = 1.0
        if conf < 0.3 or not text.strip():
            continue
        y_c = (box[0][1] + box[2][1]) / 2
        x_c = (box[0][0] + box[2][0]) / 2
        items.append((y_c, x_c, text.strip()))

    items.sort(key=lambda x: x[0])

    lines, cur_y, cur_line = [], -100, []
    for y, x, txt in items:
        if cur_y < 0 or abs(y - cur_y) <= 25:
            cur_line.append((x, txt))
        else:
            cur_line.sort(key=lambda t: t[0])
            lines.append(' '.join(t[1] for t in cur_line))
            cur_line = [(x, txt)]
        cur_y = y

    if cur_line:
        cur_line.sort(key=lambda t: t[0])
        lines.append(' '.join(t[1] for t in cur_line))
    return lines

def only_hanzi_lines(lines):
    return [''.join(c for c in l if is_hanzi(c)) for l in lines if any(is_hanzi(c) for c in l)]

reader = easyocr.Reader(['ch_sim'], gpu=False, verbose=False)

input_dir = Path(r"C:\Users\lhl20\Desktop\语文字词表")
images = sorted(input_dir.glob("*.jpg"))
out = input_dir / "ocr_output.txt"

print(f"找到 {len(images)} 张图片\n")

all_text = []
for i, p in enumerate(images, 1):
    name = p.stem[:40]
    print(f"[{i}/{len(images)}] {name} ...", end="", flush=True)
    try:
        import numpy as np
        from PIL import Image
        img_pil = Image.open(str(p)).convert('RGB')
        img_np = np.array(img_pil)
        raw = reader.readtext(img_np)  # 传 numpy 数组而非路径
        lines = sort_boxes(raw)
        hanzi = only_hanzi_lines(lines)
        print(f" {len(hanzi)} 行汉字")
        all_text.append(f"===== 图片{i}: {p.name} =====")
        all_text.extend(hanzi)
        all_text.append("")
    except Exception as e:
        print(f" ❌ {e}")

out.write_text("\n".join(all_text), encoding="utf-8")
total = sum(len(t) for t in all_text if t.strip() and not t.startswith('='))
print(f"\n✅ 完成 → {out} ({total} 字)")
