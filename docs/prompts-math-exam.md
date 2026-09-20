# 数学试卷识别提示词（规格 → 现状 → 适配稿）

> 用途：小学数学**试卷**照片 → 结构化 `blocks`（type/align/indent/lines）。
> 代码位置：`server_cf/src/lib/prompts.ts` 的 `MATH_OCR_JSON_PROMPT`
> 调用链：`routes/ai_homework.ts` → `lib/subject/math.ts` 的 `runMathOcr()` → `finalizeMathBlocks()`

---

## 1. 规格原文（2026-09-15 用户给出）

1. **逐行底线**：每个块内的 `lines` 严格对应原图物理行，有几行输出几条，禁止合并、拆分行。
2. **结构分类（type）**：
   - 试卷主标题 → `title`，align=center
   - 学年标题、考试时间、大题标题 → `heading`，align 对应原图（center/left）
   - 计分表格 → `table`，内容用标准 HTML 保留行列、合并单元格
   - 每道小题的题干 → `question`，align=left
   - 单个选项（A/B/C/D） → `option`，indent=1，align=left
   - 配图标注、旁注文字 → `note`，align 对应原图位置
   - 页眉密级、普通说明文字 → `body`，align 对应原图
   - 页脚页码行 → `foot`，align=center
3. **缩进**：首行顶格的块 indent=0；选项统一缩进 indent=1，和原图视觉对齐。
4. **间隔**：大题之间、小题之间的空行，对应保留空 line 或块间隔。
5. **内容红线**：所有数字、符号、单位、括号原样输出；禁止 LaTeX、Markdown 文本标记；禁止改写、润色、删减。

---

## 2. 现行提示词（代码原文，2026-09-15）

### `MATH_OCR_JSON_PROMPT`（结构化主路径，豆包多模态）

```
任务：精确识别小学数学课本/作业照片，原样还原全部文字、数字、算式、填空横线，按结构直接输出 JSON（一步完成，不需两步）。
【第一步·先看整体】先判断图片方向：横放/倒置/倾斜先在脑中纠正到正向，再按正向读。
【核心硬性规则——逐行保真】
1. 图片上有几行文字，lines 里就输出几条；每行单独一条，禁止合并/拆分/删行。
2. 每行的字符必须与图片严格一致：数字、运算符、字母、单位、标点、括号、下划线、□、√、①②等一个不漏，也不得多字。
3. 竖式计算的每一行（含进位/借位小字、横线、结果）都单独输出一条 line，并**保留每行前面的空格**（竖式靠空格对齐，禁止压缩空格）。
4. 图片里空着的方框/横线按原样保留（方框写 □，填空横线写 ____），不要脑补答案、不要做题。
5. 算式**独占一条 line**，不要跟在题干文字后面。
【禁止格式标记】禁止输出任何 LaTeX/HTML/markdown 标记（如 \frac、\boldsymbol、\underline、\boxed、\quad、\square、\times 等一律不许出现）。分数写成 a/b，方框写 □，填空横线写 ____。
【结构分类】按阅读顺序整理成 blocks：
- 大标题（如「第一单元 练习一」）→ type=title（align=center）
- 小标题（如「一、计算下面各题」「二、填空」）→ heading
- 题目题干→question；可选项（A./B./C. 或 ①/②/③）→option 单独成块
- 算式、竖式、计算过程→body（一个 body 块放同一道题的算式/竖式，块内逐行保真）
- 旁批/注脚/提示→note
【indent】数学一律 indent=0（不缩进）；竖式各行也不要加缩进，靠行内空格对齐。
【不要重复输出】不要写 text 字段——块的全文就是 lines 逐行拼接的结果。
【输出】只输出一个 JSON，不要任何解释、不要 markdown 包裹：
{"blocks":[{"type":"title|heading|body|question|option|note","align":"left|center|right","lines":[{"text":"行","indent":0}]}]}
【最后自检】输出前数一遍：lines 总行数是否与图片一致，每个算式是否独占一行。
```

