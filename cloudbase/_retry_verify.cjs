#!/usr/bin/env node
/**
 * 冷启动「自动重试」端到端验证（Playwright + 真实浏览器）—— v3
 *
 * 迭代史（都是踩出来的）：
 *  - v1：只监听 `response`/`requestfailed`，**不监听 `request` 开始** ⇒ 请求发出后挂在网关
 *        （既无响应也未失败）时零输出，表现为「打完『第 1/4 次重试将在 800ms 后进行』就没下文」，
 *        无法区分「重试没生效」与「请求在飞」。
 *  - v2：补 request 日志 + 在飞请求心跳 + 分阶段计时。本地复现时又暴露两个 harness 问题：
 *        ① **首访会 reload 一次**（Service Worker 首次接管触发 `controllerchange` → 应用 reload），
 *           会把在飞的 `/health` 掐掉、把表单已填的值清空；
 *        ② 因此点「登录」时按钮仍 `disabled={busy || !username.trim() || !password}`，click 超时。
 *  - v3（本版）：等页面稳定 + 记录主框架导航 + 点击前**重填两栏并等按钮可用**。
 *
 * 验证目标（`MinNum=0` 能否交付的核心）：
 *   ① 登录页聚焦 → `GET /health` 预热把实例拉起（记录**闸门耗时**）
 *   ② 冷启动的 503 是否被 `lib/apiRetry.ts` 的退避重试吞掉
 *   ③ 登录最终拿到**非 503** 的真实响应（凭据错 → 401 也算），并给出**点击→响应**的墙钟时间
 *
 * 用法：CB_BASE="https://<网关域名>" WAIT_MIN=38 node cloudbase/_retry_verify.cjs
 * 可选：GATE_MAX_MS POST_MAX_MS HEARTBEAT_MS CLICK_BUDGET_MS SETTLE_MS
 *
 * 判据：出现 503 + /health 最终 200 + 登录 POST 重发 ≥2 次 + 登录最终非 503 + 点击→响应 < 预算。
 * 退出码：0 通过 / 2 未确认 / 1 异常。
 *
 * ⚠️ 静置期**零业务请求**（只有 sleep），否则 30 分钟缩容窗口会被重置、实验作废。
 *    控制面调用（MCP / tcb CLI）不算业务流量。
 */
const path = require("node:path")
const { createRequire } = require("node:module")

const ROOT = path.resolve(__dirname, "..")
// playwright 装在 web/ 下（web 才是 e2e 的常驻宿主），跨目录解析
const req = createRequire(path.join(ROOT, "web", "package.json"))
const { chromium } = req("playwright")

const BASE = (process.env.CB_BASE || "").replace(/\/+$/, "")
const WAIT_MIN = Number(process.env.WAIT_MIN || 0)
const USER = process.env.TEST_USER || "cbtest01"
const PASS = process.env.TEST_PASS || "Test123456"
const GATE_MAX_MS = Number(process.env.GATE_MAX_MS || 200_000)
const POST_MAX_MS = Number(process.env.POST_MAX_MS || 180_000)
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 10_000)
const CLICK_BUDGET_MS = Number(process.env.CLICK_BUDGET_MS || 150_000)
/** 首访等 SW 接管导致的 reload 落定，再开始交互 */
const SETTLE_MS = Number(process.env.SETTLE_MS || 3500)

