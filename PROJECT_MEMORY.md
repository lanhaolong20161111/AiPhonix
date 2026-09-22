# AiPhonix 项目记忆（通用交接文档）

> 供任何 coding agent 读取的完整项目上下文。生成日期：2026-08-17（最后更新：2026-09-22）。
> 整合自 `AGENTS.md`、历史 `memory-export-*.md` / `SESSION_HANDOFF_*.md` 及最近会话的进展。

---

## 0.5 🆕 2026-09-22 Android 端重启：对齐 Web 功能（批次A + 批次B 完成）

### 背景
- Android `app/` 自 2026-09-10 起标注「停更存档」（`f7843b7`），期间 Web 端持续演进，新增大量模块。
- 本轮任务：**把 Android 功能补全对齐 Web**。完整差距清单与实施批次见 **`docs/ANDROID_PARITY_PLAN.md`**（新增，必读）。
- 提交：`2ed3d99`（拼音表/AI历史/AI英语）、`b90811a`（评测历史）、`64f03ac`（批次A 文档+记忆）。均只改 `app/`，`assembleDebug` BUILD SUCCESSFUL（APK 35MB）。
- 本轮（批次B）为**同一任务继续**：从「生词本」起补 5 个模块，遵循同一套「Repository + ViewModel + Screen」骨架。

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

### 批次B 顺手修掉的真实 bug（生产影响，重要）
- **`type` vs `type_` 参数名不一致 ⇒ 过滤被静默忽略**：服务端 `char_images.ts`（`server_cf` 与 `server_ts`）读的是 `c.req.query("type")`，但 web `services/charImages.ts` 与 Android `CharImageViewModel` 都传 **`type_`**。生产实测（走代理 + 浏览器 UA）：`type=认` → **816** 条，`type_=认` → **3028** 条（全量）；`三年级上&type=认` → **173**，`type_=认` → **1407**。后果是「识字表/写字表/词语表」显示同一份混合内容。**Android 侧已修**（`CharImageViewModel` 两处 `type_=` → `type=`，带 ⚠️ 注释）。⚠️ **web 侧尚未修**（`web/src/services/charImages.ts` 的 `qs.set("type_", …)` 要改成 `qs.set("type", …)`），需**单独一次 web 构建 + 部署**，不在本轮范围。
- **web `CharMapPage.TYPE_LABEL` 是过期词表**：写的是 `字/词/句`，但生产 3028 条实测分布是 **认 816 / 写 748 / 词 729 / 英词 533 / 英句 202** ⇒ 与 Android `CharImageList.type_` 词表**完全一致**，汉字地图可**直接透传 `type`、无需映射**。Android 的 `TYPE_LABEL` 已按真实数据定为 `认→识字表 / 写→写字表 / 词→词语表 / 英词→英语词汇表 / 英句→英语句子表`。

