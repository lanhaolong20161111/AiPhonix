"""清理索引中的重复旧条目"""
import json

with open("server_py/data/char_image_index.json", encoding="utf-8") as f:
    data = json.load(f)

items = data["items"]

# 收集所有新格式 PNG 条目
new_keys = set()
for it in items:
    if "_" in it["image"] and it["image"].endswith(".png"):
        grade = it.get("grade", "")
        semester = it.get("semester", "")
        new_keys.add((it["char"], grade, semester, it.get("type", "")))

before = len(items)
filtered = []
removed = []

for it in items:
    key = (it["char"], it.get("grade", ""), it.get("semester", ""), it.get("type", ""))
    if key in new_keys and it["image"].endswith(".jpg"):
        removed.append(it["char"])
    else:
        filtered.append(it)

data["items"] = filtered
data["total"] = len(filtered)

with open("server_py/data/char_image_index.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"删除重复旧条目: {len(removed)} 条")
print(f"索引: {before} -> {len(filtered)}")
print(f"删除的字: {removed}")
