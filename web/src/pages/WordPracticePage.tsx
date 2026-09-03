/** 词语练习页 — TTS 朗读（词语+例句），学生跟读后标记 ✓/✗ */

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { queryWords, queryWordsByGrades, queryWordsByTexts, type WordBankEntry } from "../services/wordbank"
import { useTts } from "../hooks/useTts"
import { useFeatureGrades } from "../hooks/useTrainingConfig"
import { loadDailyZhSynced } from "../services/dailyZh"
import { fetchPracticeRecords, recordTotalCount } from "../services/practice"
import { api } from "../services/api"
import { useSoeScore } from "../hooks/useSoeScore"
import { ensureGenerated } from "../services/generatedDict"

const REPEAT_TIMES = 2
const WORD_SENTENCE_GAP = 1000
const NEXT_DELAY_MS = 10000

interface WordItem {
  entry: WordBankEntry
  sentence: string
  isCorrect: boolean | null
}

export function WordPracticePage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<WordItem[]>([])
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState("init")
  const [repeatCount, setRepeatCount] = useState(1)
  const [currentWord, setCurrentWord] = useState("")
  const [currentSentence, setCurrentSentence] = useState("")
  const [reviewPhase, setReviewPhase] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [started, setStarted] = useState(false)
  // 每词练习次数（核对页展示）
  const [countByChar, setCountByChar] = useState<Record<string, number>>({})
  // 今日练词列表（家长设置，点选可直接练对应词，不按固定顺序）
  const [todayWords, setTodayWords] = useState<string[]>([])
  // 今日词选词页：有今日配置时先展示宫格选词，点击某词才进入练习
  const [pickOpen, setPickOpen] = useState(true)
  // 朗读循环运行令牌：返回选词页/切换词时自增，旧循环在下一题推进前会因令牌不符退出
  const runTokenRef = useRef(0)

  const { speaking, speak } = useTts()
  // 家长配置的年级批次（空=全部）
  const grades = useFeatureGrades("word_practice")
  // 生成词朗读打分（SOE 评测）：读一遍该词 → 评分反馈
  const wordSoe = useSoeScore(
    useCallback(() => ({ refText: currentWord, scene: "word" }), [currentWord]),
  )
  const onWordSoeScore = async (score: number) => {
    setMessage(`读词得分: ${score}（需 70 分以上）`)
  }
  const toggleWordSoe = async () => {
    if (wordSoe.state.recording) {
      const s = await wordSoe.stop()
      if (s !== null) await onWordSoeScore(s)
      return
    }
    if (wordSoe.state.evaluating) return
    setMessage("录音中...")
    await wordSoe.start()
  }

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  const loadQuiz = async () => {
    setLoading(true)
    setMessage("加载题目...")
    try {
      // 每日一练指定了今日词 → 优先按手打列表过滤（词库命中才练）；否则按年级/全部
      // loadDailyZhSynced：已登录走服务端（跨设备同步），失败退本地镜像
      const dailyTexts = (await loadDailyZhSynced())
        .words.split(/[,，、;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean)
      setTodayWords(dailyTexts)
      let all: WordBankEntry[] = []
      let dailyNote = ""
      // 词库没有、改由大模型生成的词 → 例句。须声明在分支外：
      // 下方 selected.map 属共用路径也要读它，非每日一练时为空映射（取 ?? ""）。
      const genSentenceMap: Record<string, string> = {}
      if (dailyTexts.length > 0) {
        const hits = await queryWordsByTexts(dailyTexts)
        const hitSet = new Set(hits.map((e) => e.text))
        const misses = dailyTexts.filter((t) => !hitSet.has(t))
        if (misses.length > 0) {
          // 词库没有的词 → 调大模型生成 1 个句子（缓存复用）
          const gen = await ensureGenerated(misses.map((t) => ({ type: "word", text: t })))
          for (const g of gen) genSentenceMap[g.text] = g.sentence
        }
        const genEntries: WordBankEntry[] = misses.map((t) => ({
          text: t,
          pinyin: "",
          tags: ["词语"],
          type: "word",
          ipa: "",
          ipa_uk: "",
          letter: "",
          phonemes: [],
          phonemes_uk: [],
          emoji: "",
          difficulty: 0,
          translation: "",
        }))
        all = [...hits, ...genEntries]
        dailyNote = `今日练词：${dailyTexts.join("、")}`
        if (all.length === 0) {
          setMessage(`词语库中没有这些词，请检查每日设置：${dailyTexts.join("、")}`)
          setLoading(false)
          return
        }
      } else {
        all = grades.length > 0 ? await queryWordsByGrades(grades) : await queryWords("词语")
      }
      if (all.length === 0) {
        setMessage(grades.length > 0 ? "所选年级暂无词语，请家长调整范围" : "词语库为空")
        setLoading(false)
        return
      }
      if (dailyNote) setMessage(dailyNote)
      const selected = [...all].sort(() => Math.random() - 0.5)

      const words: WordItem[] = selected.map((entry) => ({
        entry,
        sentence: genSentenceMap[entry.text] ?? "",
        isCorrect: null,
      }))
      // 首屏只生成前 5 个词的例句（服务端缓存命中则秒回；未命中调 LLM），
      // 其余词懒生成（进入该题时 ensureSentence 补齐），避免首屏等全部 20 个。
      // 已带生成句子的词（词库没有、刚大模型生成）跳过，不重复生成。
      const firstBatch = words.slice(0, 5)
      await Promise.allSettled(
        firstBatch.map(async (item) => {
          if (item.sentence) return
          try {
            const res = await api<{ sentence: string }>("/llm/sentence-generate", {
              method: "POST",
              body: { word: item.entry.text },
              auth: false,
              timeoutMs: 8000,
            })
            if (res.sentence) item.sentence = res.sentence
          } catch {
            /* 忽略，用默认句 */
          }
        }),
      )
      for (const item of words) {
        if (!item.sentence) item.sentence = `请写出词语: ${item.entry.text}`
      }

      setItems(words)
      setLoading(false)
      // 不自动朗读：等用户点「开始朗读」（autoplay 策略需用户手势解锁）
    } catch (e) {
      setMessage(`加载失败: ${String((e as Error)?.message ?? e)}`)
      setLoading(false)
    }
  }

  /** 懒生成指定题的例句（未生成时调 LLM 补齐），返回最终句子 */
  const ensureSentence = async (idx: number): Promise<string> => {
    const item = items[idx]
    if (!item) return ""
    if (item.sentence && !item.sentence.startsWith("请写出词语")) return item.sentence
    try {
      const res = await api<{ sentence: string }>("/llm/sentence-generate", {
        method: "POST",
        body: { word: item.entry.text },
        auth: false,
        timeoutMs: 8000,
      })
      if (res.sentence) {
        const sentence = res.sentence
        setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, sentence } : it)))
        return sentence
      }
    } catch {
      /* 保留默认句 */
    }
    return item.sentence || `请写出词语: ${item.entry.text}`
  }

  const startReading = async (idx: number, word: string, sentence: string, pinyin: string, token: number) => {
    for (let round = 1; round <= REPEAT_TIMES; round++) {
      if (token !== runTokenRef.current) return
      setRepeatCount(round)
      setPhase("reading_word")
      setMessage(`🔊 ${word.split("").map(() => "█").join("")}（第${round}遍）`)
      await speak(word, { pinyin })
      await sleep(1500)

      if (token !== runTokenRef.current) return
      setPhase("reading_sentence")
      setMessage(`📖 ${maskWordInSentence(sentence, word)}`)
      await speak(sentence)
      await sleep(3000)
    }
    if (token !== runTokenRef.current) return
    setPhase("waiting")
    setMessage("请写出词语，即将进入下一题...")
    await speak("请写出词语，10秒后进入下一题")
    await sleep(NEXT_DELAY_MS)
    nextWord(idx + 1, items, token)
  }

  const nextWord = async (idx: number, list: WordItem[], token: number) => {
    if (token !== runTokenRef.current) return
    if (idx >= list.length) {
      setReviewPhase(true)
      setMessage("请逐题确认 ✓/✗")
      return
    }
    setIndex(idx)
    setPhase("init")
    setRepeatCount(1)
    // 懒生成该题例句（若首屏未生成），拿到最终句子
    const sentence = await ensureSentence(idx)
    const item = items[idx]
    const word = item?.entry.text ?? ""
    setCurrentWord(word)
    setCurrentSentence(sentence)
    await startReading(idx, word, sentence, item?.entry.pinyin ?? "", token)
  }

  /** 用户点击「开始朗读」→ 解锁 autoplay 后启动循环 */
  const startPractice = () => {
    setStarted(true)
    setMessage("")
    runTokenRef.current++
    void nextWord(0, items, runTokenRef.current)
  }

  // grades（家长配置）变化或首次进入 → 重新加载题目
  const loadedGradesRef = useRef<string | null>(null)
  useEffect(() => {
    const key = grades.join(",")
    if (loadedGradesRef.current === key) return
    loadedGradesRef.current = key
    void loadQuiz()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grades])

  // reviewPhase（进入核对页）→ 加载每个词的练习次数
  useEffect(() => {
    if (!reviewPhase || items.length === 0) return
    void (async () => {
      try {
        const recs = await fetchPracticeRecords(items.map((it) => it.entry.text))
        const map: Record<string, number> = {}
        for (const r of recs) map[r.char] = recordTotalCount(r)
        setCountByChar(map)
      } catch {
        /* 忽略 */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewPhase])

  const reRead = async () => {
    await speak(currentWord, { pinyin: items[index]?.entry.pinyin ?? "" })
    await sleep(1500)
    await sleep(WORD_SENTENCE_GAP)
    await speak(currentSentence)
  }

  const markItem = (idx: number, correct: boolean) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, isCorrect: correct } : it)))
    // 上报逐字练习记录（供练习页展示练过几次）
    const item = items[idx]
    if (item) {
      void api("/practice/char-record", {
        method: "POST",
        body: { char: item.entry.text, correct, type: "pronunciation" },
      }).catch(() => {})
    }
  }

  const submitResults = async () => {
    if (submitted) return
    setLoading(true)
    setMessage("提交记录...")
    const correctCount = items.filter((it) => it.isCorrect).length
    const records = items.map((it) => ({
      char: it.entry.text,
      module: "word",
      attempt_count: 1,
      first_try_correct: it.isCorrect === true,
      hint_used: false,
      correct: it.isCorrect === true,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
    }))
    try {
      await api("/practice/submit", {
        method: "POST",
        body: { module: "word", records, total_score: correctCount, max_score: items.length },
      })
      setSubmitted(true)
      setMessage("记录已保存")
    } catch {
      setMessage("提交失败（可稍后重试）")
    } finally {
      setLoading(false)
    }
  }

  if (loading && items.length === 0) {
    return (
      <div className="page center-page">
        <p className="empty">加载题目…</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="page center-card">
        <p className="empty">{message || "词语库为空"}</p>
      </div>
    )
  }

  if (reviewPhase) {
    const correctCount = items.filter((it) => it.isCorrect).length
    return (
      <div className="page review-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>词语核对</h1>
        </header>
        <p className="module-hint">逐词确认写对了吗？✓ 或 ✗</p>

        <div className="review-list">
          {items.map((it, i) => (
            <div key={it.entry.text + i} className="review-row">
              <span className="review-char">{it.entry.text}</span>
              <span className="review-word">
                {it.sentence}
                {countByChar[it.entry.text] ? (
                  <span className="review-count">已练 {countByChar[it.entry.text]} 次</span>
                ) : null}
              </span>
              <div className="review-btns">
                <button
                  className={`mark-btn ok${it.isCorrect === true ? " active" : ""}`}
                  onClick={() => markItem(i, true)}
                >
                  ✓
                </button>
                <button
                  className={`mark-btn no${it.isCorrect === false ? " active" : ""}`}
                  onClick={() => markItem(i, false)}
                >
                  ✗
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="nav-row" style={{ marginTop: 16 }}>
          <span className="section-hint">答对 {correctCount}/{items.length}</span>
          <button className="btn-primary" onClick={submitResults} disabled={loading || submitted}>
            {submitted ? "已提交" : loading ? "提交中…" : "提交结果"}
          </button>
        </div>
        {message && <p className="msg">{message}</p>}
      </div>
    )
  }

  // 今日词选词页：不直接进入某个词的练习，点击某词才开始练
  if (pickOpen && todayWords.length > 0) {
    return (
      <div className="page word-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>词语练习</h1>
          <span className="module-level">今日 {todayWords.length} 词</span>
        </header>
        <p className="module-hint">点选要练的词👇</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "8px 6px" }}>
          {todayWords.map((t, i) => {
            const idx = items.findIndex((it) => it.entry.text === t)
            const hit = idx >= 0
            return (
              <button key={`${t}-${i}`} disabled={!hit}
                onClick={() => { runTokenRef.current++; setStarted(true); setPickOpen(false); void nextWord(idx, items, runTokenRef.current) }}
                title={hit ? `练「${t}」` : "词语库未命中该词"}
                style={{
                  width: 88, minHeight: 48, fontSize: 18, lineHeight: 1.2, borderRadius: 14,
                  cursor: hit ? "pointer" : "not-allowed",
                  border: `2px solid ${hit ? "#93c5fd" : "#e2e8f0"}`,
                  background: hit ? "#eff6ff" : "#f8fafc",
                  color: hit ? "#1e3a8a" : "#cbd5e1",
                  boxShadow: hit ? "0 2px 6px rgba(59,130,246,.15)" : "none",
                } as React.CSSProperties}>{t}</button>
            )
          })}
        </div>
        {todayWords.some((t) => !items.some((it) => it.entry.text === t)) && (
          <p style={{ fontSize: 11, color: "#94a3b8", padding: "0 6px" }}>
            置灰的词不在词语库中，无法练习（可在每日设置里调整）
          </p>
        )}
      </div>
    )
  }

  if (!started) {
    return (
      <div className="page word-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>词语练习</h1>
        </header>
        <p className="module-hint">共 {items.length} 个词语。先听词语，再听例句，然后跟读默写。</p>
        <div className="card center-card">
          <div style={{ fontSize: 40 }}>📚</div>
          <p style={{ fontWeight: 700, margin: "8px 0 4px" }}>准备好了吗？</p>
          <p style={{ color: "#6b7280", fontSize: 13 }}>点击开始，听词语和例句</p>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={startPractice}>
            ▶ 开始朗读
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page word-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>词语练习</h1>
        {todayWords.length > 0 ? (
          <button className="btn-secondary btn-sm" onClick={() => { runTokenRef.current++; setStarted(false); setPickOpen(true) }} title="返回选词">☰ 选词</button>
        ) : (
          <span className="module-level">第 {index + 1}/{items.length} 词</span>
        )}
      </header>
      <p className="module-hint">
        先听词语，再听例句，然后跟读并默写。
        {phase === "waiting" && <><br />写好后等待进入下一题，或点「重读」再听</>}
      </p>

      {/* 今日练词点选条：点谁直接练谁，不按固定顺序（朗读中禁用，避免声音重叠） */}
      {todayWords.length > 0 && !reviewPhase && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "0 4px 10px" }}>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>今日练词（点选直接练）：</span>
          {todayWords.map((t, i) => {
            const idx = items.findIndex((it) => it.entry.text === t)
            const active = idx === index
            const busyPhase = phase === "reading_word" || phase === "reading_sentence"
            return (
              <button key={`${t}-${i}`} disabled={idx < 0 || busyPhase}
                onClick={() => { if (idx >= 0) { runTokenRef.current++; setStarted(true); void nextWord(idx, items, runTokenRef.current) } }}
                title={idx < 0 ? "词语库未命中该词" : `跳到「${t}」`}
                style={{
                  padding: "4px 10px", fontSize: 13,
                  borderRadius: 8, cursor: idx < 0 || busyPhase ? "not-allowed" : "pointer",
                  border: `1.5px solid ${active ? "#3b82f6" : "#e2e8f0"}`,
                  background: active ? "#dbeafe" : "#fff",
                  color: idx < 0 ? "#cbd5e1" : active ? "#1d4ed8" : "#334155",
                  fontWeight: active ? 700 : 400,
                } as React.CSSProperties}>{t}</button>
            )
          })}
        </div>
      )}

      <div className="dictation-card card">
        <div className="dictation-char-mask">
          {currentWord.split("").map((_, i) => (
            <span key={i} className="mask-block">█</span>
          ))}
        </div>
        <div className="dictation-status">
          {phase === "reading_word" && <span>🔊 读词语（第 {repeatCount} 遍）</span>}
          {phase === "reading_sentence" && <span>📖 读例句</span>}
          {phase === "waiting" && <span>⏳ 即将进入下一题…</span>}
        </div>
        <div className="word-sentence">「{maskWordInSentence(currentSentence, currentWord)}」</div>
        {message && <p className="msg">{message}</p>}
      </div>

      <div className="nav-row">
        <button className="btn-secondary" disabled={speaking} onClick={reRead}>
          🔊 重读
        </button>
        <button
          className="btn-secondary"
          disabled={wordSoe.state.evaluating || wordSoe.state.recording}
          onClick={() => void toggleWordSoe()}
        >
          {wordSoe.state.recording ? "⏹ 停止" : wordSoe.state.evaluating ? "评分中…" : "🎤 读词打分"}
        </button>
        {wordSoe.state.score != null && (
          <span className="recog-eval-score">读词 {wordSoe.state.score}分（需70）</span>
        )}
      </div>
    </div>
  )
}

/** 把句子中第一次出现的目标词语替换为等长 █ 掩码（听句猜词） */
function maskWordInSentence(sentence: string, word: string): string {
  if (!sentence || !word) return sentence
  const idx = sentence.indexOf(word)
  if (idx < 0) return sentence
  const mask = word.split("").map(() => "█").join("")
  return sentence.slice(0, idx) + mask + sentence.slice(idx + word.length)
}
