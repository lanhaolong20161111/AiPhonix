"""测试：不带 Origin header"""
import hashlib, hmac, base64, time, uuid, urllib.parse, json, struct, math
import websocket

app_id = "1444240037"
sid = "YOUR_TENCENT_SECRET_ID"
sk = "YOUR_TENCENT_SECRET_KEY"

ts = str(int(time.time()))
params = {
    "secretid": sid,
    "timestamp": ts,
    "expired": str(int(time.time()) + 86400),
    "nonce": ts,
    "voice_id": str(uuid.uuid4()),
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
sign_str = f"soe.cloud.tencent.com/soe/api/{app_id}?{raw_query}"
mac = hmac.new(sk.encode(), sign_str.encode(), hashlib.sha1)
signature = base64.b64encode(mac.digest()).decode()
uv = urllib.parse.urlencode([(k, params[k]) for k in keys])
ws_url = (f"wss://soe.cloud.tencent.com/soe/api/{app_id}?"
          f"{uv}&signature={urllib.parse.quote(signature, safe='')}")

# 不使用默认的 create_connection（它会加 Origin header）
# 用底层 WebSocket 工厂自定义 header
ws = websocket.create_connection(
    ws_url,
    timeout=15,
    header={"Origin": ""}  # 空 Origin
)
msg = ws.recv()
h = json.loads(msg)
print(f"空 Origin: code={h.get('code')} msg={h.get('message')[:50]}")
ws.close()

# 也试试 Go 风格的 Origin: http://soe.cloud.tencent.com
ws2 = websocket.create_connection(
    ws_url,
    timeout=15,
    header={"Origin": "http://soe.cloud.tencent.com"}
)
msg2 = ws2.recv()
h2 = json.loads(msg2)
print(f"http Origin: code={h2.get('code')} msg={h2.get('message')[:50]}")
ws2.close()
