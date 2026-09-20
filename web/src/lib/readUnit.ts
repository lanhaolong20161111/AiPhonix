/** 朗读单位判定（识别结果页左侧「整块朗读 / 句子朗读」）—— 纯函数，便于单测。
 *
 *  为什么单独成文件：识别页要在「用户点中正文某个位置」之后反推朗读单位。
 *  ⚠️ 单位口径（2026-09-15 修正）：
 *  - **整块（按钮「整块」）= 一个 block 的全部内容**，不是块里的某个 `.flow-para`。
 *    语文一块=一段/一题，数学一块=一整道题（题干+选项+多行），英语一块=一段课文。
 *    块内点哪都读整块，所以文本由渲染层直接传（`toReadableBlockText` 清成可读串）。
 *  - 句子 = 把点击偏移映射成句边界，这段边界规则容易写错（英文句点误切 "3.5"、
 *    中文右引号被甩到下一句），独立出来可以直接跑用例。
 *
 *  ⚠️ 与 `articleSplit.splitSentences`（文章练习的本地切句）刻意不同，别互相替换：
 *  - 文章练习按**行**切（换行强制断句），且只认中文/省略号句末，**不认英文句点**；
 *  - 这里按**段落**切（段落里没有换行），必须认英文句点，才能给英语课文分句。
 */

/** 句末标点：中文句号/叹号/问号/分号 + 英文 ! ? ;，以及「后面跟空白或到结尾」的英文句点。
 *  英文句点要求跟空白/结尾，避免把 "3.5" / "Mr." 当成句尾（这正是不能逐字符 test 的原因：
 *  逐字符时 "." 的 `(?=\s|$)` 永远成立，必须整段扫描保留上下文）。 */
const SENT_END = /[。！？；!?;]|\.(?=\s|$)/g
/** 句末标点后可吸收的收尾符号（右引号/右括号），避免「。”」把引号甩到下一句 */
const CLOSERS = "”’」』）)》〉】"
/** 英文常见缩略语：其后的句点不是句尾（否则 "Mr. Li agrees." 会被切成两句）。
 *  另加「单个大写字母 + .」（J. K. Rowling 之类首字母缩写）同样跳过。 */
const ABBR = new Set([
  "mr", "mrs", "ms", "dr", "st", "vs", "etc", "jr", "sr", "prof", "no", "fig", "eg", "ie",
])

export interface SentenceSpan {
  /** 句子原文（含首尾空白，调用方自行 trim） */
  text: string
  /** 在原串中的起始下标 */
  start: number
  /** 在原串中的结束下标（不含） */
  end: number
}

/** 把一段文本切成句子，保留标点与 offset。返回的区间互不重叠、按顺序排列。 */
export function splitSentences(raw: string): SentenceSpan[] {
  const text = raw ?? ""
  const out: SentenceSpan[] = []
  const re = new RegExp(SENT_END.source, "g")
  let start = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    // 缩略语句点（Mr. / Dr. / J.）不算句尾 —— 继续往后找真正的句末标点
    if (m[0] === ".") {
      const prev = (/([A-Za-z]+)$/.exec(text.slice(0, m.index)) ?? [])[1] ?? ""
      if (prev.length === 1 || ABBR.has(prev.toLowerCase())) continue
    }
    let end = m.index + m[0].length
    // 吞掉句末标点后的右引号/右括号（最多两个）
    for (let k = 0; k < 2 && end < text.length && CLOSERS.includes(text[end]); k++) end++
    const seg = text.slice(start, end)
    if (seg.trim()) out.push({ text: seg, start, end })
    start = end
    re.lastIndex = end
  }
  const tail = text.slice(start)
  if (tail.trim()) out.push({ text: tail, start, end: text.length })
  return out
}

/** 取「包含 offset 位置」的那一句（已 trim）；offset 越界时夹到首句/末句。
 *  段落里没有句子（纯符号/空白）时原样返回 trim 后的整段。 */
export function sentenceAt(raw: string, offset: number): string {
  const text = raw ?? ""
  const list = splitSentences(text)
  if (!list.length) return text.trim()
  const at = Math.max(0, Math.min(offset, text.length))
  for (const s of list) {
    if (at < s.end) return s.text.trim()
  }
  return list[list.length - 1].text.trim()
}

/** 整块朗读用的可读文本（段落模式的单位是**整个块**，不是块里的某个段落）。 */
export function toReadableBlockText(raw: string): string {
  return (raw ?? "")
    // 去 HTML 标签（块文本里可能内嵌 <table>…</table>）。只认「< + 字母」开头的真标签，
    // 避免把数学里的小于号（`3 < 5`）当成标签吃掉。
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    // 全角空格是段落首行缩进用的，读出来只是停顿，统一成半角再压缩
    .replace(/[\u3000\u00a0]/g, " ")
    // OCR 物理换行/连续空格 → 单空格：TTS 不需要物理行，单空格即一次自然停顿
    .replace(/\s+/g, " ")
    .trim()
}
