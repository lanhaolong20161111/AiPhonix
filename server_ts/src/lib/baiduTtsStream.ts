/** 百度「流式文本在线合成」客户端 — server_ts 版（Node 全局 WebSocket）
 *
 * 协议同 server_cf：system.start → text → 二进制 mp3 分片 → system.finish。
 * 边收边推入 ReadableStream，路由以 chunked 下发浏览器。
 */
import WebSocket from "ws"
import { getConfig } from "../env.js"

const WS_URL = "wss://aip.baidubce.com/ws/2.0/speech/publiccloudspeech/v1/tts"
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

export async function synthesizeStream(text: string, speaker: string, speed: number): Promise<ReadableStream<Uint8Array>> {
  const token = await baiduToken()
  const url = `${WS_URL}?access_token=${encodeURIComponent(token)}&per=${encodeURIComponent(effectiveSpeaker(text, speaker))}`
  const ws = new WebSocket(url)

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    try { ws.close() } catch { /* ignore */ }
    try { controller?.close() } catch { /* ignore */ }
  }
  const fail = (e: Error) => {
    try { controller?.error(e) } catch { /* ignore */ }
    try { ws.close() } catch { /* ignore */ }
  }

  ws.on("open", () => {
    ws.send(JSON.stringify({
      type: "system.start",
      payload: { spd: Math.max(0, Math.min(15, speed)), pit: 5, vol: 9, audio_ctrl: "", aue: 3 },
    }))
  })
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      let j: any = null
      try { j = JSON.parse(data.toString()) } catch { return }
      if (j?.type === "system.started") {
        if (j.code !== 0) return fail(new Error(`流式 TTS 启动失败 code=${j.code} ${j.message ?? ""}`))
        ws.send(JSON.stringify({ type: "text", payload: { text: ensurePunct(text) } }))
        ws.send(JSON.stringify({ type: "system.finish" }))
      } else if (j?.type === "system.error") {
        fail(new Error(`流式 TTS 错误 code=${j.code} ${j.message ?? ""}`))
      } else if (j?.type === "system.finished") {
        close()
      }
      return
    }
    try { controller?.enqueue(new Uint8Array(data)) } catch { /* ignore */ }
  })
  ws.on("close", () => close())
  ws.on("error", () => fail(new Error("流式 TTS 连接错误")))

  return new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      close()
    },
  })
}
