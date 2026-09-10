/** 百度短语音识别（整段上传一次性返回）— server_ts 版（磁盘无缓存，token 内存缓存）
 *
 * 用途：停顿提示/点结束时把该段录音一次上传识别，替代流式对单字不稳、延迟不稳的短板。
 * 标准版：POST https://vop.baidu.com/server_api，中文 dev_pid=1537（有标点）/ 英文 1737。
 */
import { Hono } from "hono"
import { getConfig } from "../env.js"

const router = new Hono()

const SHORT_PID: Record<string, number> = { zh: 1537, en: 1737 }
const SHORT_URL = "https://vop.baidu.com/server_api"
const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"

let tokenCache = ""
let tokenExp = 0
async function getBaiduToken(): Promise<string> {
  const cfg = getConfig()
  if (tokenCache && Date.now() / 1000 < tokenExp) return tokenCache
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.baidu_tts.api_key,
    client_secret: cfg.baidu_tts.secret_key,
  })
  const resp = await fetch(`${TOKEN_URL}?${params.toString()}`, { method: "POST", signal: AbortSignal.timeout(15000) })
  const j = (await resp.json()) as { access_token?: string; error?: string }
  if (!j.access_token) throw new Error(`获取百度 token 失败: ${j.error ?? resp.status}`)
  tokenCache = j.access_token
  tokenExp = Date.now() / 1000 + 25 * 3600
  return tokenCache
}

// POST /api/v1/asr/short — body { lang: "zh"|"en", audio: base64(16k/16bit/mono PCM) } → { text }
router.post("/asr/short", async (c) => {
  const body = await c.req.json().catch(() => null)
  const lang = body?.lang === "en" ? "en" : "zh"
  const speech = typeof body?.audio === "string" ? body.audio : ""
  if (!speech) return c.json({ detail: "缺少 audio(base64 PCM)" }, 400)
  let raw: Buffer
  try {
    raw = Buffer.from(speech, "base64")
  } catch {
    return c.json({ detail: "audio base64 非法" }, 400)
  }
  if (raw.length < 1600) return c.json({ detail: "音频太短" }, 422)

  let token: string
  try {
    token = await getBaiduToken()
  } catch (e) {
    return c.json({ detail: `获取百度 token 失败: ${(e as Error).message}` }, 500)
  }
  const payload = {
    format: "pcm",
    rate: 16000,
    channel: 1,
    cuid: `aiphonix-short-${Date.now()}`,
    token,
    dev_pid: SHORT_PID[lang],
    len: raw.length,
    speech,
  }
  try {
    const resp = await fetch(SHORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    })
    const j = (await resp.json()) as { err_no?: number; err_msg?: string; result?: string[] }
    if (j.err_no !== 0) {
      return c.json({ detail: `短语音识别失败 err=${j.err_no} ${j.err_msg ?? ""}` }, 502)
    }
    const text = String(j.result?.[0] ?? "").trim()
    if (!text) return c.json({ detail: "未识别到内容（音频过短或太吵）" }, 422)
    return c.json({ text })
  } catch (e) {
    return c.json({ detail: `短语音识别请求失败: ${(e as Error).message}` }, 502)
  }
})

export default router
