"""部署 word_images 中重命名后的字到服务器"""
import json, os, shutil

wd = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"
idx_path = "server_py/data/char_image_index.json"
fb_path = "server_py/data/char_image_feedback.json"

chars = ["碧", "绿", "寻", "原", "惊", "邓", "植", "昨", "诗"]

with open(idx_path, encoding="utf-8") as f:
    idx = json.load(f)
with open(fb_path, encoding="utf-8") as f:
    fb = json.load(f)
fb_map = {it["char"]: it for it in fb}

for char in chars:
    src = os.path.join(wd, f"{char}.png")
    if not os.path.exists(src):
        print(f"{char}.png 不存在，跳过")
        continue

    dst = os.path.join(sd, f"{char}.png")
    shutil.copy2(src, dst)
    print(f"复制: {char}.png")

    # 更新索引
    found = False
    for it in idx["items"]:
        if it["char"] == char:
            it["image"] = f"{char}.png"
            it["grade"] = "二年级"
            it["semester"] = "下"
            it["type"] = "写"
            found = True
            break
    if not found:
        idx["items"].append({
            "char": char, "image": f"{char}.png",
            "grade": "二年级", "semester": "下", "type": "写"
        })
        idx["total"] = len(idx["items"])

    # 更新反馈标记
    if char in fb_map:
        fb_map[char]["needs_regen"] = False
    else:
        fb.append({
            "char": char, "grade": "二年级", "semester": "下",
            "type": "写", "needs_regen": False
        })

with open(idx_path, "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
with open(fb_path, "w", encoding="utf-8") as f:
    json.dump(fb, f, ensure_ascii=False, indent=2)

print(f"\n完成！索引总条数: {len(idx['items'])}")
