/** 三年级数学 · 等式变变变 —— 「移项变号」规则引擎（零后端调用）
 *
 * 核心规律：把一个数（或未知数）从等号**一侧挪到另一侧**，符号必须**变相反**
 *     + ↔ -      × ↔ ÷
 * 而**在等号同一侧交换左右位置，符号一点不用调**。
 *
 * 本文件是纯逻辑：
 *   · 出题 —— **反推参数**（先定 x 与操作数，再算出得数），保证每道题恒成立
 *   · 轨迹 —— 每一步 = 「做了什么 / 原来什么样 / 做完什么样」
 *   · 资料 —— 口诀、易错卡、对比练习（全部逐条人工验算过）
 * 动画只负责**照着轨迹播**，自己不参与任何计算。
 *
 * ── 四种动作（MoveAction.type）────────────────────────────
 *   move    跨过等号搬一项 —— **符号必须翻转**（这是本页的主角）
 *   swap    同一侧交换两项位置 —— **符号一点不动**
 *   combine 同一侧合并两个同类项（3x 和 -2x ⇒ x）—— 求值不变，只是写法变短
 *   flip    等式两边整体对调（b = x + a ⇒ x + a = b）—— 等式对称性
 *
 * ★ swap 存在的理由：**首项不写符号**是个纯显示约定，可学生看不见符号就没法判断
 *   「跨过去该变成什么」。所以搬首项之前，先在**同侧**把它换到后面 —— 符号一旦
 *   露出来（`5 + x` ⇒ `x + 5`），再跨线变号就一目了然。
 *   ⚠️ 同侧换位只对 + 和 × 合法（交换律）。`a ÷ x ≠ x ÷ a`，所以中间是 ÷ 时禁止 swap。
 *
 * ⚠️ 减号统一用 ASCII "-"（与 web 全站算式一致），避免和 U+2212 混用导致求值对不上。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

export type Op = "+" | "-" | "×" | "÷"

/** 等式一侧里的一项：写在它**前面**的符号 + 值。
 *  value 可以是 "x" / "5x" / "12" —— 系数紧贴着写（`5x` 表示 5 个 x） */
export interface Term {
  /** 该项前面的运算符（null = 首项正项，屏幕上不写符号） */
  op: Op | null
  value: string
  isVar: boolean
}

export type Side = Term[]
export interface EqState {
  left: Side
  right: Side
}

export type MoveKind =
  // ── 基础：一次搬运，四条互逆规律 ──
  | "plus"
  | "minus"
  | "times"
  | "divide"
  // ── 进阶：要搬两次 / 要显形 ──
  | "minusVar"
  | "divideVar"
  | "revealPlus"
  | "revealTimes"
  // ── 进阶：结构变化（一边多项 / 两边都有 x / 对调）──
  | "xRight"
  | "threeTerms"
  | "bothSides"
  | "multiStep"
  // ── 反例：同侧换位，不变号 ──
  | "sameSide"

/** ★ 13 种题型的分组（页面的题型选择行按这个分组渲染，别把 13 个按钮平铺成一排） */
export const KIND_GROUPS: { title: string; kinds: MoveKind[] }[] = [
  { title: "基础 · 跨线变号", kinds: ["plus", "minus", "times", "divide"] },
  { title: "进阶 · 要搬两次", kinds: ["minusVar", "divideVar", "revealPlus", "revealTimes"] },
  { title: "进阶 · 结构变化", kinds: ["xRight", "threeTerms", "bothSides", "multiStep"] },
  { title: "反例 · 同侧不变号", kinds: ["sameSide"] },
]

export type ActionType = "move" | "swap" | "combine" | "flip"

/** 一步动作。字段含义随 type 变化（用 `actionTypeNote` 的约定，别混用）：
 *   · move    index = 被搬走项的下标 · srcOp/fromOp/toOp = 原写符号/等效符号/跨线后符号
 *   · swap    index/index2 = 交换的两项下标（相邻）· fromOp === toOp（不变号）
 *   · combine index = 保留的位置 · index2 = 被并入的项 · value 为被并入项的值 · combined 为合并后的文本
 *   · flip    index/index2 无意义 · before/after 就是左右互换
 */
export interface MoveAction {
  type: ActionType
  from: "left" | "right"
  index: number
  index2?: number
  /** 被搬的项原本**写出来**的符号（首项为 null —— 屏幕上它前面真的什么都没写） */
  srcOp: Op | null
  /** move: 被搬项在式子里**等效**的运算符（首项 / 因数也算得出来）—— 决定它跨过去会变成什么。
   *  swap: 左侧那一项的等效符号（换位前后一致）。combine/flip: 无意义，恒为 "+"。 */
  fromOp: Op
  /** move: 跨过等号后变成的符号。swap/combine/flip: 与 fromOp 相同。 */
  toOp: Op
  value: string
  isVar: boolean
  /** combine 专用：合并后的显示文本（如 "8" / "2x"） */
  combined?: string
  before: EqState
  after: EqState
  note: string
}

export interface MoveProblem {
  kind: MoveKind
  kindLabel: string
  kindTip: string
  initial: EqState
  actions: MoveAction[]
  /** 全部搬完后要「左右对调」才写成 x = … 的标准形态（a - x = b 这类） */
  flipSides: boolean
  /** 最终规范形态：x = 一个数 */
  final: EqState
  /** x 的解 */
  x: number
  /** 末态右侧算出来的数（恒等于 x） */
  answer: number
  /** 同侧交换（反例）：压根没跨等号，符号不变 */
  isSameSide: boolean
  hint: string
}

// ────────────────────────────────────────────────────────────
// 核心规则
// ────────────────────────────────────────────────────────────

/** ★ 全页的核心：跨过等号 ⇒ 符号必须变相反 */
export function flipOp(op: Op): Op {
  switch (op) {
    case "+":
      return "-"
    case "-":
      return "+"
    case "×":
      return "÷"
    case "÷":
      return "×"
  }
}

