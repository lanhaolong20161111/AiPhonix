/** 识别结果页 — 图片识别完成后独立展示（语文：排版块逐字点读/块级评测/标记不认识字；数学：题目列表逐字点读）
 *
 * 数据来自 parseSessionStore（输入页识别成功后写入，跳转过来）。刷新会丢会话，引导返回重新识别。
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useParseSessionStore } from "../stores/parseSessionStore"
import { useQaStore, scopeQa } from "../stores/qaStore"
import { parseImage } from "../services/aiImage"
import { rotateBlob90 } from "../lib/imageOrientation"
import { schedulePolyPatch } from "../lib/polyPatch"
import { addHistory, makeThumb } from "../lib/aiHistory"
import { isSpeakableChar } from "../lib/chars"
import { BlockText, BlockMic } from "../components/BlockText"
import { BlockAsk } from "../components/BlockAsk"
import { BlockHighlight } from "../components/BlockHighlight"
import { QaHistoryModal } from "../components/QaHistoryModal"
import type { HighlightMarkItem } from "../services/aichinese"
import { useBlockSpeaking } from "../hooks/useBlockSpeaking"
import { markUnknownChars, recordCharClick } from "../services/aichinese"
import { askLlm } from "../services/aiAsk"
import { detailFromError } from "../services/auth"
import { addWordbook, addWordbookMany } from "../services/wordbook"
import { SpeakableTable } from "../components/SpeakableTable"
import { useCharLongPressFactory } from "../hooks/useCharLongPress"

/** 英语逐词点读：按空白切词，点击单词内任意字母朗读整个单词（而非单字母）。
 * 视觉仍逐字母渲染以保留"点某个字母"的手感；高亮以整个单词为单位。 */
type WordLpHandlers = Record<
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerLeave" | "onPointerCancel",
  (e: React.PointerEvent<HTMLElement>) => void
