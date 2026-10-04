# AiPhonix 项目记忆（通用交接文档）

> 供任何 coding agent 读取的完整项目上下文。生成日期：2026-08-17（最后更新：2026-10-04）。
> 整合自 `AGENTS.md`、历史 `memory-export-*.md` / `SESSION_HANDOFF_*.md` 及最近会话的进展。

---

## 0.11 🆕 2026-10-04 后端模块清单化：挂载由 manifest 派生 + 端点 parity 门禁（`b8d2775`）

承接「前端模块化做完了吗？**后端**可以模块化吗，保持最小核心」。先做了量化体检（结论写在 §0.11.1），
再按体检结论只做最有价值的一步（§0.11.2）。

### 1. ★ 体检结论：后端 ≠ 前端，「保持最小核心」的价值点完全不同

| | `server_cf`（生产 Worker） | `server_ts`（本地 Node） |
|---|---|---|
| `src` TS 文件 / 行数 | 87 / **18769** | 71 / **13954** |
| 路由文件 / 端点数 | 46 / **214**（含重复注册的原始条目 253） | 40 / **180**（原始 212） |
| Worker 上传体积 | **2069 KiB / gzip 458 KiB** | — |

- **体积不是瓶颈**：gzip 458 KiB，距 CF 限额（3 MiB 免费 / 10 MiB 付费）差 6~20 倍。
  且**部署单元就是整个 Worker，裁剪不能让线上少部署一个字节** ⇒
  「后端照搬前端的构建期裁剪」**几乎没收益**（前端裁剪救的是弱网下载，后端省不出用户可感知的东西）。
  唯一真收益是**爆炸半径**，而那要**部署两个 Worker** ⇒ 属于 B2，本次未选。
- **真正痛点是两端分叉，比记忆里记的严重**：68 个同名文件**只有 4 个相同**
  （`lib/pinyin.ts`/`lib/practiceWeights.ts`/`lib/sentenceGuard.ts`/`types/bcryptjs.d.ts`），
  **26 个差异 >40%**、37 个在 10~40%。「server_cf 是 server_ts 的自包含副本」**只在结构上成立**，
  内容早已各走各的（且大量差异是必要的：R2 vs fs、D1 vs SQLite、`getEnv()` vs `process.env`）。
- **护栏只盖了很小一块**：`contractParity.test.ts` **只比 zod schema 结构指纹**，
  抓不到 ① 路由/挂载清单 ② 端点路径 ③ 裸常量（`BLOCK_TYPES` 等） ④ 中间件作用域。
  而两端 `index.ts` 的「40 行 import + 20 行 `api.route()`」正是**各一份手工清单、零护栏**。
- 已经存在的模块化：`routes/*.ts` 一模块一文件 + `lib/subject/{kernel,chinese,english,math}.ts`
  学科隔离（**已验证的正确模式**，附「禁止开关型 API」的禁令 —— 数学的 `□` 真被语文清洗器删过）。

### 2. 做了什么（`b8d2775`）

1. **新增 `src/modules/manifest.ts`（两端同构）** —— 把挂载表收敛成一份有序数据
   `{ id, target: "api"|"app", prefix, core?, handler }`；`index.ts` 只留「按清单挂载」两段循环，
   净删 **~157 行**样板。
   🔴 **清单顺序 = 挂载顺序，不可随意调整**：Hono 子应用 `route()` 会合并中间件，
   `/llm` 下挂 4 个子应用、顺序敏感（见 §0.11.3 与 skill `aiphonix-backend-parity` §4 事故）。
   `core` 字段**刻意留空未启用** —— 填它前必须确认核心边界，本次不做。
2. **新增 `server_ts/tests/routeParity.test.ts`（5 条）+ `tests/routeDivergence.ts`** ——
   从两端 Hono 实例取端点全集（`METHOD + path`）逐条比对，差异必须**恰好等于**显式冻结的
   **38 条 cfOnly / 4 条 tsOnly**。未声明的漂移、以及「声明里写了但实际没差异」的僵尸条目，都会变红。
   门禁还会断言**模块 id 集合**与 manifest 无重复、端点规模未骤降（防整片路由没挂上）。

### 3. ★★ 踩的坑（这条最值钱，别再踩）

- **Hono 会把 `router.get(path, mw, handler)` 的每个 handler 各存成一条同路径路由表条目。**
  实测 `visits.ts` 只有 1 个 `router.get("/visits", requireAuth(), h)`，`app.routes` 里却是
  **2 条**（中间件一条 + 处理器一条）。也正好解释「`PUT /daily-en` 重复而 `GET /daily-en` 不重复」
  —— PUT 带了 `requireAuth()`。
  ⇒ **取端点必须用「集合」去重**：不去重会把每个带守卫的路由都数成两次，
  初版探针因此误报「39 对重复注册」，差点写进结论当 bug 报。
  同理**门禁只管端点集合、不管注册顺序**（顺序仍靠人，manifest 文件头已写警告）。
- **`cp.spawnSync("diff", …)` 在 Windows 上静默失败**：Git Bash 的 `PATH=/usr/bin` 是 POSIX 风格，
  Node 按 Windows 语义解析 ⇒ 找不到 `diff` ⇒ `stdout` 为空 ⇒ 脚本算出「64 个文件 0% 差异」，
  与「只有 4 个字节相同」直接矛盾。**看到「0 差异但字节不同」先怀疑工具没跑起来。**
  Node 里做 diff 一律自己在 JS 里比，或给 spawn 传绝对路径 `C:/Program Files/Git/usr/bin/diff.exe`。
- **`server_ts` 测试必须用系统 Node 24**（`better-sqlite3` 按 Node 24 编译，受管 Node 22 报
  `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION 127 vs 137`）。skill 里早有这条，实际仍先踩了一次。
- `routeParity.test.ts` 导入 `server_ts/src/index.ts` 会连带执行 `src/db/index.ts` 的**顶层建库**
  （`new Database()` + `init.sql` + 迁移）⇒ **必须先 `process.env.DATABASE_PATH = <临时目录>`
  再动态 `await import()`**（静态 import 会被提升到赋值之前），否则会写开发者真实的 `shared/data/app.db`。

### 4. 验证（每步真跑）

- **行为零变化**（核心证据）：改造前后各导出一次端点全集 ⇒
  **集合一致 + 原始序列逐条一致**（cf 214 / ts 180 唯一端点；含重复的原始条目 253 / 212 也完全相同）。
- **反向验证**：故意从声明里删掉 1 条 ⇒ 门禁变红且报出预期消息，随后已恢复。
  （不做的门禁等于没有门禁。）
- `tsc --noEmit`：server_cf / server_ts 均 EXIT=0。
- 测试：**server_cf 98/98**、**server_ts 31/31**（原 26 + 新增 5）。
- 提交只含 `server_cf/` 2 个 + `server_ts/` 5 个文件，`web/` 与 `app/` 未动。

### 5. 未做 / 待办

- **未部署**：`b8d2775` 只提交没上线（用户未要求）。因端点集证明零变化，不紧急。
- **B2「核心/全量双 Worker」未做**：`manifest.core` 已留字段但故意为空 —— 需要先确认核心边界
  （可机械化的判据：该模块是否调用生成式 AI ⇒ 是否烧第三方额度）。
- **B3「收敛两端 26 个 >40% 分叉文件」未做**，且建议**默认不做**：大量差异是 CF/Node 的本质差异，
  硬合会把 CF 专属能力「对齐掉」—— 按纪律那属于「功能对齐」，不能混进隔离改动。

---

## 0.10 🆕 2026-10-04 能力折叠：AI 语文/英语/数学三页折成同一个 `AiUploadPage`（`9dd4574`）

承接 §0.8「尚未做」里的 **B 步 —— 能力折叠**（搬家只挪位置不改行为；折叠要改组件树，风险更高）。
开工前先量化了「重复」到底有多少，**结论与最初设想不同**（见下），实际只做了其中最有价值的一块。

### 1. ★ 调研结论：两个原定目标，只有一个成立

| 原计划 | 调研结果 | 处置 |
|---|---|---|
| 4 个数学页共用「口诀/易错卡」→ 折成 1 个 math-kit | **不成立**。4 页实为**两套设计**：`uc`(math_units)/`mo`(math_mul_one) 是「揭示式」（wrong 卡 → 点开展示 right+why+tip）；`eq`(equation_move)/`ce`(compound_expr) 是「对照式」（wrong 行 + right 行并排 + tag/expr）。同组内 CSS 也**有实质差异**：`uc` card `padding:10px 11px`、tip 绿色 700 字重；`mo` `padding:11px 12px`、right 带虚线分隔、tip 琥珀色 400 字重 | **不做**。收益仅 ~120 行，却要么改 CSS 要么把类名参数化；后者会让源码里不再出现 `uc-mistake-card` 这类字面量，**直接废掉 §0.9 刚建立的样式归属分析** |
| 8 个 AI 页共用对话/批改 → 折成 1 个 ai-kit | **大部分不成立**。对话逻辑**早已**在 `hooks/useAiChat.ts`；8 个页面里只有 3 个是同构的，其余各有自己的逻辑 | 只折这 3 页 |

**怎么发现的**：`diff` 三个候选页面。`ai_chinese`(232 行) / `ai_english`(216 行) / `ai_homework`(223 行)
的 `import` 段**逐行相同**，`diff` 只报组件名 / `useAiChat(mode)` / `module` / 标题 / 提示文案 ——
典型的「同一组件的三个 mode」。而数学页是 `grep` 出 4 份 `MistakeCard` 定义后发现类名前缀与 CSS 都不同。

### 2. 做了什么（`9dd4574`）

新增 `web/src/components/AiUploadPage.tsx`，三页退化成 ~17 行薄壳（只声明 mode + 文案）。
净省 **~330 行源码**，消除 3 份重复的「切块/自由框选/批处理」逻辑。

| | 折叠前 | 折叠后 |
|---|---|---|
| `ai_chinese` chunk | 3663 B | **373 B** |
| `ai_english` chunk | 3555 B | **351 B** |
| `ai_homework` chunk | 3532 B | **349 B** |
| 合计（含新 `AiUploadPage` 32.8 KB） | 10.75 KB | 33.9 KB |

⚠️ **物产物体积没变小**：`AiUploadPage` 32.8 KB 里**内联了折叠前独立成 chunk 的 `useAiChat`**（29.7 KB）——
它现在只有 1 个引用者，rollup 就不再单独拆 chunk。三页首屏总下载量基本持平（33.3 → 33.2 KB）。
**收益在源码维护性**（改一处 = 改三处 → 改一处），不在字节数。裁剪能力不受影响（`AiUploadPage` 只要还有一个用户就保留）。

### 3. 三个开关 = 三处「有意保留的差异」（别顺手统一）

| 开关 | 归属 | 原因 |
|---|---|---|
| `polyPatch` | 语文 | 「切块 / 自由框选」路径**不走** `startParseBatch`，所以要各段自己后台补注音（`startParseBatch` 内部对整图路径已经调过了） |
| `omitStructured` | 数学 | 整图识别沿用扁平口径（不落 blocks/crops）。**已验证 `false` 与不传等价**（`normalize()` 里是 `if (!omitStructured) return res`），所以直接透传安全 |
| `plainStatus` | 语文 | 进度提示历史上是朴素内联样式，与另两页的 `.ai-parse-status` 卡片**视觉不同**；原样保留，不借折叠改 UI |

### 4. ★ 验证手法：归一化 chunk 引用后比对（分辨「实质变化」vs「引用级联」）

折叠后 `sha256` 比对发现 **85 个 chunk 全部改名**（连 4 个数学页 chunk 都变）—— 看着像出了大事。
把两侧 chunk 里的 `-XXXXXXXX.js` 全部替换成 `-HASH.js` 再算哈希 ⇒

```
polyPatch / math_units / math_equation_move / math_compound_expr /
math_mul_one / parseSessionStore / useTts   →  全部逐字节相同 ✓
```

🔴 **结论：vite 的 chunk hash 含「它 import 的 chunk 的 hash」⇒ 一处真变会让整个依赖链雪崩改名。**
以后看到「所有 chunk 都变了」先做这一步归一化比对，别急着当成 85 处回归。数学页那 197 处 computed style
差异同理：是**随机出题**（元素数 356→362），不是折叠引起的。

`computed style` 快照对 12 条路由（含新增的 3 个 AI 路由）折叠前后逐项比对 ⇒
**AI 三页含 `width`/`height` 全属性 0 差异**，`console errors` 0。

### 5. 复用的工具

`web/_css_smoke.mjs`（本地，gitignore）已扩成 12 条路由 —— auth 用假 session 注入 localStorage
（`ai_phonix_web_auth`），`**/api/v1/**` 全部 mock 成 `{}`，`serviceWorkers:"block"`。
`node _css_smoke.mjs <distDir> <label>`；同一 label 复跑会覆盖 `_css_shots/<label>/`。

---

## 0.9 🆕 2026-10-04 构建期裁剪打通：死代码清理 + 样式归属标记（`VITE_SKILLS` 真能出小包）

承接 §0.8。上一轮加了 `VITE_SKILLS` 裁剪开关，但它只决定「注册哪些路由」：
`catalog.ts` 里的 48 个 `import()` 仍在包里 ⇒ rollup 照样产 48 个 chunk、PWA 还把它们
全部预缓存（~1.6MB）；`App.css` 229KB 源码也一次全量打包。本轮补齐（`f523a4a` → `012d795`）。

### 1. 死代码清理（`f523a4a`）

传递可达性扫描（从 `main.tsx` + vite alias 出发解析相对 import 建图）：210 个源文件 → 可达 180。
删掉 7 个 0 引用且无同名测试的文件：`components/BlockRecorder.tsx`、`components/CollapsibleText.tsx`、
`hooks/useSegmentAsr.ts`、`hooks/useSpeechComposer.ts`、`services/asrShort.ts`、`services/uploads.ts`、
`services/zhDialogue.ts`（后三个的引用者是上一轮删掉的死代码 `App.tsx`）。
另把 `src/SoeDemo.tsx` 搬进 `modules/soe_demo/`，`src` 根下只剩 `main.tsx` / `routes.tsx` / 样式入口。

🔴 `src/lib/stubs/shikiStub.ts` 在扫描里同样显示 0 引用，但 `vite.config.ts` 有 alias 指向它 —— **是活的，别删**。

### 2. 样式归属标记 —— 为什么不做「每个模块一个 css 文件」（★ 关键决策，别再试）

`App.css` 里模块的规则是**散段**的：36 个模块共 148 段，`ai_parse_result` 一个模块散了 24 处。
而 CSS 层叠依赖**规则顺序**：把散段合并进独立文件 = 改变加载位置。
静态分析量出 **87 对**「同特指度 + 共享 class + 被搬走的原本排在留下的之前」的规则 ——
搬走后它们会从「输」变「赢」，是**静默**的样式回归，抽查也发现不了。

⇒ 采用：**单一有序样式表 + 归属标记 + 构建期整块删除**。
删掉的规则属于未启用模块，那些模块的 DOM 不会渲染 ⇒ 不可能影响任何元素的最终样式。
也正因如此，**未设 `VITE_SKILLS` 时产物与改造前逐字节相同**（hash 都不变），老路径零风险。

### 3. 文件与命令

| 东西 | 作用 |
|---|---|
| `src/App.css` 里的 `/* @skill: <id> */ … /* @skill:end */` | 148 对，覆盖 36 个页面；是合法 CSS 注释，没有过滤器也照常工作 |
| `web/tools/cssSkillMark.py` | 生成器/校验器。`--report` 分析+列层叠风险、`--check` 校验标记与归属一致、`--write` 注入（已有标记则拒绝） |
| `src/modules/skillsCss.ts` | `scanSkillBlocks` / `filterCssBySkills` / `checkSkillCss`（纯函数） |
| `src/modules/skillsSwitch.ts` | **`VITE_SKILLS` 解析规则 + `ALWAYS_ON_SKILLS` 的唯一真源** |
| `vite.config.ts`：`skillsCss()` / `skillsCatalog()` | 两个构建期插件 |

🔴 **改 CSS 后跑 `python web/tools/cssSkillMark.py --check`**：标记与归属不一致会退出码 1
（负例：删标记 / 把共享规则错标成模块，都能抓出来）。
🔴 **`ALWAYS_ON_SKILLS`（`home`/`login`/`register`/`placeholder`）三处共用一份**
（registry / skillsCss / vite.config）。曾踩：登录页样式被裁 ⇒ 「页面在、样式没了」的白屏。
🔴 `skillsCatalog()` 会把未启用模块的 `load: () => import("./x/index")` 换成桩；
**任一 `load:` 行不匹配预期写法就直接让构建失败**（宁可构建失败，也别静默少裁/多裁）。

### 4. 实测（同一台机器、同一份源码）

| | 全量 | 裁剪（8 个核心模块） |
|---|---|---|
| JS chunk | 99 | **21** |
| CSS | 163432 B | **113124 B**（gzip 29689 → 21715） |
| PWA 预缓存 | 1680 KiB | **1187 KiB** |
| 首页磁贴 | 23 | 8 |

命令：`VITE_SKILLS=pinyin,recognition,dictation,word_practice,math_units,math_mul_one,math_equation_move,math_compound_expr npm run build`
（同时支持写进 `.env`：配置侧用 `loadEnv(mode, cwd, "VITE_")` 读，与 registry 读 `import.meta.env` 同口径）。

### 5. 验证手法（可复用）

- **默认构建零风险**：`cmp -s` 比对 CSS 与改造前**逐字节相同**，chunk 数不变。
- **产物结构**：按去哈希 chunk 名做 `comm`，被裁模块的 76 个 chunk 名消失、12 个 always-on/核心页面全在。
- **样式等价（这条最值钱）**：静态伺服两版产物，对 9 条路由抓全部元素的
  **computed style 快照（1301 元素 × 28 项属性）**逐项比对 ⇒ 全量 vs 裁剪 **0 处差异**；
  同时跑「全量 vs 全量」作噪声基线（随机出题的数学页会有 `width`/`gridTemplateColumns` 抖动）。
  ⇒ 证明「只变小、没改样式」。脚本 `web/_css_smoke.mjs`（本地，gitignore）。
- `web/tools/cssSkillMark.py --check`（负例也验过）。


用户诉求：「把这个网页应用模块化 skills 化，只保持最必要的核心」。
分三个提交落地（`3aff04a` → `8be1297` → `f09ce3b`），全程只改 `web/src`，未动 `server_*`。

### 起点诊断

不是「没拆分」——`pages/` 早就是 49 个懒加载页面。真问题是**同一份「有哪些功能」清单被抄在 4 处、互不校验**：
`routes.tsx`(44 条路由) · `HomePage.SECTIONS`(23 磁贴) · `HomePage.FEATURE_ROUTES`(12 条) · `services/training.FEATURES`(10 条)。
漏改任一处 = 「首页有入口、点进去空白」。另发现 `web/src/App.tsx`(221 行) 是死代码。

### ① 微内核 + 模块注册表（`3aff04a`）

`web/src/modules/` 新增 `types.ts`（`SkillModule` 契约）· `catalog.ts`（**48 条声明 = 唯一真源**）·
`registry.ts`（派生路由 / 磁贴 / 打卡目录）· `registry.test.ts`（自检）。

| 消费方 | 变化 |
|---|---|
| `routes.tsx` | 155 → **63 行**，由 `AUTH_MODULES` / `GUEST_MODULES` 生成 |
| `HomePage.tsx` | 磁贴与 `FEATURE_ROUTES` 改为派生，删 23 条死数据 |
| `services/training.ts` | `FEATURES` 由 `TRAINING_MODULES` 派生 |
| `web/src/App.tsx` | **删除**（无人 import） |

新增构建期裁剪开关 **`VITE_SKILLS=pinyin,dictation,math_units`**（只打这些 + 系统页）——
这就是「只保持最必要的核心」的落地口子。自检含**路由快照**（48 条与重构前逐条比对）。

### ② 页面物理搬家（`8be1297`）

`src/pages/XxxPage.tsx` → `src/modules/<catalog id>/index.tsx`（48 模块 + `home` 内核页），
**`pages/` 目录整体删除**。深度 2→3 ⇒ 页面内 **263 条** `from "../` 统一加深为 `from "../../"`。

前提全满足才好动手：唯一引用 `pages/` 的只有 `catalog.ts`(48 条) 与 `routes.tsx`(HomePage)，
**页面之间零互相引用**，内部相对 import 只有 `"../<dir>"` 一种形态。

新增**结构门禁**：catalog 每个 id 必须有 `modules/<id>/index.tsx`；反向查孤儿目录（`home` 白名单）。

### ③ 共享层共置（`f09ce3b`）

把「事实上只服务一个模块」的共享层文件搬进该模块目录（引擎 / 专用组件 / 专用 service / 其测试）。

**归属判据 = 传递闭包 + 不动点迭代**：模块目录内文件归属该模块；共享层文件 F 的**全部「非测试、
非死代码」引用者**都归属同一模块 M ⇒ F 归属 M；环 / 多归属 / 被 `routes.tsx`、`layouts` 引用 ⇒ 真共享。
⇒ 连「只被某模块专用组件间接使用」的引擎也能正确归位（`precedence.ts` ← `OpPrecedenceDemo.tsx` ← `math_compound_expr`）。

结果：共享层 127 → 68，**可共置 59 个**
（`lib 60→28 · services 33→23 · components 33→18 · hooks 10→7 · data 4→3`）。
`modules/ai_parse_result/` 现在自带 20 个文件。

### ★ 搬家工具链的三个技术点（可复用）

1. **路径重写不靠「加深一层」**（脆弱），而是「**旧图解析 → 新路径重算**」：对每条相对 import，
   先用旧图解析出目标文件，再按「引用者新位置 → 目标新位置」重算相对路径 ——
   引用者无论留在原地还是也被搬走都对。
2. **正则必须同时吃 `"` 与 `'`**（项目里混用）；只吃双引号会漏改 ⇒ `Cannot find module`。
3. **同目录「去扩展名后小写同名」会撞**：`components/MathAnalyze.tsx` 与 `lib/mathAnalyze.ts` 搬进同一目录后，
   TS 在大小写不敏感文件系统上把 `"./MathAnalyze"` 解析到 `mathAnalyze.ts` ⇒ `TS2305` + `TS1261`。
   规则：冲突时让 `lib/services` 侧留在共享层（引用者路径自动指回 `lib/`）。

### ★★ 工具链改为「计算与执行分离 + 幂等」（重要教训）

