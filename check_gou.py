import os
d = "server_py/data/char_images"
# 找所有 png 文件数量
pngs = [f for f in os.listdir(d) if f.endswith(".png")]
print(f"服务器 char_images 中共 {len(pngs)} 个 png 文件")
# 检查特定文件
for char in ["勾", "政"]:
    png = os.path.join(d, f"{char}.png")
    jpg = os.path.join(d, f"{char}.jpg")
    print(f"{char}.png: {os.path.exists(png)}")
    print(f"{char}.jpg: {os.path.exists(jpg)}")

# 看看 word_images 目录
wd = r"C:\Users\lhl20\Desktop\word_images"
print(f"\nword_images 中的勾.png: {os.path.exists(os.path.join(wd, '勾.png'))}")
print(f"word_images 中的政.png: {os.path.exists(os.path.join(wd, '政.png'))}")