### `MATH_OCR_PROMPT`（纯文本回退路径）

```
任务：精确识别小学数学课本照片，原样还原课本全部文字、数字、算式、填空横线，区分标题、例题、对话框、竖式计算，不要脑补答案，图片里面空着的方框、横线就原样保留为空。
【逐行保真】图片上有几行文字就输出几行，禁止合并/拆分/删行；每行字符数与图片一致。
【禁止格式标记】禁止输出任何 LaTeX/HTML/markdown 标记（如 \frac、\boldsymbol、\underline、\boxed、\quad、\square、\times 等一律不许出现）。算式全部用普通文本：分数写成 a/b，方框写成 □，填空横线写成 ____，空格用普通空格。
【版面结构】保留原图的段落划分与空行；题目和它的算式**分行输出**——算式另起一行，不要跟在题目文字后面。
只输出识别文本本身，不要解释、不要做题。
```

---

## 3. 你的规格 vs 现状：5 处冲突 / 缺口

| # | 你的规则 | 现状 | 证据 |
|---|---|---|---|
| 1 | `type=foot`（页脚页码行） | ❌ **不存在这个类型**，会被静默压成 `body` | `subject/kernel.ts:37` `BLOCK_TYPES=["title","heading","body","question","option","note","table"]`，`normType()` 越界回退 `body` |
| 2 | 选项 `indent=1` | ⚠️ 提示词写的是「**数学一律 indent=0**」，**直接矛盾** | `prompts.ts:327` |
| 3 | `align` 按原图（center/left） | ❌ **数学页前端根本不读 align**，模型输出什么都被丢掉 | `web/src/pages/AiParseResultPage.tsx:437` `mathDisplaySegments()` 只保留 `{text,type}`；渲染 `renderMixedText(seg.text,"recog_math",false,mathReflow,i)` 固定不缩进 |
| 4 | 空行「保留空 line」 | ❌ **块内空行必被删除**，不可能实现 | `subject/math.ts:95` `if (!lt.trim()) return null` → 空行直接丢弃。「或块间隔」这半句可以满足，用块边界表达 |
| 5 | 表格 `table` 用标准 HTML | ⚠️ 类型和渲染**都已支持**，但**数学提示词里一个字都没提表格**；且同一份提示词写着「禁止任何 HTML 标记」，需要开豁免口子 | `BLOCK_TYPES` 含 `table`；前端 `safeHtml.ts` 白名单含 `table/thead/tbody/tfoot/caption`，`SplitInlineTables`→`SpeakableTable` 可渲染；但 `prompts.ts:320` 是全局禁 HTML |

**另外两个隐藏坑：**

- **`markOrderedIndent` 会把题号行强制抬到 indent=1**（`aiTextUtils.ts:289`，三学科共用、数学也生效）。这和你「首行顶格=0」冲突 —— 但和「选项 indent=1」方向一致。当前数学页因为前端不读 indent，所以这个抬升**没有任何可见效果**；一旦前端开始尊重 indent，它就会显形。
- **数学缓存键没有版本后缀**（`MATH_CACHE_DIR/parse_<sha256>.json`，与语文 `_r5`／英语 `_en_r6` 不同）。改提示词后，**旧图仍会命中旧缓存**，新提示词只对新图生效。

---

## 4. 适配稿（可直接替换 `MATH_OCR_JSON_PROMPT`）

> ⚠️ 粘进 `prompts.ts` 的模板字面量时，`\frac` 等示例要双写反斜杠（`\\frac`）。
> 已保留既有硬规则：竖式保空格、算式独占行、不脑补答案、不输出 text 字段。

