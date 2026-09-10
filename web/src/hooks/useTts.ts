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

/** 客户端 LRU 音频缓存：同文本+同参数第二次朗读直接播内存 Blob（消除重复合成的延迟感） */
const TTS_CACHE = new Map<string, Blob>()
const TTS_CACHE_MAX = 80

function ttsKey(text: string, speaker: string, speed: number, engine: string, avoidPregen: boolean): string {
  return `${engine}|${speaker}|${speed}|${avoidPregen ? 1 : 0}|${text}`
}
function cacheGet(key: string): Blob | undefined {
  const b = TTS_CACHE.get(key)
  if (b) {
    TTS_CACHE.delete(key) // LRU：命中后移到末尾
    TTS_CACHE.set(key, b)
  }
  return b
}
function cacheSet(key: string, blob: Blob): void {
  TTS_CACHE.set(key, blob)
  if (TTS_CACHE.size > TTS_CACHE_MAX) {
    const oldest = TTS_CACHE.keys().next().value
    if (oldest !== undefined) TTS_CACHE.delete(oldest)
  }
}

const HAS_MSE = typeof window !== "undefined" && typeof window.MediaSource !== "undefined"

/** 流式播放：MSE 边收边播；返回 false 表示不可用/失败（调用方回退普通整段合成） */
async function playStreamed(resp: Response, text: string, cacheKey: string): Promise<boolean> {
  if (!resp.body || !HAS_MSE) return false
  const ms = new MediaSource()
  const url = URL.createObjectURL(ms)
  if (!audioManager.playUrl(url, text)) {
    URL.revokeObjectURL(url)
    return false
  }
  try {
    const sb: SourceBuffer = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("MediaSource 打开超时")), 5000)
      ms.addEventListener("sourceopen", () => {
        clearTimeout(t)
        try {
          resolve(ms.addSourceBuffer("audio/mpeg"))
        } catch (e) {
          reject(e as Error)
        }
      }, { once: true })
    })
    const chunks: Uint8Array[] = []
    const queue: Uint8Array[] = []
    let appending = false
    let finished = false
    const pump = () => {
      if (appending || finished) return
      const c = queue.shift()
      if (!c) return
      appending = true
      try {
        sb.appendBuffer(c as unknown as BufferSource)
      } catch {
        appending = false
      }
    }
    sb.addEventListener("updateend", () => {
      appending = false
      pump()
    })
    const reader = resp.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value?.length) {
        chunks.push(value)
        queue.push(value)
        pump()
      }
    }
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!appending && queue.length === 0) {
          finished = true
          try {
            if (ms.readyState === "open") ms.endOfStream()
          } catch { /* 已 ended 等状态忽略 */ }
          resolve()
        } else setTimeout(check, 50)
      }
      check()
    })
    if (chunks.length) cacheSet(cacheKey, new Blob(chunks as BlobPart[], { type: "audio/mpeg" }))
    // 等播放结束；部分浏览器 MSE 不触发 ended → 用估算时长兜底，避免调用方被卡住
    const bytes = chunks.reduce((n, c) => n + c.length, 0)
    const estMs = Math.min(90_000, Math.max(4_000, (bytes * 8) / 24)) // mp3 约 24kbps ≈ 3KB/s
    await Promise.race([
      audioManager.waitFinish(),
      new Promise<void>((r) => setTimeout(r, estMs + 3_000)),
    ])
    // 兜底：估算时长都过了仍未复位（MSE ended 未触发）→ 主动释放全局朗读锁，避免后续朗读被拒
    if (audioManager.speaking) audioManager.stop()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    return true
  } catch {
    try { ms.endOfStream() } catch { /* ignore */ }
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    return false
  }
}

/** 全站 TTS 默认音色：6221 度云萱（臻品音库·旁白女声）——2026-09-10 统一中文场景；
 *  古诗模块单独传 speaker="3"（度逍遥）不受影响；英文文本由服务端自动改走 4193 大模型音色。 */
const DEFAULT_SPEAKER = "6221"

/**
 * 单字发音结果。
 * source 含义（对应服务端 /tts/char 的 X-Tts-Source）：
 * - recording：命中人工录音库 data/char_audio（Android 端上传的真人录音，质量最高）
 * - cached：命中 TTS 沉淀库 data/tts_char（之前点过、已落盘，纯 R2 读）
 * - synthesized：本次实时合成（首次点击该字/音节，之后即沉淀）
 * - pre-generated：命中火山预生成音频（R2），不调用实时百度 TTS
 * - fallback：端点异常，已回退到旧 /tts/synthesize 通道
 */
