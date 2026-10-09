/** 单位换算引擎单测 —— 核心判据：**换算结果必须能被两条互不相干的路径算出同一个值**
 *
 *  裁判① 基准单位法（引擎实际用法）：全部化成毫米/克，再化成目标单位
 *  裁判② 沿链逐级法（本文件自己实现）：顺着单位链一小步一小步走，每步用相邻进率
 *  两个思路完全不同的实现给出同一个数，才把「进率没写错」从信仰变成证明。
 *
 *  另外还要钉住三件容易悄悄坏掉的事：
 *   · 「切几轮」和实操轨迹自洽（每轮份数 × 每份 = 总量守恒）
 *   · 反推参数出题 ⇒ 结果永远是 1..9 的整数，不会出分数
 *   · 易错案例里的「✅对」那一侧，要真的等于引擎算出来的值（展示数据不许和引擎脱节）
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  UNITS,
  unitsOf,
  unitOf,
  convert,
  convertChain,
  rateOf,
  roundsOf,
  planSteps,
  qty,
  qtyEn,
  readingsOf,
  compoundOf,
  rulerUnits,
  rulerExamples,
  meterExamples,
  RULER_EXAMPLE_MM,
  METER_EXAMPLE_MM,
  METER_RULER_CM,
  genProblem,
  genProblemSet,
  ADJACENT_PAIRS,
  PROBLEM_GROUPS,
  MISTAKE_CASES,
  LENGTH_FACTS,
  MASS_FACTS,
  type UnitId,
  type UnitKind,
  type ProblemGroupKey,
} from "./units"

const KINDS: UnitKind[] = ["length", "mass"]
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 20, 25, 100]

// ────────────────────────────────────────────────────────────
// 1. 单位表自洽
// ────────────────────────────────────────────────────────────

test("单位表：每族按 base 严格递增，且都是 10 的整数次幂", () => {
  for (const kind of KINDS) {
    const chain = unitsOf(kind)
    assert.ok(chain.length >= 2, `${kind} 至少要有两个单位`)
    assert.equal(chain[0].base, 1, `${kind} 的最小单位必须是基准单位`)

    for (let i = 0; i < chain.length; i++) {
      const u = chain[i]
      // 10 的整数次幂
      const n = Math.log10(u.base)
      assert.ok(Math.abs(n - Math.round(n)) < 1e-9, `${u.name} 的 base=${u.base} 不是 10 的整数次幂`)
      assert.equal(u.base, Math.pow(10, Math.round(n)))

      // 严格递增（相邻两级不能同 base，否则根本没有「相邻」可言）
      if (i > 0) {
        assert.ok(
          u.base > chain[i - 1].base,
          `${kind} 链上 ${chain[i - 1].name} → ${u.name} 的 base 没有严格递增`,
        )
      }
    }
  }
})

test("单位表：每个单位都有名字、符号、手感提示和至少 3 个参照物", () => {
  for (const u of UNITS) {
    assert.ok(u.name.length > 0, `${u.id} 缺名字`)
    assert.ok(u.symbol.length > 0, `${u.id} 缺符号`)
    assert.ok(u.sense.length > 0, `${u.name} 缺手感提示`)
    assert.ok(u.refs.length >= 3, `${u.name} 的参照物少于 3 个`)
    for (const r of u.refs) {
      assert.ok(r.name.length > 0 && r.detail.length > 0, `${u.name} 有个参照物字段残缺`)
    }
  }
})

test("单位表：长度 5 个、质量 3 个，且 id 唯一", () => {
  assert.equal(unitsOf("length").map((u) => u.id).join(","), "mm,cm,dm,m,km")
  assert.equal(unitsOf("mass").map((u) => u.id).join(","), "g,kg,t")
  assert.equal(new Set(UNITS.map((u) => u.id)).size, UNITS.length)
})

// ────────────────────────────────────────────────────────────
// 2. ★ 两个独立裁判对拍
// ────────────────────────────────────────────────────────────

test("★ 裁判①②对拍：基准单位法 === 沿链逐级法（全部同族单位对 × 全部取值）", () => {
  // ⚠️ 比「完全相等」松一点：两条路径的**除法次数不同**，浮点舍入自然不同
  //    （7毫米→米：一步除得 0.007，三步除得 0.007000000000000001）。
  //    这仍然是有效检查 —— 进率写错是**差 10 倍**，量级 1e0；浮点噪声是 1e-16。
  //    差得再多就只能说明有一边算错了，绝不可能只是"精度问题"。
  const close = (a: number, b: number) => {
    if (Number.isInteger(a) && Number.isInteger(b)) return a === b
    return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-9
  }

  let n = 0
  let exactInt = 0
  for (const kind of KINDS) {
    const chain = unitsOf(kind)
    for (const from of chain) {
      for (const to of chain) {
        if (from.id === to.id) continue
        for (const v of VALUES) {
          const a = convert(v, from, to)
          const b = convertChain(v, from, to)
          assert.ok(close(a, b), `${v}${from.name}→${to.name}：基准法=${a} 逐级法=${b}`)
          if (Number.isInteger(a) && Number.isInteger(b)) {
            // 整数结果必须**逐位相等**（这才是学生真正会算的那些题）
            assert.equal(a, b)
            exactInt++
          }
          n++
        }
      }
    }
  }
  assert.ok(n >= 50, `对拍样本太少：只有 ${n}`)
  assert.ok(exactInt >= 30, `整数样本太少：只有 ${exactInt}，容差检查就形同虚设了`)
})

test("裁判③往返：换过去再换回来必须回到原值", () => {
  for (const kind of KINDS) {
    const chain = unitsOf(kind)
    for (const from of chain) {
      for (const to of chain) {
        for (const v of VALUES) {
          const back = convert(convert(v, from, to), to, from)
          assert.ok(Math.abs(back - v) < 1e-9, `${v}${from.name}→${to.name}→${from.name} 得到 ${back}`)
        }
      }
    }
  }
})

test("进率：rateOf 恒 > 1，且相邻长度单位是 10、米↔千米与质量单位是 1000", () => {
  for (const p of ADJACENT_PAIRS) {
    assert.equal(rateOf(p.small, p.big), p.ratio)
    assert.equal(rateOf(p.big, p.small), p.ratio, "进率与方向无关，恒为大÷小")
    assert.ok(p.ratio > 1)
  }
  // 教材口径：长度只有「米↔千米」是 1000，其余相邻都是 10
  const lenRatios = ADJACENT_PAIRS.filter((p) => p.kind === "length").map((p) => p.ratio)
  assert.deepEqual(lenRatios, [10, 10, 10, 1000])
  // 质量相邻全是 1000
  assert.deepEqual(
    ADJACENT_PAIRS.filter((p) => p.kind === "mass").map((p) => p.ratio),
    [1000, 1000],
  )
})

test("roundsOf 与 rateOf 自洽：10^轮数 === 进率", () => {
  for (const kind of KINDS) {
    const chain = unitsOf(kind)
    for (const from of chain) {
      for (const to of chain) {
        const r = roundsOf(from, to)
        assert.equal(
          Math.pow(10, r),
          rateOf(from, to),
          `${from.name}→${to.name}：${r} 轮 ≠ 进率 ${rateOf(from, to)}`,
        )
      }
    }
  }
  // 钉死几个关键值
  assert.equal(roundsOf(unitOf("m"), unitOf("dm")), 1)
  assert.equal(roundsOf(unitOf("m"), unitOf("cm")), 2)
  assert.equal(roundsOf(unitOf("m"), unitOf("mm")), 3)
  assert.equal(roundsOf(unitOf("km"), unitOf("m")), 3)
  assert.equal(roundsOf(unitOf("t"), unitOf("g")), 6)
})

test("教材口径钉死：这些等式必须逐条成立", () => {
  const cases: [number, UnitId, UnitId, number][] = [
    [1, "m", "dm", 10],
    [1, "m", "cm", 100],
    [1, "m", "mm", 1000],
    [1, "dm", "cm", 10],
    [1, "dm", "mm", 100],
    [1, "cm", "mm", 10],
    [1, "km", "m", 1000],
    [1, "kg", "g", 1000],
    [1, "t", "kg", 1000],
    [1, "t", "g", 1_000_000],
  ]
  for (const [v, f, t, expected] of cases) {
    const got = convert(v, unitOf(f), unitOf(t))
    assert.equal(got, expected, `${v}${f} = ${got}${t}，应为 ${expected}${t}`)
  }
})

// ────────────────────────────────────────────────────────────
// 3. 切开 / 拼合轨迹
// ────────────────────────────────────────────────────────────

test("★ 切开/拼合轨迹守恒：每一轮「份数 × 每份」都等于总量", () => {
  for (const kind of KINDS) {
    const chain = unitsOf(kind)
    for (const from of chain) {
      for (const to of chain) {
        if (from.id === to.id) continue
        // 「单位变小」时 from 是大单位，取 1..9；「单位变大」时 from 是小单位，取 k×进率
        const ratio = rateOf(from, to)
        const values = from.base > to.base ? [1, 3, 9] : [ratio, ratio * 3, ratio * 9]
        for (const v of values) {
          const plan = planSteps(from, to, v)
          const total = v * from.base
          for (const c of plan.cuts) {
            assert.ok(
              Math.abs(c.count * c.pieceBase - total) < 1e-9,
              `${v}${from.name}→${to.name} 第${c.round}轮：${c.count} × ${c.pieceBase} ≠ ${total}`,
            )
          }
        }
      }
    }
  }
})

test("切开/拼合轨迹：末轮的份数 === 结果，每份 === 目标单位本身", () => {
  for (const kind of KINDS) {
    const chain = unitsOf(kind)
    for (const from of chain) {
      for (const to of chain) {
        if (from.id === to.id) continue
        const ratio = rateOf(from, to)
        const v = from.base > to.base ? 1 : ratio
        const plan = planSteps(from, to, v)
        const last = plan.cuts[plan.cuts.length - 1]
        assert.equal(plan.cuts.length, plan.rounds, "轨迹轮数必须等于 rounds")
        assert.equal(last.count, plan.result, `${v}${from.name}→${to.name} 末轮份数应为结果`)
        assert.equal(last.pieceBase, to.base, "末轮每份必须正好是目标单位")
        assert.equal(last.pieceLabel, `1${to.name}`)
        assert.ok(last.namedUnit && last.namedUnit.id === to.id, "末轮要能认出「现在就叫这个名字了」")
      }
    }
  }
})

test("切开/拼合轨迹：中间轮的说法要对（1千米→米 应为 100米 / 10米 / 1米）", () => {
  const plan = planSteps(unitOf("km"), unitOf("m"), 1)
  assert.equal(plan.direction, "split")
  assert.equal(plan.op, "×")
  assert.equal(plan.rounds, 3)
  assert.deepEqual(
    plan.cuts.map((c) => [c.count, c.pieceLabel]),
    [
      [10, "100米"],
      [100, "10米"],
      [1000, "1米"],
    ],
  )
  // ⚠️ 第一轮绝不是「10米」—— 只记「×10」而忘了「每份也在变小」就会写错这个
  assert.notEqual(plan.cuts[0].pieceLabel, "10米")
})

test("切开/拼合轨迹：10 进制那几对只切 1 轮，且中途就落在命名单位上", () => {
  const plan = planSteps(unitOf("m"), unitOf("dm"), 1)
  assert.equal(plan.rounds, 1)
  assert.equal(plan.direction, "split")
  assert.equal(plan.cuts[0].count, 10)
  assert.equal(plan.cuts[0].pieceLabel, "1分米")
})

test("切开/拼合轨迹：拼合方向（分米→米）份数一路变少", () => {
  const plan = planSteps(unitOf("dm"), unitOf("m"), 10)
  assert.equal(plan.direction, "merge")
  assert.equal(plan.op, "÷")
  assert.equal(plan.result, 1)
  assert.equal(plan.cuts[0].count, 1)
  assert.equal(plan.cuts[0].pieceLabel, "1米")
})

test("切开/拼合轨迹：每轮份数都比上一轮多（切开）或少（拼合）", () => {
  const split = planSteps(unitOf("km"), unitOf("mm"), 1)
  assert.equal(split.rounds, 6)
  for (let i = 1; i < split.cuts.length; i++) {
    assert.ok(split.cuts[i].count > split.cuts[i - 1].count, "切开时份数必须单调增")
  }
  const merge = planSteps(unitOf("mm"), unitOf("km"), 1_000_000)
  for (let i = 1; i < merge.cuts.length; i++) {
    assert.ok(merge.cuts[i].count < merge.cuts[i - 1].count, "拼合时份数必须单调减")
  }
})

test("切开/拼合轨迹：拒绝跨族与非法数值", () => {
  assert.throws(() => convert(1, unitOf("m"), unitOf("kg")), /长度和质量不能互相换算/)
  assert.throws(() => planSteps(unitOf("m"), unitOf("dm"), 0), /正数/)
  assert.throws(() => planSteps(unitOf("m"), unitOf("dm"), -3), /正数/)
})

// ────────────────────────────────────────────────────────────
// 4. ★ 出题自洽（反推参数 ⇒ 结果永远是整洁整数）
// ────────────────────────────────────────────────────────────

const ALL_GROUPS: ProblemGroupKey[] = PROBLEM_GROUPS.map((g) => g.key)

test("★ 抽 1000 道：每道题的答案都能被引擎重算出来，且三步的答案各自与题面一致", () => {
  let n = 0
  for (const g of ALL_GROUPS) {
    for (let i = 0; i < 250; i++) {
      const p = genProblem(g)

      // 题面里的结果，必须等于引擎独立算出来的值
      const truth = convert(p.value, p.from, p.to)
      assert.equal(p.result, truth, `${p.fullText}：题面答案 ${p.result} ≠ 实算 ${truth}`)

      // 三步：方向 / 进率 / 计算
      assert.deepEqual(p.steps.map((s) => s.key), ["op", "rate", "calc"])
      const [sOp, sRate, sCalc] = p.steps

      assert.equal(sOp.answer, p.op, "第1步答案必须是这一步真正该用的运算")
      assert.equal(sRate.answer, String(p.ratio), "第2步答案必须是真进率")
      assert.equal(sCalc.answer, String(p.result), "第3步答案必须是结果")
      assert.equal(sCalc.ask, `${p.value} ${p.op} ${p.ratio} = ?`)

      // 方向必须能从单位大小推出来（不靠背口诀）
      const shouldMultiply = p.from.base > p.to.base
      assert.equal(p.op, shouldMultiply ? "×" : "÷", `${p.fullText} 的方向判反了`)

      // 进率必须等于 units 里查得到的那个
      assert.equal(p.ratio, rateOf(p.from, p.to))
      assert.equal(p.rounds, roundsOf(p.from, p.to))
      // 本页只出进率 10 / 100 / 1000 的题
      assert.ok([10, 100, 1000].includes(p.ratio), `出了超纲进率 ${p.ratio}`)

      // 每一步的选项：答案必须**恰好出现一次**，且选项不重复
      for (const s of p.steps) {
        assert.equal(
          s.options.filter((o) => o === s.answer).length,
          1,
          `${p.fullText} 第${s.key}步：正确答案在选项里出现 ${s.options.filter((o) => o === s.answer).length} 次`,
        )
        assert.equal(new Set(s.options).size, s.options.length, `${p.fullText} 第${s.key}步：选项有重复`)
        assert.ok(s.options.length >= 2, `${p.fullText} 第${s.key}步：选项太少`)
        assert.ok(s.tip.length > 0, `${p.fullText} 第${s.key}步：缺讲解`)
      }
      assert.deepEqual([...sOp.options].sort(), ["×", "÷"].sort())

      // ★ 反推参数的保证：数值永远整洁，绝不出现分数或 0
      assert.ok(Number.isInteger(p.value) && p.value > 0, `${p.fullText} 的操作数不是正整数`)
      assert.ok(Number.isInteger(p.result) && p.result > 0, `${p.fullText} 的结果不是正整数`)
      // 「单位变小」时结果 ≥ 进率，「单位变大」时原数 ≥ 进率
      // （⚠️ 不能写死 result ≥ 进率：3000克 = 3千克 的结果就只有 3）
      assert.ok(
        Math.max(p.value, p.result) >= p.ratio,
        `${p.fullText}：两个数都比进率 ${p.ratio} 小，这道题不成立`,
      )
      assert.ok(p.value >= 1)

      // 陷阱项不能等于正确答案（否则「错答」变成「对答」）
      if (p.trap !== null) {
        assert.notEqual(p.trap, p.result, `${p.fullText} 的方向陷阱与正确答案重合`)
        assert.ok(Number.isInteger(p.trap) && p.trap > 0)
      }
      n++
    }
  }
  assert.equal(n, 1000)
})

test("抽题：题组里不会出现同一对自己到自己的换算，且题组只用声明的单位对", () => {
  for (const g of PROBLEM_GROUPS) {
    const allowed = new Set(g.pairs.map(([a, b]) => `${a}-${b}`))
    for (let i = 0; i < 200; i++) {
      const p = genProblem(g.key)
      assert.notEqual(p.from.id, p.to.id, `${p.fullText}：自己换自己`)
      const tag = `${p.from.id}-${p.to.id}`
      const tagRev = `${p.to.id}-${p.from.id}`
      assert.ok(allowed.has(tag) || allowed.has(tagRev), `${g.key} 出了未声明的单位对 ${tag}`)
      assert.equal(p.from.kind, p.to.kind, "不能跨族出题")
    }
  }
})

test("每组 6 道：同组内不重复同一道题", () => {
  for (const g of ALL_GROUPS) {
    const set = genProblemSet(g, 6)
    assert.equal(set.length, 6, `${g} 只抽到 ${set.length} 道`)
    const tags = set.map((p) => `${p.from.id}-${p.to.id}-${p.value}`)
    assert.equal(new Set(tags).size, tags.length, `${g} 抽到重复题：${tags.join(" / ")}`)
  }
})

test("题目 finalNote 与题面自洽", () => {
  for (const g of ALL_GROUPS) {
    for (let i = 0; i < 40; i++) {
      const p = genProblem(g)
      assert.ok(p.finalNote.includes(qty(p.value, p.from)), `${p.finalNote} 里没有原数`)
      assert.ok(p.finalNote.includes(qty(p.result, p.to)), `${p.finalNote} 里没有答案`)
    }
  }
})

// ────────────────────────────────────────────────────────────
// 5. 易错案例：展示数据不许和引擎脱节
// ────────────────────────────────────────────────────────────

test("★ 易错案例的「✅对」那一侧，必须是引擎真算得出来的值", () => {
  // 把案例里涉及的换算逐条挑出来交给引擎重算（顺序与 MISTAKE_CASES 一一对应）
  const checks: [number, UnitId, UnitId, number][] = [
    [5, "m", "dm", 50],
    [1, "km", "m", 1000],
    [3000, "g", "kg", 3],
    [4, "t", "kg", 4000],
    [20, "mm", "cm", 2],
  ]
  for (const [v, f, t, expected] of checks) {
    assert.equal(convert(v, unitOf(f), unitOf(t)), expected)
  }

  // 案例数量与内容都要对得上（改了案例就得同步改上面这张表）
  assert.equal(MISTAKE_CASES.length, 7)
  assert.ok(MISTAKE_CASES[0].right.includes("50分米"))
  assert.ok(MISTAKE_CASES[1].right.includes("1000米"))
  assert.ok(MISTAKE_CASES[2].right.includes("3千克"))
  assert.ok(MISTAKE_CASES[3].right.includes("4000千克"))
  assert.ok(MISTAKE_CASES[4].right.includes("2厘米"))

  // 每条错例都要有「错在哪」和「怎么记」
  for (const c of MISTAKE_CASES) {
    assert.ok(c.wrong !== c.right, `${c.wrong} 的错和对写成一样了`)
    assert.ok(c.why.length > 5 && c.tip.length > 5, `${c.wrong} 缺错因或口诀`)
  }
})

test("口诀与关系式齐全，且关系式条条能被引擎验证", () => {
  assert.equal(LENGTH_FACTS.length + MASS_FACTS.length, 9)
  // LENGTH_FACTS 的每一条都转成「1 大单位 = ? 小单位」交给引擎重算
  const expectLen: [UnitId, UnitId, number][] = [
    ["m", "dm", 10],
    ["dm", "cm", 10],
    ["cm", "mm", 10],
    ["m", "cm", 100],
    ["m", "mm", 1000],
    ["km", "m", 1000],
  ]
  expectLen.forEach(([big, small, r], i) => {
    assert.equal(convert(1, unitOf(big), unitOf(small)), r, `LENGTH_FACTS[${i}] 与引擎不符`)
    assert.ok(LENGTH_FACTS[i].text.includes(String(r)), `LENGTH_FACTS[${i}] 文案里的数与进率不符`)
  })

  const expectMass: [UnitId, UnitId, number][] = [
    ["kg", "g", 1000],
    ["t", "kg", 1000],
    ["t", "g", 1_000_000],
  ]
  expectMass.forEach(([big, small, r], i) => {
    assert.equal(convert(1, unitOf(big), unitOf(small)), r, `MASS_FACTS[${i}] 与引擎不符`)
  })
})

test("题组声明与相邻单位对一致：相邻题组不许混进跨级对", () => {
  const adjacent = new Set(ADJACENT_PAIRS.map((p) => `${p.small.id}-${p.big.id}`))
  for (const g of PROBLEM_GROUPS) {
    if (g.key === "cross") continue
    for (const [a, b] of g.pairs) {
      const small = unitOf(a).base < unitOf(b).base ? a : b
      const big = small === a ? b : a
      assert.ok(
        adjacent.has(`${small}-${big}`),
        `题组「${g.title}」声明的是相邻对，但 ${a}-${b} 并不相邻`,
      )
    }
  }
  // 跨级组反过来：至少有一对确实不相邻（否则这个题组没意义）
  const cross = PROBLEM_GROUPS.find((g) => g.key === "cross")!
  const hasCross = cross.pairs.some(([a, b]) => {
    const small = unitOf(a).base < unitOf(b).base ? a : b
    const big = small === a ? b : a
    return !adjacent.has(`${small}-${big}`)
  })
  assert.ok(hasCross, "跨级组里一对跨级的都没有")
})

// ────────────────────────────────────────────────────────────
// 6. 尺子实例：同一段长度、不同写法（「亮出这一段」的数据来源）
// ────────────────────────────────────────────────────────────

test("★ 尺子实例：每个例子都能整除出整数写法，且每条读数换回毫米都回到原值", () => {
  const ex = rulerExamples()
  assert.ok(ex.length >= 6, `尺子例子太少：${ex.length}`)

  // 例子的毫米数必须严格递增（页面上是按顺序排的 chip）
  for (let i = 1; i < ex.length; i++) {
    assert.ok(ex[i].mm > ex[i - 1].mm, `例子没按毫米升序：${ex[i - 1].mm} → ${ex[i].mm}`)
  }

  for (const e of ex) {
    // 一把 10 厘米的尺子 ⇒ 所有例子都必须落在 0..100 毫米之内
    assert.ok(Number.isInteger(e.mm) && e.mm > 0 && e.mm <= 100, `${e.label} 超出尺子范围：${e.mm}mm`)

    const rs = readingsOf(e.mm)
    assert.ok(rs.length >= 1, `${e.label} 一条读数都没有`)
    // ★ 主说法（复合读法）必须**由引擎派生**，不是页面手写的字符串
    assert.equal(e.label, compoundOf(e.mm).label, `${e.mm}mm 的复合说法不对`)

    for (const r of rs) {
      // ★ 读数必须是**整数**（三年级不读 0.7 分米）
      assert.ok(Number.isInteger(r.value) && r.value > 0, `${qty(r.value, r.unit)} 不是正整数写法`)
      // ★ 换回毫米必须回到原值 —— 这就是「同一段长度，换个单位写」
      const back = convert(r.value, r.unit, unitOf("mm"))
      assert.equal(Math.round(back), e.mm, `${qty(r.value, r.unit)} ≠ ${e.mm}毫米`)
    }

    // 带英文标注的写法：条数一致，且每条都以「(小写字母)」结尾
    assert.equal(e.same.length, rs.length)
    for (const s of e.same) {
      assert.ok(/[\u4e00-\u9fff]\([a-z]+\)$/.test(s), `读数没标英文：${s}`)
    }
    // ★ 最后一条必须是「毫米」写法 —— 复合读法拆到底一定落到毫米
    assert.equal(e.same[e.same.length - 1], `${e.mm}毫米(mm)`, `${e.label} 的毫米写法不对`)
  }
})

test("★ 复合读法：7厘米3毫米 —— 各段之和必须回到原值（页面按它把亮区分段画）", () => {
  // 参与「尺子上读一段」的单位只有毫米/厘米/分米/米（千米要 378 万像素，放不下）
  const ru = rulerUnits()
  assert.deepEqual(ru.map((u) => u.id), ["m", "dm", "cm", "mm"], `rulerUnits 不对：${ru.map((u) => u.id).join(",")}`)
  for (const u of ru) assert.ok(u.base <= 1000, `${u.name} 不该出现在尺子上`)

  for (const mm of [...RULER_EXAMPLE_MM, ...METER_EXAMPLE_MM]) {
    const c = compoundOf(mm)
    assert.equal(
      c.parts.reduce((a, p) => a + p.mm, 0),
      mm,
      `${c.label} 的各段加起来 ≠ ${mm}毫米`,
    )
    assert.ok(c.parts.length >= 1 && c.parts.length <= 4, `${c.label} 段数不合理：${c.parts.length}`)
    for (let i = 0; i < c.parts.length; i++) {
      const p = c.parts[i]
      assert.ok(Number.isInteger(p.value) && p.value > 0, `${c.label} 里有一段不是正整数`)
      assert.equal(p.mm, p.value * p.unit.base, `${c.label} 的段长和数值对不上`)
      if (i > 0) {
        assert.ok(p.unit.base < c.parts[i - 1].unit.base, `${c.label} 的单位没从大到小排`)
        // ★ 贪心的不变量：后面每一截都必须**比上一级小**（1200 不能拆成「1米1分米」）
        assert.ok(p.mm < c.parts[i - 1].unit.base, `${c.label}：${p.value}${p.unit.name} 比上一级还大，拆错了`)
      }
    }
    assert.equal(c.label, c.parts.map((p) => `${p.value}${p.unit.name}`).join(""))
  }
})

test("★ 复合读法在 1..1500 毫米上全覆盖：拆得开、加得回、把标签解析回去还是原值", () => {
  /**
   * ★ 反向裁判：把**引擎生成的那个字符串**重新解析成毫米 —— 不是再跑一遍同一个贪心，
   * 而是从文本逆推。单位名写错、少写一段、数字丢一位，这里都会当场炸。
   */
  const parseLabel = (s: string): number => {
    const idOf: Record<string, UnitId> = { 毫米: "mm", 厘米: "cm", 分米: "dm", 米: "m" }
    const re = /(\d+)(毫米|厘米|分米|米)/g // ★ 「毫米」必须排在「米」前面，否则只吃到「米」
    let total = 0
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      if (m.index !== last) return NaN // 中间夹着认不出来的字符
      last = m.index + m[0].length
      total += Number(m[1]) * unitOf(idOf[m[2]]).base
    }
    return last === s.length ? total : NaN
  }

  let single = 0
  for (let mm = 1; mm <= 1500; mm++) {
    const c = compoundOf(mm)
    assert.ok(c.label.length > 0, `${mm} 的标签是空的`)
    assert.equal(c.parts.reduce((a, p) => a + p.mm, 0), mm, `${mm} ⇒ ${c.label} 加不回原值`)
    for (const p of c.parts) {
      assert.equal(p.mm % p.unit.base, 0, `${c.label}：${p.value}${p.unit.name} 不是整数个单位`)
    }
    assert.equal(parseLabel(c.label), mm, `把「${c.label}」解析回毫米 ≠ ${mm}`)
    if (c.parts.length === 1) single++
  }
  // 单段的值恰好是「一个单位就能写出来」的那些：
  //   1..9 毫米(9) + 10..90 厘米(9) + 100..900 分米(9) + 1000 米(1) = 28
  // 数出来 ≠ 28 ⇒ 贪心在某一级多取或少取了（比如把 30 拆成「2厘米10毫米」）
  assert.equal(single, 28, `单段值 ${single} 个（应为 28）`)
})

