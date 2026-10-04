/** 三年级上「把两个分步算式合并成综合算式」— 纯逻辑引擎（确定性）
 *
 * 教学法（人教版三年级上册 混合运算）：
 *   合并三步法「找 → 换 → 查」
 *     ① 找：找出两个算式里**相同的那一个数**（第一个算式的结果，出现在第二个算式里）
 *     ② 换：用**第一个算式整体**替换第二个算式里的那个数
 *     ③ 查：检查运算顺序 —— 原式要先算的部分，换进去后是否还先算？
 *           不是 → 必须**补小括号**
 *
 * 括号判据（核心考点）：
 *   · 「加减在后」：合并后 乘除 会抢在 加减 前面算，但原来 加减 是先算的 ⇒ **必加括号**
 *   · 「乘除在前」：合并后 乘除 本来就先算，与原来顺序一致 ⇒ **不加括号**
 *
 * 为什么不用大模型生成：本题型是纯逻辑（两式必须数值自洽），
 * LLM 有算错/结构不成立的风险，且每次练习都要等网络。规则引擎 = 0 延迟 + 0 成本 + 100% 正确。
 * 题型与易错点全部按教材归纳，见下方 TYPES / MISTAKE_KINDS。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 题型：按「第一个算式在第二个算式里的位置」分层 */
export type CompoundKind =
  /** 先加减后乘除 —— **必加括号**（第一阶段最典型） */
  | "addsub_then_muldiv"
  /** 先乘除后加减 —— 不加括号 */
  | "muldiv_then_addsub"
  /** 第一个算式的结果是被除数（除法在右）—— 必加括号 */
  | "as_dividend"
  /** 第一个算式的结果是减数 —— 必加括号 */
  | "as_subtrahend"

/** 一个操作数：要么是数字，要么是「引用上一步结果的占位」 */
export interface StepOperand {
  /** 显示文本（数字，或占位符如 "①"） */
  text: string
  /** 若这是第一个算式的结果占位，记它的编号（1 起） */
  fromStep?: number
}

/** 一步算式：a op b = result */
export interface StepLine {
  a: StepOperand
  op: "+" | "-" | "×" | "÷"
  b: StepOperand
  result: number
}

/** 内嵌括号片段：在综合算式中某一段要被括号包起来 */
export interface ParenSpan {
  /** 在合并后算式「token 序列」中的起止下标（含头不含尾） */
  start: number
  end: number
}

/** 合并后的综合算式：tokens 数组便于逐 token 着色/高亮 */
export interface MergedExpr {
  /** 逐 token 展开（数字、运算符、括号） */
  tokens: Token[]
  /** 需要补的括号区间（可能为空 = 不需要括号） */
  parens: ParenSpan[]
  /** 结果值 */
  value: number
}

export interface Token {
  text: string
  /** 该 token 来源：'num' 数字 | 'op' 运算符 | 'paren' 括号 */
  type: "num" | "op" | "paren"
  /** 该 token 是否来自第一个算式（替换进来的部分）—— 用于动画高亮 */
  fromFirst?: boolean
  /** 该 token 对应的运算符优先级（op 才有）：'md' 乘除 | 'as' 加减 */
  prec?: "md" | "as"
}

/** 「找→换→查」三步的逐步讲解数据 */
export interface MergeSteps {
  /** ① 找：相同的数 */
  find: { value: number; inFirst: string; inSecond: string }
  /** ② 换：替换后的（未加括号的）算式文本 */
  substitute: string
  /** ③ 查：顺序是否一致；不一致 ⇒ 需括号 */
  check: { needParen: boolean; reason: string }
}

/** 一道完整练习题 */
export interface CompoundProblem {
  id: string
  kind: CompoundKind
  /** 分步算式（① ②） */
  steps: StepLine[]
  /** 正确的综合算式 */
  merged: MergedExpr
  /** 合并过程讲解 */
  how: MergeSteps
  /** 一句话考点提示 */
  hint: string
  /** 结果值 */
  answer: number
}

/** 易错点类型（用于「警示」区） */
export type MistakeKind = "missing_paren" | "extra_paren" | "wrong_order" | "left_to_right"

