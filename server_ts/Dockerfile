# AiPhonix 后端 — 腾讯 CloudBase 云托管（CloudRun）镜像
#
# 布局铁律（与 src/env.ts 的 ROOT 推导严格对应，否则数据路径全错）：
#   /app/server_ts/dist/...     ← HERE = /app/server_ts/dist → ROOT = /app
#   /app/shared/{data,static,cache}
# 持久卷必须挂到 **/app/shared**（SQLite app.db 与上传/图片/静态资源都在其下）。
#
# 密钥一律走环境变量（src/env.ts 每个字段都有对应 env 覆盖名）：
# **不烘焙 shared/config.yaml**（含真实密钥且被 .gitignore 排除）。
# 若把 config.yaml 放进持久卷 /app/shared/config.yaml，env.ts 会自动加载（零 env 即可全量配置）。
#
# 构建上下文 = server_ts/（自包含，约 16MB）：
#   仓库根有 11GB（shared 4.6G / server_py 4.5G / .git 850M / node_modules …），
#   绝不能整体上传；tsc 不产出的运行期资源（db/init.sql、assets/chinese_wordbank.json）
#   已随源码放进本上下文。
#
# 种子与启动引导（2026-09-20 加）：
#   容器首启时 /app/shared 是空的，而 app.db / 前端产物 / config.yaml 必须在服务起来前就位。
#   故构建上下文带一份 _seed/（13MB，由仓库根 _cb_seedgen.cjs 生成，**不入库**——含生产
#   app.db），运行阶段 COPY 成 /app/seed，再由 docker-entrypoint.sh 铺到 /app/shared。
#   ⚠️ 种子里 config.yaml 的密钥字段已清空（沿用「不烘焙密钥」的原设计），真实密钥走
#     服务配置的 EnvParam 注入（见仓库根 _cb_pushenv.cjs）。
#   ⚠️ _seed/static/web 必须取自 web/dist，不能取 shared/static/web —— 后者是停留在
#      2026-08-02 的旧构建，会让 /web/ 打开几个月前的旧前端。
#
# ⚠️ CloudBase 构建镜像与本机的三处差异（2026-09-20 实测，前两次部署均因此失败）：
#   1) 构建容器带 NODE_ENV=production → `npm ci` 会省略 devDependencies
#      （曾只装 19 包 → `sh: 1: tsc: not found`）。必须显式 `--include=dev`。
#   2) 该镜像是**定制 npm**：默认不执行依赖的 install 脚本
#      （警告 "install-scripts … allowScripts"，且其建议的 `npm install-scripts approve`
#       在官方 npm 11.17 里根本不存在 —— 即平台补丁，不能靠改 npm 配置绕过）。
#      → 原生模块必须**绕开 npm**、用 node 直接执行安装流程（见下方 better-sqlite3 段）。
#   3) lockfile 必须**在隔离空目录**里生成。server_ts 的 node_modules 是指向仓库根
#      pnpm 符号链接农场（../node_modules/.pnpm/*）的 link，若在仓库内跑
#      `npm install --package-lock-only`，npm 会把「磁盘现状」记成 lock：
#      19 条 link 记录、传递依赖（bindings / prebuild-install / @img/sharp-*）全缺；
#      容器里 `npm ci` 就去建指向镜像外的死符号链接 → `Cannot find module 'better-sqlite3'`。
#      当前 lock（212 条、0 link）由空目录生成，复现步骤：
#        mkdir -p /tmp/lockgen && cp server_ts/package.json /tmp/lockgen/
#        cd /tmp/lockgen && npm install --package-lock-only --ignore-scripts
#        cp package-lock.json <repo>/server_ts/package-lock.json
#      自检：entries > 200 且 .pnpm 条目数为 0。
#
# 部署：tcb cloudrun deploy --env-id <envId> --service-name aiphonix-api \
#        --source <abs path>/server_ts --port 8080 --min-num 1 --max-num 1 --wait

