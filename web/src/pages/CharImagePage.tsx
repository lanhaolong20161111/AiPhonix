/** 看图识字页 — 图片字卡，左右滑动，点图片发声，录音评分 */

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  listCharImages, charImageUrl, submitCharFeedback,
  type CharImageItem, type LearningStatus,
} from "../services/charImages"
import { fetchFeedback, fetchSoeRecords } from "../services/soeRecords"
import { getCharExample, type CharExample } from "../services/charExamples"
import { getAllCharSentences, getAllEnglishWordSentences } from "../services/charSentences"
import { useSoeScore, type SoeScoreState } from "../hooks/useSoeScore"
import { useTts } from "../hooks/useTts"
import { SoeDetail } from "../components/SoeDetail"
import { PinyinChips } from "../components/PinyinChips"
import { PhonemeChips } from "../components/PhonemeChips"
import { MnemonicToggle } from "../components/MnemonicToggle"
import { useMnemonicVisible } from "../lib/mnemonicPref"
import { useAuthStore } from "../stores/authStore"
import { savePosition, saveLastVisit, getPosition } from "../lib/charImageProgress"
import { normalizePinyin } from "../lib/pinyin"

export function CharImagePage() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const grade = search.get("grade") ?? ""
  const semester = search.get("semester") ?? ""
  const type_ = search.get("type") ?? ""
  const focus = search.get("focus") ?? ""

  const [items, setItems] = useState<CharImageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [current, setCurrent] = useState(0)
  const [pageInput, setPageInput] = useState("")
  const [learningStatus, setLearningStatus] = useState<LearningStatus | null>(null)
  const [feedbackMsg, setFeedbackMsg] = useState("")
  const [example, setExample] = useState<CharExample | null>(null)
  // 词卡：豆包生成的 词语→句子 映射（type=词 页面专用）
  const [sentences, setSentences] = useState<Record<string, string>>({})
  // 英词卡：豆包生成的 单词→英文句子 映射（type=英词 页面专用）
  const [enSentences, setEnSentences] = useState<Record<string, string>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const userId = useAuthStore((s) => s.session?.user.user_id ?? 0)
  const [mnVisible, toggleMn] = useMnemonicVisible()
  const targetIdxRef = useRef(0)
  const currentRef = useRef(0)
  // 学习状态(feedback) + 最近评测分数(按字/类型)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({})
  // source+类型 → 总分（读拼音 pinyin / 读字 word）
  const [scoreBySourceType, setScoreBySourceType] = useState<Record<string, number>>({})
  // refText → 总分（词语/句子 sentence）
  const [scoreByRefText, setScoreByRefText] = useState<Record<string, number>>({})
  // 评测详情浮窗：出结果后显示 5 秒自动隐藏
  const [showEval, setShowEval] = useState(false)
  const evalTimerRef = useRef<number | undefined>(undefined)

  // 加载本账号的反馈状态 + 评测记录，按 char 建立查找表
  useEffect(() => {
    if (!userId) return
    void (async () => {
      try {
        const [fb, recs] = await Promise.all([
          fetchFeedback(userId),
          fetchSoeRecords({ user_id: userId, limit: 1000 }),
        ])
        const fmap: Record<string, string> = {}
        for (const f of fb.items ?? []) {
          if (f.char && f.learning_status) fmap[f.char] = f.learning_status
        }
        setFeedbackMap(fmap)
        const stMap: Record<string, number> = {}
        const rtMap: Record<string, number> = {}
        for (const r of recs) {
          const score = Math.round(r.suggested_score)
          const src = (r.source || "").trim()
          const ref = (r.ref_text || "").trim()
          const type = (r.eval_type || "word").toLowerCase()
          // 读拼音/读字：按 source+type（最新第一条）
          if (src) {
            const sk = `${src}__${type}`
            if (!(sk in stMap)) stMap[sk] = score
          }
          // 词语/句子：按 refText（最新第一条）
          if (ref && !(ref in rtMap)) rtMap[ref] = score
        }
        setScoreBySourceType(stMap)
        setScoreByRefText(rtMap)
      } catch (e) {
        console.warn("加载状态/分数失败", e)
      }
    })()
  }, [userId])

  const { speaking, speak, speakChar } = useTts()
  const currentItem = items[current]
  /** 当前字若命中服务端人工录音库（data/char_audio），显示「真人录音」标记 */
  const [recordingChar, setRecordingChar] = useState<string | null>(null)
  // 评测模式：句子（含空格/标点）或多字中文词语 → sentence；单字/英词 → word
  const isSentence = currentItem ? /[\s,，。!?！？]/.test(currentItem.char) : false
  const isMultiChinese = currentItem ? /[\u4e00-\u9fff]/.test(currentItem.char) && [...currentItem.char].length > 1 : false
  const wordEvalScene = isSentence || isMultiChinese ? "sentence" : "word"

  // 「读拼音」：汉字字卡用拼音模式（eval_mode=8，refText 用数字声调格式 sang4）
  const pinyinSoe = useSoeScore(
    useCallback(() => {
      const py = currentItem?.pinyin ?? ""
      return { refText: normalizePinyin(py), scene: "pinyin", source: currentItem?.char ?? "" }
    }, [currentItem]),
  )
  // 「读字 / 读词 / 读一读」：字（word）/ 词·句（sentence）模式
  const wordSoe = useSoeScore(
    useCallback(
      () => ({
        refText: currentItem?.char ?? "",
        scene: wordEvalScene,
        source: currentItem?.char ?? "",
      }),
      [currentItem, wordEvalScene],
    ),
  )

  // 词语/句子 评测（各一个 SOE）：词语是多字 → sentence 模式；句子 → sentence 模式
  const exWord1Soe = useSoeScore(
    useCallback(() => ({ refText: example?.words?.[0] ?? "", scene: "sentence", source: currentItem?.char ?? "" }), [example, currentItem]),
  )
  const exWord2Soe = useSoeScore(
    useCallback(() => ({ refText: example?.words?.[1] ?? "", scene: "sentence", source: currentItem?.char ?? "" }), [example, currentItem]),
  )
  const exSentSoe = useSoeScore(
    useCallback(() => ({ refText: example?.sentence ?? "", scene: "sentence", source: currentItem?.char ?? "" }), [example, currentItem]),
  )
  // 词卡豆包句子：多字中文 → sentence 模式
  const curSentence = currentItem ? (sentences[currentItem.char] ?? "") : ""
  const genSentSoe = useSoeScore(
    useCallback(() => ({ refText: curSentence, scene: "sentence", source: currentItem?.char ?? "" }), [curSentence, currentItem]),
  )
  // 英词卡豆包英文句子：整句 sentence 模式
  const enCurSentence = currentItem ? (enSentences[currentItem.char] ?? "") : ""
  const enSentSoe = useSoeScore(
    useCallback(() => ({ refText: enCurSentence, scene: "sentence", source: enCurSentence || (currentItem?.char ?? "") }), [enCurSentence, currentItem]),
  )

  const toggleSoe = async (soe: ReturnType<typeof useSoeScore>) => {
    if (soe.state.recording) {
      await soe.stop()
    } else {
      await soe.start()
    }
  }

  // 评测出结果 → 浮窗显示 5 秒后自动隐藏；录音/评分中保持显示
  useEffect(() => {
    const hasResult = pinyinSoe.state.score !== null || wordSoe.state.score !== null
    const busy = pinyinSoe.state.recording || wordSoe.state.recording || pinyinSoe.state.evaluating || wordSoe.state.evaluating
    if (busy) {
      setShowEval(true)
      return
    }
    if (hasResult) {
      setShowEval(true)
      if (evalTimerRef.current) window.clearTimeout(evalTimerRef.current)
      evalTimerRef.current = window.setTimeout(() => setShowEval(false), 5000)
    }
    return () => {
      if (evalTimerRef.current) window.clearTimeout(evalTimerRef.current)
    }
  }, [pinyinSoe.state.score, pinyinSoe.state.recording, pinyinSoe.state.evaluating, wordSoe.state.score, wordSoe.state.recording, wordSoe.state.evaluating])

  // 切换字卡 → 清空上一字的评测结果，避免串到新字（reset 是稳定引用）
  const pinyinReset = pinyinSoe.reset
  const wordReset = wordSoe.reset
  const genSentReset = genSentSoe.reset
  useEffect(() => {
    pinyinReset()
    wordReset()
    genSentReset()
  }, [current, pinyinReset, wordReset, genSentReset])

  // 词页：加载豆包生成的 词语→句子 映射；英词页：加载 单词→英文句子 映射（加载失败静默）
  useEffect(() => {
    let alive = true
    if (type_ === "词") {
      void getAllCharSentences()
        .then((m) => {
          if (alive) setSentences(m)
        })
        .catch(() => {})
    } else if (type_ === "英词") {
      void getAllEnglishWordSentences()
        .then((m) => {
          if (alive) setEnSentences(m)
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [type_])

  // 加载当前字的词语+句子示例（仅汉字字卡；加载失败静默，不阻塞页面）
  useEffect(() => {
    let alive = true
    setExample(null)
    const item = items[current]
    if (!item || !item.pinyin) return
    void getCharExample(item.char)
      .then((ex) => {
        if (alive) setExample(ex)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [current, items])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError("")
      try {
        // type=字 是前端合成的多类型（认+写），后端无此类型 → 不传 type_ 拉全量，再前端过滤
        const apiType = type_ === "字" ? "" : type_
        const raw = await listCharImages({ grade, semester, type_: apiType, limit: 100000 })
        // 新入口 type=字/词/句 映射到后端数据类型；旧的 认/写/词 也兼容
        // 字 → 认+写；词 → 词；句 → 句（暂无数据，空列表）
        let data: CharImageItem[]
        if (type_ === "字") {
          data = raw.filter(it => it.type === "认" || it.type === "写")
        } else if (type_ === "词") {
          data = raw.filter(it => it.type === "词")
        } else if (type_ === "句") {
          data = raw.filter(it => it.type === "句")
        } else if (type_ === "英词" || type_ === "英句") {
          data = raw.filter(it => it.type === type_) // 英词/英句：服务端/前端双重过滤，防止全量混入
        } else {
          // 无 type 或旧类型（认/写/词）→ 显示对应类型，排除英语
          data = type_ ? raw.filter(it => it.type === type_) : raw.filter(it => it.type !== "英词" && it.type !== "英句")
        }
        setItems(data)
        // 定位目标：优先 focus 参数（从评测历史跳转定位某字），否则恢复上次位置
        let target = -1
        if (focus) {
          const f = focus.trim()
          const firstChar = f[0] ?? ""
          const fNorm = normalizePinyin(f) // 拼音评测 ref_text 是数字声调如 tan4
          target = data.findIndex(
            (it) =>
              it.char === f ||
              (f.length > 1 && it.char === firstChar) || // 词/句取首字定位
              (it.pinyin &&
                normalizePinyin(it.pinyin).toLowerCase() === fNorm.toLowerCase()) || // 拼音：带调号 tàn / 数字 tan 统一
              it.ipa === f,
          )
        }
        if (target < 0) {
          const saved = getPosition(userId, grade, semester, type_)
          target = saved >= 0 && saved < data.length ? saved : 0
        }
        targetIdxRef.current = target >= 0 && target < data.length ? target : 0
        currentRef.current = targetIdxRef.current
        setCurrent(targetIdxRef.current)
        setPageInput(String(targetIdxRef.current + 1))
      } catch (e) {
        setError(`加载失败: ${String((e as Error)?.message ?? e)}`)
      } finally {
        setLoading(false)
      }
    })()
  }, [grade, semester, type_, userId, focus])

  // 加载完成后滚动到恢复的位置
  useEffect(() => {
    if (loading || items.length === 0) return
    const el = scrollRef.current
    if (!el) return
    const target = targetIdxRef.current
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        el.scrollTo({ left: target * el.clientWidth, behavior: "auto" })
      })
      return raf2
    })
    return () => cancelAnimationFrame(raf1)
  }, [loading, items.length])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // 自由滚动：按滚动位置实时计算当前索引（去掉 snap 保护，左右可连续滑）
    const w = el.clientWidth
    if (!w) return
    const idx = Math.round(el.scrollLeft / w)
    const target = Math.max(0, Math.min(items.length - 1, idx))
    if (target === currentRef.current) return
    currentRef.current = target
    setCurrent(target)
    setPageInput(String(target + 1))
    setLearningStatus(null)
    setFeedbackMsg("")
    if (target >= 0) {
      savePosition(userId, grade, semester, type_, target)
      saveLastVisit(userId, { grade, semester, type: type_, index: target })
    }
  }, [items.length, userId, grade, semester, type_])

  const scrollTo = (idx: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" })
  }

  // 输入页码跳转：1..N，越界自动夹紧
  const jumpToPage = (raw: string) => {
    const n = parseInt(raw, 10)
    if (Number.isNaN(n)) return
    const idx = Math.max(0, Math.min(items.length - 1, n - 1))
    scrollTo(idx)
    setPageInput(String(idx + 1))
  }

  const submitFeedback = async () => {
    const item = currentItem
    if (!item || !learningStatus) return
    const ok = await submitCharFeedback(item, learningStatus)
    setFeedbackMsg(ok ? "✅ 已记录" : "❌ 提交失败")
    setLearningStatus(null)
  }

  if (loading) return <div className="page center-page"><p className="empty">加载字卡…</p></div>
  if (error) return <div className="page center-card"><p className="err">{error}</p><button className="btn-secondary" onClick={() => navigate(-1)}>返回</button></div>
  if (items.length === 0) return <div className="page center-card"><p className="empty">暂无{type_ === "字" ? "字" : type_ === "词" ? "词" : type_ === "句" ? "句" : "字"}卡，请家长在设置中选择范围</p><button className="btn-secondary" onClick={() => navigate(-1)}>返回</button></div>

  const title = type_ === "字" ? "看图识字" : type_ === "词" ? "看图识词" : type_ === "句" ? "看图识句" : type_ === "英词" ? "词汇练习" : type_ === "英句" ? "英句跟读" : "看图识字"

  // 年级/学期/模式标记（优先 URL 参数；为空则从首项推断）
  const first = items[0]
  const ctxGrade = grade || first?.grade || ""
  const ctxSem = semester || first?.semester || ""
  const ctxType = type_ || first?.type || ""
  const ctxLabel = [ctxGrade ? `${ctxGrade}${ctxSem || ""}` : "", ctxType ? (ctxType === "英词" ? "英词" : ctxType === "英句" ? "英句" : ctxType === "字" ? "字" : ctxType === "词" ? "词" : ctxType === "句" ? "句" : ctxType) : ""].filter(Boolean).join(" · ")
  const hasCtx = !!ctxLabel

  // 当前字的学习状态 + 各评测项最近总分
  const curChar = currentItem?.char ?? ""
  const curStatus = curChar ? (feedbackMap[curChar] ?? null) : null
  const statusIcon = curStatus === "correct" ? "✓" : curStatus === "wrong" ? "×" : curStatus === "unsure" ? "?" : ""
  const curPinyinScore = curChar && scoreBySourceType[`${curChar}__pinyin`] != null ? scoreBySourceType[`${curChar}__pinyin`] : null
  const curWordScore = curChar && scoreBySourceType[`${curChar}__word`] != null ? scoreBySourceType[`${curChar}__word`] : null
  const w1 = example?.words?.[0] ?? ""
  const w2 = example?.words?.[1] ?? ""
  const sent = example?.sentence ?? ""
  const word1Score = w1 && scoreByRefText[w1] != null ? scoreByRefText[w1] : null
  const word2Score = w2 && scoreByRefText[w2] != null ? scoreByRefText[w2] : null
  const sentScore = sent && scoreByRefText[sent] != null ? scoreByRefText[sent] : null
  const genSentScore = curSentence && scoreByRefText[curSentence] != null ? scoreByRefText[curSentence] : null
  const enSentScore = enCurSentence && scoreByRefText[enCurSentence] != null ? scoreByRefText[enCurSentence] : null

  return (
    <div className="page charimage-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>{title}</h1>
        <MnemonicToggle visible={mnVisible} onToggle={toggleMn} />
      </header>

      {/* 评测历史入口：右下角圆形浮钮（位于年级标签上方） */}
      <button
        className="charimage-soe-fab"
        title="评测历史"
        aria-label="评测历史"
        style={{ bottom: hasCtx ? 58 : 14 }}
        onClick={() => navigate("/module/soe_history")}
      >
        📊
      </button>

      <div className="swipe-nav">
        <div className="charimage-page-nav">
          <input
            className="charimage-page-input"
            type="number"
            min={1}
            max={items.length}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpToPage(pageInput)
            }}
            inputMode="numeric"
            placeholder="页码"
          />
          <span className="charimage-page-total">/ {items.length}</span>
          <button className="charimage-page-go" onClick={() => jumpToPage(pageInput)}>跳转</button>
        </div>
      </div>

      {/* 读拼音/读字 评测结果：固定屏幕底部浮层，出结果后 5 秒自动消失 */}
      {showEval && (
        <div className="charimage-eval-fixed">
          {currentItem?.pinyin && <EvalPane soe={pinyinSoe.state} active />}
          <EvalPane soe={wordSoe.state} active />
        </div>
      )}

      <div className="swipe-track charimage-track" ref={scrollRef} onScroll={onScroll}>
        {items.map((item, i) => {
          // 懒渲染：只渲染当前字附近的前后各 2 个，其余用轻量占位，避免上千字卡全渲染导致卡顿
          if (Math.abs(i - current) > 2) {
            return <section key={item.char + i} className="swipe-item charimage-placeholder" />
          }
          return (
          <section key={item.char + i} className="swipe-item">
            <div className="charimage-card card">
              {/* 默认 768px WebP 缩略图即时加载；「显示原图」带进度加载原图后卡面切换展示；箭头仅当前卡渲染（函数 props 只传当前卡，保证相邻卡 memo 生效） */}
              <CharCardImage
                filename={item.image}
                alt={item.char}
                showArrows={i === current}
                onPrev={i === current ? () => scrollTo(current - 1) : undefined}
                onNext={i === current ? () => scrollTo(current + 1) : undefined}
                prevDisabled={i === current ? current === 0 : undefined}
                nextDisabled={i === current ? current === items.length - 1 : undefined}
              />
              {item.ipa_uk || item.ipa ? (
                <>
                  <div className="charimage-pinyin">{item.ipa_uk || item.ipa}</div>
                  <PhonemeChips phonemes={item.phonemes_uk || item.phonemes} />
                </>
              ) : item.pinyin ? (
                <PinyinChips pinyin={item.pinyin} />
              ) : null}
              <div className="charimage-actions">
                <button
                  className="btn-secondary"
                  disabled={speaking}
                  onClick={async () => {
                    const r = await speakChar(item.char, item.pinyin)
                    // 体现「点击单字发音先检查服务器是否有记录这个字的音频文件」
                    setRecordingChar(r.source === "recording" ? item.char : null)
                  }}
                >
                  🔊 发音
                  {recordingChar === item.char && <span className="charimage-rec-badge">真人录音</span>}
                </button>
                {item.pinyin ? (
                  <>
                    <div className="charimage-eval-col">
                      <button
                        className={pinyinSoe.state.recording && i === current ? "btn-danger" : "btn-primary"}
                        disabled={pinyinSoe.state.evaluating && i === current}
                        onClick={() => toggleSoe(pinyinSoe)}
                      >
                        {pinyinSoe.state.recording && i === current
                          ? "⏹ 停止"
                          : pinyinSoe.state.evaluating && i === current
                            ? "评分中…"
                            : "🎤 读拼音"}
                      </button>
                      {i === current && curPinyinScore != null && <span className="charimage-last-score">上次 {curPinyinScore}分</span>}
                    </div>
                    <div className="charimage-eval-col">
                      <button
                        className={wordSoe.state.recording && i === current ? "btn-danger" : "btn-secondary"}
                        disabled={wordSoe.state.evaluating && i === current}
                        onClick={() => toggleSoe(wordSoe)}
                      >
                        {wordSoe.state.recording && i === current
                          ? "⏹ 停止"
                          : wordSoe.state.evaluating && i === current
                            ? "评分中…"
                            : wordEvalScene === "sentence" ? "📖 读词" : "📖 读字"}
                      </button>
                      {i === current && curWordScore != null && <span className="charimage-last-score">上次 {curWordScore}分</span>}
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      className={wordSoe.state.recording && i === current ? "btn-danger" : "btn-primary"}
                      disabled={wordSoe.state.evaluating && i === current}
                      onClick={() => toggleSoe(wordSoe)}
                    >
                      {wordSoe.state.recording && i === current
                        ? "⏹ 停止并评分"
                        : wordSoe.state.evaluating && i === current
                          ? "评分中…"
                          : "🎤 读一读"}
                    </button>
                    {i === current && curWordScore != null && <span className="charimage-last-score">上次 {curWordScore}分</span>}
                  </>
                )}
              </div>

              {/* 学习状态反馈 ✓ × ? */}
              <div className="charimage-feedback">
                <button
                  className={`feedback-btn ok${learningStatus === "correct" ? " active" : ""}`}
                  onClick={() => setLearningStatus(learningStatus === "correct" ? null : "correct")}
                  title="认识"
                >
                  ✓
                </button>
                <button
                  className={`feedback-btn no${learningStatus === "wrong" ? " active" : ""}`}
                  onClick={() => setLearningStatus(learningStatus === "wrong" ? null : "wrong")}
                  title="不认识"
                >
                  ×
                </button>
                <button
                  className={`feedback-btn unsure${learningStatus === "unsure" ? " active" : ""}`}
                  onClick={() => setLearningStatus(learningStatus === "unsure" ? null : "unsure")}
                  title="不确定"
                >
                  ?
                </button>
                {learningStatus && (
                  <button className="feedback-submit" onClick={submitFeedback}>
                    提交
                  </button>
                )}
              </div>
              {feedbackMsg && <p className="feedback-msg">{feedbackMsg}</p>}
              {example && (
                <div className="charimage-examples">
                  <div className="charimage-examples-title">词语</div>
                  <div className="charimage-examples-words">
                    {example.words.map((w, wi) => {
                      const exSoe = wi === 0 ? exWord1Soe : wi === 1 ? exWord2Soe : null
                      const exActive = i === current && !!exSoe
                      return (
                        <div key={wi} className="charimage-example-block">
                          <button
                            className="charimage-example-word"
                            disabled={speaking}
                            onClick={() => void speak(w)}
                            title={`朗读：${w}`}
                          >
                            {w} 🔊
                          </button>
                          {exSoe && (
                            <div className="charimage-eval-col">
                              <button
                                className={exSoe.state.recording ? "btn-danger charimage-example-eval" : "btn-secondary charimage-example-eval"}
                                disabled={i !== current || (exSoe.state.evaluating)}
                                onClick={() => void toggleSoe(exSoe)}
                              >
                                {exSoe.state.recording ? "⏹ 停止" : exSoe.state.evaluating ? "评分中…" : "🎤 评测"}
                              </button>
                              {i === current && (wi === 0 ? word1Score : word2Score) != null && (
                                <span className="charimage-last-score">{wi === 0 ? word1Score : word2Score}分</span>
                              )}
                              <EvalPane soe={exSoe.state} active={exActive} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="charimage-examples-title">句子</div>
                  <div className="charimage-example-block">
                    <button
                      className="charimage-example-sentence"
                      disabled={speaking}
                      onClick={() => void speak(example.sentence)}
                      title={`朗读：${example.sentence}`}
                    >
                      {example.sentence} 🔊
                    </button>
                    <div className="charimage-eval-col">
                      <button
                        className={exSentSoe.state.recording ? "btn-danger charimage-example-eval" : "btn-secondary charimage-example-eval"}
                        disabled={i !== current || exSentSoe.state.evaluating}
                        onClick={() => void toggleSoe(exSentSoe)}
                      >
                        {exSentSoe.state.recording ? "⏹ 停止" : exSentSoe.state.evaluating ? "评分中…" : "🎤 评测"}
                      </button>
                      {i === current && sentScore != null && <span className="charimage-last-score">上次 {sentScore}分</span>}
                      <EvalPane soe={exSentSoe.state} active={i === current} />
                    </div>
                  </div>
                </div>
              )}
              {/* 词卡：豆包生成的 词语→句子（TTS 朗读 + 评测） */}
              {sentences[item.char] && (
                <div className="charimage-examples">
                  <div className="charimage-examples-title">句子</div>
                  <div className="charimage-example-block">
                    <button
                      className="charimage-example-sentence"
                      disabled={speaking}
                      onClick={() => void speak(sentences[item.char])}
                      title={`朗读：${sentences[item.char]}`}
                    >
                      {sentences[item.char]} 🔊
                    </button>
                    <div className="charimage-eval-col">
                      <button
                        className={genSentSoe.state.recording ? "btn-danger charimage-example-eval" : "btn-secondary charimage-example-eval"}
                        disabled={i !== current || genSentSoe.state.evaluating}
                        onClick={() => void toggleSoe(genSentSoe)}
                      >
                        {genSentSoe.state.recording ? "⏹ 停止" : genSentSoe.state.evaluating ? "评分中…" : "🎤 评测"}
                      </button>
                      {i === current && genSentScore != null && <span className="charimage-last-score">上次 {genSentScore}分</span>}
                      <EvalPane soe={genSentSoe.state} active={i === current} />
                    </div>
                  </div>
                </div>
              )}
              {/* 英词卡：豆包生成的 单词→英文句子（TTS 朗读 + 整句评测） */}
              {type_ === "英词" && enSentences[item.char] && (
                <div className="charimage-examples">
                  <div className="charimage-examples-title">句子</div>
                  <div className="charimage-example-block">
                    <button
                      className="charimage-example-sentence"
                      disabled={speaking}
                      onClick={() => void speak(enSentences[item.char])}
                      title={`朗读：${enSentences[item.char]}`}
                    >
                      {enSentences[item.char]} 🔊
                    </button>
                    <div className="charimage-eval-col">
                      <button
                        className={enSentSoe.state.recording ? "btn-danger charimage-example-eval" : "btn-secondary charimage-example-eval"}
                        disabled={i !== current || enSentSoe.state.evaluating}
                        onClick={() => void toggleSoe(enSentSoe)}
                      >
                        {enSentSoe.state.recording ? "⏹ 停止" : enSentSoe.state.evaluating ? "评分中…" : "🎤 评测"}
                      </button>
                      {i === current && enSentScore != null && <span className="charimage-last-score">上次 {enSentScore}分</span>}
                      <EvalPane soe={enSentSoe.state} active={i === current} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
          )
        })}
      </div>
      {hasCtx && (
        <div className="charimage-ctx-fixed">
          <span className="ctx-fixed-label">{ctxLabel}</span>
          {statusIcon && <span className={`ctx-fixed-status ${curStatus || ""}`}>{statusIcon}</span>}
        </div>
      )}
    </div>
  )
}

/** 字卡图片：默认显示 768px WebP 缩略图（3x 屏清晰、体积小），点「显示原图」后带进度加载并切换为原图展示。
 * memo：父组件因录音电平/评分高频重渲染时，props 不变的相邻卡（filename 相同、无函数 props）直接跳过重渲染 */
const CharCardImage = memo(function CharCardImage({
  filename, alt, showArrows, onPrev, onNext, prevDisabled, nextDisabled,
}: {
  filename: string
  alt: string
  /** 仅当前卡显示左右翻页箭头（叠在图片两侧） */
  showArrows?: boolean
  onPrev?: () => void
  onNext?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
}) {
  const [origSrc, setOrigSrc] = useState<string | null>(null)
  // null = 未在加载；0-100 = 加载进度百分比
  const [progress, setProgress] = useState<number | null>(null)
  const urlRef = useRef<string | null>(null)

  // 卡片滑出懒渲染范围被卸载时释放 blob，避免大图内存累积
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  const loadOriginal = () => {
    if (progress != null || origSrc) return
    setProgress(0)
    const xhr = new XMLHttpRequest()
    xhr.open("GET", charImageUrl(filename, 1536))
    xhr.responseType = "blob"
    xhr.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      const url = URL.createObjectURL(xhr.response)
      urlRef.current = url
      setOrigSrc(url)
      setProgress(null)
    }
    xhr.onerror = () => setProgress(null)
    xhr.send()
  }

  return (
    <div className="charimage-imgwrap">
      <img
        className="charimage-img"
        src={origSrc ?? charImageUrl(filename, 768)}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
      {!origSrc && (
        <button
          type="button"
          className="charimage-original-btn"
          disabled={progress != null}
          onClick={loadOriginal}
        >
          {progress != null ? `加载中 ${progress}%` : "显示原图"}
        </button>
      )}
      {showArrows && (
        <>
          <button type="button" className="charimage-nav-arrow left" disabled={prevDisabled} onClick={onPrev}>‹</button>
          <button type="button" className="charimage-nav-arrow right" disabled={nextDisabled} onClick={onNext}>›</button>
        </>
      )}
    </div>
  )
})

/** 评测结果展示（录音电平 / 错误 / 分数 / 音素明细） */
function EvalPane({ soe, active }: { soe: SoeScoreState; active: boolean }) {
  if (!active) return null
  return (
    <>
      {soe.recording && (
        <div className="level-bar" style={{ marginTop: 12 }}>
          <div className="level-fill" style={{ width: `${Math.max(4, Math.min(100, soe.level * 100))}%` }} />
        </div>
      )}
      {soe.error && <p className="err">{soe.error}</p>}
      {soe.score !== null && (
        <>
          <div className={`charimage-score${soe.score >= 80 ? " good" : soe.score >= 60 ? " ok" : " bad"}`}>
            {soe.score} 分
          </div>
          {soe.result && <SoeDetail result={soe.result} />}
        </>
      )}
    </>
  )
}
