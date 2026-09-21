/**
 * AiPhonix 云托管（CloudBase CloudRun）入口 —— **跑的是 server_cf 原版源码**。
 *
 * 设计原则：server_cf/** 一行不改。CF 专有面只有 4 个绑定 + WebSocket + waitUntil，
 * 全部在 cloudbase/src/shims/ 里等价实现；本文件只做「启动 + HTTP/WS 接线 + 静态优先路由」。
 *
 * 与生产（Cloudflare Worker）逐项对齐的点：
 *   · `/` → 302 `/web/`、`/web/*`、`/letter-clips/*`、`/videos/*`、`/api/v1/**`、`/health` 全由 server_cf 处理
 *   · `[assets] run_worker_first = false` 的「静态文件优先」在此显式实现：
 *     `GET/HEAD /web/*`、`/tts-cache/*` 先查磁盘，命中直出（缓存头按 _headers 复刻），未命中才进 Hono
 *   · WebSocket：入站 `/api/v1/asr/stream` 用 http `upgrade` 事件 + WebSocketPair 适配；
 *     出站（百度/腾讯）由包装后的 fetch 走真实 ws
 *
 * 环境变量（全部同名对应 wrangler secret/vars，另加下面 4 个部署参数）：
 *   PORT          监听端口（平台注入，默认 8080）
 *   BIND_HOST     监听地址（默认 0.0.0.0）
 *   SHARED_ROOT   R2 根（默认 /app/shared）
 *   ASSETS_ROOT   Assets 根（默认 /app/server_cf/static_assets）
 */
import { createAdaptorServer } from "@hono/node-server"
import serverApp from "../../server_cf/src/index.js"
import { setEnv } from "../../server_cf/src/env.js"
import { staticResponse } from "./shims/assets.js"
import { ExecutionContextShim } from "./shims/context.js"
import { createRuntime, describeBindings } from "./shims/index.js"
import { attachWebSocketUpgrade, installFetchUpgrade, installResponseShim, installWebSocketPairGlobal } from "./shims/ws.js"

const PORT = Number(process.env.PORT || 8080)
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0"
const SHARED_ROOT = process.env.SHARED_ROOT || "/app/shared"
const ASSETS_ROOT = process.env.ASSETS_ROOT || "/app/server_cf/static_assets"

// ── 全局补丁（必须在加载/调用 server_cf 之前）──
// ① Response：允许 status=101（server_cf 的 asr 路由自己就构造 101，undici 默认会抛 RangeError）
installResponseShim()
// ② WebSocketPair：把「本次升级的端点对」交给路由
installWebSocketPairGlobal()
// ③ fetch：出站 `Upgrade: websocket` 改走真实 ws
installFetchUpgrade()

const { bindings } = createRuntime({ filesRoot: SHARED_ROOT, assetsRoot: ASSETS_ROOT })
setEnv(bindings)

/**
 * Assets 直出的路径前缀（对齐 run_worker_first=false 的可见范围）。
 * ⚠️ 必须同时含不带尾斜杠的精确路径：CF Assets 对 `/web` 做 clean-URL 307 到 `/web/`，
 *    若只匹配 `/web/` 就会落到 Hono 的 serveWebIndex 上（200 + index.html），与生产不一致。
 */
const STATIC_PREFIXES = ["/web/", "/tts-cache/"]
const STATIC_EXACT = ["/web", "/tts-cache"]

function isAssetsPath(pathname: string): boolean {
  return STATIC_EXACT.includes(pathname) || STATIC_PREFIXES.some((p) => pathname.startsWith(p))
}

async function handleFetch(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  // ① 静态资源优先（与生产 Assets 直出一致）
  if ((method === "GET" || method === "HEAD") && isAssetsPath(url.pathname)) {
    const staticRes = await staticResponse(ASSETS_ROOT, url.pathname, request.headers, method === "HEAD")
    if (staticRes) return staticRes
  }

  // ② 交给 server_cf 原版 Hono 应用
  const ctx = new ExecutionContextShim()
  return await serverApp.fetch(request, bindings, ctx as unknown as ExecutionContext)
}

const server = createAdaptorServer({
  fetch: (request: Request) => handleFetch(request),
  // ⚠️ 必须关掉全局覆盖：@hono/node-server 默认会把 globalThis.Response 换成它自己那个轻量
  //    `Response`，而那个类的 `status` getter 走 `new GlobalResponse(body, this.#init)` 复制构造 ——
  //    init.status=101 时 undici 直接抛 `RangeError: init["status"] must be in the range of 200 to 599`。
  //    表现就是「/api/v1/asr/stream 升级请求返回 500，错误信息是 undici 的 RangeError」。
  //    关掉后全局仍是原生 Response（+ upgrade 补丁），101 与其它一切行为都按标准来。
  overrideGlobalObjects: false,
})

// ③ WebSocket 升级（Node 不会把 upgrade 请求交给 requestListener，故必须单独接）
attachWebSocketUpgrade(server, {
  dispatch: (request: Request) => {
    const ctx = new ExecutionContextShim()
    return serverApp.fetch(request, bindings, ctx as unknown as ExecutionContext)
  },
})

// ── 启动 ──
server.listen(PORT, BIND_HOST, () => {
  const { configured, missing } = describeBindings(bindings)
  console.log("─".repeat(64))
  console.log("[cloudbase] AiPhonix api (server_cf on Node) 已启动")
  console.log(`[cloudbase] listen       http://${BIND_HOST}:${PORT}`)
  console.log(`[cloudbase] SHARED_ROOT  ${SHARED_ROOT}  (R2 键空间 / data/app.db)`)
  console.log(`[cloudbase] ASSETS_ROOT  ${ASSETS_ROOT}  (/web/、/tts-cache/)`)
  console.log(`[cloudbase] env 已注入 ${configured.length} 项: ${configured.join(", ") || "（无）"}`)
  if (missing.length) console.log(`[cloudbase] env 未注入 ${missing.length} 项: ${missing.join(", ")}`)
  console.log("─".repeat(64))
})

// ── 优雅退出 ──
let shuttingDown = false
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[cloudbase] 收到 ${sig}，停止接收新连接…`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10_000).unref()
  })
}

process.on("unhandledRejection", (reason) => {
  // 兜底：不应出现（waitUntil 已捕获）。打日志但不退出，避免一次抖动就让容器重启。
  console.error("[cloudbase] unhandledRejection:", reason)
})
process.on("uncaughtException", (err) => {
  console.error("[cloudbase] uncaughtException:", err)
})
