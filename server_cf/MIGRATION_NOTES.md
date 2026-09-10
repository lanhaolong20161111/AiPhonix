# server_cf 迁移契约（所有迁移文件必须遵守）

> 目标：把 `../server_ts/src` 的 Hono 后端逐文件迁移到本工程（Cloudflare Workers）。
> 迁移后的文件写进 `AiPhonix/server_cf/src` 对应路径。**业务逻辑/响应结构必须逐字保留**，只换基础设施层。

## 已存在的基础设施（直接 import，禁止重新发明）

### 1. env（`src/env.ts`）
```ts
import { setEnv, getEnv, getConfig } from "../env.js"   // 路径按层级调整
getConfig()            // AppConfig：cfg.deepseek / cfg.baidu_tts / cfg.tencent / cfg.ark_image / cfg.ark_chat / cfg.pp_structure / cfg.llm_prompts
getEnv()               // Bindings：.DB (D1) / .FILES (R2) / secrets（DEEPSEEK_API_KEY 等，见 src/bindings.ts）
```
- **禁止** `process.env.*` → 一律 `getEnv().XXX`
- **禁止** `DATA_DIR / STATIC_DIR / ROOT / HERE` 等目录导出 → 用下方 key 映射
- `cfg.server` 已删除（Workers 无需监听配置）

### 2. 数据库（`src/db/index.ts`）— D1 + drizzle，全 async
```ts
import { getDb, sqlFirst, sqlRun, sqlAll, parseJsonArray } from "../db/index.js"
import * as schema from "../db/schema.js"   // 与 server_ts 完全相同，sqliteTable 定义复用

await getDb().select().from(users).where(eq(users.id, 1)).get()   // 原 db.select()...get()
await getDb().insert(t).values({...}).run()                        // 原 db.insert()...run()
await getDb().update(t).set({...}).where(...).run()
await getDb().delete(t).where(...).run()
// onConflictDoUpdate / returning / orderBy / limit 同样可用，全部加 await
// 原生 SQL（替代 sqlite.prepare().get/all/run + sqlite.exec）：
await sqlFirst<T>("SELECT ... WHERE id=?", sid)      // 单行或 null
await sqlAll<T>("SELECT ...", a, b)                  // 行数组
await sqlRun("DELETE FROM ... WHERE ...")            // 写
```
- **禁止** `import { db, sqlite }`（不存在）；`sqlite.prepare(...).get()` → `sqlFirst(...)`；`.all()` → `sqlAll(...)`；`.run()/exec` → `sqlRun(...)`
- 原 `db.select()...all()/.get()/.run()` → 加 `await` + `getDb()`
- drizzle 表定义里 createdAt 是 numeric 模式，别改 schema.ts
- 事务（sqlite.transaction）→ 顺序 await 即可（D1 无交互事务；写序列很少，可接受）

### 3. 文件存储（`src/lib/storage.ts`）— R2
```ts
import { toKey, readBlob, readText, writeBlob, writeText, exists, listKeys, removeBlob } from "../lib/storage.js"
await readBlob(key): Promise<ArrayBuffer | null>
await readText(key): Promise<string | null>
await writeBlob(key, data, contentType?)   // data: ArrayBuffer|Uint8Array|string
await writeText(key, text, contentType?)
await exists(key): Promise<boolean>
await listKeys(prefix): Promise<string[]>   // 替代 readdirSync
await removeBlob(key)
toKey(path): string   // 任意本地绝对/相对路径 → R2 key（"C:\x\shared\data\a.jpg" → "data/a.jpg"）
```

### 4. JSON 文件（`src/lib/jsonfile.ts`）— 全 async
```ts
import { dataPath, readJson, writeJson } from "../lib/jsonfile.js"
dataPath("char_image_index.json")          // → "data/char_image_index.json"
await readJson<T>(key, fallback)           // 原 readJson
await writeJson(key, data)                 // 原 writeJson
// 原 `import { existsSync }` → `import { exists } from "./storage.js"` + await
```

### 5. 图片（`src/lib/image.ts`）— WASM，签名兼容
```ts
import { autoOrient, compressImage, compressImageToFile, toDataUrl, isAllowedImageExt, safeJoin, keyToDataUrl, decodeImage, encodeJpeg, sniffImageKind, readExifOrientation, applyOrientation } from "../lib/image.js"
```
- 入参/返回的"路径"都是 R2 key；`compressImage` 返回 `Buffer`；`autoOrient`/`compressImageToFile` 变化仅为 key 语义
- 原生 sharp 调用（metadata/raw/extract/trim 等）必须重写：`decodeImage(Uint8Array) → {image: ImageData, kind}` + 手写像素逻辑 + `encodeJpeg(ImageData, quality) → Buffer` + `writeBlob`

### 6. 其它已迁移 lib（`src/lib/`）：ocr.ts（ocrChain(key) 图片走 R2）、ark.ts（getArk()，image_paths 是 R2 key）、deepseek.ts（chat() 语义不变，全 async）、baiduTts.ts（BaiduTTSService 缓存走 R2）、soe.ts（TencentSOEService 不变）、aiShared.ts（readCache/writeCache 变 **async**，makeSentenceAudioPath 返回 POSIX key）、aiChineseContext.ts（CACHE_DIR/IMAGE_DIR/PROBLEM_IMAGE_DIR/SENTENCE_AUDIO_DIR/UPLOAD_DATA_DIR = "data/..." key；autoCropWhite(key)；**searchTitle 变 async**；resolveImagePath 是纯归一化 + 新增 basenameOf）、pinyin.ts/aiTextUtils.ts/practiceWeights.ts/prompts.ts（原样）
- `middleware/auth.ts`：requireAuth/resolveCurrentUser/createAccessToken/hashToken 不变（签名一致），**无 sqlite 导出**
- `lib/quest_graph.ts`：**全部导出已变 async**（start/startRetry/answer/resume/rawState/retryErrorsSeed/replay/history/report），调用点必须 await
- `lib/ai_practice.ts`：startSession/sendAnswer 本就 async（内部已适配）；loadProfile/loadState/saveProfile 私有已 async
- `lib/deepseek.ts`：getCallLogs/clearCallLogs/getDayCost 已变 async（chat 不变）

