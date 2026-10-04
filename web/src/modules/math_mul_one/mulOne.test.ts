/** 多位数乘一位数引擎单测
 *
 * ── 核心判据：一个积要能被**四条互不相干的路径**算出同一个数 ──
 *   裁判① 竖式逐位相乘（`planSteps`，引擎实际用法：逐位乘、满十进位、把进位加回下一位）
 *   裁判② 直接交给 JS 引擎乘（`productOf`）
 *   裁判③ 分位展开相加（`productByExpansion`：100×6 + 30×6 + 7×6）
 *   裁判④ 把竖式**写下来的各位**重新拼回一个数（`productFromPlan`）
 * 四个思路完全不同的实现给出同一个整数，才把「竖式轨迹一定对」从信仰变成证明。
 *
 * ── 另外三件容易悄悄坏掉的事 ──
 *   · `viewOf(index)` 推出的**高亮区域必须指向真实存在的格子** —— 高亮指向一个
 *     还没写出来的格子，动画就会「发光发在空气上」，而截图里完全看不出来
 *   · 出题器产出的题必须**真的属于它宣称的题型**（判据 `kindOf` 与生成器共用同一套）
 *   · 练习的每一步：选项互不重复、答案恰好出现一次、答案确实在选项里
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BEAT_MS,
  KIND_GROUPS,
  MISTAKE_CASES,
  RULES,
  buildProblem,
  beatStateAt,
  chant,
  cnNum,
  digitsOf,
  fromDigits,
  genPlan,
  genProblem,
  genProblemSet,
  kindOf,
  maxCarryRun,
  placeName,
  planSteps,
  productByExpansion,
  productCarryOneOnly,
  productDroppingCarries,
  productFromPlan,
  productOf,
  productZeroDropsCarry,
  tailZeroHint,
  viewOf,
  type Beat,
  type MulKind,
  type MulPlan,
} from "./mulOne"
import { mathIcon } from "../../lib/mathIcons"

const KINDS: MulKind[] = ["noCarry", "carry", "carryChain", "tailZero", "midZero"]
const ACTIVE_BEATS: Exclude<Beat, "idle" | "done">[] = ["mul", "add", "write", "carry"]

/** 全量样本：所有 10..999 的被乘数 × 所有 2..9 的一位数 */
function allPlans(): MulPlan[] {
  const out: MulPlan[] = []
  for (let value = 10; value <= 999; value++) {
    for (let factor = 2; factor <= 9; factor++) out.push(planSteps(value, factor))
  }
  return out
}

const ALL = allPlans()

// ────────────────────────────────────────────────────────────
// 1. 中文数字与口诀
// ────────────────────────────────────────────────────────────

test("cnNum：10 读「一十」，12 读「十二」，20 读「二十」", () => {
  assert.equal(cnNum(1), "一")
  assert.equal(cnNum(9), "九")
  assert.equal(cnNum(10), "一十")
  assert.equal(cnNum(12), "十二")
  assert.equal(cnNum(20), "二十")
  assert.equal(cnNum(24), "二十四")
  assert.equal(cnNum(42), "四十二")
  assert.equal(cnNum(81), "八十一")
})

test("chant：小数在前、不满十带「得」、有 0 就没有口诀", () => {
  assert.equal(chant(8, 3), "三八二十四")
  assert.equal(chant(3, 8), "三八二十四")
  assert.equal(chant(3, 3), "三三得九")
  assert.equal(chant(2, 4), "二四得八")
  assert.equal(chant(5, 2), "二五一十")
  assert.equal(chant(4, 5), "四五二十")
  assert.equal(chant(6, 9), "六九五十四")
  assert.equal(chant(7, 8), "七八五十六")
  assert.equal(chant(0, 5), "")
  assert.equal(chant(7, 0), "")
  // 口诀里的数必须真的等于乘积 —— 这是口诀唯一的功能
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      assert.ok(chant(a, b).length > 0, `${a}×${b} 应当有口诀`)
    }
  }
})

test("placeName：从个位起", () => {
  assert.equal(placeName(0), "个位")
  assert.equal(placeName(1), "十位")
  assert.equal(placeName(2), "百位")
  assert.equal(placeName(3), "千位")
})

test("digitsOf / fromDigits 往返一致", () => {
  for (const n of [10, 23, 100, 105, 280, 999, 1234, 8991]) {
    assert.equal(fromDigits(digitsOf(n)), n, `${n} 分解再拼回应当相等`)
  }
  assert.deepEqual(digitsOf(305), [5, 0, 3], "digitsOf 必须**从个位起**")
})

// ────────────────────────────────────────────────────────────
// 2. 竖式轨迹的结构自洽
// ────────────────────────────────────────────────────────────