/**
 * 某一项在式子里**等效**的运算符 —— 即它跨过等号时会以什么身份变号。
 *
 *   · 写出来的符号（+ / - / × / ÷）直接用
 *   · 首项没写符号时：若它**后面跟的是 × / ÷**，说明它是乘除链的第一个因数 ⇒ 等效 ×
 *     否则等效 +
 *
 * 例：[x, +5] 的 5 ⇒ +   ·   [4, ×x] 的 4 ⇒ ×   ·   [15, -x] 的 15 ⇒ +
 *     [5x] 的 5x ⇒ +（`5x` 是**一个**加数，不是「5 乘 x」两步 —— 系数剥离是另一回事）
 */
export function effectiveOp(side: Side, i: number): Op {
  const t = side[i]
  if (t.op === "-") return "-"
  if (t.op === "×" || t.op === "÷") return t.op
  const next = side[i + 1]
  if (next && (next.op === "×" || next.op === "÷")) return "×"
  return "+"
}

/** 项的系数：x ⇒ 1，5x ⇒ 5，12 ⇒ 12 */
export function coefOf(t: Term): number {
  if (!t.isVar) return Number(t.value)
  const n = Number(t.value.replace(/x$/, ""))
  return Number.isFinite(n) && n !== 0 ? n : 1
}

/** 带符号的系数（前面写 - 的就是负）—— 合并同类项时直接加起来 */
export function signedCoef(t: Term): number {
  return (t.op === "-" ? -1 : 1) * coefOf(t)
}

/** 代入 x 后该项的**纯数值**（`5x` 且 x=3 ⇒ 15） */
export function termValueAt(t: Term, xVal: number): number {
  return t.isVar ? coefOf(t) * xVal : coefOf(t)
}

/** 按系数生成 x 项的显示文本：1 ⇒ "x"，5 ⇒ "5x" */
function varText(coef: number): string {
  return coef === 1 ? "x" : `${coef}x`
}

/** 规范化首项：首项只可能在「-」时写符号，+ / × / ÷ 一律不写 */
function normFirst(side: Side): Side {
  if (side.length === 0) return side
  const h = side[0]
  return [{ ...h, op: h.op === "-" ? "-" : null }, ...side.slice(1)]
}

/** 移走第 i 项之后，把新的首项规范化 */
function removeTerm(side: Side, i: number): Side {
  return normFirst(side.filter((_, k) => k !== i))
}

/** 往一侧的末尾追加一项（搬到对面后排在最后） */
function appendTerm(side: Side, op: Op, value: string, isVar: boolean): Side {
  return [...side, { op, value, isVar }]
}

function putSide(st: EqState, from: "left" | "right", side: Side): EqState {
  return from === "left" ? { left: side, right: st.right } : { left: st.left, right: side }
}

/** 构造一次「搬运动作」：从 st 的某一侧搬走第 index 项，跨等号到对侧末尾，**符号翻转** */
function buildAction(st: EqState, from: "left" | "right", index: number, note: string): MoveAction {
  const src = st[from]
  const t = src[index]
  const fromOp = effectiveOp(src, index)
  const toOp = flipOp(fromOp)
  const after: EqState =
    from === "left"
      ? { left: removeTerm(st.left, index), right: appendTerm(st.right, toOp, t.value, t.isVar) }
      : { left: appendTerm(st.left, toOp, t.value, t.isVar), right: removeTerm(st.right, index) }
  return { type: "move", from, index, srcOp: t.op, fromOp, toOp, value: t.value, isVar: t.isVar, before: st, after, note }
}

/**
 * ★ 构造一次「同侧换位」：把第 i 项与它**右边相邻**的第 i+1 项交换，符号一点不动。
 *
 * 交换后每项写出的符号 = 它**自己**的等效符号，再套一遍「首项不写符号」的约定。
 *   `5 + x` ⇒ `x + 5`   ·   `3 × x` ⇒ `x × 3`   ·   `15 - x` ⇒ `-x + 15`
 *   `2x + 5` ⇒ `5 + 2x`（右边反向同理）
 *
 * 🔴 中间是 **÷** 时**禁止**调用 —— `a ÷ x ≠ x ÷ a`，换位不成立（会直接抛错，别静默出错）。
 */
function buildSwap(st: EqState, from: "left" | "right", i: number, note: string): MoveAction {
  const side = st[from]
  const j = i + 1
  if (i < 0 || j >= side.length) throw new Error(`swap: 下标越界 ${i}/${j}（该侧只有 ${side.length} 项）`)
  const A = side[i]
  const B = side[j]
  if (B.op === "÷") throw new Error("swap: 中间是 ÷，同侧换位不成立")
  if (B.op === null) throw new Error("swap: 右边那项没有写出来的符号，无法换位")
  const aOp = effectiveOp(side, i)
  const next = side.slice()
  next[i] = { op: B.op === "-" ? "-" : null, value: B.value, isVar: B.isVar }
  next[j] = { op: aOp, value: A.value, isVar: A.isVar }
  const swapped = normFirst(next)
  return {
    type: "swap",
    from,
    index: i,
    index2: j,
    srcOp: A.op,
    fromOp: aOp,
    toOp: aOp,
    value: A.value,
    isVar: A.isVar,
    before: st,
    after: putSide(st, from, swapped),
    note,
  }
}

/**
 * 构造一次「合并同类项」：把第 i 项与它**右边相邻**的第 i+1 项（必须同类：都是 x、或都是数）合并。
 *   3x 与 -2x ⇒ x      ·    3 与 5 ⇒ 8
 * `value` 记被并入那一项的值，`combined` 记合并后的文本。
 */
