#!/bin/sh
# AiPhonix — CloudRun 容器启动引导
#
# 为什么需要它：容器首启时 /app/shared 是空的（挂载的持久卷初始也是空的），
# 而 app.db / 前端产物 / config.yaml 必须在服务起来之前就位，否则：
#   - 没有 app.db → 服务只会建出一个空库，无法与生产比对
#   - 没有 static/web → /web/ 全 404，前端根本打不开
#   - 没有 config.yaml → 模型/提示词退回代码默认值
#
# 因此镜像内带一份「种子」（/app/seed，由构建上下文 server_ts/_seed 提供），
# 启动时按下面的规则铺到 /app/shared。密钥不在种子里，走服务配置的 EnvParam。
set -eu

SEED=/app/seed
DEST=/app/shared

log() { echo "[entrypoint] $*"; }

# 挂载点就位（卷为对象存储挂载时可能不可写，失败不致命）
mkdir -p "$DEST/data" "$DEST/static" "$DEST/cache" "$DEST/downloads" 2>/dev/null || true

if [ -d "$SEED" ]; then
  # 1) 配置与数据库：**仅在缺失时**播种 —— 绝不覆盖运行期已写入的数据。
  #    挂载持久卷后，第二次启动就会命中「已存在」分支，数据得以延续。
  for f in config.yaml data/app.db; do
    if [ -f "$SEED/$f" ] && [ ! -e "$DEST/$f" ]; then
      mkdir -p "$(dirname "$DEST/$f")" 2>/dev/null || true
      if cp -a "$SEED/$f" "$DEST/$f" 2>/dev/null; then
        log "seeded $f"
      else
        log "warn: 播种 $f 失败（目标不可写？）"
      fi
    fi
  done

  # 2) 前端构建产物：属于镜像的一部分，每次启动都覆盖。
  #    刻意不做 rm -rf：卷若是对象存储挂载，逐个删除既慢又贵；
  #    同名哈希文件内容一致，就地覆盖即可，残留的旧哈希块无害。
  if [ -d "$SEED/static" ]; then
    if cp -a "$SEED/static/." "$DEST/static/" 2>/dev/null; then
      log "refreshed static/"
    else
      log "warn: 刷新 static/ 失败"
    fi
  fi
fi

if [ "$#" -eq 0 ]; then
  log "error: 未收到启动命令"
  exit 1
fi
log "starting: $*"
exec "$@"
