/** 百度「流式文本在线合成」客户端 — Cloudflare 版
 *
 * WS 协议（doc lm5xd63rn）：
 *   wss://aip.baidubce.com/ws/2.0/speech/publiccloudspeech/v1/tts?access_token=xxx&per=<音色>
 *   ① 发 system.start（spd/pit/vol/audio_ctrl/aue=3 mp3）→ 收 system.started(code=0)
 *   ② 发 text → 服务端返回二进制 mp3 分片（尽量带标点，否则服务端会等标点/60 字）
 *   ③ 发 system.finish → 收 system.finished，随后连接断开
 * 对外暴露 synthesizeStream：把音频分片按到达顺序推入 ReadableStream（边合成边下发给浏览器）。
 */
import { getConfig } from "../env.js"

/** Workers 不能 fetch wss://，须用 https + Upgrade 头（同 asr.ts 的出站方式） */
// 百度流式 TTS WebSocket 控制消息结构（实测）
interface BaiduTtsWsMsg {
  type?: string
  code?: number
  message?: string
}

const WS_BASE = "https://aip.baidubce.com/ws/2.0/speech/publiccloudspeech/v1/tts"
const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"

let tokenCache = ""
let tokenExp = 0
export async function baiduToken(): Promise<string> {
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

/** 给无标点文本补一个逗号，避免服务端等待标点/60 字才开合 */
function ensurePunct(t: string): string {
  return /[,.;:!?，。；：！？、]$/.test(t) ? t : `${t}，`
}

/** 英文专用大模型音色：4193 度泽言（大模型音库，中英双语，英文自然）。
 * 与 lib/baiduTts.ts 的非流式链路保持一致 —— 英文文本一律用它，避免落到基础音库（per=0 度小美）。*/
const ENGLISH_MODEL_SPEAKER = "4193"

/** 英文文本（无汉字且含拉丁字母）→ 大模型音色；其余用调用方指定音色 */
function effectiveSpeaker(text: string, speaker: string): string {
  const isEnglish = !/[\u4e00-\u9fff]/.test(text) && /[a-zA-Z]/.test(text)
  return isEnglish ? ENGLISH_MODEL_SPEAKER : speaker
}

async function connect(token: string, per: string): Promise<WebSocket> {
  const url = `${WS_BASE}?access_token=${encodeURIComponent(token)}&per=${encodeURIComponent(per)}`
  const resp = await fetch(url, { headers: { Upgrade: "websocket" } })
  if (!resp.webSocket) throw new Error(`百度流式 TTS 握手失败（HTTP ${resp.status}）`)
  const sock = resp.webSocket
  sock.accept()
  return sock
}

/**
 * 流式合成：返回 ReadableStream，按到达顺序输出 mp3 分片。
 * 失败（握手/协议错误）时抛错，由路由回退到普通合成。
 */
export async function synthesizeStream(text: string, speaker: string, speed: number): Promise<ReadableStream<Uint8Array>> {
  const token = await baiduToken()
  const sock = await connect(token, effectiveSpeaker(text, speaker))

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false
  let errored: Error | null = null

  const close = () => {
    if (closed) return
    closed = true
    try { sock.close() } catch { /* ignore */ }
    try { controller?.close() } catch { /* ignore */ }
  }
  const fail = (e: Error) => {
    errored = e
    try { controller?.error(e) } catch { /* ignore */ }
    try { sock.close() } catch { /* ignore */ }
  }

  // 事件注册
  sock.addEventListener("message", (ev: MessageEvent) => {
    const d: string | ArrayBuffer | Blob = ev.data
    if (typeof d === "string") {
      let j: BaiduTtsWsMsg | null = null
      try { j = JSON.parse(d) } catch { return }
      if (j?.type === "system.started") {
        if (j.code !== 0) return fail(new Error(`流式 TTS 启动失败 code=${j.code} ${j.message ?? ""}`))
        try {
          sock.send(JSON.stringify({ type: "text", payload: { text: ensurePunct(text) } }))
          sock.send(JSON.stringify({ type: "system.finish" }))
        } catch (e) {
          fail(e as Error)
        }
      } else if (j?.type === "system.error") {
        fail(new Error(`流式 TTS 错误 code=${j.code} ${j.message ?? ""}`))
      } else if (j?.type === "system.finished") {
        close()
      }
      return
    }
    // 二进制音频分片
    if (d instanceof ArrayBuffer) {
      try { controller?.enqueue(new Uint8Array(d)) } catch { /* ignore */ }
    } else if (d instanceof Blob) {
      void d.arrayBuffer().then((ab) => {
        try { controller?.enqueue(new Uint8Array(ab)) } catch { /* ignore */ }
      })
    }
  })
  sock.addEventListener("close", () => close())
  sock.addEventListener("error", () => fail(new Error("流式 TTS 连接错误")))

  // 启动：发送 system.start（等 started 事件后再发文本）
  try {
    sock.send(JSON.stringify({
      type: "system.start",
      payload: { spd: Math.max(0, Math.min(15, speed)), pit: 5, vol: 9, audio_ctrl: "", aue: 3 },
    }))
  } catch (e) {
    fail(e as Error)
  }

  return new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      if (errored) c.error(errored)
    },
    cancel() {
      close()
    },
  })
}