function buildCombine(st: EqState, from: "left" | "right", i: number, note: string): MoveAction {
  const side = st[from]
  const j = i + 1
  if (j >= side.length) throw new Error(`combine: 下标越界 ${i}/${j}`)
  const A = side[i]
  const B = side[j]
  if (A.isVar !== B.isVar) throw new Error("combine: 一个是 x 一个是数，不是同类项，不能合并")
  const sum = signedCoef(A) + signedCoef(B)
  const combined = A.isVar ? varText(sum) : String(sum)
  const next = side.slice()
  next[i] = { op: A.op, value: combined, isVar: A.isVar }
  next.splice(j, 1)
  return {
    type: "combine",
    from,
    index: i,
    index2: j,
    srcOp: B.op,
    fromOp: "+",
    toOp: "+",
    value: B.value,
    isVar: B.isVar,
    combined,
    before: st,
    after: putSide(st, from, normFirst(next)),
    note,
  }
}

/** 构造一次「两边对调」（等式对称性）：b = x + a 就是 x + a = b */
function buildFlip(st: EqState, note: string): MoveAction {
  const after: EqState = { left: normFirst(st.right), right: normFirst(st.left) }
  return {
    type: "flip",
    from: "left",
    index: 0,
    srcOp: null,
    fromOp: "+",
    toOp: "+",
    value: "",
    isVar: false,
    before: st,
    after,
    note,
  }
}

// ────────────────────────────────────────────────────────────
// 文本
// ────────────────────────────────────────────────────────────

/** 一侧 → 可读文本；给了 xVal 就把未知数替换成具体数字（验算用，`5x` 且 x=3 ⇒ "15"） */
export function sideToText(side: Side, xVal?: number): string {
  return side
    .map((t, i) => {
      const v = t.isVar && xVal !== undefined ? String(termValueAt(t, xVal)) : t.value
      if (i === 0) return t.op === "-" ? `-${v}` : v
      return ` ${t.op} ${v}`
    })
    .join("")
}

/** 整个等式 → 文本 */
export function eqToText(st: EqState, xVal?: number): string {
  return `${sideToText(st.left, xVal)} = ${sideToText(st.right, xVal)}`
}

/** 一行解答：x = 12 - 5 = 7 */
export function solutionText(p: MoveProblem): string {
  return `x = ${sideToText(p.final.right)} = ${p.answer}`
}

// ────────────────────────────────────────────────────────────
// 出题（全部**反推参数**：先定答案，再算出得数 ⇒ 恒成立）
// ────────────────────────────────────────────────────────────

/** [min, max] 闭区间随机整数。max <= min 时返回 min，不抛异常 */
function rnd(min: number, max: number): number {
  if (max <= min) return min
  return min + Math.floor(Math.random() * (max - min + 1))
}

const XV = (op: Op | null = null): Term => ({ op, value: "x", isVar: true })
const NU = (v: number, op: Op | null = null): Term => ({ op, value: String(v), isVar: false })
/** k 个 x（k=1 就写成 "x"） */
const KV = (k: number, op: Op | null = null): Term => ({ op, value: varText(k), isVar: true })

export const KIND_LABEL: Record<MoveKind, string> = {
  plus: "x + a = b",
  minus: "x - a = b",
  times: "x × a = b",
  divide: "x ÷ a = b",
  minusVar: "a - x = b",
  divideVar: "a ÷ x = b",
  revealPlus: "a + x = b",
  revealTimes: "a × x = b",
  xRight: "b = x + a",
  threeTerms: "x + a + c = b",
  bothSides: "3x = 2x + 5",
  multiStep: "2x + 3 = x + 8",
  sameSide: "同侧交换 · 不变号",
}

export const KIND_TIP: Record<MoveKind, string> = {
  plus: "加数跨过等号 ⇒ 变减",
  minus: "减数跨过等号 ⇒ 变加",
  times: "乘数跨过等号 ⇒ 变除",
  divide: "除数跨过等号 ⇒ 变乘",
  minusVar: "x 前面是减号 —— 要搬两次",
  divideVar: "x 在除数位置 —— 要搬两次",
  revealPlus: "最前面的数没写符号 ⇒ 先换位显形，再跨线",
  revealTimes: "最前面的因数是隐藏的「×」⇒ 先换位显形，再跨线",
  xRight: "x 在等号右边 ⇒ 两边对调回来，再搬",
  threeTerms: "同一边有好几个数 ⇒ 一个一个有顺序地搬",
  bothSides: "两边都有 x ⇒ 先把 x 都搬到一边，再合并",
  multiStep: "多项多步 ⇒ 先搬常数，再移 x，最后合并",
  sameSide: "没跨等号 ⇒ 符号不动",
}

/** x + a = b ⇒ x = b - a */
function buildPlus(): MoveProblem {
  const x = rnd(2, 9)
  const a = rnd(2, 9)
  const b = x + a
  const initial: EqState = { left: [XV(), NU(a, "+")], right: [NU(b)] }
  const act = buildAction(initial, "left", 1, `把 +${a} 搬到等号右边 —— 跨过等号，「+」就要变成「-」。`)
  return {
    kind: "plus",
    kindLabel: KIND_LABEL.plus,
    kindTip: KIND_TIP.plus,
    initial,
    actions: [act],
    flipSides: false,
    final: { left: [XV()], right: [NU(b), NU(a, "-")] },
    x,
    answer: b - a,
    isSameSide: false,
    hint: `x + ${a} = ${b}　⇒　x = ${b} - ${a} = ${x}`,
  }
}

/** x - a = b ⇒ x = b + a */
function buildMinus(): MoveProblem {
  const x = rnd(11, 20)
  const a = rnd(2, 9)
  const b = x - a
  const initial: EqState = { left: [XV(), NU(a, "-")], right: [NU(b)] }
  const act = buildAction(initial, "left", 1, `要搬的是连在一起的「-${a}」这一整块 —— 跨过等号，「-」变成「+」。`)
  return {
    kind: "minus",
    kindLabel: KIND_LABEL.minus,
    kindTip: KIND_TIP.minus,
    initial,
    actions: [act],
    flipSides: false,
    final: { left: [XV()], right: [NU(b), NU(a, "+")] },
    x,
    answer: b + a,
    isSameSide: false,
    hint: `x - ${a} = ${b}　⇒　x = ${b} + ${a} = ${x}`,
  }
}

