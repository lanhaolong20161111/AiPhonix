#!/bin/sh
# AiPhonix（server_cf 版）— 云托管容器启动引导
#
# 职责：把「镜像内置的种子数据」铺到「运行期数据根」，**只补缺失、绝不覆盖**。
# 这样有没有挂持久卷，启动路径是同一条：
#   · 没挂卷：$DEST 就是镜像里的目录，内容本来就在 ⇒ 播种分支基本不触发。
#   · 挂了空卷：卷把镜像内容遮蔽 ⇒ 首启从 $SEED 播种，之后运行期数据一直留在卷里。
#
# 路径（都可由环境变量覆盖，便于本地做「空卷仿真」）：
#   SHARED_ROOT  运行期数据根，默认 /app/shared（**与 src/main.ts 读的 SHARED_ROOT 是同一个变量**）
#   SEED_DIR     镜像内置种子，默认 /app/seed
#                  · $SEED_DIR/data/app.db   生产 D1 快照（用户、练习记录都在里面）
#                  · $SEED_DIR/static/**     R2 静态资源（/letter-clips/*、/videos/*）
#
# ⚠️ 挂载位置**建议 `/app/shared/data`**（只把 SQLite 放进卷）：
#    整根挂到 /app/shared 会把镜像里 434MB 的 static/** 一并遮蔽 ⇒ /letter-clips/*、/videos/*
#    直接 404，且首启要额外把这 434MB 拷进卷。下面的 static 自愈分支只作为
#    「确实整根挂载了」的兜底（2026-09-20 补）。
#
# ⚠️ 前端产物与 tts-cache 已烤进镜像（/app/server_cf/static_assets），不随运行期变化，无需播种。
# ⚠️ config.yaml 不需要 —— server_cf/src/env.ts 只从 bindings（=环境变量）读配置。
# ⚠️ R2 里的大文件（用户上传/生成的图片、视频）刻意不进镜像，待挂载对象存储后另行搬迁。
set -eu

SEED="${SEED_DIR:-/app/seed}"
DEST="${SHARED_ROOT:-/app/shared}"

log() { echo "[entrypoint] $*"; }

# 挂载点就位（卷为对象存储挂载时可能不可写，失败不致命）
mkdir -p "$DEST/data" "$DEST/static" "$DEST/cache" "$DEST/downloads" 2>/dev/null || true

# ── 1) D1（SQLite）—— 运行期最关键的数据 ──
if [ -f "$SEED/data/app.db" ]; then
  if [ -e "$DEST/data/app.db" ]; then
    log "data/app.db 已存在，跳过播种（不覆盖运行期数据）"
  else
    mkdir -p "$DEST/data" 2>/dev/null || true
    if cp -a "$SEED/data/app.db" "$DEST/data/app.db" 2>/dev/null; then
      log "seeded data/app.db"
    else
      log "warn: 播种 data/app.db 失败（目标不可写？）"
    fi
  fi
else
  log "warn: 种子缺少 data/app.db —— 服务会建空库，数据与生产不一致"
fi

# ── 2) R2 静态资源 —— 兜底自愈 ──
# 只有把卷**整根**挂到 $DEST 时 $DEST/static 才会是空的；此时从种子补回，
# 否则 /letter-clips/* 与 /videos/* 会 404（它们在镜像里是 COPY 进来的，被空卷遮蔽了）。
if [ -d "$SEED/static" ]; then
  if [ -z "$(ls -A "$DEST/static" 2>/dev/null)" ]; then
    log "warn: $DEST/static 为空 ⇒ 判定为「卷整根挂载」，从种子自愈（体积较大，首启会变慢）"
    mkdir -p "$DEST/static" 2>/dev/null || true
    if cp -a "$SEED/static/." "$DEST/static/" 2>/dev/null; then
      log "seeded static/**"
    else
      log "warn: 播种 static/** 失败（目标不可写？）"
    fi
  fi
fi

if [ "$#" -eq 0 ]; then
  log "error: 未收到启动命令"
  exit 1
fi
log "starting: $*"
exec "$@"