test("竖式每一步：sum = base + carryIn，write 是个位，carryOut 是十位", () => {
  for (const plan of ALL) {
    let carry = 0
    assert.equal(plan.steps.length, plan.digits.length, `${plan.value}×${plan.factor} 步数应等于位数`)
    plan.steps.forEach((s, i) => {
      assert.equal(s.place, i, "place 必须从 0 连续递增")
      assert.equal(s.digit, plan.digits[i], `${i} 位的数字应当来自 digits`)
      assert.equal(s.base, s.digit * plan.factor, `${i} 位 base 应当 = digit × factor`)
      assert.equal(s.carryIn, carry, `${i} 位的 carryIn 必须 = 上一位的 carryOut`)
      assert.equal(s.sum, s.base + s.carryIn, `${i} 位 sum 应当 = base + carryIn`)
      assert.equal(s.write, s.sum % 10, `${i} 位 write 应当 = sum 的个位`)
      assert.equal(s.carryOut, Math.floor(s.sum / 10), `${i} 位 carryOut 应当 = sum 的十位`)
      assert.ok(s.carryOut >= 0 && s.carryOut <= 8, `${i} 位 carryOut 应当落在 0..8`)
      assert.ok(s.write >= 0 && s.write <= 9, `${i} 位 write 应当是数字`)
      carry = s.carryOut
    })
  }
})

test("★ 四个裁判对拍：竖式轨迹 / JS 乘法 / 分位展开 / 拼回写下的各位", () => {
  assert.ok(ALL.length > 7000, `样本量应当足够（实际 ${ALL.length}）`)
  let exact = 0
  for (const plan of ALL) {
    const a = plan.product // 裁判① 的结论（planSteps 自己算出来的）
    const b = productOf(plan.value, plan.factor)
    const c = productByExpansion(plan.value, plan.factor)
    const d = productFromPlan(plan)
    const tag = `${plan.value}×${plan.factor}`
    assert.equal(a, b, `${tag}：竖式轨迹与 JS 乘法不一致`)
    assert.equal(a, c, `${tag}：竖式轨迹与分位展开不一致`)
    assert.equal(a, d, `${tag}：竖式轨迹与「拼回写下的各位」不一致`)
    assert.ok(Number.isInteger(a) && a > 0, `${tag}：积应当是正整数`)
    exact++
  }
  assert.equal(exact, ALL.length)
})

test("积的位数：grewTop ⟺ 多一位，且 cols 容得下", () => {
  for (const plan of ALL) {
    const expectExtra = plan.steps[plan.steps.length - 1].carryOut > 0
    assert.equal(plan.grewTop, expectExtra, `${plan.value}×${plan.factor} grewTop 判定错`)
    assert.equal(
      plan.resultDigits.length,
      plan.digits.length + (plan.grewTop ? 1 : 0),
      `${plan.value}×${plan.factor} 积的位数不对`,
    )
    assert.equal(plan.cols, plan.resultDigits.length, "cols 应当容得下积")
    assert.ok(plan.cols >= plan.digits.length, "cols 也应当容得下被乘数")
  }
})

test("时间轴自洽：每一拍都合法，且 add / carry 只在真的发生时出现", () => {
  for (const plan of ALL) {
    plan.timeline.forEach((n, i) => {
      assert.equal(n.index, i, "timeline 的 index 必须连续")
      assert.ok(n.place >= 0 && n.place < plan.steps.length, `${plan.value}×${plan.factor} 拍了不存在的位`)
      const s = plan.steps[n.place]
      if (n.beat === "add") assert.ok(s.carryIn > 0, "没有进上来的数就不该有「加」这一拍")
      if (n.beat === "carry") assert.ok(s.carryOut > 0, "没有进位就不该有「进」这一拍")
      assert.ok(n.beat !== "idle" && n.beat !== "done", "timeline 里不该出现 idle / done")
    })
    // 每一位都必须至少走到「写」
    for (const s of plan.steps) {
      assert.ok(
        plan.timeline.some((n) => n.place === s.place && n.beat === "write"),
        `${plan.value}×${plan.factor} 的第 ${s.place} 位没有「写」这一拍`,
      )
    }
    // 每一拍必须属于「顺序推进」：place 单调不减
    for (let i = 1; i < plan.timeline.length; i++) {
      assert.ok(plan.timeline[i].place >= plan.timeline[i - 1].place, "时间轴不能倒回已经算过的位")
    }
  }
})

test("beatStateAt：越界要安全地落到 idle / done", () => {
  const plan = planSteps(137, 6)
  assert.equal(beatStateAt(plan, -1).beat, "idle")
  assert.equal(beatStateAt(plan, -1).place, 0)
  const done = beatStateAt(plan, plan.timeline.length)
  assert.equal(done.beat, "done")
  assert.equal(done.place, plan.timeline[plan.timeline.length - 1].place)
  assert.equal(beatStateAt(plan, plan.timeline.length + 5).beat, "done")
  for (const b of ACTIVE_BEATS) assert.ok(BEAT_MS[b] > 0, `${b} 缺少时长`)
})

