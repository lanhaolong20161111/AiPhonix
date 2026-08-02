"""部署 76 个二年级上写单字到服务器"""
import json, os, shutil

wd = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"
idx_path = "server_py/data/char_image_index.json"
fb_path = "server_py/data/char_image_feedback.json"

# 从 word_images 收集所有单字文件
chars = sorted(set(
    f.replace(".png","") for f in os.listdir(wd)
    if f.endswith(".png") and len(f.replace(".png","")) <= 2
))
print(f"发现 {len(chars)} 个单字文件")

with open(idx_path, encoding="utf-8") as f:
    idx = json.load(f)
with open(fb_path, encoding="utf-8") as f:
    fb = json.load(f)
fb_map = {r["char"]: r for r in fb}

copied = 0
idx_updated = 0
fb_updated = 0
for char in chars:
    src = os.path.join(wd, f"{char}.png")
    dst = os.path.join(sd, f"{char}.png")
    shutil.copy2(src, dst)
    copied += 1

    # 更新索引
    for it in idx["items"]:
        if it["char"] == char:
            it["image"] = f"{char}.png"
            it["grade"] = "二年级"
            it["semester"] = "上"
            it["type"] = "写"
            idx_updated += 1
            break

    # 更新反馈
    if char in fb_map:
        fb_map[char]["needs_regen"] = False
        fb_updated += 1

with open(idx_path, "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
with open(fb_path, "w", encoding="utf-8") as f:
    json.dump(fb, f, ensure_ascii=False, indent=2)

print(f"复制 {copied}, 更新索引 {idx_updated}, 更新反馈 {fb_updated}")
print(f"索引总条数: {idx['total']}")