export interface CharSpeakResult {
  ok: boolean
  source?: "recording" | "cached" | "pre-generated" | "synthesized" | "fallback"
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
   * @param opts.engine "doubao" 走豆包 TTS（火山语音）；当前无页面调用（休眠保留），缺省走百度链路。
   * @param opts.avoidPregen 跳过服务端预生成音频库（古诗等需要指定音色时用）。
   */
  const speak = useCallback(
    async (
      text: string,
      opts: {
        speaker?: string
        speed?: number
        pinyin?: string
        polyphoneOnly?: boolean
        engine?: "doubao"
        avoidPregen?: boolean
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
      const speaker = opts.speaker ?? DEFAULT_SPEAKER
      const speed = opts.speed ?? 5
      const engine = opts.engine ?? "baidu"
      const avoidPregen = !!opts.avoidPregen
      const plain = stripEmoji(ttsText)
      const key = ttsKey(plain, speaker, speed, engine, avoidPregen)

      try {
        let blob = cacheGet(key)
        // 缓存未命中 + 百度引擎 + 支持 MSE → 先试流式（边合成边播，首音更早）
        if (!blob && !opts.engine && HAS_MSE) {
          try {
            const resp = await api<Response>("/tts/stream", {
              method: "POST",
              body: {
                text: plain,
                speaker,
                speed,
                ...(avoidPregen ? { avoidPregen: true } : {}),
              },
              responseType: "response",
              timeoutMs: 60_000,
            })
            if (resp.ok) {
              if (resp.headers.get("X-Tts-Source")) {
                blob = await resp.blob() // 预生成命中：整段
                if (blob.size > 0) cacheSet(key, blob)
              } else if (resp.headers.get("X-Tts-Stream")) {
                if (await playStreamed(resp, text, key)) return true
              }
            }
          } catch {
            /* 流式失败 → 回退普通整段合成 */
          }
        }
        if (!blob) {
          blob = await api<Blob>("/tts/synthesize", {
            method: "POST",
            body: {
              text: plain,
              speaker,
              speed,
              ...(opts.engine ? { engine: opts.engine } : {}),
              ...(avoidPregen ? { avoidPregen: true } : {}),
            },
            responseType: "blob",
          })
          if (blob.size > 0) cacheSet(key, blob)
        }
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

  /**
   * 预取朗读音频（不播放）：后台合成并写入客户端缓存，之后同文本 speak 秒开。
   * 支持任意音色/引擎（古诗用 speaker=3 等）；失败静默，不影响页面。
   */
  const warm = useCallback(
    async (
      text: string,
      opts: {
        engine?: "doubao"
        speaker?: string
        speed?: number
        pinyin?: string
        polyphoneOnly?: boolean
        avoidPregen?: boolean
      } = {},
    ): Promise<void> => {
      if (!text.trim()) return
      const ttsText = annotateTts(text, opts.pinyin, { polyphoneOnly: opts.polyphoneOnly ?? true })
      const speaker = opts.speaker ?? DEFAULT_SPEAKER
      const speed = opts.speed ?? 5
      const engine = opts.engine ?? "baidu"
      const avoidPregen = !!opts.avoidPregen
      const plain = stripEmoji(ttsText)
      const key = ttsKey(plain, speaker, speed, engine, avoidPregen)
      if (cacheGet(key)) return // 已有缓存，无需再取
      try {
        const blob = await api<Blob>("/tts/synthesize", {
          method: "POST",
          body: {
            text: plain,
            speaker,
            speed,
            ...(opts.engine ? { engine: opts.engine } : {}),
            ...(avoidPregen ? { avoidPregen: true } : {}),
          },
          responseType: "blob",
          timeoutMs: 90_000,
        })
        if (blob.size > 0) cacheSet(key, blob)
      } catch {
        /* 预取失败无碍 */
      }
    },
    [],
  )

  const stop = useCallback(() => {
    if (startedRef.current) {
      audioManager.stop()
      startedRef.current = false
    }
  }, [])

  return { speaking, speak, speakChar, stop, warm }
}
