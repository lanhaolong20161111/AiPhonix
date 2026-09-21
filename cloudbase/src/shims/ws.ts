/**
 * WebSocket 适配：Cloudflare 的 `WebSocketPair` / `fetch + Upgrade` ↔ Node 的 `ws`。
 *
 * server_cf 只有两处 WS 用法（改动它们等于改生产代码，故一律在适配层解决）：
 *
 * ① 入站（浏览器 → Worker）：`routes/asr.ts`
 *      const pair = new WebSocketPair(); const client = pair[0]; const server = pair[1]
 *      server.accept(); server.addEventListener("message"|"close"|"error", …)
 *      return new Response(null, { status: 101, webSocket: client })
 *    Node 侧做法：
 *      · `<http.Server>.on("upgrade")` 里先把 IncomingMessage 造成 Request（Node 允许
 *        带 `upgrade`/`connection`/`sec-websocket-key` 头构造 Request，不必绕过 fetch 语义）
 *      · 在 AsyncLocalStorage 里预置一对端点，供 `new WebSocketPair()` 取出（这正是
 *        「运行时把真实连接交给 Worker」的等价物）
 *      · 调 app.fetch 拿响应；**若返回 101** 才 `wss.handleUpgrade` 真正完成握手并把真实
 *        `ws` 挂到 server 端点；否则把 HTTP 响应原样写回 socket（426/500/403 与生产一致）
 *
 * ② 出站（Worker → 百度/腾讯）：`routes/asr.ts`、`lib/soe.ts`、`lib/baiduTtsStream.ts`
 *      const resp = await fetch(url, { headers: { Upgrade: "websocket" } })
 *      const sock = resp.webSocket; sock.accept(); sock.send(…)
 *    Node 侧做法：包装 globalThis.fetch —— 检测到 `Upgrade: websocket` 就改用 `ws` 建真连，
 *    完成后返回一个「status=101 且带 .webSocket」的合成 Response。
 *
 * ⚠️ `new Response(null, { status: 101 })` 在 undici 里会抛 RangeError（status 只允许 200~599），
 *    故 `upgradeResponse()` 先造 200 再就地覆写 `status`/`webSocket` 自有属性（已实测可行）。
 *
 * ⚠️ 事件语义对齐：CF 在 `accept()` 之前到达的消息会排队、accept 后补发；两端点都照此实现。
 */
import { AsyncLocalStorage } from "node:async_hooks"
import type { IncomingHttpHeaders, IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocket as WsClient, WebSocketServer } from "ws"

// ── 通用工具 ───────────────────────────────────────────────────────

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView
    return (v.buffer as ArrayBuffer).slice(v.byteOffset, v.byteOffset + v.byteLength)
  }
  if (typeof data === "string") return new TextEncoder().encode(data).buffer as ArrayBuffer
  return new ArrayBuffer(0)
}

const UTF8 = new TextDecoder()

/** CF 交给业务代码的二进制帧是 ArrayBuffer，文本帧是 string —— 这里严格照搬 */
function frameOf(buf: unknown, isBinary: boolean): { type: "message"; data: string | ArrayBuffer } {
  if (isBinary) return { type: "message", data: toArrayBuffer(buf) }
  if (typeof buf === "string") return { type: "message", data: buf }
  return { type: "message", data: UTF8.decode(buf as Uint8Array) }
}

/** 事件派发基类（对齐 CF WebSocket 的 addEventListener 语义） */
class EndpointBase {
  protected listeners = new Map<string, Array<(ev: unknown) => void>>()

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(fn)
    this.listeners.set(type, arr)
  }

  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    const arr = this.listeners.get(type)
    if (arr) this.listeners.set(type, arr.filter((f) => f !== fn))
  }

  protected emit(type: string, ev: unknown): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      try {
        fn(ev)
      } catch (e) {
        console.error(`[ws] 监听器抛错（${type}）:`, e)
      }
    }
  }
}

// ── 全局 Response 补丁（必须最先安装）────────────────────────────────