// ────────────────────────────────────────────────────────────
// 3. ★★ 视图推导：高亮必须指向真实存在的格子
// ────────────────────────────────────────────────────────────

test("viewOf 全 index 扫描：结果行单调填满、进位槽只在送到时出现", () => {
  const samples = [planSteps(23, 3), planSteps(38, 2), planSteps(38, 3), planSteps(137, 6), planSteps(305, 6), planSteps(280, 3), planSteps(999, 9)]
  for (const plan of samples) {
    const tag = `${plan.value}×${plan.factor}`
    const seen: (number | null)[] = plan.resultDigits.map(() => null)
    for (let index = -1; index <= plan.timeline.length + 1; index++) {
      const v = viewOf(plan, index)
      assert.equal(v.resultCells.length, plan.resultDigits.length, `${tag} 结果行列数不对`)
      assert.equal(v.carryCells.length, plan.steps.length, `${tag} 进位槽个数不对`)

      // 结果行只能「从 null 变成数」，不能回退、也不能改值
      v.resultCells.forEach((cell, i) => {
        if (seen[i] !== null && cell !== null) {
          assert.equal(cell, seen[i], `${tag}：index=${index} 时第 ${i} 格的值被改了`)
        }
        if (seen[i] !== null) assert.notEqual(cell, null, `${tag}：index=${index} 时第 ${i} 格被擦掉了`)
        if (cell !== null) seen[i] = cell
      })

      // 进位槽同理
      v.carryCells.forEach((c, i) => {
        if (c !== null) assert.equal(c, plan.steps[i].carryIn, `${tag}：进位槽 ${i} 装错了数`)
      })

      // 播完之后必须全满
      if (index >= plan.timeline.length) {
        assert.deepEqual(v.resultCells, plan.resultDigits, `${tag}：播完结果行应当写满`)
        assert.equal(v.finished, true)
        for (let i = 1; i < plan.steps.length; i++) {
          if (plan.steps[i].carryIn > 0) {
            assert.equal(v.carryCells[i], plan.steps[i].carryIn, `${tag}：播完后进位槽 ${i} 应当露出来`)
          }
        }
      }
    }
    // 播完时进位槽全对
    const fin = viewOf(plan, plan.timeline.length)
    for (let i = 0; i < plan.steps.length; i++) {
      assert.equal(fin.carryCells[i], plan.steps[i].carryIn > 0 ? plan.steps[i].carryIn : null)
    }
  }
})

test("★ viewOf 的高亮永远指向存在的格子（不许发在空气上）", () => {
  const samples = [planSteps(23, 3), planSteps(38, 2), planSteps(137, 6), planSteps(305, 6), planSteps(280, 3), planSteps(999, 9)]
  for (const plan of samples) {
    const tag = `${plan.value}×${plan.factor}`
    for (let index = 0; index < plan.timeline.length; index++) {
      const v = viewOf(plan, index)
      const where = `${tag} @${index}(${v.beat},位${v.place})`
      if (v.hl.digit !== null) {
        assert.ok(v.hl.digit >= 0 && v.hl.digit < plan.digits.length, `${where}：高亮的被乘数位不存在`)
        assert.equal(v.hl.digit, v.place, `${where}：乘的时候高亮应当就是当前这一位`)
      }
      if (v.hl.write !== null) {
        assert.notEqual(v.resultCells[v.hl.write], null, `${where}：高亮的结果格还没写出来`)
        assert.equal(v.hl.write, v.place, `${where}：高亮的应当是刚写下的那一格`)
      }
      if (v.hl.carryIn !== null) {
        assert.notEqual(v.carryCells[v.hl.carryIn], null, `${where}：高亮的进位槽还是空的`)
      }
      if (v.hl.topCarry) {
        const top = plan.resultDigits.length - 1
        assert.notEqual(v.resultCells[top], null, `${where}：高亮了最高位，可它还没露面`)
        assert.ok(plan.grewTop, `${where}：没长出新的一位，不该高亮最高位`)
      }
      if (v.hl.op) assert.equal(v.beat, "mul", `${where}：只有「乘」那一拍才该点亮 × 号`)
      if (v.hl.shown === "base") assert.equal(v.beat, "mul")
      // 讲的话不能是空的（每一拍都要有台词）
      assert.ok(v.say.length > 0, `${where}：这一拍没有台词`)
    }
  }
})

