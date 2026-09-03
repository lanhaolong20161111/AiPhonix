/** 排版块渲染器 — 逐字点读 + 整块朗读 + 块级评测麦克风 + 标记不认识字
 *
 * 对齐 Android AiChineseScreen 的块渲染。
 */

import { useEffect, useState } from "react"
import type { TextBlock } from "../services/aiImage"
import type { HighlightMarkItem } from "../services/aichinese"
import { isSpeakableChar } from "../lib/chars"
import { tokenizePinyinText, applyToneStr } from "../lib/pinyin"
import { PinyinInline } from "./PinyinInline"
import { getCharPinyinDict } from "../services/wordbank"
import { useSoeScore } from "../hooks/useSoeScore"
import { SoeDetail } from "./SoeDetail"
import { useGlobalReading, useGlobalSpeaking } from "../hooks/useTts"
import { useCharLongPressFactory } from "../hooks/useCharLongPress"

interface BlockTextProps {
  block: TextBlock
  /** 当前正在朗读的单字（高亮） */
  speakingChar: string | null
  /** 标记模式激活 */
  marking: boolean
  /** 已标记的字（红底） */
  markedChars: Set<string>
  onCharClick: (ch: string) => void
  /** 长按单字加入生词本（识别结果页传入；标记模式下不触发） */
  onCharLongPress?: (ch: string) => void
  onSpeakBlock: (text: string) => void
  /** 段落高亮（解析后叠加到正文渲染） */
  highlights?: HighlightMarkItem[]
  /** 点击高亮短语 → 朗读该短语 */
  onSpeakPhrase?: (phrase: string) => void
  /** 隐藏块头朗读喇叭（由外部操作条提供） */
  hideSpeak?: boolean
}

/** 把一行文本按高亮短语切段（高亮段整段渲染，可点击朗读；其余逐字） */
function splitLine(
  line: string,
  highlights: HighlightMarkItem[],
): { text: string; type: string | null; phrase?: string }[] {
  if (!highlights?.length) return [{ text: line, type: null }]
  const segs: { text: string; type: string | null; phrase?: string }[] = []
  let cursor = 0
  for (const h of highlights) {
    const phrase = h?.phrase
    if (!phrase || !line.includes(phrase)) continue
    const idx = line.indexOf(phrase, cursor)
    if (idx < 0) continue
    if (idx > cursor) segs.push({ text: line.slice(cursor, idx), type: null })
    segs.push({ text: phrase, type: h.type, phrase })
    cursor = idx + phrase.length
  }
  if (cursor < line.length) segs.push({ text: line.slice(cursor), type: null })
  return segs
}

