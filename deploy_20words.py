"""部署 20 个词语到服务器"""
import json, os, shutil

wd = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"
idx_path = "server_py/data/char_image_index.json"
fb_path = "server_py/data/char_image_feedback.json"

words = ["新奇","任何","事情","怎样","以前","灵巧","开始","决心","从此",
         "忽然","启发","号召","民众","自由","道理","根本","果然","提供","百姓","必须"]

with open(idx_path, encoding="utf-8") as f:
    idx = json.load(f)
with open(fb_path, encoding="utf-8") as f:
    fb = json.load(f)
fb_map = {it["char"]: it for it in fb}

for w in words:
    src = os.path.join(wd, f"{w}.png")
    if not os.path.exists(src):
        print(f"  {w}.png 不存在，跳过")
        continue
    dst = os.path.join(sd, f"{w}.png")
    shutil.copy2(src, dst)

    for it in idx["items"]:
        if it["char"] == w:
            it["image"] = f"{w}.png"
            it["grade"] = "二年级"
            it["semester"] = "下"
            it["type"] = "词"
            break

    if w in fb_map:
        fb_map[w]["needs_regen"] = False

with open(idx_path, "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
with open(fb_path, "w", encoding="utf-8") as f:
    json.dump(fb, f, ensure_ascii=False, indent=2)

print(f"部署 {len(words)} 个完成")
