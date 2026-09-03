/** TTS 播放 hook — 调用服务端 /tts/synthesize 获取 MP3，经全局音频管理器播放
 *
 * 全局唯一朗读态（与 Android TtsEngine.isSpeaking 对应）：
 * - 同一时刻只允许一个音频（useTts 与拼音部件音频共用 audioManager）
 * - 页面卸载 / 路由切换时自动中断该实例启动的音频
 * - 朗读期间所有朗读按钮禁用，防止重复播放
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../services/api"
import { audioManager, type ReadingState } from "../lib/audioManager"
import { stripEmoji, isSpeakableChar } from "../lib/chars"
import { annotateTts, toBaiduSyllable } from "../lib/ttsPinyin"

/**
 * 单字发音结果。
 * source 含义（对应服务端 /tts/char 的 X-Tts-Source）：
 * - recording：命中人工录音库 data/char_audio（Android 端上传的真人录音，质量最高）
 * - cached：命中 TTS 沉淀库 data/tts_char（之前点过、已落盘，纯 R2 读）
 * - synthesized：本次实时合成（首次点击该字/音节，之后即沉淀）
 * - fallback：端点异常，已回退到旧 /tts/synthesize 通道
 */
export interface CharSpeakResult {
  ok: boolean
  source?: "recording" | "cached" | "synthesized" | "fallback"
}

/** 订阅全局朗读态变化，返回当前是否在朗读 */
export function useGlobalSpeaking(): boolean {
  const [speaking, setSpeaking] = useState(audioManager.speaking)
  useEffect(() => audioManager.subscribe(setSpeaking), [])
  return speaking
}

/** 订阅朗读卡拉OK进度（正在读的字符）；无朗读时为 null */
export function useGlobalReading(): ReadingState | null {
  const [reading, setReading] = useState<ReadingState | null>(null)
  useEffect(() => audioManager.subscribeReading(setReading), [])
  return reading
}

/** 朗读按钮 hook：返回 { speaking, speak, stop } */
export function useTts() {
  const [speaking, setSpeaking] = useState(audioManager.speaking)
  const startedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => audioManager.subscribe(setSpeaking), [])

  // 组件挂载 → 重置挂载标志（StrictMode 双挂载下 useRef 保留旧值，
  // 若不清除，第一次 unmount 置 false 后 remount 仍为 false，speak 全部被拒）
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (startedRef.current) audioManager.stop()
    }
  }, [])

  /**
   * 朗读文本。
   * @param opts.pinyin 与 text 逐字对应的拼音；传入后自动转成百度 `字(pinyin)`
   *   注音语法锁定读音，专治多音字读错。只影响送进 TTS 的文本，
   *   界面卡拉OK高亮仍用原始 text。
   */
  const speak = useCallback(
    async (
      text: string,
      opts: {
        speaker?: string
        speed?: number
        pinyin?: string
        polyphoneOnly?: boolean
      } = {},
    ): Promise<boolean> => {
      if (!text.trim()) return false
      if (!mountedRef.current) return false // 组件已卸载，拒绝播放
      if (audioManager.speaking) return false // 全局正在朗读，忽略

      const ttsText = annotateTts(text, opts.pinyin, {
        // 调用方显式给出拼音时（如 AI 语文的 polyphones），一律标注，
        // 不受多音字集合限制；否则只标多音字以节省字节
        polyphoneOnly: opts.polyphoneOnly ?? true,
      })

      try {
        const blob = await api<Blob>("/tts/synthesize", {
          method: "POST",
          body: {
            text: stripEmoji(ttsText),
            speaker: opts.speaker ?? "0",
            speed: opts.speed ?? 5,
          },
          responseType: "blob",
        })
        const url = URL.createObjectURL(blob)
        if (!mountedRef.current || audioManager.speaking) {
          URL.revokeObjectURL(url)
          return false
        }
        startedRef.current = true
        const ok = audioManager.playUrl(url, text)
        if (!ok) {
          URL.revokeObjectURL(url)
          return false
        }
        // 等待播放自然结束（或被 stop 中断）
        await audioManager.waitFinish()
        return true
      } catch {
        return false
      }
    },
    [],
  )

  /**
   * 单字发音（推荐用于「点一个字/字母/数字朗读」）。
   * 走 GET /tts/char/:char —— **先查服务端音频库**（人工录音 data/char_audio → TTS 沉淀
   * data/tts_char），未命中才实时调百度合成并沉淀。任何字/音节只消耗一次百度配额，
   * 之后全是纯 R2 读（不调百度、不耗 CPU）。这正是「点击单字发音先检查服务器是否
   * 有记录这个字的音频文件」的语义。
   * 返回 source 供 UI 标记（如命中真人录音时显示「真人录音」）。
   * 端点异常时自动回退到旧 /tts/synthesize，保证不哑火。
   */
  const speakChar = useCallback(
    async (char: string, pinyin?: string): Promise<CharSpeakResult> => {
      if (!char || ![...char].length || ![...char].every((c) => isSpeakableChar(c))) return { ok: false }
      if (audioManager.speaking) return { ok: false }
      const syl = pinyin ? toBaiduSyllable(pinyin) : ""
      const q = syl ? `?pinyin=${encodeURIComponent(syl)}` : ""
      try {
        const resp = await api<Response>(
          `/tts/char/${encodeURIComponent(char)}${q}`,
          { method: "GET", responseType: "response" },
        )
        if (resp.ok) {
          const blob = await resp.blob()
          if (blob.size === 0) throw new Error("empty audio")
          const url = URL.createObjectURL(blob)
          if (audioManager.speaking) {
            URL.revokeObjectURL(url)
            return { ok: false }
          }
          if (!audioManager.playUrl(url, char)) {
            URL.revokeObjectURL(url)
            return { ok: false }
          }
          startedRef.current = true
          const source = (resp.headers.get("X-Tts-Source") as CharSpeakResult["source"]) ?? "synthesized"
          await audioManager.waitFinish()
          return { ok: true, source }
        }
      } catch {
        /* 端点异常 → 回退合成通道 */
      }
      // 回退：旧合成通道（POST /tts/synthesize）
      const ok = await speak(char, pinyin ? { pinyin } : undefined)
      return { ok, source: ok ? "fallback" : undefined }
    },
    [speak],
  )

  const stop = useCallback(() => {
    if (startedRef.current) {
      audioManager.stop()
      startedRef.current = false
    }
  }, [])

  return { speaking, speak, speakChar, stop }
}
