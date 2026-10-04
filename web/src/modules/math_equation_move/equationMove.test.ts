/** 移项变号引擎单测 —— 核心判据：**每一步动作都必须保持等式成立**
 *
 * 两个**互相独立**的裁判给同一个数，才把「移项是合法的等价变形」从信仰变成证明：
 *   裁判 ① 自己按 term 序列算（不复用引擎的任何算术 / 判据）
 *   裁判 ② 把 term 序列拼成 JS 表达式，交给 JS 引擎算
 * 断言链：
 *   原式成立 → 每做一步都还成立 → 搬的项只是符号变了 / 换位的项符号没动 / 合并的项求值没变
 *   → x 从未被反复搬 → 末态右侧求值 === x → 而且把答案代回**原式**也成立（证明解是对的）
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  generateProblem,
  generateProblems,
  flipOp,
  effectiveOp,
  coefOf,
  sideToText,
  eqToText,
  solutionText,
  KIND_LABEL,
  KIND_TIP,
  KIND_ICON,
  KIND_GROUPS,
  RULES,
  MISTAKE_CASES,
  PRACTICE,
  buildSolveItem,
  generateSolveItems,
  type EqState,
  type MoveKind,
  type MoveProblem,
  type Op,
  type Side,
  type SolveStep,
  type Term,
} from "./equationMove"
import { mathIcon } from "../../lib/mathIcons"

// ────────────────────────────────────────────────────────────
// 裁判 ①：自己按 term 序列求值（给定 x）
// ────────────────────────────────────────────────────────────

/** 项的数值：`5x` 在 x=3 时是 15（系数必须算进去 —— 这是新题型的重点） */
function val(t: Term, x: number): number {
  return t.isVar ? coefOf(t) * x : Number(t.value)
}

function evalSide(side: Side, x: number): number {
  let acc = side[0].op === "-" ? -val(side[0], x) : val(side[0], x)
  for (let i = 1; i < side.length; i++) {
    const t = side[i]
    const v = val(t, x)
    switch (t.op) {
      case "+":
        acc += v
        break
      case "-":
        acc -= v
        break
      case "×":
        acc *= v
        break
      case "÷":
        assert.notEqual(v, 0, "除数不能为 0")
        acc /= v
        break
      default:
        assert.fail(`第 ${i} 项缺运算符：${JSON.stringify(t)}`)
    }
  }
  return acc
}

function evalState(st: EqState, x: number): [number, number] {
  return [evalSide(st.left, x), evalSide(st.right, x)]
}

const sideOf = (st: EqState, from: "left" | "right"): Side => (from === "left" ? st.left : st.right)

// ────────────────────────────────────────────────────────────
// 裁判 ②：拼成 JS 表达式，交给 JS 引擎
// ────────────────────────────────────────────────────────────

/** term → JS 片段：`5x` 必须写成 `5*x`，否则 JS 会当语法错误 */
function jsTerm(t: Term): string {
  if (!t.isVar) return t.value
  return t.value === "x" ? "x" : `${t.value.slice(0, -1)}*x`
}

function evalSideViaJs(side: Side, x: number): number {
  const src = side
    .map((t, i) => {
      const v = jsTerm(t)
      if (i === 0) return t.op === "-" ? `-(${v})` : v
      return ` ${t.op} ${v}`
    })
    .join(" ")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
  // eslint-disable-next-line no-new-func
  return new Function("x", `"use strict"; return (${src});`)(x) as number
}

/** 两路裁判必须一致。
 *  ⚠️ 裁判 ① 是**严格从左往右**算的，只在「一侧里不混优先级」时等价 ——
 *     乘除链只出现在两项的一侧（`a × x` / `b ÷ a`），其余多项目的一侧只有加减。这里把它钉住。 */
function bothAgree(side: Side, x: number, label: string) {
  assert.ok(side.length >= 1, `${label}: 一侧不该为空`)
  if (side.some((t) => t.op === "×" || t.op === "÷")) {
    assert.ok(side.length <= 2, `${label}: 乘除链只允许出现在两项的一侧，实际 ${side.length} 项`)
  }
  const a = evalSide(side, x)
  const b = evalSideViaJs(side, x)
  assert.equal(a, b, `${label}: 两路裁判不一致（自己 ${a} / JS ${b}）—— ${sideToText(side, x)}`)
  return a
}

/** 一侧的「组成」（值 + 身份），判断换位时组成有没有被改动 */
const composition = (side: Side) => side.map((t) => `${t.value}:${t.isVar}`).sort().join("|")

// ────────────────────────────────────────────────────────────
// 逐题全量校验
// ────────────────────────────────────────────────────────────

/** 各题型的动作构成（按 type 计数），把「几步、都是什么动作」钉死 */
const EXPECTED_ACTIONS: Record<MoveKind, string> = {
  plus: "move",
  minus: "move",
  times: "move",
  divide: "move",
  minusVar: "move,swap,move",
  divideVar: "move,swap,move",
  revealPlus: "swap,move",
  revealTimes: "swap,move",
  xRight: "flip,move",
  threeTerms: "move,move",
  bothSides: "swap,move,combine",
  multiStep: "move,swap,move,combine",
  sameSide: "swap",
}