test("★ 米尺例子：只放分米/米/复合，且一格都没超出尺子长度", () => {
  const ex = meterExamples()
  assert.deepEqual(ex.map((e) => e.mm), [...METER_EXAMPLE_MM].sort((a, b) => a - b))
  assert.deepEqual(ex.map((e) => e.label), ["1分米", "5分米", "1米", "1米2分米"])
  for (const e of ex) {
    assert.ok(e.mm <= METER_RULER_CM * 10, `${e.label} 超出米尺（${METER_RULER_CM} 厘米）`)
    // 米尺上的例子都是整分米 —— 页面是按「亮到第几大格」讲的
    assert.equal(e.mm % 100, 0, `${e.label} 不是整分米`)
  }
  // 米尺至少要画到 1 米（第 10 格），否则「1米」这个锚点落不进去
  assert.ok(METER_RULER_CM >= 100, `米尺只有 ${METER_RULER_CM} 厘米，画不到 1 米`)
})

test("尺子实例钉死：73 毫米读作 7厘米3毫米；70 / 100 读作 7厘米 / 1分米", () => {
  const bare = (mm: number) => readingsOf(mm).map((r) => qty(r.value, r.unit))
  const label = (mm: number) => compoundOf(mm).label

  assert.deepEqual(bare(70), ["7厘米", "70毫米"])
  assert.deepEqual(bare(100), ["1分米", "10厘米", "100毫米"])
  assert.deepEqual(bare(5), ["5毫米"])
  assert.deepEqual(bare(10), ["1厘米", "10毫米"])

  // ★ 复合读法（用户点名要的那一类）
  assert.equal(label(73), "7厘米3毫米")
  assert.equal(label(25), "2厘米5毫米")
  assert.equal(label(37), "3厘米7毫米")
  assert.equal(label(98), "9厘米8毫米")
  assert.equal(label(70), "7厘米")
  assert.equal(label(100), "1分米")
  assert.equal(label(1200), "1米2分米")
  assert.equal(label(1500), "1米5分米")
  assert.equal(label(1050), "1米5厘米") // ★ 中间那级恰好是 0 就跳过，不写「0分米」

  const three = rulerExamples().find((e) => e.mm === 73)
  assert.ok(three, "默认例子 7厘米3毫米 不在列表里")
  assert.equal(three.label, "7厘米3毫米")
  assert.deepEqual(three.same, ["73毫米(mm)"])
  assert.deepEqual(three.parts.map((p) => p.mm), [70, 3])

  const seven = rulerExamples().find((e) => e.mm === 70)
  assert.ok(seven, "例子 7 厘米 不在列表里")
  assert.equal(seven.label, "7厘米")
  assert.deepEqual(seven.same, ["7厘米(cm)", "70毫米(mm)"])

  // 非法输入必须炸，绝不许悄悄四舍五入
  assert.throws(() => readingsOf(0), /正整数/)
  assert.throws(() => readingsOf(7.5), /正整数/)
  assert.throws(() => readingsOf(-1), /正整数/)
  assert.throws(() => compoundOf(0), /正整数/)
  assert.throws(() => compoundOf(7.5), /正整数/)
})

