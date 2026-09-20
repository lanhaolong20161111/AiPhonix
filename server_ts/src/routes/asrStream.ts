/** 百度实时语音识别 WebSocket 双向中转 — /api/v1/asr/stream?lang=zh|en（Node / ws 版）
 *
 * 与 server_cf/src/routes/asr.ts 行为对齐，只有传输层实现不同：
 *   Cloudflare：入站 WebSocketPair + 出站 fetch({Upgrade:"websocket"})
 *   Node：      入站 http 'upgrade' + WebSocketServer.handleUpgrade，出站 new WebSocket()
 *
 * 浏览器 →（WS）→ 本服务 →（WS）→ 百度 vop.baidu.com/realtime_asr
 * 安全核心：百度实时识别的鉴权（appid + appkey + dev_pid）在 START 帧里，
 * 浏览器直连会暴露密钥。故本服务拦截浏览器发的 START 帧、注入真实凭据 +
 * 按语言选择的 dev_pid 后再转发百度；音频二进制帧与百度的 MID_TEXT/FIN_TEXT
 * 结果帧双向原样透传。
 *
 * 语言 → dev_pid：zh=15372（普通话加强标点），en=17372（英语加强标点）。
 * 注意：本路由不进 Hono（Hono 不处理 HTTP upgrade），由 attachAsrStream()
 * 挂在 http.Server 的 'upgrade' 事件上；Hono 侧只留一个 426 提示路由保证契约一致。
 */
import type { IncomingMessage, Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import { Hono } from "hono"
import { WebSocket as WsSocket, WebSocketServer } from "ws"
import { getConfig } from "../env.js"

export const ASR_STREAM_PATH = "/api/v1/asr/stream"

/** 普通 HTTP GET 打过来时的提示路由（真正的升级走 attachAsrStream），契约对齐 server_cf */
const router = new Hono()
router.get("/asr/stream", (c) => c.json({ detail: "需要 WebSocket 连接" }, 426))
export default router

const DEV_PID: Record<string, number> = { zh: 15372, en: 17372 }
const BAIDU_HOST = "vop.baidu.com"
const UPSTREAM_TIMEOUT_MS = 10000

function makeSn(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 仅当对端处于 OPEN 时才发送（ws 在 CLOSING/CLOSED 时 send 会抛） */
function sendText(sock: WsSocket, obj: unknown): void {
  if (sock.readyState !== WsSocket.OPEN) return
  try {
    sock.send(JSON.stringify(obj))
  } catch { /* ignore */ }
}

/**
 * 处理单条已升级的连接。
 * @param client 浏览器侧 socket（已 accept）
 * @param lang   zh | en
 */
function handleClient(client: WsSocket, lang: string): void {
  const cfg = getConfig()
  const appid = String(cfg.baidu_asr?.app_id ?? "").trim()
  const appkey = String(cfg.baidu_asr?.api_key ?? "").trim()
  const pid = DEV_PID[lang] ?? DEV_PID.zh

  if (!appid || !appkey) {
    sendText(client, { type: "FIN_TEXT", err_no: -3004, err_msg: "服务端未配置百度 ASR 密钥", result: "" })
    try { client.close() } catch { /* ignore */ }
    return
  }

  let up: WsSocket | null = null
  let upPromise: Promise<WsSocket> | null = null
  let closed = false

  /** 懒建到百度的连接：首个文本帧（START）到达时建立 */
  const openUpstream = (): Promise<WsSocket> => {
    if (upPromise) return upPromise
    upPromise = new Promise<WsSocket>((resolve, reject) => {
      const sn = makeSn()
      const sock = new WsSocket(`wss://${BAIDU_HOST}/realtime_asr?sn=${sn}`)
      const timer = setTimeout(() => {
        try { sock.terminate() } catch { /* ignore */ }
        reject(new Error("百度连接超时"))
      }, UPSTREAM_TIMEOUT_MS)
      sock.once("open", () => {
        clearTimeout(timer)
        up = sock
        // 百度 → 浏览器：文本/二进制原样透传
        sock.on("message", (data: unknown, isBinary: boolean) => {
          const buf = data as Buffer
          if (client.readyState !== WsSocket.OPEN) return
          try {
            client.send(isBinary ? buf : buf.toString("utf-8"), { binary: isBinary })
          } catch { /* ignore */ }
        })
        sock.on("close", (code: number, reason: Buffer) => {
          // 1000/1005 = 正常收尾（百度在无有效语音时也会直接关，且不发结果帧）
          if (code !== 1000 && code !== 1005) {
            console.warn(`[asr] 上游非正常关闭 code=${code} reason=${reason?.toString().slice(0, 120) ?? ""}`)
          }
          up = null
          sendText(client, { type: "CLOSED" })
        })
        sock.on("error", (e: Error) => {
          console.warn(`[asr] 上游错误: ${e.message}`)
          sendText(client, { type: "ERROR", detail: "百度连接错误" })
        })
        resolve(sock)
      })
      sock.once("error", (e: Error) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      })
    })
    // 失败后允许下一次 START 重试
    upPromise.catch(() => { upPromise = null })
    return upPromise
  }

  // 下游消息后的统一错误反馈（与 CF 版同文案）
  const reportUpstreamFailure = (e: Error): void => {
    console.warn(`[asr] 百度连接失败: ${e.message}`)
    sendText(client, { type: "FIN_TEXT", err_no: -3004, err_msg: `百度连接失败: ${e.message}`, result: "" })
  }

  let audioFrames = 0
  let droppedFrames = 0
  client.on("message", (data: unknown, isBinary: boolean) => {
    if (closed) return
    if (!isBinary) {
      // 文本帧：START → 改写注入凭据；FINISH/CANCEL/HEARTBEAT → 原样转发
      let payload = (data as Buffer).toString("utf-8")
      try {
        const j = JSON.parse(payload) as { type?: string; data?: { cuid?: string } }
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
      openUpstream()
        .then((sock) => {
          try { sock.send(payload) } catch { /* ignore */ }
        })
        .catch(reportUpstreamFailure)
      return
    }
    // 二进制音频帧 → 原样转发百度（上游未就绪时丢弃，与 CF 版一致）
    audioFrames += 1
    if (up && up.readyState === WsSocket.OPEN) {
      try { up.send(data as Buffer, { binary: true }) } catch { /* ignore */ }
    } else {
      droppedFrames += 1
    }
  })

  client.on("close", () => {
    closed = true
    console.log(`[asr] 浏览器侧断开（音频帧 ${audioFrames}，其中上游未就绪丢弃 ${droppedFrames}）`)
    try { up?.close() } catch { /* ignore */ }
    up = null
  })

  client.on("error", () => {
    closed = true
    try { up?.close() } catch { /* ignore */ }
    up = null
  })
}

const wss = new WebSocketServer({ noServer: true })

/** 把 /api/v1/asr/stream 的 HTTP upgrade 接到 ws（非该路径直接销毁 socket） */
export function attachAsrStream(server: HttpServer): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = ""
    let lang = "zh"
    try {
      const u = new URL(req.url ?? "/", "http://localhost")
      pathname = u.pathname
      lang = u.searchParams.get("lang") === "en" ? "en" : "zh"
    } catch {
      socket.destroy()
      return
    }
    if (pathname !== ASR_STREAM_PATH) {
      // 本服务只有这一个 WS 端点，其余 upgrade 一律拒绝（否则 socket 会挂到超时）
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      handleClient(client, lang)
    })
  })
}
