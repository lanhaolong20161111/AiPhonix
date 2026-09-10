/** 百度实时语音识别 WebSocket 双向中转 — /api/v1/asr/stream?lang=zh|en
 *
 * 浏览器 →（WS）→ Worker →（fetch+Upgrade）→ 百度 vop.baidu.com/realtime_asr
 *
 * 安全核心：百度实时识别的鉴权（appid + appkey + dev_pid）在 START 帧里，
 * 浏览器直连会暴露密钥。因此浏览器只连本 Worker：Worker 拦截浏览器发的 START
 * 帧、注入真实凭据 + 按语言选择的 dev_pid 后再转发百度；音频二进制帧与百度
 * 的 MID_TEXT/FIN_TEXT 结果帧双向原样透传。
 *
 * 入站用 Cloudflare WebSocketPair（返回 101）；出站用 fetch+Upgrade
 * （Workers 不可 new WebSocket()，模式同 lib/soe.ts）。
 * 语言 → dev_pid：zh=15372（普通话加强标点），en=17372（英语加强标点）。
 */
import { Hono } from "hono"
import { getConfig } from "../env.js"

const router = new Hono()

const DEV_PID: Record<string, number> = { zh: 15372, en: 17372 }
const BAIDU_WS = "vop.baidu.com"
/** 短语音识别标准版：中文近场有标点 1537；英文 1737 */
const SHORT_PID: Record<string, number> = { zh: 1537, en: 1737 }
const SHORT_URL = "https://vop.baidu.com/server_api"
const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"

function makeSn(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 出站连百度：fetch + Upgrade → resp.webSocket */
function connectBaidu(cuid: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = `https://${BAIDU_WS}/realtime_asr?sn=${makeSn()}`
    fetch(url, { headers: { Upgrade: "websocket" } })
      .then((resp) => {
        if (!resp.webSocket) throw new Error(`百度握手被拒绝（HTTP ${resp.status}）`)
        const sock = resp.webSocket
        sock.accept()
        resolve(sock)
      })
      .catch((e) => {
        console.warn(`[asr] 百度连接失败: ${(e as Error).message}`)
        reject(e)
      })
  })
}

// GET /api/v1/asr/stream?lang=zh|en — WebSocket 升级
router.get("/asr/stream", async (c) => {
  const lang = c.req.query("lang") === "en" ? "en" : "zh"
  const cfg = getConfig()
  const appid = String(cfg?.baidu_asr?.app_id ?? "").trim()
  const appkey = String(cfg?.baidu_asr?.api_key ?? "").trim()
  const pid = DEV_PID[lang]

  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ detail: "需要 WebSocket 连接" }, 426)
  }
  if (!appid || !appkey) {
    return c.json({ detail: "服务端未配置百度 ASR 密钥" }, 500)
  }

  const pair = new WebSocketPair()
  const client = pair[0] // 返回给浏览器（运行时自动 accept，不要手动 accept）
  const server = pair[1] // 服务端侧：手动 accept + 监听

  let up: WebSocket | null = null // 百度侧 socket

  const sendDown = (payload: string | ArrayBuffer) => {
    try {
      server.send(payload as any) // server ↔ client 同一 pair 内互通
    } catch { /* ignore */ }
  }

  // 首个文本帧（START）到达后建立百度连接；其后 server 消息都转发给 up
  const openUpstream = async (): Promise<WebSocket> => {
    if (up) return up
    const sock = await connectBaidu("web-child")
    up = sock
    sock.addEventListener("message", (ev: MessageEvent) => {
      const d: any = ev.data
      if (typeof d === "string") sendDown(d)
      else sendDown(d as ArrayBuffer)
    })
    sock.addEventListener("close", () => {
      sendDown('{"type":"CLOSED"}')
      up = null
    })
    sock.addEventListener("error", () => {
      sendDown('{"type":"ERROR","detail":"百度连接错误"}')
    })
    return sock
  }

  // 服务端侧 accept + 注册监听
  server.accept()
  server.addEventListener("message", async (ev: MessageEvent) => {
    const data: any = ev.data
    if (typeof data === "string") {
      // 文本帧：START → 改写注入凭据；FINISH/CANCEL/HEARTBEAT → 原样转发
      let payload: string = data
      try {
        const j = JSON.parse(data)
        if (j?.type === "START") {
          payload = JSON.stringify({
            type: "START",
            data: {
              appid: Number(appid),
              appkey,
              dev_pid: pid,
              cuid: String(j?.data?.cuid ?? "web-child") || "web-child",
              format: "pcm",
              sample: 16000,
            },
          })
        }
      } catch { /* 非 JSON 文本，原样转发 */ }
      try {
        const sock = await openUpstream()
        sock.send(payload)
      } catch (e) {
        sendDown(JSON.stringify({ type: "FIN_TEXT", err_no: -3004, err_msg: `百度连接失败: ${(e as Error).message}`, result: "" }))
      }
      return
    }
    // 二进制音频帧 → 原样转发百度
    if (up) {
      try {
        const ab = data instanceof ArrayBuffer ? data : await (data as Blob).arrayBuffer()
        up.send(ab)
      } catch { /* ignore */ }
    }
  })
  server.addEventListener("close", () => {
    try { up?.close() } catch { /* ignore */ }
    up = null
  })

  return new Response(null, { status: 101, webSocket: client })
})

// ── 短语音识别（整段上传一次性返回；停顿/结束即用，替代流式对单字不稳的短板） ──

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

// POST /api/v1/asr/short — body { lang: "zh"|"en", audio: base64(16k/16bit/mono PCM) }
// 60s 内短音频，返回 { text }
router.post("/asr/short", async (c) => {
  const body = await c.req.json().catch(() => null)
  const lang = body?.lang === "en" ? "en" : "zh"
  const speech = typeof body?.audio === "string" ? body.audio : ""
  if (!speech) return c.json({ detail: "缺少 audio(base64 PCM)" }, 400)
  let raw: Uint8Array
  try {
    raw = Uint8Array.from(atob(speech), (ch) => ch.charCodeAt(0))
  } catch {
    return c.json({ detail: "audio base64 非法" }, 400)
  }
  const MIN_BYTES = 1600 // 0.05s@16k 以下没意义
  if (raw.length < MIN_BYTES) return c.json({ detail: "音频太短" }, 422)

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
