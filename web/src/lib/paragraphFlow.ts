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
 * 合并后交给浏览器自动折行，段落首行用 text-indent 空两格。
 *
 * 中文行之间直接拼接（不插空格），英文/数字边界补一个空格，英文折行连字符去掉。
 */

/** 汉字 + 中文标点 + 全角字符：这些字符相邻时行间不需要空格 */
const HAN_CLS = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3000-\\u303F\\uFF00-\\uFFEF"
const HAN_RE = new RegExp(`[${HAN_CLS}]`)

function isHan(ch: string): boolean {
  return !!ch && HAN_RE.test(ch)
}

/** 清理行内噪声空白：汉字/中文标点旁边的空格是 OCR 常见噪声（如 `(  危险`、`)的霞光`），
 * 删掉；纯西文之间的空格有意义（`hello world`）保留。
 * ⚠️ 「（  ）」这类**填空位**必须原样保留——先摘出来占位，清理完再还原，
 * 否则 `（  ）的霞光` 会被压成 `（）的霞光`，孩子就看不到要填几个字了。
 * 同时把换行/制表符/连续空白归一为单个半角空格。 */
export function tidyInlineSpaces(s: string): string {
  const src = (s || "").trim()
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

/** 把一段识别文本按内嵌 HTML `<table>…</table>` 切成"文本段 / 表格段"。
 *
 * 模型（豆包表格模式）与 PaddleOCR 会把 HTML 表格混排在正文里（如「四、照样子填表。＋表格＋
 * 五、填空。」）。若整段交给逐字/逐词渲染，标签本身会被当成普通文字显示成一串
 * `<table><tr><td>` 尖括号，单元格也不能点读；直接整段丢给表格组件又会丢掉表格前后的文字。
 * 故按表格边界切段，各段各自渲染。无表格时返回单段文本，调用方行为不变。 */
export function splitInlineTables(text: string): TableSegment[] {
  const t = text ?? ""
  if (!/<table[\s>]/i.test(t)) return [{ type: "text", text: t }]
  const out: TableSegment[] = []
  const re = /<table[\s\S]*?<\/table>/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) out.push({ type: "text", text: t.slice(last, m.index) })
    out.push({ type: "table", text: m[0] })
    last = m.index + m[0].length
  }
  if (last < t.length) out.push({ type: "text", text: t.slice(last) })
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
