"""测试 GLM-5.2 API 调用（通过火山引擎方舟 Ark SDK）

使用方式：
  1. 设置环境变量 ARK_API_KEY
  2. python test_glm52.py

也可直接运行交互式对话模式：
  python test_glm52.py chat
"""

import os
import sys
from volcenginesdkarkruntime import Ark

# 初始化 Ark 客户端
client = Ark(
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    api_key=os.environ.get("ARK_API_KEY"),
)

MODEL = "glm-5-2-260617"


def chat(system_prompt: str, user_prompt: str, max_tokens: int = 2000) -> str:
    """非流式对话"""
    completion = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
    )
    return completion.choices[0].message.content


def main():
    print(f"----- GLM-5.2 非流式测试 -----")
    resp = chat("你是人工智能助手。", "你好，请用一句话介绍你自己。")
    print(resp)
    print()

    print(f"----- GLM-5.2 流式测试 -----")
    stream = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "你是人工智能助手。"},
            {"role": "user", "content": "从1数到5。"},
        ],
        stream=True,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        content = chunk.choices[0].delta.content
        if content:
            print(content, end="", flush=True)
    print()
    print()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "chat":
        print("交互式对话模式（输入 /q 退出）")
        while True:
            user = input("\n>>> ")
            if user.strip() == "/q":
                break
            resp = chat("你是人工智能助手。", user)
            print(resp)
    else:
        main()