/** 对一道题跑完整套判据 */
function checkProblem(p: MoveProblem, tag: string) {
  const x = p.x

  // ① 答案必须是正整数
  assert.ok(Number.isInteger(p.answer), `${tag}: 答案不是整数`)
  assert.ok(p.answer > 0, `${tag}: 答案应为正数，实际 ${p.answer}`)
  assert.equal(p.answer, p.x, `${tag}: answer 与 x 不等`)

  // ② 原等式成立（两路裁判都同意）
  const [l0, r0] = evalState(p.initial, x)
  assert.ok(Number.isInteger(l0) && Number.isInteger(r0), `${tag}: 原式出现非整数（${l0} / ${r0}）`)
  assert.equal(l0, r0, `${tag}: 原式本身不成立 —— ${eqToText(p.initial, x)}`)

  // ③ 动作构成与题型对得上
  assert.equal(
    p.actions.map((a) => a.type).join(","),
    EXPECTED_ACTIONS[p.kind],
    `${tag}: 动作构成与题型不符`,
  )

  // ④ 每一步做完，等式都必须**仍然成立**（这就是「等价变形」的证明）
  let prev: EqState = p.initial
  let varMoves = 0
  p.actions.forEach((a, k) => {
    const where = `${tag} 第${k + 1}步(${a.type})`
    assert.equal(eqToText(a.before), eqToText(prev), `${where}: before 与上一步的 after 不衔接`)

    const srcBefore = sideOf(a.before, a.from)
    const srcAfter = sideOf(a.after, a.from)

    if (a.type === "move") {
      // 符号翻转必须正好是「变相反」，而且翻转两次回到原值
      assert.equal(a.toOp, flipOp(a.fromOp), `${where}: 符号没有按规则翻转`)
      assert.equal(flipOp(flipOp(a.fromOp)), a.fromOp, `${where}: flip 不是自反的`)

      // 写了符号的项：等效符号 === 写出来的符号
      if (a.srcOp !== null) {
        assert.equal(a.srcOp, a.fromOp, `${where}: 显式符号与等效符号不符`)
      } else {
        assert.ok(
          a.fromOp === "+" || a.fromOp === "×",
          `${where}: 首项没写符号时，等效只可能是 + 或 ×，实际 ${a.fromOp}`,
        )
      }

      // 项数守恒：源侧 -1、目标侧 +1
      const dstBefore = sideOf(a.before, a.from === "left" ? "right" : "left")
      const dstAfter = sideOf(a.after, a.from === "left" ? "right" : "left")
      assert.equal(srcAfter.length, srcBefore.length - 1, `${where}: 源侧项数没减 1`)
      assert.equal(dstAfter.length, dstBefore.length + 1, `${where}: 目标侧项数没加 1`)

      // ★ 搬过去的必须是「同一块」，只有符号变
      const landed = dstAfter[dstAfter.length - 1]
      assert.equal(landed.value, a.value, `${where}: 搬过去的数值变了`)
      assert.equal(landed.isVar, a.isVar, `${where}: 搬过去的项身份变了`)
      assert.equal(landed.op, a.toOp, `${where}: 落位项的符号不对`)

      if (a.isVar) {
        varMoves++
        assert.ok(varMoves <= 1, `${where}: x 项被搬了不止一次`)
      }
    }

    if (a.type === "swap") {
      // ★ 同侧换位：符号**一点不动**，组成不变，这一侧求值不变
      assert.equal(a.toOp, a.fromOp, `${where}: 同侧换位不许改符号`)
      assert.equal(a.index2, a.index + 1, `${where}: 只支持相邻换位`)
      assert.ok(a.index2! < srcBefore.length, `${where}: 换位下标越界`)
      assert.notEqual(srcBefore[a.index2!].op, "÷", `${where}: 中间是 ÷，换位不成立`)
      assert.equal(srcAfter.length, srcBefore.length, `${where}: 换位不该改变项数`)
      assert.equal(composition(srcAfter), composition(srcBefore), `${where}: 换位不该改变这一侧的组成`)
      assert.equal(
        evalSide(srcAfter, x),
        evalSide(srcBefore, x),
        `${where}: 换位后这一侧求值变了 —— 说明不该变号的地方变号了`,
      )
    }

    if (a.type === "combine") {
      // 合并同类项：项数 -1，但这一侧求值不变；合并后的文本要能对上
      assert.equal(a.index2, a.index + 1, `${where}: 只支持相邻合并`)
      assert.equal(srcAfter.length, srcBefore.length - 1, `${where}: 合并后项数应减 1`)
      assert.equal(
        evalSide(srcAfter, x),
        evalSide(srcBefore, x),
        `${where}: 合并是「改写」不是「运算」，求值必须不变`,
      )
      assert.ok(typeof a.combined === "string" && a.combined.length > 0, `${where}: 缺合并后的文本`)
      assert.equal(srcAfter[a.index].value, a.combined, `${where}: 合并后的文本没落到位置上`)
      // 合并结果必须真的等于那两项的和
      const sum = (srcBefore[a.index].op === "-" ? -1 : 1) * coefOf(srcBefore[a.index]) +
        (srcBefore[a.index2!].op === "-" ? -1 : 1) * coefOf(srcBefore[a.index2!])
      assert.equal(coefOf(srcAfter[a.index]), sum, `${where}: 合并后的系数 ${coefOf(srcAfter[a.index])} ≠ ${sum}`)
    }

    if (a.type === "flip") {
      // 两边整体对调：左变右、右变左，内容一模一样
      assert.equal(sideToText(a.after.left), sideToText(a.before.right), `${where}: 对调后左边应等于原右边`)
      assert.equal(sideToText(a.after.right), sideToText(a.before.left), `${where}: 对调后右边应等于原左边`)
    }

    // ★ 做任何一步之后，等式都必须依然成立（两路裁判）
    const l = bothAgree(a.after.left, x, `${where} after.left`)
    const r = bothAgree(a.after.right, x, `${where} after.right`)
    assert.equal(l, r, `${where}: 做完这一步等式不成立了 —— ${eqToText(a.after, x)}`)

    prev = a.after
  })

  // ⑤ x 项最多被搬一次（不许来回搬）
  assert.ok(varMoves <= 1, `${tag}: x 项被搬了不止一次`)

  // ⑥ 末态：x 单独在一边，另一边是能算出答案的式子（且不该再留着 x）
  //    ⚠️ 同侧交换题的目标是「换位置」而不是「解出 x」—— 在各自的 test 里断言
  if (!p.isSameSide) {
    assert.equal(p.final.left.length, 1, `${tag}: 末态左边应只有一项`)
    assert.equal(p.final.left[0].isVar, true, `${tag}: 末态左边应是 x`)
    assert.equal(p.final.left[0].op, null, `${tag}: x 不应带符号`)
    assert.equal(coefOf(p.final.left[0]), 1, `${tag}: 末态左边应当是 1 个 x（不是 2x）`)
    assert.ok(p.final.right.length >= 1, `${tag}: 末态右边不该为空`)
    assert.equal(p.final.right.some((t) => t.isVar), false, `${tag}: 末态右边不该还留着 x`)
    const fin = evalSide(p.final.right, x)
    assert.equal(fin, p.answer, `${tag}: 末态右边求值 ${fin} ≠ answer ${p.answer}`)
  }

  // ⑦ ★ 把答案代回**原式**也必须成立（证明这个解是对的）
  const [lb, rb] = evalState(p.initial, p.answer)
  assert.equal(lb, rb, `${tag}: 把 x=${p.answer} 代回原式不成立 —— ${eqToText(p.initial, p.answer)}`)

  // ⑧ 数值规模 & 无退化（三年级教材范围）
  for (const side of [p.initial.left, p.initial.right, p.final.left, p.final.right]) {
    for (const t of side) {
      if (t.isVar) {
        const k = coefOf(t)
        assert.ok(Number.isInteger(k) && k >= 1 && k <= 9, `${tag}: x 的系数超范围 ${t.value}`)
        continue
      }
      const n = Number(t.value)
      assert.ok(Number.isInteger(n), `${tag}: 出现非整数项 ${t.value}`)
      assert.ok(n >= 1 && n <= 100, `${tag}: 数字超范围 ${n}`)
    }
  }
  // 乘除题：因子不许是 1（×1 / ÷1 看不出规律，是退化题）
  for (const side of [p.initial.left, p.initial.right]) {
    for (const t of side) {
      if ((t.op === "×" || t.op === "÷") && !t.isVar) {
        assert.ok(Number(t.value) >= 2, `${tag}: 乘除因子退化为 1`)
      }
    }
  }

  // ⑨ 同侧交换题：只换位置，不搬运
  if (p.isSameSide) {
    assert.equal(p.actions.filter((a) => a.type === "move").length, 0, `${tag}: 同侧交换不该有搬运`)
    assert.equal(evalSide(p.initial.left, x), evalSide(p.final.left, x), `${tag}: 同侧交换后左边求值变了`)
    assert.equal(p.answer, p.x, `${tag}: 同侧交换的 answer 应等于 x`)
  }
  // ⑩ 需要末尾对调的题（a - x = b / a ÷ x = b）
  if (p.kind === "minusVar" || p.kind === "divideVar") {
    assert.equal(p.flipSides, true, `${tag}: ${p.kind} 需要末尾左右对调`)
    assert.equal(p.actions.filter((a) => a.type === "move").length, 2, `${tag}: ${p.kind} 要搬两次`)
  } else {
    assert.equal(p.flipSides, false, `${tag}: 只有 minusVar / divideVar 需要末尾对调`)
  }
}

