"""直接用已知 OCR 结果分割 39 张图并保存单字"""
import os
from PIL import Image

src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and "字卡" in f)

# OCR 已知结果（从左到右）
known = {
    0: ("答", "处"), 1: ("肚", "更"), 2: ("识", "夹"),
    3: ("之", "名"), 4: ("诉", "很"), 5: ("份", "状"),
    6: ("形", "活"), 7: ("些", "总"), 8: ("您", "能"),
    9: ("奇", "吧"), 10: ("代", "穿"), 11: ("两", "条"),
    12: ("货", "利"), 13: ("路", "常"), 14: ("非", "每"),
    15: ("士", "忘"), 16: ("民", "理"), 17: ("令", "反"),
    18: ("村", "由"), 19: ("于", "员"), 20: ("岁", "息"),
    21: ("绝", "独"), 22: ("哪", "宽"), 23: ("阴", "该"),
    24: ("失", "得"), 25: ("忙", "谁"), 26: ("宁", "怎"),
    27: ("收", "极"), 28: ("送", "但"), 29: ("句", "抓"),
    30: ("咱", "戏"), 31: ("成", "起"), 32: ("许", "作"),
    33: ("办", "法"), 34: ("如", "已"), 35: ("经", "别"),
    36: ("轻", "胆"), 37: ("因", "难"),
}

saved = 0
for idx, fname in enumerate(files):
    if idx not in known:
        continue
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    left_char, right_char = known[idx]
    for char, side_img in [(left_char, img.crop((0, 0, w//2, h))),
                           (right_char, img.crop((w//2, 0, w, h)))]:
        dst = os.path.join(src_dir, f"{char}.png")
        if os.path.exists(dst):
            print(f"  {char}.png 已存在，跳过")
            continue
        side_img.save(dst)
        saved += 1
        print(f"  {char}.png")

print(f"\n保存 {saved} 个，共 {len(known)*2} 个字符")
