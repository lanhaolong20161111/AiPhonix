/** 排版块渲染器 — 逐字点读 + 整块朗读 + 块级评测麦克风 + 标记不认识字
 *
 * 对齐 Android AiChineseScreen 的块渲染。
 */

import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import type { TextBlock } from "../services/aiImage"
import type { HighlightMarkItem, PosTagItem, StoryElementItem } from "../services/aichinese"
import { isSpeakableChar } from "../lib/chars"
import { tokenizePinyinText, applyToneStr } from "../lib/pinyin"
import { buildParagraphs } from "../lib/paragraphFlow"
import { PinyinInline } from "./PinyinInline"
import { getCharPinyinDict } from "../services/wordbank"
import { useSoeScore } from "../hooks/useSoeScore"
import { SoeDetail } from "./SoeDetail"
import { useGlobalReading, useGlobalSpeaking } from "../hooks/useTts"

interface BlockTextProps {
  block: TextBlock
  /** 当前正在朗读的单字（高亮） */
  speakingChar: string | null
  /** 标记模式激活 */
  marking: boolean
  /** 已标记的字（红底） */
  markedChars: Set<string>
  /** 点读回调（父级负责朗读 + 自动加入生词本） */
  onCharClick: (ch: string) => void
  onSpeakBlock: (text: string) => void
  /** 段落高亮（解析后叠加到正文渲染） */
  highlights?: HighlightMarkItem[]
  /** 词性标注（名词/动词/形容词），开启后整词着色、词内逐字仍可点读 */
  posTags?: PosTagItem[]
  /** 文章要素标注（人物/时间/地点/起因/经过/结果），要素优先于词性 */
  storyTags?: StoryElementItem[]
  /** 点击高亮短语 → 朗读该短语 */
  onSpeakPhrase?: (phrase: string) => void
  /** 隐藏块头朗读喇叭（由外部操作条提供） */
  hideSpeak?: boolean
  /** 连读高亮范围：从点中的字（start）到句尾（end-1）整段高亮；end-1 那个字额外标出 */
  range?: { start: number; end: number } | null
}

/** 文章要素 kind → CSS 类 */
const STORY_CLS: Record<string, string> = {
  person: "story-person",
  time: "story-time",
  place: "story-place",
  cause: "story-cause",
  process: "story-process",
  result: "story-result",
  event: "story-process", // event(做了什么) 与经过同色
}

/** 统一标注项：word 命中原文后渲染为带 cls 类的整段（词内字符仍可点读） */
export interface AnnoItem {
  word: string
  cls: string
}

/** 把一行文本按标注词表切词：命中词标注 cls，其余为 null。
 * 长词优先、大小写不敏感；顺序传入的标注源中，先传入的优先（调用方保证要素先于词性）。 */
