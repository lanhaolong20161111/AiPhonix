/** 发音评测 hook — 录音 → SOE 评分（复用 pcmRecorder + soeApi） */

import { useCallback, useEffect, useRef, useState } from "react"
import { PcmRecorder } from "../lib/pcmRecorder"
import { evaluateSoe, type SoeResult } from "../lib/soeApi"
import { useAuthStore } from "../stores/authStore"

export interface UseSoeScoreOptions {
  /** 参考文本 */
  refText: string
  /** 评测引擎（空=自动） */
  engine?: string
  /** 兼容旧参数：评测模式（"0"/"1"/"2"/"8"） */
  evalMode?: string
  /** 被测对象类型（推荐）：word / sentence / paragraph / pinyin —— 决定腾讯 eval_mode */
  scene?: string
  /** 最短有效音频字节（默认 12800 = 0.4s @16kHz） */
  minBytes?: number
  /** 来源字卡/词（评测上下文 char/词），用于评测历史按来源跳转定位 */
  source?: string
}

export interface SoeScoreState {
  recording: boolean
  evaluating: boolean
  /** 录音音量等级（0-1），用于实时电平显示 */
  level: number
  /** 评测结果（null=尚未评测成功） */
  score: number | null
  /** 完整评测明细（每词/每音素得分） */
  result: SoeResult | null
  /** 最近一次成功评测的原始 PCM（16kHz/16bit/mono，无 WAV 头），用于 A/B 回放；null=无 */
  lastPcm: Uint8Array | null
  error: string
}

/**
 * 录音 → 停止 → 上传 SOE → 返回分数。
 * 返回 { state, start, stop }。
 * 调用方在 start/stop 间展示录音 UI，stop 会触发评分。
 */
export function useSoeScore(opts: () => UseSoeScoreOptions) {
  const [state, setState] = useState<SoeScoreState>({
    recording: false,
    evaluating: false,
    level: 0,
    score: null,
    result: null,
    lastPcm: null,
    error: "",
  })
  const recorderRef = useRef<PcmRecorder | null>(null)
  /** 最近一次成功评分的 PCM（同步更新，供调用方在 stop().then 里立即读，做 A/B 回放） */
  const lastPcmRef = useRef<Uint8Array | null>(null)

  // 卸载时务必释放麦克风：组件被路由切换/页面关闭时若仍在录音，
  // 不显式 stop 会导致 MediaStream 永久占用（麦克风指示灯常亮）——P1-9。
  useEffect(() => {
    return () => {
      const r = recorderRef.current
      recorderRef.current = null
      try {
        r?.destroy()
      } catch {
        /* 忽略卸载时的释放异常 */
      }
    }
  }, [])

  const start = useCallback(async () => {
    // 防御：上次未正常释放的 recorder 先销毁，避免重复 start 泄漏上一个麦克风流（P1-9）
    if (recorderRef.current) {
      try {
        recorderRef.current.destroy()
      } catch {
        /* 忽略 */
      }
      recorderRef.current = null
    }
    const recorder = new PcmRecorder({
      onLevel: (l) => setState((s) => ({ ...s, level: l })),
    })
    recorderRef.current = recorder
    lastPcmRef.current = null
    setState((s) => ({ ...s, recording: false, evaluating: false, score: null, result: null, lastPcm: null, error: "", level: 0 }))
    try {
      await recorder.start()
      setState((s) => ({ ...s, recording: true }))
      return true
    } catch (e) {
      recorderRef.current = null
      setState((s) => ({
        ...s,
        recording: false,
        error: `录音启动失败: ${String((e as Error)?.message ?? e)}`,
      }))
      return false
    }
  }, [])

  const stop = useCallback(async (): Promise<number | null> => {
    const recorder = recorderRef.current
    if (!recorder || !recorder.isRecording) return null
    recorderRef.current = null // 立即解绑，便于 GC；麦克风资源在 recorder.stop() 内已释放（P1-9）
    setState((s) => ({ ...s, recording: false, level: 0 }))
    const pcm = recorder.stop()
    const { refText, engine, evalMode, minBytes, scene, source } = opts()
    const min = minBytes ?? 12800
    if (pcm.length < min) {
      lastPcmRef.current = null
      setState((s) => ({
        ...s,
        evaluating: false,
        lastPcm: null,
        error: "录音太短，请再读一次",
      }))
      return null
    }
    setState((s) => ({ ...s, evaluating: true, error: "" }))
    try {
      // 带上当前登录账号，服务端把评测明细（含音素）记到该账号下
      const userId = useAuthStore.getState().session?.user.user_id ?? 0
      const result = await evaluateSoe(refText, pcm, engine ?? "", evalMode ?? "", scene ?? "", userId, source ?? "")
      const score = Math.round(result.pron_accuracy)
      lastPcmRef.current = pcm
      setState((s) => ({ ...s, evaluating: false, score, result, lastPcm: pcm }))
      return score
    } catch (e) {
      lastPcmRef.current = null
      setState((s) => ({
        ...s,
        evaluating: false,
        lastPcm: null,
        error: `评分失败: ${String((e as Error)?.message ?? e)}`,
      }))
      return null
    }
  }, [opts])

  const reset = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder?.isRecording) {
      try {
        recorder.stop()
      } catch {
        /* 忽略 */
      }
    }
    recorderRef.current = null
    lastPcmRef.current = null
    setState((s) => ({
      ...s,
      recording: false,
      evaluating: false,
      score: null,
      result: null,
      lastPcm: null,
      error: "",
      level: 0,
    }))
  }, [])

  return { state, start, stop, reset, lastPcmRef }
}
