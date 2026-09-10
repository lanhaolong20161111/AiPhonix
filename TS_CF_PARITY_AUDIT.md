# AiPhonix server_ts ↔ server_cf 对标审计报告

> 审计日期:2026-09-02
> 审计方式:静态源码逐模块比对(只读,无运行时冒烟测试)
> 审计对象:
> - `server_ts` —— 本地开发后端(Hono + better-sqlite3 + 本地 FS,3001)
> - `server_cf` —— Cloudflare 生产 Worker(Hono + D1 + R2 + Workers Assets)
> - `server_py` —— **已放弃**,不再作为对标基准(旧报告 `TS_PY_PARITY_AUDIT.md` 基准已失效)
>
> 说明:两端均为 TypeScript/Hono,可直接逐行比对;差异主要来自**部署底座(server_ts=SQLite+本地 FS,server_cf=D1+R2)**与**功能演进(server_cf 是更完整的实现)**。

---

## 0. 总体结论(先答"能否完美替代")

**不能直接说"server_ts 可完美替代 server_cf 部署"——方向反了。** 现实是:

- `server_cf` 是**生产端**,且功能比 `server_ts` 更完整(多 5 个模块、PaddleOCR 识图增强、ai_chat 角色扮演/改错、/llm 端点鉴权)。
- `server_ts` 是**本地开发端**,是 `server_cf` 的"子集 + 有鉴权缺口 + 模型漂移"。
- 若把 `server_ts` 当生产部署:会**丢失 5 个生产模块**、**识图质量下降**、**/llm 付费端点裸奔无鉴权**、且 SQLite+本地 FS 无法跑在 Cloudflare(需自建 VM,失去边缘优势)。❌ 不可完美替代。
- `server_cf` 本身**有 1 个上线级红灯(FTS5 虚表在 D1 上迁移失败/搜索静默降级为空)**,属生产缺陷,须在切换/新环境部署前修复。

**可替代性评级:部分实现(整体),非等价。** 业务主体(19 个模块)等价,但存在 1 个高优阻断缺陷 + 9 个部分实现 + 5 个 server_ts 缺失模块。

---

## 1. 审计范围与方法

### 1.1 对比单元
按"模块对"组织:`server_ts/src/routes/X.ts`(+ `lib/Y.ts`)vs `server_cf/src/routes/X.ts`(+ `lib/Y.ts`)。

### 1.2 评级标准(三级)
- **等价**:端点齐全、参数/响应/存储/鉴权/逻辑对齐,仅部署形态(同步↔异步、FS↔R2)差异。
- **部分实现**:端点存在但逻辑有缺口(缺端点/无缓存/无回退/无鉴权/响应字段缺失)。
- **缺失**:一端完全没有该模块(未实现或未挂载)。

### 1.3 模块评级总表

| 模块 | 评级 | 关键缺口(一句话) |
|---|---|---|
| ai_homework | 等价 | 仅拆分/注释差异,功能齐备 |
| ai_practice | 等价 | 仅 sync/await + 并发统计写法差异 |
| auth | 等价 | 仅 D1 async |
| users | 等价 | 无 |
| user_imports | 等价 | 无 |
| uploads | 等价 | 仅 FS→R2 |
| free_llm | 等价 | 仅 FS→R2 |
| ark_image | 等价 | 仅 503 文案 |
| prefs | 等价 | cf 运行时建表 |
| visits | 等价 | cf 运行时建表 |
| bili | 等价 | 逐字一致 |
| import_templates | 等价 | cf 缓存 60s TTL |
| english | 等价 | FS→R2 |
| chinese | 等价 | FS→R2 |
| wordbank(字库) | 等价 | ts 用 JSON 文件,cf 用 D1 表 |
| essays | 等价 | 仅缓存策略(ts 模块级 vs cf 60s TTL) |
| practice | 等价 | 仅 JSON 文件后端 |
| practice_tracker | 等价 | 表结构一致 |
| training | 等价 | 仅 FS→R2 |
| **ai_chinese** | **部分实现** | ts 缺 `detect-blocks` 端点 + PaddleOCR/fillPolyphones/llmFilterOcrText |
| **ai_chat** | **部分实现** | ts 缺 `GET /ai-chat/session`、role 角色扮演、`correction`/`judge` |
| **soe** | **部分实现** | ts 删除端点无用户归属校验(可越权删) |
| **tts** | **部分实现** | cf 多单字音频库端点(`/tts/char/:char`) |
| **char_images** | **部分实现** | cf D1+R2 双源+缩略图+feedback 强制登录;ts 本地 JSON/FS |
| **quiz** | **部分实现** | cf 两端点加登录 + R2;ts 裸奔 |
| **word_suggestions** | **部分实现** | cf 加登录 + 60s TTL;ts 无鉴权 |
| **llm** | **部分实现** | cf 运维三端点加登录;ts 全开放 |
| **chinese_practice** | **部分实现** | cf 三端点加登录 + R2;ts 无鉴权 |
| **daily_zh** | **缺失(仅 cf)** | ts 无每日一练配置 |
| **generatedDict** | **缺失(仅 cf)** | ts 无按需生成字词内容 |
| **radical** | **缺失(仅 cf)** | ts 无偏旁儿歌/字谜 |
| **wordbook(生词本)** | **缺失(仅 cf)** | ts 仅有只读 wordbank,缺用户生词本 SRS |
| **ops** | **缺失(仅 cf)** | ts 无请求日志/可观测端点 |

