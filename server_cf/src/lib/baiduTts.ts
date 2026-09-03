/** 百度 TTS 服务 — Cloudflare 版：R2 缓存（替代磁盘缓存），签名/重试逻辑与 server_ts 一致 */
import { createHash } from "node:crypto"
import { readBlob, writeBlob } from "./storage.js"

const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
const TTS_URL = "https://tsn.baidu.com/text2audio"
const MIN_VALID_AUDIO_BYTES = 1000

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

  async synthesize(text: string, speaker = "0", speed = 5): Promise<Buffer> {
    // 1. 查 R2 缓存
    if (this.cacheDir) {
      const key = this.cacheKey(text, speaker, speed)
      const cached = await readBlob(`${this.cacheDir}/${key}.mp3`)
      if (cached) return Buffer.from(cached)
    }

    // 2. 调百度 API
    const token = await this.getAccessToken()
    // 英文文本（无汉字且含拉丁字母）→ 切到英文语音（lan=en，per=0 为英文标准音）；
    // 其余（含汉字/中文标点）保持中文。向后兼容：中文调用完全不受影响。
    const isEnglish = !/[一-鿿]/.test(text) && /[a-zA-Z]/.test(text)
    const form: Record<string, string> = {
      tex: text,
      tok: token,
      cuid: "aiphonix-server",
      ctp: "1",
      lan: isEnglish ? "en" : "zh",
      per: speaker || "0",
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
        const key = this.cacheKey(text, speaker, speed)
        await writeBlob(`${this.cacheDir}/${key}.mp3`, audio, "audio/mpeg")
      }
      return audio
    }
    const errText = await resp.text()
    throw new Error(`百度 TTS 合成失败: ${errText} (ct=${contentType}, status=${resp.status})`)
  }
}
