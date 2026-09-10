/** PaddleOCR 的 markdown → blocks 纯字符串转换。
 *
 * 从 paddleOcr.ts 抽出：这里是识别结果「排版」的权威逻辑（段落聚合直接影响学生看到的
 * 版式），必须能脱离 Workers 运行时单独回归测试，故不引入任何运行时依赖。
 */

/** 剥离 PaddleOCR markdown 里嵌入的子图标签（<img ...> / <div>...</div> / <figure>），
 * 避免行内裸 HTML 进入前端文本。 */
export function stripEmbeddedHtml(md: string): string {
  return md
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/?div\b[^>]*>/gi, "")
    .replace(/<\/?figure\b[^>]*>/gi, "")
}

function isTableStart(lines: string[], i: number): boolean {
  // 当前行以 | 开头，且下一行是分隔行（含 --- 与 |）
  const next = lines[i + 1]?.trim() ?? ""
  return next.startsWith("|") && /\|[\s:|-]+\|/.test(next) && next.includes("---")
}

function collectTable(lines: string[], i: number): { html: string; next: number } {
  const rows: string[] = []
  let j = i
  while (j < lines.length && lines[j].trim().startsWith("|")) {
    rows.push(lines[j].trim())
    j++
  }
  if (rows.length < 2) return { html: rows.join("\n"), next: j }
  const splitRow = (r: string) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
  const header = splitRow(rows[0])
  const bodyRows = rows.slice(2).map(splitRow)
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const thead = "<tr>" + header.map((c) => `<th>${esc(c)}</th>`).join("") + "</tr>"
  const tbody = bodyRows.map((r) => "<tr>" + r.map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>").join("")
  const html = `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`
  return { html, next: j }
}

/** PaddleOCR 的 markdown → 我们的 blocks[] 结构（title/heading/body/table）。
 * 最佳努力转换：标题转 heading、表格转 HTML table 块、其余按 **markdown 段落**聚合。
 *
 * ⚠️ 段落聚合是排版关键：Paddle 的 markdown 用空行分隔段落，段内换行只是版面折行。
 * 早年把每个非空行都输出成独立 body 块，前端逐块渲染 → 每行都从行首另起、行尾留白，
 * 一段正文被切得七零八落。现在按空行聚合，lines 保留段内各物理行（首行 indent=1、
 * 续行 indent=0），前端据此把物理行并回语义段落并自动折行（段落首行空两格）。
 * polyphones 留空（本引擎不标拼音）。 */
export function markdownToBlocks(md: string): any[] {
  const lines = md.split("\n")
  const blocks: any[] = []
  let i = 0
  let para: string[] = []
  const flushPara = () => {
    if (!para.length) return
    const rows = para
    para = []
    blocks.push({
      type: "body",
      text: rows.join("\n"),
      align: "left",
      lines: rows.map((t, idx) => ({ text: t, indent: idx === 0 ? 1 : 0 })),
      polyphones: {},
    })
  }
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      flushPara() // 空行 = 段落边界
      i++
      continue
    }
    if (trimmed.startsWith("|") && isTableStart(lines, i)) {
      flushPara()
      const tbl = collectTable(lines, i)
      i = tbl.next
      blocks.push({ type: "table", text: tbl.html, align: "left", lines: [], polyphones: {} })
      continue
    }
    // HTML 表格：PP-StructureV3 开启表格识别（数学/英语通道）时，markdown 里表格直接是
    // HTML <table>。若不识别，整段标签会被当正文 → 前端显示一串尖括号、单元格不能点读。
    if (/^<table[\s>]/i.test(trimmed)) {
      flushPara()
      let html = ""
      let j = i
      while (j < lines.length) {
        html += (html ? "\n" : "") + lines[j].trim()
        if (/<\/table>/i.test(lines[j])) {
          j++
          break
        }
        j++
      }
      i = j
      blocks.push({ type: "table", text: html, align: "left", lines: [], polyphones: {} })
      continue
    }
    const h = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      flushPara()
      const level = h[1].length
      const txt = h[2].trim()
      blocks.push({
        type: level === 1 ? "title" : "heading",
        text: txt,
        align: "left",
        lines: [{ text: txt, indent: 0 }],
        polyphones: {},
      })
      i++
      continue
    }
    para.push(trimmed)
    i++
  }
  flushPara()
  return blocks
}