>
function EnglishWordTap({
  text,
  speakingWord,
  onWordSpeak,
  lpHandlersFor,
}: {
  text: string
  speakingWord: string | null
  onWordSpeak: (word: string) => void
  lpHandlersFor: (word: string) => WordLpHandlers
}) {
  const segs = useMemo(() => text.match(/\s+|\S+/g) ?? [], [text])
  return (
    <span className="tap-char">
      {segs.map((seg, si) => {
        if (/^\s+$/.test(seg)) {
          return (
            <span key={si} className="tap-char-space">
              {seg.includes("\n")
                ? seg.split("").map((c, i) => (c === "\n" ? <br key={i} /> : c))
                : seg}
            </span>
          )
        }
        const word = seg
        const speaking = speakingWord === word
        return (
          <span key={si} className={`tap-char-word${speaking ? " word-speaking" : ""}`}>
            {[...word].map((ch, ci) => (
              <span
                key={ci}
                className={`tap-char-item${speaking ? " playing" : ""}`}
                {...lpHandlersFor(word)}
                onClick={() => onWordSpeak(word)}
              >
                {ch}
              </span>
            ))}
          </span>
        )
      })}
    </span>
  )
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

/** 英语结果内容：表格 → 画成真正的表格方框，且按整词/整格朗读（SpeakableTable word 模式）；
 * 否则 → 逐词点读（EnglishWordTap）。 */
function EnglishResult({
  text,
  speakingWord,
  onWordSpeak,
  lpHandlersFor,
  onWordLongPress,
}: {
  text: string
  speakingWord: string | null
  onWordSpeak: (word: string) => void
  lpHandlersFor: (word: string) => WordLpHandlers
  onWordLongPress: (word: string) => void
}) {
  const tbl = toTableHtml(text)
  if (tbl) {
    return (
      <SpeakableTable
        html={tbl}
        cellTapMode="word"
        speakingWord={speakingWord}
        onWordClick={onWordSpeak}
        onWordLongPress={onWordLongPress}
      />
    )
  }
  return (
    <EnglishWordTap
      text={text}
      speakingWord={speakingWord}
      onWordSpeak={onWordSpeak}
      lpHandlersFor={lpHandlersFor}
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

  // 语文各块的高亮（解析后叠加到正文渲染）
  const [hlMap, setHlMap] = useState<Record<number, HighlightMarkItem[]>>({})

  // 识别批次号：重新识别/旋转时 +1，强制高亮组件重挂载清空旧状态
  const [runId, setRunId] = useState(0)

  // 全部问答记录浮窗
  const [showQa, setShowQa] = useState(false)
  // 区域裁剪图放大预览
  const [previewCrop, setPreviewCrop] = useState<string | null>(null)
  // 侧边定位条折叠（隐藏全部标签，只留细线，不挡内容）
  const [railCollapsed, setRailCollapsed] = useState(false)

  const qaAll = useQaStore((s) => s.qa)

  // 长按字加生词本（toast 反馈）
  const [wbToast, setWbToast] = useState<string | null>(null)
  const wbToastTimer = useRef<number | null>(null)
  const showToast = (msg: string) => {
    setWbToast(msg)
    if (wbToastTimer.current) window.clearTimeout(wbToastTimer.current)
    wbToastTimer.current = window.setTimeout(() => setWbToast(null), 1800)
  }
  const handleCharLongPress = useCallback((ch: string) => {
    if (!isSpeakableChar(ch)) return
    void addWordbook(ch, "", `recog_${module}`).then((ok) => {
      showToast(ok ? `「${ch}」已加入生词本` : "加入生词本失败，请重试")
    })
  }, [module, showToast])

  // 修复版长按手势（pointer capture + 移动阈值，不再被手指微动误杀）
  const makeLpHandlers = useCharLongPressFactory(handleCharLongPress)

  // ── 英语逐词点读：点击单词内任意字母 → 朗读整个单词（而非单字母）──
  // 整词朗读时高亮单位也是一个单词（不是字母）；长按整词加入生词本。
  const [speakingWord, setSpeakingWord] = useState<string | null>(null)
  const isEnglish = effModule === "english"
  const speakEnglishWord = useCallback(
    async (word: string) => {
      const w = word.trim()
      if (!w) return
      setSpeakingWord(w)
      await speakBlock(w)
      setSpeakingWord(null)
    },
    [speakBlock],
  )
  const handleEnglishWordLongPress = useCallback(
    (word: string) => {
      const w = word.trim()
      if (!w) return
      void addWordbook(w, "", `recog_english`).then((ok) =>
        showToast(ok ? `「${w}」已加入生词本` : "加入生词本失败，请重试"),
      )
    },
    [showToast],
  )
  const makeLpWordHandlers = useCharLongPressFactory(handleEnglishWordLongPress)

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
        addHistory({
          module,
          text: t,
          questions,
          blocks,
          pageBounds: session.pageBounds,
          thumb,
          qa: scopeQa(sessionId, useQaStore.getState().qa),
        })
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

  // 长按单字加生词本：用修复版 hook（pointer capture + 移动阈值）
  const lpProps = (ch: string) => {
    if (!isSpeakableChar(ch)) return {}
    return makeLpHandlers(ch)
  }

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📄 识别结果</h1>
      </header>
      <p className="module-hint">{isChinese ? "点字听发音 · 整段可评测 · 可标记不认识的字 · 长按字加生词本" : "点字可听发音 · 识别完自动保存历史回看 · 长按字加生词本"}</p>

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
                      onCharLongPress={handleCharLongPress}
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
                      onSpeakPhrase={(p) => void speakBlock(p)}
                      onCharClick={handleCharClick}
                      onCharLongPress={handleCharLongPress}
                      onSpeakBlock={(t) => speakBlock(t)}
                      hideSpeak
                    />
                    {/* 块底部操作条：喇叭/收词/麦克风/提问/解析高亮，一行居中图标 */}
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
                      {!marking && (
                        <button
                          className="block-ops-btn block-ops-wordbook"
                          onClick={() => void handleAddBlockWords(b.text)}
                          title="整块汉字加入生词本"
                          aria-label="整块汉字加入生词本"
                        >
                          📥
                        </button>
                      )}
                      {!marking && b.text.trim() && b.type !== "title" && b.type !== "heading" && (
                        <BlockMic text={b.text} />
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
                    <div className="import-text tap-char">
                      {[...q].map((ch, ci) =>
                        ch === "\n" || ch === " " || !isSpeakableChar(ch) ? (
                          <span key={ci} className="tap-char-space">
                            {ch === "\n" ? <br /> : ch}
                          </span>
                        ) : (
                          <span
                            key={ci}
                            className={`tap-char-item${speakingChar === ch ? " playing" : ""}`}
                            {...lpProps(ch)}
                            onClick={() => {
                              void speakChar(ch, {})
                              void recordCharClick([ch])
                            }}
                          >
                            {ch}
                          </span>
                        ),
                      )}
                    </div>
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
            <p className="import-meaning">识别到 {questions.length} 道题，一题一个块（点字可听发音）：</p>
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
                    lpHandlersFor={makeLpWordHandlers}
                    onWordLongPress={handleEnglishWordLongPress}
                  />
                ) : (
                  <div className="ai-question-block-text tap-char">
                    {[...q].map((ch, ci) =>
                      ch === "\n" || ch === " " || !isSpeakableChar(ch) ? (
                        <span key={ci} className="tap-char-space">
                          {ch === "\n" ? <br /> : ch}
                        </span>
                      ) : (
                        <span
                          key={ci}
                          className={`tap-char-item${speakingChar === ch ? " playing" : ""}`}
                          {...lpProps(ch)}
                          onClick={() => {
                            void speakChar(ch, {})
                            void recordCharClick([ch])
                          }}
                        >
                          {ch}
                        </span>
                      ),
                    )}
                  </div>
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
            {isEnglish ? (
              <EnglishResult
                text={text}
                speakingWord={speakingWord}
                onWordSpeak={speakEnglishWord}
                lpHandlersFor={makeLpWordHandlers}
                onWordLongPress={handleEnglishWordLongPress}
              />
            ) : (
              <div className="ai-question-block-text tap-char">
                {[...text].map((ch, ci) =>
                  ch === "\n" || ch === " " || !isSpeakableChar(ch) ? (
                    <span key={ci} className="tap-char-space">
                      {ch === "\n" ? <br /> : ch}
                    </span>
                  ) : (
                    <span
                      key={ci}
                      className={`tap-char-item${speakingChar === ch ? " playing" : ""}`}
                      onClick={() => {
                        void speakChar(ch, {})
                        void recordCharClick([ch])
                      }}
                    >
                      {ch}
                    </span>
                  ),
                )}
              </div>
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
