#!/usr/bin/env bash
# 端到端验证：补多音字异步化（waitUntil）+ 补丁轮询接口 + 服务端缓存回写。
# 为什么用 curl 而不是 python urllib / node fetch：
#   本机沙箱代理会对 urllib 返回 403，node 原生 fetch 又不读代理环境变量直连失败；
#   curl --noproxy "*" 实测稳定。JSON 解析交给本地 python（只读 stdin，不联网）。
# 用法：bash _test_poly_async.sh [图片路径]
set -u

API_BASE="${API_BASE:-https://aiphonix-api.xinyi7lan.workers.dev/api/v1}"
IMG="${1:-C:/Users/lhl20/Desktop/android_cli_demos/test_card_wake.jpg}"
PY="C:/Users/lhl20/.workbuddy/binaries/python/versions/3.13.12/python.exe"
USER="smoke_poly_$(date +%s)"

echo "image: $IMG"
echo "== register =="
REG=$(curl -s --noproxy "*" -X POST "$API_BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"test1234\",\"nickname\":\"smoke\"}")
TOKEN=$(printf '%s' "$REG" | "$PY" -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
if [ -z "$TOKEN" ]; then echo "register FAILED: $REG"; exit 1; fi
echo "registered: $USER"

echo "== 1) 异步模式主请求 (no_cache + poly_async=1) =="
T0=$(date +%s%3N)
RESP=$(curl -s --noproxy "*" -X POST "$API_BASE/ai-chinese/parse-image?no_cache=true&poly_async=1" \
  -H "Authorization: Bearer $TOKEN" -F "file=@$IMG;type=image/jpeg")
T1=$(date +%s%3N)
printf '%s' "$RESP" > /tmp/poly_async_resp.json
echo "$RESP" | "$PY" -c "
import sys,json
j=json.load(sys.stdin)
b=j.get('blocks') or []
poly=sum(len((x or {}).get('polyphones') or {}) for x in b)
print('  HTTP %dms textLen=%s blocks=%s polyTotal=%s pending=%s token=%s'%($((T1-T0)),len(j.get('text') or ''),len(b),poly,j.get('poly_pending'),(j.get('poly_token') or '')[:12]))
print('  text[0..70]:', (j.get('text') or '').replace(chr(10),' ')[:70])
"
PTOKEN=$(printf '%s' "$RESP" | "$PY" -c "import sys,json;print(json.load(sys.stdin).get('poly_token') or '')")

if [ -n "$PTOKEN" ]; then
  echo "== 2) 轮询注音补丁 =="
  T2=$(date +%s%3N)
  GOT=""
  DELAY=1
  for i in $(seq 1 25); do
    sleep "$DELAY"
    D=$(curl -s --noproxy "*" "$API_BASE/ai-chinese/parse-polyphones?token=$PTOKEN" -H "Authorization: Bearer $TOKEN")
    READY=$(printf '%s' "$D" | "$PY" -c "import sys,json;print('1' if json.load(sys.stdin).get('ready') else '0')" 2>/dev/null || echo 0)
    if [ "$READY" = "1" ]; then
      T3=$(date +%s%3N)
      echo "$D" | "$PY" -c "
import sys,json
d=json.load(sys.stdin).get('polyphones') or {}
print('  ready in %dms, 多音字 %d 个: %s'%($((T3-T2)),len(d),list(d.items())[:5]))
"
      GOT="1"
      break
    fi
    DELAY=$(echo "$DELAY" | awk '{d=$1*1.5; if(d>4)d=4; print d}')
  done
  [ -z "$GOT" ] && echo "  TIMEOUT: 未拿到注音补丁"
else
  echo "== 2) SKIP：主请求未返回 poly_token（可能走了豆包回退路径，该路径本就不补注音） =="
fi

echo "== 3) 同图再请求（服务端缓存，应已被异步回写为带注音版本） =="
sleep 2
T4=$(date +%s%3N)
RESP3=$(curl -s --noproxy "*" -X POST "$API_BASE/ai-chinese/parse-image?poly_async=1" \
  -H "Authorization: Bearer $TOKEN" -F "file=@$IMG;type=image/jpeg")
T5=$(date +%s%3N)
printf '%s' "$RESP3" | "$PY" -c "
import sys,json
j=json.load(sys.stdin)
b=j.get('blocks') or []
poly=sum(len((x or {}).get('polyphones') or {}) for x in b)
print('  HTTP %dms blocks=%s polyTotal=%s pending=%s'%($((T5-T4)),len(b),poly,j.get('poly_pending')))
"
echo "done"
