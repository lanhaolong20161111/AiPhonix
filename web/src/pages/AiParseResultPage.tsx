/** 识别结果页 — 图片识别完成后独立展示（语文：排版块逐字点读/块级评测/标记不认识字；数学：题目列表逐字点读）
 *
 * 数据来自 parseSessionStore（输入页识别成功后写入，跳转过来）。刷新会丢会话，引导返回重新识别。
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useParseSessionStore, type ParsePageStatus } from "../stores/parseSessionStore"
import { useQaStore, scopeQa } from "../stores/qaStore"
import { parseImage } from "../services/aiImage"
import { rotateBlob90 } from "../lib/imageOrientation"
import { schedulePolyPatch } from "../lib/polyPatch"
import { addHistory, updateHistory, makeThumb } from "../lib/aiHistory"
import { isSpeakableChar } from "../lib/chars"
import { BlockText } from "../components/BlockText"
import { BlockAsk } from "../components/BlockAsk"
import { BlockHighlight } from "../components/BlockHighlight"
import { QaHistoryModal } from "../components/QaHistoryModal"
import { PhonicsWord, PhonicsToggle } from "../components/PhonicsWord"
import type { HighlightMarkItem, PosTagItem, StoryElementItem } from "../services/aichinese"
import { useBlockSpeaking } from "../hooks/useBlockSpeaking"
import { markUnknownChars, recordCharClick, posTags, storyElements } from "../services/aichinese"
import { askLlm } from "../services/aiAsk"
import { detailFromError } from "../services/auth"
import { addWordbook } from "../services/wordbook"
import { SpeakableTable } from "../components/SpeakableTable"
import { splitInlineTables, stripMdHeaders } from "../lib/paragraphFlow"
import { sentenceAt, toReadableBlockText } from "../lib/readUnit"
import {
  isTableSeg,
  mathAlignTextAlign,
  mathDisplaySegments,
  mathIndentEm,
  type MathSeg,
} from "../lib/mathDisplay"
import { chineseReflow } from "../lib/subject/chinese"
import { englishReflow } from "../lib/subject/english"
import { mathReflow } from "../lib/subject/math"

/** 点读即加生词本的文本判定：只收中文汉字（点读单字）或英文单词（点读整词），
 * 不收数字/标点/纯字母串（避免污染词库，如数学题面的数字、拼音注音）。 */
function isWordbookWorthy(text: string): boolean {
  const t = (text ?? "").trim()
  if (!t) return false
  if (/^[\u4e00-\u9fff]+$/.test(t)) return true // 汉字（单字或整段中文块均收单字）
  return /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(t) // 英文单词
}

/** 一个英文标注短语：word 拆成的小写词序列 + CSS 类（story 优先级高于 pos） */
interface EnPhrase {
  words: string[] // 小写词序列（已剥离前后缀标点）
  cls: string
  priority: number // story=1 > pos=0
}

/** 标点归一：剥离词首尾常见粘连标点，便于 Tom's vs Tom / "Hello" vs Hello 匹配 */
const STRIP_PUNCT = /^[.,;:!?'"()[\]{}…“”‘’«»<>~`_\-]+|[.,;:!?'"()[\]{}…“”‘’«»<>~`_\-]+$/g

function toEnPhrases(tags: { word: string; cls: string; story: boolean }[]): EnPhrase[] {
  const out: EnPhrase[] = []
  for (const t of tags) {
    const words = (t.word || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(STRIP_PUNCT, ""))
      .filter(Boolean)
    if (!words.length) continue
    out.push({ words, cls: t.cls, priority: t.story ? 1 : 0 })
  }
  // 命中优先级：story 层 > pos 层；同层内长短语优先（避免 the 抢先吞掉 in the park）
  out.sort((a, b) => b.priority - a.priority || b.words.length - a.words.length)
  return out
}

/** 英语逐词点读：按空白切词，点击单词内任意字母朗读整个单词（而非单字母）。
 * 支持多词短语整段着色（命中短语的连续词包在一个外层着色 span 内），词内字母仍可独立点读。 */
function EnglishWordTap({
  text,
  speakingWord,
  onWordSpeak,
  phrases,
}: {
  text: string
  speakingWord: string | null
  onWordSpeak: (word: string) => void
  phrases?: EnPhrase[]
}) {
  // 保留原始分段（含空白）用于渲染，另建「词 token 序列」供短语匹配
  const segs = useMemo(() => text.match(/\s+|\S+/g) ?? [], [text])
  // 命中区间：词 token 下标 → { from, to, cls }（含词间空白段，渲染时一并包入）
  const hits = useMemo(() => {
    const wordIdx: number[] = []
    segs.forEach((s, i) => {
      if (!/^\s+$/.test(s)) wordIdx.push(i)
    })
    const ranges: { from: number; to: number; cls: string }[] = []
    if (phrases?.length && wordIdx.length) {
      let cursor = 0
      while (cursor < wordIdx.length) {
        let hit: EnPhrase | null = null
        for (const p of phrases) {
          const n = p.words.length
          if (n === 0 || cursor + n > wordIdx.length) continue
          let ok = true
          for (let k = 0; k < n; k++) {
            const raw = segs[wordIdx[cursor + k]]
            const norm = (raw || "").toLowerCase().replace(STRIP_PUNCT, "")
            if (norm !== p.words[k]) {
              ok = false
              break
            }
          }
          if (ok) {
            hit = p
            break
          }
        }
        if (hit) {
          ranges.push({ from: wordIdx[cursor], to: wordIdx[cursor + hit.words.length - 1], cls: hit.cls })
          cursor += hit.words.length
        } else {
          cursor++
        }
      }
    }
    return ranges
  }, [segs, phrases])

  const renderWord = (seg: string, si: number) => {
    // 填空位（连续下划线）：不是单词 → 不可点读、不逐字渲染，整体当填空位。
    // （英语识图提示词要求「空白的填空横线按原样输出下划线」，服务端已不再删除行内下划线。）
    if (/^[_＿]+$/.test(seg)) {
      return (
        <span key={si} className="block-blank">
          {seg}
        </span>
      )
    }
    const word = seg
    const speaking = speakingWord === word
    return (
      <span key={si} className={`tap-char-word${speaking ? " word-speaking" : ""}`}>
        {/* 逐词点读 + 拼读着色：色块按发音规律切，字盒与点读行为完全不变 */}
        <PhonicsWord
          word={word}
          wrapChar={(ch, ci) => (
            <span
              key={ci}
              className={`tap-char-item${speaking ? " playing" : ""}`}
              onClick={() => onWordSpeak(word)}
            >
              {ch}
            </span>
          )}
        />
      </span>
    )
  }

  const renderSpace = (seg: string, si: number) => (
    <span key={si} className="tap-char-space">
      {seg.includes("\n")
        ? seg.split("").map((c, i) => (c === "\n" ? <br key={i} /> : c))
        : seg}
    </span>
  )

  const nodes: ReactNode[] = []
  let i = 0
  const hitAt = new Map<number, { to: number; cls: string }>()
  for (const r of hits) hitAt.set(r.from, { to: r.to, cls: r.cls })
  while (i < segs.length) {
    const hit = hitAt.get(i)
    if (hit) {
      // 命中短语：把 from..to 全部段（词+中间空白）包进一个外层着色 span
      const inner: ReactNode[] = []
      let j = i
      for (; j <= hit.to; j++) {
        inner.push(/^\s+$/.test(segs[j]) ? renderSpace(segs[j], j) : renderWord(segs[j], j))
      }
      nodes.push(
        <span key={`ph-${i}`} className={`tap-char-phrase ${hit.cls}`}>
          {inner}
        </span>,
      )
      i = j
    } else {
      nodes.push(/^\s+$/.test(segs[i]) ? renderSpace(segs[i], i) : renderWord(segs[i], i))
      i++
    }
  }
  return <span className="tap-char">{nodes}</span>
}

/** 转义单元格文本，避免表格内容里的 < > & 破坏 HTML 或被当成标签 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** 判断一段识别文本是否为表格，并规范成 <table> HTML：
 * 1) 模型直接返回 HTML 表格（PaddleOCR 开启 useTableRecognition 时，文本里是
 *    <table><tr><td> 原始标签）——原 EnglishWordTap 会把标签当纯文本显示；
 * 2) markdown 管道表（| a | b | / |---|---|）——兜底转换，避免退化为竖线文本。
 * 非表格返回 null，调用方退回逐词点读。 */
function toTableHtml(s: string): string | null {
  const t = (s ?? "").trim()
  if (!t) return null
  if (/<table[\s>]/i.test(t)) return t
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean)
  const pipeRows = lines.filter((l) => l.startsWith("|") && l.endsWith("|"))
  if (pipeRows.length >= 2 && /^\|[\s:|-]+\|$/.test(pipeRows[1])) {
    const cells = (row: string) => row.split("|").slice(1, -1).map((c) => c.trim())
    const head = cells(pipeRows[0])
    const body = pipeRows.slice(2).map(cells)
    const thead = `<thead><tr>${head.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`
    const tbody = `<tbody>${body
      .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody>`
    return `<table>${thead}${tbody}</table>`
  }
  return null
}

