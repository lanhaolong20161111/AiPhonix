/** 英语学科排版：本文件只含英语自己的段落并回规则，不与其他学科共用策略。
 *
 *  §7 学科隔离（2026-09-15）后（与 server_cf 的 lib/subject/english.ts 同一思路）：英语课本
 *  「一句一行」、标题样行独占一段，这些是英语专属的断行规则，不通过 opts 开关表达
 *  （复刻后端隔离的止血思路，开关型 API 一旦漏传就出事故）。
 *
 *  本文件只导出：
 *    · englishReflow —— 纯文本段并回段落（标题独占一段 + 句末即段落边界）
 *  改英语不会波及语文或数学。 */

import { reflowWithBreaks } from "./paragraphFlow"

/** 句末标点（英文 `. ! ? …` + 中文 `。！？`，可带收尾引号/括号）。
 *  英语用它断段：英语课本常**一句一行**，句末即段落边界。
 *  不这样做，整页（含标题）会被并成一行。 */
const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/

/** 英语「标题样」行判据：以大写字母/数字开头、较短、**内部不含任何标点**。
 *  如 `Unit 3 My Family` / `Story time` / `Let's learn` / `Read and write`。
 *
 *  ⚠️ 判据刻意收紧到「无标点」，因为正文折行几乎总含标点：
 *    `My name is Tom. I am` / `nine years old. I like` → 含句点 → 不是标题（正确并段）；
 *    而 `Let's learn` / `Story time` 不带标点 → 标题（正确独立成段）。
 *  撇号不计入标点（`Let's` / `I'm` 是正常拼写）。
 *  ⚠️ 不要用「下一行是否小写开头」来排除折行：`Let's learn` 后面跟的就是小写单词表
 *    （`doctor teacher`），那样会把真标题误判成折行。 */
const EN_TITLE_MAX_LEN = 28
const EN_TITLE_PUNCT = /[.!?…。！？,，;；:：]/
function isEnTitleLine(s: string): boolean {
  return s.length <= EN_TITLE_MAX_LEN && /^[A-Z0-9]/.test(s) && !EN_TITLE_PUNCT.test(s)
}

/** 英语纯文本段并回段落：标题样行独占一段、句末即段落边界。
 *
 *  逐字等价于隔离前的 `reflowText(raw, { breakOnSentence: true, breakBeforeTitle: true })`：
 *    · breakBefore  = 本行是标题 或 上一行已收尾（句末/标题） → 另起一段；
 *    · closesAfter  = 本行是标题 或 以句末标点结尾 → 标记为"已收尾"。 */
export function englishReflow(raw: string): string[] {
  return reflowWithBreaks(
    raw,
    (t, prevCloses) => isEnTitleLine(t) || prevCloses,
    (t) => isEnTitleLine(t) || SENTENCE_END.test(t),
  )
}
