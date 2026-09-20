# AiPhonix 版面契约（Layout Contract）

> 目的：把「版面」从**三套各自为政的规则**（提示词 / 服务端后处理 / 前端渲染）收敛成**一份契约 + 单一权威**。
> 背景：语文相对稳，是因为它的三套规则对齐度最高；数学最差，是因为 `blocks` 恒空、结构规则无处承载；英语次差，是因为复用接口导致规则串味 + 前端二次推导。

---

## 0. 术语与基准

> 本节 2026-09-15 落笔。来源：对「5 项待确认规则」逐条核对代码（结论见 §0.5 与 §8）。
> **作用**：把此前只存在于**提示词自然语言**与**后处理实现**里的口径写成明文 —— 这些规则一直在生效，只是从没被写下来，所以新人（或模型）很容易按"合理"改掉它们。
> 除 **§0.5 待定项**外均为定稿；改动本节须同步检查 §2 / §6 的相关表述。（2026-09-15：§0.5 第 1 项已闭环，仅剩第 2 项与新增的括号填空位待办。）

### 0.1 `line` = 读图阶段的视觉物理行

`BlockLine.text` 只有**一个**口径：**模型读图时在图片上看到的视觉物理行** —— 图片上有几行文字，就输出几条 `line`。

- 判据在提示词层（`lib/prompts.ts`）：自然语言「图片上有几行文字，你就输出几条 line」+ 自检「数一遍总行数是否与图片一致」。
- 它属于**读图阶段**要求，目的**只有一个**：防模型为求"干净"而合并行 → 漏字。

**允许的改写（白名单，仅此四处）** —— 读图之后刻意破坏「`lines` 条数 = 图片行数」的地方：

| # | 位置 | 现象 | 性质 |
|---|---|---|---|
| 1 | 拼音转录 | 提示词要求拼音行与汉字行**各自独立成一条 `line`** → 1 个视觉行带 = **2 条** `line` | 有意：合并会丢字 |
| 2 | 语文去印刷拼音 | `stripPrintedPinyin` 整行删拼音行 → `lines` 总数 **<** 图片行数 | 有意：读音改由 `polyphones` 重生（§6-2） |
| 3 | 表格折叠 | `table` 块 `lines` **只放一条**，整张表 N 行折叠进 `text` 的 HTML | 有意：表格结构优先（§0.2） |
| 4 | 前端并段 | `body` 物理行按 `indent` 并回语义段落，再交浏览器折行 | 有意：§2 元规则 1 |

**两条推论**

1. **渲染行 ≠ `line`。** 屏幕上的一行是浏览器折行的结果，**不得反噬**读图阶段的行数保真 —— 不能因为"反正前端会并段"就放任模型合并行。
2. 反之，`line` 条数 **≠** 图片行数也**不是 bug**，只要改写落在上表四处之内。

⚠️ 除上表以外，任何新增的「改变 `lines` 条数」逻辑**必须先在本表登记**，否则视为破坏行数保真。

### 0.2 优先级表

两条规则冲突时，按 **左 > 右** 裁决：

| 冲突对 | 裁决 | 现状 |
|---|---|---|
| 表格结构 vs 逐行规则 | **表格结构 > 逐行规则** | 隐式：靠 `hoistHtmlTableBlocks` + `table` 块 `lines` 只放一条"碰巧"成立，此前**无明文** |
| `align` vs `indent` | **`align` > `indent`** | 隐式：居中块忽略 `indent` 且不走段落流（§6-3） |
| 读图口径 vs 原文零改写 | **读图口径 > 原文零改写** | 去印刷拼音、去页码等：为读音/版面正确，允许偏离原图字面 |
| 渲染口径 vs 版面美观 | **渲染口径 > 版面美观** | 如 §6-1 强制 `body` 首行缩进，代价是顶格排版（公告体）也被加缩进 |

### 0.3 元素分类表

把数学既有的「禁止格式标记」规定**提升为三学科通用**，取代此前零散的"一个不漏"清单（`prompts.ts:9/26/57/99/115/316`）：

| 元素 | 归一化写法 | 渲染方式 |
|---|---|---|
| 汉字 | 原字 | 逐字可点读（`.block-char`，**`display:inline`**） |
| 印刷拼音 | 转录成独立 `line` | **语文：删除**（读音走 `polyphones` 字符级注音）；英语：不去拼音 |
| 拼音字母 / 声调 | ASCII 字母 + 声调符号，原样 | 原样 |
| 标点 | 原样（全角/半角**不互转**） | 原样 |
| 括号 | 原样 | 保留「（　）」填空位（`tidyInlineSpaces` 先占位、后还原） |
| 数字 | 原样 | 原样 |
| 填空方框 `□` | `□`，**禁止被任何清洗器删除** | 原样（数学专有坑，见 §6-6） |
| 填空横线 | 提示词要求 `____`，禁 LaTeX、禁写成 `a/b` | **留**（2026-09-15 拍板；见 §0.5） |
| 判断符号 `√` `×` | 原样 | 原样 |
| 圈号 `①` `②` | 原样 | 前导序号行 `indent=1`（`markOrderedIndent`） |
| 算式 / 竖式 | 原样，**保留行首空格** | **逐行 `pre-wrap`**：不折行、不 trim（§4 数学专项） |
| 数学禁用的格式标记 | 不产出 LaTeX / HTML / markdown（`prompts.ts:303` 有枚举） | — |

