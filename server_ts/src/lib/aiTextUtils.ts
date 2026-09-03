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

export function extractBlocks(reply: string): Block[] {
  try {
    const data = JSON.parse(stripCodeFence(reply || ""))
    if (!data || typeof data !== "object" || Array.isArray(data)) return []
    const blocks: Block[] = []
    const list = (data as { blocks?: unknown[] }).blocks ?? []
    for (const b of list) {
      if (!b || typeof b !== "object") continue
      const obj = b as Record<string, unknown>
      const text = String(obj.text ?? "").trim()
      if (!text) continue
      let type = String(obj.type ?? "").trim()
      if (!["title", "heading", "body", "question", "option", "note"].includes(type)) type = "body"
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
  t = t.replace(/\$+\^?\{?([^$]*?)\}?\$+/g, "$1")
  t = t.replace(/\$+/g, "")
  t = t.replace(/\\text\{([^{}]*)\}/g, "$1")
  t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
  t = t.replace(/<sub>([^<]*)<\/sub>/gi, "$1")
  t = t.replace(/<sup>([^<]*)<\/sup>/gi, "$1")
  return t
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