/** x × a = b ⇒ x = b ÷ a */
function buildTimes(): MoveProblem {
  const x = rnd(2, 9)
  const a = rnd(2, 9)
  const b = x * a
  const initial: EqState = { left: [XV(), NU(a, "×")], right: [NU(b)] }
  const act = buildAction(initial, "left", 1, `把 ×${a} 搬到等号右边 —— 乘的因子跨过等号，就变成「除以 ${a}」。`)
  return {
    kind: "times",
    kindLabel: KIND_LABEL.times,
    kindTip: KIND_TIP.times,
    initial,
    actions: [act],
    flipSides: false,
    final: { left: [XV()], right: [NU(b), NU(a, "÷")] },
    x,
    answer: b / a,
    isSameSide: false,
    hint: `x × ${a} = ${b}　⇒　x = ${b} ÷ ${a} = ${x}`,
  }
}

/** x ÷ a = b ⇒ x = b × a */
function buildDivide(): MoveProblem {
  const a = rnd(2, 9)
  const b = rnd(2, 9)
  const x = a * b
  const initial: EqState = { left: [XV(), NU(a, "÷")], right: [NU(b)] }
  const act = buildAction(initial, "left", 1, `把 ÷${a} 搬到等号右边 —— 除的因子跨过等号，就变成「乘以 ${a}」。`)
  return {
    kind: "divide",
    kindLabel: KIND_LABEL.divide,
    kindTip: KIND_TIP.divide,
    initial,
    actions: [act],
    flipSides: false,
    final: { left: [XV()], right: [NU(b), NU(a, "×")] },
    x,
    answer: b * a,
    isSameSide: false,
    hint: `x ÷ ${a} = ${b}　⇒　x = ${b} × ${a} = ${x}`,
  }
}

/** a - x = b ⇒ -x = b - a ⇒ x = a - b（搬两次 + 两边对调）
 *  第二步搬的是**右侧首项** b（前面不写符号）⇒ 先同侧换位显形 */
function buildMinusVar(): MoveProblem {
  const a = rnd(11, 20)
  const x = rnd(2, 9)
  const b = a - x
  const initial: EqState = { left: [NU(a), XV("-")], right: [NU(b)] }
  const s1 = buildAction(
    initial,
    "left",
    1,
    `「-x」是一整块 —— 先把它整个搬到等号右边：「-」跨过等号变成「+」，得到 ${a} = ${b} + x。`,
  )
  const swap = buildSwap(
    s1.after,
    "right",
    0,
    `${b} 站在右边最前面，前面不写符号 —— 先把它和 x 换个位置：同一边换位置符号不变，得到 ${a} = x + ${b}。`,
  )
  const s2 = buildAction(
    swap.after,
    "right",
    1,
    `现在看得见它是「+${b}」了 —— 跨过等号搬到左边，「+」变成「-」，得到 ${a} - ${b} = x。`,
  )
  return {
    kind: "minusVar",
    kindLabel: KIND_LABEL.minusVar,
    kindTip: KIND_TIP.minusVar,
    initial,
    actions: [s1, swap, s2],
    flipSides: true,
    final: { left: [XV()], right: [NU(a), NU(b, "-")] },
    x,
    answer: a - b,
    isSameSide: false,
    hint: `${a} - x = ${b}　⇒　${a} = ${b} + x　⇒　x = ${a} - ${b} = ${x}`,
  }
}

/** a ÷ x = b ⇒ a = b × x ⇒ x = a ÷ b（搬两次 + 两边对调）
 *  第二步搬的同样是**右侧首项** b ⇒ 先同侧换位显形 */
function buildDivideVar(): MoveProblem {
  const b = rnd(2, 9)
  const x = rnd(2, 9)
  const a = b * x
  const initial: EqState = { left: [NU(a), XV("÷")], right: [NU(b)] }
  const s1 = buildAction(
    initial,
    "left",
    1,
    `「÷x」是一整块 —— 先把它整个搬到等号右边：「÷」跨过等号变成「×」，得到 ${a} = ${b} × x。`,
  )
  const swap = buildSwap(
    s1.after,
    "right",
    0,
    `${b} 站在右边最前面，前面不写符号 —— 先把它和 x 换个位置：同一边换位置符号不变，得到 ${a} = x × ${b}。`,
  )
  const s2 = buildAction(
    swap.after,
    "right",
    1,
    `${b} 在这里是「乘的因子」—— 跨过等号搬到左边，「×」变成「÷」，得到 ${a} ÷ ${b} = x。`,
  )
  return {
    kind: "divideVar",
    kindLabel: KIND_LABEL.divideVar,
    kindTip: KIND_TIP.divideVar,
    initial,
    actions: [s1, swap, s2],
    flipSides: true,
    final: { left: [XV()], right: [NU(a), NU(b, "÷")] },
    x,
    answer: a / b,
    isSameSide: false,
    hint: `${a} ÷ x = ${b}　⇒　${a} = ${b} × x　⇒　x = ${a} ÷ ${b} = ${x}`,
  }
}

/** ★ a + x = b ⇒ ① 同侧换位把 a 换到后面（符号「+」这才露出来）② 跨线变号 ⇒ x = b - a
 *  这是「首项不写符号」的招牌演示：不先换位，学生看不见 a 前面有个「+」。 */
function buildRevealPlus(): MoveProblem {
  const a = rnd(2, 9)
  const x = rnd(2, 9)
  const b = a + x
  const initial: EqState = { left: [NU(a), XV("+")], right: [NU(b)] }
  const swap = buildSwap(
    initial,
    "left",
    0,
    `${a} 站在最前面，前面不写符号 —— 先把它和 x 换个位置：同一边换位置，符号一点不用动，得到 x + ${a} = ${b}。`,
  )
  const act = buildAction(
    swap.after,
    "left",
    1,
    `现在能看见它是「+${a}」了 —— 跨过等号，「+」变成「-」，得到 x = ${b} - ${a}。`,
  )
  return {
    kind: "revealPlus",
    kindLabel: KIND_LABEL.revealPlus,
    kindTip: KIND_TIP.revealPlus,
    initial,
    actions: [swap, act],
    flipSides: false,
    final: { left: [XV()], right: [NU(b), NU(a, "-")] },
    x,
    answer: b - a,
    isSameSide: false,
    hint: `${a} + x = ${b}　⇒　x + ${a} = ${b}　⇒　x = ${b} - ${a} = ${x}`,
  }
}

