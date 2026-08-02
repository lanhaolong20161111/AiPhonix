"""将 word_images 中的 29 张双字图切成左右单字并重命名"""
import os
from PIL import Image
import numpy as np
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and f.startswith("儿童汉字插图设计"))

reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

for i, fname in enumerate(files):
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    left = img.crop((0, 0, w//2, h))
    right = img.crop((w//2, 0, w, h))

    for side, side_img, desc in [("左", left, "左(L)"), ("右", right, "右(R)")]:
        # 裁顶部35%做OCR
        top_h = int(h * 0.35)
        top = side_img.crop((0, 0, w//2, top_h))
        small = top.resize((w//6, top_h//3), Image.LANCZOS)
        arr = np.array(small)
        results = reader.readtext(arr)
        char = ""
        for bbox, text, conf in results:
            if len(text) >= 1 and conf > 0.3 and any('\u4e00' <= c <= '\u9fff' for c in text):
                char = text[0] if len(text)==1 else text[0]
                break

        if not char:
            print(f"  [{i+1}/29] {fname} {desc}: 未识别到文字")
            continue

        dst = os.path.join(src_dir, f"{char}.png")
        if os.path.exists(dst):
            print(f"  [{i+1}/29] {fname}  {desc}: {char} -> 已存在，跳过")
            continue
        side_img.save(dst)
        print(f"  [{i+1}/29] {fname}  {desc}: {char}")

print("\n完成！所有单字已保存到 word_images")