## 目录常量 → R2 key 映射（硬规则）

| server_ts | server_cf key |
|---|---|
| `DATA_DIR` | `"data"` |
| `STATIC_DIR` | `"static"` |
| `join(DATA_DIR, "char_image_index.json")` | `dataPath("char_image_index.json")` |
| aiChineseContext 的五个目录 | 见上（"data/ai_chinese_cache" 等） |
| `join(DATA_DIR, "ai_homework_images")` | `"data/ai_homework_images"` |
| `join(DATA_DIR, "ai_homework_problems")` | `"data/ai_homework_problems"` |
| `join(DATA_DIR, "uploads")` | `"data/uploads"` |
| `join(DATA_DIR, "subtitle_captures")` | `"data/subtitle_captures"` |
| `join(DATA_DIR, "char_images")` | `"data/char_images"` |
| `join(DATA_DIR, "char_audio")` | `"data/char_audio"` |
| `join(DATA_DIR, "cache/tts")` | `"data/cache/tts"` |
| `join(DATA_DIR, "ai_chinese_sentence_audio")` | `"data/ai_chinese_sentence_audio"` |
| pinyin/ipa 音频目录 | 路由内按同规则映射（原 join(DATA_DIR,...) → "data/..."） |
| `join(STATIC_DIR, "letter_clips")` | `"static/letter_clips"` |
| `join(STATIC_DIR, "videos")` | `"static/videos"` |
| `join(STATIC_DIR, "web")` | `"static/web"` |
| `join(ROOT, "shared", "downloads", "AiPhonix.apk")` | `"downloads/AiPhonix.apk"` |

- 路径拼接一律 POSIX：`` `${dir}/${name}` `` 或 `dataPath(...)`；**禁止 node:path 的 join/dirname 用于存储路径**（R2 key 不是文件系统路径）。node:path 仍可用于 extname/basename 类字符串操作，但优先用正则。
- `join(DATA_DIR, x)` 一律改 `dataPath(x)` 或字面量 key。

## 其它硬规则

1. **逐字保留**：路由路径、请求字段、响应 JSON 结构、错误文案、状态码、console 文案（除 fs/sqlite 语义词）。
2. handler 里凡新增 await → 函数已是 async（Hono handler 原生 async，直接加）。
3. helper 函数因 await 变 async → 同文件调用点补 await；导出函数签名变化在文件头注释标注「Cloud 版: xxx 变 async」。
4. `renameSync(a,b)` → `const buf = await readBlob(a); if (buf) { await writeBlob(b, buf); await removeBlob(a) }`
5. `mkdirSync` → 删掉（R2 无目录概念）。
6. `readFileSync(p).toString("base64")` → `Buffer.from(await readBlob(p) ?? new ArrayBuffer(0)).toString("base64")`（先判 null）。
7. `existsSync(p)` → `await exists(p)`。
8. `readdirSync(dir)` → `await listKeys(dir)`（返回完整 key，文件名可 `.split("/").pop()`）。
9. `writeFileSync(p, data)` → `await writeBlob(p, data, <按扩展名给 contentType，未知省略>)`。
10. WebSocket/`ws` 包禁止 → 参照 `src/lib/soe.ts`（原生 WebSocket + addEventListener）。
11. `AbortSignal.timeout` 在 Workers 可用；setTimeout/setInterval 可用。
12. `sharp` 禁止（见第 5 条）。`better-sqlite3` 禁止（见第 2 条）。
13. CORS/日志/错误处理由 `src/index.ts` 全局负责，路由文件不要重复添加。
14. 路由文件最后 `export default router`。
15. `import ... from "../db/schema.js"` 的表导入照抄原文件。

## 验证（写完自己负责的文件后）

```powershell
cd C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_cf
npx tsc --noEmit
```
- 只修复 **自己负责的文件** 报的错；别人还没迁移完的文件报错直接忽略（写明即可）。
- 常见错误：漏 await（TS2571/对象可能是 null）、`Buffer` 缺 import（nodejs_compat 下 Buffer 全局可用，无需 import）、ImageData 构造（ Workers 自带）。

## 2026-08-28 SOE/TTS Workers 踩坑修复（重要）

1. **workerd 出站 WebSocket 必须用 fetch+Upgrade 头**：`new WebSocket()` 不可靠。模式：`fetch(https://..., { headers: { Upgrade: "websocket" } })` → `resp.webSocket.accept()`。
2. **fetch URL 不能用 wss://**：workerd 报 "Fetch API cannot load"，改 https:// + Upgrade 头。
3. **中文参数不要预先 encodeURIComponent**：workerd 会对 URL 再编码，%E6 → %25E6 双重编码导致腾讯 4102 RefText 无效。只编码保留字符（& = + % # ? 空格），非 ASCII 原样交给 fetch。
4. **TENCENT_APP_ID 曾漏配 secret**：报 404 握手拒绝（URL 里 /soe/api/ 后为空）。检查线上 URL 是否含 appid。
5. **腾讯 4107**：音频长度必须偶数，lib/soe.ts 已做奇数截断保护。
6. **pinyin 场景（eval_mode 8）ref_text 必须带数字声调**（如 tan4 / chun1 tian1），纯 "hao" 会 4103 OOV。web 端 CharImagePage 用 normalizePinyin 已正确。
7. **百度 TTS token 冷启动**：新部署首次调用可能连续返回短音频（<1KB 保护触发），重试即恢复；baidutts.ts 失败信息现含长度/CT/头部诊断。
8. **本地调试 SOE**：`wrangler dev` + `.dev.vars`（勿提交）；PS5.1 测试脚本发中文 JSON 必须 UTF-8 字节体（GetBytes），否则 ???? 自毒化。