### 关键坑（避免重走）
0. **★ 写工具函数前先 `grep -rn "fun xxx"`**：本项目同一逻辑常有 2–3 份实现。本轮我新写的 `util/PinyinText.kt`（`normalizePinyin` + `TONE_CHAR_MAP`）其实 `data/chinesepractice/PinyinPart.kt` **早已有同名同逻辑**，`data/userimport/ImportProcessor.kt` 还有第三份；最终删掉我的重复份、改 `import ...chinesepractice.normalizePinyin` 复用。**构建警告会暴露这类死代码**（`Warning: 'normalizePinyin' is never used`）—— 别只顾着消警告，先想「是不是已有实现」。
0b. **★ 单测期望值必须取自「另一个真实实现」**：Android 的 `toBaiduSyllable` / `highlightJoyText` 的单测期望值，是用 `npx tsx` 跑 **web 真实实现**（`web/src/lib/ttsPinyin.ts`、`web/src/services/joy.ts`）逐项打印出来的，**不要自己推导**（否则等于自己实现自己验）。详见 `app/src/test/.../data/tts/BaiduSyllableTest.kt`、`data/joy/JoyHighlightTest.kt`（各 7 用例，全绿）。
0c. **写探测/冒烟脚本落 `.mjs` 文件再跑**：bash 内联 `node -e "...中文..."` 会被 shell 吃引号（报 `SyntaxError: missing ) after argument list`，输出里还会出现 `./ _` 这类诡异内容，看着像命令被执行）。落文件 + 命令行传参才可靠。
0d. **bash 里的 `/tmp` 是 `C:\tmp`**（MSYS 挂载语义），Node **读不到**；临时文件写 `C:/Users/lhl20/AppData/Local/Temp/`。
1. **`TtsEngine` 只适合英语**（系统 TTS 用 Locale.US/UK，回退百度 speaker 106/5118）。中文朗读一律用 `BaiduTtsCache.play(text, "0")`。
2. **`/soe/records` 查询无鉴权**，必须显式传 `user_id`，否则返回**全站**记录。
3. **`AiHistoryStore` 只存 `AiHistoryTurn`**（data 层），UI 层的 `AiEnglishTurn` 需先转换（`AiHistoryTurn(role, content)`），别直接塞。
4. 拼音表数据**不要手改** `PinyinTableData.kt`；改数据请改 web 的 `pinyinTable.ts` 后重新生成。
5. 生成脚本用 Node 时注意：TS 有类型标注（`export const X: PinyinItem[] = [`），按 `=` 后再找 `[` 做括号匹配，别匹配到 `PinyinItem[]` 的空括号（**偏旁字族脚本同样踩这个坑**）。
6. **`char-images` 的 query 参数名是 `type`（不是 `type_`）**，传 `type_` 会被服务端**静默忽略**并返回全量（详见「批次B 顺手修掉的真实 bug」）。**web 侧还带着这个 bug**。
7. **`/char-images/feedback` 的唯一键含 (grade, semester, type)**：同一个字跨年级/类型存**多行**，服务端按 `timestamp` **倒序**返回 ⇒ **首次见到即为最新**。Android 按意图取最新；web 是「倒序遍历后写覆盖」= 取**最旧**（笔误）。这是**有意保留的差异**，别去「对齐」web。
8. **单字音频 `/tts/char/:char?synthesize=1&pinyin=hao3`** 需鉴权（`requireAuth()`），且 `pinyin` 必须是**数字调**格式（服务端 `SYLLABLE_RE = /^[a-z]{1,6}[1-5]$/`）。百度 TTS 对「字（无声调）」会把拼音字母当字面内容念出来 ⇒ 拿不到声调时 `toBaiduSyllable` **返回 `""` 宁可不注音**，绝不返回 `"zhong"` 这种半成品（偏旁字族里 3/117 个轻声字如 `ma`/`ba`/`men` 就属此类）。
9. **`BaiduTtsCache.stopAll()` 兼作「停止」与「释放 activePlayer」**：`playRemote` 前调一次即可实现「新读音打断旧读音」；但它**没有完成回调**，需要清 UI 高亮时得自己 `delay(≈1800)` 兜底。
10. **Compose `items(count, key)` 的 key 必须全局唯一**：汉字地图有多年级重复字 ⇒ 用 `"${g.key}#$idx#${cell.char}"`。
11. **共享 OkHttp `NetworkModule.httpClient` 的 readTimeout 已是 180s**，LLM 的 40s/90s 调用**直接用共享 client**，不必再 `createHttpClient` 派生。
12. `scripts/` 在 `.gitignore` 里（「# Temp scripts → scripts/」）⇒ **新写的生成脚本不会被提交**（已跟踪的老脚本仍在库里）。生成物 `.kt` 必须提交，且文档要写清生成脚本路径。

### 剩余（批次C，共 7 模块 + 2 待核对）
AI 对话学语文、AI 英语对话、课件库、每日语文、每日英语、综合算式动画、字幕采集（C）；家长报告完整度核对、注册页是否已含在登录页核对。
其中**综合算式动画**（Compose 重写飞入/转移动画，预计一整轮）与**字幕采集**（视频帧框选 + 区域 OCR，预计一整轮）难度最高。
另有遗留：Android 端生词本「点读自动收录」尚未接线（`WordbookRepository.add/addMany` 已实现但无调用方）。
⚠️ 待办（不属于 app 范围）：修 `web/src/services/charImages.ts` 的 `type_` → `type`，需单独一次 web 构建 + 部署。

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
