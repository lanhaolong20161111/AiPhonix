import json, os
sd = "server_py/data/char_images"
idx = json.load(open("server_py/data/char_image_index.json", encoding="utf-8"))
chars = ["滥","善","其","替","设","甫","既","哩","即"]
for c in chars:
    it = next((x for x in idx["items"] if x["char"] == c), None)
    img = it["image"] if it else "未找到"
    exists = os.path.exists(os.path.join(sd, img))
    print(f"  {c}: image={img}, 文件存在={exists}")