```
任务：精确识别小学数学试卷照片，逐行保真转录，并按指定结构直接输出 JSON（一步完成，不需两步）。
【第一步·先看整体】先判断图片方向：横放/倒置/倾斜先在脑中纠正到正向，再按正向读。

【红线一·逐行保真】图片上有几行文字，lines 里就输出几条；每行单独一条，禁止合并、拆分、删行、增字。
每行字符必须与图片严格一致：数字、运算符、字母、单位、标点、括号、下划线、方框、√、①②、°、%、元角分、cm/m/kg 等一个不漏，也不得多字。
竖式计算的每一行（含进位/借位小字、横线、结果）都单独输出一条 line，并**保留每行前面的空格**（竖式靠空格对齐，禁止压缩空格）。
算式**独占一条 line**，不要跟在题干文字后面。

【红线二·原样保留，禁止作答】图片里空着的方框/横线按原样保留（方框写 □，填空横线写 ____），不要脑补答案、不要做题、不要补全。
卷面所有数字、符号、单位、括号、标点原样照抄；禁止改写、润色、缩写、删减。分数写成 a/b（不许 LaTeX），小数与带分数按原样。

【红线三·禁止格式标记】除 table 块（见下）外，禁止输出任何 LaTeX / HTML / markdown 标记（如 \frac、\boldsymbol、\underline、\boxed、\quad、\square、\times、**、## 等一律不许出现）。填空横线写 ____（半角下划线），方框写 □，空格用普通空格。

【结构分类】按阅读顺序把整页整理成 blocks，type 只能取下列之一：
- 试卷主标题（如「三年级数学下册期中测试卷」）→ title，align=center
- 学年标题、考试时间、大题标题（「一、直接写出得数」）→ heading，align 按原图（原图居中就 center，靠左就 left）
- 计分表/成绩表/统计表 → table。**这是唯一允许出现 HTML 标记的块**：内容用标准 HTML <table> 输出，<tr>/<td> 完整还原行列结构，合并单元格用 rowspan/colspan，禁止用 markdown 竖线表
- 每道小题的题干 → question，align=left
- 单个选项（A. / B. / C. / D. 或 ① ② ③）→ option，indent=1，align=left
- 配图标注、旁注、旁批、卷面提示文字 → note，align 按原图位置
- 页眉密级、一般说明文字、算式、竖式、计算过程 → body，align 按原图
- 页脚页码行（如「第 1 页 共 4 页」「- 1 -」）→ foot，align=center

【indent】首行顶格的块 indent=0；选项统一 indent=1（与原图视觉对齐）。竖式各行**不加缩进**，一律靠行内空格对齐。indent 只取 0 或 1。

【间隔】大题之间、小题之间的空行用「另起一个 block」表达，不要输出空的 lines 行。同一道题的题干与其算式/竖式可合并在同一个 body 块内逐行保真；不同题目一律分块。

【不要重复输出】不要写 text 字段——块的全文就是 lines 逐行拼接的结果。
【输出】只输出一个 JSON，不要任何解释、不要 markdown 包裹：
{"blocks":[{"type":"title|heading|table|question|option|note|body|foot","align":"left|center|right","lines":[{"text":"行","indent":0}]}]}
table 块例外：lines 只有一条，其 text 为完整的 HTML 表格字符串。
【最后自检】输出前数一遍：lines 总行数是否与图片一致；每个算式是否独占一行；空着的方框/横线是否都保留；有没有混进 LaTeX。
```

---

## 5. 落地清单（**2026-09-15 全部已落地并上线**）

| 优先级 | 改动 | 文件 | 状态 |
|---|---|---|---|
| **P0** | `BLOCK_TYPES` 加 `"foot"`（`markOrderedIndent` / `markPoetry` 的跳过名单同步加 `foot`） | `server_cf/src/lib/subject/kernel.ts`、`aiTextUtils.ts` | ✅ 已落地 |
| **P0** | 数学提示词换成第 4 节适配稿（含 foot 专用规则段） | `server_cf/src/lib/prompts.ts` | ✅ 已落地 |
| **P0** | **服务端页脚归一化** `markFooterBlock()`：末块命中页脚形态 → 改判 `foot`+center | `server_cf/src/lib/subject/math.ts` | ✅ 已落地（见 §7 的原因） |
| **P1** | 前端数学路径尊重 `align` / 逐行 `indent`；分段逻辑抽到 `web/src/lib/mathDisplay.ts` + 10 例单测 | `web/src/lib/mathDisplay.ts`、`pages/AiParseResultPage.tsx` | ✅ 已落地 |
| **P1** | 数学档位跳过 `finishBlocks()`（不再抬题号行缩进），只保留 `mergeMarkdownTableBlocks` | `server_cf/src/lib/subject/math.ts` | ✅ 已落地 |
| **P2** | 数学缓存加版本后缀 `MATH_CACHE_SUFFIX` | `server_cf/src/lib/subject/math.ts` | ✅ 已落地（现 `_r2`） |
| **P2** | 实测 `table` 块端到端 | — | ✅ 已实测（见 §7） |