`web/_reg_colocate.py` 只产出 `_reg_plan.json`（**永不碰源码**），`web/_reg_apply_plan.py` **幂等**落地
（目标内容已正确就跳过、旧路径不在就跳过）。

原因：执行期发现 **写操作在沙箱里会被静默拦截**（命令仍报成功、`ls` 也自相矛盾），
且 **同一条 Bash 命令可能被执行两次** ⇒ 一次性脚本的第二次运行会因源文件已不在而误报失败，
**而你只会看到第二次的输出**，据此判断状态必然出错。

### 验证

- `tsc -b --force` 0 错 · `tsx --test src/**/*.test.ts` **349/349** · `vite build` ✓ **99 chunk**
  （与搬家前一致 ⇒ 懒加载分包结构未变）
- 浏览器实测：首页 **5 小节 / 23 磁贴**逐条不变；**16 条路由**直达全 OK，
  其中 9 条是本轮动过文件的模块（`ai_parse_result` / `speech_compose` / `ai_english_talk` /
  `math_compound_expr` / `video_practice` / `radical_game` / `math_equation_move` / `ai_homework` / `char_image` 练习）

### 尚未做（下一步可选）

- **能力折叠**：4 个数学页共用「口诀 / 易错卡」版式 ⇒ 折成 1 个 math-kit；8 个 AI 页共用对话 / 批改 ⇒ 1 个 ai-kit
  （这一步要动渲染代码，才是真正「减核心」）
- **死代码清理**：`components/BlockRecorder.tsx`、`CollapsibleText.tsx`、`hooks/useSegmentAsr.ts`、
  `useSpeechComposer.ts`、`services/asrShort.ts`、`uploads.ts`、`zhDialogue.ts` 零引用
  （`lib/stubs/shikiStub.ts` 有 vite alias `shiki`，**不是**死代码）
- **未部署**：本轮只提交，未 `wrangler deploy`

---

## 0.7 🆕 2026-10-01 四个数学页「降文字密度」：一套图元数据、两端各自渲染

用户反馈：「长度与质量单位设计太多文字，最近设计的几个数学页面文字都太多了，
尽量用动画和图标演示，文字尽可能少，比如一毫米参照物用物品的图画显示在旁边」。
经确认：**范围＝四个数学页共 8 个渲染文件**（web + app）——units / mulOne / eqmove / compoundExpr；
**图画做法＝手绘矢量简笔画**（不用 AI 生成实物插画、不用精选 emoji）。

提交：`6662b3c`（基础设施 + units）、`64adc3c`（mulOne）、`a2b78c2`（eqmove）、
`7a83ce1`（compoundExpr）。**只改 `app/` + `web/src/`**，`server_cf/static_assets/web` 未入库（每次重新构建同步）。

### ★ 图标库（本轮最重要的可复用件）
- 唯一真源 **`web/src/lib/mathIcons.ts`**；坐标统一 **0..100 正方形** viewBox。
- 图元只有 5 种，**绝不使用 SVG path 的 `d` 字符串**（Android 没有 path 解析器）：
  `["c",cx,cy,r]` 圆 · `["r",x,y,w,h]` 矩形 · `["rr",x,y,w,h,rad]` 圆角矩形 ·
  `["l",x1,y1,x2,y2,w?]` 线段（`w` 默认 3）· `["p",[x,y,…],closed]` 多边形/折线。
  数组**末尾可带 `"o"`**（outline）＝只描边不填充，用来「挖空」。
- 生成链（**生成物必须提交**）：`mathIcons.ts` → `./web/node_modules/.bin/tsx web/_gen_math_icons.ts`
  → `app/src/main/java/com/example/ai/ui/icon/MathIcons.kt`；本轮 **37 → 43 个图标**。
  离线包围盒自检 `./web/node_modules/.bin/tsx web/_check_icons.ts`（门槛 30×30 且不越界）。
- 渲染件 `components/MathIcon.tsx` / `ui/icon/MathIcon.kt`（`MathIcon(name, size, tint)`）——
  **名字打错会安静地什么都不画** ⇒ 两端单测都加了「配图键必须存在」的断言。
- ★ **「左图右文」规格**：web `display:grid; grid-template-columns:30px minmax(0,1fr); gap:10px;`
  （`minmax(0,1fr)` 不能省，否则长文案撑破网格）；Android `Row` + `Column(Modifier.weight(1f))`，
  图标 30.dp（题型行/易错卡标题 20.dp），主色 `0xFF0F766E` / 易错 `0xFFB45309`。

### ★ 中文文案量化口径（`web/_shrink_zh_count.py`、`web/_dump_zh.py`，两文件同构）
只数**用户看得见的文案**：字符串字面量（`"` `'` `` ` `` 三种；模板字面量要**递归解析 `${}` 里嵌套的字符串**）
＋ JSX/Compose 裸文本 `>([^<>{}]{1,400})<`；注释一律不计。
⚠️ 必须在**剔掉字符串的代码**上**再剔一次注释**，才跑 JSX 正则（否则 `=>` 与 `<div>` 之间整段注释被当裸文本）。
⚠️ 只认 `"`/`'` 的旧版 `_dump_zh.py` 会把**模板字面量全漏掉**（`equationMove.ts` 少报 766 汉字）——已重写齐平。
「长句」＝**连续 ≥10 个汉字**（`[\u4e00-\u9fff]{10,}`，标点/数字/字母都截断）⇒ 「拆句加逗号」是合法降长手段。

### 结果（汉字 / 长句）
web：`equationMove.ts` 2100/42→**1211/8**、`EquationMovePage.tsx` 1074/24→**808/8**、
`compoundExpr.ts` 692/17→**583/7**、`MathCompoundExprPage.tsx` 389/8→**309/6**、
`OpPrecedenceDemo.tsx` 272/5→**194/0**。
app：`EqMove.kt` 2100/40→**1211/8**、`CompoundExpr.kt` 696/17→**587/7**、
`OpPrecedenceDemo.kt` 270/5→**192/0**、`EqMoveViewModel.kt` 626→489、`MathCompoundExprViewModel.kt` 297→217。

结构性改动：新增 `KIND_ICON`（题型 → 图标键，两端同名）让「提示行左边一幅图」顶掉一整句话；
`RULES`/口诀卡从长卡改为「一句话 + icon」；`MistakeCase` 增加 `icon` 字段。
**两端数据逐句同文**（Android 是从 web 逐句移植的）⇒ 改文案要同时改 `_shrink_*.py` 与 `_shrink_*_kt.py`。

门禁：web `tsc -b` 0 错、`tsx --test` **330/330**；Android **540 用例 / 38 类 / 0 失败 / 0 错误**、APK 38,027,767 bytes。

### 批量替换脚本的三条铁律（血泪）
1. **`old` 只匹配那一行本身，别把缩进写进去**——缩进差 2 个空格就命中 0 次；跨两行的串要含两行、
   且注意**字符串可能以 `"。` 结尾而不是 `",`**。
2. **Kotlin 文案里的引号是 `“”`（U+201C/U+201D），不是 `「」`**——写 old 前先看真实字节。
3. 统一模式：**先把所有 `(old,new)` 在原文里数一遍命中次数，只要有一条 ≠ 1 就整份文件都不写**，
   然后才逐条 `replace(old,new,1)`。这样不会写出半改的文件。

### 视觉核验（`web/_em_*.mjs`，已 gitignore）
本地 dev server 是 **https 且 base 是 `/web/`**：`https://127.0.0.1:5199/web/module/<路由键>`，
需 `ignoreHTTPSErrors:true` + `serviceWorkers:"block"`（`http://` 探活得 `000`）；
先 `goto(BASE)` 注入假 session（localStorage 键 `ai_phonix_web_auth`，形状 `{state:{session:{…}},version:0}`）
再进模块，并断言 `page.url()` 含模块键（`RequireAuth` 是纯客户端守卫）。
⚠️ 数学动画页路由键在 `web/src/routes.tsx` 且**不带前导斜杠**。

---

## 0.6 🆕 2026-09-22 Web 数学「解析高亮」改用数学专用 analyze

### 问题
数学题块底部的 ✨「解析高亮」此前调的是**语文**的 `POST /ai-chinese/highlight-mark`，
标的是「core 核心句 / beautiful 优美词句 / word 重点词」——**「优美词句」对数学应用题毫无意义**，属于套错对象。

### 现在（`16ff8d5`）
数学改走**数学专用**的 `POST /ai-homework/analyze`（该接口**早已实现、但此前从未被任何页面调用**），
按应用题「审题三步」标注 —— 规则实现见 `web/src/lib/mathAnalyze.ts`：

| 类型 | 含义 | 渲染 |
|---|---|---|
| `qty` 量数 | 数字 + 单位（已知数据） | 浅蓝底 |
| `rel` 关系词 | 运算线索（一共 / 比…多 / 比…少 / …倍） | 琥珀底 |
| `ask` 问题句 | 题目问什么（框定所求） | 浅绿底 + 绿下划线 |

- 优先级 `ask < rel < qty`（逐字数组覆盖），问题句里的量数仍单独标出；
- 未知量（`quantities[].value === null`）不落正文，只在面板列出；
- 面板另展示 数量 / 数量关系 / 所求 / 关键条件；
- 文字一律纯黑，靠底色 + 下划线区分（项目颜色规范）。

### 两个易踩的匹配坑（已在 `mathAnalyze.test.ts` 立护栏）
1. **数字必须独立出现**：否则 `value=2` 会命中 `"20"` 里的 `"2"`，标错位置（`findNumber()`）。
2. **关系词兜底模式要用前后视排除「多少」**：`/多(?!少)/`、`/(?<!多)少/`，
   否则问句「一共有多少个」会被误标成 less 关系词。

### 接口字段（此前 TS 漏声明，已补）
`AnalyzeResult` 实际还返回 `quantities[{name,value,unit}]` 与
`relations[{a,b,type:more|less|times|total,amount,parts}]`；`web/src/services/aiHomework.ts`
原先只声明了 `topic/sentences/total_key_points/questions`。

### 未动
语文块与表格块仍用 `BlockHighlight`（受 `isChinese` 守卫）；英语段保留原高亮
（英语有自身的词性着色 / 文章要素）。**别把数学这套规则套到语文上**——语文要的是好词好句。

---

## 0.5 🆕 2026-09-22 Android 端重启：对齐 Web 功能（**21/21 全部完成 ✅**）

### 背景
- Android `app/` 自 2026-09-10 起标注「停更存档」（`f7843b7`），期间 Web 端持续演进，新增大量模块。
- 本轮任务：**把 Android 功能补全对齐 Web**。完整差距清单与实施批次见 **`docs/ANDROID_PARITY_PLAN.md`**（新增，必读）。
- 提交：`2ed3d99`（拼音表/AI历史/AI英语）、`b90811a`（评测历史）、`64f03ac`（批次A 文档+记忆）、`e418127`（**批次B** 5 模块）、`438d749`（**批次C前半** 4 模块 + 生词本接线）、`10b58fa`（**批次C后半①** AI 对话学语文）、`d491cf5`（**批次C后半②** AI 英语对话）、`c0663cf` + `381585c`（**批次C后半③** 综合算式动画）、`1670771`（**批次C后半④** 字幕采集）、`9850006`（收官核对文档）、本轮（**收官补齐** 家长周报）。均只改 `app/`，`assembleDebug` BUILD SUCCESSFUL（APK ≈35MB）。
- 🆕 **本轮再补齐：每日英语 phonics 音形着色 + 发音要领**（原 21/21 收官清单的遗留项 ①）：`data/phonics/` 三件套（`PhonicsSegmenter` 逐位移植 web `lib/phonics.ts` + `PhonicsExceptions` 66 条例外表 + `PhonemeTips` 44 条要领表与 `tipSpeechText` TTS 清洗）+ `data/audio/PhonicsColorStore`（SharedPreferences 开关，默认开）+ `ui/common/PhonicsText.kt`（`PhonicsText`/`PhonicsToggle`，配色对齐 web App.css）+ `DailyEnglishScreen` 接线（单词/例句/句子三处着色、顶栏开关、PhoneChips 对 bad 类音素出要领卡 + 🔈 朗读）。
- 🆕 **本轮再补齐②：AI 英语对话流式 ASR 三项**（原遗留项 ②）：`data/asr/StreamingAsrClient`（OkHttp WS `/asr/stream`，START/FINISH + MID_TEXT/FIN_TEXT 契约，`awaitFinalText` 对齐 web `waitFinalText`）+ `data/audio/StreamingPcmRecorder`（200ms 块 + `energyLevel` 0-1 刻度逐位移植）+ `ui/englishtalk/EnglishTurnAsr`（web `useEnglishTurn` 等价物：start/pause/resume/stop + `PauseWatch` 静音判定 300ms 轮询/能量阈值 0.02/首静默 6s/停顿 2s，时钟可注入已单测）+ VM/Screen 接线（逐词实时上屏+电平条、停顿逐词提示、6s 挂引导阶梯复用 `EchoLadderState`、💡提示记录面板、点读/再读录音中自动暂停恢复 ASR）。单测 **+9 例**，全量门禁 **34 类 / 444 例 / 0 失败**，`assembleDebug` BUILD SUCCESSFUL。⚠️ **KDoc 里 `/asr/*` 的 `/*` 会开嵌套注释**（skill `aiphonix-android-parity` §5c 的又一实例）。
- ⚠️ 码表 `v`=vowel-single、`V`=vowel-long（大小写敏感）；★ JVM 正则支持嵌套字符类，JS 正则照抄时类内 `[` 必须转义 `\[`（详见 `ANDROID_PARITY_PLAN.md`「批次 C 收官后补齐」小节）。
- ✅ **21/21 个 web 模块全部移植完成**（差距表 #1–#19 全绿；#2 为有意的结构差异）。完整收官结论见 `docs/ANDROID_PARITY_PLAN.md` **§3.5**。
- **仍剩余**：① web 侧待修 `charImages.ts` 的 `type_` → `type`；② 用户实机验证。（~~AI 英语对话流式 ASR 三项~~ 已在本轮补齐，见下条。）
- ★ **「拍照 OCR 自动填入」已全部落地**（详见下方「拍照 OCR 自动填入」小节）：每日语文（多图框选 + 拼音清洗）、每日英语（单图整页）、AI 英语对话（整页识词抽句 → 勾选导入）三处设置面板均已移植，对应 `OcrPickSheet` / `EnVocabPhotoSheet` 系 + `EnVocabExtract` 抽词规则。**唯一不做的是 AI 对话学语文**——web `SpeechComposePage` 本就没有 OCR，不是 parity gap。

### 已完成（批次A 5/5）
| 模块 | 关键实现 |
|---|---|
| **拼音表** | `ui/pinyintable/`（索引+详情，横向滑动）；数据 `data/pinyin/PinyinTableData.kt` **由脚本从 `web/src/data/pinyinTable.ts` 自动生成**（449 行，23声母/26韵母/16整体认读 + 助记字），别再手工转录。音频走 `/api/v1/pinyin-audio`（复用 `PinyinAudioPlayer`），例字走**中文百度 TTS**（speaker `"0"`，不是 `TtsEngine`——`TtsEngine` 是英式/美式英语专用）。首页新增固定入口卡片。 |
| **AI 英语** | `ui/aienglish/`；识别走 `AiChineseRepository.parseImage(mode="english")`（英语专用提示词，不删字母）；文本对话走**新增** `data/aichat/AiChatRepository`（`POST /ai-chat/ask` + `GET /ai-chat/session` 断点续聊）；点英文单词 → `TtsEngine`（英语），块内含汉字 → 百度中文 TTS。入口在 AI 陪练页新增的「英语」卡片。 |
| **AI 历史** | `data/aihistory/AiHistoryStore`：本地 JSON（`filesDir/ai_history.json`），**chinese/math/english 三桶**，每桶上限 50，新条目头插，缩略图 base64（`makeThumb`，≤240px JPEG60），临时文件 rename 原子写。列表页 + 详情页（只读回看，点行朗读）。AI 语文/数学识别成功后自动存快照；AI 英语会话自动存对话摘要（首条 add、后续 update）。三个页面都有「🗂 历史」入口。**对齐 web 的 `ai_phonix_web_ai_history`（3 桶×50）**。 |
| **评测历史** | `data/soerecord/SoeRecordRepository`（查询/单删/批删）；`ui/soehistory/`（全选+批量删除、展开明细）。⚠️ 查询接口 **不校验 token**，靠 body 里的 `user_id` 过滤，必须带 `TokenManager.userId`；limit 服务端上限 200。明细保留了 `units` 的**词→音素嵌套**（`ScoreClient.parseJsonResponse` 会把音素打平，历史明细需要分组，故本仓库自己解析）。入口：我的账户 → 语音评测记录 → 查看全部明细。 |

### 已完成（批次B 5/5｜2026-09-22 续做）
| 模块 | 关键实现 |
|---|---|
| **生词本** | `data/wordbook/WordbookRepository`（`/wordbook` 列表 + `/wordbook/review` 队列 + `rate/remove/add`，失败返回 **null** 以区分「空列表」）+ `ui/wordbook/`（复习/列表两个 Tab）。`isEnglish` 用 `^[A-Za-z][A-Za-z'\u2019-]*$` 对齐 web `phonics.ts`；英文走 `TtsEngine`、中文走 `BaiduTtsCache.play(text,"0")`。`rate()` **本地先出队再静默重拉**，避免等网络；`refreshSilently()` 不动 `loading`（防列表闪一下）。 |
| **记忆快乐本** | `data/joy/JoyRepository`（`/joy` 列表 + `entries` 数组、字段是**驼峰** `createdAt`）+ `ui/memoryjoy/`。`highlightJoyText()` **逐行移植** web `services/joy.ts`：targets 顺序 `words` 在前 `chars` 在后，比较用 **strict `<`** ⇒ 同位置**词胜出**。逐字点读走 `charAudioUrl(ch)` + `ttsAuthHeaders()` + `playRemote`；`playRemote` 无完成回调 ⇒ `delay(1800)` 兜底清高亮。私有 `JoyEssay` 用 `FlowRow`（标点不可点，`\n` → 满宽 Spacer 强制换行）。 |
| **汉字地图** | `data/charmap/CharMapRepository`（`/char-images/list?limit=100000` + `feedback?user_id=`）+ `ui/charmap/`。`LazyVerticalGrid(Adaptive(44.dp))`，表头 `item(span = { GridItemSpan(maxLineSpan) })`，格子 key **`"${g.key}#$idx#${cell.char}"`**（防跨年级同字冲突）。配色与 web `.charmap-cell.*` 同色（Lit `DCFCE7/15803D`、Unsure `FEF3C7/B45309`、Wrong `FEE2E2/B91C1C`、None `F8FAFC/CBD5E1`）。 |
| **成长日记** | `data/diary/DiaryStore`（本地 `filesDir/diary_entries.json`，临时文件 rename 原子写）+ `DiaryRepository`（`/llm/chat` `mode=chinese`，提示词与 web **逐字一致**）+ `ui/diary/`。单 `LazyColumn` 承载「今日输入卡 + 时间线」**避免嵌套滚动冲突**；`AlertDialog` 替代 web 的 `confirm()`。`DiaryStore` 需 Context ⇒ 由 `AppContainer` 注入 VM，**别在 VM 内 new**。 |
| **偏旁魔法屋** | `data/radical/RadicalFamilies.kt` **由脚本 `scripts/gen_radical_families.mjs` 从 web `radicalFamilies.ts` 生成**（34 字族 / 134 字 / 45 偏旁；交叉校验：Kotlin `RadicalItem(` 计数 135 = TS `{ char: ` 计数 134 + 声明 1）；`RadicalRepository`（`/radical/song` + `/radical/riddles`，网络失败返回 **null**）+ `ui/radical/`（SELECT/SONG/QUIZ/DONE 四阶段、题型 A×5 选字填空 + 题型 B×3 选偏旁、小豆反应池三组）。**修掉 web 一个边界**：`questions` 为空时 web 的 `next()` 会直接跳 DONE，Android 改为 `getOrNull` + 提示重试。 |

### 已完成（批次C前半 4 模块 + 1 接线｜2026-09-22 续做）
| 模块 | 关键实现 |
|---|---|
| **课件库** | `data/courseware/`（`CoursewareRepository` + `PickedImage`）+ `ui/courseware/`。**VM 不持有 `Context`**（`AGENTS.md`）⇒ 由 Screen 用 `ContentResolver` 读字节成 `PickedImage`（**显式实现 `equals/hashCode`**，否则 `ByteArray` 退化成引用比较）再交 VM。上传**串行**逐张（对齐 web `for (const f of files)`），失败 message 取服务端 `detail`（如「图片超过 20MB 限制」）。图片直链**不鉴权**直接给 Coil。入口在家长设置 →「内容管理」（⚠️ 该段实际在**私有** `PlanEditor` 里，加参数要**同时给 `PlanEditor` 加同名参数并透传**，否则 `Unresolved reference`）。 |
| **每日语文** | `data/dailyzh/`（`DailyZhStore` 本地镜像 / `DailyZhRepository` / `DailyTextSplit` / `DailyZhSync`）+ `ui/dailychinese/`。★ `DailyTextSplit` 是**跨页共享**的：`chars`/`words` = `[,，、;\s]+`、`sentences` = `[;；\n]+`、`todaySentences` = 换行或「句号/分号后的空白」（**零宽**，标点留在上段尾）—— 三套口径**不要合并**。★ `\s` 的 JS/Kotlin 差异见坑 0e。摘要行与 web `todaySummary` **逐字一致**。 |
| **每日英语** | `data/dailyen/`（`DailyEnStore` + `DailyEnRepository`）+ `ui/dailyenglish/`。★ `/daily-en` 在 **`server_ts` 缺失**，一律以 **`server_cf/src/routes/daily_en.ts`** 为准。`/word-info`、`/sentence-info`、`/image`、`/file/:filename` 都**不鉴权**（web 注释：「不是敏感数据，未登录也能看」）。`/image` 命中不了专表会**回退看图识字图库**（type=英词/英句），返回**文件名**。评测 `eval_mode` 用 `"0"`(词)/`"1"`(句) —— 与服务端 `resolveEvalMode()` 的 `scene="word"/"sentence"` 映射**逐位相同**；★ **千万别省成 `""`（自动判定）**：英文自动判定下句子上限只有 **30 字符**，长句会被截断（`scene`/`eval_mode` 才是 120）。 |
| **造句练习** | `ui/sentencecompose/`（选句页 → 练习页）。三级回退取词：今日句型随机 → 生词本 `reviewQueue()` 随机 → 内置 `FALLBACK_WORDS`（与 web 逐字一致）。`AiChatRepository.AiChatAskResult` **非破坏性**加了 `wrongs`（`correction.wrongs`）。 |
| **生词本自动收录**（B 遗留） | `data/wordbook/WordbookAutoCollect.kt`：`isWordbookWorthy` 移植自 web（纯 CJK 块 / 纯英文词），去重键 `${source}:${text}`。★ **服务端 `add`/`add-many` 是 `onConflictDoUpdate`（`times + 1`）⇒ 收录侧必须去重**，否则 SRS 被污染。★ 构造**注入 `launch` 而非持有 `viewModelScope`**（否则不可单测）；`by lazy` 建 collector（避免构造期访问 `viewModelScope`）。★ `speakTappedWord` **独立于 `speak`**（否则整段气泡也被收进去）。 |

