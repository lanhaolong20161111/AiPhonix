/** 复习权重公式单测 — 对齐 PY services/practice_tracker.py（含 2026-08-24 双端冒烟基准值） */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeWeight, emptyRec } from "../src/lib/practiceWeights.js"

const NOW = 1756270000 // 固定"当前时间"，保证天数用例可复现

describe("computeWeight", () => {
  it("无记录历史 → 基础权重 1.0", () => {
    const w = computeWeight(emptyRec("火"), NOW)
    assert.equal(w, 1.0)
  })

  it("错 3 次、无连续正确 → 1.9（与双端冒烟基准一致）", () => {
    const rec = { ...emptyRec("测"), pronunciation_wrong: 3 }
    assert.equal(computeWeight(rec, NOW), 1.9)
  })

  it("连续正确衰减：−min(连续×0.15, 0.7)，3 次未触顶 / 5 次起触顶", () => {
    // 3 × 0.15 = 0.45 未到上限 → 1 − 0.45
    assert.ok(Math.abs(computeWeight({ ...emptyRec("木"), consecutive_correct: 3 }, NOW) - 0.55) < 1e-9)
    // 5 × 0.15 = 0.75 > 0.7 触顶 → 1 − 0.7
    assert.ok(Math.abs(computeWeight({ ...emptyRec("木"), consecutive_correct: 5 }, NOW) - 0.3) < 1e-9)
    assert.ok(Math.abs(computeWeight({ ...emptyRec("木"), consecutive_correct: 10 }, NOW) - 0.3) < 1e-9)
  })

  it("错误加权后再叠加连续正确折扣", () => {
    const rec = { ...emptyRec("水"), pronunciation_wrong: 3, consecutive_correct: 4 }
    // 1 + 3×0.3 − 4×0.15 = 1.3
    assert.ok(Math.abs(computeWeight(rec, NOW) - 1.3) < 1e-9)
  })

  it("超过 7 天未练：+min(天数×0.02, 0.5)", () => {
    const base = { ...emptyRec("金"), pronunciation_wrong: 3 }
    base.last_seen = NOW - 10 * 86400
    // 1.9 + 0.2 = 2.1
    assert.ok(Math.abs(computeWeight(base, NOW) - 2.1) < 1e-9)
    // 加封顶：30 天 → +0.5
    base.last_seen = NOW - 30 * 86400
    assert.equal(computeWeight(base, NOW), 1.9 + 0.5)
  })

  it("恰好第 7 天不加分（严格大于）", () => {
    const rec = { ...emptyRec("土"), last_seen: NOW - 7 * 86400 }
    assert.equal(computeWeight(rec, NOW), 1.0)
  })
})