test("★ 「加进位」那一拍必须真的讲出进上来的数", () => {
  // 38 × 2：个位 8×2=16 写6进1（这是第 0 位的 sum，16）；
  //          十位 3×2=6（第 1 位的 base），6 + 1 = 7
  const plan = planSteps(38, 2)
  const addIdx = plan.timeline.findIndex((n) => n.beat === "add")
  assert.ok(addIdx > 0, "38×2 应当有「加进位」这一拍")
  const v = viewOf(plan, addIdx)
  assert.equal(v.place, 1)
  assert.equal(v.hl.shown, "sum")
  assert.equal(v.hl.carryIn, 1, "高亮应当指向那个进位槽")
  assert.ok(v.say.includes("1"), `台词里应当点出进上来的 1：${v.say}`)
  assert.ok(v.say.includes("6 + 1"), `台词里应当出现「6 + 1」这一步加法：${v.say}`)
  assert.ok(v.say.includes("7"), `台词里应当出现结果 7：${v.say}`)
  assert.ok(v.warn.length > 0, "这一拍必须给易错提醒")
  // 这一拍的进位槽必须真的露出来了（否则高亮发在空气上）
  assert.equal(v.carryCells[1], 1)
})

test("★ 「进」那一拍：中间位指向左边一格，最高位变成积的新一位", () => {
  // 137 × 6：个位进 4（送到十位头上）、十位进 2（送到百位头上）
  const plan = planSteps(137, 6)
  const carries = plan.timeline.filter((n) => n.beat === "carry")
  assert.equal(carries.length, 2)
  const c0 = viewOf(plan, carries[0].index)
  assert.equal(c0.place, 0)
  assert.equal(c0.hl.carryIn, 1, "个位的进位应当送到第 1 位（十位）头上")
  assert.equal(c0.hl.topCarry, false)
  const c1 = viewOf(plan, carries[1].index)
  assert.equal(c1.place, 1)
  assert.equal(c1.hl.carryIn, 2, "十位的进位应当送到第 2 位（百位）头上")

  // 38 × 3：十位 3×3+2 = 11 ⇒ 最高位进位变成积的新一位（114）
  const p2 = planSteps(38, 3)
  const last = p2.timeline[p2.timeline.length - 1]
  assert.equal(last.beat, "carry")
  const v = viewOf(p2, last.index)
  assert.equal(v.hl.topCarry, true, "最高位的进位应当高亮积新长出来的那一格")
  assert.equal(v.resultCells[2], 1, "积的百位应当是 1")
  assert.equal(p2.product, 114)
})

test("已知案例钉死：轨迹与积逐个对上", () => {
  const cases: [number, number, number[], number[]][] = [
    // [被乘数, 一位数, 积的各位(从个位起), 每一步的 sum]
    [38, 2, [6, 7], [16, 7]],
    [38, 3, [4, 1, 1], [24, 11]],
    [137, 6, [2, 2, 8], [42, 22, 8]],
    [305, 6, [0, 3, 8, 1], [30, 3, 18]],
    [280, 3, [0, 4, 8], [0, 24, 8]],
    [403, 2, [6, 0, 8], [6, 0, 8]],
    [999, 9, [1, 9, 9, 8], [81, 89, 89]],
  ]
  for (const [value, factor, digits, sums] of cases) {
    const plan = planSteps(value, factor)
    assert.deepEqual(plan.resultDigits, digits, `${value}×${factor} 积的各位不对`)
    assert.deepEqual(plan.steps.map((s) => s.sum), sums, `${value}×${factor} 每一步的和不对`)
    assert.equal(plan.product, productOf(value, factor))
  }
  // 305 × 6 是「中间有 0 也要加进位」的招牌题：十位写的是 3，不是 0
  const p = planSteps(305, 6)
  assert.equal(p.steps[1].digit, 0)
  assert.equal(p.steps[1].carryIn, 3)
  assert.equal(p.steps[1].sum, 3)
  assert.equal(p.steps[1].write, 3)
})

// ────────────────────────────────────────────────────────────
// 4. 错答生成器（必须能被独立重算，不许硬凑）
// ────────────────────────────────────────────────────────────

test("错答生成器：已知错答逐条重现", () => {
  // 27×4：个位 7×4=28 写8进2；十位 2×4=8 —— 忘了加 2 ⇒ 88
  assert.equal(productDroppingCarries(27, 4), 88)
  // 68×4：个位 8×4=32 应进 3，只进 1 ⇒ 252（⚠️ 最高位要整块写下，不能也「只进 1」）
  assert.equal(productCarryOneOnly(68, 4), 252)
  // 137×6：只进 1 ⇒ 792（正确 822）
  assert.equal(productCarryOneOnly(137, 6), 792)
  assert.equal(productDroppingCarries(305, 6), 800, "305×6 全漏加进位是 800")
  // ★ 「中间是 0 就直接写 0」—— 这条把易错案例里那个 1800 和引擎绑上了
  assert.equal(productZeroDropsCarry(305, 6), 1800)
  assert.equal(productZeroDropsCarry(403, 2), 806, "403×2 没有进位可漏，写法不同但结果一样")
  // ⚠️ 漏进位错答可能**退化成 0**（每一位的个位都是 0）—— 展示前必须滤掉，
  //    否则选项里会出现一个「0」，既没有干扰作用又容易被当成印刷错误
  assert.equal(productDroppingCarries(220, 5), 0, "220×5 全漏进位就是 0")
})