### 0.4 量化边界

**原则：「量化放在哪一层」本身就是契约的一部分。**

**允许的量化**

| 量 | 值 | 层 |
|---|---|---|
| `indent` | 语义层级 `0~3`，**不直接等于空格数**（§1） | 服务端 |
| 渲染缩进 | 1 级 = `2em` | 前端渲染层（常数，非数据） |
| `body` 首行缩进 | 两个全角空格 `\u3000\u3000` | 前端渲染层 |

> ⚠️ 现状**两套机制并存**：`BlockText.tsx` 用 `indent * 2em` padding；`body` 段落流用两个全角空格。二者服务于不同块类型，属现存实现 —— 但**数值只能取自上表**，不得在别处硬编码。

**明确不做的量化（及理由）**

| 不做 | 理由 |
|---|---|
| 物理长度 / 像素 / cm / DPI | 链路里**没有物理尺度信息**：`bbox` 恒 `null`（§1 约定 4），模型也不测量 |
| 「1cm 横线 → 5 个下划线」 | 同上 —— 让模型报这个数**只能是猜**，必然不稳 |
| 下划线条数 → 宽度映射 | 正确落点是**渲染层**（固定宽度 CSS / 占位符组件），**不是数据层** |
| 拼音与汉字的**位置**对齐 | 无 `bbox` 无从对齐；语文已改字符级注音（`pinyinValue.ts`），英语不做 |

### 0.5 待定项

1. **填空横线「留 or 删」** —— ✅ **2026-09-15 拍板为「留」并已实施**（见下方提案）。原始分歧保留记录：

   ⚠️ **影响面（2026-09-15 实测修正，此前判断有误）**：这些删除**只作用于响应的 `text` 字段**
   （→ 题目拆分 `splitQuestions`、整块问答上下文、blocks 为空时的兜底文本）。
   **渲染用的 `blocks.lines` 根本不经过 `stripQuestionNoise`** —— 它走 `cleanBookScanText` /
   `cleanBookScanBlocks`，只去印刷拼音与页码（`aiTextUtils.ts:678`）。
   所以此前"填空横线在版面上消失"的说法**不准确**：版面上它一直以**裸露的下划线串**存在，
   且每个 `_` 都是可点读的字盒。真正的病灶是**两处而非一处**：

   | 侧 | 实际症状 |
   |---|---|
   | `text` | 填空信息**丢失**（分句/问答上下文里 `____` 被吃掉） |
   | `blocks` | `____` 被当**普通字符串逐字渲染** —— 难看、可逐字点读、会被当成生字 |

   改动**前**的分歧（三学科不一致）：

   | 侧 | 行为 | 出处 |
   |---|---|---|
   | 提示词（三学科一致） | 「空白的填空横线按原样输出下划线，保留该行空格位置」 | `prompts.ts:10/28/59/101/117` |
   | 数学后处理 | **保留** `____` | `MATH_OCR_PROMPT` 明确「填空横线写成 `____`」；`mathClean` 无下划线删除 |
   | 语文后处理 | **删**：`s.replace(/_+/g, "")` | `aiTextUtils.ts:607`（`stripQuestionNoise`，调用点 `chinese.ts:452`） |
   | 语文 LLM 去噪 | **删**：提示词第 3 条原文「删除下划线符号 `_`」 | `chinese.ts:123` |
   | 英语后处理 | **删**：同一 `stripQuestionNoise` | `english.ts:306`；`routes/ai_chinese.ts:182` |

   → **结论：留**（2026-09-15）。填空位是题目语义（要填几个字），删了学生看不出填几格；数学本就在留，删它等于把学科不一致固化。
   真正的难点没变：**「填空横线」与「老师下划线批注」从 OCR 文本上无法区分**（见下方残留风险）。

#### ▷ 成因溯源：为什么语文/英语会删（2026-09-15 查证）

