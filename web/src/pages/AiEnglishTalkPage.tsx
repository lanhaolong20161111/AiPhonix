/** AI 英语对话陪练页 — "我说你接"（两态录音版）
 *
 * 链路：设置词句 → /llm/en-dialogue-setup 生成剧情(台词+目标句+hint_words) →
 * 每轮 AI 台词(EnglishWordTap 点读 + 🀄翻译 + 🔊整句 TTS，可切百度/豆包音) →
 * 孩子点绿色「🎤 开始录音」自由说（百度 ASR en 流式）→
 * 停顿 2s：自动暂停 ASR → 播放下一个提示词（只读不评，文本逐行保留）→ 1.5s 后自动恢复录音 →
 * **提示记录里的句子＝先读英文、紧接着读中文**（整句提示行带中文翻译，词提示行只读英文）→
 * 孩子说完点红色「⏹ 结束」→ /llm/en-answer-judge 判定：
 *   ✅ 表扬（朗读）/ ❌ 显示并朗读正确句 → 孩子可「🎤 跟读正确句」SOE 评分加深记忆 → 下一轮。
 *
 * 状态：idle（绿·开始）/ recording（红·结束）/ hinting（灰·提示中，自动恢复）/
 *       judging（AI 评分中）。词级评测已移除（评测会分散注意力），只保留错误答案句的跟读评测。
 */
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { EnglishWordTap } from "../components/EnglishWordTap"
import { EchoLadder } from "../components/EchoLadder"
import { useEnglishTurn } from "../hooks/useEnglishTurn"
import { useTts } from "../hooks/useTts"
import { enDialogueSetup, enAnswerJudge, type DialogueScript } from "../services/englishTalk"
import { fetchSentenceInfo, fetchWordInfo } from "../services/dailyEn"
import { lookupWordZhSync } from "../services/wordbankEnglish"

type Phase = "idle" | "recording" | "hinting" | "reading" | "judging"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** chunks 兜底：后端没给意群时按 2~3 词一组（弱词不领句） */
function fallbackChunks(sentence: string): string[] {
  const words = sentence.split(/\s+/).map((w) => w.trim()).filter(Boolean)
  const weak = new Set(["to", "the", "a", "an", "and", "of", "for", "with", "in", "on", "at", "is", "are"])
  const out: string[] = []
  let cur: string[] = []
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i])
    const next = words[i + 1]
    const boundary = cur.length >= 3 || (next !== undefined && !weak.has(next.toLowerCase()) && !weak.has(words[i].toLowerCase()))
    if (boundary && cur.length) {
      out.push(cur.join(" "))
      cur = []
    }
  }
  if (cur.length) out.push(cur.join(" "))
  return out.length ? out : [sentence]
}

/** 只保留英文部分：若文本里混入了中文翻译后缀，裁掉（防 AI 台词"英文+中文翻译"被一起朗读） */
function englishOnly(t: string): string {
  const i = t.search(/[\u4e00-\u9fff]/)
  return i > 0 ? t.slice(0, i).trim() : t.trim()
}