/** 一个「错误 vs 正确」对比示例 */
export interface MistakeCase {
  kind: MistakeKind
  /** 分区标题，如「漏加括号」 */
  title: string
  /** 错误列式 */
  wrong: string
  /** 正确列式 */
  right: string
  /** 错在哪（一句话） */
  why: string
  /** 怎么避免（口诀） */
  tip: string
  /** ★ 卡片配图（mathIcons.ts 的键）—— 一幅图顶一句解释 */
  icon: string
}

// ────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────

function rnd(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** 是否乘除运算符 */
function isMd(op: string): boolean {
  return op === "×" || op === "÷"
}

/** 运算符优先级：'md' 乘除 | 'as' 加减 */
function precOf(op: string): "md" | "as" {
  return isMd(op) ? "md" : "as"
}

/** 安全除法：保证整除，否则返回 null */
function safeDiv(a: number, b: number): number | null {
  if (b === 0) return null
  return a % b === 0 ? a / b : null
}

/** 把一步算式构建为 StepLine。
 *  @param refWhich 哪个操作数来自上一步的得数（'a' | 'b' | 不传=都不是） */
function mk(
  a: number,
  op: StepLine["op"],
  b: number,
  result: number,
  refWhich?: "a" | "b",
): StepLine {
  return {
    a: refWhich === "a" ? { text: String(a), fromStep: 1 } : { text: String(a) },
    op,
    b: refWhich === "b" ? { text: String(b), fromStep: 1 } : { text: String(b) },
    result,
  }
}

// ────────────────────────────────────────────────────────────
// 题型生成器 —— 每个都返回「两步算式 + 正确综合式 + 讲解」
// ────────────────────────────────────────────────────────────

/** 类型 1：先加减后乘除（**必加括号**）
 *  如：17 - 8 = 9, 36 ÷ 9 = 4  →  36 ÷ (17 - 8) = 4
 */
function genAddSubThenMulDiv(): CompoundProblem | null {
  // 第一步：加减 → 得数 r（必须保证 a1 op1 b1 === r，故反推 b1）
  const r = rnd(2, 9)
  const usePlus = Math.random() < 0.5
  let a1: number, b1: number
  if (usePlus) {
    a1 = rnd(2, r - 1)          // b1 = r - a1 ≥ 1
    b1 = r - a1
  } else {
    a1 = rnd(r + 1, r + 20)     // b1 = a1 - r ≥ 1
    b1 = a1 - r
  }
  if (b1 < 1 || a1 === b1 || a1 + b1 > 30 || a1 > 40 || b1 > 30) return null
  const op1: StepLine["op"] = usePlus ? "+" : "-"

  const steps0: StepLine = mk(a1, op1, b1, r)

  // 第二步：乘除，把 r 作为**第二个操作数**（a op b，b = r）—— 替换动作最直观
  if (Math.random() < 0.5) {
    const other = rnd(2, 9)
    const total = other * r
    if (total > 99) return null
    const steps: StepLine[] = [steps0, mk(other, "×", r, total, "b")]
    return buildProblem("addsub_then_muldiv", steps, {
      mergedTokens: () => [
        tok(String(other), "num"),
        tok("×", "op", undefined, "md"),
        ...wrapTokens(exprTokensFromStep0(steps[0])),
      ],
      needParen: true,
      value: total,
      hint: "乘除会抢在加减前算！得用小括号把加减括起来。",
    })
  } else {
    const k = rnd(2, 9)
    const total = r * k
    if (total > 99) return null
    const steps: StepLine[] = [steps0, mk(total, "÷", r, k, "b")]
    return buildProblem("addsub_then_muldiv", steps, {
      mergedTokens: () => [
        tok(String(total), "num"),
        tok("÷", "op", undefined, "md"),
        ...wrapTokens(exprTokensFromStep0(steps[0])),
      ],
      needParen: true,
      value: k,
      hint: "被除数是算式时，必须括起来，否则变成先除后算。",
    })
  }
}

/** 类型 2：先乘除后加减（**不加括号**）
 *  如：3 × 9 = 27, 64 + 27 = 91  →  64 + 3 × 9 = 91
 */
function genMulDivThenAddSub(): CompoundProblem | null {
  // 第一步：乘除 → 得数 r（必须保证 a1 op1 b1 === r）
  let a1: number, b1: number, r: number, op1: StepLine["op"]
  if (Math.random() < 0.5) {
    a1 = rnd(2, 9)
    b1 = rnd(2, 9)
    r = a1 * b1
    op1 = "×"
  } else {
    b1 = rnd(2, 9)
    r = rnd(2, 9)
    a1 = b1 * r
    op1 = "÷"
  }
  if (r > 81 || a1 > 81) return null

  // 第二步：加减，r 作**第二个操作数**；other 不能等于 r（否则替换后分不清哪一个是它）
  const usePlus2 = Math.random() < 0.5
  let other = rnd(10, 60)
  if (other === r) other += 1
  const total = usePlus2 ? other + r : other - r
  if (total < 1 || total > 99) return null
  const op2: StepLine["op"] = usePlus2 ? "+" : "-"

  const steps: StepLine[] = [
    mk(a1, op1, b1, r),
    mk(other, op2, r, total, "b"),
  ]
  return buildProblem("muldiv_then_addsub", steps, {
    mergedTokens: () => [
      tok(String(other), "num"),
      tok(op2, "op", undefined, "as"),
      ...exprTokensFromStep0(steps[0]),
    ],
    needParen: false,
    value: total,
    hint: "乘除本来就先算，直接代进去，括号多余。",
  })
}

/** 类型 3：第一个算式的结果是**减数**（被减数固定）
 *  如：25 - 12 = 13, 40 - 13 = 27  →  40 - (25 - 12) = 27
 */
function genAsSubtrahend(): CompoundProblem | null {
  // 第一步：加减 → r
  const r = rnd(3, 20)
  const usePlus1 = Math.random() < 0.5
  let a1: number, b1: number
  if (usePlus1) {
    a1 = rnd(2, r - 1)
    b1 = r - a1
  } else {
    a1 = rnd(r + 1, r + 20)
    b1 = a1 - r
  }
  const op1: StepLine["op"] = usePlus1 ? "+" : "-"
  if (a1 < 2 || b1 < 1 || a1 === b1 || a1 > 60 || b1 > 60) return null

  // 第二步：被减数 - r = k；被减数不能等于 r（否则替换后分不清）
  const k = rnd(2, 30)
  const minuend = k + r
  if (minuend > 99 || minuend === r) return null
  const steps: StepLine[] = [
    mk(a1, op1, b1, r),
    mk(minuend, "-", r, k, "b"),
  ]
  return buildProblem("as_subtrahend", steps, {
    mergedTokens: () => [
      tok(String(minuend), "num"),
      tok("-", "op", undefined, "as"),
      ...wrapTokens(exprTokensFromStep0(steps[0])),
    ],
    needParen: true,
    value: k,
    hint: "减号后面是算式，必须括起来先算，否则从左往右算错。",
  })
}

/** 类型 4：第一个算式的结果是**被除数**
 *  如：8 + 4 = 12, 12 ÷ 3 = 4  →  (8 + 4) ÷ 3 = 4
 */
function genAsDividend(): CompoundProblem | null {
  const r = rnd(6, 40)
  const usePlus1 = Math.random() < 0.5
  let a1: number, b1: number
  if (usePlus1) {
    // 两个加数都 ≥ 2 ⇒ r ≥ 4（rnd(6,40) 已保证）
    a1 = rnd(2, r - 2)
    b1 = r - a1
  } else {
    a1 = rnd(r + 2, r + 30)
    b1 = a1 - r
  }
  const op1: StepLine["op"] = usePlus1 ? "+" : "-"
  if (!Number.isFinite(a1) || !Number.isFinite(b1)) return null
  if (a1 < 2 || b1 < 2 || a1 === b1 || a1 > 80 || b1 > 60) return null

  const divisor = rnd(2, 9)
  const k = safeDiv(r, divisor)
  if (k === null || k < 1 || r === divisor) return null
  const steps: StepLine[] = [
    mk(a1, op1, b1, r),
    mk(r, "÷", divisor, k, "a"),
  ]
  return buildProblem("as_dividend", steps, {
    mergedTokens: () => [
      ...wrapTokens(exprTokensFromStep0(steps[0])),
      tok("÷", "op", undefined, "md"),
      tok(String(divisor), "num"),
    ],
    needParen: true,
    value: k,
    hint: "被除数是加减算式时，先括起来算出它，再去除。",
  })
}

// ────────────────────────────────────────────────────────────
// token / 括号工具
// ────────────────────────────────────────────────────────────

function tok(text: string, type: Token["type"], fromFirst?: boolean, prec?: "md" | "as"): Token {
  return { text, type, fromFirst, prec }
}

/** 把第一步算式展开为 tokens（标记 fromFirst=true，用于动画高亮） */
function exprTokensFromStep0(s: StepLine): Token[] {
  return [
    tok(s.a.text, "num", true),
    tok(s.op, "op", true, precOf(s.op)),
    tok(s.b.text, "num", true),
  ]
}

/** 给 tokens 套上括号（返回带括号的 token 序列） */
function wrapTokens(inner: Token[]): Token[] {
  return [tok("(", "paren"), ...inner, tok(")", "paren")]
}

/** 无括号的裸式文本（用于「换」这一步的展示） */
export function bareText(s: StepLine): string {
  return `${s.a.text} ${s.op} ${s.b.text}`
}

/** tokens → 文本 */
export function tokensToText(tokens: Token[]): string {
  return tokens.map((t) => t.text).join(" ")
}

interface BuildSpec {
  mergedTokens: () => Token[]
  needParen: boolean
  value: number
  hint: string
}

let PROBLEM_SEQ = 0

/** 按 token 求值（标准优先级 + 括号）—— 用于「巧合题」拦截 */
function evalTokens(tokens: Token[]): number {
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
      eat() // ")"
      return v
    }
    eat()
    return Number(t.text)
  }
  const v = parseExpr()
  if (pos !== tokens.length) throw new Error("token 未消费完")
  return v
}

