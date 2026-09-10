/** 分段录音 hook（中文造句等用）：只做"录音→能量停顿检测→取出本段 PCM"，
 * 识别改用百度短语音整段上传（/asr/short），由页面在停顿/结束时上传。
 *
 * 说明：去掉了流式 WS；停顿检测仍基于麦克风能量（与提示词打断逻辑解耦）。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { PcmRecorder } from "../lib/pcmRecorder"

export interface SegmentAsrState {
  recording: boolean
  level: number
  error: string
}

interface UseSegmentAsrOpts {
  /** 停顿 N ms（说话后静音）→ onPause 回调（页面据此收段+提示） */
  pauseMs?: number
  /** 开始后完全没出过声的首静默超时；到点回调一次（每轮一次） */
  initialSilenceMs?: number
  onPause?: () => void
}

export function useSegmentAsr(opts: UseSegmentAsrOpts = {}) {
  const pauseMs = opts.pauseMs ?? 2000
  const initialSilenceMs = opts.initialSilenceMs ?? 0
  const [state, setState] = useState<SegmentAsrState>({ recording: false, level: 0, error: "" })
  const recorderRef = useRef<PcmRecorder | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const lastVoiceTsRef = useRef(0)
  const hadVoiceRef = useRef(false)
  const pauseFiredRef = useRef(false)
  const initialFiredRef = useRef(false)
  const startedAtRef = useRef(0)
  const checkTimerRef = useRef<number | null>(null)
  const ENERGY_TH = 0.02

  const patch = useCallback((p: Partial<SegmentAsrState>) => setState((s) => ({ ...s, ...p })), [])

  useEffect(() => {
    return () => {
      if (checkTimerRef.current) window.clearInterval(checkTimerRef.current)
      try { recorderRef.current?.destroy() } catch { /* ignore */ }
      recorderRef.current = null
    }
  }, [])

  const clearTimer = useCallback(() => {
    if (checkTimerRef.current) {
      window.clearInterval(checkTimerRef.current)
      checkTimerRef.current = null
    }
  }, [])

  const armTimer = useCallback(() => {
    clearTimer()
    checkTimerRef.current = window.setInterval(() => {
      const now = Date.now()
      const conf = optsRef.current
      if (initialSilenceMs > 0 && !hadVoiceRef.current && !initialFiredRef.current && now - startedAtRef.current >= initialSilenceMs) {
        initialFiredRef.current = true
        pauseFiredRef.current = true
        conf.onPause?.()
        return
      }
      if (hadVoiceRef.current && !pauseFiredRef.current && now - lastVoiceTsRef.current >= pauseMs) {
        pauseFiredRef.current = true
        conf.onPause?.()
      }
    }, 300)
  }, [clearTimer, initialSilenceMs, pauseMs])

  const open = useCallback(async (): Promise<boolean> => {
    clearTimer()
    try { recorderRef.current?.destroy() } catch { /* ignore */ }
    recorderRef.current = null
    lastVoiceTsRef.current = Date.now()
    startedAtRef.current = Date.now()
    hadVoiceRef.current = false
    pauseFiredRef.current = false

    const recorder = new PcmRecorder({
      onLevel: (l) => {
        patch({ level: l })
        if (l >= ENERGY_TH) {
          lastVoiceTsRef.current = Date.now()
          hadVoiceRef.current = true
          pauseFiredRef.current = false
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
    patch({ recording: true, error: "" })
    armTimer()
    return true
  }, [armTimer, clearTimer, patch])

  /** 开始新一段录音（每轮/每次提示词结束后调用） */
  const start = useCallback((): Promise<boolean> => open(), [open])
  /** 提示词结束自动续录 */
  const resume = useCallback((): Promise<boolean> => open(), [open])

  /** 取走本段 PCM 并停止录音（之后可 resume 开新段）。返回 16k PCM 或空数组 */
  const capture = useCallback((): Uint8Array => {
    clearTimer()
    const r = recorderRef.current
    recorderRef.current = null
    if (r?.isRecording) {
      const pcm = r.stop()
      patch({ recording: false, level: 0 })
      return pcm.length ? pcm : new Uint8Array(0)
    }
    patch({ recording: false, level: 0 })
    return new Uint8Array(0)
  }, [clearTimer, patch])

  return { state, start, resume, capture }
}
