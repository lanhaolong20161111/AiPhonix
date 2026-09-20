/** 数学学科排版：本文件只含数学自己的段落并回规则，不与其他学科共用策略。
 *
 *  §7 学科隔离（2026-09-15）后（与 server_cf 的 lib/subject/math.ts 同一思路）：数学的算式行
 *  必须独占一段，否则会跟在题干后面（见下 isMathFormulaLine 的说明）。这一判定是数学专属的，
 *  不通过 opts 开关表达 —— 调用方无法漏传、也无法传错，复刻后端隔离的止血思路。
 *
 *  本文件只导出：
 *    · isMathFormulaLine —— 算式行判定（从 paragraphFlow 原样搬来，含原注释）
 *    · mathReflow        —— 纯文本段并回段落（算式行强制另起一段）
 *  改数学不会波及语文或英语。 */

import { reflowWithBreaks } from "../paragraphFlow"

/** 数学算式行判定：不含汉字，且含运算符/等号。
 *
 * 数学卷子里算式（`12+35=47`、`3×4=`、`x + y = 10`）在图片上**独占一行**，OCR 也按
 * 【逐行保真】原样输出成独立物理行。但 reflowWithBreaks 会把非空行当续行并回上一段，于是
 * 「计算下面各题」＋「12+35=」被拼成一行 —— 学生看到的算式跟在题干后面。
 * 数学路径走 mathReflow 后，算式行一律独立成段（算式后面的纯数字答案行仍并回该算式）。
 *
 * 判据用**纯汉字**范围（不含全角标点）：`12+35=（ ）` 带全角括号仍是算式。
 * 含汉字则排除，这样「第1-3题」「2023-2024学年」不会被连字符误判。 */
const HAN_IDEOGRAPH_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/
const MATH_OP_RE = /[=+×÷*/<>≤≥±·]/
const MATH_MINUS_RE = /\d\s*[-−]\s*\d/
export function isMathFormulaLine(s: string): boolean {
  if (!s || HAN_IDEOGRAPH_RE.test(s)) return false
  return MATH_OP_RE.test(s) || MATH_MINUS_RE.test(s)
}

/** 数学纯文本段并回段落：算式行强制另起一段，逐字等价于旧的
 *  reflowWithBreaks(raw, (t) => isMathFormulaLine(t), () => false)。 */
export function mathReflow(raw: string): string[] {
  return reflowWithBreaks(raw, (t) => isMathFormulaLine(t), () => false)
}