> 注：数学的试卷 / 作业 / 课本**共用同一条提示词**，本次按用户选择「全量落地」直接替换，
> 未新增 `mode=exam` 分支。

---

## 6. 实施要点（踩过的坑）

1. **提示词模板字面量里禁止裸反引号**：在 `prompts.ts` 的 `` `...` `` 里写 `` `type=foot` `` 会**截断模板字符串**，
   报错是 esbuild 的 `Expected ";" but found "type"`（tsc `--noEmit` 也拦不住，因为它只报语法位置）。
   写 `type=foot` 或改用「」，别用反引号。
2. **改后处理必须 bump 缓存后缀**：`MATH_CACHE_SUFFIX` 从 `_r1` 到 `_r2` 就是因为加了 `markFooterBlock`。
3. **前端分段函数抽成 lib**：`mathDisplaySegments` 以前埋在页面组件里（不可测），
   现在在 `lib/mathDisplay.ts`，`align`/`indent`/`isTableSeg` 都有护栏测试。
4. `.math-line` 的行级缩进用 `paddingInlineStart`（块级盒），**不要用 `text-indent`**
   —— 语文那边踩过「text-indent 把每个行内字盒撑宽 2em」的坑。

---

## 7. 线上实测结论（2026-09-15，豆包多模态，合成试卷图）

实测脚本：`_math_exam_probe.py`（本地、非入库；合成一张含主标题/学年/考试时间/计分表/大题标题/
小题/ABCD 选项/竖式/页脚页码的试卷，打 `POST /api/v1/ai-homework/parse-image?no_cache=true`）。

实测输出（17 块，HTTP 200 / 约 14–15s）：

| 期望 | 实测 | 备注 |
|---|---|---|
| 主标题 → `title` center | ✅ 1 块 | 首版曾把「学年+时间」并进 title 的 3 行，提示词加「只有主标题进 title」后修正为独立块 |
| 学年/考试时间 → `heading` center | ✅ 各 1 块 | |
| 大题标题 → `heading` left | ✅ 3 块 | |
| 计分表 → `table` + HTML | ✅ `<table><tr><td>题号</td>…<td>得分</td><td></td>…` | **空单元格保留、行列完整** |
| 小题题干 → `question` left | ✅ | |
| 选项 → `option` indent=1 | ✅ 全 4 块 indent=1 | |
| 竖式 → `body` 逐行 + 行首空格 | ✅ 4 行，前导空格保留 | 「  4 5 / + 2 7 / ------ /  7 2」 |
| 页脚页码 → `foot` center | ✅（**靠服务端归一化**） | 见下 |

### ⚠️ 关键发现：模型不会输出 `foot`

连续 **3 次**实测（含把页码行规则提升为独立段落、点名「页码行被写成 body 是最常见错误」、
并在最后自检里加了这条），豆包始终把「第 1 页 共 4 页」输出为 `body` + `align=center`。
页脚形态是**可确定性判定**的，与其继续加提示词，不如服务端兜底：
`markFooterBlock()` 只检查**最后一个块**（避免正文里「1 / 2」「第 1 页」被误判），
命中 `第N页[ 共M页]` / `共M页` / `N/M` / `-N-` 就改判 `foot`+center。已单测覆盖 6 例。

**结论：不要指望提示词解决一切 —— 结构里凡"形态可判定"的部分，都要在服务端用规则兜一遍。**

