#!/usr/bin/env node
/**
 * 云托管交付入口的**浏览器可用性探测**（Playwright + 系统 Chrome）。
 *
 * 为什么需要它：`curl` 只能证明字节对，不能证明页面真的能用。而 CloudBase 域名有两种
 * 「看起来像坏了」的正常现象，必须分清楚，否则会把平台行为当成应用故障：
 *   ① **测试域名** `*.sh.run.tcloudbase.com` 首次访问是「风险提醒」中间页
 *      （状态码 404 + 标题「风险提醒」+ 正文含「页面访问提示 / 确定访问 / 测试域名」），
 *      点掉「确定访问」后才是真页面。**这不是应用 404**。
 *   ② **网关域名** `*.<region>.app.tcloudbase.com`（配了 `/` → CBR 路由后）没有该中间页，
 *      更适合当作交付/验收入口（见 .workbuddy/memory/2026-09-20.md）。
 *
 * 用法：
 *   CB_BASE="https://<域名>" node cloudbase/_browser_probe.cjs [截图.png]
 *   CB_BASE=... PW_CHROME=/path/to/chrome node cloudbase/_browser_probe.cjs   # 指定浏览器
 *
 * 判据：title 含 AiPhonix、#root 有子节点、body 有「AiPhonix」文案、无静态资源 4xx/5xx。
 * 退出码：0 通过 / 2 失败。
 */
const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")

const HERE = __dirname
const ROOT = path.resolve(HERE, "..")
// playwright 装在 web/ 下（web 才是 e2e 的常驻宿主），这里跨目录解析
const req = createRequire(path.join(ROOT, "web", "package.json"))
const { chromium } = req("playwright")

const BASE = (process.env.CB_BASE || "").replace(/\/+$/, "")
const SHOT = process.argv[2] || path.join(HERE, "_browser_probe.png")
if (!BASE) {
  console.error("缺少 CB_BASE，例如：CB_BASE=https://xxx.sh.run.tcloudbase.com")
  process.exit(1)
}

const fail = []
const ok = (s) => console.log("  ✓ " + s)
const bad = (s) => {
  console.log("  ✗ " + s)
  fail.push(s)
}
const note = (s) => console.log("  • " + s)

/** 风险提醒页的指纹（CloudBase 测试域名专属，出现时点「确定访问」继续） */
const RISK_TEXTS = ["页面访问提示", "确定访问", "测试域名"]
const isRiskPage = (title, body) =>
  title.includes("风险提醒") || (RISK_TEXTS.filter((t) => body.includes(t)).length >= 2)

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : { channel: "chrome" }),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()

  const badResponses = []
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  page.on("response", (r) => {
    const u = r.url()
    if (u.startsWith(BASE) && r.status() >= 400) badResponses.push(`${r.status()} ${u.replace(BASE, "")}`)
  })

  console.log(`探测 ${BASE}/web/`)

  let resp = await page.goto(`${BASE}/web/`, { waitUntil: "domcontentloaded", timeout: 45000 })
  note(`HTTP ${resp ? resp.status() : "?"} → ${page.url()}`)

  // ① 风险提醒中间页（平台行为）
  if (isRiskPage(await page.title(), await page.content())) {
    note("命中「风险提醒」中间页（CloudBase 测试环境的平台行为，非应用故障）→ 点「确定访问」")
    const btn = page.locator('text=确定访问').first()
    if (await btn.count()) {
      await btn.click().catch(() => {})
      await page.waitForLoadState("domcontentloaded").catch(() => {})
      await page.waitForTimeout(2500)
      note(`点掉后 → ${page.url()}`)
      // 中间页自身就以 404 返回主文档，别把它记成「应用资源失败」
      badResponses.length = 0
    } else {
      bad("风险提醒页里找不到「确定访问」按钮")
    }
  } else {
    ok("无「风险提醒」中间页")
  }

  // ② 应用就绪
  await page.waitForFunction(() => {
    const r = document.querySelector("#root")
    return !!r && r.childElementCount > 0
  }, { timeout: 30000 }).catch(() => {})

  const title = await page.title()
  const rootKids = await page.evaluate(() => document.querySelector("#root")?.childElementCount ?? 0)
  const bodyText = (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").slice(0, 200)

  title.includes("AiPhonix") ? ok(`title = ${title}`) : bad(`title 不含 AiPhonix：${title}`)
  rootKids > 0 ? ok(`#root 已渲染（${rootKids} 个子节点）`) : bad("#root 为空（前端没挂载）")
  bodyText.includes("AiPhonix") ? ok(`body 文案 = ${bodyText.slice(0, 80)}`) : bad(`body 无 AiPhonix 文案：${bodyText.slice(0, 80)}`)

  // ③ 静态资源与运行时错误
  if (badResponses.length) bad(`静态资源/接口 4xx-5xx：${badResponses.slice(0, 6).join(" | ")}`)
  else ok("无 4xx/5xx 子请求")
  if (pageErrors.length) bad(`页面 JS 报错：${pageErrors.slice(0, 3).join(" | ")}`)
  else ok("无页面 JS 报错")

  await page.screenshot({ path: SHOT, fullPage: false })
  note(`截图 → ${SHOT}`)

  await browser.close()
  console.log(fail.length ? `结论：失败 ${fail.length} 项` : "结论：全部通过")
  process.exit(fail.length ? 2 : 0)
})().catch((e) => {
  console.error("探测异常：", e)
  process.exit(1)
})