function splitByAnno(line: string, annos: AnnoItem[]): { text: string; cls: string | null }[] {
  if (!annos?.length) return [{ text: line, cls: null }]
  const segs: { text: string; cls: string | null }[] = []
  let cursor = 0
  const sorted = [...annos].sort((a, b) => b.word.length - a.word.length)
  while (cursor < line.length) {
    let hit: AnnoItem | null = null
    for (const t of sorted) {
      if (!t.word) continue
      const idx = line.slice(cursor).toLowerCase().indexOf(t.word.toLowerCase())
      if (idx === 0) {
        hit = t
        break
      }
    }
    if (hit) {
      segs.push({ text: hit.word, cls: hit.cls })
      cursor += hit.word.length
    } else {
      let next = line.length
      for (const t of sorted) {
        if (!t.word) continue
        const idx = line.slice(cursor).toLowerCase().indexOf(t.word.toLowerCase())
        if (idx > 0 && cursor + idx < next) next = cursor + idx
      }
      segs.push({ text: line.slice(cursor, next), cls: null })
      cursor = next
    }
  }
  return segs
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

/** 定位「连读高亮范围」落在某个段落里的局部下标。
 *
 *  范围坐标 = 块内**可发音字**的序号（由调用方按同样口径算好 start/end）。
 *  之所以不用「字符下标」：body 块会走 buildParagraphs 把物理行并成语义段落，
 *  合并时行间可能补空格、行尾连字符会被去掉，段落文本与原文的下标对不上；
 *  而「按顺序数可发音字」两边完全一致，且对空格/换行/连字符天然免疫。
 *
 *  @param para 段落文本
 *  @param acc  本段之前已经数过的可发音字数
 *  @returns 本段内的局部 {from,to} 与数完本段后的累计值 */
function paraRange(
  para: string,
  acc: number,
  range: { start: number; end: number } | null | undefined,
): { from: number; to: number; total: number } {
  let n = acc
  let from = -1
  let to = -1
  for (let i = 0; i < para.length; i++) {
    if (!isSpeakableChar(para[i])) continue
    if (range && n === range.start && from < 0) from = i
    if (range && n === range.end - 1) to = i + 1
    n++
  }
  return { from, to, total: n }
}

export function BlockText({
  block,
  speakingChar,
  marking,
  markedChars,
  onCharClick,
  onSpeakBlock,
  highlights,
  posTags,
  storyTags,
  onSpeakPhrase,
  hideSpeak,
  range,
}: BlockTextProps) {
  const globalSpeaking = useGlobalSpeaking()
  const reading = useGlobalReading()
  const [noteOpen, setNoteOpen] = useState(false)
  // 逐字拼音（显示用，带调号）：优先服务端 polyphones（多音字按语境），否则查词库词典
  const [pyMap, setPyMap] = useState<Record<string, string>>({})

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
  const baseLines: { text: string; indent: number }[] =
    block.lines && block.lines.length > 0
      ? block.lines.filter((l) => (l.text || "").trim())
      : text
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => ({ text: l, indent: 0 }))
  const alignCenter = block.align === "center"

  // 正文 body 走「段落流」：把 OCR 的物理行并回语义段落（服务端用 indent 标记段落起点：
  // 首行 1 / 续行 0），交给浏览器自动折行，段落首行用 text-indent 空两格。
  // 这样不会出现「行尾留一片空白、下一个字又从行首另起」的断行观感。
  // 标题/注脚/居中诗歌/右对齐页码以及题目、选项等仍逐行原样渲染（respect indent）。
  const flowParas: string[] | null =
    block.type === "body" && !isTitle && !isNote && !alignCenter && block.align !== "right"
      ? buildParagraphs(baseLines)
      : null

  // 词性/要素标注词表（渲染用）：词性 cls = pos-n/v/adj；要素 cls = story-*
  const posAnnos: AnnoItem[] = useMemo(
    () => (posTags ?? []).filter((t) => t.word).map((t) => ({ word: t.word, cls: `pos-${t.pos}` })),
    [posTags],
  )
  const storyAnnos: AnnoItem[] = useMemo(
    () =>
      (storyTags ?? [])
        .filter((t) => t.word && STORY_CLS[t.kind])
        .map((t) => ({ word: t.word, cls: STORY_CLS[t.kind] })),
    [storyTags],
  )

  const renderLine = (
    lineText: string,
    lineKey: number,
    narrowSpace = false,
    rangeInfo?: { from: number; to: number } | null,
  ) => {
    // 保留行内空格显示（诗句/空行缩进），但空格不作为可点读的字
    const segs = splitLine(lineText, highlights ?? [])
    const useRange = rangeInfo && rangeInfo.from >= 0 && rangeInfo.from < rangeInfo.to ? rangeInfo : null
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
          // 本段在高亮范围里的局部下标（前面的段把偏移吃掉）
          const segFrom = segs.slice(0, si).reduce((n, s) => n + s.text.length, 0)
          const segRange = useRange
            ? {
                from: Math.max(0, useRange.from - segFrom),
                to: Math.min(seg.text.length, useRange.to - segFrom),
              }
            : null
          return renderAnnotated(
            seg.text,
            `${si}`,
            narrowSpace,
            segRange && segRange.from < segRange.to ? segRange : null,
          )
        })}
      </span>
    )
  }

  /** 分层标注渲染：先套要素层(story)，其空隙再套词性层(pos)，都未命中则逐字渲染。
   * 标注段整段包 cls span，但内部逐字仍走 renderChars（点读/拼音/标记不受影响）。
   * rangeInfo 只传给纯文本段：标注段内部偏移难以对齐，连读高亮跳过标注段（可接受）。 */
  const renderAnnotated = (
    text: string,
    keyPrefix: string,
    narrowSpace = false,
    rangeInfo?: { from: number; to: number } | null,
  ): ReactNode => {
    const applyLayer = (
      inner: string,
      innerKey: string,
      annos: AnnoItem[],
      fallback: (t: string, k: string) => ReactNode,
    ): ReactNode => {
      if (!annos.length) return fallback(inner, innerKey)
      const parts = splitByAnno(inner, annos)
      return parts.map((p, pi) => {
        const k = `${innerKey}-a${pi}`
        if (p.cls) {
          return (
            <span key={k} className={p.cls}>
              {fallback(p.text, k)}
            </span>
          )
        }
        return fallback(p.text, k)
      })
    }
    return applyLayer(text, keyPrefix, storyAnnos, (t, k) =>
      applyLayer(t, k, posAnnos, (t2, k2) => renderChars(t2, k2, narrowSpace, rangeInfo)),
    )
  }

  /** 渲染一段普通文本为逐字可点读（含拼音/空格/标点处理），复用给词性着色词段。
   *  @param rangeInfo 本段落在连读高亮范围内的局部起止（只对纯文本段有意义） */
  const renderChars = (
    text: string,
    keyPrefix: string,
    narrowSpace = false,
    rangeInfo?: { from: number; to: number } | null,
  ) => {
    return tokenizePinyinText(text).flatMap(function (part, pi) {
      if (part.type === "pinyin") {
        return [<PinyinInline key={`${keyPrefix}-p${pi}`} syllable={part.text} />]
      }
      return [...part.text].map(function (ch: string, ci: number) {
        if (ch === " " || ch === "\u3000") {
          return (
            <span key={`${keyPrefix}-${pi}-${ci}`} className="block-char-space">
              {/* 段落流（西文词间空格）按半角显示；逐行块仍用全角，保持诗句/缩进原有宽度 */}
              {narrowSpace || ch === "\u3000" ? ch : "\u3000"}
            </span>
          )
        }
        // 标点等不可发音字符不可点（点读只对汉字/拼音/数字生效）
        if (!isSpeakableChar(ch)) {
          return (
            <span key={`${keyPrefix}-${pi}-${ci}`} className="block-char-noop">
              {ch}
            </span>
          )
        }
        const isPlaying = speakingChar === ch
        const isReading = reading !== null && reading.text === (block.text || "") && reading.char === ch
        const isMarked = marking && markedChars.has(ch)
        // 连读高亮：范围内每个字符标 hl-base；范围末字（句尾）额外标 hl-end
        const inRange = !!rangeInfo && ci >= rangeInfo.from && ci < rangeInfo.to
        const isRangeEnd = inRange && !!rangeInfo && ci === rangeInfo.to - 1
        const charSpan = (
          <span
            key={`${keyPrefix}-${pi}-${ci}`}
            className={`block-char${isPlaying ? " playing" : ""}${isReading ? " reading" : ""}${isMarked ? " marked" : ""}${inRange ? " hl-base" : ""}${isRangeEnd ? " hl-end" : ""}`}
            onClick={() => onCharClick(ch)}
            title="点读自动加生词本"
          >
            {ch}
          </span>
        )
        // 汉字上方注拼音（ruby）：拼音可点击 → 播放 声母/韵母/介母/整体认读；汉字仍点读整字
        const pyDisp = pyMap[ch]
        if (pyDisp) {
          return (
            <ruby key={`${keyPrefix}-${pi}-${ci}`} className="block-char-ruby">
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
              {flowParas && flowParas.length > 0
                ? (() => {
                    // 逐段推进「可发音字」累计值，把块级 range 映射到每段的局部下标
                    let acc = 0
                    return flowParas.map((para, i) => {
                      const pr = paraRange(para, acc, range)
                      acc = pr.total
                      return (
                        // 语义段落：整段交给浏览器自动折行，首行缩进两格（段落开头空两格）
                        <div key={i} className="block-line-row block-para" style={{ textIndent: "2em" }}>
                          {renderLine(para, i, true, pr.from >= 0 && pr.from < pr.to ? { from: pr.from, to: pr.to } : null)}
                        </div>
                      )
                    })
                  })()
                : (() => {
                    let acc = 0
                    return baseLines.map((l, i) => {
                      // 诗句居中：忽略 indent；普通块按 indent 缩进（1≈两汉字 2≈四汉字）
                      const pad = alignCenter ? 0 : (l.indent || 0) * 2
                      const pr = paraRange(l.text, acc, range)
                      acc = pr.total
                      return (
                        <div
                          key={i}
                          className="block-line-row"
                          style={{ paddingLeft: pad ? `${pad}em` : undefined }}
                        >
                          {renderLine(l.text, i, false, pr.from >= 0 && pr.from < pr.to ? { from: pr.from, to: pr.to } : null)}
                        </div>
                      )
                    })
                  })()}
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
