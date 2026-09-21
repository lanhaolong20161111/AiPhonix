/** 综合算式引擎单测 — 核心判据：生成的每道题**数值必须自洽**
 *  ① 分步算式自身要算对
 *  ② 合并后的综合算式，代入求值必须等于分步结果
 *  ③ 括号判据必须与「先算顺序是否改变」一致（宁可自己重算一遍验证）
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  generateProblem,
  generateProblems,
  tokensToText,
  MISTAKE_CASES,
  KIND_LABEL,
  type CompoundProblem,
  type Token,
} from "./compoundExpr"

/** 按 token 序列求值（支持 + - × ÷ 与括号，遵循标准优先级） */
function evalTokens(tokens: Token[]): number {
  // 递归下降：先括号，再乘除，再加减
  let pos = 0
  const peek = () => tokens[pos]
  const eat = () => tokens[pos++]

  function parseExpr(): number {
    let left = parseTerm()
    while (peek() && peek().type === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = eat().text
      const right = parseTerm()
      left = op === "+" ? left + right : left - right
    }
    return left
  }
  function parseTerm(): number {
    let left = parseFactor()
    while (peek() && peek().type === "op" && (peek().text === "×" || peek().text === "÷")) {
      const op = eat().text
      const right = parseFactor()
      left = op === "×" ? left * right : left / right
    }
    return left
  }
  function parseFactor(): number {
    const t = peek()
    if (!t) throw new Error("意外的算式结束")
    if (t.text === "(") {
      eat()
      const v = parseExpr()
      const close = eat()
      assert.equal(close.text, ")")
      return v
    }
    eat()
    return Number(t.text)
  }
  const v = parseExpr()
  assert.equal(pos, tokens.length, "token 未全部消费完")
  return v
}

/** 分步算式求值 */
function evalStep(a: number, op: string, b: number): number {
  switch (op) {
    case "+": return a + b
    case "-": return a - b
    case "×": return a * b
    case "÷": return a / b
    default: throw new Error(`未知运算符 ${op}`)
  }
}

/** 单题全面校验 */
function checkProblem(p: CompoundProblem) {
  // ① 分步算式必须算对，且第②步里必须出现第①步的得数
  assert.equal(evalStep(Number(p.steps[0].a.text), p.steps[0].op, Number(p.steps[0].b.text)), p.steps[0].result,
    `[${p.kind}] 第①步算式自身算错`)
  assert.ok(Number.isInteger(p.steps[0].result), `[${p.kind}] 第①步结果非整数`)
  assert.ok(p.steps[0].result > 0, `[${p.kind}] 第①步结果非正`)

  const hasRef = p.steps[1].a.fromStep === 1 || p.steps[1].b.fromStep === 1
  assert.ok(hasRef, `[${p.kind}] 第②步没有引用第①步的得数（无法「替换」）`)

  // ② 代入第①步得数后，第②步结果必须等于记录值
  const a2 = p.steps[1].a.fromStep === 1 ? p.steps[0].result : Number(p.steps[1].a.text)
  const b2 = p.steps[1].b.fromStep === 1 ? p.steps[0].result : Number(p.steps[1].b.text)
  const r2 = evalStep(a2, p.steps[1].op, b2)
  assert.equal(r2, p.steps[1].result, `[${p.kind}] 第②步结果错（代入得数后算不出记录值）`)
  assert.ok(Number.isInteger(r2), `[${p.kind}] 第②步结果非整数`)
  assert.ok(r2 > 0, `[${p.kind}] 第②步结果非正`)

  // ③ 综合算式 token 求值必须等于最终结果（这是最重要的一条）
  const merged = evalTokens(p.merged.tokens)
  assert.equal(merged, p.merged.value, `[${p.kind}] 综合算式求值与记录值不符`)
  assert.equal(merged, r2, `[${p.kind}] 综合算式求值 ≠ 分步第②步结果`)
  assert.equal(p.answer, merged, `[${p.kind}] answer 字段与综合式求值不符`)

  // ④ 括号判据必须与「不补括号会不会算错」一致
  const bare = p.merged.tokens.filter((t) => t.type !== "paren")
  const bareVal = p.merged.parens.length > 0 ? evalTokens(bare) : merged
  if (p.how.check.needParen) {
    assert.ok(p.merged.parens.length > 0, `[${p.kind}] 判定需括号但 token 里没有括号`)
    assert.notEqual(bareVal, merged, `[${p.kind}] 判定需括号，但不加括号答案居然一样（判据可疑）`)
  } else {
    assert.equal(p.merged.parens.length, 0, `[${p.kind}] 判定不需括号但 token 里有括号`)
  }

  // ⑤ 括号必须成对且包裹完整（首个 token 与末个 token 不得只出现一半）
  const texts = p.merged.tokens.map((t) => t.text)
  const bal = texts.reduce((s, t) => s + (t === "(" ? 1 : t === ")" ? -1 : 0), 0)
  assert.equal(bal, 0, `[${p.kind}] 括号不配对`)

  // ⑥ 数值规模适合三年级（两位数以内为主）
  for (const s of p.steps) {
    assert.ok(Number(s.a.text) <= 99, `[${p.kind}] 数字过大 ${s.a.text}`)
    assert.ok(Number(s.b.text) <= 99, `[${p.kind}] 数字过大 ${s.b.text}`)
    assert.ok(s.result <= 99, `[${p.kind}] 结果过大 ${s.result}`)
  }
}

