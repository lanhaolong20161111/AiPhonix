/** 认字练习页 — 看图认汉字，拼音填空 + 发音评分双通过 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { queryChars, queryCharsByGrades, queryCharsByTexts, findWordContaining, type WordBankEntry } from "../services/wordbank"
import { getCharExample } from "../services/charExamples"
import { ensureGenerated, type GeneratedEntry } from "../services/generatedDict"
import { getCharInfo, pinyinInitial, type CharInfo } from "../services/charInfo"
import { listCharImages, charImageUrl } from "../services/charImages"
import { parsePinyin } from "../lib/pinyin"
import { useSoeScore } from "../hooks/useSoeScore"
import { api } from "../services/api"
import { useTts } from "../hooks/useTts"
import { useFeatureGrades } from "../hooks/useTrainingConfig"
import { loadDailyZhSynced } from "../services/dailyZh"
import { fetchPracticeRecords, recordTotalCount, markCharPassed } from "../services/practice"
import { SoeDetail } from "../components/SoeDetail"
// cache-bust: 触发新构建哈希，打破 recognition 选字页 SW 缓存链

const MAX_ERRORS = 3
const PASS_SCORE = 70

interface HintContent {
  words: string[]
}

interface QuizResult {
  char: string
  isCorrect: boolean
}

const INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
  "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"]

function pinyinIsOverall(raw: string): boolean {
  const body = raw.replace(/[0-9]/g, "")
  return ["zhi", "chi", "shi", "ri", "zi", "ci", "si",
    "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"].includes(body)
}

function pinyinZeroInit(raw: string): boolean {
  const body = raw.replace(/[0-9]/g, "")
  if (pinyinIsOverall(raw)) return false
  return !INITIALS.some((i) => body.startsWith(i))
}

function pinyinHasMedial(raw: string): boolean {
  const body = raw.replace(/[0-9]/g, "")
  const init = INITIALS.find((i) => body.startsWith(i))
  const rest = init ? body.slice(init.length) : body
  const iMed = ["iong", "iang", "iao", "ian", "ia"]
  const uMed = ["uang", "uai", "uan", "uo", "ua"]
  const vMed = ["van", "vong"]
  switch (rest[0]) {
    case "i": return iMed.some((m) => rest.startsWith(m))
    case "u": return uMed.some((m) => rest.startsWith(m))
    case "v": return vMed.some((m) => rest.startsWith(m))
    default: return false
  }
}

/** 根据组词/句子上下文反查多音字正确读音（匹配不到回退主读音，再回退词库默认拼音） */
function resolveContextPinyin(
  defaultPinyin: string,
  poly: { primary: string; words: Record<string, string[]> } | undefined,
  exampleWords: string[],
  exampleSentence: string,
): string {
  if (!poly) return defaultPinyin
  const texts = [...exampleWords, exampleSentence].filter((t) => typeof t === "string" && t.length > 0)
  for (const t of texts) {
    for (const [pinyin, words] of Object.entries(poly.words)) {
      if (words.some((w) => w && (t.includes(w) || w.includes(t)))) return pinyin
    }
  }
  return poly.primary || defaultPinyin
}