# ── 构建阶段 ──
FROM node:24-slim AS build
# python3/make/g++：better-sqlite3 拉不到预编译包时做源码编译的兜底工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server_ts

COPY package.json package-lock.json ./
# --include=dev：构建容器带 NODE_ENV=production，不加这个拿不到 typescript
RUN npm ci --include=dev --no-audit --no-fund

# 原生模块自检 + better-sqlite3 手动构建。
# sharp 0.33 的二进制来自可选依赖 @img/sharp-linux-x64（普通包、无脚本），npm ci 即可就位；
# 只有 better-sqlite3 需要跑 install（prebuild-install 下载 / node-gyp 源码编译）。
# 这里刻意不使用 `npm rebuild`：它同样受上面的脚本拦截，只会「假成功」。
#   → 用 node 直接调 prebuild-install；拉不到预编译包再退到 node-gyp 源码编译。
RUN set -eux; \
    cd /app/server_ts/node_modules/better-sqlite3; \
    node /app/server_ts/node_modules/prebuild-install/bin.js -r node \
      || npx --yes node-gyp@10.3.1 rebuild --release; \
    cd /app/server_ts; \
    node -e "const D=require('/app/server_ts/node_modules/better-sqlite3');const db=new D(':memory:');db.exec('create table t(a)');db.prepare('insert into t values (?)').run(1);console.log('[build] better-sqlite3 ok rows=' + db.prepare('select count(*) c from t').get().c);db.close()"; \
    node -e "const s=require('/app/server_ts/node_modules/sharp');console.log('[build] sharp ok vips=' + s.versions.vips)"

COPY tsconfig.json ./
# scripts/copy-assets.mjs：把 tsc 不会拷贝的运行期资源（src/db/init.sql）送进 dist
COPY scripts ./scripts
COPY src ./src
# 运行期数据资产（chinese_wordbank.json：chinese_practice / ai_chat 查词用）
COPY assets ./assets
RUN npm run build
# 丢掉 devDependencies（typescript 等）；已构建好的原生二进制保留在 node_modules 内
RUN npm prune --omit=dev

# ── 运行阶段 ──
# 纯 runtime 基础镜像：不带 python3/make/g++，故绝不在本阶段重装原生模块（拉不到预编译包就会崩）。
# node_modules 直接从 build 阶段整体搬运（同 node:24-slim → ABI 一致，原生二进制可复用）。
FROM node:24-slim
ENV NODE_ENV=production
# 平台会注入 PORT；这里给默认值便于本地 docker run 调试
ENV PORT=8080
# 先建出卷挂载点（首启若挂空卷，better-sqlite3 会建库并执行 dist/db/init.sql 的 CREATE TABLE IF NOT EXISTS）
RUN mkdir -p /app/shared/data /app/shared/static /app/shared/cache
WORKDIR /app/server_ts
COPY --from=build /app/server_ts/node_modules ./node_modules
COPY --from=build /app/server_ts/package.json ./package.json
COPY --from=build /app/server_ts/dist ./dist
COPY --from=build /app/server_ts/assets ./assets
WORKDIR /app
# 启动引导：把镜像内的种子（app.db / static/web / config.yaml）铺到 /app/shared（详见脚本注释）。
# sed 清掉 CRLF —— 在 Windows 上写出的脚本会在 `#!/bin/sh\r` 处报 "not found"。
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && sed -i 's/\r$//' /app/docker-entrypoint.sh
# 种子目录（13MB）：构建上下文 server_ts/_seed，由 _cb_seedgen.cjs 生成且不入库。
# ⚠️ 含生产用户数据（app.db），故本镜像只能留在用户自有私有仓库，不可公开分发。
COPY _seed ./seed
EXPOSE 8080
CMD ["/app/docker-entrypoint.sh", "node", "server_ts/dist/index.js"]