/** ★ a × x = b ⇒ ① 同侧换位把 a 换到后面（隐藏的「×」这才露出来）② 跨线变号 ⇒ x = b ÷ a */
function buildRevealTimes(): MoveProblem {
  const a = rnd(2, 9)
  const x = rnd(2, 9)
  const b = a * x
  const initial: EqState = { left: [NU(a), XV("×")], right: [NU(b)] }
  const swap = buildSwap(
    initial,
    "left",
    0,
    `${a} 站在最前面，前面不写符号 —— 先把它和 x 换个位置：同一边换位置，符号一点不用动，得到 x × ${a} = ${b}。`,
  )
  const act = buildAction(
    swap.after,
    "left",
    1,
    `现在能看见它是「×${a}」了 —— 跨过等号，「×」变成「÷」，得到 x = ${b} ÷ ${a}。`,
  )
  return {
    kind: "revealTimes",
    kindLabel: KIND_LABEL.revealTimes,
    kindTip: KIND_TIP.revealTimes,
    initial,
    actions: [swap, act],
    flipSides: false,
    final: { left: [XV()], right: [NU(b), NU(a, "÷")] },
    x,
    answer: b / a,
    isSameSide: false,
    hint: `${a} × x = ${b}　⇒　x × ${a} = ${b}　⇒　x = ${b} ÷ ${a} = ${x}`,
  }
}

/** b = x + a（x 在等号右边）⇒ ① 两边对调 ② 跨线变号 ⇒ x = b - a */
function buildXRight(): MoveProblem {
  const a = rnd(2, 9)
  const x = rnd(2, 9)
  const b = x + a
  const initial: EqState = { left: [NU(b)], right: [XV(), NU(a, "+")] }
  const flip = buildFlip(
    initial,
    `x 跑到等号右边去了 —— 等式两边可以整个对调：${b} = x + ${a} 就是 x + ${a} = ${b}。`,
  )
  const act = buildAction(
    flip.after,
    "left",
    1,
    `回到熟悉的写法了 —— 把 +${a} 跨过等号搬走，「+」变成「-」，得到 x = ${b} - ${a}。`,
  )
  return {
    kind: "xRight",
    kindLabel: KIND_LABEL.xRight,
    kindTip: KIND_TIP.xRight,
    initial,
    actions: [flip, act],
    flipSides: false,
    final: { left: [XV()], right: [NU(b), NU(a, "-")] },
    x,
    answer: b - a,
    isSameSide: false,
    hint: `${b} = x + ${a}　⇒　x + ${a} = ${b}　⇒　x = ${b} - ${a} = ${x}`,
  }
}

/** x + a + c = b ⇒ 同一边好几个数，一个一个有顺序地搬两次（每项都写了符号，不用显形）
 *  ⚠️ 三项相加最容易冲出「20 以内加减法」这条线（9+9+9=27）—— 参数刻意收到 x ≤ 8、a/c ≤ 6 ⇒ b ≤ 20 */
function buildThreeTerms(): MoveProblem {
  const x = rnd(2, 8)
  const a = rnd(2, 6)
  const c = rnd(2, 6)
  const b = x + a + c
  const initial: EqState = { left: [XV(), NU(a, "+"), NU(c, "+")], right: [NU(b)] }
  const s1 = buildAction(
    initial,
    "left",
    1,
    `同一边有好几个数，一个一个来 —— 先把 +${a} 搬过去，「+」变成「-」，得到 x + ${c} = ${b} - ${a}。`,
  )
  const s2 = buildAction(
    s1.after,
    "left",
    1,
    `再把 +${c} 搬过去 —— 同样「+」变成「-」，得到 x = ${b} - ${a} - ${c}。`,
  )
  return {
    kind: "threeTerms",
    kindLabel: KIND_LABEL.threeTerms,
    kindTip: KIND_TIP.threeTerms,
    initial,
    actions: [s1, s2],
    flipSides: false,
    final: { left: [XV()], right: [NU(b), NU(a, "-"), NU(c, "-")] },
    x,
    answer: b - a - c,
    isSameSide: false,
    hint: `x + ${a} + ${c} = ${b}　⇒　x = ${b} - ${a} - ${c} = ${x}`,
  }
}

/** kx = mx + c（两边都有 x，且 k - m = 1）⇒ ①右侧换位显形 ②把 mx 搬到左边 ③合并同类项 ⇒ x = c
 *  ★ 刻意让 k - m = 1：合并后系数正好是 1 ⇒ 不需要再做「系数剥离」，把焦点留在「搬到一起 + 合并」 */
function buildBothSides(): MoveProblem {
  const k = rnd(2, 9)
  const m = k - 1
  const x = rnd(2, 9)
  const c = x
  const kx = varText(k)
  const mx = varText(m)
  const initial: EqState = { left: [KV(k)], right: [KV(m), NU(c, "+")] }
  const swap = buildSwap(
    initial,
    "right",
    0,
    `${mx} 站在右边最前面，前面不写符号 —— 先把它和 ${c} 换个位置：同一边换位置符号不变，得到 ${kx} = ${c} + ${mx}。`,
  )
  const act = buildAction(
    swap.after,
    "right",
    1,
    `现在看得见它是「+${mx}」了 —— 把 x 项都搬到等号左边：「+」变成「-」，得到 ${kx} - ${mx} = ${c}。`,
  )
  const comb = buildCombine(
    act.after,
    "left",
    0,
    `${kx} 和 ${mx} 都带 x，是一类 —— 合起来：${k} - ${m} 个 x，也就是 x。`,
  )
  return {
    kind: "bothSides",
    kindLabel: KIND_LABEL.bothSides,
    kindTip: KIND_TIP.bothSides,
    initial,
    actions: [swap, act, comb],
    flipSides: false,
    final: { left: [XV()], right: [NU(c)] },
    x,
    answer: c,
    isSameSide: false,
    hint: `${kx} = ${mx} + ${c}　⇒　${kx} - ${mx} = ${c}　⇒　x = ${c}`,
  }
}

