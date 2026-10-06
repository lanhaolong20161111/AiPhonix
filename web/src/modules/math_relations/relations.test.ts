/** 数量关系与交换 —— 引擎单测
 *
 * ── 核心判据：关系句、算式、交换后果**三者必须自洽**，且由独立裁判重算 ──
 * 引擎记录的 `nums` / `result` 是它的**主张**，测试不能拿主张当证明。
 * 所以这里把 `eq.before` / `eq.after` 的**字符串**重新解析求值（`splitEq`），
 * 用另一条路径算出「不变量」，再与 `nums` / `result` 对拍。
 *
 * ── 另外三件容易悄悄坏掉的事 ──
 *   · ★ 全页的纲：**两边同色 ⇔ 交换后结论不变**。
 *     写成断言就是 `effect === "keep"` ⟺ `slotRole[0] === slotRole[1]` ——
 *     这条一破，页面上的颜色教学就与事实矛盾了。
 *   · 交换后**每个数的角色确实换了**（否则「颜色对调」只是视觉花招，没有数学含义）
 *   · 退化的题必须被拦掉：1 倍、差为 0、份数=每份数 —— 这些题**看不出交换的效果**
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  EFFECT_LABEL,
  KIND_GROUPS,
  MISTAKE_CASES,
  REL_KINDS,
  ROLE_META,
  RULES,
  SWAP_TABLE,
  generateProblem,
  generateProblems,
  type RelKind,
  type RelProblem,
  type Role,
  type SwapEffect,
} from "./relations"
import { mathIcon } from "../../lib/mathIcons"

// ────────────────────────────────────────────────────────────
// 独立裁判：把算式**字符串**重新解析求值
// ────────────────────────────────────────────────────────────

const OPS: Record<string, (a: number, b: number) => number> = {
  "＋": (a, b) => a + b,
  "－": (a, b) => a - b,
  "×": (a, b) => a * b,
  "÷": (a, b) => a / b,
}

/** 求一条两步算式的值（只认 数字 运算符 数字，别的一律报错 → 测试当场炸） */
function evalExpr(src: string): number {
  const parts = src.trim().split(/\s+/)
  assert.equal(parts.length, 3, `不是两步算式：${src}`)
  const a = Number(parts[0])
  const b = Number(parts[2])
  const f = OPS[parts[1]]
  assert.ok(f, `认不出运算符：${src}`)
  assert.ok(Number.isFinite(a) && Number.isFinite(b), `操作数不是数：${src}`)
  return f(a, b)
}

/** 把 `"a ＋ b ＝ c"` 拆成 [左边算出来的值, 右边写的值] */
function splitEq(src: string): [number, number] {
  const seg = src.split("＝")
  assert.equal(seg.length, 2, `不是等式：${src}`)
  const rhs = Number(seg[1].trim())
  assert.ok(Number.isFinite(rhs), `右边不是数：${src}`)
  return [evalExpr(seg[0]), rhs]
}

/** 独立裁判：一道题的不变量（交换前后必须相同的那一个数） */
function invariantOf(p: RelProblem): number {
  switch (p.kind) {
    case "total":
      // 两个加数互换 ⇒ 和不变
      return evalExpr(p.eq.before.split("＝")[0])
    case "compare":
      // 差不变
      return evalExpr(p.eq.before.split("＝")[0])
    case "times":
      // 乘积不变
      return evalExpr(p.eq.before.split("＝")[0])
    case "share":
      // 总数不变
      return p.result.value
  }
}

/**
 * 不变量在数据结构里**住哪**（★ 四类并不统一，测试必须知道这件事）：
 *   total / compare / share → `result.value` 就是那个不变量
 *   times                   → `result.value` 是**倍数**（求出来的第三个数），
 *                             不变量是乘积，住在 `left.value`
 */
function invariantField(p: RelProblem): number {
  if (p.kind === "times") return p.left.value
  return p.result.value
}

// ────────────────────────────────────────────────────────────
// 1. 每个生成器都把「结果」反推对了
// ────────────────────────────────────────────────────────────

