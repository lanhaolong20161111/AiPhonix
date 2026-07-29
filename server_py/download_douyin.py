"""尝试从抖音下载视频"""
import re
import requests

VIDEO_ID = "7598940317417506811"

url = f"https://www.douyin.com/video/{VIDEO_ID}"
headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.douyin.com/",
}

resp = requests.get(url, headers=headers, timeout=15)
print("Status:", resp.status_code)
print("HTML length:", len(resp.text))

# Search for video URLs in HTML
patterns = [
    r'https?://[^\\"\'\s<>]+\.mp4[^\\"\'\s<><>]*',
    r'https?://[^\\"\'\s<>]+video[^\\"\'\s<><>]*\.m3u8',
    r'"play_addr":{[^}]+"url_list":\[[^\]]+\]',
    r'"play_api_url":"([^"]+)"',
]

for i, pat in enumerate(patterns):
    matches = re.findall(pat, resp.text)
    if matches:
        print(f"\nPattern {i}: found {len(matches)} matches")
        for m in matches[:3]:
            print(f"  {m[:300]}")
    else:
        print(f"Pattern {i}: no matches")
