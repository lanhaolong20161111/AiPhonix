"""将 4 张词语图切成左右各一个词语"""
import os
from PIL import Image

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and "字卡" in f)

# OCR 已知结果
known = {
    "1-3年级小学生汉字字卡制作（含图画+句子解释）.png": ("反而", "仍然"),
    "1-3年级小学生汉字字卡制作（含图画+句子解释） (1).png": ("治服", "继续"),
    "1-3年级小学生汉字字卡制作（含图画+句子解释） (2).png": ("采用", "奔波"),
    "1-3年级小学生汉字字卡制作（含图画+句子解释） (3).png": ("平常", "平时"),
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
            print(f"  {word}.png 已存在，跳过")
            continue
        side_img.save(dst)
        print(f"  {word}.png")
        saved += 1

print(f"\n保存 {saved} 个词语文件")
