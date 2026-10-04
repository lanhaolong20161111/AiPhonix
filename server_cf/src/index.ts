/**
 * AiPhonix Cloudflare Workers 入口（对齐 server_ts/src/index.ts 的挂载与响应语义）。
 * - 静态资源（web/letter-clips/videos/APK）全部走 R2（含 Range/ETag 支持）
 * - 业务路由挂载结构与 server_ts 一致
 */
import { Hono } from "hono"
import type { Context } from "hono"
import { setEnv, getConfig, getEnv } from "./env.js"
import type { Bindings } from "./bindings.js"
import { toKey } from "./lib/storage.js"
import { recordLog, errMeta } from "./lib/observe.js"

// 路由清单（模块注册表）—— 唯一真源；本文件只负责「按清单挂载」
import { MODULES } from "./modules/manifest.js"

// 导出 app 供双端 parity 检查（scripts/parity-check.mts）使用，无副作用。
export const app = new Hono<{ Bindings: Bindings }>()

// ── CORS allowlist（与 server_ts 一致）──
function originAllowed(origin: string | undefined, reqHost: string | undefined): boolean {
  if (!origin) return true
  const allowList = (getEnv().CORS_ALLOW_ORIGINS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
  if (allowList.includes(origin)) return true
  // 同主机放行（前端与 API 署在同一域名下）
  if (reqHost) {
    try { if (new URL(origin).host === reqHost) return true } catch { /* 非法 Origin */ }
  }
  // 未显式配置白名单时，仅放行本地开发回退（5173 / localhost / 127.0.0.1）。
  // 生产必须配置 CORS_ALLOW_ORIGINS，否则上述任意端口/主机不再放行。
  if (allowList.length === 0) {
    try {
      const u = new URL(origin)
      if (u.port === "5173") return true
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true
    } catch { /* 非法 Origin */ }
  }
  return false
}

function setCorsHeaders(c: { header: (name: string, value: string) => void }, origin: string): void {
  c.header("Access-Control-Allow-Origin", origin)
  c.header("Vary", "Origin")
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

app.use("*", async (c, next) => {
  // 静态资源同源直出，不需要 CORS 处理（省一次 origin 解析 + 响应头写入）
  const p = c.req.path
  if (p.startsWith("/web/") || p.startsWith("/letter-clips/") || p.startsWith("/videos/") || p === "/web" || p === "/") {
    return await next()
  }
  const origin = c.req.header("Origin")
  if (!originAllowed(origin, c.req.header("Host"))) {
    return c.json({ detail: "Origin 不在允许列表" }, 403)
  }
  await next()
  if (origin) setCorsHeaders(c, origin)
})

app.options("*", (c) => {
  const origin = c.req.header("Origin")
  if (origin) setCorsHeaders(c, origin)
  return c.body(null, 204)
})

// ── 请求日志（媒体快速成功请求不打；结构化 JSON + D1 落库，供 /api/v1/ops 查询）──
const MEDIA_LOG_SKIP_PREFIXES = [
  "/api/v1/pinyin-audio",
  "/api/v1/ipa-audio",
  "/api/v1/char-images/file",
  "/api/v1/tts/char",
  "/letter-clips/",
  "/videos/",
  "/web/",
]
app.use("*", async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  const fastMedia =
    MEDIA_LOG_SKIP_PREFIXES.some((p) => c.req.path.startsWith(p)) && ms < 500 && c.res.status < 400
  if (!fastMedia) {
    c.executionCtx.waitUntil(
      recordLog({ method: c.req.method, path: c.req.path, status: c.res.status, durationMs: ms, level: "info" })
    )
  }
})

// 健康检查（顺带探测 D1/R2 绑定）
app.get("/health", async (c) => {
  const cfg = getConfig()
  let d1 = "unknown"
  let r2 = "unknown"
  try {
    const r = await getEnv().DB.prepare("SELECT 1 AS ok").first<{ ok: number }>()
    d1 = r ? "ok" : "empty"
  } catch {
    d1 = "error"
  }
  try {
    await getEnv().FILES.head("__probe__")
    r2 = "ok"
  } catch {
    r2 = "error"
  }
  return c.json({ status: "ok", model: cfg.deepseek.model, d1, r2 })
})

// ── R2 静态资源（web/letter-clips/videos；含 Range 与 ETag） ──
const MIME_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  woff: "font/woff",
  woff2: "font/woff2",
}

function extMime(key: string): string {
  const m = key.match(/\.([a-z0-9]+)$/i)
  return m ? MIME_BY_EXT[m[1].toLowerCase()] ?? "application/octet-stream" : "application/octet-stream"
}

