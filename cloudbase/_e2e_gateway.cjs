#!/usr/bin/env node
/**
 * 浏览器端端到端验证 —— 确认「网关分流」之后应用能真正跑起来，
 * 并核对每条子请求实际由哪个上游应答。
 *
 * 与 `_gateway_check.cjs` 的分工：后者是请求级（curl/fetch + md5），
 * 本脚本是浏览器级（真实 Chrome：SW、模块加载、CSP、渲染）。
 *
 * 用法：
 *   node cloudbase/_e2e_gateway.cjs
 *   CB_BASE=<网关域名> node cloudbase/_e2e_gateway.cjs
 *
 * 需要 playwright（装在 web/node_modules）：
 *   NODE_PATH=.../web/node_modules node cloudbase/_e2e_gateway.cjs
 *
 * ⚠️ 体验版环境每个域名首访都有「风险提醒」中间页（404 + 标题「风险提醒」），
 *    本脚本会自动点「确定访问」，别把这个 404 当成路由故障。
 */
const path = require("path")
const { chromium } = require("playwright")

const CB_BASE = process.env.CB_BASE || "https://cloudbase-test-d8gna6iyy14e2ba39-1444240037.ap-shanghai.app.tcloudbase.com"
const ROOT = path.resolve(__dirname, "..")

const ok = (m) => console.log(`✓ ${m}`)
const bad = (m) => { console.log(`✗ ${m}`); failures.push(m) }
const note = (m) => console.log(`  · ${m}`)
const failures = []

;(async () => {
  console.log("=".repeat(80))
  console.log(`浏览器端 E2E — ${CB_BASE}`)
  console.log("=".repeat(80))

  const browser = await chromium.launch({ channel: "chrome" })
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  })
  const page = await ctx.newPage()

  const jsErrors = []
  const upstreams = new Map() // pathname -> {up, status, ct}
  const httpErrors = []
  page.on("pageerror", (e) => jsErrors.push(String(e)))
  page.on("response", (res) => {
    const u = new URL(res.url())
    if (u.origin !== new URL(CB_BASE).origin) return
    upstreams.set(u.pathname, {
      up: res.headers()["x-cloudbase-upstream-type"] || "-",
      status: res.status(),
      ct: (res.headers()["content-type"] || "").split(";")[0],
    })
    if (res.status() >= 400) httpErrors.push(`${res.status()} ${u.pathname}`)
  })

  // ── 打开首页（处理风险提醒中间页）──
  await page.goto(CB_BASE + "/web/", { waitUntil: "domcontentloaded", timeout: 90000 }).catch((e) => note(`goto: ${e.message}`))
  {
    const t = await page.title().catch(() => "")
    const c = await page.content().catch(() => "")
    if (/风险提醒|页面访问提示/.test(t + c)) {
      note("命中「风险提醒」中间页（平台行为）→ 点「确定访问」")
      await page.locator("text=确定访问").first().click().catch(() => {})
      await page.waitForLoadState("domcontentloaded").catch(() => {})
      await page.waitForTimeout(3000)
    }
  }
  await page.waitForTimeout(4000)

  const title = await page.title()
  const url = page.url()
  const rootHtml = await page.locator("#root").innerHTML().catch(() => "")
  const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim()

  title === "AiPhonix" ? ok(`标题 = AiPhonix`) : bad(`标题异常：${title}`)
  note(`最终 URL = ${url}`)
  rootHtml.length > 50 ? ok(`#root 已挂载（${rootHtml.length} 字节）`) : bad(`#root 内容过少（${rootHtml.length}）`)
  ;/登录|开始学习|AiPhonix/.test(bodyText) ? ok(`页面文案正常：${bodyText.slice(0, 70)}`) : bad(`页面文案异常：${bodyText.slice(0, 70)}`)
  jsErrors.length === 0 ? ok("无 JS 运行时报错") : bad(`JS 报错 ${jsErrors.length} 条：${jsErrors.slice(0, 3).join(" | ")}`)

  // ── 子请求的上游归属 ──
  console.log("\n── 子请求上游归属 ──")
  const rows = [...upstreams.entries()].filter(([p]) => !p.endsWith("/web/"))
  const cos = rows.filter(([, v]) => v.up === "Tencent-COS")
  const cbr = rows.filter(([, v]) => v.up === "Tencent-CloudBaseRun")
  for (const [p, v] of rows.slice(0, 25)) {
    console.log(`    ${String(v.status).padEnd(4)} ${(v.up || "-").padEnd(22)} ${p.slice(0, 60)}`)
  }
  if (rows.length > 25) note(`（另有 ${rows.length - 25} 条同类请求未列出）`)

  cos.length > 0 ? ok(`静态资源由 CDN 应答：${cos.length} 条`) : bad("没有子请求落到 CDN（分流可能没生效）")
  note(`容器应答：${cbr.length} 条 ${cbr.length ? "（" + cbr.map(([p]) => p).slice(0, 4).join(", ") + "）" : ""}`)

  // 关键静态资源必须走 CDN
  for (const p of [...upstreams.keys()].filter((p) => /^\/web\/assets\/.*\.(js|css)$/.test(p)).slice(0, 3)) {
    const v = upstreams.get(p)
    v.up === "Tencent-COS" ? ok(`资源走 CDN：${p.slice(0, 50)}`) : bad(`资源未走 CDN：${p} → ${v.up}`)
  }

  // 404/5xx 清理（排除中间页造成的）
  const realErrors = httpErrors.filter((e) => !/^404 \/(web\/)?$/.test(e))
  realErrors.length === 0 ? ok("无 4xx/5xx 子请求") : bad(`子请求错误：${realErrors.slice(0, 5).join(" | ")}`)

  // ── 深链刷新（SPA 回退在真实浏览器里的行为）──
  console.log("\n── SPA 深链刷新 ──")
  await page.goto(CB_BASE + "/web/login", { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const deepHtml = await page.locator("#root").innerHTML().catch(() => "")
  deepHtml.length > 50 ? ok(`/web/login 深链直访可渲染（${deepHtml.length} 字节）`) : bad("/web/login 深链直访未渲染")

  await browser.close()

  console.log("\n" + "=".repeat(80))
  failures.length ? (console.log(`结论：${failures.length} 项失败`), process.exit(2)) : console.log("结论：全部通过")
  console.log("=".repeat(80))
})().catch((e) => {
  console.error("E2E 异常：", e)
  process.exit(1)
})
