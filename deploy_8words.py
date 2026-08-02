"""部署 8 个词语到服务器"""
import json, os, shutil

wd = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"
idx_path = "server_py/data/char_image_index.json"
fb_path = "server_py/data/char_image_feedback.json"

words = ["治服","继续","采用","奔波","平常","平时","反而","仍然"]

with open(idx_path, encoding="utf-8") as f:
    idx = json.load(f)
with open(fb_path, encoding="utf-8") as f:
    fb = json.load(f)
fb_map = {it["char"]: it for it in fb}

for w in words:
    src = os.path.join(wd, f"{w}.png")
    dst = os.path.join(sd, f"{w}.png")
    shutil.copy2(src, dst)

    # 更新索引
    found = False
    for it in idx["items"]:
        if it["char"] == w:
            it["image"] = f"{w}.png"
            it["grade"] = "二年级"
            it["semester"] = "下"
            it["type"] = "词"
            found = True
            break
    if not found:
        idx["items"].append({"char": w, "image": f"{w}.png", "grade": "二年级",
                             "semester": "下", "type": "词"})
        idx["total"] = len(idx["items"])

    # 更新反馈
    if w in fb_map:
        fb_map[w]["needs_regen"] = False
    else:
        fb.append({"char": w, "grade": "二年级", "semester": "下", "type": "词", "needs_regen": False})

with open(idx_path, "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
with open(fb_path, "w", encoding="utf-8") as f:
    json.dump(fb, f, ensure_ascii=False, indent=2)

print(f"部署 {len(words)} 个词语完成")
print(f"索引总数: {idx['total']}")
