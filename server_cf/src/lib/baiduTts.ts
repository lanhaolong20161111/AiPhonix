/** 百度 TTS 服务 — Cloudflare 版：R2 缓存（替代磁盘缓存），签名/重试逻辑与 server_ts 一致 */
import { createHash } from "node:crypto"
import { readBlob, writeBlob } from "./storage.js"

const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
const TTS_URL = "https://tsn.baidu.com/text2audio"
const MIN_VALID_AUDIO_BYTES = 1000

/** 英文句间停顿增强：把 . ! ? 结尾的句子之间插入空行，给 TTS 清晰的停顿 cue。
 * 避免缩写误伤：句号后须跟空格+大写字母/数字 或 句尾才切分（Mr. Smith 不切）。
 * 仅在英文生效；中文保持原样（百度中文自身断句足够）。 */
function enhanceEnglishPauses(text: string): string {
  // 已有空行分隔则视为调用方已控制停顿，不再重复处理
  if (/\n\s*\n/.test(text)) return text
  // 在句子边界后插入换行：. ! ? 后跟 空格+大写 或 行尾
  const out = text.replace(
    /([.!?])(?=\s+[A-Z0-9])|([.!?])\s*$/g,
    (m, g1, g2) => (g1 ? `${g1}\n` : m),
  )
  // 用空行强化停顿
  return out.replace(/\n/g, "\n\n")
}

export class BaiduTTSService {
  private token = ""
  private tokenExp = 0
  constructor(
    private appId: string,
    private apiKey: string,
    private secretKey: string,
    /** R2 key 前缀（如 data/cache/tts），为空则不缓存 */
    private cacheDir = ""
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() / 1000 < this.tokenExp) return this.token
    const params = new URLSearchParams({ grant_type: "client_credentials", client_id: this.apiKey, client_secret: this.secretKey })
    const resp = await fetch(`${TOKEN_URL}?${params.toString()}`, { method: "POST" })
    if (!resp.ok) throw new Error(`获取百度 token 失败: ${resp.status}`)
    const data = (await resp.json()) as { error?: string; access_token?: string }
    if (data.error) throw new Error(`获取百度 token 失败: ${data.error}`)
    if (!data.access_token) throw new Error("获取百度 token 失败: 无 access_token")
    this.token = data.access_token
    this.tokenExp = Date.now() / 1000 + 25 * 3600
    return this.token
  }

  private cacheKey(text: string, speaker: string, speed: number): string {
    return createHash("md5").update(`${text}|${speaker}|${speed}`).digest("hex")
  }

  async synthesize(text: string, speaker = "6221", speed = 5): Promise<Buffer> {
    // 英文文本（无汉字且含拉丁字母）→ 大模型音色 4193（度泽言·自然英文）+ 句间停顿增强；
    // 其余保持中文音色（默认 6221 度云萱）
    const isEnglish = !/[一-鿿]/.test(text) && /[a-zA-Z]/.test(text)
    const effectiveSpeaker = isEnglish ? "4193" : speaker
    const tex = isEnglish ? enhanceEnglishPauses(text) : text

    // 1. 查 R2 缓存
    if (this.cacheDir) {
      const key = this.cacheKey(tex, effectiveSpeaker, speed)
      const cached = await readBlob(`${this.cacheDir}/${key}.mp3`)
      if (cached) return Buffer.from(cached)
    }

    // 2. 调百度 API
    const token = await this.getAccessToken()
    const form: Record<string, string> = {
      tex,
      tok: token,
      cuid: "aiphonix-server",
      ctp: "1",
      lan: isEnglish ? "en" : "zh",
      per: effectiveSpeaker || "0",
      spd: String(Math.max(speed, 1) || 5),
      pit: "5",
      vol: "9",
      aue: "3",
    }
    const signStr = this.apiKey + new URLSearchParams(form).toString() + this.secretKey
    form.sign = createHash("md5").update(signStr).digest("hex")

    const body = new URLSearchParams(form)
    let resp: Response | null = null
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        resp = await fetch(TTS_URL, { method: "POST", body, signal: AbortSignal.timeout(120000) })
        break
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    if (!resp) throw new Error(`百度 TTS 请求失败（重试 3 次仍异常）: ${String(lastErr)}`)

    const contentType = resp.headers.get("content-type") ?? ""
    if (contentType.includes("audio/")) {
      const audio = Buffer.from(await resp.arrayBuffer())
      if (audio.length < MIN_VALID_AUDIO_BYTES) {
        // 诊断信息：短音频头部可能内嵌百度错误 JSON
        const head = audio.subarray(0, Math.min(120, audio.length)).toString("utf-8").replace(/[^\x20-\x7e]/g, ".")
        throw new Error(`百度 TTS 合成结果无效（音频过短: ${audio.length}B, ct=${contentType}, head=${head}）`)
      }
      if (this.cacheDir && audio.length > 100) {
        const key = this.cacheKey(tex, effectiveSpeaker, speed)
        await writeBlob(`${this.cacheDir}/${key}.mp3`, audio, "audio/mpeg")
      }
      return audio
    }
    const errText = await resp.text()
    throw new Error(`百度 TTS 合成失败: ${errText} (ct=${contentType}, status=${resp.status})`)
  }
}
