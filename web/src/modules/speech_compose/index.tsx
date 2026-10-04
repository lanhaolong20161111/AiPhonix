/** AI 对话学语文（SpeechComposePage）— 覆盖式多轮问答教学
 *
 * 设置 主题+考查词语/句子 → 后端 zh-teach-setup 生成逐题剧本（参考回答覆盖全部考查词/句）。
 * 每轮：AI 提问自动朗读（百度 6221）→ 6s 未作答自动逐级给提示并朗读（意思→例句→句型骨架，最多 3 级）
 * → 孩子**文本输入作答**（手机输入法可语音转文字）→ zh-teach-judge：
 *   对 → 朗读表扬 → 下一问；
 *   错 → 显示并朗读参考回答 → 孩子麦克风朗读测评参考句（EchoLadder 单级，16k_zh，≥70 过关）→ 下一问。
 * 全部题目完成后展示覆盖清单。
 */
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { TapCharText } from "../../components/TapCharText"
import { EchoLadder } from "../../components/EchoLadder"
import { SentenceNavRail } from "../../components/SentenceNavRail"
import { useTts } from "../../hooks/useTts"
import { zhTeachSetup, zhTeachJudge, type TeachScript, type TeachItem } from "../../services/zhTeach"
import { zhPoemSetup, zhPoemSummary, zhPoemSearch, type PoemScript, type PoemLine, type PoemSearchHit } from "../../services/zhPoem"
import { articleReciteSetup } from "../../services/zhRecite"
import { splitSentences, mergeShorts, type ArticleLine } from "../../lib/articleSplit"

type Stage = "setup" | "question" | "judging" | "finished"
const SIX_SECONDS = 6000
/** 古诗模块朗读音色：百度 度逍遥（per=3），更有诗词朗诵感 */
const POEM_VOICE = "3"