#### 批次C前半补齐的公共能力（都在 `app/`）
- **`util/SoeDisplay.kt`** = web `src/lib/soeDisplay.ts` 的移植：`isMissing` / `formatScore` / `scoreClass` / `restoreWordCase`。★ 腾讯 SOE 的**漏读是 `MatchTag=2` 或负分，不是 0 分**（直接渲染会出现「-1 分」）；英文引擎返回的词**一律小写**（`I`→`i`），要按参考文本**顺序双指针**还原大小写。附 `SoeDisplayTest`（5 用例，期望值来自跑 web 真实现的探针）。
- **`WordScore.phoneInfos`** + **`PhonemeScore.rawAccuracy`/`matchTag`**（都有默认值 ⇒ 既有调用方零影响）。★ 腾讯 SOE **句子模式也返回 `phone_infos`** ⇒ 句子卡支持点单词展开音素。★ `PhonemeScore.score` 被 `coerceIn(0,100)` 夹过，漏读的 -1 会变 0 ⇒ **分不清「0 分」与「未读」**，故必须保留 `rawAccuracy`。
- 首页「学习工具」区新增「每日语文 / 每日英语」两张卡。

### 已完成（批次C后半 第 1 个模块｜2026-09-22 续做）
**AI 对话学语文**（`/module/speech_compose`）—— 一个页面三套练习，由「开始学」时填的内容分流（顺序与 web 一致：**文章 → 古诗 → 词语/句子**）。

| 模式 | 数据/接口 | 流程 |
|---|---|---|
| 词语/句子教学 | `POST /llm/zh-teach-setup`（服务端带同参缓存 + 自检重试，失败 **422+detail**）、`POST /llm/zh-teach-judge` | 生成逐题剧本 → 一问一答 → **6 秒未作答自动逐级提示**（意思 → 例句 → 句型骨架，最多 3 级）→ 文本作答判定；**答错先朗读参考回答**，用户点按钮才进跟读测评（对齐 web 两步交互） |
| 古诗 | `POST /llm/zh-poem-setup`（缓存键含 `v2`）、`/llm/zh-poem-summary`、GET `/llm/zh-poem-search`（**纯数据**，服务器内置诗库） | `PoemSplit` **本地立即切句** → 开场朗读整篇（带全诗拼音锁多音字）+ 概括（**最多等 3s**）→ 逐句「原文 → 白话」→ 逐句测评；讲解/白话后台补上后**原地合并**（按去标点文本匹配，句数一致时按下标兜底） |
| 文章背诵 | `POST /llm/article-recite` | `ArticleSplit.splitSentences` **本地立即切句** → 逐句领读 + 测评；每句背诵缩写后台生成后用 `mergeShorts` 合并 |

- 数据层 `data/zhteach/`：`ZhTeachRepository` / `ZhPoemRepository` / `ZhReciteRepository` + 共用的 `ZhTeachHttp`（`guard` **必须先重抛 `CancellationException`**，否则页面退出后请求不会被真正取消）。
- 跟读测评 = web `EchoLadder` 的 Android 等价物（**单级整句**）：复用既有 `AudioRecorder` + `ScoreClient.evaluate(engine = "16k_zh")`，**过关线 70**（★ 对齐 web `EchoLadder.PASS = 70`，**不是** `SentenceReadingViewModel` 的 80）。
- 新增公用能力（都在 `app/`）：
  - **`data/zhteach/PoemSplit`** —— 古诗切句（按 `，。！？；：` 断、标点**归前句**、换行丢弃）。
  - **`data/tts/TtsAnnotate.annotateTts`** —— **多音字注音**，移植 web `lib/ttsPinyin.ts`：产出 `字(xie2)` 形式 tex 交给 `/tts/synthesize`。★ 语法为实测确认：`字(拼音数字调)` **生效**；`字(无声调)`、`字(zhòng)`（声调符号）、`{字^拼音}` **全部无效**（拼音会被当字面念出来）。古诗因此能读对「石径斜」的 `xie2`。
  - **`BaiduTtsCache.playRemoteAndWait`** —— **可等待**的远程播放。原 `playRemote` 是即发即忘、**无完成回调** ⇒ 无法串行「先读字再读义」（旧做法只能 `delay` 硬猜）。
  - `AppContainer.ttsCache`（`BaiduTtsCache` 需 `Context` 构造，而 **VM 不该持有 Context** ⇒ 由容器持有并注入；VM 侧参数为 `BaiduTtsCache? = null`，为 null 时**静默降级为不朗读**，单测可用）。
- 首页「学习工具」区新增「🤖 AI 对话学语文」卡。

### 已完成（批次C后半 第 2 个模块｜2026-09-22 续做）
**AI 英语对话**（`/module/ai_english_talk`）—— 设置「主题 + 练习单词 + 练习句子」→ `POST /llm/en-dialogue-setup` 生成多轮英文剧本（每轮含 AI 台词、该说的回答、意群切分）→ 逐轮练习。

| 回答模式 | 数据/接口 | 流程 |
|---|---|---|
| **跟读**（默认） | `POST /llm/en-dialogue-setup`（**不传 `lang`** ⇒ 默认 en；三者至少给一个否则 **400+detail**；同参缓存落 `en_dialogue.json`；`generateWithGuard` 最多 3 次；全失败 **422+detail**） | AI 领读整句回答 → **逐词扩长阶梯**（第 1 遍读第 1 个词、第 2 遍读前 2 个词……）→ 每级 ≥70 分进下一级 → 整句读完进下一轮 |
| **自己说** | `POST /asr/short`（body `{lang:"en", audio: base64(PCM 16k/16bit/mono)}`，**无鉴权**）+ `POST /llm/en-answer-judge`（`{target, said}`，失败 **500+detail**） | 录音 → 识别 → 判定 → 通过给表扬；不通过给正确句 + 可展开**意群阶梯**（片段 → 扩长 → 整句）跟读修复 |

- 数据层：`data/englishtalk/EnglishTalkRepository`、`data/asr/AsrRepository`；翻译复用 `data/dailyen/DailyEnRepository`（`/daily-en/sentence-info` · `/word-info`）。
- **`data/zhteach/ZhTeachHttp.kt` 提升为 `data/llm/LlmHttp.kt`**（`/llm/` 前缀通用 HTTP 层：Auth / 对象解析 / 错误抽取 / 取消透传），三个语文仓储同步改名 `ZhTeachHttp` → `LlmHttp`。
- 新增公用能力（都在 `app/`，后续模块可复用）：
  - **`ui/echo/EchoLadderState`（纯状态机）+ `ui/echo/EchoLadder`（纯展示组件）** —— 移植 web `EchoLadder` 的逐词/意群阶梯。★ 语义细节：`PASS = 70`（**恰好 70 不算失败**）；第 2 级起连错 2 次**降级**到失败单位做「小步」，小步过关**回原级**（不升级、不清 level）；`level == 1` **永不降级**；`failingChunk` 用 `steps.find`（**从头扫**）⇒ 常返回第 1 个单位；`accuracy` 缺失按 `0`。附 13 条单测。
  - **`util/EnText.kt`** —— `splitEnWords` / `englishOnly` / `normEnWord` / `fallbackChunks` / `soeScene` / `evalModeForScene` / `parsePracticeWords` / `parsePracticeSentences` / `jsTrim`。附 16 条单测。
  - **`ui/common/EnglishWordTapText`** —— 英文文本逐词可点读（点词查词信息朗读 + 高亮 `0xFF90CAF9`）。未移植 web `PhonicsWord` 的音形着色（见已知差异）。
- 服务端 `lib/baiduTts.ts` 对英文文本**自动换音色**（`4193` 度泽言·自然英文）⇒ 前端**不必**区分语言，中英统一走注入的 `AppContainer.ttsCache`；「先英文后中文」严格串行（`play` 全局互斥）。
- 首页「学习工具」区新增「🗣 AI 英语对话」卡（青绿 `E0F2F1` / `00695C`）。

#### 批次C后半② AI 英语对话的已知差异（有意为之，非遗漏）
- **「自己说」降级为「录一段 → `/asr/short` → 判定」**：web 用 WebSocket 流式 ASR（`/asr/stream`）做实时逐词上屏，Android 无该通道 ⇒ 录音结束才拿到整段文本。
- **放弃 3 项依赖流式 ASR 的能力**：① 逐词实时提示；② **6 秒静音自动挂阶梯**；③ 提示记录面板。另外「未作答自动给提示」的三级 hint 也依赖静音检测，未实现。
- **`EN_WORD_RE` 照抄 web 三处反直觉行为**：连字符 **不在**字符类内（`well-known` → `well` + `known`）；数字切开（`world4u` → `world` + `u`）；非 ASCII 字母切开（`café` → `caf`、`résumé` → `r` + `sum`）。⚠️ 与 `WordbookAutoCollector` 的英文词正则（允许连字符、整串匹配）**不同，不可互换**。`normEnWord` 则只留 ASCII（`It’s` → `its`）。
- **设置面板无拍照 OCR**：前置依赖「字幕采集」。
- **`englishOnly` 判据是「首个汉字下标 `> 0`」**（不是 `>= 0`）：纯中文原样返回；`englishOnly("  你好") == ""`。
- **`soeScene` 必须传对**：`word→"0"(≤30)` / `sentence→"1"(≤120)` / `paragraph→"2"(≤120)` / `pinyin→"8"`。省成自动判定时英文句子 `maxRefLen` 只有 **30 字符**（长句被静默截断）。

### 已完成（批次C后半 第 3 个模块｜2026-09-22 续做）
**三年级上综合算式动画**（`/module/math_compound_expr`）—— **零后端**：出题与讲解全在本地算，`web/src/lib/compoundExpr.ts`（648 行）+ `precedence.ts`（290 行）整份移植为 `data/math/CompoundExpr.kt` + `data/math/Precedence.kt`（纯 Kotlin）。

教学法「找 → 换 → 查」：① 相同数双高亮 + **斜虚线真正连到两个数上**（两端圆点）；② ★ **转移动画**：① 的算式成幽灵，从得数位置起飞→抬起放大→落到 ② 那个数字位置并**原位顶掉**它（② 卡同时隐藏 `= 得数`，因为那时式子还没验证完）；③ **三小步**：先不加括号展示 → 把「按规矩会第一个算到」的运算符标**红**（点名具体是哪个）→ ★ **括号飞入 → 落位 → 向内夹紧**（被抱住那段亮紫边紫底）→ 按正确顺序**逐项绿高亮**。不用加括号时：括号飞进来**想夹→夹不住→被弹回去消散**。

- **出题引擎**：4 题型（先加减后乘除 / 先乘除后加减 / 得数做被除数 / 得数做减数）+ 按权重随机 + 批量去重。★ **反推参数**（先定得数再推操作数）保证 `a op b == result` 恒成立；★ **巧合题拦截**（需括号的题若「去掉括号答案竟一样」直接丢弃）；题面规范（排除重复加数、排除「替换哪个数分不清」的歧义题）。
- **优先级引擎**（页内可展开的「🔢 先算谁？」小块，也是「查」的前提）：产物是**计算顺序轨迹** `planSteps()`，动画只照轨迹播；`why: PAREN / HIGHER / SAME_LEVEL` 三值直接映射三句讲解。
- **单测 21 例（新增 2 类）**：`CompoundExprTest`（11 例，1000 道随机全量校验 + 题型判据 + **动画不变量 `fromFirst` 必须连续整块** + 无重复加数）；`PrecedenceTest`（10 例，两组示例的**硬编码常量**裁判 + 括号内优先级 + `nextOpIndex` 两规矩 + 随机 3000 例交叉验算 + 轨迹不变量）。
  ★ 求值用**互相独立的裁判**：手写递归下降 ↔ `Precedence.planSteps` 的逐步化简（另一份移植）—— 两个不同实现给出同一个整数，才把「生成的题是对的」从信仰变成证明。
- Compose 侧四个实现要点：① 幽灵飞行 = **单一进度 0→1 + 手写分段插值**（等价 web 的 4 段 WAAPI keyframes，蓄力段用 `easeOutBack` 复刻 back 缓动）；② 括号**真身始终占位（alpha 0）**、替身飞到位后真身立刻显形，且**绝不能给括号加透明度过渡**（会出现「括号闪一下」的空档），时间常量与 VM 落位时刻**同源**；③ 坐标统一报 `boundsInRoot()`、取值只减基准容器（`CeGeom.relTo(anchor, key)`）；④ 优先级小动画用**定宽槽位**（数字 38dp / 运算符 30dp / 间隔 7dp）⇒ 宽度过渡不必量尺寸，扫描条目标位置可直接累加算出。
- 首页新增「🧮 动画学数学」小标题 + 「三年级上综合算式动画」卡（靛蓝 `E8EAF6` / `3949AB`），对齐 web 首页的「动画学数学」分区。

#### 批次C后半③ 综合算式动画的已知差异（有意为之，非遗漏）
- **动画未做逐帧核验**：web 靠抓帧 + `getBoundingClientRect` 坐标断言验证落位精度；本机**无设备/模拟器**，Android 只到「构建通过 + 引擎单测绿」，观感由实机验证补。
- **`prefers-reduced-motion` 换成系统动画缩放**：读 `Settings.Global.ANIMATOR_DURATION_SCALE == 0` 时直接跳到完成态。
- **易错卡「滚到才揭晓」用 LazyColumn 天然实现**（卡片进入 composition 才起 1.1s 定时器）⇒ 等效 web 的 `IntersectionObserver`，且不需要观察者。
- **括号「夹紧」的紫边用 `drawBehind` 画**（不改变任何布局尺寸）⇒ 比 web 的负 margin 方案更稳，落位坐标不会因夹紧而漂。

### 已完成（批次C后半 第 4 个模块｜2026-09-22 续做）—— **批次C后半收官**
**字幕采集**（`/module/subtitle_capture`）—— 打开影片（本地 / 云端直链 / B站搜索）→ 在画面上**框选字幕区** → 在某一时间点**截那一帧** → 存盘（文件名含时间戳）+ 交 LLM 识图出「原文 / 翻译 / 纠错 / 讲解」→ 结果卡片可回看、可重测、可跟读评分；框选位置作为**书签**打在进度条上，播放到书签附近**自动暂停**提醒复习。

**分层**（`data/subtitlecapture/` + `ui/subtitlecapture/`）

| 文件 | 职责 |
|---|---|
| `SubtitleCaptureModels.kt` | 数据类：`CaptureItem` / `SubtitleEval` / `EvalCardModel` / `SubtitleMark` / `RectMemory` / `LastMovie` / `BiliItem` / `CaptureRequest` / `MovieSource` |
| `SubtitleCaptureLogic.kt` | **纯函数 object**（可 JVM 单测）：时间戳格式 / 画框坐标换算与 clamp / 书签命中 / 近邻分组 / 测评卡片合并 / URL 推导片名 |
| `SubtitleCaptureStore.kt` | SharedPreferences（沿用 web 的 localStorage key 名）：画框记忆 / 书签 / 上次影片 |
| `SubtitleCaptureRepository.kt` | `/subtitle-capture/*` 六个接口（multipart 上传 · JSON 重测 · 列表 · 删除 · B站搜索） |
| `VideoFrameCropper.kt` | **唯一需要 `Context` 的**：`MediaMetadataRetriever` 取帧 + 旋转校正 + 裁剪 + PNG |
| `ui/subtitlecapture/` | ViewModel（UDF，**不持 `Context`**）+ Screen（`ExoPlayer`/`PlayerView`、框选叠加层、进度条书签、结果卡列表） |

★ **抓帧：web 靠 canvas，Android 只能走 `MediaMetadataRetriever`**

| web | Android | 说明 |
|---|---|---|
| `<video>` + `canvas.drawImage` | `getFrameAtTime(ms*1000, OPTION_CLOSEST)` + `Bitmap.createBitmap` 裁剪 | 必须 `OPTION_CLOSEST`；`OPTION_CLOSEST_SYNC` 只给关键帧、可能差好几秒（字幕早换句了） |
| `video.videoWidth/Height`（旋转后尺寸） | 同尺寸 **+ 手动 `Matrix.postRotate`** | 竖拍手机 `METADATA_KEY_VIDEO_ROTATION = 90`，不校正会裁错位置 |
| —— | 画框 **clamp 到帧内** | `createBitmap` 越界会抛 `IllegalArgumentException` |
| —— | **不能抓控件** | `PlayerView` 底层是 `SurfaceView`，`View.draw(Canvas)` 抓不到画面 ⇒ 必须走 retriever |
| 影片文件存 IndexedDB（重启自动续播） | 只存 SAF URI + **`takePersistableUriPermission`** | 不做持久化授权重启后 URI 失效、**静默播不出来** |
| B站用 `<iframe>` 内嵌 | `WebView` 载 B站播放页 | **两端都不能采集**（无帧数据），行为一致 |

★ **逐条对齐的「神奇数字」（各有出处，不能统一成一个）**：书签展示容差 **800ms（含边界 `<=`）** / 自动复习容差 **400ms（严格 `<`）** / `saveMark` 去重窗口 **300ms** / 服务端缓存命中 **500ms** / 近邻截图分组 **1500ms**；近邻分组**只比相邻两项、不展开传递性**。★ `saveLastTime` **保留原影片名**（web 即使当前片名不同也保留存着的名字）⇒ 照抄，否则进度被写到别的影片名下。
★ 该路由**整段挂 `requireAuth()`**，**包括 `GET /file/:fileName`** ⇒ 截图直链必须给 Coil 手动加 `Authorization` 头（web 靠 `api()` 的 fetch 自动带 token；`<img src>` 在 Android 会 **401**）。`/bili/search` **不鉴权**。

★ **单测 19 例（新增 1 类）`SubtitleCaptureLogicTest`**：期望值**全部来自 `web/_subcap_probe.mjs`**（把 web 的 `fmt` / `restoreRectForMovie` / 近邻分组 / 书签命中 / `openUrl` 取名 / `mousemove` clamp **原样复制到 node** 跑出来的，**不是**按语义推导）。这一步当场抓出真差异 ⇒ 见坑 0q。

- `ui/subtitlecapture/SubtitleCaptureScreen.kt` ≈1100 行，单 `LazyColumn` 承载全部内容（item key：`header/stage/soepopup?/eval/list-header/row-<seq>/footer`）。`ExoPlayer` + `VideoFrameCropper` 由 Screen 持有，Screen 只回传「播放头 / 时长 / 尺寸 / PNG 字节」，**VM 不碰平台资源**。
- ★ 自动复习用**状态驱动**而非事件通道：VM 只把 `pendingAutoPauseTs` 挂状态，Screen 的 `LaunchedEffect` 观察到后**先 `player.pause()` 再 `consumeAutoPause()`**（顺序反了朗读会被继续播放打断）。
- 首页新增「🎬 视频」小标题 + 「字幕采集」卡（蓝灰 `ECEFF1` / `37474F`）。

#### 批次C后半④ 字幕采集的已知差异（有意为之，非遗漏）
- **云端直链截图不需要 CORS**：web 受同源策略限制（截图失败 = 未开 CORS），Android 原生请求无此限制 —— 这是**能力提升**；提示文案沿用了 web 的说法，实机看到该句可直接忽略。
- **八向缩放手柄不做负偏移**：web 是「10px 圆点 + 负偏移压住框线」，Compose 里**超出父边界的子元素收不到手势** ⇒ 就地贴边放在框内（视觉略靠内，但一定可拖）。
- **进度条书签点与 `Slider` 轨道有几 dp 偏差**（web 是绝对定位 div，Compose 受 `Slider` 内建 padding 影响）。
- **B站内嵌预览不能采集**：与 web 一致。
- **未做逐帧核验**：本机无设备/模拟器 ⇒ 只到「构建通过 + 逻辑单测绿」，取帧裁剪位置 / 旋转视频 / SAF 授权由实机验证补。

### 已完成（数学动画 · 第 2 个模块｜2026-09-29）—— 等式变变变 ✅（**21/21 之外的新增模块**）
**等式变变变**（路由键 `module/math_equation_move`，见 `web/src/routes.tsx:120`）—— **零后端**：出题与讲解全在本地算，`web/src/lib/equationMove.ts` 整份移植为 `data/math/EqMove.kt`（纯 Kotlin），页面 `web/src/pages/EquationMovePage.tsx` → `ui/eqmove/`（VM + Screen）。

教学法「找 → 飞 → 落 → 算」：① 要搬走的那一整块**脉动高亮**；② ★ 整块起飞越过**等号分界线**（等号上下各一段虚线 + 底部「等号 = 分界」标签），**跨线那一瞬符号翻牌**（旧符号转半圈缩走、新符号从对面转出来）+ 竖线闪一下 ⇒ 把「这条线就是变号的分界」演出来；③ 落在等号另一侧末尾，源侧原位**只变灰划掉、不删除**（学生看得出它从哪儿走的）；④ 算出结果并把答案代回原式验算 ✓。★ **四种动作模型** `EqActionType`（对齐 web 的 `ActionType`）—— 本轮从「只有 move」扩到 4 种：

| 动作 | 含义 | 视觉 | 符号 |
|---|---|---|---|
| `MOVE` | 跨过等号搬一项 | 幽灵飞越 + **跨线翻牌** + 落位槽 | **必须翻转** |
| `SWAP` | 同一侧相邻两项交换 | 只在一侧内部擦身滑动（`dx>0` 抬上去、`dx<0` 沉下来） | **一点不动** |
| `COMBINE` | 同侧合并同类项（`3x` 与 `-2x` ⇒ `x`） | 两项同亮 → 合成项紫底亮一下 | 求值不变、写法变短 |
| `FLIP` | 等式两边整体对调（`b = x + a` ⇒ `x + a = b`） | 两侧同时滑到对面 | 全都不动 |

