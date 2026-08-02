"""将 word_images 中所有图片切成左右两半，再缩小后 OCR"""
import os, sys
import numpy as np
from PIL import Image
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and f.startswith("儿童汉字插图设计"))
print(f"待处理: {len(files)} 张")

# 先全部切成左右半
halves = []  # [(side_name, img, src_file_idx)]
for i, fname in enumerate(files):
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    left = img.crop((0, 0, w//2, h))
    right = img.crop((w//2, 0, w, h))
    # 只保留上半部分（文字区域）
    top_h = int(h * 0.35)
    left_top = left.crop((0, 0, w//2, top_h))
    right_top = right.crop((0, 0, w//2, top_h))
    # 缩小到 1/3 加速 OCR
    small_w = w // 6
    small_h = top_h // 3
    left_small = left_top.resize((small_w, small_h), Image.LANCZOS)
    right_small = right_top.resize((small_w, small_h), Image.LANCZOS)
    halves.append(("左", left_small, i))
    halves.append(("右", right_small, i))

# 初始化 OCR
print("初始化 EasyOCR...")
reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

# OCR 所有半图
for side_name, small_img, idx in halves:
    fname = files[idx]
    arr = np.array(small_img)
    results = reader.readtext(arr)
    texts = []
    for bbox, text, conf in results:
        if len(text) >= 1 and conf > 0.3 and any('\u4e00' <= c <= '\u9fff' for c in text):
            texts.append(f"{text}({conf:.2f})")
    print(f"  图{idx+1} {side_name}: {' '.join(texts) if texts else '无'}")
    sys.stdout.flush()

print("完成")
