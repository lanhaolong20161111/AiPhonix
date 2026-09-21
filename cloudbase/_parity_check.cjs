/**
 * 同源对比：生产 Cloudflare Worker ↔ 腾讯云托管（CloudRun，跑 server_cf 原版源码）。
 *
 * 目的：证明「同一份源码 + 适配层」在两端行为一致（状态码 / 头 / 字节）。
 *
 * 用法：
 *   CB_BASE="https://aiphonix-api-xxx.sh.run.tcloudbase.com" node cloudbase/_parity_check.cjs
 *   # 生产侧默认经代理 127.0.0.1:7897（本机直连 workers.dev 被墙）
 *   # 加 AUTH=1 会额外注册测试用户并比对鉴权接口形状
 *
 * 判据：逐项输出 ✓/≠；末尾给出不一致清单。已知差异会单独标注（不视为失败）。
 */
const { spawnSync } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const CF_BASE = process.env.CF_BASE || "https://aiphonix-api.xinyi7lan.workers.dev"
const CB_BASE = process.env.CB_BASE
const PROXY = process.env.PROXY || "http://127.0.0.1:7897"
const UA =
  process.env.UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const WITH_AUTH = process.env.AUTH === "1"

if (!CB_BASE) {
  console.error("缺少 CB_BASE（云托管公网地址）")
  process.exit(1)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"))
const SIDES = [
  { id: "CF", base: CF_BASE, curl: ["-x", PROXY, "-A", UA] },
  { id: "CB", base: CB_BASE, curl: ["-A", UA] },
]

let seq = 0
const FMT = "%{http_code}|%{size_download}|%{content_type}|%{redirect_url}"

function curlRaw(side, p, extra = []) {
  const out = path.join(TMP, `${side.id}-${++seq}.bin`)
  const args = ["-s", "-o", out, "-w", `${FMT}|%header{cache-control}`, ...side.curl, side.base + p, ...extra]
  const r = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 1 << 26 })
  const parts = (r.stdout || "").split("|")
  return {
    code: Number(parts[0]) || 0,
    size: Number(parts[1]) || 0,
    ct: parts[2] || "",
    loc: (parts[3] || "").replace(side.base, ""),
    cc: parts[4] || "",
    file: out,
    err: r.status === 0 ? "" : r.stderr || `curl exit ${r.status}`,
  }
}

function md5(file) {
  try {
    return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex").slice(0, 12)
  } catch {
    return "-"
  }
}

function body(file, limit = 200) {
  try {
    return fs.readFileSync(file, "utf8").slice(0, limit).replace(/\s+/g, " ")
  } catch {
    return "-"
  }
}

/**
 * CloudBase 平台**统一注入**的响应头（2026-09-20 实测）。
 * 云托管 CBR 域名、`*.ap-shanghai.app.tcloudbase.com` 网关域名、静态托管 `*.tcloudbaseapp.com`
 * 三处都注入，并且**覆盖容器返回的 Cache-Control**（容器声明 `immutable` 也被改掉）。
 * 属平台行为而非应用差异，单独标注、不计入不一致。
 * 正解：网关「缓存配置」Domain.Extension.Cache.Rules（当前未配置）。
 */
const CB_INJECTED_CC = "no-store, no-cache, must-revalidate, max-age=0"

const results = []

function compare(name, getter, opts = {}) {
  const cf = getter(SIDES[0])
  const cb = getter(SIDES[1])
  const fields = opts.fields || ["code", "size", "ct", "loc", "cc"]
  const diffs = fields.filter((f) => String(cf[f]) !== String(cb[f]))
  const platform = diffs.filter((f) => f === "cc" && String(cb.cc) === CB_INJECTED_CC)
  const real = diffs.filter((f) => !platform.includes(f))
  const ok = real.length === 0
  results.push({ name, ok, diffs: real, platform, cf, cb, note: opts.note })
  const tag = ok ? (platform.length ? "≈" : "✓") : "≠"
  console.log(`${tag} ${name}${ok && platform.length ? "   （仅 Cache-Control 为平台注入）" : ""}`)
  for (const f of fields) {
    console.log(`    ${f.padEnd(5)} CF=${String(cf[f]).slice(0, 90)}`)
    const mark = real.includes(f) ? "   ← 不一致" : platform.includes(f) ? "   ← 平台注入（已知）" : ""
    console.log(`    ${" ".repeat(5)} CB=${String(cb[f]).slice(0, 90)}${mark}`)
  }
  if (opts.sample) {
    console.log(`    body  CF=${body(cf.file, 160)}`)
    console.log(`    body  CB=${body(cb.file, 160)}`)
  }
}

console.log("=".repeat(78))
console.log(`对比 CF ${CF_BASE}`)
console.log(`     CB ${CB_BASE}`)
console.log("=".repeat(78))

// ① 健康检查（容器版应同样探测 D1/R2，且两者都 ok）
compare(
  "/health",
  (s) => {
    const r = curlRaw(s, "/health")
    r.json = body(r.file, 300)
    return r
  },
  { fields: ["code", "json"] },
)

// ② 根路径跳转
compare("/", (s) => curlRaw(s, "/"), { fields: ["code", "loc"] })