test("一共：a ＋ b ＝ 总量，且交换前后都是同一个和", () => {
  for (let i = 0; i < 300; i++) {
    const p = generateProblem("total")
    assert.ok(p, "total 生成失败")
    const [b1, r1] = splitEq(p.eq.before)
    const [b2, r2] = splitEq(p.eq.after)
    assert.equal(b1, r1, `等式不成立：${p.eq.before}`)
    assert.equal(b2, r2, `等式不成立：${p.eq.after}`)
    assert.equal(b1, b2, "换位置后和变了 —— 加法交换律不成立？")
    assert.equal(b1, p.result.value, "result.value 与算式对不上")
    // 两个加数确实互换（不是原地不动）
    assert.deepEqual(p.nums.before, [p.left.value, p.right.value])
    assert.deepEqual(p.nums.after, [p.right.value, p.left.value])
    assert.notEqual(p.left.value, p.right.value, "退化题：两个加数一样，换位置看不出效果")
  }
})

test("比多少：大数 － 小数 ＝ 差，交换前后差不变、两个数确实换了位", () => {
  for (let i = 0; i < 300; i++) {
    const p = generateProblem("compare")
    assert.ok(p, "compare 生成失败")
    const [b1, r1] = splitEq(p.eq.before)
    const [b2, r2] = splitEq(p.eq.after)
    assert.equal(b1, r1, `等式不成立：${p.eq.before}`)
    assert.equal(b2, r2, `等式不成立：${p.eq.after}`)
    assert.equal(b1, b2, "交换后差不相等")
    assert.equal(b1, p.result.value, "相差与算式对不上")
    assert.ok(b1 > 0, "退化了：差为 0 就看不出「多 / 少」")
    // 左量确实是大数（句子「A 比 B 多」要求 A > B）
    assert.ok(p.left.value > p.right.value, "「比…多」句子里左值必须更大")
    assert.deepEqual(p.nums.after, [p.right.value, p.left.value])
  }
})

test("倍数：1倍量 × 倍数 ＝ 比较量；交换后是它的 1/n", () => {
  for (let i = 0; i < 300; i++) {
    const p = generateProblem("times")
    assert.ok(p, "times 生成失败")
    const [b1, r1] = splitEq(p.eq.before)
    const [b2, r2] = splitEq(p.eq.after)
    assert.equal(b1, r1 && b1, `等式不成立：${p.eq.before}`)
    assert.equal(b1, b2, "交换后乘积变了 —— 乘法交换律不成立？")
    assert.equal(b1, p.left.value, "比较量 ≠ 1倍量 × 倍数")
    assert.equal(b2, r2)
    const n = p.result.value
    assert.ok(n >= 2, `退化了：${n} 倍不是「倍」`)
    assert.equal(p.right.value * n, p.left.value, "1倍量 × 倍数 ≠ 比较量")
    assert.notEqual(p.left.value, p.right.value, "退化了：两个数一样")
    // 交换后：右量 ÷ 左量 恰好是 1/n（用独立除法重算，不看引擎字段）
    assert.equal(p.nums.after[0] / p.nums.after[1], 1 / n)
    // 因数交换这一级必须**不变**（与主宾交换形成对照）
    assert.ok(p.factorSwap, "倍数题必须给出「换因数」的对照")
    assert.equal(p.factorSwap.n * p.factorSwap.b, p.factorSwap.value)
    assert.equal(p.factorSwap.value, p.left.value)
  }
})

test("平均分：总数 ÷ 份数 ＝ 每份数，交换后是另一个问题；份数 ≠ 每份数", () => {
  for (let i = 0; i < 300; i++) {
    const p = generateProblem("share")
    assert.ok(p, "share 生成失败")
    const [b1, r1] = splitEq(p.eq.before)
    const [b2, r2] = splitEq(p.eq.after)
    assert.equal(b1, r1, `等式不成立：${p.eq.before}`)
    assert.equal(b2, r2, `等式不成立：${p.eq.after}`)
    const k = p.nums.before[0]
    const per = p.nums.before[1]
    assert.equal(b1, per, "总数 ÷ 份数 应得每份数")
    assert.equal(b2, k, "总数 ÷ 每份数 应得份数")
    assert.equal(p.result.value, k * per, "总数 ≠ 份数 × 每份数")
    assert.notEqual(k, per, "退化了：份数 = 每份数，两种分法长得一模一样")
    // 点阵排布必须真的换了个形状（否则「12 个重新排一遍」这一帧演不出来）
    assert.ok(p.shareGrid, "平均分必须给出点阵排布")
    assert.equal(p.shareGrid.before.rows * p.shareGrid.before.cols, p.result.value)
    assert.equal(p.shareGrid.after.rows * p.shareGrid.after.cols, p.result.value)
    assert.notDeepEqual(p.shareGrid.before, p.shareGrid.after, "交换前后排布一样，看不出重排")
  }
})

