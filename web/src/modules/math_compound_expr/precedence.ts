/** 「先算谁？」— 运算优先级的**计算顺序**引擎（纯逻辑 · 确定性 · 可单测）
 *
 * 人教版三年级上「混合运算」的三条规矩：
 *   ① 有小括号 ⇒ 先算括号里面的（括号只改「里外」顺序，括号里的规矩不变）
 *   ② 没有括号 ⇒ 先乘除、后加减（跟运算符写在左边还是右边**无关**）
 *   ③ 同级运算 ⇒ 从左往右，一个一个算
 *
 * 为什么产物是「顺序」而不是「一个数」：
 *   这一节要教的是**谁先算**。动画必须照着一条确定的化简轨迹走 —— 每一步算哪个运算符、
 *   算完算式长什么样。所以引擎返回 `PStep[]`（轨迹），而不是求值结果。
 *
 * 单测用**三个互相独立的裁判**交叉验算轨迹终点：
 *   ① 递归下降求值（本文件 evalExpr）② 逐步化简（planSteps 的终点）
 *   ③ 直接把 token 拼成 JS 表达式交给 JS 引擎算（测试里用 new Function）
 *   —— 三个来自不同思路的实现给出同一个整数，才说明轨迹一定对。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

export interface PToken {
  text: string
  type: "num" | "op" | "paren"
  /** 该数字是**前一步算出来的**（渐进化简的产物）—— 动画给它一个「已算出」的底色 */
  computed?: boolean
}

/** 本步为什么先算它 */
export type PWhy =
  /** 在括号里 ⇒ 括号里的先算 */
  | "paren"
  /** 同一层里级别不同 ⇒ 乘除压倒加减 */
  | "higher"
  /** 同一层里级别相同 ⇒ 从左往右，先碰到谁先算 */
  | "same-level"

/** 一步化简 */
export interface PStep {
  /** 本步要算的运算符在 **before** 里的下标 */
  index: number
  op: string
  /** 左右两个操作数（显示文本） */
  left: string
  right: string
  value: number
  why: PWhy
  /** 同一层里除它以外的运算符（讲解用：「加号在左边也得等一等」） */
  siblings: string[]
  before: PToken[]
  after: PToken[]
}

// ────────────────────────────────────────────────────────────
// token 构造
// ────────────────────────────────────────────────────────────

export function numTok(v: number | string): PToken {
  return { text: String(v), type: "num" }
}

export function opTok(op: string): PToken {
  return { text: op, type: "op" }
}

export function parenTok(ch: "(" | ")"): PToken {
  return { text: ch, type: "paren" }
}

/** 是否乘除（优先级高的一级） */
export function isMd(op: string): boolean {
  return op === "×" || op === "÷"
}

export function applyOp(a: number, op: string, b: number): number {
  switch (op) {
    case "+": return a + b
    case "-": return a - b
    case "×": return a * b
    case "÷": return a / b
    default: throw new Error(`未知运算符：${op}`)
  }
}

// ────────────────────────────────────────────────────────────
// 求值（递归下降 —— 与「逐步化简」互为交叉验证）
// ────────────────────────────────────────────────────────────

export function evalExpr(tokens: PToken[]): number {
  let pos = 0
  const peek = () => tokens[pos]
  const eat = () => tokens[pos++]

  function parseExpr(): number {
    let left = parseTerm()
    while (peek() && peek().type === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = eat().text
      left = applyOp(left, op, parseTerm())
    }
    return left
  }
  function parseTerm(): number {
    let left = parseFactor()
    while (peek() && peek().type === "op" && isMd(peek().text)) {
      const op = eat().text
      left = applyOp(left, op, parseFactor())
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
      if (!close || close.text !== ")") throw new Error("括号不配对")
      return v
    }
    eat()
    return Number(t.text)
  }

  const v = parseExpr()
  if (pos !== tokens.length) throw new Error("token 未消费完")
  return v
}

// ────────────────────────────────────────────────────────────
// 顺序判定
// ────────────────────────────────────────────────────────────

/** 最内层括号组（返回 "(" 与 ")" 的下标）；没有括号则 null */
export function innermostGroup(tokens: PToken[]): { open: number; close: number } | null {
  let open = -1
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type !== "paren") continue
    if (t.text === "(") {
      if (open < 0) open = i
      depth += 1
      continue
    }
    depth -= 1
    if (depth === 0 && open >= 0) {
      // 这一组里还嵌着更内层的括号 ⇒ 往里面钻
      const inner = innermostGroup(tokens.slice(open + 1, i))
      if (inner) return { open: open + 1 + inner.open, close: open + 1 + inner.close }
      return { open, close: i }
    }
  }
  return null
}

/** 当前层（= 最内层括号组之内，或整个算式）的运算符下标 */
export function opsAtLevel(tokens: PToken[], g: { open: number; close: number } | null): number[] {
  const from = g ? g.open + 1 : 0
  const to = g ? g.close : tokens.length
  const out: number[] = []
  for (let i = from; i < to; i++) if (tokens[i].type === "op") out.push(i)
  return out
}

