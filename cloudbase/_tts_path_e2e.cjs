#!/usr/bin/env node
/**
 * 点读路径端到端验证（真机）—— 证明「点一个字」现在打的是静态发音库，
 * 而不是 /api/v1/tts/char/:char（容器）。
 *
 * 为什么值得测：这是本项目最高频的用户动作（整块/逐字点读），
 * 每次点读的成本从「网关调用 0.003 点 + 容器出流量 ~0.009 点」降到
 * 「CDN 出流量 ~0.0024 点」，且 5 分钟内重复点读 0 成本。
 * 单测只能证明 URL 拼对了；这条链路上还有「真登录 → 页面渲染出可点的字」等多个环节。
 *
 * 判据：
 *   ✅ 至少 1 条请求命中 /tts-cache/data/tts_char/
 *   ✅ 0 条请求打到 /api/v1/tts/char/（原本的容器端点）
 *
 * 用法：node cloudbase/_tts_path_e2e.cjs        （需要 NODE_PATH 指向 web/node_modules）
 */
const { chromium } = require("playwright")

const GW =
  process.env.CB_BASE || "https://cloudbase-test-d8gna6iyy14e2ba39-1444240037.ap-shanghai.app.tcloudbase.com"
const API = `${GW}/api/v1`
const PAGE = `${GW}/web/module/word_practice`
const USER = `smoke_ttpath_${Date.now()}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await chromium.launch({ channel: "chrome" })
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  })
  const page = await ctx.newPage()

  const hits = []
  page.on("request", (r) => {
    const u = r.url()
    if (/\/tts|\/tts-cache/.test(u)) hits.push({ t: Date.now(), method: r.method(), url: u })
  })
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`))

  // 先进 /web/ 拿同源上下文（顺便处理体验版「风险提醒」中间页）
  await page.goto(`${GW}/web/`, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {})
  const t = await page.title().catch(() => "")
  const c = await page.content().catch(() => "")
  if (/风险提醒|页面访问提示/.test(t + c)) {
    console.log("[e2e] 命中「风险提醒」→ 点「确定访问」")
    await page.locator("text=确定访问").first().click().catch(() => {})
    await sleep(2500)
  }
  await sleep(1500)

  // ⚠️ 必须先显式预热容器再干正事：`MinNum=0` 下首个请求可能拿到 **502（nginx Bad Gateway）**
  //    而不是 503，且**会连续 502 一段时间**（不只是 30s 的一次性 503）。
  //    不预热的话，注册这一步就会 502，整条 E2E 直接崩在起点（踩过多次）。
  console.log("[e2e] 预热容器（轮询 /health，最多 ~90s）…")
  const warm = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const t0 = Date.now()
    for (let i = 1; i <= 30; i++) {
      try {
        const r = await fetch("/health", { cache: "no-store" })
        if (r.ok) return { ok: true, tries: i, ms: Date.now() - t0, body: (await r.text()).slice(0, 80) }
      } catch {}
      await sleep(3000)
    }
    return { ok: false, tries: 30, ms: Date.now() - t0 }
  })
  console.log(`[e2e] 预热结果: ${JSON.stringify(warm)}`)
  if (!warm.ok) {
    console.log("[e2e] ⚠️ 90s 内容器没起来，后面的调用大概率 502")
  }

  // ⚠️ 注册必须在**浏览器内**发：Node 裸 fetch 不带浏览器指纹，
  //    会被体验版的「风险提醒」中间页拦成一段 HTML（JSON.parse 直接炸）。
  // ⚠️ 必须带重试：MinNum=0 下容器可能正在冷启动，首个请求会拿到 503 / 502（nginx Bad Gateway）。
  // ⚠️ 注册后**必须校验 token 真能用**（GET /users/me）——无持久卷时 Pod 重建会让 sqlite
  //    回到镜像态，刚注册的用户就消失了，此时带着 token 进页面会被 401 → 应用 logout → 落登录页，
  //    看起来像「前端登录坏了」，其实是数据被回滚。
  console.log(`[e2e] 在页面内注册测试用户 ${USER}`)
  const reg = await page.evaluate(
    async ([api, un]) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const tryJson = async (path, init) => {
        for (let i = 1; i <= 8; i++) {
          try {
            const r = await fetch(`${api}${path}`, init)
            if (r.status === 502 || r.status === 503 || r.status === 504) {
              await sleep(4000)
              continue
            }
            const txt = await r.text()
            try {
              return { __status: r.status, ...JSON.parse(txt) }
            } catch {
              return { __status: r.status, __raw: txt.slice(0, 160) }
            }
          } catch {
            await sleep(4000)
          }
        }
        return { __status: 0, __raw: "重试 8 次仍失败（容器一直没起来？）" }
      }
      const r = await tryJson("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, password: "test1234", nickname: "点读验证" }),
      })
      if (!r.access_token) return r
      const me = await tryJson("/users/me", { headers: { Authorization: `Bearer ${r.access_token}` } })
      return { ...r, __meStatus: me.__status }
    },
    [API, USER],
  )
  if (!reg.access_token) throw new Error("注册失败: " + JSON.stringify(reg))
  console.log(`[e2e] 拿到 token（user_id=${reg.user_id}），/users/me 校验 = ${reg.__meStatus}`)
  if (reg.__meStatus !== 200) {
    console.log("  ⚠️ token 校验未过（Pod 可能刚被重建、sqlite 回滚）—— 继续跑，页面侧会自愈重注册")
  }

  await page.evaluate(
    ([a, r, uid, un]) => {
      localStorage.setItem(
        "ai_phonix_web_auth",
        JSON.stringify({
          state: {
            session: {
              access_token: a,
              refresh_token: r,
              user: { user_id: uid, username: un, nickname: "点读验证", role: "student", grade: "一年级", age: 7 },
            },
          },
          version: 0,
        }),
      )
    },
    [reg.access_token, reg.refresh_token, reg.user_id, USER],
  )
  console.log("[e2e] 已注入会话，进入词语练习页")

  hits.length = 0
  await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {})

  // ⚠️ 实测会偶发落到登录页：应用的 401 路径在「刷新 token 失败」时会 `logout()`
  //    （`services/api.ts:202`），启动期抖动就可能把注入的会话清掉。
  //    自愈：轮询等待；确认是登录页就再注入 + reload（最多 3 次）。
  //    ⚠️ 必须**等到有实质内容**再判定 —— 加载态 `innerText` 是空串，早判会直接 break（踩过）。
  const SEL = ".tap-char-item"
  let n = 0
  let t0 = Date.now()
  for (let attempt = 1; attempt <= 3; attempt++) {
    // 可点字要等「AI 造句」回来才渲染（首词 10~30s，新词可能更久）⇒ 这里给到 ~150s
    for (let i = 0; i < 50; i++) {
      n = await page.locator(SEL).count().catch(() => 0)
      if (n > 0) break
      await sleep(3000)
    }
    if (n > 0) break

    const body = await page.locator("body").innerText().catch(() => "")
    const onLogin = /还没有账号|登录开始学习/.test(body)
    console.log(`[e2e] 第 ${attempt} 轮：未找到可点字，登录页=${onLogin}，body 长度=${body.length}`)
    if (!onLogin) {
      console.log(`[e2e] body 片段: ${body.slice(0, 200).replace(/\n+/g, " | ")}`)
      break
    }
    await page.evaluate(
      ([a, r, uid, un]) => {
        localStorage.setItem(
          "ai_phonix_web_auth",
          JSON.stringify({
            state: {
              session: {
                access_token: a,
                refresh_token: r,
                user: { user_id: uid, username: un, nickname: "点读验证", role: "student", grade: "一年级", age: 7 },
              },
            },
            version: 0,
          }),
        )
      },
      [reg.access_token, reg.refresh_token, reg.user_id, USER],
    )
    console.log("[e2e] 重新注入会话并 reload")
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {})
    t0 = Date.now()
  }
  console.log(`[e2e] 当前 URL: ${page.url()}`)
  console.log(`[e2e] 找到 ${n} 个可点字（等了 ${Math.round((Date.now() - t0) / 1000)}s）`)
  if (!n) {
    const ls = await page.evaluate(() => (localStorage.getItem("ai_phonix_web_auth") || "").slice(0, 160)).catch(() => "")
    console.log(`[e2e] localStorage 里的会话: ${ls || "(空)"}`)
    console.log(`[e2e] ⚠️ 页面没渲染出可点字 —— 无法验证`)
    await browser.close()
    process.exit(2)
  }
  console.log(`[e2e] 找到 ${n} 个可点字（等了 ${Math.round((Date.now() - t0) / 1000)}s）`)

  const first = await page.locator(SEL).first().innerText().catch(() => "?")
  console.log(`[e2e] 点击第一个字：「${first}」`)
  hits.length = 0
  await page.locator(SEL).first().click({ timeout: 15000 }).catch((e) => console.log(`[e2e] 点击失败: ${e.message}`))
  await sleep(8000)

  console.log("\n=== 点读产生的 TTS 请求 ===")
  for (const h of hits) {
    const p = new URL(h.url).pathname
    const kind = p.startsWith("/tts-cache/")
      ? "★静态发音库(CDN)"
      : p.startsWith("/api/v1/tts/char")
        ? "✗容器 /tts/char"
        : p.startsWith("/api/v1/tts/stream")
          ? "✗容器 /tts/stream"
          : p.startsWith("/api/v1/tts/synthesize")
            ? "✗容器 /tts/synthesize"
            : "?"
    console.log(`  +${String(h.t - t0).padStart(6)}ms  ${h.method.padEnd(5)} ${kind.padEnd(22)} ${p}`)
  }
  const staticHits = hits.filter((h) => new URL(h.url).pathname.startsWith("/tts-cache/"))
  const containerHits = hits.filter((h) => new URL(h.url).pathname.startsWith("/api/v1/tts/"))
  console.log("\n=== 判定 ===")
  console.log(`  静态发音库命中 : ${staticHits.length}`)
  console.log(`  容器 TTS 命中  : ${containerHits.length}`)
  if (!hits.length) console.log("  ⚠️ 一条 TTS 请求都没有 —— 点击可能没触发（或音频已缓存）")
  else if (staticHits.length && !containerHits.length)
    console.log("  ✅ 全部走静态发音库，未触碰容器 TTS 端点")
  else if (staticHits.length && containerHits.length)
    console.log("  ⚠️ 两条路都走了（可能是静态库未覆盖 → 回退容器，属预期分支）")
  else console.log("  ❌ 没走静态发音库")

  await browser.close()
}

main().catch((e) => {
  console.error("失败：", e)
  process.exit(1)
})
