"""部署 69 个词语到服务器"""
import json, os, shutil

wd = r"C:\Users\lhl20\Desktop\word_images"
sd = "server_py/data/char_images"
idx_path = "server_py/data/char_image_index.json"
fb_path = "server_py/data/char_image_feedback.json"

# 需要部署的词（needs_regen 中的词语）
needs_words = [
    # 二年级上词 (11)
    "那么", "自言自语", "常常", "来回", "为了", "由于",
    "一切", "消失", "怎么", "但是", "更加",
    # 三年级上词 (58)
    "频频", "准备", "旁边", "安心", "吃力", "漂亮", "意思", "因此",
    "阁楼", "妥当", "声明", "普通", "让步", "条件", "要是", "最好",
    "答应", "来得及", "当然", "刚才", "知觉", "介绍", "主旨", "占领",
    "乏力", "一本正经", "发展", "海滨", "水平线", "来来往往",
    "散发", "密密层层", "严严实实", "视线", "山谷", "充满",
    "轻快", "精神", "千姿百态", "无穷", "奥秘", "再三",
    "难得", "落后", "地位", "环节", "难度", "陆续",
    "血丝", "匆匆", "转告", "连续", "怒目圆睁", "眨眼",
    "眼眶", "耳闻目睹", "迟到", "凌乱",
]

with open(idx_path, encoding="utf-8") as f:
    idx = json.load(f)
with open(fb_path, encoding="utf-8") as f:
    fb = json.load(f)
fb_map = {r["char"]: r for r in fb}

copied = 0
idx_updated = 0
fb_updated = 0
for word in needs_words:
    src = os.path.join(wd, f"{word}.png")
    dst = os.path.join(sd, f"{word}.png")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        copied += 1
    else:
        print(f"  ! {word}.png 不存在于 word_images")
        continue

    for it in idx["items"]:
        if it["char"] == word:
            it["image"] = f"{word}.png"
            if word in {"那么","自言自语","常常","来回","为了","由于","一切","消失","怎么","但是","更加"}:
                it["grade"] = "二年级"
                it["semester"] = "上"
            else:
                it["grade"] = "三年级"
                it["semester"] = "上"
            it["type"] = "词"
            idx_updated += 1
            break

    if word in fb_map:
        fb_map[word]["needs_regen"] = False
        fb_updated += 1

with open(idx_path, "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
with open(fb_path, "w", encoding="utf-8") as f:
    json.dump(fb, f, ensure_ascii=False, indent=2)

print(f"复制 {copied}, 更新索引 {idx_updated}, 更新反馈 {fb_updated}")
print(f"索引总条数: {idx['total']}")
