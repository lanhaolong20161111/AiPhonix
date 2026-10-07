"""用 ARK 视觉模型识别汉字图片并重命名"""
import os, re, base64, time
from volcenginesdkarkruntime import Ark

ARK_API_KEY = os.environ["ARK_API_KEY"]  # 只从环境变量读取；密钥不写入源码
VISION_MODEL = "doubao-vision-pro-32k"  # 视觉模型，可换成 ep-xxx 端点 ID

IMAGE_DIR = r"C:\Users\lhl20\Desktop\word_images"

client = Ark(
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    api_key=ARK_API_KEY,
)

files = sorted(
    [f for f in os.listdir(IMAGE_DIR) if f.lower().endswith(".png")],
    key=lambda x: os.path.getmtime(os.path.join(IMAGE_DIR, x)),
)

# 跳过已重命名的单字文件
files = [f for f in files if not re.match(r"^[\u4e00-\u9fff]{1,3}\.png$", f)]

print(f"共 {len(files)} 张图片待识别")

success = 0
skip = 0
fail = 0

for i, fname in enumerate(files):
    path = os.path.join(IMAGE_DIR, fname)

    # 读取图片并 base64 编码
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    data_url = f"data:image/png;base64,{b64}"

    try:
        resp = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {"type": "text", "text": "这张图片最上方最大的汉字是什么？只输出这一个字，不要任何其他文字。"},
                    ],
                }
            ],
            max_tokens=10,
            temperature=0,
        )
        text = resp.choices[0].message.content.strip()
    except Exception as e:
        fail += 1
        print(f"[{i+1}/{len(files)}] {fname}: API错误 - {e}")
        # 可能欠费了，提前退出
        if "AccountOverdue" in str(e) or "Insufficient" in str(e):
            print("账户欠费，停止")
            break
        time.sleep(1)
        continue

    # 提取纯汉字
    clean = re.sub(r"[^\u4e00-\u9fff]", "", text)
    if not clean:
        fail += 1
        print(f"[{i+1}/{len(files)}] {fname}: 未识别到汉字 (回复: \"{text}\")")
        time.sleep(1)
        continue

    char = clean[0]
    new_name = f"{char}.png"
    new_path = os.path.join(IMAGE_DIR, new_name)

    if not os.path.exists(new_path):
        os.rename(path, new_path)
        success += 1
        print(f"[{i+1}/{len(files)}] {fname} -> {new_name}")
    else:
        print(f"[{i+1}/{len(files)}] {fname}: {char} 已存在，跳过")
        skip += 1

    time.sleep(0.5)

print(f"\n完成: 成功{success}, 跳过{skip}, 失败{fail}")
