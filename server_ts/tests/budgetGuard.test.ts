/** 预算守卫三段检查单测（对齐 PY services/deepseek.py 守卫顺序与消息文本） */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { checkBudget, BudgetExceededError } from "../src/lib/deepseek.js"

const LIMITS = {
  max_input_chars: 20000,
  max_cost_per_day: 5.0,
  max_cost_per_call: 0.5,
}

describe("checkBudget", () => {
  it("三项都在限内 → 放行", () => {
    assert.doesNotThrow(() => checkBudget(1000, 2048, 0.0, LIMITS))
  })

  it("输入超长（system+user 合计）→ 抛 BudgetExceededError", () => {
    assert.throws(() => checkBudget(25000, 1024, 0, LIMITS), (e: unknown) => {
      assert.ok(e instanceof BudgetExceededError)
      assert.match((e as Error).message, /input 25000 chars exceeds limit 20000/)
      assert.equal((e as BudgetExceededError).status, 429)
      assert.equal((e as BudgetExceededError).budget, true)
      return true
    })
  })

  it("日累计达到上限（>= 边界）→ 抛错", () => {
    assert.throws(() => checkBudget(1000, 1024, 5.0, LIMITS), /daily cost 5\.0000 yuan/)
  })

  it("单次最坏预估超上限 → 抛错", () => {
    // (10000×0.5 + 300000×2)/1e6 = 0.605 > 0.5
    assert.throws(() => checkBudget(10000, 300000, 0, LIMITS), /estimated cost 0\.6050 yuan/)
  })

  it("守卫顺序：先查输入长度，超长时不再报日累计", () => {
    assert.throws(
      () => checkBudget(999999, 1024, 99, LIMITS),
      /input 999999 chars/
    )
  })
})