/**
 * 拦截「巧合题」：判定需括号、但不加括号答案竟一样（如 4×(14+7) 与 4×14+7 都是 63）。
 * 这类题**无法体现「必须加括号」的教学意图**（学生漏了括号也会"算对"），必须丢弃。
 */
function isCoincidental(tokens: Token[], needParen: boolean, value: number): boolean {
  if (!needParen) return false
  const bare = tokens.filter((t) => t.type !== "paren")
  if (bare.length === tokens.length) return false
  try {
    return evalTokens(bare) === value
  } catch {
    return false
  }
}

function buildProblem(kind: CompoundKind, steps: StepLine[], spec: BuildSpec): CompoundProblem | null {
  const tokens = spec.mergedTokens()
  const parens: ParenSpan[] = []
  if (spec.needParen) {
    const open = tokens.findIndex((t) => t.text === "(")
    const close = tokens.findIndex((t) => t.text === ")")
    if (open < 0 || close <= open) return null
    parens.push({ start: open, end: close + 1 })
  }
  // 巧合题（漏括号也"对"）在教学上无意义 ⇒ 直接丢弃，由外层重新生成
  if (isCoincidental(tokens, spec.needParen, spec.value)) return null

  const firstResult = steps[0].result
  const mergedText = tokensToText(tokens)
  const bareSub = mergedText.replace(/[()]/g, "").replace(/\s+/g, " ").trim()

  PROBLEM_SEQ += 1
  return {
    id: `${kind}-${PROBLEM_SEQ}-${Date.now().toString(36)}`,
    kind,
    steps,
    merged: { tokens, parens, value: spec.value },
    how: {
      find: {
        value: firstResult,
        inFirst: `${bareText(steps[0])} = ${firstResult}`,
        inSecond: bareText(steps[1]),
      },
      substitute: bareSub,
      check: {
        needParen: spec.needParen,
        reason: spec.needParen
          ? "按规矩先轮到的不是原来那步 ⇒ 必须补小括号"
          : "按规矩先轮到的正是原来那步 ⇒ 不用加括号",
      },
    },
    hint: spec.hint,
    answer: spec.value,
  }
}