> 说明:`ai_chinese` 的 kb/quest/textbook/questions 四个子路由两端**均真实挂载**(非死代码),内部 53 个端点对齐,故 ai_chinese 主体评级为"部分实现"仅因 OCR 子系统缺口。

---

## 2. 基础设施兼容性矩阵

### 2.1 部署底座对照

| 维度 | server_ts(开发) | server_cf(生产) | 对齐? |
|---|---|---|---|
| HTTP 框架 | Hono + `@hono/node-server` | Hono(Workers runtime) | ✅ |
| 数据库 | better-sqlite3(同步) | D1(drizzle-orm/d1,异步) | ⚠️ 同步↔异步改造 |
| 文件存储 | 本地 FS(`DATA_DIR/STATIC_DIR/CACHE_DIR`) | R2(`FILES`)+ Workers Assets | ⚠️ 抽象替换 |
| 密钥来源 | `config.yaml` + 环境变量 | Cloudflare secrets + `[vars]` | ⚠️ 见 2.5 |
| 静态托管 | `serveStatic`(web/letter-clips/videos) | Workers Assets(/web)+ R2(Range/ETag) | ✅ 语义对等 |
| CORS | 同源白名单逻辑一致 | 同源白名单逻辑一致 | ✅ |
| 路由挂载 | 与 cf 几乎一致 | 多挂 wordbook/radical/daily-zh/generated-dict/ops | ⚠️ 见 1.3 |

### 2.2 数据库表结构

- **共有 35 张表**:`users`…`llmCallLog` —— 列名/类型/默认值/索引**逐字节一致**。
- **server_cf 独有 7 张表**(server_ts 确无):

| 表 | 用途 | 对应 cf 独有功能 |
|---|---|---|
| `char_image_index` | 认字索引 | char_images 双源 |
| `char_image_feedback` | 认字反馈 | char_images 双源 |
| `wordbank_item` | 词库条目 | wordbank(消写竞态) |
| `wordbook_item` | 生词本 SRS | wordbook(缺失模块) |
| `radical_content` | 偏旁缓存 | radical(缺失模块) |
| `daily_zh_config` | 每日一练配置 | daily_zh(缺失模块) |
| `request_logs` | 可观测日志 | ops(缺失模块) |

> server_ts 的 char-images 索引/反馈以 JSON 文件 + 模块级 `Map` 存储(多进程/多 isolate 下脑裂);server_cf 迁 D1 消解。

### 2.3 🔴 红灯:FTS5 虚表 vs Cloudflare D1(高优,阻断性)

- 两端 `schema.ts` 都保留 6 张 `chinese_fts*` 影子表声明(普通 `sqliteTable`)。
- **`server_cf/migrations/0001_init.sql:96` 含 `CREATE VIRTUAL TABLE chinese_fts USING fts5(...)` —— Cloudflare D1 不支持 FTS5 虚表,该迁移会失败。**
- 两条业务路由仍真实查询 FTS:`server_cf/src/routes/ai_chinese_kb.ts:127`、`ai_chinese.ts:988` 执行 `chinese_fts MATCH ...`,被 `catch` 吞掉 → **搜索功能静默降级为空**(不是崩溃,但用户搜不到)。
- server_ts 用 better-sqlite3,FTS5 可用,搜索正常。

