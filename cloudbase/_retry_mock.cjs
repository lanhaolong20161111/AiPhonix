#!/usr/bin/env node
/**
 * 冷启动重试的**本地复现**（不依赖平台、不用等 38 分钟）。
 *
 * 为什么需要它：`_retry_verify.cjs` 在真实冷启动下观察到「第 1/4 次重试将在 800ms 后进行」之后
 * 就再无任何请求 —— 这是「重试循环本身有问题」还是「平台侧请求被挂住」无法区分。
 * 本脚本用**同一份已部署产物**（`web/dist_cb`）+ 假 503 把上游不确定性摘掉：
 *
 *   GET  /health            → 前 HEALTH_503 次返回 503（每次挂 DELAY_MS），之后 200
 *   POST /api/v1/auth/login → 前 LOGIN_503 次返回 503，之后 401（凭据错，但已是真实响应）
 *   其余 /api/v1/*          → 404
 *
 * 判据（与真实探测一致）：预热 /health 重发 ≥2 次、登录 POST 重发 ≥2 次、最终非 503。
 *
 * 用法： node cloudbase/_retry_mock.cjs
 */
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")

const ROOT = path.resolve(__dirname, "..")
const DIST = path.join(ROOT, "web", "dist_cb")
const PORT = Number(process.env.PORT || 18041)
const HEALTH_503 = Number(process.env.HEALTH_503 || 2)
const LOGIN_503 = Number(process.env.LOGIN_503 || 1)
const DELAY_MS = Number(process.env.DELAY_MS || 1200)
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 40_000)

const req = createRequire(path.join(ROOT, "web", "package.json"))
const { chromium } = req("playwright")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
}