export function BlockText({
  block,
  speakingChar,
  marking,
  markedChars,
  onCharClick,
  onCharLongPress,
  onSpeakBlock,
  highlights,
  onSpeakPhrase,
  hideSpeak,
}: BlockTextProps) {
  const globalSpeaking = useGlobalSpeaking()
  const reading = useGlobalReading()
  const [noteOpen, setNoteOpen] = useState(false)
  // 逐字拼音（显示用，带调号）：优先服务端 polyphones（多音字按语境），否则查词库词典
  const [pyMap, setPyMap] = useState<Record<string, string>>({})
  // 长按加生词本（修复版：pointer capture + 移动阈值，不再被手指微动误杀）
  const makeLpHandlers = useCharLongPressFactory(onCharLongPress ?? (() => {}))

  const isTitle = block.type === "title" || block.type === "heading"
  const isNote = block.type === "note"
  const text = block.text.replace(/\s+/g, "")
  if (!text.trim()) return null

  // 给本块每个汉字注上显示用拼音（带调号）：多音字优先用服务端 polyphones，其余查词库
  useEffect(() => {
    let cancelled = false
    const hanChars = Array.from(new Set(text.split(""))).filter((c) => /[一-鿿]/.test(c))
    if (hanChars.length === 0) {
      setPyMap({})
      return
    }
    void (async () => {
      const dict = await getCharPinyinDict()
      if (cancelled) return
      const m: Record<string, string> = {}
      for (const ch of hanChars) {
        const py = block.polyphones?.[ch] ?? dict[ch]
        if (!py) continue
        const body = py.replace(/[0-9]/g, "")
        const tone = Number((py.match(/[1-5]$/) || [])[0] || 0)
        m[ch] = applyToneStr(body, tone)
      }
      setPyMap(m)
    })()
    return () => {
      cancelled = true
    }
  }, [text, block.polyphones])

  // 视觉行：优先用服务端 lines（含缩进）；退化为按换行拆
  const visualLines: { text: string; indent: number }[] =
    block.lines && block.lines.length > 0
      ? block.lines.filter((l) => (l.text || "").trim())
      : text
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => ({ text: l, indent: 0 }))
  const alignCenter = block.align === "center"

  const renderLine = (lineText: string, lineKey: number) => {
    // 保留行内空格显示（诗句/空行缩进），但空格不作为可点读的字
    const segs = splitLine(lineText, highlights ?? [])
    return (
      <span key={lineKey} className="block-line">
        {segs.map((seg, si) => {
          if (seg.type && seg.phrase) {
            return (
              <span
                key={si}
                className={`block-char hl-${seg.type}`}
                title="点击朗读这段"
                onClick={() => onSpeakPhrase?.(seg.phrase!)}
              >
                {seg.text}
              </span>
            )
          }
          return tokenizePinyinText(seg.text).flatMap(function (part, pi) {
            if (part.type === "pinyin") {
              return [<PinyinInline key={`${si}-p${pi}`} syllable={part.text} />]
            }
            return [...part.text].map(function (ch: string, ci: number) {
            if (ch === " " || ch === "\u3000") {
              return (
                <span key={`${si}-${pi}-${ci}`} className="block-char-space">
                  {ch === " " ? "\u3000" : ch}
                </span>
              )
            }
            // 标点等不可发音字符不可点（点读只对汉字/拼音/数字生效）
            if (!isSpeakableChar(ch)) {
              return (
                <span key={`${si}-${pi}-${ci}`} className="block-char-noop">
                  {ch}
                </span>
              )
            }
            const isPlaying = speakingChar === ch
            const isReading = reading !== null && reading.text === (block.text || "") && reading.char === ch
            const isMarked = marking && markedChars.has(ch)
            const lpEnabled = !!onCharLongPress && !marking
            const charSpan = (
              <span
                key={`${si}-${pi}-${ci}`}
                className={`block-char${isPlaying ? " playing" : ""}${isReading ? " reading" : ""}${isMarked ? " marked" : ""}`}
                onClick={() => onCharClick(ch)}
                title={lpEnabled ? "点读 · 长按加生词本" : undefined}
                {...(lpEnabled ? makeLpHandlers(ch) : {})}
              >
                {ch}
              </span>
            )
            // 汉字上方注拼音（ruby）：拼音可点击 → 播放 声母/韵母/介母/整体认读；汉字仍点读整字
            const pyDisp = pyMap[ch]
            if (pyDisp) {
              return (
                <ruby key={`${si}-${pi}-${ci}`} className="block-char-ruby">
                  {charSpan}
                  <rt className="block-char-py">
                    <PinyinInline syllable={pyDisp} playOnly />
                  </rt>
                </ruby>
              )
            }
            return charSpan
            })
          })
        })}
      </span>
    )
  }

  return (
    <div className={`block-text${isNote ? " block-note" : ""}`}>
      <div className="block-text-head">
        {isNote && (
          <button className="block-note-toggle" onClick={() => setNoteOpen((o) => !o)}>
            <span className={`side-note-arrow${noteOpen ? " open" : ""}`}>▶</span>
            <span className="side-note-label">📌 注脚/旁白</span>
          </button>
        )}
        {text.trim() && !hideSpeak && (
          <button
            className="block-speak-btn"
            disabled={globalSpeaking}
            onClick={() => onSpeakBlock(block.text)}
            title="朗读整块"
          >
            🔊
          </button>
        )}
      </div>

      {(!isNote || noteOpen) && (
        <div
          className={`block-text-body${isTitle ? " block-title" : ""}`}
          style={
            !isTitle
              ? { textAlign: alignCenter ? "center" : block.align === "right" ? "right" : "left" }
              : undefined
          }
        >
          {isTitle ? (
            <span className="block-title-text">{renderLine(text, 0)}</span>
          ) : (
            <div className="block-lines">
              {visualLines.map((l, i) => {
                // 诗句居中：忽略 indent；普通块按 indent 缩进（1≈两汉字 2≈四汉字）
                const pad = alignCenter ? 0 : (l.indent || 0) * 2
                return (
                  <div
                    key={i}
                    className="block-line-row"
                    style={{ paddingLeft: pad ? `${pad}em` : undefined }}
                  >
                    {renderLine(l.text, i)}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 块级评测麦克风 — 独立组件，用 useSoeScore 录音评分 */
export function BlockMic({ text }: { text: string }) {
  const [scored, setScored] = useState(false)
  const soe = useSoeScore(() => ({ refText: text, scene: "sentence" }))

  const toggle = async () => {
    if (soe.state.recording) {
      const score = await soe.stop()
      if (score !== null) setScored(true)
    } else {
      setScored(false)
      await soe.start()
    }
  }

  return (
    <div className="block-mic">
      <button
        className={`block-ops-btn block-mic-btn${soe.state.recording ? " recording" : ""}`}
        disabled={soe.state.evaluating}
        onClick={toggle}
        title={soe.state.recording ? "停止并评测" : "朗读这段并评测"}
        aria-label="朗读并评测"
      >
        {soe.state.recording ? "⏹" : soe.state.evaluating ? "…" : "🎤"}
      </button>
      {soe.state.recording && (
        <div className="level-bar" style={{ width: 80 }}>
          <div className="level-fill" style={{ width: `${Math.max(4, Math.min(100, soe.state.level * 100))}%` }} />
        </div>
      )}
      {scored && soe.state.score !== null && (
        <div className={`block-score${soe.state.score >= 85 ? " good" : soe.state.score >= 60 ? " ok" : " bad"}`}>
          {soe.state.score} 分
          {soe.state.result && <SoeDetail result={soe.state.result} />}
        </div>
      )}
    </div>
  )
}