/**
 * 让 `new Response(null, { status: 101, webSocket })` 在 Node 上可用。
 *
 * 为什么必须打这个补丁：**server_cf 的路由自己就会构造 101 响应**
 * （routes/asr.ts:142 `return new Response(null, { status: 101, webSocket: client })`），
 * 而 undici 的 Response 只接受 200~599 → 原样跑会抛
 * `RangeError: init["status"] must be in the range of 200 to 599, inclusive.`
 * （表现为升级请求返回 500，而不是 101）。
 *
 * 做法：包一层子类 —— status=101 时先按 200 构造，再就地覆写 `status`/`webSocket`
 * 自有属性（实测可行，原型上的 status getter 被自有属性遮蔽）。子类仍 `instanceof Response`，
 * 故 Hono / @hono/node-server 里的 `res instanceof Response` 分支不受影响。
 */
export function installResponseShim(): void {
  const g = globalThis as unknown as { Response: typeof Response }
  const Orig = g.Response
  if ((Orig as unknown as { __aiphonixUpgrade?: boolean }).__aiphonixUpgrade) return

  class UpgradeAwareResponse extends Orig {
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
      const status = init?.status
      if (status === 101) {
        const rest = { ...(init as Record<string, unknown>) }
        delete rest.status
        delete rest.webSocket
        super(body ?? null, rest as ResponseInit)
        Object.defineProperty(this, "status", { value: 101, enumerable: true, configurable: true })
        const ws = (init as { webSocket?: unknown }).webSocket
        if (ws !== undefined) {
          Object.defineProperty(this, "webSocket", { value: ws, enumerable: true, configurable: true })
        }
        return
      }
      super(body ?? null, init as ResponseInit)
    }
  }
  Object.defineProperty(UpgradeAwareResponse, "__aiphonixUpgrade", { value: true })
  g.Response = UpgradeAwareResponse as unknown as typeof Response
}

// ── ① 入站：服务端端点（pair[1]） ──────────────────────────────────

/**
 * `pair[1]`：包住真实 `ws` 的服务端端点。
 * 生命周期与 CF 一致：`accept()` 之前到达的帧先入队，accept 后补发。
 */
class IncomingServerSocket extends EndpointBase {
  #ws: WsClient | null = null
  #accepted = false
  #queue: Array<{ type: string; ev: unknown }> = []

  accept(): void {
    if (this.#accepted) return
    this.#accepted = true
    const q = this.#queue
    this.#queue = []
    for (const it of q) this.emit(it.type, it.ev)
  }

  /** 供 main.ts 在 HTTP 101 之后挂上真实连接 */
  attach(ws: WsClient): void {
    this.#ws = ws
    ws.on("message", (data: unknown, isBinary: boolean) => {
      this.#deliver("message", frameOf(data, isBinary))
    })
    ws.on("close", (code: number) => {
      this.#deliver("close", { type: "close", code, reason: "", wasClean: code === 1000 })
    })
    ws.on("error", (e: Error) => {
      this.#deliver("error", { type: "error", message: e.message, error: e })
    })
  }

  #deliver(type: string, ev: unknown): void {
    if (this.#accepted) this.emit(type, ev)
    else this.#queue.push({ type, ev })
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (!this.#ws) return
    try {
      // ws 的二进制发送要 Buffer/TypedArray；string 原样透传（文本帧）
      this.#ws.send(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer))
    } catch {
      /* 连接已断，与 CF 的行为一致：静默 */
    }
  }

  close(code = 1000, reason = ""): void {
    try {
      this.#ws?.close(code, reason)
    } catch {
      /* 已关闭 */
    }
    if (!this.#ws) this.#deliver("close", { type: "close", code, reason, wasClean: true })
  }
}

/** `pair[0]`：CF 里由运行时自动 accept 并接回浏览器，业务代码从不直接使用 —— 给个哑端点即可 */
class ClientEndpointStub extends EndpointBase {
  accept(): void {
    /* 运行时职责，业务代码不该调用 */
  }
  send(): void {
    /* 不通过 client 端点发送（业务用 server 端点） */
  }
  close(): void {
    /* noop */
  }
}

// ── WebSocketPair 全局 + AsyncLocalStorage 关联 ─────────────────────

export interface UpgradeContext {
  /** 由 main.ts 预置，`new WebSocketPair()` 取出后置空（一次请求只允许取一次） */
  pair: [unknown, IncomingServerSocket] | null
}

/** 把「本次升级的端点对」与当前异步调用链绑定，避免并发请求互相串台 */
export const upgradeCtx = new AsyncLocalStorage<UpgradeContext>()

export function installWebSocketPairGlobal(): void {
  const g = globalThis as unknown as Record<string, unknown>
  // 用函数而非 class：构造函数返回对象时 new 的结果就是该对象（正好返回 [client, server]）
  g.WebSocketPair = function WebSocketPair(): unknown {
    const store = upgradeCtx.getStore()
    if (!store?.pair) {
      throw new Error("[ws] 调用了 WebSocketPair，但当前请求不是 WebSocket 升级")
    }
    const pair = store.pair
    store.pair = null
    return pair
  }
}

/** main.ts 在派发升级请求前调用，拿到交给路由的两个端点 */
export function createIncomingPair(): [unknown, IncomingServerSocket] {
  return [new ClientEndpointStub(), new IncomingServerSocket()]
}

// ── 入站：HTTP upgrade 事件处理 ────────────────────────────────────

const STATUS_TEXT: Record<number, string> = {
  101: "Switching Protocols",
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  426: "Upgrade Required",
  429: "Too Many Requests",
  500: "Internal Server Error",
}

/** 把 Node 的升级请求原样造成 Request（保留 upgrade / connection / sec-websocket-key） */
function toUpgradeRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? "localhost"
  const url = new URL(req.url ?? "/", `http://${host}`)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers as IncomingHttpHeaders)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const item of v) headers.append(k, item)
    else headers.set(k, v)
  }
  return new Request(url, { method: req.method ?? "GET", headers })
}