**结论**:若对**新 D1** 跑迁移会卡在 FTS5;若已在跑的 D1 是"迁移前"状态或 FTS5 建表失败,则生产搜索当前已是空结果。必须删除 FTS5 迁移并改为 `LIKE`/外部搜索方可正常。

### 2.4 鉴权中间件

| 项 | server_ts | server_cf | 差异 |
|---|---|---|---|
| JWT | HS256(jose) | HS256(jose) | ✅ |
| refresh token | sha256 校验 | sha256 校验 | ✅ |
| resolveCurrentUser | 同步 | async(D1) | ⚠️ |
| 密钥持久化 | 落盘 `DATA_DIR/jwt_secret.key` | **未配则 isolate 随机密钥** | 🟡 见下 |

- **🟡 JWT_SECRET 未配置风险**:server_cf 若未 `wrangler secret put JWT_SECRET`,每次 isolate 重启生成随机密钥 → 多实例/重启后 token 不互认、用户被迫重登。生产必须配。

### 2.5 存储:R2 vs 本地 FS

- server_cf `lib/storage.ts`:`toKey()` 归一化路径为 R2 key;`readBlob/writeBlob/exists/listKeys` 封装 `env.FILES`;`btoa` 替代 `Buffer`。
- server_ts:本地 `DATA_DIR/STATIC_DIR/CACHE_DIR` + `serveStatic`。
- char-image:cf = D1(索引/反馈)+ R2(图/音频,含 `?w=N` 缩略图回退);ts = JSON+Map + 本地 FS。
- 抽象到位,迁移成本可控,**属可接受差异**(部署形态)。

### 2.6 request_logs(🟡 项,本次已覆盖)

- server_cf `lib/observe.ts`:`recordLog` 落 D1,**2% 概率执行 `DELETE ... WHERE substr(ts,1,10) < date('now','-7 days')`**,保留 7 天(`RETENTION_DAYS=7`)。fire-and-forget(`waitUntil`)。
- server_ts 仅 `console.log`,不落库。
- **结论**:cf 有清理机制(非无限增长),可接受;ts 不落库。原 🟡 "request_logs TTL" 已澄清为"有 7 天 TTL、概率清理",无行动项。

---

## 3. 外部服务集成(逐库)

| 集成 | 对齐度 | 关键差异 |
|---|---|---|
| 讯飞/腾讯 SOE | ✅ 等价 | ts 用 `ws` 包;cf 用 workerd 原生 `fetch(wss)`+`sock.accept()`,含双重编码修正。协议/重试/守卫一致 |
| 百度 TTS | ✅ 等价 | 仅缓存后端(ts 本地文件 ↔ cf R2) |
| Ark 聊天/图像 | ✅ 已对齐 | **2026-09-02 已修：ts 改 `doubao-seed-2-1-turbo-260628` + `vision_model` 配置(`ARK_VISION_MODEL`)** |
| DeepSeek + 预算守卫 | ✅ 已对齐 | 2026-09-02 已修：ts chat 新增 `arkOnly` + 预算/空内容/异常均回退 GLM(需 `BIGMODEL_API_KEY`) |
| PaddleOCR | 🔴 cf 独有 | **server_ts 完全无 `lib/paddleOcr.ts`**;cf 作为识图第一选项(失败回退豆包/OCR 链)。属 cf 增强,但使 ts 识图质量弱于生产 |
| OCR(腾讯云→百度) | ✅ 等价 | 仅图片读取(ts FS ↔ cf R2) |

---

## 4. 鉴权覆盖率对照(重点)

`/llm` 前缀付费/运维端点 —— **server_cf 已加 `resolveCurrentUser`,server_ts 未加**:

