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
import { TapCharText } from "../components/TapCharText"
import { EchoLadder } from "../components/EchoLadder"
import { useTts } from "../hooks/useTts"
import { zhTeachSetup, zhTeachJudge, type TeachScript, type TeachItem } from "../services/zhTeach"
import { zhPoemSetup, zhPoemSummary, type PoemScript, type PoemLine } from "../services/zhPoem"

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
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState("")
  const [waitSec, setWaitSec] = useState(0)

  // ── 古诗模式 ──
  const [poem, setPoem] = useState<PoemScript | null>(null)
  const [poemIdx, setPoemIdx] = useState(0)
  const [poemIntroDone, setPoemIntroDone] = useState(false)
  const [charTip, setCharTip] = useState<{ c: string; m: string } | null>(null)
  const [ttsBusy, setTtsBusy] = useState(false) // 任意古诗 TTS 进行中（点击即时反馈 + 防竞态）
  const [evalBusy, setEvalBusy] = useState(false) // 测评（朗读/录音）中 → 禁点 TTS
  const poemBusyRef = useRef(false)
  const poemLine: PoemLine | null = poem?.lines[poemIdx] ?? null

  // 剧本
  const [script, setScript] = useState<TeachScript | null>(null)
  const [units, setUnits] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const item: TeachItem | null = script?.items[idx] ?? null

  const [stage, setStage] = useState<Stage>("setup")

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

  // ── 古诗朗读（全部走 speaker=3；串行 + 忙碌锁，避免多个 TTS 竞态） ──
  /** 硬超时：底层播放 promise 万一不返回（浏览器差异），也不让流程卡死 */
  const withTimeout = <T,>(p: Promise<T>, ms = 12_000): Promise<T | void> =>
    Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])

  const speakPoem = async (t: string) => {
    if (!t.trim() || poemBusyRef.current || evalBusy) return
    poemBusyRef.current = true
    setTtsBusy(true)
    try {
      await withTimeout(speak(t, { speaker: POEM_VOICE }))
    } finally {
      poemBusyRef.current = false
      setTtsBusy(false)
    }
  }

  /** 单字点读：先读这个字（指定音色），紧接着读这个字的意思 */
  const tapPoemChar = async (c: string, m: string) => {
    if (poemBusyRef.current || evalBusy) return
    setCharTip({ c, m })
    poemBusyRef.current = true
    setTtsBusy(true)
    try {
      await withTimeout(speak(c, { speaker: POEM_VOICE }))
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
    void warm(nx.verse, { speaker: POEM_VOICE })
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
        await withTimeout(speak(l.verse, { speaker: POEM_VOICE }))
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
    const local: PoemScript = {
      title: "古诗练习",
      summary: "",
      lines: segs.map((v) => ({ verse: v, meaning: "", chars: [] })),
      fallback: true,
    }
    setPoem(local)
    setPoemIdx(0)
    setPoemIntroDone(false) // 先听"整篇古诗 + 全诗概括"，听完才进入逐句测评
    setStage("question") // 离开 setup 界面（否则第 320 行 stage==="setup" 恒真，古诗界面永远不渲染）

    // 快速概括（只生成题目+概括，1~3s）：整篇朗读期间就绪，开场不用等完整讲解
    const summaryPromise = zhPoemSummary(raw)
      .then((s) => {
        if (s?.summary) setPoem((prev) => (prev ? { ...prev, title: s.title || prev.title, summary: prev.summary || s.summary } : prev))
        return s
      })
      .catch(() => null)

    // 后台生成完整讲解（概括/白话/逐字义）；成功后原地合并，失败保持原文练习可用
    // 后台生成完整讲解（逐句白话/逐字释义），就绪后原地合并；失败保持原文练习可用
    void (async () => {
      try {
        const p = await zhPoemSetup(raw)
        setPoem((prev) => {
          if (!prev) return prev
          const zhMap = new Map(p.lines.map((l) => [l.verse.replace(/\s+/g, ""), l]))
          return {
            title: p.title || prev.title,
            summary: p.summary || prev.summary,
            lines: prev.lines.map((l) => {
              const hit = zhMap.get(l.verse.replace(/\s+/g, ""))
              return hit ? { ...l, meaning: hit.meaning || l.meaning, chars: hit.chars?.length ? hit.chars : l.chars, verse: l.verse } : l
            }),
            fallback: false,
          }
        })
      } catch {
        /* 讲解生成失败：保持原文练习可用，不报错打断 */
      }
    })()

    // 开场：先朗读整篇古诗，再读全诗概括（快速端点，通常朗读期间已就绪；最多再等 8s，失败则跳过），然后才逐句
    setEvalBusy(true)
    poemBusyRef.current = true
    setTtsBusy(true)
    try {
      await withTimeout(speak(raw, { speaker: POEM_VOICE }), 40_000).catch(() => { /* 朗读失败不阻塞流程 */ })
      // 优先用快速概括；万一它也慢，最多再等 8s（正常已在整篇朗读期间就绪）
      const s = await Promise.race([summaryPromise, new Promise<null>((r) => setTimeout(() => r(null), 8_000))])
      if (s?.summary) await withTimeout(speak(s.summary, { speaker: POEM_VOICE }), 20_000).catch(() => { /* 同上 */ })
    } finally {
      poemBusyRef.current = false
      setTtsBusy(false)
      setEvalBusy(false)
    }
    setPoemIntroDone(true)
    void enterPoemVerse(0)
  }

  // ── 生成剧本 ──
  const handleSetup = async () => {
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
    setCharTip(null)
    setStage("setup")
    setTopic("")
    setWordsText("")
    setSentencesText("")
    setPoemText("")
  }

  // ── 设置界面 ──
  if (stage === "setup" || (!script && !poem)) {
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>🤖 AI 对话学语文</h1>
        </header>
        <div className="card" style={{ padding: 16 }}>
          <p className="module-hint">
            先告诉 AI 主题和要练的词语/句子，它会出好多道题带你一问一答，把每个词的意思和用法都练到。每题你都可以**打字或用输入法语音**回答。
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
          <label style={{ fontWeight: 700 }}>要练的古诗（可选，填了就练古诗）</label>
          <textarea
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px", minHeight: 72, resize: "vertical" }}
            placeholder={"如：床前明月光，疑是地上霜。\n举头望明月，低头思故乡。"}
            value={poemText}
            onChange={(e) => setPoemText(e.target.value)}
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
    const total = poem.lines.length
    const ttsBlocked = ttsBusy || evalBusy // 朗读/评测中：禁点 TTS（含单字）
    if (poemIdx >= total) {
      return (
        <div className="page aihomework-page">
          <header className="module-header">
            <button className="back-btn" onClick={backToSetup}>←</button>
            <h1>🎉 古诗学完啦</h1>
          </header>
          <div className="card" style={{ padding: 16 }}>
            <p className="talk-feedback-praise">《{poem.title}》全部 {total} 句都读完啦！</p>
            <p className="module-hint">{poem.summary}</p>
            <button className="btn-primary" style={{ width: "100%" }} onClick={backToSetup}>🔁 再练一首</button>
          </div>
        </div>
      )
    }
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={backToSetup}>←</button>
          <h1>📜 {poem.title}</h1>
          <span style={{ fontSize: 13, color: "#536471" }}>第 {poemIdx + 1}/{total} 句</span>
        </header>

        {/* 上面：古诗原文（单字可点：先读字，再读字义） */}
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <div style={{ fontSize: 20, lineHeight: 1.9, fontWeight: 700, color: "#0f1419" }}>
            {poem.lines.map((l, li) => (
              <div key={li} style={li === poemIdx ? { background: "#fff8e1", borderRadius: 8, padding: "2px 6px" } : { opacity: 0.6 }}>
                {(() => {
                  let cjk = 0
                  return [...l.verse].map((ch, ci) => {
                    const punct = !/[\u4e00-\u9fff]/.test(ch)
                    if (punct) return <span key={ci}>{ch}</span>
                    const info = l.chars[cjk] ?? null
                    cjk += 1
                    return (
                      <span
                        key={ci}
                        onClick={() => { if (!ttsBlocked && info) void tapPoemChar(info.c, info.m) }}
                        style={{ cursor: ttsBlocked ? "default" : "pointer", padding: "0 1px" }}
                      >
                        {ch}
                      </span>
                    )
                  })
                })()}
              </div>
            ))}
          </div>
        </div>

        {/* 下面：解释（白话意思 + 点到的字义） */}
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <p className="module-hint" style={{ marginTop: 0 }}>📖 解释</p>
          {poemLine?.meaning
            ? <p style={{ fontSize: 16, fontWeight: 600, color: "#1b5e20", margin: "4px 0" }}>{poemLine.meaning}</p>
            : <p className="module-hint" style={{ margin: "4px 0" }}>（这句的白话意思稍后补上，先跟 AI 读一遍）</p>}
          {charTip && (
            <p style={{ fontSize: 15, color: "#e65100", margin: "4px 0" }}>
              「{charTip.c}」：{charTip.m}
            </p>
          )}
          {ttsBusy && <p className="speech-completing">🔊 朗读中…</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn-secondary btn-sm" disabled={ttsBlocked} onClick={() => poemLine && void speakPoem(poemLine.verse)}>🔊 读原文</button>
            <button className="btn-secondary btn-sm" disabled={ttsBlocked} onClick={() => poemLine && void speakPoem(poemLine.meaning)}>🔊 读意思</button>
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
            onFinished={() => void enterPoemVerse(poemIdx + 1)}
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