| 问题 | 查证结果 |
|---|---|
| 是最近的改动吗？ | **不是**。`git log -S 'replace(/_+/g'` 只命中 `05d547a`「后端源码纳入 git」，即**进入版本控制前就已存在**，无提交说明 —— 属遗留实现（可上溯到最早的实现）。 |
| 唯一留下的理由？ | `aiTextUtils.ts:588-597` 注释：本函数定位是删「**非题目信息**」的两类强信号。括号 ——「OCR 常把答案、注释、小提示或**填空横线**识别进括号，属"不符合的文本"，**按需求全部过滤**」；下划线 ——「**老师下划线批注** / 填空横线在 OCR 里常被识别成连续下划线」。函数名 `stripQuestionNoise` 也点明语境是「**题目**噪声」。 |
| 原始语境到底是什么？ | **试卷/题目去噪** —— 在那个场景清掉批注线与括号里的答案是对的。但同一函数被**无条件**挂在**主识图排版链路**上（`chinese.ts:452` / `english.ts:306` / `routes/ai_chinese.ts:182`），那是**版面还原**场景。**这是设计错位，不是有意决策。** |
| 语文为什么删两遍？ | 主路 `stripQuestionNoise` 删一次；`llmFilterOcrText` 内联提示词第 3 条又删一次（但**仅** `needLlmDenoise` 的两段式 / OCR API 回退链路会跑到）。 |
| 英语为什么也删？ | **继承，不是决定**。`english.ts:304` 注释原文：「英语**不跑** LLM 中文去噪：那条提示词要求"删除所有括号"，会吃掉英语的括号内容。只做确定性清洗（**删括号/下划线** + 归并空行）」—— 作者明知中文降噪对英语有害，却沿用了同一个按中文语境设计的 `stripQuestionNoise`，下划线删除随之被继承。与「英语付费兜底误用语文 `deepseekRelayout`」是**同一类病**。 |
| 为什么一直没人修？ | **同类事故已经为数学修过，却没为语文/英语修。** `aiTextUtils.ts:104-116` 明载：「历史事故：**数学填空方框 `□` 被语文清洗器删掉**，只因调用方没传 `lineCleaner`」。§7 学科隔离后数学拿回 `mathClean`（保留 `□`），`____` 也一并保住；语文/英语的填空位信号则始终无人认领。 |

> **一句话结论**：这不是"语文/英语故意要删"，而是**一个为试卷去噪设计的清洗器被套用到了课本版面还原上**，且它删 `□` 的那一半已经修过、删 `_` 的这一半漏了。

2. **拼音不做列对齐** —— 已在 §0.4 列为"明确不做"，但需在语文/英语模块里把「不做」写成**注释明文**，避免后来者重新引入。

#### ▷ 提案 ✅ 已于 2026-09-15 实施：填空横线「留」+ 改由渲染层承接

**实施状态**：步骤 1–4 全部完成，未部署。验证：`server_cf` 58/58（新增 `tests/questionNoise.test.ts` 9 例）、`web` 84/84（新增 4 例）、两侧 `tsc --noEmit` 干净、`oxlint` 0 error（5 个 warning 为既有 hooks 告警）。

**决策主张：留。** 理由：填空位是题目**语义**（要填几个字），删了孩子看不出填几格；且数学本就在留，删它等于把学科不一致固化下来。

**步骤 1 —— 服务端：把"无条件删"改成"只删整行批注线"** ✅（`aiTextUtils.ts` `stripQuestionNoise`）

```ts
// 旧：s = s.replace(/_+/g, "")            ← 行内填空位一起没了
// 新：只删「整行只有下划线/空格」的批注线、分隔线；行内下划线是填空位，保留
//     行内容须至少含 1 个下划线（ASCII `_` 或全角 `＿`），且不含其它可见字符
s = s
  .split("\n")
  .map((ln) => (/^[ \t\u3000_\uFF3F]*[_＿][ \t\u3000_\uFF3F]*$/.test(ln) ? "" : ln))
  .join("\n")
```

⚠️ **此规则不得套用到数学**：竖式的计算横线正是"整行 `____`"。`stripQuestionNoise` 现由 `chinese.ts:452` / `english.ts:306` / `routes/ai_chinese.ts:182` 调用，**数学不调**，所以天然安全 —— 但改之前要确认这一点不被破坏。

**步骤 2 —— 服务端：语文 LLM 去噪提示词第 3 条改写**（`chinese.ts:123`）

现原文「删除下划线符号 `_`」与主提示词（§0.5 表）正面冲突，改为：

> `3) 删除「整行只有下划线」的批注线/分隔线；行内的填空下划线必须原样保留；`

主提示词（`prompts.ts:10/28/59/101/117`）**不用改** —— 它本来就说「按原样输出下划线」。

**步骤 3 —— 渲染层：把 `____` 纳入既有「填空位」机制** ✅（对应 §0.4「量化放渲染层」）

前端**已有**填空位实现，扩展即可，不需要新机制：

| 文件 | 改动 |
|---|---|
| `web/src/lib/paragraphFlow.ts` | `BLANK_RE` 扩展为 `/[（(][ \t\u3000]*[）)]\|[_＿]{2,}/`，`splitBlanks()` 无需改动即自动标 `blank: true` |
| `web/src/components/BlockText.tsx` | **无需改动** —— 它已按 `BLANK_RE`/`splitBlanks` 分支渲染 `.block-blank` |
| `web/src/pages/AiParseResultPage.tsx` | `EnglishWordTap.renderWord` 加护栏：纯下划线段渲染成 `.block-blank`，**不做逐字点读盒**（此前 `____` 会变成 4 个可点读的 `_`） |
| CSS `.block-blank` | 复用既有 `display:inline; white-space:nowrap`（不可断单元），宽度即字面 `_` 的宽度 |
| 逐字点读 | 填空位内部**不生成字盒** ✅ |

