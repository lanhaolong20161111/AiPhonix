/**
 * 冷启动重试策略单测。
 *
 * 判据来自 2026-09-20 的实测序列（CloudBase `MinNum=0` 缩容后）：
 *   ① 30.3s → 503   ② 10.0s → 503   ③ 30.3s → 200
 * 这套策略必须能把上面这段吃掉，同时**不能**把 POST 的 502/网络失败也重发。
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_ATTEMPTS,
  RETRY_BUDGET_MS,
  isIdempotent,
  retryDelayMs,
  retryReason,
} from "./apiRetry.js"

describe("retryReason", () => {
  it("503 是「实例未就绪」，任何方法都可重试（含 POST）", () => {
    for (const m of ["GET", "POST", "PUT", "DELETE"]) {
      assert.equal(retryReason("response", 503, m), "HTTP 503（后端实例未就绪）")
    }
  })

  it("502/504 只对幂等方法重试", () => {
    assert.match(retryReason("response", 502, "GET") ?? "", /502/)
    assert.match(retryReason("response", 504, "PUT") ?? "", /504/)
    assert.equal(retryReason("response", 502, "POST"), null)
    assert.equal(retryReason("response", 504, "POST"), null)
  })

  it("网络失败与超时只对幂等方法重试", () => {
    assert.equal(retryReason("networkError", 0, "GET"), "网络连接失败")
    assert.equal(retryReason("timeout", 0, "GET"), "请求超时")
    assert.equal(retryReason("networkError", 0, "POST"), null)
    assert.equal(retryReason("timeout", 0, "POST"), null)
  })

  it("4xx 与 500 一律不重试（确定性错误，重试只是让用户多等一遍）", () => {
    for (const s of [400, 401, 403, 404, 409, 422, 429, 500]) {
      assert.equal(retryReason("response", s, "GET"), null, `status=${s} 不该重试`)
    }
  })

  it("方法名大小写不敏感（小写 get 也认作幂等）", () => {
    assert.equal(retryReason("timeout", 0, "get"), "请求超时")
    assert.equal(isIdempotent("get"), true)
    assert.equal(isIdempotent("post"), false)
  })
})

describe("retryDelayMs", () => {
  it("按 800 / 2000 / 4000 / 6000 递增，且末位重复使用", () => {
    assert.equal(retryDelayMs(1), 800)
    assert.equal(retryDelayMs(2), 2000)
    assert.equal(retryDelayMs(3), 4000)
    assert.equal(retryDelayMs(4), 6000)
    assert.equal(retryDelayMs(5), 6000)
    assert.equal(retryDelayMs(99), 6000)
  })

  it("非法入参不会返回 NaN（0 / 负数都退到首位）", () => {
    assert.equal(retryDelayMs(0), 800)
    assert.equal(retryDelayMs(-3), 800)
  })
})

describe("预算与次数必须覆盖实测冷启动序列", () => {
  it("退避总等待远小于 30s 网关挂起时间（重试次数不是瓶颈）", () => {
    let total = 0
    for (let i = 1; i < MAX_ATTEMPTS; i++) total += retryDelayMs(i)
    assert.equal(total, 12_800)
    assert.ok(total < 15_000, "退避总和应远小于单次网关挂起的 30s")
  })

  it("按实测 30.3s / 10.0s / 30.3s 三次尝试，累计耗时在总预算内", () => {
    // 若不退出，前 3 次尝试自身就要 70.6s，加上前两次退避 2.8s
    const elapsed = 30_300 + 800 + 9_978 + 2_000 + 30_268
    assert.ok(elapsed < RETRY_BUDGET_MS, `实测累计 ${elapsed}ms 必须小于预算 ${RETRY_BUDGET_MS}ms`)
    assert.ok(MAX_ATTEMPTS >= 3, "至少要有 3 次尝试才够冷启动用")
  })
})