const hits = {}
const bump = (k) => (hits[k] = (hits[k] || 0) + 1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tSrv = Date.now()
const slog = (s) => console.log(`  [mock ${((Date.now() - tSrv) / 1000).toFixed(1)}s] ${s}`)

const server = http.createServer(async (req_, res) => {
  const url = new URL(req_.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname
  if (p === "/health" || p.startsWith("/api/")) {
    slog(`<< ${req_.method} ${p} (HTTP/${req_.httpVersion}, conn=${req_.headers.connection || "-"})`)
  }

  // 服务端侧地面真相：客户端是拿到响应了，还是中途断了
  res.on("close", () => {
    if (!res.writableFinished) slog(`!! ${req_.method} ${p} 客户端提前断开（未回完响应）`)
  })
  req_.on("aborted", () => slog(`!! ${req_.method} ${p} 被客户端 abort`))

  // ---- 假上游 ----
  if (p === "/health") {
    const n = bump("/health")
    slog(`收到 #${n} GET /health（挂 ${DELAY_MS}ms）`)
    await sleep(DELAY_MS)
    if (n <= HEALTH_503) {
      const body = "<html><title>503 Service Temporarily Unavailable</title></html>"
      slog(`回 #${n} /health = 503`)
      res.writeHead(503, { "content-type": "text/html", "content-length": Buffer.byteLength(body) })
      return res.end(body)
    }
    slog(`回 #${n} /health = 200`)
    res.writeHead(200, { "content-type": "application/json" })
    return res.end('{"ok":true}')
  }
  if (p === "/api/v1/auth/login") {
    const n = bump("/api/v1/auth/login")
    await sleep(DELAY_MS)
    if (n <= LOGIN_503) {
      res.writeHead(503, { "content-type": "text/html" })
      return res.end("<html><title>503 Service Temporarily Unavailable</title></html>")
    }
    res.writeHead(401, { "content-type": "application/json" })
    return res.end('{"detail":"用户名或密码错误"}')
  }
  if (p.startsWith("/api/")) {
    bump("/api/*")
    res.writeHead(404, { "content-type": "application/json" })
    return res.end('{"detail":"not found"}')
  }

  // ---- 静态产物（/web/* 映射到 dist_cb/*）----
  let rel = p.replace(/^\/web\/?/, "")
  if (rel === "") rel = "index.html"
  const file = path.join(DIST, rel)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" })
    return res.end("static 404 " + rel)
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" })
  return res.end(fs.readFileSync(file))
})

;(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r))
  const BASE = `http://127.0.0.1:${PORT}`
  console.log(`[mock] ${BASE}/web/  health 前 ${HEALTH_503} 次 503、login 前 ${LOGIN_503} 次 503、每次挂 ${DELAY_MS}ms`)

  // SERVE_ONLY：只起假上游，交给外部探测脚本（如 _retry_verify.cjs）去打
  if (process.env.SERVE_ONLY) {
    console.log("[mock] SERVE_ONLY 模式：等待外部探测，Ctrl-C 结束")
    return
  }

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : { channel: "chrome" }),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } })
  const page = await ctx.newPage()

  const t0 = Date.now()
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
  const seq = []
  const isApi = (u) => u.includes("/api/") || u.includes("/health")

  page.on("request", (r) => {
    if (isApi(r.url())) seq.push({ t: at(), dir: "→", method: r.method(), path: new URL(r.url()).pathname })
  })
  page.on("response", (r) => {
    if (isApi(r.url())) seq.push({ t: at(), dir: "←", status: r.status(), path: new URL(r.url()).pathname })
  })
  page.on("requestfailed", (r) => {
    if (isApi(r.url()))
      seq.push({ t: at(), dir: "✗", err: r.failure()?.errorText || "?", path: new URL(r.url()).pathname })
  })
  page.on("console", (m) => {
    const t = m.text()
    if (t.includes("[api]") || t.includes("[auth]")) console.log(`  [${at()}] ${t}`)
  })
  page.on("pageerror", (e) => console.log(`  [${at()}] [pageerror] ${e.message}`))

  console.log(`打开 ${BASE}/web/`)
  await page.goto(`${BASE}/web/`, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await page.waitForTimeout(2000)

  const uIn = page.locator('input[placeholder*="用户名"]').first()
  await uIn.waitFor({ state: "visible", timeout: 15_000 })
  console.log(`聚焦用户名输入框（触发预热）`)
  await uIn.click()
  await page.waitForTimeout(800)
  await uIn.fill("cbtest01")
  await page.locator('input[placeholder*="密码"]').first().fill("Test123456")
  console.log(`点「登录」`)
  await page.locator("button.auth-submit").first().click()

  // 观察窗口：只要还没拿到「非 503 的 POST 响应」就继续等
  const end = Date.now() + OBSERVE_MS
  while (Date.now() < end) {
    await page.waitForTimeout(1000)
    const done = seq.some((r) => r.dir === "←" && r.status && r.status !== 503 && r.path.includes("/auth/login"))
    if (done) break
  }
  await page.waitForTimeout(1500)

  console.log("\n=== 请求时序 ===")
  seq.forEach((r) => console.log(`  ${r.t.padStart(7)}  ${r.dir} ${r.method || ""} ${r.path}${r.status ? ` → ${r.status}` : ""}${r.err ? ` ✗ ${r.err}` : ""}`))

  const hReq = seq.filter((r) => r.dir === "→" && r.path === "/health").length
  const pReq = seq.filter((r) => r.dir === "→" && r.path.includes("/auth/login")).length
  const pOk = seq.some((r) => r.dir === "←" && r.path.includes("/auth/login") && r.status && r.status !== 503)
  const hOk = seq.some((r) => r.dir === "←" && r.path === "/health" && r.status === 200)

  console.log("\n=== 判定 ===")
  console.log(`  ${hReq >= 2 ? "✓" : "✗"} 预热 /health 被重发：${hReq} 次（阈值 ≥2）`)
  console.log(`  ${pReq >= 2 ? "✓" : "✗"} 登录 POST 被重发：${pReq} 次（阈值 ≥2）`)
  console.log(`  ${hOk ? "✓" : "✗"} /health 最终 200`)
  console.log(`  ${pOk ? "✓" : "✗"} 登录最终拿到非 503 响应`)
  console.log(`  [mock 计数] ${JSON.stringify(hits)}`)

  await browser.close()
  server.close()
  const pass = hReq >= 2 && pReq >= 2 && pOk
  console.log(pass ? "\n结论：重试闭环成立（本地复现通过）✓" : "\n结论：重试闭环有问题 ✗")
  process.exit(pass ? 0 : 2)
})().catch((e) => {
  console.error("异常：", e)
  server.close()
  process.exit(1)
})
