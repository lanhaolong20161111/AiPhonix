/** 语音造句补全 hook — 流式录音 → 百度 ASR（经 Worker 中转）→ 停顿检测 → 触发 LLM 补全
 *
 * 链路：PcmRecorder(onPcmChunk) → WS /api/v1/asr/stream?lang=xx → Worker 转发百度。
 * 百度回 MID_TEXT(实时)/FIN_TEXT(一句终)，累积成已说文本；
 * FIN_TEXT 后停顿 PAUSE_MS 无新句 → 判定孩子说完了 → 调 /llm/sentence-complete 拿 3 候选。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { PcmRecorder } from "../lib/pcmRecorder"
import { api } from "../services/api"

export type ComposeLang = "zh" | "en"
export type ComposerPhase = "idle" | "recording" | "completing" | "done" | "error"

export interface ComposerState {
  phase: ComposerPhase
  /** 已说文本（FIN_TEXT 累积，去空格便于显示） */
  saidText: string
  /** 实时临时文本（MID_TEXT，随说话刷新；停顿后清空） */
  interimText: string
  /** 音量等级 0-1 */
  level: number
  /** 补全候选（3 条） */
  candidates: string[]
  /** 补全中是否可再触发 */
  paused: boolean
  error: string
}

const PAUSE_MS = 2500 // 停顿判定阈值
const SILENCE_RESET_MS = 8000 // 长时间无有效语音 → 强制结束本轮

const WS_BASE = (() => {
  const p = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${p}//${window.location.host}/api/v1`
})()