// ③ /web（无尾斜杠）与 /web/ 首页
compare("/web", (s) => curlRaw(s, "/web"), { fields: ["code", "loc"] })
compare(
  "/web/",
  (s) => {
    const r = curlRaw(s, "/web/")
    r.hash = (body(r.file, 2000).match(/assets\/index-([A-Za-z0-9_-]+)\.js/) || [])[1] || "?"
    return r
  },
  { fields: ["code", "size", "cc", "hash"] },
)

// ④ 入口 chunk 逐字节（md5）
compare(
  "/web/assets/index-<hash>.js",
  (s) => {
    const r = curlRaw(s, "/web/assets/index-ClCOQd8D.js")
    r.md5 = md5(r.file)
    return r
  },
  { fields: ["code", "size", "ct", "cc", "md5"] },
)

// ⑤ SPA 深链接回退（未命中静态 → 回 index.html）
compare("/web/definitely-missing.js", (s) => curlRaw(s, "/web/definitely-missing.js"), {
  fields: ["code", "size", "ct"],
})

// ⑥ API 404 / 401 文案
compare("/api/v1/definitely-not-a-route", (s) => {
  const r = curlRaw(s, "/api/v1/definitely-not-a-route")
  r.json = body(r.file, 120)
  return r
}, { fields: ["code", "ct", "json"] })

// ⑦ R2 媒体 + Range
compare("/letter-clips/letter_a.mp4", (s) => curlRaw(s, "/letter-clips/letter_a.mp4"), {
  fields: ["code", "size", "ct", "cc"],
})
compare(
  "/letter-clips/letter_a.mp4 (Range bytes=100-199)",
  (s) => {
    const r = curlRaw(s, "/letter-clips/letter_a.mp4", ["-H", "Range: bytes=100-199"])
    r.cr = ""
    return r
  },
  { fields: ["code", "size"] },
)

// ⑧ 预生成发音库（Assets 直出）
compare("/tts-cache/data/tts_char/你.mp3", (s) => curlRaw(s, "/tts-cache/data/tts_char/你.mp3"), {
  fields: ["code", "size", "ct"],
})

// ⑨ 鉴权接口形状（可选：AUTH=1）
if (WITH_AUTH) {
  const u = `parity_${Date.now()}`
  const payload = JSON.stringify({ username: u, password: "test1234", nickname: "parity" })
  const pf = path.join(TMP, "reg.json")
  fs.writeFileSync(pf, payload, "utf8")

  console.log("-".repeat(78))
  console.log(`鉴权对比（测试账号 ${u}）`)
  const regs = {}
  for (const s of SIDES) {
    const out = path.join(TMP, `${s.id}-reg.bin`)
    const r = spawnSync(
      "curl",
      ["-s", "-o", out, "-w", "%{http_code}", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", `@${pf}`, ...s.curl, `${s.base}/api/v1/auth/register`],
      { encoding: "utf8", maxBuffer: 1 << 24 },
    )
    let j = null
    try {
      j = JSON.parse(fs.readFileSync(out, "utf8"))
    } catch {
      /* ignore */
    }
    regs[s.id] = { code: Number(r.stdout) || 0, j }
  }
  const shape = (j) => (j ? Object.keys(j).sort().join(",") : "-")
  const okShape = shape(regs.CF.j) === shape(regs.CB.j)
  console.log(`${okShape ? "✓" : "≠"} POST /auth/register  code CF=${regs.CF.code} CB=${regs.CB.code}`)
  console.log(`    字段 CF=[${shape(regs.CF.j)}]`)
  console.log(`    字段 CB=[${shape(regs.CB.j)}]`)

  // 用 CF 的 token 打两端受保护接口（同一账号在两库各注册了一份，各自用各自的 token）
  for (const s of SIDES) {
    const tok = regs[s.id].j?.access_token
    if (!tok) continue
    const out = path.join(TMP, `${s.id}-me.bin`)
    const r = spawnSync(
      "curl",
      ["-s", "-o", out, "-w", "%{http_code}", "-H", `Authorization: Bearer ${tok}`, ...s.curl, `${s.base}/api/v1/practice/today`],
      { encoding: "utf8", maxBuffer: 1 << 24 },
    )
    console.log(`    GET /practice/today [${s.id}] code=${Number(r.stdout) || 0} body=${fs.readFileSync(out, "utf8").slice(0, 120).replace(/\s+/g, " ")}`)
  }
}

console.log("=".repeat(78))
const bad = results.filter((r) => !r.ok)
const plat = results.filter((r) => r.platform.length)
console.log(`结论：${results.length - bad.length}/${results.length} 项一致${bad.length ? `，不一致：${bad.map((b) => b.name).join(" / ")}` : ""}`)
if (plat.length) {
  console.log(`（另有 ${plat.length} 项的 Cache-Control 被平台注入覆盖，非应用差异：${plat.map((p) => p.name).join(" / ")}）`)
}
console.log(`（已知差异：R2 对象的 ETag 在容器版由「大小+mtime」推导，生产是内容 MD5；不影响 304 语义。）`)
process.exit(bad.length ? 2 : 0)