## 2026-08-28 追加：wrangler r2 必须显式 --remote（关键！）

- **本环境 `wrangler r2 object put/get` 默认走本地 miniflare 桶**（`usingLocalBucket`），
  只有加 `--remote` 才真正写/读云端 R2！曾导致"上传后线上无变化"。
- 手敲任何 r2 命令必须带 `--remote`；上传完整 dist 用：
  `npx wrangler r2 object put aiphonix-files/static/web/<rel> --file <本地> --content-type <ct> --remote`
- 排查技巧：`wrangler r2 object get ... --pipe`（cmd 级重定向，勿过 PS 管道转码）对比
  worker 实际服务内容（可用临时 `/_dbg_r2` 端点 head 探测，用完删除）。
- 助记词开关"点了不实时、要刷新"根因：PinyinChips 与页面各持一份 useState 副本，
  点击只更新页面那份 → mnemonicPref.ts 改为模块级共享状态（订阅广播），
  所有组件实时联动，同时 localStorage 持久化。

## 助记词开关页面清单（6 页面 + PinyinChips）
拼音表 / 拼音详情 / 自然拼读音素 / 音素详情 / 字母详情 / 认字（含英词/英句）/ PinyinChips 组件内

## 2026-08-28 部署脚本固化 + 静态缓存/CORS 优化（高优项落地）

### 部署唯一入口（禁止手敲 wrangler）
- `pwsh -File scripts/deploy.ps1` — 全量：tsc 门 → wrangler deploy → 构建 Web → R2 `--remote` 上传 → 验证线上。
- `scripts/deploy.ps1 -SkipWeb`（只改后端）/ `-SkipWorker`（只改前端）。
- `scripts/deploy_web.ps1`（可 `-SkipBuild`）— 只做 Web：tsc+vite 构建 → 遍历 dist 全部上传
  （**始终 `--remote`**，含 content-type 映射）→ curl 线上 index.html 校验引用的 hash 与 HTTP 200。
- package.json `deploy` 已改为 `tsc --noEmit && wrangler deploy`（类型错误直接中止，防坏版本上线）。
- ⚠️ .ps1 一律 **ASCII-only 文本**（勿写中文/emoji，PS5.1 无 BOM 会乱码炸解析）；
  ⚠️ 脚本内**禁止 `$ErrorActionPreference = "Stop"`**——wrangler/npx 的代理警告走 stderr，
  Stop 模式下会被当成终止错误假失败；统一靠 `$LASTEXITCODE` 判断。

### 静态资源缓存/CORS（src/index.ts）
- `/web/assets/*`（带 hash 文件）→ `Cache-Control: public, max-age=31536000, immutable`。
- index.html / sw.js / manifest → `no-cache`（每次回源拿最新引用）。
- CORS 中间件对 `/web/*`、`/letter-clips/*`、`/videos/*`、`/web`、`/` **直接放行**（同源静态无需 CORS，
  省 origin 解析与响应头写入）；API 路由 CORS 行为不变。

### env/config 最小加固
- `src/env.ts`：`getConfig()` 加 60s TTL——secret 轮换最多 1 分钟生效（无需等 isolate 重启）；
  `setEnv()` 检测到 env 引用变化打 warning（安全网）。
- `src/routes/char_images.ts`：`pinyinCache` 加 5000 条上限，防无界增长撑爆 isolate 内存。

## 2026-08-28 静态资源迁移 Workers Assets（🔴4 落地，替代旧 R2 方案）

> 上一节「静态资源缓存/CORS」里 `deploy_web.ps1 遍历 dist 上传 R2 --remote` 的旧做法**已废弃**。
> Web 静态资源现在随 Worker 一起经 **Workers Assets** 部署（一次部署原子生效），不再走 R2。

### wrangler.toml `[assets]`
```toml
[assets]
directory = "./static_assets"   # 根下 web/ 子树 → 线上 /web/* 路径不变
binding = "ASSETS"              # Worker 里 env.ASSETS.fetch() 可取回文件
run_worker_first = false        # 默认：已有文件平台直出（0 Worker CPU）；未命中才进 Worker
```
- **不要**配 `not_found_handling`：它对 `run_worker_first=false` 不拦截未命中请求（未命中直接进 Worker），
  且 SPA 回退回的是**根** `/index.html`，与我们 `/web/` 基准不符。SPA 深链接回退在 Worker 内实现（见下）。

### 自定义响应头：`static_assets/_headers`（下划线，Pages 风格，非 `.headers`）
- 路径行 + 缩进 `Header: value`；`*` 通配可用（`/web/assets/*` 已验证命中 immutable）。
- 规则：`/web/index.html`、`/web/sw.js`、`/web/manifest.webmanifest`、`/web/registerSW.js`、
  `/web/workbox-*.js` → `Cache-Control: no-cache`；`/web/assets/*` → `public, max-age=31536000, immutable`。
- 改名史：wrangler 只认 `_headers`（HEADERS_FILENAME="_headers"），`.headers` 会被当普通文件上传且不生效。