const ALL_KINDS: MoveKind[] = Object.keys(EXPECTED_ACTIONS) as MoveKind[]

// ────────────────────────────────────────────────────────────
// 测试
// ────────────────────────────────────────────────────────────

test("flipOp：跨过等号 ⇒ 符号变相反，且翻转两次回到原值", () => {
  assert.equal(flipOp("+"), "-")
  assert.equal(flipOp("-"), "+")
  assert.equal(flipOp("×"), "÷")
  assert.equal(flipOp("÷"), "×")
  const ops: Op[] = ["+", "-", "×", "÷"]
  for (const o of ops) assert.equal(flipOp(flipOp(o)), o)
  assert.notEqual(flipOp("+"), "×")
  assert.notEqual(flipOp("+"), "÷")
  assert.notEqual(flipOp("×"), "+")
  assert.notEqual(flipOp("×"), "-")
})

test("每种题型随机 300 道，跑完整套判据（含新题型）", () => {
  for (const kind of ALL_KINDS) {
    const list = generateProblems(300, kind)
    list.forEach((p, i) => checkProblem(p, `${kind}#${i}`))
  }
})

test("混合随机 1500 道也全部通过", () => {
  generateProblems(1500).forEach((p, i) => checkProblem(p, `mix#${i}`))
})

test("题型标签 / 提示 / 分组齐全且不重不漏", () => {
  for (const kind of ALL_KINDS) {
    assert.ok(KIND_LABEL[kind]?.length > 0, `${kind} 缺 label`)
    assert.ok(KIND_TIP[kind]?.length > 0, `${kind} 缺 tip`)
    // ★ 题型提示行左边的那个图标 —— 名字打错会安静地什么都不画
    assert.ok(mathIcon(KIND_ICON[kind]), `${kind} 的配图「${KIND_ICON[kind]}」不在 mathIcons 里`)
  }
  const grouped = KIND_GROUPS.flatMap((g) => g.kinds)
  assert.equal(new Set(grouped).size, grouped.length, "分组里出现重复题型")
  assert.deepEqual([...grouped].sort(), [...ALL_KINDS].sort(), "分组必须恰好覆盖全部题型")
})