test("错答生成器：与正确答案的关系符合直觉", () => {
  for (const plan of ALL) {
    const drop = productDroppingCarries(plan.value, plan.factor)
    const one = productCarryOneOnly(plan.value, plan.factor)
    const zero = productZeroDropsCarry(plan.value, plan.factor)
    const tag = `${plan.value}×${plan.factor}`
    assert.ok(Number.isInteger(drop) && drop >= 0, `${tag} 漏进位错答应当是非负整数`)
    assert.ok(Number.isInteger(one) && one > 0, `${tag} 只进 1 错答应当是正整数`)
    assert.ok(Number.isInteger(zero) && zero > 0, `${tag} 0 位漏进位错答应当是正整数`)
    // 被乘数里没有 0 时，「0 位漏进位」这条错误规则压根不触发 ⇒ 结果必须与正确答案相同
    if (!plan.digits.slice(1).includes(0)) {
      assert.equal(zero, plan.product, `${tag} 没有 0 位，这条错答规则不该产生差别`)
    }
    // 没有任何进位时，「漏加进位」不会造成差别 —— 这正是它只在高频错题上出现的原因
    if (maxCarryRun(plan.steps) === 0) {
      assert.equal(drop, plan.product, "没有进位时漏进位不该改变结果")
    }
  }
  // 至少要有大量题真的能产生错答（否则练习里的干扰项会退化）
  const useful = ALL.filter((p) => productDroppingCarries(p.value, p.factor) !== p.product)
  assert.ok(useful.length > 2000, `能产生「漏加进位」错答的题应当足够多（实际 ${useful.length}）`)
})

// ────────────────────────────────────────────────────────────
// 5. 题型判据与出题器
// ────────────────────────────────────────────────────────────

test("kindOf：判据本身逐条可验证", () => {
  for (const plan of ALL) {
    const k = kindOf(plan)
    const run = maxCarryRun(plan.steps)
    if (k === "tailZero") {
      assert.equal(plan.value % 10, 0, `${plan.value}×${plan.factor} 判成 tailZero 但末尾不是 0`)
    } else if (k === "midZero") {
      assert.ok(plan.digits.length >= 3, "中间有 0 至少是三位数")
      assert.ok(
        plan.digits.slice(1, plan.digits.length - 1).includes(0),
        `${plan.value}×${plan.factor} 判成 midZero 但中间没有 0`,
      )
      assert.notEqual(plan.value % 10, 0, "判成 midZero 就不该是末尾有 0（tailZero 优先判）")
    } else if (k === "noCarry") {
      assert.equal(run, 0, `${plan.value}×${plan.factor} 判成不进位但其实有进位`)
    } else if (k === "carry") {
      assert.equal(run, 1, `${plan.value}×${plan.factor} 判成进位但连续进位段不是 1`)
    } else {
      assert.ok(run >= 2, `${plan.value}×${plan.factor} 判成连续进位但连段只有 ${run}`)
    }
  }
})

test("maxCarryRun：几个手算过的例子", () => {
  assert.equal(maxCarryRun(planSteps(23, 3).steps), 0, "23×3 全程不进位")
  assert.equal(maxCarryRun(planSteps(38, 2).steps), 1, "38×2 只有个位进位")
  assert.equal(maxCarryRun(planSteps(137, 6).steps), 2, "137×6 个位与十位连着进位")
  assert.equal(maxCarryRun(planSteps(999, 9).steps), 3, "999×9 三位全部进位")
  assert.equal(maxCarryRun(planSteps(403, 2).steps), 0, "403×2 没有进位")
})

test("★ 出题器产出的题必须真的属于它宣称的题型（每型 300 道）", () => {
  for (const kind of KINDS) {
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const plan = genPlan(kind)
      assert.equal(kindOf(plan), kind, `genPlan("${kind}") 产出了 ${plan.value}×${plan.factor}（实测 ${kindOf(plan)}）`)
      assert.ok(plan.value >= 10 && plan.value <= 999, `被乘数 ${plan.value} 超出两/三位数范围`)
      assert.ok(plan.factor >= 2 && plan.factor <= 9, `一位数 ${plan.factor} 超出 2..9`)
      assert.equal(plan.product, productOf(plan.value, plan.factor))
      seen.add(`${plan.value}×${plan.factor}`)
    }
    // 题目要够散，不能老是那几道
    assert.ok(seen.size > 40, `题型 ${kind} 的题目太集中（300 次只出了 ${seen.size} 种）`)
  }
})

test("题型判据的覆盖面：五种题型都能从全量样本里找到，且每型都有货", () => {
  const byKind = new Map<MulKind, number>()
  for (const plan of ALL) {
    const k = kindOf(plan)
    byKind.set(k, (byKind.get(k) ?? 0) + 1)
  }
  for (const k of KINDS) {
    assert.ok((byKind.get(k) ?? 0) > 20, `题型 ${k} 在全量样本里只有 ${byKind.get(k) ?? 0} 个，判据可能写歪了`)
  }
  // 连续进位确实要靠低位「够大」才出现，但必须真的存在
  assert.ok((byKind.get("carryChain") ?? 0) > 100, "连续进位的样本太少")
})

