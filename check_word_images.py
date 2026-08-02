"""检查三年级上写字图片状态"""
import json, os

# 加载索引
with open("server_py/data/char_image_index.json", encoding="utf-8") as f:
    data = json.load(f)

# 三年级上写
items = [it for it in data["items"] if it.get("grade") == "三年级" and it.get("semester") == "上" and it.get("type") == "写"]
print(f"三年级上写 索引中条数: {len(items)}")
jpg_count = sum(1 for it in items if it["image"].endswith(".jpg"))
png_count = sum(1 for it in items if it["image"].endswith(".png"))
print(f"其中 jpg 图片: {jpg_count}, png 图片: {png_count}")

# 新图片目录中的字
word_dir = r"C:\Users\lhl20\Desktop\word_images"
new_chars = set(f.replace(".png", "") for f in os.listdir(word_dir) if f.endswith(".png") and len(f.replace(".png","")) <= 3)

# 索引中的字
idx_chars = set(it["char"] for it in items)
missing = new_chars - idx_chars
extra = idx_chars - new_chars
overlap = new_chars & idx_chars

print(f"\n新图片字数: {len(new_chars)}")
print(f"索引中已有的字数: {len(idx_chars)}")
print(f"新图有但索引没有的字: {len(missing)}")
for c in sorted(missing):
    print(f"  {c}")
print(f"\n索引有但新图没有的字: {len(extra)}")
for c in sorted(extra):
    print(f"  {c}")
print(f"\n重叠字数: {len(overlap)}")

# 检查重叠字中哪些是 jpg（需要替换）
need_replace = [c for c in overlap if any(it["image"].endswith(".jpg") for it in items if it["char"] == c)]
print(f"需要替换旧 jpg 的字: {len(need_replace)}")
for c in sorted(need_replace):
    print(f"  {c}")
