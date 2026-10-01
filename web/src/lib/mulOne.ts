/** 三年级上 · 多位数乘一位数 —— 规则引擎（零后端调用）
 *
 * ── 这一页要解决的真问题 ──────────────────────────────────
 * 孩子算 `27 × 4` 常常写成 88。他并不是不会背「四七二十八」，
 * 而是**算完十位就忘了把个位进上来的 2 加进去**。
 * 也就是说：错的不是乘法，错在「进位」这一步没有成为**看得见的动作**。
 *
 * 所以本引擎把竖式拆成**逐位的四拍**，每一拍都对应一个视觉动作：
 *   ① 乘 —— 这一位的数字 × 一位数（口诀）        ⇒ 得到 base
 *   ② 加 —— 再加上右边进上来的数                 ⇒ 得到 sum    ★ 错得最多的一拍
 *   ③ 写 —— sum 的个位写在这一位下面              ⇒ write
 *   ④ 进 —— sum 的十位送到前一位头上              ⇒ carryOut
 *
 * ── ★ 为什么「从个位乘起」不是死记 ─────────────────────────
 * 因为**进位只能往左走**：只有个位先攒够 10，才谈得上送 1 个给十位。
 * 十位在个位算完之前根本不知道该加几。所以顺序是被进位的方向**逼**出来的，
 * 不是规定。页面的位值点阵图（PlaceStage）就是演这件事：个位的点满 10 个
 * 捆成一捆，飞到十位；十位才知道自己要多加一捆。
 *
 * ── 四个题型，各自的「坑」不一样 ───────────────────────────
 *   noCarry     每一位乘完都不满十 —— 建立「一位一位地乘」这件事本身
 *   carry       恰好一段连续进位   —— 演「进几」与「进上来的数要加」
 *   carryChain  连着两位都进位     —— 进位会一层层往左传，不能算完一位就收工
 *   tailZero    末尾有 0           —— 巧算：先算前面的数，末尾把 0 补回来
 *   midZero     中间有 0           —— ★ 0×几 得 0，但**还要加上进上来的数**
 *
 * 动画只负责照着 `plan.timeline` 播，自己不参与任何计算；
 * 页面上的高亮区域也全部由 `viewOf()` 纯函数推导，不散落在 JSX 里。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 五个题型。★ 页面渲染题型按钮、引擎抽题都读 `KIND_GROUPS`，页面绝不手写清单 */
export type MulKind = "noCarry" | "carry" | "carryChain" | "tailZero" | "midZero"

/** 竖式里「这一位」的四拍。`idle` / `done` 只用于整段动画的首尾 */
export type Beat = "idle" | "mul" | "add" | "write" | "carry" | "done"

/** 竖式逐位的一步（全部按「从个位起」的下标） */
export interface MulStep {
  /** 第几位，0 = 个位 */
  place: number
  /** 被乘数在这一位上的数字 */
  digit: number
  /** 这一位乘一位数的口诀结果（还没加进位） */
  base: number
  /** 从右边进上来的数（个位恒为 0） */
  carryIn: number
  /** ★ base + carryIn —— 「忘加进位」错的就是把这个数算成了 base */
  sum: number
  /** 写在结果这一位上的数 = sum 的个位 */
  write: number
  /** 向前一位进的数 = sum 的十位（可能是 2..8，不是只有 1） */
  carryOut: number
  /** 口诀原文，如「三八二十四」；某一位是 0 时为空串 */
  chant: string
}

/** 时间轴上的一拍 */
export interface BeatNode {
  index: number
  place: number
  beat: Beat
}

export interface MulPlan {
  value: number
  factor: number
  product: number
  /** 被乘数各位，**从个位起**（digits[0] 是个位） */
  digits: number[]
  steps: MulStep[]
  /** 最高位算完还有进位 ⇒ 积比被乘数多一位 */
  grewTop: boolean
  /** 积的各位，**从个位起**；`grewTop` 时最后一项是新增的那一位 */
  resultDigits: number[]
  /** 竖式一共几列（结果位数 ≥ 被乘数位数） */
  cols: number
  /** ★ 唯一的播片脚本：页面只需按 index 往前走 */
  timeline: BeatNode[]
}

export interface BeatState {
  index: number
  place: number
  beat: Beat
  total: number
}

/** ★ 由 (index) 推出的全部可视状态 —— 纯函数，单测可以直接钉住 */
export interface MoView {
  index: number
  total: number
  place: number
  beat: Beat
  finished: boolean
  /** 结果行每一格写了什么（从个位起；null = 还没写到） */
  resultCells: (number | null)[]
  /** 进位槽：第 i 格是「被送进第 i 位」的那个数（写在竖式上方；null = 还没送到） */
  carryCells: (number | null)[]
  hl: {
    /** 被乘数哪一位在发光（null = 没有） */
    digit: number | null
    /** 一位数因数在发光 */
    factor: boolean
    /** × 号在发光 */
    op: boolean
    /** 哪个进位槽在发光 */
    carryIn: number | null
    /** 结果行哪一格刚写下（发光） */
    write: number | null
    /** 积最前面新长出来的那一格在发光 */
    topCarry: boolean
    /** 口诀是否亮相 */
    chant: boolean
    /** 本拍露出的中间得数 */
    shown: "base" | "sum" | null
  }
  /** 这一拍在讲什么 */
  say: string
  /** 这一拍的易错提醒（没有则空串） */
  warn: string
}