// ────────────────────────────────────────────────────────────
// 对外：生成题目
// ────────────────────────────────────────────────────────────

/** 各题型权重（三年级上以「先加减后乘除」为重难点，权重最高）—— 键 = KIND_OF_INDEX 下标 */
const WEIGHTS: Record<number, number> = { 0: 4, 1: 3, 2: 2, 3: 2 }

/** ⚠️ 必须与 GENERATORS 数组顺序严格一致（索引即题型） */
const KIND_OF_INDEX: CompoundKind[] = [
  "addsub_then_muldiv",
  "muldiv_then_addsub",
  "as_subtrahend",
  "as_dividend",
]

/** 索引 → 生成器 的静态表保证顺序一致，避免「指定题型却生成别的题型」 */
const GENERATORS: Array<{ kind: CompoundKind; gen: () => CompoundProblem | null }> = [
  { kind: "addsub_then_muldiv", gen: genAddSubThenMulDiv },
  { kind: "muldiv_then_addsub", gen: genMulDivThenAddSub },
  { kind: "as_subtrahend", gen: genAsSubtrahend },
  { kind: "as_dividend", gen: genAsDividend },
]

/** 兜底：直连题型 → 生成器 */
const BY_KIND = new Map<CompoundKind, () => CompoundProblem | null>(
  GENERATORS.map((g) => [g.kind, g.gen]),
)

