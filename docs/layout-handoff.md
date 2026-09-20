# AiPhonix 版面（Layout）交接文档

> **给接手 AI 识别 / 版面工作的 coding agent。**
> 本文自包含：架构、规则矩阵、本次会话日志、根因库、坑与铁律、待办、验证与部署命令。
> 配套正式契约见 **`docs/layout-contract.md`**（`Block` schema / 段落定义 / 元规则 / 已废弃项）。
> 最后更新：**2026-09-15**。

## ⚠️ 当前代码状态（2026-09-15，接手第一件事请读这里）

| | |
|---|---|
| **线上 Worker Version** | **`9be8d9f2-e33e-4c10-8e80-0a75795ecbb2`**（= 2026-09-14 的「移除流式 OCR」） |
| **本地代码** | **领先于线上**：§7 学科隔离已在 `server_cf` + `web` 落地，**尚未部署** |
| **git** | ⚠️ **大量工作仍未提交**：`HEAD` 停在 `f11793a`（2026-09-11），工作区有 20+ 文件改动（含 2026-09-14 的 9 次部署成果 + 本次隔离），`docs/layout-*.md` 仍是 untracked |

> 🔴 **接手须知**：本地代码 ≠ 线上代码。改动要生效必须走 §8 的部署流程。
> 另：隔离重构涉及删除公开 API（`finalizeBlocks` / `reflowText`），部署前请先确认没有遗漏的调用点（`grep` 应为零命中）。

---


## 0. TL;DR（30 秒看懂现状）

- 三个学科的识别链路是：**提示词（模型）→ 服务端后处理（确定性清洗/分块）→ 前端渲染（段落化）**。
- **版面一直搞不好的根因不是某条规则写错，而是三套逻辑各自为政 + 三学科标准不统一**，并且"**共用**"是这一串 bug 的直接来源。
- **已做**：移除流式 OCR、数学补上结构化 `blocks`、英语改用 `blocks` 渲染，以及（2026-09-15）**§7 学科隔离在 `server_cf` + `web` 全部落地** —— 三学科各持一条自洽垂直链路，`profile` / `lineCleaner` / `reflowText(opts)` 三个开关型 API 已删除。
- **已做（2026-09-15 追加）**：**`server_ts` 镜像**落地 —— 本地后端同样切成 `lib/subject/{kernel,chinese,english,math}.ts`，两个路由收敛为薄委托，`isEnglish` 布尔参数删除。**只搬结构、行为保持**；`server_cf` 独有能力未随行（见 §6）。
- **下一步主线**：**部署本次隔离**（本地领先线上一个版本，隔离全程未部署）→ 见 §6。
- **未部署**：本地领先线上一个版本，见开头的代码状态表。


---

## 1. 架构：三学科链路矩阵（以代码为准）

> **2026-09-15 起，本表的每一列都由独立文件承载**：`server_cf/src/lib/subject/{chinese,english,math}.ts`。
> 「行文本清洗器」「行内空格」「首行缩进」「服务端收尾」这些**学科策略**已**内联**在各自模块里，
> 不再是"共用函数 + 参数开关"（`profile` / `lineCleaner` 已删除）。详见 §7 与契约 §5。

| 维度 | 语文 | 数学 | 英语 |
|---|---|---|---|
| 端点 | `/api/v1/ai-chinese/parse-image` | `/api/v1/ai-homework/parse-image` | 同语文 + `?mode=english` |
| 流式 | ❌ **已移除**（前端 + SSE 路由都删了） | ❌ 从来没有 | ❌ **已移除** |
| 默认引擎 | **Paddle 优先**（env `OCR_ENGINE=paddle`），失败回退豆包 | **豆包**（只有显式 `engine=paddle` 才走 PaddleOCR-VL） | **豆包优先** |
| 结构化提示词 | `DOUBAO_OCR_JSON_PROMPT` / `_NO_POLY` | `MATH_OCR_JSON_PROMPT`（失败回退纯文本 `MATH_OCR_PROMPT`） | `DOUBAO_OCR_JSON_PROMPT_EN` |
| 纯文本提示词 | `DOUBAO_OCR_PROMPT`（两段式回退） | `MATH_OCR_PROMPT` | `DOUBAO_OCR_PROMPT_EN` |
| 排版回退提示词 | `DEEPSEEK_RELAYOUT_PROMPT` | — | `DEEPSEEK_RELAYOUT_PROMPT_EN` |
| 去印刷拼音 | ✅（**仅含汉字的行**） | ❌ | ❌（英语模块**物理移除**了该步骤） |
| 多音字 `polyphones` | ✅（后台异步补 + 前端轮询回填） | ❌ | ❌ |
| 分段权威 | 服务端 `blocks` | 服务端 `blocks`（**P1 起非空**）→ 退 `splitProblemsByNumber` | 服务端 `blocks` |
| 行文本清洗器 | `cleanOcrText` | **`mathClean`**（`cleanOcrText` 会删 `□`！） | `cleanOcrText` |
| 行内空格 | trim | **保留**（竖式靠空格对齐） | trim |
| 首行缩进 | `body` 首行 `indent=1` | **不缩进** | `body` 首行 `indent=1` |
| 服务端收尾 | `finalizeChineseBlocks`（含 `markPoetry`） | `finalizeMathBlocks` | `finalizeEnglishBlocks` |
| 缓存键后缀 | `_r4` | 无 | `_en_r5` |


