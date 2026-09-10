/** 识别结果页 — 图片识别完成后独立展示（语文：排版块逐字点读/块级评测/标记不认识字；数学：题目列表逐字点读）
 *
 * 数据来自 parseSessionStore（输入页识别成功后写入，跳转过来）。刷新会丢会话，引导返回重新识别。
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useParseSessionStore } from "../stores/parseSessionStore"
import { useQaStore, scopeQa } from "../stores/qaStore"
import { parseImage } from "../services/aiImage"
import { rotateBlob90 } from "../lib/imageOrientation"
import { schedulePolyPatch } from "../lib/polyPatch"
import { addHistory, updateHistory, makeThumb } from "../lib/aiHistory"
import { isSpeakableChar } from "../lib/chars"
import { BlockText } from "../components/BlockText"
import { BlockRecorder } from "../components/BlockRecorder"
import { BlockAsk } from "../components/BlockAsk"
import { BlockHighlight } from "../components/BlockHighlight"
import { QaHistoryModal } from "../components/QaHistoryModal"
import type { HighlightMarkItem, PosTagItem, StoryElementItem } from "../services/aichinese"
import { useBlockSpeaking } from "../hooks/useBlockSpeaking"
import { markUnknownChars, recordCharClick, posTags, storyElements } from "../services/aichinese"
import { askLlm } from "../services/aiAsk"
import { detailFromError } from "../services/auth"
import { addWordbook, addWordbookMany } from "../services/wordbook"
import { SpeakableTable } from "../components/SpeakableTable"
import { splitInlineTables } from "../lib/paragraphFlow"

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
    const word = seg
    const speaking = speakingWord === word
    return (
      <span key={si} className={`tap-char-word${speaking ? " word-speaking" : ""}`}>
        {[...word].map((ch, ci) => (
          <span
            key={ci}
            className={`tap-char-item${speaking ? " playing" : ""}`}
            onClick={() => onWordSpeak(word)}
          >
            {ch}
          </span>
        ))}
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

/** 句末标点：中文句号/叹号/问号/分号 + 英文 ! ? ; 以及句末英文句点。
 *  英文句点要求后面是空白或结尾，避免把 "3.5" / "Mr." 当句尾。 */
const SENT_END = /[。！？；!?;]|\.(?=\s|$)/
/** 中文把句末标点后的右引号/右括号也算作一句的结尾 */
const isSentenceCloser = (c: string) => "”’」』）)》〉】".includes(c)

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
 * 否则 → 逐词点读（EnglishWordTap）。点读整词即自动加入生词本（onWordSpeak 内处理）。 */
function EnglishResult({
  text,
  speakingWord,
  onWordSpeak,
  posTags,
  storyTags,
}: {
  text: string
  speakingWord: string | null
  onWordSpeak: (word: string) => void
  posTags?: PosTagItem[]
  storyTags?: StoryElementItem[]
}) {
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
  // 内嵌 HTML 表格（Paddle/豆包表格模式把表格混排在正文里）：按 `<table>` 切段 ——
  // 表格段画成真正的表格方框（整词/整格朗读），其余文本段照常逐词点读。
  // 直接整段丢给 SpeakableTable 会丢掉表格前后的文字，整段丢给逐词渲染则标签会被显示成尖括号。
  const segs = useMemo(() => splitInlineTables(text), [text])
  if (segs.some((s) => s.type === "table")) {
    return (
      <>
        {segs.map((s, i) =>
          s.type === "table" ? (
            <SpeakableTable
              key={i}
              html={s.text}
              cellTapMode="word"
              speakingWord={speakingWord}
              onWordClick={onWordSpeak}
            />
          ) : (
            <EnglishWordTap
              key={i}
              text={s.text}
              speakingWord={speakingWord}
              onWordSpeak={onWordSpeak}
              phrases={phrases}
            />
          ),
        )}
      </>
    )
  }
  // markdown 管道表兜底（识别文本里没有 HTML 标签、只有 | a | b | 的情形）
  const tbl = toTableHtml(text)
  if (tbl) {
    return (
      <SpeakableTable
        html={tbl}
        cellTapMode="word"
        speakingWord={speakingWord}
        onWordClick={onWordSpeak}
      />
    )
  }
  return (
    <EnglishWordTap
      text={text}
      speakingWord={speakingWord}
      onWordSpeak={onWordSpeak}
      phrases={phrases}
    />
  )
}

