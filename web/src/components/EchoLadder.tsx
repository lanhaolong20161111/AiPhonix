/** 跟读阶梯 — 片段→扩长→整句 的渐进跟读练习
 *
 * 以「意群 chunks」为最小发音单位，逐级扩长：
 *   第1级 = chunks[0]；第2级 = chunks[0]+chunks[1]；…；最后一级 = 整句。
 * 每级：AI 自动朗读模板 → 孩子点 🎤 跟读（SOE 评分）→ ≥70 过关进下一级。
 * 同一级连错 2 次且 >1 级 → 用 SOE 逐词明细定位失败词 → 降级到该意群「小步」局部练，
 * 小步过关后回到原级继续重组；直到整句完成。
 * 复用 useSoeScore / useTts（快速通道）。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useSoeScore } from "../hooks/useSoeScore"
import { useTts } from "../hooks/useTts"

export interface EchoLadderProps {
  sentence: string
  /** 发音意群（拼接后应等于 sentence） */
  chunks: string[]
  /** 单词级步进单位（传了则按"第1词→前2词→…整句"），如 en 目标句逐词 */
  units?: string[]
  engine: "16k_en" | "16k_zh"
  source?: string
  /** 朗读音色 speaker（英文页可传 0/4193；中文页 6221） */
  speaker?: string
  onFinished?: (ok: boolean) => void
  onSkip?: () => void
  /** 整句过关时的表扬朗读文案（默认英文） */
  praise?: string
  /** 进入/离开朗读或录音（评测）状态时回调，供页面禁用其它 TTS */
  onBusyChange?: (busy: boolean) => void
  /** 是否在挂载时自动先领读一次（页面已经读过可传 false，避免重复） */
  autoReadFirst?: boolean
}

const PASS = 70

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "").trim()
}