### 提示词里的版面硬性规则（三学科已加固）

- **通用**：逐行保真（图上有几行就输出几行，禁止合并/拆分/删行）→ 每行列数与图片严格一致
- **结构**：大标题→`title(center)`／小标题·页眉→`heading`（页码 `right`）／题目→`question`／选项→`option`／正文→`body`／旁批→`note`／表格→`table`(HTML `rowspan`/`colspan`)；**每个自然段单独一个 `body` 块，禁止多段并进同一块**
- **段落**：段与段空一行；**标题独占一行，禁止标题与正文并一行**
- **禁止改写**：不许改写/润色/总结/简化/翻译；不许调整语序
- **缩进**：`indent` 语义（`body` 首行 1、续行 0；数学一律 0）
- **数学专项**：禁止 LaTeX/HTML/markdown 标记（分数写 `a/b`、方框 `□`、横线 `____`）；**算式独占一条 line，不跟在题干后面**；竖式每行单独一条 line 且**保留行首空格**
- **英语专项**：这是英语课文不是拼音，原样保留每个英文单词，禁止当拼音/省略/合并/翻译

### 前端渲染分支（`web/src/pages/AiParseResultPage.tsx`）

| 学科 | 分段来源 | 渲染 |
|---|---|---|
| 语文 | `blocks`（`blocks.map`） | `BlockText`：**只有 `body`**（且非标题/注记/居中/右对齐）走**段落流** `buildParagraphs`（`indent≥1`=新段）+ 首行两个全角空格；其余**逐行**渲染（`indent*2em` padding） |
| 数学 | `mathDisplaySegments(blocks, questions, text)` | `body` 块（算式/竖式）→ **逐行原样 + `pre-wrap`**（`.math-line`，保列对齐）；`question` 等 → `renderMixedText(..., indent=false, breakOnFormula=true)` |
| 英语 | `enDisplaySegments(blocks, questions, text)` | `EnglishResult` → `reflowText(text, {breakOnSentence, breakBeforeTitle})` + `EnglishWordTap` 逐词点读 |

> ⚠️ `enDisplaySegments` / `mathDisplaySegments` 与 **`posMap` 标注项 / `navCount` / `sectionLabel` / 渲染循环必须共用同一份结果**，否则 `[i]` 索引错位。
> ⚠️ 这两个函数**不能写成 `useMemo`**：组件在 `if (!session) return` 之前已用完所有 hooks，早返回之后再加 hook 会触发 hook 数量不一致。

---

## 2. 缓存三层（改版面/识别质量必看）

| 层 | 位置 | 键 | 失效方式 |
|---|---|---|---|
| 服务端识别结果 | R2（`aiphonix-files`） | `parse_<sha256>_r4.json`（语文/数学）／`parse_<hash>_en_r5.json`（英语） | 改 key 版本后缀 |
| **客户端识别结果** | `localStorage["aiphonix_ocr_cache_v1"]` | `${KEY_V}:${module}:${fp}:${engine}`，**TTL 7 天**，命中即**完全绕过服务端** | 改 `KEY_V`（`web/src/lib/ocrResultCache.ts`，当前 **`v4`**） |
| 前端历史回看 | localStorage（`web/src/lib/aiHistory.ts`） | 会话条目（含 `text`/`questions`/**`blocks`**/pos/story） | 用户手动清 |