export function AiParseResultPage() {
  const navigate = useNavigate()
  const session = useParseSessionStore((s) => s.session)
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

  // 连读高亮：开启后点正文某个字 → 高亮「该字到句尾」并朗读该段
  const [rangeOn, setRangeOn] = useState(false)
  const [range, setRange] = useState<{ blockIdx: number; start: number; end: number } | null>(null)

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
      const w = word.trim()
      if (!w) return
      addTappedWordbook(w, "recog_english")
      setSpeakingWord(w)
      await speakBlock(w)
      setSpeakingWord(null)
    },
    [speakBlock, addTappedWordbook],
  )

  // 整块一键收词：把块内所有汉字去重后批量加入生词本
  const handleAddBlockWords = useCallback(async (text: string) => {
    const chars = [...new Set([...text].filter((c) => /[一-鿿]/.test(c)))]
    if (!chars.length) {
      showToast("该块没有可收录的汉字")
      return
    }
    const ok = await addWordbookMany(chars, `recog_${module}`)
    showToast(ok ? `已加入 ${chars.length} 个字到生词本` : "加入生词本失败，请重试")
  }, [module, showToast])

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
        ? qs && qs.length
          ? qs.map((q, i) => ({ i, text: (q || "").trim() })).filter((x) => x.text)
          : session.text && session.text.trim() ? [{ i: 0, text: session.text.trim() }] : []
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
   * 连读高亮：以 (blockIdx, ch) 为起点算出「这个字 → 句尾」的范围并朗读该段。
   * 范围坐标用「块内可发音字序号」而非字符下标 —— BlockText 走段落流时会把物理行
   * 并段、补空格，字符下标对不上；按顺序数可发音字两边一致（见 BlockText.paraRange）。
   * 挂在这里（早于下方 `if (!session)` 提前 return）以满足 hooks 调用顺序恒定。
   */
  const pickRangeStart = useCallback(
    async (blockIdx: number, ch: string) => {
      const blk = session?.blocks?.[blockIdx]
      if (!blk) return
      const raw = blk.text
      const pos = raw.indexOf(ch)
      if (pos < 0) return
      // 从该字起找第一个句末标点（含英文句点）
      const m = SENT_END.exec(raw.slice(pos))
      let endIdx = m ? pos + m.index + m[0].length : raw.length
      // 吞掉句末标点后的右引号/右括号（最多两个），让高亮覆盖完整句子
      for (let k = 0; k < 2 && endIdx < raw.length && isSentenceCloser(raw[endIdx]); k++) endIdx++
      const segment = raw.slice(pos, endIdx)
      if (!segment.trim()) return
      const before = [...raw.slice(0, pos)].filter(isSpeakableChar).length
      const inSeg = [...segment].filter(isSpeakableChar).length
      if (inSeg === 0) return
      setRangeOn(true)
      setRange({ blockIdx, start: before, end: before + inSeg })
      void speakBlock(segment)
    },
    [session, speakBlock],
  )

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

  /** 文本段渲染：表格 → 可点读表格；其余 → 逐字。供数学/语文纯文本分支复用。 */
  const renderMixedText = (t: string, tag: string) =>
    splitInlineTables(t).map((seg, si) =>
      seg.type === "table" ? (
        <SpeakableTable key={`t${si}`} html={seg.text} speakingChar={speakingChar} onCharClick={handleCharClick} />
      ) : (
        <span key={`x${si}`}>{renderTapChars(seg.text, tag)}</span>
      ),
    )

  // 可定位区块数：语文=文字块数，数学=题目数（每块/题一个方块）
  const navCount = isChinese ? blocks.length : questions.length
  const jumpToSection = (idx: number) => {
    sectionRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  // 定位方块文案：该块前 5 个字（去掉空白）
  const sectionLabel = (idx: number): string => {
    const raw = isChinese ? blocks[idx]?.text ?? "" : questions[idx] ?? ""
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
    setRangeOn(false)
    setRange(null)
    setHlMap({})
    setRunId((r) => r + 1)
    // 重新识别 = 新结果，清空当前会话问答（QaStore 中按 scope 隔离）
    useQaStore.getState().removeScope(sessionId)
    try {
      const res = await parseImage(f, effModule === "english" ? "chinese" : effModule, noCache)
      useParseSessionStore.getState().setSession({
        sessionId,
        module: effModule,
        text: res.text ?? "",
        questions: res.questions?.length ? res.questions : res.text ? [res.text] : [],
        blocks: res.blocks ?? [],
        pageBounds: res.page_bounds ?? null,
        previewUrl: url,
        file: f,
        crops: res.crops ?? [],
      })
      // 重新识别/旋转后同样后台补齐注音并回填（本页是 store 订阅组件，注音就绪自动重渲染）
      if (effModule === "chinese") schedulePolyPatch(res, "chinese")
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
    // 连读模式：点字 → 高亮「这个字到句尾」并朗读该段（不点读、不加生词本）
    if (rangeOn) {
      const bi = blocks.findIndex((b) => b.text.includes(ch))
      if (bi >= 0) void pickRangeStart(bi, ch)
      return
    }
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
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📄 识别结果</h1>
      </header>
      <p className="module-hint">{isChinese ? "点字听发音 · 整段可评测 · 可标记不认识的字 · 点读自动加生词本" : "点字可听发音 · 识别完自动保存历史回看 · 点读自动加生词本"}</p>

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
          <h2 className="section-title">📷 {isChinese ? "课文" : "题目"}识别</h2>
          <button className="btn-secondary btn-sm" onClick={() => setShowQa(true)}>
            💬 问答记录{qaCount ? `（${qaCount}）` : ""}
          </button>
        </div>
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
              <span className="import-meaning">{blocks.length} 个文字块 · 点字听发音 · 末尾🎤评测</span>
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
                    <SpeakableTable
                      html={b.text}
                      speakingChar={speakingChar}
                      onCharClick={handleCharClick}
                    />
                    {/* 表格块操作条：朗读整表 / 一键收词 / 提问 */}
                    <div className="block-ops">
                      {!marking && (
                        <button
                          className="block-ops-btn block-ops-speak"
                          onClick={() => speakBlock(b.text.replace(/<[^>]+>/g, ""))}
                          title="朗读整表"
                          aria-label="朗读整表"
                        >
                          🔊
                        </button>
                      )}
                      {!marking && (
                        <button
                          className="block-ops-btn block-ops-wordbook"
                          onClick={() => void handleAddBlockWords(b.text)}
                          title="整表汉字加入生词本"
                          aria-label="整表汉字加入生词本"
                        >
                          📥
                        </button>
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
                      range={rangeOn && range?.blockIdx === i ? range : null}
                      hideSpeak
                    />
                    {/* 块底部操作条：喇叭/录音/回放/连读高亮/提问/解析高亮，一行居中图标 */}
                    <div className="block-ops">
                      {!marking && (
                        <button
                          className="block-ops-btn block-ops-speak"
                          onClick={() => speakBlock(b.text)}
                          title="朗读整块"
                          aria-label="朗读整块"
                        >
                          🔊
                        </button>
                      )}
                      {!marking && b.text.trim() && b.type !== "title" && b.type !== "heading" && (
                        <BlockRecorder />
                      )}
                      {!marking && (
                        <button
                          className={`block-ops-btn${rangeOn ? " range-on" : ""}`}
                          onClick={() => {
                            setRangeOn((v) => {
                              if (v) setRange(null)
                              return !v
                            })
                          }}
                          title="连读高亮：开启后点正文里的字，高亮并朗读「这个字到句尾」"
                          aria-label="连读高亮开关"
                        >
                          🖍️
                        </button>
                      )}
                      {!marking && <BlockAsk text={b.text} qaKey={`${sessionId}:block-${i}`} />}
                      {!marking && (
                        <BlockHighlight
                          key={`${runId}-h${i}`}
                          text={b.text}
                          showInline={false}
                          onParsed={(marks) => setHlMap((m) => ({ ...m, [i]: marks }))}
                        />
                      )}
                    </div>
                    {!marking && rangeOn && (
                      <p className="block-mark-hint">点正文里任意一个字：高亮并朗读「这个字到句尾」</p>
                    )}
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
                    <div className="import-text tap-char">{renderMixedText(q, "recog_chinese")}</div>
                  </div>
                </div>
                <BlockAsk text={q} qaKey={`${sessionId}:q-${i}`} />
                <BlockHighlight key={`${runId}-qh${i}`} text={q} />
              </div>
            ))}
          </div>
        )}

        {!isChinese && questions.length > 0 && (
          <div className="ai-recog-questions">
            <p className="import-meaning">
              识别到 {questions.length} 道题，一题一个块（点字可听发音）：
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
            {questions.map((q, i) => (
              <div key={i} ref={(el) => { sectionRefs.current[i] = el }} className="ai-question-block">
                <div className="ai-question-block-head">
                  <span className="ai-question-index">📝 第 {i + 1} 题</span>
                </div>
                {isEnglish ? (
                  <EnglishResult
                    text={q}
                    speakingWord={speakingWord}
                    onWordSpeak={speakEnglishWord}
                    posTags={posOn ? (posMap[i] ?? []) : []}
                    storyTags={storyOn ? (storyMap[i] ?? []) : []}
                  />
                ) : (
                  <div className="ai-question-block-text tap-char">{renderMixedText(q, "recog_math")}</div>
                )}
                <div className="block-ops">
                  <button
                    className="block-ops-btn block-ops-speak"
                    onClick={() => speakBlock(q)}
                    title="朗读整块"
                    aria-label="朗读整块"
                  >
                    🔊
                  </button>
                  <button
                    className="block-ops-btn block-ops-wordbook"
                    onClick={() => void handleAddBlockWords(q)}
                    title="整块汉字加入生词本"
                    aria-label="整块汉字加入生词本"
                  >
                    📥
                  </button>
                  <BlockAsk text={q} qaKey={`${sessionId}:q-${i}`} />
                  <BlockHighlight key={`${runId}-qh${i}`} text={q} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isChinese && !questions.length && text.trim() && (
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
              <div className="ai-question-block-text tap-char">{renderMixedText(text, "recog_math")}</div>
            )}
            <BlockAsk text={text} qaKey={`${sessionId}:text`} />
            <BlockHighlight key={`${runId}-texth`} text={text} />
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
          moduleLabel={isChinese ? "语文" : "数学"}
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