export function EchoLadder({ sentence, chunks, units, engine, source = "echo_ladder", speaker, onFinished, onSkip, praise, onBusyChange, autoReadFirst = true }: EchoLadderProps) {
  const { speak } = useTts()
  // 步进单位：优先单词级（units，如"第1词→前2词→…整句"），否则用意群 chunks
  const steps = (units && units.length ? units : chunks ?? []).map((c) => c.trim()).filter(Boolean)
  const total = steps.length
  const wordMode = !!(units && units.length)

  const [level, setLevel] = useState(1) // 1..total，含前 level 个单位
  const [failCount, setFailCount] = useState(0)
  const [drill, setDrill] = useState<string | null>(null) // 局部小步（单个失败单位）
  const [done, setDone] = useState(false)
  const doneRef = useRef(false)
  const firstReadRef = useRef(true)
  /** AI 正在领读（读完才允许跟读录音） */
  const [reading, setReading] = useState(false)
  /** 失败后重读触发计数 */
  const [retry, setRetry] = useState(0)

  const target = drill ?? (total > 0 ? steps.slice(0, level).join(" ") : sentence)
  // scene 必须与被测文本/引擎匹配，否则腾讯报 4104（RefText 超限）：
  // 中文 eval_mode=0 是「单字模式」（RefText 仅 1 字），多字要走 sentence（≤30 字）/paragraph（≤120 字）；
  // 英文按空格分词，1 词 = word，2~30 词 = sentence。
  const soeScene = (() => {
    if (engine === "16k_zh") {
      const n = [...target].filter((c) => c >= "\u4e00" && c <= "\u9fff").length
      if (n <= 1) return "word"
      return n <= 30 ? "sentence" : "paragraph"
    }
    return target.split(/\s+/).filter(Boolean).length > 1 ? "sentence" : "word"
  })()
  const soe = useSoeScore(() => ({
    refText: target,
    scene: soeScene,
    engine,
    source,
  }))

  const speakTarget = useCallback(
    async (t: string): Promise<void> => {
      if (!t) return
      // 硬超时：底层播放 promise 万一不返回（浏览器差异），也不让"先听后评"卡死
      await Promise.race([
        speak(t, speaker ? { speaker } : {}),
        new Promise<void>((r) => setTimeout(r, 12_000)),
      ])
    },
    [speak, speaker],
  )

  // 进入每一级 / 小步 / 失败重试：先 TTS 领读，读完才允许孩子跟读
  useEffect(() => {
    if (done || !target) return
    if (!autoReadFirst && firstReadRef.current) {
      firstReadRef.current = false
      setReading(false)
      return
    }
    firstReadRef.current = false
    let on = true
    setReading(true)
    speakTarget(target)
      .catch(() => { /* 朗读失败不阻塞测评 */ })
      .finally(() => {
        if (on) setReading(false)
      })
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, drill, retry, done])

  // 忙着（领读或录音评测）时通知页面禁用其它 TTS
  useEffect(() => {
    onBusyChange?.(reading || soe.state.recording || soe.state.evaluating)
  }, [reading, soe.state.recording, soe.state.evaluating, onBusyChange])
  useEffect(() => () => { onBusyChange?.(false) }, [onBusyChange])

  const finishAll = () => {
    if (doneRef.current) return
    doneRef.current = true
    setDone(true)
    void speakTarget(praise ?? "Great! Whole sentence done.")
    onFinished?.(true)
  }

  /** 从逐词明细找失败词所在单位 */
  const failingChunk = (): string | null => {
    const words = soe.state.result?.words
    if (!Array.isArray(words)) return null
    const bad = words.filter((w) => (w.accuracy ?? 0) < PASS)
    if (!bad.length) return null
    const badWords = bad.map((w) => normWord(w.word)).filter(Boolean)
    return steps.find((c) => {
      const cw = c.split(/\s+/).map(normWord).filter(Boolean)
      return cw.some((w) => badWords.includes(w))
    }) ?? null
  }

  const handleScore = async (score: number | null) => {
    if (score === null) return
    if (score >= PASS) {
      if (drill) {
        // 小步过关 → 清 drill，回到原级继续
        setDrill(null)
        setFailCount(0)
        return
      }
      setFailCount(0)
      const next = level + 1
      if (next > total) {
        finishAll()
      } else {
        setLevel(next)
      }
    } else {
      // 失败：先重新 AI 领读一次（测评前先听），同级最多 2 次后降级到失败单位局部练
      const nf = failCount + 1
      setFailCount(nf)
      setRetry((r) => r + 1)
      if (!drill && level > 1 && nf >= 2) {
        const chunk = failingChunk() ?? steps[level - 1] ?? null
        if (chunk) setDrill(chunk)
      }
    }
  }

  const toggleRecord = async () => {
    if (reading) return // 先听完 AI 领读
    if (soe.state.recording) {
      const score = await soe.stop()
      await handleScore(score)
    } else {
      await soe.start()
    }
  }

  if (done) {
    return (
      <div className="echo-ladder done">
        <p className="talk-word-score good">✅ 整句跟读完成！</p>
        <button className="btn-secondary btn-sm" onClick={onSkip}>收起</button>
      </div>
    )
  }

  const highlight = (idx: number, text: string) => {
    // 已过关单位打勾；当前关注（最后一段在非 drill 时）高亮
    if (idx < level - 1) return <span key={idx} className="echo-chunk done-chunk">✔ {text}</span>
    if (drill) return <span key={idx} className="echo-chunk plain-chunk">{text}</span>
    return <span key={idx} className="echo-chunk active-chunk">{text}</span>
  }

  const unitLabel = wordMode ? "词" : "片段"

  return (
    <div className="echo-ladder card" style={{ marginTop: 8, padding: 10 }}>
      <div className="echo-ladder-title">
        {drill ? `🩹 小步练习（先把这个${wordMode ? "词" : "意群"}读准）` : `🧗 跟读阶梯 · ${unitLabel} ${level}/${total}`}
        {!drill && <button className="btn-secondary btn-sm" onClick={onSkip}>跳过</button>}
      </div>

      {drill ? (
        <div className="echo-ladder-drill">
          <span className="echo-ladder-label">小步：</span>
          <span className="talk-hint-text">{drill}</span>
        </div>
      ) : (
        <div className="echo-ladder-line">{steps.map((c, i) => highlight(i, c))}</div>
      )}

      <div className="echo-ladder-ops">
        <button
          className="btn-secondary btn-sm"
          disabled={reading || soe.state.recording || soe.state.evaluating}
          onClick={() => { setReading(true); void speakTarget(drill ?? target).finally(() => setReading(false)) }}
        >
          🔊 再听
        </button>
        <button
          className={`btn-lg talk-rec${soe.state.recording ? " stop" : " go"}`}
          onClick={() => void toggleRecord()}
          disabled={reading || soe.state.evaluating}
        >
          {reading ? "🔊 先听 AI 读…" : soe.state.recording ? "⏹ 停止" : soe.state.evaluating ? "…评分中" : "🎤 跟读"}
        </button>
      </div>
      {soe.state.recording && (
        <div className="speech-level"><div className="speech-level-bar" style={{ width: `${Math.max(4, Math.min(100, soe.state.level * 100))}%` }} /></div>
      )}
      {soe.state.score !== null && (
        <p className={`talk-word-score${soe.state.score >= PASS ? " good" : " bad"}`}>
          {soe.state.score >= PASS ? `✅ ${soe.state.score}分，过关！` : `⚠️ ${soe.state.score}分，再试一次${failCount >= 2 && level > 1 && !drill ? "（准备拆小步）" : ""}`}
        </p>
      )}
      {soe.state.error && <p className="talk-word-err">{soe.state.error}</p>}
    </div>
  )
}
