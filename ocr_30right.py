"""补查 image 30 右半的顶部"""
import os, sys
import numpy as np
from PIL import Image
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and "字卡" in f)

reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

fname = files[29]  # image 30 (0-based)
path = os.path.join(src_dir, fname)
img = Image.open(path).convert("RGBA")
w, h = img.size

# Right half
right = img.crop((w//2, 0, w, h))
# Try different crop heights
for crop_h in [0.25, 0.30, 0.35, 0.40]:
    top = right.crop((0, 0, right.width, int(h * crop_h)))
    results = reader.readtext(np.array(top), width_ths=0.7)
    texts = [f"{t}({c:.2f})" for b, t, c in results if c > 0.4]
    if texts:
        print(f"  顶部{crop_h:.2f}: {' | '.join(texts)}")
    else:
        print(f"  顶部{crop_h:.2f}: 无")

# Get full right half  
results = reader.readtext(np.array(right), width_ths=0.7)
print(f"  全图: {' | '.join(f'{t}({c:.2f})' for b,t,c in results if c>0.4)}")
sys.stdout.flush()
