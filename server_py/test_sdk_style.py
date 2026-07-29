"""测试：SDK 风格的 URL 构建（url.PathEscape）"""
import hashlib, hmac, base64, time, uuid, urllib.parse, json

app_id = "1444240037"
sid = "YOUR_TENCENT_SECRET_ID"
sk = "YOUR_TENCENT_SECRET_KEY"

ts = str(int(time.time()))
voice_id = str(uuid.uuid4())

# 1. 构建原始查询字符串（同 SDK buildURL）
params = {
    "secretid": sid,
    "timestamp": ts,
    "expired": str(int(time.time()) + 86400),
    "nonce": ts,
    "voice_id": voice_id,
    "voice_format": "1",
    "text_mode": "0",
    "ref_text": "hello",
    "keyword": "",
    "eval_mode": "0",
    "score_coeff": "1.0",
    "server_engine_type": "16k_en",
    "sentence_info_enabled": "0",
    "rec_mode": "1",
}

keys = sorted(params.keys())
raw_query = "&".join([f"{k}={params[k]}" for k in keys])

# 签名 URL（SDK 方式：以 "soe.cloud.tencent.com/soe/api/{appid}?{rawQuery}" 为待签字符串）
sign_url = f"soe.cloud.tencent.com/soe/api/{app_id}?{raw_query}"
print(f"sign_url: {sign_url}")

mac = hmac.new(sk.encode(), sign_url.encode(), hashlib.sha1)
signature = base64.b64encode(mac.digest()).decode()
print(f"signature: {signature}")

# 2. 构建实际 URL（SDK 方式：url.PathEscape(queryStr)）
# Python 中 urllib.parse.quote 默认 safe='/'，要加 '' 来编码 = 和 &
path_escaped = urllib.parse.quote(raw_query, safe='')
print(f"path_escaped: {path_escaped[:80]}...")

# SDK 格式：wss://soe.cloud.tencent.com/soe/api/{appid}?{pathEscapedQuery}&signature={QueryEscape(sig)}
sdk_url = (f"wss://soe.cloud.tencent.com/soe/api/{app_id}?"
           f"{path_escaped}&signature={urllib.parse.quote(signature, safe='')}")
print(f"\nSDK风格URL (query部分): {sdk_url[sdk_url.index('?'):][:150]}...")

# 3. 连接测试
import websocket
try:
    ws = websocket.create_connection(sdk_url, timeout=10)
    msg = ws.recv()
    h = json.loads(msg)
    print(f"SDK风格: code={h.get('code')} msg={h.get('message')[:50]}")
    ws.close()
except Exception as e:
    print(f"SDK风格异常: {e}")
