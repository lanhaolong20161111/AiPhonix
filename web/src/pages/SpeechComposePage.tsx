/** AI 对话学 — 和 AI 一问一答练口语表达（原造句小助手，"我说你接"中文口语对话版；流式实时显示 + 结束短语音兜底）
 *
 * 识别链路：百度实时流式（zh dev_pid 15372）边说边显示；点「结束」若流式没给出字
 * （单字偶发），把本轮完整 PCM 上传短语音（/asr/short）兜底。
 * 无自动逐词提示：卡壳用「💡 提示整句」按钮（点击给整句并发音一次，录音中点会在
 * 暂停窗口播放并自动恢复）。
 * 其余：中文剧情（lang=zh）、AI 声音百度 6221、错误句朗读 + 16k_zh 跟读、无翻译。
 */
import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { TapCharText } from "../components/TapCharText"
import { useEnglishTurn } from "../hooks/useEnglishTurn"
import { useTts } from "../hooks/useTts"
import { useSoeScore } from "../hooks/useSoeScore"
import { shortAsr } from "../services/asrShort"
import { zhDialogueSetup, zhAnswerJudge, type DialogueScript } from "../services/zhDialogue"

type Phase = "idle" | "recording" | "reading" | "judging"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function SpeechComposePage() {
  const navigate = useNavigate()
  const { speak, speakChar } = useTts()

  // 设置
  const [topic, setTopic] = useState("")
  const [wordsText, setWordsText] = useState("")
  const [sentencesText, setSentencesText] = useState("")
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState("")

  // 剧情
  const [script, setScript] = useState<DialogueScript | null>(null)
  const [turnIdx, setTurnIdx] = useState(0)

  // 整句提示记录（按钮触发，逐轮保留）
  const [hintRows, setHintRows] = useState<{ text: string; full: boolean }[]>([])
  const lastHintTextRef = useRef("")

  // 阶段
  const [phase, setPhase] = useState<Phase>("idle")
  const phaseRef = useRef<Phase>("idle")
  const setPh = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }
  const busyRef = useRef(false)

  // 判定结果
  const [feedback, setFeedback] = useState<{ ok: boolean; praise: string; correct: string; said: string } | null>(null)
  const [judging, setJudging] = useState(false)
  const [errText, setErrText] = useState("")

  const line = script?.lines[turnIdx]

  // ── 录音：百度实时流式（zh）。停顿提示已改按钮 → 停检不触发（pauseMs 极大）──
  const turn = useEnglishTurn({
    lang: "zh",
    pauseMs: 600_000,
    initialSilenceMs: 0,
    onPause: () => { /* 无自动提示 */ },
  })

  // ── 正确句跟读评测（16k_zh）──
  const correctRef = useRef("")
  const correctSoe = useSoeScore(() => ({
    refText: correctRef.current,
    scene: "sentence",
    engine: "16k_zh",
    source: "zh_talk_correct",
  }))

  // ── 朗读：百度 6221 ──
  const talkSpeak = async (t: string) => {
    if (!t.trim()) return
    await speak(t, { speaker: "6221" })
  }

  /** 录音中打断朗读：暂停 ASR（等流式收尾）→ 窗口内播放 → 停 1.2s → 自动恢复 */
  const interruptSpeak = async (fn: () => Promise<void>) => {
    const recNow: Phase = phaseRef.current
    if (recNow !== "recording" || busyRef.current) return
    busyRef.current = true
    setPh("reading")
    await turn.pause()
    try {
      await fn()
      await sleep(1200)
    } finally {
      busyRef.current = false
      if (phaseRef.current === "reading") {
        const resumed = await turn.resume().catch(() => false)
        if (resumed) setPh("recording")
        else {
          setPh("idle")
          setErrText("麦克风恢复失败，请点「开始录音」重试")
        }
      }
    }
  }

  const playWhole = (t: string) => {
    if (!t.trim()) return
    if (phaseRef.current === "recording") void interruptSpeak(() => talkSpeak(t))
    else void talkSpeak(t)
  }
  const playCharGuarded = (ch: string) => {
    if (phaseRef.current === "recording") void interruptSpeak(async () => { await speakChar(ch) })
    else void speakChar(ch)
  }

  /** 💡 提示整句：点击给完整目标句一次并发音 */
  const hintWhole = async () => {
    if (busyRef.current || judging || !line?.target) return
    const target = line.target
    const wasRecording = phaseRef.current === "recording"
    const fn = async () => {
      if (target !== lastHintTextRef.current) {
        lastHintTextRef.current = target
        setHintRows((rows) => [...rows, { text: target, full: true }])
      }
      await talkSpeak(target)
    }
    if (wasRecording) await interruptSpeak(fn)
    else await fn()
  }

  /** 绿色「开始录音」 */
  const startRecording = async () => {
    if (phaseRef.current !== "idle" || judging) return
    setErrText("")
    const ok = await turn.start()
    if (ok) {
      setPh("recording")
    } else if (!turn.state.error) {
      setErrText("开始录音失败，请检查麦克风权限")
    }
  }

  /** 红色「结束」：取整句；流式空结果 → 整段 PCM 短语音兜底 → 判定 */
  const finishRecording = async () => {
    const recNow: Phase = phaseRef.current
    if (recNow !== "recording" || judging) return
    setJudging(true)
    setPh("judging")
    try {
      let whole = (await turn.stop()).trim()
      if (!whole) {
        // 流式没给出字（短音/单字偶发）→ 用本轮完整 PCM 走短语音兜底
        const pcm = turn.takePcm()
        if (pcm.length >= 1600) {
          const t = await shortAsr(pcm, "zh").catch(() => "")
          whole = t.trim()
        }
      }
      if (!whole) {
        setPh("idle")
        setJudging(false)
        setErrText("没有识别到内容，请再试一次")
        return
      }
      if (!line) {
        setPh("idle")
        setJudging(false)
        return
      }
      const res = await zhAnswerJudge(line.target, whole)
      correctRef.current = res.correct || ""
      setFeedback({ ok: res.ok, praise: res.praise, correct: res.correct, said: whole })
      if (res.ok) {
        await talkSpeak(res.praise)
      } else {
        await talkSpeak(res.praise)
        if (res.correct) await talkSpeak(res.correct)
      }
    } catch {
      if (line) {
        correctRef.current = line.target
        setFeedback({ ok: false, praise: "再试一次！", correct: line.target, said: turn.state.saidText })
      }
    } finally {
      setJudging(false)
      setPh("idle")
    }
  }

  /** 正确句跟读评测 */
  const toggleCorrectEval = async () => {
    if (correctSoe.state.recording) await correctSoe.stop()
    else {
      setErrText("")
      await correctSoe.start()
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
      const sc = await zhDialogueSetup(topic.trim(), words, sentences)
      setScript(sc)
      setTurnIdx(0)
      setFeedback(null)
      setErrText("")
      lastHintTextRef.current = ""
      busyRef.current = false
      setHintRows([])
      correctRef.current = ""
      correctSoe.reset()
      setPh("idle")
      if (sc.lines[0]?.ai) void talkSpeak(sc.lines[0].ai)
    } catch (e) {
      setSetupError(`生成失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setSettingUp(false)
    }
  }

  const reReadAi = () => {
    if (line?.ai) playWhole(line.ai)
  }

  // ── 下一轮 / 完成 ──
  const nextTurn = async () => {
    if (correctSoe.state.recording || correctSoe.state.evaluating) return
    const next = turnIdx + 1
    if (next < (script?.lines.length ?? 0)) {
      await turn.stop().catch(() => "")
      setTurnIdx(next)
      setFeedback(null)
      setErrText("")
      lastHintTextRef.current = ""
      setHintRows([])
      correctRef.current = ""
      correctSoe.reset()
      setPh("idle")
      const aiLine = script!.lines[next].ai
      if (aiLine) void talkSpeak(aiLine)
    } else {
      correctSoe.reset()
      setScript(null)
      setTopic("")
      setWordsText("")
      setSentencesText("")
    }
  }

  // ── 设置界面 ──
  if (!script) {
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>🤖 AI 和你对话学语文</h1>
        </header>
        <div className="card" style={{ padding: 16 }}>
          <p className="module-hint">AI 和你对话学语文：告诉它要练的词句，AI 会编一段小对话和你一问一答，你开口回答，AI 老师即时判定并纠正。</p>
          <label style={{ fontWeight: 700 }}>主题 / 场景（可选，不填 AI 自动决定）</label>
          <input
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px" }}
            placeholder="如：在公园 / 去动物园 / 我的家人"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>练习词语（逗号或空格分隔）</label>
          <input
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px" }}
            placeholder="如：苹果、快乐、跑步"
            value={wordsText}
            onChange={(e) => setWordsText(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>练习句子（每行一句，可选）</label>
          <textarea
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px", minHeight: 64, resize: "vertical" }}
            placeholder={"如：我喜欢吃苹果。\n今天天气真好！"}
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
  const recording = turn.state.recording
  const canStop = phase === "recording"
  const correctScore = correctSoe.state.score

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🤖 {script.title || "AI 和你对话学语文"}</h1>
        <span style={{ fontSize: 13, color: "#536471" }}>{turnIdx + 1}/{script.lines.length}</span>
      </header>

      {/* AI 台词气泡 */}
      {line && (
        <div className="talk-bubble ai">
          <div className="talk-bubble-label">🤖 AI · {topic || "对话"}</div>
          <div className="talk-bubble-text">
            <TapCharText text={line.ai} charSpeakOverride={playCharGuarded} />
          </div>
          <div className="talk-bubble-ops">
            <button className="btn-secondary btn-sm" onClick={reReadAi}>🔊 再读</button>
          </div>
        </div>
      )}

      {/* 孩子回答区 */}
      <div className="card" style={{ marginTop: 10 }}>
        <p className="module-hint" style={{ marginTop: 0 }}>
          听清 AI 的话后，点「🎤 开始录音」说出你的回答。卡住了点「💡 提示整句」。说完了点红色「⏹ 结束」，AI 来点评。
        </p>
        <div className="talk-live">
          <span className="speech-said">{turn.state.saidText}</span>
          {turn.state.interimText && <span className="speech-interim">{turn.state.interimText}</span>}
          {!turn.state.saidText && !turn.state.interimText && !turn.state.recording && (
            <span className="speech-placeholder">（还没说）</span>
          )}
        </div>

        {phase === "recording" && (
          <div className="talk-status go"><span className="talk-dot" /> 录音中… 说完了点下方红色结束</div>
        )}
        {phase === "reading" && (
          <div className="talk-status busy"><span className="talk-dot" /> 🔊 朗读中… 录音已暂停</div>
        )}
        {recording && (
          <div className="speech-level"><div className="speech-level-bar" style={{ width: `${Math.max(4, Math.min(100, turn.state.level * 100))}%` }} /></div>
        )}
        {errText && <p className="err">{errText}</p>}
        {turn.state.error && <p className="err">{turn.state.error}</p>}

        {(phase === "idle" || phase === "recording") && !feedback && !judging && !!line?.target && (
          <button
            className="btn-secondary"
            style={{ width: "100%", marginBottom: 8, padding: "10px 14px" }}
            onClick={() => void hintWhole()}
            title="点击后朗读完整的目标句"
          >
            💡 提示整句
          </button>
        )}

        <div className="speech-actions">
          {phase === "idle" && !feedback && !judging ? (
            <button className="btn-lg talk-rec go" onClick={() => void startRecording()}>🎤 开始录音</button>
          ) : canStop ? (
            <button className="btn-lg talk-rec stop" onClick={() => void finishRecording()}>⏹ 结束</button>
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
                你说：{feedback.said}{feedback.said.trim() ? "。" : ""}
              </p>
            )}
            <p className="talk-feedback-praise">{feedback.ok ? "✅ " : ""}{feedback.praise}</p>
            {!feedback.ok && feedback.correct && (
              <div className="talk-feedback-correct">
                <div className="talk-correct-head">
                  <span>正确说法：</span>
                  <button className="btn-secondary btn-sm" onClick={() => playWhole(feedback.correct)}>🔊 再读</button>
                </div>
                <TapCharText text={feedback.correct} charSpeakOverride={playCharGuarded} />
                <div className="talk-correct-eval">
                  <button
                    className={`btn-lg talk-rec${correctSoe.state.recording ? " stop" : " go"}`}
                    onClick={() => void toggleCorrectEval()}
                    disabled={correctSoe.state.evaluating}
                  >
                    {correctSoe.state.recording
                      ? "⏹ 停止评测"
                      : correctSoe.state.evaluating
                        ? "…评分中"
                        : correctScore !== null
                          ? "🎤 再读一遍"
                          : "🎤 跟读这句"}
                  </button>
                  {correctScore !== null && (
                    <span className={`talk-word-score${correctScore >= 70 ? " good" : " bad"}`}>
                      {correctScore >= 70 ? `✅ ${correctScore}分，读得不错！` : `⚠️ ${correctScore}分，再练一次`}
                    </span>
                  )}
                  {correctSoe.state.error && <span className="talk-word-err">{correctSoe.state.error}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 整句提示记录 */}
      {hintRows.length > 0 && (
        <div className="talk-hints card" style={{ marginTop: 8 }}>
          <div className="talk-hints-title">💡 提示记录</div>
          {hintRows.map((h, i) => (
            <div className="talk-hint-row" key={i}>
              <span className="talk-hint-no">{i + 1}</span>
              <span className="talk-hint-main">
                <span className="talk-hint-text">（整句）{h.text}</span>
              </span>
              <button className="btn-secondary btn-sm" onClick={() => playWhole(h.text)}>🔊</button>
            </div>
          ))}
        </div>
      )}

      {/* 下一轮 */}
      {feedback && (
        <button
          className="btn-primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => void nextTurn()}
          disabled={correctSoe.state.recording || correctSoe.state.evaluating}
        >
          {turnIdx + 1 < (script?.lines.length ?? 0) ? "下一轮 →" : "🎉 完成，再来一次"}
        </button>
      )}
    </div>
  )
}