### SPA 深链接回退（src/index.ts `serveWebIndex`）
- `/web`、`/web/*` 挂在 Worker 兜底：Assets 未命中的路径（React Router 深链接）→ 取 index.html 内容返回。
- **关键坑**：`env.ASSETS.fetch("/web/index.html")` 会触发 Assets clean-URL 重定向（307 → `/web/`），
  导致路径丢失。必须 fetch **`/web/`（带斜杠）**——Assets 对 `/web/` 直接命中 `web/index.html` 并 200 返回内容。
- 响应加 `Cache-Control: no-cache`（每次回源拿最新 asset 引用）。

### 构建/部署链
- `scripts/build_web_assets.ps1`：tsc -b → vite build → purge `static_assets/web/` → copy `web/dist/*`。
- `scripts/deploy.ps1`（全量 / `-SkipWeb`）→ build_web_assets → wrangler deploy（Worker + Assets 原子）→ 线上校验。
- 根 `/` 仍由 Worker 302 → `/web/`（assets 根不再放 index.html）。
- 已验证：`/web/` 与深链接 `/web/module/...` 均 200 text/html 且引用同一 hashed JS；
  `/zz_nonexistent`（Accept: text/html）→ 404 JSON（API 语义保留）；`/web/assets/*.js` immutable。

### 部署前密钥体检（🟡10 落地）
- `scripts/check_secrets.ps1`：`wrangler secret list`（JSON）逐项核对 11 个必需 secret + 4 个可选 secret，
  缺任何一个非零退出；`deploy.ps1` 已把它作为 [0.5/4] 门禁（`-SkipSecrets` 可跳过）。

## 2026-08-28 服务单例 → 按 config 现取（🔴3 落地）

> 背景：`getConfig()` 有 60s TTL、`setEnv(env)` 每请求更新，本意是 secret 轮换最多 1 分钟生效。
> 但若干服务在模块级「首次构造后永久缓存」实例，把旧 secret 焊死到 isolate 回收，使 TTL 形同虚设。
> 修复原则：**服务实例必须跟随 config/secret 重建**，不再模块级永久缓存。

| 文件 | 原问题 | 修复 |
|---|---|---|
| `src/lib/ark.ts` | `let _ark` 单例焊死 API key | `getArk()` 每次 `createArkService()`（内部读 `getConfig()`/`getEnv()`），无状态零成本 |
| `src/routes/soe.ts` | `let svc` 单例 | `getSvc()` 每次 `new TencentSOEService(...)`（仅存 3 字符串） |
| `src/routes/tts.ts` | `let svc` 单例 | **密钥快照为键**的实例缓存：secret 变化才重建；保留实例内 25h 百度 access token（不可每请求重建，否则每请求重拉 token） |
| `src/middleware/auth.ts` | `let _secretKey` 焊死 JWT 密钥 | 按 `getEnv().JWT_SECRET` 变化重建（轮换立即生效）；未配置时随机回退保持 isolate 内稳定（避免 60s 轮换致全部 token 失效） |
| `src/routes/char_images.ts` | `index/indexMap/loaded` 装载一次永不刷新 | 加 `INDEX_TTL_MS=60s`：超时重读 R2，多 isolate 下索引更新最多延迟 60s；构建局部后整体替换防并发读半成品；失败置空下次重试 |

- 遗留（后续 cosmetic，非本轮范围）：`getDb()`/`getEnv()` 无状态直调点保留；`import_templates/essays/wordbank/word_suggestions/chinese_practice` 等纯静态数据缓存仍是「装载一次」模式（非 secret，跨 isolate 一致性问题同 char_images，可后续统一加 TTL）。

## 2026-08-28 认字索引/反馈 + 词库 JSON → D1 表（🟠5 落地）

> 背景：`data/char_image_index.json`、`data/char_image_feedback.json`、`data/wordbank.json` 是 R2 上的「JSON 当数据库」：
> 反馈/加词是**整文件读改写**（并发后写覆盖前写 → 数据丢失），且模块级缓存跨 isolate 不一致（改完数据线上不更新）。
> 修复：三处全部迁 D1（migrations 0002/0003），服务端读写走 D1，R2 JSON 保留为只读快照兜底。

| 表 | 原 JSON | 设计 | 效果 |
|---|---|---|---|
| `char_image_index` | 3028 条 | id 自增主键（=原数组序）+ char 索引 + 核心列 + `extra` JSON 保全字段 | 列表**保序含重字变体**（同字 认 .png / 写 .jpg 各一条）；`:char` 按 id 倒序取最后一条 = 旧 Map 语义；无缓存零陈旧 |
| `char_image_feedback` | 709 条 | 唯一键 `(user_id,char,grade,semester,type)` + UPSERT | 并发写原子合并（learning_status 非空才覆盖、needs_regen 取并集），**消读改写竞态** |
| `wordbank_item` | chars 0 + words 203 | text 主键 + kind + `json` 列整体存原条目 | add-word UPSERT 原子；API 响应与旧行为字节级一致 |

- **坑**：0002 初版用 `char` 作主键，`INSERT OR REPLACE` 把 116 个「同字认/写变体」合并成 2912 行 → 0003 重建为 id 主键后恢复 3028（实测类型 B 变体都在）。
- **灌库**：`scripts/seed_d1_from_json.mjs <index.json> <feedback.json> <wordbank.json> [--remote]`（Node 生成批量 SQL，规避 PS5.1 中文乱码；INSERT OR REPLACE 可重复执行；幂等）。
- **线上实测**：列表 total=3028 首条 丝/丧、`丝`→.jpg 写变体、grade+type 过滤 total=173、q=丝 total=3、反馈 UPSERT 两次合并正确（保留 correct + needs_regen=true）、词库 stats 0/203、search q=ap→5 条、`:file/丝.png` 200。测试行已清理。
- **迁移记录**：`wrangler d1 migrations apply aiphonix-db --remote`（0002+0003 已应用）。

