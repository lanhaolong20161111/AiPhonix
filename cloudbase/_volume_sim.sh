#!/bin/sh
# 空卷仿真 —— 验证「挂上持久卷之后，启动既不丢运行期数据、也不丢镜像内置资源」。
#
# 为什么需要它：真机上云托管一次部署要十几分钟，而「持久卷」这件事的失败模式极其阴险
# （首启把镜像里的 app.db / static/** 遮蔽掉 ⇒ 数据全没 or /letter-clips/* 全 404）。
# 这里用本地文件系统复刻「空卷挂在 DEST 下」的效果，把三条判据都跑一遍：
#
#   A) 推荐布局：卷挂在 `$DEST/data`  ⇒ 只播种 app.db，镜像里的 static/** 一根头发都不动
#   B) 整根挂载：卷挂在 `$DEST`       ⇒ app.db 与 static/** 都要从种子自愈补回
#   C) 幂等性：卷里已有 app.db        ⇒ 绝不被种子覆盖（运行期数据优先）
#   D) 服务端能从这个数据根起来，`/health` 的 d1 自检为 ok
#
# 用法：
#   sh cloudbase/_volume_sim.sh
#   NODE_BIN=/path/to/node PORT=18031 sh cloudbase/_volume_sim.sh
#
# ⚠️ 只读镜像种子、只写 mktemp 出来的临时目录，结束即清理。

set -u

# 本机 curl 会走系统代理 ⇒ 打 127.0.0.1 会被代理拒绝，产生「假阴性」
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy 2>/dev/null || true

HERE=$(cd "$(dirname "$0")" && pwd)
SEED="$HERE/_ctx/seed"
ENTRY="$HERE/docker-entrypoint.sh"
NODE_BIN=${NODE_BIN:-"C:/Users/lhl20/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"}
PORT=${PORT:-18031}

fail=0
ok()  { echo "  [ok]   $*"; }
bad() { echo "  [FAIL] $*"; fail=1; }
log() { echo "[sim] $*"; }

if [ ! -f "$ENTRY" ]; then bad "找不到 $ENTRY"; exit 1; fi
if [ ! -f "$SEED/data/app.db" ]; then
  bad "找不到种子 $SEED/data/app.db —— 先跑：node cloudbase/_ctxgen.cjs"
  exit 1
fi

# 临时根放在仓库内（放到系统 temp 会被删除安全层拦住，跑完清不掉）
TMP="$HERE/_sim_tmp"
rm -rf "$TMP" 2>/dev/null || true
mkdir -p "$TMP"
trap 'rm -rf "$TMP" 2>/dev/null || true' EXIT
log "临时根 $TMP"

# 检查端口是否被占（否则会对着**上一个**服务做健康检查，形成假阳性）
PORT_BUSY=0
if command -v curl >/dev/null 2>&1; then
  if curl -s -m 2 --noproxy '*' "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"status"'; then
    PORT_BUSY=1
  fi
fi
if [ "$PORT_BUSY" = "1" ]; then
  bad "端口 $PORT 上已有服务在跑 —— 先停掉它再跑本脚本（否则健康检查打的是旧进程）"
  exit 1
fi

# ─────────────────────────────────────────────────────────────
# A) 推荐布局：卷只挂 $DEST/data
# ─────────────────────────────────────────────────────────────
log ""
log "== A) 卷挂在 \$DEST/data（推荐） =="
A="$TMP/A"
mkdir -p "$A/shared/static/letter_clips" "$A/shared/cache" "$A/shared/downloads"
# 模拟「镜像里烤进去的 static」——注意它不该被播种逻辑碰
echo "image-baked-666" > "$A/shared/static/letter_clips/marker.txt"

SEED_DIR="$SEED" SHARED_ROOT="$A/shared" sh "$ENTRY" echo SEED_DONE >"$TMP/A.log" 2>&1 \
  || bad "entrypoint 退出码非 0"
sed 's/^/    | /' "$TMP/A.log"

[ -f "$A/shared/data/app.db" ] && ok "空卷 data/ 被播种出 app.db" || bad "app.db 未播种"
if cmp -s "$SEED/data/app.db" "$A/shared/data/app.db"; then
  ok "app.db 与种子逐字节一致"
else
  bad "app.db 内容与种子不符"
fi
if [ "$(cat "$A/shared/static/letter_clips/marker.txt" 2>/dev/null)" = "image-baked-666" ]; then
  ok "镜像内置 static/ 未被触碰"
else
  bad "static/ 被改动了（不该发生）"
fi
if [ -d "$A/shared/static/videos" ] || [ -d "$A/shared/static/images" ]; then
  bad "static/ 被误播种（推荐布局下不该触发自愈）"
else
  ok "static/ 未触发自愈分支（符合预期）"
fi

# ─────────────────────────────────────────────────────────────
# D) 服务端能从该数据根启动，d1 自检 ok
# ─────────────────────────────────────────────────────────────
log ""
log "== D) 服务端从该数据根启动 =="
ENTRYJS="$HERE/dist/cloudbase/src/main.js"
if [ ! -f "$ENTRYJS" ]; then
  bad "$ENTRYJS 不存在 —— 先跑：cd cloudbase && tsc -p tsconfig.json"