/** 句末标点与右引号规则见 lib/readUnit.ts（那里有单测）。此处只留 DOM 侧的偏移计算。 */

/** 取点击位置在段落元素里的字符偏移（句子模式判「点在哪一句」用）。
 *
 *  ⚠️ 不能用 `Range.toString()` 量偏移：中文字符外面包着 <ruby> 拼音（<rt>），
 *  toString() 会把拼音文本一起数进去，偏移整体偏大 → 句子判错。
 *  这里用 TreeWalker 逐个文本节点累加长度，**跳过 <rt> 里的拼音**，
 *  得到的偏移与「段落纯文本」一一对应。 */
function caretOffsetIn(e: ReactMouseEvent, paraText: string): number {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return 0
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let off = 0
  if (typeof doc.caretRangeFromPoint === "function") {
    const r = doc.caretRangeFromPoint(e.clientX, e.clientY)
    if (r) {
      node = r.startContainer
      off = r.startOffset
    }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const p = doc.caretPositionFromPoint(e.clientX, e.clientY)
    if (p) {
      node = p.offsetNode
      off = p.offset
    }
  }
  if (!node || !el.contains(node)) return 0
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let total = 0
  let n: Node | null = walker.nextNode()
  while (n) {
    const inRt = !!(n.parentElement && n.parentElement.closest("rt"))
    if (!inRt) {
      if (n === node) return total + off
      total += (n.nodeValue ?? "").length
    } else if (n === node) {
      // 点在拼音上：按该 ruby 的基准字算（拼音排在基准字之后，返回 total ≈「该字之后」）
      return total
    }
    n = walker.nextNode()
  }
  return Math.min(total, paraText.length)
}

/** 文章要素 kind → CSS 类（与 BlockText 的 STORY_CLS 保持一致） */const STORY_CLS: Record<string, string> = {
  person: "story-person",
  time: "story-time",
  place: "story-place",
  cause: "story-cause",
  process: "story-process",
  result: "story-result",
  event: "story-process", // event(做了什么) 与经过同色
}

/** 英语结果内容：表格 → 画成真正的表格方框，且按整词/整格朗读（SpeakableTable word 模式）；
 * 否则 → 逐词点读（EnglishWordTap）。点读整词即自动加入生词本（onWordSpeak 内处理）。
 * 排版与语文/数学一致：OCR 物理行经 reflowWithBreaks（英语走 englishReflow）并回语义段落，每段 .flow-para 自动折行。 */
function EnglishResult({
  text,
  speakingWord,
  onWordSpeak,
  posTags,
  storyTags,
  readMeta,
}: {
  text: string
  speakingWord: string | null
  onWordSpeak: (word: string) => void
  posTags?: PosTagItem[]
  storyTags?: StoryElementItem[]
  /** 朗读模式（左侧栏）：开启后点段落 → 父级判定所在句子并高亮朗读。
   *  词语点读（onWordSpeak）在朗读模式下被父级 guard 掉，让点击落到段落上。 */
  readMeta?: {
    blockIdx: number
    /** 本块全文：段落模式的朗读单位是整个块（整段课文 / 整道题） */
    blockText: string
    onParaClick: (blockIdx: number, paraKey: string, paraText: string, e: ReactMouseEvent, blockText?: string) => void
    readMark: { blockIdx: number; paraKey: string; text: string; whole?: boolean } | null
  }
}) {
  // 去掉模型偶发写出的 markdown 标题记号（`## Tom's Family`），否则会原样显示 `##`。
  const clean = useMemo(() => stripMdHeaders(text), [text])
  // 表格课文本期不着色（cell 匹配复杂），仅普通逐词渲染时启用
  // 合并词性 + 要素为短语列表；同一词同时命中时要素优先（story priority=1 > pos=0）
  const phrases = useMemo(() => {
    if (!posTags?.length && !storyTags?.length) return undefined
    const items: { word: string; cls: string; story: boolean }[] = []
    for (const t of posTags ?? []) {
      const w = (t.word || "").trim()
      if (w) items.push({ word: w, cls: `pos-${t.pos}`, story: false })
    }
    for (const t of storyTags ?? []) {
      const w = (t.word || "").trim()
      const cls = STORY_CLS[t.kind]
      if (w && cls) items.push({ word: w, cls, story: true })
    }
    return toEnPhrases(items)
  }, [posTags, storyTags])
  // 把一段纯文本并回语义段落（englishReflow），每段一个 .flow-para 交浏览器自动折行 ——
  // 否则英文长段会按图片物理行硬断行，行尾留大片空白、断在不该断的地方。
  // 断行规则（标题样行独占一段、句末即段落边界）由英语学科模块自己决定，
  // 不再通过 opts 开关从外部注入 —— 见 web/src/lib/subject/english.ts。
  /** 朗读高亮切分（与语文/数学同构）：整块模式→本段全高亮（块全文跨多段，子串匹配落空）；
   *  句子模式→只高亮 readMark.text 那一句。 */
  const splitRead = (body: string, paraKey: string, renderFn: (s: string) => ReactNode): ReactNode => {
    const rm = readMeta
    const mine = !!rm && !!rm.readMark && rm.readMark.blockIdx === rm.blockIdx
    if (mine && rm!.readMark!.whole) return <span className="read-hl">{renderFn(body)}</span>
    const mk = mine && rm!.readMark!.paraKey === paraKey ? rm!.readMark!.text : ""
    if (mk) {
      const idx = body.indexOf(mk)
      if (idx >= 0) {
        const before = body.slice(0, idx)
        const mid = body.slice(idx, idx + mk.length)
        const after = body.slice(idx + mk.length)
        return (
          <>
            {before && renderFn(before)}
            <span className="read-hl">{renderFn(mid)}</span>
            {after && renderFn(after)}
          </>
        )
      }
    }
    return renderFn(body)
  }
  const textParas = (segText: string, keyBase: string) =>
    englishReflow(segText).map((para, pi) => {
      const paraKey = `${keyBase}-p${pi}`
      const pickable = !!readMeta
      return (
        <div
          key={`${keyBase}-${pi}`}
          className={`flow-para${pickable ? " read-pickable" : ""}`}
          onClick={
            pickable
              ? (e) => readMeta!.onParaClick(readMeta!.blockIdx, paraKey, para, e, readMeta!.blockText)
              : undefined
          }
        >
          {splitRead(para, paraKey, (s) => (
            <EnglishWordTap
              text={s}
              speakingWord={speakingWord}
              onWordSpeak={onWordSpeak}
              phrases={phrases}
            />
          ))}
        </div>
      )
    })
  // 内嵌 HTML 表格（Paddle/豆包表格模式把表格混排在正文里）：按 `<table>` 切段 ——
  // 表格段画成真正的表格方框（整词/整格朗读），其余文本段并段后逐词点读。
  // 直接整段丢给 SpeakableTable 会丢掉表格前后的文字，整段丢给逐词渲染则标签会被显示成尖括号。
  /** 表格段包一层可点容器：朗读模式下点表格 = 读整块（表格内部不做逐格高亮，整块黄底即可，
   *  否则表格结构会被高亮切分打散）。 */
  const wrapTable = (key: string, node: ReactNode): ReactNode => {
    const rm = readMeta
    if (!rm) return <div key={key}>{node}</div>
    const hl = !!rm.readMark && rm.readMark.blockIdx === rm.blockIdx && !!rm.readMark.whole
    return (
      <div
        key={key}
        className={`read-pickable${hl ? " read-hl" : ""}`}
        onClick={(e) => rm.onParaClick(rm.blockIdx, key, toReadableBlockText(clean), e, rm.blockText)}
      >
        {node}
      </div>
    )
  }
  const segs = useMemo(() => splitInlineTables(clean), [clean])
  if (segs.some((s) => s.type === "table")) {
    const nodes: ReactNode[] = []
    segs.forEach((s, i) => {
      if (s.type === "table") {
        nodes.push(
          wrapTable(
            `t${i}`,
            <SpeakableTable
              html={s.text}
              cellTapMode="word"
              speakingWord={speakingWord}
              onWordClick={onWordSpeak}
            />,
          ),
        )
      } else {
        nodes.push(...textParas(s.text, `s${i}`))
      }
    })
    return <>{nodes}</>
  }
  // markdown 管道表兜底（识别文本里没有 HTML 标签、只有 | a | b | 的情形）
  const tbl = toTableHtml(clean)
  if (tbl) {
    return wrapTable(
      "pt",
      <SpeakableTable
        html={tbl}
        cellTapMode="word"
        speakingWord={speakingWord}
        onWordClick={onWordSpeak}
      />,
    )
  }
  return <>{textParas(clean, "p")}</>
}

