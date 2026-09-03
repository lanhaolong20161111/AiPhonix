/** 识别文本渲染 — 将【旁批】【注脚】【拓展】【手写批改】等旁注区块默认折叠 */

import { useState } from "react"

/** 旁注区块类型（服务端 Ark 识图提示词标记） */
const SIDE_NOTE_TYPES = ["旁批", "旁白", "注脚", "拓展", "手写批改"] as const
type SideNoteType = (typeof SIDE_NOTE_TYPES)[number]

interface Segment {
  text: string
  noteType: SideNoteType | null
}

/**
 * 把识别文本按旁注标记切分成段落。
 * 标记格式：【旁批】内容...（内容直到下一个【旁...】标记或文本结束）
 */
function splitSegments(text: string): Segment[] {
  if (!text) return []
  const segs: Segment[] = []
  const regex = /【(旁批|旁白|注脚|拓展|手写批改)】/g

  // 收集所有标记位置
  const marks: Array<{ index: number; type: SideNoteType }> = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    marks.push({ index: match.index, type: match[1] as SideNoteType })
  }
  if (marks.length === 0) {
    return text.trim() ? [{ text, noteType: null }] : []
  }

  let cursor = 0
  for (let i = 0; i < marks.length; i++) {
    const { index, type } = marks[i]
    const contentStart = index + `【${type}】`.length
    const contentEnd = i + 1 < marks.length ? marks[i + 1].index : text.length
    // 标记前的普通文本
    if (index > cursor) {
      const body = text.slice(cursor, index).trim()
      if (body) segs.push({ text: body, noteType: null })
    }
    const noteBody = text.slice(contentStart, contentEnd).trim()
    if (noteBody) segs.push({ text: noteBody, noteType: type })
    cursor = contentEnd
  }
  // 末尾剩余普通文本
  if (cursor < text.length) {
    const tail = text.slice(cursor).trim()
    if (tail) segs.push({ text: tail, noteType: null })
  }
  return segs
}

const NOTE_LABELS: Record<SideNoteType, string> = {
  旁批: "📝 旁批",
  旁白: "💬 旁白",
  注脚: "📌 注脚",
  拓展: "📚 知识拓展",
  手写批改: "✏️ 手写批改",
}

/** 折叠可展开的旁注区块 */
function CollapsibleNote({ type, text }: { type: SideNoteType; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="side-note">
      <button className="side-note-toggle" onClick={() => setOpen((o) => !o)}>
        <span className={`side-note-arrow${open ? " open" : ""}`}>▶</span>
        <span className="side-note-label">{NOTE_LABELS[type]}</span>
        <span className="side-note-count">{text.length} 字</span>
      </button>
      {open && <div className="side-note-body">{text}</div>}
    </div>
  )
}

/** 识别文本渲染器：普通段落保留换行，旁注区块默认折叠 */
export function CollapsibleText({ text }: { text: string }) {
  const segments = splitSegments(text)
  if (segments.length === 0) return null

  return (
    <div className="collapsible-text">
      {segments.map((seg, i) =>
        seg.noteType ? (
          <CollapsibleNote key={i} type={seg.noteType} text={seg.text} />
        ) : (
          <div key={i} className="collapsible-body">
            {seg.text}
          </div>
        ),
      )}
    </div>
  )
}
