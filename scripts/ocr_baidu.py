"""
用百度 OCR API 识别语文字词表图片
"""
import sys, os, base64, requests
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

API_KEY = "ICj014x3faJcd74nARBrmwJ7"
SECRET_KEY = "zxWUFGwGu3fXCHiTzAvVArZQz3kDCE0t"

input_dir = Path(r"C:\Users\lhl20\Desktop\语文字词表")
output_file = input_dir / "ocr_output.txt"
images = sorted(input_dir.glob("*.jpg"))

print(f"找到 {len(images)} 张图片\n")

# 获取 access token
print("[INFO] 获取百度 access token...")
resp = requests.get("https://aip.baidubce.com/oauth/2.0/token", params={
    "grant_type": "client_credentials",
    "client_id": API_KEY,
    "client_secret": SECRET_KEY,
})
token = resp.json().get("access_token")
if not token:
    print(f"[FAIL] {resp.text}")
    exit(1)
print("[OK] token 获取成功\n")

all_text = []
for i, img_path in enumerate(images, 1):
    short = img_path.name[:60]
    try:
        with open(img_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        resp = requests.post(
            "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic",
            params={"access_token": token},
            data={"image": b64},
        )
        result = resp.json()
        if "words_result" in result:
            texts = [w["words"] for w in result["words_result"]]
            print(f"[{i}/{len(images)}] {short}")
            print(f"  -> {len(texts)} 行:")
            for t in texts:
                print(f"    {t}")
            all_text.append(f"===== 图片{i}: {img_path.name} =====")
            all_text.extend(texts)
            all_text.append("")
        else:
            print(f"[{i}/{len(images)}] {short}")
            print(f"  [FAIL] {result}")
    except Exception as e:
        print(f"[{i}/{len(images)}] {short}")
        print(f"  [FAIL] {e}")

output_file.write_text("\n".join(all_text), encoding="utf-8")
print(f"\n[DONE] 结果 -> {output_file}")