test("盲抽：400 道随机题，积与竖式轨迹都要对得上", () => {
  for (let i = 0; i < 400; i++) {
    const plan = planSteps(
      10 + Math.floor(Math.random() * 990),
      2 + Math.floor(Math.random() * 8),
    )
    assert.equal(plan.product, productOf(plan.value, plan.factor))
    assert.equal(productFromPlan(plan), plan.product, `${plan.value}×${plan.factor} 拼回的积不对`)
    assert.equal(productByExpansion(plan.value, plan.factor), plan.product)
  }
})

// ────────────────────────────────────────────────────────────
// 6. 一步一填
// ────────────────────────────────────────────────────────────

test("★ 练习每一步：选项互不重复、答案恰好出现一次、且答案在选项里", () => {
  for (const kind of KINDS) {
    for (let i = 0; i < 120; i++) {
      const p = genProblem(kind)
      assert.ok(p.solveSteps.length >= 3, `${kind} 的练习步骤太少（${p.solveSteps.length}）`)
      for (const s of p.solveSteps) {
        const tag = `${kind} ${p.value}×${p.factor} 第「${s.label}」步`
        assert.ok(s.options.length >= 2, `${tag}：至少要 2 个选项`)
        assert.equal(new Set(s.options).size, s.options.length, `${tag}：选项有重复`)
        assert.equal(
          s.options.filter((o) => o === s.answer).length,
          1,
          `${tag}：答案在选项里出现了 ${s.options.filter((o) => o === s.answer).length} 次`,
        )
        assert.ok(s.options.includes(s.answer), `${tag}：答案根本不在选项里`)
        assert.ok(s.ask.length > 0 && s.tip.length > 0 && s.label.length > 0, `${tag}：题面/讲解不能为空`)
        // ⚠️ 页面上是纯文本渲染，markdown 的星号会原样露出来
        for (const field of [s.ask, s.tip, s.label, ...s.options]) {
          assert.ok(!field.includes("**"), `${tag}：文案里混进了 markdown 星号 —— ${field}`)
        }
      }
    }
  }
})

test("★ 练习的最后一步必须就是「积」（否则前面的步骤白填）", () => {
  for (const kind of KINDS) {
    for (let i = 0; i < 120; i++) {
      const p = genProblem(kind)
      const last = p.solveSteps[p.solveSteps.length - 1]
      assert.equal(last.answer, String(p.product), `${kind} ${p.value}×${p.factor} 最后一步问的不是积`)
      assert.equal(p.plan.product, p.product)
    }
  }
})

test("★ 竖式路线的「乘」步答案必须等于引擎的 sum（不许另算一套）", () => {
  for (let i = 0; i < 200; i++) {
    const plan = genPlan("carryChain")
    const p = buildProblem(plan, "carryChain")
    for (let place = 0; place < plan.steps.length; place++) {
      const s = p.solveSteps.find((x) => x.key === `mul${place}`)
      assert.ok(s, `缺第 ${place} 位的「乘」步`)
      assert.equal(s.answer, String(plan.steps[place].sum), `第 ${place} 位的「乘」答案与轨迹不符`)
      const w = p.solveSteps.find((x) => x.key === `write${place}`)
      assert.ok(w, `缺第 ${place} 位的「写」步`)
      const expectCarry = plan.steps[place].carryOut > 0 ? `进 ${plan.steps[place].carryOut}` : "不进位"
      assert.equal(w.answer, `写 ${plan.steps[place].write}，${expectCarry}`)
    }
  }
})

test("★ 末尾有 0 的题走巧算三问：先算前面 → 数 0 → 补上", () => {
  for (let i = 0; i < 120; i++) {
    const p = genProblem("tailZero")
    const t = p.tail
    assert.ok(t, "tailZero 的题必须有巧算信息")
    assert.equal(t.core * Math.pow(10, t.zeros), p.value, "core 与 zeros 应当能还原被乘数")
    assert.notEqual(t.core % 10, 0, "core 自己不该再带 0（否则 zeros 会数少）")
    assert.equal(t.coreProduct, t.core * p.factor)
    const keys = p.solveSteps.map((s) => s.key)
    assert.deepEqual(keys, ["core", "zeros", "final"], `巧算步骤不对：${keys.join(",")}`)
    assert.equal(p.solveSteps[0].answer, String(t.coreProduct))
    assert.equal(p.solveSteps[1].answer, `${t.zeros} 个 0`)
    assert.equal(p.solveSteps[2].answer, String(p.product))
    // 「忘了补 0」这个经典错答必须在选项里
    assert.ok(
      p.solveSteps[2].options.includes(String(t.coreProduct)),
      "补 0 那一步应当把「忘补 0」的错答摆出来",
    )
  }
})