/** 英语展示分段：优先用服务端结构化 blocks（title/heading/body 各自独立 → 版面与原图一致），
 *  没有 blocks 时才退回扁平 questions / text。
 *
 *  为什么需要它：英语页原先把扁平的 `questions` 当展示单元，而 `questions` 来自 `text`，
 *  段落边界在链路里会被压掉（Paddle 的 text 归一化）→ 整页挤成一段、标题和正文并排。
 *  blocks 是服务端按版面给出的真结构，用它渲染「一段一块」才名副其实。
 *
 *  ⚠️ 渲染循环、posMap 标注项、导航索引必须共用这一份结果，否则 [i] 对不上。
 *  table 块照常渲染（EnglishResult 内部会画成可点读表格），但**不做词性标注**（HTML 参与标注没意义）。 */
function enDisplaySegments(
  blocks: { text?: string; type?: string }[] | undefined,
  questions: string[],
  text: string,
): { text: string; type: string }[] {
  const fromBlocks = (blocks ?? [])
    .map((b) => ({ text: String(b?.text ?? "").trim(), type: String(b?.type ?? "body") }))
    .filter((s) => s.text && s.type !== "image")
  if (fromBlocks.length) return fromBlocks
  const qs = (questions ?? []).map((q) => String(q ?? "").trim()).filter(Boolean)
  if (qs.length) return qs.map((t) => ({ text: t, type: "body" }))
  const t = (text ?? "").trim()
  return t ? [{ text: t, type: "body" }] : []
}

/* 数学展示分段已抽到 `lib/mathDisplay.ts`（2026-09-15）：那里带上了服务端给的 align 与
   逐行 indent（此前只保留 {text,type}，居中的标题与缩进的选项在前端永远看不见），并补了单测。
   ⚠️ 渲染循环 / navCount / sectionLabel 仍必须共用同一份结果，索引才对得上。 */

/** 「第 N 张」标签上的状态文案（多图批次，见 lib/parseBatch.ts） */
const PAGE_TAB_TEXT: Record<ParsePageStatus, string> = {
  waiting: "排队中",
  parsing: "识别中…",
  done: "已识别",
  error: "失败",
}