export interface SolveStep {
  key: string
  label: string
  ask: string
  options: string[]
  answer: string
  tip: string
}

export interface MulTrap {
  label: string
  value: number
  why: string
}

export interface TailZeroHint {
  /** 去掉末尾 0 之后的数 */
  core: number
  /** 末尾有几个 0 */
  zeros: number
  /** core × factor */
  coreProduct: number
}

export interface MulProblem {
  groupKey: MulKind
  value: number
  factor: number
  product: number
  plan: MulPlan
  fullText: string
  tail: TailZeroHint | null
  solveSteps: SolveStep[]
  /** 经典错答 —— 练习收尾时用来点破 */
  traps: MulTrap[]
  finalNote: string
}

export interface MulKindGroup {
  key: MulKind
  emoji: string
  title: string
  desc: string
}

export interface MistakeCase {
  wrong: string
  right: string
  why: string
  tip: string
  /** ★ 可核验的算式：单测逐条重算 `value × factor === product`，避免展示数据和引擎脱节 */
  check?: { value: number; factor: number; product: number }
}

export interface Rule {
  title: string
  body: string
}

/** 每拍用多久（ms）。`add` 只在真的进上来了数时才走，所以「无进位」的位会快很多 */
export const BEAT_MS: Record<Exclude<Beat, "idle" | "done">, number> = {
  mul: 700,
  add: 620,
  write: 460,
  carry: 620,
}

/** 收尾停顿 */
export const TAIL_MS = 420

const PLACE_NAMES = ["个位", "十位", "百位", "千位", "万位"]

export function placeName(i: number): string {
  return PLACE_NAMES[i] ?? `从右往左第 ${i + 1} 位`
}

// ────────────────────────────────────────────────────────────
// 中文数字与乘法口诀
// ────────────────────────────────────────────────────────────

const CN_DIGIT = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"]

/** 10 ⇒ 一十（口诀里就是「二五一十」）、12 ⇒ 十二、20 ⇒ 二十、24 ⇒ 二十四 */
export function cnNum(n: number): string {
  if (n < 10) return CN_DIGIT[n]
  if (n === 10) return "一十"
  const t = Math.floor(n / 10)
  const u = n % 10
  return (t === 1 ? "十" : CN_DIGIT[t] + "十") + (u ? CN_DIGIT[u] : "")
}

/**
 * 口诀原文。★ 教材口径是**小数在前**：「8 × 3」写「三八二十四」，不写「八三二十四」。
 * 积不满十要带「得」：「二三得六」。
 * 有 0 的算式没有口诀（`0 × 5` 教材只说「0 乘任何数都得 0」）⇒ 返回空串。
 */
export function chant(a: number, b: number): string {
  if (a === 0 || b === 0) return ""
  const [x, y] = a <= b ? [a, b] : [b, a]
  const p = a * b
  return p < 10 ? `${CN_DIGIT[x]}${CN_DIGIT[y]}得${CN_DIGIT[p]}` : `${CN_DIGIT[x]}${CN_DIGIT[y]}${cnNum(p)}`
}

// ────────────────────────────────────────────────────────────
// 数字分解 / 拼装
// ────────────────────────────────────────────────────────────

/** 各位数字，**从个位起** */
export function digitsOf(n: number): number[] {
  const out: number[] = []
  let v = Math.abs(Math.trunc(n))
  if (v === 0) return [0]
  while (v > 0) {
    out.push(v % 10)
    v = Math.floor(v / 10)
  }
  return out
}

/** 把「从个位起」的各位拼回一个整数 */
export function fromDigits(digitsLe: number[]): number {
  let v = 0
  for (let i = digitsLe.length - 1; i >= 0; i--) v = v * 10 + digitsLe[i]
  return v
}

// ────────────────────────────────────────────────────────────
// 竖式轨迹 planSteps
// ────────────────────────────────────────────────────────────

function beatsOf(s: MulStep): Beat[] {
  const b: Beat[] = ["mul"]
  // ★ 没有进上来的数就**不走**这一拍 —— 既省时间，也避免把「加 0」讲成一个动作
  if (s.carryIn > 0) b.push("add")
  b.push("write")
  if (s.carryOut > 0) b.push("carry")
  return b
}

/**
 * 竖式逐位相乘。**这里是全页唯一的算术出处**：页面上的每一个数字（包括高亮）
 * 都来自这条轨迹，页面自己不做任何加减。
 */
export function planSteps(value: number, factor: number): MulPlan {
  assertOperands(value, factor)
  const digits = digitsOf(value)
  const steps: MulStep[] = []
  let carry = 0

  for (let place = 0; place < digits.length; place++) {
    const digit = digits[place]
    const base = digit * factor
    const carryIn = carry // 个位恒为 0；其余位 = 右一位的 carryOut
    const sum = base + carryIn
    const write = sum % 10
    const carryOut = Math.floor(sum / 10)
    steps.push({
      place,
      digit,
      base,
      carryIn,
      sum,
      write,
      carryOut,
      chant: chant(digit, factor),
    })
    carry = carryOut
  }

  const grewTop = carry > 0
  const resultDigits = steps.map((s) => s.write)
  if (grewTop) resultDigits.push(carry)

  const timeline: BeatNode[] = []
  for (const s of steps) {
    for (const beat of beatsOf(s)) {
      timeline.push({ index: timeline.length, place: s.place, beat })
    }
  }

  return {
    value,
    factor,
    product: value * factor,
    digits,
    steps,
    grewTop,
    resultDigits,
    cols: Math.max(digits.length, resultDigits.length),
    timeline,
  }
}