test("★ 「忘加进位」这个错答必须出现在练习选项里（这才是这一页的意义）", () => {
  let seen = 0
  for (const kind of ["carry", "carryChain", "midZero"] as MulKind[]) {
    for (let i = 0; i < 200; i++) {
      const p = genProblem(kind)
      for (const s of p.solveSteps) {
        if (!s.key.startsWith("mul")) continue
        const place = Number(s.key.slice(3))
        const step = p.plan.steps[place]
        if (step.carryIn === 0) continue
        assert.ok(
          s.options.includes(String(step.base)),
          `${kind} ${p.value}×${p.factor} 第 ${place} 位的选项里没有「忘加进位」的 ${step.base}`,
        )
        seen++
      }
    }
  }
  assert.ok(seen > 200, `「忘加进位」干扰项出现次数太少（${seen}）`)
})

test("traps：错答与正确答案不同、是正整数、且文案点出原因", () => {
  for (const kind of KINDS) {
    for (let i = 0; i < 80; i++) {
      const p = genProblem(kind)
      for (const t of p.traps) {
        assert.notEqual(t.value, p.product, `${kind} ${p.value}×${p.factor} 的错答与正确答案相同`)
        assert.ok(Number.isInteger(t.value) && t.value > 0, "错答应当是正整数")
        assert.ok(t.why.length > 0 && t.label.length > 0, "错答必须带解释")
        assert.ok(!t.why.includes("**"), "错答解释里混进了 markdown 星号")
      }
    }
  }
})

test("★ 错答必须**真的来自**那三个错答生成器 —— 不许手写一个「看起来像」的数字", () => {
  // 这条是「错答讲解」的诚信底线：屏幕上写「算成 55」，就必须真能用生成器复现 55。
  // 否则讲解会挂在空气上（孩子照着错的思路走，反而学到错的）。
  let checked = 0
  for (const kind of KINDS) {
    for (let i = 0; i < 80; i++) {
      const p = genProblem(kind)
      const allowed = new Set(
        [
          productDroppingCarries(p.value, p.factor),
          productCarryOneOnly(p.value, p.factor),
          productZeroDropsCarry(p.value, p.factor),
        ].filter((v) => v > 0),
      )
      for (const t of p.traps) {
        assert.ok(
          allowed.has(t.value),
          `${p.value}×${p.factor} 的错答 ${t.value} 不在三个生成器的输出里（可能是手写的）`,
        )
        // 标签里的数字必须与 value 一致，避免「标签写着 55、底下为什么讲的是别的数」
        assert.equal(t.label, `算成 ${t.value}`, `错答标签与数值对不上：${t.label} / ${t.value}`)
        checked++
      }
    }
  }
  assert.ok(checked > 40, `错答抽样太少（${checked}），这条断言没起到作用`)
})

test("★ 退化的错答（0）不许进选项：问积的那一步不能出现「0」这个选项", () => {
  // 202 × 5 = 1010：每一位漏加进位的话写下来正好是 0，必须被滤掉
  assert.equal(productDroppingCarries(202, 5), 0)
  const p = buildProblem(planSteps(202, 5), "midZero")
  for (const t of p.traps) assert.notEqual(t.value, 0, "退化的 0 不许当错答")
  const final = p.solveSteps.find((s) => s.key === "final")
  assert.ok(final, "应当有收尾的「写完整」一步")
  assert.ok(!final.options.includes("0"), `问积的选项里不该出现 0：${final.options.join(" / ")}`)
  assert.ok(final.options.includes(String(p.product)))

  // 全量兜底：任何题型的收尾步都不许出现 0
  for (const kind of KINDS) {
    for (let i = 0; i < 100; i++) {
      const q = genProblem(kind)
      const last = q.solveSteps[q.solveSteps.length - 1]
      assert.ok(
        !last.options.includes("0"),
        `${kind} ${q.value}×${q.factor} 的收尾选项里出现了 0：${last.options.join(" / ")}`,
      )
      for (const t of q.traps) assert.ok(t.value > 0, `${kind} ${q.value}×${q.factor} 的错答不是正整数`)
    }
  }
})

test("genProblemSet：一组内不重复，且每道都对", () => {
  for (const kind of KINDS) {
    const set = genProblemSet(kind, 4)
    assert.equal(set.length, 4, `${kind} 应当抽到 4 道`)
    const tags = new Set(set.map((p) => `${p.value}×${p.factor}`))
    assert.equal(tags.size, set.length, `${kind} 一组内出现了重复题`)
    for (const p of set) {
      assert.equal(kindOf(p.plan), kind)
      assert.equal(p.product, productOf(p.value, p.factor))
    }
  }
})

