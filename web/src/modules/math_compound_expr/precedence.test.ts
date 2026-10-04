/** 运算优先级引擎单测
 *
 * 核心手法：**三个互相独立的裁判**交叉验算同一条化简轨迹
 *   ① 递归下降求值（evalExpr）
 *   ② 逐步化简的终点（planSteps → finalValue）
 *   ③ 把 token 拼成 JS 表达式，交给 JS 引擎自己算（new Function）
 * 三个不同思路的实现必须给出同一个整数 —— 这才把「轨迹一定对」从信仰变成证明。
 * 另外对两组页内示例做**硬编码常量**断言（数值人工验算过，不依赖引擎自证）。
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  PR_DEMO_CASES,
  applyOp,
  evalExpr,
  finalValue,
  isMd,
  nextOpIndex,
  numTok,
  opTok,
  parenTok,
  planSteps,
  reduceAt,
  type PToken,
} from "./precedence"

// ────────────────────────────────────────────────────────────
// 裁判 ③：交给 JS 引擎（与本文件的实现完全无关）
// ────────────────────────────────────────────────────────────

function evalByJs(tokens: PToken[]): number {
  const src = tokens
    .map((t) => (t.text === "×" ? "*" : t.text === "÷" ? "/" : t.text))
    .join("")
  // 这里刻意用 Function：要的就是一个**独立于本文件算法**的裁判
  const fn = new Function(`return (${src});`) as () => number
  return fn()
}

// ────────────────────────────────────────────────────────────
// 示例题的硬编码断言（人工验算，防引擎自证）
// ────────────────────────────────────────────────────────────

test("页内两组示例：顺序判据 + 结果必须等于人工验算的常量", () => {
  const expect = [
    { key: "diff", firstOpIdx: 3, firstOp: "×", firstWhy: "higher", answer: 22 },
    { key: "same", firstOpIdx: 1, firstOp: "-", firstWhy: "same-level", answer: 29 },
  ]
  for (const e of expect) {
    const c = PR_DEMO_CASES.find((x) => x.key === e.key)
    assert.ok(c, `找不到示例 ${e.key}`)

    // 人工验算的常量
    assert.equal(c.answer, e.answer, `${e.key}: 答案常量被改动过？`)
    assert.equal(evalExpr(c.tokens), e.answer, `${e.key}: 求值与常量不一致`)
    assert.equal(evalByJs(c.tokens), e.answer, `${e.key}: JS 引擎与常量不一致`)

    const steps = planSteps(c.tokens)
    assert.equal(steps.length, 2, `${e.key}: 两个运算符应化简两步`)
    assert.equal(steps[0].index, e.firstOpIdx, `${e.key}: 第一个该算的运算符下标错了`)
    assert.equal(steps[0].op, e.firstOp, `${e.key}: 第一个该算的运算符错了`)
    assert.equal(steps[0].why, e.firstWhy, `${e.key}: 第一个该算的依据错了`)
    assert.equal(finalValue(steps), e.answer, `${e.key}: 轨迹终点与常量不一致`)
  }
})

test("4 + 6 × 3：加号在左边也轮不到它（加号是「同层里的旁人」）", () => {
  const c = PR_DEMO_CASES[0]
  const steps = planSteps(c.tokens)
  assert.deepEqual(steps[0].siblings, ["+"], "应把同层的加号列出来（讲解要用）")
  assert.deepEqual(steps[0].before.map((t) => t.text), ["4", "+", "6", "×", "3"])
  assert.deepEqual(steps[0].after.map((t) => t.text), ["4", "+", "18"])
  assert.equal(steps[1].why, "same-level", "第二步只剩加减 ⇒ 按同级从左往右")
  assert.deepEqual(steps[1].after.map((t) => t.text), ["22"])
})

test("24 - 13 + 18：减法不比加法厉害，同级从左往右", () => {
  const c = PR_DEMO_CASES[1]
  const steps = planSteps(c.tokens)
  assert.deepEqual(steps[0].siblings, ["+"], "两个都是加减 ⇒ 同层且同级")
  assert.deepEqual(steps[0].after.map((t) => t.text), ["11", "+", "18"])
  assert.equal(steps[1].value, 29)
})

test("括号里也要看优先级：(12 + 8 × 3) ÷ 4 = 9", () => {
  // MISTAKE_CASES 里「括号里也要看优先级」那条，必须与下方算式文字一致
  const tokens: PToken[] = [
    parenTok("("), numTok(12), opTok("+"), numTok(8), opTok("×"), numTok(3), parenTok(")"),
    opTok("÷"), numTok(4),
  ]
  const steps = planSteps(tokens)
  assert.deepEqual(steps.map((s) => s.op), ["×", "+", "÷"], "括号里先乘除、再算括号内加减、最后除")
  assert.deepEqual(steps.map((s) => s.why), ["paren", "paren", "same-level"])
  assert.equal(steps[0].value, 24)
  assert.equal(steps[1].value, 36)
  assert.equal(finalValue(steps), 9)
  assert.equal(evalExpr(tokens), 9)
  assert.equal(evalByJs(tokens), 9)
})

test("nextOpIndex 的两条规矩：级别高的压倒位置，同级取最左", () => {
  assert.equal(nextOpIndex([numTok(4), opTok("+"), numTok(6), opTok("×"), numTok(3)]), 3, "× 级别高 ⇒ 忽略它更靠右")
  assert.equal(nextOpIndex([numTok(24), opTok("-"), numTok(13), opTok("+"), numTok(18)]), 1, "同级 ⇒ 取最左的 -")
  assert.equal(nextOpIndex([numTok(2), opTok("÷"), numTok(3), opTok("×"), numTok(4)]), 1, "乘除之间也取最左")
  assert.equal(nextOpIndex([numTok(7)]), -1, "没有运算符")
})

test("reduceAt：三个 token 并成一个、并把只包一个数的括号拆掉", () => {
  const t: PToken[] = [numTok(6), opTok("×"), numTok(3)]
  assert.deepEqual(reduceAt(t, 1).map((x) => x.text), ["18"])
  assert.equal(reduceAt(t, 1)[0].computed, true, "化简产出的数要打上「已算出」标记")

  // 括号里算完只剩一个数 ⇒ 这层括号就没用了，顺手拆掉
  const wrapped: PToken[] = [
    parenTok("("), numTok(12), opTok("+"), numTok(24), parenTok(")"), opTok("÷"), numTok(4),
  ]
  assert.deepEqual(reduceAt(wrapped, 2).map((x) => x.text), ["36", "÷", "4"], "( 36 ) ÷ 4 ⇒ 36 ÷ 4")

  assert.throws(() => reduceAt([numTok(1), opTok("+"), parenTok("(")], 1), /两侧不是数字/)
})

test("applyOp / isMd 与配色约定一致", () => {
  assert.equal(applyOp(6, "×", 3), 18)
  assert.equal(applyOp(24, "-", 13), 11)
  assert.equal(applyOp(36, "÷", 4), 9)
  assert.deepEqual(["×", "÷"].map(isMd), [true, true])
  assert.deepEqual(["+", "-"].map(isMd), [false, false])
})

// ────────────────────────────────────────────────────────────
// 轨迹不变量（对随机算式成立）
// ────────────────────────────────────────────────────────────

/** 随机造一条算式：保证每一步都能整除成整数，否则返回 null 重摇 */
function randTokens(): PToken[] | null {
  const n = 3 + Math.floor(Math.random() * 3) // 3~5 个操作数
  const nums: number[] = []
  const ops: string[] = []
  const pool = "+-×÷"
  for (let i = 0; i < n; i++) nums.push(1 + Math.floor(Math.random() * 9))
  for (let i = 0; i < n - 1; i++) ops.push(pool[Math.floor(Math.random() * 4)])
  // 先粗筛：左往右的除法必须整除（省得大量无效样本）
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === "÷" && (nums[i + 1] === 0 || nums[i] % nums[i + 1] !== 0)) return null
  }

  const flat: PToken[] = []
  for (let i = 0; i < n; i++) {
    flat.push(numTok(nums[i]))
    if (i < n - 1) flat.push(opTok(ops[i]))
  }
  // 半数样本随手套一层括号（只套一层、覆盖连续的一段操作数）
  if (Math.random() < 0.5) {
    const a = Math.floor(Math.random() * (n - 1))
    const b = a + 1 + Math.floor(Math.random() * (n - 1 - a))
    flat.splice(b * 2 + 1, 0, parenTok(")"))
    flat.splice(a * 2, 0, parenTok("("))
  }

  // 精筛：套括号后每一步仍须整除成整数，否则本样本作废
  try {
    const steps = planSteps(flat)
    if (steps.length === 0) return null
    for (const s of steps) if (!Number.isInteger(s.value)) return null
    if (!Number.isInteger(evalExpr(flat))) return null
    if (!Number.isInteger(evalByJs(flat))) return null
    return flat
  } catch {
    return null
  }
}

