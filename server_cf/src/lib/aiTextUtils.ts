/** 文本处理工具 — 从 Python utils/ai_text_utils.py 移植（JSON/blocks/OCR清洗/题目拆分） */

export interface BlockLine {
  text: string
  indent: number
}
export interface Block {
  type: string
  text: string
  align: string
  lines: BlockLine[]
  polyphones: Record<string, string>
  bbox?: number[] | null
  order?: number | null
}

// ── JSON / blocks 解析 ──

function stripCodeFence(s: string): string {
  let c = (s || "").trim()
  if (c.startsWith("```")) {
    c = c.replace(/^```(?:json)?\s*/i, "")
    c = c.replace(/\s*```\s*$/, "")
  }
  return c
}

export function extractJsonArray(text: string): unknown[] {
  try {
    let c = stripCodeFence(text)
    const s = c.indexOf("["), e = c.lastIndexOf("]")
    if (s >= 0 && e > s) c = c.slice(s, e + 1)
    const data = JSON.parse(c)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** 从 LLM 回复里解出 blocks 数组。
 *
 * ⚠️ 2026-09-02 修复：合并调用提示词 DOUBAO_OCR_JSON_PROMPT 明确要求「不要写 text 字段」
 * （块全文 = lines 逐行拼接，写一遍是重复劳动、拖慢速度）。但这里原本以 `if (!text) continue`
 * 直接丢弃无 text 的块 —— 于是快路径 100% 解析为空、每次都回退两段式（多跑 OCR+排版+去噪
 * 三次模型调用，实测 13.1s vs 快路径 3.7s）。finalizeBlocks 当年已同步支持「由 lines 推导
 * text」，唯独漏了先执行的本函数。
 * 现在改为：text 缺失时由 lines 逐行拼接推导（与 finalizeBlocks 一致）。
 */
export function extractBlocks(reply: string): Block[] {
  try {
    const data = JSON.parse(stripCodeFence(reply || ""))
    if (!data || typeof data !== "object" || Array.isArray(data)) return []
    const blocks: Block[] = []
    const list = (data as { blocks?: unknown[] }).blocks ?? []
    for (const b of list) {
      if (!b || typeof b !== "object") continue
      const obj = b as Record<string, unknown>
      let type = String(obj.type ?? "").trim()
      if (!["title", "heading", "body", "question", "option", "note", "table"].includes(type)) type = "body"
      let align = String(obj.align ?? "").trim()
      if (!["left", "center", "right"].includes(align)) align = "left"
      const poly: Record<string, string> = {}
      const p = (obj.polyphones ?? {}) as Record<string, unknown>
      if (p && typeof p === "object" && !Array.isArray(p)) {
        for (const [k, v] of Object.entries(p)) {
          const ks = String(k).trim()
          const vs = String(v ?? "").trim()
          if (ks && ks.length === 1 && vs) poly[ks] = vs
        }
      }
      const lines: BlockLine[] = []
      for (const ln of (obj.lines ?? []) as unknown[]) {
        if (ln && typeof ln === "object") {
          const lt = String((ln as Record<string, unknown>).text ?? "").trim()
          if (lt) {
            let indent = Number((ln as Record<string, unknown>).indent ?? 0)
            indent = indent < 0 ? 0 : Math.min(indent, 3)
            lines.push({ text: lt, indent })
          }
        }
      }
      // text 字段缺失（合并调用提示词刻意省略）→ 由 lines 逐行拼接推导
      let text = String(obj.text ?? "").trim()
      if (!text && lines.length) text = lines.map((l) => l.text).join("\n")
      if (!text) continue // 既无 text 也无 lines → 空块，丢弃
      if (!lines.length) lines.push({ text, indent: 0 })
      blocks.push({ type, text, align, lines, polyphones: poly })
    }
    return blocks
  } catch {
    return []
  }
}

export function extractHtmlTables(text: string): [string, string[]] {
  const tables: string[] = []
  const replaced = text.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (m) => {
    tables.push(m)
    return `\n[TABLE]${tables.length - 1}\n`
  })
  return [replaced, tables]
}

export function mergeTableBlocks(blocks: Block[], tables: string[]): Block[] {
  if (!tables.length) return blocks
  const out: Block[] = []
  for (const b of blocks) {
    const text = String(b.text || "")
    let hit: [number, number, number] | null = null
    const re = /\[TABLE\](\d+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const idx = Number(m[1])
      if (idx >= 0 && idx < tables.length) {
        hit = [m.index, m.index + m[0].length, idx]
        break
      }
    }
    if (hit === null) {
      out.push(b)
      continue
    }
    const [start, end, idx] = hit
    const before = text.slice(0, start).trim()
    const after = text.slice(end).trim()
    if (before) out.push({ ...b, text: before, lines: [{ text: before, indent: 0 }], type: "body" })
    out.push({ type: "table", text: tables[idx], align: "left", lines: [{ text: tables[idx], indent: 0 }], polyphones: {} })
    if (after) out.push({ ...b, text: after, lines: [{ text: after, indent: 0 }], type: "body" })
  }
  return out
}

export function extractPageBounds(reply: string): { left: number; top: number; right: number; bottom: number } | null {
  try {
    const data = JSON.parse(stripCodeFence(reply || ""))
    if (!data || typeof data !== "object" || Array.isArray(data)) return null
    const pb = (data as { page_bounds?: Record<string, unknown> }).page_bounds ?? {}
    if (!pb || typeof pb !== "object") return null
    let left = Number(pb.left ?? 0)
    let top = Number(pb.top ?? 0)
    let right = Number(pb.right ?? 1000)
    let bottom = Number(pb.bottom ?? 1000)
    if ([left, top, right, bottom].some(Number.isNaN)) return null
    if (left <= 1 && top <= 1 && right >= 999 && bottom >= 999) return null
    left = Math.max(0, Math.min(1000, left))
    top = Math.max(0, Math.min(1000, top))
    right = Math.max(left + 1, Math.min(1000, right))
    bottom = Math.max(top + 1, Math.min(1000, bottom))
    return { left, top, right, bottom }
  } catch {
    return null
  }
}

// ── blocks 排版修正 ──

export function reorderTitleFirst(blocks: Block[]): void {
  if (blocks.length < 2) return
  const titleIdx = blocks.findIndex((b) => b.type === "title")
  if (titleIdx === -1 || titleIdx === 0) return
  const [title] = blocks.splice(titleIdx, 1)
  blocks.unshift(title)
}

export function markPoetry(blocks: Block[]): void {
  for (const b of blocks) {
    const lines = b.lines ?? []
    if (lines.length < 2 || ["title", "heading", "option", "note"].includes(b.type)) continue
    const textLen = lines.map((l) => l.text.replace(/\s/g, "").length)
    if (textLen.some((n) => n < 2 || n > 16)) continue
    const punctEnd = lines.filter((l) => /[，。、！？,]$/.test(l.text.trim())).length
    if (punctEnd < Math.max(1, lines.length - 1)) continue
    b.align = "center"
    for (const l of lines) l.indent = 1
    b.text = lines.map((l) => l.text).join("\n")
  }
}

const ORDERED_PREFIX = /^(?:[（(]?\d+[）).、．]|[①-⑳]|一、|二、|三、|四、|五、|六、|七、|八、|九、|十、|[一二三四五六七八九十]+[、.)．]|[◆◇●○□■△▲★☆])/

