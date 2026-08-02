"""删除旧 jpg，重命名新 png 为 {char}.png"""
import json, os

regen_chars = [
    ("啊","二年级","上","写"), ("假","三年级","上","认"), ("厉","三年级","上","认"),
    ("韵","三年级","上","认"), ("掠","三年级","上","认"), ("尔","三年级","上","认"),
    ("陌","三年级","上","认"), ("委","三年级","上","认"), ("屈","三年级","上","认"),
    ("局","三年级","上","认"), ("搞","三年级","上","认"), ("少","三年级","上","认"),
    ("希","三年级","上","认"), ("瘦","三年级","上","认"), ("性","三年级","上","认"),
    ("饶","三年级","上","认"), ("侧","三年级","上","认"), ("贸","三年级","上","认"),
    ("府","三年级","上","认"), ("幻","三年级","上","认"), ("激","三年级","上","认"),
    ("伟","三年级","上","认"), ("贞","三年级","上","认"), ("凡","三年级","上","认"),
    ("资","三年级","上","认"), ("还","三年级","上","认"),
]

BASE = "server_py/data/char_images"
INDEX = "server_py/data/char_image_index.json"

for char, grade, semester, type_ in regen_chars:
    old_jpg = os.path.join(BASE, f"{char}.jpg")
    new_png = os.path.join(BASE, f"{char}_{grade}{semester}.png")

    if os.path.exists(old_jpg):
        os.remove(old_jpg)
        print(f"删除: {char}.jpg")

    if not os.path.exists(new_png):
        print(f"跳过(无新图): {char}")
        continue

    target = os.path.join(BASE, f"{char}.png")
    os.replace(new_png, target)
    print(f"重命名: {char}_{grade}{semester}.png -> {char}.png")

# 更新索引
with open(INDEX, encoding="utf-8") as f:
    data = json.load(f)

items = data["items"]
updated = 0
for it in items:
    fname = it["image"]
    if fname.endswith("上.png") or fname.endswith("下.png"):
        newname = f"{it['char']}.png"
        if fname != newname:
            oldname = fname
            it["image"] = newname
            updated += 1
            print(f"索引: {oldname} -> {newname}")

with open(INDEX, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\n完成: 索引更新 {updated} 条")