test("★ 首项显形（revealPlus / revealTimes）：换位不改号，换完符号才露出来", () => {
  for (let i = 0; i < 200; i++) {
    for (const kind of ["revealPlus", "revealTimes"] as MoveKind[]) {
      const p = generateProblem(kind)
      const swap = p.actions[0]
      assert.equal(swap.type, "swap")
      assert.equal(swap.index, 0, "换位必须发生在首项上")
      // 换之前：首项真的没写符号（这就是那个「看不见」的坑）
      assert.equal(swap.before[swap.from][0].op, null, `${kind}: 换位前首项应当没写符号`)
      // 换位不动号
      assert.equal(swap.toOp, swap.fromOp, `${kind}: 换位不许改符号`)
      // 换之后：原来那个首项落到第二位，写上了自己的符号
      const landed = swap.after[swap.from][1]
      assert.equal(landed.value, swap.value, `${kind}: 换过来的还是同一个数`)
      assert.equal(landed.op, swap.fromOp, `${kind}: 换到后面应当写出它的等效符号`)
      // 然后再跨线变号
      const move = p.actions[1]
      assert.equal(move.type, "move")
      assert.equal(move.srcOp, swap.fromOp, `${kind}: 搬的时候它已经写在屏幕上了`)
      assert.equal(move.toOp, flipOp(swap.fromOp), `${kind}: 跨过等号才变号`)
    }
  }
})

test("★ 两边都有 x（bothSides）：先换位显形、再搬到一起、最后合并", () => {
  for (let i = 0; i < 300; i++) {
    const p = generateProblem("bothSides")
    const [swap, move, comb] = p.actions
    assert.equal(swap.type, "swap")
    assert.equal(swap.from, "right", "换位发生在右边（右边的 x 项是首项）")
    assert.equal(move.type, "move")
    assert.equal(move.isVar, true, "第二步搬的是 x 项")
    assert.equal(move.toOp, "-", "右边的 x 项搬到左边要变号")
    assert.equal(comb.type, "combine")
    assert.equal(comb.isVar, true, "合并的是两个 x 项")
    // 合并后左边只剩一个 x（系数 1）—— 这是「k - m = 1」的设计目的
    assert.equal(coefOf(p.final.left[0]), 1)
    assert.equal(p.final.right.length, 1, "右边只剩一个常数")
    assert.equal(p.answer, p.final.right[0].value ? Number(p.final.right[0].value) : -1)
  }
})

test("★ 多项多步（multiStep）：搬常数 → 移 x → 合并，顺序不能乱", () => {
  for (let i = 0; i < 300; i++) {
    const p = generateProblem("multiStep")
    const kinds = p.actions.map((a) => a.type).join(",")
    assert.equal(kinds, "move,swap,move,combine")
    assert.equal(p.actions[0].isVar, false, "第一步先搬常数")
    assert.equal(p.actions[0].from, "left")
    assert.equal(p.actions[0].toOp, "-")
    assert.equal(p.actions[1].type, "swap")
    assert.equal(p.actions[1].from, "right")
    assert.equal(p.actions[2].isVar, true, "第三步才搬 x 项")
    assert.equal(p.actions[3].type, "combine")
    // 末态右边是「常数 - 常数」，两项都是数
    assert.equal(p.final.right.length, 2)
    assert.equal(p.final.right.every((t) => !t.isVar), true)
  }
})

test("★ x 在等号右边（xRight）：先对调，再照常搬", () => {
  for (let i = 0; i < 200; i++) {
    const p = generateProblem("xRight")
    assert.equal(p.actions[0].type, "flip", "第一步是两边整体对调")
    assert.equal(p.initial.left.some((t) => t.isVar), false, "原式里 x 不在左边")
    assert.equal(p.initial.right[0].isVar, true, "原式里 x 在右边（首项）")
    assert.equal(p.actions[1].type, "move")
    assert.equal(p.actions[1].toOp, "-")
    assert.equal(eqToText(p.initial), `${p.initial.left[0].value} = x + ${p.initial.right[1].value}`)
  }
})

test("★ 一边多项（threeTerms）：连着搬两次，每次都是「+ 变 -」", () => {
  for (let i = 0; i < 200; i++) {
    const p = generateProblem("threeTerms")
    assert.equal(p.initial.left.length, 3)
    assert.equal(p.initial.left[0].isVar, true)
    for (const a of p.actions) {
      assert.equal(a.type, "move")
      assert.equal(a.srcOp, "+")
      assert.equal(a.toOp, "-")
    }
    assert.equal(p.final.right.length, 3, "右边攒下 3 项：b - a - c")
    assert.equal(p.final.right[0].isVar, false)
  }
})

test("★ 同侧交换：值不变、且符号确实没动", () => {
  for (let i = 0; i < 200; i++) {
    const p = generateProblem("sameSide")
    assert.equal(p.initial.left[0].isVar, false)
    assert.equal(p.initial.left[1].isVar, true)
    assert.equal(p.final.left[0].isVar, true)
    assert.equal(p.final.left[1].isVar, false)
    assert.equal(p.initial.left[1].op, "+")
    assert.equal(p.final.left[1].op, "+")
    assert.equal(sideToText(p.initial.right), sideToText(p.final.right))
    // 唯一那一步就是换位，而且它是「符号零变化」—— 与 sameSide 的定义互证
    assert.equal(p.actions.length, 1)
    assert.equal(p.actions[0].type, "swap")
    assert.equal(p.actions[0].toOp, p.actions[0].fromOp)
  }
})