export function markOrderedIndent(blocks: Block[]): void {
  for (const b of blocks) {
    if (["title", "heading", "note"].includes(b.type)) continue
    for (const l of b.lines) {
      const t = l.text.trim()
      if (!t || !ORDERED_PREFIX.test(t)) continue
      if ((l.indent || 0) < 1) l.indent = 1
    }
  }
}

// ── OCR 文本清洗 ──

export function fixMojibake(s: string): string {
  const t = s || ""
  if (!t) return t
  const zh = [...t].filter((c) => c >= "\u4e00" && c <= "\u9fff").length
  if (zh > 0) {
    const lines = t.split("\n")
    const fixed = lines.map((ln) => {
      const hasZh = [...ln].some((c) => c >= "\u4e00" && c <= "\u9fff")
      const looksMojibake = !hasZh && ln.length > 2 && /[æåäçèïÉÅæçñîâ]/.test(ln)
      if (looksMojibake) {
        try {
          // latin-1 字节重新按 utf-8 解码
          return Buffer.from(ln, "latin1").toString("utf8")
        } catch {
          return ln
        }
      }
      return ln
    })
    return fixed.join("\n")
  }
  const latinExt = [...t].filter((c) => "æåäçèïÉÅæçñîâàáâã".includes(c)).length
  if (latinExt >= 3) {
    try {
      return Buffer.from(t, "latin1").toString("utf8")
    } catch {
      return t
    }
  }
  return t
}

