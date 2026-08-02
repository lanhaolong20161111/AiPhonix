"""用 PaddleOCR 识别汉字图片并重命名"""
import os, re
from PIL import Image
from paddleocr import PaddleOCR

IMAGE_DIR = r"C:\Users\lhl20\Desktop\word_images"

print("初始化 PaddleOCR...")
ocr = PaddleOCR(use_textline_orientation=False, lang="ch")

files = sorted(
    [f for f in os.listdir(IMAGE_DIR) if f.lower().endswith(".png")],
    key=lambda x: os.path.getmtime(os.path.join(IMAGE_DIR, x)),
)

print(f"共 {len(files)} 张图片")

success = 0
skip = 0
fail = 0

for i, fname in enumerate(files):
    # 跳过已经重命名的（单字+后缀）
    if re.match(r"^[\u4e00-\u9fff]{1,2}\.png$", fname):
        skip += 1
        continue

    path = os.path.join(IMAGE_DIR, fname)
    try:
        img = Image.open(path)
        w, h = img.size
    except:
        fail += 1
        print(f"[{i+1}] {fname}: 打开失败")
        continue

    # 只识别上半部分（大汉字所在区域）
    top = img.crop((0, 0, w, h // 2))
    top_path = path + "_top.png"
    top.save(top_path)

    try:
        results = ocr.ocr(top_path, cls=False)
        os.remove(top_path)
    except:
        os.remove(top_path)
        results = None

    if not results or not results[0]:
        # 如果上半部分没识别到，尝试全图
        try:
            results = ocr.ocr(path, cls=False)
        except:
            results = None

    if not results or not results[0]:
        fail += 1
        print(f"[{i+1}] {fname}: 未识别到文字")
        continue

    # 找到面积最大的文字块
    best = max(results[0], key=lambda r: (r[0][2][0] - r[0][0][0]) * (r[0][2][1] - r[0][0][1]))
    text = best[1][0]
    conf = best[1][1]

    clean = re.sub(r"[^\u4e00-\u9fff]", "", text)
    if not clean:
        fail += 1
        print(f"[{i+1}] {fname}: 识别结果不含汉字: \"{text}\"")
        continue

    char = clean[0]
    new_name = f"{char}.png"
    new_path = os.path.join(IMAGE_DIR, new_name)

    if not os.path.exists(new_path):
        os.rename(path, new_path)
        success += 1
        print(f"[{i+1}] {fname} -> {new_name} (conf={conf:.2f})")
    else:
        print(f"[{i+1}] {fname}: 识别为 {char}, 但 {new_name} 已存在，跳过")
        skip += 1

print(f"\n完成: 成功{success}, 跳过{skip}, 失败{fail}")