## 2026-08-28 模块缓存跨 isolate 不一致 → TTL 化（🟠6 落地）

> 背景：多个路由「模块级装载一次永不刷新」——数据源（R2 JSON）更新后，各 isolate 永久陈旧（"上传后线上不更新"）；
> 且某 isolate 一旦装载失败，坏指针焊死到 isolate 回收。
> 修复：统一改为 **60s TTL 懒加载单飞缓存**（`src/lib/ttlCache.ts`），数据变更最多延迟 60s 生效，失败即失效下次重试。

| 文件 | 原状态 | 修复 |
|---|---|---|
| `src/lib/ttlCache.ts`（新） | — | get()（懒加载+TTL 重读+单飞+失败失效）+ refresh()（本地写后重置计时） |
| `src/routes/essays.ts` | `essaysCache` 装载一次 | ttlCache 包 essays.json 读取 |
| `src/routes/import_templates.ts` | `cache`+`loading` 装载一次 | ttlCache 包 import_templates.json 读取 |
| `src/routes/chinese_practice.ts` | `charMap/pinyinMap/sentenceCache` 装载一次；sentenceCache 是写路径 | 60s 重读：charMap/pinyinMap 整体替换；sentenceCache **合并**（本地已写键保留=本地最新，其余取 R2=跨 isolate 更新可见）；`saveSentenceCache()` 后 `refresh()` |
| `src/routes/word_suggestions.ts` | `cache/fallbackWords` 装载一次；写路径全量写回 | 60s 重读：R2 新键并入本地 map（本地已生成缓存保留）、fallbackWords 整体刷新；`saveCache()` 后 `refresh()` |

- **不属此轮**（每请求直读 R2，无模块缓存）：`chinese.ts` polyphone、`english.ts` vocabulary/sentences、`quiz.ts` 逐视频缓存文件、`aiShared.ts` readCache/writeCache 调用方（ai_chinese/ai_homework 等）。
- **线上实测**：essays 200×10 条、import-templates 200×7 条、`word-suggestions` POST 命中缓存 `source=cache`（零 LLM 花费）、`sentence-generate` 命中缓存 `source=cache`。

## 2026-08-28 静态资源缓存头定稿（🟠7 落地）

> 背景：分析发现带 hash 的构建产物只有 300s 缓存（本应永久缓存），且 index.html 曾是 300s 导致部署后旧页面残留。
> 🔴4（Workers Assets）已把 `/web/assets/*` 设为 immutable；本轮把其余文件的缓存策略显式补全并全部实测。

| 路径 | 策略 | 理由 |
|---|---|---|
| `/web/assets/*`（hash JS/CSS） | `public, max-age=31536000, immutable` | 文件名=内容指纹，永久缓存（🔴4 已设，本轮复验） |
| `/web/index.html`、`sw.js`、`manifest.webmanifest`、`registerSW.js`、`workbox-*.js` | `no-cache` | 每次构建变，必须回源拿最新引用（🔴4 已设） |
| `/web/*.json`（词库/例句/字例 6 个）、`favicon.svg`、`icons.svg` | `no-cache`（新增显式规则） | 无 hash、随构建/数据更新变化；原平台默认 max-age=0, must-revalidate 等价，显式声明更稳 |
| `/web/alphabet_audio/*.mp3`（26 个） | `public, max-age=86400`（新增） | 内容几乎不变；1 天缓存省掉每次点播的 304 校验往返；重新录音后可换文件名/等过期 |

- `_headers` 规则实测全部生效（curl 逐条核对）。部署 `22e2b3e2`（web 重建 hash 不变，无漂移；precache 5 entries）。

## 2026-08-28 可观测性（🟡8 落地）

> 背景：此前只有 `console.log("[req] ...")` + `console.error("[error]")`，排查问题全靠 `wrangler tail` 肉眼盯，无历史可查。
> 修复：结构化 JSON 日志行（tail/面板可直接 grep）+ 请求/错误落 D1（可查询、可聚合），并提供带 JWT 的查询端点。

- **migrations/0004**：`request_logs` 表（ts/method/path/status/duration_ms/level/message/meta；ts/status/path 索引；7 天保留，写入时 2% 概率清理）。
- **`src/lib/observe.ts`**：`recordLog()`——结构化 console 行（error 走 console.error）+ best-effort D1 落库（失败不阻断请求）。
- **`src/index.ts`**：
  - 请求日志中间件改为 `c.executionCtx.waitUntil(recordLog(...))`（不阻塞响应）；媒体快速成功仍不打（MEDIA_LOG_SKIP_PREFIXES 不变）。
  - `onError` 记录 error 行（message + 栈 meta），预算守卫记 warn。
- **`src/routes/ops.ts`**（挂 `/api/v1/ops`，requireAuth 保护）：
  - `GET /api/v1/ops/logs?level=&status=&path=&limit=` — 列表（id 倒序）
  - `GET /api/v1/ops/metrics?since=24h|1d|7d|ISO` — 汇总：总数/错误数/平均/最大耗时、按 status 分布、Top20 路径、p50/p95
- **线上实测**：注册临时用户登录后查询 logs（含 404/401/200 各状态行）与 metrics（n/errs/avg/p50/p95 正确）；无 token 访问 ops → 401；测试用户已清理。
- **行为说明**：① 抛异常的请求会记「info（含耗时）+ error（含栈）」两行（Hono 错误处理后外层中间件继续走），`level=error` 过滤即得纯错误列表；② 落库是 best-effort，突发并发下偶发丢一行（console 行不丢），属设计预期。