export function useSpeechComposer(lang: ComposeLang) {
  const [state, setState] = useState<ComposerState>({
    phase: "idle",
    saidText: "",
    interimText: "",
    level: 0,
    candidates: [],
    paused: false,
    error: "",
  })

  const recorderRef = useRef<PcmRecorder | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const saidTextRef = useRef("")
  const pauseTimerRef = useRef<number | null>(null)
  const resetTimerRef = useRef<number | null>(null)
  const phaseRef = useRef<ComposerPhase>("idle")
  const busyRef = useRef(false)

  const patch = useCallback((p: Partial<ComposerState>) => {
    setState((s) => ({ ...s, ...p }))
  }, [])

  const setPhase = useCallback((phase: ComposerPhase) => {
    phaseRef.current = phase
    setState((s) => ({ ...s, phase }))
  }, [])

  // 清理计时器
  const clearTimers = useCallback(() => {
    if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current)
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current)
    pauseTimerRef.current = null
    resetTimerRef.current = null
  }, [])

  // 卸载释放
  useEffect(() => {
    return () => {
      clearTimers()
      try { wsRef.current?.close() } catch { /* ignore */ }
      wsRef.current = null
      try { recorderRef.current?.destroy() } catch { /* ignore */ }
      recorderRef.current = null
    }
  }, [clearTimers])

  /** 触发补全：停掉本轮录音/WS，把已说文本发 /llm/sentence-complete */
  const requestComplete = useCallback(async () => {
    if (busyRef.current) return
    const partial = saidTextRef.current.trim()
    if (!partial) return
    busyRef.current = true
    clearTimers()
    // 关 WS + 停录音（先发 FINISH 收尾再断）
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "FINISH" }))
        // 稍候让百度出最后 FIN_TEXT
        await new Promise((r) => setTimeout(r, 400))
      }
    } catch { /* ignore */ }
    try { wsRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    try { recorderRef.current?.destroy() } catch { /* ignore */ }
    recorderRef.current = null

    setPhase("completing")
    patch({ interimText: "", candidates: [], error: "" })
    try {
      const res = await api<{ sentences: string[] }>("/llm/sentence-complete", {
        method: "POST",
        body: { lang, partial },
        timeoutMs: 60000,
      })
      patch({ candidates: res.sentences ?? [] })
      setPhase("done")
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      setPhase("error")
      patch({ error: `补全失败：${msg}` })
    } finally {
      busyRef.current = false
    }
  }, [clearTimers, lang, patch, setPhase])

  /** 停顿检测：每次文本推进后重置 PAUSE_MS 计时，超时且已说非空 → 补全 */
  const armPauseTimer = useCallback(() => {
    if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null
      if (phaseRef.current === "recording" && saidTextRef.current.trim()) {
        void requestComplete()
      }
    }, PAUSE_MS)
  }, [requestComplete])

  /** 开始一轮口述 */
  const start = useCallback(async (): Promise<boolean> => {
    // 清理上一轮
    clearTimers()
    try { wsRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    try { recorderRef.current?.destroy() } catch { /* ignore */ }
    recorderRef.current = null
    saidTextRef.current = ""
    busyRef.current = false

    patch({ saidText: "", interimText: "", candidates: [], error: "", level: 0 })

    // 1) 连 WS（Worker 中转百度）
    const ws = new WebSocket(`${WS_BASE}/asr/stream?lang=${lang}`)
    ws.binaryType = "arraybuffer"
    const wsReady = new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true)
      ws.onerror = () => resolve(false)
    })
    wsRef.current = ws

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return
      let j: any = null
      try { j = JSON.parse(ev.data as string) } catch { return }
      if (j?.type === "MID_TEXT" && j.result) {
        patch({ interimText: String(j.result) })
      } else if (j?.type === "FIN_TEXT") {
        if (j.err_no !== 0) {
          // -3005 无效音频等 → 忽略（静音误触发）；-3004 等 → 提示
          if (j.err_no === -3004) patch({ error: "语音服务鉴权失败，请稍后重试" })
          return
        }
        const t = String(j.result ?? "").trim()
        if (!t) return
        const prev = saidTextRef.current
        const next = prev ? (prev.endsWith(t) ? prev : prev + t) : t
        saidTextRef.current = next
        patch({ saidText: next, interimText: "" })
        // 文本推进 → 重新计时停顿
        armPauseTimer()
        // 重置超时保险（太久无 FIN_TEXT 强制结束）
        if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current)
        resetTimerRef.current = window.setTimeout(() => {
          if (phaseRef.current === "recording" && saidTextRef.current.trim()) void requestComplete()
        }, SILENCE_RESET_MS)
      }
    }
    ws.onclose = () => { /* WS 关闭由补全/stop 管理 */ }

    const ok = await wsReady
    if (!ok) {
      patch({ error: "语音连接失败，请检查网络" })
      setPhase("error")
      return false
    }

    // 2) 启动录音，onPcmChunk → 实时发 WS
    const recorder = new PcmRecorder({
      onLevel: (l) => patch({ level: l }),
      onPcmChunk: (chunk) => {
        const w = wsRef.current
        if (w && w.readyState === WebSocket.OPEN) {
          try { w.send(chunk.buffer as ArrayBuffer) } catch { /* ignore */ }
        }
      },
    })
    recorderRef.current = recorder
    try {
      await recorder.start()
    } catch (e) {
      patch({ error: `麦克风启动失败：${String((e as Error)?.message ?? e)}` })
      setPhase("error")
      return false
    }

    // 3) 发 START（Worker 会注入凭据 + dev_pid）
    try {
      ws.send(JSON.stringify({ type: "START", data: { cuid: `web-${Date.now()}` } }))
    } catch { /* ignore */ }

    setPhase("recording")
    patch({ error: "" })
    return true
  }, [armPauseTimer, clearTimers, lang, patch, requestComplete, setPhase])

  /** 手动结束（用户点"好了"）——优先于停顿自动触发 */
  const finish = useCallback(() => {
    if (phaseRef.current !== "recording") return
    clearTimers()
    void requestComplete()
  }, [clearTimers, requestComplete])

  /** 重新开始 */
  const restart = useCallback(() => {
    clearTimers()
    try { wsRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    try { recorderRef.current?.destroy() } catch { /* ignore */ }
    recorderRef.current = null
    saidTextRef.current = ""
    busyRef.current = false
    patch({ saidText: "", interimText: "", candidates: [], error: "", level: 0, paused: false })
    setPhase("idle")
  }, [clearTimers, patch, setPhase])

  return { state, start, finish, restart }
}
