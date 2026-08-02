import json, os, shutil
wd = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"
chars = ["滥","善","其","替","设","甫","既","哩","即"]

# 复制文件
for char in chars:
    src = os.path.join(wd, f"{char}.png")
    shutil.copy2(src, os.path.join(sd, f"{char}.png"))

# 更新索引
idx = json.load(open("server_py/data/char_image_index.json", encoding="utf-8"))
for it in idx["items"]:
    if it["char"] in chars:
        it["image"] = f"{it['char']}.png"
        it["grade"] = "二年级"
        it["semester"] = "下"
        it["type"] = "认"
json.dump(idx, open("server_py/data/char_image_index.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# 更新反馈
fb = json.load(open("server_py/data/char_image_feedback.json", encoding="utf-8"))
fb_map = {r["char"]: r for r in fb}
for char in chars:
    if char in fb_map:
        fb_map[char]["needs_regen"] = False
json.dump(fb, open("server_py/data/char_image_feedback.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print("9 个字部署完成")
