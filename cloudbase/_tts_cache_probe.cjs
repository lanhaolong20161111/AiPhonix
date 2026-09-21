#!/usr/bin/env node
/**
 * 发音库缓存语义探测（真浏览器）—— 回答一个成本问题：
 * 「同一个字点读第二次，浏览器还会不会重新下载那 12KB？」
 *
 * 背景：点读走 GET /api/v1/tts/char/:char（容器，带 Authorization），
 * 但服务端在不带 pinyin 时返回的其实就是 /tts-cache/data/tts_char/{字}.mp3。
 * 若浏览器能缓存住静态路径，前端改走 CDN 直连就有实打实的收益。
 *
 * 判据：
 *   1) cache-control 是否为可缓存（immutable / max-age>0）—— 基础前提
 *   2) 第二次 fetch 的 transferSize 是否为 0（= 完全没走网络）/ 是否为 304
 *
 * 用法：
 *   SKIP_CF=1 node cloudbase/_tts_cache_probe.cjs
 *   CHARS=学,习 node cloudbase/_tts_cache_probe.cjs
 */
const { chromium } = require("playwright")

const SD = process.env.SD_BASE || "https://cloudbase-test-d8gna6iyy14e2ba39-1444240037.tcloudbaseapp.com"
const CB = process.env.CB_BASE || "https://cloudbase-test-d8gna6iyy14e2ba39-1444240037.ap-shanghai.app.tcloudbase.com"
const CHARS = (process.env.CHARS || "学,习").split(",").filter(Boolean)
const HDRS = ["cache-control", "content-type", "content-length", "etag", "last-modified", "age", "x-cache", "x-cloudbase-upstream-type"]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probe(name, base, pathFor) {
  console.log(`\n${"=".repeat(78)}\n### ${name} — ${base}\n${"=".repeat(78)}`)
  const browser = await chromium.launch({ channel: "chrome" })
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  })
  const page = await ctx.newPage()
  const seen = new Map()
  page.on("response", (res) => {
    const u = new URL(res.url())
    if (u.origin !== new URL(base).origin) return
    if (!seen.has(u.pathname)) seen.set(u.pathname, { status: res.status(), headers: res.headers() })
  })

  // ⚠️ 故意不加载 /web/：整站 SPA 一起来就会打 /api/*，把容器从 0 唤醒、
  // 重置「连续 30 分钟无流量」的缩容窗口。这里只要一个同源上下文就够（静态 404 页）。
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})
  const t = await page.title().catch(() => "")
  const c = await page.content().catch(() => "")
  if (/风险提醒|页面访问提示/.test(t + c)) {
    console.log("  · 命中「风险提醒」中间页 → 点「确定访问」")
    await page.locator("text=确定访问").first().click().catch(() => {})
    await page.waitForTimeout(2500)
  }
  await page.waitForTimeout(800)
  if (!page.url().startsWith(base)) {
    console.log(`  ⚠️ 页面被重定向到 ${page.url()}，同源假设可能不成立`)
  }
  seen.clear() // 只看后面主动发的请求

  for (const ch of CHARS) {
    const p = pathFor(ch)
    const url = base + p
    console.log(`\n  ── ${ch}  →  ${p}`)

    // 第 1 次：清掉该 URL 的 resource timing，再取
    const r1 = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { cache: "default" })
        const b = await r.arrayBuffer()
        return { ok: r.ok, status: r.status, bytes: b.byteLength }
      } catch (e) {
        return { err: String(e) }
      }
    }, url)
    const h = seen.get(p)
    if (h) for (const k of HDRS) if (h.headers[k] !== undefined) console.log(`    ${k.padEnd(26)}= ${h.headers[k]}`)
    console.log(`    第1次: ${JSON.stringify(r1)}`)

    // 第 2 次：同 URL 再取一次，看是否落缓存
    seen.clear()
    await sleep(300)
    const timing = await page.evaluate(async (u) => {
      // 清掉旧的 resource timing 条目，确保读到的就是本次
      performance.clearResourceTimings()
      const r = await fetch(u, { cache: "default" })
      await r.arrayBuffer()
      const e = performance.getEntriesByName(u).pop()
      return {
        status: r.status,
        transferSize: e ? e.transferSize : null,
        encodedBodySize: e ? e.encodedBodySize : null,
        decodedBodySize: e ? e.decodedBodySize : null,
        duration: e ? Math.round(e.duration) : null,
      }
    }, url)
    const h2 = seen.get(p)
    console.log(`    第2次: ${JSON.stringify(timing)}`)
    console.log(`    第2次上游: ${h2 ? h2.status + " / " + (h2.headers["x-cloudbase-upstream-type"] || "-") : "(无网络请求 = 命中浏览器缓存)"}`)
    console.log(
      `    ⇒ ${timing.transferSize === 0 ? "✅ 命中浏览器缓存（0 流量、0 网关调用）" : timing.transferSize === null ? "⚠️ 读不到 timing" : `❌ 仍走网络（transferSize=${timing.transferSize}B）`}`,
    )
  }
  await browser.close()
}

;(async () => {
  const staticPath = (ch) => `/tts-cache/data/tts_char/${encodeURIComponent(ch)}.mp3`
  await probe("静态托管 CDN（/tts-cache 直连）", SD, staticPath)
  // 容器路径对照（音频本身一样，但这条必须带 Authorization，浏览器缓存语义不同）
  console.log(
    "\n注：容器路径 /api/v1/tts/char/:char 需 JWT，本探测不便直接取；\n" +
      "    其对浏览器的缓存语义本就更差（带 Authorization 的响应默认不入共享缓存）。",
  )
  console.log("\n" + "=".repeat(78))
  console.log("判据：第2次 transferSize === 0 ⇒ 前端可放心改走 CDN 直连，重复点读零成本。")
})().catch((e) => {
  console.error("探测失败：", e)
  process.exit(1)
})
