import json, os
with open("server_py/data/char_image_index.json", encoding="utf-8") as f:
    idx = json.load(f)
words = ["新奇","任何","事情","怎样","以前","灵巧","开始","决心","从此","忽然","启发","号召","民众","自由","道理","根本","果然","提供","百姓","必须","反而","仍然","治服","继续","采用","奔波","平常","平时","难道"]
imgdir = "server_py/data/char_images"
for w in words:
    it = next((x for x in idx["items"] if x["char"]==w and x.get("grade")=="二年级" and x.get("semester")=="下" and x.get("type")=="词"), None)
    fname = it["image"] if it else f"{w}.jpg"
    exists = os.path.exists(os.path.join(imgdir, fname))
    found = "✅ 存在" if exists else "❌ 无文件"
    print(f"  {w} -> {fname} {found}")
