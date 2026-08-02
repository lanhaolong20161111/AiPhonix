"""补查缺失的词语：23左, 27右, 30全"""
import os, sys
import numpy as np
from PIL import Image
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and "字卡" in f)

reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

for idx in [22, 26, 29]:  # 0-based
    fname = files[idx]
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    
    for side_name, side_img in [("左", img.crop((0, 0, w//2, h))),
                                 ("右", img.crop((w//2, 0, w, h)))]:
        # 用全图识别，不裁剪
        results = reader.readtext(np.array(side_img), width_ths=0.7)
        texts = []
        for b, t, c in results:
            if c > 0.3 and len(t) >= 2:
                texts.append(f"{t}({c:.2f})")
        print(f"  {idx+1} {side_name}: {' | '.join(texts)}")
    sys.stdout.flush()

print("\n完成")