**步骤 4 —— 缓存键与验证** ✅

- 服务端缓存后缀 bump（§5.2 铁律）：语文 `_r4` → **`_r5`**、英语 `_en_r5` → **`_en_r6`**。
- 前端 `ocrResultCache.ts` 的 `KEY_V`：**结论是必须 bump** —— `v4` → **`v5`**。理由：本次改的确实是**数据**（`text` 里多了 `_`），且旧缓存里 `text` 已丢 `____`，不 bump 会一直吃旧结果。
- 测试：新增 `server_cf/tests/questionNoise.test.ts`（9 例，含"数学竖式不得走本函数"的回归护栏）；`web/src/lib/paragraphFlow.test.ts` 补 4 例（`____` / `＿＿＿` / 单个 `_` 不算 / 与括号填空共存）。

**已知残留风险**（诚实声明）

- **行内的老师批注线会被一并保留**（整行规则覆盖不到它）。从 OCR 文本上，**"填空横线"与"行内批注线"目前无法可靠区分** —— 这是本提案真正的难点，也是不做阈值猜测（§0.4）的代价。
- **只认连续下划线**：`_` 被空格拆开（`_ _ _`）时不匹配，会退回逐字渲染。提示词要求模型输出连续 `_`，实测如此；若日后出现拆散样本，再放宽 `BLANK_RE`。
- **整行批注线是"整行丢掉"而非"变空行"**：实现上映射为 `""`，会留下一个空行 → 前端视作段落边界。因 `text` 不参与渲染，影响仅限分句/问答上下文（见 §0.5 影响面）。
- **`（  ）` 空括号填空位仍被服务端删除**（`stripQuestionNoise` 的括号规则 + 语文 LLM 去噪第 2 条「包括空括号」）—— 这是**同一病灶的另一半，本次未动**（本次只点了下划线）。因 `blocks` 保留原文，版面症状不可见。**留作待办。**

**替代方案（若不接受"留"）**

| 案 | 做法 | 代价 |
|---|---|---|
| B | 维持"删"，但把主提示词改成"不要输出下划线"，消除自相矛盾 | 填空位信息**永久丢失**，且与数学继续不一致 |
| C | 只留「行内 + 长度 ≤ 6」的下划线，更长的视为批注线 | 阈值靠猜，**违反 §0.4** |

**回滚**：本提案落在单个 commit；回滚后把缓存后缀改回即可（旧缓存自然失效不影响正确性，只多一次重算）。

---

## 1. 唯一数据载体：`Block`

```ts
interface BlockLine {
  text: string      // 一行的文本（物理行）
  indent: number    // 0~3，语义缩进层级（不直接等于空格数）
}
interface Block {
  type: "title" | "heading" | "body" | "question" | "option" | "note" | "table"
  text: string                          // 块全文（= lines 拼接；table 块例外，放 HTML）
  align: "left" | "center" | "right"
  lines: BlockLine[]
  polyphones: Record<string, string>    // 仅语文用（多音字注音）
  bbox?: number[] | null                // 预留：Paddle 可给归一化坐标
}
```

**硬性约定**
1. `type` 与 `align` 必须落在枚举内，越界一律回退 `body` / `left`。
2. `table` 块的 `text` 放 **HTML `<table>`**，`lines` 只放一条（内容同 `text`）。
3. `indent` 夹取 `0~3`；**越界不是错误，是归一化**。
4. `bbox` 目前恒 `null`（豆包 chat 接口不返回坐标；只有 PP-OCRv6 行检测给 bbox，用于切块绿框，不进 Block）。

---

## 2. 段落定义（唯一口径）

> **一个 block 是「块」；块内连续 `lines` 是「段内物理行」；一个 `body` 块 = 一个语义段落。**

| 概念 | 权威来源 | 前端职责 |
|---|---|---|
| 段落边界（哪到哪是一段） | **服务端 `blocks`** | 只按块渲染，**禁止**自己做分组 |
| 段内物理行 | 服务端 `lines` | 交给浏览器自动折行（`body`），或逐行原样（见 §4） |
| 缩进 | 服务端 `indent` | `body` 首行用两个全角空格；其它块 `indent*2em` padding |

**禁止**前端用「句末标点 / 标题启发式 / 算式启发式」重新分组（这是历史债，正在逐模块拆除）。

---

## 3. 三条元规则

