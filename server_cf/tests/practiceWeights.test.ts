/** 复习权重公式单测 — 与 server_ts/tests/practiceWeights.test.ts 同源同参。
 *
 * 公式本体与 PY services/practice_tracker.py get_weight 逐字对齐；server_cf 与 server_ts
 * 共用同一实现，本测试的作用是：任何一侧改动公式而另一侧没跟上时，至少有一侧会红。
 * 基准值沿用 2026-08-24 双端冒烟用例。
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeWeight, emptyRec } from "../src/lib/practiceWeights.js"

const NOW = 1756270000 // 固定"当前时间"，保证天数用例可复现

describe("computeWeight", () => {
  it("无记录历史 → 基础权重 1.0", () => {
    assert.equal(computeWeight(emptyRec("火"), NOW), 1.0)
  })

  it("错 3 次、无连续正确 → 1.9（与双端冒烟基准一致）", () => {
    const rec = { ...emptyRec("测"), pronunciation_wrong: 3 }
    assert.equal(computeWeight(rec, NOW), 1.9)
  })

  it("连续正确衰减：−min(连续×0.15, 0.7)，3 次未触顶 / 5 次起触顶", () => {
    assert.ok(Math.abs(computeWeight({ ...emptyRec("木"), consecutive_correct: 3 }, NOW) - 0.55) < 1e-9)
    assert.ok(Math.abs(computeWeight({ ...emptyRec("木"), consecutive_correct: 5 }, NOW) - 0.3) < 1e-9)
    assert.ok(Math.abs(computeWeight({ ...emptyRec("木"), consecutive_correct: 10 }, NOW) - 0.3) < 1e-9)
  })

  it("错误加权后再叠加连续正确折扣", () => {
    const rec = { ...emptyRec("水"), pronunciation_wrong: 3, consecutive_correct: 4 }
    assert.ok(Math.abs(computeWeight(rec, NOW) - 1.3) < 1e-9)
  })

  it("超过 7 天未练：+min(天数×0.02, 0.5)", () => {
    const base = { ...emptyRec("金"), pronunciation_wrong: 3 }
    base.last_seen = NOW - 10 * 86400
    assert.ok(Math.abs(computeWeight(base, NOW) - 2.1) < 1e-9)
    base.last_seen = NOW - 30 * 86400
    assert.equal(computeWeight(base, NOW), 1.9 + 0.5)
  })

  it("恰好第 7 天不加分（严格大于）", () => {
    const rec = { ...emptyRec("土"), last_seen: NOW - 7 * 86400 }
    assert.equal(computeWeight(rec, NOW), 1.0)
  })

  it("折扣触顶后不再继续降低：连对再多次也停在 0.3", () => {
    // 注 1：公式里的 0.1 下限在现有输入域内不可达 —— 错误只增权、连对折扣上限 0.7，
    //       故最小值恒为 1.0 − 0.7 = 0.3。此处钉住"不会更低"这一实际边界。
    // 注 2：必须用容差比较。1.0 − 0.7 在 IEEE754 下是 0.30000000000000004，
    //       直接 assert.equal 会红 —— 本文件所有涉及减法的用例同理。
    const rec = { ...emptyRec("下"), consecutive_correct: 100 }
    assert.ok(Math.abs(computeWeight(rec, NOW) - 0.3) < 1e-9)
  })
})