export { KIND_OF_INDEX }

/**
 * 生成一道题。
 * @param kinds 限定题型（不传 = 按权重随机）
 */
export function generateProblem(kinds?: CompoundKind[]): CompoundProblem | null {
  // 指定题型：直接取对应生成器（多次尝试，躲开内部 return null 的苛刻条件）
  if (kinds && kinds.length > 0) {
    for (let i = 0; i < 200; i++) {
      const k = kinds[rnd(0, kinds.length - 1)]
      const p = BY_KIND.get(k)?.()
      if (p) return p
    }
    return null
  }

  // 未指定：按权重随机
  const total = GENERATORS.reduce((s, _, i) => s + (WEIGHTS[i] ?? 1), 0)
  for (let i = 0; i < 200; i++) {
    let t = Math.random() * total
    let idx = GENERATORS.length - 1
    for (let j = 0; j < GENERATORS.length; j++) {
      t -= WEIGHTS[j] ?? 1
      if (t <= 0) { idx = j; break }
    }
    const p = GENERATORS[idx].gen()
    if (p) return p
  }
  return null
}

/** 批量生成 n 道不重复的题（生成不出足够多时按实际数量返回） */
export function generateProblems(n: number, kinds?: CompoundKind[]): CompoundProblem[] {
  const out: CompoundProblem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < n * 25 && out.length < n; i++) {
    const p = generateProblem(kinds)
    if (!p) continue
    const sig = tokensToText(p.merged.tokens)
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(p)
  }
  return out
}

// ────────────────────────────────────────────────────────────
// 易错示例（静态精选，教学法归纳）
// ────────────────────────────────────────────────────────────