function assertOperands(value: number, factor: number): void {
  if (!Number.isInteger(value) || value < 10) {
    throw new Error(`被乘数必须是 ≥ 10 的整数（多位数），收到 ${value}`)
  }
  if (!Number.isInteger(factor) || factor < 2 || factor > 9) {
    throw new Error(`一位数必须是 2..9 的整数，收到 ${factor}`)
  }
}

// ────────────────────────────────────────────────────────────
// ★ 四个互不相干的「裁判」—— 单测用它们交叉验算
// ────────────────────────────────────────────────────────────

/** 裁判②：直接交给 JS 引擎乘 */
export function productOf(value: number, factor: number): number {
  return value * factor
}

/** 裁判③：分位展开相加（`137×6 = 100×6 + 30×6 + 7×6`），跟竖式的循环完全不同 */
export function productByExpansion(value: number, factor: number): number {
  let sum = 0
  let v = Math.abs(Math.trunc(value))
  let place = 1
  while (v > 0) {
    sum += (v % 10) * place * factor
    v = Math.floor(v / 10)
    place *= 10
  }
  return sum
}

/** 裁判④：把竖式**写下来的各位**重新拼回一个数 */
export function productFromPlan(plan: MulPlan): number {
  return fromDigits(plan.resultDigits)
}

/**
 * ★ 错答生成器①：每一位都忘了加进上来的数。
 * 这是全章最高频的错误（`27 × 4` ⇒ 88），所以它必须由**独立的规则**重算，
 * 不能靠「答案减个什么」硬凑。
 */
export function productDroppingCarries(value: number, factor: number): number {
  const digits = digitsOf(value)
  const out = digits.map((d) => (d * factor) % 10)
  return fromDigits(out)
}

/**
 * ★ 错答生成器②：每处进位都只进 1（满几十也只进 1）。
 * `68 × 4` 应该进 3，只进 1 ⇒ 252（正确 272）。
 *
 * ⚠️ 最高位（最后一次）**不能**套这条错误规则：那里算出来的数整块写在最前面，
 * 根本没有「写几进几」这一步。我第一版就在这里栽了 —— 把 68×4 算成 152 而不是 252。
 */
export function productCarryOneOnly(value: number, factor: number): number {
  const digits = digitsOf(value)
  const out: number[] = []
  let carry = 0
  for (let i = 0; i < digits.length; i++) {
    const sum = digits[i] * factor + carry
    if (i === digits.length - 1) {
      // 最高位：整块写下（sum ≤ 9×9+8 = 89，十位最多是 8）
      out.push(sum % 10)
      const hi = Math.floor(sum / 10)
      if (hi > 0) out.push(hi)
      break
    }
    out.push(sum % 10)
    carry = sum >= 10 ? 1 : 0 // ★ 错在「不管满几十都只进 1」
  }
  return fromDigits(out)
}

/**
 * ★ 错答生成器③：被乘数哪一位是 0，就直接写 0 —— 忘了 0 还要加上进上来的数。
 * `305 × 6` ⇒ 1800（正确 1830）。这一条专治「中间有 0」这个题型。
 */
export function productZeroDropsCarry(value: number, factor: number): number {
  const digits = digitsOf(value)
  const out: number[] = []
  let carry = 0
  for (const d of digits) {
    // ★ 错在把「0 乘任何数都得 0」当成了「这一位就是 0」
    const sum = d === 0 ? 0 : d * factor + carry
    out.push(sum % 10)
    carry = Math.floor(sum / 10)
  }
  if (carry > 0) out.push(carry)
  return fromDigits(out)
}

// ────────────────────────────────────────────────────────────
// 题型判定（生成器与单测共用同一套判据，避免两处口径漂移）
// ────────────────────────────────────────────────────────────

/** 连续进位的**最长连段**长度 */
export function maxCarryRun(steps: MulStep[]): number {
  let best = 0
  let cur = 0
  for (const s of steps) {
    if (s.carryOut > 0) {
      cur++
      best = Math.max(best, cur)
    } else {
      cur = 0
    }
  }
  return best
}

export function kindOf(plan: MulPlan): MulKind {
  // ① 末尾有 0：这一组的教学点是**巧算**，优先判
  if (plan.value % 10 === 0) return "tailZero"
  // ② 中间有 0（只可能是三位数的十位）：教学点是「0 也要加进位 / 不能漏写 0」
  const digits = plan.digits
  if (digits.length >= 3 && digits.slice(1, digits.length - 1).some((d) => d === 0)) return "midZero"
  // ③ 按进位连段分
  const run = maxCarryRun(plan.steps)
  if (run === 0) return "noCarry"
  if (run === 1) return "carry"
  return "carryChain"
}

// ────────────────────────────────────────────────────────────
// 题型清单（★ 单一来源）
// ────────────────────────────────────────────────────────────

export const KIND_GROUPS: MulKindGroup[] = [
  { key: "noCarry", emoji: "🔹", title: "不进位", desc: "每一位乘完都不满十，顺着写下来就行" },
  { key: "carry", emoji: "🔸", title: "进位", desc: "有一位满十，要向左边一位进几" },
  { key: "carryChain", emoji: "🔗", title: "连续进位", desc: "连着两位都满十，进位一层层往左传" },
  { key: "tailZero", emoji: "0️⃣", title: "末尾有 0", desc: "先算前面的数，最后把 0 补回来" },
  { key: "midZero", emoji: "🕳️", title: "中间有 0", desc: "0 乘得 0，但别忘了再加上进上来的数" },
]

