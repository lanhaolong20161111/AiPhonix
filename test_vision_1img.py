"""用 ARK API 识别左右半图上的文字"""
import os, base64
from PIL import Image
from volcenginesdkarkruntime import Ark

api_key = os.environ.get("ARK_API_KEY")
if not api_key:
    print("请设置 ARK_API_KEY")
    exit(1)

client = Ark(base_url="https://ark.cn-beijing.volces.com/api/v3", api_key=api_key)

# 测试第一张图
src_dir = r"C:\Users\lhl20\Desktop\word_images"
path = os.path.join(src_dir, "儿童汉字插图设计 (1).png")
img = Image.open(path)
w, h = img.size
print(f"图片尺寸: {w}x{h}")

# 切左右并保存
left = img.crop((0, 0, w//2, h))
right = img.crop((w//2, 0, w, h))
left.save("_test_left.png")
right.save("_test_right.png")

# 用 ARK 识别
def recognize(img_path, side):
    with open(img_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    try:
        resp = client.chat.completions.create(
            model="doubao-vision-pro-32k-241028",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": "这张图片最上方最大的汉字是什么？只输出这1-2个汉字本身，不要任何其他文字。"},
                ],
            }],
            max_tokens=10,
            temperature=0,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return f"ERR: {e}"

print(f"左半: {recognize('_test_left.png', '左')}")
print(f"右半: {recognize('_test_right.png', '右')}")
