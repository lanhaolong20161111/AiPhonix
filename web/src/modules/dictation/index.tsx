/** 默写练习页 — TTS 朗读（字+词），学生纸笔默写后逐题标记 ✓/✗ */

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { queryChars, queryCharsByGrades, queryWords, type WordBankEntry } from "../../services/wordbank"
import { useTts } from "../../hooks/useTts"
import { useFeatureGrades } from "../../hooks/useTrainingConfig"
import { fetchPracticeRecords, recordTotalCount } from "../../services/practice"
import { audioManager } from "../../lib/audioManager"
import { api } from "../../services/api"

const READ_TIMES = 2
const WORD_GAP_MS = 2000
const NEXT_DELAY_MS = 10000

interface DictationItem {
  entry: WordBankEntry
  word1: string
  word2: string
  isCorrect: boolean | null
}

interface PolyInfo {
  primary: string
  words: Record<string, string[]>
}

export function DictationPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<DictationItem[]>([])
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState("init")
  const [repeatCount, setRepeatCount] = useState(1)
  const [reviewPhase, setReviewPhase] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [started, setStarted] = useState(false)
  // 每字练习次数（核对页展示）
  const [countByChar, setCountByChar] = useState<Record<string, number>>({})

  const { speaking, speak } = useTts()
  // 家长配置的年级批次（空=全部）
  const grades = useFeatureGrades("dictation")

  // 朗读循环版本号：每次 startReading 递增；旧循环在每个 await 点检查
  // cycleRef.current !== myCycle 则立即退出（用于「提前下一题」和组件卸载中断）
  const cycleRef = useRef(0)
  // 挂载 → 重置 cycleRef（StrictMode 双挂载下 useRef 保留旧值，
  // 第一次 unmount 置 -1 后 remount 仍是 -1，startReading 会永久退出）
  // 卸载 → 使旧循环失效并中断音频（防切页后继续朗读/空转）
  useEffect(() => {
    cycleRef.current = 0
    return () => {
      cycleRef.current = -1
      audioManager.stop()
    }
  }, [])

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  const loadQuiz = async () => {
    setLoading(true)
    setMessage("加载题目...")
    try {
      // 多音字
      let poly: Record<string, PolyInfo> = {}
      try {
        const res = await api<{ chars: Record<string, { primary?: string; words?: Record<string, string[]> }> }>("/chinese/polyphone", {
          auth: false,
        })
        poly = Object.fromEntries(
          Object.entries(res.chars ?? {}).map(([k, v]) => [k, { primary: v.primary ?? "", words: v.words ?? {} }]),
        )
      } catch {
        /* 忽略 */
      }

      const all = grades.length > 0 ? await queryCharsByGrades(grades) : await queryChars("写字")
      if (all.length === 0) {
        setMessage(grades.length > 0 ? "所选年级暂无写字字，请家长调整范围" : "字库中没有写字类汉字")
        setLoading(false)
        return
      }
      const selected = [...all].sort(() => Math.random() - 0.5)

      // 每个字找 2 个词
      const allWords = await queryWords("词语")
      const dict: DictationItem[] = selected.map((entry) => {
        const [w1, w2] = getTwoWords(entry.text, poly, allWords)
        return { entry, word1: w1, word2: w2, isCorrect: null }
      })

      setItems(dict)
      setLoading(false)
      // 不自动朗读：等用户点「开始朗读」（autoplay 策略需用户手势解锁）
    } catch (e) {
      setMessage(`加载失败: ${String((e as Error)?.message ?? e)}`)
      setLoading(false)
    }
  }

  /** 用户点击「开始朗读」→ 解锁 autoplay 后启动循环 */
  const startPractice = () => {
    setStarted(true)
    setMessage("")
    void startReading(0, items)
  }

  const startReading = async (idx: number, list: DictationItem[]) => {
    if (cycleRef.current < 0) return // 组件已卸载
    const myCycle = ++cycleRef.current
    if (idx >= list.length) {
      setReviewPhase(true)
      setMessage("请逐字确认 ✓/✗")
      return
    }
    setIndex(idx)
    setPhase("init")
    const item = list[idx]
    const char = item.entry.text

    for (let round = 1; round <= READ_TIMES; round++) {
      if (cycleRef.current !== myCycle) return // 被「提前下一题」/卸载中断
      setRepeatCount(round)
      setPhase("reading_char")
      setMessage(`🔊 ${char.split("").map(() => "█").join("")}（第${round}遍）`)
      await speak(char, { pinyin: item.entry.pinyin })
      if (cycleRef.current !== myCycle) return
      await sleep(1500)
      if (cycleRef.current !== myCycle) return

      if (item.word1) {
        setPhase("reading_word1")
        setMessage(`📝 听词语: ${item.word1.split("").map(() => "█").join("")}`)
        await speak(item.word1)
        if (cycleRef.current !== myCycle) return
        await sleep(WORD_GAP_MS)
        if (cycleRef.current !== myCycle) return
      }

      if (item.word2) {
        setPhase("reading_word2")
        setMessage(`📝 听词语: ${item.word2.split("").map(() => "█").join("")}`)
        await speak(item.word2)
        if (cycleRef.current !== myCycle) return
        await sleep(2000)
        if (cycleRef.current !== myCycle) return
      }
      await sleep(1000)
      if (cycleRef.current !== myCycle) return
    }

    if (cycleRef.current !== myCycle) return
    setPhase("waiting")
    setMessage("请在纸上写下来，即将进入下一题...")
    await speak("请在纸上写下来，10秒后进入下一题")
    if (cycleRef.current !== myCycle) return
    await sleep(NEXT_DELAY_MS)
    if (cycleRef.current !== myCycle) return
    startReading(idx + 1, list)
  }

  // reviewPhase（进入核对页）→ 加载每个字的练习次数
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
  const loadedGradesRef = useRef<string | null>(null)
  useEffect(() => {
    const key = grades.join(",")
    if (loadedGradesRef.current === key) return
    loadedGradesRef.current = key
    void loadQuiz()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grades])

  const reRead = async () => {
    const item = items[index]
    if (!item) return
    await speak(item.entry.text, { pinyin: item.entry.pinyin })
    await sleep(500)
    if (item.word1) await speak(item.word1)
    await sleep(WORD_GAP_MS)
    if (item.word2) await speak(item.word2)
  }

  /** 提前下一题：中断当前发音并跳到下一题 */
  const nextChar = () => {
    // 立即中断正在播放的音频（旧循环在下一个 await 点检测 cycleRef 变化后退出）
    audioManager.stop()
    setMessage("")
    void startReading(index + 1, items)
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
      module: "dictation",
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
        body: { module: "dictation", records, total_score: correctCount, max_score: items.length },
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
        <p className="empty">{message || "字库为空"}</p>
      </div>
    )
  }

  if (reviewPhase) {
    const correctCount = items.filter((it) => it.isCorrect).length
    return (
      <div className="page review-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>默写核对</h1>
        </header>
        <p className="module-hint">对照纸上的默写，逐字标记 ✓ 或 ✗</p>

        <div className="review-list">
          {items.map((it, i) => (
            <div key={it.entry.text + i} className="review-row">
              <span className="review-char">{it.entry.text}</span>
              <span className="review-word">
                {it.word1} {it.word2 !== it.word1 ? it.word2 : ""}
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

  if (!started) {
    return (
      <div className="page dictation-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>默写练习</h1>
        </header>
        <p className="module-hint">共 {items.length} 个字。听音默写，每字读 2 遍（字 + 组词）。</p>
        <div className="card center-card">
          <div style={{ fontSize: 40 }}>✏️</div>
          <p style={{ fontWeight: 700, margin: "8px 0 4px" }}>准备好了吗？</p>
          <p style={{ color: "#6b7280", fontSize: 13 }}>点击开始，准备纸和笔听写</p>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={startPractice}>
            ▶ 开始朗读
          </button>
        </div>
      </div>
    )
  }

  const item = items[index]
  return (
    <div className="page dictation-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>默写练习</h1>
        <span className="module-level">第 {index + 1}/{items.length} 字</span>
      </header>
      <p className="module-hint">
        听音默写。每字读 2 遍：字 + 组词，请写下来。
        {phase === "waiting" && <br />}
        {phase === "waiting" && "写好后等待进入下一题，或点「重读」再听"}
      </p>

      <div className="dictation-card card">
        <div className="dictation-char-mask">
          {item.entry.text.split("").map((_, i) => (
            <span key={i} className="mask-block">█</span>
          ))}
        </div>
        <div className="dictation-status">
          {phase === "reading_char" && <span>🔊 读字（第 {repeatCount} 遍）</span>}
          {phase === "reading_word1" && <span>📝 听词语 1</span>}
          {phase === "reading_word2" && <span>📝 听词语 2</span>}
          {phase === "waiting" && <span>⏳ 即将进入下一题…</span>}
        </div>
        {message && <p className="msg">{message}</p>}
      </div>

      <div className="nav-row">
        <button className="btn-secondary" disabled={speaking} onClick={reRead}>
          🔊 重读
        </button>
        <button className="btn-primary" onClick={nextChar}>
          提前下一题 →
        </button>
      </div>
    </div>
  )
}

function getTwoWords(char: string, poly: Record<string, PolyInfo>, allWords: WordBankEntry[]): [string, string] {
  const pool = new Set<string>()
  const info = poly[char]
  if (info) {
    for (const w of info.words[info.primary] ?? []) {
      if (w !== char && w.length >= 2) pool.add(w)
    }
  }
  if (pool.size < 2) {
    for (const w of allWords) {
      if (w.text.includes(char) && w.text.length >= 2 && !pool.has(w.text)) pool.add(w.text)
    }
  }
  const arr = [...pool]
  const w1 = arr[0] ?? char
  const w2 = arr[1] ?? arr[0] ?? char
  return [w1, w2]
}
