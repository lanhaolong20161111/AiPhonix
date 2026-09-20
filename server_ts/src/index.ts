/** AiPhonix TS 服务端入口 — Hono，路径/响应与 Python 版兼容 */
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { dirname, join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import type { Server as HttpServer } from "node:http"
import { fileURLToPath } from "node:url"
import { getConfig, STATIC_DIR, DATA_DIR, ROOT } from "./env.js"
import { sqlite } from "./db/index.js"
import authRoutes from "./routes/auth.js"
import usersRoutes from "./routes/users.js"
import userImportsRoutes from "./routes/user_imports.js"
import uploadsRoutes from "./routes/uploads.js"
import coursewareRoutes from "./routes/courseware.js"
import essaysRoutes from "./routes/essays.js"
import englishRoutes from "./routes/english.js"
import wordbankRoutes from "./routes/wordbank.js"
import chinesePracticeRoutes from "./routes/chinese_practice.js"
import practiceRoutes from "./routes/practice.js"
import practiceTrackerRoutes from "./routes/practice_tracker.js"
import trainingRoutes from "./routes/training.js"
import importTemplatesRoutes from "./routes/import_templates.js"
import charImagesRoutes from "./routes/char_images.js"
import pinyinAudioRoutes from "./routes/pinyin_audio.js"
import ipaAudioRoutes from "./routes/ipa_audio.js"
import quizRoutes from "./routes/quiz.js"
import wordSuggestionsRoutes from "./routes/word_suggestions.js"
import llmRoutes from "./routes/llm.js"
import arkImageRoutes from "./routes/ark_image.js"
import freeLlmRoutes from "./routes/free_llm.js"
import aiPracticeRoutes from "./routes/ai_practice.js"
import chineseRoutes from "./routes/chinese.js"
import aiChineseRoutes from "./routes/ai_chinese.js"
import aiHomeworkRoutes from "./routes/ai_homework.js"
import aiChatRoutes from "./routes/ai_chat.js"
import ttsRoutes from "./routes/tts.js"
import soeRoutes from "./routes/soe.js"
import asrShortRoutes from "./routes/asrShort.js"
import asrStreamRoutes, { attachAsrStream } from "./routes/asrStream.js"
import subtitleCaptureRoutes from "./routes/subtitleCapture.js"
import biliRoutes from "./routes/bili.js"
import visitsRoutes from "./routes/visits.js"
import prefsRoutes from "./routes/prefs.js"
import videoIssuesRoutes from "./routes/video_issues.js"

const HERE = dirname(fileURLToPath(import.meta.url))


export const app = new Hono()

// ── CORS allowlist（替代 origin:"*"，防止局域网内任意网页对后端发跨域写请求）──
// 放行：无 Origin（curl/原生 App）、localhost 任意端口（本机 dev）、任意主机的 :5173
// （Vite dev 经 changeOrigin 代理后 Host 已改写为后端地址，Origin 才是前端真身，不能按 host 比对）、
// env CORS_ALLOW_ORIGINS 额外白名单（逗号分隔）、与 Host 同源的直接访问。
function originAllowed(origin: string | undefined, reqHost: string | undefined): boolean {
  if (!origin) return true
  try {
    if (process.env.CORS_ALLOW_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean).includes(origin)) return true
    const u = new URL(origin)
    if (u.port === "5173") return true
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true
    if (reqHost && u.host === reqHost) return true
  } catch {
    /* 非法 Origin */
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

// ── 请求日志（媒体路径快速成功时不打，避免字卡页一屏几百条刷屏）──
const MEDIA_LOG_SKIP_PREFIXES = [
  "/api/v1/pinyin-audio",
  "/api/v1/ipa-audio",
  "/api/v1/char-images/file",
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
  if (!fastMedia) console.log(`[req] ${c.req.method} ${c.req.path} -> ${c.res.status} ${ms}ms`)
})

// 健康检查
app.get("/health", (c) => {
  const cfg = getConfig()
  return c.json({ status: "ok", model: cfg.deepseek.model })
})

// ── 顶层 HTML 页面（对齐 Python main.py） ──

const APK_PATH = join(ROOT, "shared", "downloads", "AiPhonix.apk")
const INDEX_PATH = join(DATA_DIR, "char_image_index.json")

// 最近重配的 24 张英句卡（Seedream-5.0 新图），用于单独审查
const RECENT_SENTS = [
  "beg your pardon", "Can you see me", "come here",
  "Did you hear anything", "doors go up", "good afternoon",
  "how about a drink", "How far is it?", "I beg your pardon",
  "I can hear something", "i can't see anyone", "I see.",
  "in front", "it's not big enough", "look out",
  "no one can see me", "once upon a time", "say it again",
  "second floor", "straight on", "take away",
  "Tell me.", "there's no one outside", "yes I like apples",
]

app.get("/download", (c) => {
  const apkExists = existsSync(APK_PATH)
  const sizeMb = apkExists ? Math.round(readFileSync(APK_PATH).length / (1024 * 1024) * 10) / 10 : 0
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AiPhonix 下载</title>
<style>
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background:#f5f7fa; display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; }
  .card { background:#fff; border-radius:16px; padding:40px 32px; text-align:center; box-shadow:0 4px 20px rgba(0,0,0,.08); max-width:360px; width:90%; }
  .logo { font-size:52px; margin-bottom:12px; }
  h1 { font-size:22px; color:#1a1a2e; margin:0 0 8px; }
  p { color:#666; font-size:14px; line-height:1.7; margin:6px 0; }
  .btn { display:block; background:#4a6cf7; color:#fff; text-decoration:none; padding:14px; border-radius:10px; font-size:17px; font-weight:600; margin-top:20px; }
  .btn:active { opacity:.85; }
  .tip { background:#fff8e6; border:1px solid #f0d68a; border-radius:8px; padding:10px; font-size:12px; color:#8a6d1a; margin-top:16px; text-align:left; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">📱</div>
  <h1>AiPhonix</h1>
  <p>局域网内 APK 安装包</p>
  <p>版本：Debug 构建 · 大小：${sizeMb} MB</p>
  <a class="btn" href="/download/apk">⬇️ 下载并安装</a>
  <div class="tip">
    ⚠️ 首次安装需在手机设置中允许「安装未知来源应用」<br>
    （不同品牌路径：设置 → 安全/应用 → 允许安装未知应用）
  </div>
</div>
</body>
</html>`)
})

app.get("/download/apk", (c) => {
  if (!existsSync(APK_PATH)) return c.html("<h3>APK 文件不存在</h3>", 404)
  const buf = readFileSync(APK_PATH)
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="AiPhonix.apk"',
    },
  })
})

function reviewCardsHtml(sents: { char: string; image: string }[]): string {
  let cards = ""
  for (const it of sents) {
    const char = it.char
    const img = encodeURIComponent(it.image)
    cards += `
        <div class="card">
          <div class="imgwrap"><img src="/api/v1/char-images/file/${img}" alt="${char}" loading="lazy"></div>
          <div class="info"><span class="word">${char}</span><span class="type">英句</span></div>
        </div>`
  }
  return cards
}

app.get("/review", (c) => {
  let data: unknown = null
  try {
    data = JSON.parse(readFileSync(INDEX_PATH, "utf-8"))
  } catch {
    return c.html("<h3>索引文件读取失败</h3>", 500)
  }
  const raw = data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
    ? (data as { items: { type?: string; char?: string; image?: string }[] }).items
    : []
  const sents = raw
    .filter((it) => it?.type === "英句")
    .sort((a, b) => (a?.char ?? "").toLowerCase().localeCompare((b?.char ?? "").toLowerCase()))
  const cards = reviewCardsHtml(sents.map((it) => ({ char: String(it?.char ?? ""), image: String(it?.image ?? "") })))
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>英句图片汇总审查（${sents.length} 条）</title>
<style>
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background:#f5f7fa; margin:0; padding:20px; }
  h1 { font-size:20px; color:#1a1a2e; text-align:center; }
  .stats { text-align:center; color:#888; font-size:14px; margin:4px 0 16px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; max-width:1400px; margin:0 auto; }
  .card { background:#fff; border-radius:14px; padding:12px; box-shadow:0 2px 12px rgba(0,0,0,.06); }
  .imgwrap { background:#eee; border-radius:10px; overflow:hidden; aspect-ratio:1/1; display:flex; align-items:center; justify-content:center; }
  .imgwrap img { max-width:100%; max-height:100%; object-fit:contain; }
  .info { display:flex; align-items:center; gap:8px; margin:10px 2px 4px; }
  .word { font-size:15px; font-weight:700; color:#1a1a2e; word-break:break-word; }
  .type { background:#4a6cf7; color:#fff; font-size:12px; padding:2px 8px; border-radius:20px; flex-shrink:0; }
</style>
</head>
<body>
<h1>📄 英句图片汇总（${sents.length} 条）</h1>
<div class="stats">按字母排序 · 点击图片可放大查看原图</div>
<div class="grid">${cards}
</div>
</body>
</html>`)
})

app.get("/review/new", (c) => {
  let data: unknown = null
  try {
    data = JSON.parse(readFileSync(INDEX_PATH, "utf-8"))
  } catch {
    return c.html("<h3>索引文件读取失败</h3>", 500)
  }
  const raw = data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
    ? (data as { items: { type?: string; char?: string; image?: string }[] }).items
    : []
  const byChar = new Map(raw.filter((it) => it?.type === "英句").map((it) => [it?.char, it]))
  const found: { char: string; image: string }[] = []
  for (const sent of RECENT_SENTS) {
    const it = byChar.get(sent)
    if (it) found.push({ char: sent, image: String(it.image ?? "") })
  }
  const cards = reviewCardsHtml(found)
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>新图审核（${found.length}/${RECENT_SENTS.length}）</title>
<style>
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background:#f5f7fa; margin:0; padding:20px; }
  h1 { font-size:20px; color:#1a1a2e; text-align:center; }
  .stats { text-align:center; color:#888; font-size:14px; margin:4px 0 16px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; max-width:1400px; margin:0 auto; }
  .card { background:#fff; border-radius:14px; padding:12px; box-shadow:0 2px 12px rgba(0,0,0,.06); }
  .imgwrap { background:#eee; border-radius:10px; overflow:hidden; aspect-ratio:1/1; display:flex; align-items:center; justify-content:center; }
  .imgwrap img { max-width:100%; max-height:100%; object-fit:contain; }
  .info { display:flex; align-items:center; gap:8px; margin:10px 2px 4px; }
  .word { font-size:15px; font-weight:700; color:#1a1a2e; word-break:break-word; }
  .type { background:#4a6cf7; color:#fff; font-size:12px; padding:2px 8px; border-radius:20px; flex-shrink:0; }
  a.back { display:block; text-align:center; color:#4a6cf7; margin-bottom:12px; text-decoration:none; }
</style>
</head>
<body>
<h1>🆕 新图审核（${found.length}/${RECENT_SENTS.length}）</h1>
<div class="stats">Seedream-5.0 重配的 24 张英句卡 · <a href="/review">查看全部英句</a></div>
<div class="grid">${cards}
</div>
</body>
</html>`)
})

// ── 静态资源（与 Python main.py 挂载一致） ──
// 前端构建产物 web/
const webDir = join(STATIC_DIR, "web")
if (existsSync(webDir)) {
  app.use("/web/*", serveStatic({ root: STATIC_DIR, rewriteRequestPath: (p) => p.replace(/^\/web/, "/web") }))
}
// 字母视频
const letterDir = join(STATIC_DIR, "letter_clips")
if (existsSync(letterDir)) {
  app.use("/letter-clips/*", serveStatic({ root: STATIC_DIR, rewriteRequestPath: (p) => p.replace(/^\/letter-clips/, "/letter_clips") }))
}
// 跟读视频
const videosDir = join(STATIC_DIR, "videos")
if (existsSync(videosDir)) {
  app.use("/videos/*", serveStatic({ root: STATIC_DIR }))
}

// /api/v1 路由（逐阶段挂载）
const api = new Hono()
api.route("/auth", authRoutes)
api.route("/users", usersRoutes)
api.route("/user-imports", userImportsRoutes)
api.route("/uploads", uploadsRoutes)
api.route("/courseware", coursewareRoutes)
api.route("/essays", essaysRoutes)
api.route("/english", englishRoutes)
api.route("/wordbank", wordbankRoutes)
api.route("/practice", practiceRoutes)
api.route("/practice", practiceTrackerRoutes)
api.route("/training", trainingRoutes)
api.route("/import-templates", importTemplatesRoutes)
api.route("/char-images", charImagesRoutes)
api.route("/pinyin-audio", pinyinAudioRoutes)
api.route("/ipa-audio", ipaAudioRoutes)
api.route("/llm", quizRoutes)
api.route("/llm", wordSuggestionsRoutes)
api.route("/llm", llmRoutes)
api.route("/llm", chinesePracticeRoutes)
api.route("/chinese", chineseRoutes)
app.route("/api/v1", api)
// ai_*/tts/soe 内部用完整前缀，直接挂到 /api/v1
app.route("/api/v1", aiChineseRoutes)
app.route("/api/v1", aiHomeworkRoutes)
app.route("/api/v1", aiPracticeRoutes)
app.route("/api/v1", aiChatRoutes)
app.route("/api/v1", arkImageRoutes)
app.route("/api/v1", freeLlmRoutes)
app.route("/api/v1", ttsRoutes)
app.route("/api/v1", asrShortRoutes)
app.route("/api/v1", asrStreamRoutes)
app.route("/api/v1", soeRoutes)
app.route("/api/v1", subtitleCaptureRoutes)
app.route("/api/v1", biliRoutes)
app.route("/api/v1", visitsRoutes)
app.route("/api/v1", prefsRoutes)
app.route("/api/v1", videoIssuesRoutes)

// 404 for unknown API
app.notFound((c) => c.json({ detail: "Not Found" }, 404))

// 统一错误处理（预算守卫等）
app.onError((err, c) => {
  console.error("[error]", err)
  const anyErr = err as { status?: number; detail?: string; budget?: boolean }
  if (anyErr.budget) {
    return c.json({ detail: "今日 AI 额度已用完，请明天再试（预算守卫）", budget: true }, 429 as const)
  }
  const status = (anyErr.status || 500) as 200 | 400 | 401 | 403 | 404 | 413 | 422 | 429 | 500
  return c.json({ detail: anyErr.detail || err.message || "服务器内部错误" }, status)
})

// 启动（仅当直接运行本文件时）
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() || "")) {
  const cfg = getConfig()
  const host = cfg.server.host
  const port = Number(process.env.PORT || cfg.server.port)
  console.log(`[aiphonix-ts] 启动 ${host}:${port} (model: ${cfg.deepseek.model})`)
  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`[aiphonix-ts] listening on http://${info.address}:${info.port}`)
  })
  // WebSocket 升级（/api/v1/asr/stream）必须挂在底层 http.Server：Hono 不处理 HTTP upgrade
  attachAsrStream(server as unknown as HttpServer)

  // ── 优雅停机：先关 HTTP，再关 SQLite；8 秒兜底强杀（Windows job 托管下 SIGTERM 也可能来）──
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[aiphonix-ts] 收到 ${signal}，优雅关闭中…`)
      const force = setTimeout(() => {
        console.warn("[aiphonix-ts] 关闭超时，强制退出")
        process.exit(1)
      }, 8000)
      force.unref()
      server.close(() => {
        try {
          sqlite.close()
        } catch {
          /* 已关闭 */
        }
        console.log("[aiphonix-ts] 已退出")
        process.exit(0)
      })
    })
  }
}
