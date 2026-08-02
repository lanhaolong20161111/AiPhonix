"""部署新图片到服务器"""
import json, os, shutil

WORD_DIR = r"C:\Users\lhl20\Desktop\word_images"
IMG_DIR = "server_py/data/char_images"
IDX_PATH = "server_py/data/char_image_index.json"
FB_PATH = "server_py/data/char_image_feedback.json"

# 新图片
new_chars = {}
for f in os.listdir(WORD_DIR):
    if f.endswith(".png") and len(f.replace(".png", "")) <= 3:
        char = f.replace(".png", "")
        new_chars[char] = os.path.join(WORD_DIR, f)
print(f"新图片: {len(new_chars)} 个字")
print("字列表:", " ".join(sorted(new_chars.keys())))

# 加载索引
with open(IDX_PATH, encoding="utf-8") as f:
    idx = json.load(f)

# 加载反馈
with open(FB_PATH, encoding="utf-8") as f:
    fb = json.load(f)
fb_map = {item["char"]: item for item in fb}

# 统计
update_count = 0
new_entry_count = 0
existing_idx_chars = set(it["char"] for it in idx["items"])

for char in sorted(new_chars.keys()):
    src = new_chars[char]
    dst = os.path.join(IMG_DIR, f"{char}.png")

    # 复制图片
    shutil.copy2(src, dst)
    print(f"  复制: {char}.png")

    if char in existing_idx_chars:
        # 更新已有条目
        for it in idx["items"]:
            if it["char"] == char:
                it["image"] = f"{char}.png"
                break
        update_count += 1
    else:
        # 新增条目（按三年级上写）
        new_entry = {
            "char": char,
            "image": f"{char}.png",
            "grade": "三年级",
            "semester": "上",
            "type": "写"
        }
        idx["items"].append(new_entry)
        idx["total"] = len(idx["items"])
        new_entry_count += 1

    # 更新反馈
    if char in fb_map:
        fb_map[char]["needs_regen"] = False
    else:
        fb.append({
            "char": char,
            "grade": "三年级",
            "semester": "上",
            "type": "写",
            "needs_regen": False,
            "original_version": None,
            "feedback": "",
            "timestamp": "2026-07-29T14:00:00"
        })

# 写回
with open(IDX_PATH, "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
with open(FB_PATH, "w", encoding="utf-8") as f:
    json.dump(fb, f, ensure_ascii=False, indent=2)

print(f"\n完成: 更新 {update_count} 个旧条目, 新增 {new_entry_count} 个条目")
print(f"索引总条数: {len(idx['items'])}")
