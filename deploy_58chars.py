"""部署 word_images 中的 58 个单字到服务器"""
import json, os, shutil

wd = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"
idx_path = "server_py/data/char_image_index.json"
fb_path = "server_py/data/char_image_feedback.json"

chars = sorted([f.replace(".png","") for f in os.listdir(wd) if f.endswith(".png") and len(f.replace(".png","")) <= 3])
print(f"待部署: {len(chars)} 个字符")

with open(idx_path, encoding="utf-8") as f:
    idx = json.load(f)
with open(fb_path, encoding="utf-8") as f:
    fb = json.load(f)
fb_map = {it["char"]: it for it in fb}

copied = 0
updated_idx = 0
updated_fb = 0
for char in chars:
    src = os.path.join(wd, f"{char}.png")
    dst = os.path.join(sd, f"{char}.png")
    shutil.copy2(src, dst)
    copied += 1

    # 更新索引
    found = False
    for it in idx["items"]:
        if it["char"] == char:
            it["image"] = f"{char}.png"
            it["grade"] = "二年级"
            it["semester"] = "下"
            it["type"] = "写"
            found = True
            updated_idx += 1
            break
    if not found:
        idx["items"].append({
            "char": char, "image": f"{char}.png",
            "grade": "二年级", "semester": "下", "type": "写"
        })
        idx["total"] = len(idx["items"])

    # 更新反馈
    if char in fb_map:
        fb_map[char]["needs_regen"] = False
        updated_fb += 1
    else:
        fb.append({"char": char, "grade": "二年级", "semester": "下",
                     "type": "写", "needs_regen": False})

with open(idx_path, "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
with open(fb_path, "w", encoding="utf-8") as f:
    json.dump(fb, f, ensure_ascii=False, indent=2)

print(f"复制 {copied} 个, 更新索引 {updated_idx} 条, 更新反馈 {updated_fb} 条")
print(f"索引总条数: {idx['total']}")