/** 升级被拒（426/500/…）：把 HTTP 响应写回裸 socket 再断开 —— 与 CF 的失败路径一致 */
async function writeRejection(socket: Duplex, res: Response): Promise<void> {
  let body = Buffer.alloc(0)
  try {
    body = Buffer.from(await res.arrayBuffer())
  } catch {
    /* 无 body */
  }
  const headers = new Headers(res.headers)
  headers.set("Content-Length", String(body.length))
  headers.set("Connection", "close")
  let head = `HTTP/1.1 ${res.status} ${STATUS_TEXT[res.status] ?? "Error"}\r\n`
  for (const [k, v] of headers) head += `${k}: ${v}\r\n`
  head += "\r\n"
  try {
    socket.write(head)
    if (body.length) socket.write(body)
    socket.end()
  } catch {
    socket.destroy()
  }
}

export interface AttachOptions {
  /** 升级请求统一派发（返回 101 才真正完成握手） */
  dispatch: (request: Request) => Promise<Response>
  maxPayloadBytes?: number
}

/**
 * 只要求「能挂 upgrade 事件」的结构类型 —— createAdaptorServer 的返回类型是
 * http/http2 Server 的联合，直接写 http.Server 会不兼容。
 */
export interface UpgradeCapableServer {
  on(event: "upgrade", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown
}

/**
 * 把 `upgrade` 事件接到 Hono 应用上。
 * @param httpServer @hono/node-server 的 createAdaptorServer 返回值（普通 http.Server）
 */
export function attachWebSocketUpgrade(httpServer: UpgradeCapableServer, opts: AttachOptions): void {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: opts.maxPayloadBytes ?? 16 * 1024 * 1024,
  })

  httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const [client, server] = createIncomingPair()
      let res: Response
      try {
        res = await upgradeCtx.run({ pair: [client, server] }, () => opts.dispatch(toUpgradeRequest(req)))
      } catch (e) {
        console.error("[ws] 升级派发失败:", e)
        await writeRejection(
          socket,
          new Response(JSON.stringify({ detail: (e as Error).message || "服务器内部错误" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        )
        return
      }

      // 路由拒绝升级（426 需要 WS、密钥缺失 500、CORS 403 …）→ 原样回写 HTTP
      if (res.status !== 101) {
        await writeRejection(socket, res)
        return
      }

      try {
        wss.handleUpgrade(req, socket, head, (ws) => server.attach(ws))
      } catch (e) {
        console.error("[ws] 握手失败:", e)
        socket.destroy()
      }
    })()
  })
}

// ── ② 出站：包装 fetch + Upgrade ───────────────────────────────────

/**
 * `resp.webSocket` 的等价物。
 * 与 CF 一致：`accept()` 之前到达的消息先入队；`send()` 接受 string/Uint8Array/ArrayBuffer。
 */
class OutboundSocket extends EndpointBase {
  #ws: WsClient
  #accepted = false
  #queue: Array<{ type: string; ev: unknown }> = []
  #closed = false

