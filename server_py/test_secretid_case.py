"""测试：secretid 大小写"""
import hashlib, hmac, base64, time, uuid, urllib.parse, json

app_id = "1444240037"
sid = "YOUR_TENCENT_SECRET_ID"
sk = "YOUR_TENCENT_SECRET_KEY"

def try_with(key_name):
    ts = str(int(time.time()))
    params = {
        key_name: sid,
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
    
    print(f"\n=== key_name='{key_name}' ===")
    print(f"params keys包含: {key_name}")
    import websocket
    try:
        ws = websocket.create_connection(ws_url, timeout=10)
        msg = ws.recv()
        h = json.loads(msg)
        print(f"code={h.get('code')} msg={h.get('message')[:50]}")
        ws.close()
    except Exception as e:
        print(f"异常: {e}")

# Go 用 lowercase "secretid"
try_with("secretid")
# 试试大写 "SecretId"
try_with("SecretId")