🔴 **只有 `MOVE` 有「落位槽」概念**：swap / combine / flip **不跨等号线** ⇒ 绝不能落进「幽灵飞越」那条渲染路径，否则会把「同侧换位、符号不变」画成「整块飞过等号」，**教学上正好教反**。VM 的 `view` / `play` 与 Screen 的幽灵、落位槽、FLIP 三处都按 `act.type == EqActionType.MOVE` 分流守卫（web 同款守卫见 `EquationMovePage.tsx:77` 的 `isMove`）。

- **出题引擎**：**13 题型** —— 基础 7（plus / minus / times / divide / minusVar / divideVar / sameSide）+ 本轮新增 6（`revealPlus` / `revealTimes` 首项显形、`xRight` 未知数在等号右边、`threeTerms` 一边三项、`bothSides` 两边都有 x、`multiStep` 两步搬运）。★ **反推参数**（先定 x 与操作数再算得数）⇒ 每道题恒成立，动画只照着 `MoveAction` 播、自己不参与计算。★ `threeTerms` 的参数上限收紧为 `x∈2..8`、`a/c∈2..6` ⇒ 得数 ≤20；`multiStep` 要求 `k-m=1`（否则两步内搬不完）。★ 题型按钮不再硬编码 3 行，改由 `EQ_KIND_GROUPS` 四组（基础·跨线变号 / 进阶·要搬两次 / 进阶·结构变化 / 反例·同侧不变号）驱动。
- ★ **首项显形（本轮的「加一个动画」需求）**：首项前面不写符号是**纯显示约定**（`eqEffectiveOp` 对 `i==0` 返回 `+`，若后面紧跟 `×`/`÷` 则返回 `×`），学生**看不见符号** ⇒ `revealPlus` / `revealTimes` 先用 `SWAP` **在同侧换位把符号挤出来**（`8 - x = 3` → `-x + 8 = 3`，符号显形），**再**用 `MOVE` 搬走。动作序列固定 `"swap,move"`，单测 `EXPECTED_ACTIONS` 钉死。
- ★ **`SWAP` 的数学前提**：只对 `+` 和 `×` 合法（交换律）；`a ÷ x ≠ x ÷ a` ⇒ 中间是 `÷` 时 **`require` 直接抛错**（不静默降级）。
- **随机 6 题练习**（原 5 题，本轮 +1）：4 条基本变号规律**各一道** + 1 道两步型 + 1 道同侧交换（`DRILL_BASIC` / `DRILL_STEP` / `DRILL_POOL` + Fisher–Yates 打乱）；候选池不够时 `n` 自动退让（不抛错）。「🔄 换一组」重开并清零计分。
- 🔴 **命名必须带 `Eq` / `eq` / `EQ_` 前缀**：`EqMove.kt` 与 `CompoundExpr.kt`、`Precedence.kt` **同处 `com.example.ai.data.math` 一个 package**，Kotlin **顶层声明同包不能重名**。那边已有 `KIND_LABEL` / `RULES` / `MISTAKE_CASES` / `rndInclusive` / `generateProblem` —— 照抄 web 的裸名会直接编译不过（`Overload resolution ambiguity` / `Conflicting declarations`，报错位置在多处调用点、极具误导性）。`Precedence.kt` 也是靠 `P` / `Pr` / `PR_` 前缀在同一包避让的 ⇒ 沿用同一惯例。同名文件还有 `EqState` / `EqSideList`（原 web 的 `Side`）/ `EqTerm` / `eqFlipOp` / `eqSideToText` / `eqRndInclusive` / `generateEqProblem` / `generateEqDrill` / `EqPracticeItem` / `EQ_KIND_LABEL` / `EQ_RULES` / `EQ_MISTAKE_CASES` / `EQ_PRACTICE`。
- ★ **选项集 4 → 5 个**：`EqPracticeAnswer` sealed（`Op` ×4 + `Same`「保持不变」），配合 `EqPracticeAsk.SAME_SIDE` 出「同侧换位该不该变号」的对比题 —— **「不变」那一项是故意放进去的干扰项**（`EqPracticeKind` 也从 5 种扩到 9 种）。
- **单测 27 例（新增 1 类）`EqMoveTest`** ⇒ 全量 **471 用例 / 0 失败 / 35 类**（上批 460 / 35）。★ 两个**互相独立**的裁判给同一个数：裁判 A 按 `EqTerm` 序列逐项求值；裁判 B 把算式**渲染成文本再解析求值**（另一条实现路径，只认字符串）。断言链：原式成立 → **每搬一步前后都还成立** → 搬的项只是符号取反、值一字未改 → 末态右侧求值 == `answer` == `x` → 答案代回**原式**也成立。★ `checkProblem` 按 `a.type` 分支校验四种动作各自的守恒律：MOVE 查符号翻转 + 项数守恒 + 落位 + `varMoves ≤ 1`；SWAP 查 `fromOp == toOp` + 相邻 + 组成不变 + 求值不变 + 非 `÷`；COMBINE 查项数 −1 + 求值不变 + `combined` 落位 + 系数 = 两项和；FLIP 查左右对调。覆盖 **13 种题型 ×300** + 混合随机 1000 + 随机练习组 ×300。
- ⚠️ **同侧交换的判据别用「显示形态」拼串比**：首项不写符号是**显示约定**，不代表它没符号。`5 + x` 的项是 `[(null,"5"), (+,"x")]`、`x + 5` 是 `[(null,"x"), (+,"5")]` —— 按 `"${op?.sym ?: ""}${value}"` 拼串再排序会得到 `["5","+x"]` vs `["x","+5"]`，**永远不等**（本轮真踩到，挂在断言上）。正确口径（与 web `equationMove.test.ts` 第 270~273 行一致）：① 左侧**整体求值**不变；② 第二项写出来的符号仍是 `+`；③ 逐项取「**语义**符号 + 值」再比较（测试里**独立复算了一遍**「首项没写符号时带的是 + 还是 ×」）。
- Compose 侧实现要点：① 幽灵飞行 = 单一进度 0→1 + **手写三段分段插值**（等价 web 的 4 段 WAAPI keyframes，蓄力段用 `easeOutBack`）；★ **跨线点 `cross` 由实测几何算出**（源项中心 ↔ 等号线 ↔ 落位槽），**不能写死** ⇒ 翻牌时刻由 Screen 在飞行动画跑到 cross 时回调 VM 记账（`onGhostCrossed`），VM 只管状态、Screen 管几何与动画。② **落位槽从动画一开始就以 alpha 0 占位**（`graphicsLayer{alpha}` 不影响布局）⇒ 整个动画期间两侧宽度完全不变，幽灵落点像素级准确。③ 坐标统一报 `boundsInRoot()`、取值只减基准容器（`EqGeom.relTo(anchor, key)`）。④ **swap / combine / flip 三种动作统一走 FLIP**：量旧位 → 切 state → 倒推 `dx` → 滑动（`dx > 0` 抬上去、`dx < 0` 沉下来，否则两项半路正面叠成一个「x5」）。★ **`combine` 的合成项文本变了**（`3x`/`-2x` → `x`）⇒ 查不到旧位就 `return@forEachIndexed` 安静收场、只留紫色高亮 —— **这与 web 完全一致**（`EquationMovePage.tsx:361` 原注释：「找不到同名的旧位（比如 combine 后文本变了）⇒ 这一项不做位移，安静收场」）。⑤ 「找」的脉动高亮用 `rememberInfiniteTransition`（仅在 `lit` 时创建）。⑥ 等号线用 `Canvas(matchParentSize)` 画，**状态读在 draw lambda 里** ⇒ 只重绘不重组。
- 🔴 **FLIP 的位置上报 key 必须带侧别前缀**：`geom.report("$valuePrefix${term.value}")` 存进去的是 `lval-8` / `rval-8`，查表若写成 `prevSide[term.value]`（少了 `lval-`）⇒ **全部落空**，`?: return@forEachIndexed` **静默提前返回**，同侧滑动「看着像实现了、其实从未动过」。★ web 侧能不加前缀是因为它用 `.eq-side-${side}` 选择器**把查询限定在一侧内**；Compose 没有 DOM 选择器可依托 ⇒ 前缀必须落在 key 上。**静默空匹配是本项目最常见的失败形态**，改这类代码后必须逐帧抓图确认。
- 首页「🧮 动画学数学」小节下新增第 2 张卡「⚖️ 等式变变变」（橙 `FFF7ED` / `EA580C`），NavKey `EqMove`。

#### 等式变变变的已知差异（有意为之，非遗漏）
- **动画未做逐帧核验**：本机无设备/模拟器 ⇒ 只到「APK 构建通过 + 全量单测绿」，观感由实机验证补。
- **`prefers-reduced-motion` 换成系统动画缩放**：读 `Settings.Global.ANIMATOR_DURATION_SCALE == 0` 时直接跳到完成态。
- **易错卡「滚到才揭晓」用 LazyColumn 天然实现**（卡片进入 composition 才起 1.1s 定时器）⇒ 等效 web 的 `IntersectionObserver`。
- **题型选择排成 3 行、口诀/原理/易错 chips 排成 2 行**：web 是 flex-wrap，窄屏（320）会顶出横向滚动，Android 直接分行（13 题型后按 `EQ_KIND_GROUPS` 四组分段，每段 3 列 + 末尾补空位）。
- **首项显形与 combine / flip 两种新动作的观感同属「未逐帧核验」** —— 逻辑由 27 例单测钉死（含每种题型 ×300 的逐步守恒），动画由实机补验。

### 已完成（数学动画 · 第 2 模块续｜2026-09-29）—— 分步解方程练习 ✅
**需求原话**：「练习题也要分步骤动画 学生跟着动画步骤填每一步的答案 直到完成算式求解」。

把原来的「一道题只问一次」（只问「挪过去符号变成什么」）整体换成**一步一填的分步解题**：学生答出一步 → 卡片**就在卡内**演出这一步的动画 → 再填下一步 → 一路填到把 `x` 解出来。
> ⚠️ 本节**取代**上面「随机 6 题练习」（原 `DRILL_BASIC` / `DRILL_STEP` / `DRILL_POOL`）与「选项集 4 → 5 个」两条里关于**随机练习**的旧设计；**教材对比练习**（`EQ_PRACTICE` ×4、`EqPracticeAnswer` / `EqPracticeAsk`）原样保留，`PracticeCard` 仍服务于它。

- 引擎（`web/src/lib/equationMove.ts` ↔ `data/math/EqMove.kt` 逐行对照）新增 `SolveStep` / `SolveItem`：
  - ★ 步骤 = `p.actions` 各一步 ＋（`flipSides` 时）补一次「两边对调」 ＋（`!isSameSide` 时）最后「算出来」一步。上一步的 `after` **必须逐字段等于**下一步的 `before`。
  - ★ **每一条都从 `BUILDERS[kind]()` 生成的 `MoveProblem` 派生**，绝不另算一遍数学 —— 否则会出现「练习说跨线变号、主舞台演的却是同侧换位」的自相矛盾。
  - ★ 删除 `PracticeKind` / `buildPracticeItem` / `generateEqDrill`（Kotlin 侧同步删 `EqPracticeKind` / `DRILL_*` / `buildPracticeItem` / `generateEqDrill`，并去掉 `EqPracticeItem.kind`）。组合策略不变：**4 条基本规律各一道 ＋ 1 道多步题（必出）＋ 1 道「同侧换位不变号」反例（必出）**，打乱后取前 n。
- ★★ **分步解题的数值判据（本轮新确立、被单测钉死）**：四种动作在数值上**分成两类**
  - `move` —— 两侧的值**都会变**（这正是「搬运」的含义），但**等式照旧成立**
  - `swap` / `combine` / `flip` —— 两侧的值**一分不动**，只有写法变了

  ⇒ 学生只要用「数值变没变」就能替我们判「这一步到底跨没跨等号线」。**我第一版判据写成「每一步两侧都不许变」，被自己的单测当场抓出**（`plus 第 1 步(move): 左边求值变了（17 ⇒ 8）`）—— 已拆成 `stateHolds()`（只断言等式成立）+ 按 `type` 分支（`move` 用不等断言、其余用相等断言）。
- ★ **「忘变号」陷阱项**：把末态右侧除首项外的运算符全翻回去再求值（代 `x=0`，此时右侧已不含未知数）⇒ 得到经典错答 `noFlip`，**保证进选项**，学生选中时点破（`trapAnswer` / `trapTip`）。实测 `x + 8 = 12` 的陷阱项是 **`20`**（= 12+8）✔。⚠️ `noFlip` 必须用 **Double** 累积再判整除 —— JS 的除法会出小数，Kotlin 的 `Int` 会**静默截断**把 `8÷3` 变成合法的 `2` 混进选项。
- ★ **同侧反例题（`sameSide`）刻意不给「算出来」那一步**（`solved: false`、`steps.size == 1`）—— 它只演示「同侧换位不变号」，硬凑一步会把「这一步不用解」这个教学点抹掉；收尾文案改为「🧩 这一步填完了」。
- 卡片（web `SolveCard` / `SolveDone` ↔ `ui/eqmove/EqMoveScreen.kt` 尾部）：
  - ★ **卡内幽灵必须绝对定位**（web 用 `position:absolute`；Compose 用**每张卡一个独立的 `EqGeom` 实例** + 相对卡片舞台的偏移）。主舞台一屏一道题、用视口坐标没问题；**一屏 6 张卡再用视口坐标，幽灵会飞出卡片盖到隔壁**。
  - ★ **复用主舞台的渲染件**：给 `EqSideContent` / `EqToken` / `GhostBlock` / `OpGlyphText` / `FlippingGlyph` 加了**带默认值的 `size` / `spacing` / `glyphW` / `padH` / `padV` 参数**（默认值 == 原值 ⇒ **主舞台零变化**；卡片传 20sp / 6dp / 13dp / 5dp / 1dp）。卡片自己的阶段枚举映射回 `EqPhase` ⇒ 涂装规则一字不改。
  - ★ 卡内时间轴（比主舞台短一截）：`S_FIND 560` / `S_FLY 780` / `S_SLIDE 700` / `S_LAND 820`；`SOLVE` 步没有可演动作 ⇒ 直接亮结果。
  - ★ **`flip` 刻意不做 FLIP 测量**（对调时两侧的项会换边，「按文本找旧位」本就不成立）⇒ 纯视觉擦身而过（左侧从右滑来、右侧从左滑来）；`flipSides` 补出来的那次对调同样走这条。
  - ★ 计分单位从「题」改成「**步**」（`EqMoveUiState.drillStepCount`）；每一步**只在第一次点选时**记成绩，答错可以再试（红框留在原地、选项不锁死）。
- 🔴 **同名函数在测试里先踩到「局部声明不能前向引用」**：给卡片加符号翻牌协程时，把 `LaunchedEffect(symFlipped, playToken)` 写在了 `symFlipped` / `playToken` 的 `remember` **之前** ⇒ `Unresolved reference`。**同时还有 8 条级联报错**（`view.left` / `view.right` / `term.value`），根因却只是 Screen 少了一句 `import com.example.ai.data.math.EqState`（`val view: EqState?` 解析不了 ⇒ 整条链塌掉）。**Compose 文件里引入新类型一定要补 import**，否则报错位置全在调用点、极具误导性。
- **验证（web 本地 dev server `5188`）**：`tsc -b` 零错误 · `tsx --test` **278/278 全绿** · 抓帧脚本 `web/_eq_solve_shot.mjs` 改「跑到四类动作都见过为止」（`MAX_ROUNDS = 20`，避免靠抽签），最终**第 11 轮收工**：**11 轮 ×6 张 = 72 张分步卡**（共填 **154 步**），实测：
  - **72 张卡「轨迹条数 == 步数」零误差** ✔；答错能再试 ✔（`bad:true, stillEnabled:true`）；**零 `/api/v1/` 调用** ✔；窄屏 320 无溢出 ✔（`{scrollW:320, innerW:320}`）；console 只有 dev server 自签名证书的 2 条 `SSL certificate error`（与本页无关）。
  - ★ **四类动作（跨线变号 / 同侧换位 / 同侧合并 / 两边对调）全部在浏览器里亲眼见到** ✔，含一直抽不到的 `同侧合并`（帧文件 `L8_第步同侧合并_*.png`：紫底 `x` + 3 条轨迹 + 选项禁用 + 绿框「不变」）。
  - 「算出来」步 **60/60** 都是 4 个互不相同的选项，且陷阱项确为「忘变号」算出的数 ✔（抽样：`11-3` 正解 8 / 陷阱 14；`21÷3` 正解 7 / 陷阱 63；`5×4` 正解 20 / 陷阱 40；`11+8` 正解 19 / 陷阱 3）。
  - 关键帧人工核对：`L4_第步跨线变号_2motion.png`（幽灵压在等号上、源项 13 划掉）· `L5_第步两边对调_2motion.png`（`flipSides` 题正确调成 `x = 13 - 8`）· `B3_progress.png` / `N_narrow_card.png`（同侧反例题收尾「🧩 这一步填完了」）· `L1_第步跨线变号_2motion.png`（那是**故意先点错**的那一拍）。
  - ⚠️ **中途插曲：「`同侧合并` 连跑 10 轮一次都没抽到」** —— `combine` 只在 `bothSides` / `multiStep` 里出现，而每轮**只抽 1 道**进阶型（2/8 命中率）⇒ **纯抽签运气，不是功能坏了**。两手处置：① 脚本改成「跑到四类都见过」（`NEED` + `kindsSeen()`）；② 另写**引擎层确定性检查** `web/_eq_kind_check.ts`（13 题型 × 8 轮逐个 `buildSolveItem`，断言答案在选项里 / 首尾相接 / `move` 答案 ≠「不变」而同侧答案 ==「不变」/ `solved` 时末步必为 `solve`）⇒ 全绿，`combine` 确实存在且 5 种步骤类型数据自洽 ✔。**以后遇到「某分支没被抓到」，先怀疑抽样，再怀疑代码。**
  - ⚠️ **抓帧脚本的「下一步」按钮只在该步 `settled` 之后（约 2.2s）才渲染**：早先脚本只等 260ms 就查、查不到直接跳过 ⇒ **步骤漂移 + 每张卡干等 30s**（18 张 ≈ 540s，看着像卡死）。已改成 `waitFor({state:"visible", timeout:5000})` + 短超时 `readText()`，三轮全部跑完无卡死。
- **Android 侧**：`:app:testDebugUnitTest` **472 用例 / 0 失败 / 35 套件**（`EqMoveTest` 28 例：删 7 例整题用例、加 8 例分步用例）+ `:app:assembleDebug` 通过。

#### 分步解方程练习的已知差异（有意为之，非遗漏）
- **动画未做逐帧核验**（同上一节）：本机无设备/模拟器 ⇒ 只到「`assembleDebug` 通过 + 全量单测绿 + web 侧抓帧核对」，实机观感由用户补验。
- **`combine` 步的视觉已由浏览器抓帧确认**（`L8_第步同侧合并_*.png`）；它与 `swap` **共用同一条渲染分支**（差别只有合成项的紫底高亮）。

**家长周报**（`/module/parent_report`）—— 近 7 天评测趋势 + 识字状态 + 需多练的词，给家长看。

- 分层：`data/parentreport/`（`ParentReportLogic` 纯函数引擎 + `ParentReportRepository` 只做聚合）+ `ui/parentreport/`（ViewModel + Screen）。
- ★ **入口在评测历史页**（对齐 web `SoeHistoryPage` 里那个「📈 家长周报」按钮），**不在首页**。
- ★ **别和 `ReportScreen` 混**：那是本 App 自己的「学习报告」（读 `/api/v1/practice/stats` + `/api/v1/practice/history`），与 web 家长周报**不是同一功能**（数据源完全不同）。新模块 = `ParentReportScreen` + NavKey `ParentReport`，原 `ReportScreen` **未改动**。
- ★ 三源：`/soe/records` + `/char-images/feedback` 的 **`stats`** + `/wordbook/list`。web 传 `limit:500` 但服务端 `Math.min(limit, 200)` 会夹到 200 ⇒ Android 直接要 200，**取到的数据与 web 完全一致**（非能力缩水）。★ 给 `CharMapRepository` 补了 `feedbackWithStats(userId)` —— 原 `feedbackStatus` **只取 items、把 `stats` 丢了**；现在 `feedbackStatus` 委托它，两者共用同一次请求。
- ★ **两条 web 口径必须保留**（看着像 bug，实为口径，已用单测钉死）：
  ① **日期 key 用设备本地时区，记录侧却比 `created_at` 前 10 字符（= UTC 日期）** ⇒ UTC+8 上本地 **00:00–08:00** 产生的记录会归到**前一天**那一列（实测：本地 22 日 00:10 的记录落在 21 日列）。
  ② 「需多练」的 30 天 cutoff 取自 `toISOString()`（**恒为 UTC**），与 ① 的本地 key **不同源**（`08-23T00:00Z` 入选、`08-22T23:59Z` 出局）。
- ★ `weakWords` 三段：`ref_text` **去空白必须用 JS 空白集**（`util/removeJsWhitespace`，含 U+3000 / NBSP / BOM）→ 截前 8 字做 key → 同组取**最低分** → 筛 `< 80` → **升序**取 8；同分按**首次出现顺序**（`LinkedHashMap` + 稳定 `sortedBy`）。
- ★ 新增公共件（都在 `util/EnText.kt`）：`removeJsWhitespace()`、`jsNumber()`。★ `suggested_score` 是数据库 **`real`（带小数）** ⇒ **显示必须过 `jsNumber`**（复刻 JS `String(number)`），否则 Kotlin `Float.toString()` 会把 `85f` 打成 `"85.0"`，而 web 是 `85`。
- ★ `toLocaleString("zh-CN")` 的等价物是 `SimpleDateFormat("yyyy/M/d HH:mm:ss", Locale.CHINA)`（月/日**不补零**、时/分/秒补零）。
- 唯一显示差异（有意）：三路全失败时显示「⚠️ 统计数据加载失败（断网）」，web 则显示一片 0（避免家长误以为孩子这周没练）。
- 单测 **21 例（新增 1 类）`ParentReportLogicTest`**，期望值来自 web 原逻辑的 node 探针（含空集场景）。

### 已完成（数学动画 · 第 3/4 个模块｜2026-10-01）—— 长度与质量单位 + 多位数乘一位数 ✅

两个模块一次做完，都是**零后端**：引擎从 web `src/lib/*.ts` 整份移植为纯 Kotlin，页面各自 VM + Screen。

