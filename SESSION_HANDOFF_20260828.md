# SESSION_HANDOFF_20260828

> 新会话先读这个文件。上一份交接：`SESSION_HANDOFF_20260815.md`（Android/Web 时代，162 天前）。
> 本会话主题：**AiPhonix TS 后端（server_ts → server_cf）全部迁移 Cloudflare Workers 后的收官整改**（20 项问题优先级清单的 8 项已落地）。

## 当前状态（2026-08-28）

- **生产**：`server_cf` Worker `aiphonix-api` @ `https://aiphonix-api.xinyi7lan.workers.dev`
  - 最新部署 **Version `8fb87e9d`**（缩略图路由）；前序：`af8fff5e`（前端小图）→ `22e2b3e2`（缓存头）→ `03364622`（TTL）→ `5a11cece`（D1 迁移）→ `8856cf35`（DI）→ `eb1c91b9`(🥡) 等
  - 绑定：D1 `aiphonix-db`（id 27debe4f-…）、R2 `aiphonix-files`、ASSETS（45 文件）
- **staging**：Worker `aiphonix-api-staging` @ `https://aiphonix-api-staging.xinyi7lan.workers.dev`（Version `1f7e7044`），独立 D1 `aiphonix-db-staging` + R2 `aiphonix-files-staging`
- **后台任务**：3027 张字卡缩略图已全部生成（`.thumbs/` 本地 + R2 上传中）→ `# 待办 1`
- **本地浏览器/手机测试提示**：phone 硬刷新 + SW 自动更新 precache

## 本会话完成（2026-08-28，按执行顺序）

| # | 项 | 落地内容 | 部署版本 |
|---|---|---|---|
| 🔴4 | 静态资源 → Workers Assets | `[assets] directory=./static_assets binding=ASSETS run_worker_first=false`；`_headers` 缓存头；SPA 回退在 Worker（`fetch "/web/"`）；探针/根 index 删除；45 文件 | `c5f38857` |
| 🔴3 | 依赖注入（secret 轮换生效） | ark/soe 按 config 现取；tts 密钥快照缓存（保 token）；auth JWT 密钥源比较；char_images 索引 TTL 60s | `8856cf35` |
| 🟡10 | 密钥预检 | `scripts/check_secrets.ps1`（11 必需 + 4 可选），挂 `deploy.ps1` [0.5/4] 门禁 | 随各次部署 |
| 🟠5 | JSON 当 DB → D1 | `char_image_index`（3028 行，id 保序）、`char_image_feedback`（709 行，UPSERT 消竞态）、`wordbank_item`（203 词）；迁移 0002/0003；`seed_d1_from_json.mjs` | `5a11cece` |
| 🟠6 | 模块缓存 TTL 化 | `lib/ttlCache.ts`；essays/import_templates/chinese_practice/word_suggestions 60s TTL + 写后 refresh | `03364622` |
| 🟠7 | 静态缓存头定稿 | hash 产物 immutable 1y（🔴4 已有）；JSON/svg no-cache；字母音频 1d | `22e2b3e2` |
| 🟡8 | 可观测性 | `request_logs` 表（0004）+ `lib/observe.ts` + `/api/v1/ops/logs|metrics`（JWT 保护） | `eb1c91b9` |
| 🟡9 | staging 环境 | wrangler `[env.staging]`；独立 D1/R2；`setup_staging.ps1` 推密钥；`deploy.ps1 -Env staging`；4 迁移+灌库 | `1f7e7044` |
| 🎨 | 字卡图片加速 | 2048px/3.3MB PNG → 640px JPEG ~60KB；`?w=640` 直读 R2 `data/char_images_thumb/<原名>.jpg`；前端 `charImageUrl(item.image,640)`+lazy+decoding | `af8fff5e`+`8fb87e9d` |

## 关键改动文件（server_cf/）

- 路由/入口：`src/index.ts`（Assets/SPA/ops 挂载/日志中间件/onError）、`src/routes/{char_images,wordbank,ops,essays,import_templates,chinese_practice,word_suggestions,soe,tts}.ts`、`src/middleware/auth.ts`
- lib：`src/lib/{ttlCache,observe,ark}.ts`（新建 ttlCache/observe；重写 char_images 缓存）
- db：`src/db/schema.ts`（+charImageIndex/charImageFeedback/wordbankItem/requestLogs）
- 迁移：`migrations/0002_char_json_to_d1.sql`、`0003_char_image_index_id.sql`、`0004_request_logs.sql`
- 脚本：`scripts/{deploy.ps1(-Env),check_secrets.ps1(-Env),build_web_assets.ps1,deploy_web.ps1,setup_staging.ps1,seed_d1_from_json.mjs,gen_char_thumbs.py,gen_char_thumbs.mjs}`
- 前端：`web/src/{services/charImages.ts,pages/CharImagePage.tsx}`（缩略图）
- 文档：`server_cf/MIGRATION_NOTES.md`（8 个落地项全部有节）、`docs/session-transcript-20260828.md`（原始转录）、`session-export-20260828.md`（整理导出）

## 坑（必须记住，全踩过）

- **workerd 禁止运行时 WASM 编译**：`@jsquash` 在 Worker 里必然抛 `Wasm code generation disallowed by embedder` → 图像变换必须**离线预生成**（PIL 本地批处理，见 gen_char_thumbs.py）。
- **`_headers`（下划线）** 才是 wrangler 4.127 认的资产头文件名；`.headers` 无效。路径规则支持 `*` 通配，缩进 `Header: value`。
- **`wrangler r2 object get/put` 是单位置参数 `bucket/key`**；`get` 用 `--file`（`--pipe` 在 PS 5.1 下 0xC0000409 崩溃）。
- **`wrangler secret put/ list` 值不可回读**；staging 密钥从 `shared/config.yaml` 推（见 setup_staging.ps1）。
- **PS 5.1**：无三元、`pwsh -File` 用 `& .\scripts\x.ps1`、脚本纯 ASCII 注释、`.mjs`/`.py` 处理中文数据（PS 拼 UTF-8 会乱码）。
- **Python urllib 被 Cloudflare 403**（默认 UA 被拦）→ 加浏览器 UA + `ProxyHandler({})` 绕过本机代理。
- **D1 迁移先于部署**：`wrangler d1 migrations apply aiphonix-db --remote`（staging 加 `--env staging`）；灌库 `node scripts/seed_d1_from_json.mjs --remote [--env staging] <3 json>`。
- **多环境配置后 wrangler deploy 会警告**"Multiple environments..."——prod 可用 `--env=""` 消警（未改，备注）。
- **`INSERT OR REPLACE` 以 char 为主键会把认/写重字变体合并**→ 索引表用显式 id 保序（0003）。
- **Assets SPA 回退**：`ASSETS.fetch("/web/index.html")` 会 307 → 必须 fetch `"/web/"`；平台 `not_found_handling` 对 run_worker_first=false 无效。

## 待办（下一步）

1. **⏳ 缩略图上传完成**：`pwsh-23` 后台任务（3027 张 → R2）跑完后，抽查若干 `?w=640` 与手机实测页面，向用户汇报完成。
2. 可选优化：WebP 缩略图（-30~50%）；768px 变体（3x 屏）；列表接口瘦身（3028 条 JSON 减字段/分页）。
3. 新项目的建议起点：读 `PROJECT_MEMORY.md`（已更新 2026-08-28 节）→ `server_cf/MIGRATION_NOTES.md` → 本文件。