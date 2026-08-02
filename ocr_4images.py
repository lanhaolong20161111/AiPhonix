"""OCR 查看新 4 张图的文字布局"""
import os, sys
import numpy as np
from PIL import Image
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and "字卡" in f)

reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

for fname in files:
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    print(f"\n=== {fname} ({w}x{h}) ===")

    # 缩小到一半加速
    small = img.resize((w//2, h//2), Image.LANCZOS)
    arr = np.array(small)
    results = reader.readtext(arr)

    for bbox, text, conf in results:
        y1 = bbox[0][1] * 2  # 还原到原始坐标
        y2 = bbox[2][1] * 2
        x1 = bbox[0][0] * 2
        x2 = bbox[2][0] * 2
        top_pct = y1 / h * 100
        print(f"  {text}({conf:.2f}) x=({x1:.0f}-{x2:.0f}) y=({y1:.0f}-{y2:.0f}) [top={top_pct:.0f}%]")
    sys.stdout.flush()

print("\n完成")