| 模块 | 路由键（`web/src/routes.tsx`） | 引擎 | 页面 |
|---|---|---|---|
| 长度与质量单位 | `module/math_units`（:123） | `data/units/Units.kt` | `ui/units/`（UnitsViewModel + UnitsScreen） |
| 多位数乘一位数 | `module/math_mul_one`（:124） | `data/math/MulOne.kt`（**前缀 `Mo`/`mo`/`MO_`**） | `ui/mulone/`（MulOneViewModel + MulOneScreen） |

★ **命名前提（老坑重演风险）**：`MulOne.kt` 与 `CompoundExpr.kt`/`EqMove.kt`/`Precedence.kt` **同处 `com.example.ai.data.math`**，
而 `MistakeCase` / `RULES` / `MISTAKE_CASES` / `planSteps` / `rndInclusive` / `generateProblem` **全部已被占用** ⇒
本文件**一律**加 `Mo`/`mo`/`MO_` 前缀（`MoStep`/`MoPlan`/`moViewOf`/`MO_RULES`…）。`Units.kt` 落在**新包** `data/units`，无冲突。

**两个引擎的三条移植差异**（都写进了 KDoc）
1. web `Math.random()` ⇒ Kotlin **注入 `Random`（默认 `Random.Default`）**，否则单测无法复现；
2. ★ **`rnd(min,max)` 跨度 ≤ 0 时 JS 返回 `min`、Kotlin `nextInt` 会抛** ⇒ 自建 `unitRndInclusive` / `moRndInclusive`（各配一条单测）；
3. ★ units 里 **web 的 `number` 是双精度** ⇒ Kotlin **一律显式 `Double`**，**严禁 Int**（`1毫米→厘米` 会静默截断成 0）。

**单测 54 例（新增 2 类）**：`UnitsTest` **23 例**、`MulOneTest` **31 例**；期望值全部由 `npx tsx` 跑
**web 真实现**打印（`web/_mo_units_expect.ts`，用完即删），**不是**自己推导。关键护栏：
units 的**守恒断言**（每轮 `count × pieceBase === value × from.base`，≥200 样本）+ 两条独立换算路径**全量对拍**（基准单位法 vs 沿链逐级法）；
mulOne 的**四裁判对拍**（`value*factor` / 展开法 / 轨迹拼回 / 逐步累加）+ ★**时间轴合法性**（`add`/`carry` 只在真进/真写时出现、
`place` 单调不减、每位必以 MUL 开头且有 WRITE）+ ★**高亮永远指向存在的格子**（`hl.write` 指向的 `resultCells[i]` 必须非 null
—— 发在空气上的高亮，截图根本看不出来）。

★ **本轮踩到并修掉的 4 条「测试期望值」错误**（**引擎全对**，是我手算 / 想当然写错的）
1. `280 × 3` 的最长进位连段：手算写 0，实为 **1**（十位 `8×3=24` 进 2 ⇒ 那一位自成一个连段）；
2. `38 × 3` 的「积新长出来那一格」：写成 `resultCells[3]`，但 `cols = max(digits.size, resultDigits.size) = 3` ⇒ 下标只到 2，改 `resultCells.last()`；
3. ★ **别把「乘除方向搞反的错答必须进选项」当成设计约束** —— web 第三步的干扰项来自 {加错值、按错进率算}，
   **方向错答是单独放在 `p.trap` 里、等学生做完再点破的**（实测 `90厘米=?分米`：选项 `[9, 100]`，`flipped = 900` 不在其中）。
   已把测试改成「进选项**或**落在 `trap`」，并把引擎里那条**误导性注释**（"方向用错"）改正；
4. units 的 `onScreenReal` 只有 **毫米/厘米/分米** 三个为 true（`1米 ≈ 3779 px` 放不下），我原先多写了「米」。

**Screen 侧的 4 条有意差异**（非遗漏）
- ★ **真实尺寸**：web 靠 CSS `1in = 96px` + 量一个 10mm 探针；Android **没有 DOM** ⇒ 改用 `DisplayMetrics.xdpi`
  （**物理**每英寸像素）**÷ `density.density`** 得 dp/毫米，并**保留 web 那条「拿真尺子校准」的滑块**
  （倍率存 SharedPreferences `aiphonix_units` / key `uc_calib`）。逐机型 `xdpi` 可能报不准，所以校准滑块是**必需**而非可选。
- **米尺横向滚动**：真实 10 厘米 ≈ 610dp，比手机屏宽 ⇒ 套 `horizontalScroll`，**绝不缩放**
  （缩放就不是真实大小，整段量感教学的前提就没了）。同理 `分米` 的真实条在手机上多数装不下 ⇒ 走 web 同款「**不画**、改去指上面那把米尺」文案。
- **>100 格改 Canvas**：`1米→毫米` 要摆 1000 个格子，1000 个 Compose 元素 + 逐格动画会明显掉帧 ⇒
  `≤100` 用 Compose 格子（保留逐格「扫出来」），`>100` 用 Canvas 一次画完、用同一个 0→1 进度扫过。
- 点阵改成**每行固定 10 个**（十格框），一眼看出「满十成捆」—— web 是 flex-wrap，行宽随容器变，数捆反而费劲。

**接线四处**：`NavigationKeys`（`MathUnits` / `MathMulOne`）、`Navigation.kt`（import + `entry<>` + 首页两个回调）、
`HomeScreen.kt`（两个 `ToolCard`，顺序与 web 首页一致：综合算式 → 等式变变变 → **长度与质量单位** → **多位数乘一位数**）。
**未改 `AppContainer`**（两页都不需要注入依赖；校准值由 Screen 自己读写 SharedPreferences —— 这也符合「VM 不持 Context」）。

**门禁**：`export JAVA_HOME="C:/Program Files/Java/jdk-21.0.11"` → `:app:compileDebugKotlin` ✅ →
`:app:testDebugUnitTest` + `:app:assembleDebug` ✅ —— **526 用例 / 37 类 / 0 失败**（基线 472/35，正好 **+54 例 / +2 类**），
APK ≈35.8MB。★ 本机**无设备/模拟器** ⇒ 止于「构建通过 + 单测绿」，
**实机观感（真实尺寸量得准不准、点阵挤不挤、竖式高亮跟不跟得上）由用户补验**。

### 拍照 OCR 自动填入（设置面板自动填入｜2026-09-22 收官后新增）

三处设置面板移植 web 的「拍照 OCR 自动填入」：每日语文（**多图框选 + 拼音清洗**）、每日英语（**单图整页**）、AI 英语对话（**整页识词抽句 → 勾选导入**）。AI 对话学语文**故意不做**（web `SpeechComposePage` 本就无 OCR）。

**架构要点（AGENTS.md 分层）**：
- `OcrPlatform` 是**唯一持 `Context`** 的类（读 URI 字节 / EXIF 转正 / 缩图 / 裁剪）；VM 侧 `ocrPlatform` / `ocrRepository` / `ocrEngineStore` 全**可空**，为 null 时**静默降级**（单测不传）。
- 识别统一走 `AiChineseRepository.parseImage(bytes, mode, engine, forceRefresh)`（`/api/v1/ai-chinese/parse-image`）；整页识词用 `mode="english"`。缓存键把 `mode`+`engine` 算进 sha256。
- ★ **规范图统一坐标系**：`OcrPlatform.canonicalize()` 生成一张「EXIF 转正 + 自动裁白边 + 最长边 ≤1600 + JPEG 85」的图，**显示、文字行检测（吸附）、裁剪三件套全部基于同一张** ⇒ 坐标天然自洽，位图只解码一次（否则「检测用原图归一化坐标、显示用转正位图」会整页偏移）。
- `OcrPickSession` / `EnVocabPhotoSession` 是**可复用会话状态机**（三处面板共用），业务侧的「导入到哪个字段 / 多图队列 / 落盘同步」留在各自 VM。

**文件清单（都在 `app/`）**：
- `util/StripPinyin.kt`（`stripPinyin` / `stripPinyinKeepDelimiters`）+ 3 单测。
- `data/ocr/`：`OcrModels.kt`（枚举/状态）、`OcrBoxLogic.kt`（框选几何纯函数，**18 单测**）、`OcrEngineStore.kt`（引擎 SharedPreferences，key 沿用 web `aiphonix_ocr_engine`）、`OcrPlatform.kt`（唯一持 Context）。
- `ui/ocr/`：`OcrPickSession.kt` + `OcrPickSheet.kt`（框选）、`EnVocabPhotoSession.kt` + `EnVocabPhotoSheet.kt`（整页识词）、`OcrImportButtons.kt`（共享件：`OcrEnginePicker` / `OcrSmallButton` / `OcrIconChip` / `clickableNoRipple`）。
- `data/envocab/EnVocabExtract.kt`（整页文本抽词句纯函数，**单测全绿**）。
- VM：`DailyChineseViewModel` / `DailyEnglishViewModel` / `EnglishTalkViewModel`；Screen：`DailyChineseScreen` / `DailyEnglishScreen` / `EnglishTalkScreen`；`Navigation.kt` 三处补 `ocrRepository`/`ocrPlatform`/`ocrEngineStore`。

**★ 移植时钉死的 web 反直觉行为（单测已锁，别"顺手修好"）**：
- **两套不同的尺寸门槛**：画新框 `w > 8 && h > 8`（**严格**大于）；调整已有框 `w >= 8 && h >= 8`（**大于等于**）；吸附门槛又是第三套 `w > 2 && h > 2`。
- **吸附** `intersectRatio > 0.35`（**严格**）才吸附，且按文字行顺序**首个胜出**（不是取最大）。命中把手 = 半径 18 的圆；命中框内用 `pad=6` 窄带排除；遍历**从后往前**。
- ★ web `DailyChinesePage.joinOcrTexts` 有**真 bug**：源码写成 `t.split(/\\s+/)` 与 `join("\\n")` 是**字面双反斜杠**（`od -c` 核实字节是 `\ \s`、`\ \n`），多图导入词/句会插入字面 `\n`。**Android 按意图实现**（真 JS 空白集切分 + 真换行）。
- `EnVocabExtract` 的 `object` 初始化顺序陷阱：`STOP_WORDS` 用到 `WS` 正则常量 ⇒ **`WS` 等正则常量必须声明在 `STOP_WORDS` 之前**，否则运行期 NPE（首版就栽在这）。
- **`clickableNoRipple` 必须是包级 `internal`**：同包多个文件各写 `private fun Modifier.clickableNoRipple` 会与包级版**重名冲突**（`Conflicting overloads`）。抽到 `OcrImportButtons.kt` 包级一处即可。
- ★ 相机走 `ActivityResultContracts.TakePicture` + `OcrPlatform.newCameraFile()`（FileProvider 要求的 `cache/import_photos/ocr_photo_<ts>.jpg`）；相册每日语文走 `GetMultipleContents("image/*")`（可多选）、每日英语/AI 英语对话走 `GetContent("image/*")`（单张）。
- 删除按钮 Android 适配：web 把 ✕ 放框外（`right:-10`），Compose 超出父边界收不到手势 ⇒ 就地贴框内右上角并左移让开 `ne` 把手。

### 批次B 顺手修掉的真实 bug（生产影响，重要）
- ✅ **`type` vs `type_` 参数名不一致 ⇒ 过滤曾被静默忽略（已全链路闭环，2026-09-22 复核）**：服务端 `char_images.ts`（`server_cf` 与 `server_ts`）读的是 `c.req.query("type")`。生产实测：`type=认` → **816** 条，`type_=认` → **3028** 条（全量）；`三年级上&type=认` → **173**。Android 侧已修（`CharImageViewModel` 两处 `type_=` → `type=`，带 ⚠️ 注释）；**web 侧也已生效**——`web/src/services/charImages.ts` 实际一直是 `qs.set("type", params.type_)`（自 `64c6899` 入库起即如此，此前「web 侧未修」是过时记录），且修复已随 `index-PBqBgbjv.js` 构建上线（线上 charImages chunk 与本地 dist 字节一致、生产 entry 哈希相同）。
- **web `CharMapPage.TYPE_LABEL` 是过期词表**：写的是 `字/词/句`，但生产 3028 条实测分布是 **认 816 / 写 748 / 词 729 / 英词 533 / 英句 202** ⇒ 与 Android `CharImageList.type_` 词表**完全一致**，汉字地图可**直接透传 `type`、无需映射**。Android 的 `TYPE_LABEL` 已按真实数据定为 `认→识字表 / 写→写字表 / 词→词语表 / 英词→英语词汇表 / 英句→英语句子表`。

### 关键坑（避免重走）
0. **★ 写工具函数前先 `grep -rn "fun xxx"`**：本项目同一逻辑常有 2–3 份实现。本轮我新写的 `util/PinyinText.kt`（`normalizePinyin` + `TONE_CHAR_MAP`）其实 `data/chinesepractice/PinyinPart.kt` **早已有同名同逻辑**，`data/userimport/ImportProcessor.kt` 还有第三份；最终删掉我的重复份、改 `import ...chinesepractice.normalizePinyin` 复用。**构建警告会暴露这类死代码**（`Warning: 'normalizePinyin' is never used`）—— 别只顾着消警告，先想「是不是已有实现」。
0b. **★ 单测期望值必须取自「另一个真实实现」**：Android 的 `toBaiduSyllable` / `highlightJoyText` 的单测期望值，是用 `npx tsx` 跑 **web 真实实现**（`web/src/lib/ttsPinyin.ts`、`web/src/services/joy.ts`）逐项打印出来的，**不要自己推导**（否则等于自己实现自己验）。详见 `app/src/test/.../data/tts/BaiduSyllableTest.kt`、`data/joy/JoyHighlightTest.kt`（各 7 用例，全绿）。
0c. **写探测/冒烟脚本落 `.mjs` 文件再跑**：bash 内联 `node -e "...中文..."` 会被 shell 吃引号（报 `SyntaxError: missing ) after argument list`，输出里还会出现 `./ _` 这类诡异内容，看着像命令被执行）。落文件 + 命令行传参才可靠。
0d. **bash 里的 `/tmp` 是 `C:\tmp`**（MSYS 挂载语义），Node **读不到**；临时文件写 `C:/Users/lhl20/AppData/Local/Temp/`。
0e. **★ JS 的 `\s` ≠ Kotlin 的 `\s`**：JS 含 `\u00A0 \u1680 \u2000-\u200A \u2028 \u2029 \u202F \u205F \u3000 \uFEFF`，Kotlin 默认只认 `[ \t\n\x0B\f\r]`。中文输入法极易打**全角空格 U+3000**、粘贴文本常带 **NBSP / BOM** ⇒ 照抄 `\s` 会**少切一刀**（实测 web `splitText("日\u3000月")` → `["日","月"]`）。且 **Kotlin `trim()` 不认 U+FEFF**（JS 的 `trim()` 认），要 `trim { it.isWhitespace() || it == '\uFEFF' }`。见 `data/dailyzh/DailyTextSplit.kt`。
0f. **★ 别在 KDoc 注释里写正则或路径通配符**：Kotlin 的块注释**可以嵌套** ⇒ **`/*` 和 `*/` 都会出事**：
   - 注释里写 `/\n+|(?<=[。；;])\s*/`：其中的 `*/` **提前结束**注释块，后面全被当顶层声明 ⇒ **30+ 个 `Syntax error: Expecting a top level declaration`**。
   - 注释里写 `` `/llm/*` 系列端点 ``：其中的 **`/*` 开启嵌套注释**，把外层 `*/` 吃掉 ⇒ 错误报在**文件末尾**（`Syntax error: Unclosed comment.`），而且**同包其它文件全部**跟着报 `Unresolved reference`（一个"找不到的 object"看起来像包名写错，极具误导性）。
   - ★ 本轮又踩镜像面：注释里写 web 的正则字面量 `` `/[A-Za-z]+(?:['’][A-Za-z]+)*/g` `` —— 末尾 **`*/g` 里的 `*/` 提前结束**注释块，`g` 后的反引号变成顶层声明 ⇒ **30+ 条 `Syntax error: Expecting a top level declaration`**（报在文件末尾附近，同样误导）。自查：`grep -n "\*/g|[A-Za-z0-9_\)\]]\*/"` 扫全仓。
   规避：注释里用中文描述正则；路径写 `/llm/` 前缀而**不要**写 `/llm/*`；通配符一律用文字描述（本轮又踩：能力映射表里写 `accept=video/*` 与 `OpenDocument(["video/*"])` ⇒ 报在 `SubtitleCaptureScreen.kt` **文件末尾** `Unclosed comment.` + 同包 `Navigation.kt` 两处 `Unresolved reference`）。
0g. **往已有 composable 加回调参数，别忘了私有子 composable**：课件库入口加在家长设置的「内容管理」段，而那段实际在**私有 `PlanEditor`** 里 ⇒ 只改公开签名会 `Unresolved reference`，必须**同时给 `PlanEditor` 加同名参数并透传**。
0h. **★ 同名的「英文词正则」在本项目有两份、行为不同，别互换**：`util/EnText.splitEnWords`（移植 web `AiEnglishTalkPage`，**连字符不在字符类内** ⇒ `well-known` 切成两词；数字与非 ASCII 字母也会切开）vs `data/wordbook/WordbookAutoCollector`（**允许连字符**、整串匹配）。移植时**照抄来源那一份**，不要"顺手统一"。
0i. **★ `/asr/short` 的 422 不是错误**：`raw.length < 1600`（音频太短）或百度无识别结果都返回 **422** ⇒ 语义等于「没听到话」，应归一成 `Result.success("")`，与「请求失败（网络/500）」分开处理。另：该端点**无鉴权**。
0j. **★ Kotlin 局部函数不能前向引用（移植 JS 递归下降求值器必踩）**：`parseFactor` 要回调 `parseExpr`，而 `parseExpr` 又要用 `parseTerm` —— JS 靠**函数声明提升**没事，Kotlin 直接 `Unresolved reference 'parseExpr'`（报在调用那一行，看半天像拼错名）。修法：把最外层那个函数换成 **`lateinit var parseExpr: () -> Int`** 的 lambda 承接，其余保持 `fun`（顺序：parseFactor → parseTerm → parseExpr）。本轮在 `CompoundExpr.evalTokens` / `Precedence.evalExpr` / 单测裁判里**各踩一次**。
0k. **★ JS 的 `rnd(min,max)` 与 Kotlin `nextInt(min,max)` 语义不同**：JS 是 `min + floor(random*(max-min+1))`，跨度 ≤ 0 时 **返回 min 不报错**；Kotlin `nextInt(2, 1)` **抛 IllegalArgumentException**。生成器里真存在 `rnd(2, r-1)`（r 很小时）⇒ 必须写 `rndInclusive()` 复刻（跨度 ≤ 0 返回 min），否则随机出题会**间歇性崩溃**（而且只在特定 r 值下出现，极难复现）。
0l. **★ JS 除法出小数、Kotlin Int 除法截断** ⇒ 移植「整数性筛选」不能照抄 `Number.isInteger`：`3/2` 在 JS 是 1.5（会被筛掉），在 Kotlin 是 1（**静默截断，筛不掉**）。web `precedence.test.ts` 里随机造题的精筛必须改写成「每一步的除法都整除」的显式判断（见 `PrecedenceTest.randTokens`）。
0m. **★ Compose 侧的四条硬约束（本轮集中踩）**：① `Modifier` 扩展里**不能用 `remember`** ⇒ 要写成 `@Composable fun Modifier.xxx()`；② **不要自己定义 `Modifier.clickable(onClick)`** —— 会与 `androidx.compose.foundation.clickable` 同名扩展**歧义**；③ `fontSize = 22f` 是 Float 不是 `TextUnit`（要 `22.sp`），误用会报一长串「None of the following candidates is applicable」；④ `boundsInRoot()` 与 `clip()` 需要**显式 import**（`androidx.compose.ui.layout.boundsInRoot` / `androidx.compose.ui.draw.clip`）。
0n. **★ `onGloballyPositioned` 给的是绝对（root）坐标**：多容器页面必须**只减自己的基准容器**。把「stage 内的元素」和「resultBox 内的元素」都去减 stage 会得到完全错误的偏移（resultBox 根本不在 stage 里，只是同屏）。本轮统一成 `CeGeom.relTo(anchor, key)` 一种写法后消除。
0o. **web 源码里 `4 × (14 + 7)` 的「63 巧合题」注释是误读**：带括号 `4×21 = 84`，去括号 `4×14+7 = 63` —— 两者**不等**，它恰恰是**合格**题；原文把「去括号后的值」当成了「两种写法同值」。照它写单测断言（`eq(63, …)`）必然失败。⚠️ 另注：合并分步算式这个题型在数学上（含 Int 截断）**几乎不可能产生真正的巧合题**，`isCoincidental` 是纯防御。
0p. **Compose 里做「先渲染一帧，再打开过渡」用 `withFrameNanos { }`**（对应 web 的双 `requestAnimationFrame`）：`joined` 先置 false 渲染一帧、再置 true，宽度过渡才会动。
0q. **★ JVM 的 `java.net.URL` 比 JS 的 WHATWG `URL` 宽松 ⇒ 移植「从 URL 取影片名」必须改用 `java.net.URI`**：`new URL("https://not a url at all with spaces")` 在 JS **抛错**（走截断兜底），`java.net.URL` 会把整串当主机名**静默吃掉**。改用 `URI`（遇空格直接抛）+ `host` 非空校验 + `lowercase()`（对齐 JS `hostname` 转小写）。见 `data/subtitlecapture/SubtitleCaptureLogic.movieNameFromUrl`。★ 这类「标准库宽严不同」只有**拿 web 真实现跑期望值**才能发现（坑 0b 的价值）。
0r. **★ Compose 两个低频 import/作用域陷阱**：① `Modifier.offset` 要**显式** `import androidx.compose.foundation.layout.offset`（`padding` 在 `unit` 包且常用所以不缺，`offset` 不在）；② `Modifier.align` **只在 `BoxScope` 里可用** ⇒ 需要 `align` 的私有 composable 要写成 **`private fun BoxScope.XXX()`**，写成普通 `Modifier` 扩展会报 `Unresolved reference 'align'`。
0s. **★ `pointerInput` 的 key 绝不能带「每帧变化的值」**：`pointerInput(rect)` 会在拖拽过程中因 `rect` 更新而**重启手势检测器**，表现为「拖一下就断」。按键一律用固定字符串（`"new-box"` / `"move-box"` / 手柄名 / `mark.ts`）；需要读可变值就用 `rememberUpdatedState`。另：**Compose 里超出父边界的子元素收不到手势** ⇒ web 那套「圆点负偏移压住框线」的八向手柄不能照搬，要就地贴边放到框内。
0t. **★ SAF 影片 URI 必须 `takePersistableUriPermission`**：`OpenDocument` 默认只给「当次」授权、**不持久化** ⇒ 重启后 URI 失效、播放器**静默播不出来**（不报错，最难查）。拿到 URI 后立刻 `contentResolver.takePersistableUriPermission(uri, FLAG_GRANT_READ_URI_PERMISSION)`（web 对应物是 IndexedDB 存 Blob，无此问题）。
0u. **★ 跨端「日期 / 数字」的隐蔽差异（家长周报集中踩，全是静默错数）**：
   - **web 同一页面里可能并存两套日期口径**：`getFullYear/getMonth/getDate` 拼出的 key 是**本地**日期，而 `created_at` 前 10 字符是 **UTC** 日期；`toISOString()` 又**恒为 UTC**。移植时**不要统一**，照抄并用单测钉住（实测：UTC+8 上本地 00:00–08:00 的记录会归到前一天列）。
   - **`JS toLocaleString("zh-CN")` = `2026/9/22 16:46:44`**（月/日**不补零**、时/分/秒补零）⇒ Kotlin 用 `SimpleDateFormat("yyyy/M/d HH:mm:ss", Locale.CHINA)`，不是 `"yyyy/MM/dd"`。
   - **数字→字符串**：Kotlin `Float.toString()` 把 `85f` 打成 `"85.0"`，JS 是 `"85"` ⇒ 用 `util/jsNumber()`。数据库里的 `real` 列（如 `suggested_score`）真会带小数，两端显示必须过它。
   - **`\s` 一律用 `util/removeJsWhitespace()` / `splitJsWhitespace()`**（见 0e），别用 Kotlin 的 `\s`。
