"""续跑 OCR 识别 28-39 张"""
import os, sys
import numpy as np
from PIL import Image
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and "字卡" in f)

reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

for i, fname in enumerate(files):
    if i < 27:
        continue  # 跳过已识别的
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    left = img.crop((0, 0, w//2, h))
    right = img.crop((w//2, 0, w, h))
    top_h = int(h * 0.35)
    l_top = left.crop((0, 0, w//2, top_h))
    r_top = right.crop((0, 0, w//2, top_h))
    l_small = l_top.resize((w//4, top_h//2), Image.LANCZOS)
    r_small = r_top.resize((w//4, top_h//2), Image.LANCZOS)

    l_results = reader.readtext(np.array(l_small))
    r_results = reader.readtext(np.array(r_small))

    l_text = ""
    for b,t,c in l_results:
        if len(t) >= 1 and c > 0.3 and any('\u4e00'<=ch<='\u9fff' for ch in t):
            l_text = t
            break
    r_text = ""
    for b,t,c in r_results:
        if len(t) >= 1 and c > 0.3 and any('\u4e00'<=ch<='\u9fff' for ch in t):
            r_text = t
            break

    print(f"  {i+1}: [{l_text}] [{r_text}]")
    sys.stdout.flush()

print("\n完成")
