"""将 word_images 中左右各半的图切成左右两半，用 EasyOCR 识别上半部分文字后重命名"""
import os, json, sys
import numpy as np
from PIL import Image
import easyocr

src_dir = r"C:\Users\lhl20\Desktop\word_images"
reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

# 获取要处理的文件
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and f.startswith("儿童汉字插图设计"))

total = len(files)
print(f"待处理: {total} 张")

results = []  # [(new_name, old_path)]
for i, fname in enumerate(files):
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    # 切左右
    left = img.crop((0, 0, w // 2, h))
    right = img.crop((w // 2, 0, w, h))

    # 只取上半部分（~35%高度，文字通常在顶部）
    top_h = int(h * 0.35)
    left_top = left.crop((0, 0, w // 2, top_h))
    right_top = right.crop((0, 0, w // 2, top_h))

    # EasyOCR 识别
    l_text = ""
    left_top_np = np.array(left_top)
    l_results = reader.readtext(left_top_np)
    for bbox, text, conf in l_results:
        if len(text) >= 2 and conf > 0.3:
            l_text = text
            # 过滤掉纯数字/字母
            if any('\u4e00' <= c <= '\u9fff' for c in text):
                break

    r_text = ""
    right_top_np = np.array(right_top)
    r_results = reader.readtext(right_top_np)
    for bbox, text, conf in r_results:
        if len(text) >= 2 and conf > 0.3:
            r_text = text
            if any('\u4e00' <= c <= '\u9fff' for c in text):
                break

    # 保存左右
    for side_name, side_img, ocr_text in [("左", left, l_text), ("右", right, r_text)]:
        if not ocr_text:
            print(f"  [{i+1}/{total}] {fname} {side_name}: 未识别到文字")
            continue
        # 清理文件名合规字符
        clean = ocr_text.strip()
        dst = os.path.join(src_dir, f"{clean}.png")
        if os.path.exists(dst):
            print(f"  [{i+1}/{total}] {fname} {side_name}: {ocr_text} -> 已存在，跳过")
            continue
        side_img.save(dst)
        print(f"  [{i+1}/{total}] {fname} {side_name}: {ocr_text}")

print(f"\n处理完成，请检查 word_images 目录")
