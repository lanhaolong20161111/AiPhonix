/** 流式识图 — 增量 JSON 文本抽取器（2026-09-10）
 *
 * 豆包 OCR 合并调用输出形如：
 *   {"blocks":[{"type":"body","lines":[{"text":"床前明月光","indent":0},...]}]}
 * 文本藏在 `"text":"…"` 字符串值里。若等完整 JSON 解析再出字，学生要等 10~30s；
 * 本类在流式过程中**增量扫描**，把每个已闭合的 text 字符串按出现顺序立刻吐出：
 * 模型一写完一行就能显示，显著降低「看到第一段文字」的时间。
 *
 * 设计要点：
 * - 只吐闭合字符串（未闭合等下一块，绝不吐半行/半个汉字）；
 * - 正确跳过 \" \\ \n \uXXXX 等转义，不把转义中间态误判为结束；
 * - 去重：模型重跑/回显可能重复同一行，已出现过的文本不再吐（按内容去重）；
 * - 同时兼容块级 `"text"`（表格 table 块的 text 是完整 HTML）。
 */

export class IncrementalLineExtractor {
  private buf = ""
  private emitted: string[] = []
  /** 已解析到的 buffer 游标（避免重复扫描/重复吐字） */
  private cursor = 0

  /** 喂入一段 delta，返回本次新吐出的文本行（可能为空数组） */
  push(chunk: string): string[] {
    this.buf += chunk
    const out: string[] = []
    const re = /"text"\s*:\s*"/g
    re.lastIndex = this.cursor
    let m: RegExpExecArray | null
    while ((m = re.exec(this.buf))) {
      const valueStart = m.index + m[0].length
      // 从 valueStart 扫描字符串，处理转义；未闭合（没找到收尾引号）则本轮到头
      let i = valueStart
      let closed = false
      let raw = ""
      while (i < this.buf.length) {
        const ch = this.buf[i]
        if (ch === "\\") {
          if (i + 1 >= this.buf.length) break // 转义符在块尾，等下一块
          raw += this.buf[i] + this.buf[i + 1]
          i += 2
          continue
        }
        if (ch === '"') {
          closed = true
          break
        }
        raw += ch
        i += 1
      }
      if (!closed) break // 未闭合：等更多数据
      let text = raw
      try {
        text = JSON.parse('"' + raw + '"') as string
      } catch {
        /* 转义异常：按原文保留 */
      }
      text = text.replace(/\\n/g, "\n").trim()
      if (text && !this.emitted.includes(text)) {
        this.emitted.push(text)
        out.push(text)
      }
      this.cursor = i + 1
      re.lastIndex = this.cursor
    }
    return out
  }

  /** 已吐出的全部文本行（用于兜底拼全文） */
  get lines(): string[] {
    return this.emitted
  }
}
