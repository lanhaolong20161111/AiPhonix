/** 字符工具 — 判断字符是否可发音 */

/** 该字符是否可发音（汉字 / 字母 / 数字 / 拼音带声调）。
 * 标点、空白、下划线填空位等不可发音，逐字点读时跳过（百度 TTS 对单标点返回 500）。 */
export function isSpeakableChar(ch: string): boolean {
  if (!ch) return false
  if (/[\u4e00-\u9fff]/.test(ch)) return true // 汉字
  if (/[A-Za-z0-9]/.test(ch)) return true // 字母 / 数字
  if (/[\u00c0-\u02af]/.test(ch)) return true // 拼音带声调（á、ǒ、ǚ…）
  return false
}

/** emoji / 符号装饰正则（百度 TTS 读不出会念杂音；朗读时间线中权重为 0） */
export const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}]/gu

/** 去掉文本中的 emoji / 符号装饰 */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "")
}
