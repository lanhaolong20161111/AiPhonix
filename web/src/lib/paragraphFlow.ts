/** 识别结果排版：把 OCR/LLM 给出的「物理行」还原成「语义段落」。
 *
 * 背景：识图提示词要求「图片上一行 → lines 里一条 text」（逐行保真，见
 * server_cf/src/lib/prompts.ts）。于是一整段正文会被拆成多条短行；前端若逐行渲染
 * （每行一个 div），就会出现「行尾留一片空白、下一个字又从行首另起」的断行观感。
 *
 * 这里按服务端给出的缩进语义重建段落：
 *  - 正文 body 块：首行 indent=1、续行 indent=0（finalizeBlocks / markdownToBlocks 保证）；
 *  - 有序项（1. / ① / 一、）被 markOrderedIndent 标成 indent=1，各自独立成段；
 *  - indent>=1 一律视为「新段落起点」，indent=0 的续行并回上一段。
 * 合并后交给浏览器自动折行。
 * ⚠️ 段落首行缩进请用**两个全角空格**（`\u3000\u3000`），不要用 CSS `text-indent`：
 * 段落里的字是独立行内盒，text-indent 会把**每个字盒**都撑宽 2em（实测 `、` 24px→64px），
 * 造成「行内巨大空隙」。
 *
 * 中文行之间直接拼接（不插空格），英文/数字边界补一个空格，英文折行连字符去掉。
 */

/** 汉字 + 中文标点 + 全角字符：这些字符相邻时行间不需要空格 */
const HAN_CLS = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3000-\\u303F\\uFF00-\\uFFEF"
const HAN_RE = new RegExp(`[${HAN_CLS}]`)

function isHan(ch: string): boolean {
  return !!ch && HAN_RE.test(ch)
}

/** 去掉行首的 markdown 标题记号（`#` ~ `######` + 空格）。
 *
 * 模型（英语模块尤其明显）有时把图片里的小标题写成 markdown：`## Tom's Family`。
 * 直接当正文渲染就会出现刺眼的 `##`。这里只吃掉「# + 空白」形式，
 * `#1`（井号后没空格）不动，避免误伤题号/标签。
 * 放在 tidyInlineSpaces 里 → 语文(BlockText)、数学/语文兜底(reflowText)、
 * 英语(EnglishResult) 全部路径一次生效。 */
export function stripMdHeaders(s: string): string {
  return (s ?? "").replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
}

/** 清理行内噪声空白：汉字/中文标点旁边的空格是 OCR 常见噪声（如 `(  危险`、`)的霞光`），
 * 删掉；纯西文之间的空格有意义（`hello world`）保留。
 * ⚠️ 「（  ）」这类**填空位**必须原样保留——先摘出来占位，清理完再还原，
 * 否则 `（  ）的霞光` 会被压成 `（）的霞光`，孩子就看不到要填几个字了。
 * 同时把换行/制表符/连续空白归一为单个半角空格。 */
export function tidyInlineSpaces(s: string): string {
  const src = stripMdHeaders(s || "").trim()
  if (!src) return ""
  // 先摘出填空位（含其中原始空白宽度），再做空白归一 —— 保证 `（  ）` 宽度不失真
  const blanks: string[] = []
  let t = src.replace(/[（(][ \t\u3000]*[）)]/g, (m) => {
    blanks.push(m)
    return `\u0000${blanks.length - 1}\u0000`
  })
  t = t.replace(/\s+/g, " ").trim()
  t = t
    .replace(new RegExp(`([${HAN_CLS}]) +(?=\\S)`, "g"), "$1")
    .replace(new RegExp(`(\\S) +(?=[${HAN_CLS}])`, "g"), "$1")
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => blanks[Number(i)] ?? "")
  return t.trim()
}

/** 匹配「填空位」：括号里只有空白（如 `（  ）`、`( )`、`（　）`）。 */
export const BLANK_RE = /[（(][ \t\u3000]*[）)]/

