"""
为 char_image_feedback.json 中 needs_regen=true 的字重新生成配图。
使用 Doubao Seedream 4.5 (doubao-seedream-4-5-251128) 模型。
"""
import json, os, time, requests, sys
from pathlib import Path

# === 配置 ===
ARK_API_KEY = os.environ.get("ARK_API_KEY", "")
if not ARK_API_KEY:
    print("请设置环境变量 ARK_API_KEY")
    sys.exit(1)

MODEL = "doubao-seedream-4-5-251128"
BASE_DIR = Path(__file__).parent / "server_py" / "data"
FEEDBACK_FILE = BASE_DIR / "char_image_feedback.json"
INDEX_FILE = BASE_DIR / "char_image_index.json"
IMAGE_DIR = BASE_DIR / "char_images"
IMAGE_DIR.mkdir(parents=True, exist_ok=True)

# === 加载反馈 ===
with open(FEEDBACK_FILE, encoding="utf-8") as f:
    feedbacks = json.load(f)

chars_to_regen = [fb for fb in feedbacks if fb.get("needs_regen", False)]
print(f"需要重新配图的字数: {len(chars_to_regen)}")

# === 加载索引 ===
with open(INDEX_FILE, encoding="utf-8") as f:
    index_data = json.load(f)
index_items = index_data["items"]

# === 按字生成图片（不写提示词，让豆包自己发挥） ===
# 只传汉字本身，让模型自行决定画面

# === ARK API 调用 ===
from volcenginesdkarkruntime import Ark

client = Ark(
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    api_key=ARK_API_KEY,
)

success = 0
fail = 0

for fb in chars_to_regen:
    char = fb["char"]
    grade = fb["grade"]
    semester = fb["semester"]
    type_ = fb["type"]

    prompt = f"为汉字「{char}」配一张儿童插图，卡通风格，色彩明亮，简洁清晰，白色背景，上面是汉字，中间是插图，下方是一句话，目标年龄1-3年级小学生做字卡认字用"
    filename = f"{char}_{grade}{semester}.png"
    filepath = IMAGE_DIR / filename

    # 跳过已存在的图片
    if filepath.exists():
        print(f"\n[{success+1}/{len(chars_to_regen)}] {char} ({grade}{semester}) — 已存在，跳过")
        # 只在索引中缺失时才补充
        found = any(
            item["char"] == char and item["grade"] == grade and item["semester"] == semester
            for item in index_items
        )
        if not found:
            index_items.append({
                "char": char, "image": filename, "grade": grade,
                "semester": semester, "type": type_,
            })
            index_data["total"] = len(index_items)
        success += 1
        continue

    print(f"\n[{success+1}/{len(chars_to_regen)}] {char} ({grade}{semester}) → {filename}")
    print(f"  Prompt: {prompt[:80]}...")

    try:
        resp = client.images.generate(
            model=MODEL,
            prompt=prompt,
            size="2K",
            stream=False,
            watermark=False,
        )
        image_url = resp.data[0].url
        print(f"  URL: {image_url[:60]}...")

        # 下载图片
        img_resp = requests.get(image_url, timeout=60)
        if img_resp.status_code == 200:
            with open(filepath, "wb") as f:
                f.write(img_resp.content)
            print(f"  ✓ 已保存 ({len(img_resp.content)} bytes)")

            # 更新索引
            # 查找同字同年级同学期的已有条目
            found = False
            for item in index_items:
                if item["char"] == char and item["grade"] == grade and item["semester"] == semester:
                    old = item["image"]
                    item["image"] = filename
                    print(f"  → 索引更新: {old} → {filename}")
                    found = True
                    break
            if not found:
                index_items.append({
                    "char": char,
                    "image": filename,
                    "grade": grade,
                    "semester": semester,
                    "type": type_,
                })
                print(f"  → 索引新增")
                index_data["total"] = len(index_items)

            success += 1
        else:
            print(f"  ✗ 下载失败: HTTP {img_resp.status_code}")
            fail += 1

    except Exception as e:
        print(f"  ✗ 生成失败: {e}")
        fail += 1

    # 避免 API 限流
    time.sleep(2)

# === 保存更新后的索引 ===
with open(INDEX_FILE, "w", encoding="utf-8") as f:
    json.dump(index_data, f, ensure_ascii=False, indent=2)
print(f"\n===== 完成: 成功{success}, 失败{fail} =====")
print(f"索引已更新: {INDEX_FILE}")