// ────────────────────────────────────────────────────────────
// 视图推导（纯函数）—— 页面只渲染，不判断
// ────────────────────────────────────────────────────────────

export function beatStateAt(plan: MulPlan, index: number): BeatState {
  const total = plan.timeline.length
  if (total === 0) return { index: 0, place: 0, beat: "done", total: 0 }
  if (index < 0) return { index: -1, place: 0, beat: "idle", total }
  if (index >= total) {
    const last = plan.timeline[total - 1]
    return { index: total, place: last.place, beat: "done", total }
  }
  const n = plan.timeline[index]
  return { index, place: n.place, beat: n.beat, total }
}

export function viewOf(plan: MulPlan, index: number): MoView {
  const st = beatStateAt(plan, index)
  const { place, beat, total } = st
  const finished = index >= total
  const len = plan.steps.length
  const step = plan.steps[Math.min(Math.max(place, 0), len - 1)]

  // ── 结果行 ──
  // 第 i 位（0 = 个位）什么时候被写下来？
  // ⚠️ 必须先判 `finished`：否则「播完」这一帧会走进 `beat === "done"` 的分支、
  //    把已经写出来的格子**又变回 null** —— 表现是「动画放完，个位数字消失了」。
  //    （这是单测里「播完结果行应当写满」那条当场抓出来的。）
  const resultCells: (number | null)[] = plan.resultDigits.map((v, i) => {
    if (finished) return v
    if (i < len) {
      if (i < place) return plan.steps[i].write
      if (i === place && (beat === "write" || beat === "carry")) return plan.steps[i].write
      return null
    }
    // 多出来的最高位：只有最后一位「进」的那一拍才露面
    return place === len - 1 && beat === "carry" ? v : null
  })

  // ── 进位槽 ──
  // 槽 i 里装的是「被送进第 i 位」的数 = steps[i].carryIn。它由第 i-1 位的「进」那一拍填上。
  const carryCells: (number | null)[] = Array.from({ length: len }, (_, i) => {
    const v = plan.steps[i].carryIn
    if (v === 0) return null
    if (i - 1 < place) return v
    if (i - 1 === place && beat === "carry") return v
    return null
  })

  const hl: MoView["hl"] = {
    digit: null,
    factor: false,
    op: false,
    carryIn: null,
    write: null,
    topCarry: false,
    chant: false,
    shown: null,
  }
  let say = ""
  let warn = ""

  if (beat === "mul") {
    hl.digit = place
    hl.factor = true
    hl.op = true
    hl.chant = step.digit > 0
    hl.shown = "base"
    say = step.digit === 0
      ? step.carryIn > 0
        ? `${placeName(place)}上是 0 —— 0 乘 ${plan.factor} 得 0。先记着这个 0，等一下还要加上进上来的数。`
        : `${placeName(place)}上是 0 —— 0 乘任何数都得 0，这一位就写 0。`
      : `${placeName(place)}上的 ${step.digit} 乘 ${plan.factor} —— ${step.chant}，得 ${step.base}。`
    if (step.digit * plan.factor >= 10) {
      warn = `⚠️ ${step.chant}，满十了 —— 等一下要把十位那个数往左边送。`
    }
  } else if (beat === "add") {
    hl.carryIn = place
    hl.shown = "sum"
    say = `再加上${placeName(place - 1)}进上来的 ${step.carryIn}：${step.base} + ${step.carryIn} = ${step.sum}。`
    warn = step.digit === 0
      ? `⚠️ 这一位是 0，0 乘 ${plan.factor} 得 0 —— 但 0 还要加上进上来的 ${step.carryIn}，直接写 0 就错了。`
      : `⚠️ 别忘了把刚进上来的 ${step.carryIn} 加进去。这一步是全章错得最多的地方。`
  } else if (beat === "write") {
    hl.write = place
    hl.shown = "sum"
    say = step.carryOut > 0
      ? `${step.sum} 的个位是 ${step.write}，写在${placeName(place)}下面；十位那个 ${step.carryOut} 先记着。`
      : `${step.sum} 不满十，${step.write} 直接写在${placeName(place)}下面，不用进位。`
    if (step.carryOut > 1) warn = `⚠️ 满 ${step.sum}，要向前一位进 ${step.carryOut}，不是进 1。`
  } else if (beat === "carry") {
    hl.shown = "sum"
    if (place === len - 1) {
      hl.topCarry = true
      say = `${step.sum} 满十了 —— ${step.carryOut} 写在最前面，积就比原来的数多一位。`
    } else {
      hl.carryIn = place + 1
      say = `${step.sum} 满十了 —— ${step.carryOut} 送到前一位（${placeName(place + 1)}）的头上去，算那一位的时候要加上它。`
    }
  } else if (beat === "done") {
    hl.shown = "sum"
    say = `${plan.value} × ${plan.factor} = ${plan.product}。每一位都乘完、进位都加上了，竖式就完成了。`
  } else {
    say = `准备好了 —— 从个位开始，一位一位地乘。`
  }

  return {
    index,
    total,
    place: st.place,
    beat,
    finished,
    resultCells,
    carryCells,
    hl,
    say,
    warn,
  }
}