test("★ 加减法 vs 乘除法：跨过去变的是「同类相反」，不能串门", () => {
  for (let i = 0; i < 200; i++) {
    const movesOf = (k: MoveKind) => generateProblem(k).actions.filter((a) => a.type === "move")
    assert.equal(movesOf("plus")[0].toOp, "-", "加数过去必须变减")
    assert.equal(movesOf("minus")[0].toOp, "+", "减数过去必须变加")
    assert.equal(movesOf("times")[0].toOp, "÷", "乘数过去必须变除")
    assert.equal(movesOf("divide")[0].toOp, "×", "除数过去必须变乘")
    assert.equal(movesOf("revealPlus")[0].toOp, "-", "显形后的加数过去变减")
    assert.equal(movesOf("revealTimes")[0].toOp, "÷", "显形后的因数过去变除")
  }
})

test("★ 两步题：第一步搬 -x / ÷x，第二步搬那个数（中间夹一次换位显形）", () => {
  for (let i = 0; i < 200; i++) {
    const mv = generateProblem("minusVar")
    const mvMoves = mv.actions.filter((a) => a.type === "move")
    assert.equal(mvMoves[0].value, "x", "a - x 的第一步必须先把 -x 整块搬走")
    assert.equal(mvMoves[0].fromOp, "-")
    assert.equal(mvMoves[0].toOp, "+")
    // 第二步里那个数原本是首项（屏幕上不写符号）—— 换位显形之后才搬
    assert.equal(mv.actions[1].type, "swap", "第二步之前先同侧换位显形")
    assert.equal(mvMoves[1].srcOp, "+", "换位后它已经写上符号了")
    assert.equal(mvMoves[1].fromOp, "+")
    assert.equal(mvMoves[1].toOp, "-")

    const dv = generateProblem("divideVar")
    const dvMoves = dv.actions.filter((a) => a.type === "move")
    assert.equal(dvMoves[0].value, "x", "a ÷ x 的第一步必须先把 ÷x 整块搬走")
    assert.equal(dvMoves[0].fromOp, "÷")
    assert.equal(dvMoves[0].toOp, "×")
    assert.equal(dv.actions[1].type, "swap")
    assert.equal(dvMoves[1].srcOp, "×", "换位后它已经写上「×」了")
    assert.equal(dvMoves[1].fromOp, "×")
    assert.equal(dvMoves[1].toOp, "÷")
  }
})

test("★ 首项没写符号 ≠ 没有符号：等效符号必须算得出来", () => {
  // `5 + x` 的 5 ⇒ +    ·    `4 × x` 的 4 ⇒ ×    ·    `15 - x` 的 15 ⇒ +
  assert.equal(effectiveOp([{ op: null, value: "5", isVar: false }, { op: "+", value: "x", isVar: true }], 0), "+")
  assert.equal(effectiveOp([{ op: null, value: "4", isVar: false }, { op: "×", value: "x", isVar: true }], 0), "×")
  assert.equal(effectiveOp([{ op: null, value: "15", isVar: false }, { op: "-", value: "x", isVar: true }], 0), "+")
  // `5x` 是**一个**加数，不是「5 乘 x」—— 等效符号仍是 +
  assert.equal(effectiveOp([{ op: null, value: "5x", isVar: true }], 0), "+")

  for (let i = 0; i < 200; i++) {
    const mv = generateProblem("minusVar")
    const s1 = mv.actions[0]
    assert.equal(s1.srcOp, "-", "屏幕上写的是 -x")
    assert.equal(s1.toOp, "+", "- 跨过等号要变成 +")

    // 那个「看不见符号」的项，在换位之前 srcOp 必须是 null
    const hidden = mv.actions[1]
    assert.equal(hidden.type, "swap")
    assert.equal(hidden.before[hidden.from][0].op, null, "它就是那个没写符号的首项")
  }
})

test("文本输出：文本形式与原式语义一致", () => {
  for (const kind of ALL_KINDS) {
    const p = generateProblem(kind)
    const txt = eqToText(p.initial)
    assert.ok(txt.includes("="), `${kind}: 等式文本缺等号`)
    // 文本里 x 的个数与原式里的未知数项一致（`5x` 也算一个）
    const xCount = (txt.match(/x/g) ?? []).length
    const varCount = [...p.initial.left, ...p.initial.right].filter((t) => t.isVar).length
    assert.equal(xCount, varCount, `${kind}: x 个数对不上 —— ${txt}`)
  }
  const p = generateProblem("plus")
  assert.match(solutionText(p), /^x = \d+ - \d+ = \d+$/)
  // 系数要写进文本：3x ⇒ "3x"，1x ⇒ "x"
  assert.equal(sideToText([{ op: null, value: "3x", isVar: true }]), "3x")
  assert.equal(sideToText([{ op: null, value: "x", isVar: true }]), "x")
  // 代入 x 时系数必须算进去（否则验算会静默错）
  assert.equal(sideToText([{ op: null, value: "3x", isVar: true }], 4), "12")
})

test("静态资料：口诀 / 易错卡 / 对比练习都齐且自洽", () => {
  assert.ok(RULES.length >= 3, "口诀至少要三块")
  for (const r of RULES) {
    assert.ok(r.title.length > 0 && r.lines.length > 0)
    // ★ 配图键打错的话渲染件会安静地什么都不画 ⇒ 这里当场拦住
    assert.ok(mathIcon(r.icon), `口诀「${r.title}」的配图「${r.icon}」不在 mathIcons 里`)
  }
  // 首项显形这条规律必须写进口诀里
  assert.ok(
    RULES.some((r) => r.lines.some((l) => l.includes("不写符号"))),
    "口诀里要讲清「首项不写符号」这件事",
  )

  assert.ok(MISTAKE_CASES.length >= 5, "易错卡至少 5 张（新增了首项显形与合并同类项两张）")
  for (const m of MISTAKE_CASES) {
    assert.notEqual(m.wrong, m.right, "错例与对例不能相同")
    assert.ok(m.wrong.includes("⇒") && m.right.includes("⇒"))
  }

  assert.equal(PRACTICE.length, 4)
  for (const item of PRACTICE) {
    assert.equal(item.answer, flipOp(item.sym), `练习「${item.before}」的答案符号不对`)
    assert.ok(item.result.includes(String(item.num)))
  }
  assert.deepEqual(
    PRACTICE.map((p) => `${p.sym}→${p.answer}`).sort(),
    ["+→-", "-→+", "×→÷", "÷→×"].sort(),
  )
})