/** kx + a = mx + c（多项多步，且 k - m = 1）⇒ ①搬常数 ②右侧换位显形 ③把 mx 搬到左边 ④合并 */
function buildMultiStep(): MoveProblem {
  const k = rnd(2, 9)
  const m = k - 1
  const x = rnd(2, 9)
  const a = rnd(2, 9)
  const c = x + a
  const kx = varText(k)
  const mx = varText(m)
  const initial: EqState = { left: [KV(k), NU(a, "+")], right: [KV(m), NU(c, "+")] }
  const s1 = buildAction(
    initial,
    "left",
    1,
    `先把左边的常数 +${a} 搬到右边 —— 「+」变成「-」，得到 ${kx} = ${mx} + ${c} - ${a}。`,
  )
  const swap = buildSwap(
    s1.after,
    "right",
    0,
    `${mx} 在右边最前面，前面不写符号 —— 先把它和 ${c} 换个位置：符号不变，得到 ${kx} = ${c} + ${mx} - ${a}。`,
  )
  const s2 = buildAction(
    swap.after,
    "right",
    1,
    `把 ${mx} 也搬到左边来 —— 「+」变成「-」，得到 ${kx} - ${mx} = ${c} - ${a}。`,
  )
  const comb = buildCombine(
    s2.after,
    "left",
    0,
    `${kx} 和 ${mx} 合并：${k} - ${m} 个 x，也就是 x。`,
  )
  return {
    kind: "multiStep",
    kindLabel: KIND_LABEL.multiStep,
    kindTip: KIND_TIP.multiStep,
    initial,
    actions: [s1, swap, s2, comb],
    flipSides: false,
    final: { left: [XV()], right: [NU(c), NU(a, "-")] },
    x,
    answer: c - a,
    isSameSide: false,
    hint: `${kx} + ${a} = ${mx} + ${c}　⇒　${kx} - ${mx} = ${c} - ${a}　⇒　x = ${c} - ${a} = ${x}`,
  }
}

/** 反例：a + x = b ⇒ x + a = b —— 同一侧换位置，符号一点都不用动 */
function buildSameSide(): MoveProblem {
  const a = rnd(2, 9)
  const x = rnd(2, 9)
  const b = a + x
  const initial: EqState = { left: [NU(a), XV("+")], right: [NU(b)] }
  const swap = buildSwap(
    initial,
    "left",
    0,
    `${a} 没跨过等号，只是和 x 换了位置 —— 同一边换位置，符号一点不用调。`,
  )
  return {
    kind: "sameSide",
    kindLabel: KIND_LABEL.sameSide,
    kindTip: KIND_TIP.sameSide,
    initial,
    actions: [swap],
    flipSides: false,
    final: { left: [XV(), NU(a, "+")], right: [NU(b)] },
    x,
    answer: x,
    isSameSide: true,
    hint: `${a} + x = ${b}　⇒　x + ${a} = ${b}　（同一侧换位置，符号一点没变）`,
  }
}

const BUILDERS: Record<MoveKind, () => MoveProblem> = {
  plus: buildPlus,
  minus: buildMinus,
  times: buildTimes,
  divide: buildDivide,
  minusVar: buildMinusVar,
  divideVar: buildDivideVar,
  revealPlus: buildRevealPlus,
  revealTimes: buildRevealTimes,
  xRight: buildXRight,
  threeTerms: buildThreeTerms,
  bothSides: buildBothSides,
  multiStep: buildMultiStep,
  sameSide: buildSameSide,
}

/** 加权抽题型（加减法最常见；同侧交换作为反例偶尔出现） */
const POOL: MoveKind[] = [
  "plus",
  "plus",
  "plus",
  "minus",
  "minus",
  "minus",
  "times",
  "times",
  "divide",
  "divide",
  "minusVar",
  "divideVar",
  "revealPlus",
  "revealTimes",
  "xRight",
  "threeTerms",
  "bothSides",
  "multiStep",
  "sameSide",
]

export function generateProblem(kind?: MoveKind): MoveProblem {
  return BUILDERS[kind ?? POOL[rnd(0, POOL.length - 1)]]()
}

/** 首页/测试用：一次生成一批（默认每种题型各来几道） */
export function generateProblems(n: number, kind?: MoveKind): MoveProblem[] {
  return Array.from({ length: n }, () => generateProblem(kind))
}

// ────────────────────────────────────────────────────────────
// 静态教学资料（全部逐条验算过）
// ────────────────────────────────────────────────────────────

export const RULES: { title: string; lines: string[] }[] = [
  {
    title: "一句话规律（背下来）",
    lines: [
      "等式两边移动数，跨过等号才变号；",
      "加变减，减变加，乘变除，除变乘。",
      "等号同侧换顺序，符号一点不用调。",
    ],
  },
  {
    title: "加减法口诀",
    lines: [
      "同一边，随便换，符号不变；跨过等号，加减互换。",
      "移的是「加减法里的项」⇒ 移项变号（+ 变 -，- 变 +）。",
      "要搬走的，是「整个数字连同它前面的符号」—— 例：搬的是「-6」，不是「-」也不是「6」。",
      "★ 站在最前面的那个数**不写符号**，但它其实带着一个隐藏的「+」（或「×」）。看不出来就先跟后面换个位置，符号才露出来 —— 换位置不改符号。",
    ],
  },
  {
    title: "乘除法口诀",
    lines: [
      "同一边，随便换，符号不变；跨过等号，乘除互换。",
      "移的是「乘除法里的因子」⇒ 移到对面变成倒数（× 变 ÷，÷ 变 ×）。",
      "x 在除数位置上（如 24 ÷ x = 4）时，先把「÷x」整块搬过去，再搬第二个数。",
    ],
  },
  {
    title: "多步方程的口诀",
    lines: [
      "先看哪边有 x：把 x 都搬到同一边去（搬的时候照旧变号）。",
      "再把同一边的 x 项合起来（3 个 x 减 2 个 x，就是 1 个 x）—— 合并是**同一边**的事，不用变号。",
      "最后把剩下的常数搬到另一边，x 就单独留下了。",
    ],
  },
]

