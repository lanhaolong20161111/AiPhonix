"""尝试不同的视觉模型名"""
import os, base64
from volcenginesdkarkruntime import Ark

api_key = os.environ.get("ARK_API_KEY", "")
client = Ark(base_url="https://ark.cn-beijing.volces.com/api/v3", api_key=api_key)

models_to_try = [
    "doubao-vision-pro-32k",
    "doubao-vision-lite-32k",
    "doubao-1-5-vision-pro-32k",
    "doubao-1-5-vision-lite-32k",
    "doubao-1-5-vision-pro-256k",
]

with open("_test_left.png", "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")

for model in models_to_try:
    try:
        resp = client.chat.completions.create(
            model=model,
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
        text = resp.choices[0].message.content.strip()
        print(f"✅ {model}: {text}")
        break
    except Exception as e:
        print(f"❌ {model}: {str(e)[:100]}")