| | 规则 | 说明 |
|---|---|---|
| **元规则 1** | **「读」逐行保真，「渲染」段落以服务端为准** | 逐行保真是**读图阶段**要求（防模型合并行导致漏字）；段落化是**显示阶段**行为（防物理行硬断行）。二者不矛盾，但**分组权必须在服务端**，不能前端二次推导 |
| **元规则 2** | **结构以服务端 `blocks` 为准；`text`/`questions` 只是兼容退路** | 三个模块的 `blocks` 都必须非空（数学此前为空 = 规则悬空） |
| **元规则 3** | **学科差异靠「删逻辑」而非「加开关」** | 如英语不去拼音，应从英语路径**物理移除**去拼音后处理，而不是靠 `stripPinyin:false` 布尔值（本次已因开关漏过两次） |

---

## 4. 各模块规格

| 维度 | 语文 | 数学 | 英语 |
|---|---|---|---|
| 端点 | `/ai-chinese/parse-image` | `/ai-homework/parse-image` | 同语文，`?mode=english` |
| 默认引擎 | **Paddle 优先** | **豆包**（仅显式选 paddle 才走 Paddle） | **豆包优先** |
| 结构化提示词 | `DOUBAO_OCR_JSON_PROMPT(_NO_POLY)` | `MATH_OCR_JSON_PROMPT` | `DOUBAO_OCR_JSON_PROMPT_EN` |
| 纯文本提示词（回退） | `DOUBAO_OCR_PROMPT` | `MATH_OCR_PROMPT` | `DOUBAO_OCR_PROMPT_EN` |
| 去印刷拼音 | ✅（**仅含汉字的行**） | ❌ | ❌ |
| 多音字 | ✅ `polyphones` | ❌ | ❌ |
| 分块/分题 | `blocks`（模型给） | `blocks`（模型给）→ 退 `splitProblemsByNumber` | `blocks`（模型给） |
| `body` 块渲染 | 段落流（并段 + 自动折行 + 首行空两格） | **逐行 pre-wrap**（保竖式对齐） | 逐行 + 句末/标题分段 |
| 标题样式 | `title`/`heading` 独立块 + 居中 | `title`/`heading` 独立块 | `title`/`heading` 独立块 |
| 表格 | `table` 块 → 可点读表格 | 同 | 同 |

### 数学专项（`body` = 算式/竖式）
- **必须逐行原样渲染 + `white-space: pre-wrap`**，否则竖式的列对齐会被折行/压空格破坏。
- 因此**解析阶段不能 `trim()` 行文本**（`extractBlocks` 默认 trim，数学需 `keepLineSpaces`）。
- 题干（`question`）仍走段落流（长题干需折行）。

---

## 5. 后处理函数（2026-09-15 §7 隔离后已拆成三份）

> ⚠️ **P0 时期的「三模块共用 `finalizeBlocks` + `profile`/`lineCleaner` 开关」已删除。**
> 隔离后的分布见下表。判据：**「如果要在三个学科之间选一个值，就不该出现在共用文件里。」**
>
> **2026-09-15 追加**：同一套结构已镜像到本地后端 —— `server_ts/src/lib/subject/{kernel,chinese,english,math}.ts`。
> 目录、职责划分、判据与下表**逐条对齐**；差异只在 server_cf 独有的**能力**（Paddle 引擎、JSON 结构化提示词、
> 多音字补丁、去页码、内嵌表格提升），见 §5.2 表下注与 §8 P1.6。

### 5.1 学科无关内核 —— `server_cf/src/lib/subject/kernel.ts`

只放三学科**必须完全一样、否则就是 bug** 的机制，不含任何学科决策：

| 函数 | 职责 |
|---|---|
| `normType` / `normAlign` / `clampIndent` | Block 格式归一化（契约 §1 硬性约定 1、3） |
| `joinLines` | 块全文 = lines 逐行拼接（text 缺失时推导） |
| `finishBlocks` | 结构型收尾：`markOrderedIndent` + 表格归位（markdown 表格合并 / 正文内嵌 HTML 表格提升） |
| `tidyBlocks` | 丢页码块 + 丢清洗后变空的块 + 表格提升（**去拼音须在调用本函数之前完成**） |
| `dropPageNumberLines` | 丢页码行，保留空行 |
| `readImageRequest` / `persistAndOrient` / `extOf` / `sha256Hex` | parse-image 请求机制（读表单、落盘、EXIF 校正、哈希） |
| `readCacheJson` / `writeCacheJson` | R2 缓存读写 |
| `SubjectOcrOutcome` | 学科链路的统一返回形状（= 前后端通信格式，故三学科一致，同 §1） |

### 5.2 学科模块 —— `server_cf/src/lib/subject/{chinese,english,math}.ts`

每份**自带**提示词选择 + 引擎优先级 + 行清洗器 + 缩进规则 + 诗歌标记 + 多音字策略 + 印刷拼音策略 + 缓存键后缀 + 分题函数，**不含任何 switch**：