## 2026-08-28 staging 环境（🟡9 落地）

> 背景：只有 prod（workers_dev 单 worker），改代码直接打线上，无灰度/回滚预案。
> 修复：新增 wrangler `--env staging` 环境——独立 Worker + 独立 D1 + 独立 R2，改代码先打 staging 验证。

- **`wrangler.toml`**：`[env.staging]` + `[[env.staging.d1_databases]]`（aiphonix-db-staging，id 333fb1ce-…）+ `[[env.staging.r2_buckets]]`（aiphonix-files-staging）；worker 名自动派生 `aiphonix-api-staging`。
- **基础设施**：D1（`wrangler d1 create`）、R2 桶（`wrangler r2 bucket create`）已建；4 个迁移（0001–0004）已应用到 staging；索引/反馈/词库已从 R2 JSON 快照灌入（3028/709/203）。
- **密钥**：`scripts/setup_staging.ps1` 一次性从 `shared/config.yaml`（deepseek/baidu/tencent/ark/pp 真实值）+ 新生成的 JWT_SECRET 推送 11 个 staging secrets（`wrangler secret put --env staging`）。
- **脚本支持 env**：`deploy.ps1 -Env staging`（含 check_secrets -Env staging 门禁 + staging URL 验证与打印）；`check_secrets.ps1 -Env staging`；`seed_d1_from_json.mjs --env staging`。
- **部署**：`& .\scripts\deploy.ps1 -Env staging` → `https://aiphonix-api-staging.xinyi7lan.workers.dev`（Version `1f7e7044`，41 资产独立上传）。
- **staging 实测**：/web/ 200 HTML、sw.js 200、/health 200、char-images total=3028、wordbank words=203、注册/登录→/ops/logs 200（JWT 生效）、无 token → 401；测试用户已清理。
- **已知取舍**：staging R2 桶为空（char 图片/媒体 404，需时再拷贝）；首部署后 verify 曾短暂报 no refs（资产传播瞬时状态，随后 200 正常）。

## 2026-08-28 字卡图片加速（看图识字页 3.3MB/张 → ~60KB/张）

> 背景：`/web/module/char_image/practice?type=字` 拉全量 3028 条、前端过滤出 认+写 1564 张卡，每张卡 `<img>` 直接下载 **2048×2048 PNG ~3.3MB**（滑动一张卡即数 MB）→ 页面极慢。
> 方案：**离线预生成 640px JPEG 缩略图 → R2 `data/char_images_thumb/<原名>.jpg` → 路由直读（零 CPU）**；前端卡图改用 `?w=640`。

- **为什么不做运行时变换**：workerd 禁止运行时 WASM 编译（`WebAssembly.instantiate(): Wasm code generation disallowed by embedder`），`@jsquash`（decodePng/resize/encodeJpeg）在 Worker 里必然抛错（已用 wrangler tail 实证）。
- **生成**：`scripts/gen_char_thumbs.py`（PIL，LANCZOS 640px，JPEG q88 optimize，幂等跳过已有）— 原图本地已有 `shared/data/char_images/`（3484 张，与 R2 索引 3027 个文件名全部对得上）。
- **上传**：`scripts/gen_char_thumbs.mjs`（并发 5 个 wrangler put → `data/char_images_thumb/<原名>.jpg`，幂等可重跑）。
- **服务端**：`routes/char_images.ts` `GET /file/:filename?w=N` → 直读预生成缩略图（`image/jpeg` + `public, max-age=604800, immutable`）；未生成则回退原图（批处理补完中不报错）。
- **前端**：`services/charImages.ts` `charImageUrl(filename, width?)`；`CharImagePage.tsx` 卡图 `charImageUrl(item.image, 640)` + `loading="lazy" decoding="async"`。
- **实测**：`?w=640` → JPEG 91KB（原图 1,048,561B 约 11 倍；PNG 原图 3.3MB 可达 40-80 倍）；缓存头 immutable 7 天（浏览器/CDN 双缓存）；后端批处理生成+上传 3027 张（后台，~30 分钟）。
- **后续可选**：WebP 再省 30-50%；列表接口按需字段/分页（当前 3028 条 JSON 一次拉 ~1.5MB+拼 3028 个拼音）；缩略图改 768px 保 3x 屏清晰度。


## 2026-08-28 缩略图升级 768px WebP + 列表接口体积实测

> 三项可选优化（WebP / 768px / 列表瘦身）的落地结论。

### 768px WebP（已落地，替代 640px JPEG 成为首选）
- **采样对比**：768px WebP q82 比 640px JPEG q88 体积**约省一半**且更清晰（如 Be careful.jpg：93KB→69KB；90od.jpg：18.8KB→7.6KB）。
- **生成**：`scripts/gen_char_thumbs_webp.py`（PIL LANCZOS 768px，WEBP q82）→ `.thumbs_webp/`，3027 张 3 分钟生成完毕。
- **上传**：`scripts/gen_char_thumbs_webp.mjs`（并发 5 wrangler put --remote → `data/char_images_thumb/<原名>.webp`；`--op retry-missing` 探测线上缺失补传）。
- **服务端**：`GET /file/:filename?w=N` 现在**优先读 `.webp`**（image/webp），回退旧 `.jpg`（image/jpeg），最后回退原图。两代缩略图在 R2 并存，jpg 作为兜底保留。
- **前端**：`CharCardImage` 缩略图请求 `?w=768`。
- ⚠️ 坑：上传脚本 spawn wrangler `stdio:"ignore"` 时，偶发**假成功**（exit 0 但对象未落 R2，本地/远程桶都没有）。上传完必须跑 `--op retry-missing` 探测补漏；排查时用 `wrangler r2 object get --remote` 拉回比对字节数。

