/** 百度 TTS 服务 — HTTP API + 服务端磁盘缓存（对齐 Python services/baidutts.py） */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
const TTS_URL = "https://tsn.baidu.com/text2audio"
const MIN_VALID_AUDIO_BYTES = 1000

/** 英文句间停顿增强：. ! ? 结尾的句子之间插入空行，给 TTS 清晰的停顿 cue。
 * 避免缩写误伤：句号后须跟空格+大写字母/数字 或 句尾才切分（Mr. Smith 不切）。 */
function enhanceEnglishPauses(text: string): string {
  if (/\n\s*\n/.test(text)) return text
  const out = text.replace(
    /([.!?])(?=\s+[A-Z0-9])|([.!?])\s*$/g,
    (m, g1: string, g2: string) => (g1 ? `${g1}\n` : m),
  )
  return out.replace(/\n/g, "\n\n")
}

export class BaiduTTSService {
  private token = ""
  private tokenExp = 0
  constructor(
    private appId: string,
    private apiKey: string,
    private secretKey: string,
    private cacheDir = ""
  ) {
    if (cacheDir) mkdirSync(cacheDir, { recursive: true })
  }

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
    // 英文文本（无汉字且含拉丁字母）→ 大模型音色 4193（度泽言·自然英文）+ 句间停顿增强
    const isEnglish = !/[\u4e00-\u9fff]/.test(text) && /[a-zA-Z]/.test(text)
    const effectiveSpeaker = isEnglish ? "4193" : speaker
    const tex = isEnglish ? enhanceEnglishPauses(text) : text

    // 1. 查缓存
    if (this.cacheDir) {
      const key = this.cacheKey(tex, effectiveSpeaker, speed)
      const cacheFile = join(this.cacheDir, `${key}.mp3`)
      if (existsSync(cacheFile)) return readFileSync(cacheFile)
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
        throw new Error("百度 TTS 合成结果无效（音频过短）")
      }
      if (this.cacheDir && audio.length > 100) {
        const key = this.cacheKey(tex, effectiveSpeaker, speed)
        writeFileSync(join(this.cacheDir, `${key}.mp3`), audio)
      }
      return audio
    }
    const errText = await resp.text()
    throw new Error(`百度 TTS 合成失败: ${errText}`)
  }
}
