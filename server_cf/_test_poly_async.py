"""端到端验证：补多音字异步化（waitUntil）+ 补丁轮询接口。

验证点：
1) 语文模式加 poly_async=1 后，主请求应"很快"返回（不再串行等 fillPolyphones）
2) 响应带 poly_pending=true + poly_token
3) 轮询 /ai-chinese/parse-polyphones 能在超时前拿到 ready=true 和注音
4) 再发一次同图请求（走服务端缓存）应极快，且 blocks 已带注音（异步回写主缓存生效）

用法：
  python _test_poly_async.py [图片路径]
  API_BASE=https://aiphonix-api-staging... python _test_poly_async.py   # 打 staging
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

API_BASE = os.environ.get(
    "API_BASE", "https://aiphonix-api.xinyi7lan.workers.dev/api/v1"
)
IMG = sys.argv[1] if len(sys.argv) > 1 else (
    "C:/Users/lhl20/Desktop/android_cli_demos/test_card_wake.jpg"
)


def _req(url, data=None, headers=None, method=None, timeout=180):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def post_multipart(url, field, filename, blob, token, timeout=180):
    boundary = "----aiphonix" + uuid.uuid4().hex
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
    ).encode()
    body += b"Content-Type: image/jpeg\r\n\r\n"
    body += blob + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return _req(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {token}",
        },
        timeout=timeout,
    )


def has_poly(blocks):
    return any((b or {}).get("polyphones") for b in (blocks or []))


def poly_count(blocks):
    n = 0
    for b in blocks or []:
        n += len((b or {}).get("polyphones") or {})
    return n


user = "smoke_poly_" + str(int(time.time()))
status, raw = _req(
    f"{API_BASE}/auth/register",
    data=json.dumps(
        {"username": user, "password": "test1234", "nickname": "smoke"}
    ).encode(),
    headers={"Content-Type": "application/json"},
    timeout=60,
)
reg = json.loads(raw)
token = reg.get("access_token")
if not token:
    raise SystemExit("register failed: " + raw.decode()[:200])
print(f"registered: {user}")

with open(IMG, "rb") as f:
    blob = f.read()
print(f"image: {IMG} ({len(blob)} bytes)")

# ── 1) 异步模式主请求 ──
t0 = time.time()
st, raw = post_multipart(
    f"{API_BASE}/ai-chinese/parse-image?no_cache=true&poly_async=1",
    "file",
    "test.jpg",
    blob,
    token,
)
ms = int((time.time() - t0) * 1000)
j = json.loads(raw)
blocks = j.get("blocks") or []
print(
    f"[async] HTTP {st} {ms}ms textLen={len(j.get('text') or '')} "
    f"blocks={len(blocks)} hasPoly={has_poly(blocks)} "
    f"pending={j.get('poly_pending')} token={(j.get('poly_token') or '')[:12]}…"
)
token_v = j.get("poly_token")

# ── 2) 轮询补丁 ──
if token_v:
    t1 = time.time()
    got = None
    delay = 1.2
    while time.time() - t1 < 60:
        time.sleep(delay)
        try:
            st2, raw2 = _req(
                f"{API_BASE}/ai-chinese/parse-polyphones?token={token_v}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30,
            )
            d = json.loads(raw2)
            if d.get("ready"):
                got = d.get("polyphones") or {}
                print(
                    f"[patch] ready in {int((time.time() - t1) * 1000)}ms, "
                    f"多音字 {len(got)} 个: {list(got.items())[:5]}"
                )
                break
        except urllib.error.HTTPError as e:
            print(f"[patch] HTTP {e.code}, retrying…")
        delay = min(delay * 1.5, 4)
    if got is None:
        print("[patch] TIMEOUT (60s) — 未拿到注音补丁")
else:
    print("[patch] SKIP — 主请求未返回 poly_token（可能走了豆包回退路径）")

# ── 3) 同图再请求（服务端缓存，应已被异步回写成带注音版本）──
time.sleep(2)
t2 = time.time()
st3, raw3 = post_multipart(
    f"{API_BASE}/ai-chinese/parse-image?poly_async=1", "file", "test.jpg", blob, token
)
ms3 = int((time.time() - t2) * 1000)
j3 = json.loads(raw3)
b3 = j3.get("blocks") or []
print(
    f"[cache] HTTP {st3} {ms3}ms blocks={len(b3)} hasPoly={has_poly(b3)} "
    f"polyTotal={poly_count(b3)} pending={j3.get('poly_pending')}"
)
print("done")
