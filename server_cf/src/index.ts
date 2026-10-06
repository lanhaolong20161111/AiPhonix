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
  // 静态资源/下载同源直出，不需要 CORS 处理（省一次 origin 解析 + 响应头写入）
  const p = c.req.path
  if (p.startsWith("/web/") || p.startsWith("/letter-clips/") || p.startsWith("/videos/") || p.startsWith("/dl/") || p === "/web" || p === "/") {
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
  "/dl/",
]

/**
 * 下载口令就写在路径里，落库前先抹掉。
 * D1 是长期留痕的，而口令一旦进日志，「不公开」这条前提就靠不住了。
 */
function redactPath(p: string): string {
  return p.replace(/^\/dl\/[^/]+/, "/dl/***")
}

app.use("*", async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  const fastMedia =
    MEDIA_LOG_SKIP_PREFIXES.some((p) => c.req.path.startsWith(p)) && ms < 500 && c.res.status < 400
  if (!fastMedia) {
    c.executionCtx.waitUntil(
      recordLog({ method: c.req.method, path: redactPath(c.req.path), status: c.res.status, durationMs: ms, level: "info" })
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
  // APK：写对 MIME 才会被浏览器/系统当成安装包（否则是 octet-stream，
  // 部分国产浏览器会把它当普通文件存下来，不给「安装」入口）
  apk: "application/vnd.android.package-archive",
}

function extMime(key: string): string {
  const m = key.match(/\.([a-z0-9]+)$/i)
  return m ? MIME_BY_EXT[m[1].toLowerCase()] ?? "application/octet-stream" : "application/octet-stream"
}

/**
 * @param downloadAs 传文件名则加 `Content-Disposition: attachment`（强制下载而非就地打开）。
 *   APK 必须走这条：否则某些浏览器会尝试渲染二进制。
 */
async function serveR2Object(c: Context, key: string, cacheControl: string, downloadAs?: string): Promise<Response> {
  const env = getEnv()
  const rangeHeader = c.req.header("Range")
  let obj = null as R2ObjectBody | null
  let status = 200
  const headers: Record<string, string> = {
    "Content-Type": extMime(key),
    "Cache-Control": cacheControl,
    "Accept-Ranges": "bytes",
  }
  if (downloadAs) headers["Content-Disposition"] = `attachment; filename="${downloadAs}"`
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

// ── APK 下载（刻意「不公开」）────────────────────────────────────────
// 为什么走服务端而不是静态资源：APK 46MB / 38MB，远超 Workers 静态资源**单文件 25MiB** 上限。
// 为什么不在首页挂入口：小英 APK 的 BuildConfig 里烘焙了 DeepSeek key（从 classes.dex 里
//   `grep sk-` 就能拿到明文），公开链接 = 把 key 送人。故只给一条猜不到的口令路径。
// 口令从 secret `DL_TOKEN` 读（见 bindings.ts 里为什么不用 [vars]）；未配置则整块关闭。
const DL_FILES: Record<string, { key: string; label: string; desc: string }> = {
  "xiaoying.apk": {
    key: "downloads/xiaoying.apk",
    label: "小英（语音问答）",
    desc: "喊「小英小英」→ 应答 → 问「XX 的英语怎么说」→ 读单词 3 遍 + 例句。首次打开需在 App 内下载 226MB 识别模型。",
  },
  "aiphonix.apk": {
    key: "downloads/AiPhonix.apk",
    label: "AiPhonix（主 App）",
    desc: "拼音 / 认字 / 跟读测评 / 动画学数学等，功能对齐网页版。",
  },
}

/** 口令校验：未配置或过短 ⇒ 一律拒绝（fail closed，避免「忘了配 secret」变成公开下载） */
function dlTokenOk(input: string): boolean {
  const want = (getEnv().DL_TOKEN ?? "").trim()
  if (want.length < 12) return false
  if (input.length !== want.length) return false
  // 定长比较，不给「靠响应时间逐字节猜口令」留路（口令虽长，成本也就几行）
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= input.charCodeAt(i) ^ want.charCodeAt(i)
  return diff === 0
}

function dlPageHtml(token: string, files: { name: string; label: string; desc: string; size: number | null }[]): string {
  const rows = files
    .map((f) => {
      const size = f.size === null ? "未上传" : `${(f.size / 1048576).toFixed(1)} MB`
      const action = f.size === null
        ? `<span class="btn off">暂不可用</span>`
        : `<a class="btn" href="/dl/${token}/${f.name}">下载</a>`
      return `<li><div><p class="name">${f.label}</p><p class="desc">${f.desc}</p></div><div class="act"><span class="size">${size}</span>${action}</div></li>`
    })
    .join("")
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>小英 · 下载</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:24px 16px 48px;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7f4;color:#23231f}
.wrap{max-width:560px;margin:0 auto}
h1{margin:0 0 4px;font-size:20px;font-weight:600}
.sub{margin:0 0 20px;color:#5f5e5a;font-size:13px}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
li{display:flex;gap:12px;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e2e1db;border-radius:12px;padding:14px}
.name{margin:0 0 4px;font-weight:600}
.desc{margin:0;color:#5f5e5a;font-size:12.5px;line-height:1.5}
.act{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none}
.size{color:#8a8880;font-size:12px;white-space:nowrap}
.btn{display:inline-block;padding:8px 18px;border-radius:8px;background:#2f6f4f;color:#fff;text-decoration:none;font-size:14px;white-space:nowrap}
.btn.off{background:#d3d1c7;color:#5f5e5a}
.note{margin:20px 0 0;padding:12px 14px;border-radius:10px;background:#fdf6e3;border:1px solid #f0e0b0;font-size:12.5px;color:#6b5518}
.note b{color:#4a3808}
@media(max-width:420px){li{flex-direction:column;align-items:flex-start}.act{flex-direction:row;align-items:center;gap:10px}}
</style></head>
<body><div class="wrap">
<h1>小英 · 下载</h1>
<p class="sub">安卓安装包。手机点「下载」→ 安装时允许「未知来源应用」即可。</p>
<ul>${rows}</ul>
<p class="note"><b>请勿转发此页面链接。</b>小英安装包里带有一个「访问口令」——大模型 key 只在服务端，APK 里已经没有它了；但口令扩散出去，别人就会用掉你的 AI 额度（服务端有每日硬顶，可你当天也就用不了了）。</p>
</div></body></html>`
}

app.get("/dl/:token", async (c) => {
  if (!dlTokenOk(c.req.param("token"))) return c.notFound()
  const files = await Promise.all(
    Object.entries(DL_FILES).map(async ([name, f]) => {
      const head = await getEnv().FILES.head(toKey(f.key))
      return { name, label: f.label, desc: f.desc, size: head ? head.size : null }
    }),
  )
  return c.html(dlPageHtml(c.req.param("token"), files), 200, {
    // 口令页不留缓存、不进搜索引擎（口令本身已在 URL 里，缓存等于二次分发）
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  })
})

app.get("/dl/:token/:name", (c) => {
  if (!dlTokenOk(c.req.param("token"))) return c.notFound()
  const f = DL_FILES[c.req.param("name")]
  if (!f) return c.notFound()
  // private：不让中间缓存把「口令 URL」缓存下来二次分发；max-age 给浏览器留 1 天，便于断点续传
  return serveR2Object(c, toKey(f.key), "private, max-age=86400", c.req.param("name"))
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
      recordLog({ method: c.req.method, path: redactPath(c.req.path), status: 429, durationMs: 0, level: "warn", message: "budget guard", meta: errMeta(err) })
    )
    return c.json({ detail: "今日 AI 额度已用完，请明天再试（预算守卫）", budget: true }, 429 as const)
  }
  const status = (anyErr.status || 500) as 200 | 400 | 401 | 403 | 404 | 413 | 422 | 429 | 500
  c.executionCtx.waitUntil(
    recordLog({ method: c.req.method, path: redactPath(c.req.path), status, durationMs: 0, level: "error", message: errMsg, meta: errMeta(err) })
  )
  return c.json({ detail: errMsg }, status)
})

export default {
  fetch(req: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    setEnv(env)
    return Promise.resolve(app.fetch(req, env, ctx))
  },
}