export function RecognitionPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<WordBankEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [index, setIndex] = useState(0)
  const [initial, setInitial] = useState("")
  const [medial, setMedial] = useState("")
  const [fin, setFin] = useState("")
  const medialRef = useRef<HTMLInputElement>(null)
  const finRef = useRef<HTMLInputElement>(null)
  const [tone, setTone] = useState(0)
  const [pinyinPassed, setPinyinPassed] = useState(false)
  const [pronPassed, setPronPassed] = useState(false)
  const [wordPassed1, setWordPassed1] = useState(false)
  const [wordPassed2, setWordPassed2] = useState(false)
  const [sentencePassed, setSentencePassed] = useState(false)
  const [pinyinErr, setPinyinErr] = useState(0)
  const [pronErr, setPronErr] = useState(0)
  const [hintActivated, setHintActivated] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [hintContent, setHintContent] = useState<HintContent | null>(null)
  const [finished, setFinished] = useState(false)
  const [results, setResults] = useState<QuizResult[]>([])
  const [ttsHint, setTtsHint] = useState("")
  const [polyphoneMap, setPolyphoneMap] = useState<Record<string, { primary: string; words: Record<string, string[]> }>>({})
  const [recordSyncFailed, setRecordSyncFailed] = useState(false)
  // 练习次数记录（当前字练过几次）
  const [practiceCount, setPracticeCount] = useState(0)
  // 字卡图 / 组词 / 句子（纯展示，不加朗读）
  const [charImg, setCharImg] = useState("")
  const [exampleWords, setExampleWords] = useState<string[]>([])
  const [exampleSentence, setExampleSentence] = useState("")
  // 当前字的结构/笔画/部首（用于四角标注）
  const [charInfo, setCharInfo] = useState<CharInfo | null>(null)
  // 今日练字列表（家长设置的每日字，点选可直接练对应字，不按固定顺序）
  const [todayChars, setTodayChars] = useState<string[]>([])
  // 今日字选字页：有今日配置时先展示宫格选字，点击某个字才进入练习
  const [pickOpen, setPickOpen] = useState(true)
  // 本轮已练且通过的字（选字页/选词条标绿用，会话内有效）
  const [passedChars, setPassedChars] = useState<Set<string>>(new Set())
  // 本轮由大模型生成的字（词库没有）→ 映射 text → 生成结果（组词/句/拼音），供组词句子加载用
  const generatedMapRef = useRef<Record<string, GeneratedEntry>>({})

  const { speaking, speak } = useTts()
  // 家长配置的年级批次（空=全部）
  const grades = useFeatureGrades("recognition")
  const current = items[index]
  const currentPinyin = current?.pinyin ?? ""
  // 多音字：根据组词/句子上下文反查正确读音（词库只有单一拼音，组词可能用另一读音）
  const effectivePinyin = useMemo(
    () => resolveContextPinyin(currentPinyin, current ? polyphoneMap[current.text] : undefined, exampleWords, exampleSentence),
    [current, currentPinyin, polyphoneMap, exampleWords, exampleSentence],
  )
  // 与有效读音一致的上下文词（"来自：xxx"），保证上下文、拼音、组词三者读音一致
  const effectiveWordContext = useMemo(() => {
    if (!current) return ""
    const poly = polyphoneMap[current.text]
    if (!poly) return ""
    return poly.words[effectivePinyin]?.[0] ?? Object.values(poly.words)[0]?.[0] ?? ""
  }, [current, polyphoneMap, effectivePinyin])

  const soe = useSoeScore(
    // 认字=单字 → word 模式（eval_mode=0）
    useCallback(() => ({ refText: current?.text ?? "", scene: "word" }), [current]),
  )
  // 组词 ×2 + 句子评测（句子模式，跳过 pinyin 标注）
  const wordSoe1 = useSoeScore(
    useCallback(() => ({ refText: exampleWords[0] ?? "", scene: "sentence" }), [exampleWords]),
  )
  const wordSoe2 = useSoeScore(
    useCallback(() => ({ refText: exampleWords[1] ?? "", scene: "sentence" }), [exampleWords]),
  )
  const sentenceSoe = useSoeScore(
    useCallback(() => ({ refText: exampleSentence ?? "", scene: "sentence" }), [exampleSentence]),
  )

  const isCorrect: boolean | null = useMemo(() => {
    // 过关 = 拼音对 + 单字发音 ≥70；组词/句子若存在则也需 ≥70
    if (!pinyinPassed || !pronPassed) return null
    if (exampleWords[0] && !wordPassed1) return null
    if (exampleWords[1] && !wordPassed2) return null
    if (exampleSentence && !sentencePassed) return null
    return true
  }, [pinyinPassed, pronPassed, wordPassed1, wordPassed2, sentencePassed, exampleWords, exampleSentence])

  // 某字全部达标（isCorrect=true）→ 记入已通过集合（选字页标绿）+ 上报服务器持久化
  const passedSyncRef = useRef<string>("")
  useEffect(() => {
    if (isCorrect === true && current?.text) {
      setPassedChars((prev) => {
        if (prev.has(current.text)) return prev
        const n = new Set(prev)
        n.add(current.text)
        return n
      })
      // 服务器持久化（去重：同字只上报一次，避免重复写）
      if (passedSyncRef.current !== current.text) {
        passedSyncRef.current = current.text
        void markCharPassed(current.text)
      }
    }
  }, [isCorrect, current])

  // 加载题目
  const loadQuiz = useCallback(async () => {
    setLoading(true)
    setMessage("")
    try {
      // 每日一练指定了今日字 → 优先按手打列表过滤（词库命中才练）；否则按年级/全部
      // loadDailyZhSynced：已登录走服务端（跨设备同步），失败退本地镜像
      const dailyTexts = (await loadDailyZhSynced())
        .chars.split(/[,，、;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean)
      setTodayChars(dailyTexts)
      let all: WordBankEntry[] = []
      let dailyNote = ""
      if (dailyTexts.length > 0) {
        const hits = await queryCharsByTexts(dailyTexts)
        const hitSet = new Set(hits.map((e) => e.text))
        const misses = dailyTexts.filter((t) => !hitSet.has(t))
        let genEntries: WordBankEntry[] = []
        if (misses.length > 0) {
          // 词库没有的字 → 调大模型生成（拼音+2组词+1句），结果由后端缓存复用
          const gen = await ensureGenerated(misses.map((t) => ({ type: "char", text: t })))
          const map: Record<string, GeneratedEntry> = {}
          for (const g of gen) {
            map[g.text] = g
            genEntries.push({
              text: g.text,
              pinyin: g.pinyin ?? "",
              tags: ["识字"],
              type: "char",
              ipa: "",
              ipa_uk: "",
              letter: "",
              phonemes: [],
              phonemes_uk: [],
              emoji: "",
              difficulty: 0,
              translation: "",
            })
          }
          generatedMapRef.current = map
        } else {
          generatedMapRef.current = {}
        }
        all = [...hits, ...genEntries]
        dailyNote = `今日练字：${dailyTexts.join("、")}`
        if (all.length === 0) {
          setMessage(`字库中没有这些字，请检查每日设置：${dailyTexts.join("、")}`)
          setLoading(false)
          return
        }
      } else {
        all = grades.length > 0 ? await queryCharsByGrades(grades) : await queryChars("识字")
      }
      if (all.length === 0) {
        setMessage(grades.length > 0 ? "所选年级暂无识字字，请家长调整范围" : "字库中没有识字类汉字")
        setLoading(false)
        return
      }
      if (dailyNote) setMessage(dailyNote)

      // 加权排序（弱项优先），不设数量上限
      let weights: Record<string, number> | null = null
      try {
        const res = await api<{ weights: Record<string, number> }>("/practice/char-weights", {
          method: "POST",
          body: { chars: all.map((e) => e.text) },
        })
        weights = res.weights
      } catch {
        /* 忽略 */
      }

      let selected: WordBankEntry[]
      if (weights) {
        // 按权重降序（弱项排前），取全部
        selected = [...all].sort((a, b) => (weights[b.text] ?? 1) - (weights[a.text] ?? 1))
      } else {
        selected = [...all].sort(() => Math.random() - 0.5)
      }

      // 多音字数据
      let poly: Record<string, { primary: string; words: Record<string, string[]> }> = {}
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
      setPolyphoneMap(poly)

      // 拉回服务器"已通过"状态 → 初始化绿标（跨会话：上次达标过的字仍标绿）
      try {
        const recs = await fetchPracticeRecords(selected.map((e) => e.text))
        const passedSet = new Set(recs.filter((r) => r.passed).map((r) => r.char))
        if (passedSet.size > 0) {
          setPassedChars((prev) => {
            const n = new Set(prev)
            for (const ch of passedSet) n.add(ch)
            return n
          })
        }
      } catch {
        /* 拉取失败不影响本次练习 */
      }

      setItems(selected)
      setIndex(0)
      setLoading(false)

      // TTS hint
      const hint = (await findWordContaining(selected[0]?.text ?? "")) ?? selected[0]?.text ?? ""
      setTtsHint(hint)
    } catch (e) {
      setMessage(`加载失败: ${String((e as Error)?.message ?? e)}`)
      setLoading(false)
    }
  }, [grades])

  // 首次加载
  // grades（家长配置）变化或首次进入 → 重新加载题目
  const loadedGradesRef = useRef<string | null>(null)
  useEffect(() => {
    const key = grades.join(",")
    if (loadedGradesRef.current === key) return
    loadedGradesRef.current = key
    setLoading(true)
    void loadQuiz()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grades])

  // 当前字变化 → 加载该字练习次数（练过几次）
  useEffect(() => {
    if (!current?.text) return
    void (async () => {
      try {
        const recs = await fetchPracticeRecords([current.text])
        const r = recs.find((x) => x.char === current.text)
        setPracticeCount(r ? recordTotalCount(r) : 0)
      } catch {
        setPracticeCount(0)
      }
    })()
  }, [current?.text])

  // 当前字变化 → 加载字卡图 + 组词 + 句子（展示辅助）
  useEffect(() => {
    if (!current?.text) return
    let cancelled = false
    void (async () => {
      const ch = current.text
      setCharInfo(null)
      // 字卡图（看图识字库按字模糊匹配：优先精确命中该字的图，否则用第一条相关图）
      try {
        const imgs = await listCharImages({ q: ch, limit: 10 })
        if (!cancelled) {
          const exact = imgs.find((i) => i.char === ch)
          const pick = exact ?? imgs[0]
          setCharImg(pick ? charImageUrl(pick.image, 640) : "")
        }
      } catch {
        if (!cancelled) setCharImg("")
      }
      // 组词 + 句子：词库生成的字优先用大模型结果；否则取 char_examples.json
      try {
        const gen = generatedMapRef.current[ch]
        if (gen) {
          if (!cancelled) {
            setExampleWords(gen.words.slice(0, 2))
            setExampleSentence(gen.sentence)
          }
        } else {
          const ex = await getCharExample(ch)
          if (cancelled) return
          setExampleWords(ex?.words?.slice(0, 2) ?? [])
          setExampleSentence(ex?.sentence ?? "")
        }
      } catch {
        if (!cancelled) {
          setExampleWords([])
          setExampleSentence("")
        }
      }
      // 四角标注：结构/笔画/部首（音序由拼音推导）
      try {
        const info = await getCharInfo(ch)
        if (cancelled) return
        setCharInfo(info)
      } catch {
        if (!cancelled) setCharInfo(null)
      }
    })()
    return () => { cancelled = true }
  }, [current?.text])

  const resetFields = () => {
    setInitial("")
    setMedial("")
    setFin("")
    setTone(0)
    setPinyinPassed(false)
    setPronPassed(false)
    setWordPassed1(false)
    setWordPassed2(false)
    setSentencePassed(false)
    // 切换字/重试 → 清空上一字的发音测评结果（score/result/error/录音态），避免串到下一个字
    soe.reset()
    wordSoe1.reset()
    wordSoe2.reset()
    sentenceSoe.reset()
  }

  const sendRecord = async (char: string, correct: boolean, type: string) => {
    try {
      await api("/practice/char-record", {
        method: "POST",
        body: { char, correct, type },
      })
    } catch {
      setRecordSyncFailed(true)
    }
  }

  const submitPinyin = async () => {
    // 生成的字可能无拼音（LLM 未返回）→ 跳过拼音填空，不卡住流程
    if (!effectivePinyin) {
      setPinyinPassed(true)
      setMessage("无拼音，跳过拼音填空 ✓")
      return
    }
    const passed = isPinyinMatch(initial, medial, fin, tone, effectivePinyin)
    setPinyinPassed(passed)
    if (!passed) {
      const newErr = pinyinErr + 1
      setPinyinErr(newErr)
      setHintActivated(newErr >= MAX_ERRORS || pronErr >= MAX_ERRORS)
      setMessage("拼音填错了")
      await sendRecord(current.text, false, "pinyin")
    } else {
      setMessage("拼音正确 ✓ 还需要读音达标")
    }
  }

  const onPronScore = async (score: number) => {
    const passed = score >= PASS_SCORE
    setPronPassed(passed)
    if (passed) {
      if (pinyinPassed) {
        if (exampleWords.length > 0 || exampleSentence) {
          setMessage("单字达标 ✓ 还需读组词和句子（每项 ≥" + PASS_SCORE + "分）")
        } else {
          setMessage("✅ 回答正确！")
          setResults((r) => [...r, { char: current.text, isCorrect: true }])
        }
        await sendRecord(current.text, true, "pinyin")
        await sendRecord(current.text, true, "pronunciation")
      } else {
        setMessage("读音达标 ✓ 还需要填对拼音")
      }
    } else {
      const newErr = pronErr + 1
      setPronErr(newErr)
      setHintActivated(newErr >= MAX_ERRORS || pinyinErr >= MAX_ERRORS)
      setMessage(`发音得分: ${score}（需 ${PASS_SCORE} 分以上，再读一遍）`)
      await sendRecord(current.text, false, "pronunciation")
    }
  }

  const toggleRecord = async () => {
    if (soe.state.recording) {
      const score = await soe.stop()
      if (score !== null) await onPronScore(score)
      return
    }
    if (soe.state.evaluating) return
    setMessage("录音中...")
    await soe.start()
  }

  // ── 组词/句子评测：得分 ≥ PASS_SCORE 才标记通过 ──
  const onWordScore1 = async (score: number) => {
    const passed = score >= PASS_SCORE
    setWordPassed1(passed)
    setMessage(passed ? `组词「${exampleWords[0]}」达标 ✓` : `组词「${exampleWords[0]}」得分 ${score}（需 ${PASS_SCORE} 分）`)
    await sendRecord(current.text, passed, "word1")
  }
  const onWordScore2 = async (score: number) => {
    const passed = score >= PASS_SCORE
    setWordPassed2(passed)
    setMessage(passed ? `组词「${exampleWords[1]}」达标 ✓` : `组词「${exampleWords[1]}」得分 ${score}（需 ${PASS_SCORE} 分）`)
    await sendRecord(current.text, passed, "word2")
  }
  const onSentenceScore = async (score: number) => {
    const passed = score >= PASS_SCORE
    setSentencePassed(passed)
    setMessage(passed ? "句子朗读达标 ✓" : `句子得分 ${score}（需 ${PASS_SCORE} 分）`)
    await sendRecord(current.text, passed, "sentence")
  }

  // 通用：切换某套评测的录音
  const toggleEval = async (s: { state: { recording: boolean; evaluating: boolean }; start: () => Promise<boolean>; stop: () => Promise<number | null> }, onScore: (n: number) => Promise<void>) => {
    if (s.state.recording) {
      const score = await s.stop()
      if (score !== null) await onScore(score)
      return
    }
    if (s.state.evaluating) return
    setMessage("录音中...")
    await s.start()
  }

  const showHintAsync = async () => {
    if (!hintActivated || !current) return
    setMessage("加载提示...")
    try {
      const res = await api<{ words: string[] }>("/llm/word-suggestions", {
        method: "POST",
        body: { char: current.text },
        auth: false,
      })
      setHintContent({ words: res.words ?? [] })
      setShowHint(true)
      setMessage("")
    } catch (e) {
      setMessage(`获取提示失败: ${String((e as Error)?.message ?? e)}`)
    }
  }

  const nextQuestion = async () => {
    // 过关 = 拼音对 + 单字发音 + 存在的组词/句子 全部 ≥ PASS_SCORE
    const allPassed =
      pinyinPassed &&
      pronPassed &&
      (!exampleWords[0] || wordPassed1) &&
      (!exampleWords[1] || wordPassed2) &&
      (!exampleSentence || sentencePassed)
    if (!allPassed) {
      const missing: string[] = []
      if (!pinyinPassed) missing.push("拼音")
      if (!pronPassed) missing.push("单字读音")
      if (exampleWords[0] && !wordPassed1) missing.push(`组词「${exampleWords[0]}」`)
      if (exampleWords[1] && !wordPassed2) missing.push(`组词「${exampleWords[1]}」`)
      if (exampleSentence && !sentencePassed) missing.push("句子")
      setMessage(`还需要完成：${missing.join("、")}（每项 ≥${PASS_SCORE} 分）`)
      return
    }
    const next = index + 1
    if (next >= items.length) {
      setFinished(true)
    } else {
      setIndex(next)
      resetFields()
      setHintActivated(false)
      setShowHint(false)
      setHintContent(null)
      const hint = (await findWordContaining(items[next].text)) ?? items[next].text
      setTtsHint(hint)
    }
  }

  /** 今日字点选：直接跳到该字练习（不按固定顺序）；从选字页进入时关闭选字页 */
  const jumpToChar = (text: string) => {
    const idx = items.findIndex((e) => e.text === text)
    if (idx < 0) return
    setPickOpen(false)
    if (idx === index) return
    setIndex(idx)
    resetFields()
    setHintActivated(false)
    setShowHint(false)
    setHintContent(null)
    void (async () => {
      const hint = (await findWordContaining(items[idx].text)) ?? items[idx].text
      setTtsHint(hint)
    })()
  }

  if (loading) {
    return (
      <div className="page center-page">
        <p className="empty">加载题目…</p>
      </div>
    )
  }

  if (finished) {
    return (
      <div className="page center-card">
        <h1 style={{ fontSize: 22, color: "#000" }}>认字练习完成！</h1>
        <p className="module-hint">
          答对 {results.filter((r) => r.isCorrect).length} / {items.length}
        </p>
        {recordSyncFailed && <p className="err">部分练习记录未同步（断网）</p>}
        <button onClick={() => navigate(-1)}>返回</button>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="page center-card">
        <p className="empty">{message || "字库为空"}</p>
      </div>
    )
  }

  // 今日字选字页：不直接进入某个字的练习，点击一个字才开始练
  if (pickOpen && todayChars.length > 0) {
    return (
      <div className="page recognition-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>认字练习</h1>
          <span className="module-level">今日 {todayChars.length} 字</span>
        </header>
        <p className="module-hint">点选要练的字👇（<span style={{ color: "#15803d" }}>绿色=已通过</span>，灰色=未测）</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "8px 6px" }}>
          {todayChars.map((t, i) => {
            const idx = items.findIndex((e) => e.text === t)
            const hit = idx >= 0
            const passed = passedChars.has(t)
            return (
              <button key={`${t}-${i}`} disabled={!hit} onClick={() => jumpToChar(t)}
                title={hit ? (passed ? `已通过：「${t}」` : `练「${t}」`) : "词库未命中该字"}
                style={{
                  width: 72, height: 72, fontSize: 34, lineHeight: 1, position: "relative",
                  borderRadius: 14, cursor: hit ? "pointer" : "not-allowed",
                  border: `2px solid ${!hit ? "#e2e8f0" : passed ? "#22c55e" : "#cbd5e1"}`,
                  background: !hit ? "#f8fafc" : passed ? "#f0fdf4" : "#f1f5f9",
                  color: !hit ? "#cbd5e1" : passed ? "#15803d" : "#94a3b8",
                  boxShadow: hit && passed ? "0 2px 6px rgba(34,197,94,.20)" : "none",
                } as React.CSSProperties}>
                {t}
                {passed && <span style={{ position: "absolute", top: 3, right: 6, fontSize: 13 }}>✓</span>}
              </button>
            )
          })}
        </div>
        {todayChars.some((t) => !items.some((e) => e.text === t)) && (
          <p style={{ fontSize: 11, color: "#94a3b8", padding: "0 6px" }}>
            置灰的字不在词库中，无法练习（可在每日设置里调整）
          </p>
        )}
      </div>
    )
  }

  const isOverall = pinyinIsOverall(effectivePinyin)
  const zeroInit = pinyinZeroInit(effectivePinyin)
  const hasMedial = pinyinHasMedial(effectivePinyin)

  return (
    <div className="page recognition-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>认字练习</h1>
        {todayChars.length > 0 ? (
          <button className="btn-secondary btn-sm" onClick={() => setPickOpen(true)} title="返回选字">☰ 选字</button>
        ) : (
          <span className="module-level">第 {index + 1}/{items.length} 题</span>
        )}
      </header>

      <div className="recog-layout">
        <div className="recog-card">
          {/* 大字（写字标签字带四角关键信息：结构/笔画/部首/音序） */}
          <div className="recog-char-wrap">
            <div className="recog-char">{current.text}</div>
            {current.tags.includes("写字") && charInfo && (
              <>
                <span className="recog-corner recog-corner-tl">结构 {charInfo.structure}</span>
                <span className="recog-corner recog-corner-tr">笔画 {charInfo.stroke_count > 0 ? charInfo.stroke_count : "—"}</span>
                <span className="recog-corner recog-corner-bl">部首 {charInfo.radical}</span>
                <span className="recog-corner recog-corner-br">音序 {pinyinInitial(effectivePinyin) || "—"}</span>
              </>
            )}
          </div>
          {practiceCount > 0 && (
            <div className="recog-count">已练 {practiceCount} 次</div>
          )}
          {current.tags.filter((t) => t.includes("年级")).slice(0, 1).map((t) => (
            <div key={t} className="recog-grade">{t}</div>
          ))}
          {effectiveWordContext && <div className="recog-ctx">来自：{effectiveWordContext}</div>}

          {/* 字卡图 + 组词 + 句子（展示辅助） */}
          {(charImg || exampleWords.length > 0 || exampleSentence) && (
            <div className="recog-example">
              {charImg && (
                <div className="recog-media">
                  <img className="recog-charimg" src={charImg} alt={`${current.text} 字卡`} loading="lazy" />
                </div>
              )}

              {exampleWords.length > 0 && (
                <div className="recog-section">
                  <div className="recog-section-hd">
                    <span className="recog-ex-label">组词</span>
                    <span className="recog-section-tip">点击麦克风跟读</span>
                  </div>
                  <div className="recog-word-evals">
                    {exampleWords.map((w, wi) => {
                      const s = wi === 0 ? wordSoe1 : wordSoe2
                      const passed = wi === 0 ? wordPassed1 : wordPassed2
                      return (
                        <div key={w} className="recog-word-eval">
                          <span className="recog-word-chip">{w}</span>
                          <div className="recog-word-actions">
                            <button
                              className={`recog-eval-btn${s.state.recording ? " recording" : ""}`}
                              disabled={s.state.evaluating || passed}
                              onClick={() => void toggleEval(s, wi === 0 ? onWordScore1 : onWordScore2)}
                            >
                              {passed
                                ? `✓ ${s.state.score ?? PASS_SCORE}分`
                                : s.state.recording
                                  ? "⏹ 停止"
                                  : s.state.evaluating
                                    ? "评分中…"
                                    : "🎤 读"}
                            </button>
                            {!passed && s.state.score != null && (
                              <span className="recog-eval-score">总分 {s.state.score}分（需{PASS_SCORE}）</span>
                            )}
                          </div>
                          {/* 逐字得分明细（2字词 scene=sentence → 每字 Words） */}
                          {s.state.result && (
                            <div className="recog-soe-detail">
                              <SoeDetail result={s.state.result} sentenceTitle="逐字得分" />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {exampleSentence && (
                <div className="recog-section">
                  <div className="recog-section-hd">
                    <span className="recog-ex-label">句子</span>
                  </div>
                  <div className="recog-sentence-eval">
                    <span className="recog-sentence-text">{exampleSentence}</span>
                    <div className="recog-sentence-actions">
                      <button
                        className={`recog-eval-btn${sentenceSoe.state.recording ? " recording" : ""}`}
                        disabled={sentenceSoe.state.evaluating || sentencePassed}
                        onClick={() => void toggleEval(sentenceSoe, onSentenceScore)}
                      >
                        {sentencePassed
                          ? `✓ ${sentenceSoe.state.score ?? PASS_SCORE}分`
                          : sentenceSoe.state.recording
                            ? "⏹ 停止"
                            : sentenceSoe.state.evaluating
                              ? "评分中…"
                              : "🎤 读"}
                      </button>
                      {!sentencePassed && sentenceSoe.state.score != null && (
                        <span className="recog-eval-score">总分 {sentenceSoe.state.score}分（需{PASS_SCORE}）</span>
                      )}
                    </div>
                  </div>
                  {/* 逐字得分明细（eval_mode=1 返回每字 Words + 音素） */}
                  {sentenceSoe.state.result && (
                    <div className="recog-soe-detail">
                      <SoeDetail result={sentenceSoe.state.result} sentenceTitle="逐字得分" />
                      <div className="recog-soe-total">
                        总分 <b>{Math.round(sentenceSoe.state.result.pron_accuracy)}</b> 分
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 拼音填空 */}
          {isCorrect !== true && (
            <div className="pinyin-input-area">
              {effectivePinyin && (
                <>
                  {isOverall ? (
                    <input
                      className="py-input overall"
                      value={fin}
                      onChange={(e) => setFin(e.target.value)}
                      placeholder="输入拼音"
                    />
                  ) : zeroInit ? (
                    <input
                      className="py-input zero"
                      value={fin}
                      onChange={(e) => setFin(e.target.value)}
                      placeholder="拼音"
                    />
                  ) : (
                    <div className="py-row">
                      <input
                        className="py-input init"
                        value={initial}
                        onChange={(e) => setInitial(e.target.value)}
                        placeholder="声母"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) {
                            (hasMedial ? medialRef : finRef).current?.focus()
                          }
                        }}
                      />
                      {hasMedial && (
                        <input
                          ref={medialRef}
                          className="py-input medi"
                          value={medial}
                          onChange={(e) => setMedial(e.target.value)}
                          placeholder="介母"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) {
                              finRef.current?.focus()
                            }
                          }}
                        />
                      )}
                      <input
                        ref={finRef}
                        className="py-input fin"
                        value={fin}
                        onChange={(e) => setFin(e.target.value)}
                        placeholder="韵母"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) {
                            e.currentTarget.blur()
                          }
                        }}
                      />
                    </div>
                  )}

                  <div className="tone-row">
                    <span className="tone-label">声调:</span>
                    {[[1, "ˉ"], [2, "ˊ"], [3, "ˇ"], [4, "ˋ"], [5, "轻声"]].map(([num, label]) => (
                      <button
                        key={num}
                        className={`tone-btn${tone === num ? " active" : ""}`}
                        onClick={() => setTone(tone === num ? 0 : (num as number))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="action-row">
                <button
                  className="btn-secondary"
                  disabled={speaking}
                  onClick={() => speak(ttsHint || current.text, ttsHint ? undefined : { pinyin: effectivePinyin })}
                >
                  🔊 听发音
                </button>
                {soe.state.recording ? (
                  <button className="btn-danger" onClick={toggleRecord}>⏹ 停止</button>
                ) : (
                  <button className="btn-tertiary" disabled={soe.state.evaluating} onClick={toggleRecord}>
                    {soe.state.evaluating ? "评分中…" : "🎤 读字"}
                  </button>
                )}
                {hintActivated && !showHint && (
                  <button className="btn-secondary" onClick={showHintAsync}>💡 提示</button>
                )}
                <button className="btn-primary" onClick={submitPinyin} disabled={pinyinPassed || (!fin.trim() && !!effectivePinyin)}>
                  {pinyinPassed ? "拼音✓" : "提交拼音"}
                </button>
              </div>

              {showHint && hintContent && (
                <div className="hint-box">
                  <p>提示词语：{hintContent.words.join("、")}</p>
                </div>
              )}
            </div>
          )}

          {/* 状态 */}
          <div className="status-line">
            {isCorrect === true && <span className="status-ok">✅ 全部正确！</span>}
            {pinyinPassed && !pronPassed && <span className="status-warn">拼音正确 ✓ 还需读音达标</span>}
            {pronPassed && !pinyinPassed && <span className="status-warn">读音达标 ✓ 还需填对拼音</span>}
            {message && <span className="status-msg">{message}</span>}
            {soe.state.error && <span className="status-err">{soe.state.error}</span>}
          </div>

          <div className="nav-row">
            <button className="btn-secondary" onClick={resetFields}>重试</button>
            <button className="btn-primary" onClick={nextQuestion} disabled={isCorrect !== true}>
              下一题 →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function isPinyinMatch(initial: string, medial: string, fin: string, tone: number, stored: string): boolean {
  const correct = parsePinyin(stored)
  if (correct.isOverall) {
    return fin.trim().toLowerCase() === correct.final && tone === correct.tone
  }
  const initOk = correct.initial === "" ? true : initial.trim().toLowerCase() === correct.initial
  const medialOk = correct.medial === "" ? true : medial.trim().toLowerCase() === correct.medial
  const finalOk = fin.trim().toLowerCase() === correct.final
  return initOk && medialOk && finalOk && tone !== 0 && tone === correct.tone
}