/** 把文本切成「填空位 / 普通文本」两类片段。
 *
 * 填空位是给孩子看的语义单元（要填几个字），必须整体渲染成不可断单元，
 * 否则浏览器会在「（」和「）」之间的空格处断行，右括号被甩到下一行行首。 */
export function splitBlanks(s: string): { blank: boolean; text: string }[] {
  const raw = s ?? ""
  if (!BLANK_RE.test(raw)) return [{ blank: false, text: raw }]
  const out: { blank: boolean; text: string }[] = []
  const re = new RegExp(BLANK_RE.source, "g")
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) out.push({ blank: false, text: raw.slice(last, m.index) })
    out.push({ blank: true, text: m[0] })
    last = m.index + m[0].length
  }
  if (last < raw.length) out.push({ blank: false, text: raw.slice(last) })
  return out
}

/** 拼接同一段落的两片文本：中文直拼 / 西文补空格 / 英文折行连字符合并 */
function joinPieces(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  if (/[-‐–—]$/.test(a) && /^[A-Za-z]/.test(b)) return a.slice(0, -1) + b
  return isHan(a.slice(-1)) && isHan(b.slice(0, 1)) ? a + b : `${a} ${b}`
}

export interface FlowLine {
  text: string
  indent?: number | null
}

export interface TableSegment {
  type: "text" | "table"
  text: string
}

/** 把 markdown 管道表（首行 `| a | b |`、次行 `| --- | --- |` 分隔行）转成 HTML table。
 * 返回 null 表示这不是一张完整的管道表（调用方按普通文本处理）。 */
export function pipeTableToHtml(block: string): string | null {
  const lines = (block || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return null
  if (!lines[0].startsWith("|")) return null
  // 分隔行：只由 | - : 和空白组成，且至少有一个 -
  if (!/^\|?[\s:|-]*-[\s:|-]*\|?$/.test(lines[1])) return null
  const cells = (l: string) =>
    l
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim())
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const head = cells(lines[0])
  const rows = lines.slice(2).map(cells)
  if (!head.length) return null
  const thead = `<thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>`
  const tbody = rows.length
    ? `<tbody>${rows.map((r) => `<tr>${head.map((_, i) => `<td>${esc(r[i] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`
    : ""
  return `<table>${thead}${tbody}</table>`
}

/** 把纯文本里的管道表片段切出来（其余仍是文本段）。 */
function splitPipeTables(text: string): TableSegment[] {
  const lines = (text ?? "").split("\n")
  const out: TableSegment[] = []
  let buf: string[] = []
  const flushText = () => {
    if (buf.length) {
      out.push({ type: "text", text: buf.join("\n") })
      buf = []
    }
  }
  let i = 0
  while (i < lines.length) {
    const cur = lines[i].trim()
    const nxt = (lines[i + 1] ?? "").trim()
    const isTableStart = cur.startsWith("|") && /^\|?[\s:|-]*-[\s:|-]*\|?$/.test(nxt)
    if (!isTableStart) {
      buf.push(lines[i])
      i++
      continue
    }
    const start = i
    while (i < lines.length && lines[i].trim().startsWith("|")) i++
    const html = pipeTableToHtml(lines.slice(start, i).join("\n"))
    if (html) {
      flushText()
      out.push({ type: "table", text: html })
    } else {
      // 解析不出真表格 → 原样保留为文本，不丢内容
      for (let k = start; k < i; k++) buf.push(lines[k])
    }
  }
  flushText()
  return out.length ? out : [{ type: "text", text: text ?? "" }]
}

/** 把一段识别文本按内嵌 HTML `<table>…</table>` 切成"文本段 / 表格段"。
 *
 * 模型（豆包表格模式）与 PaddleOCR 会把 HTML 表格混排在正文里（如「四、照样子填表。＋表格＋
 * 五、填空。」）。若整段交给逐字/逐词渲染，标签本身会被当成普通文字显示成一串
 * `<table><tr><td>` 尖括号，单元格也不能点读；直接整段丢给表格组件又会丢掉表格前后的文字。
 * 故按表格边界切段，各段各自渲染。无表格时返回单段文本，调用方行为不变。
 *
 * 数学/英语的题目路径只有纯文本（没有 blocks），OCR 常把表格留成 markdown 管道表
 * （`| 要查的字 | 音序查字法 |` + `| --- | --- |`），前端会显示成一串竖线噪声，
 * 这里一并转成真表格。 */
export function splitInlineTables(text: string): TableSegment[] {
  const t = text ?? ""
  if (!/<table[\s>]/i.test(t)) return splitPipeTables(t)
  const mixed: TableSegment[] = []
  const re = /<table[\s\S]*?<\/table>/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) mixed.push({ type: "text", text: t.slice(last, m.index) })
    mixed.push({ type: "table", text: m[0] })
    last = m.index + m[0].length
  }
  if (last < t.length) mixed.push({ type: "text", text: t.slice(last) })
  // 文本段里可能还混着管道表，再切一遍
  const out: TableSegment[] = []
  for (const seg of mixed) {
    if (seg.type === "table") out.push(seg)
    else out.push(...splitPipeTables(seg.text))
  }
  return out
}