| 学科 | 收尾函数 | 行清洗器 | 引擎默认 | 缓存键后缀 | 特殊策略 |
|---|---|---|---|---|---|
| 语文 | `finalizeChineseBlocks` | `cleanOcrText` | **Paddle 优先** | `_r4` | 去印刷拼音、补多音字（同步/异步）、诗歌居中、body 首行缩进、LLM 去噪（仅回退链路） |
| 英语 | `finalizeEnglishBlocks` | `cleanOcrText` | **豆包优先** | `_en_r5` | **不去拼音、不补多音字、不跑中文去噪**、提示词全用 `*_EN` 一套 |
| 数学 | `finalizeMathBlocks` | **`mathClean`** | **仅显式 `engine=paddle`** | 无后缀 | **保留行首空格（竖式）**、不缩进、不做诗歌标记、`splitProblemsByNumber` |

> **`server_ts` 侧同名模块**（2026-09-15 镜像，行为保持）：`finalizeChineseBlocks` / `finalizeEnglishBlocks` 齐全；
> 数学**还没有** `finalizeMathBlocks` —— server_ts 缺 `MATH_OCR_JSON_PROMPT`，数学链只出纯文本、`blocks` 恒为空，
> 那个函数没有调用点，故**不预置死代码**。英语缓存键后缀在 server_ts 是 `_en`（**未 bump**，因为默认主路径本来就用 `*_EN` 提示词），
> 语文仍无后缀。引擎列：server_ts **只有豆包一条路**（无 PaddleOCR 模块），`engine` 参数仅记日志。
> 另：`server_ts/src/lib/subject/kernel.ts` 里**没有** `tidyBlocks` / `dropPageNumberLines`，`finishBlocks` 只做 `markOrderedIndent`。

### 5.3 仍留在 `lib/aiTextUtils.ts` 的通用函数（与学科无关，多端点复用）

| 函数 | 职责 |
|---|---|
| `extractBlocks(reply, { keepLineSpaces })` | LLM JSON → `Block[]`（越界归一化；数学传 `keepLineSpaces: true`） |
| `markdownToBlocks(md)` | Paddle markdown → `Block[]`（按空行聚合段落，`#`→title/heading） |
| `cleanOcrText` / `cleanBookScanBlocks` / `cleanBookScanText` / `stripPrintedPinyin` | 语文侧清洗（`stripPrintedPinyin` 现仅由语文模块调用） |
| `markPoetry` / `markOrderedIndent` / `mergeMarkdownTableBlocks` / `hoistHtmlTableBlocks` | 排版修正原语（学科模块按需调用） |
| `splitProblemsByNumber` / `splitQuestions` / `splitSentences` | 分题/分句 |
| `dedupeLines` / `recoverTextFromJson` / `stripQuestionNoise` / `fixMojibake` / `isPageNumberText` | 文本原语 |

> ⚠️ **`server_ts` 的 `aiTextUtils.ts` 目前只有上表的一部分**：有 `extractBlocks`（**无** `keepLineSpaces`）、`cleanOcrText`、
> `markPoetry`、`markOrderedIndent`、`dedupeLines`、`recoverTextFromJson`、`splitQuestions`、`splitProblemsByNumber`、
> `extractHtmlTables`、`mergeTableBlocks`；**没有** `markdownToBlocks`、`stripPrintedPinyin`、`isPageNumberText`、
> `hoistHtmlTableBlocks`、`mergeMarkdownTableBlocks`、`stripQuestionNoise`、`cleanBookScan*`。
> 这是**功能差距，不是隔离遗漏**（隔离只搬结构、不改行为）—— 补齐清单见 §8 P1.6。

### 5.4 前端对应拆分（2026-09-15）

| 模块 | 内容 |
|---|---|
| `web/src/lib/paragraphFlow.ts` | **无策略基元**：`stripMdHeaders` / `tidyInlineSpaces` / `splitBlanks` / `joinPieces` / `splitInlineTables` / `buildParagraphs` / `reflowWithBreaks(raw, breakBefore, closesAfter)` |
| `web/src/lib/subject/chinese.ts` | `chineseReflow` / `chineseBodyParagraphs` |
| `web/src/lib/subject/math.ts` | `isMathFormulaLine` / `mathReflow` |
| `web/src/lib/subject/english.ts` | `isEnTitleLine` / `SENTENCE_END` / `englishReflow` |

> `reflowWithBreaks` 是**无策略内核**：断行决策由两个谓词注入，学科差异因此留在各学科模块里。
> 旧的 `reflowText(raw, { breakOnFormula, breakOnSentence, breakBeforeTitle })` **已删除**，全仓零命中。


---

## 6. 已知取舍（有意为之，勿当 bug 改）

