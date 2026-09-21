# AiPhonix — 云托管（CloudBase CloudRun）镜像：**跑 server_cf（生产 Cloudflare Worker）源码**
#
# 与 server_ts/Dockerfile 的区别：本镜像不装 wrangler、不跑 Worker，而是把 server_cf 的
# src/** 用 Node 直接加载，CF 专有绑定由 cloudbase/src/shims/ 适配：
#   D1 → better-sqlite3、R2 → 本地文件系统、Assets → 本地静态目录、
#   WebSocketPair/fetch+Upgrade → ws、ExecutionContext.waitUntil → 引用保活
#
# 布局铁律（与 cloudbase/src/main.ts 的默认路径严格对应）：
#   /app/dist/cloudbase/src/main.js            ← 入口（tsc 产物）
#   /app/dist/server_cf/src/*.js               ← server_cf 原版编译产物
#   /app/node_modules                          ← 运行期依赖
#   /app/server_cf/static_assets/{web,tts-cache}← Worker Assets 根（/web/、/tts-cache/）
#   /app/shared                                ← R2 根（键空间 data/ static/ cache/ downloads/）
#                                                + data/app.db（D1 快照）
# 持久卷必须挂到 **/app/shared**（SQLite 与用户上传/生成的文件都在其下）。
#
# ⚠️ 为什么 server_cf/src 必须与 node_modules 同处 /app（扁平布局）：
#    Node 的裸模块解析是「从调用文件所在目录逐级向上找 node_modules」。编译期
#    `/app/server_cf/src/*.ts` 里的 `import ... from "hono"` 只会找
#    /app/server_cf/src/node_modules → /app/server_cf/node_modules → /app/node_modules。
#    若把 server_cf 放到 /app/cloudbase/ 之下而 node_modules 也在 /app/cloudbase/，
#    构建就会以 `TS2307: Cannot find module 'hono'/'zod'/'drizzle-orm'` 全线失败
#    （2026-09-20 第一次 cf 版部署即因此失败）。
#    扁平布局同时让 tsconfig 的 rootDir="." 产出 dist/{cloudbase,server_cf}，
#    与本地 `cloudbase/tsconfig.json`（rootDir=".."）的输出结构完全一致。
#
# 构建上下文 = `cloudbase/_ctx`（由 cloudbase/_ctxgen.cjs 装配，约 0.5GB：
#   {package.json,package-lock.json,tsconfig.json,Dockerfile,docker-entrypoint.sh} +
#   cloudbase/src + server_cf/src + static_assets/{web,tts-cache} + seed/{data/app.db,static/**}）。
# ⚠️ 绝不能把仓库根当上下文：shared/ 4.2G、server_py 4.5G、.git 850M。
# 体积主要由 seed/static 决定（434MB：letter_clips 6MB + images 15MB + videos 413MB），
# 用 `CTX_STATIC=small|none node cloudbase/_ctxgen.cjs` 可显著缩小上传量。
#
# ⚠️ CloudBase 构建镜像的三处坑（2026-09-20 实测，server_ts 版踩过，此处逐条规避）：
#   1) 构建容器带 NODE_ENV=production → `npm ci` 会省略 devDependencies（拿不到 tsc）
#      → 必须显式 `--include=dev`。
#   2) 该镜像是**定制 npm**：默认不执行依赖的 install 脚本（警告 "install-scripts … allowScripts"，
#      且其建议的 `npm install-scripts approve` 在官方 npm 里不存在 —— 平台补丁，改配置绕不过去）
#      → 原生模块（better-sqlite3）必须**绕开 npm**，用 node 直接跑 prebuild-install，
#        拉不到预编译包再退到 node-gyp 源码编译。
#   3) lockfile 必须**在隔离空目录**生成：在本仓库内跑 npm 会把 pnpm 符号链接农场记成 lock
#      （link: true 条目 + 传递依赖缺失），容器里 `npm ci` 会去建死链接。
#      复现：mkdir -p /tmp/lockgen && cp cloudbase/package.json /tmp/lockgen/
#            cd /tmp/lockgen && npm install --package-lock-only --ignore-scripts
#            cp package-lock.json <repo>/cloudbase/package-lock.json
#      自检：条目数 > 200 且 `.pnpm` 条目为 0、`"link": true` 为 0。
#
# 部署：tcb cloudrun deploy --env-id <envId> --service-name aiphonix-api \
#        --source <abs>/cloudbase/_ctx --port 8080 --min-num 1 --max-num 1 --wait

# ── 构建阶段 ──
FROM node:24-slim AS build
# python3/make/g++：better-sqlite3 拉不到预编译包时做源码编译的兜底工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
# --include=dev：构建容器带 NODE_ENV=production，不加这个拿不到 typescript
RUN npm ci --include=dev --no-audit --no-fund

# better-sqlite3 手动构建 + 自检。
# 刻意不用 `npm rebuild`：它同样受脚本拦截影响，只会「假成功」。
RUN set -eux; \
    cd /app/node_modules/better-sqlite3; \
    node /app/node_modules/prebuild-install/bin.js -r node \
      || npx --yes node-gyp@10.3.1 rebuild --release; \
    node -e "const D=require('/app/node_modules/better-sqlite3');const db=new D(':memory:');db.exec('create table t(a)');db.prepare('insert into t values (?)').run(1);console.log('[build] better-sqlite3 ok rows=' + db.prepare('select count(*) c from t').get().c);db.close()"

COPY tsconfig.json ./
COPY cloudbase/src ./cloudbase/src
# server_cf 原版源码：与 cloudbase/src 同处一个 tsc 程序（tsconfig 的 rootDir="."）
COPY server_cf/src ./server_cf/src
RUN npm run build
# 丢掉 devDependencies（typescript/workers-types 等），原生二进制保留在 node_modules 内
RUN npm prune --omit=dev

# ── 运行阶段 ──
# 纯 runtime 基础镜像（无 python3/make/g++）：绝不在本阶段重装原生模块
FROM node:24-slim
ENV NODE_ENV=production
# 平台会注入 PORT；给默认值便于本地 docker run 调试
ENV PORT=8080
# 先建出卷挂载点（首启若挂空卷，entrypoint 会播种 app.db）
RUN mkdir -p /app/shared/data /app/shared/static /app/shared/cache /app/shared/downloads \
             /app/server_cf/static_assets
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
# Worker Assets 根：只装 web/ 与 tts-cache/（_headers 由适配层复刻，不需要进镜像）
COPY static_assets/web /app/server_cf/static_assets/web
COPY static_assets/tts-cache /app/server_cf/static_assets/tts-cache
# 种子：data/app.db（生产 D1 快照）+ static/**（R2 静态资源：/letter-clips/*、/videos/*）。
# 前端产物已随镜像固定，无需运行期刷新。
COPY seed /app/seed
# R2 静态资源落到容器内的 R2 根下（R2Shim 直读文件系统；见 _ctxgen.cjs 的 CTX_STATIC 开关）。
# ⚠️ 一旦把持久卷挂到 /app/shared，本目录会被空卷**遮蔽** —— 届时 static/ 需另行同步进卷，
#    或改为只把卷挂到 /app/shared/data（SQLite 与用户上传数据）。
COPY seed/static /app/shared/static
# 启动引导：把种子里的 app.db 铺到 /app/shared（仅缺失时）。
# sed 清掉 CRLF —— Windows 上写出的脚本会在 `#!/bin/sh\r` 处报 "not found"。
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && sed -i 's/\r$//' /app/docker-entrypoint.sh
EXPOSE 8080
CMD ["/app/docker-entrypoint.sh", "node", "dist/cloudbase/src/main.js"]