export function AiEnglishTalkPage() {
  const navigate = useNavigate()
  const { speak } = useTts()

  // 朗读统一走百度链路（中文 6221 度云萱 / 英文自动 4193 度泽言）
  const speakAi = (t: string) => void speak(englishOnly(t))

  // 设置
  const [topic, setTopic] = useState("")
  const [wordsText, setWordsText] = useState("")
  const [sentencesText, setSentencesText] = useState("")
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState("")

  // 剧情
  const [script, setScript] = useState<DialogueScript | null>(null)
  const [turn, setTurn] = useState(0) // 当前轮
  /** 每轮 AI 台词自动中文翻译（key=轮次，懒加载） */
  const [lineZh, setLineZh] = useState<Record<number, string>>({})
  const zhFetchRef = useRef<Record<number, boolean>>({})
  /** 正确句的中文翻译（自动） */
  const [correctZh, setCorrectZh] = useState("")

  // 提示词（只读不评）：每停顿提示一个词，提示文本逐行保留，每行自动带中文翻译
  const [hintRows, setHintRows] = useState<{ text: string; full: boolean; zh: string }[]>([])
  const hintCountRef = useRef(0)
  const hintWordsRef = useRef<string[]>([])
  const hintIdxRef = useRef(0)
  const lastHintTextRef = useRef("")
  /** 轮次序号：换轮/重开时 +1，作废上一轮还在飞的中文翻译请求 */
  const turnSeqRef = useRef(0)
  /** 本页会话内 英文→中文 缓存（跨轮复用，避免同句反复调 LLM 翻译） */
  const zhCacheRef = useRef<Map<string, string>>(new Map())
  /** 进行中的翻译请求（同一句并发只发一次） */
  const zhInflightRef = useRef<Map<string, Promise<string>>>(new Map())

  // 阶段
  const [phase, setPhase] = useState<Phase>("idle")
  const phaseRef = useRef<Phase>("idle")
  const setPh = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }
  const hintBusyRef = useRef(false)
  /** 整句提示已给过一次 → 本轮不再周期性提示/打断 ASR（孩子自由说到点结束） */
  const fullHintGivenRef = useRef(false)

  // 判定结果
  const [feedback, setFeedback] = useState<{ ok: boolean; praise: string; correct: string; said: string } | null>(null)
  const [judging, setJudging] = useState(false)
  const [errText, setErrText] = useState("")
  /** 错句区「跟读阶梯」是否展开 */
  const [ladderOpen, setLadderOpen] = useState(false)
  /** 6s 无话后自动引导：给出整句并进入单词阶梯测评（done=true 表示整句已过关） */
  const [guided, setGuided] = useState<{ sentence: string; units: string[]; done: boolean } | null>(null)

  const line = script?.lines[turn]

  // 当前 AI 台词自动附带中文翻译（去掉翻译按钮）
  useEffect(() => {
    if (!line || lineZh[turn] !== undefined || zhFetchRef.current[turn]) return
    zhFetchRef.current[turn] = true
    let on = true
    void fetchSentenceInfo(line.ai)
      .then((info) => {
        if (on) setLineZh((m) => ({ ...m, [turn]: info.translation ?? "（暂无翻译）" }))
      })
      .catch(() => {
        if (on) setLineZh((m) => ({ ...m, [turn]: "（暂无翻译）" }))
      })
      .finally(() => {
        zhFetchRef.current[turn] = false
      })
    return () => {
      on = false
    }
  }, [script, turn, line, lineZh])

  // ── 录音：onPause（说过话后停顿→逐词提示）与 onInitialSilence（6s 没出过声）经 ref 转发 ──
  const pauseHandlerRef = useRef<(saidSoFar: string) => void>(() => {})
  const initialSilenceRef = useRef<() => void>(() => {})
  const turnHook = useEnglishTurn({
    pauseMs: 2000,
    initialSilenceMs: 6000,
    onPause: (said) => pauseHandlerRef.current(said),
    onInitialSilence: () => initialSilenceRef.current(),
  })

  // ── 整句朗读：表扬/正确句；提示词走快速通道 ──
  const playLines = async (texts: string[]) => {
    for (const t of texts) {
      const en = englishOnly(t)
      if (!en) continue
      await speak(en)
    }
  }
  const speakHint = async (t: string) => {
    void speak(englishOnly(t)) // 快速通道（预生成命中 ~1s；未命中走百度实时合成）
  }

  /** 取英文（词/句）的中文翻译：先查本地课标词库（单词，同步秒出）→ 本页会话缓存 → 服务端缓存。
   *  同一句/词并发只发一次请求（提示行补显与「读中文」共用同一 promise）。 */
  const fetchZhFor = async (text: string, full: boolean): Promise<string> => {
    const ck = `${full ? "s" : "w"}:${text.trim().toLowerCase()}`
    const hitCache = zhCacheRef.current.get(ck)
    if (hitCache) return hitCache
    const inflight = zhInflightRef.current.get(ck)
    if (inflight) return inflight
    const task = (async (): Promise<string> => {
      try {
        if (!full) {
          const local = lookupWordZhSync(text)
          if (local) return local
        }
        const zh = full
          ? (await fetchSentenceInfo(text)).translation ?? ""
          : await fetchWordInfo(text).then((info) => info.translation || info.meaning || "")
        if (zh) zhCacheRef.current.set(ck, zh) // 同句/同词在后续轮次不再重复请求
        return zh
      } catch {
        return ""
      } finally {
        zhInflightRef.current.delete(ck)
      }
    })()
    zhInflightRef.current.set(ck, task)
    return task
  }

  /** 带超时的翻译查询：中文朗读不能因为翻译迟迟不来卡住整轮对话。
   *  超时给足——整句翻译是 LLM 实时生成（首次 3~8s），中文必须读出来；
   *  录音已暂停，多等这几秒只是「提示中」状态多停一会，不会漏录。 */
  const fetchZhTimed = (text: string, full: boolean, ms = 9000): Promise<string> => {
    const local = full ? "" : lookupWordZhSync(text)
    if (local) return Promise.resolve(local)
    return Promise.race([
      fetchZhFor(text, full),
      new Promise<string>((r) => setTimeout(() => r(""), ms)),
    ])
  }

  /**
   * 朗读提示行：**先读英文，紧接着读中文**（用户要求「读完英语后接着读中文意思」）。
   * 只有整句提示行读中文——逐词提示读单个中文字（如「我」）没教学意义还占时长。
   * 中文等不到（超时/失败）就只读英文，不阻塞录音恢复。
   * @param rowIndex 该行在 hintRows 中的下标；换轮后下标可能被复用，故配合 turnSeq 校验
   */
  const readHintAloud = async (text: string, full: boolean, rowIndex?: number): Promise<void> => {
    const en = englishOnly(text)
    if (en) await speak(en)
    if (!full) return
    const seq = turnSeqRef.current
    const zh = await fetchZhTimed(text, true)
    if (!zh || seq !== turnSeqRef.current) return
    await speak(zh)
    // 翻译是后到的 → 补写回该行，保证「提示句子的中文翻译」一定显示
    if (rowIndex !== undefined) {
      setHintRows((rows) => rows.map((r, i) => (i === rowIndex && !r.zh ? { ...r, zh } : r)))
    }
  }

  /** 追加提示词记录行（逐行保留）+ 自动懒加载中文翻译（整句/单词都补，单词走本地词库秒出） */
  const pushHintRow = (text: string, full: boolean) => {
    const idx = hintCountRef.current
    hintCountRef.current += 1
    const seq = turnSeqRef.current
    const local = full ? "" : lookupWordZhSync(text)
    setHintRows((rows) => [...rows, { text, full, zh: local }])
    if (local) return
    void fetchZhFor(text, full).then((zh) => {
      if (zh && seq === turnSeqRef.current) {
        setHintRows((rows) => rows.map((r, i) => (i === idx ? { ...r, zh } : r)))
      }
    })
  }

  /** 录音中主动点击 TTS 朗读：暂停 ASR（防录到扬声器）+ 冻结停顿计时，
   *  按钮灰置不可点；读完后停 1.2s 自动恢复录音继续计时。非录音中直接朗读。 */
  const playTts = async (t: string) => {
    if (!t.trim()) return
    const wasRecording = phaseRef.current === "recording"
    if (wasRecording) {
      hintBusyRef.current = true
      setPh("reading")
      await turnHook.pause()
    }
    await speak(englishOnly(t))
    if (wasRecording) {
      await sleep(1200)
      hintBusyRef.current = false
      if (phaseRef.current === "reading") {
        const resumed = await turnHook.resume().catch(() => false)
        if (resumed) setPh("recording")
        else {
          setPh("idle")
          setErrText("麦克风恢复失败，请点「开始录音」重试")
        }
      }
    }
  }

  /** 停顿处理：暂停 ASR → 提示下一个词并朗读 → 停 1.5s → 自动恢复录音。
   * 词提示完后给一次整句；整句给过就不再提示（不周期性打断 ASR）。 */
  const pauseHandler = async () => {
    const recNow: Phase = phaseRef.current
    if (recNow !== "recording" || hintBusyRef.current) return
    const target = line?.target ?? ""
    if (!target) return
    const words = hintWordsRef.current
    // 词已提示完 → 整句提示只给一次；之后停顿一律静默，让 ASR 连续工作到孩子点结束
    const isFull = hintIdxRef.current >= words.length
    if (isFull) {
      if (fullHintGivenRef.current) return
      fullHintGivenRef.current = true
    }
    hintBusyRef.current = true
    setPh("hinting")
    await turnHook.pause()

    let text = ""
    if (hintIdxRef.current < words.length) {
      text = words[hintIdxRef.current] // 逐词提示
      hintIdxRef.current += 1
    } else {
      text = target // 词提示完 → 提示一次整句
    }
    if (text && text !== lastHintTextRef.current) {
      lastHintTextRef.current = text
      const rowIdx = hintCountRef.current // pushHintRow 内会 +1，先记下写入下标
      pushHintRow(text, isFull)
      await readHintAloud(text, isFull, rowIdx) // 整句：英文读完接着读中文
    } else if (text) {
      await speakHint(text)
    }

    // 播完提示词停一下让 TA 消化，再自动切回 ASR 继续录
    await sleep(1500)
    hintBusyRef.current = false
    if (phaseRef.current === "hinting") {
      const resumed = await turnHook.resume().catch(() => false)
      if (resumed) setPh("recording")
      else {
        setPh("idle")
        setErrText("麦克风恢复失败，请点「开始录音」重试")
      }
    }
  }
  pauseHandlerRef.current = pauseHandler

  /** 6s 完全没出过声 → 不干等：先把整句显示并朗读，再进入「第1词→前2词→…整句」阶梯测评 */
  const startGuided = async () => {
    const cur: Phase = phaseRef.current
    if (cur !== "recording" || hintBusyRef.current || !line || guided) return
    hintBusyRef.current = true
    await turnHook.stop().catch(() => "")
    hintBusyRef.current = false
    const en = englishOnly(line.target)
    const words = (en.match(/[A-Za-z']+(?:['’][A-Za-z]+)?/g) ?? []).filter(Boolean)
    // 显示整句提示行（可重听，中文翻译异步补上），再「英文→中文」朗读，最后挂载单词阶梯
    const rowIdx = hintCountRef.current // pushHintRow 内会 +1，先记下写入下标
    pushHintRow(en, true)
    setPh("idle")
    setFeedback(null)
    await readHintAloud(en, true, rowIdx)
    setGuided({ sentence: en, units: words.length ? words : [en], done: false })
  }
  initialSilenceRef.current = () => {
    void startGuided()
  }

  /** 绿色「开始录音」 */
  const startRecording = async () => {
    if (phaseRef.current !== "idle" || judging) return
    setErrText("")
    const ok = await turnHook.start()
    if (ok) {
      setPh("recording")
    } else if (!turnHook.state.error) {
      setErrText("开始录音失败，请检查麦克风权限")
    }
  }

  /** 红色「结束」→ 取整句 → AI 判定 → 朗读表扬/正确句 */
  const finishRecording = async () => {
    if (phaseRef.current !== "recording" || judging) return
    setJudging(true)
    setPh("judging")
    try {
      const said = await turnHook.stop()
      if (!said) {
        setPh("idle")
        setJudging(false)
        setErrText("没有听到内容，请再试一次")
        return
      }
      if (!line) {
        setPh("idle")
        setJudging(false)
        return
      }
      const res = await enAnswerJudge(line.target, said)
      setFeedback({ ok: res.ok, praise: res.praise, correct: res.correct, said })
      setLadderOpen(false)
      if (!res.ok && res.correct) {
        void fetchZhFor(res.correct, true).then(setCorrectZh) // 正确句自动翻译
      } else {
        setCorrectZh("")
      }
      if (res.ok) {
        await playLines([res.praise]) // ✅ 表扬朗读
      } else {
        await playLines([res.praise]) // ❌ 鼓励 + 正确句
        if (res.correct) await readHintAloud(res.correct, true) // 正确句：英文读完接着读中文
      }
    } catch {
      if (line) {
        setFeedback({ ok: false, praise: "Try again!", correct: line.target, said: "" })
        void fetchZhFor(line.target, true).then(setCorrectZh)
      }
    } finally {
      setJudging(false)
      setPh("idle")
    }
  }

  // ── 开始练习 ──
  const handleSetup = async () => {
    const words = wordsText.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean)
    const sentences = sentencesText.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    if (!words.length && !sentences.length && !topic.trim()) {
      setSetupError("请输入至少一个练习词 / 句子，或主题")
      return
    }
    setSettingUp(true)
    setSetupError("")
    try {
      const sc = await enDialogueSetup(topic.trim(), words, sentences)
      setScript(sc)
      setTurn(0)
      setFeedback(null)
      setErrText("")
      hintWordsRef.current = sc.lines[0]?.hint_words ?? []
      hintIdxRef.current = 0
      lastHintTextRef.current = ""
      fullHintGivenRef.current = false
      hintCountRef.current = 0
      turnSeqRef.current += 1
      setHintRows([])
      setLineZh({})
      zhFetchRef.current = {}
      zhCacheRef.current.clear() // 新剧情 → 清空翻译缓存
      zhInflightRef.current.clear()
      setCorrectZh("")
      setLadderOpen(false)
      setGuided(null)
      setPh("idle")
      // AI 首句自动朗读
      if (sc.lines[0]?.ai) speakAi(sc.lines[0].ai)
    } catch (e) {
      setSetupError(`生成失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setSettingUp(false)
    }
  }

  /** 重读当前 AI 台词（录音中会先暂停 ASR） */
  const reReadAi = () => {
    if (line?.ai) void playTts(line.ai)
  }

  // ── 下一轮 / 完成 ──
  const nextTurn = async () => {
    const next = turn + 1
    if (next < (script?.lines.length ?? 0)) {
      await turnHook.stop() // 停掉可能残留的录音
      setTurn(next)
      setFeedback(null)
      setErrText("")
      setCorrectZh("")
      setLadderOpen(false)
      setGuided(null)
      hintWordsRef.current = script!.lines[next].hint_words ?? []
      hintIdxRef.current = 0
      lastHintTextRef.current = ""
      fullHintGivenRef.current = false
      hintCountRef.current = 0
      turnSeqRef.current += 1
      setHintRows([])
      setPh("idle")
      const aiLine = script!.lines[next].ai
      if (aiLine) speakAi(aiLine)
    } else {
      // 全部完成
      await turnHook.stop()
      setGuided(null)
      setScript(null)
      setTopic("")
      setWordsText("")
    }
  }

  // ── 设置界面 ──
  if (!script) {
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>🗣 AI 英语对话</h1>
        </header>
        <div className="card" style={{ padding: 16 }}>
          <p className="module-hint">设置要练的词语或句子（场景可不填，AI 会自己挑合适的），AI 会编一段小剧情和你对话。</p>
          <label style={{ fontWeight: 700 }}>主题 / 场景（可选，不填 AI 自动决定）</label>
          <input
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px" }}
            placeholder="如：在公园 / 去动物园 / 我的家人"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>练习单词（逗号或空格分隔）</label>
          <input
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px" }}
            placeholder="如：apple, park, happy, run"
            value={wordsText}
            onChange={(e) => setWordsText(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>练习句子（每行一句，可选）</label>
          <textarea
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px", minHeight: 64, resize: "vertical" }}
            placeholder={"如：I like apples.\nCan I run in the park?"}
            value={sentencesText}
            onChange={(e) => setSentencesText(e.target.value)}
          />
          {setupError && <p className="err">{setupError}</p>}
          <button className="btn-primary" style={{ width: "100%" }} disabled={settingUp} onClick={() => void handleSetup()}>
            {settingUp ? "AI 编剧情中…" : "✨ 开始对话"}
          </button>
        </div>
      </div>
    )
  }

  // ── 对话界面 ──
  const recording = turnHook.state.recording
  const canStop = phase === "recording"

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🗣 {script.title || "英语对话"}</h1>
        <span style={{ fontSize: 13, color: "#536471" }}>{turn + 1}/{script.lines.length}</span>
      </header>

      {/* AI 台词气泡 */}
      {line && (
        <div className="talk-bubble ai">
          <div className="talk-bubble-label">🤖 AI · {topic || "对话"}</div>
          <div className="talk-bubble-text">
            <EnglishWordTap text={englishOnly(line.ai)} speakOverride={(w) => void playTts(w)} />
          </div>
          <div className="talk-bubble-ops">
            <button className="btn-secondary btn-sm" onClick={reReadAi}>🔊 再读</button>
          </div>
          {lineZh[turn] && <p className="talk-translation">{lineZh[turn]}</p>}
        </div>
      )}

      {/* 孩子回答区（两态：绿=开始/录音中，红=结束） */}
      <div className="card" style={{ marginTop: 10 }}>
        <p className="module-hint" style={{ marginTop: 0 }}>
          听清 AI 的问题后，点「🎤 开始录音」说出你的回答。说完了点红色「⏹ 结束」，AI 来评分。
        </p>
        <div className="talk-live">
          <span className="speech-said">{turnHook.state.saidText}</span>
          {turnHook.state.interimText && <span className="speech-interim">{turnHook.state.interimText}</span>}
          {!turnHook.state.saidText && !turnHook.state.interimText && !turnHook.state.recording && (
            <span className="speech-placeholder">（还没说）</span>
          )}
        </div>

        {phase === "recording" && (
          <div className="talk-status go"><span className="talk-dot" /> 录音中… 说完了点下方红色结束</div>
        )}
        {phase === "hinting" && (
          <div className="talk-status busy"><span className="talk-dot" /> 🔊 提示中，请听提示词…</div>
        )}
        {phase === "reading" && (
          <div className="talk-status busy"><span className="talk-dot" /> 🔊 朗读中… 录音已暂停</div>
        )}
        {recording && (
          <div className="speech-level"><div className="speech-level-bar" style={{ width: `${Math.max(4, Math.min(100, turnHook.state.level * 100))}%` }} /></div>
        )}
        {errText && <p className="err">{errText}</p>}
        {turnHook.state.error && <p className="err">{turnHook.state.error}</p>}

        <div className="speech-actions">
          {phase === "idle" && !feedback && !judging && !guided ? (
            <button className="btn-lg talk-rec go" onClick={() => void startRecording()}>🎤 开始录音</button>
          ) : canStop ? (
            <button className="btn-lg talk-rec stop" onClick={() => void finishRecording()}>⏹ 结束</button>
          ) : phase === "hinting" ? (
            <button className="btn-lg talk-rec busy" disabled>🔊 提示中…</button>
          ) : phase === "reading" ? (
            <button className="btn-lg talk-rec busy" disabled>🔊 朗读中…</button>
          ) : null}
        </div>

        {/* 判定反馈 */}
        {judging && <p className="speech-completing">🤔 AI 在听你回答…</p>}
        {feedback && (
          <div className={`talk-feedback${feedback.ok ? " ok" : " no"}`}>
            {feedback.said && (
              <p className="talk-feedback-said">
                你说：{feedback.said}{/[.!?]$/.test(feedback.said.trim()) ? "" : "."}
              </p>
            )}
            <p className="talk-feedback-praise">{feedback.ok ? "✅ " : ""}{feedback.praise}</p>
            {!feedback.ok && feedback.correct && (
              <div className="talk-feedback-correct">
                <div className="talk-correct-head">
                  <span>正确说法：</span>
                  <button className="btn-secondary btn-sm" onClick={() => void playTts(feedback.correct)}>🔊 再读</button>
                </div>
                <EnglishWordTap text={feedback.correct} speakOverride={(w) => void playTts(w)} />
                {correctZh && <p className="talk-translation">{correctZh}</p>}
                {/* 跟读阶梯：片段→扩长→整句（错句修复用） */}
                {ladderOpen ? (
                  <EchoLadder
                    sentence={englishOnly(feedback.correct)}
                    chunks={line?.chunks ?? fallbackChunks(englishOnly(feedback.correct))}
                    engine="16k_en"
                    source="english_talk_ladder"
                    onFinished={() => { /* 完成：鼓励已内置播放 */ }}
                    onSkip={() => setLadderOpen(false)}
                  />
                ) : (
                  <button
                    className="btn-secondary"
                    style={{ width: "100%", marginTop: 8, padding: "10px 14px" }}
                    onClick={() => setLadderOpen(true)}
                  >
                    🧗 跟读练习（从片段到整句）
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 提示词记录（逐行保留，每行可重听） */}
      {hintRows.length > 0 && (
        <div className="talk-hints card" style={{ marginTop: 8 }}>
          <div className="talk-hints-title">💡 提示记录</div>
          {hintRows.map((h, i) => (
            <div className="talk-hint-row" key={i}>
              <span className="talk-hint-no">{i + 1}</span>
              <span className="talk-hint-main">
                <span className="talk-hint-text">{h.full ? `（整句）${h.text}` : h.text}</span>
                {h.zh && <span className="talk-hint-zh">{h.zh}</span>}
              </span>
              <button className="btn-secondary btn-sm" onClick={() => void playTts(h.text)}>🔊</button>
            </div>
          ))}
        </div>
      )}

      {/* 6s 无话引导：整句单词阶梯测评 */}
      {guided && !feedback && (
        <div className="card" style={{ marginTop: 8, padding: 10 }}>
          {guided.done ? (
            <div className="talk-feedback ok" style={{ marginTop: 0 }}>
              <p className="talk-feedback-praise">✅ 整句过关！点下方进入下一轮</p>
            </div>
          ) : (
            <EchoLadder
              sentence={guided.sentence}
              chunks={[]}
              units={guided.units}
              engine="16k_en"
              source="english_talk_guided"
              speaker="0"
              onFinished={() => setGuided((g) => (g ? { ...g, done: true } : g))}
              onSkip={() => setGuided(null)}
            />
          )}
        </div>
      )}

      {/* 下一轮 */}
      {(feedback || guided?.done) && (
        <button
          className="btn-primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => void nextTurn()}
        >
          {turn + 1 < (script?.lines.length ?? 0) ? "下一轮 →" : "🎉 完成，再来一次"}
        </button>
      )}
    </div>
  )
}
