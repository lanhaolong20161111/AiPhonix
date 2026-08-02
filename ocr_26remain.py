"""续跑 OCR 剩余 26 张词语图"""
import os, sys
import numpy as np
from PIL import Image
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and "字卡" in f)

reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

# 只处理 9+ 以后的
for i, fname in enumerate(files):
    if i < 9:
        continue
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    left = img.crop((0, 0, w//2, h))
    right = img.crop((w//2, 0, w, h))
    top_h = int(h * 0.40)
    l_top = left.crop((0, 0, w//2, top_h))
    r_top = right.crop((0, 0, w//2, top_h))

    l_results = reader.readtext(np.array(l_top), width_ths=0.7)
    r_results = reader.readtext(np.array(r_top), width_ths=0.7)

    l_text = ""
    best = {"conf": 0, "text": ""}
    for b, t, c in l_results:
        if c > 0.3 and len(t) >= 2 and any('\u4e00'<=ch<='\u9fff' for ch in t):
            if c > best["conf"]:
                best = {"conf": c, "text": t}
    l_text = best["text"]

    best = {"conf": 0, "text": ""}
    for b, t, c in r_results:
        if c > 0.3 and len(t) >= 2 and any('\u4e00'<=ch<='\u9fff' for ch in t):
            if c > best["conf"]:
                best = {"conf": c, "text": t}
    r_text = best["text"]

    print(f"  {i+1}: [{l_text}] [{r_text}]")
    sys.stdout.flush()

print("\n完成")
