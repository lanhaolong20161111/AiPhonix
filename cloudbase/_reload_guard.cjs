#!/usr/bin/env node
/**
 * 验证「SW 自动 reload 不再掐断预热」这条修复（2026-09-20）。
 *
 * 背景（真实冷启动实测）：`main.tsx` 的 30s SW 更新轮询会在页面打开约 30s 时触发
 * `controllerchange` → 原来**无条件 `location.reload()`** → 把已发出 23s 的 `/health`
 * 预热请求连同它的 60s 超时定时器一起销毁 ⇒ 预热白干，冷启动代价被推迟到用户点击那一刻。
 *
 * 本脚本用**真产物 + 真 SW + 真浏览器**做判定：
 *   ① 打开页面、等 SW 首次接管的那次 reload 落定；
 *   ② 聚焦输入框触发预热（本例 /health 挂 6s 后 503、第二次 200）；
 *   ③ 在预热**在飞期间**派发一次 `controllerchange`；
 *   ④ 断言：预热结束前**不得**发生主框架导航；预热结束后**应当**发生一次导航。
 *
 * 旧代码在 ③ 之后 0s 就会导航 —— 所以「导航是否被推迟到预热结束」就是判据。
 *
 * 用法： node cloudbase/_reload_guard.cjs
 */
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")

const ROOT = path.resolve(__dirname, "..")
const DIST = path.join(ROOT, "web", "dist_cb")
const PORT = Number(process.env.PORT || 18045)
const HOLD_MS = Number(process.env.HOLD_MS || 6000) // /health 每次挂多久

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tSrv = Date.now()
const slog = (s) => console.log(`  [srv ${((Date.now() - tSrv) / 1000).toFixed(1)}s] ${s}`)
let healthHits = 0

const server = http.createServer(async (req_, res) => {
  const url = new URL(req_.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname

  if (p === "/health") {
    healthHits += 1
    const n = healthHits
    slog(`<< GET /health #${n}（挂 ${HOLD_MS}ms 后回 ${n === 1 ? 503 : 200}）`)
    await sleep(HOLD_MS)
    if (n === 1) {
      const body = "<html><title>503 Service Temporarily Unavailable</title></html>"
      res.writeHead(503, { "content-type": "text/html", "content-length": Buffer.byteLength(body) })
      return res.end(body)
    }
    res.writeHead(200, { "content-type": "application/json" })
    return res.end('{"ok":true}')
  }
  if (p.startsWith("/api/")) {
    res.writeHead(404, { "content-type": "application/json" })
    return res.end('{"detail":"not found"}')
  }

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
  console.log(`[guard] 静态产物 ${DIST}`)
  console.log(`[guard] ${BASE}/web/   /health 第一次挂 ${HOLD_MS}ms 回 503、第二次 200`)

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : { channel: "chrome" }),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } })
  const page = await ctx.newPage()

  const t0 = Date.now()
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
  let navCount = 0
  const navs = []
  let gateDoneAt = null
  let dispatchedAt = null

  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame()) return
    navCount += 1
    navs.push({ t: Date.now() - t0, url: f.url() })
    console.log(`  [${at()}] ⚠️ 主框架导航 #${navCount} → ${f.url()}`)
  })
  page.on("response", (r) => {
    const u = r.url()
    if (!u.includes("/health") && !u.includes("/api/")) return
    console.log(`  [${at()}] ← ${new URL(u).pathname} = ${r.status()}`)
    if (new URL(u).pathname === "/health" && r.status() === 200) gateDoneAt = Date.now() - t0
  })
  page.on("request", (r) => {
    const u = r.url()
    if (!u.includes("/health") && !u.includes("/api/")) return
    console.log(`  [${at()}] → ${r.method()} ${new URL(u).pathname}`)
  })
  page.on("console", (m) => {
    const t = m.text()
    if (t.includes("[sw]") || t.includes("[api]")) console.log(`  [${at()}] [log] ${t}`)
  })

  console.log(`\n打开 ${BASE}/web/`)
  await page.goto(`${BASE}/web/`, { waitUntil: "domcontentloaded", timeout: 30_000 })

  // ── 等首访 SW 接管的那次 reload 落定 ──
  console.log("等页面落定（首访 SW 接管的 reload 结束）")
  {
    let last = navCount
    const end = Date.now() + 20_000
    while (Date.now() < end) {
      await page.waitForTimeout(1000)
      if (navCount === last) break
      last = navCount
    }
  }
  await page.waitForTimeout(1500)

  const uIn = page.locator('input[placeholder*="用户名"]').first()
  await uIn.waitFor({ state: "visible", timeout: 15_000 })

  const navBefore = navCount
  console.log(`\n聚焦用户名输入框（触发预热，此时 navCount=${navBefore}）`)
  await uIn.click()
  // 预热请求刚发出去就派发 controllerchange（模拟 30s SW 更新轮询那条路径）
  await page.waitForTimeout(600)
  dispatchedAt = Date.now() - t0
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")))
  console.log(`  [${at()}] ⚡ 已派发 controllerchange（脚本内部）`)

  // ── 观察：预热结束前不应有导航 ──
  console.log(`\n观察 ${Math.ceil(HOLD_MS / 1000) + 4}s：预热在飞期间不得导航`)
  const navDuringGate = navCount
  await page.waitForTimeout(HOLD_MS + 2000)
  const navAfterHold = navCount
  const gateDoneByThen = gateDoneAt !== null

  // 预热直到第二次 /health 拿到 200；再给几秒让「静默后 reload」发生
  console.log(`\n等预热彻底结束（第二次 /health = 200）后再观察 4s`)
  const end = Date.now() + 25_000
  while (Date.now() < end && gateDoneAt === null) await page.waitForTimeout(500)
  await page.waitForTimeout(4000)
  const navFinal = navCount

  console.log("\n=== 结果 ===")
  console.log(`  派发 controllerchange 时 navCount = ${navDuringGate}`)
  console.log(`  预热在飞 + 回 503 后 navCount = ${navAfterHold}（gateDone=${gateDoneByThen}）`)
  console.log(`  预热结束并静默后 navCount = ${navFinal}`)
  console.log(`  /health 命中 ${healthHits} 次，gateDoneAt = ${gateDoneAt ?? "未拿到 200"}`)

  const okHold = navAfterHold === navDuringGate
  const okFinal = navFinal > navAfterHold
  console.log("\n=== 判定 ===")
  console.log(`  ${okHold ? "✓" : "✗"} 预热在飞期间**没有**被 reload 掐断（navCount 未变）`)
  console.log(`  ${okFinal ? "✓" : "✗"} 预热结束、网络静默后**发生了** reload（新 bundle 仍能生效）`)

  await browser.close()
  server.close()
  const pass = okHold && okFinal
  console.log(pass ? "\n结论：reload 已被「网络静默」正确推迟 ✓" : "\n结论：修复未生效 ✗")
  process.exit(pass ? 0 : 2)
})().catch((e) => {
  console.error("异常：", e)
  server.close()
  process.exit(1)
})