13. **给 data class 加字段用「带默认值」= 非破坏性扩展**（`WordScore.phoneInfos`、`PhonemeScore.rawAccuracy/matchTag` 都是）——既有构造点零改动。★ 但**别信被 clamp 过的字段**：`PhonemeScore.score` 是 `coerceIn(0,100)`，漏读的 `-1` 变成 `0`，分不清「0 分」与「未读」⇒ 要额外存原始值。
14. **UI 里按「被测文本」而不是「卡片外层 key」取评测结果**：单词卡会给同卡片内的**例句**也做评测，若例句行去取 `outcomes[word]` 就会显示成单词的分数（我第一版就写错了）。`soeOutcomes` 的 key 一律是实际送进 SOE 的那段文本。
15. **★ 项目里有「四套」切句口径，互不等价、不可互换**：① `data/zhteach/PoemSplit`（古诗：按 `，。！？；：` 断、标点归前句、换行丢弃 —— 因为古诗的「，」是**句内**停顿，要当一行跟读）；② `data/zhteach/ArticleSplit`（文章：按句末标点 `。！？!?；;…` 断，**吸收紧跟的收尾引号**最多 4 个，换行强制断句）；③ `data/dailyzh/DailyTextSplit.sentences`（只按 `；;\n` 断）；④ **`web/src/lib/readUnit.ts`**（**识别页**用，按**段落**切、认英文句点、有缩略语表 `mr/dr/st/…` 与「单字母 + `.`」跳过；Android 未移植）。★ 另有两处反直觉行为已用单测钉住：连续句末标点**各自成句**（`"只有标点。。。"` → `["只有标点。","。","。"]`）；`mergeShorts` 文本没命中时**回退下标**，会让句子拿到别的句子的缩写。
16. **★ 「异步播表扬语 + 立刻进下一步」会被忙碌锁挡掉**：`onEchoPassed()` 里 `enterPoemVerse(i+1)` 的第一步是领读，而领读会判 `ttsBusy` —— 若表扬语是用「异步即发」的方式播的，`ttsBusy` 还是 true ⇒ **下一步静默不朗读**。必须把「播完表扬 → 再进下一步」写成**同一个协程块串行**（web 的 `EchoLadder` 天然如此：播完才回调 `onFinished`）。
17. **★ `BaiduTtsCache` 是 `class`（需 `Context` 构造），不是 `object`**：`play` / `playRemote` / `playRemoteAndWait` 都是**实例方法**（写成 `BaiduTtsCache.play(...)` 会报 `Unresolved reference 'play'`）；只有 `stopAll()` / `splitForTts()` / `SPEAKER_US` / `SPEAKER_UK` 在 `companion object` 里是静态。VM 里要用就**从 `AppContainer.ttsCache` 注入**（见第 20 条）。
18. **`PronunciationResult.feedback` 是 `String?`**（`totalScore` 才是 `Int`）⇒ 塞进非空字段要 `.orEmpty()`。
19. **`/llm/zh-teach-setup` 的失败是 422 + `{detail}`**（服务端 `generateWithGuard` 4 次自检不过），而 `zh-teach-judge` 失败是 500 —— **都要把 `detail` 原样显示给用户**（`ZhTeachHttp` 已统一提取）。
20. **VM 不该持有 `Context`**（`AGENTS.md`）⇒ 需要 `Context` 的 TTS 由 `AppContainer.ttsCache` 持有、构造注入；VM 侧参数做成 `BaiduTtsCache? = null`，为 null 时**静默降级为不朗读**（其余功能不受影响，单测也不必造 Context）。
1. **`TtsEngine` 只适合英语**（系统 TTS 用 Locale.US/UK，回退百度 speaker 106/5118）。中文朗读一律用 `BaiduTtsCache.play(text, "0")`。
2. **`/soe/records` 查询无鉴权**，必须显式传 `user_id`，否则返回**全站**记录。
3. **`AiHistoryStore` 只存 `AiHistoryTurn`**（data 层），UI 层的 `AiEnglishTurn` 需先转换（`AiHistoryTurn(role, content)`），别直接塞。
4. 拼音表数据**不要手改** `PinyinTableData.kt`；改数据请改 web 的 `pinyinTable.ts` 后重新生成。
5. 生成脚本用 Node 时注意：TS 有类型标注（`export const X: PinyinItem[] = [`），按 `=` 后再找 `[` 做括号匹配，别匹配到 `PinyinItem[]` 的空括号（**偏旁字族脚本同样踩这个坑**）。
6. **`char-images` 的 query 参数名是 `type`（不是 `type_`）**，传 `type_` 会被服务端**静默忽略**并返回全量（详见「批次B 顺手修掉的真实 bug」）。web/Android 两端均已用 `type` 且已上线。
7. **`/char-images/feedback` 的唯一键含 (grade, semester, type)**：同一个字跨年级/类型存**多行**，服务端按 `timestamp` **倒序**返回 ⇒ **首次见到即为最新**。Android 按意图取最新；web 是「倒序遍历后写覆盖」= 取**最旧**（笔误）。这是**有意保留的差异**，别去「对齐」web。
8. **单字音频 `/tts/char/:char?synthesize=1&pinyin=hao3`** 需鉴权（`requireAuth()`），且 `pinyin` 必须是**数字调**格式（服务端 `SYLLABLE_RE = /^[a-z]{1,6}[1-5]$/`）。百度 TTS 对「字（无声调）」会把拼音字母当字面内容念出来 ⇒ 拿不到声调时 `toBaiduSyllable` **返回 `""` 宁可不注音**，绝不返回 `"zhong"` 这种半成品（偏旁字族里 3/117 个轻声字如 `ma`/`ba`/`men` 就属此类）。
9. **`BaiduTtsCache.stopAll()` 兼作「停止」与「释放 activePlayer」**：`playRemote` 前调一次即可实现「新读音打断旧读音」；但它**没有完成回调**，需要清 UI 高亮时得自己 `delay(≈1800)` 兜底。
9b. **★ `BaiduTtsCache` 曾有一个「全 App 朗读永久静默」的全局 bug（本轮已修）**：`playLock` 是 `companion object` 里的**静态** `AtomicBoolean`；`play()` 开头 `if (!playLock.compareAndSet(false, true)) return false`（**拒绝而非排队**），`finally { playLock.set(false) }`。但 `MediaPlayer.stop()` / `release()` **不会触发** `onCompletion` / `onError` ⇒ `stopAll()` 期间挂起的 `suspendCancellableCoroutine` **永不返回** ⇒ `finally` 永不执行 ⇒ 锁永久为 true ⇒ **之后所有朗读全部静默返回 false**。修复：新增 `@Volatile private var activeFinish: (() -> Unit)?`，`playFile` / `playRemoteAndWait` 挂起时注册 `finish(false)`，`stopAll()` 主动调用它解开挂起，并用 `clearActive(mp)` 统一清理。★ 另修 `playRemote` **直接覆盖 `activePlayer`（不先 `stopAll`）** ⇒ 被覆盖的 `MediaPlayer` 既不停也不释放（漏音 + 泄漏），已改为**先 `stopAll()` 再 new`。
9c. **★ 新加一条 suspend 等待前，先确认「谁负责唤醒它」**：上面那个 bug 的成因就是「等一个只由 `MediaPlayer` 回调唤醒的 `suspendCancellableCoroutine`，而 `stopAll()` 会把 `MediaPlayer` 直接掐掉」。凡是「注册回调 + 挂起等待」的写法，都要**同时**保证「异常/中断路径也会唤醒」。
10. **Compose `items(count, key)` 的 key 必须全局唯一**：汉字地图有多年级重复字 ⇒ 用 `"${g.key}#$idx#${cell.char}"`。
11. **共享 OkHttp `NetworkModule.httpClient` 的 readTimeout 已是 180s**，LLM 的 40s/90s 调用**直接用共享 client**，不必再 `createHttpClient` 派生。
12. `scripts/` 在 `.gitignore` 里（「# Temp scripts → scripts/」）⇒ **新写的生成脚本不会被提交**（已跟踪的老脚本仍在库里）。生成物 `.kt` 必须提交，且文档要写清生成脚本路径。

### 剩余（批次C后半 最后 1 模块 + 2 待核对）
- **字幕采集**（`/module/subtitle_capture`，视频帧框选 + 区域 OCR，预计一整轮）。
  ⚠️ 已确认：剩余模块**不轻量** —— `SubtitleCapture` 要视频帧选取 + 区域框选 + OCR（本轮已分别消化 `MathCompoundExprPage` 889 行、`SpeechComposePage` 1037 行、`AiEnglishTalkPage` 993 行）。
- 2 项待核对：家长报告完整度、注册页是否已含在登录页。
- ⚠️ **字幕采集是「每日语文 / 每日英语设置面板的拍照 OCR 自动填入」的前置依赖** —— 那两个面板的 📷/🖼️ 按钮在 Android 右侧目前是缺的（有意留白，见 `DailyChineseScreen` / `DailyEnglishScreen` 的 KDoc）。
- ⚠️ 待办（不属于 app 范围）：修 `web/src/services/charImages.ts` 的 `type_` → `type`，需单独一次 web 构建 + 部署。

---

---

## 0.4 🈶 2026-09-14 英语识别不再删字母 + 数学算式独占一行

### 英语「字母都没了」（生产 server_cf）
- **根因**：英语页复用语文通道 `/api/v1/ai-chinese/parse-image?mode=english`，但豆包识别用的仍是**小学语文专用提示词**（`DOUBAO_OCR_JSON_PROMPT` / `DOUBAO_OCR_PROMPT` + system「小学语文识别排版器」）。语文提示词反复强调「汉字/拼音字母/声调」，豆包于是把英语单词当拼音/非目标内容处理 → 课文里字母被删。
- **修复**：新增英语专用提示词 `DOUBAO_OCR_PROMPT_EN` / `DOUBAO_OCR_JSON_PROMPT_EN` / `DEEPSEEK_RELAYOUT_PROMPT_EN`（核心：这是英语课文、原样保留每个英文单词、禁止当拼音/省略/合并/翻译）；`arkExtractBlocks` / `arkExtractBlocksTwoPass` 加 `isEnglish` 参数，按 mode 选提示词与 `system_prompt`；流式纯文本路径（`chatStream`）同样按 mode 选。
- **server_ts 同步**：本地后端 `ai-chinese/parse-image` **原本完全不认 `mode` 参数**（英语按语文跑），已补 `mode` 解析 + `isEnglish` 贯通 + 英语提示词；缓存 key 加 `_en` 后缀（`parse_<hash>_en.json`）避免中英互串。
- ⚠️ 结论：**英语不是「不能去拼音」，而是不能用语文提示词**。`stripPrintedPinyin` 那条"删所有 [A-Za-z]"的规则本身没被英语触发（各路径 `stripPinyin: mode !== "english"` 都正确），别再去改它。
- ⚠️ **必须换缓存 key**：英语缓存键原本就是 `parse_<hash>_en_r4.json`，里面存的是旧提示词产出的「被删字母」脏结果。这种脏是**提示词层面**造成的，读取路径再怎么清洗也救不回 → 英语 key 升为 `_en_r5`（`parse_<hash>_en_r5.json`）强制重识别；**中文 key 保持 `_r4` 不动**，避免全量重识别。两处路由（非流式 + 流式）都要改。
- **顺带修掉另一处「语文规则漏到英语」**：英语结果页的「📥 整块加入生词本」原本只收汉字（点英语块必弹「该块没有可收录的汉字」）。`handleAddBlockWords` 改为按模块分流——英语按整词 `[A-Za-z]+(?:['’-][A-Za-z]+)*` 收录，语文/数学仍按汉字；按钮 title/aria 同步。
- ✅ **用户已确认生效**（部署 + 手机硬刷新后，英语识别不再掉字母）。
- 📌 排查结论（避免后人重复劳动）：**当前源码里英语路径不存在任何"删字母"的地方**。`stripPrintedPinyin`（`ASCII_LETTER_RUN_RE = /[A-Za-z]+/g`）与前端 `stripPinyin` 都被 `mode !== "english"` 正确挡住，前端 `OcrPickSheet` 也有 `if (!wantStrip) return s` 兜底；Paddle 链路（`paddleOcrExtract` → `markdownToBlocks`）和 `cleanOcrText`/`dedupeLines`/`fixMojibake` 都不删字母。**真正的"语文规则"是提示词**，别再往正则方向找。

### 数学「算式跟在题目后面」（纯前端）
- **根因**：数学 OCR 按【逐行保真】已把算式输出成独立物理行，是前端 `reflowText`（`web/src/lib/paragraphFlow.ts`）把非空行当续行并回了上一段。
- **修复**：`reflowText(raw, { breakOnFormula })` 新增选项，新增导出 `isMathFormulaLine()`（不含**纯汉字**且含运算符/等号；纯数字行不算，避免拆散竖式；用纯汉字范围避免 `12+35=（ ）` 被全角括号误判）；`AiParseResultPage.renderMixedText` 加第 4 参数 `breakOnFormula`，仅数学两处调用传 `true`。语文/英语不传 → 行为零变化。
- 测试：`web` 新增 4 个 reflowText 用例（`npx tsx --test src/lib/paragraphFlow.test.ts` → 35/35 通过）。

### 英语「标题和正文挤在一行」（纯前端）
- **根因**：英语结果页渲染 `questions`（扁平文本），而 `questions` 来自 `text`——Paddle 路径在 `paddleOcr.ts` 里做了 `cleanedMd.replace(/\n{2,}/g, "\n")`，**空行（段落边界）被压掉**；`reflowText` 又把所有非空行当续行并回上一段 → 整页（含标题）并成一行。结构化 `blocks`（带 `title/heading/body` 类型）明明在作用域里，但英语分支没用它。
- **修复**：`reflowText` 新增两个英语选项并在英语渲染处开启（`EnglishResult.textParas`）：
  - `breakOnSentence`：上一行以句末标点结尾（英文课本「一句一行」）→ 本行另起一段；
  - `breakBeforeTitle`：标题样行独占一段，且**标题后必须另起段**（`prevCloses`）。
  标题判据刻意做成「以大写/数字开头 + ≤28 字符 + **整行不含任何标点**」：正文折行几乎总含标点（`My name is Tom. I am`）故不误判，而 `Unit 3 My Family` / `Story time` / `Let's learn` 无标点故命中。
  ⚠️ **不要**用「下一行是否小写开头」排除折行——`Let's learn` 后面跟的正是小写单词表（`doctor teacher`），那样会把真标题误判成折行。
- 效果：`Unit 3 My Family` / 每个句子 / `Let's learn` + 单词表 各自独立成行；正文折行仍并回同一段。
- 测试：新增 6 个英语用例（`paragraphFlow.test.ts` 共 **42/42 通过**）。
- 缓存无关：纯渲染期处理，**已识别的历史/缓存结果刷新即生效，无需重新识别**。

### OCR 提示词加固：段落/版面约束（参考"豆包版面理解"资料）
- **适用性判断（重要，别照搬）**：资料里的 `parse_mode: detail`、返回 bounding box 属于火山**文档解析产品线**；我们走的是方舟 **chat/completions 视觉对话**（`ark.ts` 的 body 只有 `model`/`messages`/`max_tokens`/`thinking:{type:"disabled"}`），**没有该参数、也不返回 bbox**（`arkExtractBlocks` 的 pageBounds 恒 null）。能用的只有**提示词约束**这一层。
- **已落地**：6 个提示词补【版面结构（重要）】——
  - JSON 类（`DOUBAO_OCR_JSON_PROMPT` / `_NO_POLY` / `_EN`）：每个自然段单独一个 body 块，禁止多段并进同一块；标题各自成块；禁止改写/润色/总结/简化/翻译、禁止调整语序；
  - 纯文本类（`DOUBAO_OCR_PROMPT` + `_EN`）：段间空一行、标题独占一行、禁止标题与正文并一行；
  - `MATH_OCR_PROMPT`：题目与算式分行，算式另起一行。
  server_cf + server_ts 已同步。
- ⚠️ **豆包提示词只对豆包路径生效**：生产 `OCR_ENGINE=paddle`，Paddle 常抢跑胜出，而 **Paddle 是专用 OCR 模型、不吃提示词** → 这批改动主要改善豆包兜底/回退链路。
- ⚠️ **已知残留（两处，别误判成"改了没用"）**：
  ① `paddleOcrExtract` 的 `cleanedMd.replace(/\n{2,}/g, "\n")` 会压掉 `text` 的段落空行（`blocks` 不受影响，结构仍在）。**没改它**是因为 `splitQuestions` 里「空行分隔」分支优先级**高于**「行首题号」，加空行会让**数学改按空行分题**（回归风险）。
  ② 英语结果页渲染的是扁平 `questions` 而非结构化 `blocks`，标题/段落目前靠前端 `reflowText` 启发式还原。彻底解法是英语也改用 `blocks` 渲染（UI 文案「识别到 N 段，一段一块」本来就是按这个设计的），但会牵动 `posMap`/`navCount`/`sectionLabel`/历史索引，需单独评估。

### 英语版面结构三项整改（按用户「按顺序都改了」落地）
1. **英语结果页改用结构化 `blocks` 渲染**（`web/src/pages/AiParseResultPage.tsx`）：新增模块级 `enDisplaySegments(blocks, questions, text)`，优先用服务端的 `title/heading/body` 块（版面与原图一致），没有 blocks 才退回扁平 `questions/text`。**渲染循环 / `posMap` 标注项 / `navCount` / `sectionLabel` 共用同一份**，索引才对得上；`table` 块照常渲染但跳过词性标注。这样「识别到 N 段，一段一块」的文案才名副其实（原先扁平 `questions` 通常只有 1 段）。
   ⚠️ 该函数放在组件外、**不是 hook**（组件在 `if (!session) return` 之前已有全部 hooks，早返回之后再加 hook 会触发 hook 数量不一致）。
2. **不再压掉 Paddle 的段落空行**（`server_cf/src/lib/paddleOcr.ts`）：`replace(/\n{2,}/g,"\n")` → 只做收敛（3+ 空行 → 1 个空行）与行尾空白清理，让 `text` 保留段落边界（`blocks` 本来就没受影响）。
   ⚠️ **配套必改**：新增 **`splitProblemsByNumber`**（`aiTextUtils.ts`，server_cf + server_ts 同步）——数学只按【题N】/行首题号分题、**忽略空行**。因为 `splitQuestions` 的「空行分隔」分支优先级高于「行首题号」，一加空行数学就会退化成按空行切段、把题干/选项切散。`ai_homework.ts` 两处（缓存读 + 主链路）已改用它，并有单测守卫（同一文本：通用拆题 3 段 vs 数学 2 题）。
3. **英语默认豆包优先**（`server_cf/src/routes/ai_chinese.ts` 的 `usePaddleFirst` 与 `tryPaddleFirst`）：显式传 `engine=paddle/doubao` 仍优先；否则**英语走豆包**（多模态有版面理解），其余模块维持 Paddle 优先。原因：Paddle 只吐扁平 markdown，标题层级/段落边界会丢。代价是英语首屏慢一点（Paddle 1~3s vs 豆包流式）。
   ℹ️ server_ts 无 Paddle（只有豆包 + 腾讯/百度 API 回退链），故第 2、3 条不涉及它，只同步了 `splitProblemsByNumber`。

### 卷内英文被删成标点乱码（2026-09-14 追加）
用户截图：语文卷里夹的**英语邮件范文**，在英语模块结果页显示成 `,  ,  .` / `? / ? / ?`（英文全丢，标点/数字/中文保留）。查出**两个独立原因，都已修**：
1. **客户端 OCR 结果缓存没被清**（`web/src/lib/ocrResultCache.ts`）：localStorage `aiphonix_ocr_cache_v1`，`KEY_V` 原为 `v3`、**TTL 7 天**、命中即秒出并**完全绕过服务端**。此前英语走语文提示词产出的脏结果就躺在这里 —— **服务端怎么改都不会影响它**（这正是"改了提示词还是乱码"的原因）。已 bump 到 **`v4`**，旧脏条目自然失效、强制重识别一次。
2. **`stripPrintedPinyin` 会删掉中文行里的英文正文**（`server_cf/src/lib/aiTextUtils.ts`）：它无条件 `replace(/[A-Za-z]+/g, "")`，于是中文卷子里的英语范文被删成标点乱码。改为**只在该行还有汉字时才删无调拉丁段**（带声调的仍走 `PINYIN_TONE_RE` 无条件删）。
   取舍：纯无调拼音行极罕见（教材拼音必标调），宁可漏删也绝不删英文正文。已用 `tsx` 跑**真实代码**验证：`It has been a long time…` 原样保留；`妈妈 mā ma 在家里` / `我爱 xue xi 语文` 拼音仍删净。
   ℹ️ 只改 server_cf —— server_ts 根本没有 `stripPrintedPinyin`（它从不删拼音）。
- ⚠️ **教训（务必记住）**：改识别质量后只 bump **服务端**缓存键（R2 blob）**不等于**清掉**客户端** localStorage 缓存；同一张图重新识别仍会命中旧脏结果。**两处都要 bump。**

### 版面契约 P0+P1：三套规则收敛 + 数学补 blocks（2026-09-14 追加）
> 完整契约见 **`docs/layout-contract.md`**（Block schema / 段落定义 / 两条元规则 / 各模块规格 / 已知取舍 / P0~P5 待办）。起因：用户反馈"版面一直搞不好"，诊断出**提示词、服务端后处理、前端渲染三套逻辑各自为政**，且数学 `blocks` 恒空导致结构规则全部悬空。
- **P0 收尾函数统一**：`finalizeBlocks` 从 `ai_chinese.ts` 提到 `aiTextUtils.ts` 导出，三模块共用；**顺带删掉 ai_chinese.ts 里重复的第二份 inline 清洗**（`deepseekRelayout` 内，两份规则一旦漂移就会出现"同页不同分支结果不同"）。
- **P1 数学补 blocks**：① Paddle 路径原先把 `po.blocks` **直接丢掉**，现已接上；② 豆包路径新增 `MATH_OCR_JSON_PROMPT`（内容规则与 `MATH_OCR_PROMPT` 一致，只是输出 blocks JSON），**失败自动回退纯文本提示词**（零回归）；③ 前端新增 `mathDisplaySegments`，与 `enSegments` 同构（渲染/`navCount`/`sectionLabel` 共用一份，索引对齐）；④ **`body` 块（算式/竖式）改为逐行原样渲染** + `.math-line{white-space:pre-wrap}`，保住竖式列对齐。
- ⚠️ **两个必须记住的实现坑**：
  ① `cleanOcrText` 会删掉 `\u25a1`（**□**）——语文无害，但数学填空方框正是 □。故 `finalizeBlocks` 加 `profile: "chinese"|"math"` **一次性表达学科差异**，并用 `lineCleaner` 注入 `mathClean`。实测：语文档位 `2. 填空：□ + 5 = 9` → `2. 填空： + 5 = 9`；数学档位完整保留。
  ② `extractBlocks` 默认逐行 `.trim()`，会吃掉竖式行首空格 → 数学必须传 `keepLineSpaces: true`。
- **已部署**：Version `476ea01f`（Worker + web 全量）。`web tsc` / `server_cf tsc` 均 0；`paragraphFlow` 42/42。
- **待办**：server_ts 尚未镜像（其 `aiTextUtils` 无 `finalizeBlocks`、`extractBlocks` 无 `keepLineSpaces`）→ 见契约文档 P1.5；P2（统一分段）/P3（前端删启发式）/P4（流式对齐）/P5（边界场景）未做。

### 流式 OCR 移除 + 学科隔离指令（2026-09-14 追加）
- **用户指令（两条）**：① 英语/数学/语文**不共用逻辑，各自独立出来**；② **去掉流式 OCR**。
- **② 已完成**（Version `9be8d9f2`，全量部署）：
  - 前端：删 `parseImageStream` + `ParseImageStreamHandlers`（`web/src/services/aiImage.ts`，-149 行）；AI 语文/英语页改调 `parseImage`；顺带删除 `liveLines`/`readingIdx`/`abortRef`/`finishNow`（"就按这些字来"）与 TTS 逐行朗读 UI（两页各 -1.4 kB）。
  - 服务端：删 `/ai-chinese/parse-image-stream` 路由整段（291 行）+ `streamSSE`/`IncrementalLineExtractor` 导入。
  - 收益：**少一条重复管线**（原先非流式/流式各有一套清洗与引擎选择，任何规则改动都要改两处；且流式天生丢空行 → 契约 P4 随之作废）。
- **① 尚未执行（下一步）**：上一步 P0 我把 `finalizeBlocks` 做成了**共用**（`profile` / `lineCleaner` 开关），与用户新指令方向**相反**。待拆成 `lib/subject/{chinese,english,math}.ts` 三份自洽实现并**删掉开关**；`Block` schema 作为前后端通信格式保留。契约文档 **§7** 已写明执行顺序与理由 —— **共用正是这串 bug 的根源**：英语吃语文提示词（英文被删）、语文去拼音删掉卷内英文正文、数学要 `□` 却用了会删 `□` 的语文清洗器。

### 部署
- 已部署生产（四次）：
  1. Version **`10230c0c-cad0-4002-8a23-e559ec890c72`** —— 全量部署（Worker 英语提示词 + web 资产：数学算式换行）。
  2. Version **`dcc6b5c6-43ba-4858-b138-94746e7a2b4b`** —— `deploy.ps1 -SkipWeb`（英语缓存 key → `_en_r5`，让旧脏缓存失效重识别）。
  3. Version **`3fe07db3-ccef-4733-86b3-35d04b7ae0c0`** —— `deploy_web.ps1`（英语结果页整块收词改为按英文单词收录）。
  4. Version **`ad6e59bb-a0b5-47ce-8a2d-5b29c9076845`** —— `deploy_web.ps1`（英语换行：标题独占一段，不与正文挤一行）。
  5. Version **`e75dbf87-b4a0-49c8-9ca9-4e345f4f2b53`** —— `deploy.ps1 -SkipWeb`（OCR 提示词加固：段落/标题/禁止改写约束，含英语与数学）。
  6. Version **`54ed44a5-1d2f-4988-92cf-f11ad899c0dd`** —— 全量部署（英语 blocks 渲染 + Paddle 保留段落空行 + 数学 `splitProblemsByNumber` + 英语豆包优先）。
  7. Version **`61c23550-7b3b-4259-8373-2eb338c56289`** —— 全量部署（`stripPrintedPinyin` 不再删英文正文 + 客户端 OCR 缓存 `KEY_V` → `v4`）。
  8. Version **`476ea01f-62fb-4134-8f52-3df69f8cf422`** —— 全量部署（版面契约 P0+P1：`finalizeBlocks` 统一 + 数学补 blocks + 竖式逐行渲染）。
  9. Version **`9be8d9f2-e33e-4c10-8e80-0a75795ecbb2`** —— 全量部署（**移除流式 OCR**：前端 `parseImageStream` + 两页实时行 UI、服务端 SSE 路由整段）。
- 线上验证：`web/assets/paragraphFlow-5A5zHClZ.js` 已含 `breakOnFormula`；`/health` → `{"status":"ok","d1":"ok","r2":"ok"}`。
- 注：`deploy.ps1` 的 [3/4] verify 步骤在本机必报 `[regex]::Match` null（`curl.exe --noproxy` 返回空），**属既有噪声、不影响部署**，用 `web_fetch` 验产物即可。
- 本地后端（server_ts 18002）本次**未在运行**，dist 已重建，下次启动即带英语模式修复。

---

## 0.3 🧩 2026-09-07 记忆快乐本缓存按 scope 拆分（认字页/练词页各生各的）

- **背景**：词语练习页出现「查字典」主题故事引起困惑——`JoyStoryCard` 是认字/练词页共用组件，旧逻辑把每日配置的**字+词合在一起**喂 LLM，按 账号+日期 只存一条，两页看到同一段故事。
- **改动**：`memory_joy_entry` 加 `scope` 列（`'all'`=旧混合 / `'char'`=认字页只传今日字 / `'word'`=练词页只传今日词），唯一索引 `(user_id,date)` → `(user_id,date,scope)`。迁移 **0014_memory_joy_scope.sql** 已应用生产 D1。
- `/joy/generate` 接受 `scope` 参数纳入缓存键；`/joy?date=` 同日多条时取最新。前端：练词页 `chars="" scope="word"`、认字页 `words="" scope="char"`（`generateJoy` 新增 scope 参数，默认 `"all"` 兼容旧客户端）。
- 已部署生产（Version `8d85158d`）并用 webtest 账号线上冒烟通过：word/char 各自生成、重复请求命中缓存；测试数据已删。

---

## 0.2 📦 2026-08-28 server_cf（Cloudflare Workers）收官整改（重要，新会话必读）

> 本会话完成了 TS 后端迁 Cloudflare 后的 **8 项整改**（20 项问题清单的 🔴4/🔴3/🟡10/🟠5/🟠6/🟠7/🟡8/🟡9）+ 看图识字图片加速。
> **完整细节**：`server_cf/MIGRATION_NOTES.md`（8 个落地项逐节记录）→ `SESSION_HANDOFF_20260828.md`（交接/坑/待办）→ `session-export-20260828.md`（整理导出）→ `docs/session-transcript-20260828.md`（原始转录 533KB）。

### 生产（新常态）
- Worker `aiphonix-api` @ `https://aiphonix-api.xinyi7lan.workers.dev`（最新 Version `8fb87e9d`）；staging @ `aiphonix-api-staging.…`（`1f7e7044`，独享 D1/R2）。
- 部署统一走 `& .\scripts\deploy.ps1`（tsc→secret 门禁→web 构建→deploy→verify）；staging 用 `-Env staging`。**禁止裸 wrangler 手搓。**
- 数据层已全 D1：`char_image_index`（3028 行 id 保序）、`char_image_feedback`（UPSERT 消竞态）、`wordbank_item`、`request_logs`（可观测）。
- `/api/v1/char-images/file/<名>?w=640` = 预生成缩略图（~60KB），字卡页用它；workerd **禁止运行时 WASM**，图像加工一律离线（PIL `scripts/gen_char_thumbs.py`）。

### 关键坑（踩过，勿重蹈）
- `_headers`（下划线）才是 wrangler 4.127 的资产头文件；`.headers` 无效。
- `wrangler r2 object get|put` 单位置参数 `bucket/key`；get 用 `--file`。
- workerd 禁运行时 WASM 编译（@jsquash 在线路必炸）。
- Python urllib 默认 UA 被 CF 403 → 加浏览器 UA + `ProxyHandler({})`。
- PS5.1 中文乱码 → 中文数据脚本用 `.py`/`.mjs`；`.ps1` 纯 ASCII 注释。

### 台前工程（Android/Web）状态不变
- 见下节（2026-08-27 及更早）；Android 客户端、web/（React+Vite）、server_ts 18002 看门狗等照旧。

## 0.1 🔧 2026-08-27 移除 EasyOCR + dev_agent（纯 HTTP API 化）

- **EasyOCR 已彻底移除**：删除 `server_py/scripts/ts_image_bridge.py` 的调用方 `server_ts/src/lib/imageBridge.ts`；新建 `server_ts/src/lib/ocr.ts` 多 API fallback 链（豆包优先 → 腾讯云 GeneralBasicOCR → 百度 general_basic，复用 tencent/baidu_tts 凭证）。三个调用点已接入：`ai_chinese.ts`、`ai_homework.ts`（识图回退）、`uploads.ts`（后台 OCR）。`ai_chinese.ts` 的 `detectRegions` 与截图预分类 `classifyImage/cropToBox` 已移除（豆包整页识别替代）。后端不再有 Python 子进程依赖（唯一残留 `dev_agent.ts` 亦已删除，见下）。
- **dev_agent 功能已删除**（RCE 级高危接口，生产不应存在）：删 `server_ts/src/routes/dev_agent.ts`、`server_py/routes/dev_agent.py`；清理 `index.ts`/`env.ts`/`ark.ts`（GLM 注释）、`web`（DevAgentPage.tsx、routes.tsx、HomePage.tsx 入口、App.css 样式）、`shared/config.yaml`（dev_agent 段）、`start_ts_backend.ps1`（DEV_AGENT_ENABLED）。后端 19 项测试仍全绿，`npm run build` + `web tsc -b` 零错误。

## 0. 🔄 2026-08-27 更新（TS 后端优化第二轮：性能/安全/守护/测试）

### 服务托管方式变更（重要）
- **18002 现由看门狗托管**：`watchdog_all.ps1` 每 30s 幂等调用 start_ts_backend.ps1 + start_frontend.ps1，崩溃 ≤30s 自动拉起；开机自启走启动文件夹 `AiPhonixWatchdog.vbs`。手动重启直接跑桌面/项目里的 `start_ts_backend.ps1` 即可（已设 PORT=18002、DEV_AGENT_ENABLED=1）。**ps1 必须纯 ASCII 注释**——Windows PowerShell 对无 BOM 文件按 GBK 解析，中文注释会把下一行代码吞进注释导致变量丢失（本次实际踩坑：$outLog 变 Null）。
- 8080 僵尸进程依旧勿动。

### 本次改动清单
- **性能**：媒体路由异步读文件+pinyin/ipa 音频缓存头(max-age=604800)；LLM 调用日志防抖合并落盘(800ms,上限仍 10 万条)；APK 下载与 dev_agent 同步子进程**未改**（低频，遗留）。
- **OCR 常驻 sidecar**：`ts_image_bridge.py` 加 `--serve` JSON 行协议模式+EasyOCR Reader 进程内缓存；`server_ts/lib/imageBridge.ts` 重写为常驻管理器（握手/串行队列/空闲 30min 回收/**沙箱降级回退一次性进程**），对外签名不变。实测 rows 首调 330ms→复用 21ms（原每次 2–4s）。
- **安全**：JWT 密钥自动生成到 `server_py/data/jwt_secret.key`（旧登录态失效一次）；CORS 从 `*` 收敛为 allowlist（无 Origin 放行、`:5173` 与 localhost 放行、恶意 Origin 403，env `CORS_ALLOW_ORIGINS` 可扩展）；16 个敏感写接口挂 `requireAuth()`（essays×4、user_imports×2、uploads×2、training×2、practice_tracker×3、practice submit、wordbank add-word、char-images audio 上传；GET 静态资源保持开放）；dev_agent 默认关闭由 DEV_AGENT_ENABLED 门控，模型名走 env `DEV_AGENT_GLM_MODEL`。
- **稳定性/可观测**：SIGTERM/SIGINT 优雅停机（关 HTTP→关 SQLite，8s 兜底强杀）；请求日志中间件 `[req] METHOD path -> status ms`（快速媒体请求降噪）。
- **测试**：`npm test`（node:test + 已有 tsx，零新依赖）19 例全过：权重公式(lib/practiceWeights.ts)、预算守卫(checkBudget 抽取自 deepseek.ts)、aiTextUtils 清洗/拆题。回归基准：错3次=1.9 等双端冒烟值。
- **去重拆分(第一阶段)**：ai_chinese/ai_homework 六个逐字重复的函数抽到 `lib/aiShared.ts`（stripFence/parseJsonObj/readCache/writeCache/sentenceAudioPath工厂/renderAnalyze）；两文件仍 >1000 行，按域拆分待后续。
- **EasyOCR 取舍结论**：保留。TS 原生方案中 tesseract.js 中文精度不足、ONNX 跑 PP-OCR 工程量大；EasyOCR 仅作 Ark 失败兜底且现在常驻进程化，冷启动痛点已消。

### 第二轮补充（同日）：状态迁库 / 配置入 yaml / 提示词出库
- **共享状态已全部进 SQLite**（根治脑裂；PY 已退役由 TS 单写）：
  - `char_practice.json`→表 `char_practice`（首启自动迁移+改名 `.imported-bak` 封存）；练习权重/记录接口行为逐字段对齐 PY。
  - `llm_call_logs.json`→表 `llm_call_log`（2425 条历史已迁入，行式追加）；`llm_budget.json`→表 `llm_budget_day`（当日记录并入）。两文件启动时自动导入并封存，幂等。
  - 新表 DDL 由 TS 侧 `db/index.ts` 的 `CREATE TABLE IF NOT EXISTS` 兜底建（PY 建表机制已退役）。
- **dev_agent 模型配置进 config.yaml**：新增 `dev_agent:` 段（pydantic 忽略多余段，PY 不受影响），env `DEV_AGENT_GLM_MODEL` 仍可覆盖。ark_chat api_key 复用不变。
- **提示词常量出库**：17 个纯文本 PROMPT 模板移到 `lib/prompts.ts`；含 `${}` 插值的留在路由内。ai_chinese.ts 现 2041 行。
- 若未来要复活 PY 后端：**先读 PROJECT_MEMORY 再动**——练习/预算/日志的真实来源已是 SQLite 表，旧 .json 已封存勿解档。

### 大文件按域拆分完成（同日三轮补记）
- **ai_chinese.ts 2227→1219 行**，拆出四个子域模块（同目录、`router.route("/", child)` 透明合并，外部零改动）：ai_chinese_kb（wiki/知识图谱/search/kb-ask 6条）、ai_chinese_quest（闯关8条）、ai_chinese_textbook（教材大纲/units 6条）、ai_chinese_questions（背诵/阅读/出题/作文 10条）。共享目录常量与 chatJson/resolveImagePath/autoCropWhite 等提升到 **lib/aiChineseContext.ts**。
- **ai_homework.ts 1107→868 行**：闯关 8 条拆为 ai_homework_quest.ts。
- 提示词集中在 lib/prompts.ts；纯工具在 lib/aiShared.ts。今后改 AI 功能先找对应子域文件。
- 改动经 tsc/19单测/build 验证；线上五域抽探全 200。路由总数守恒（52+22）。

### 契约层 / 前端收编 / 目录松绑（同日四轮）
- **共享契约层**：`server_ts/src/contracts/index.ts`（zod 单一事实来源）。后端 practice 出参走 parseOut 渐进校验；前端经 tsconfig.app `paths:{"@contracts":...}` 直接 import type（vite 无需别名，类型擦除零运行时）。practice/uploads 两域已接入；其余 service 迁移照此模板。
- **App.tsx 裸 fetch 收编** services/uploads.ts（顺带修复：requireAuth 后旧页面无 token 必 401 的隐患）。
- **目录松绑**：数据/静态/缓存/配置物理迁至 **AiPhonix/shared/{data,static,cache,config.yaml}**（robocopy 复制，原 server_py/data 因 8080 僵尸占句柄改"冻结不写"策略）。env.ts 现以 ROOT 派生四个中立常量，LEGACY_PY_ROOT 仅剩桥接脚本。APK 移至 shared/downloads。
- ⚠️ PY 后端若复活需自行指向新路径；旧 server_py/data 成僵尸私有副本不再同步。

### 待办遗留

### 待办遗留
- APK 下载流式化、dev_agent 开启时的管理员 token、脑裂文件搬 SQLite、大文件按域拆分、ts_py 审计文档随接口演进需同步。

---

## 0. 🔄 2026-08-25 更新（本次会话）

### 服务状态变更（重要）
- **8080 旧 TS 进程（PID 14604）无法终止**（Access denied，高权限启动，taskkill 也不行），它是改动前的旧代码、**不响应新接口**。不要尝试重启它。
- **新 TS 后端跑在 18002**（`node dist/index.js`，含 bili 路由）；**Vite proxy 四段 target 已从 8080 改为 18002**（`web/vite.config.ts`）。手机访问地址不变。
- **18002 由 dsh 后台 job 托管**（node dist/index.js 前台常驻）；job 被杀/机器重启后需重起。**注意：裸 Start-Process 起的 18002 会在命令结束时被环境回收，务必用常驻后台 job 托管。**
- 若前端经 5173 访问 `/api/*` 走 18002 正常；直连 8080 是新功能不可用。

### 新增：字幕采集页影片三来源（`web/src/pages/SubtitleCapturePage.tsx`）
- 「🎞️ 影片」按钮 → 浮层：📁本地（原有）/ 🔗云端直链 URL（截图需源开 CORS，canvas 有明确报错）/ 🎬B站（**iframe 预览模式，不能画框/截图/采集**，相关按钮禁用+提示条）。
- **B站搜索**：`server_ts/src/routes/bili.ts` 代理 `GET /api/v1/bili/search?keyword=`（服务端带 buvid3 cookie+UA/Referer，规避 CORS/风控）。前端搜索 → 结果列表 → 点选 → 预览。
- 功能冒烟：`web/responsive/smoke.spec.ts`。

### 新增：响应式排版审计（`web/responsive/`）
- Playwright + DOM 几何检测 + 9 条规则（R001-R009，P1/P2/P3 分级）+ 截图 + 报告 + 评分。
- 运行：Vite 5173 + 后端在跑时 `npm run audit`（web 目录）；`pass.json` P1=0 过关。
- 首轮修复：顶栏按钮/back-btn/删除按钮 加 `min-height:44px`（App.css 全局）。
- 已修规则误报：根容器/横向滚动容器豁免。

## 0. 🔄 2026-08-22 更新（上个会话记忆导入 — 8/20~8/22 进展）

> 由 2026-08-22 新会话从 `session-cabc785d`（8/20 16:51 ~ 8/22 12:15）导入。新会话先读本节接续。

### 看图识字（char_image）重构 — 已完成
- `/module/char_image` 拆成两级页面：`CharImageEntryPage`（首页入口「看图识字词句」）→ 中间页 3 入口：看图识字(`?type=字`) / 看图识词(`?type=词`) / 看图识句(`?type=句`)。路由：`module/char_image` → entry，`module/char_image/practice` → `CharImagePage`。
- **英语（英词/英句）不混入 3 个中文入口**，仅经 EnglishLearningPage 进入。
- `type=字` 页显示全部认+写卡片：前端 `apiType=""` 拉全量 3028 → 过滤 `认(816)+写(748)` = 1564（原先把 "字" 直接传给后端导致空页）。
- 词页音素按钮**按字一行排列**：`pinyinChips` 返回 `PinyinChip[][]`（每字一行），`PinyinChips.tsx` 按行渲染 `.pinyin-chips-row`（justify-content:center）；`.pinyin-chip{width:auto}` 覆盖全局 `button{width:100%}`。例：春天 → `ch un` / `t ian`。
- `YUNMU_MNEMONIC` 补 `ian:"烟"`（天 `tian1` → `t` + `ian` 两个 chip）。
- 「读字」按钮改「读词」；多字中文词 SOE 用 sentence 模式（`wordEvalScene`：`isSentence`/`isMultiChinese` 判断）。
- **豆包给全部 729 个词生成句子 + 每卡 TTS/评测（已完成）**：
  - `server_py/scripts/gen_char_sentences.py`：用 ARK `doubao-seed-evolving`（disable_thinking=True）批量生成 `{"词":"句子"}` → `web/public/char_sentences.json`（**729 条全齐**，如 春天→"春天到了，小草偷偷地从土里钻出来。"）；英文句子同理供英词卡。
  - `web/src/services/charSentences.ts`：`getAllCharSentences` / `getCharSentence` / `getAllEnglishWordSentences`。
  - `CharImagePage.tsx`：词卡/英词卡显示「句子」块（句子文本 + 🔊TTS + 🎤评测，sentence 模式，`curSentence` / `genSentScore`），复用 `charimage-examples` 样式。

### 环境：WSL2 安装与 F 盘迁移（8/21 晚）— 已完成
- WSL2 + **Ubuntu 26.04 LTS** 安装，发行版数据迁移到 `F:\WSL\Ubuntu\ext4.vhdx`（不占 C 盘）。
- **清华 TUNA 镜像源**已配置；用户 `lhl20` / 密码 `ll123456` / sudo 可用。
- 修复 `Wsl/Service/CreateInstance/MountDisk/HCS/E_ACCESSDENIED`：`wsl --export` → `--unregister` → `--import` 重建发行版（重启 vmcompute 只能临时恢复，重建根治，冷启动验证通过）。
- WSL 快速入口：`wsl` 进入 Ubuntu；`sudo apt install xxx`。

### 待办 / 遗留
- 上个会话最后一条消息「**你擅长写ocaml代码吗**」（8/22 12:15）尚未回复。
- 服务状态：后端 uvicorn 8080（health 200）、Vite dev 5173 均在运行；手机访问 `https://192.168.1.7:5173/web/` 需硬刷新。

---

## 0. 🔄 2026-08-20 更新（最近会话关键工作）

> 本节记录 08-20 当天完成的所有重要改动，新会话先读这里再接续。

### 功能新增/修改（web 前端）
- **拼音表页面**：`/module/pinyin-index` + `/module/pinyin/:id`（仿英语音标页）。数据 `web/src/data/pinyinTable.ts`（23 声母/24 韵母/16 整体认读 + 例字），例字点击用百度 TTS（服务端 `/tts/synthesize`，带缓存）；音素本体用 `pinyin_audio/` 现成 mp3。首页有「📖 拼音表」入口。
- **拼音助记字**：`web/src/data/pinyinMnemonic.ts` —— 每个声母/韵母/整体认读配"一声汉字"助记（b→波、y→一、w→乌、j/q/x+uan→渊、其它声母+uan→弯 等）；`lib/pinyin.ts` 的 `pinyinChips` 给每个部件带 `mnemonic`，`PinyinChips.tsx` 显示"助记字在上+拼音在下"。j/q/x/y 后 ü 去两点显示 u（书写规则）。
- **char_image 页**：
  - 两个词语+一个句子各加「🎤 评测」按钮（SOE，词/句用 sentence 模式）
  - 最近一次总分显示在对应评测按钮下方（`scoreBySourceType`/`scoreByRefText`，从 `/soe/records` 加载）
  - 顶部小圆点定位改**输入页码组件**；支持 URL `focus=字` 定位（从评测历史跳转）
  - 右下角固定角标显示分类（年级学期·模式）+ 学习状态 ✓/×/?
  - 去掉左右滑动 snap 保护（自由滚动）；懒渲染（只渲染当前±2 个避免 3000+ 字卡卡顿）
  - **评测评测上限放开**：`listCharImages` 传 `limit=100000`（后端默认 500 会截断）
- **评测历史页**（`SoeHistoryPage`）：条目点击按来源跳转（有 `source` → char_image 定位；英文 → pronounce 页）；新增「📋 学习状态」按钮，弹窗按 ✓/×/? 筛选显示反馈记录（`/char-images/feedback` 全量 + 总数）。
- **区域切割**（`ai_chinese.py _detect_regions`）：改为**行级题号正则硬切**——逐行读文本→正则认大题题号（汉字/数字/第X部分）→按题切块，解决"切到上一题/切废"。每个字卡顶部显示"区域大题"块。
- **AI 编程助手**：`/module/dev_agent`（DevAgentPage）——对话让 GLM-5.2 改代码，工具调用（read/write/edit/list/run_command），安全边界锁定项目根。达到轮数上限时显示黑客风提示。
- **顶部栏**（AppLayout）：去掉底部导航（今日任务/每日一练/退出），改为左上角头像 + 右上角「🏠主页」+「🚪退出」（带文字）。

### 后端
- **同步阻塞修复**（重要，防服务假死）：`_auto_orient`/`_compress_image`/`classify_image`/`crop_to_box` 共 11 处用 `asyncio.to_thread` 包裹（ai_chinese.py / ai_homework.py / uploads.py），方案与完整代码由 GLM-5.2 生成（`server_py/scripts/fix_plan.md`）。
- **胖路由拆分（第一步）**：抽 `_auto_orient` → `utils/ai_image_utils.py`（auto_orient）、`_read_cache`/`_write_cache` → `utils/ai_cache_utils.py`，三个路由 import 共用（行为零变化）。GLM 完整方案在 `server_py/scripts/fat_route_split_plan.md`（注意：GLM 重写的函数体与原实现不同，**只能照 GLM 分组、函数体必须原样搬移原文件**）。
- **胖路由拆分（第二步）**：抽 16 个文本处理函数 → `utils/ai_text_utils.py`（extract_json_array / extract_blocks / extract_html_tables / merge_table_blocks / extract_page_bounds / reorder_title_first / mark_poetry / mark_ordered_indent / detect_complex_layout / detect_pp_strength / clean_ocr_text / fix_mojibake / dedupe_lines / recover_text_from_json / split_questions / split_sentences）。ai_chinese.py import 全部 16 个（`as _原名`）；ai_homework.py 只 import `split_sentences`（两文件实现相同）。**ai_homework 的 `_clean_ocr_text` / `_split_questions` 是数学版（多了 LaTeX/markdown/HTML 清理），与语文版不同，不抽不共享**。原函数定义改名为 `_xxx_MOVED` 后已由 `python scripts/cleanup_moved_functions.py` 一键清理完毕（ai_chinese.py 0 个、ai_homework.py 删除 1 个）。语法验证 `py_compile` 零错误通过。GLM 方案 4（拼音工具）和方案 5（homework 工具）不可行：拼音函数依赖 8 个模块级常量（工程量大）；`_parse_blocks`/`_parse` 是嵌套局部函数（非模块级）。
- **拼音 uan 规则**：`lib/pinyin.ts` j/q/x+uan → van(üan) 读"渊"；补了音频 `data/pinyin_audio/韵母/van.mp3` + `特殊韵母声调/van1-4.mp3`（百度 TTS 生成）。
- **架构评审**：`ARCHITECTURE_REVIEW.md`（GLM-5.2 基于代码摘要生成，7 维度）。
- **工程清理**：server_py 根目录开发/测试脚本移到 `scripts/`、`tests/`；`.gitignore` 补 app.db/.mypy_cache/日志等。

### DSH / 环境
- **AI 编程助手模型已切 GLM-5.2**：`routes/dev_agent.py` 用火山 ARK `glm-5-2-260617`（base_url `https://ark.cn-beijing.volces.com/api/v3`，key=config.yaml `ark_chat.api_key`，支持 tools/function calling）。不再用 deepseek-v4-flash。
- **DSH 会话模型切 GLM-5.2（路线B）**：`~/.dsh/profiles/web/cordis.patch.yml` 注册 `doubao-ark` provider（api=openai-completions，baseURL=火山 ARK，model=glm-5-2-260617，contextWindow=200000，maxTokens=16384）；`ARK_API_KEY` 用户级环境变量已设置。⚠️ 新会话在模型选择器选 Doubao ARK / GLM-5.2。
- **桌面恢复脚本**：`C:\Users\lhl20\Desktop\恢复AiPhonix服务.bat`（一键检测/重启后端+前端）；`启动后端.bat`、`启动前端.bat` 也已放桌面。GBK 编码，勿用 UTF-8 另存。
- **后端 --reload**：`start_server.bat` 已加 `--reload`，改 Python 自动重启。

### 已知注意事项
- 长会话切 GLM-5.2 会"上下文已用 100%"（当前会话历史巨大）→ 开新会话。
- dev_agent 是**高危接口**（能读写文件+跑命令），生产应禁用/加鉴权。
- `PROJECT_MEMORY.md` 本节为 08-20 快照，新会话读到本节即可接续；具体代码以文件实际为准。

---

## 1. 项目概览

- **产品**：AiPhonix —— 面向小学生的 AI 语文/英语学习助手（识字、拼音、英语字母/音素/发音评测、AI 语文/数学拍照识题问答等）。
- **后端架构（2026-09 校正）**：`server_py`(FastAPI/8080) 已于 2026-08 退役；生产后端为 **`server_cf`**（Cloudflare Worker，D1+R2），本地开发后端为 **`server_ts`**（Hono，3001，better-sqlite3 + 本地 FS）。前端同源 `/api/v1` 经部署指向对应后端。
  - `server_cf/`：Cloudflare 生产 Worker（`aiphonix-api`，D1+R2+Workers Assets）。
  - `server_ts/`：本地开发后端（Hono + better-sqlite3 + 本地 FS），与 server_cf 同为 TS/Hono。
  - `app/`：Android 原生（Kotlin + Jetpack Compose），已基本停更，Web 化迁移中。
  - `web/`：Responsive Web App（手机浏览器优先），当前主战场。
- **对标/可替代性**：真实基准是 **server_ts ↔ server_cf**（非 vs PY）。完整只读审计见 `AiPhonix/TS_CF_PARITY_AUDIT.md`：19 模块等价、9 部分实现、5 个 server_cf 独有模块；server_cf 有 FTS5/D1 上线红灯需修。
- **当前主线**：把 Android 功能迁移到 Responsive Web；最近聚焦 AI 语文/数学的识别→排版→问答→高亮→评测链路，以及英语字母/音素/词汇的发音交互。

## 2. 环境与启动（重要）

| 项 | 值 |
|---|---|
| 后端 | `http://127.0.0.1:8080`，uvicorn `main:app`，`server_py/start_server.bat`（已设**开机自启**：启动文件夹 `AiPhonixServer.lnk` → `wscript //B start_server_hidden.vbs` → `start_server.bat`；bat 带 8080 端口幂等检测，已运行则跳过） |
| Web dev | `https://192.168.1.10:5173/web/`，Vite（`server_py/start_web_frontend.bat` + `start_web_frontend_hidden.vbs`，端口 5173 幂等；**已设开机自启**：启动文件夹 `AiPhonixWebFrontend.lnk` → `wscript //B start_web_frontend_hidden.vbs` → `start_web_frontend.bat`） |
| 访问 | 手机浏览器访问上面地址；自签证书首次点「高级 → 继续前往」；改代码后手机必须**硬刷新/清缓存** |
| 测试账号 | `webtest / test1234`（user_id=45） |
| 验证流程 | 后端：改后 `python -m py_compile` → 重启 uvicorn → `http://127.0.0.1:8080/health` 200；前端：`npx tsc -b && npm run lint && npm run build` → dev HMR → 手机硬刷新 |

## 3. 技术栈与架构

- **Web**：React 19 + Vite 8 + TS(strict) + React Router 7 + Zustand 5 + TanStack Query 5 + Tailwind 4（已跳过 preflight）。PWA（`vite-plugin-pwa`，autoUpdate）。
- **后端**：`server_cf`（Cloudflare Worker + D1 + R2，Hono）为生产；`server_ts`（Hono + better-sqlite3 + 本地 FS）为本地开发。统一前缀 `/api/v1`。
- **同源代理**：前端 `/api`、`/letter-clips`、`/videos` 走 Vite proxy → server_ts(3001) 本地 / server_cf 生产（避免 https 页面 mixed-content 被拦）。
- **关键目录**：
  - `web/src/pages/`：页面；`components/`：复用组件；`stores/`：Zustand；`lib/`：工具；`services/`：API 客户端；`hooks/`：业务 hook。
  - `server_py/routes/`：路由；`services/`：业务服务；`data/`：SQLite/缓存/上传/音频。
  - `web/public/`：静态资源（词库 json、alphabet_audio、favicon 等）。

## 4. 关键业务规则（改相关代码前必读）

### SOE 发音评测（反复踩坑）
- 腾讯 SOE `eval_mode` 决定返回粒度：0=单词/单字（含音素）、1=句子（单词+音素）、2=段落（仅单词）、8=拼音。
- **前端必须传 `scene`**：word / sentence / paragraph / pinyin，服务端 `_resolve_eval_mode` 映射；`sentence_info_enabled` 必须为 `"1"`，否则 Words/PhoneInfos 全空。
- 智聆返回**小写音素**，用 `web/src/lib/arpabet.ts` 的 `arpabetToIpa(phone, style)` 映射（英式/美式，别自造）。
- 评测记录：`useSoeScore` 会自动带上登录 `user_id`，服务端写入 `SpeechEvalRecord`（`details` 存 words+phone_infos）；查询接口 `POST /soe/records`；前端历史页 `web/src/pages/SoeHistoryPage.tsx`（`/module/soe_history`）。

### AI 语文/数学
- 拍照/粘贴图片 → 输入页跳转**独立识别结果页**（`/module/ai_parse_result`，`AiParseResultPage`）；会话数据存 `stores/parseSessionStore`（含 `sessionId`）。
- **OCR 提示词（server_ts，豆包 doubao-seed-2-1-turbo-260628 + disable_thinking 提速）**：
  - 语文/英语共用 `/api/v1/ai-chinese/parse-image`（`server_ts/src/routes/ai_chinese.ts` 的 `arkExtractBlocks`）：**2026-09 起合并为单次调用**——`DOUBAO_OCR_BLOCKS_PROMPT`（`server_ts/src/lib/prompts.ts`，OCR 逐行保真规则 + 结构分块规则 + 拆块示例）识图直接输出 `{"blocks":[...]}` JSON，一次往返完成 OCR+排版（实测 20-24s，旧两步流程 30s+）；JSON 解析失败才回退旧两步流程（`DOUBAO_OCR_PROMPT` OCR → `DEEPSEEK_RELAYOUT_PROMPT` relayout，失败兜底付费 deepseek `deepseekRelayout()`）。
  - 分块类型：title/heading/body/question/option/note；每块含 `text`/`align`/`lines[{text,indent}]`/`polyphones`；服务端 `cleanOcrText`+`markPoetry`+`markOrderedIndent`+`dedupeLines` 清洗 → 前端 BlockText 逐字点读/块级评测/标记不认识字。
  - 数学 `/api/v1/ai-homework/parse-image`（`server_ts/src/routes/ai_homework.ts`）：本来就是**单次调用**，无需合并；专用提示词（竖式完整抄写、空白格保留 □、不脑补答案）；`_split_questions` 按题号（含开头题号/圈号①、（1））**一题一块**拆分。
- **块级能力**（`web/src/components/`）：
  - `BlockAsk`：每块「向 AI 提问」，多轮问答；问答写入全局 `stores/qaStore`（**localStorage 自动持久化**，key=`scope:relKey`），「💬 问答记录」浮窗 `QaHistoryModal` 按 scope 展示。
  - `BlockHighlight`：每块「解析高亮」→ 后端 `/ai-chinese/highlight-mark`（原文一字不改、最多 3 处：core/beautiful/word + 口语化学习提示）；高亮叠加到正文（`BlockText` 支持 `highlights`/`onSpeakPhrase`，点击高亮短语整段朗读）。
  - 后端接口：`/ai-chinese/text-ask`、`/ai-chinese/highlight-mark`（均 DeepSeek + 预算守卫）。
- **历史会话**：结果页「💾 保存历史」→ `web/src/lib/aiHistory.ts`（localStorage，按模块 chinese/math 各存 50 条，含问答 `qa`）；历史列表页 `/module/ai_history?module=chinese|math`，回看恢复问答。

### 看图识字（`/module/char_image?grade=..&semester=..&type=..`，type=汉字/英词/英句）
- 汉字字卡：拼音显示为可点击部件 `PinyinChips`（`lib/pinyin.ts` 的 `parsePinyin` + `pinyinChips`）：**声母 / 介母(i,u,ü) / 韵母(带声调)** 各自单独 chip，点击播 `/pinyin-audio?file=..` 标准音频；整体认读音节单独一个 chip。
- 英词/英句字卡：显示音标文本 + `PhonemeChips`（每个音素可点，播 `/ipa-audio?file=..aac`）。
- 顶部有「📊 评测历史」入口 → `SoeHistoryPage`。
- 学习状态反馈 ✓/×/? → `/char-images/feedback`；进度记忆 `lib/charImageProgress.ts`（localStorage + 首页「继续上次学习」）。
- **词语+句子示例**（2026-08-17）：汉字字卡下方展示 **2 个词语 + 1 个句子**，点击 TTS 发音（`useTts.speak`）。数据 `web/public/char_examples.json`（`{"字": {"words": [..2..], "sentence": ".."}}`），由 `server_py/gen_char_examples.py` 用**免费 ARK**（`deepseek-v4-flash-ga-260731`，config.yaml `ark_chat` 段）离线批量生成；前端 `services/charExamples.ts` 的 `getCharExample(char)` 按字查询。重新生成：脚本支持断点续传 + `--retry-failed`；注意 prompt 用 `__CHARS__` 占位符 + `replace()`（**不能用 `.format()`**，JSON 花括号会被误解析）。

### 英语字母 / 音素 / 词汇 / 发音评分
- **字母索引页** `/module/letters`：点击字母格子进详情页；点击格子里**音标名直接播放字母音频**（`/web/alphabet_audio/{大写}_{两位序号}.mp3`，A_01~Z_26）。字母名音标显示用**教材简化记法**（`/ei/`、`/bi:/`、`/i:/`、`/ai/`、`/əu/`、`/ju:/` 等，已改 `web/public/wordbank.json`）。
- **字母详情页** `/module/letter/:char`：横向滑动；「🔈 字母名」播对应字母音频；「字母发音」音标 chips 播 `/ipa-audio`；练习单词/三年级词汇的**音素可点击发音**（`PhonemeChips`），点单词本身进发音评分页。
- **音素索引页** `/module/phoneme-index`：点击格子进详情；点击**音标符号直接播音素音频**。
- **音素详情页** `/module/phoneme/:symbol`：横向滑动；练习单词/三年级词汇音素可点击发音。
- **发音评分页** `/module/pronounce/:word`：单词下方音素 chips **点击直接发音**（不再跳详情）；「🔊 参考发音」整词 TTS；录音评分 + 音素明细（`SoeDetail`）。
- 音频资源：`server_py/data/ipa_audio/*.aac`（音素）、`server_py/data/pinyin_audio/`（声母/韵母/整体认读，ü 用 v）、`web/public/alphabet_audio/*.mp3`（字母名）。

### 横滑页面「一次最多翻一页」
- 看图识字、字母详情、音素详情都走 `lib/swipeSnap.ts` 的 `scheduleSwipeSnap(el, timerRef, getCurrent, onSnap)`：**移除 CSS scroll-snap**，松手后平滑吸附，**目标限制为当前页±1**，滑动中页码不跳变、吸附后才更新。

## 5. 已删除 / 停用（别重新引入）
- 「我的学习」模块及其子页（导入中心、我的导入、句子练习、文章跟读）已删除（`MyLearningPage`、`ImportCenterPage`、`MyImportsPage`、`SentenceReadingPage`、`ArticleListPage`、`ArticleReadingPage`）。
- 「保存到我的学习」功能已移除，改为「保存历史」。
- PP-StructureV3（PaddleOCR 外部服务）已**停用**（效果不佳，代码/配置保留待日后看场景）：`server_py/services/pp_structure.py`、config `pp_structure` 段仍在，路由已不调用。

## 6. 常见坑与排查
- **bat 中文注释乱码**：`.bat` 必须纯 ASCII（中文注释在 GBK 代码页会解析错乱）。
- `server.log` 被运行中的 uvicorn 占用，其他进程 `>>` 追加会被拒 → 幂等日志写独立文件（如 `server_start.log`）。
- TTS 对**单个标点**返回 500 → `isSpeakableChar`（`web/src/lib/chars.ts`）只允许汉字/字母/数字/拼音带声调可点读，标点渲染为不可点击。
- 多音字朗读用 `{字^拼音}`（百度 TTS 语法），`BlockText`/`useBlockSpeaking.speakChar` 支持；多音字由 relayout 的 `polyphones` 提供。
- 改 Vite proxy / 后端挂载后**必须重启对应进程**；手机访问后**硬刷新**。
- 录音 getUserMedia 需 https（自签证书即可）；音频全局互斥走 `audioManager`（同一时刻一个）。

## 7. 最近开发进度（2026-08 中旬，Web 化）
- **2026-09-07 识图提速（server_ts）**：语文/英语识图由「OCR + relayout 两次串行 Ark 调用」合并为**单次调用直接输出结构化 blocks**（`DOUBAO_OCR_BLOCKS_PROMPT`），实测 29.8s→23.7s（约 -20%），分块粒度反而更细（选项/对话句独立成块）；顺带修复 `server_ts/src/lib/ark.ts` 的 `buildMessages` **未 await `buildUserContent`** 导致图片请求 content 序列化成 `{}` 被 Ark 400 拒的 bug（该 bug 在已提交 HEAD 中，因 18002 跑的是旧 dist 从未暴露）。注意：18002 被无法杀死的僵尸进程占用（跑旧 dist），新代码需重启后端或换端口才生效；`npm run build` 产物缺 `dist/db/init.sql`（tsc 不复制 .sql），全新 dist 启动会 ENOENT，需手动拷贝 `src/db/init.sql`。
- P1~P5 功能全部迁移到 Web（登录/首页/家长设置/拼音/认字/默写/词语/英语字母音素词汇/看图识字/口述作文/AI 陪练/Quiz/AI 语文/AI 数学/视频跟读）。
- AI 语文/数学：独立识别结果页 + 块级问答（多轮+自动持久化+问答记录浮窗）+ 解析高亮（正文高亮+点击朗读）+ 数学一题一块 + 竖式 LaTeX→纯文本 + 拼音保留。
- 看图识字：声母/介母/韵母拼音部件可点、英词音素可点、评测按账号记录 + 历史查询页。
- 英语：字母名用本地音频 + 教材音标记法；索引/详情/评分页音素点击发音。
- 滑动翻页优化为一次一页。
- 服务端已开机自启；Web dev 有隐藏启动脚本（未自启）。

## 8. 建议交接动作
- 把本文件放到新工具约定的上下文位置（opencode→`AGENTS.md`；Claude Code→`CLAUDE.md`；Cursor→`.cursor/rules/*.mdc` 等），或直接喂给新 agent。
- 若新工具只读一个文件，可把本文件内容并入其约定文件；旧的 `memory-export-*` / `SESSION_HANDOFF_*` 为历史快照，需要时按日期查阅。
