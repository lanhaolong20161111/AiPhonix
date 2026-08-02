import json, os

wd = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"

# word_images 中的所有单字
chars = [f.replace(".png","") for f in os.listdir(wd) if f.endswith(".png") and len(f.replace(".png","")) <= 3]
print(f"word_images 中 {len(chars)} 个单字")

# 哪些还没有 png 在服务器端
missing = []
for c in chars:
    if not os.path.exists(os.path.join(sd, f"{c}.png")):
        # 找有没有旧 jpg
        has_jpg = os.path.exists(os.path.join(sd, f"{c}.jpg"))
        missing.append((c, has_jpg))

print(f"服务器端缺少 png 的: {len(missing)} 个")
for c, has_jpg in missing:
    print(f"  {c} (有jpg={has_jpg})")
