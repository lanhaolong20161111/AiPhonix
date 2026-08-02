"""OCR 识别汉字图片并重命名"""
import os, sys, re
from PIL import Image
import easyocr

IMAGE_DIR = r"C:\Users\lhl20\Desktop\word_images"

# 初始化 EasyOCR（中文）
reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

files = sorted(
    [f for f in os.listdir(IMAGE_DIR) if f.lower().endswith(".png")],
    key=lambda x: os.path.getmtime(os.path.join(IMAGE_DIR, x)),
)

print(f"共 {len(files)} 张图片")

for i, fname in enumerate(files):
    path = os.path.join(IMAGE_DIR, fname)
    try:
        img = Image.open(path)
    except Exception as e:
        print(f"[{i+1}/{len(files)}] {fname}: 打开失败 - {e}")
        continue
    w, h = img.size

    # 取上半部分（汉字在顶部区域）
    top_region = img.crop((0, 0, w, h // 3))

    # OCR
    try:
        results = reader.readtext(os.fspath(path))
    except Exception as e:
        print(f"[{i+1}/{len(files)}] {fname}: OCR失败 - {e}")
        continue
    # 过滤只取中文且足够大的文字
    chars = []
    for bbox, text, conf in results:
        y1, x1 = bbox[0]
        y2, x2 = bbox[2]
        box_h = y2 - y1
        # 高度占图像比例 > 5% 的才是大标题字
        if box_h > h * 0.05:
            clean = re.sub(r"[^\u4e00-\u9fff]", "", text)
            if clean:
                chars.append((clean, conf))

    if chars:
        # 取置信度最高的字
        best = max(chars, key=lambda x: x[1])
        char = best[0]
        new_name = f"{char}.png"
        new_path = os.path.join(IMAGE_DIR, new_name)
        if not os.path.exists(new_path):
            os.rename(path, new_path)
            print(f"[{i+1}/{len(files)}] {fname} -> {new_name} (conf={best[1]:.2f})")
        else:
            print(f"[{i+1}/{len(files)}] {fname}: 识别为 {char}, 但 {new_name} 已存在，跳过")
    else:
        print(f"[{i+1}/{len(files)}] {fname}: 未识别到汉字")

print("完成")
