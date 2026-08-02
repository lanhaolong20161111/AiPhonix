import json
with open("server_py/data/char_image_feedback.json", encoding="utf-8") as f:
    fb = json.load(f)
# 按年级学期分类统计
from collections import Counter
counter = Counter()
for r in fb:
    if r.get("needs_regen"):
        key = f"{r.get('grade','?')}{r.get('semester','?')}({r.get('type','?')})"
        counter[key] += 1
print("需配图按分类:")
for k, c in counter.most_common():
    print(f"  {k}: {c}个")

# 列出二年级下词语
print("\n二年级下词语:")
for r in fb:
    if r.get("needs_regen") and r.get("grade")=="二年级" and r.get("semester")=="下" and r.get("type")=="词":
        print(f"  {r['char']}")