> 🔴 **铁律**：改识别质量后只 bump 服务端 key **不等于**清客户端缓存。**两处都要 bump**，否则"同一张图重新识别还是旧脏结果"（本次已因此被误导一轮）。

---

## 3. 本次会话日志（按时间顺序，含部署版本）

| # | Version | 类型 | 内容 | 触发问题 |
|---|---|---|---|---|
| 1 | `10230c0c` | 全量 | Worker 英语提示词（`*_EN`）+ web 数学算式换行 | "AI 数学算式应该另起一行" / "AI 英语不要删字母" |
| 2 | `dcc6b5c6` | Worker | 英语缓存 key → `_en_r5` | 旧英语脏缓存在 `_en_r4` 里 |
| 3 | `3fe07db3` | web | 英语结果页"整块收词"改为按**英文单词**收录 | 该按钮用语文规则（只收汉字） |
| 4 | `ad6e59bb` | web | 英语换行：标题独占一段（`breakOnSentence` + `breakBeforeTitle`） | "标题和正文挤在一行" |
| 5 | `e75dbf87` | Worker | OCR 提示词加固（段落/标题/禁止改写） | 参照"豆包版面理解"资料 |
| 6 | `54ed44a5` | 全量 | 英语改 `blocks` 渲染 + Paddle 保留空行 + 数学 `splitProblemsByNumber` + 英语豆包优先 | 版面结构与原图不一致 |
| 7 | `61c23550` | 全量 | `stripPrintedPinyin` 不再删英文正文 + 客户端缓存 `KEY_V`→`v4` | 语文卷里的英文邮件被删成标点乱码 |
| 8 | `476ea01f` | 全量 | 版面契约 P0+P1：`finalizeBlocks` 统一 + 数学补 `blocks` + 竖式逐行渲染 | "版面一直搞不好" |
| 9 | `9be8d9f2` | 全量 | **移除流式 OCR**（前端 + SSE 路由） | 用户指令 |
| 10 | **（未部署）** | 全量 | **§7 学科隔离**：服务端拆 `lib/subject/{kernel,chinese,english,math}.ts` + 前端拆 `web/src/lib/subject/*`；路由收敛为薄委托（`ai_chinese.ts` −468 行 / `ai_homework.ts` −196 行）；删除 `finalizeBlocks`(`profile`/`lineCleaner`) 与 `reflowText(opts)`；顺带删除流式遗留死代码 `incrementalJsonText.ts` + 其测试 | 用户指令「三学科不共用逻辑，各自独立」 |
| 11 | **（未部署）** | 全量 | **`server_ts` 镜像**（把 §7 的隔离结构应用到本地后端）：新建 `server_ts/src/lib/subject/{kernel,chinese,english,math}.ts`（149 / 246 / 253 / 158 行）；`ai_chinese.ts` −319 行、`ai_homework.ts` −144 行收敛为薄路由；删除 `isEnglish` 布尔参数与学科函数里的 `mode` 分支；**顺带修正 server_ts 英语付费兜底误用语文提示词**（与 server_cf 第 10 行同一处修正）。**只搬结构、行为保持**：同提示词、同流程、同缓存键 | 用户指令「按照这个开工」（把 §7 结构落到本地后端） |

### 每个部署的验证记录

- 全部：`server_cf` / `web` `tsc` exit 0；`server_ts` `npm test` **26/26**；`web` `paragraphFlow` 测试 **42/42**；oxlint 改动文件 0 error
- 线上独立验证：`/health` → `{"status":"ok","d1":"ok","r2":"ok"}`；用 `web_fetch` 抓**线上 chunk** 核对新逻辑（如 `paragraphFlow-*.js` 里的 `breakOnFormula`、`aiImage-*.js` 里的 `v4`）
- 体积基线（移除流式后）：`aiImage` 6.42→**4.42 kB**、`AiChinesePage` 5.31→**3.92**、`AiEnglishPage` 5.18→**3.80**、Worker 总 2204→**2196 KiB**

---

## 4. 根因库（8 条，可直接当 bug 清单用）