if (!BASE) {
  console.error("缺少 CB_BASE，例如：CB_BASE=https://xxx.ap-shanghai.app.tcloudbase.com")
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const RISK_TEXTS = ["页面访问提示", "确定访问", "测试域名"]
const isRiskPage = (t, b) => t.includes("风险提醒") || RISK_TEXTS.filter((x) => b.includes(x)).length >= 2
const isApi = (u) => u.includes("/api/") || u.endsWith("/health")
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

;(async () => {
  if (WAIT_MIN > 0) {
    console.log(`[静置] ${WAIT_MIN} 分钟，期间零业务请求，等平台把实例缩到 0 …`)
    for (let i = WAIT_MIN; i > 0; i--) {
      await sleep(60_000)
      if (i % 5 === 1 || i <= 2) console.log(`[静置] 剩余约 ${i - 1} 分钟`)
    }
    console.log("[静置] 完成")
  }

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : { channel: "chrome" }),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()

  let t0 = Date.now()
  const at = () => ((Date.now() - t0) / 1000).toFixed(1) + "s"
  const log = (s) => console.log(`  [${at()}] ${s}`)

  /** 完整事件序列（顺序即真相） */
  const seq = []
  /** 在飞请求：request 对象 → 记录（心跳时暴露「挂住」的请求）—— v1 的盲区就在这 */
  const inFlight = new Map()
  let navCount = 0

  page.on("request", (r) => {
    const u = r.url()
    if (!isApi(u)) return
    const fromSw = r.serviceWorker() ? "sw" : "page"
    const rec = { startedAt: Date.now(), method: r.method(), path: new URL(u).pathname, done: false }
    inFlight.set(r, rec)
    seq.push({ dir: "→", ...rec, type: r.resourceType(), fromSw, t: Date.now() - t0 })
    log(`→ ${r.method()} ${rec.path} 发出（${r.resourceType()}/${fromSw}）`)
  })
  page.on("response", (r) => {
    const u = r.url()
    if (!isApi(u)) return
    const p = new URL(u).pathname
    const rec = inFlight.get(r.request())
    if (rec) rec.done = true
    // 上游标识（网关自己加的）：判断请求是否真的落到容器
    let up = ""
    try {
      const h = r.headers()
      const type = h["x-cloudbase-upstream-type"] || ""
      const cost = h["x-cloudbase-upstream-timecost"] || ""
      if (type || cost) up = ` [upstream=${type} ${cost}ms]`
    } catch {}
    const row = {
      dir: "←",
      status: r.status(),
      path: p,
      method: r.request().method(),
      ms: rec ? Date.now() - rec.startedAt : 0,
      t: Date.now() - t0,
    }
    seq.push(row)
    console.log(`  → ${row.method} ${p} = ${r.status()} @ ${fmt(row.ms)}${up}`)
  })
  page.on("requestfailed", (r) => {
    const u = r.url()
    if (!isApi(u)) return
    const rec = inFlight.get(r)
    if (rec) rec.done = true
    const ms = rec ? Date.now() - rec.startedAt : 0
    seq.push({ dir: "✗", path: new URL(u).pathname, method: r.method(), err: r.failure()?.errorText || "?", ms, t: Date.now() - t0 })
    console.log(`  → ${r.method()} ${new URL(u).pathname} ✗ FAILED @ ${fmt(ms)} (${r.failure()?.errorText || "?"})`)
  })
  page.on("console", (m) => {
    const t = m.text()
    if (t.includes("[api]") || t.includes("[auth]")) log(`[log] ${t}`)
  })
  page.on("pageerror", (e) => log(`[pageerror] ${e.message}`))
  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame()) return
    navCount++
    log(`⚠️ 主框架导航 #${navCount} → ${f.url()}（首访 SW 接管会触发一次 reload：会掐掉在飞请求并清空表单）`)
  })

  /** 心跳：把还在飞（既无响应也未失败）的请求报出来 */
  let hbTimer = null
  const stopHeartbeat = () => {
    if (hbTimer) clearInterval(hbTimer)
    hbTimer = null
  }
  const startHeartbeat = (label) => {
    stopHeartbeat()
    hbTimer = setInterval(() => {
      const pend = [...inFlight.values()].filter((r) => !r.done)
      if (!pend.length) return
      const desc = pend.map((r) => `${r.method} ${r.path} 已等 ${fmt(Date.now() - r.startedAt)}`).join("；")
      console.log(`  [${at()}] ⏳ ${label}：${pend.length} 个请求仍无响应 —— ${desc}`)
    }, HEARTBEAT_MS)
  }

  // ───── 打开页面并等稳定 ─────
  t0 = Date.now()
  console.log(`打开 ${BASE}/web/`)
  await page.goto(`${BASE}/web/`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => console.log("goto: " + e.message))

  if (isRiskPage(await page.title(), await page.content())) {
    console.log("  命中「风险提醒」中间页（平台行为，非应用故障）→ 点「确定访问」")
    const btn = page.locator("text=确定访问").first()
    if (await btn.count()) {
      await btn.click().catch(() => {})
      await page.waitForLoadState("domcontentloaded").catch(() => {})
      await sleep(2500)
    }
  }
  console.log(`  等页面落定 ${fmt(SETTLE_MS)}（避开首访 SW 接管的 reload）`)
  await sleep(SETTLE_MS)

  /** 填两栏并等按钮可用 —— 每次点击前都调用，天然免疫中途 reload */
  const fillAndReady = async () => {
    const u = page.locator('input[placeholder*="用户名"]').first()
    const p = page.locator('input[placeholder*="密码"]').first()
    await u.waitFor({ state: "visible", timeout: 20_000 })
    if (!(await u.inputValue().catch(() => ""))) {
      await u.click().catch(() => {})
      await u.fill(USER)
    }
    if (!(await p.inputValue().catch(() => ""))) {
      await p.click().catch(() => {})
      await p.fill(PASS)
    }
    const btn = page.locator("button.auth-submit").first()
    try {
      await btn.waitFor({ state: "attached", timeout: 10_000 })
      await page.waitForFunction(
        () => {
          const b = document.querySelector("button.auth-submit")
          return !!b && !b.disabled
        },
        undefined,
        { timeout: 20_000 },
      )
      return { btn, ready: true }
    } catch {
      const uv = await u.inputValue().catch(() => "?")
      const pv = await p.inputValue().catch(() => "?")
      console.log(`  ✗ 按钮仍不可用（用户名="${uv}" 密码长度=${String(pv).length}）`)
      return { btn, ready: false }
    }
  }

  const uIn = page.locator('input[placeholder*="用户名"]').first()
  if (!(await uIn.count())) {
    const txt = (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").slice(0, 160)
    console.log(`  ✗ 没等到登录表单，页面文本：${txt}`)
    await browser.close()
    process.exit(1)
  }

  // ───── 阶段 A：预热闸门（聚焦输入框 → onFocusCapture → GET /health）─────
  console.log("\n=== 阶段 A：聚焦输入框，触发预热闸门 ===")
  const focusAt = Date.now()
  startHeartbeat("闸门")
  await uIn.click().catch(() => {})
  await uIn.fill(USER)

  let gateMs = null
  {
    const end = focusAt + GATE_MAX_MS
    while (Date.now() < end) {
      await sleep(1000)
      if (seq.some((r) => r.dir === "←" && r.path === "/health" && r.status === 200)) {
        gateMs = Date.now() - focusAt
        break
      }
    }
    stopHeartbeat()
  }
  console.log(gateMs !== null ? `  闸门耗时（聚焦→/health 200）：${fmt(gateMs)}` : `  闸门在 ${fmt(GATE_MAX_MS)} 内未拿到 200`)

  // ───── 阶段 B：点登录 ─────
  console.log("\n=== 阶段 B：点「登录」 ===")
  const { btn, ready } = await fillAndReady()
  let clickMs = null
  let finalPost = null
  if (ready) {
    const clickAt = Date.now()
    startHeartbeat("登录")
    await btn.click({ timeout: 15_000 }).catch((e) => console.log("  click: " + e.message))
    const end = clickAt + POST_MAX_MS
    while (Date.now() < end) {
      await sleep(1000)
      const hit = seq.find(
        (r) => r.dir === "←" && r.method === "POST" && r.path.includes("/auth/login") && typeof r.status === "number" && r.status !== 503,
      )
      if (hit) {
        clickMs = Date.now() - clickAt
        finalPost = hit.status
        break
      }
    }
    stopHeartbeat()
  } else {
    console.log("  跳过点击（表单未就绪）")
  }

  // 收尾：页面上用户实际看到的错误文案
  const errText = (await page.locator(".auth-error, .err, [class*=error]").first().innerText().catch(() => "")) || ""

  console.log("\n=== 请求时序 ===")
  seq.forEach((r, i) => {
    const h = (r.t / 1000).toFixed(1) + "s"
    if (r.dir === "→") console.log(`  ${i + 1}. ${h}  → ${r.method} ${r.path}`)
    else if (r.dir === "←") console.log(`  ${i + 1}. ${h}  ← ${r.method} ${r.path} = ${r.status} (${fmt(r.ms)})`)
    else console.log(`  ${i + 1}. ${h}  ✗ ${r.method} ${r.path} FAILED (${fmt(r.ms)}) ${r.err}`)
  })

  const got503 = seq.some((r) => r.status === 503)
  const health200 = seq.some((r) => r.dir === "←" && r.path === "/health" && r.status === 200)
  const healthTries = seq.filter((r) => r.dir === "→" && r.path === "/health").length
  const postTries = seq.filter((r) => r.dir === "→" && r.method === "POST").length
  const maxHang = Math.max(0, ...seq.filter((r) => r.dir !== "→").map((r) => r.ms || 0))
  const clickOk = clickMs !== null && clickMs < CLICK_BUDGET_MS

  console.log("\n=== 判定 ===")
  console.log(`  ${got503 ? "✓" : "•"} 出现 503（冷启动证据）：${got503}`)
  console.log(`  ${health200 ? "✓" : "✗"} 预热 /health 最终 200（=实例被拉起）：${health200}（共 ${healthTries} 次尝试）`)
  console.log(`  ${gateMs !== null ? "✓" : "✗"} 闸门耗时：${gateMs !== null ? fmt(gateMs) : "未完成"}`)
  console.log(`  ${postTries >= 2 ? "✓" : "✗"} 登录 POST 被重发：${postTries} 次`)
  console.log(`  ${finalPost !== null && finalPost !== 503 ? "✓" : "✗"} 登录最终非 503：${finalPost ?? "无"}`)
  console.log(`  ${clickOk ? "✓" : "✗"} 点击→响应 ${clickMs !== null ? fmt(clickMs) : "超时"}（预算 ${fmt(CLICK_BUDGET_MS)}）`)
  console.log(`  • 单次请求最长耗时：${fmt(maxHang)}`)
  console.log(`  • 主框架导航次数：${navCount}`)
  if (errText) console.log(`  • 用户看到的错误文案：「${errText.replace(/\s+/g, " ").slice(0, 120)}」`)

  await page.screenshot({ path: path.join(__dirname, "_retry_verify.png") }).catch(() => {})
  await browser.close()

  const pass = got503 && health200 && postTries >= 2 && finalPost !== null && finalPost !== 503 && clickOk
  console.log(pass ? "\n结论：冷启动被自动重试吞掉，登录可用 ✓" : "\n结论：未能确认（看上面的时序与心跳定位卡在哪）")
  process.exit(pass ? 0 : 2)
})().catch((e) => {
  console.error("验证异常：", e)
  process.exit(1)
})