export const MISTAKE_CASES: MistakeCase[] = [
  {
    kind: "missing_paren",
    title: "漏加括号（最常见）",
    icon: "paren",
    wrong: "20 - 15 × 6 = 20 - 90 = -70",
    right: "(20 - 15) × 6 = 5 × 6 = 30",
    why: "原式要先算 20 - 15，写成综合算式后乘除会抢在前头，答案全错。",
    tip: "先加减、后乘除 ⇒ 括号不能省！",
  },
  {
    kind: "missing_paren",
    title: "减号后面漏括号",
    icon: "paren",
    wrong: "83 - 27 ÷ 8 = 83 - 27 ÷ 8（除不尽，做不下去）",
    right: "(83 - 27) ÷ 8 = 56 ÷ 8 = 7",
    why: "27 是 83 减出来的，要整体参与除法；不括起来就变成 83 减 27÷8。",
    tip: "减号 / 除号后面是算式 ⇒ 加括号。",
  },
  {
    kind: "extra_paren",
    title: "多加括号（也扣分）",
    icon: "parenSlash",
    wrong: "5 × (63 ÷ 7) = 45（虽然答案对，但没必要）",
    right: "5 × 63 ÷ 7 = 5 × 9 = 45",
    why: "乘除同级，从左往右本来就先算 63 ÷ 7 —— 括号多余。",
    tip: "同级运算从左往右 ⇒ 不加括号。",
  },
  {
    kind: "extra_paren",
    title: "把乘除顺序搞反",
    icon: "parenSlash",
    wrong: "(5 × 63) ÷ 7 = 315 ÷ 7 = 45",
    right: "5 × 63 ÷ 7 = 45",
    why: "答案碰巧一样，但 (5×63) 改了运算顺序，不是题目要的「先算 63÷7」。",
    tip: "该先算哪个就放对位置，别乱加括号。",
  },
  {
    kind: "left_to_right",
    title: "同级运算跳步抢算",
    icon: "ltrSteps",
    wrong: "24 - 13 + 18 误算成 24 - (13 + 18) = -7",
    right: "24 - 13 + 18 = 11 + 18 = 29",
    why: "加减同级，要从左往右挨着算，不能挑后面的先算。",
    tip: "同级运算：从左往右，一个一个来。",
  },
  {
    kind: "wrong_order",
    title: "异级顺序弄反",
    icon: "timesDiv",
    wrong: "4 + 6 × 3 误算成 (4 + 6) × 3 = 30",
    right: "4 + 6 × 3 = 4 + 18 = 22",
    why: "有乘除又有加减，要先算乘除；题里没括号就不能自己加。",
    tip: "先乘除、后加减；想改顺序才用小括号。",
  },
  {
    kind: "left_to_right",
    title: "括号里也要看优先级",
    icon: "ltrSteps",
    wrong: "(12 + 8 × 3) ÷ 4 误算成 (20 × 3) ÷ 4 = 15",
    right: "(12 + 8 × 3) ÷ 4 = (12 + 24) ÷ 4 = 9",
    why: "括号里照样「先乘除后加减」，8×3 要先算，不能一路从左往右。",
    tip: "括号只改里外顺序，括号里的规矩不变。",
  },
]

/** 按类型取易错示例 */
export function mistakeCasesOf(kind: MistakeKind): MistakeCase[] {
  return MISTAKE_CASES.filter((m) => m.kind === kind)
}

// ────────────────────────────────────────────────────────────
// 口诀 / 常考点
// ────────────────────────────────────────────────────────────

export const RULES: { title: string; icon: string; lines: string[] }[] = [
  {
    title: "① 找 —— 找相同的那个数",
    icon: "lookup",
    lines: ["两个算式里相同的数，就是第一步的得数"],
  },
  {
    title: "② 换 —— 把得数换成整段算式",
    icon: "substitute",
    lines: ["第二步里那个数，换成第一步的整个算式"],
  },
  {
    title: "③ 查 —— 比一比运算顺序",
    icon: "checkMark",
    lines: ["顺序变了就补小括号"],
  },
  {
    title: "要不要加括号？",
    icon: "paren",
    lines: ["先加减、后乘除 ⇒ 加括号", "得数做被除数 / 减数 ⇒ 加括号", "其余 ⇒ 不加"],
  },
]

/** 题型 → 中文名 */
export const KIND_LABEL: Record<CompoundKind, string> = {
  addsub_then_muldiv: "先加减，后乘除",
  muldiv_then_addsub: "先乘除，后加减",
  as_dividend: "得数做被除数",
  as_subtrahend: "得数做减数",
}

/** ★ 题型图标（mathIcons.ts 的键）—— 提示行左边画一个，一幅图顶一句话 */
export const KIND_ICON: Record<CompoundKind, string> = {
  addsub_then_muldiv: "paren",
  muldiv_then_addsub: "parenSlash",
  as_dividend: "paren",
  as_subtrahend: "paren",
}