/** 把块内的物理行按缩进语义合并为段落数组（每项是一整段文本，无换行）。 */
export function buildParagraphs(lines: FlowLine[] | null | undefined): string[] {
  const out: string[] = []
  for (const l of lines || []) {
    const piece = tidyInlineSpaces(l?.text ?? "")
    if (!piece) continue
    const startNew = out.length === 0 || (l?.indent || 0) >= 1
    if (startNew) out.push(piece)
    else out[out.length - 1] = joinPieces(out[out.length - 1], piece)
  }
  return out
}

/** 有序项/题号前缀：`1.` `1、` `（1）` `①` `一、` 等 —— 这类行各自起一段，不能被并进上一段。 */
const ORDERED_PREFIX =
  /^\s*(?:[（(]\s*\d{1,2}\s*[）)]|(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[.、．)）]|[①-⑳])/

/** 标签前缀：`近义词：` `反义词：` `答：` `解析：` `例：` 等 —— 也是独立信息项。
 *
 * 语文/数学试卷常把这类条目按物理行排成两行：
 *   `近义词：镇定—减少—寒冷—危险—`
 *   `反义词：美丽—模糊—镇静—凶猛—`
 * 若当成普通续行合并，就会在行首标签中间断行，出现「…危险—反义 / 词：美丽…」。 */
const LABEL_PREFIX = /^[^\s]{1,6}[：:]/

/** 把「按图片物理行硬折行」的纯文本还原成段落数组。
 *
 * 用于题目/纯文本渲染（英语、数学、语文兜底路径）：这些文本来自 OCR，每一行都是
 * 图片上的一行，直接按 `\n` 渲染（换行符 + white-space:pre-wrap）就会出现
 * 「行内还有空间、下一个字另起一行到行首」。这里把物理行并回语义段落，
 * 交给浏览器自动折行：
 *  - 空行 = 强制分段；
 *  - 有序项（1. / ① / 一、）= 各自独立成段；
 *  - 标签项（`近义词：` / `答：` 等，见 LABEL_PREFIX）= 各自独立成段；
 *  - 其余非空行 = 续行，并回上一段（中文直拼，英文补空格）。
 * 调用方负责「段落首行空两格」（用两个全角空格，不要用 text-indent）。 */
export function reflowText(raw: string): string[] {
  const out: string[] = []
  let fresh = true
  for (const ln of (raw || "").split(/\r?\n/)) {
    const t = tidyInlineSpaces(ln)
    if (!t) {
      fresh = true
      continue
    }
    if (fresh || out.length === 0 || ORDERED_PREFIX.test(t) || LABEL_PREFIX.test(t)) out.push(t)
    else out[out.length - 1] = joinPieces(out[out.length - 1], t)
    fresh = false
  }
  return out
}