### 列表接口瘦身（实测后判定无需做）
- `GET /char-images?limit=100000`（3028 条全量）实测 **375KB 原始 / 47KB gzip 传输**（CF 自动压缩）。
- 字段已全部是前端在用的（char/image/grade/semester/type/pinyin/ipa/phonemes），无冗余可砍；
  分页会破坏前端"全量拉取+本地过滤+页码跳转"的交互，收益（47KB→更小）不抵改造风险。**结论：维持现状。**
- **完成状态（2026-08-29）**：3027 张 WebP 全部上传并经 `--op retry-missing` 终验 0 缺失（覆盖索引全量=App 实际使用的全部字卡）。
  实测 `?w=768` 返回 image/webp（丝.png 42KB / 丧.png 19KB / Big Muzzy.jpg 31KB，均低于原 640px JPEG）。
  注意：本地 `shared/data/char_images/` 有 3484 张，其中 457 张不在索引里（App 不显示），其 `?w=` 请求按设计回退原图，属正常现象。

## 2026-08-29 LLM 三级兜底（Ark → DeepSeek → GLM-5.3-Flash）

> 故障：AI 对话全挂。原因双重——① DeepSeek 402 Insufficient Balance（欠费）；② 线上 secret `ARK_CHAT_MODEL` 值被 YAML 行内注释污染
> （`deepseek-v4-flash-ga-260731" # 文本分析默认模型…` 整串推上去了），Ark 免费链路 404。两条链路同断 → ai_chat 静默吞错显示"AI 暂时没有回应"。

- **修复 ①**：重推干净的 `ARK_CHAT_MODEL` secret（免费链路恢复，教训：**推 secret 只推纯值，严禁带注释**）。
- **修复 ②（GLM 兜底）**：`lib/deepseek.ts` chatJson 链路改为 Ark 免费 → DeepSeek 付费 → **GLM-5.3-Flash 兜底**：
  - 触发条件：DeepSeek 任何失败（含 402 欠费）或本地预算守卫超限
  - 实现：`tryGlmFallback()` → BigModel OpenAI 兼容 `/v4/chat/completions`；未配置 `BIGMODEL_API_KEY` secret 时跳过（保持原错误）
  - **坑**：GLM-5.3-Flash 是常思考模型，`thinking` 不支持 disabled，只支持 `{"level":"low"|"high"|"max"}`（注意是 `level` 不是 `type`）；思维链吃 token → max_tokens 给 `max(2x, +1024)` 余量，否则 content 为空
  - 日志：同落 llm_call_log（cost 记 0）；prod/staging 均已推 `BIGMODEL_API_KEY`

## 2026-08-30 批量新功能（字族游戏 LLM 化 + 生词本 + 角色扮演 + 记录体系）

- **0005 迁移**：`wordbook_item`（生词本 SRS：box/next_review，唯一键 user_id+text）。路由 `/api/v1/wordbook`（add 幂等 times+1 / list / review 到期队列 / rate 打卡：答对 box+1 间隔拉长、答错回 1）。⚠️ drizzle 返回驼峰键，路由层要 mapRow 转 snake_case。
- **0006 迁移**：`radical_content`（偏旁魔法屋 LLM 内容缓存，唯一键 family+kind）。路由 `/api/v1/radical`：`/song`（AI 按字族编儿歌，全部族字必须入歌，缺字重试一次）+ `/riddles`（字谜池 JSON [{riddle,answer}]，答案必须命中前端传入的族内字集，防幻觉）。**每族只生成一次走缓存**，成本有界。前端：字族卡「🎵 儿歌」（爷爷/老师音色朗读）+「🧩 字谜」模式（谜面题干+族内字选项）。
- **角色扮演**：ai-chat body.role ∈ {libai, wukong, foreigner, teacher_gao, student}（ROLE_PROMPTS 覆盖老师人设）。前端按模块存偏好（lib/aiPrefs.ts），对话面板头部 chips 切换。
- **小老师反转模式**（role=student）：小豆出含错句子 → 孩子纠正 → 【判对】1/0。⚠️ 免费模型常跳过判卷 → 服务端兜底：role=student 且上一条是出题时，独立发一次 1/0 判卷调用（maxTokens 200 + 只取首个 [10] 数字 + warn 日志）。⚠️ 判卷响应要挂到面板 🏆 记分牌（lib/teacherScore.ts）。
- **前端新页面**：/module/wordbook（复习卡+词表）、/module/sentence_practice（造句批改，复用【改错】）、/module/char_map（汉字地图，3028 字按年级网格点亮，数据=char-images+feedback）、/module/parent_report（家长周报：近 7 天 SOE 柱状图/识字状态/最弱词榜）、/module/diary（成长日记：localStorage 存储+LLM 润色点评）、/module/radical_game（偏旁魔法屋）。首页 STANDALONE 加 5 个入口。
- **TTS 卡拉OK**：audioManager.playUrl(url, readingText) 按字符加权估算时间线广播 subscribeReading；useTts 自动传文本（请求体去 emoji，时间线用原文对齐渲染）；useGlobalReading hook 供 UI 高亮。对话气泡 + BlockText 已接入。
- **对话逐字点读**：气泡每字可点朗读；长按 550ms 加生词本（pointerdown 计时，lpFired 抑制误触）。
- **历史会话会话化**：条目绑定 session_id，点击恢复续聊（不再跳快照页）；「➕ 新对话」显式开新线程。⚠️ 旧条目无 sessionId 保持快照回看。
- **列表接口实测结论**：char-images 全量 375KB/gzip 47KB，瘦字段/分页无收益，维持现状。

