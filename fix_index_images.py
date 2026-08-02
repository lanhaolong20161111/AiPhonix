"""修复索引：将已重新配图的字指向新 PNG 文件"""
import json, os

INDEX_FILE = "server_py/data/char_image_index.json"
IMAGE_DIR = "server_py/data/char_images"

with open(INDEX_FILE, encoding="utf-8") as f:
    data = json.load(f)

items = data["items"]

# 需要替换的 26 个字（政失败，跳过）
regen_chars = [
    ("啊", "二年级", "上", "写"),
    ("假", "三年级", "上", "认"),
    ("厉", "三年级", "上", "认"),
    ("韵", "三年级", "上", "认"),
    ("掠", "三年级", "上", "认"),
    ("尔", "三年级", "上", "认"),
    ("陌", "三年级", "上", "认"),
    ("委", "三年级", "上", "认"),
    ("屈", "三年级", "上", "认"),
    ("局", "三年级", "上", "认"),
    ("搞", "三年级", "上", "认"),
    ("少", "三年级", "上", "认"),
    ("希", "三年级", "上", "认"),
    ("瘦", "三年级", "上", "认"),
    ("性", "三年级", "上", "认"),
    ("饶", "三年级", "上", "认"),
    ("侧", "三年级", "上", "认"),
    ("贸", "三年级", "上", "认"),
    ("府", "三年级", "上", "认"),
    ("幻", "三年级", "上", "认"),
    ("激", "三年级", "上", "认"),
    ("伟", "三年级", "上", "认"),
    ("贞", "三年级", "上", "认"),
    ("凡", "三年级", "上", "认"),
    ("资", "三年级", "上", "认"),
    ("还", "三年级", "上", "认"),
]

# 政 跳过——生成失败

updated = 0
removed = 0

for char, grade, semester, type_ in regen_chars:
    new_filename = f"{char}_{grade}{semester}.png"
    new_path = os.path.join(IMAGE_DIR, new_filename)

    if not os.path.exists(new_path):
        print(f"  ✗ {char}: 新图片 {new_filename} 不存在，跳过")
        continue

    # 找到该字的所有旧条目
    matching = [(i, it) for i, it in enumerate(items) if it["char"] == char]

    if not matching:
        # 索引中不存在，新增
        items.append({
            "char": char,
            "image": new_filename,
            "grade": grade,
            "semester": semester,
            "type": type_,
        })
        print(f"  + {char}: 新增索引 -> {new_filename}")
        updated += 1
        continue

    # 有旧条目：检查是否已指向新文件
    already_updated = any(it["image"] == new_filename for _, it in matching)
    if already_updated:
        print(f"  ✓ {char}: 已是最新")
        continue

    # 更新第一条 old->new，删除其他重复
    first = True
    for i, it in matching:
        if first:
            print(f"  → {char}: {it['image']} -> {new_filename}")
            items[i]["image"] = new_filename
            first = False
            updated += 1
        else:
            # 删除重复条目
            print(f"  - {char}: 删除重复 {it['image']}")
            items[i] = None  # 标记删除
            removed += 1

# 清理被标记删除的条目
items = [it for it in items if it is not None]
data["items"] = items
data["total"] = len(items)

with open(INDEX_FILE, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\n完成: 更新 {updated} 条, 删除重复 {removed} 条")
print(f"索引总计: {len(items)} 条")
