"""用已知的 OCR 结果直接将 29 张双字图切成单字"""
import os
from PIL import Image

# 按文件排序的 OCR 结果（从之前成功的输出中提取）
ocr_results = [
    ("姓","仍"), ("周","勇"), ("敢","术"), ("州","华"), ("全","团"),
    ("真","品"), ("乎","精"), ("亡","劝"), ("坏","死"), ("意","刻"),
    ("突","然"), ("继","续"), ("掉","映"), ("新","迎"), ("扑","南"),
    ("帮","忠"), ("夜","特"), ("或","所"), ("慢","定"), ("决","付"),
    ("终","佛"), ("任","何"), ("业","灿"), ("迟","始"), ("值","此"),
    ("忽","件"), ("启","召"), ("完","却"), ("供","治"),
]

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and f.startswith("儿童汉字插图设计"))
assert len(files) == 29 and len(ocr_results) == 29

saved = 0
skipped = 0
for fname, (left_char, right_char) in zip(files, ocr_results):
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    for char, side_img in [(left_char, img.crop((0, 0, w//2, h))),
                           (right_char, img.crop((w//2, 0, w, h)))]:
        dst = os.path.join(src_dir, f"{char}.png")
        if os.path.exists(dst):
            skipped += 1
            continue
        side_img.save(dst)
        saved += 1

print(f"保存 {saved} 个，跳过(已存在) {skipped} 个")
