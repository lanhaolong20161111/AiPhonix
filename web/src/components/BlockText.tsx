/** 排版块渲染器 — 逐字点读 + 整块朗读 + 块级评测麦克风 + 标记不认识字
 *
 * 对齐 Android AiChineseScreen 的块渲染。
 */

import { useEffect, useMemo, useState } from "react"
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from "react"
import type { TextBlock } from "../services/aiImage"
import type { HighlightMarkItem, PosTagItem, StoryElementItem } from "../services/aichinese"
import { isSpeakableChar } from "../lib/chars"
import { tokenizePinyinText, applyToneStr } from "../lib/pinyin"
import { BLANK_RE, splitBlanks } from "../lib/paragraphFlow"
import { chineseBodyParagraphs } from "../lib/subject/chinese"
import { rangeSliceIn } from "../lib/readUnit"
import type { ReadRange } from "../lib/readUnit"
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
  /** 段落级点击（朗读模式）：父级据此判定「整个块 / 块里的哪一句 / 起点→终点范围」并高亮朗读。
   *  paraKey 是段落在本块内的稳定键（`p0`/`l3`），父级回传 readMark 时按它匹配；
   *  blockText 是本块**全文** —— 段落模式的朗读单位是整个块，不传它父级只能拿到被点的那一段。
   *  paras 是本块按渲染顺序的段落体列表（选字范围朗读用，作起点/终点的累计偏移基准）。 */
  onParaClick?: (paraKey: string, paraText: string, blockText: string, e: ReactMouseEvent, paras?: string[]) => void
  /** 朗读模式选中的单位：paraKey 指明哪一段，text 是高亮子串。
   *  `whole=true` 表示整块模式 —— 本块内每一段都整段高亮（块文本跨多段，无法用子串匹配）。
   *  `range` 表示选字范围模式 —— 各段按在 paras 序列上的累计偏移切本段交集高亮。 */
  readMark?: { paraKey: string; text: string; whole?: boolean; range?: ReadRange } | null
  /** 朗读模式是否生效：生效时给正文加可点提示（点正文=选单位朗读，不再逐字点读） */
  readActive?: boolean
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
  onParaClick,
  readMark,
  readActive,
}: BlockTextProps) {
  const globalSpeaking = useGlobalSpeaking()
  const reading = useGlobalReading()
  const [noteOpen, setNoteOpen] = useState(false)
  // 逐字拼音（显示用，带调号）：优先服务端 polyphones（多音字按语境），否则查词库词典
  const [pyMap, setPyMap] = useState<Record<string, string>>({})

  const isTitle = block.type === "title" || block.type === "heading"
  const isNote = block.type === "note"
  const text = block.text.replace(/\s+/g, "")

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
      ? chineseBodyParagraphs(baseLines)
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

  // ⚠️ 早退必须放在所有 Hook 之后：放到上面会让空文本时跳过 useEffect/useMemo，
  // 违反 Hook 调用顺序（同一实例从空→非空渲染会抛「Rendered more hooks than…」）。
  if (!text.trim()) return null

  const renderLine = (
    lineText: string,
    lineKey: number,
    narrowSpace = false,
    readHl = false,
  ) => {
    // 保留行内空格显示（诗句/空行缩进），但空格不作为可点读的字
    const segs = splitLine(lineText, highlights ?? [])
    return (
      <span key={lineKey} className={`block-line${readHl ? " read-hl" : ""}`}>
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
          return renderAnnotated(seg.text, `${si}`, narrowSpace)
        })}
      </span>
    )
  }

  /** 分层标注渲染：先套要素层(story)，其空隙再套词性层(pos)，都未命中则逐字渲染。
   * 标注段整段包 cls span，但内部逐字仍走 renderChars（点读/拼音/标记不受影响）。 */
  const renderAnnotated = (
    text: string,
    keyPrefix: string,
    narrowSpace = false,
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
      applyLayer(t, k, posAnnos, (t2, k2) => renderChars(t2, k2, narrowSpace)),
    )
  }

  /** 渲染一段普通文本为逐字可点读（含拼音/空格/标点处理），复用给词性着色词段。 */
  const renderChars = (
    text: string,
    keyPrefix: string,
    narrowSpace = false,
  ) => {
    /** 单字渲染：空格 / 标点 / 可点读汉字（带拼音条）。 */
    const oneChar = (ch: string, key: string): ReactElement => {
      if (ch === " " || ch === "\u3000") {
        return (
          <span key={key} className="block-char-space">
            {/* 段落流（西文词间空格）按半角显示；逐行块仍用全角，保持诗句/缩进原有宽度 */}
            {narrowSpace || ch === "\u3000" ? ch : "\u3000"}
          </span>
        )
      }
      // 标点等不可发音字符不可点（点读只对汉字/拼音/数字生效）
      if (!isSpeakableChar(ch)) {
        return (
          <span key={key} className="block-char-noop">
            {ch}
          </span>
        )
      }
      const isPlaying = speakingChar === ch
      const isReading = reading !== null && reading.text === (block.text || "") && reading.char === ch
      const isMarked = marking && markedChars.has(ch)
      const charSpan = (
        <span
          key={key}
          className={`block-char${isPlaying ? " playing" : ""}${isReading ? " reading" : ""}${isMarked ? " marked" : ""}`}
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
          <ruby key={key} className="block-char-ruby">
            {charSpan}
            <rt className="block-char-py">
              <PinyinInline syllable={pyDisp} playOnly />
            </rt>
          </ruby>
        )
      }
      return charSpan
    }
    return tokenizePinyinText(text).flatMap(function (part, pi) {
      if (part.type === "pinyin") {
        return [<PinyinInline key={`${keyPrefix}-p${pi}`} syllable={part.text} />]
      }
      const raw = part.text
      if (!BLANK_RE.test(raw)) {
        return [...raw].map((ch: string, ci: number) => oneChar(ch, `${keyPrefix}-${pi}-${ci}`))
      }
      // 含填空位：`（  ）` 整体渲染成不可断单元（否则会在括号之间断行，
      // 右括号被甩到下一行行首），其余照常逐字渲染。
      const out: ReactElement[] = []
      let ci = 0
      for (const seg of splitBlanks(raw)) {
        const chars = [...seg.text]
        if (seg.blank) {
          out.push(
            <span key={`${keyPrefix}-${pi}-b${ci}`} className="block-blank">
              {seg.text}
            </span>,
          )
        } else {
          chars.forEach((ch, k) => out.push(oneChar(ch, `${keyPrefix}-${pi}-${ci + k}`)))
        }
        ci += chars.length
      }
      return out
    })
  }

  /** 段落正文渲染：整块模式→整段全高亮；句子模式→只高亮 readMark.text 那段子串；
   *  选字范围→按本段在块内段落体序列（lineKey 即段落下标）上的累计偏移切本段交集。
   *  按子串切成 前/中/后 三段分别 renderLine —— 各段仍是 inline span，视觉上连成一段。 */
  const renderParaBody = (body: string, paraKey: string, lineKey: number, narrowSpace: boolean): ReactNode => {
    // 整块模式：块文本是「多段拼起来」的，body 只是其中一段，子串匹配必然落空 →
    // 直接整段套 read-hl（每段各自高亮，合起来就是整块被选中）。
    if (readMark?.whole) return renderLine(body, lineKey, narrowSpace, true)
    // 选字范围：lineKey = 该段在块内段落体序列（flowParas / baseLines）里的下标
    if (readMark?.range) {
      const rs = rangeSliceIn(body, lineKey, readMark.range)
      if (rs && rs.to > rs.from) {
        const before = body.slice(0, rs.from)
        const mid = body.slice(rs.from, rs.to)
        const after = body.slice(rs.to)
        return (
          <>
            {before && renderLine(before, lineKey * 10 + 1, narrowSpace)}
            {renderLine(mid, lineKey * 10 + 2, narrowSpace, true)}
            {after && renderLine(after, lineKey * 10 + 3, narrowSpace)}
          </>
        )
      }
    }
    const mk = readMark && readMark.paraKey === paraKey ? readMark.text : ""
    if (mk) {
      const idx = body.indexOf(mk)
      if (idx >= 0) {
        const before = body.slice(0, idx)
        const mid = body.slice(idx, idx + mk.length)
        const after = body.slice(idx + mk.length)
        return (
          <>
            {before && renderLine(before, lineKey * 10 + 1, narrowSpace)}
            {renderLine(mid, lineKey * 10 + 2, narrowSpace, true)}
            {after && renderLine(after, lineKey * 10 + 3, narrowSpace)}
          </>
        )
      }
    }
    return renderLine(body, lineKey, narrowSpace)
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
          className={`block-text-body${isTitle ? " block-title" : ""}${readActive ? " read-pickable" : ""}`}
          style={
            !isTitle
              ? { textAlign: alignCenter ? "center" : block.align === "right" ? "right" : "left" }
              : undefined
          }
          // 标题块没有「段落容器」，整块就是这一行：直接把点击挂在这一层，
          // 否则朗读模式下点标题没反应（正文块的点击挂在各自的 .flow-para / .block-line-row 上）。
          onClick={
            isTitle && onParaClick ? (e) => onParaClick("t0", text, block.text, e, [text]) : undefined
          }
        >
          {isTitle ? (
            <span className="block-title-text">{renderLine(text, 0, false, !!readMark?.whole)}</span>
          ) : (
            <div className="block-lines">
              {flowParas && flowParas.length > 0
                ? flowParas.map((para, i) => {
                    // 段落首行缩进用「两个全角空格」实现，**不能**用 CSS text-indent：
                    // 段落内每个字都是独立的行内盒，text-indent 会把每个行内盒的宽度
                    // 都撑大 2em（实测 `、` 24px→64px），导致整行字被拆得七零八落。
                    const body = `\u3000\u3000${para}`
                    const paraKey = `p${i}`
                    return (
                      // 语义段落：整段交给浏览器自动折行
                      <div
                        key={i}
                        className={`block-line-row block-para${onParaClick ? " read-pickable" : ""}`}
                        onClick={onParaClick ? (e) => onParaClick(paraKey, body, block.text, e, flowParas!.map((p) => `\u3000\u3000${p}`)) : undefined}
                      >
                        {renderParaBody(body, paraKey, i, true)}
                      </div>
                    )
                  })
                : baseLines.map((l, i) => {
                    // 诗句居中：忽略 indent；普通块按 indent 缩进（1≈两汉字 2≈四汉字）
                    const pad = alignCenter ? 0 : (l.indent || 0) * 2
                    const paraKey = `l${i}`
                    return (
                      <div
                        key={i}
                        className={`block-line-row${onParaClick ? " read-pickable" : ""}`}
                        style={{ paddingLeft: pad ? `${pad}em` : undefined }}
                        onClick={onParaClick ? (e) => onParaClick(paraKey, l.text, block.text, e, baseLines.map((x) => x.text)) : undefined}
                      >
                        {renderParaBody(l.text, paraKey, i, false)}
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