export function cleanOcrText(s: string): string {
  let t = fixMojibake(s || "")
  t = t.replace(/[\ufffd\u25a1\u25af\u2588\u258c\u2580\u2590]/g, "")
  // ① 先展开 LaTeX 上下标注（注音）：\underset{主体}{注音} → 主体(注音)，避免残留 \$ \cdot 乱码
  t = replaceLatexRubi(t, "underset", true)
  t = replaceLatexRubi(t, "overset", false)
  // ② 展开 \text / \frac（需在剥 $ 之前，否则嵌套花括号会被 $ 规则破坏）
  t = t.replace(/\\text\{([^{}]*)\}/g, "$1")
  t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
  // ③ 清掉裸 LaTeX 命令与残缺上下标注命令名
  t = t.replace(/\\cdot\b/g, "")
  t = t.replace(/\\circ\b/g, "")
  t = t.replace(/\\underset\b|\\overset\b|\\stackrel\b/g, "")
  // ④ 剥剩余 $ 外壳
  t = t.replace(/\$+/g, "")
  // ⑤ HTML 上下标转回普通文本
  t = t.replace(/<sub>([^<]*)<\/sub>/gi, "$1")
  t = t.replace(/<sup>([^<]*)<\/sup>/gi, "$1")
  return t
}

/** 展开 LaTeX 上下标注命令（支持嵌套大括号）。
 * underset: \underset{A}{B} → A(B)；overset: \overset{B}{A} → A(B)。
 * 命令参数里可能含 \text{..}、\cdot 等残留，统一剥离后保留纯文本。 */
function replaceLatexRubi(t: string, cmd: "underset" | "overset", underset: boolean): string {
  const re = new RegExp(`\\\\${cmd}\\s*`, "g")
  let out = ""
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const start = m.index
    const after = m.index + m[0].length
    const args: string[] = []
    let pos = after
    let ok = true
    for (let k = 0; k < 2; k++) {
      while (pos < t.length && /\s/.test(t[pos])) pos++
      if (t[pos] !== "{") { ok = false; break }
      pos++
      let depth = 1
      const segStart = pos
      while (pos < t.length && depth > 0) {
        if (t[pos] === "{") depth++
        else if (t[pos] === "}") depth--
        pos++
      }
      args.push(t.slice(segStart, pos - 1))
    }
    if (!ok || args.length !== 2) {
      out += t.slice(last, start)
      last = start
      continue
    }
    const [a, b] = underset ? [args[0], args[1]] : [args[1], args[0]]
    out += t.slice(last, start) + `${stripLatex(a)}(${stripLatex(b)})`
    last = pos
  }
  return out + t.slice(last)
}

/** 剥掉 LaTeX 片段里的残留命令与大括号（\text{..} → ..，去掉 \frac/\cdot 等），仅留纯文本。 */
function stripLatex(s: string): string {
  return (s || "")
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\[a-zA-Z]+\b/g, "")
    .replace(/[{}\s]/g, "")
}

export function dedupeLines(s: string): string {
  const lines = (s || "").split("\n")
  const out: string[] = []
  let lastNonempty: string | null = null
  for (const ln of lines) {
    const stripped = ln.trim()
    if (stripped === "") {
      out.push(ln)
      continue
    }
    if (stripped === lastNonempty) continue
    out.push(ln)
    lastNonempty = stripped
  }
  return out.join("\n")
}

export function recoverTextFromJson(s: string): string {
  const t = (s || "").trim()
  if (!t.startsWith("{") && !t.startsWith("[")) return s
  let data: unknown
  try {
    data = JSON.parse(t)
  } catch {
    if (t.includes('"text"') || t.includes('"blocks"')) {
      const vals = [...t.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
        .map((m) => (m[1].includes("\\") ? JSON.parse('"' + m[1] + '"') : m[1]))
        .map((v) => String(v).trim())
        .filter(Boolean)
      if (vals.length) return vals.join("\n\n")
    }
    return s
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.blocks)) {
      const parts = obj.blocks
        .filter((b) => b && typeof b === "object")
        .map((b) => String((b as Record<string, unknown>).text ?? "").trim())
        .filter(Boolean)
      if (parts.length) return parts.join("\n\n")
    }
    if (obj.text) return String(obj.text)
  }
  if (Array.isArray(data)) {
    const parts = data
      .filter((b) => b && typeof b === "object")
      .map((b) => String((b as Record<string, unknown>).text ?? "").trim())
      .filter(Boolean)
    if (parts.length) return parts.join("\n\n")
  }
  return s
}

