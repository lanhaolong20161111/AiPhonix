"""用 EasyOCR 识别汉字图片并重命名（处理中文路径）"""
import os, re, shutil, tempfile
from PIL import Image
import easyocr

IMAGE_DIR = r"C:\Users\lhl20\Desktop\word_images"
TEMP_DIR = os.path.join(tempfile.gettempdir(), "ocr_temp")
os.makedirs(TEMP_DIR, exist_ok=True)

print("初始化 EasyOCR（CPU，可能需要一段时间）...")
reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

files = sorted(
    [f for f in os.listdir(IMAGE_DIR) if f.lower().endswith(".png")],
    key=lambda x: os.path.getmtime(os.path.join(IMAGE_DIR, x)),
)
# 跳过已重命名的单字文件
files = [f for f in files if not re.match(r"^[\u4e00-\u9fff]{1,3}\.png$", f)]

print(f"共 {len(files)} 张图片待识别")

success = 0
skip = 0
fail = 0

for i, fname in enumerate(files):
    path = os.path.join(IMAGE_DIR, fname)

    # 拷贝到临时目录（去掉文件名中的中文避免 OpenCV 问题）
    temp_name = f"img_{i:03d}.png"
    temp_path = os.path.join(TEMP_DIR, temp_name)
    try:
        shutil.copy2(path, temp_path)
    except:
        fail += 1
        print(f"[{i+1}/{len(files)}] {fname}: 复制失败")
        continue

    try:
        results = reader.readtext(temp_path)
    except Exception as e:
        fail += 1
        print(f"[{i+1}/{len(files)}] {fname}: OCR失败 - {e}")
        os.remove(temp_path)
        continue
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    if not results:
        fail += 1
        print(f"[{i+1}/{len(files)}] {fname}: 未识别到文字")
        continue

    # 找最高最大的文字（应该是顶部的大汉字）
    img = Image.open(path)
    w, h = img.size
    top_results = [r for r in results if r[0][0][1] < h * 0.4]  # 在顶部40%区域
    candidates = top_results if top_results else results

    # 按文字框高度排序（取最大的）
    best = max(candidates, key=lambda r: abs(r[0][2][1] - r[0][0][1]))
    text = best[1]
    conf = best[2]

    # 提取第一个汉字
    clean = re.sub(r"[^\u4e00-\u9fff]", "", text)
    if not clean:
        fail += 1
        print(f"[{i+1}/{len(files)}] {fname}: 识别结果不含汉字: \"{text}\"")
        continue

    char = clean[0]
    new_name = f"{char}.png"
    new_path = os.path.join(IMAGE_DIR, new_name)

    if not os.path.exists(new_path):
        os.rename(path, new_path)
        success += 1
        print(f"[{i+1}/{len(files)}] {fname} -> {new_name} (conf={conf:.2f}, \"{text}\")")
    else:
        print(f"[{i+1}/{len(files)}] {fname}: {char} 已存在 ({new_name})，跳过")
        skip += 1

# 清理临时目录
try:
    shutil.rmtree(TEMP_DIR, ignore_errors=True)
except:
    pass

print(f"\n完成: 成功{success}, 跳过{skip}, 失败{fail}")