// ────────────────────────────────────────────────────────────
// 巧算（末尾有 0）
// ────────────────────────────────────────────────────────────

export function tailZeroHint(value: number, factor: number): TailZeroHint | null {
  if (value % 10 !== 0) return null
  let zeros = 0
  let core = value
  while (core % 10 === 0) {
    core = core / 10
    zeros++
  }
  return { core, zeros, coreProduct: core * factor }
}

// ────────────────────────────────────────────────────────────
// 出题
// ────────────────────────────────────────────────────────────

function rnd(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 选项拼装：保证**答案只出现一次**、选项互不重复、至少 2 个。
 * ★ 单测会逐条断言这三件事 —— 选项重复或漏掉答案是最容易悄悄发生的事故。
 */
function optsFor(answer: string, cands: string[], filler: string[] = []): string[] {
  const out = [answer]
  for (const c of [...cands, ...filler]) {
    if (out.length >= 4) break
    if (!c || c === answer || out.includes(c)) continue
    out.push(c)
  }
  return shuffle(out)
}

/** 数值型选项的兜底干扰项（只在真正的错答凑不够时才用得上） */
function numFillers(answer: number): string[] {
  return [answer + 10, answer - 10, answer + 1, answer - 1, answer * 10, Math.floor(answer / 10)]
    .filter((n) => Number.isInteger(n) && n > 0 && n !== answer)
    .map(String)
}

/** 每个题型都放一个「怎么算都对不上」的兜底题，避免随机抽不到时死循环 */
const FALLBACK: Record<MulKind, { value: number; factor: number }> = {
  // 23 × 3 = 69：两位都不满十
  noCarry: { value: 23, factor: 3 },
  // 38 × 2 = 76：个位 8×2=16 进 1，十位 3×2+1=7 不进位 ⇒ 正好一段
  carry: { value: 38, factor: 2 },
  // 137 × 6 = 822：个位进 4、十位进 2 ⇒ 连续两段
  carryChain: { value: 137, factor: 6 },
  // 280 × 3 = 840：`28 × 3 = 84` 末尾补 1 个 0
  tailZero: { value: 280, factor: 3 },
  // 305 × 6 = 1830：十位 0×6=0，但必须加上个位进上来的 3
  midZero: { value: 305, factor: 6 },
}

function pickNoCarry(): { value: number; factor: number } {
  // factor ≥ 5 时每位只能填 1（1×5=5），题面太机械 ⇒ 只取 2..4
  const factor = rnd(2, 4)
  const maxDigit = Math.floor(9 / factor) // 2⇒4、3⇒3、4⇒2
  const len = Math.random() < 0.5 ? 2 : 3
  for (let attempt = 0; attempt < 40; attempt++) {
    const digits = Array.from({ length: len }, () => rnd(1, maxDigit))
    if (new Set(digits).size === 1) continue // 222×3 这类太像抄写
    const value = fromDigits(digits)
    if (value % 10 === 0) continue
    if (planSteps(value, factor).steps.some((s) => s.carryOut > 0)) continue
    return { value, factor }
  }
  return FALLBACK.noCarry
}

function pickCarry(): { value: number; factor: number } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const factor = rnd(2, 9)
    const len = Math.random() < 0.5 ? 2 : 3
    const digits = Array.from({ length: len }, () => rnd(1, 9))
    const value = fromDigits(digits)
    if (value % 10 === 0) continue
    if (digits.slice(1, len - 1).some((d) => d === 0)) continue // 中间有 0 留给 midZero
    if (maxCarryRun(planSteps(value, factor).steps) !== 1) continue
    return { value, factor }
  }
  return FALLBACK.carry
}

function pickCarryChain(): { value: number; factor: number } {
  for (let attempt = 0; attempt < 400; attempt++) {
    const factor = rnd(3, 9)
    const len = Math.random() < 0.45 ? 2 : 3
    // 低位先给大一点，进位才连得起来
    const digits = Array.from({ length: len }, (_, i) => (i === 0 ? rnd(5, 9) : rnd(2, 9)))
    const value = fromDigits(digits)
    if (value % 10 === 0) continue
    if (digits.slice(1, len - 1).some((d) => d === 0)) continue
    if (maxCarryRun(planSteps(value, factor).steps) >= 2) return { value, factor }
  }
  return FALLBACK.carryChain
}

function pickTailZero(): { value: number; factor: number } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const core = rnd(12, 99)
    if (core % 10 === 0) continue // core 自己带 0 就不是「末尾恰好一个 0」了
    const factor = rnd(2, 9)
    const value = core * 10
    if (planSteps(value, factor).steps[0].carryOut !== 0) continue
    return { value, factor }
  }
  return FALLBACK.tailZero
}

function pickMidZero(): { value: number; factor: number } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const a = rnd(1, 9)
    // ★ 个位取 5..9 ⇒ 个位乘一位数必然满十 ⇒ 十位（那个 0）一定收到进位，
    //   于是「0 不能直接写 0」这个教学点必然出现，不用碰运气
    const c = rnd(5, 9)
    const factor = rnd(2, 9)
    const value = a * 100 + c
    const plan = planSteps(value, factor)
    if (plan.steps[1].carryIn === 0) continue
    if (kindOf(plan) !== "midZero") continue
    return { value, factor }
  }
  return FALLBACK.midZero
}