| 端点 | server_cf | server_ts |
|---|---|---|
| `quiz` POST /quiz、/quiz-generate | ✅ | ❌ 裸奔 |
| `word_suggestions` POST /word-suggestions | ✅ | ❌ 裸奔 |
| `llm` /logs、/logs/clear、/budget | ✅ | ❌ 裸奔(运维日志开放) |
| `chinese_practice` /word-info、/sentence-generate、/sentence-batch-save | ✅ | ❌ 裸奔 |
| `soe` DELETE /:id、batch-delete | ✅ 按 userId 隔离 | ❌ 无用户归属校验(可越权删) |
| `uploads`(photo/text)、`free_llm`、`prefs`、`visits`、`users` | ✅ 两端一致 | ✅ 两端一致 |

> 若把 server_ts 暴露为公网生产,`/llm` 端点可被未登录调用刷额度/读运维日志;soe 删除可越权。属**安全缺口**,须补。

---

## 5. 缺口清单(按风险排序)

### 🔴 高优(阻断/功能失效/安全)
1. **FTS5 虚表迁移失败(server_cf)**:`migrations/0001_init.sql:96` 的 `CREATE VIRTUAL TABLE ... fts5` 在 D1 失败;搜索(`kb-ask`/`search`)静默降级为空。→ 改为 `LIKE` 或外部搜索,删 FTS5 迁移。**（2026-09-02 已修：删迁移虚表 + 新增 `chineseSearch` LIKE 跨表搜索,见 server_cf/src/lib/aiChineseContext.ts）**
2. **server_ts 缺 5 个生产模块**(daily_zh / generatedDict / radical / wordbook / ops):直接当生产会丢功能。→ 补或确认不依赖。**（2026-09-02 仍待补：5 模块 L 量级,非本次范围）**
3. **server_ts `/llm` 端点无鉴权 + soe 删除越权**:生产暴露即安全事件。→ ts 补 `resolveCurrentUser` / userId 隔离(对齐 cf)。**（2026-09-02 已修：llm 路由 `router.use(requireAuth())`；soe 删除/批量删除加 `resolveCurrentUser` + userId 归属校验）**