1. **`finalizeBlocks` 强制 `body` 首行 `indent=1`** —— 中文教材正文本就首行缩进两格；代价是顶格排版（公告体）被加缩进。
2. **提示词要求转录印刷拼音，后处理又删掉它** —— 两阶段设计：不要求转录，模型会为「干净」而**合并行**、破坏行数保真；转录后由服务端统一删（读音由 `polyphones` 重生成）。
3. **`markPoetry` 把诗歌各行 `indent` 设为 1** —— 同时设 `align="center"`，前端居中块**忽略 indent 且不走段落流**，显示不受影响。
4. **流式 `line` 事件传不了空行**（`if (!t) continue`）—— 增量阶段看不到段间空行，但 `done` 事件的 `text`/`blocks` 是完整的。**结构一律以 `done.blocks` 为准。**
5. **`dedupeLines` 只删「与上一个非空行完全相同」的行** —— 窄风险：连续两行完全相同的算式会被去掉一行。
6. **`cleanOcrText` 会删掉 `\u25a1`（□）** —— 对语文无害（语文填空用「（ ）」或下划线），但**数学填空方框正是 □**。
   **§7 隔离后这已不是"需要调用方记得传对参数"的坑**：数学模块 `lib/subject/math.ts` 的收尾函数**内置** `mathClean`，没有任何开关可漏传（`lineCleaner` 参数已随 P0 的 `finalizeBlocks` 一并删除）。
   实测对照：语文清洗器把 `2. 填空：□ + 5 = 9` 变成 `2. 填空： + 5 = 9`，数学清洗器完整保留。
7. **`markOrderedIndent` 对数学也生效**（题号行 `indent=1`）—— 无害：数学前端忽略 `indent`（`body` 块逐行原样渲染、`question` 块走 `renderMixedText(..., indent=false)`）。
8. **数学 `extractBlocks` 必须传 `keepLineSpaces: true`** —— 默认实现每行 `.trim()`，会把竖式的行首空格吃掉（列位直接散掉）。

---

## 7. 学科隔离（2026-09-14 用户新指令，取代"共用"思路）

用户明确要求：**英语 / 数学 / 语文不共用逻辑，各自独立出来**。这是 §3 元规则 3 的加强版：

- 每个学科一条**自洽的垂直链路**：自己的提示词 → 自己的后处理 → 自己的渲染；改一个学科不波及其他。
- §1/§2（`Block` schema、段落定义）**作为"通信格式"保留** —— 前后端必须用同一种结构才能渲染，这部分不是"共用逻辑"。
- §5 的**共享函数要拆成三份**（`finalizeBlocks` 按学科各自内联清洗器/缩进规则/标记规则），**删掉 `profile` / `lineCleaner` 开关**。
- **历史教训支撑该决定**：英语吃到语文提示词（英文被删）／语文去拼音删掉卷内英文／数学要 `□` 却用了会删 `□` 的语文清洗器 —— **全部源于"共用"**。

**执行顺序**：① 拆服务端后处理（`lib/subject/{chinese,english,math}.ts`）→ ② 拆前端渲染（各学科独立渲染模块，不再共用启发式）→ ③ 删除开关型 API（`profile` / `lineCleaner`）。

### 落地状态（2026-09-15，四步全部完成 —— server_cf + web + server_ts 镜像）

| 步骤 | 状态 | 产物 |
|---|---|---|
| ① 拆服务端后处理 | ✅ | `server_cf/src/lib/subject/{kernel,chinese,english,math}.ts`；`ai_chinese.ts` / `ai_homework.ts` 收敛为薄路由（只做机制，不再出现 `mode === "english"` 判断） |
| ② 拆前端渲染 | ✅ | `web/src/lib/subject/{chinese,english,math}.ts`；`paragraphFlow.ts` 只留无策略基元 + `reflowWithBreaks` |
| ③ 删除开关型 API | ✅ | 服务端 `finalizeBlocks` / `FinalizeOpts`（`profile` + `lineCleaner`）已删除；前端 `reflowText(opts)` 已删除。两者全仓**零命中** |
| ④ `server_ts` 镜像 | ✅ | `server_ts/src/lib/subject/{kernel,chinese,english,math}.ts`（149 / 246 / 253 / 158 行）；`ai_chinese.ts` −319 行、`ai_homework.ts` −144 行收敛为薄路由。**行为保持**：同提示词、同流程、同缓存键，只搬结构。验证：tsc **exit 0** + npm test **26/26** |

**已定案的两条设计判据（后续改动请沿用）**
1. **`Block` schema 保留共用**（用户 2026-09-15 确认）。它是**前后端通信格式**，必须一致才能渲染；隔离的是**逻辑**（策略），不是**格式**。同理 `SubjectOcrOutcome` 也共用。
2. **「无策略内核」与「学科策略」的分界**：判据是「**如果要在三个学科之间选一个值，就不该出现在共用文件里**」。
   - 进内核的：`type`/`align` 归一化、`indent` 夹取、丢空、表格归位、页码判定、请求/缓存机制 —— 三学科**必须完全一样**。
   - 留在学科模块的：清洗器、缩进规则、诗歌标记、提示词、引擎优先级、缓存键后缀、分题函数、去拼音、多音字。
   - ⚠️ 刻意**不做**的事：把 `mergeMarkdownTableBlocks` 这类结构逻辑复制三份。那是 §5 记录过的"两份规则漂移"成因；内核存在的意义就是避免它。

