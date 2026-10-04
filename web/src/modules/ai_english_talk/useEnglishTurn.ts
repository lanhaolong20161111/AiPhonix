/** 英语对话单轮录音 hook — 长按 ASR（百度实时，经 Worker 中转），停顿上报给页面做逐词提示
 *
 * 与 useSpeechComposer 的区别：停顿触发「提示下一个词」由页面驱动（onPause 上报，
 * 不自动停止/补全）。支持 pause()/resume()：评词前 pause 释放麦克风（保留已说文本），
 * 评词过关后 resume 继续收话；stop() = 本轮结束取整句（返回并清空已说文本）。
 * 词级发音评测走 useSoeScore（scene=word）短按录音，与本 hook 的 ASR 互不冲突（先 pause 再评）。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { PcmRecorder } from "../../lib/pcmRecorder"

const WS_BASE = (() => {
  const p = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${p}//${window.location.host}/api/v1`
})()

/** 清洗 ASR 片段：去掉句子标点（.?!。？！），话没说完不显示句号；
 * 保留字母/撇号/连字符，多余空白折叠。整句结束时由调用方统一补一个句点。 */
export function cleanAsrText(t: string): string {
  return t
    .replace(/[.,!?。？！]+(?:\s+|$)/g, (m) => (m.trim() ? " " : ""))
    .replace(/\s+/g, " ")
    .trim()
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!b.length) return a
  if (!a.length) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export interface EnglishTurnState {
  recording: boolean
  /** 已说文本（FIN_TEXT 累积） */
  saidText: string
  /** 实时临时文本（MID_TEXT） */
  interimText: string
  level: number
  error: string
}

interface UseEnglishTurnOpts {
  /** ASR 语言：zh=dev_pid 15372、en=17372；决定 /asr/stream?lang= 参数 */
  lang?: "zh" | "en"
  /** ASR 停顿 N ms 无新句 → 回调（页面据此提示下一个词）；null 则不触发 */
  pauseMs?: number
  /** 开始录音后完全没出过声的首静默超时（ms）；到点提示一次第一个词（每轮一次）。
   *  默认 0 = 关闭（不说话就永远不提示）。 */
  initialSilenceMs?: number
  onPause?: (saidSoFar: string) => void
  /** 首静默超时专用回调（开始后一直没出过声）；缺省时复用 onPause */
  onInitialSilence?: (saidSoFar: string) => void
}