### 🟡 中优(功能降级/质量/一致性)
4. **ai_chinese(ts 缺 `detect-blocks` + PaddleOCR/fillPolyphones/llmFilterOcrText)**:识图质量(多音字、版面噪声、绿框切块)弱于生产。→ 移植 `paddleOcr.ts` + 链路。**（2026-09-02 仍待补：PaddleOCR 原生依赖，移植 M 量级）**
5. **ai_chat(ts 缺 `GET /ai-chat/session`、role 角色扮演、`correction`/`judge`)**:学生"小老师"纠音游戏、会话恢复不可用。→ 补 `ROLE_PROMPTS` + `parseToolTags` 扩展 + 判卷兜底。**（2026-09-02 仍待补：ai_chat 全链路 M 量级）**
6. **Ark 视觉模型漂移(ts 用弃用 `doubao-seed-evolving`)**:多模态/识图可能超时或 404。→ ts 同步 cf 模型名。**（2026-09-02 已修：ts 改 `doubao-seed-2-1-turbo-260628` + 新增 `vision_model` 配置 / `ARK_VISION_MODEL`）**
7. **DeepSeek 预算守卫语义差异(cf 回退 GLM / ts 抛 429;cf `arkOnly`)**:行为不一致,需确认预期。→ 对齐策略。**（2026-09-02 已修：chat 新增 `arkOnly` + 预算/空内容/异常均回退 GLM(需配 `BIGMODEL_API_KEY`））**
8. **tts(ts 缺单字音频库端点 `/tts/char/:char`)**:性能/配额优化缺失。→ 可选补。**（2026-09-02 仍待补：可选）**
9. **char_images(ts 本地 JSON/Map 不鉴权;cf D1+R2+缩略图+feedback 登录)**:cf 更强一致性与鉴权。→ ts 可选对齐。**（2026-09-02 仍待补：可选）**

### 🟢 低优(可接受部署差异)
10. 存储后端(R2 vs 本地 FS)、缓存 TTL(模块级 vs 60s)、DB 同步↔异步、SOE WebSocket 实现(`ws` vs workerd 原生)、静态托管语义 —— 均属部署形态,接口与行为等价,**非缺陷**。

---

## 6. 可替代性结论(回答三问)

### ① 现在直接切换会坏什么?
- **用 server_ts 当生产**:丢 5 个模块、识图降级、ai_chat 高级辅导失效、`/llm` 裸奔(安全)、SQLite 需自建 VM(失去 CF 边缘)。❌
- **server_cf 当前生产**:搜索(kb-ask/search)此前因 FTS5 静默降级为空,**已于 2026-09-02 改为 LIKE 搜索修复**;其余功能正常。

### ② 补齐工作量估计(按模块)
| 工作 | 量级 | 说明 |
|---|---|---|
| 修 FTS5 → LIKE 搜索 | S(0.5d) | 删迁移 + 改 2 处 MATCH |
| ts 补 `/llm` + soe 鉴权 | S(0.5d) | 加 `resolveCurrentUser` |
| ts 移植 PaddleOCR + detect-blocks | M(2-3d) | 新增 `paddleOcr.ts` + 链路 |
| ts 补 ai_chat 三项 | M(1-2d) | ROLE_PROMPTS + parseToolTags + 判卷 |
| ts 补 5 个缺失模块 | L(3-5d) | daily_zh/generatedDict/radical/wordbook/ops(含 D1 表) |
| ts 同步 Ark 模型名 + 守卫语义 | S(0.5d) | 改 env/默认值 |
| 部署形态(已在 cf 完成) | — | R2/D1 已由 cf 实现 |

### ③ 哪些是可接受的行为差异(非缺陷)?
- 状态码相同(均 400/401/403/404/422/429/500)。
- 存储后端 R2 vs 本地 FS、缓存刷新时效、DB 同步↔异步、SOE `ws` vs workerd 原生 WebSocket、Workers Assets vs `serveStatic` —— 接口与行为等价,仅部署形态不同。

---

## 7. 与原始 🟡 遗留项的对应关系

用户此前在旧报告(PY 基准)列出的 🟡 项,重定基准后状态:

| 原 🟡 项 | 新审计下状态 |
|---|---|
| contracts 扩展(shared/contracts) | server_cf 有独立 `src/contracts/index.ts`;server_ts 用 `shared/contracts`。两端 zod 契约需对齐,属 `shared/contracts` 锁定范围(改需走 owner C)。→ **待核(不在本审计深度内)** |
| request_logs TTL | **已覆盖(§2.6)**:cf 有 7 天 TTL 概率清理,无行动项 |
| 401 刷新竞态 + localStorage 双 token | **前端项**(web/src/services/auth.ts) → **已修(2026-09-02)**:`api.ts` 加单飞刷新锁,并发 401 只刷新一次,消除 refresh_token 互相失效/误登出 |
| 环境文档漂移(AGENTS.md/PROJECT_MEMORY) | **文档项** → **已修(2026-09-02)**:PROJECT_MEMORY 项目概览/技术栈段、config.ts 注释已校正(server_py 退役、生产=server_cf、本地=server_ts、对标基准) |
| char_info/wordbank web/public vs R2 双源 | **已覆盖(§2.2/§2.5/§4)**:char_images 双源 + wordbank cf 用 D1 表、ts 用 JSON 文件;且 cf 另有 wordbook 模块 ts 缺失 |
| SubtitleCapturePage 收编 | **前端项**(web/src/pages/SubtitleCapturePage.tsx) → **已修(2026-09-02)**:6 处裸 fetch 已收编到共享 `api()` 客户端(自动 Bearer + 401 单飞刷新 + 超时) |

---

## 8. 附录:对比依据与执行

- 挂载地图:`server_ts/src/index.ts`(295-328)vs `server_cf/src/index.ts`(256-295)—— 两端 `/api/v1` 挂载一致,cf 多 5 个模块。
- 表清单:`server_ts/src/db/schema.ts`(35 表)vs `server_cf/src/db/schema.ts`(42 表)。
- 部署:`server_cf/wrangler.toml`(D1 `aiphonix-db` / R2 `aiphonix-files` / Assets `static_assets`)。
- 执行:4 个 code-explorer 子代理分批(基础设施+服务层 / ai_chinese / ai_homework+ai_practice+ai_chat / 其余路由),主代理汇总。
- 注:本次为只读审计,未修改两端任何代码;未在 server_ts 与 server_cf 间切换部署。