export interface MistakeCase {
  title: string
  wrong: string
  right: string
  why: string
  tip: string
}

export const MISTAKE_CASES: MistakeCase[] = [
  {
    title: "没跨等号，却也把符号改了",
    wrong: "2 + x = 8　⇒　x - 2 = 8",
    right: "2 + x = 8　⇒　x + 2 = 8",
    why: "2 只是从等号左边挪到了 x 的后面，它压根没跨过等号 —— 同一边换位置，符号一点不用动。",
    tip: "只有跨过等号，才变号。",
  },
  {
    title: "移项时把「前面的符号」弄丢了",
    wrong: "x - 6 = 10　⇒　x = 10 - 6",
    right: "x - 6 = 10　⇒　x = 10 + 6",
    why: "要搬走的是连在一起的「-6」这一整块。6 前面是减号，跨过等号就得变成加号；只搬「6」就等于把那个减号丢了。",
    tip: "移项是「整个数字连同它前面的符号」一起搬。",
  },
  {
    title: "把 x 前面的减号当成了 x 自己的",
    wrong: "10 - x = 3　⇒　x = 3 - 10",
    right: "10 - x = 3　⇒　x = 10 - 3",
    why: "x 本身没有「负号」，那个减号是它「前面的运算符」，管的是「10 减掉 x」。把 -x 整块搬过去、两边再同时变号，才对。",
    tip: "负号不是数字自带的，是它前面的运算符。",
  },
  {
    title: "首项没写符号，就以为它「没有符号」",
    wrong: "5 + x = 12　⇒　x = 12 + 5",
    right: "5 + x = 12　⇒　x = 12 - 5",
    why: "5 站在最前面才不写符号 —— 它其实是「+5」。看不出来就先跟 x 换个位置写成 x + 5 = 12（换位置不变号），这下「+」露出来了，跨过等号自然要变成「-」。",
    tip: "首项不写符号 ≠ 没有符号；换到后面就看得见。",
  },
  {
    title: "合并同类项时也去变号",
    wrong: "5x = 3x + 6　⇒　5x + 3x = 6",
    right: "5x = 3x + 6　⇒　5x - 3x = 6　⇒　2x = 6",
    why: "先把 3x 从右边搬到左边，这一步跨了等号 ⇒ 必须变号；而后面「5x 减 3x 合成 2x」是**同一边**的合并，不用变号。两步别混。",
    tip: "跨等号的要变号，同一边合并的不用变。",
  },
]

export interface PracticeItem {
  /** 原式 */
  before: string
  /** 要搬走（或换位）的那一项的符号 */
  sym: Op
  num: number
  /** 跨线后变成的符号；同侧换位型是 "same"（不变号） */
  answer: PracticeAnswer
  /** 完整结果 */
  result: string
  why: string
  /** 未知数的值 —— 练习反馈要显示它，单测也拿它代回原式验算 */
  x: number
  /** 被搬走那一块的显示文本，默认 `${sym}${num}`；两步型要显式给（「-x」「÷x」「-8」这类） */
  movedLabel?: string
  /** 问法：cross = 跨过等号变成什么（默认）；sameSide = 同侧换位，符号怎么变 */
  ask?: "cross" | "sameSide"
  /** 出题来源的题型 —— 随机练习带上它，断言「哪几类必出」时才有确切依据 */
  kind?: PracticeKind
}

export const PRACTICE: PracticeItem[] = [
  {
    before: "x + 8 = 14",
    sym: "+",
    num: 8,
    answer: "-",
    result: "x = 14 - 8 = 6",
    why: "加号跨过等号 ⇒ 变成减号。",
    x: 6,
  },
  {
    before: "x - 8 = 14",
    sym: "-",
    num: 8,
    answer: "+",
    result: "x = 14 + 8 = 22",
    why: "减号跨过等号 ⇒ 变成加号。",
    x: 22,
  },
  {
    before: "x × 8 = 16",
    sym: "×",
    num: 8,
    answer: "÷",
    result: "x = 16 ÷ 8 = 2",
    why: "乘号跨过等号 ⇒ 变成除号（因子到对面变倒数）。",
    x: 2,
  },
  {
    before: "x ÷ 8 = 16",
    sym: "÷",
    num: 8,
    answer: "×",
    result: "x = 16 × 8 = 128",
    why: "除号跨过等号 ⇒ 变成乘号（因子到对面变倒数）。",
    x: 128,
  },
]

// ────────────────────────────────────────────────────────────
// 随机练习：默认 6 道，把「移项变号」的六种情形全练到
// ────────────────────────────────────────────────────────────

/** 跨线后符号变成什么；"same" 表示同侧换位、符号不变 */
export type PracticeAnswer = Op | "same"

/** 随机练习题型 */
export type PracticeKind =
  | "plus"
  | "minus"
  | "times"
  | "divide"
  | "minusVar"
  | "divideVar"
  | "revealPlus"
  | "revealTimes"
  | "sameSide"

/** 4 种基本题型：每轮练习各来一道，保证四条变号规律全练到 */
const DRILL_BASIC: PracticeKind[] = ["plus", "minus", "times", "divide"]