test("★ 对比练习逐题验算：结果里的等式代回去必须成立", () => {
  const expected = [
    { before: "x + 8 = 14", x: 6, lhs: 6 + 8, rhs: 14 },
    { before: "x - 8 = 14", x: 22, lhs: 22 - 8, rhs: 14 },
    { before: "x × 8 = 16", x: 2, lhs: 2 * 8, rhs: 16 },
    { before: "x ÷ 8 = 16", x: 128, lhs: 128 / 8, rhs: 16 },
  ]
  PRACTICE.forEach((item, i) => {
    assert.equal(item.before, expected[i].before)
    assert.equal(expected[i].lhs, expected[i].rhs, `练习「${item.before}」的解代回去不成立`)
    assert.ok(item.result.includes(`= ${expected[i].x}`), `练习「${item.before}」的答案应为 ${expected[i].x}`)
  })
})

test("★ 易错卡逐题验算：把正确解代回变形式，错的必须真的不成立", () => {
  // ① 2 + x = 8 ⇒ 原式的解是 6
  assert.equal(2 + 6, 8, "2 + 6 = 8，原式的解就是 6")
  assert.notEqual(6 - 2, 8, "把 6 代回错式「x - 2 = 8」：6 - 2 = 4 ≠ 8 ⇒ 确实错了")
  assert.equal(6 + 2, 8, "把 6 代回对式「x + 2 = 8」成立")

  // ② x - 6 = 10 ⇒ 原式的解是 16；错式误算出 x = 10 - 6 = 4
  assert.equal(16 - 6, 10, "原式的解是 16")
  assert.notEqual(4 - 6, 10, "把错解 4 代回原式：4 - 6 = -2 ≠ 10 ⇒ 确实错了")

  // ③ 10 - x = 3 ⇒ 原式的解是 7；错式误算出 x = 3 - 10 = -7
  assert.equal(10 - 7, 3, "原式的解是 7")
  assert.notEqual(10 - (3 - 10), 3, "把错解 -7 代回原式：10 - (-7) = 17 ≠ 3 ⇒ 确实错了")
  assert.equal(10 - 3, 7, "对式「x = 10 - 3」算出 7")

  // ④ 5 + x = 12 ⇒ 解是 7；错式误算出 12 + 5 = 17（首项其实带着 +）
  assert.equal(5 + 7, 12, "原式的解是 7")
  assert.notEqual(12 + 5, 7, "12 + 5 = 17 ≠ 7 ⇒ 确实错了")
  assert.equal(12 - 5, 7, "对式「x = 12 - 5」算出 7")

  // ⑤ 5x = 3x + 6 ⇒ x = 3；错式 5x + 3x 会算出 8x
  assert.equal(5 * 3, 3 * 3 + 6, "原式的解是 3")
  assert.notEqual(5 * 3 + 3 * 3, 6, "5*3 + 3*3 = 24 ≠ 6 ⇒ 确实错了")
  assert.equal(5 * 3 - 3 * 3, 6, "对式「5x - 3x = 6」成立")

  assert.ok(MISTAKE_CASES[0].wrong.includes("x - 2 = 8"))
  assert.ok(MISTAKE_CASES[1].right.includes("10 + 6"))
  assert.ok(MISTAKE_CASES[2].right.includes("10 - 3"))
  assert.ok(MISTAKE_CASES[3].right.includes("12 - 5"))
  assert.ok(MISTAKE_CASES[4].right.includes("5x - 3x = 6"))
})

test("★ 教材范围：加减法结果 ≤ 20，乘法都在表内（≤ 81）", () => {
  for (let i = 0; i < 800; i++) {
    const p = generateProblem()
    for (const side of [p.initial.left, p.initial.right]) {
      for (const t of side) {
        if (t.isVar) continue
        const n = Number(t.value)
        if (p.kind === "times" || p.kind === "divide" || p.kind === "divideVar" || p.kind === "revealTimes") {
          assert.ok(n <= 81, `${p.kind}: ${n} 超出表内乘法范围`)
        } else {
          assert.ok(n <= 20, `${p.kind}: ${n} 超出 20 以内范围`)
        }
      }
    }
  }
})

// ────────────────────────────────────────────────────────────
// 分步解方程练习（默认 6 道）：每一步都必须是一次**等价变形**
// ────────────────────────────────────────────────────────────

/** 把「等式文本」拼成 JS 表达式并代 x 进去（裁判 ② 的快捷版；`5x` 要写成 `5*x`） */
function holdsAt(expr: string, xVal: number): boolean {
  const js = expr
    .replace(/(\d)x/g, "$1*x")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/=/g, "===")
  // eslint-disable-next-line no-new-func
  return (new Function("x", `"use strict"; return ${js};`) as (v: number) => boolean)(xVal)
}

/** 一个状态在 x 处必须仍是**真等式**（左右两边求值相等）—— 返回两侧的值 */
function stateHolds(st: EqState, xVal: number, label: string): [number, number] {
  assert.ok(st.left.length > 0 && st.right.length > 0, `${label}: 两侧都不该被搬空`)
  const l = bothAgree(st.left, xVal, `${label} 左边`)
  const r = bothAgree(st.right, xVal, `${label} 右边`)
  assert.equal(l, r, `${label}: 等式不成立（${l} ≠ ${r}）`)
  return [l, r]
}

