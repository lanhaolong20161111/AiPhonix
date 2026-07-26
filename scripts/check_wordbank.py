import json
d = json.load(open("app/src/main/assets/wordbank.json", "rb"))

# show tag distribution
from collections import Counter
tag_count = Counter()
for c in d["chars"]:
    for t in c["tags"]:
        tag_count[t] += 1
print("=== 标签分布 ===")
for t, n in tag_count.most_common():
    print(f"  {t:20s}  {n}")

# chars with overlapping grades
print("\n=== 跨年级重叠的字 ===")
seen = set()
for c in d["chars"]:
    grades = [t for t in c["tags"] if t.endswith("上") or t.endswith("下")]
    if len(set(grades)) > 1:
        key = " ".join(grades) + " " + c["text"]
        if key not in seen:
            seen.add(key)
            print(f"  {c['text']} -> {grades}")

# sample overlap: 识+写
print("\n=== 同时标记\"识\"和\"写\"的字 ===")
for c in d["chars"]:
    if "识" in c["tags"] and "写" in c["tags"]:
        print(f"  {c['text']} -> {c['tags']}")
        break
