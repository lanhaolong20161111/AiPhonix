/** 语文学科排版：本文件只含语文自己的段落并回规则，不与其他学科共用策略。
 *
 *  §7 学科隔离（2026-09-15）后（与 server_cf 的 lib/subject/chinese.ts 同一思路），
 *  前端文本排版也被切成三份自洽的垂直链路：
 *      lib/subject/chinese.ts   语文
 *      lib/subject/english.ts   英语
 *      lib/subject/math.ts      数学
 *
 *  语文是"无开关"的兜底：只走内核的机械换行规则（光学换行 / 有序项 / 标签项，
 *  见 paragraphFlow 的 ORDERED_PREFIX / LABEL_PREFIX），不引入任何学科特定的断行策略。
 *  改这一个学科不会波及其他学科，也不需要调用方记得传对开关。
 *
 *  本文件只导出：
 *    · chineseReflow          —— 纯文本段并回段落（不强制任何学科断行）
 *    · chineseBodyParagraphs  —— 块级 body 的段落流（buildParagraphs 的语文别名，供 BlockText 用）
 */

import { buildParagraphs, reflowWithBreaks, type FlowLine } from "../paragraphFlow"

/** 语文纯文本段并回段落：只走内核的机械换行规则，不引入任何学科特定的断行策略。 */
export function chineseReflow(raw: string): string[] {
  return reflowWithBreaks(raw, () => false, () => false)
}

/** 语文 body 块的段落流：直接是 buildParagraphs 的别名，供 BlockText 用。 */
export function chineseBodyParagraphs(lines: FlowLine[] | null | undefined): string[] {
  return buildParagraphs(lines)
}
