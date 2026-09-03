/** 可点读表格组件 —— 把模型生成的表格 HTML 递归重建为 React 元素，
 * 每个 td/th 单元格内的可发音汉字（汉字/拼音/数字）都变成可点读 span。
 *
 * 保留 colspan/rowspan/align 等表格结构属性；标点/空格原样渲染。
 * 清洗失败（无 <table>）回退为纯文本。 */
import { useMemo } from "react"
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react"
import { sanitizeTableHtml } from "../lib/safeHtml"
import { isSpeakableChar } from "../lib/chars"
import { useCharLongPressFactory } from "../hooks/useCharLongPress"

interface SpeakableTableProps {
  html: string
  /** 单元格点读粒度：char=逐字（中文，默认）；word=整词（英语，点词内任意字母读整词/整格） */
  cellTapMode?: "char" | "word"
  speakingChar?: string | null
  onCharClick?: (ch: string) => void
  onCharLongPress?: (ch: string) => void
  speakingWord?: string | null
  onWordClick?: (word: string) => void
  onWordLongPress?: (word: string) => void
}

interface RenderCtx {
  speakingChar: string | null
  onCharClick: (ch: string) => void
  makeLpHandlers: (ch: string) => Record<string, (e: ReactPointerEvent<HTMLElement>) => void>
  cellTapMode: "char" | "word"
  speakingWord: string | null
  onWordClick?: (word: string) => void
  onWordLongPress?: (word: string) => void
  makeWordLpHandlers: (word: string) => Record<string, (e: ReactPointerEvent<HTMLElement>) => void>
}

/** 把文本拆成逐字 span：可发音字符可点读+长按，其余原样 */
function renderText(text: string, ctx: RenderCtx, key: string): ReactNode[] {
  // 英语整词模式：按空白切词，点词内任意字母朗读整个单词（整词/整格）
  if (ctx.cellTapMode === "word") {
    const segs = text.match(/\s+|\S+/g) ?? []
    return segs.map((seg, i) => {
      const k = `${key}-${i}`
      if (/^\s+$/.test(seg)) {
        return (
          <span key={k} className="block-char-space">
            {seg.includes("\n") ? seg.split("").map((c, j) => (c === "\n" ? <br key={j} /> : c)) : seg}
          </span>
        )
      }
      const word = seg
      const playing = ctx.speakingWord === word
      return (
        <span
          key={k}
          className={`block-char tap-char-word${playing ? " playing" : ""}`}
          onClick={() => ctx.onWordClick?.(word)}
          title="点读整词 · 长按加生词本"
          {...(ctx.makeWordLpHandlers?.(word) ?? {})}
        >
          {word}
        </span>
      )
    })
  }
  return Array.from(text).map((ch, i) => {
    const k = `${key}-${i}`
    if (ch === "\n") return <br key={k} />
    if (ch === " " || ch === "\u3000") {
      return <span key={k} className="block-char-space">{ch === " " ? "\u3000" : ch}</span>
    }
    if (!isSpeakableChar(ch)) {
      return <span key={k} className="block-char-noop">{ch}</span>
    }
    const isPlaying = ctx.speakingChar === ch
    return (
      <span
        key={k}
        className={`block-char${isPlaying ? " playing" : ""}`}
        onClick={() => ctx.onCharClick?.(ch)}
        title="点读 · 长按加生词本"
        {...ctx.makeLpHandlers(ch)}
      >
        {ch}
      </span>
    )
  })
}

function renderNode(node: Node, ctx: RenderCtx, keyPrefix: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ""
    if (!text) return null
    return <span key={keyPrefix}>{renderText(text, ctx, keyPrefix)}</span>
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()

  if (tag === "br") return <br key={keyPrefix} />

  // 提取表格相关属性（colspan→colSpan 等 React 写法）
  const props: Record<string, unknown> = { key: keyPrefix }
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    if (name === "colspan") props.colSpan = attr.value
    else if (name === "rowspan") props.rowSpan = attr.value
    else if (name === "align") props.align = attr.value
    else if (name === "scope") props.scope = attr.value
    else if (name === "width") props.width = attr.value
  }

  const children: ReactNode[] = []
  Array.from(el.childNodes).forEach((child, i) => {
    const rendered = renderNode(child, ctx, `${keyPrefix}-${i}`)
    if (rendered !== null) children.push(rendered)
  })

  switch (tag) {
    case "table":
      return <table key={keyPrefix}>{children}</table>
    case "thead":
      return <thead key={keyPrefix}>{children}</thead>
    case "tbody":
      return <tbody key={keyPrefix}>{children}</tbody>
    case "tfoot":
      return <tfoot key={keyPrefix}>{children}</tfoot>
    case "caption":
      return <caption key={keyPrefix}>{children}</caption>
    case "colgroup":
      return <colgroup key={keyPrefix}>{children}</colgroup>
    case "col":
      return <col key={keyPrefix} {...props} />
    case "tr":
      return <tr key={keyPrefix}>{children}</tr>
    case "td":
      return <td key={keyPrefix} {...props}>{children}</td>
    case "th":
      return <th key={keyPrefix} {...props}>{children}</th>
    case "span":
      return <span key={keyPrefix}>{children}</span>
    case "div":
      return <div key={keyPrefix}>{children}</div>
    case "p":
      return <p key={keyPrefix}>{children}</p>
    default:
      return <span key={keyPrefix}>{children}</span>
  }
}

export function SpeakableTable({
  html,
  cellTapMode = "char",
  speakingChar,
  onCharClick,
  onCharLongPress,
  speakingWord,
  onWordClick,
  onWordLongPress,
}: SpeakableTableProps) {
  const cleaned = useMemo(() => sanitizeTableHtml(html), [html])
  const makeLpHandlers = useCharLongPressFactory(onCharLongPress ?? (() => {}))
  const makeWordLpHandlers = useCharLongPressFactory(onWordLongPress ?? (() => {}))

  const ctx: RenderCtx = useMemo(
    () => ({
      speakingChar: cellTapMode === "word" ? null : speakingChar ?? null,
      onCharClick: onCharClick ?? (() => {}),
      makeLpHandlers,
      cellTapMode,
      speakingWord: cellTapMode === "word" ? speakingWord ?? null : null,
      onWordClick,
      onWordLongPress,
      makeWordLpHandlers,
    }),
    [speakingChar, onCharClick, makeLpHandlers, cellTapMode, speakingWord, onWordClick, onWordLongPress, makeWordLpHandlers],
  )

  const rendered = useMemo(() => {
    if (!cleaned) return null
    const doc = new DOMParser().parseFromString(cleaned, "text/html")
    const table = doc.querySelector("table")
    if (!table) return null
    return renderNode(table, ctx, "tbl")
  }, [cleaned, ctx])

  if (!rendered) {
    return <div className="ai-table-fallback" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{html}</div>
  }
  return <div className="ai-table-wrap">{rendered}</div>
}