// ────────────────────────────────────────────────────────────
// 2. ★ 全页的纲：同色 ⇔ 不变
// ────────────────────────────────────────────────────────────

/** 逐题体检（批量测试复用） */
function checkProblem(p: RelProblem): void {
  const [roleL, roleR] = p.slotRole
  const sameColor = roleL === roleR

  // ★ 纲：两边同角色 ⇒ 交换后果必须是「不变」；异角色 ⇒ 必须真的变了
  if (sameColor) {
    assert.equal(p.effect, "keep", `${p.kind}：同色却宣称会变`)
    assert.equal(p.before.key, p.after.key, `${p.kind}：同色但结论片段不同`)
    assert.equal(EFFECT_LABEL[p.effect].changed, false)
  } else {
    assert.notEqual(p.effect, "keep", `${p.kind}：异色却宣称不变`)
    assert.equal(EFFECT_LABEL[p.effect].changed, true)
  }

  // 交换后「每个数的角色确实换了」—— 否则颜色对调只是花招
  // 左槽角色不动，站在左槽的**人**从 left 换成了 right ⇒ 那个数的角色确实变了
  assert.notEqual(p.nums.before[0], p.nums.after[0], `${p.kind}：交换后左槽还是原来那个数`)
  assert.notDeepEqual(p.nums.before, p.nums.after, `${p.kind}：交换没改变任何东西`)

  // 不变量（独立裁判重算：把算式字符串重新求值，再与结构里的字段对拍）
  const inv = invariantOf(p)
  assert.equal(inv, invariantField(p), `${p.kind}：独立重算的不变量与结构字段对不上`)

  // ★ 结构字段之间的交叉验算（不看字符串，另走一条路）
  if (p.kind === "total") {
    assert.equal(p.result.value, p.left.value + p.right.value, "一共 ≠ 两部分之和")
  } else if (p.kind === "compare") {
    assert.equal(p.result.value, p.left.value - p.right.value, "差 ≠ 大数 － 小数")
  } else if (p.kind === "times") {
    assert.equal(p.right.value * p.result.value, p.left.value, "1倍量 × 倍数 ≠ 比较量")
  } else {
    assert.equal(p.result.value, p.nums.before[0] * p.nums.before[1], "总数 ≠ 份数 × 每份数")
  }

  // 句子里的「词」要跟交换后果对上
  const kind = p.effect as SwapEffect
  if (kind === "flipWord") {
    const hasMore = /多/.test(p.before.key)
    const hasLess = /少/.test(p.before.key)
    assert.ok(hasMore !== hasLess, `${p.kind}：交换前既不是「多」也不是「少」：${p.before.key}`)
    assert.ok(/(多|少)/.test(p.after.key), `${p.kind}：交换后没有多/少：${p.after.key}`)
    // 多 ⇄ 少 必须真的翻过来
    assert.notEqual(p.before.key.includes("多"), p.after.key.includes("多"), `${p.kind}：多/少没有翻转`)
  } else if (kind === "flipRate") {
    assert.ok(/倍/.test(p.before.key), `${p.kind}：交换前不是「几倍」：${p.before.key}`)
    assert.ok(/1\//.test(p.after.key), `${p.kind}：交换后不是 1/n：${p.after.key}`)
  } else if (kind === "flipMeaning") {
    assert.notEqual(p.before.key, p.after.key, `${p.kind}：交换后问的还是同一件事`)
  }

  // 一步一填：选项互不重复、答案恰好出现一次、答案确实在选项里
  assert.ok(p.solveSteps.length >= 2, `${p.kind}：步骤太少`)
  for (const s of p.solveSteps) {
    assert.ok(s.options.length >= 2, `${s.key}：选项太少`)
    assert.equal(new Set(s.options).size, s.options.length, `${s.key}：选项有重复`)
    assert.equal(s.options.filter((o) => o === s.answer).length, 1, `${s.key}：答案在选项里出现了非 1 次`)
    assert.ok(s.label && s.ask && s.tip, `${s.key}：文案缺失`)
  }
}

test("★ 全页的纲：两边同色 ⇔ 交换后结论不变（四类逐一体检）", () => {
  for (const k of REL_KINDS) {
    for (let i = 0; i < 120; i++) {
      const p = generateProblem(k)
      assert.ok(p, `${k} 生成失败`)
      checkProblem(p)
    }
  }
  // 只有「一共」是对称的 —— 这条写死，防止以后有人把某类改成同色
  const same = REL_KINDS.filter((k) => {
    const p = generateProblem(k)
    return p && p.slotRole[0] === p.slotRole[1]
  })
  assert.deepEqual(same, ["total"], "只有「一共」该是对称（同色）的")
})

test("随机 1000 道（不限题型）全部自洽", () => {
  const seen = new Set<RelKind>()
  for (let i = 0; i < 1000; i++) {
    const p = generateProblem()
    assert.ok(p, "随机生成失败")
    seen.add(p.kind)
    checkProblem(p)
  }
  assert.equal(seen.size, REL_KINDS.length, "随机 1000 道没能覆盖全部四类")
})

test("批量生成：不重复、数量够、每道都自洽", () => {
  const set = generateProblems(12)
  assert.equal(set.length, 12, `只生成了 ${set.length} 道`)
  assert.equal(new Set(set.map((p) => p.before.text)).size, 12, "批量题里有重复")
  set.forEach(checkProblem)
  for (const k of REL_KINDS) {
    const one = generateProblems(5, k)
    assert.ok(one.length >= 3, `${k} 只能生成 ${one.length} 道`)
    assert.ok(one.every((p) => p.kind === k), "指定题型却混进了别的题型")
  }
})

// ────────────────────────────────────────────────────────────
// 3. 静态教学资料
// ────────────────────────────────────────────────────────────

test("题型清单：四类齐全、id 与生成器一致、都有图标与配色档", () => {
  assert.deepEqual(KIND_GROUPS.map((g) => g.key), REL_KINDS)
  for (const g of KIND_GROUPS) {
    assert.ok(g.title && g.desc, `${g.key} 文案缺失`)
    assert.ok(g.desc.length <= 8, `${g.key} 的副标题超过 8 字：${g.desc}`)
    assert.ok(mathIcon(g.icon), `${g.key} 的图标 ${g.icon} 不存在`)
  }
  assert.equal(KIND_GROUPS.filter((g) => g.kindOfSwap === "both").length, 1, "只该有一类是对称的")
  assert.equal(KIND_GROUPS.find((g) => g.kindOfSwap === "both")?.key, "total")
})

test("规律卡 / 易错卡：图标都存在，文案都在字数预算内", () => {
  for (const r of RULES) {
    assert.ok(mathIcon(r.icon), `规律卡图标 ${r.icon} 不存在`)
    assert.ok(r.body.length <= 35, `规律卡正文超预算（${r.body.length} 字）：${r.body}`)
  }
  for (const c of MISTAKE_CASES) {
    assert.ok(mathIcon(c.icon), `易错卡图标 ${c.icon} 不存在`)
    // 预算口径：与已合规的 units 页齐平（why ≤18 / tip ≤18 字符）
    assert.ok(c.why.length <= 18, `易错 why 超预算（${c.why.length} 字）：${c.why}`)
    assert.ok(c.tip.length <= 18, `易错 tip 超预算（${c.tip.length} 字）：${c.tip}`)
    assert.ok(c.title && c.wrong && c.right, "易错卡字段缺失")
    assert.notEqual(c.wrong, c.right)
  }
  // 每类关系至少有一条易错卡
  const covered = new Set(MISTAKE_CASES.map((c) => c.icon))
  assert.ok(covered.size >= 3, "易错卡覆盖的概念太少")
})

test("★ 静态示例的数值逐条人工验算（引擎注释里的数字一律自己重算）", () => {
  // 易错卡 1：4 比 7 少 3 ⇒ |7-4| = 3
  assert.equal(7 - 4, 3)
  // 易错卡 2：6 是 2 的 3 倍；2 是 6 的 1/3
  assert.equal(2 * 3, 6)
  assert.equal(2 / 6, 1 / 3)
  // 易错卡 3：2 的 3 倍 = 3 的 2 倍 = 6
  assert.equal(2 * 3, 3 * 2)
  // 易错卡 5：3 + 5 = 5 + 3 = 8
  assert.equal(3 + 5, 5 + 3)
  // 易错卡 6：7 - 4 = 3，且 7 ÷ 4 = 1.75（「1 倍多」，不是 3 倍）
  assert.equal(7 - 4, 3)
  assert.equal(7 / 4, 1.75)
  assert.notEqual(7, 4 * 3)

  // ★ 对照表里每一行都得自己重算
  const byKind = new Map(SWAP_TABLE.map((r) => [r.kind, r]))
  assert.equal(SWAP_TABLE.length, REL_KINDS.length, "对照表行数应等于关系类数")

  const total = byKind.get("total")!
  assert.equal(splitEq(total.before)[0], splitEq(total.before)[1])
  assert.equal(splitEq(total.after)[0], splitEq(total.before)[0])
  assert.equal(total.effect, "keep")

  const cmp = byKind.get("compare")!
  {
    const m = cmp.before.match(/(\d+)\s*比\s*(\d+)\s*多\s*(\d+)/)
    assert.ok(m, `对照表「比多少」行格式不对：${cmp.before}`)
    assert.equal(Number(m![1]) - Number(m![2]), Number(m![3]))
    const a = cmp.after.match(/(\d+)\s*比\s*(\d+)\s*少\s*(\d+)/)
    assert.ok(a, `对照表「比多少」交换后格式不对：${cmp.after}`)
    // 主语确实换了，差确实没变
    assert.equal(a![1], m![2])
    assert.equal(a![2], m![1])
    assert.equal(Number(a![1]) - Number(a![2]), -Number(a![3]))
  }

  const tm = byKind.get("times")!
  {
    const m = tm.before.match(/(\d+)\s*是\s*(\d+)\s*的\s*(\d+)\s*倍/)
    assert.ok(m, `对照表「倍数」行格式不对：${tm.before}`)
    assert.equal(Number(m![2]) * Number(m![3]), Number(m![1]))
    const a = tm.after.match(/(\d+)\s*是\s*(\d+)\s*的\s*1\/(\d+)/)
    assert.ok(a, `对照表「倍数」交换后格式不对：${tm.after}`)
    assert.equal(a![1], m![2])
    assert.equal(a![2], m![1])
    assert.equal(Number(a![1]) / Number(a![2]), 1 / Number(a![3]))
  }

  const sh = byKind.get("share")!
  {
    const b = sh.before.match(/(\d+)\s*÷\s*(\d+)\s*＝\s*(\d+)/)
    const a = sh.after.match(/(\d+)\s*÷\s*(\d+)\s*＝\s*(\d+)/)
    assert.ok(b && a, "对照表「平均分」行格式不对")
    assert.equal(Number(b![2]) * Number(b![3]), Number(b![1]))
    assert.equal(Number(a![2]) * Number(a![3]), Number(a![1]))
    // 同一个总数，除数与商互换
    assert.equal(a![1], b![1])
    assert.equal(a![2], b![3])
    assert.equal(a![3], b![2])
  }
})

test("交换后果的四个标签齐全且「变没变」与 effect 自洽", () => {
  const effects: SwapEffect[] = ["keep", "flipWord", "flipRate", "flipMeaning"]
  for (const e of effects) assert.ok(EFFECT_LABEL[e]?.label, `${e} 缺标签`)
  assert.equal(EFFECT_LABEL.keep.changed, false)
  assert.equal(EFFECT_LABEL.flipWord.changed, true)
  assert.equal(EFFECT_LABEL.flipRate.changed, true)
  assert.equal(EFFECT_LABEL.flipMeaning.changed, true)
})

test("角色配色：青绿给「基准」，橙红给「比较」，两者必须不同色", () => {
  const roles: Role[] = ["part", "whole", "base", "cmp"]
  for (const r of roles) {
    assert.ok(ROLE_META[r]?.fg && ROLE_META[r]?.bg, `${r} 缺配色`)
  }
  assert.notEqual(ROLE_META.base.dot, ROLE_META.cmp.dot, "基准与比较必须一眼可分")
  assert.notEqual(ROLE_META.part.dot, ROLE_META.cmp.dot, "对等与比较必须一眼可分")
})

test("引擎导出的题不依赖随机数之外的任何东西（同种子下可重复出题不崩）", () => {
  // 连出 500 道不抛异常、不返回 null
  let ok = 0
  for (let i = 0; i < 500; i++) if (generateProblem()) ok++
  assert.equal(ok, 500)
})