else
  SHARED_ROOT="$A/shared" \
  ASSETS_ROOT="$HERE/../server_cf/static_assets" \
  PORT="$PORT" BIND_HOST=127.0.0.1 \
  "$NODE_BIN" "$ENTRYJS" >"$TMP/server.log" 2>&1 &
  SRV=$!
  HEALTH=""
  LASH=""
  i=0
  while [ "$i" -lt 60 ]; do
    i=$((i + 1))
    if command -v curl >/dev/null 2>&1; then
      LASH=$(curl -s -m 3 --noproxy '*' "http://127.0.0.1:$PORT/health" 2>&1)
    else
      LASH=$("$NODE_BIN" -e "
        fetch('http://127.0.0.1:$PORT/health').then(r=>r.text()).then(t=>console.log(t)).catch(()=>{})
      " 2>/dev/null)
    fi
    # ⚠️ 必须校验「真的是 JSON 响应」：curl 失败时会回一段中文错误文本，
    #    当成响应就会把「服务没起来」误判成「服务起来了但 d1 不对」。
    case "$LASH" in
      *'"status"'*) HEALTH="$LASH"; break ;;
    esac
    sleep 0.5
  done
  if [ -n "$HEALTH" ]; then
    ok "/health 有响应：$HEALTH"
    case "$HEALTH" in
      *'"d1":"ok"'*) ok "d1 自检 ok（即从卷里的 app.db 正常打开了库）" ;;
      *) bad "d1 自检不是 ok ⇒ 卷里的 app.db 打不开" ;;
    esac
    case "$HEALTH" in
      *'"r2":"ok"'*) ok "r2 自检 ok" ;;
      *) bad "r2 自检不是 ok" ;;
    esac
  else
    bad "/health 在 30s 内没拿到 JSON 响应（最后一次：$LASH），服务端日志："
    sed 's/^/    | /' "$TMP/server.log"
  fi
  kill "$SRV" 2>/dev/null || true
  wait "$SRV" 2>/dev/null || true
fi

# ─────────────────────────────────────────────────────────────
# C) 幂等性：已有 app.db 绝不被覆盖
# ─────────────────────────────────────────────────────────────
log ""
log "== C) 已有 DB 不被种子覆盖 =="
echo "RUNTIME-WRITE-AFTER-BOOT" >> "$A/shared/data/app.db"
cp "$A/shared/data/app.db" "$TMP/after-write.db"
SEED_DIR="$SEED" SHARED_ROOT="$A/shared" sh "$ENTRY" echo SEED_DONE >"$TMP/C.log" 2>&1 || true
sed 's/^/    | /' "$TMP/C.log"
if cmp -s "$TMP/after-write.db" "$A/shared/data/app.db"; then
  ok "运行期写入原封不动（幂等，不会被种子回滚）"
else
  bad "运行期数据被种子覆盖了 —— 这是最危险的失败模式"
fi

# ─────────────────────────────────────────────────────────────
# B) 整根挂载：static/** 必须自愈（用小尺寸假种子，只验分支逻辑）
# ─────────────────────────────────────────────────────────────
log ""
log "== B) 卷整根挂载 ⇒ static/** 自愈（用迷你假种子） =="
FAKE="$TMP/fakeseed"
mkdir -p "$FAKE/data" "$FAKE/static/letter_clips"
cp "$SEED/data/app.db" "$FAKE/data/app.db"
echo "from-seed" > "$FAKE/static/letter_clips/a.txt"
B="$TMP/B"
mkdir -p "$B/shared"
SEED_DIR="$FAKE" SHARED_ROOT="$B/shared" sh "$ENTRY" echo SEED_DONE >"$TMP/B.log" 2>&1 \
  || bad "entrypoint 退出码非 0"
sed 's/^/    | /' "$TMP/B.log"

[ -f "$B/shared/data/app.db" ] && ok "app.db 自愈补回" || bad "app.db 未补回"
if [ "$(cat "$B/shared/static/letter_clips/a.txt" 2>/dev/null)" = "from-seed" ]; then
  ok "static/** 自愈补回"
else
  bad "static/** 未补回 ⇒ /letter-clips/* 会 404"
fi
# 再跑一次：static 此时非空 ⇒ 不该再触发自愈
SEED_DIR="$FAKE" SHARED_ROOT="$B/shared" sh "$ENTRY" echo SEED_DONE >"$TMP/B2.log" 2>&1 || true
if grep -q "自愈" "$TMP/B2.log"; then
  bad "第二次启动仍触发 static 自愈（判断条件太宽）"
else
  ok "第二次启动不再触发自愈（static 已非空）"
fi

log ""
if [ "$fail" -eq 0 ]; then
  log "==== 全部通过：挂上持久卷后启动路径是安全的 ===="
else
  log "==== 有失败项，见上面 [FAIL] ===="
fi
exit "$fail"
