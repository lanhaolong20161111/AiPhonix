import json
with open("server_py/data/char_image_index.json", encoding="utf-8") as f:
    idx = json.load(f)
items = [it for it in idx["items"] if it.get("grade")=="二年级" and it.get("semester")=="下" and it.get("type")=="词"]
print(f"二年级下词语索引条数: {len(items)}")
for it in items:
    print(f"  {it['char']} -> {it['image']}")