1. **数学算式跟在题干后面** → 数学提示词本就要求逐行，是**前端 `reflowText` 把算式行并回题干**。修：`breakOnFormula`（`isMathFormulaLine`：不含纯汉字 + 含运算符；纯数字不算，避免拆散竖式）。
2. **数学结果出现 `\boldsymbol \underline \quad \boxed \square`** → ① 豆包偏好 LaTeX；② `mathClean` 覆盖不全；③ 缓存放大。修：提示词**禁止 LaTeX 标记** + `mathClean` 增强（带参剥壳/无参映射/矩阵分隔符）+ **缓存读路径也清洗**。
3. **英语"字母都没了"** → 英语复用语文通道，但豆包用的是**小学语文提示词**（反复强调"汉字/拼音"），模型把英文当拼音删掉。修：英语专用提示词 + 按 `mode` 选。**不是** `stripPinyin` 的问题。
4. **英语同一张图重新识别还是旧脏结果** → **客户端 localStorage 缓存**未失效（服务端怎么修都不影响它）。修：`KEY_V` → `v4`。
5. **语文卷里夹的英文正文被删成标点乱码** → `stripPrintedPinyin` 无条件 `replace(/[A-Za-z]+/g,"")`。修：**只在该行还有汉字时才删无调拉丁段**（带声调仍走 `PINYIN_TONE_RE`）。
6. **英语标题与正文挤在一行** → Paddle 的 `text` 把空行压成单换行（`paddleOcr.ts`）+ 英语渲染扁平 `questions`。修：保留段落空行 + 英语改 `blocks` 渲染。
7. **数学 `blocks` 恒空、结构规则全部悬空** → Paddle 路径的 `po.blocks` **被直接丢弃**，豆包只出纯文本。修：Paddle 接回 `po.blocks`；豆包新增结构化提示词（失败回退纯文本）。
8. **两条重复管线（非流式 / 流式）** → 任何规则改动都要改两处（`mode=english` 门禁、英语豆包优先都改过两遍），且 **SSE 逐行协议天生传不了空行**（"段间空行"规则在流式下完全无效）。修：**整体移除流式**。

---

## 5. 坑与铁律（下一个 agent 必读）

### 代码层
1. **`cleanOcrText` 会删 `\u25a1`（□）** —— 语文无害，但**数学填空方框正是 □**。数学必须用 `mathClean`（`finalizeBlocks({ profile:"math", lineCleaner: mathClean })`）。实测：语文档位 `2. 填空：□ + 5 = 9` → `2. 填空： + 5 = 9`。
2. **`extractBlocks` 默认逐行 `.trim()`** —— 会吃掉竖式行首空格 → 数学必须 `{ keepLineSpaces: true }`。
3. **`finalizeBlocks` 的 `forceBodyIndent`** 会把顶格正文硬加 `indent=1`（中文教材正文本来就缩进，属有意取舍）。
4. **`markPoetry` 会把诗歌各行 `indent` 设为 1**，但同时设 `align="center"` → 前端居中块忽略 indent，显示无影响。
5. **`markOrderedIndent` 对数学也生效**（题号行 `indent=1`）→ 无害，数学前端忽略 `indent`。
6. **`web/tsconfig.app.json` 开了 `noUnusedLocals` + `noUnusedParameters`** → 删代码必须把导入/变量一并清干净，否则 `tsc` 直接失败。
7. **前端 `enDisplaySegments`/`mathDisplaySegments` 不是 hook**（原因见 §1 警告）。

### 流程层
8. **`deploy.ps1` 的 `[3/4] verify` 在本机必报 `[regex]::Match` null**（`curl.exe --noproxy` 返回空）→ **属既有噪声，不影响部署**；用 `web_fetch` 抓产物核对。
9. **部署前必须清代理环境变量**（`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` + 小写），否则 wrangler 连 Cloudflare `fetch failed`。
10. **本机网络受限**：DNS 到 `*.workers.dev` 被污染（Node 直连超时），`curl` 也不通 → 只能用 **`web_fetch`**（只读 GET）或 **`wrangler`**（deploy 可用）。**因此无法用脚本端到端调线上识别接口**。
11. **grep 默认受根仓库 `.gitignore` 影响**（排除 `AiPhonix/`）→ 搜 AiPhonix 内部必须显式传 `path: AiPhonix/...`。
12. **手机验证要硬刷新**（PWA SW precache）。
13. **临时脚本/测试图用完即删**（根仓库只放文档，别留产物）。本次用过 `tsx` 直连 `server_cf` 的 TS 源码做单点验证（`import "../server_cf/src/lib/xxx.js"` 可被 tsx 解析）。