/** ★★ 全页最核心的判据 —— 四种动作在数值上分成两类：
 *   · move（跨等号）：**两侧的值都会变**（这正是「搬运」的含义），但等式照样成立
 *   · swap / combine / flip（同侧）：**两侧的值一分不动**，只有写法变了
 *  换句话说：学生只要用「数值变没变」就能替我们判「这一步到底跨没跨等号线」。 */
function stepKeepsValue(step: SolveStep, xVal: number, label: string) {
  const before = stateHolds(step.before, xVal, `${label} 变形前`)
  const after = stateHolds(step.after, xVal, `${label} 变形后`)
  if (step.type === "move") {
    assert.notDeepEqual(after, before, `${label}: 搬运之后两侧的数值应当都变了（否则等于没搬）`)
  } else {
    assert.deepEqual(after, before, `${label}: 同侧动作（换位/合并/对调）不许改变任何一侧的数值`)
  }
}

/** 逐条校验一步的全部字段（选项、答案、文案、与动作类型的一致性） */
function checkStep(it: { kindLabel: string }, step: SolveStep, k: number) {
  const label = `${it.kindLabel} 第 ${k + 1} 步(${step.type})`
  assert.ok(step.ask.length > 0, `${label}: 缺问法`)
  assert.ok(step.why.length > 0, `${label}: 缺「为什么」`)
  assert.ok(step.wrongTip.length > 0, `${label}: 缺答错提示`)
  assert.ok(step.options.length >= 2, `${label}: 选项太少`)
  assert.equal(new Set(step.options).size, step.options.length, `${label}: 选项有重复`)
  assert.ok(step.options.includes(step.answer), `${label}: 正确答案「${step.answer}」不在选项里`)

  if (step.type === "move") {
    const a = step.action
    assert.ok(a, `${label}: 搬运步必须带上原始动作（卡片要照着它演动画）`)
    assert.equal(a.type, "move")
    assert.equal(a.toOp, flipOp(a.fromOp), `${label}: 跨线必须翻符号`)
    assert.notEqual(step.answer, "不变", `${label}: 跨线步的答案不能是「不变」`)
    assert.equal(step.answer, `${a.toOp}${a.value}`, `${label}: 答案文本与动作不符`)
  } else if (step.type === "solve") {
    assert.ok(step.options.every((o) => /^\d+$/.test(o)), `${label}: 「算出来」的选项应当是纯数字`)
    if (step.trapAnswer) {
      assert.ok(step.options.includes(step.trapAnswer), `${label}: 「忘变号」陷阱项必须在选项里`)
      assert.ok(step.trapTip, `${label}: 有陷阱项就该有对应的点破话术`)
    }
  } else {
    // swap / combine / flip：一个字节都不跨等号线 ⇒ 答案必须是「不变」
    assert.equal(step.answer, "不变", `${label}: 同侧动作不能变号`)
    assert.ok(step.options.includes("不变"), `${label}: 同侧动作的选项里必须有「不变」`)
    if (step.type === "swap") assert.equal(step.action?.type, "swap")
  }
}

/** 四个「变号」+ 一个「不变」—— 卡片上按这个顺序渲染 */
const OP_OPTIONS = ["+", "-", "×", "÷", "不变"]

test("★ 分步练习：一步步首尾相接 —— 第一步就是原式，最后一步落回 final", () => {
  for (let round = 0; round < 200; round++) {
    const items = generateSolveItems()
    assert.equal(items.length, 6, "默认应生成 6 道")
    for (const it of items) {
      assert.ok(it.steps.length >= 1, `${it.kindLabel}: 至少要有一问`)
      assert.deepEqual(it.steps[0].before, it.initial, `${it.kindLabel}: 第一步不是从原式开始`)
      assert.deepEqual(
        it.steps[it.steps.length - 1].after,
        it.final,
        `${it.kindLabel}: 最后一步没落回最终形态`,
      )
      // 首尾相接：第 k 步做完的样子，必须**逐字段等于**第 k+1 步开始的样子
      for (let k = 0; k + 1 < it.steps.length; k++) {
        assert.deepEqual(
          it.steps[k].after,
          it.steps[k + 1].before,
          `${it.kindLabel}: 第 ${k + 2} 步接不上第 ${k + 1} 步`,
        )
      }
      // 「算出来」只该出现在最后，且与 solved 一致
      const solveAt = it.steps.map((s, i) => (s.type === "solve" ? i : -1)).filter((i) => i >= 0)
      assert.equal(solveAt.length, it.solved ? 1 : 0, `${it.kindLabel}: 「算出来」的步数与 solved 不符`)
      if (solveAt.length) {
        assert.equal(solveAt[0], it.steps.length - 1, `${it.kindLabel}: 「算出来」必须是最后一步`)
      }
    }
  }
})

test("★ 分步练习：每一步都是等价变形 + 每一步的答案都跟「跨没跨等号线」严格一致", () => {
  // ★ 13 种题型逐个扫（确定性地覆盖到 threeTerms / bothSides / multiStep 这些结构题型）
  for (const kind of Object.keys(KIND_LABEL) as MoveKind[]) {
    for (let i = 0; i < 40; i++) {
      const it = buildSolveItem(kind)
      assert.equal(it.kind, kind)
      for (const [k, step] of it.steps.entries()) {
        stepKeepsValue(step, it.x, `${kind} 第 ${k + 1} 步(${step.type})`)
        checkStep(it, step, k)
      }
    }
  }
  // 随机练习组同样逐条扫
  for (let round = 0; round < 120; round++) {
    for (const it of generateSolveItems()) {
      for (const [k, step] of it.steps.entries()) {
        stepKeepsValue(step, it.x, `${it.kindLabel} 第 ${k + 1} 步(${step.type})`)
        checkStep(it, step, k)
      }
      // 符号步的选项顺序固定：四个变号 + 一个「不变」
      for (const step of it.steps) {
        if (step.type === "solve") continue
        assert.deepEqual(
          step.options.map((o) => (o === "不变" ? "不变" : o[0])),
          OP_OPTIONS,
          `${it.kindLabel}: 符号步的选项应当是「+ - × ÷ 不变」`,
        )
      }
    }
  }
})

