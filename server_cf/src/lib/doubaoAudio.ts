/** 豆包 TTS 客户端 — Cloudflare 版（火山语音 openspeech.bytedance.com，R2 缓存）
 *
 * engine = "seed-audio-1.0"（默认）：POST /api/v3/tts/create —— 音频生成，同步返回 JSON{audio:base64}。
 *          有免费额度，音色更"生成式"；短句实测 ~12–13s。
 * engine = "seed-tts-2.0"：POST /api/v3/tts/unidirectional —— 豆包语音合成大模型 2.0，chunked 分片，
 *          Tina老师 2.0 教育音色实测 ~1s 出音、更自然。
 * 切换只需改配置（volc_tts.engine），本文件不变；两条链路同 key（X-Api-Key）。
 *
 * 音色描述 / 发音人集中在文件顶部常量 —— 唯一可编辑点（双端 server_cf/server_ts 需同步改）。
 */
import { createHash, randomUUID } from "node:crypto"
import { readBlob, writeBlob } from "./storage.js"

const CREATE_URL = "https://openspeech.bytedance.com/api/v3/tts/create"
const STREAM_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
const MODEL_V1 = "seed-audio-1.0"
const RESOURCE_ID_V2 = "seed-tts-2.0"

/** seed-tts-2.0 发音人：Tina老师 2.0（英语教学场景，支持英式/标准英语） */
const SPEAKER_V2 = "zh_female_yingyujiaoxue_uranus_bigtts"

/** seed-audio-1.0 口播前缀：决定生成音频的音色/语气/语言（正文拼在冒号后的引号里） */
const VOICE_PREFIX = "一位温柔清晰的英语女老师，用标准英语、亲切自然的语气朗读："

const FORMAT = "mp3"
const SAMPLE_RATE = 24000

/** 成功状态码（流式分片用）：0=分片正常；20000000=流式结束(OK) */
const OK_CODES = new Set([0, 20000000])

interface TtsPayload {
  model?: string
  text_prompt?: string
  req_params?: Record<string, unknown>
  audio_config?: Record<string, unknown>
  post_process?: Record<string, unknown>
  watermark?: Record<string, unknown>
}

export class DoubaoTTSService {
  constructor(
    private apiKey: string,
    /** seed-audio-1.0 | seed-tts-2.0 */
    private engine: string,
    /** R2 key 前缀（如 cache/tts/volc），为空则不缓存 */
    private cacheDir = "",
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Api-Key": this.apiKey,
    }
  }

  private cacheKey(text: string): string {
    return createHash("md5").update(`${text}|${this.engine}|${FORMAT}|${SAMPLE_RATE}`).digest("hex")
  }

  async synthesize(text: string, timeoutMs = 120_000): Promise<Buffer> {
    if (!text || !text.trim()) throw new Error("待合成文本为空")

    // 1. 查 R2 缓存（seed-audio 非确定性 → 命中即免额度且音色一致）
    if (this.cacheDir) {
      const cached = await readBlob(`${this.cacheDir}/${this.cacheKey(text)}.mp3`)
      if (cached) return Buffer.from(cached)
    }

    // 2. 运行时硬锁：仅允许 seed-audio-1.0（有免费额度）。
    //    seed-tts-2.0 单向流式会扣费，误配 engine 时直接拒绝（要启用 2.0 需先移除本守卫）
    const engine = this.engine === "seed-tts-2.0" ? "seed-tts-2.0" : "seed-audio-1.0"
    if (engine === "seed-tts-2.0") {
      throw new Error("豆包 TTS seed-tts-2.0 已禁用（防扣费）：运行时仅允许 seed-audio-1.0")
    }
    const audio = await this.synthCreate(text, timeoutMs)

    if (audio.length < 1000) throw new Error(`豆包 TTS 返回音频过短: ${audio.length}B`)
    if (this.cacheDir) {
      try {
        await writeBlob(`${this.cacheDir}/${this.cacheKey(text)}.mp3`, audio, "audio/mpeg")
      } catch {
        /* 沉淀失败不影响本次播放 */
      }
    }
    return audio
  }

  /** seed-audio-1.0：/api/v3/tts/create —— 同步 JSON，audio 字段为 base64 MP3 */
  private async synthCreate(text: string, timeoutMs: number): Promise<Buffer> {
    const payload: TtsPayload = {
      model: MODEL_V1,
      text_prompt: `${VOICE_PREFIX}"${text}"`,
      audio_config: {
        format: FORMAT,
        sample_rate: SAMPLE_RATE,
        pitch_rate: 0,
        speech_rate: 0,
        loudness_rate: 0,
      },
      watermark: {},
    }
    const res = await fetch(CREATE_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`豆包 TTS HTTP ${res.status} ${res.statusText}`)
    const j = (await res.json()) as { audio?: string; message?: string; code?: number }
    if (typeof j.audio !== "string" || j.audio.length < 100) {
      throw new Error(`豆包 TTS 无音频返回: ${JSON.stringify(j).slice(0, 200)}`)
    }
    return Buffer.from(j.audio, "base64")
  }

  /** seed-tts-2.0：/api/v3/tts/unidirectional —— chunked 多段 JSON，逐行拼 base64（对齐 volcano-tts 实测） */
  private async synthStream(text: string, timeoutMs: number): Promise<Buffer> {
    const payload = {
      req_params: {
        text,
        speaker: SPEAKER_V2,
      },
      audio_params: {
        format: FORMAT,
        sample_rate: SAMPLE_RATE,
        enable_subtitle: false,
      },
    }
    const headers = this.headers()
    headers["X-Api-Request-Id"] = randomUUID()
    headers["X-Api-Resource-Id"] = RESOURCE_ID_V2
    const res = await fetch(STREAM_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const raw = await res.text()

    const chunks: Record<string, unknown>[] = []
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t) continue
      try {
        chunks.push(JSON.parse(t) as Record<string, unknown>)
      } catch {
        /* 忽略无法解析的片段 */
      }
    }
    if (chunks.length === 0) {
      throw new Error(`豆包流式 TTS 无有效 JSON（HTTP ${res.status}）: ${raw.slice(0, 200)}`)
    }
    for (const c of chunks) {
      const code = Number(c.code ?? 0)
      if (!OK_CODES.has(code)) {
        throw new Error(`豆包流式 TTS 失败 code=${c.code} message=${String(c.message ?? "(无 message)")}`)
      }
    }
    const parts: Buffer[] = []
    for (const c of chunks) {
      if (typeof c.data === "string" && c.data.length > 0) parts.push(Buffer.from(c.data, "base64"))
    }
    if (parts.length === 0) throw new Error("豆包流式 TTS 未返回音频数据")
    return Buffer.concat(parts)
  }
}