export function AiParseResultPage() {
  const navigate = useNavigate()
  const session = useParseSessionStore((s) => s.session)
  // 多图批次（2026-09-16）：session 是"当前页"的展开视图，pages 用于画「第 N 张」标签
  const pages = useParseSessionStore((s) => s.pages)
  const activePage = useParseSessionStore((s) => s.activePage)
  const selectPage = useParseSessionStore((s) => s.selectPage)
  const { speakingChar, speakChar, speakBlock } = useBlockSpeaking()
  const module = session?.module ?? ""
  // session 未加载时 module 退化为 ""，归一化给下方 parseImage / setSession（二者类型不含 ""）
  const effModule = (module || "chinese") as "chinese" | "math" | "english"

  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState("")

  // 标记不认识字（仅语文）
  const [marking, setMarking] = useState(false)
  const [markedChars, setMarkedChars] = useState<Set<string>>(new Set())
  const [markUploading, setMarkUploading] = useState(false)

  // ── 朗读模式（页面左侧小按钮）───────────────────────────────
  // readUnit：段落（=整个块）/ 句子 二选一（互斥）；repeatOn + repeatTimes：反复朗读（默认 1 次）
  const [readUnit, setReadUnit] = useState<"para" | "sent" | null>(null)
  const [repeatOn, setRepeatOn] = useState(false)
  const [repeatTimes, setRepeatTimes] = useState(1)
  /** 当前高亮的朗读单位。
   *  - 段落模式（whole=true）：text 是**整个块**的全文，块内每一段整段高亮；
   *  - 句子模式：text 是点中的那一句，按 blockIdx+paraKey 定位到那一段里做子串高亮。 */
  const [readMark, setReadMark] = useState<
    { blockIdx: number; paraKey: string; text: string; whole?: boolean } | null
  >(null)
  /** 朗读模式是否生效（任一按钮打开即可）：生效时点正文=选单位朗读，不再逐字点读 */
  const readActive = readUnit !== null || repeatOn

  // 语文各块的高亮（解析后叠加到正文渲染）
  const [hlMap, setHlMap] = useState<Record<number, HighlightMarkItem[]>>({})

  // 词性着色：进页后台自动拉取标注（后端有缓存），默认关闭、开关打开显示
  const [posOn, setPosOn] = useState(false)
  // 语文按块索引、英语按题索引 → 该段词性标注
  const [posMap, setPosMap] = useState<Record<number, PosTagItem[]>>({})
  // 词性标注拉取状态（正在拉取时按钮显示加载）
  const [posLoading, setPosLoading] = useState(false)

  // 文章要素着色（六要素），与词性开关独立、可叠加；要素优先渲染
  const [storyOn, setStoryOn] = useState(false)
  const [storyMap, setStoryMap] = useState<Record<number, StoryElementItem[]>>({})
  const [storyLoading, setStoryLoading] = useState(false)

  // 识别批次号：重新识别/旋转时 +1，强制高亮组件重挂载清空旧状态
  const [runId, setRunId] = useState(0)

  // 全部问答记录浮窗
  const [showQa, setShowQa] = useState(false)
  // 区域裁剪图放大预览
  const [previewCrop, setPreviewCrop] = useState<string | null>(null)
  // 侧边定位条折叠（隐藏全部标签，只留细线，不挡内容）
  const [railCollapsed, setRailCollapsed] = useState(false)

  const qaAll = useQaStore((s) => s.qa)

  // 点读即加生词本（toast 反馈 + 会话内去重：同一结果页里同一字/词只加一次）
  const [wbToast, setWbToast] = useState<string | null>(null)
  const wbToastTimer = useRef<number | null>(null)
  const showToast = (msg: string) => {
    setWbToast(msg)
    if (wbToastTimer.current) window.clearTimeout(wbToastTimer.current)
    wbToastTimer.current = window.setTimeout(() => setWbToast(null), 1800)
  }
  const wordbookAddedRef = useRef<Set<string>>(new Set())
  /** 点读后把字/词加入生词本（前端去重：同一结果页会话内只发一次；source 沿用 recog_* 口径） */
  const addTappedWordbook = useCallback(
    (text: string, source: string) => {
      const t = (text ?? "").trim()
      if (!t || !isWordbookWorthy(t)) return
      if (wordbookAddedRef.current.has(`${source}:${t}`)) return
      wordbookAddedRef.current.add(`${source}:${t}`)
      void addWordbook(t, "", source).then((ok) => {
        showToast(ok ? `「${t}」已加入生词本` : "加入生词本失败，请重试")
      })
    },
    [showToast],
  )

  // ── 英语逐词点读：点击单词内任意字母 → 朗读整个单词（而非单字母），同时自动加入生词本 ──
  const [speakingWord, setSpeakingWord] = useState<string | null>(null)
  const isEnglish = effModule === "english"
  const speakEnglishWord = useCallback(
    async (word: string) => {
      // 朗读模式生效时不做逐词点读：让点击继续冒泡到 .flow-para，
      // 由 handleReadClick 判定「哪一段 / 哪一句」再整句朗读（否则两套朗读会打架）。
      if (readActive) return
      const w = word.trim()
      if (!w) return
      addTappedWordbook(w, "recog_english")
      setSpeakingWord(w)
      await speakBlock(w)
      setSpeakingWord(null)
    },
    [readActive, speakBlock, addTappedWordbook],
  )

  // ── 自动保存历史：识别结果就绪后自动写入历史（同一 sessionId+runId 只存一次）
  const autoSavedRef = useRef<Set<string>>(new Set())
  const autoSaveBusyRef = useRef(false)
  // 自动保存的历史条目 id（供标注完成后回填 pos/story）
  const pendingHistoryIdRef = useRef<string | null>(null)
  // 标注最新结果（供自动保存落库时带出；解耦两个 effect 的完成时序）
  const annoRef = useRef<{ pos: Record<number, PosTagItem[]>; story: Record<number, StoryElementItem[]> }>({ pos: {}, story: {} })
  // 区块问答定位：给每个块/题容器挂 ref，供右侧圆点快速滚动定位
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (!session) return
    if (session.fromHistory) return // 回看历史不触发自动保存
    const { module, text, questions, blocks, previewUrl, sessionId } = session
    // 重新识别/旋转会递增 runId，这里用 runId 去重：每个识别结果自动存一条
    const key = `${sessionId}:${runId}`
    if (autoSavedRef.current.has(key)) return
    if (autoSaveBusyRef.current) return
    const t = blocks.length ? blocks.map((b) => b.text).join("").trim() : text.trim()
    if (!t) return
    autoSaveBusyRef.current = true
    void (async () => {
      try {
        const thumb = previewUrl ? await makeThumb(previewUrl) : ""
        const entry = addHistory({
          module,
          text: t,
          questions,
          blocks,
          pageBounds: session.pageBounds,
          thumb,
          qa: scopeQa(sessionId, useQaStore.getState().qa),
        })
        // 记录历史条目 id：若标注已就绪则立即回填，否则留给标注 effect 完成后回填
        pendingHistoryIdRef.current = entry.id
        const { pos, story } = annoRef.current
        if (Object.keys(pos).length || Object.keys(story).length) {
          updateHistory(module, entry.id, { pos, story })
          pendingHistoryIdRef.current = null
        }
        autoSavedRef.current.add(key)
      } catch {
        /* 自动保存失败静默，不阻塞页面；用户仍可手动点保存 */
      } finally {
        autoSaveBusyRef.current = false
      }
    })()
  }, [session, runId])

  // ── 带图提问：识别后把文本框里的问题自动问 AI（initialQuestion）──
  const [initQa, setInitQa] = useState<{ question: string; answer: string; asking: boolean } | null>(null)
  const initAskedRef = useRef(false)
  useEffect(() => {
    const q = session?.initialQuestion?.trim()
    if (!q || initAskedRef.current) return
    // 等识别文本就绪（blocks/text 非空）再问；未就绪时稍等一次
    const ctx = session?.text?.trim()
    if (!ctx) return
    initAskedRef.current = true
    setInitQa({ question: q, answer: "", asking: true })
    void (async () => {
      try {
        const reply = await askLlm(`${ctx}\n\n【学生问题】${q}`, "")
        setInitQa({ question: q, answer: reply, asking: false })
      } catch {
        setInitQa({ question: q, answer: "（提问失败，可手动在上方提问框输入）", asking: false })
      }
    })()
  }, [session?.initialQuestion, session?.text])

  // ── 词性/要素着色：进页后台自动拉取（语文按块、英语按题；失败静默，不阻塞阅读）。
  // 历史回看（fromHistory）且会话自带标注时直接用存量、跳过网络请求。
  useEffect(() => {
    if (!session) return
    if (session.turns && session.turns.length > 0) return // 对话回看不识别文本
    const mySid = session.sessionId // 多图切换守卫：结果回来时若已切到别的照片就丢弃
    const { module: m, questions: qs, blocks: bs } = session
    const lang = m === "english" ? "en" : m === "chinese" ? "zh" : null
    if (!lang) {
      setPosMap({})
      setStoryMap({})
      return
    }
    // 历史回看：直接用条目里存的标注
    if (session.fromHistory && session.pos && session.story) {
      setPosMap(session.pos)
      setStoryMap(session.story)
      annoRef.current = { pos: session.pos, story: session.story }
      return
    }
    const items =
      m === "english"
        ? enDisplaySegments(bs, qs ?? [], session.text ?? "")
            .map((s, i) => ({ i, text: s.text, type: s.type }))
            .filter((x) => x.text && x.type !== "table" && x.type !== "image") // 表格/图片不着色
        : bs
          .map((b, i) => ({ i, text: (b.text || "").trim(), type: b.type }))
          .filter((x) => x.text && x.type !== "table" && x.type !== "image") // 表格/图片不着色
    if (!items.length) return
    setPosLoading(true)
    setStoryLoading(true)
    void Promise.allSettled(items.map(async (x) => {
      const [posRes, storyRes] = await Promise.allSettled([
        posTags(x.text, lang),
        storyElements(x.text, lang),
      ])
      return {
        i: x.i,
        tags: posRes.status === "fulfilled" ? posRes.value.tags : [],
        elements: storyRes.status === "fulfilled" ? storyRes.value.elements : [],
      }
    })).then((results) => {
      const pm: Record<number, PosTagItem[]> = {}
      const sm: Record<number, StoryElementItem[]> = {}
      for (const r of results) {
        if (r.status === "fulfilled") {
          pm[r.value.i] = r.value.tags
          sm[r.value.i] = r.value.elements
        }
      }
      // 标注是异步拉的：回来时用户可能已切到第 2 张照片 —— 那时块下标含义完全不同，
      // 直接写进去就会串页（第 1 张的"名词"染到第 2 张的别的块）。故按会话 id 丢弃过期结果。
      if (useParseSessionStore.getState().session?.sessionId !== mySid) return
      annoRef.current = { pos: pm, story: sm }
      setPosMap(pm)
      setStoryMap(sm)
      setPosLoading(false)
      setStoryLoading(false)
      // 若自动保存已落库（标注晚到），用条目 id 回填历史
      const hid = pendingHistoryIdRef.current
      if (hid) {
        updateHistory(m, hid, { pos: pm, story: sm })
        pendingHistoryIdRef.current = null
      }
    })
  }, [session, runId])

  /**
   * 朗读模式点击：由渲染层把「点中的是第几块、哪一段、段落原文、事件、整块全文」传进来，
   * 这里按当前模式判定朗读单位：
   *  - 段落模式 = **整个块**（语文一块=一段/一题，数学一块=一整道题，英语一块=一段课文）；
   *    点块内任一处都读整块，不再只读被点中的那一个语义段落。
   *  - 句子模式 = 用点击偏移定位到那一句。
   * 高亮它并朗读（反复朗读开启时按 repeatTimes 连读，默认 1 次）。
   * 挂在这里（早于下方 `if (!session)` 提前 return）以满足 hooks 调用顺序恒定。
   */
  const handleReadClick = useCallback(
    (blockIdx: number, paraKey: string, paraText: string, e: ReactMouseEvent, blockText?: string) => {
      // 标记模式优先：正在选「不认识的字」时点正文只做标记，不朗读
      if (marking) return
      const unit = readUnit ?? "sent" // 只开了「反复朗读」时默认按句子
      const whole = unit === "para"
      // 整块文本可能带表格 HTML / OCR 物理换行 → 先清成可读串再读。
      // 兜底：渲染层没给整块文本时退回被点的这一段（旧行为，至少不会读空）。
      const seg = whole
        ? toReadableBlockText(blockText ?? "") || toReadableBlockText(paraText)
        : sentenceAt(paraText, caretOffsetIn(e, paraText))
      const t = seg.trim()
      if (!t) return
      setReadMark({ blockIdx, paraKey: whole ? "" : paraKey, text: t, whole })
      const times = repeatOn ? Math.max(1, repeatTimes) : 1
      void (async () => {
        for (let i = 0; i < times; i++) await speakBlock(t)
      })()
    },
    [readUnit, repeatOn, repeatTimes, speakBlock, marking],
  )

  /**
   * 多图切换（2026-09-16）：页级 UI 状态必须整体重置。
   * 高亮 / 标记 / 词性着色 / 回答卡片全部**按块下标索引**，第 2 张的块与第 1 张毫无关系，
   * 不重置就会出现「切过去还顶着上一张的高亮」。问答记录（qaStore）按 sessionId 隔离，
   * 不用管；历史保存在订阅里按 sessionId 去重，也不受影响。
   */
  const activeSessionId = session?.sessionId ?? ""
  useEffect(() => {
    setHlMap({})
    setReadMark(null)
    setMarking(false)
    setMarkedChars(new Set())
    setPosMap({})
    setStoryMap({})
    setInitQa(null)
    setPreviewCrop(null)
    setError("")
    initAskedRef.current = false
    wordbookAddedRef.current = new Set()
    sectionRefs.current = []
  }, [activeSessionId])

  if (!session) {
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>📄 识别结果</h1>
        </header>
        <div className="card">
          <p className="err">暂无识别结果，请先拍照 / 粘贴图片识别。</p>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => navigate(-1)}>
            ← 返回
          </button>
        </div>
      </div>
    )
  }

  const { text, questions, blocks, previewUrl, file, sessionId, turns, crops } = session
  const isChinese = module === "chinese"
  // 英语展示分段：结构化 blocks 优先（版面与原图一致），退回扁平文本。
  // ⚠️ 下面渲染循环 / posMap 标注项 / navCount / sectionLabel 必须共用这一份，索引才对得上。
  const enSegments = isEnglish ? enDisplaySegments(blocks, questions, text) : []
  // 数学展示分段：服务端结构化 blocks 优先（P1 起非空），退回扁平 questions/text
  const mathSegments = !isChinese && !isEnglish ? mathDisplaySegments(blocks, questions, text) : []

  /** 逐字可点读渲染（数学/语文的纯文本分支共用）：点字朗读 + 加生词本 + 记录点击。
   * HTML 表格不在这里渲染——由 splitInlineTables 切出后交给可点读表格组件。 */
  const renderTapChars = (t: string, tag: string) =>
    [...t].map((ch, ci) =>
      ch === "\n" || ch === " " || !isSpeakableChar(ch) ? (
        <span key={ci} className="tap-char-space">
          {ch === "\n" ? <br /> : ch}
        </span>
      ) : (
        <span
          key={ci}
          className={`tap-char-item${speakingChar === ch ? " playing" : ""}`}
          onClick={() => {
            addTappedWordbook(ch, tag)
            void speakChar(ch, {})
            void recordCharClick([ch])
          }}
        >
          {ch}
        </span>
      ),
    )

  /** 朗读高亮切分：把正文字符串按当前 readMark 切成「前 / 中 / 后」，中段包 `.read-hl`。
   *  中段仍是 inline 元素，视觉上仍是一整段（不能换成块级，否则会断行）。
   *  · 整块模式（readMark.whole）：readMark.text 是**多段拼起来的块全文**，而 body 只是其中
   *    一段，子串匹配必然落空 → 这一段整段高亮（块内每段都走这里 = 整块被选中）。
   *  · 句子模式：mid = 点中的那一句。 */
  const renderReadSplit = (
    body: string,
    blockIdx: number,
    paraKey: string,
    renderFn: (s: string) => ReactNode,
  ): ReactNode => {
    const rm = readMark
    const isMine = !!rm && rm.blockIdx === blockIdx
    if (isMine && rm!.whole) return <span className="read-hl">{renderFn(body)}</span>
    const mk = isMine && rm!.paraKey === paraKey ? rm!.text : ""
    if (mk) {
      const idx = body.indexOf(mk)
      if (idx >= 0) {
        const before = body.slice(0, idx)
        const mid = body.slice(idx, idx + mk.length)
        const after = body.slice(idx + mk.length)
        return (
          <>
            {before && renderFn(before)}
            <span className="read-hl">{renderFn(mid)}</span>
            {after && renderFn(after)}
          </>
        )
      }
    }
    return renderFn(body)
  }

  /** 文本段渲染：表格 → 可点读表格；正文 → 按语义段落逐字渲染。
   *
   *  为什么要段落化：OCR 文本是按图片物理行硬折行的，旧实现把 `\n` 渲染成 <br>，
   *  容器又是 white-space:pre-wrap，于是图片上每一行都被硬断行 —— 出现
   *  「行内还有空间、下一个字另起一行到行首」。现在把物理行并回语义段落，
   *  交给浏览器自动折行。
   *  ⚠️ 段落首行缩进用**两个全角空格**，不要用 CSS text-indent：段落里每个字都是
   *  独立行内盒，text-indent 会把每个字盒撑宽 2em（实测 `、` 24px→64px）。
   *  数学题是带题号的条目（非作文段落），不缩进、左对齐贴合试卷排版惯例。
   *  断行规则由学科模块决定：语文走 chineseReflow、数学走 mathReflow（算式独占一段），
   *  通过最后一个参数传入对应学科的 reflow 函数，不再用布尔开关（见 lib/subject/*）。
   *  blockIdx 供朗读模式回传（段落/句子高亮的匹配键 = blockIdx + paraKey）。 */
  const renderMixedText = (
    t: string,
    tag: string,
    indent = true,
    reflowFn: (s: string) => string[] = chineseReflow,
    blockIdx = -1,
  ) =>
    splitInlineTables(t).map((seg, si) => {
      // 整块朗读命中的是本块（含表格块）时：整块上高亮（表格没法逐字高亮，整块黄底即可）
      const wholeHit = blockIdx >= 0 && readActive && readMark?.blockIdx === blockIdx && !!readMark.whole
      const pickable = blockIdx >= 0 && readActive
      if (seg.type === "table") {
        return (
          <div
            key={`t${si}`}
            className={`${pickable ? "read-pickable" : ""}${wholeHit ? " read-hl" : ""}`}
            // 表格块也吃「整块朗读」：点表格读整张表（段落模式），句子模式则退回表内文本首句。
            onClick={
              pickable
                ? (e) => handleReadClick(blockIdx, `t${si}`, toReadableBlockText(seg.text), e, t)
                : undefined
            }
          >
            <SpeakableTable html={seg.text} speakingChar={speakingChar} onCharClick={handleCharClick} />
          </div>
        )
      }
      return reflowFn(seg.text).map((para, pi) => {
        const paraKey = `p${pi}`
        const body = indent ? `\u3000\u3000${para}` : para
        return (
          <div
            key={`x${si}-${pi}`}
            className={`flow-para${readActive ? " read-pickable" : ""}`}
            // 第 5 参 = 本块全文：段落模式读的是「整个块」，不是被点的这一段
            onClick={readActive ? (e) => handleReadClick(blockIdx, paraKey, body, e, t) : undefined}
          >
            {renderReadSplit(body, blockIdx, paraKey, (s) => renderTapChars(s, tag))}
          </div>
        )
      })
    })

  /** 数学块渲染：尊重服务端给出的 `align` 与逐行 `indent`（2026-09-15 试卷规格落地）。
   *
   *  · `body`（算式/竖式）→ **逐行原样**渲染，行首空格是列位不能动；
   *    行级 indent 用 `paddingInlineStart` 而不是 `text-indent`：`.math-line` 是块级盒，
   *    padding 不会像 text-indent 那样把行内每个字盒撑宽（语文那边踩过 24px→64px 的坑）。
   *  · `table` / 正文内嵌 `<table>` → 交给 renderMixedText，它内部会切成可点读表格。
   *  · 其余（题干/选项/注/标题/页脚）→ 仍走 reflow 并段（长题干自动折行），
   *    缩进取**首行** indent 做块级缩进；逻辑行已被并段，无法逐行缩进（选项本就单行）。
   *  · `align=center/right` 走 textAlign，让居中标题、右对齐说明与原图一致。 */
  const renderMathSeg = (seg: MathSeg, idx: number) => {
    if (isTableSeg(seg)) return <>{renderMixedText(seg.text, "recog_math", false, mathReflow, idx)}</>
    const ta = mathAlignTextAlign(seg.align)
    const style: React.CSSProperties = ta === "left" ? {} : { textAlign: ta }
    if (seg.type === "body") {
      // 算式/竖式块逐行渲染，没有 .flow-para 承载点击 → 点击与高亮都挂在这一层。
      // 整块朗读命中本块时，每行整行高亮（块文本跨多行，无法用子串匹配）。
      const hl = readActive && !!readMark && readMark.blockIdx === idx && !!readMark.whole
      return (
        <div
          className={`ai-question-block-text tap-char${readActive ? " read-pickable" : ""}`}
          style={style}
          onClick={readActive ? (e) => handleReadClick(idx, "body", seg.text, e, seg.text) : undefined}
        >
          {seg.lines.map((l, li) => (
            <div
              key={li}
              className={`math-line${hl ? " read-hl" : ""}`}
              style={{ paddingInlineStart: `${mathIndentEm(l.indent)}em` }}
            >
              {renderTapChars(l.text, "recog_math")}
            </div>
          ))}
        </div>
      )
    }
    const blockPad = mathIndentEm(seg.lines[0]?.indent ?? 0)
    if (blockPad > 0) style.paddingInlineStart = `${blockPad}em`
    return (
      <div className="ai-question-block-text tap-char" style={style}>
        {renderMixedText(seg.text, "recog_math", false, mathReflow, idx)}
      </div>
    )
  }

  // 可定位区块数：语文=文字块数，数学=题目数，英语=展示分段数（与渲染循环同一份）
  const navCount = isChinese ? blocks.length : isEnglish ? enSegments.length : mathSegments.length
  // 是否有可能朗读的正文（决定左侧朗读模式栏是否出现）：没有正文时不显示，避免空占版面
  const hasReadable =
    (isChinese && (blocks.length > 0 || questions.length > 0)) ||
    (isEnglish && enSegments.length > 0) ||
    (!isChinese && !isEnglish && (mathSegments.length > 0 || questions.length > 0 || !!text.trim()))
  const jumpToSection = (idx: number) => {
    sectionRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  // 定位方块文案：该块前 5 个字（去掉空白）
  const sectionLabel = (idx: number): string => {
    const raw = isChinese ? blocks[idx]?.text ?? "" : isEnglish ? enSegments[idx]?.text ?? "" : mathSegments[idx]?.text ?? ""
    const compact = raw.replace(/\s+/g, "").replace(/\n/g, "")
    return compact.slice(0, 5)
  }

  // 纯文本对话历史回看（无识别图片）
  if (turns && turns.length > 0) {
    const turnsCount = Math.ceil(turns.filter((t) => t.role === "user").length)
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>💬 AI 对话回看</h1>
        </header>
        <p className="module-hint">历史对话 · {turnsCount} 轮问答</p>
        <div className="ai-chat-panel">
          <div className="ai-chat-head">
            <h2 className="section-title">对话</h2>
          </div>
          <div className="ai-chat-scroll">
            <div className="ai-chat-list">
              {turns.map((t, i) => (
                <div key={i} className={`ai-chat-turn ${t.role === "user" ? "user" : "assistant"}`}>
                  <div className="ai-chat-role">{t.role === "user" ? "🙋" : "🤖"}</div>
                  <div className="ai-chat-bubble" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {t.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card" style={{ marginTop: 10 }}>
          <button className="btn-secondary" style={{ width: "100%" }} onClick={() => navigate(-1)}>
            ← 返回
          </button>
        </div>
      </div>
    )
  }

  const scopeEntries = Object.values(scopeQa(sessionId, qaAll))
  const qaCount = scopeEntries.reduce((n, list) => n + list.length, 0)

  const runParse = async (f: File | Blob, url: string, noCache: boolean) => {
    setParsing(true)
    setError("")
    setMarking(false)
    setMarkedChars(new Set())
    setReadMark(null)
    setHlMap({})
    setRunId((r) => r + 1)
    // 重新识别 = 新结果，清空当前会话问答（QaStore 中按 scope 隔离）
    useQaStore.getState().removeScope(sessionId)
    try {
      // ⚠️ 这里此前写的是 `effModule === "english" ? "chinese" : effModule`：英语重识别会走语文
      // 通道（不带 mode=english），服务端按语文提示词识别英文 —— 与输入页首次识别口径不一致。
      // 2026-09-16 统一为直接传 effModule（parseImage 内部会给英语带上 mode=english）。
      const res = await parseImage(f, effModule, noCache)
      const store = useParseSessionStore.getState()
      // 多图批次里「重新识别 / 旋转」只作用于**当前这一张**：结果写回该页，
      // 切到别的照片再切回来看到的就是新结果（不再整批作废）。单页时 pages 为空，
      // setPageResult 自动走"直接更新 session"的分支。
      store.setPageResult(store.activePage, res, { file: f, previewUrl: url })
      // 重新识别/旋转后同样后台补齐注音并回填（本页是 store 订阅组件，注音就绪自动重渲染）
      if (effModule === "chinese") schedulePolyPatch(res, "chinese", store.pages.length ? store.activePage : undefined)
    } catch (err) {
      setError(`识别失败: ${detailFromError(err)}`)
    } finally {
      setParsing(false)
    }
  }

  const reRecognize = () => {
    if (session?.file && !parsing) void runParse(session.file, session.previewUrl, true)
  }

  const rotateImage = async () => {
    if (!session?.file || parsing) return
    const rotated = await rotateBlob90(session.file)
    void runParse(rotated, URL.createObjectURL(rotated), false)
  }

  const handleCharClick = async (ch: string) => {
    if (isChinese && marking) {
      setMarkedChars((prev) => {
        const next = new Set(prev)
        if (next.has(ch)) next.delete(ch)
        else next.add(ch)
        return next
      })
      return
    }
    // 朗读模式：这里刻意什么都不做（也不 stopPropagation）—— 让点击冒泡到段落容器，
    // 由 handleReadClick 统一判定「哪一段 / 哪一句」再朗读，避免逐字点读与整句朗读打架。
    if (readActive) return
    // 点读单字 → 自动加入生词本（仅收汉字；数学题面的数字/字母不收）
    addTappedWordbook(ch, effModule === "math" ? "recog_math" : "recog_chinese")
    const block = blocks.find((b) => b.text.includes(ch))
    await speakChar(ch, block?.polyphones ?? {})
    void recordCharClick([ch])
  }

  const submitMarks = async () => {
    if (markedChars.size === 0) {
      setError("还没有选中任何字")
      return
    }
    setMarkUploading(true)
    setError("")
    try {
      const ok = await markUnknownChars([...markedChars], (blocks[0]?.text ?? "").slice(0, 30))
      if (ok) {
        alert("✅ 已标记不认识的字")
        setMarking(false)
        setMarkedChars(new Set())
      } else {
        setError("上传失败，请重试")
      }
    } finally {
      setMarkUploading(false)
    }
  }

  return (
    <div className={`page aihomework-page${hasReadable ? " has-read-rail" : ""}`}>
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📄 识别结果</h1>
        {isEnglish && <PhonicsToggle />}
      </header>
      <p className="module-hint">
        {isChinese
          ? "点字听发音 · 可标记不认识的字 · 点读自动加生词本 · 左侧选朗读模式后点正文可整段/整句朗读"
          : isEnglish
            ? "点词听发音 · 点读整词自动加生词本 · 彩色色块 = 发音规律（见首页⚙️设置里的色卡）"
            : "点字听发音 · 点读自动加生词本 · 左侧选朗读模式后点正文可整段/整句朗读"}
      </p>

      {/* 多张照片切换标签（仅"一次选多张"时出现）：第 1 张先识别，其余在后台依次识别；
          标签上直接显示每张的状态（排队中 / 识别中 / 已识别 / 失败），点一下切过去看。 */}
      {pages.length > 1 && (
        <div className="page-tabs" role="tablist" aria-label="识别照片切换">
          {pages.map((p, i) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={i === activePage}
              className={`page-tab st-${p.status}${i === activePage ? " on" : ""}`}
              onClick={() => selectPage(i)}
              title={p.error || `第 ${i + 1} 张（共 ${pages.length} 张）`}
            >
              <span className="page-tab-idx">第 {i + 1} 张</span>
              <span className="page-tab-st">{PAGE_TAB_TEXT[p.status]}</span>
            </button>
          ))}
        </div>
      )}

      {/* 页面区域裁剪图（Vision 检测 bbox 切割，点击看大图对照定位） */}
      {crops && crops.length > 0 && (
        <div className="card" style={{ marginBottom: 8 }}>
          <h2 className="section-title">🖼️ 区域大题 {crops.length} 块（点击看图）</h2>
          <div className="ai-crop-row">
            {crops.map((c) => (
              <button key={c.id} className="ai-crop-thumb" onClick={() => setPreviewCrop(c.image)} title={c.title || `第 ${c.id} 块`}>
                <img src={c.image} alt={c.title || `第 ${c.id} 块`} loading="lazy" />
                {c.title && <span className="ai-crop-title">{c.title}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 带图提问：识别后自动用文本框问题问答 */}
      {initQa && (
        <div className="card" style={{ marginBottom: 8 }}>
          <h2 className="section-title">🤖 识别后回答</h2>
          <p className="import-meaning">问题：{initQa.question}</p>
          {initQa.asking ? (
            <p className="empty">AI 思考中…</p>
          ) : (
            <div className="ai-answer-text" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 6 }}>
              {initQa.answer}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="section-title-row">
          <h2 className="section-title">📷 {isChinese || isEnglish ? "课文" : "题目"}识别</h2>
          <button className="btn-secondary btn-sm" onClick={() => setShowQa(true)}>
            💬 问答记录{qaCount ? `（${qaCount}）` : ""}
          </button>
        </div>
        {/* 切到的那张还没识别完（或失败）时的占位说明：多图批次里除了第 1 张，
            其余都是后台排队识别的，用户点过来经常会看到"识别中"，要说清楚来源。 */}
        {pages[activePage] && pages[activePage].status !== "done" && (
          <p className={`page-pending st-${pages[activePage].status}`}>
            {pages[activePage].status === "error"
              ? `⚠️ 第 ${activePage + 1} 张识别失败：${pages[activePage].error || "未知原因"}（可点下方「🔄 重新识别」重试）`
              : `🔍 第 ${activePage + 1} 张正在识别中（多张照片按顺序依次识别，其余排在这张后面）…`}
          </p>
        )}
        {file && (
          <div className="ai-upload-row">
            <button className="btn-secondary" onClick={reRecognize} disabled={parsing}>
              {parsing ? "识别中…" : "🔄 重新识别"}
            </button>
            <button className="btn-secondary" onClick={rotateImage} disabled={parsing}>
              ↻ 旋转
            </button>
          </div>
        )}
        {previewUrl && <img className="ai-preview" src={previewUrl} alt="识别图片" />}

        {isChinese && blocks.length > 0 && (
          <div className="block-list">
            <div className="block-list-toolbar">
              <span className="import-meaning">{blocks.length} 个文字块 · 点字听发音 · 左侧可整段/整句朗读</span>
              <button
                className={`btn-secondary btn-sm pos-toggle${posOn ? " pos-on" : ""}`}
                onClick={() => setPosOn((v) => !v)}
                disabled={posLoading}
                title="给名词/动词/形容词染上不同颜色"
                aria-label="词性颜色开关"
              >
                🎨 词性颜色{posLoading ? "…" : posOn ? " 开" : " 关"}
              </button>
              <button
                className={`btn-secondary btn-sm story-toggle${storyOn ? " story-on" : ""}`}
                onClick={() => setStoryOn((v) => !v)}
                disabled={storyLoading}
                title="标出人物/时间/地点/起因/经过/结果"
                aria-label="文章要素开关"
              >
                📌 文章要素{storyLoading ? "…" : storyOn ? " 开" : " 关"}
              </button>
              {marking ? (
                <div className="block-mark-actions">
                  <span className="block-mark-count">已选 {markedChars.size} 字</span>
                  <button className="btn-secondary btn-sm" onClick={() => { setMarking(false); setMarkedChars(new Set()) }}>
                    取消
                  </button>
                  <button className="btn-primary btn-sm" onClick={submitMarks} disabled={markUploading || markedChars.size === 0}>
                    {markUploading ? "上传中…" : "上传不认识的字"}
                  </button>
                </div>
              ) : (
                <button className="btn-secondary btn-sm" onClick={() => setMarking(true)}>
                  ✋ 标记不认识的字
                </button>
              )}
            </div>
            {marking && <p className="block-mark-hint">点选不认识的字（红底），选完点「上传不认识的字」</p>}
            {blocks.map((b, i) => (
              <div key={i} ref={(el) => { sectionRefs.current[i] = el }} className="block-item">
                {b.type !== "image" && (
                  b.type === "table" ? (
                  <>
                    {/* 表格块也支持整块朗读：表格内部不做逐格高亮（会打散表格结构），整块黄底。 */}
                    <div
                      className={`${readActive ? "read-pickable" : ""}${
                        readActive && readMark?.blockIdx === i && readMark.whole ? " read-hl" : ""
                      }`}
                      onClick={
                        readActive
                          ? (e) => handleReadClick(i, "table", toReadableBlockText(b.text), e, b.text)
                          : undefined
                      }
                    >
                      <SpeakableTable
                        html={b.text}
                        speakingChar={speakingChar}
                        onCharClick={handleCharClick}
                      />
                    </div>
                    {/* 表格块操作条：同样只保留「解析高亮」与「跟 AI 对话」。
                        原「朗读整表 🔊」「整表汉字加入生词本 📥」已按需求移除。 */}
                    <div className="block-ops">
                      {!marking && (
                        <BlockHighlight
                          key={`${sessionId}-${runId}-th${i}`}
                          text={b.text.replace(/<[^>]+>/g, "")}
                          showInline={false}
                          onParsed={(marks) => setHlMap((m) => ({ ...m, [i]: marks }))}
                        />
                      )}
                      {!marking && <BlockAsk text={b.text.replace(/<[^>]+>/g, "")} qaKey={`${sessionId}:block-${i}`} />}
                    </div>
                  </>
                  ) : (
                  <>
                    <BlockText
                      block={b}
                      speakingChar={speakingChar}
                      marking={marking}
                      markedChars={markedChars}
                      highlights={hlMap[i] ?? []}
                      posTags={posOn ? (posMap[i] ?? []) : []}
                      storyTags={storyOn ? (storyMap[i] ?? []) : []}
                      onSpeakPhrase={(p) => void speakBlock(p)}
                      onCharClick={handleCharClick}
                      onSpeakBlock={(t) => speakBlock(t)}
                      readActive={readActive}
                      onParaClick={readActive ? (paraKey, paraText, blockText, e) => handleReadClick(i, paraKey, paraText, e, blockText) : undefined}
                      readMark={readMark && readMark.blockIdx === i ? readMark : null}
                      hideSpeak
                    />
                    {/* 块底部操作条：只保留「解析高亮」（✨）与「跟 AI 对话」（？）。
                        朗读移到页面左侧的朗读模式栏（段落/句子/反复），此前的
                        喇叭 🔊 / 录音 🎤 / 连读高亮 🖍️ 已按需求移除（2026-09-15）。 */}
                    <div className="block-ops">
                      {!marking && (
                        <BlockHighlight
                          key={`${sessionId}-${runId}-h${i}`}
                          text={b.text}
                          showInline={false}
                          onParsed={(marks) => setHlMap((m) => ({ ...m, [i]: marks }))}
                        />
                      )}
                      {!marking && <BlockAsk text={b.text} qaKey={`${sessionId}:block-${i}`} />}
                    </div>
                  </>
                  )
                )}
              </div>
            ))}
          </div>
        )}

        {isChinese && blocks.length === 0 && questions.length > 0 && (
          <div className="ai-recog-questions">
            <p className="import-meaning">识别到 {questions.length} 段：</p>
            {questions.map((q, i) => (
              <div key={i} ref={(el) => { sectionRefs.current[i] = el }} className="ai-question-item">
                <div className="article-row">
                  <div className="import-body">
                    <div className="import-text tap-char">{renderMixedText(q, "recog_chinese", true, chineseReflow, i)}</div>
                  </div>
                </div>
                <BlockAsk text={q} qaKey={`${sessionId}:q-${i}`} />
                <BlockHighlight key={`${sessionId}-${runId}-qh${i}`} text={q} />
              </div>
            ))}
          </div>
        )}

        {!isChinese && (isEnglish ? enSegments.length > 0 : questions.length > 0) && (
          <div className="ai-recog-questions">
            <p className="import-meaning">
              {isEnglish
                ? `识别到 ${enSegments.length} 段，一段一块（点词可听发音）：`
                : `识别到 ${questions.length} 道题，一题一个块（点字可听发音）：`}
              {isEnglish && (
                <button
                  className={`btn-secondary btn-sm pos-toggle${posOn ? " pos-on" : ""}`}
                  style={{ marginLeft: 8 }}
                  onClick={() => setPosOn((v) => !v)}
                  disabled={posLoading}
                  title="给名词/动词/形容词染上不同颜色"
                  aria-label="词性颜色开关"
                >
                  🎨 词性颜色{posLoading ? "…" : posOn ? " 开" : " 关"}
                </button>
              )}
              {isEnglish && (
                <button
                  className={`btn-secondary btn-sm story-toggle${storyOn ? " story-on" : ""}`}
                  style={{ marginLeft: 4 }}
                  onClick={() => setStoryOn((v) => !v)}
                  disabled={storyLoading}
                  title="标出人物/时间/地点/起因/经过/结果"
                  aria-label="文章要素开关"
                >
                  📌 文章要素{storyLoading ? "…" : storyOn ? " 开" : " 关"}
                </button>
              )}
            </p>
            {(isEnglish ? enSegments : mathSegments).map((seg, i) => (
              <div key={i} ref={(el) => { sectionRefs.current[i] = el }} className="ai-question-block">
                <div className="ai-question-block-head">
                  <span className="ai-question-index">📝 第 {i + 1} {isEnglish ? "段" : "题"}</span>
                </div>
                {isEnglish ? (
                  <EnglishResult
                    text={seg.text}
                    speakingWord={speakingWord}
                    onWordSpeak={speakEnglishWord}
                    posTags={posOn ? (posMap[i] ?? []) : []}
                    storyTags={storyOn ? (storyMap[i] ?? []) : []}
                    readMeta={readActive ? { blockIdx: i, blockText: seg.text, onParaClick: handleReadClick, readMark } : undefined}
                  />
                ) : (
                  // 走到这里 isEnglish 必为 false，seg 一定来自 mathSegments（带 align/lines）；
                  // TS 只看到 `enSegments | mathSegments` 的联合类型，故显式收窄。
                  renderMathSeg(seg as MathSeg, i)
                )}
                {/* 块底部只保留「解析高亮」与「跟 AI 对话」；朗读移到左侧朗读模式栏
                    （2026-09-15 按需求移除喇叭 🔊 与「整块加入生词本」📥）。 */}
                <div className="block-ops">
                  <BlockHighlight key={`${sessionId}-${runId}-qh${i}`} text={seg.text} />
                  <BlockAsk text={seg.text} qaKey={`${sessionId}:q-${i}`} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isChinese && !isEnglish && !questions.length && text.trim() && (
          <div className="ai-question-block">
            {isEnglish && (
              <p className="import-meaning">
                <button
                  className={`btn-secondary btn-sm pos-toggle${posOn ? " pos-on" : ""}`}
                  onClick={() => setPosOn((v) => !v)}
                  disabled={posLoading}
                  title="给名词/动词/形容词染上不同颜色"
                  aria-label="词性颜色开关"
                >
                  🎨 词性颜色{posLoading ? "…" : posOn ? " 开" : " 关"}
                </button>
                <button
                  className={`btn-secondary btn-sm story-toggle${storyOn ? " story-on" : ""}`}
                  style={{ marginLeft: 4 }}
                  onClick={() => setStoryOn((v) => !v)}
                  disabled={storyLoading}
                  title="标出人物/时间/地点/起因/经过/结果"
                  aria-label="文章要素开关"
                >
                  📌 文章要素{storyLoading ? "…" : storyOn ? " 开" : " 关"}
                </button>
              </p>
            )}
            {isEnglish ? (
              <EnglishResult
                text={text}
                speakingWord={speakingWord}
                onWordSpeak={speakEnglishWord}
                posTags={posOn ? (posMap[0] ?? []) : []}
                storyTags={storyOn ? (storyMap[0] ?? []) : []}
              />
            ) : (
              <div className="ai-question-block-text tap-char">
                {renderMixedText(text, "recog_math", false, mathReflow, 0)}
              </div>
            )}
            <div className="block-ops">
              <BlockHighlight key={`${sessionId}-${runId}-texth`} text={text} />
              <BlockAsk text={text} qaKey={`${sessionId}:text`} />
            </div>
          </div>
        )}

        <p className="history-saved-hint" style={{ marginTop: 10, width: "100%", textAlign: "center", fontSize: 13, color: "#2e7d32" }}>
          ✅ 已自动保存到历史（识别完成后自动记录）
        </p>
      </div>

      <div className="card">
        <button className="btn-secondary" style={{ width: "100%" }} onClick={() => navigate(-1)}>
          ← 返回
        </button>
      </div>

      {error && <p className="err">{error}</p>}

      {/* 朗读模式栏（左侧·小按钮）：整块 / 句子 / 反复朗读。
          先选模式，再点正文任意位置 —— 整块模式读**整个块**的内容（语文一块=一段/一题，
          数学一块=一整道题），句子模式按点击偏移只读其中一句；
          高亮后朗读（反复朗读按设定次数连读，默认 1 次）。
          ⚠️ 版面按手机设计，按钮刻意做得很小（见 App.css .read-rail），不遮挡正文。 */}
      {hasReadable && (
        <div className="read-rail" role="group" aria-label="朗读模式">
          <button
            className={`read-rail-btn${readUnit === "para" ? " on" : ""}`}
            onClick={() => setReadUnit((v) => (v === "para" ? null : "para"))}
            title="整块朗读：点块内任一处，朗读这个块的全部内容（整段课文 / 整道题）"
            aria-label="整块朗读"
            aria-pressed={readUnit === "para"}
          >
            <span className="read-rail-icon">¶</span>
            <span className="read-rail-label">整块</span>
          </button>
          <button
            className={`read-rail-btn${readUnit === "sent" ? " on" : ""}`}
            onClick={() => setReadUnit((v) => (v === "sent" ? null : "sent"))}
            title="句子朗读：点正文任一处，只读所在的那一句"
            aria-label="句子朗读"
            aria-pressed={readUnit === "sent"}
          >
            <span className="read-rail-icon">。</span>
            <span className="read-rail-label">句子</span>
          </button>
          <button
            className={`read-rail-btn${repeatOn ? " on" : ""}`}
            onClick={() => setRepeatOn((v) => !v)}
            title="反复朗读：按下方次数重复朗读所选内容"
            aria-label="反复朗读"
            aria-pressed={repeatOn}
          >
            <span className="read-rail-icon">↻</span>
            <span className="read-rail-label">反复</span>
          </button>
          {repeatOn && (
            <div className="read-rail-times" aria-label="反复朗读次数">
              <button
                className="read-rail-step"
                onClick={() => setRepeatTimes((n) => Math.max(1, n - 1))}
                disabled={repeatTimes <= 1}
                aria-label="减少次数"
              >
                −
              </button>
              <span className="read-rail-count">{repeatTimes}</span>
              <button
                className="read-rail-step"
                onClick={() => setRepeatTimes((n) => Math.min(9, n + 1))}
                disabled={repeatTimes >= 9}
                aria-label="增加次数"
              >
                ＋
              </button>
            </div>
          )}
          {readActive && <span className="read-rail-hint">点正文</span>}
        </div>
      )}

      {wbToast && (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#111",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 20,
            fontSize: 14,
            zIndex: 9999,
            boxShadow: "0 4px 12px rgba(0,0,0,.25)",
          }}
        >
          {wbToast}
        </div>
      )}

      {showQa && (
        <QaHistoryModal
          scope={sessionId}
          moduleLabel={isChinese ? "语文" : isEnglish ? "英语" : "数学"}
          onClose={() => setShowQa(false)}
        />
      )}

      {/* 区域裁剪图放大预览 */}
      {previewCrop && (
        <div className="ai-crop-overlay" onClick={() => setPreviewCrop(null)}>
          <img src={previewCrop} alt="region" className="ai-crop-overlay-img" />
        </div>
      )}

      {/* 区块定位条：右侧长方块，写每块前五个字，点击快速定位到任一块/题；把手可折叠隐藏全部标签 */}
      {navCount > 1 && !turns && (
        <div className={`block-nav-rail${railCollapsed ? " collapsed" : ""}`}>
          <button
            className="block-nav-toggle"
            onClick={() => setRailCollapsed((v) => !v)}
            title={railCollapsed ? "展开定位标签" : "收起定位标签"}
            aria-label={railCollapsed ? "展开定位标签" : "收起定位标签"}
          >
            {railCollapsed ? "»" : "«"}
          </button>
          <div className="block-nav-line" />
          {Array.from({ length: navCount }, (_, i) => (
            <button
              key={i}
              className="block-nav-item"
              onClick={() => jumpToSection(i)}
              title={sectionLabel(i)}
              aria-label={`定位到块${sectionLabel(i)}`}
            >
              {sectionLabel(i) || "..."}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
