"""用 doubao-seedream-4-5-251128 生成 9 个字的配图"""
import os, base64, time, sys
from volcenginesdkarkruntime import Ark

api_key = os.environ.get("ARK_API_KEY", "")
if not api_key:
    print("请设置 ARK_API_KEY")
    sys.exit(1)

client = Ark(base_url="https://ark.cn-beijing.volces.com/api/v3", api_key=api_key)

chars = ["滥","善","其","替","设","甫","既","哩","即"]

prompt_template = '为汉字「{char}」配一张儿童插图，卡通风格，色彩明亮，简洁清晰，白色背景，上面是汉字，中间是插图，下方是一句话，目标年龄1-3年级小学生做字卡认字用'

out_dir = r"C:\Users\lhl20\Desktop\word_images"
os.makedirs(out_dir, exist_ok=True)

for char in chars:
    dst = os.path.join(out_dir, f"{char}.png")
    if os.path.exists(dst):
        print(f"  {char}.png 已存在，跳过")
        continue

    prompt = prompt_template.format(char=char)
    print(f"  生成 {char}...")
    sys.stdout.flush()

    try:
        resp = client.images.generate(
            model="doubao-seedream-4-5-251128",
            prompt=prompt,
            sequential_image_generation="disabled",
            response_format="url",
            size="2K",
            stream=False,
            watermark=True
        )
        url = resp.data[0].url
        print(f"    下载中...")
        import requests
        img_data = requests.get(url, timeout=60).content
        with open(dst, "wb") as f:
            f.write(img_data)
        print(f"    ✅ {char}.png")
    except Exception as e:
        print(f"    ❌ {char}: {e}")

    time.sleep(1)

print("\n完成")