// ── 题目/句子拆分 ──

export function splitQuestions(text: string): string[] {
  const cleaned = cleanOcrText(text || "").trim()
  if (!cleaned) return []

  // 1) 【题N】标记
  const marked = cleaned.split(/【\s*题\s*\d+\s*】/)
  if (marked.length > 1) {
    const out = marked.map((m) => m.trim()).filter(Boolean)
    if (out.length) return out
  }

  // 2) 空行分隔
  const parts = cleaned.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1) return parts

  // 3) 行首题号
  const numbered = cleaned.split(/\n\s*(?=\d+\s*[.、)]|（\d+）|[一二三四五六七八九十]+[、.])/)
  if (numbered.length > 1) {
    const out = numbered.map((p) => p.trim()).filter(Boolean)
    if (out.length) return out
  }

  return [cleaned]
}

export function splitSentences(question: string): string[] {
  const parts = question.split(/(?<=[。！？?!])/)
  const out = parts.map((p) => p.trim()).filter(Boolean)
  return out.length ? out : [question.trim()]
}

// ── 版面几何分段（PP-OCRv6 行块 → 整齐段落） ──

export interface LayoutParagraph {
  /** 合并后的段落文本（同一段落的行直接拼接，中文无需空格） */
  text: string
  /** 段落包围盒（归一化，相对原图尺寸 0~1） */
  nx: number
  ny: number
  nw: number
  nh: number
  /** 段落首行阅读顺序 */
  order: number
}

/**
 * 按几何位置把 PP-OCRv6 零散文本行合并为「整齐段落」，无需任何第三方排版库。
 *
 * 规则（自上而下、同行左→右已排好序的块）：
 * - 当前行中心与上一行中心垂直间距 < 1.5 行高，且水平有重叠/紧邻 → 并入同一段；
 * - 否则另起一段。
 * 用于「切块识图」把识别出的零散行排版成连贯段落；语义级纠错/润色交给 LLM 步骤（见 ai_chinese llmFilterOcrText）。
 */
export function groupParagraphsByLayout(
  blocks: { text: string; nx: number; ny: number; nw: number; nh: number; order?: number }[],
): LayoutParagraph[] {
  const sorted = [...(blocks || [])]
    .filter((b) => b && b.text && b.text.trim())
    .sort((a, b) => a.ny - b.ny || a.nx - b.nx)
  if (!sorted.length) return []

  const paras: LayoutParagraph[] = []
  let cur: { lines: string[]; top: number; bottom: number; left: number; right: number; order: number } | null = null

  const flush = () => {
    if (!cur) return
    paras.push({
      text: cur.lines.join(""),
      nx: cur.left,
      ny: cur.top,
      nw: cur.right - cur.left,
      nh: cur.bottom - cur.top,
      order: cur.order,
    })
  }

  for (const b of sorted) {
    const top = b.ny
    const bottom = b.ny + b.nh
    const left = b.nx
    const right = b.nx + b.nw
    const lineH = b.nh || 0.01
    if (
      cur &&
      // 垂直间距不超过 1.5 行高
      top - cur.bottom < lineH * 1.5 &&
      // 水平有重叠或紧邻（不要求完全包含）
      !(right < cur.left - lineH || left > cur.right + lineH)
    ) {
      cur.lines.push(b.text.trim())
      cur.bottom = Math.max(cur.bottom, bottom)
      cur.left = Math.min(cur.left, left)
      cur.right = Math.max(cur.right, right)
    } else {
      flush()
      cur = { lines: [b.text.trim()], top, bottom, left, right, order: b.order ?? paras.length }
    }
  }
  flush()
  return paras
}

/**
 * 确定性去噪（不依赖 LLM）：删掉「非题目信息」里两类强信号——括号与下划线。
 *
 * - 括号（）/( )：一律删除（含内部内容与空括号「在（ ）里填空」的空位），OCR 常把答案、注释、
 *   小提示或填空横线识别进括号，属“不符合的文本”，按需求全部过滤。
 * - 下划线 _：删除（老师下划线批注 / 填空横线在 OCR 里常被识别成连续下划线）。
 *
 * 纯语义的“非题目信息”（页眉页脚、页码、水印、广告、图标文字）由 LLM 步骤 llmFilterOcrText 处理；
 * 本函数只做稳定、可预测的字符级清理，且保留段落间空行，不影响排版。
 */
