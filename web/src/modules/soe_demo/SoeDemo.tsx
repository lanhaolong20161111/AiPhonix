import { useRef, useState } from "react"
import { PcmRecorder, energyLevel } from "../../lib/pcmRecorder"
import { evaluateSoe, type SoeResult, type SoeWord } from "../../lib/soeApi"

const DEFAULT_TEXT = "春天来了，花儿开了，小鸟在树上唱歌。"

function scoreColor(score: number): string {
  if (score >= 80) return "#2E7D32"
  if (score >= 60) return "#F9A825"
  return "#B71C1C"
}

function WordChip({ w }: { w: SoeWord }) {
  return (
    <span
      className="word-chip"
      style={{ borderColor: scoreColor(w.accuracy) }}
      title={`准确度 ${w.accuracy.toFixed(0)}`}
    >
      {w.word}
      <span className="word-score" style={{ color: scoreColor(w.accuracy) }}>
        {w.accuracy.toFixed(0)}
      </span>
    </span>
  )
}

function SoeDemo() {
  const [refText, setRefText] = useState(DEFAULT_TEXT)
  const [engine, setEngine] = useState("") // "" = 自动
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SoeResult | null>(null)
  const [error, setError] = useState("")
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [pcmInfo, setPcmInfo] = useState("")
  const recorderRef = useRef<PcmRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const levelRef = useRef(0)

  const startRecording = async () => {
    setError("")
    setResult(null)
    setPcmInfo("")
    levelRef.current = 0
    const recorder = new PcmRecorder({
      onLevel: (l) => {
        levelRef.current = Math.max(levelRef.current, l)
        setLevel(l)
      },
    })
    recorderRef.current = recorder
    try {
      await recorder.start()
      setRecording(true)
      setSeconds(0)
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (e) {
      setError(`录音启动失败: ${String((e as Error)?.message ?? e)}`)
    }
  }

  const stopAndScore = async () => {
    const recorder = recorderRef.current
    if (!recorder || !recorder.isRecording) return
    setRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const pcm = recorder.stop()
    setLevel(0)
    const peak = energyLevel(pcm)
    setPcmInfo(`PCM: ${pcm.length} 字节 ≈ ${(pcm.length / 32000).toFixed(1)}s · 能量峰值 ${peak.toFixed(3)}`)
    if (pcm.length === 0) {
      setError("没有录到声音，请重试")
      return
    }
    setBusy(true)
    try {
      const r = await evaluateSoe(refText.trim(), pcm, engine)
      setResult(r)
    } catch (e) {
      setError(`评分失败: ${String((e as Error)?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header>
        <h1>🎤 发音评测（Web 试点）</h1>
        <p>浏览器录音 → 服务端 SOE 评分，验证 Web 端语音链路</p>
      </header>

      <section className="card">
        <h2>📝 参考文本</h2>
        <textarea
          rows={3}
          value={refText}
          onChange={(e) => setRefText(e.target.value)}
        />
        <div className="engine-row">
          <label>
            <input
              type="radio"
              checked={engine === ""}
              onChange={() => setEngine("")}
            />
            自动识别中/英文
          </label>
          <label>
            <input
              type="radio"
              checked={engine === "16k_zh"}
              onChange={() => setEngine("16k_zh")}
            />
            中文
          </label>
          <label>
            <input
              type="radio"
              checked={engine === "16k_en"}
              onChange={() => setEngine("16k_en")}
            />
            英文
          </label>
        </div>
      </section>

      <section className="card rec-card">
        <h2>{recording ? "🔴 正在录音…" : "🎤 录音评测"}</h2>
        {recording ? (
          <>
            <p className="rec-hint">请照着参考文本大声朗读，说完点「停止并评分」</p>
            <p className="rec-timer">⏱ {seconds}s</p>
            <div className="level-bar">
              <div
                className="level-fill"
                style={{ width: `${Math.max(4, Math.min(100, level * 100))}%` }}
              />
            </div>
            <p className="level-text">
              {level < 0.02
                ? "⚠ 没检测到声音，请靠近麦克风并大声读"
                : level < 0.1
                  ? "声音较小"
                  : "✓ 检测到声音"}
            </p>
            <button className="btn-danger" onClick={stopAndScore}>
              {busy ? "评分中…" : "🛑 停止并评分"}
            </button>
          </>
        ) : (
          <>
            <p className="rec-hint">
              麦克风录音需要浏览器授权。若按钮无响应，请确认页面在
              localhost 或 https 下访问。
            </p>
            <button onClick={startRecording} disabled={!refText.trim()}>
              🎤 开始录音
            </button>
          </>
        )}
      </section>

      {busy && <p className="msg">正在提交评分，请稍候…</p>}
      {error && <p className="err">{error}</p>}
      {pcmInfo && !error && <p className="msg">{pcmInfo}</p>}

      {result && (
        <section className="card result-card">
          <h2>📊 评测结果</h2>
          <div className="score-main" style={{ color: scoreColor(result.pron_accuracy) }}>
            {result.pron_accuracy.toFixed(0)}
            <span className="score-max">/100</span>
          </div>
          <div className="score-bars">
            <div className="bar-row">
              <span>准确度</span>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${result.pron_accuracy}%`, background: "#2E7D32" }} />
              </div>
              <b>{result.pron_accuracy.toFixed(1)}</b>
            </div>
            <div className="bar-row">
              <span>流利度</span>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${result.pron_fluency * 100}%`, background: "#1565C0" }} />
              </div>
              <b>{result.pron_fluency.toFixed(2)}</b>
            </div>
            <div className="bar-row">
              <span>完整度</span>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${result.pron_completion * 100}%`, background: "#F9A825" }} />
              </div>
              <b>{result.pron_completion.toFixed(2)}</b>
            </div>
          </div>
          <div className="word-chips">
            {result.words.map((w, i) => (
              <WordChip key={`${w.word}-${i}`} w={w} />
            ))}
          </div>
          <p className="engine-note">引擎: {result.engine} · 模式: {result.eval_mode}</p>
        </section>
      )}
    </div>
  )
}

export default SoeDemo
