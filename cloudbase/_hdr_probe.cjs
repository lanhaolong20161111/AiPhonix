#!/usr/bin/env node
/**
 * 真实浏览器响应头探测 —— 判定 CloudBase「no-store + content-disposition: attachment」注入
 * 到底是不是浏览器实际收到的（curl 结果可疑：直连 + 真实 Chrome UA 也被注入，
 * 但 Playwright 却能正常渲染页面，两者矛盾，必须以浏览器为准）。
 *
 * 用法：
 *   node cloudbase/_hdr_probe.cjs                       # 默认测云托管域名 + 生产 CF 对照
 *   CB_BASE=<url> node cloudbase/_hdr_probe.cjs
 *   SKIP_CF=1 node cloudbase/_hdr_probe.cjs             # 只测云托管
 *
 * 关键点：
 *  -「风险提醒」中间页是环境级平台行为 → 先点「确定访问」再采集真实文档的响应头
 *  - 入口 JS 的 URL 从页面 HTML 里解析，避免硬编码 hash
 *  - 生产 CF 必须经代理 127.0.0.1:7897（直连不通）
 */
const { chromium } = require("playwright")

const CB_BASE = process.env.CB_BASE || "https://aiphonix-api-316746-6-1444240037.sh.run.tcloudbase.com"
const CF_BASE = "https://aiphonix-api.xinyi7lan.workers.dev"
const PROXY = "http://127.0.0.1:7897"
const SKIP_CF = process.env.SKIP_CF === "1"

const HDRS = ["cache-control", "content-type", "content-disposition", "expires", "pragma", "etag", "last-modified", "content-encoding", "age", "x-cache"]

function show(label, headers) {
  console.log(`  ${label}`)
  for (const h of HDRS) {
    const v = headers[h]
    if (v !== undefined) console.log(`    ${h.padEnd(20)}= ${v}`)
  }
}

/** 采集：主文档 + 一个静态资源（js/css/mp3 各取一样） */
async function collect(page, base, { clickRisk }) {
  const docHeaders = []
  const resLog = new Map()

  page.on("response", (res) => {
    const u = new URL(res.url())
    if (u.origin !== new URL(base).origin) return
    resLog.set(u.pathname, { status: res.status(), headers: res.headers() })
  })

  await page.goto(base + "/web/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})

  // 风险提醒中间页（仅体验版环境）
  if (clickRisk) {
    const t = await page.title().catch(() => "")
    const c = await page.content().catch(() => "")
    if (/风险提醒|页面访问提示/.test(t + c)) {
      console.log("  · 命中「风险提醒」中间页 → 点「确定访问」")
      await page.locator("text=确定访问").first().click().catch(() => {})
      await page.waitForTimeout(2500)
    }
  }
  await page.waitForTimeout(2500)

  const doc = []
  for (const [p, r] of resLog) {
    if (p === "/web/" || p === "/web/index.html") doc.push({ p, ...r })
  }
  return { doc, resLog, title: await page.title().catch(() => ""), url: page.url() }
}

async function run(name, base, useProxy) {
  console.log(`\n${"=".repeat(78)}\n### ${name} — ${base}\n${"=".repeat(78)}`)
  const browser = await chromium.launch({
    channel: "chrome",
    ...(useProxy ? { proxy: { server: PROXY } } : {}),
  })
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  })
  const page = await ctx.newPage()
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e)))

  const { doc, resLog, title, url } = await collect(page, base, { clickRisk: !useProxy })

  console.log(`  最终 URL : ${url}`)
  console.log(`  标题     : ${title}`)
  console.log(`  页面错误 : ${errs.length ? errs.slice(0, 3).join(" | ") : "无"}`)

  console.log(`\n  ── 主文档响应头 ──`)
  if (doc.length) for (const d of doc) show(`${d.p}  [${d.status}]`, d.headers)
  else console.log("    (未捕获到主文档响应)")

  // 静态资源取样：js / css / mp3
  const picks = []
  for (const [p, r] of resLog) {
    if (/^\/web\/assets\/.*\.(js|css)$/.test(p) && picks.length < 2) picks.push([p, r])
  }
  for (const [p, r] of resLog) {
    if (/\.(mp3|woff2|json|svg)$/.test(p) && picks.length < 4) picks.push([p, r])
  }
  console.log(`\n  ── 静态资源响应头（${picks.length} 个取样）──`)
  for (const [p, r] of picks) show(`${p}  [${r.status}]`, r.headers)

  await browser.close()
}

;(async () => {
  await run("腾讯云 CloudBase 云托管", CB_BASE, false)
  if (!SKIP_CF) await run("生产 Cloudflare（对照）", CF_BASE, true)
  console.log("\n" + "=".repeat(78))
  console.log("判据：若浏览器实际收到 cache-control: no-store / content-disposition: attachment 二者之一，")
  console.log("      则「平台注入」结论成立，静态资源无法被浏览器缓存；否则该结论只在 curl 场景成立。")
})().catch((e) => {
  console.error("探测失败：", e)
  process.exit(1)
})