export function SpeechComposePage() {
  const navigate = useNavigate()
  const { speak, speakChar, warm } = useTts()

  // 设置
  const [topic, setTopic] = useState("")
  const [wordsText, setWordsText] = useState("")
  const [sentencesText, setSentencesText] = useState("")
  const [poemText, setPoemText] = useState("")
  // 小学古诗库搜索（标题搜 → 一键填入原文）
  const [poemQuery, setPoemQuery] = useState("")
  const [poemHits, setPoemHits] = useState<PoemSearchHit[]>([])
  const [poemSearching, setPoemSearching] = useState(false)
  const [poemPicked, setPoemPicked] = useState("")
  /** 选中的库内古诗元信息（朝代/作者），用于标题栏与讲解来源显示 */
  const [poemMeta, setPoemMeta] = useState<{ title: string; dynasty: string; author: string } | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState("")
  const [waitSec, setWaitSec] = useState(0)

  // ── 古诗模式 ──
  const [poem, setPoem] = useState<PoemScript | null>(null)
  const [poemIdx, setPoemIdx] = useState(0)
  /** 已跟读测评过关（≥70）的诗句下标 → 右侧导航小圆圈亮起 */
  const [poemEvaluated, setPoemEvaluated] = useState<Set<number>>(new Set())
  const [poemIntroDone, setPoemIntroDone] = useState(false)
  const [charTip, setCharTip] = useState<{ c: string; m: string } | null>(null)
  const [ttsBusy, setTtsBusy] = useState(false) // 任意古诗 TTS 进行中（点击即时反馈 + 防竞态）
  const [evalBusy, setEvalBusy] = useState(false) // 测评（朗读/录音）中 → 禁点 TTS
  const poemBusyRef = useRef(false)
  /** 「古诗学完啦」祝贺词已朗读过（每首诗只自动读一次，防重复渲染重复读） */
  const congratsSpokenRef = useRef(false)
  const poemLine: PoemLine | null = poem?.lines[poemIdx] ?? null

  // ── 文章模式（粘贴文章 → 逐句朗读 + 跟读测评 + LLM 背诵提示）──
  const [articleText, setArticleText] = useState("")
  const [article, setArticle] = useState<ArticleLine[] | null>(null)
  const [artIdx, setArtIdx] = useState(0)
  /** 已跟读测评过关（≥70）的句子下标 → 右侧导航小圆圈亮起 */
  const [artEvaluated, setArtEvaluated] = useState<Set<number>>(new Set())
  /** 当前句 TTS 领读完成，可以开始跟读测评 */
  const [artReady, setArtReady] = useState(false)
  /** 背诵提示（缩写）生成中 */
  const [shortsLoading, setShortsLoading] = useState(false)
  const artBusyRef = useRef(false)
  const artCongratsRef = useRef(false)

  // 剧本
  const [script, setScript] = useState<TeachScript | null>(null)
  const [units, setUnits] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const item: TeachItem | null = script?.items[idx] ?? null

  const [stage, setStage] = useState<Stage>("setup")

  // ── 小学古诗库搜索：300ms 防抖调后端数据匹配（纯数据不走 LLM） ──
  useEffect(() => {
    const q = poemQuery.trim()
    if (!q) {
      setPoemHits([])
      setPoemSearching(false)
      return
    }
    setPoemSearching(true)
    const t = setTimeout(() => {
      void zhPoemSearch(q)
        .then((hits) => setPoemHits(hits))
        .catch(() => setPoemHits([]))
        .finally(() => setPoemSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [poemQuery])

  /** 选中库中古诗 → 自动填入原文（清搜索结果，保留提示） */
  const pickPoem = (h: PoemSearchHit) => {
    setPoemText(h.text)
    setPoemQuery("")
    setPoemHits([])
    setPoemPicked(`已选《${h.title}》 ${h.dynasty}·${h.author}`)
    setPoemMeta({ title: h.title, dynasty: h.dynasty, author: h.author })
    setSetupError("")
  }

  // 作答区
  const [answer, setAnswer] = useState("")
  // 当前题判定结果（ok=表扬后可下一问；no=先测评后下一问）
  const [judge, setJudge] = useState<{ ok: boolean; praise: string; correct: string } | null>(null)
  const [echoOpen, setEchoOpen] = useState(false)
  const [echoDone, setEchoDone] = useState(false)
  // 未作答自动提示
  const [hintLvl, setHintLvl] = useState(0)
  const [hintTip, setHintTip] = useState("")
  const hintLvlRef = useRef(0)
  const lastActRef = useRef(0)

  // 覆盖统计（考查单位）
  const [covered, setCovered] = useState<Set<string>>(new Set())

  const talkSpeak = async (t: string) => {
    if (!t.trim()) return
    await speak(t, { speaker: "6221" })
  }

  const markCovered = (focus: string) => {
    setCovered((prev) => {
      const next = new Set(prev)
      if (focus) next.add(focus)
      return next
    })
  }

  /** 标记某句文章已测评过关（右侧导航小圆圈亮起） */
  const markArtEvaluated = (i: number) => {
    setArtEvaluated((prev) => {
      if (prev.has(i)) return prev
      const next = new Set(prev)
      next.add(i)
      return next
    })
  }

  /** 标记某句古诗已测评过关（右侧导航小圆圈亮起） */
  const markPoemEvaluated = (i: number) => {
    setPoemEvaluated((prev) => {
      if (prev.has(i)) return prev
      const next = new Set(prev)
      next.add(i)
      return next
    })
  }

  // ── 古诗朗读（全部走 speaker=3；串行 + 忙碌锁，避免多个 TTS 竞态） ──
  /** 硬超时：底层播放 promise 万一不返回（浏览器差异），也不让流程卡死 */
  const withTimeout = <T,>(p: Promise<T>, ms = 12_000): Promise<T | void> =>
    Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])

  /** 古诗朗读参数：给了逐字拼音就锁读（多音字读对，如「石径斜」的斜 xie2），否则交给百度默认 */
  const poemSpeakOpts = (pinyin?: string) =>
    pinyin && pinyin.trim()
      ? { speaker: POEM_VOICE, pinyin, polyphoneOnly: false, avoidPregen: true }
      : { speaker: POEM_VOICE }

  const speakPoem = async (t: string, pinyin?: string) => {
    if (!t.trim() || poemBusyRef.current || evalBusy) return
    poemBusyRef.current = true
    setTtsBusy(true)
    try {
      await withTimeout(speak(t, poemSpeakOpts(pinyin)))
    } finally {
      poemBusyRef.current = false
      setTtsBusy(false)
    }
  }

  /** 单字点读：先读这个字（指定音色+该字读音），紧接着读这个字的意思 */
  const tapPoemChar = async (c: string, m: string, p?: string) => {
    if (poemBusyRef.current || evalBusy) return
    setCharTip(p ? { c, m: `${p}｜${m}` } : { c, m })
    poemBusyRef.current = true
    setTtsBusy(true)
    try {
      // 单字也带读音：百度对孤立字的默认读音并不可靠（如「斜」会读成古音 xiá）
      await withTimeout(speak(c, poemSpeakOpts(p)))
      if (m) await withTimeout(speak(m, { speaker: POEM_VOICE }))
    } finally {
      poemBusyRef.current = false
      setTtsBusy(false)
    }
  }

  /** 预取：当前句在播时，后台先把下一句原文+白话合成好（点击即读，减少等待感） */
  const warmPoemNext = (i: number) => {
    const nx = poem?.lines[i + 1]
    if (!nx) return
    void warm(nx.verse, poemSpeakOpts(nx.pinyin))
    void warm(nx.meaning, { speaker: POEM_VOICE })
  }

  /** 进入某一句古诗：先读原文，再读白话意思；读完才出现测评 */
  const enterPoemVerse = async (i: number) => {
    setPoemIdx(i)
    setCharTip(null)
    setEvalBusy(true) // 原文/白话朗读期间禁点其它 TTS
    poemBusyRef.current = true
    setTtsBusy(true)
    try {
      const l = poem?.lines[i]
      if (l) {
        await withTimeout(speak(l.verse, poemSpeakOpts(l.pinyin)))
        await withTimeout(speak(l.meaning, { speaker: POEM_VOICE }))
      }
    } finally {
      poemBusyRef.current = false
      setTtsBusy(false)
      setEvalBusy(false)
    }
    warmPoemNext(i) // 后台预取下一句
  }

  /** 古诗模式入口：先用原文切句**立即开始**（不等 LLM），讲解/白话在后台生成好后原地补上 */
  const startPoem = async () => {
    const raw = poemText.trim()
    setSetupError("")
    const segs = (raw.match(/[^，。！？；：\n]+[，。！？；：]?/g) ?? []).map((s) => s.trim()).filter(Boolean)
    if (!segs.length) {
      setSetupError("请先粘贴要练的古诗原文")
      return
    }
    const meta = poemMeta // 库内选中时已有确定的题目/朝代/作者，先显示，不等 LLM
    const local: PoemScript = {
      title: meta?.title || "古诗练习",
      summary: "",
      dynasty: meta?.dynasty,
      author: meta?.author,
      lines: segs.map((v) => ({ verse: v, meaning: "", chars: [] })),
      fallback: true,
    }
    setPoem(local)
    setPoemIdx(0)
    setPoemEvaluated(new Set()) // 新古诗：清空测评标记
    setPoemIntroDone(false) // 先听"整篇古诗 + 全诗概括"，听完才进入逐句测评
    setStage("question") // 离开 setup 界面（否则第 320 行 stage==="setup" 恒真，古诗界面永远不渲染）

    // 快速概括（题目+概括+全诗逐字拼音，1~3s）：整篇朗读前先拿它的拼音，锁住多音字读音
    const summaryPromise = zhPoemSummary(raw)
      .then((s) => {
        if (s?.summary) setPoem((prev) => (prev ? { ...prev, title: s.title || prev.title, summary: prev.summary || s.summary } : prev))
        return s
      })
      .catch(() => null)

    // 后台生成完整讲解（逐句白话/逐字释义/逐字拼音）；成功后原地合并，失败保持原文练习可用
    void (async () => {
      try {
        const p = await zhPoemSetup(raw)
        setPoem((prev) => {
          if (!prev) return prev
          // 匹配键去掉标点/空白：LLM 与本地切句的标点常不一致（如「，」丢/换），否则整篇对不上
          const keyOf = (s: string) => s.replace(/[^\u4e00-\u9fff0-9a-zA-Z]/g, "")
          const zhMap = new Map(p.lines.filter((l) => keyOf(l.verse)).map((l) => [keyOf(l.verse), l] as const))
          const sameLen = p.lines.length === prev.lines.length
          return {
            title: prev.title !== "古诗练习" ? prev.title : p.title || prev.title,
            summary: p.summary || prev.summary,
            dynasty: prev.dynasty,
            author: prev.author,
            lines: prev.lines.map((l, li) => {
              // ① 去标点后按原文匹配；② 对不上但句数一致时按下标兜底（切句方式不同也能补上）
              const hit = zhMap.get(keyOf(l.verse)) ?? (sameLen ? p.lines[li] : undefined)
              if (!hit) return l
              return {
                ...l,
                verse: l.verse,
                pinyin: l.pinyin || hit.pinyin || "",
                meaning: hit.meaning || l.meaning,
                chars: hit.chars?.length ? hit.chars : l.chars,
              }
            }),
            fallback: false,
          }
        })
      } catch {
        /* 讲解生成失败：保持原文练习可用，不报错打断 */
      }
    })()

    // 开场：先朗读整篇古诗（有全诗拼音则锁读多音字），再读全诗概括，然后才逐句
    setEvalBusy(true)
    poemBusyRef.current = true
    setTtsBusy(true)
    try {
      // 概括端点很快（1~3s）；最多等 3s 拿它的全诗拼音，让"整篇朗读"的读音也正确
      const s = await Promise.race([summaryPromise, new Promise<null>((r) => setTimeout(() => r(null), 3_000))])
      await withTimeout(speak(raw, poemSpeakOpts(s?.pinyin)), 40_000).catch(() => { /* 朗读失败不阻塞流程 */ })
      if (s?.summary) await withTimeout(speak(s.summary, { speaker: POEM_VOICE }), 20_000).catch(() => { /* 同上 */ })
    } finally {
      poemBusyRef.current = false
      setTtsBusy(false)
      setEvalBusy(false)
    }
    setPoemIntroDone(true)
    void enterPoemVerse(0)
  }

  // ── 文章练习 ──
  /** 朗读一句文章（全站默认音色 6221；串行 + 忙碌锁，防竞态） */
  const speakArticle = async (t: string) => {
    if (!t.trim() || artBusyRef.current || evalBusy) return
    artBusyRef.current = true
    setTtsBusy(true)
    try {
      await withTimeout(speak(t), 30_000)
    } finally {
      artBusyRef.current = false
      setTtsBusy(false)
    }
  }

  /** 进入某一句：先 TTS 领读该句，读完再出现跟读测评（一句一轮） */
  const enterArticleSentence = async (items: ArticleLine[], i: number) => {
    if (i >= items.length) {
      setArtIdx(i) // 越界 = 全部完成，交给完成分支
      return
    }
    setArtIdx(i)
    setArtReady(false)
    setEvalBusy(true)
    artBusyRef.current = true
    setTtsBusy(true)
    try {
      const sent = items[i]?.text
      if (sent) await withTimeout(speak(sent), 30_000)
    } finally {
      artBusyRef.current = false
      setTtsBusy(false)
      setEvalBusy(false)
    }
    setArtReady(true)
  }

  /** 开始文章练习：本地切句**立即**进入；每句的「背诵缩写」后台生成后原地合并 */
  const startArticle = async () => {
    const raw = articleText.trim()
    setSetupError("")
    const segs = splitSentences(raw)
    if (!segs.length) {
      setSetupError("没有识别到句子，请检查文章内容")
      return
    }
    const lines: ArticleLine[] = segs.map((text) => ({ text, short: "" }))
    setArticle(lines)
    setArtIdx(0)
    setArtReady(false)
    setArtEvaluated(new Set()) // 新文章：清空测评标记
    artCongratsRef.current = false
    setStage("question") // 离开 setup 界面

    setShortsLoading(true)
    void articleReciteSetup(segs)
      .then((items) => setArticle(mergeShorts(segs, items)))
      .catch(() => { /* 缩写生成失败：保持无缩写可练，不打断 */ })
      .finally(() => setShortsLoading(false))

    void enterArticleSentence(lines, 0)
  }

  /** 文章全部读完的祝贺朗读（串行） */
  const speakArticleCompletion = async () => {
    if (artBusyRef.current) return
    artBusyRef.current = true
    setTtsBusy(true)
    try {
      await withTimeout(speak(`全部 ${article?.length ?? 0} 句都读完啦！真棒！`))
    } finally {
      artBusyRef.current = false
      setTtsBusy(false)
    }
  }

  // 文章全部读完 → 自动朗读一次祝贺（每篇只读一次）
  useEffect(() => {
    if (!article || artIdx < article.length || artCongratsRef.current) return
    artCongratsRef.current = true
    void speakArticleCompletion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, artIdx])

  // ── 生成剧本 ──
  const handleSetup = async () => {
    // 填了文章 → 走文章练习模式
    if (articleText.trim()) {
      await startArticle()
      return
    }
    // 填了古诗 → 走古诗练习模式
    if (poemText.trim()) {
      await startPoem()
      return
    }
    const words = wordsText.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean)
    const sentences = sentencesText.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    if (!words.length && !sentences.length && !topic.trim()) {
      setSetupError("请输入至少一个要练的词 / 句子，或主题（也可以填一首古诗）")
      return
    }
    setSettingUp(true)
    setSetupError("")
    try {
      const sc = await zhTeachSetup(topic.trim(), words, sentences)
      if (!sc.items?.length) throw new Error("AI 没有生成题目，请稍后重试")
      setScript(sc)
      setUnits([...words, ...sentences])
      setIdx(0)
      setStage("question")
      setAnswer("")
      setJudge(null)
      setEchoOpen(false)
      setEchoDone(false)
      setHintLvl(0)
      setHintTip("")
      setCovered(new Set())
      hintLvlRef.current = 0
      lastActRef.current = Date.now()
      if (sc.items[0]?.q) void talkSpeak(sc.items[0].q)
    } catch (e) {
      setSetupError(`生成失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setSettingUp(false)
    }
  }

  // 切题重置
  const enterQuestion = (nextIdx: number) => {
    setIdx(nextIdx)
    setStage("question")
    setAnswer("")
    setJudge(null)
    setEchoOpen(false)
    setEchoDone(false)
    setHintLvl(0)
    setHintTip("")
    hintLvlRef.current = 0
    lastActRef.current = Date.now()
    const q = script?.items[nextIdx]?.q
    if (q) void talkSpeak(q)
  }

  // 出题等待计时（让"AI 出题中…"看得见进度，不像卡死）
  useEffect(() => {
    if (!settingUp) {
      setWaitSec(0)
      return
    }
    const id = window.setInterval(() => setWaitSec((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [settingUp])

  // 6s 未作答 → 逐级提示并朗读（意思 → 例句 → 句型骨架）
  useEffect(() => {
    if (stage !== "question" || !item || judge || echoOpen) return
    const id = window.setInterval(() => {
      const hints = item.hints ?? []
      if (hintLvlRef.current < hints.length && Date.now() - lastActRef.current >= SIX_SECONDS) {
        const h = hints[hintLvlRef.current]
        hintLvlRef.current += 1
        setHintLvl(hintLvlRef.current)
        setHintTip(h)
        void talkSpeak(h)
        lastActRef.current = Date.now()
      }
    }, 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, idx, item, judge, echoOpen])

  // 提交作答
  const submit = async () => {
    if (!item || !answer.trim() || stage !== "question" || judge) return
    setStage("judging")
    lastActRef.current = Date.now()
    try {
      const res = await zhTeachJudge(item.q, item.ref, answer.trim())
      setJudge(res)
      if (res.ok) {
        markCovered(item.focus)
        await talkSpeak(res.praise || "真棒！")
        setStage("question")
      } else {
        // 先显示并朗读参考回答，再进入麦克风测评
        if (res.correct) await talkSpeak(res.correct)
        setEchoOpen(true)
        setStage("question")
      }
    } catch {
      setJudge({ ok: false, praise: "评分出错了，再试一次。", correct: "" })
      setStage("question")
    }
  }

  // 测评过关（错句 ≥70）→ 记覆盖，可下一问
  const onEchoFinished = () => {
    if (item) markCovered(item.focus)
    setEchoOpen(false)
    setEchoDone(true)
  }

  const gotoNext = () => {
    const next = idx + 1
    if (next < (script?.items.length ?? 0)) enterQuestion(next)
    else setStage("finished")
  }

  const backToSetup = () => {
    setScript(null)
    setPoem(null)
    setPoemIntroDone(false)
    setPoemIdx(0)
    setPoemEvaluated(new Set())
    setCharTip(null)
    setArticle(null)
    setArticleText("")
    setArtIdx(0)
    setArtReady(false)
    setArtEvaluated(new Set())
    setShortsLoading(false)
    artCongratsRef.current = false
    setStage("setup")
    setTopic("")
    setWordsText("")
    setSentencesText("")
    setPoemText("")
    setPoemPicked("")
    setPoemMeta(null)
    congratsSpokenRef.current = false // 换一首诗 → 允许再自动读祝贺词
  }

  // ── 古诗全部读完：朗读祝贺词 + 白话概括（孩子还不识字，光显示等于没反馈） ──
  const poemTotal = poem?.lines.length ?? 0
  const poemAllDone = !!poem && poemTotal > 0 && poemIdx >= poemTotal

  /** 用诗词音色（度逍遥）读「《题》全部 N 句都读完啦！」＋ 白话概括；串行，忙碌期不重入 */
  const speakPoemCompletion = async () => {
    if (!poem || poemBusyRef.current) return
    poemBusyRef.current = true
    setTtsBusy(true)
    try {
      await withTimeout(speak(`《${poem.title}》全部 ${poem.lines.length} 句都读完啦！真棒！`, { speaker: POEM_VOICE }))
      if (poem.summary.trim()) await withTimeout(speak(poem.summary, { speaker: POEM_VOICE }))
    } finally {
      poemBusyRef.current = false
      setTtsBusy(false)
    }
  }

  useEffect(() => {
    if (!poemAllDone || congratsSpokenRef.current) return
    congratsSpokenRef.current = true // 先落标记：避免 StrictMode 双挂载/重复渲染读两遍
    void speakPoemCompletion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poemAllDone])

  // ── 设置界面 ──
  if (stage === "setup" || (!script && !poem && !article)) {
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>🤖 AI 对话学语文</h1>
        </header>
        <div className="card" style={{ padding: 16 }}>
          <p className="module-hint">
            先告诉 AI 主题和要练的词语/句子，它会出好多道题带你一问一答，把每个词的意思和用法都练到。每题你都可以**打字或用输入法语音**回答。
            想练背诵？把**整篇课文/段落粘贴到下面的「要练的文章」**，就会带你一句一句朗读 + 跟读测评，还给每句配一个背诵提示。
          </p>
          <label style={{ fontWeight: 700 }}>主题 / 场景（可选，不填 AI 自动决定）</label>
          <input
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px" }}
            placeholder="如：春天的公园 / 我的周末"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>要练的词语（逗号或空格分隔）</label>
          <input
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px" }}
            placeholder="如：快乐、颜色、跑步"
            value={wordsText}
            onChange={(e) => setWordsText(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>要练的句子（每行一句，可选）</label>
          <textarea
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px", minHeight: 64, resize: "vertical" }}
            placeholder={"如：我喜欢和好朋友一起玩。\n公园里的花真漂亮！"}
            value={sentencesText}
            onChange={(e) => setSentencesText(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>要练的文章（可选，填了就练文章：按句朗读 + 跟读测评 + 背诵提示）</label>
          <textarea
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px", minHeight: 96, resize: "vertical" }}
            placeholder={"把要背的课文/段落整段粘贴进来，如：\n秋天的雨，是一把钥匙。它带着清凉和温柔，轻轻地，轻轻地，趁你没留意，把秋天的大门打开了。"}
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
          />
          {poemPicked && (
            <p style={{ margin: "0 0 8px", color: "#0a7d43", fontWeight: 700 }}>✅ {poemPicked}，可直接点「开始学」</p>
          )}
          <label style={{ fontWeight: 700 }}>🔍 搜小学古诗（输入诗题或作者，选一条自动填入）</label>
          <input
            className="text-input"
            style={{ width: "100%", margin: "6px 0 6px" }}
            placeholder="如：静夜思 / 望庐山瀑布 / 李白"
            value={poemQuery}
            onChange={(e) => setPoemQuery(e.target.value)}
          />
          {poemSearching && <p style={{ margin: "0 0 8px", color: "#666" }}>搜索中…</p>}
          {poemHits.length > 0 && (
            <div style={{ margin: "0 0 10px", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
              {poemHits.map((h, i) => (
                <button
                  key={`${h.title}-${h.author}-${i}`}
                  onClick={() => pickPoem(h)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
                    background: i % 2 ? "#f8fafc" : "#fff", border: "none", borderBottom: i < poemHits.length - 1 ? "1px solid #eef2f7" : "none",
                    cursor: "pointer", fontSize: 15,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 16 }}>《{h.title}》</b>
                    <span style={{ color: "#0a7d43", fontWeight: 600, fontSize: 14 }}>{h.dynasty}·{h.author}</span>
                  </span>
                  <span style={{ display: "block", color: "#64748b", fontSize: 13, marginTop: 3 }}>{h.text.split("\n")[0]}</span>
                </button>
              ))}
            </div>
          )}
          <label style={{ fontWeight: 700 }}>要练的古诗（可选，填了就练古诗）</label>
          <textarea
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px", minHeight: 72, resize: "vertical" }}
            placeholder={"如：床前明月光，疑是地上霜。\n举头望明月，低头思故乡。"}
            value={poemText}
            onChange={(e) => {
              setPoemText(e.target.value)
              if (poemPicked) setPoemPicked("")
              if (poemMeta) setPoemMeta(null) // 手改原文后不再认定是库里那首（作者/题目提示同步撤掉）
            }}
          />
          {setupError && <p className="err">{setupError}</p>}
          <button className="btn-primary" style={{ width: "100%" }} disabled={settingUp} onClick={() => void handleSetup()}>
            {settingUp ? `AI 出题中… ${waitSec}s（超过 60 秒会自动用原文先开始）` : "✨ 开始学"}
          </button>
        </div>
      </div>
    )
  }

  // ── 古诗界面 ──
  if (poem) {
    const ttsBlocked = ttsBusy || evalBusy // 朗读/评测中：禁点 TTS（含单字）
    if (poemIdx >= poemTotal) {
      return (
        <div className="page aihomework-page">
          <header className="module-header">
            <button className="back-btn" onClick={backToSetup}>←</button>
            <h1>🎉 古诗学完啦</h1>
          </header>
          <div className="card" style={{ padding: 16 }}>
            <p className="talk-feedback-praise">《{poem.title}》全部 {poemTotal} 句都读完啦！</p>
            {poem.summary && <p className="module-hint">{poem.summary}</p>}
            <button
              className="btn-secondary"
              style={{ width: "100%", marginBottom: 8 }}
              disabled={ttsBusy}
              onClick={() => void speakPoemCompletion()}
            >
              {ttsBusy ? "🔊 朗读中…" : "🔊 再听一遍祝贺"}
            </button>
            <button className="btn-primary" style={{ width: "100%" }} onClick={backToSetup}>🔁 再练一首</button>
          </div>
        </div>
      )
    }
    return (
      <div className="page aihomework-page has-sentence-nav">
        <header className="module-header">
          <button className="back-btn" onClick={backToSetup}>←</button>
          <h1>📜 {poem.title}</h1>
          <span style={{ fontSize: 13, color: "#536471" }}>第 {poemIdx + 1}/{poemTotal} 句</span>
        </header>

        {/* 右侧诗句导航：小圆圈对应每句，测评过亮起，点圈跳到那句 */}
        <SentenceNavRail
          total={poemTotal}
          current={poemIdx}
          evaluated={poemEvaluated}
          onJump={(i) => void enterPoemVerse(i)}
          disabled={ttsBlocked}
        />
        {(poem.dynasty || poem.author) && (
          <p style={{ margin: "2px 4px 0", fontSize: 14, color: "#0a7d43", fontWeight: 600 }}>
            {poem.dynasty}{poem.dynasty && poem.author ? "·" : ""}{poem.author}
          </p>
        )}

        {/* 上面：古诗原文（单字可点：先读字，再读字义） */}
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <div style={{ fontSize: 20, lineHeight: 1.9, fontWeight: 700, color: "#0f1419" }}>
            {poem.lines.map((l, li) => {
              // 逐字拼音兜底：LLM 逐字释义没到时，也能用整句拼音索引到每个字的读音
              const pys = l.pinyin ? l.pinyin.trim().split(/\s+/).filter(Boolean) : []
              let cjk = 0
              return (
                <div key={li} style={li === poemIdx ? { background: "#fff8e1", borderRadius: 8, padding: "2px 6px" } : { opacity: 0.6 }}>
                  {[...l.verse].map((ch, ci) => {
                    if (!/[\u4e00-\u9fff]/.test(ch)) return <span key={ci}>{ch}</span>
                    const info = l.chars[cjk] ?? null
                    const py = info?.p || pys[cjk] || ""
                    cjk += 1
                    return (
                      <span
                        key={ci}
                        role="button"
                        tabIndex={0}
                        onClick={() => { if (!ttsBlocked) void tapPoemChar(ch, info?.m ?? "", py) }}
                        onKeyDown={(e) => { if (!ttsBlocked && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); void tapPoemChar(ch, info?.m ?? "", py) } }}
                        style={{ cursor: ttsBlocked ? "default" : "pointer", padding: "0 1px" }}
                      >
                        {ch}
                      </span>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <p className="module-hint" style={{ margin: "6px 0 0", fontSize: 12 }}>👆 点任意一个字：听读音 + 讲意思</p>
        </div>

        {/* 下面：解释（白话意思 + 点到的字义） */}
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <p className="module-hint" style={{ marginTop: 0 }}>📖 解释</p>
          {poemLine?.meaning
            ? <p style={{ fontSize: 16, fontWeight: 600, color: "#1b5e20", margin: "4px 0" }}>{poemLine.meaning}</p>
            : <p className="module-hint" style={{ margin: "4px 0" }}>（这句的白话意思还在生成，先跟 AI 读一遍）</p>}
          {charTip && (
            <p style={{ fontSize: 15, color: "#e65100", margin: "4px 0" }}>
              「{charTip.c}」：{charTip.m}
            </p>
          )}
          {ttsBusy && <p className="speech-completing">🔊 朗读中…</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <button className="btn-secondary btn-sm" disabled={ttsBlocked} onClick={() => poemLine && void speakPoem(poemLine.verse, poemLine.pinyin)}>🔊 读原文</button>
            <button className="btn-secondary btn-sm" disabled={ttsBlocked || !poemLine?.meaning} onClick={() => poemLine && void speakPoem(poemLine.meaning)}>🔊 读意思</button>
            <button className="btn-secondary btn-sm" disabled={ttsBlocked || !poem.summary} onClick={() => void speakPoem(poem.summary)}>🔊 全诗概括</button>
          </div>
        </div>

        {/* 逐句测评：读完原文+白话后出现（先听后评，≥70 进下一句） */}
        {poemIntroDone && !ttsBusy && poemLine && (
          <EchoLadder
            key={poemIdx}
            sentence={poemLine.verse}
            chunks={[poemLine.verse]}
            engine="16k_zh"
            speaker={POEM_VOICE}
            praise="读得真好！"
            autoReadFirst={false}
            source="zh_poem_echo"
            onBusyChange={setEvalBusy}
            onFinished={() => { markPoemEvaluated(poemIdx); void enterPoemVerse(poemIdx + 1) }}
            // 「跳过」必须接上：不接时按钮点了毫无反应（原来的 bug）
            onSkip={() => void enterPoemVerse(poemIdx + 1)}
          />
        )}
      </div>
    )
  }

  // ── 文章练习界面 ──
  if (article) {
    const total = article.length
    const ttsBlocked = ttsBusy || evalBusy // 朗读/评测中：禁点 TTS 与跳句
    if (artIdx >= total) {
      return (
        <div className="page aihomework-page">
          <header className="module-header">
            <button className="back-btn" onClick={backToSetup}>←</button>
            <h1>🎉 文章背完啦</h1>
          </header>
          <div className="card" style={{ padding: 16 }}>
            <p className="talk-feedback-praise">全部 {total} 句都跟读完成！</p>
            <button
              className="btn-secondary"
              style={{ width: "100%", marginBottom: 8 }}
              disabled={ttsBusy}
              onClick={() => void speakArticleCompletion()}
            >
              {ttsBusy ? "🔊 朗读中…" : "🔊 再听一遍祝贺"}
            </button>
            <button className="btn-primary" style={{ width: "100%" }} onClick={backToSetup}>🔁 再练一篇</button>
          </div>
        </div>
      )
    }
    const cur = article[artIdx]
    return (
      <div className="page aihomework-page has-sentence-nav">
        <header className="module-header">
          <button className="back-btn" onClick={backToSetup}>←</button>
          <h1>📖 文章背诵</h1>
          <span style={{ fontSize: 13, color: "#536471" }}>第 {artIdx + 1}/{total} 句</span>
        </header>

        {/* 右侧句子导航：小圆圈对应每句，测评过亮起，点圈跳到那句 */}
        <SentenceNavRail
          total={total}
          current={artIdx}
          evaluated={artEvaluated}
          onJump={(i) => void enterArticleSentence(article, i)}
          disabled={ttsBlocked}
        />

        {/* 全文逐句：当前句高亮，每句下方是 LLM 缩写（背诵框架），右侧喇叭可单独听 */}
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <p className="module-hint" style={{ marginTop: 0 }}>
            📚 全文{shortsLoading ? "（正在生成背诵提示…）" : ""}· 点句子可跳到那句
          </p>
          {article.map((it, i) => (
            <div
              key={i}
              onClick={() => { if (!ttsBlocked) void enterArticleSentence(article, i) }}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                marginBottom: 4,
                cursor: ttsBlocked ? "default" : "pointer",
                background: i === artIdx ? "#fff8e1" : "transparent",
                opacity: i === artIdx ? 1 : 0.72,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ flex: 1, fontSize: 17, lineHeight: 1.8, fontWeight: i === artIdx ? 700 : 400 }}>{it.text}</span>
                <button
                  className="btn-secondary btn-sm"
                  disabled={ttsBlocked}
                  onClick={(e) => { e.stopPropagation(); void speakArticle(it.text) }}
                >
                  🔊
                </button>
              </div>
              {it.short
                ? <div style={{ marginTop: 2, fontSize: 13, color: "#0a7d43", fontWeight: 600 }}>🧠 {it.short}</div>
                : (shortsLoading && i === artIdx
                  ? <div className="module-hint" style={{ marginTop: 2, fontSize: 12 }}>🧠 背诵提示生成中…</div>
                  : null)}
            </div>
          ))}
        </div>

        {/* 当前句：原文 + 背诵框架 + 喇叭；下面接跟读测评（一句一轮） */}
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <p className="module-hint" style={{ marginTop: 0 }}>🎯 这一句</p>
          <p style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.9, margin: "4px 0" }}>{cur.text}</p>
          {cur.short && (
            <p style={{ fontSize: 14, color: "#0a7d43", fontWeight: 600, margin: "4px 0" }}>🧠 背诵框架：{cur.short}</p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <button className="btn-secondary btn-sm" disabled={ttsBlocked} onClick={() => void speakArticle(cur.text)}>🔊 读这句</button>
          </div>
          {ttsBusy && <p className="speech-completing">🔊 朗读中…</p>}
        </div>

        {/* 跟读测评：AI 领读完成后出现（先听后评，≥70 进下一句） */}
        {artReady && !ttsBusy && (
          <EchoLadder
            key={artIdx}
            sentence={cur.text}
            chunks={[cur.text]}
            engine="16k_zh"
            speaker="6221"
            praise="这句读得真好！"
            autoReadFirst={false}
            source="zh_article_echo"
            onBusyChange={setEvalBusy}
            onFinished={() => { markArtEvaluated(artIdx); void enterArticleSentence(article, artIdx + 1) }}
            onSkip={() => void enterArticleSentence(article, artIdx + 1)}
          />
        )}
      </div>
    )
  }

  // 到这里只剩"词语/句子教学"模式；script 必然存在（上面 setup / poem 分支已返回）
  if (!script) return null

  if (stage === "finished") {
    const missing = units.filter((u) => !covered.has(u))
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={backToSetup}>←</button>
          <h1>🎉 学完啦</h1>
        </header>
        <div className="card" style={{ padding: 16 }}>
          <p className="talk-feedback-praise">全部 {script.items.length} 道题都完成了！</p>
          <p className="module-hint">已练到的内容：{units.filter((u) => covered.has(u)).join("、") || "（无）"}</p>
          {missing.length > 0 && (
            <p className="module-hint">还没覆盖（可再开一轮专门练）：{missing.join("、")}</p>
          )}
          <button className="btn-primary" style={{ width: "100%" }} onClick={backToSetup}>
            🔁 再练一轮
          </button>
        </div>
      </div>
    )
  }

  // ── 答题界面 ──
  const showNext = judge?.ok === true || echoDone || (judge && !judge.ok && !echoOpen && judge.correct === "")
  const coveredCount = units.filter((u) => covered.has(u)).length

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={backToSetup}>←</button>
        <h1>🤖 AI 对话学语文</h1>
        <span style={{ fontSize: 13, color: "#536471" }}>
          {idx + 1}/{script.items.length} · 覆盖 {coveredCount}/{units.length}
        </span>
      </header>

      {/* AI 提问气泡 */}
      {item && (
        <div className="talk-bubble ai">
          <div className="talk-bubble-label">🤖 AI · {script.title || topic || "语文对话"}</div>
          <div className="talk-bubble-text">
            <TapCharText text={item.q} charSpeakOverride={(ch) => void speakChar(ch)} />
          </div>
          <div className="talk-bubble-ops">
            <button className="btn-secondary btn-sm" onClick={() => void talkSpeak(item.q)}>🔊 再读</button>
          </div>
        </div>
      )}

      {/* 自动提示卡（6s 未答） */}
      {hintTip && stage === "question" && !judge && (
        <div className="talk-hints card" style={{ marginTop: 8 }}>
          <div className="talk-hints-title">💡 提示（第 {hintLvl} 级）</div>
          <p className="talk-hint-text">{hintTip}</p>
        </div>
      )}

      {/* 文本作答区 */}
      {stage === "question" && !judge && !echoOpen && (
        <div className="card teach-answer-card" style={{ marginTop: 8 }}>
          <textarea
            className="text-input"
            style={{ width: "100%", minHeight: 72, resize: "vertical" }}
            placeholder={"在这里输入/用输入法语音说出你的回答…"}
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value)
              lastActRef.current = Date.now() // 有输入就重置 6s 计时
            }}
          />
          <button className="btn-primary" style={{ width: "100%", marginTop: 8 }} disabled={!answer.trim()} onClick={() => void submit()}>
            ✅ 回答好了
          </button>
        </div>
      )}
      {stage === "judging" && <p className="speech-completing">🤔 AI 在看你的回答…</p>}

      {/* 判定反馈 */}
      {judge && !echoOpen && (
        <div className={`talk-feedback${judge.ok ? " ok" : " no"}`} style={{ marginTop: 8 }}>
          <p className="talk-feedback-praise">{judge.ok ? "✅ " : ""}{judge.praise}</p>
          {!judge.ok && judge.correct && (
            <div className="talk-feedback-correct">
              <div className="talk-correct-head">
                <span>参考回答：</span>
                <button className="btn-secondary btn-sm" onClick={() => void talkSpeak(judge.correct)}>🔊 再读</button>
              </div>
              <TapCharText text={judge.correct} charSpeakOverride={(ch) => void speakChar(ch)} />
            </div>
          )}
          {!judge.ok && judge.correct && !echoDone && !echoOpen && (
            <div className="talk-correct-eval">
              <button
                className="btn-secondary"
                style={{ width: "100%", marginTop: 10, padding: "10px 14px" }}
                onClick={() => setEchoOpen(true)}
              >
                🎤 跟读测评这句（≥70 分过关）
              </button>
              <button className="btn-secondary btn-sm" onClick={gotoNext}>跳过此题</button>
            </div>
          )}
        </div>
      )}

      {/* 错句测评（先听后评单级） */}
      {judge && !judge.ok && judge.correct && echoOpen && (
        <EchoLadder
          sentence={judge.correct}
          chunks={[judge.correct]}
          engine="16k_zh"
          source="zh_teach_echo"
          speaker="6221"
          praise="读得真好！"
          onFinished={onEchoFinished}
          onSkip={() => setEchoOpen(false)}
        />
      )}

      {/* 过关后下一问 */}
      {showNext && !echoOpen && (
        <button
          className="btn-primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={gotoNext}
        >
          {idx + 1 < (script.items.length ?? 0) ? "下一题 →" : "🎉 完成"}
        </button>
      )}
    </div>
  )
}
