/** 数学「审题高亮」纯逻辑 —— 把 /ai-homework/analyze 的结构化结果映射回原文做标注。
 *
 *  从 `components/MathAnalyze.tsx` 抽出（同 `lib/mathDisplay.ts` 的理由）：规则可单测，
 *  改错有人拦得住；组件只负责渲染。
 *
 *  ── 背景 ──
 *  数学块此前直接复用语文的 `BlockHighlight`（`/ai-chinese/highlight-mark`），标的是
 *  「core 核心句 / beautiful 优美词句 / word 重点词」——**「优美词句」对数学题毫无意义**。
 *  改用数学专用的 `/ai-homework/analyze` 后，标注规则应是应用题「审题三步」：
 *
 *   1) 量数   qty —— 数字 + 单位（已知数据）；未知量 value=null 不落正文，只在面板列出
 *   2) 关系词 rel —— 决定运算的语言线索（一共 / 比…多 / 比…少 / …倍）
 *   3) 问题句 ask —— 题目问什么（框定所求）
 *
 *  优先级 ask < rel < qty：具体标记覆盖外层句子标记（问题句里含量数时，量数仍单独标出）。
 *  纪律：只标与解题相关的量、宁少勿多（沿用语文高亮的「宁可少标」原则）。
 */

export type MathMarkKind = "qty" | "rel" | "ask"

export interface MathMark {
  start: number
  end: number
  kind: MathMarkKind
}

export interface MathAnalyzeMark {
  text: string
  kind: MathMarkKind | null
}

/** analyze 结果中本模块用到的字段（结构上兼容 services/aiHomework 的 AnalyzeResult，
 *  但刻意放宽为可选，便于单测直接构造最小输入） */
export interface MathAnalyzeInput {
  sentences?: { text?: string; is_key?: boolean; highlight?: string }[]
  quantities?: { name?: string; value?: number | null; unit?: string }[]
  relations?: { a?: string; b?: string; type?: string; amount?: number; parts?: string[] }[]
  questions?: { text?: string; target?: string; needs?: string[]; hint?: string }[]
}

/** 关系类型 → 关系词正则（按类型定向找词，避免无差别标「多/少」）。
 *  长模式在前、命中即停；末位是兜底模式，但用前后视排除「多少」里的「多/少」误命中。 */
export const REL_PATTERNS: Record<string, RegExp[]> = {
  more: [/比[^，。；！？]{0,12}?多/, /多多少/, /多(?!少)/],
  less: [/比[^，。；！？]{0,12}?少/, /少多少/, /(?<!多)少/],
  times: [/是[^，。；！？]{0,12}?倍/, /多少倍/, /倍/],
  total: [/一共/, /总共/, /合计/, /共有/, /总共有/],
}

/** 在 text 中找 num 的首次「独立出现」（前后不是数字或小数点）。
 *  否则 value=2 会命中 "20" 里的 "2"，标错位置。 */
export function findNumber(text: string, num: string): number {
  if (!num) return -1
  let from = 0
  for (;;) {
    const i = text.indexOf(num, from)
    if (i < 0) return -1
    const before = i > 0 ? text[i - 1] : ""
    const after = i + num.length < text.length ? text[i + num.length] : ""
    if (!/[0-9.]/.test(before) && !/[0-9.]/.test(after)) return i
    from = i + 1
  }
}

/** 把 analyze 的结构化结果映射回原文的字符区间 */
export function buildMathMarks(text: string, data: MathAnalyzeInput): MathMark[] {
  const marks: MathMark[] = []

  // 1) 问题句（优先级最低，内部的具体标记会覆盖它）
  for (const q of data.questions ?? []) {
    const t = String(q?.text ?? "").trim()
    if (!t) continue
    const i = text.indexOf(t)
    if (i >= 0) marks.push({ start: i, end: i + t.length, kind: "ask" })
  }

  // 2) 关系词：按服务端给的关系类型定向找词
  for (const r of data.relations ?? []) {
    const pats = REL_PATTERNS[String(r?.type ?? "")] ?? []
    for (const p of pats) {
      const m = p.exec(text)
      if (m) {
        marks.push({ start: m.index, end: m.index + m[0].length, kind: "rel" })
        break
      }
    }
  }

  // 3) 量数：已知数值 + 其后的单位；未知量（value=null）不落正文
  for (const q of data.quantities ?? []) {
    if (q?.value == null) continue
    const num = String(q.value)
    const i = findNumber(text, num)
    if (i < 0) continue
    let end = i + num.length
    const unit = String(q.unit ?? "")
    if (unit && text.startsWith(unit, end)) end += unit.length
    marks.push({ start: i, end, kind: "qty" })
  }

  return marks
}

/** 按优先级把标记落到「逐字数组」上（低优先级先铺、高优先级覆盖），再合并成连续片段。
 *  用逐字数组而非区间排序，是因为标记天然会嵌套（问题句里含量数/关系词）。 */
export function mathMarksToSegments(text: string, marks: MathMark[]): MathAnalyzeMark[] {
  const kinds = new Array<MathMarkKind | null>(text.length).fill(null)
  for (const k of ["ask", "rel", "qty"] as MathMarkKind[]) {
    for (const m of marks) {
      if (m.kind !== k) continue
      for (let i = m.start; i < m.end && i < text.length; i++) kinds[i] = k
    }
  }
  const segs: MathAnalyzeMark[] = []
  let i = 0
  while (i < text.length) {
    const k = kinds[i]
    let j = i
    while (j < text.length && kinds[j] === k) j++
    segs.push({ text: text.slice(i, j), kind: k })
    i = j
  }
  return segs
}

/** 一步到位：analyze 结果 → 可直接渲染的片段序列 */
export function mathAnalyzeSegments(text: string, data: MathAnalyzeInput): MathAnalyzeMark[] {
  return mathMarksToSegments(text, buildMathMarks(text, data))
}

/** 关系 → 中文关系式（描述数量关系，不给答案、不剧透运算结果） */
export function relationText(r: {
  a?: string
  b?: string
  type?: string
  amount?: number
  parts?: string[]
}): string {
  const a = String(r?.a ?? "")
  const b = String(r?.b ?? "")
  const amount = Number(r?.amount ?? 0)
  switch (String(r?.type ?? "")) {
    case "total":
      return `${a || "总数"} = ${(r?.parts ?? []).join(" + ")}`
    case "times":
      return `${a} 是 ${b} 的 ${amount} 倍`
    case "more":
      return `${a} 比 ${b} 多 ${amount}`
    case "less":
      return `${a} 比 ${b} 少 ${amount}`
    default:
      return ""
  }
}