/**
 * 下一个该算的运算符下标（-1 = 已经没有运算符了）。
 * 判定顺序：① 最内层括号里的 → ② 其中级别最高的（乘除压倒加减）→ ③ 同级取最左。
 */
export function nextOpIndex(tokens: PToken[]): number {
  const g = innermostGroup(tokens)
  const ops = opsAtLevel(tokens, g)
  if (ops.length === 0) return -1
  const md = ops.filter((i) => isMd(tokens[i].text))
  return md.length > 0 ? md[0] : ops[0]
}

/** 单层括号若只包着一个数就拆掉：( 36 ) ⇒ 36 */
function collapseParens(tokens: PToken[]): PToken[] {
  const out: PToken[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text === "(" && tokens[i + 1]?.type === "num" && tokens[i + 2]?.text === ")") {
      out.push(tokens[i + 1])
      i += 2
      continue
    }
    out.push(tokens[i])
  }
  return out
}

/** 在 i 处化简一步：把 (i-1, i, i+1) 三个 token 换成一个数 */
export function reduceAt(tokens: PToken[], i: number): PToken[] {
  const left = tokens[i - 1]
  const right = tokens[i + 1]
  if (!left || !right || left.type !== "num" || right.type !== "num") {
    throw new Error("运算符两侧不是数字，无法化简")
  }
  const v = applyOp(Number(left.text), tokens[i].text, Number(right.text))
  const next: PToken = { text: String(v), type: "num", computed: true }
  return collapseParens([...tokens.slice(0, i - 1), next, ...tokens.slice(i + 2)])
}

/**
 * 把整个算式摊成一条**化简轨迹**：每一步算哪个运算符、依据是哪条规矩、算完长什么样。
 * 轨迹终点必然是「只剩一个数」，且那个数等于算式的结果。
 */
export function planSteps(tokens: PToken[]): PStep[] {
  const steps: PStep[] = []
  let cur = tokens.map((t) => ({ ...t }))
  // 兜底：正常算式最多化简 (token 数 / 2) 次
  for (let guard = 0; guard < tokens.length + 4; guard++) {
    const index = nextOpIndex(cur)
    if (index < 0) break
    const g = innermostGroup(cur)
    const ops = opsAtLevel(cur, g)
    const md = ops.filter((i) => isMd(cur[i].text))
    const inside = !!g && index > g.open && index < g.close

    let why: PWhy
    if (inside) why = "paren"
    else if (md.length > 0 && md.length < ops.length) why = "higher"
    else why = "same-level"

    const after = reduceAt(cur, index)
    // ⚠️ 结果值直接由左右操作数算出，**不要**回头读 after[index-1]：
    //    reduceAt 里的 collapseParens 可能把结果之前的 token 抹掉、让下标整体左移
    const value = applyOp(Number(cur[index - 1].text), cur[index].text, Number(cur[index + 1].text))
    steps.push({
      index,
      op: cur[index].text,
      left: cur[index - 1].text,
      right: cur[index + 1].text,
      value,
      why,
      siblings: ops.filter((i) => i !== index).map((i) => cur[i].text),
      before: cur,
      after,
    })
    cur = after
  }
  return steps
}

/** 轨迹终点（只剩下一个数时的值）；轨迹为空则抛出 */
export function finalValue(steps: PStep[]): number {
  const last = steps[steps.length - 1]
  if (!last) throw new Error("轨迹为空")
  const rest = last.after
  if (rest.length !== 1 || rest[0].type !== "num") throw new Error("轨迹没有化简到只剩一个数")
  return Number(rest[0].text)
}

// ────────────────────────────────────────────────────────────
// 页内小动画用的两组示例（数值均已在 MISTAKE_CASES 里人工验算过）
// ────────────────────────────────────────────────────────────

export interface PrDemoCase {
  key: string
  /** 切换按钮上的文字 */
  chip: string
  /** 这一组要讲的规矩 */
  label: string
  tokens: PToken[]
  /** 正确答案（人工验算的常量，单测会断言引擎算出来必须等于它） */
  answer: number
  /** 常见的错法 */
  wrong: string
  wrongWhy: string
}

export const PR_DEMO_CASES: PrDemoCase[] = [
  {
    key: "diff",
    chip: "不同级 4 + 6 × 3",
    label: "不同级 —— 先乘除，后加减",
    tokens: [numTok(4), opTok("+"), numTok(6), opTok("×"), numTok(3)],
    answer: 22,
    wrong: "(4 + 6) × 3 = 30",
    wrongWhy: "加号在左边就先算？旁边有乘除，加减得让路。",
  },
  {
    key: "same",
    chip: "同级 24 - 13 + 18",
    label: "同级 —— 从左往右，先碰到谁先算",
    tokens: [numTok(24), opTok("-"), numTok(13), opTok("+"), numTok(18)],
    answer: 29,
    wrong: "24 - (13 + 18) = -7",
    wrongWhy: "加减是一家，不比谁厉害；同级就从左到右算。",
  },
]