### 隔离时顺带修正的两处（有意为之，非回归）
1. **英语的付费排版兜底改用英语提示词**。改造前英语的 `deepseekRelayout` 兜底走的是**语文**提示词 + 中文 system（`ai_chinese_relayout`），与"英语吃语文提示词 → 英文被删"是同一类病。现改为 `DEEPSEEK_RELAYOUT_PROMPT_EN` + `ai_english_relayout`。
2. **`normType`/`normAlign` 真正落到 Block 上**。P0 的 `finalizeBlocks` 只做了 `align ?? "left"`，并没有按 §1 约定 1 校验枚举；现统一经内核归一化。对现有输入**是空操作**（`extractBlocks` 与 `markdownToBlocks` 本就不产出越界值），只是把契约补上。

### 已知未改（保留现状，隔离之后改它只动一个文件）
- **英语仍在做诗歌居中判定**。改造前英语走语文档位 `finalizeBlocks`（默认 profile），因此 `markPoetry`（短行 + 句末标点 → 整块居中）对它也生效。隔离时**原样保留**以免版面发生非预期变化。现在要改只需动 `finalizeEnglishBlocks`，不会再波及语文。
- **前端仍在做启发式分组**。`isEnTitleLine` / `isMathFormulaLine` 只是**归位到各学科模块**，并未改由服务端 `type`/`indent` 驱动（那是 P2/P3）。


### 流式 OCR 移除（2026-09-14 已完成）
- 前端：删 `parseImageStream` + `ParseImageStreamHandlers`（`aiImage.ts`），AI 语文/英语页改调 `parseImage`；顺带删除 `liveLines`/`readingIdx`/`finishNow`（"就按这些字来"）与 TTS 逐行朗读 UI。
- 服务端：删 `/ai-chinese/parse-image-stream` 路由整段（291 行）与 `streamSSE`/`IncrementalLineExtractor` 导入。
- 收益：**少了一条重复管线**（原先非流式/流式各有一套清洗与引擎选择，任何规则改动都要改两处，且流式天生丢空行）。

## 8. 待办（按优先级）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 本契约 + `finalizeBlocks` 提到 `aiTextUtils` 共用 | ✅ 已落地 → **已被 §7 隔离取代**：`finalizeBlocks` 及 `profile`/`lineCleaner` 开关均已删除，拆成三个学科收尾函数 |
| P1 | 数学补 `blocks`（Paddle 路径用 `po.blocks`；豆包路径结构化提示词） | ✅ 已落地（数学模块走 `MATH_OCR_JSON_PROMPT`，失败自动回退纯文本） |
| P2 | `markdownToBlocks` 成为唯一服务端分段规则；前端删「并段」职责 | ⬜ 未做（前端仍用 `buildParagraphs` / `reflowWithBreaks` 做段落化，只是已归位到各学科模块） |
| P3 | 前端删启发式（`isEnTitleLine`/`breakOnSentence`/`isMathFormulaLine`） | ⬜ 部分：启发式**已归位**到 `web/src/lib/subject/*`（不再共用开关），但仍在前端推导，未改由服务端 `type`/`indent` 驱动 |
| ~~P4~~ | ~~流式对齐~~ —— **流式 OCR 已于 2026-09-14 整体移除**（前后端 + SSE 路由）| ✅ 作废；遗留死代码（`incrementalJsonText.ts` + 其测试）已于 2026-09-15 删除 |
| ✅ | **§7 学科隔离**（服务端后处理 + 前端渲染 + 删开关 + `server_ts` 镜像） | ✅ **2026-09-15 已落地**（详见 §7 落地状态表） |
| P5 | 边界场景：分栏 > 倾斜 > 手写 > 跨页 > 水印 | ⬜ |
| **§0** | **术语与基准**（`line` 口径 / 优先级表 / 元素分类表 / 量化边界） | ✅ **2026-09-15 已落笔**。§0.5 第 1 项（填空横线留/删）**已拍板为「留」并实施**；剩 ①  `（  ）` 空括号填空位仍被服务端删除（同一病灶另一半，见 §0.5 残留风险）；② 拼音不做列对齐需写成注释明文 |
| P1.5 | **`server_ts` 镜像**（结构隔离） | ✅ **2026-09-15 完成**：本地后端同样切成 `lib/subject/*` + 薄路由，`isEnglish` 传参删除，**行为保持**（同提示词/流程/缓存键） |
| P1.6 | **`server_ts` 功能对齐**（≠ 隔离，需另排期） | ⬜ 补齐 server_cf 独有能力：① `prompts.ts` 加 `MATH_OCR_JSON_PROMPT` / `DOUBAO_OCR_JSON_PROMPT(_NO_POLY)`；② `extractBlocks` 加 `{ keepLineSpaces }`；③ `math.ts` 补 `finalizeMathBlocks` 并改二段式（数学 `blocks` 才会非空）；④ PaddleOCR 引擎；⑤ 多音字补丁 + `polyToken`；⑥ 去页码 / 内嵌表格提升 |

