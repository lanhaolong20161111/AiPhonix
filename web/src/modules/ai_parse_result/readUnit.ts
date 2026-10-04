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

// ── 范围朗读（「选字」模式：先点起点字，再点终点字，朗读开头到结束这一段）──────
//
// 范围定义在**块的段落体序列**上：渲染时每个块（/文本段）有一串按顺序的段落体
// （语文/数学正文 = reflow 出的语义段落，数学算式 = 逐行，英语 = englishReflow 段落，
// 均含各自缩进前缀），`ReadRange.start/end` 是落在 `paras.join("")` 上的字符偏移。
// 这样起点/终点即使跨段，也能统一成一段连续的朗读文本，并按段切出各自的高亮区间。

export interface ReadRange {
  /** 范围在 paras.join("") 上的起始偏移（含） */
  start: number
  /** 范围在 paras.join("") 上的结束偏移（不含） */
  end: number
  /** 块内按渲染顺序的段落体列表（渲染与计算必须同一份） */
  paras: string[]
}

/** 从「段落体列表 + 点击偏移」反查所在段落下标（数学逐行块 / 表格等 paraKey 不带序号时用）。 */
export function paraIndexAtOffset(paras: string[], offset: number): number {
  if (!paras || paras.length === 0) return 0
  let cum = 0
  for (let i = 0; i < paras.length; i++) {
    cum += paras[i].length
    if (offset < cum) return i
  }
  return paras.length - 1
}

/** 第 paraIndex 段落在朗读区间内应高亮的子串区间（相对该段 body）；无交集返回 null。
 *  body 与 paras[paraIndex] 应逐字一致（都是渲染时的段落体）；不一致时按 indexOf 兜底。 */
export function rangeSliceIn(
  body: string,
  paraIndex: number,
  range: ReadRange,
): { from: number; to: number } | null {
  const { start, end, paras } = range
  if (!paras || paraIndex < 0 || paraIndex >= paras.length) return null
  let cum = 0
  for (let i = 0; i < paraIndex; i++) cum += paras[i].length
  const lo = Math.max(cum, start) - cum
  const hi = Math.min(cum + paras[paraIndex].length, end) - cum
  if (hi <= lo) return null
  if (body === paras[paraIndex]) return { from: lo, to: hi }
  const idx = body.indexOf(paras[paraIndex])
  if (idx >= 0) return { from: idx + lo, to: idx + hi }
  return null
}

/** 两个「段落下标 + 段内偏移」→ 规整成一段连续范围 + 朗读文本。
 *  终点在起点之前时自动交换；两点相同时扩成单字；段落列表为空返回 null。 */
export function buildRange(
  paras: string[],
  a: { pi: number; offset: number },
  b: { pi: number; offset: number },
): { range: ReadRange; text: string } | null {
  if (!paras || paras.length === 0) return null
  const cumAt = (pi: number, off: number): number => {
    const idx = Math.max(0, Math.min(pi, paras.length - 1))
    let cum = 0
    for (let i = 0; i < idx; i++) cum += paras[i].length
    return cum + Math.max(0, Math.min(off, paras[idx].length))
  }
  const total = paras.reduce((s, p) => s + p.length, 0)
  if (total === 0) return null
  let s = cumAt(a.pi, a.offset)
  let e = cumAt(b.pi, b.offset)
  if (s > e) [s, e] = [e, s]
  if (s === e) {
    if (e < total) e = s + 1
    else if (s > 0) s -= 1
    else return null
  }
  const text = paras.join("").slice(s, e)
  if (!text) return null
  return { range: { start: s, end: e, paras }, text }
}