async function serveR2Object(c: Context, key: string, cacheControl: string): Promise<Response> {
  const env = getEnv()
  const rangeHeader = c.req.header("Range")
  let obj = null as R2ObjectBody | null
  let status = 200
  const headers: Record<string, string> = {
    "Content-Type": extMime(key),
    "Cache-Control": cacheControl,
    "Accept-Ranges": "bytes",
  }
  if (rangeHeader) {
    const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
    if (m) {
      const head = await env.FILES.head(key)
      if (!head) return c.json({ detail: "Not Found" }, 404)
      const size = head.size
      let start = m[1] === "" ? NaN : Number(m[1])
      let end = m[2] === "" ? NaN : Number(m[2])
      if (Number.isNaN(start)) {
        // suffix range: bytes=-N
        const n = Number(m[2])
        start = Math.max(0, size - n)
        end = size - 1
      }
      if (Number.isNaN(end) || end >= size) end = size - 1
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } })
      }
      const length = end - start + 1
      obj = await env.FILES.get(key, { range: { offset: start, length } })
      if (!obj) return c.json({ detail: "Not Found" }, 404)
      status = 206
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`
      headers["Content-Length"] = String(length)
    }
  }
  if (!obj) {
    obj = await env.FILES.get(key)
    if (!obj) return c.json({ detail: "Not Found" }, 404)
  }
  if (status === 200 && obj.httpEtag) headers["ETag"] = obj.httpEtag
  const inm = c.req.header("If-None-Match")
  if (status === 200 && inm && obj.httpEtag && inm === obj.httpEtag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(obj.body, { status, headers })
}

// 根路径跳转网页端（手机直接访问域名即可）
app.get("/", (c) => c.redirect("/web/", 302))

// ── /web/* 由 Workers Assets 直出（index.html、assets/*、sw.js、manifest 等构建产物）。
// 只有「Assets 未命中」的路径（React Router 深链接）才会进到这里 → 回 index.html（SPA fallback）。
// 注意：fetch 必须用 "/web/"（带斜杠）——Assets 对 "/web/index.html" 会走 clean-URL 重定向到
// "/web/"（307），而 "/web/" 会直接命中 web/index.html 并 200 返回内容，路径得以保留。
const serveWebIndex = async (c: Context) => {
  const req = c.req.raw as Request
  const url = new URL(req.url)
  const assetReq = new Request(new URL("/web/", url), req)
  const res = await c.env.ASSETS.fetch(assetReq)
  // 不缓存：每次回源拿最新 asset 引用（_headers 已对 /web/index.html 设 no-cache，此处兜底）
  if (res.status === 404) return c.json({ detail: "Not Found" }, 404)
  const headers = new Headers(res.headers)
  headers.set("Cache-Control", "no-cache")
  return new Response(res.body, { status: res.status, headers })
}
app.get("/web", serveWebIndex)
app.get("/web/*", serveWebIndex)

// 媒体（letter-clips/videos）仍在 R2，走 Worker + Range 支持
app.get("/letter-clips/*", (c) => {
  const path = new URL(c.req.url).pathname.replace(/^\/letter-clips\/?/, "")
  const key = toKey(`static/letter_clips/${path}`)
  return serveR2Object(c, key, "public, max-age=86400")
})

app.get("/videos/*", (c) => {
  const path = new URL(c.req.url).pathname.replace(/^\/videos\/?/, "")
  const key = toKey(`static/videos/${path}`)
  return serveR2Object(c, key, "public, max-age=86400")
})

// ── /api/v1 路由：由 modules/manifest.ts 派生（与 server_ts 挂载一致） ──
// 清单顺序 = 挂载顺序。两段循环之间插入 `app.route("/api/v1", api)`，
// 与改造前「先挂完 api 子应用、再挂 app 级路由」的顺序逐条对应。
const api = new Hono<{ Bindings: Bindings }>()
for (const m of MODULES) {
  if (m.target === "api") api.route(`/${m.prefix}`, m.handler)
}
app.route("/api/v1", api)
// ai_*/tts/soe 等：路由文件内部用完整前缀，直接挂到 /api/v1
for (const m of MODULES) {
  if (m.target !== "api") app.route(m.prefix ? `/api/v1/${m.prefix}` : "/api/v1", m.handler)
}

// 404 for unknown API
app.notFound((c) => c.json({ detail: "Not Found" }, 404))

// 统一错误处理（预算守卫等；错误落 D1 + 结构化 console，供 /api/v1/ops 查询）
app.onError((err, c) => {
  const anyErr = err as { status?: number; detail?: string; budget?: boolean }
  const errMsg = anyErr.detail || (err as Error).message || "服务器内部错误"
  if (anyErr.budget) {
    c.executionCtx.waitUntil(
      recordLog({ method: c.req.method, path: c.req.path, status: 429, durationMs: 0, level: "warn", message: "budget guard", meta: errMeta(err) })
    )
    return c.json({ detail: "今日 AI 额度已用完，请明天再试（预算守卫）", budget: true }, 429 as const)
  }
  const status = (anyErr.status || 500) as 200 | 400 | 401 | 403 | 404 | 413 | 422 | 429 | 500
  c.executionCtx.waitUntil(
    recordLog({ method: c.req.method, path: c.req.path, status, durationMs: 0, level: "error", message: errMsg, meta: errMeta(err) })
  )
  return c.json({ detail: errMsg }, status)
})

export default {
  fetch(req: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    setEnv(env)
    return Promise.resolve(app.fetch(req, env, ctx))
  },
}
