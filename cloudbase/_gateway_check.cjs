#!/usr/bin/env node
/**
 * 网关分流验证 —— 确认「静态走 CDN、动态走容器」按预期分工，
 * 且静态内容与生产 CF 字节一致。
 *
 * 核心判据（CloudBase 网关自带，无需猜测）：
 *   x-cloudbase-upstream-type: Tencent-COS          → 由静态托管(CDN)应答
 *   x-cloudbase-upstream-type: Tencent-CloudBaseRun → 由云托管容器应答
 *
 * 用法：
 *   node cloudbase/_gateway_check.cjs
 *   CB_BASE=<网关域名> node cloudbase/_gateway_check.cjs
 *   SKIP_CF=1 node cloudbase/_gateway_check.cjs
 *
 * ⚠️ 两条环境陷阱（踩过）：
 *  1. **用 fetch，不要 spawnSync("curl")**：本机沙箱下子进程一律 `EBUSY`
 *     （连 `where` 都失败；`dangerouslyDisableSandbox` 也无效）。CB 侧直连 fetch 即可。
 *  2. **CF 侧必须经代理 127.0.0.1:7897**，而 undici 不读 `http_proxy` ⇒ 只有
 *     spawn 可用的环境才能自动比 CF；不可用时本脚本会跳过并提示用 Bash+curl 手比。
 */
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { spawnSync } = require("child_process")

const ROOT = path.resolve(__dirname, "..")
const CB_BASE = process.env.CB_BASE || "https://cloudbase-test-d8gna6iyy14e2ba39-1444240037.ap-shanghai.app.tcloudbase.com"
const CF_BASE = process.env.CF_BASE || "https://aiphonix-api.xinyi7lan.workers.dev"
const PROXY = process.env.PROXY || "http://127.0.0.1:7897"
const SKIP_CF = process.env.SKIP_CF === "1"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

const COS = "Tencent-COS"
const CBR = "Tencent-CloudBaseRun"

/** 能不能 spawn 子进程（决定 CF 比对能否自动做） */
function spawnWorks() {
  try {
    const r = spawnSync("curl", ["--version"], { encoding: "utf8" })
    return !r.error && r.status === 0
  } catch {
    return false
  }
}
const SPAWN_OK = spawnWorks()

/** 从磁盘找出真实的前端入口 chunk，避免硬编码 hash */
function entryChunk() {
  const dir = path.join(ROOT, "server_cf", "static_assets", "web", "assets")
  const f = fs.readdirSync(dir).find((n) => /^index-.*\.js$/.test(n))
  if (!f) throw new Error("找不到入口 chunk：" + dir)
  return f
}
const ENTRY = entryChunk()
const ENTRY_SIZE = fs.statSync(path.join(ROOT, "server_cf", "static_assets", "web", "assets", ENTRY)).size

/** 统一探测（fetch，直连） */
async function probe(base, p, opts = {}) {
  const headers = { "User-Agent": UA }
  if (opts.range) headers["Range"] = `bytes=${opts.range}`
  try {
    const res = await fetch(base + p, { headers, redirect: "manual" })
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      code: res.status,
      len: buf.length,
      ct: res.headers.get("content-type") || "",
      loc: res.headers.get("location") || "",
      cc: res.headers.get("cache-control") || "",
      upstream: res.headers.get("x-cloudbase-upstream-type") || "",
      timecost: res.headers.get("x-cloudbase-upstream-timecost") || "",
      range: res.headers.get("content-range") || "",
      md5: crypto.createHash("md5").update(buf).digest("hex"),
      body: buf,
      err: "",
    }
  } catch (e) {
    return { code: 0, len: 0, ct: "", loc: "", cc: "", upstream: "", timecost: "", range: "", md5: "", body: Buffer.alloc(0), err: String(e.cause || e.message).slice(0, 120) }
  }
}