test("随机 3000 例：三个独立裁判必须给出同一个结果", () => {
  let checked = 0
  for (let i = 0; i < 3000; i++) {
    const t = randTokens()
    if (!t) continue
    checked += 1
    const a = evalExpr(t)
    const b = finalValue(planSteps(t))
    const c = evalByJs(t)
    assert.equal(b, a, `逐步化简与递归下降不一致：${t.map((x) => x.text).join(" ")}`)
    assert.equal(c, a, `JS 引擎与递归下降不一致：${t.map((x) => x.text).join(" ")}`)
  }
  assert.ok(checked >= 300, `有效样本太少（${checked}），随机造题被筛掉太多`)
})

test("轨迹不变量：下标合法、逐层收缩、终点只剩一个数", () => {
  let checked = 0
  for (let i = 0; i < 1200; i++) {
    const t = randTokens()
    if (!t) continue
    checked += 1
    let prev = t
    const steps = planSteps(t)
    for (const s of steps) {
      // before 必须接上上一轮的 after（轨迹是连续的，不是各算各的）
      assert.deepEqual(s.before.map((x) => x.text), prev.map((x) => x.text))
      // 下标两侧必须是数字 —— 否则动画会去「吃」括号或越界
      assert.equal(s.before[s.index].type, "op")
      assert.equal(s.before[s.index - 1].type, "num")
      assert.equal(s.before[s.index + 1].type, "num")
      // 依据必须是真的：说「级别更高」，同层就得同时存在加减
      if (s.why === "higher") {
        const level = s.before.filter((x, k) => x.type === "op" && !hasParenBetween(s.before, k, s.index))
        assert.ok(level.some((x) => !isMd(x.text)), "说是「级别更高」却找不到更低一级的运算符")
      }
      // 化简必须真的变短
      assert.ok(s.after.length < s.before.length, "化简后没有变短")
      prev = s.after
    }
    assert.equal(prev.length, 1, "轨迹终点不是单独一个数")
    assert.equal(prev[0].type, "num")
    assert.equal(Number(prev[0].text), evalExpr(t), "终点值与原算式求值不一致")
  }
  assert.ok(checked >= 150, `有效样本太少（${checked}）`)
})

/** 两个下标之间是否隔着括号边界（隔着就不同层，不参与「级别比较」） */
function hasParenBetween(tokens: PToken[], a: number, b: number): boolean {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  for (let i = lo + 1; i < hi; i++) if (tokens[i].type === "paren") return true
  return false
}
