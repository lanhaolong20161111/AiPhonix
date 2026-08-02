"""分割 35 张词语图并部署到服务器"""
import os, json
from PIL import Image

src_dir = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"
idx_path = "server_py/data/char_image_index.json"
fb_path = "server_py/data/char_image_feedback.json"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and "字卡" in f)

# OCR 综合结果 (0-based index -> 左/右词语)
known = {
    0: ("常常", "来回"),       # 二年级上词
    1: ("阁楼", "妥当"),       # 三年级上词
    2: ("声明", "普通"),
    3: ("让步", "条件"),
    4: ("要是", "最好"),
    5: ("答应", "来得及"),
    6: ("当然", "刚才"),
    7: ("知觉", "介绍"),
    8: ("主旨", "占领"),
    9: ("乏力", "一本正经"),
    10: ("发展", "海滨"),
    11: ("为了", "由于"),      # 二年级上词
    12: ("水平线", "来来往往"),
    13: ("散发", "密密层层"),
    14: ("严严实实", "视线"),
    15: ("山谷", "充满"),
    16: ("轻快", "精神"),
    17: ("千姿百态", "无穷"),
    18: ("奥秘", "再三"),
    19: ("难得", "落后"),
    20: ("地位", "环节"),
    21: ("难度", "陆续"),
    22: ("一切", "消失"),      # 二年级上词
    23: ("血丝", "匆匆"),
    24: ("转告", "连续"),
    25: ("怒目圆睁", "眨眼"),
    26: ("眼眶", "耳闻目睹"),
    27: ("迟到", "凌乱"),
    28: ("怎么", "但是"),      # 二年级上词
    29: ("更加", ""),          # 二年级上词, 右半待确认
    30: ("频频", "准备"),
    31: ("旁边", "安心"),
    32: ("吃力", "漂亮"),
    33: ("意思", "因此"),
    34: ("那么", "自言自语"),  # 二年级上词
}

# 先保存词语PNG
saved = 0
for idx, (lw, rw) in known.items():
    fname = files[idx]
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    
    for word, side_img in [(lw, img.crop((0, 0, w//2, h))),
                           (rw, img.crop((w//2, 0, w, h)))]:
        if not word:
            print(f"  跳过空词 {idx}")
            continue
        dst = os.path.join(src_dir, f"{word}.png")
        if os.path.exists(dst):
            print(f"  {word}.png 已存在，跳过")
            continue
        side_img.save(dst)
        saved += 1
        print(f"  {word}.png")

print(f"\n保存 {saved} 个词语PNG")