test("单题：1000 道随机生成全部数值自洽", () => {
  for (let i = 0; i < 1000; i++) {
    checkProblem(generateProblem()!) 
  }
})

test("分题型：每种题型的括号判据都正确", () => {
  const kinds = ["addsub_then_muldiv", "muldiv_then_addsub", "as_dividend", "as_subtrahend"] as const
  for (const k of kinds) {
    for (let i = 0; i < 200; i++) {
      const p = generateProblem([k])!
      assert.equal(p.kind, k, `指定题型 ${k} 却生成了 ${p.kind}`)
      checkProblem(p)
      // 题型与括号判据的固定对应关系
      if (k === "muldiv_then_addsub") {
        assert.equal(p.merged.parens.length, 0, `${k} 不该有括号`)
      } else {
        assert.ok(p.merged.parens.length > 0, `${k} 必须有括号`)
      }
    }
  }
})

test("批量生成不重复", () => {
  const ps = generateProblems(20)
  assert.equal(ps.length, 20)
  const sigs = new Set(ps.map((p) => tokensToText(p.merged.tokens)))
  assert.equal(sigs.size, 20, "批量生成出现重复题")
  for (const p of ps) checkProblem(p)
})

test("易错示例：每条都必须「错误列式 ≠ 正确列式」（否则不算对比）", () => {
  assert.ok(MISTAKE_CASES.length >= 6)
  for (const m of MISTAKE_CASES) {
    assert.ok(m.wrong.length > 0 && m.right.length > 0, `${m.title} 缺列式`)
    assert.notEqual(m.wrong, m.right, `${m.title} 错误与正确列式一模一样`)
    assert.ok(m.why.length >= 8, `${m.title} 缺原因说明`)
    assert.ok(m.tip.length >= 6, `${m.title} 缺口诀`)
  }
})

test("题型中文名齐全", () => {
  for (const k of ["addsub_then_muldiv", "muldiv_then_addsub", "as_dividend", "as_subtrahend"] as const) {
    assert.ok(KIND_LABEL[k]?.length > 0, `缺题型名 ${k}`)
  }
})

test("同一题型的判据一致性：需括号的题，去掉括号必须变值", () => {
  const withParen = generateProblems(30, ["addsub_then_muldiv"])
  for (const p of withParen) {
    const bare = p.merged.tokens.filter((t) => t.type !== "paren")
    assert.notEqual(evalTokens(bare), p.merged.value,
      `[${p.kind}] ${tokensToText(p.merged.tokens)} 去掉括号后答案不变，则不该判为「需括号」`)
  }
})

test("动画不变量：换进来的部分必须是「a op b」连续整块（含运算符）", () => {
  for (let i = 0; i < 300; i++) {
    const p = generateProblem()!
    const idx = p.merged.tokens.map((t, j) => (t.fromFirst ? j : -1)).filter((j) => j >= 0)
    assert.ok(idx.length >= 3, `[${p.kind}] fromFirst 的 token 不足 3 个（应为一整块算式）`)
    assert.equal(
      idx[idx.length - 1] - idx[0] + 1,
      idx.length,
      `[${p.kind}] fromFirst 的 token 不连续 —— 动画里「换进来的部分」会看着是碎片`,
    )
    assert.equal(p.merged.tokens[idx[0] + 1].type, "op", `[${p.kind}] 整块中间那个不是运算符`)
  }
})

test("题面规范：加法不出现重复加数（如 3 + 3）", () => {
  for (let i = 0; i < 400; i++) {
    const p = generateProblem()!
    for (const s of p.steps) {
      if (s.op === "+") {
        assert.notEqual(s.a.text, s.b.text, `[${p.kind}] 出现重复加数 ${s.a.text} + ${s.b.text}`)
      }
    }
  }
})