## 2026-08-30 白板模块接入（openmaic-whiteboard → server_cf + web，第一阶段）

- **决策**：目标后端为 server_cf（生产），放弃 server_ts 接线方案（bundler 产物直配 Wrangler esbuild，NodeNext 转换全砍）。模块源码+依赖在 `AiPhonix/packages/openmaic-whiteboard/`。
- **web 侧**：`npm i file:../packages/openmaic-whiteboard`（symlink，dist bundler 产物 vite 直吃）+ `motion`/`lucide-react` 安到 web + `@openmaic/dsl`/`storage` file: 装 web（类型用）。
- ⚠️ **双 React 坑**：模块 node_modules 有 npm 自动安装的 react/react-dom 副本 → renderer 用第二份 React → hooks 全崩（`(void 0) is not a function`）。修复：vite `resolve.dedupe: ["react","react-dom","motion","framer-motion","lucide-react"]`。
- ⚠️ **echarts 可选 peer 坑**：renderer 的 Chart.js 在模块加载时执行 `echarts.use([...])`。vite alias 指到 stub（`src/lib/stubs/echartsStub.ts`），**use 必须是可调用空函数**（undefined 会在模块加载即崩）；rolldown 的 alias 对象键是**精确匹配**（前缀匹配会拼接余部导致路径错乱）。
- **server_cf**：`src/lib/whiteboard-store.ts`（D1 版 RuntimeStore，12 方法，语义照 browser.js：版本戳/前向迁移/未来版本拒写/毒行跳过/CAS）；`src/routes/whiteboard.ts` REST 封装（learnerKey 强制 JWT 身份；merge 仅并入本人）。错误映射：冲突 409/不存在 404/已存在 409/校验 400。
- ⚠️ **D1 读复制坑**：跨请求"写后读"会读到滞后副本（SELECT MAX(seq) 看不到上一次插入）→ storeFor() 用 `DB.withSession("first-primary")` 强制读主。
- **前端组件**：`web/src/components/WhiteboardPanel.tsx` 可嵌入任意页面（stageId 区分板块）；REST RuntimeStore（`lib/whiteboardRestStore.ts`）+ `createWhiteboardRuntimeService` + `configureWhiteboardRuntime` + 轮询 `refreshWhiteboardRuntimeProjection`。⚠️ 模块 Whiteboard 组件用 `useI18n`/`getToast`，未配置会崩 → ensureConfigured 里补 `configureI18n("zh-CN")` + no-op toast。
- **待办（阶段 4）**：ai-chat【画板】标签 → 服务端 wb_* 工具调用（AI 老师自动板书）；目前孩子端可互动画画（仅本地 stage store）。

## 2026-08-30 白板第二阶段（AI 自动板书 + 孩子端持久化）

- **线 2（AI 板书）**：输出约定加【画板】标签（每行一条，最多 5 行，few-shot 示例提高遵循率）；parseToolTags 解析 board[]；writeBoardToRuntime 写入白板运行时。⚠️ 三个坑：① record.id 必须 === payload.operationId（fold 幂等校验）；② 新会话第一条必须是 legacy_snapshot_imported（对空白板 element_added/elements_cleared 会抛 whiteboard_missing）；③ source.fingerprint 必须是真 sha256 64 位十六进制（djb2/UUID 去杠都会被 DSL 校验拒绝，且一旦写入该记录永久毒化 fold，只能删会话）。
- **线 1（孩子端持久化）**：WhiteboardPanel 订阅 stage store → 防抖 2.5s → sha256 指纹对比 → 无记录走 legacy_snapshot_imported / 有记录走 elements_cleared+element_added 重建。
- ⚠️ **DeepSeek 空内容坑**：v4-flash 间歇返回空 content（思考吞 token），原代码直接 return "" 绕过 GLM 兜底 → 已改为空内容也走 tryGlmFallback。连续 3/3 验证回复正常。
- **已知限制**：免费模型【画板】标签遵循率随机（约 50-70%），未输出标签时板书为空（管线其余部分已全部验证）；孩子板书与 AI 板书写入同一会话存在互相覆盖的理论竞态（单人使用低风险）。
- **调试钩子**：WhiteboardPanel 挂载后 `window.__wbRefresh(stageId)` 可手动触发投影刷新并返回诊断（applied/projElements/read 状态）。

## 2026-08-30 LLM 供应商与计费更正

- **GLM-5.3-Flash 也是计费的**（非免费）：tryGlmFallback 已接入 recordCost 计入当日预算账本（费率 GLM_COST_PER_M_* 默认 0.2/0.2 元每百万 tokens，可按智谱账单调整）。含义：DeepSeek 欠费期间 GLM 兜底的花费会消耗当日预算（默认 5 元/天），超预算后 GLM 兜底仍可用（可用性优先）但 DeepSeek 预算守卫的当日额度会被 GLM 占用。
- **文本链现状**：DeepSeek-v4-flash（主，预算守卫）→ GLM-5.3-Flash（兜底，计费）。Ark 仅剩两个用途：多模态识图（doubao-seed-2-1-turbo-260628）+ 儿歌/字谜生成（arkOnly 免费专用链，带 30s 超时 + 失败冷却缓存）。
- **DeepSeek 空内容坑**：v4-flash 间歇返回空 content → 现在空内容也走 GLM 兜底（原代码 return "" 绕过兜底）。
