#!/usr/bin/env node
/**
 * 验证 `MaxNum: 1` 是否被平台尊重 —— 压测期间实例数会不会扩到 2 以上。
 *
 * 背景：`OperationMode = alwaysScale`（始终自动扩缩容）的官方描述是「实例数可在 0-10 之间自动调整」，
 * 但我们的 `MaxNum = 1`。若平台只认 OperationMode、忽略 MaxNum，就会有 2 个以上实例同时跑，
 * 成本翻倍且不可控 —— 这是目前**唯一未验证的成本风险**。
 *
 * 判据（外部可观测）：
 *   · 实例数：`tcbr:DescribeCloudRunPodList` 的 `TotalCount`（由 agent 侧用 MCP 轮询，本脚本不能调）
 *   · 本脚本负责制造持续高并发，并输出「分时段」的吞吐/延迟/状态码分布，
 *     好和 PodList 轮询的结果对齐时间线。
 *   · 若单实例（0.5 核）被打满而实例数始终为 1 ⇒ MaxNum 生效；
 *     若吞吐出现台阶式跃升且实例数变 2 ⇒ MaxNum 被忽略。
 *
 * 用法：
 *   CB_BASE=https://<网关域名> LOAD_SEC=150 CONCURRENCY=120 node cloudbase/_maxnum_probe.cjs
 *
 * ⚠️ 本机沙箱 `spawnSync` 恒 EBUSY ⇒ 一律用 fetch，不 spawn 子进程。
 */

const BASE = (
  process.env.CB_BASE || "https://cloudbase-test-d8gna6iyy14e2ba39-1444240037.ap-shanghai.app.tcloudbase.com"
).replace(/\/$/, "")
const LOAD_SEC = Number(process.env.LOAD_SEC || 150)
const CONCURRENCY = Number(process.env.CONCURRENCY || 120)
const PATH = process.env.PROBE_PATH || "/health"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

function ts() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function log(...a) {
  console.log(`[${ts()}]`, ...a)
}

/** 单次请求，带自己的超时；不抛错，统一返回结构体 */
async function hit(timeoutMs = 60_000) {
  const t0 = Date.now()
  try {
    const r = await fetch(BASE + PATH, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    })
    await r.text().catch(() => "")
    return { code: r.status, ms: Date.now() - t0 }
  } catch (e) {
    return { code: 0, ms: Date.now() - t0, err: String(e.cause || e.message).slice(0, 60) }
  }
}

function pct(sorted, p) {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[i]
}

async function warmUp() {
  log("── 预热：等实例拉起（当前实例数应为 0，冷启动约 30~70s）──")
  for (let i = 1; i <= 8; i++) {
    const r = await hit()
    log(`   预热 #${i}  code=${String(r.code).padEnd(3)} ${String(r.ms).padStart(6)}ms`)
    if (r.code === 200) return true
    await new Promise((r) => setTimeout(r, 1500))
  }
  log("   ⚠ 预热失败，仍继续压测（结果仅供参考）")
  return false
}

async function main() {
  log("=".repeat(96))
  log(`MaxNum 压测  BASE=${BASE}${PATH}`)
  log(`并发=${CONCURRENCY}  时长=${LOAD_SEC}s  ⇒ 计划输出「每 5 秒一行」的时间线，便于与 PodList 轮询对齐`)
  log("=".repeat(96))

  await warmUp()

  log("")
  log("── 开始压测（agent 侧同时轮询 DescribeCloudRunPodList）──")

  const results = []
  const t0 = Date.now()
  const deadlineAt = t0 + LOAD_SEC * 1000
  let stop = false

  // 每 5 秒输出一行窗口统计
  const bucketTimer = setInterval(() => {
    const now = Date.now()
    const elapsed = Math.round((now - t0) / 1000)
    const win = results.filter((r) => r.at > now - 5000)
    const ms = win.map((r) => r.ms).sort((a, b) => a - b)
    const codes = {}
    for (const r of win) codes[r.code] = (codes[r.code] || 0) + 1
    const codeStr = Object.entries(codes)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([c, n]) => `${c}:${n}`)
      .join(" ")
    log(
      `   +${String(elapsed).padStart(3)}s | 5s窗口 ${String(win.length).padStart(4)} 次` +
        ` | p50 ${String(pct(ms, 50)).padStart(5)}ms p95 ${String(pct(ms, 95)).padStart(6)}ms max ${String(
          ms.length ? ms[ms.length - 1] : 0,
        ).padStart(6)}ms | ${codeStr || "-"}`,
    )
    if (now >= deadlineAt && !stop) {
      stop = true
    }
  }, 5000)

  // 并发 worker：各自顺序打，直到超过 deadline
  const worker = async () => {
    while (Date.now() < deadlineAt) {
      const r = await hit()
      r.at = Date.now()
      results.push(r)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  clearInterval(bucketTimer)

  // —— 汇总 ——
  const totalSec = Math.round((Date.now() - t0) / 1000)
  const ms = results.map((r) => r.ms).sort((a, b) => a - b)
  const codes = {}
  for (const r of results) codes[r.code] = (codes[r.code] || 0) + 1

  log("")
  log("=".repeat(96))
  log(`压测结束：${totalSec}s，共 ${results.length} 次请求，吞吐 ≈ ${(results.length / totalSec).toFixed(1)} req/s`)
  log(
    `延迟：p50 ${pct(ms, 50)}ms / p95 ${pct(ms, 95)}ms / p99 ${pct(ms, 99)}ms / max ${ms[ms.length - 1] || 0}ms`,
  )
  log(
    `状态码分布：${Object.entries(codes)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([c, n]) => `${c || "网络错误"}=${n}（${((n / results.length) * 100).toFixed(1)}%）`)
      .join("  ")}`,
  )
  const slow = results.filter((r) => r.ms > 3000).length
  log(`慢请求(>3s)：${slow} 次（${((slow / results.length) * 100).toFixed(1)}%）`)
  log("=".repeat(96))
  log("判读：")
  log("  · 若实例数始终为 1，且吞吐在高并发下进入平台期 ⇒ **MaxNum=1 生效**（单实例被打满）")
  log("  · 若吞吐中途出现台阶式跃升 / 实例数变 2 ⇒ **MaxNum=1 被忽略**（成本会翻倍）")
}

main()
