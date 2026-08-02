import json, os
sd = "server_py/data/char_images"
idx = json.load(open("server_py/data/char_image_index.json", encoding="utf-8"))
for it in idx["items"]:
    if it["char"] == "自由":
        print(f'索引: image={it["image"]}')
        break
print(f'自由.png 存在: {os.path.exists(sd + "/自由.png")}')
print(f'自由.jpg 存在: {os.path.exists(sd + "/自由.jpg")}')
