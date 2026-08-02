"""识别并重命名 word_images 下的汉字图片"""
import os, re, shutil, tempfile
from PIL import Image
import easyocr

IMAGE_DIR = r"C:\Users\lhl20\Desktop\word_images"
TEMP_DIR = os.path.join(tempfile.gettempdir(), "ocr_temp2")
os.makedirs(TEMP_DIR, exist_ok=True)

print("初始化 EasyOCR...")
reader = easyocr.Reader(["ch_sim", "en"], gpu=False)

files = sorted([f for f in os.listdir(IMAGE_DIR) if f.lower().endswith(".png")])
# 跳过已重命名的单字文件
files = [f for f in files if not re.match(r"^[\u4e00-\u9fff]{1,4}\.png$", f)]
print(f"待识别: {len(files)} 张")

ok = 0
for fname in files:
    path = os.path.join(IMAGE_DIR, fname)

    # 复制到临时目录（避免中文路径问题）
    temp_path = os.path.join(TEMP_DIR, f"img_{ok}.png")
    try:
        shutil.copy2(path, temp_path)
    except:
        print(f"[ERR] {fname}: 复制失败")
        continue

    try:
        results = reader.readtext(temp_path)
    except Exception as e:
        print(f"[ERR] {fname}: OCR失败 - {e}")
        os.remove(temp_path)
        continue
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    if not results:
        print(f"[SKIP] {fname}: 未识别到文字")
        continue

    # 筛选顶部40%区域的大字
    with Image.open(path) as img:
        w, h = img.size
    top_results = [r for r in results if r[0][0][1] < h * 0.4]
    candidates = top_results if top_results else results

    # 取高度最大的文字块
    best = max(candidates, key=lambda r: abs(r[0][2][1] - r[0][0][1]))
    text = best[1]
    conf = best[2]

    # 提取首个汉字或多个汉字
    clean = re.sub(r"[^\u4e00-\u9fff]", "", text)
    if not clean:
        print(f"[SKIP] {fname}: 无汉字: \"{text}\"")
        continue

    new_name = f"{clean}.png"
    new_path = os.path.join(IMAGE_DIR, new_name)
    if os.path.exists(new_path):
        print(f"[SKIP] {fname}: {new_name} 已存在 (识别为「{clean}」)")
        continue

    os.rename(path, new_path)
    ok += 1
    print(f"[OK] {fname} -> {new_name} (conf={conf:.2f}, \"{text}\")")

# 清理
import shutil as sh
try:
    sh.rmtree(TEMP_DIR, ignore_errors=True)
except:
    pass

print(f"\n完成: 重命名 {ok} 张")