const PICKERS: Record<MulKind, () => { value: number; factor: number }> = {
  noCarry: pickNoCarry,
  carry: pickCarry,
  carryChain: pickCarryChain,
  tailZero: pickTailZero,
  midZero: pickMidZero,
}

export function genPlan(groupKey: MulKind): MulPlan {
  const pick = PICKERS[groupKey]
  if (!pick) throw new Error(`未知题型：${groupKey}`)
  for (let attempt = 0; attempt < 8; attempt++) {
    const { value, factor } = pick()
    const plan = planSteps(value, factor)
    if (kindOf(plan) === groupKey) return plan
  }
  const f = FALLBACK[groupKey]
  const plan = planSteps(f.value, f.factor)
  if (kindOf(plan) !== groupKey) {
    // 兜底题也必须自证属于本组 —— 否则宁可炸掉，也不要悄悄换一个题型给学生
    throw new Error(`兜底题 ${f.value} × ${f.factor} 不属于题型 ${groupKey}（实测 ${kindOf(plan)}）`)
  }
  return plan
}

// ────────────────────────────────────────────────────────────
// 一步一填
// ────────────────────────────────────────────────────────────

const WRITE_NONE = "不进位"

function makeVerticalSteps(plan: MulPlan): SolveStep[] {
  const out: SolveStep[] = []
  const len = plan.steps.length

  for (let i = 0; i < len; i++) {
    const s = plan.steps[i]
    const pn = placeName(i)

    // ── ① 乘（再加进位）──
    const mulCands: string[] = []
    if (s.carryIn > 0) {
      mulCands.push(String(s.base)) // ★ 忘了加进上来的数（最高频错答）
      mulCands.push(String(s.sum + s.carryIn)) // 把进位的数加了两次
    } else {
      const nb = s.digit * (plan.factor === 9 ? 8 : plan.factor + 1)
      if (nb !== s.sum) mulCands.push(String(nb)) // 口诀背错
      const nb2 = (s.digit === 1 ? 2 : s.digit - 1) * plan.factor
      if (nb2 !== s.sum) mulCands.push(String(nb2))
    }
    out.push({
      key: `mul${i}`,
      label: `${pn} · 乘`,
      ask:
        s.carryIn > 0
          ? `${pn}上：${s.digit} × ${plan.factor} = ${s.base}，再加上右边进上来的 ${s.carryIn}，一共是多少？`
          : `${pn}上：${s.digit} × ${plan.factor} = ?`,
      options: optsFor(String(s.sum), mulCands, numFillers(s.sum)),
      answer: String(s.sum),
      tip:
        s.digit === 0 && s.carryIn > 0
          ? `0 乘 ${plan.factor} 确实是 0，但这一位不是 0 —— 还要加上进上来的 ${s.carryIn}。`
          : s.carryIn > 0
            ? `${s.digit} × ${plan.factor} = ${s.base}，再加上进上来的 ${s.carryIn}，得 ${s.sum}。漏掉进位就会算成 ${s.base}，这正是 27×4 被算成 88 的原因。`
            : `${pn}上的 ${s.digit} 乘 ${plan.factor}（${s.chant || "0 乘任何数都得 0"}）得 ${s.sum}。`,
    })

    // ── ② 写几、进几 ──
    const carryWord = s.carryOut > 0 ? `进 ${s.carryOut}` : WRITE_NONE
    const answer = `写 ${s.write}，${carryWord}`
    const writeCands: string[] = []
    if (s.carryOut > 0) {
      writeCands.push(`写 ${s.write}，${WRITE_NONE}`) // ★ 漏进位
      writeCands.push(`写 ${s.carryOut}，进 ${s.write}`) // 写反
      if (s.carryOut !== 1) writeCands.push(`写 ${s.write}，进 1`) // ★ 满几十只进 1
    } else {
      writeCands.push(`写 ${s.write}，进 1`) // 不该进位却进了一位
      writeCands.push(`写 ${s.sum}，${WRITE_NONE}`) // 整块写下来
    }
    // 写「几」本身也有干扰项（改数字、保持进位说法）
    const writeFillers = [s.write + 1, Math.max(0, s.write - 1), s.write + 2]
      .filter((w) => w <= 9 && w !== s.write)
      .map((w) => `写 ${w}，${carryWord}`)
    out.push({
      key: `write${i}`,
      label: `${pn} · 写`,
      ask: `${s.sum} —— ${pn}下面写几？向前一位进几？`,
      options: optsFor(answer, writeCands, writeFillers),
      answer,
      tip:
        s.carryOut > 0
          ? `${s.sum} 的个位 ${s.write} 留在${pn}，十位 ${s.carryOut} 送到前一位头上。` +
            (i === len - 1 ? "这是最前面了，所以它直接写进积的最高位，积就多一位。" : "")
          : `${s.sum} 不到 10，${s.write} 直接写在${pn}，不用进位。`,
    })
  }

  return out
}

