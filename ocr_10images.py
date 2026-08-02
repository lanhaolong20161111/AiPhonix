"""OCR 识别 10 张词语图的内容"""
import os, sys
import numpy as np
from PIL import Image
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and f.startswith("儿童汉字插图设计"))

reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

for fname in files:
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    # 切左右
    left = img.crop((0, 0, w//2, h))
    right = img.crop((w//2, 0, w, h))

    # 只取上半部分文字区域（~30%高度）
    top_h = int(h * 0.30)
    l_top = left.crop((0, 0, w//2, top_h))
    r_top = right.crop((0, 0, w//2, top_h))

    # 缩小加速
    l_small = l_top.resize((w//4, top_h//2), Image.LANCZOS)
    r_small = r_top.resize((w//4, top_h//2), Image.LANCZOS)

    l_arr = np.array(l_small)
    r_arr = np.array(r_small)

    l_results = reader.readtext(l_arr)
    r_results = reader.readtext(r_arr)

    l_texts = [f"{t}({c:.2f})" for b,t,c in l_results if len(t)>=2 and c>0.3]
    r_texts = [f"{t}({c:.2f})" for b,t,c in r_results if len(t)>=2 and c>0.3]
    l = l_texts[0] if l_texts else "无"
    r = r_texts[0] if r_texts else "无"
    print(f"  {fname}: 左=[{l}]  右=[{r}]")
    sys.stdout.flush()

print("完成")