export function useEnglishTurn(opts: UseEnglishTurnOpts = {}) {
  const lang = opts.lang ?? "en"
  const pauseMs = opts.pauseMs ?? 2000
  const initialSilenceMs = opts.initialSilenceMs ?? 0
  const [state, setState] = useState<EnglishTurnState>({
    recording: false,
    saidText: "",
    interimText: "",
    level: 0,
    error: "",
  })
  const recorderRef = useRef<PcmRecorder | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const saidTextRef = useRef("")
  /** 本轮从开始到现在的全部 PCM（跨暂停/恢复拼接），供"流式空结果→短语音兜底"上传用 */
  const pcmAccumRef = useRef<Uint8Array>(new Uint8Array(0))
  const optsRef = useRef(opts)
  optsRef.current = opts
  // 能量停顿检测状态
  const lastVoiceTsRef = useRef(0)
  /** 最近一次 ASR 出字时间（MID/FIN_TEXT 也算"在说话"，用于重置静音计时） */
  const lastAsrTsRef = useRef(0)
  const hadVoiceRef = useRef(false)
  const hintFiredRef = useRef(false)
  /** 首静默提示已触发（每轮 start() 时复位；resume 续说不复位，保证只提示一次） */
  const initialHintFiredRef = useRef(false)
  const startedAtRef = useRef(0)
  const checkTimerRef = useRef<number | null>(null)
  const ENERGY_TH = 0.02

  const patch = useCallback((p: Partial<EnglishTurnState>) => setState((s) => ({ ...s, ...p })), [])

  const firePause = useCallback((initial: boolean, said: string) => {
    const conf = optsRef.current
    if (initial && conf.onInitialSilence) conf.onInitialSilence(said)
    else conf.onPause?.(said)
  }, [])

  // 卸载释放
  useEffect(() => {
    return () => {
      if (checkTimerRef.current) window.clearInterval(checkTimerRef.current)
      try { wsRef.current?.close() } catch { /* ignore */ }
      wsRef.current = null
      try { recorderRef.current?.destroy() } catch { /* ignore */ }
      recorderRef.current = null
    }
  }, [])

  // 能量轮询：每 300ms 检查
  // ① 首静默：开始后完全没出过声，超 initialSilenceMs → 触发一次（每轮一次，不无限等）
  // ② 停顿：说过话且静音 ≥ pauseMs → 提示下一个词（不重复触发）
  const armPauseCheck = useCallback(() => {
    if (checkTimerRef.current) return
    checkTimerRef.current = window.setInterval(() => {
      const now = Date.now()
      if (
        initialSilenceMs > 0 &&
        !hadVoiceRef.current &&
        !initialHintFiredRef.current &&
        now - startedAtRef.current >= initialSilenceMs
      ) {
        initialHintFiredRef.current = true
        hintFiredRef.current = true
        firePause(true, saidTextRef.current)
        return
      }
      // 只要还有任何说话活动（能量出声 或 ASR 出字）就重置计时；
      // 连续静音真正达到 pauseMs 才提示下一个词
      const lastAct = Math.max(lastVoiceTsRef.current, lastAsrTsRef.current)
      if (
        hadVoiceRef.current &&
        !hintFiredRef.current &&
        now - lastAct >= pauseMs
      ) {
        hintFiredRef.current = true
        firePause(false, saidTextRef.current)
      }
    }, 300)
  }, [firePause, initialSilenceMs, pauseMs])

  const clearPauseCheck = useCallback(() => {
    if (checkTimerRef.current) {
      window.clearInterval(checkTimerRef.current)
      checkTimerRef.current = null
    }
  }, [])

  /** 真正开录音+WS 的内部实现。keepText=true 时不清 saidText（供 resume 续说）。 */
  const open = useCallback(async (keepText: boolean): Promise<boolean> => {
    clearPauseCheck()
    try { wsRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    try { recorderRef.current?.destroy() } catch { /* ignore */ }
    recorderRef.current = null
    if (!keepText) {
      saidTextRef.current = ""
      pcmAccumRef.current = new Uint8Array(0) // 新一轮清空 PCM 累积
      initialHintFiredRef.current = false // 新一轮：允许再次触发首静默提示
      patch({ saidText: "", interimText: "", level: 0 })
    }
    lastVoiceTsRef.current = Date.now()
    lastAsrTsRef.current = Date.now()
    startedAtRef.current = Date.now()
    hadVoiceRef.current = false
    hintFiredRef.current = false

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
        // ASR 正在出字 = 孩子在说话：重置静音计时，绝不中途弹提示
        lastAsrTsRef.current = Date.now()
        hadVoiceRef.current = true
        hintFiredRef.current = false
        patch({ interimText: cleanAsrText(String(j.result)) })
      } else if (j?.type === "FIN_TEXT") {
        if (j.err_no !== 0) {
          if (j.err_no === -3004) patch({ error: "语音服务鉴权失败，请稍后重试" })
          return
        }
        const t = cleanAsrText(String(j.result ?? ""))
        if (!t) return
        lastAsrTsRef.current = Date.now()
        hadVoiceRef.current = true
        hintFiredRef.current = false
        const prev = saidTextRef.current
        const sep = lang === "zh" ? "" : prev.endsWith(" ") ? "" : " " // 中文不插空格
        const next = prev ? (prev.endsWith(t) ? prev : prev + sep + t) : t
        saidTextRef.current = next
        patch({ saidText: next, interimText: "" })
      }
    }

    const ok = await wsReady
    if (!ok) {
      patch({ error: "语音连接失败，请检查网络" })
      return false
    }

    const recorder = new PcmRecorder({
      onLevel: (l) => {
        patch({ level: l })
        if (l >= ENERGY_TH) {
          lastVoiceTsRef.current = Date.now()
          hadVoiceRef.current = true
          hintFiredRef.current = false
        }
      },
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
      return false
    }
    try { ws.send(JSON.stringify({ type: "START", data: { cuid: `talk-${Date.now()}` } })) } catch { /* ignore */ }
    patch({ recording: true, error: "" })
    armPauseCheck()
    return true
  }, [armPauseCheck, clearPauseCheck, lang, patch])

  /** 开始新一轮（清空已说） */
  const start = useCallback((): Promise<boolean> => open(false), [open])

  /** 发 FINISH 后等百度回完该句 FIN_TEXT 再放行（单词/短句时结果只在 FINISH 后才回，
   * 固定等 300ms 常掐掉尾部结果）。FIN_TEXT 会经 onmessage 追加进 saidText。 */
  const waitFinalText = useCallback((ws: WebSocket, timeoutMs: number): Promise<void> => {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        ws.removeEventListener("message", onMsg)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      const onMsg = (ev: MessageEvent) => {
        if (typeof ev.data !== "string") return
        try {
          const j = JSON.parse(ev.data)
          if (j?.type === "FIN_TEXT" || j?.type === "CLOSED" || j?.type === "ERROR") finish()
        } catch { /* ignore */ }
      }
      ws.addEventListener("message", onMsg)
    })
  }, [])

  /** 暂停 ASR（评词/短暂停顿），释放麦克风但保留已说文本；同时把这段 PCM 并入整轮累积 */
  const pause = useCallback(async (): Promise<void> => {
    clearPauseCheck()
    try {
      const w = wsRef.current
      if (w?.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ type: "FINISH" }))
        // 等百度把短句/单词的最终结果吐回来（最长 1.5s），再关连接
        await waitFinalText(w, 1500)
      }
    } catch { /* ignore */ }
    try { wsRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    const r = recorderRef.current
    recorderRef.current = null
    try {
      if (r?.isRecording) {
        pcmAccumRef.current = concatBytes(pcmAccumRef.current, r.stop())
      } else {
        r?.destroy()
      }
    } catch { /* ignore */ }
    patch({ recording: false, level: 0 })
  }, [clearPauseCheck, patch, waitFinalText])

  /** 取走整轮累积 PCM（并清空），供"流式空结果→短语音识别"兜底上传 */
  const takePcm = useCallback((): Uint8Array => {
    const out = pcmAccumRef.current
    pcmAccumRef.current = new Uint8Array(0)
    return out
  }, [])

  /** 恢复 ASR（保留已说文本续说） */
  const resume = useCallback((): Promise<boolean> => open(true), [open])

  /** 本轮结束：取整句并清空 */
  const stop = useCallback(async (): Promise<string> => {
    await pause()
    const said = saidTextRef.current.trim()
    saidTextRef.current = ""
    patch({ saidText: "" })
    return said
  }, [pause, patch])

  return { state, start, pause, resume, stop, takePcm }
}