function makeTailZeroSteps(plan: MulPlan, tail: TailZeroHint): SolveStep[] {
  const out: SolveStep[] = []
  const drop = productDroppingCarries(tail.core, plan.factor)
  const one = productCarryOneOnly(tail.core, plan.factor)
  const p = tail.coreProduct

  out.push({
    key: "core",
    label: "① 先算前面",
    ask: `不看末尾的 ${"0".repeat(tail.zeros)}，先算 ${tail.core} × ${plan.factor} = ?`,
    options: optsFor(
      String(p),
      [drop, one].filter((n) => n !== p).map(String),
      numFillers(p),
    ),
    answer: String(p),
    tip: `${tail.core} × ${plan.factor} = ${p}。末尾的 0 先放一边，算完再补 —— 这样只要算两位数。`,
  })

  out.push({
    key: "zeros",
    label: "② 数一数 0",
    ask: `${plan.value} 的末尾有几个 0？`,
    options: ["没有 0", "1 个 0", "2 个 0"],
    answer: `${tail.zeros} 个 0`,
    tip: `${tail.core} 后面跟着 ${tail.zeros} 个 0，所以 ${plan.value} 的末尾有 ${tail.zeros} 个 0。补的时候一个也不能少。`,
  })

  out.push({
    key: "final",
    label: "③ 补上 0",
    ask: `${p} 的末尾补上 ${tail.zeros} 个 0，${plan.value} × ${plan.factor} = ?`,
    options: optsFor(
      String(plan.product),
      [String(p), String(p * Math.pow(10, tail.zeros + 1))],
      numFillers(plan.product),
    ),
    answer: String(plan.product),
    tip: `${p} 后面补 ${tail.zeros} 个 0 ⇒ ${plan.product}。漏补就少一个 0（变成 ${p}），多补就多一个 0。`,
  })

  return out
}

/**
 * 错答候选的准入标准。
 * ⚠️ 必须滤掉 ≤ 0 的退化值：`220 × 5` 要是每一位都漏加进位，写下来就是 0，
 * 而「0」摆在选项里毫无干扰作用（还容易被当成印刷错误）。只留正整数候选。
 */
function usableTraps(values: number[], answer: number): string[] {
  return values.filter((n) => n !== answer && Number.isInteger(n) && n > 0).map(String)
}

export function makeSolveSteps(plan: MulPlan): SolveStep[] {
  const tail = tailZeroHint(plan.value, plan.factor)
  // ★ 巧算三问的最后一步问的就是积 —— 不要再追加一次通用的「写完整」，
  //   否则键会重名（final, final），同一个问题还会连着问两遍。
  if (tail) return makeTailZeroSteps(plan, tail)

  const out = makeVerticalSteps(plan)

  // 收尾：把竖式写完整，并且把经典错答摆出来让学生认一认
  const drop = productDroppingCarries(plan.value, plan.factor)
  const one = productCarryOneOnly(plan.value, plan.factor)
  const zero = productZeroDropsCarry(plan.value, plan.factor)
  out.push({
    key: "final",
    label: "写完整",
    ask: `把每一位写下来：${plan.value} × ${plan.factor} = ?`,
    options: optsFor(String(plan.product), usableTraps([drop, one, zero], plan.product), numFillers(plan.product)),
    answer: String(plan.product),
    tip: `${plan.value} × ${plan.factor} = ${plan.product}。${
      plan.grewTop ? "最高位进上来的那个数也算一位，别忘了写。" : ""
    }`,
  })
  return out
}

function makeTraps(plan: MulPlan): MulTrap[] {
  const out: MulTrap[] = []
  const drop = productDroppingCarries(plan.value, plan.factor)
  const one = productCarryOneOnly(plan.value, plan.factor)
  const zero = productZeroDropsCarry(plan.value, plan.factor)
  const taken = new Set<number>([plan.product])

  if (drop !== plan.product && drop > 0) {
    taken.add(drop)
    out.push({
      label: `算成 ${drop}`,
      value: drop,
      why: "每一位都忘了把右边进上来的数加进去。比如 27 × 4 被算成 88，就是这个原因。",
    })
  }
  if (one !== plan.product && one > 0 && !taken.has(one)) {
    taken.add(one)
    out.push({
      label: `算成 ${one}`,
      value: one,
      why: "每一处进位都只进 1，可是 8 × 6 = 48 要进 4 —— 满几十就进几。比如 68 × 4 就这样被算成了 252。",
    })
  }
  if (zero !== plan.product && zero > 0 && !taken.has(zero)) {
    out.push({
      label: `算成 ${zero}`,
      value: zero,
      why: "被乘数中间那一位是 0，就直接写了 0 —— 可它还要加上进上来的数。比如 305 × 6 被算成 1800，就是这个原因。",
    })
  }
  return out
}

// ────────────────────────────────────────────────────────────
// 组题
// ────────────────────────────────────────────────────────────

export function buildProblem(plan: MulPlan, groupKey: MulKind): MulProblem {
  const tail = tailZeroHint(plan.value, plan.factor)
  const note =
    groupKey === "tailZero" && tail
      ? `${plan.value} × ${plan.factor} = ${plan.product}。${tail.core} × ${plan.factor} = ${tail.coreProduct}，末尾再补 ${tail.zeros} 个 0。`
      : groupKey === "midZero"
        ? `${plan.value} × ${plan.factor} = ${plan.product}。中间那一位是 0，0 乘 ${plan.factor} 得 0，但还要加上进上来的数 —— 所以它不是 0。`
        : `${plan.value} × ${plan.factor} = ${plan.product}。从个位起一位一位地乘，满十就向前一位进几。`

  return {
    groupKey,
    value: plan.value,
    factor: plan.factor,
    product: plan.product,
    plan,
    fullText: `${plan.value} × ${plan.factor} = ?`,
    tail,
    solveSteps: makeSolveSteps(plan),
    traps: makeTraps(plan),
    finalNote: note,
  }
}

