"""
抖音视频下载工具

使用方法:
1. 用 Chrome/Edge 打开 https://www.douyin.com/video/7598940317417506811
2. 确保已经登录
3. 按 F12 打开开发者工具
4. 在 Console 或 Application → Cookies 中复制所有 cookie 字符串
5. 粘贴到下面的提示中
"""

import json
import os
import re
import sys

import requests

VIDEO_ID = "7598940317417506811"
OUTPUT = os.path.join(os.path.dirname(__file__), "..", "english_24_letters.mp4")


def extract_video_url(html: str) -> str | None:
    """从抖音页面 HTML 提取视频地址"""
    patterns = [
        # 视频源在 video 标签里
        r'<video[^>]*src=["\']([^"\']+)["\']',
        # 在 JavaScript 变量 video_url 中
        r'"video_url"[^:]*:\s*"([^"]+)"',
        # 在 play_addr 的 url_list 中
        r'"play_addr"[^}]*"url_list"\s*:\s*\["([^"]+)"',
        # 抖音的新版数据格式
        r'"src"\s*:\s*"([^"]+\.mp4[^"]*)"',
    ]
    for pattern in patterns:
        m = re.search(pattern, html)
        if m:
            return m.group(1).replace("\\u002F", "/").replace("\\/", "/").replace("amp;", "")
    return None


def download_video(cookie_str: str) -> bool:
    """用用户提供的 cookie 下载抖音视频"""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://www.douyin.com/",
        "Cookie": cookie_str,
    }

    sess = requests.Session()
    sess.headers.update(headers)

    # 1. 先获取视频页面
    url = f"https://www.douyin.com/video/{VIDEO_ID}"
    print(f"请求: {url}")
    resp = sess.get(url, timeout=30)
    print(f"状态: {resp.status_code}")
    print(f"页面大小: {len(resp.text)} bytes")

    if resp.status_code != 200:
        print(f"❌ 页面请求失败 (状态码 {resp.status_code})")
        return False

    # 2. 尝试从 HTML 提取视频地址
    video_url = extract_video_url(resp.text)

    if not video_url:
        print("⚠️ 未在 HTML 中找到视频地址，尝试通过 API 获取...")
        # 备用方案: 用抖音的 Web API
        token = re.search(r'X-Bogus["\']:\s*["\']([^"\']+)["\']', resp.text)
        ttwid = re.search(r'ttwid=([^;]+)', cookie_str)

        api_url = (
            f"https://www.douyin.com/aweme/v1/web/aweme/detail/"
            f"?aweme_id={VIDEO_ID}"
        )
        api_headers = {
            **headers,
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
        }
        api_resp = sess.get(api_url, headers=api_headers, timeout=30)
        print(f"API 状态: {api_resp.status_code}")

        if api_resp.status_code == 200:
            try:
                data = api_resp.json()
                detail = data.get("aweme_detail", {})
                video = detail.get("video", {})
                play_addr = video.get("play_addr", {})
                url_list = play_addr.get("url_list", [])
                if url_list:
                    video_url = url_list[0]
            except json.JSONDecodeError:
                pass

    # 3. 下载视频
    if not video_url:
        print("❌ 无法获取视频地址。Cookie 可能已过期或未登录。")
        return False

    # 清理 URL (抖音经常在 URL 里加反斜杠转义)
    video_url = video_url.replace("\\", "")
    print(f"🎬 视频地址已获取 ({video_url[:80]}...)")

    # 下载
    print("下载中...")
    video_resp = requests.get(video_url, headers=headers, timeout=120)
    if video_resp.status_code == 200 and len(video_resp.content) > 1000:
        with open(OUTPUT, "wb") as f:
            f.write(video_resp.content)
        print(f"✅ 下载成功: {OUTPUT} ({len(video_resp.content)/1024/1024:.1f} MB)")
        return True
    else:
        print(f"❌ 下载失败: 状态码={video_resp.status_code}, 大小={len(video_resp.content)}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("抖音视频下载")
    print("=" * 60)
    print()
    print("步骤:")
    print("1. 用 Edge/Chrome 打开 https://www.douyin.com/ 并登录")
    print("2. 按 F12 打开开发者工具")
    print("3. 在 Console 粘贴: document.cookie")
    print("4. 复制输出的全部 cookie 字符串")
    print("5. 粘贴到下面")
    print()

    cookie_str = input("粘贴 Cookie > ").strip()
    if not cookie_str:
        print("❌ Cookie 不能为空")
        sys.exit(1)

    print()
    success = download_video(cookie_str)
    if success:
        print(f"文件保存在: {OUTPUT}")
    else:
        print("下载失败，请检查 Cookie 是否有效。")
        sys.exit(1)