export function stripQuestionNoise(raw: string): string {
  let s = raw || ""
  // 反复删除所有单层括号（含空括号），直到无变化（处理连续/嵌套括号）
  for (let i = 0; i < 4; i++) {
    const before = s
    s = s.replace(/[（(]([^（）()]*?)[)）]/g, "")
    if (s === before) break
  }
  // 删除下划线（连续或单个）
  s = s.replace(/_+/g, "")
  // 仅清理行首尾空白与过多空行，保留段落间的单个空行（不影响排版）
  s = s
    .split("\n")
    .map((ln) => ln.replace(/^[ \t　]+|[ \t　]+$/g, ""))
    .join("\n")
  s = s.replace(/\n{3,}/g, "\n\n")
  return s.trim()
}

// ── 课本扫描清洗：去印刷拼音 + 去角落页码 ──

const PINYIN_TONE_RE = /[A-Za-z]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü][A-Za-z]*/g
const ASCII_LETTER_RUN_RE = /[A-Za-z]+/g

/** 去掉印刷在书里的拼音（拉丁字母段，含声调符号），保留中文/标点/数字/空白。
 * 与客户端 stripPinyinKeepDelimiters 同逻辑。系统后续用 polyphones 自己注音，
 * 故识别结果里不应残留印刷拼音。仅对中文模式调用（英语正文本身是拉丁字母，不能去）。 */
export function stripPrintedPinyin(s: string): string {
  if (!s) return ""
  let t = s.replace(PINYIN_TONE_RE, "")
  t = t.replace(ASCII_LETTER_RUN_RE, "")
  return t
}

/** 判断单行文本是否为「页码」。
 * 书本左下/右下角的页码多为孤立的短数字行；因 parse-image 的 blocks 不带坐标，
 * 无法做真正的角落定位，这里按文本模式过滤，覆盖绝大多数页码。
 * 保守策略：整行仅由数字（1~4 位）、第N页、或装饰符号包裹的数字组成，且很短（≤8 字）。
 * 若需像素级角落判定，需额外带 bbox 的检测（见 PaddleV6Block / groupParagraphsByLayout）。 */
export function isPageNumberText(s: string): boolean {
  const t = (s || "").trim()
  if (!t || t.length > 8) return false
  if (/^\d{1,4}$/.test(t)) return true
  if (/^第\s*\d{1,4}\s*页?$/.test(t)) return true
  if (/^[\s\-—·•・〔〕()（）]*\d{1,4}[\s\-—·•・〔〕()（）]*$/.test(t)) return true
  return false
}

/** 清洗 blocks：去印刷拼音 + 丢页码块。返回新数组（不修改入参）。 */
export function cleanBookScanBlocks(blocks: Block[], opts: { stripPinyin?: boolean } = {}): Block[] {
  const sp = !!opts.stripPinyin
  const out: Block[] = []
  for (const b of blocks) {
    const lines = (b.lines ?? []).map((l) => ({
      text: sp ? stripPrintedPinyin(l.text) : l.text,
      indent: l.indent,
    }))
    const strippedText = sp ? stripPrintedPinyin(b.text) : b.text
    const blockText = lines.length ? lines.map((l) => l.text).join("\n") : strippedText
    if (isPageNumberText(blockText)) continue // 整块是页码 → 丢弃
    if (!blockText.trim()) continue // 清洗后变空（纯拼音块）→ 丢弃
    out.push({ ...b, text: blockText, lines })
  }
  return out
}

/** 清洗纯文本：逐行去印刷拼音 + 丢页码行。保留原空白行（段落分隔）。
 * 原非空、清洗后变空（纯拼音行）→ 丢弃。 */
export function cleanBookScanText(text: string, opts: { stripPinyin?: boolean } = {}): string {
  const sp = !!opts.stripPinyin
  const out: string[] = []
  for (const ln of (text || "").split("\n")) {
    if (isPageNumberText(ln)) continue
    const stripped = sp ? stripPrintedPinyin(ln) : ln
    if (ln.trim() && !stripped.trim()) continue // 纯拼音行 → 丢弃
    out.push(stripped)
  }
  return out.join("\n")
}