export function genProblem(groupKey: MulKind): MulProblem {
  const plan = genPlan(groupKey)
  return buildProblem(plan, groupKey)
}

/** 一次抽 n 道（页面用 4 道一组）。同一组内不出现同一道题 */
export function genProblemSet(groupKey: MulKind, n = 4): MulProblem[] {
  const out: MulProblem[] = []
  const seen = new Set<string>()
  let guard = 0
  while (out.length < n && guard < n * 80) {
    guard++
    const p = genProblem(groupKey)
    const tag = `${p.value}-${p.factor}`
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(p)
  }
  return out
}

// ────────────────────────────────────────────────────────────
// 静态教学资料
// ────────────────────────────────────────────────────────────

export const RULES: Rule[] = [
  {
    title: "从个位乘起 —— 因为进位只能往左走",
    body:
      "个位先攒够 10，才谈得上送 1 个给十位；十位在个位算完之前根本不知道该加几。" +
      "所以「从个位起」不是规定，是被进位的方向逼出来的。" +
      "从高位起也能算对，但每算一位都要回头改，容易乱。",
  },
  {
    title: "哪一位满几十，就向前一位进几",
    body:
      "4 × 6 = 24，向前进 2；8 × 6 = 48，向前进 4。进的是「十位上的那个数」，" +
      "不是不管三七二十一都进 1 —— 68 × 4 应该进 3，只进 1 就会算成 252。",
  },
  {
    title: "进上来的数要「加」进去",
    body:
      "算完下一位的乘法，还要把进上来的数加上。这一步是全章错得最多的地方：" +
      "27 × 4，个位 7 × 4 = 28 写 8 进 2，十位 2 × 4 = 8 —— 别忘了 8 + 2 = 10。",
  },
  {
    title: "末尾有 0：先算前面，最后补 0",
    body:
      "280 × 5 不用一位一位地乘。先算 28 × 5 = 140，末尾再补 1 个 0 ⇒ 1400。" +
      "补几个 0，就看被乘数末尾原来有几个 0。",
  },
]

/**
 * ★ 每一条都人工验算过，并且带 `check` 的那几条会被单测逐条重算。
 * 注意这里**不写 markdown 的 `**`** —— 页面上是纯文本渲染，星号会原样露出来。
 */
export const MISTAKE_CASES: MistakeCase[] = [
  {
    wrong: "27 × 4 = 88",
    right: "27 × 4 = 108",
    why:
      "个位 7 × 4 = 28，写 8 进 2；算十位 2 × 4 = 8 的时候，忘了把进上来的 2 加上去。" +
      "应该 8 + 2 = 10，写 0 进 1。",
    tip: "凡是上一句出现过「进几」，下一句就一定要「加上几」。在进位数旁边画个小圈提醒自己。",
    check: { value: 27, factor: 4, product: 108 },
  },
  {
    wrong: "305 × 6 = 1800",
    right: "305 × 6 = 1830",
    why:
      "十位是 0，孩子看见「0 × 6 = 0」就直接写了个 0，忘了个位 5 × 6 = 30 还进了 3 上来。" +
      "这一位其实是 0 + 3 = 3。",
    tip: "0 乘任何数都得 0，这句话没错 —— 但这一位要算的是「0 × 6 的积 再加上进位的数」。",
    check: { value: 305, factor: 6, product: 1830 },
  },
  {
    wrong: "403 × 2 = 86",
    right: "403 × 2 = 806",
    why: "十位算出来是 0，孩子干脆没写，结果百位的 8 掉到了十位上，整个数位全错位了。",
    tip: "哪一位算出来是 0，也要把 0 老老实实写在那一格上 —— 0 占的不是位置，是数位。",
    check: { value: 403, factor: 2, product: 806 },
  },
  {
    wrong: "160 × 3 = 48",
    right: "160 × 3 = 480",
    why: "用巧算先算了 16 × 3 = 48，最后忘了把末尾那个 0 补回去。",
    tip: "巧算分两步：先算前面、再补 0。写完一定要回头数一数，被乘数末尾有几个 0。",
    check: { value: 160, factor: 3, product: 480 },
  },
  {
    wrong: "68 × 4 = 252",
    right: "68 × 4 = 272",
    why:
      "个位 8 × 4 = 32，应该向前进 3；孩子不管进多少都只进 1。" +
      "于是十位算成了 6 × 4 + 1 = 25，写 5 进 2。",
    tip: "进位进几，要看这一位乘出来的数十位上是几。32 就进 3，48 就进 4。",
    check: { value: 68, factor: 4, product: 272 },
  },
  {
    wrong: "45 × 3 = 1215",
    right: "45 × 3 = 135",
    why:
      "把十位和个位各自算完就拼起来了：4 × 3 = 12、5 × 3 = 15，直接写成 1215。" +
      "个位满十要往十位进，两块不能各写各的。",
    tip: "竖式是一根链条：每一位算完都要把进位交给前一位，最后只有一个数。",
    check: { value: 45, factor: 3, product: 135 },
  },
  {
    wrong: "78 × 8 = 604",
    right: "78 × 8 = 624",
    why: "口诀背混了：七八五十六记成了七八五十四（和六九五十四串了）。",
    tip: "七八五十六、六九五十四，这两句最爱混。背不牢的时候想「8 × 7 = 8 × 5 + 8 × 2 = 40 + 16」。",
    check: { value: 78, factor: 8, product: 624 },
  },
]
