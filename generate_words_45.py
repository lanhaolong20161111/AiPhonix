"""用 Doubao-Seedream-4.5 生成二年级下词语配图"""
import os, json, base64, time
from volcenginesdkarkruntime import Ark

WORDS = [
    "原来", "碧空如洗", "格外", "引人注目", "小心", "昨天", "也许", "应该", "弱小",
    "神州", "中华", "山川", "长江", "先人", "转眼", "有关", "烤鸭", "季节", "出色",
    "不时", "一直", "拼音", "劝告", "时候", "神情", "愿意", "为难", "立刻", "突然",
    "难为情", "迎面", "天然", "向导", "北极星", "特别", "主要", "方便", "直接", "实在",
    "通常", "似的", "遇到", "一定", "经常", "人家", "决定", "工夫", "终于"
]

PROMPT_TEMPLATE = '为词语「{word}」配一张儿童插图，卡通风格，色彩明亮，简洁清晰，白色背景，上面显示词语，中间是插图，下方是一句话，目标年龄1-3年级小学生做字卡认字用'

MODEL = "doubao-seedream-4-5-251128"
IMAGE_DIR = "server_py/data/char_images"
IDX_PATH = "server_py/data/char_image_index.json"
FB_PATH = "server_py/data/char_image_feedback.json"
GRADE = "二年级"
SEMESTER = "下"
TYPE = "词"

# 初始化 ARK 客户端
api_key = os.environ.get("ARK_API_KEY", "6acabf09-8736-4f09-a573-f12b64a901e4")
client = Ark(base_url="https://ark.cn-beijing.volces.com/api/v3", api_key=api_key)

# 加载索引
with open(IDX_PATH, encoding="utf-8") as f:
    idx = json.load(f)
idx_map = {it["char"]: it for it in idx["items"]}

# 加载反馈
with open(FB_PATH, encoding="utf-8") as f:
    fb = json.load(f)
fb_map = {it["char"]: it for it in fb}

generated = 0
skipped = 0
failed = 0

for word in WORDS:
    fname = f"{word}.png"
    dst = os.path.join(IMAGE_DIR, fname)

    # 跳过已有图片
    if os.path.exists(dst):
        skipped += 1
        print(f"[跳过] {word} 已存在")
        # 更新反馈标记
        if word in fb_map:
            fb_map[word]["needs_regen"] = False
        continue

    prompt = PROMPT_TEMPLATE.format(word=word)
    print(f"[{generated+1}/{len(WORDS)}] 生成: {word}")
    print(f"  Prompt: {prompt}")

    try:
        resp = client.images.generate(
            model=MODEL,
            prompt=prompt,
            size="2K",
            stream=False,
        )
        img_url = resp.data[0].url
    except Exception as e:
        failed += 1
        print(f"  ✗ 生成失败: {e}")
        if "AccountOverdue" in str(e) or "Insufficient" in str(e):
            print("  账户欠费，停止")
            break
        time.sleep(2)
        continue

    # 下载并保存
    try:
        import requests as req
        r = req.get(img_url, timeout=60)
        with open(dst, "wb") as f:
            f.write(r.content)
        print(f"  ✓ 已保存: {fname}")
    except Exception as e:
        failed += 1
        print(f"  ✗ 下载失败: {e}")
        time.sleep(2)
        continue

    # 更新索引
    if word in idx_map:
        idx_map[word]["image"] = fname
    else:
        new_entry = {"char": word, "image": fname, "grade": GRADE, "semester": SEMESTER, "type": TYPE}
        idx["items"].append(new_entry)
        idx_map[word] = new_entry
    idx["total"] = len(idx["items"])

    # 更新反馈标记
    if word in fb_map:
        fb_map[word]["needs_regen"] = False

    generated += 1
    time.sleep(1)  # 避免API限流

# 写回索引
with open(IDX_PATH, "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
print(f"  索引已更新: {len(idx['items'])} 条")

# 写回反馈
with open(FB_PATH, "w", encoding="utf-8") as f:
    json.dump(fb, f, ensure_ascii=False, indent=2)

print(f"\n完成: 生成{generated}, 跳过{skipped}, 失败{failed}")