/** CF 侧：只能走 curl + 代理（spawn 可用时） */
function probeCF(p, opts = {}) {
  const hdrFile = path.join(require("os").tmpdir(), `gwcf_${process.pid}_${++seq}.hdr`)
  const args = ["-s", "-D", hdrFile, "-o", "-", "-A", UA, "--proxy", PROXY]
  if (opts.range) args.push("-r", opts.range)
  args.push(CF_BASE + p)
  const r = spawnSync("curl", args, { maxBuffer: 1 << 28 })
  let raw = ""
  try { raw = fs.readFileSync(hdrFile, "utf8") } catch { /* ignore */ }
  try { fs.unlinkSync(hdrFile) } catch { /* ignore */ }
  const body = r.stdout || Buffer.alloc(0)
  const blocks = raw.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//m.test(b))
  const lines = (blocks.length ? blocks[blocks.length - 1] : "").split(/\r?\n/).filter(Boolean)
  return {
    code: Number((lines[0] || "").split(" ")[1] || 0),
    len: body.length,
    md5: crypto.createHash("md5").update(body).digest("hex"),
    range: (lines.find((l) => /^content-range:/i.test(l)) || "").split(":").slice(1).join(":").trim(),
  }
}
let seq = 0

const results = []
function record(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? "✓" : "✗"} ${name}`)
  for (const d of [].concat(detail || [])) console.log(`    ${d}`)
}

/** 断言：状态码 + 由哪个上游应答 +（可选）字节数 / Range */
async function check(name, p, expectUpstream, opts = {}) {
  const cb = await probe(CB_BASE, p, opts)
  const lines = [`code=${cb.code}  upstream=${cb.upstream || "(无)"}  len=${cb.len}  ct=${cb.ct}`]
  if (cb.timecost) lines[0] += `  upstream耗时=${cb.timecost}ms`
  if (cb.err) lines.push(`← 请求失败：${cb.err}`)

  let ok = true
  if (opts.expectCode !== undefined && opts.expectCode !== null && cb.code !== opts.expectCode) {
    ok = false; lines.push(`← 期望 code=${opts.expectCode}`)
  }
  if (expectUpstream && cb.upstream !== expectUpstream) {
    ok = false
    lines.push(`← 期望由 ${expectUpstream === COS ? "静态托管(CDN)" : "云托管容器"} 应答`)
  }
  if (opts.expectLen !== undefined && cb.len !== opts.expectLen) {
    ok = false; lines.push(`← 期望 len=${opts.expectLen}`)
  }
  if (opts.range) {
    if (cb.code !== 206) { ok = false; lines.push(`← Range 请求未返回 206（实际 ${cb.code}）`) }
    if (opts.total && !cb.range.includes(`/${opts.total}`)) {
      ok = false; lines.push(`← 期望总长 ${opts.total}，实际 content-range=${cb.range || "(无)"}`)
    } else if (cb.range) lines.push(`content-range=${cb.range}`)
  }
  record(name, ok, lines)
  return cb
}

async function main() {
  console.log("=".repeat(80))
  console.log("网关分流验证")
  console.log(`  CB_BASE   = ${CB_BASE}`)
  console.log(`  入口 chunk = ${ENTRY} (${ENTRY_SIZE} B)`)
  console.log(`  子进程可用 = ${SPAWN_OK ? "是（可自动比对 CF）" : "否（EBUSY，跳过 CF 自动比对）"}`)
  console.log("=".repeat(80))

  // ① 静态 → CDN
  console.log("\n── ① 静态路径 → 期望 Tencent-COS ──")
  await check("静态 /web/", "/web/", COS, { expectCode: 200, expectLen: 633 })
  await check("静态 /web（无尾斜杠）", "/web", COS, { expectCode: 200 })
  await check(`静态 /web/assets/${ENTRY}`, `/web/assets/${ENTRY}`, COS, { expectCode: 200, expectLen: ENTRY_SIZE })
  await check("静态 SPA 深链回退", "/web/module/ai_parse_result", COS, { expectCode: 200, expectLen: 633 })
  await check("静态 /web/char_examples.json", "/web/char_examples.json", COS, { expectCode: 200 })
  await check("静态 /web/manifest.webmanifest", "/web/manifest.webmanifest", COS, { expectCode: 200 })
  await check("静态 /web/favicon.svg", "/web/favicon.svg", COS, { expectCode: 200 })

  // ② 动态 → 容器
  console.log("\n── ② 动态路径 → 期望 Tencent-CloudBaseRun ──")
  {
    const cb = await check("动态 /health", "/health", CBR, { expectCode: 200 })
    const txt = cb.body.toString()
    const good = /"status":"ok"/.test(txt) && /"d1":"ok"/.test(txt) && /"r2":"ok"/.test(txt)
    if (!good) { results[results.length - 1].ok = false; console.log("    ← /health 文案不符（d1/r2 应都为 ok）") }
    console.log(`    body=${txt.slice(0, 100)}`)
  }
  {
    const cb = await check("动态 /（302 → /web/）", "/", CBR, { expectCode: 302 })
    if (cb.loc !== "/web/") { results[results.length - 1].ok = false; console.log("    ← location 应为 /web/") }
    else console.log(`    location=${cb.loc}`)
  }
  await check("动态 未知 API（应落容器）", "/api/v1/definitely-missing", CBR, { expectCode: null })

  // ③ 媒体：字母动画走 CDN，视频留在容器（Range 关键）
  console.log("\n── ③ 媒体路径 ──")
  await check("字母动画 /letter-clips/letter_a.mp4 → CDN（小文件，不依赖 Range）", "/letter-clips/letter_a.mp4", COS, {
    expectCode: 200,
    expectLen: 252808,
  })
  await check("视频 /videos/Big_Muzzy_Ep01.mp4 → 容器（Range 必需）", "/videos/Big_Muzzy_Ep01.mp4", CBR, {
    expectCode: 206, range: "0-1", total: 177010385,
  })

  // ④ 发音库 → CDN
  console.log("\n── ④ 发音库 → 期望 Tencent-COS ──")
  await check("发音库 /tts-cache/data/tts_char/你.mp3", "/tts-cache/data/tts_char/%E4%BD%A0.mp3", COS, { expectCode: 200 })
  await check("发音库 /tts-cache/poem/index.json", "/tts-cache/poem/index.json", COS, { expectCode: 200 })

  // ⑤ 与生产 CF 比字节
  if (!SKIP_CF) {
    console.log("\n── ⑤ 与生产 CF 比对（状态码 + 响应体 md5）──")
    if (!SPAWN_OK) {
      console.log("  ⚠️ 子进程不可用（EBUSY），跳过。请用 Bash 直接跑 curl 比对：")
      console.log(`     for p in /web/ /health ; do curl -s --proxy ${PROXY} -A "$UA" "https://aiphonix-api.xinyi7lan.workers.dev$p" | md5sum ; done`)
    } else {
      for (const p of [
        "/web/",
        "/web/index.html",
        `/web/assets/${ENTRY}`,
        "/web/char_examples.json",
        "/web/module/ai_parse_result",
        "/letter-clips/letter_a.mp4",
        "/tts-cache/data/tts_char/%E4%BD%A0.mp3",
        "/health",
      ]) {
        const cb = await probe(CB_BASE, p)
        const cf = probeCF(p)
        const ok = cb.code === cf.code && cb.md5 === cf.md5
        record(`CF比对 ${decodeURIComponent(p)}`, ok, [
          `CB code=${cb.code} md5=${cb.md5.slice(0, 12)} len=${cb.len} up=${cb.upstream || "-"}`,
          `CF code=${cf.code} md5=${cf.md5.slice(0, 12)} len=${cf.len}` + (ok ? "" : "   ← 不一致"),
        ])
      }
    }
  }

  console.log("\n" + "=".repeat(80))
  const bad = results.filter((r) => !r.ok)
  console.log(`结论：${results.length - bad.length}/${results.length} 项通过`)
  if (bad.length) {
    console.log("未通过：")
    for (const b of bad) console.log(`  ✗ ${b.name}`)
  }
  console.log("已知小差异（不影响功能）：")
  console.log("  · 静态托管 /web（无尾斜杠）返回 200 + index.html，CF 是 307 → /web/")
  console.log("  · 静态托管 .js MIME = application/javascript，CF = text/javascript")
  console.log("  · CBR 域名是系统内部域名、不能加 STATIC_STORE 路由 ⇒ 那里 /web/* 仍由容器出")
  console.log("  · 🔴 静态托管 CDN 不支持 Range（恒 200 + 全量）⇒ /videos/* 必须留在容器")
  console.log("=".repeat(80))
  process.exit(bad.length ? 2 : 0)
}

main().catch((e) => {
  console.error("验证脚本异常：", e)
  process.exit(1)
})