  constructor(ws: WsClient) {
    super()
    this.#ws = ws
    ws.on("message", (data: unknown, isBinary: boolean) => {
      this.#deliver("message", frameOf(data, isBinary))
    })
    ws.on("close", (code: number) => {
      this.#closed = true
      this.#deliver("close", { type: "close", code, reason: "", wasClean: code === 1000 })
    })
    // 注意：'error' 由 openOutbound 的常驻监听统一派发（握手期要 reject Promise，故不能在此重复挂）
  }

  accept(): void {
    if (this.#accepted) return
    this.#accepted = true
    const q = this.#queue
    this.#queue = []
    for (const it of q) this.emit(it.type, it.ev)
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.#closed) return
    try {
      this.#ws.send(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer))
    } catch (e) {
      this.emitError(e as Error)
    }
  }

  close(code = 1000, reason = ""): void {
    if (this.#closed) return
    try {
      this.#ws.close(code, reason)
    } catch {
      /* 已关闭 */
    }
  }

  /** 供 openOutbound 在握手成功后派发运行时错误 */
  emitError(e: Error): void {
    this.emit("error", { type: "error", message: e.message, error: e })
  }

  #deliver(type: string, ev: unknown): void {
    if (this.#accepted) this.emit(type, ev)
    else this.#queue.push({ type, ev })
  }
}

/**
 * 造一个「status=101 且带 .webSocket」的合成 Response（出站 fetch+Upgrade 用）。
 * 依赖 `installResponseShim()` 已安装；若补丁未生效则退回自有属性覆写（同样是 101）。
 */
export function upgradeResponse(webSocket: unknown): Response {
  try {
    return new Response(null, { status: 101, webSocket } as ResponseInit & { webSocket: unknown })
  } catch {
    const res = new Response(null, { status: 200 })
    Object.defineProperty(res, "status", { value: 101, enumerable: true, configurable: true })
    Object.defineProperty(res, "webSocket", { value: webSocket, enumerable: true, configurable: true })
    return res
  }
}

function headersOf(input: unknown, init: unknown): Headers {
  const i = init as RequestInit | undefined
  if (i?.headers) return new Headers(i.headers)
  if (input instanceof Request) return input.headers
  return new Headers()
}

/** 用 ws 建真连；成功后返回合成 101 Response（失败则 reject，调用方按「握手被拒」处理） */
export function openOutbound(rawUrl: string): Promise<Response> {
  const wsUrl = rawUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:")
  return new Promise<Response>((resolve, reject) => {
    const ws = new WsClient(wsUrl, { handshakeTimeout: 15000, maxPayload: 32 * 1024 * 1024 })
    const sock = new OutboundSocket(ws)
    let settled = false

    // 常驻 error 监听：握手期 reject；握手后转交 socket 的 error 事件。
    // （若不常驻，ws 在无 error 监听时会让 'error' 事件抛成未捕获异常）
    ws.on("error", (e: Error) => {
      if (!settled) {
        settled = true
        try {
          ws.terminate()
        } catch {
          /* ignore */
        }
        reject(new Error(`WebSocket 握手失败: ${e.message}`))
      } else {
        sock.emitError(e)
      }
    })

    ws.once("unexpected-response", (_req, res) => {
      if (settled) return
      settled = true
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
      reject(new Error(`WebSocket 握手被拒绝（HTTP ${res.statusCode}）`))
    })

    ws.once("close", () => {
      if (settled) return
      settled = true
      reject(new Error("WebSocket 在握手完成前关闭"))
    })

    ws.once("open", () => {
      if (settled) return
      settled = true
      resolve(upgradeResponse(sock))
    })
  })
}

/**
 * 把 `fetch(url, { headers: { Upgrade: "websocket" } })` 改走真实 WS 连接。
 * 必须在加载 server_cf 之前调用。
 */
export function installFetchUpgrade(): void {
  const g = globalThis as unknown as { fetch: (...args: unknown[]) => Promise<Response> }
  const orig = g.fetch.bind(globalThis) as (...args: unknown[]) => Promise<Response>
  g.fetch = async (input?: unknown, init?: unknown): Promise<Response> => {
    const headers = headersOf(input, init)
    if ((headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
      return orig(input, init)
    }
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url
    return openOutbound(raw)
  }
}
