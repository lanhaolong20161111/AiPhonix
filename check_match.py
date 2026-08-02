import json, os

# 二年级下写需配图的字
with open("server_py/data/char_image_feedback.json", encoding="utf-8") as f:
    fb = json.load(f)
need = [r["char"] for r in fb if r.get("needs_regen") and r.get("grade")=="二年级" and r.get("semester")=="下" and r.get("type")=="写"]
print(f"二年级下写需配图: {len(need)} 个")

# word_images 中有的字
wd = r"C:\Users\lhl20\Desktop\word_images"
have = set(f.replace(".png","") for f in os.listdir(wd) if f.endswith(".png") and len(f.replace(".png","")) <= 3)
match = [c for c in need if c in have]
print(f"word_images 中有匹配的: {len(match)} 个")
print(" ".join(match) if match else "无")