// ────────────────────────────────────────────────────────────
// 7. 中文单位旁的英文标注（展示数据不许和单位表脱节）
// ────────────────────────────────────────────────────────────

test("★ 每个单位都配了英文名，qtyEn 就是「中文名 + 英文缩写」", () => {
  const en: Record<UnitId, string> = {
    mm: "millimeter",
    cm: "centimeter",
    dm: "decimeter",
    m: "meter",
    km: "kilometer",
    g: "gram",
    kg: "kilogram",
    t: "ton",
  }
  for (const u of UNITS) {
    assert.equal(u.en, en[u.id], `${u.name} 的英文名不对`)
    assert.ok(/^[a-z]+$/.test(u.en), `${u.name} 的英文名不是纯小写字母：${u.en}`)
    assert.equal(qtyEn(7, u), `7${u.name}(${u.symbol})`)
  }
  // 长度单位的缩写必须是课本/尺子上那三个字母以内的小写
  for (const u of unitsOf("length")) {
    assert.ok(/^[a-z]{1,2}$/.test(u.symbol), `${u.name} 的缩写不像英文单位：${u.symbol}`)
  }
  // 关系式与易错例里的中文单位，都要在括号里跟着英文缩写
  for (const f of LENGTH_FACTS) {
    assert.ok(/\([a-z]{1,2}\)/.test(f.text), `关系式没标英文：${f.text}`)
  }
  for (const c of MISTAKE_CASES) {
    assert.ok(/\([a-z]{1,2}\)/.test(c.right), `易错例的正确侧没标英文：${c.right}`)
  }
})
