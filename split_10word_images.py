"""将 10 张词语图切分成单词语并保存"""
import os
from PIL import Image

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and f.startswith("儿童汉字插图设计"))

# OCR 已知结果（图6右边是"自由"）
known = {
    "儿童汉字插图设计.png": ("新奇", "任何"),
    "儿童汉字插图设计 (1).png": ("事情", "怎样"),
    "儿童汉字插图设计 (2).png": ("以前", "灵巧"),
    "儿童汉字插图设计 (3).png": ("开始", "决心"),
    "儿童汉字插图设计 (4).png": ("从此", "忽然"),
    "儿童汉字插图设计 (5).png": ("启发", "号召"),
    "儿童汉字插图设计 (6).png": ("民众", "自由"),
    "儿童汉字插图设计 (7).png": ("道理", "根本"),
    "儿童汉字插图设计 (8).png": ("果然", "提供"),
    "儿童汉字插图设计 (9).png": ("百姓", "必须"),
}

saved = 0
for fname in files:
    if fname not in known:
        continue
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    left_word, right_word = known[fname]
    for word, side_img in [(left_word, img.crop((0, 0, w//2, h))),
                           (right_word, img.crop((w//2, 0, w, h)))]:
        dst = os.path.join(src_dir, f"{word}.png")
        if os.path.exists(dst):
            print(f"  {word}.png 已存在")
            continue
        side_img.save(dst)
        print(f"  {word}.png")
        saved += 1

print(f"\n保存 {saved} 个")