### 本次（2026-09-15 隔离）新踩到的
14. **本机 `bash` 是坏的**：`PATH` 缺失，`head`/`mkdir`/`find` 全部 `command not found`（`PortableGit\...\shim` 报 `dirname: command not found`）。**一律改用 PowerShell**。
15. **PowerShell 工具的 stdout 不回传到对话**（只显示 `Command completed with exit code 0`）→ 必须 `| Out-String` / `Set-Content -Encoding UTF8` 写进临时文件，再用 Read 读回来。直接 `*>` 重定向会写成 UTF-16，Read 会报 "Cannot display content of binary file"。
16. **同一文件不要在一个消息里并批多个 Edit** —— 本次遇到过"报告 Successfully edited 但磁盘内容没变"。同一文件的多次编辑请**串行**，每次改完顺手 Read 确认。
17. **`oxlint` 在这几个文件上有 3 个**预存** error，不是回归**（改动前后都在，已用备份文件比对确认）：
    - `paragraphFlow.ts` 的 `no-control-regex`（`/\u0000(\d+)\u0000/` 占位符正则，有意为之）
    - `BlockText.tsx` 的 `rules-of-hooks` ×2（`if (!text.trim()) return null` 早返回在 hooks 之前，历史结构）
    目标基线是"**不新增 error**"，不是"清零"。
18. **`server_cf` 的 tsconfig 没开 `noUnusedLocals`**（只有 `web/tsconfig.app.json` 开了）→ `tsc` 不会因未使用导入报错，但 `oxlint` 会。删代码后要用 `oxlint` 兜一遍导入，别指望 `tsc`。
19. **用户选择"不提交直接改"时，先在仓库外做文件级备份**（本次备份到工作区 `.backup/20260915-layout-isolation/`，保留原始相对路径）—— 20+ 文件未提交的情况下这是唯一的回退点。
20. **大段删除用 Node 行切片脚本，不要手抄 `old_string`**。脚本先断言首尾行内容再替换（本次脚本 `verify` 边界后才动文件），比让模型逐字复现 400 行可靠得多。


---

## 6. 待办路线图

| 优先级 | 项 | 说明 |
|---|---|---|
| ✅ 已完成 | **`server_ts` 镜像** | 2026-09-15 完成（见 §7 ⑤）。本地后端同样切成 `lib/subject/{kernel,chinese,english,math}.ts` + 薄路由；**只搬结构、行为保持** |
| 🟠 | `server_ts` 功能对齐（≠ 隔离） | server_ts **没有** Paddle 引擎、没有 `MATH_OCR_JSON_PROMPT` / `DOUBAO_OCR_JSON_PROMPT` 那套结构化提示词、没有多音字补丁、没有去页码、没有内嵌表格提升 → 数学链 `blocks` **仍恒为空**。补齐三步：① prompts 加 JSON 提示词；② `extractBlocks` 加 `{ keepLineSpaces }`；③ `math.ts` 补 `finalizeMathBlocks` 并改二段式 |
| 🔴 **下一步主线** | **部署本次隔离** | 本地已有完整隔离（tsc 0 错 + 测试全绿），但**未部署**；部署后服务端缓存键与前端 `KEY_V` 需按 §2 铁律评估是否 bump |
| 🟡 | 统一分段（P2） | `markdownToBlocks`（按空行聚合）成为唯一服务端分段规则；前端删"并段"职责 |
| 🟡 | 前端删启发式（P3） | `isEnTitleLine` / `isMathFormulaLine` 已归位到 `web/src/lib/subject/*`，但仍是前端推导 → 改用服务端 `type` 与 `indent` |
| 🟡 | 边界场景 | 分栏 > 倾斜 > 手写 > 跨页 > 水印（目前无任何规则，全靠模型自由发挥） |
| ⚪ | 表格解析阶段不 `trim()` | 会破坏竖式；表格单元格内换行同理 |
| ⚪ | 提交 git checkpoint | 20+ 文件改动自 2026-09-11 起一直未提交，建议尽快落一个还原点（本次接手时用户明确选择"不提交直接改"，故仍然未提交） |


---

## 7. 学科隔离（用户新指令 → **2026-09-15 已执行完成**）

### 用户指令
> 「英文 数学 语文不共用逻辑 各自独立出来」

### 为什么这个方向是对的
这一路的 bug **全部源于"共用"**：

| bug | 共用什么 |
|---|---|
| 英语吃语文提示词 → 英文被删 | 语文/英语共用 `/ai-chinese/parse-image` |
| 语文"去拼音"删掉卷内英文正文 | 同一条后处理链路 |
| 数学填空 `□` 被删 | 共用 `cleanOcrText` |
| 数学要"不缩进/保竖式空格" | 被迫加 `profile` 开关才实现 |