/** 「要搬两次」的进阶型：每轮**必出**一道（含首项显形的两种） */
const DRILL_STEP: PracticeKind[] = ["minusVar", "divideVar", "revealPlus", "revealTimes"]

/** 全部题型池（补齐名额时从这里随机，含「同侧不变号」这个反例） */
const DRILL_POOL: PracticeKind[] = [...DRILL_BASIC, ...DRILL_STEP, "sameSide"]

/** 造一道练习题：先定 x 与操作数 → 反推等式另一端，保证恒成立且答案是非负整数 */
function buildPracticeItem(kind: PracticeKind): PracticeItem {
  switch (kind) {
    case "plus": {
      const x = rnd(2, 9)
      const a = rnd(2, 9)
      const b = x + a
      return {
        before: `x + ${a} = ${b}`,
        sym: "+", num: a, answer: "-", x,
        result: `x = ${b} - ${a} = ${x}`,
        why: "加号跨过等号 ⇒ 变成减号。",
      }
    }
    case "minus": {
      const x = rnd(11, 20)
      const a = rnd(2, 9)
      const b = x - a
      return {
        before: `x - ${a} = ${b}`,
        sym: "-", num: a, answer: "+", x,
        result: `x = ${b} + ${a} = ${x}`,
        why: "减号跨过等号 ⇒ 变成加号。",
      }
    }
    case "times": {
      const x = rnd(2, 9)
      const a = rnd(2, 9)
      const b = x * a
      return {
        before: `x × ${a} = ${b}`,
        sym: "×", num: a, answer: "÷", x,
        result: `x = ${b} ÷ ${a} = ${x}`,
        why: "乘号跨过等号 ⇒ 变成除号（因子到对面变倒数）。",
      }
    }
    case "divide": {
      const a = rnd(2, 9)
      const b = rnd(2, 9)
      const x = a * b
      return {
        before: `x ÷ ${a} = ${b}`,
        sym: "÷", num: a, answer: "×", x,
        result: `x = ${b} × ${a} = ${x}`,
        why: "除号跨过等号 ⇒ 变成乘号（因子到对面变倒数）。",
      }
    }
    case "minusVar": {
      const a = rnd(11, 20)
      const x = rnd(2, 9)
      const b = a - x
      return {
        before: `${a} - x = ${b}`,
        sym: "-", num: x, answer: "+", x, movedLabel: "-x",
        result: `${a} = ${b} + x　⇒　x = ${a} - ${b} = ${x}`,
        why: "「-x」是一整块 —— 跨过等号，「-」变成「+」。",
      }
    }
    case "divideVar": {
      const b = rnd(2, 9)
      const x = rnd(2, 9)
      const a = b * x
      return {
        before: `${a} ÷ x = ${b}`,
        sym: "÷", num: x, answer: "×", x, movedLabel: "÷x",
        result: `${a} = ${b} × x　⇒　x = ${a} ÷ ${b} = ${x}`,
        why: "「÷x」是一整块 —— 跨过等号，「÷」变成「×」。",
      }
    }
    case "revealPlus": {
      const a = rnd(2, 9)
      const x = rnd(2, 9)
      const b = a + x
      return {
        before: `${a} + x = ${b}`,
        sym: "+", num: a, answer: "-", x,
        result: `${a} + x = ${b}　⇒　x + ${a} = ${b}　⇒　x = ${b} - ${a} = ${x}`,
        why: `${a} 站在最前面没写符号 —— 先跟 x 换个位置（不变号），露出「+」，跨过等号才变成「-」。`,
      }
    }
    case "revealTimes": {
      const a = rnd(2, 9)
      const x = rnd(2, 9)
      const b = a * x
      return {
        before: `${a} × x = ${b}`,
        sym: "×", num: a, answer: "÷", x,
        result: `${a} × x = ${b}　⇒　x × ${a} = ${b}　⇒　x = ${b} ÷ ${a} = ${x}`,
        why: `${a} 站在最前面没写符号 —— 先跟 x 换个位置（不变号），露出「×」，跨过等号才变成「÷」。`,
      }
    }
    case "sameSide": {
      const a = rnd(2, 9)
      const x = rnd(2, 9)
      const b = a + x
      return {
        before: `${a} + x = ${b}`,
        sym: "+", num: a, answer: "same", x, ask: "sameSide",
        result: `${a} + x = ${b}　⇒　x + ${a} = ${b}`,
        why: `${a} 只是和 x 换了位置，压根没跨过等号 —— 同一边交换，符号一点不用动。`,
      }
    }
  }
}

/**
 * 生成一组随机练习题（默认 **6** 道）。
 * ★ 组合策略：**4 条基本变号规律各一道**（顺序打乱）＋ **1 道「要搬两次」的进阶型**（必出）
 *   ＋ **1 道「同侧换位不变号」反例**（必出）——
 *   只要 n ≥ 6，「加变减 / 减变加 / 乘变除 / 除变乘 / 同侧不变 / 搬两次」六种情形每轮都被练到。
 *
 * ⚠️ 为什么是 6 而不是 5：5 道只够「4 条基本 + 1 道进阶」，塞不下「两步型」和「同侧不变号」
 *    两类，必然有一类练不到。多一道刚好把六种情形占满。
 */
export function generatePracticeItems(n = 6): PracticeItem[] {
  const kinds: PracticeKind[] = [...DRILL_BASIC]
  if (n > DRILL_BASIC.length) kinds.push(DRILL_STEP[rnd(0, DRILL_STEP.length - 1)])
  if (n > DRILL_BASIC.length + 1) kinds.push("sameSide")
  while (kinds.length < n) kinds.push(DRILL_POOL[rnd(0, DRILL_POOL.length - 1)])
  // Fisher–Yates 打乱，避免每轮都是「+ - × ÷」同一个次序
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = rnd(0, i)
    const tmp = kinds[i]
    kinds[i] = kinds[j]
    kinds[j] = tmp
  }
  return kinds.slice(0, n).map((k) => ({ ...buildPracticeItem(k), kind: k }))
}