test("★ 分步练习：4 条基本规律每轮必出、多步题必出、同侧反例必出", () => {
  const STEP_KINDS: MoveKind[] = [
    "minusVar",
    "divideVar",
    "revealPlus",
    "revealTimes",
    "xRight",
    "threeTerms",
    "bothSides",
    "multiStep",
  ]
  for (let round = 0; round < 200; round++) {
    const kinds = generateSolveItems().map((it) => it.kind)
    for (const k of ["plus", "minus", "times", "divide"] as MoveKind[]) {
      assert.equal(kinds.filter((x) => x === k).length, 1, `第 ${round} 轮「${k}」应当正好 1 道`)
    }
    assert.ok(kinds.some((k) => STEP_KINDS.includes(k)), `第 ${round} 轮缺「要多步才解得完」的题`)
    assert.equal(
      kinds.filter((k) => k === "sameSide").length,
      1,
      `第 ${round} 轮「同侧不变号」反例应当正好 1 道`,
    )
    assert.equal(kinds.length, 6)
  }
})

test("★ 分步练习：同侧反例题只演一步、不解方程", () => {
  for (let i = 0; i < 60; i++) {
    const it = buildSolveItem("sameSide")
    assert.equal(it.solved, false, "同侧反例题不该声称解出了 x")
    assert.equal(it.steps.length, 1, "同侧反例题只演一步")
    assert.equal(it.steps[0].type, "swap")
    assert.equal(it.steps[0].answer, "不变")
    assert.ok(it.finalNote.includes("同一侧"), "收尾文案要点明「同一侧换位不变号」")
    // 它确实**没有**把 x 解出来 —— 末态的 x 不孤单，还得再跨一次线
    assert.ok(
      it.final.left.length + it.final.right.length > 1,
      "同侧反例题的末态不该已经只剩「x = 一个数」",
    )
  }
})

test("★ 分步练习：把答案代回原式成立（两个独立裁判各算一遍）", () => {
  const check = (it: ReturnType<typeof buildSolveItem>) => {
    // 裁判 ①：按 term 序列自己算
    const [l1, r1] = evalState(it.initial, it.answer)
    assert.equal(l1, r1, `${it.kindLabel}: x=${it.answer} 代回原式不成立（自己算：${l1} ≠ ${r1}）`)
    // 裁判 ②：拼成 JS 表达式交给 JS 引擎
    assert.ok(
      holdsAt(eqToText(it.initial), it.answer),
      `${it.kindLabel}: x=${it.answer} 代回原式不成立（JS 裁判）`,
    )
    if (it.solved) {
      assert.equal(it.final.left.length, 1, `${it.kindLabel}: 解出来后左边应当只剩 x`)
      assert.ok(it.final.left[0].isVar, `${it.kindLabel}: 解出来后左边的幸存项应当就是 x`)
      assert.equal(it.solution, `x = ${sideToText(it.final.right)} = ${it.answer}`)
      assert.equal(it.steps[it.steps.length - 1].answer, String(it.answer))
    }
  }
  for (const kind of Object.keys(KIND_LABEL) as MoveKind[]) {
    for (let i = 0; i < 40; i++) check(buildSolveItem(kind))
  }
  for (let round = 0; round < 120; round++) for (const it of generateSolveItems()) check(it)
})

test("★ 分步练习：数值都在小学口算范围内（加减 ≤ 20、乘除 ≤ 81）", () => {
  const MAX: Partial<Record<MoveKind, number>> = {
    times: 81,
    divide: 81,
    divideVar: 81,
    revealTimes: 81,
  }
  for (let round = 0; round < 200; round++) {
    for (const it of generateSolveItems()) {
      const cap = MAX[it.kind] ?? 20
      for (const side of [it.initial.left, it.initial.right, it.final.left, it.final.right]) {
        for (const t of side) {
          if (t.isVar) continue
          assert.ok(
            Number(t.value) <= cap,
            `${it.kindLabel}: ${t.value} 超出「${cap} 以内」范围`,
          )
        }
      }
      assert.ok(it.answer >= 2 && it.answer <= 81, `${it.kindLabel}: 解 ${it.answer} 越界`)
      assert.ok(Number.isInteger(it.answer), `${it.kindLabel}: 解必须是整数`)
    }
  }
})

test("★ 分步练习：换一组会真的换（不是每次都同一套）", () => {
  const seen = new Set<string>()
  for (let i = 0; i < 40; i++) {
    seen.add(generateSolveItems().map((it) => eqToText(it.initial)).join(" | "))
  }
  assert.ok(seen.size > 5, `40 轮只出现 ${seen.size} 种题组 —— 随机性不足`)
})

test("★ 分步练习：题目数量参数 n < 6 时按顺序退让，不会越界", () => {
  for (let round = 0; round < 100; round++) {
    for (const n of [1, 2, 4, 5, 6, 8, 12]) {
      const items = generateSolveItems(n)
      assert.equal(items.length, n, `n=${n} 时应当正好生成 ${n} 道`)
      if (n >= 4) {
        const kinds = new Set(items.map((it) => it.kind))
        for (const k of ["plus", "minus", "times", "divide"] as MoveKind[]) {
          assert.ok(kinds.has(k), `n=${n} 缺 ${k}`)
        }
      }
    }
  }
})