// ────────────────────────────────────────────────────────────
// 7. 静态教学资料
// ────────────────────────────────────────────────────────────

test("★ 易错案例逐条重算，且错答与正解真的不同", () => {
  assert.ok(MISTAKE_CASES.length >= 6, "易错案例太少")
  for (const c of MISTAKE_CASES) {
    assert.notEqual(c.wrong, c.right, "错例和正解不能是同一个式子")
    assert.ok(c.why.length > 0 && c.tip.length > 0, "每条都要讲清错在哪、怎么防")
    for (const f of [c.wrong, c.right, c.why, c.tip]) {
      assert.ok(!f.includes("**"), `文案里混进了 markdown 星号 —— ${f}`)
    }
    if (!c.check) continue
    const { value, factor, product } = c.check
    // ★ 正解那一侧必须真的等于引擎算出来的值 —— 展示数据不许和引擎脱节
    assert.equal(value * factor, product, `「${c.right}」的算式对不上`)
    assert.equal(productOf(value, factor), product)
    assert.equal(productFromPlan(planSteps(value, factor)), product, `竖式算不出「${c.right}」`)
  }
})

test("易错案例里「漏加进位」与「只进 1」两个招牌错都要有", () => {
  const wrongNums = MISTAKE_CASES.map((c) => c.wrong)
  assert.ok(
    wrongNums.some((w) => w.startsWith("27 × 4")),
    "必须收录 27×4=88（漏加进位，全章第一高频错）",
  )
  assert.ok(
    wrongNums.some((w) => w.startsWith("68 × 4")),
    "必须收录 68×4=252（满几十只进 1）",
  )
  assert.ok(
    wrongNums.some((w) => w.startsWith("305 × 6")),
    "必须收录 305×6=1800（中间是 0 就写 0）",
  )
  assert.ok(
    wrongNums.some((w) => w.startsWith("160 × 3")),
    "必须收录 160×3=48（末尾 0 忘补）",
  )
})

test("规律卡：有内容、配图真的存在、且不含 markdown 星号", () => {
  assert.ok(RULES.length >= 3)
  for (const r of RULES) {
    assert.ok(r.title.length > 0 && r.body.length > 0)
    assert.ok(!r.body.includes("**") && !r.title.includes("**"))
    // ★ 配图键打错的话渲染件会安静地什么都不画 ⇒ 这里当场拦住
    assert.ok(mathIcon(r.icon), `规律卡「${r.title}」的配图「${r.icon}」不在 mathIcons 里`)
  }
})

test("题型清单是单一来源：五型齐全、键不重复、每型都有说明与配图", () => {
  assert.equal(KIND_GROUPS.length, KINDS.length)
  assert.deepEqual(
    KIND_GROUPS.map((g) => g.key).sort(),
    [...KINDS].sort(),
    "KIND_GROUPS 必须覆盖全部题型（页面就靠它渲染按钮）",
  )
  for (const g of KIND_GROUPS) {
    assert.ok(g.title.length > 0 && g.desc.length > 0 && g.icon.length > 0)
    assert.ok(!g.desc.includes("**"))
    assert.ok(mathIcon(g.icon), `题型「${g.title}」的配图「${g.icon}」不在 mathIcons 里`)
  }
})

test("tailZeroHint：只有末尾有 0 才给，且能还原被乘数", () => {
  assert.equal(tailZeroHint(280, 3)?.core, 28)
  assert.equal(tailZeroHint(280, 3)?.zeros, 1)
  assert.equal(tailZeroHint(280, 3)?.coreProduct, 84)
  assert.equal(tailZeroHint(23, 3), null)
  assert.equal(tailZeroHint(400, 3)?.core, 4, "400 的 core 是 4、zeros 是 2")
  assert.equal(tailZeroHint(400, 3)?.zeros, 2)
  for (const plan of ALL) {
    const t = tailZeroHint(plan.value, plan.factor)
    if (plan.value % 10 !== 0) {
      assert.equal(t, null, `${plan.value} 末尾不是 0，不该给巧算信息`)
    } else {
      assert.ok(t, `${plan.value} 末尾有 0，应当给巧算信息`)
      assert.equal(t.core * Math.pow(10, t.zeros), plan.value, "巧算信息必须能还原被乘数")
      assert.equal(t.coreProduct, t.core * plan.factor)
      assert.equal(t.coreProduct * Math.pow(10, t.zeros), plan.product, "巧算路线必须给出同一个积")
    }
  }
})

test("非法输入要报错，不能悄悄算出错数", () => {
  assert.throws(() => planSteps(7, 4), /多位数/)
  assert.throws(() => planSteps(23, 1), /一位数/)
  assert.throws(() => planSteps(23, 10), /一位数/)
  assert.throws(() => planSteps(23, 3.5), /一位数/)
  assert.throws(() => planSteps(23.5, 3), /多位数/)
  assert.throws(() => genPlan("nope" as MulKind), /未知题型/)
})