### ✅ 执行结果（2026-09-15 已完成，服务端 + 前端）

用户 2026-09-15 拍板两件事，已按此落地：

1. **隔离粒度 = 策略独立 + 无策略内核共用**。没有选择"把 `finalizeBlocks` 复制三份"那条路，因为那会重演 §5 记录过的"两份规则漂移"。分界判据：
   > **「如果要在三个学科之间选一个值，就不该出现在共用文件里。」**
   进内核的只有三学科**必须完全一样**的机制；凡是能在学科间取不同值的，全部留在各学科模块内。
2. **`Block` schema 保留共用**（不做三份）。理由：它是**前后端通信格式**，必须一致才能渲染；隔离的是**逻辑**（清洗/分块/缩进/提示词/引擎），不是**格式**。`SubjectOcrOutcome` 同理。

**实际执行顺序与产物**

| 步骤 | 产物 |
|---|---|
| ① 拆服务端后处理 | `server_cf/src/lib/subject/kernel.ts`（无策略内核）+ `{chinese,english,math}.ts`（学科策略） |
| ② 路由收敛为薄委托 | `ai_chinese.ts` −468 行 / `ai_homework.ts` −196 行；**散布的 10 处 `mode === "english"` 判断与 `isEnglish` 传参全部消失** |
| ③ 删除开关型 API | 服务端 `finalizeBlocks` + `FinalizeOpts`（`profile` / `lineCleaner`）删除；前端 `reflowText(opts)` 删除 |
| ④ 拆前端渲染 | `web/src/lib/subject/{chinese,english,math}.ts`；`paragraphFlow.ts` 只留无策略基元 + `reflowWithBreaks(raw, breakBefore, closesAfter)` |
| ⑤ `server_ts` 同步 | ✅ **已做（2026-09-15 同日追加）**：新建 `server_ts/src/lib/subject/{kernel,chinese,english,math}.ts`（149 / 246 / 253 / 158 行）；`ai_chinese.ts` −319 行、`ai_homework.ts` −144 行收敛为薄路由；`isEnglish` 布尔参数与学科函数里的 `mode` 分支删除。**行为保持**：同提示词、同流程、同缓存键（语文 `parse_<hash>.json`、英语 `_en`），只搬结构 |

### 三条别忘的工程细节
- **`polyPatchKey` 与 `/ai-chinese/parse-polyphones` 是连体的**：补注音补丁键由语文模块导出，路由的轮询接口要用它。搬函数时容易漏，`tsc` 会抓到。
- **后台任务通过 `SubjectOcrOutcome.background` 交给路由挂 `waitUntil`**：挂载失败时路由必须把 `polyToken` 置空，否则前端会一直轮询到超时（原实现有此语义，别丢）。
- **英语的付费排版兜底顺带修正**：改造前它走的是**语文**提示词 + 中文 system，与"英语吃语文提示词→英文被删"同类。现改为 `DEEPSEEK_RELAYOUT_PROMPT_EN`。这是有意为之的修正，不是回归。


---

## 8. 接手须知：命令与文件索引

### 验证命令

> 2026-09-15 隔离后的实测基线（全绿，可当回归基准）：`web` tsc **exit 0** + paragraphFlow **42/42**；`server_cf` tsc **exit 0** + npm test **49/49**；`server_ts` tsc **exit 0** + npm test **26/26**；`oxlint` 改动文件 **0 新增 error**。
>
> ⚠️ **跑 `server_ts` 的测试必须用系统 Node 24**（`C:\Program Files\nodejs\node.exe`）。`better-sqlite3` 是本机 Node 24 编的（`NODE_MODULE_VERSION 137`），用受管 Node 22（127）会报 `was compiled against a different Node.js version`，表现为"22 个测试里挂 1 个"。这不是代码问题。

