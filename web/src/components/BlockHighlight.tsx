/** 段落高亮解析 — 对识别文本按学习重点高亮（核心句/优美词句/重点词），附口语化学习提示 */

import { useMemo, useState } from "react"
import { highlightMark, type HighlightMarkItem, type HighlightMarkResult } from "../services/aichinese"
import { useTts } from "../hooks/useTts"
import { detailFromError } from "../services/auth"

interface BlockHighlightProps {
  text: string
  /** 解析成功后上报（父组件把高亮叠加到正文渲染） */
  onParsed?: (marks: HighlightMarkItem[], tip: string) => void
  /** 是否在本组件内展示高亮正文副本；false=只在正文渲染（如语文块），这里只展示学习提示 */
  showInline?: boolean
}

interface Segment {
  text: string
  type: string | null
}

function splitSegments(data: HighlightMarkResult | null): Segment[] {
  if (!data) return []
  const segs: Segment[] = []
  let cursor = 0
  for (const h of data.highlights) {
    const idx = data.text.indexOf(h.phrase, cursor)
    if (idx < 0) continue
    if (idx > cursor) segs.push({ text: data.text.slice(cursor, idx), type: null })
    segs.push({ text: h.phrase, type: h.type })
    cursor = idx + h.phrase.length
  }
  if (cursor < data.text.length) segs.push({ text: data.text.slice(cursor), type: null })
  return segs
}

export function BlockHighlight({ text, onParsed, showInline = true }: BlockHighlightProps) {
  const { speaking, speak } = useTts()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<HighlightMarkResult | null>(null)
  const [error, setError] = useState("")
  const segments = useMemo(() => splitSegments(data), [data])

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (data) return
    setLoading(true)
    setError("")
    try {
      const res = await highlightMark(text)
      setData(res)
      onParsed?.(res.highlights, res.tip)
    } catch (err) {
      setError(`解析失败: ${detailFromError(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="block-highlight">
      <button
        className="block-ops-btn block-highlight-btn"
        onClick={toggle}
        disabled={loading}
        title={open ? "收起解析" : "解析高亮"}
        aria-label="解析高亮"
      >
        {loading ? "…" : open ? "✕" : "✨"}
      </button>
      {open && (
        <div className="block-highlight-body">
          {error && <p className="err">{error}</p>}
          {data && (
            <>
              {showInline && (
                <>
                  <div className="block-hl-text-head">
                    <span className="block-hl-label">高亮内容</span>
                    <button
                      className="block-speak-btn"
                      disabled={speaking}
                      onClick={() => void speak(data.text)}
                      title="朗读高亮正文"
                    >
                      🔊
                    </button>
                  </div>
                  <div className="block-hl-text">
                    {segments.map((s, i) =>
                      s.type === "core" ? (
                        <b key={i} className="hl-core">{s.text}</b>
                      ) : s.type === "beautiful" ? (
                        <em key={i} className="hl-beautiful">{s.text}</em>
                      ) : s.type === "word" ? (
                        <span key={i} className="hl-word">{s.text}</span>
                      ) : (
                        <span key={i}>{s.text}</span>
                      ),
                    )}
                  </div>
                </>
              )}
              {data.tip && (
                <div className="block-hl-tip">
                  <div className="block-hl-tip-head">
                    <span className="block-hl-tip-label">💡 学习提示</span>
                    <button
                      className="block-speak-btn"
                      disabled={speaking}
                      onClick={() => void speak(data.tip)}
                      title="朗读学习提示"
                    >
                      🔊
                    </button>
                  </div>
                  <div className="block-hl-tip-text">{data.tip}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
