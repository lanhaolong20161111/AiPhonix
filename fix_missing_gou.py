"""补部署漏掉的勾"""
import json, os, shutil

WORD_DIR = r"C:\Users\lhl20\Desktop\word_images"
IMG_DIR = "server_py/data/char_images"
IDX_PATH = "server_py/data/char_image_index.json"

chars_to_fix = ["勾"]

for char in chars_to_fix:
    src = os.path.join(WORD_DIR, f"{char}.png")
    if not os.path.exists(src):
        print(f"{char}.png 不在 word_images 中")
        continue
    
    dst = os.path.join(IMG_DIR, f"{char}.png")
    if os.path.exists(dst):
        old_jpg = os.path.join(IMG_DIR, f"{char}.jpg")
        if os.path.exists(old_jpg):
            os.remove(old_jpg)
            print(f"  删除旧: {char}.jpg")
        print(f"{char}.png 已存在, 跳过复制")
    else:
        shutil.copy2(src, dst)
        old_jpg = os.path.join(IMG_DIR, f"{char}.jpg")
        if os.path.exists(old_jpg):
            os.remove(old_jpg)
            print(f"  删除旧: {char}.jpg")
        print(f"  复制: {char}.png")

    # 更新索引
    with open(IDX_PATH, encoding="utf-8") as f:
        idx = json.load(f)
    for it in idx["items"]:
        if it["char"] == char:
            it["image"] = f"{char}.png"
            print(f"  索引更新: 勾.jpg -> 勾.png")
            break
    with open(IDX_PATH, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=2)

    # 更新反馈标记
    fb_path = "server_py/data/char_image_feedback.json"
    with open(fb_path, encoding="utf-8") as f:
        fb = json.load(f)
    found = False
    for item in fb:
        if item["char"] == char:
            item["needs_regen"] = False
            found = True
            print(f"  反馈标记: {char} needs_regen=false")
            break
    if not found:
        fb.append({
            "char": char, "grade": "三年级", "semester": "上",
            "type": "写", "needs_regen": False
        })
    with open(fb_path, "w", encoding="utf-8") as f:
        json.dump(fb, f, ensure_ascii=False, indent=2)

print("\n完成")