```powershell
# 前端类型 + 版面单测（42 个）
cd AiPhonix\web; npx tsc -b; npx tsx --test src/lib/paragraphFlow.test.ts

# 生产 Worker 类型 + 测试（49 个）
cd AiPhonix\server_cf; npx tsc --noEmit; npm test

# 本地后端类型 + 测试（⚠️ 测试要用系统 Node 24，见上）
cd AiPhonix\server_ts; npx tsc --noEmit; npm test

# 只 lint 改动文件（全量 lint 会被 dist_* 产物淹没）
# ⚠️ 既有 3 个预存 error（见 §5.17），基线是"不新增"
cd AiPhonix\server_cf; npx oxlint src/lib/subject src/routes/ai_chinese.ts src/routes/ai_homework.ts src/lib/aiTextUtils.ts
cd AiPhonix\web; npx oxlint src/lib/subject src/lib/paragraphFlow.ts src/pages/AiParseResultPage.tsx src/components/BlockText.tsx
```

### 部署（**串行，禁止裸 wrangler**）
```powershell
$env:HTTP_PROXY=$null; $env:HTTPS_PROXY=$null; $env:ALL_PROXY=$null
$env:http_proxy=$null; $env:https_proxy=$null; $env:all_proxy=$null
cd AiPhonix\server_cf
& .\scripts\deploy.ps1              # 全量（Worker + web 资产）
& .\scripts\deploy.ps1 -SkipWeb     # 只 Worker（改了提示词/后处理）
& .\scripts\deploy_web.ps1          # 只前端（改了 web/）
& .\scripts\deploy.ps1 -Env staging # staging（改代码先验证，不打线上）
```

### 关键文件索引
| 关注点 | 文件 |
|---|---|
| 版面契约（Block schema / 段落定义 / 元规则 / 废弃项） | `docs/layout-contract.md` |
| **★ 无策略内核（服务端）** —— 三学科必须完全一样的机制都在这 | `server_cf/src/lib/subject/kernel.ts` |
| **★ 语文学科链路**（Paddle 优先 / 去拼音 / 多音字 / 缓存键 / 分题） | `server_cf/src/lib/subject/chinese.ts` |
| **★ 英语学科链路**（豆包优先 / `*_EN` 提示词 / 不去拼音） | `server_cf/src/lib/subject/english.ts` |
| **★ 数学学科链路**（`mathClean` / 保竖式空格 / 仅显式 paddle） | `server_cf/src/lib/subject/math.ts` |
| **★ 无策略渲染内核（前端）** —— `reflowWithBreaks` + 文本/表格基元 | `web/src/lib/paragraphFlow.ts` |
| **★ 前端三学科渲染策略** | `web/src/lib/subject/{chinese,english,math}.ts` |
| 结果页（三学科渲染分支、分段索引对齐） | `web/src/pages/AiParseResultPage.tsx` |
| 语文 Block 渲染器（段落流 + 首行全角空格） | `web/src/components/BlockText.tsx` |
| 客户端 OCR 结果缓存（`KEY_V`） | `web/src/lib/ocrResultCache.ts` |
| 识别客户端（`parseImage`，流式已删） | `web/src/services/aiImage.ts` |
| 三学科提示词 | `server_cf/src/lib/prompts.ts` |
| 后处理通用原语（`extractBlocks` / `cleanOcrText` / `markdownToBlocks` …） | `server_cf/src/lib/aiTextUtils.ts` |
| 语文/英语路由（**已是薄路由**，只做机制） | `server_cf/src/routes/ai_chinese.ts` |
| 数学路由（**已是薄路由**） | `server_cf/src/routes/ai_homework.ts` |
| **★ `server_ts` 镜像（本地后端）** —— 与 `server_cf` 同构、更薄 | `server_ts/src/lib/subject/{kernel,chinese,english,math}.ts` |
| `server_ts` 薄路由（本地后端） | `server_ts/src/routes/{ai_chinese,ai_homework}.ts` |
| 两端契约漂移护栏（zod schema 指纹比对） | `server_ts/tests/contractParity.test.ts` |
| Paddle markdown → blocks | `server_cf/src/lib/paddleMarkdown.ts` |
| 项目总记忆（部署史/环境/坑） | `PROJECT_MEMORY.md` |


### 线上环境
- Worker **`aiphonix-api`** @ `https://aiphonix-api.xinyi7lan.workers.dev`（Web 挂在 `/web/`，与 Worker 同源原子部署）
- 绑定：`env.DB`(D1 `aiphonix-db`)、`env.FILES`(R2 `aiphonix-files`)、`env.ASSETS`、`env.ARK_VISION_MODEL=doubao-seed-2-1-turbo-260628`、`env.OCR_ENGINE=paddle`
- 测试账号：`webtest / test1234`（user_id=45）
- 健康检查：`GET /health` → `{"status":"ok","d1":"ok","r2":"ok"}`
