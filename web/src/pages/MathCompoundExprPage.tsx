/** 三年级上 · 综合算式动画 — 「把两个分步算式合并成一个综合算式」
 *
 * 教学法：找 → 换 → 查
 *   ① 找：两个算式里相同的那个数（第一步的得数）
 *   ② 换：用第一步的整个算式替换掉它
 *   ③ 查：运算顺序变了吗？变了 ⇒ 补小括号
 *
 * 动画设计（分步播放，每步一个明确的视觉动作）：
 *   ① 找 —— 得数在两式里同时脉动高亮，一条虚线斜着把它们连起来
 *   ② 换 —— ★ 转移动画：① 的算式变成一块「幽灵」，从得数位置起飞，
 *            沿弧线飞到 ② 里那个数字的位置，原地把它顶掉（原位替换）。
 *            ① 的得数随即变灰（已被取走）
 *   ③ 查 —— 合并式按优先级分色 → 先暴露「不加括号会先算谁」(红) → ★ 括号飞入
 *            （两个括号从算式外侧飞进来、落到自己该在的位置上、夹紧被抱的那一块）
 *            → 逐项确认(绿)
 *   易错 —— 错误列式红闪抖动 vs 正确列式绿闪落定
 *
 * 配色约定（全站一致）：乘除 = 蓝（优先）· 加减 = 橙 · 正确 = 绿 · 错误 = 红
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  generateProblem,
  tokensToText,
  bareText,
  MISTAKE_CASES,
  RULES,
  KIND_LABEL,
  type CompoundProblem,
  type MistakeCase,
  type StepLine,
  type Token,
} from "../lib/compoundExpr"

// ────────────────────────────────────────────────────────────
// 小工具
// ────────────────────────────────────────────────────────────

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return reduced
}

/** 运算符 → 优先级色类 */
function precClass(op: string): string {
  return op === "×" || op === "÷" ? "ce-op-md" : "ce-op-as"
}

/** 一步算式 → token 序列（幽灵块 / 落位块共用） */
function stepTokens(s: StepLine): Token[] {
  return [
    { text: s.a.text, type: "num" },
    { text: s.op, type: "op", prec: s.op === "×" || s.op === "÷" ? "md" : "as" },
    { text: s.b.text, type: "num" },
  ]
}

/** 算式 token 渲染（幽灵块与落位块样式完全一致 ⇒ 交接无感） */
function ExprTokens({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={t.type === "num" ? "ce-num" : `ce-op ${precClass(t.text)}`}>
          {t.text}
        </span>
      ))}
    </>
  )
}

// ────────────────────────────────────────────────────────────
// 分步算式卡片（① / ②）
// ────────────────────────────────────────────────────────────

function StepCard({
  index,
  a,
  op,
  b,
  result,
  /** ② 卡里被引用的操作数位置（1 = a 位，2 = b 位）—— 挂 data-ce="tgt" 供测量 */
  refPos,
  /** 高亮得数（「找」这一步） */
  litResult,
  /** 高亮被引用的那个数（它是替换的目标） */
  litRef,
  /** 得数已被取走（① 卡） */
  taken,
  /** 隐藏「= 得数」（② 卡落位后：这时的式子还没验证完，不写等号） */
  hideTail,
  /** ② 卡：目标位置已被「换进来的算式」原位顶掉 */
  injected,
}: {
  index: 1 | 2
  a: string
  op: string
  b: string
  result: number
  refPos?: 1 | 2 | 0
  litResult?: boolean
  litRef?: boolean
  taken?: boolean
  hideTail?: boolean
  injected?: { pos: 1 | 2; tokens: Token[] } | null
}) {
  const renderOperand = (which: 1 | 2) => {
    if (injected && injected.pos === which) {
      return (
        <span key={`inj${which}`} className="ce-inject ce-land" data-ce="tgt">
          <ExprTokens tokens={injected.tokens} />
        </span>
      )
    }
    const lit = !!(litRef && refPos === which)
    const cls = ["ce-num"]
    if (lit) cls.push("ce-lit")
    if (taken && index === 1) cls.push("ce-taken")
    return (
      <span
        key={`op${which}`}
        className={cls.join(" ")}
        data-ce={index === 2 && refPos === which ? "tgt" : undefined}
      >
        {which === 1 ? a : b}
      </span>
    )
  }

  return (
    <div className={`ce-step ce-step-${index}`}>
      <span className="ce-step-no">{index === 1 ? "①" : "②"}</span>
      <span className="ce-expr">
        {renderOperand(1)}
        <span className={`ce-op ${precClass(op)}`}>{op}</span>
        {renderOperand(2)}
        {!hideTail && (
          <>
            <span className="ce-eq">=</span>
            <span
              className={`ce-num ce-result${litResult ? " ce-lit" : ""}`}
              data-ce={index === 1 ? "res" : undefined}
            >
              {result}
            </span>
          </>
        )}
      </span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 合并后的综合算式（逐 token 渲染，支持逐步高亮 / 括号飞入）
// ────────────────────────────────────────────────────────────

function MergedExpr({
  tokens,
  /** 高亮第 n 个 token（-1 = 不高亮） */
  litIndex,
  /** 高亮语义：'warn' = 「不加括号会被先算的就是它」（提醒）· 'ok' = 「就该先算它」（确认） */
  litKind,
  /** 括号是否已落位（真身显形） */
  parensIn,
  /** 括号已夹紧：被抱住的整块亮紫边（「这一段被括号抱住了」） */
  hug,
  /** 震动（错误演示） */
  shake,
  /** 成功闪光 */
  success,
}: {
  tokens: Token[]
  litIndex: number
  litKind: "warn" | "ok" | null
  parensIn: boolean
  hug?: boolean
  shake?: boolean
  success?: boolean
}) {
  const cls = ["ce-merged"]
  if (shake) cls.push("ce-shake")
  if (success) cls.push("ce-success")
  if (hug) cls.push("ce-hug")

  /** 被替换进来的那一块的左右两端（括号要抱住的正是它） */
  const firstFrom = tokens.findIndex((t) => t.fromFirst)
  const lastFrom = tokens.reduce((acc, t, i) => (t.fromFirst ? i : acc), -1)

  return (
    <div className={cls.join(" ")}>
      {tokens.map((t, i) => {
        const isParen = t.type === "paren"
        const flipIn = isParen && parensIn
        const c = ["ce-tok"]
        if (t.type === "num") c.push("ce-num")
        if (t.type === "op") c.push("ce-op", precClass(t.text))
        if (isParen) c.push("ce-paren", t.text === "(" ? "ce-paren-open" : "ce-paren-close")
        if (t.fromFirst) {
          c.push("ce-from-first")
          c.push(i === firstFrom ? "ce-run-first" : i === lastFrom ? "ce-run-last" : "ce-run-mid")
        }
        if (i === litIndex) {
          c.push("ce-tok-lit")
          if (litKind === "warn") c.push("ce-tok-warn")
          if (litKind === "ok") c.push("ce-tok-ok")
        }
        if (flipIn) c.push("ce-paren-in")
        // 供「括号飞入」动画测量：两个括号自身 + 被抱住那块的左右两端
        const dce = isParen
          ? t.text === "("
            ? "par-open"
            : "par-close"
          : i === firstFrom
            ? "wrap-first"
            : i === lastFrom
              ? "wrap-last"
              : undefined
        return (
          <span key={i} className={c.join(" ")} data-ce={dce} style={{ animationDelay: `${i * 30}ms` }}>
            {t.text}
          </span>
        )
      })}
    </div>
  )
}

/** 综合算式里有几个运算符（决定「查」阶段逐项确认要多久） */
function countOps(tokens: Token[]): number {
  return tokens.filter((t) => t.type === "op").length
}

// ────────────────────────────────────────────────────────────
// 主页面
// ────────────────────────────────────────────────────────────

type Phase = "idle" | "find" | "substitute" | "check" | "done"

/** 动画时间轴（ms） */
const T_FIND = 2200 // ① 找
const T_FLY = 1150 // ② 换：算式幽灵起飞 → 落位（含蓄力）
const T_LAND = 1250 // ② 换：落位后停留，看清「谁顶掉了谁」
const T_SUB = T_FIND + T_FLY + T_LAND // ② 换 → ③ 查
const T_WARN = 1700 // 查①：暴露「不加括号会先算谁」
const T_PAREN_FLY = 950 // 查②：括号从算式外侧飞入 → 落位
const T_PAREN_BOUNCE = 850 // 查②：不需要括号时，括号被「弹回去」消散
const T_PAREN_HOLD = 900 // 查②：括号夹紧后停留，看清它抱住了哪一块
const T_OP = 700 // 查③：每个运算符高亮的间隔

/** 飞行中的算式幽灵（视口坐标，position:fixed） */
interface Ghost {
  x: number
  y: number
  dx: number
  dy: number
  tokens: Token[]
}

/** 得数 → 目标数字 的连线（相对 .ce-stage 的坐标） */
interface Link {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function MathCompoundExprPage() {
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const [problem, setProblem] = useState<CompoundProblem | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  /** ② 换：0 = 飞行中，1 = 已落位（算式已在原位顶掉数字） */
  const [subSub, setSubSub] = useState<0 | 1>(0)
  /** 「查」的三小步：0 = 暴露「不加括号会先算谁」· 1 = 括号飞入 · 2 = 按正确顺序逐项确认 */
  const [checkSub, setCheckSub] = useState<0 | 1 | 2>(0)
  /** 「查」② 括号是否已落位（真身显形；飞行期间由克隆体代替） */
  const [parensLanded, setParensLanded] = useState(false)
  /** 「查」② 括号已夹紧：被抱住的那一块亮紫边 */
  const [hug, setHug] = useState(false)
  /** 「查」③ 已确认到第几个运算符 */
  const [checkStep, setCheckStep] = useState(0)
  const [showRules, setShowRules] = useState(false)
  const [showMistakes, setShowMistakes] = useState(false)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [link, setLink] = useState<Link | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const resultBoxRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLSpanElement>(null)
  /** 「查」② 飞行中的括号克隆体（挂 body 上，落位/弹走后移除） */
  const parenGhostsRef = useRef<HTMLElement[]>([])
  const timerRef = useRef<number[]>([])

  const removeParenGhosts = useCallback(() => {
    for (const el of parenGhostsRef.current) el.remove()
    parenGhostsRef.current = []
  }, [])

  const clearTimers = useCallback(() => {
    for (const t of timerRef.current) window.clearTimeout(t)
    timerRef.current = []
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timerRef.current.push(id)
  }, [])

  const newProblem = useCallback(() => {
    clearTimers()
    removeParenGhosts()
    setPhase("idle")
    setSubSub(0)
    setCheckSub(0)
    setParensLanded(false)
    setHug(false)
    setCheckStep(0)
    setGhost(null)
    setProblem(generateProblem())
  }, [clearTimers, removeParenGhosts])

  useEffect(() => {
    newProblem()
    return () => {
      clearTimers()
      removeParenGhosts()
    }
  }, [newProblem, clearTimers, removeParenGhosts])

  // ── 位置测量：① 的得数（起飞点 / 连线起点）、② 的目标数（落点 / 连线终点）──
  const measure = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const res = stage.querySelector<HTMLElement>('[data-ce="res"]')
    const tgt = stage.querySelector<HTMLElement>('[data-ce="tgt"]')
    if (!res || !tgt) return null
    return {
      stage: stage.getBoundingClientRect(),
      res: res.getBoundingClientRect(),
      tgt: tgt.getBoundingClientRect(),
    }
  }, [])

  const showFind = phase === "find"
  const showSub = phase === "substitute"
  const landed = subSub === 1
  const showCheck = phase === "check"
  const done = phase === "done"

  // ── 各阶段派生状态（提前到这里：play 与「括号飞入」都要用）──
  const steps = problem?.steps
  const merged = problem?.merged
  const needParen = problem?.how.check.needParen ?? false

  // ── 「找」「换」阶段：把两个数用斜虚线真正连起来（滚动时随之重算）──
  useEffect(() => {
    const active = showFind || (showSub && !landed)
    if (!active) {
      setLink(null)
      return
    }
    const m = measure()
    if (!m) return
    setLink({
      x1: m.res.left + m.res.width / 2 - m.stage.left,
      y1: m.res.top + m.res.height / 2 - m.stage.top,
      x2: m.tgt.left + m.tgt.width / 2 - m.stage.left,
      y2: m.tgt.top + m.tgt.height / 2 - m.stage.top,
    })
  }, [showFind, showSub, landed, measure, problem])

  // ── ② 换：起飞 —— 造一块算式幽灵，停在 ① 得数的位置，稍后由 WAAPI 飞向 ② ──
  useEffect(() => {
    if (reduced || !showSub || landed || !problem) return
    const m = measure()
    if (!m || m.tgt.width === 0) return
    setGhost({
      x: m.res.left,
      y: m.res.top,
      dx: m.tgt.left - m.res.left,
      dy: m.tgt.top - m.res.top,
      tokens: stepTokens(problem.steps[0]),
    })
  }, [showSub, landed, reduced, measure, problem])

  // 幽灵的飞行动画：蓄力 → 抬起 → 加速飞过 → 落位
  useEffect(() => {
    const el = ghostRef.current
    if (!el || !ghost || reduced) return
    const anim = el.animate(
      [
        { transform: "translate(0px, 0px) scale(0.82)", opacity: 0, offset: 0 },
        { transform: "translate(-7px, -13px) scale(1)", opacity: 1, offset: 0.18, easing: "cubic-bezier(.34,1.56,.64,1)" },
        { transform: `translate(${ghost.dx * 0.44}px, ${ghost.dy * 0.44 - 22}px) scale(1.14)`, opacity: 1, offset: 0.62 },
        { transform: `translate(${ghost.dx}px, ${ghost.dy}px) scale(1)`, opacity: 1, offset: 1 },
      ],
      { duration: T_FLY, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" },
    )
    return () => anim.cancel()
  }, [ghost, reduced])

  /**
   * ★「查」② 括号飞入 ——
   *  · 需要括号：( 从算式左侧外、( 从右侧外飞进来 → 落到**自己该在的位置**上 →
   *    真实括号就地显形接管（克隆体与真身逐字一致 ⇒ 落位无跳变）→ 两个括号向内「夹紧」，
   *    被抱住的那一块亮起紫边 ⇒ 一眼看出「括号抱住了哪一段」
   *  · 不需要括号：括号飞进来想夹，没夹住、被**弹回去**消散 ⇒ 「它是多余的，别加」
   */
  useEffect(() => {
    if (reduced || !showCheck || checkSub !== 1 || !problem) return
    const box = resultBoxRef.current
    if (!box) return
    removeParenGhosts()

    // 克隆体与真身要逐字一致 ⇒ 字号/行高从 .ce-merged 现取（挂 body 上会失去继承）
    // ⚠️ 千万别内联 font-weight：.ce-paren 是 900、.ce-merged 是 800，取错就会让括号
    //    比真身窄一截、落点也就跟着偏（实测偏 7px）。让它由 .ce-paren 自己的类决定。
    const mp = box.querySelector<HTMLElement>(".ce-merged")
    const cs = mp ? window.getComputedStyle(mp) : null
    const base = [
      "position:fixed",
      "left:0",
      "top:0",
      "margin:0",
      "z-index:80",
      "pointer-events:none",
      "opacity:1",
      "will-change:transform",
      `font-size:${cs?.fontSize ?? "24px"}`,
      `font-family:${cs?.fontFamily ?? "inherit"}`,
      `line-height:${cs?.lineHeight ?? "normal"}`,
      `font-variant-numeric:${cs?.fontVariantNumeric ?? "tabular-nums"}`,
    ].join(";")

    // 被括号抱住的（要抱的）那一块：左右两端
    const wf = box.querySelector<HTMLElement>('[data-ce="wrap-first"]')
    const wl = box.querySelector<HTMLElement>('[data-ce="wrap-last"]')
    const wrap = (() => {
      if (!wf || !wl) return null
      const a = wf.getBoundingClientRect()
      const b = wl.getBoundingClientRect()
      return { left: a.left, right: b.right, top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }
    })()

    const fly = (ch: "(" | ")", dir: -1 | 1, sel: string) => {
      const real = needParen ? box.querySelector<HTMLElement>(`[data-ce="${sel}"]`) : null
      const el = real ? (real.cloneNode(true) as HTMLElement) : document.createElement("span")
      if (real) {
        // 克隆体只是飞行中的替身：摘掉测量锚点，免得污染 document 上的查询
        el.removeAttribute("data-ce")
      } else {
        el.className = "ce-tok ce-paren"
        el.textContent = ch
      }
      el.style.cssText = base
      document.body.appendChild(el)
      parenGhostsRef.current.push(el)

      const r = el.getBoundingClientRect()
      let left: number, top: number
      if (real) {
        // 落点 = 真实括号自己的位置（像素级一致 ⇒ 落位瞬间交接无感）
        const t = real.getBoundingClientRect()
        left = t.left
        top = t.top
      } else if (wrap) {
        // 不需括号：朝被替换那块的两侧靠过去（左侧 → 右边贴住块的左沿）
        left = dir < 0 ? wrap.left - r.width - 2 : wrap.right + 2
        top = wrap.top + (wrap.bottom - wrap.top - r.height) / 2
      } else {
        el.remove()
        return
      }
      el.style.left = `${left}px`
      el.style.top = `${top}px`

      // 轨迹：从算式两侧**外侧**飞入（略微抬升，别压到「综合算式」标签上）
      // ⚠️ 所有 keyframe 的 offset 必须**严格递增**，否则 WAAPI 抛
      //    「Offsets must be monotonically non-decreasing」→ React 渲染期崩溃（整页白屏）
      const out = dir * 96
      const enter = [
        { transform: `translate(${out}px, -14px) scale(2.05) rotate(${dir * 18}deg)`, opacity: 0, offset: 0 },
        { transform: `translate(${out * 0.6}px, -10px) scale(1.72) rotate(${dir * 11}deg)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${out * 0.24}px, -4px) scale(1.3) rotate(${dir * 4}deg)`, opacity: 1, offset: 0.48 },
      ]
      const dur = needParen ? T_PAREN_FLY : T_PAREN_FLY + T_PAREN_BOUNCE
      const keys = needParen
        ? [
            ...enter,
            { transform: "translate(0px, -2px) scale(1.08)", opacity: 1, offset: 0.86 },
            { transform: "translate(0px, 0px) scale(1)", opacity: 1, offset: 1 },
          ]
        : [
            ...enter,
            { transform: "translate(0px, 0px) scale(1.02)", opacity: 1, offset: 0.56 }, // 到位 —— 想夹住
            { transform: "translate(0px, 0px) scale(1)", opacity: 1, offset: 0.68 }, // 停一下：夹不住
            {
              transform: `translate(${dir * 30}px, -7px) scale(1.18) rotate(${dir * 11}deg)`,
              opacity: 0.9,
              offset: 0.82,
              easing: "cubic-bezier(.34,1.56,.64,1)",
            },
            {
              transform: `translate(${dir * 120}px, 26px) scale(1.62) rotate(${dir * 28}deg)`,
              opacity: 0,
              offset: 1,
            },
          ]
      // 兜底：万一 offset 写乱了，排序一次也好过让 WAAPI 抛错把整页带走
      const safe = [...keys].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))
      el.animate(safe, { duration: dur, easing: "cubic-bezier(.34,.06,.28,1)", fill: "forwards" })
    }

    // 括号本来就在算式外侧 —— '(' 从左来，')' 从右来
    fly("(", -1, "par-open")
    fly(")", 1, "par-close")
  }, [reduced, showCheck, checkSub, problem, needParen, removeParenGhosts])

  const play = useCallback(() => {
    if (!problem) return
    clearTimers()
    removeParenGhosts()
    setSubSub(0)
    setCheckSub(0)
    setParensLanded(false)
    setHug(false)
    setCheckStep(0)
    setGhost(null)
    if (reduced) {
      setSubSub(1)
      setCheckSub(2)
      setParensLanded(true)
      setPhase("done")
      return
    }
    setPhase("find")
    later(() => setPhase("substitute"), T_FIND)
    // ② 换：飞行结束后落位 —— 算式在 ② 原位顶掉数字，幽灵退场
    later(() => {
      setSubSub(1)
      setGhost(null)
    }, T_FIND + T_FLY)
    later(() => setPhase("check"), T_SUB)
    // 「查」① 先暴露「不加括号会先算谁」
    later(() => setCheckSub(1), T_SUB + T_WARN)
    // 「查」② 括号飞入
    const parenAt = T_SUB + T_WARN + T_PAREN_FLY
    const recheckAt = T_SUB + T_WARN + T_PAREN_FLY + T_PAREN_HOLD
    if (needParen) {
      // 落位：克隆体退场，真实括号就地显形，随即向内夹紧
      later(() => {
        setParensLanded(true)
        setHug(true)
        removeParenGhosts()
      }, parenAt)
    } else {
      // 想夹但夹不住 ⇒ 被弹回去（克隆体等动画播完再移除）
      later(removeParenGhosts, T_SUB + T_WARN + T_PAREN_FLY + T_PAREN_BOUNCE)
    }
    // 「查」③ 按正确顺序逐项确认（夹紧高亮同步结束，交给逐项高亮接管）
    later(() => {
      setCheckSub(2)
      setHug(false)
    }, recheckAt)
    const n = Math.max(1, countOps(problem.merged.tokens))
    later(() => setPhase("done"), recheckAt + 400 + T_OP * (n - 1) + 1300)
  }, [problem, reduced, needParen, clearTimers, later, removeParenGhosts])

  // ── 各阶段派生状态 ──
  /** 第二个算式里，被替换的操作数位置（1 = a 位，2 = b 位） */
  const refPos = useMemo<1 | 2 | 0>(() => {
    if (!steps) return 0
    if (steps[1].a.fromStep === 1) return 1
    if (steps[1].b.fromStep === 1) return 2
    return 0
  }, [steps])

  /** 「查」③：按**正确顺序**高亮 token（括号内先算 → 再乘除 → 再加减，各自从左往右） */
  const checkOrder = useMemo(() => {
    if (!merged) return [] as number[]
    const tokens = merged.tokens
    const md: number[] = []
    const as: number[] = []
    tokens.forEach((t, i) => {
      if (t.type !== "op") return
      if (t.prec === "md") md.push(i)
      else as.push(i)
    })
    if (merged.parens.length > 0) {
      const [span] = merged.parens
      const inner = (i: number) => i > span.start && i < span.end
      return [...md.filter(inner), ...as.filter(inner), ...md.filter((i) => !inner(i)), ...as.filter((i) => !inner(i))]
    }
    return [...md, ...as]
  }, [merged])

  /** 「查」①：**不加括号**时，按「从左往右、先乘除后加减」第一个会被算到的运算符
   *  —— 与 checkOrder[0] 对比，就能一眼看出「顺序到底变没变」 */
  const wrongFirstIdx = useMemo(() => {
    if (!merged) return -1
    const t = merged.tokens
    const i = t.findIndex((x) => x.type === "op" && x.prec === "md")
    if (i >= 0) return i
    return t.findIndex((x) => x.type === "op")
  }, [merged])

  useEffect(() => {
    if (!showCheck || checkSub !== 2 || checkOrder.length === 0) {
      setCheckStep(0)
      return
    }
    if (reduced) {
      setCheckStep(checkOrder.length)
      return
    }
    setCheckStep(0)
    const ids = checkOrder.map((_, i) => window.setTimeout(() => setCheckStep(i + 1), 400 + T_OP * i))
    return () => ids.forEach((x) => window.clearTimeout(x))
  }, [showCheck, checkSub, checkOrder, reduced])

  const litToken =
    showCheck && checkSub === 2 && checkStep > 0
      ? checkOrder[checkStep - 1]
      : showCheck && checkSub === 0
        ? wrongFirstIdx
        : -1
  const litKind: "warn" | "ok" | null = showCheck
    ? needParen
      ? checkSub === 0
        ? "warn" // 「不加括号会被先算的就是它」—— 红色警示（顺序被换掉了）
        : checkSub >= 1
          ? "ok"
          : null
      : "ok" // 本题顺序本来就不变，一路绿色确认
    : null

  // 括号显形时机：「查」② 的飞行**落位**之后（飞行期间由克隆体代替，真身保持隐身）
  const parensIn = done || (showCheck && parensLanded)

  const warnOpText = merged && wrongFirstIdx >= 0 ? merged.tokens[wrongFirstIdx].text : ""
  const step0Text = problem ? bareText(problem.steps[0]) : ""

  const hintText = useMemo(() => {
    if (!problem) return ""
    switch (phase) {
      case "find":
        return `两个式子里都有 ${problem.steps[0].result} —— 它就是第一步算出来的得数。`
      case "substitute":
        return landed
          ? `看，② 里原来的 ${problem.steps[0].result} 已经被「${step0Text}」顶掉了 —— 算式站到了数字原来的位置上。因为 ${problem.steps[0].result} 本来就是 ${step0Text} 算出来的，换进去得数不变；至于顺序会不会变，下一步再查。`
          : `把 ① 的得数 ${problem.steps[0].result} 换成整段「${step0Text}」—— 它正从 ① 的得数那儿飞过去，占住 ② 里 ${problem.steps[0].result} 的位置。`
      case "check":
        if (checkSub === 0) {
          return needParen
            ? `先别急着加括号 —— 按规矩「从左往右、先乘除后加减」，第一个轮到的会是这个「${warnOpText}」。可原题要先算 ①「${step0Text}」呀，顺序被换掉了！`
            : `按规矩「从左往右、先乘除后加减」，第一个轮到的正是这个「${warnOpText}」—— 原题也是先算它，顺序没变。`
        }
        if (checkSub === 1) {
          return needParen
            ? `看 —— 两个小括号正从算式两边飞进来，把 ①「${step0Text}」整个抱住。`
            : `把括号加进去试试 —— 可这里顺序本来就没变，括号抱不住谁，被弹回去了。直接写下来就好。`
        }
        return needParen
          ? `括号一加，第一个被算的换成了 ①「${step0Text}」—— 顺序对上了，答案才一致。`
          : `顺序没变，答案也已经一致了。`
      case "done":
        return `合并成功：${tokensToText(problem.merged.tokens)} = ${problem.answer}`
      default:
        return "点「播放动画」，看两个算式怎样合成一个。"
    }
  }, [problem, phase, checkSub, landed, needParen, warnOpText, step0Text])

  return (
    <div className="page ce-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🧮 三年级上 · 综合算式动画</h1>
      </header>
      <p className="ce-sub">把两个分步算式，合并成一个综合算式</p>

      {/* ── 口诀卡 ── */}
      <div className="ce-rules-bar">
        <button className="ce-chip" onClick={() => setShowRules((v) => !v)}>
          {showRules ? "收起口诀" : "📌 找→换→查 口诀"}
        </button>
        <button className="ce-chip" onClick={() => setShowMistakes((v) => !v)}>
          {showMistakes ? "收起易错" : "⚠️ 易错警示"}
        </button>
      </div>

      {showRules && (
        <div className="card ce-rules">
          {RULES.map((r) => (
            <div key={r.title} className="ce-rule-block">
              <p className="ce-rule-title">{r.title}</p>
              <ul>
                {r.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {showMistakes && (
        <div className="ce-mistakes">
          {MISTAKE_CASES.map((m, i) => (
            <MistakeCard key={i} m={m} />
          ))}
        </div>
      )}

      {problem && (
        <>
          {/* ── 题型标签 ── */}
          <div className="ce-kind-row">
            <span className="ce-kind-tag">{KIND_LABEL[problem.kind]}</span>
            <span className={`ce-kind-hint ${needParen ? "ce-need" : "ce-noneed"}`}>
              {needParen ? "这题要加小括号" : "这题不用加括号"}
            </span>
          </div>

          {/* ── 分步算式区 ── */}
          <div className="ce-stage" ref={stageRef}>
            <StepCard
              index={1}
              a={problem.steps[0].a.text}
              op={problem.steps[0].op}
              b={problem.steps[0].b.text}
              result={problem.steps[0].result}
              litResult={showFind || (showSub && !landed)}
              taken={landed}
            />
            <StepCard
              index={2}
              a={problem.steps[1].a.text}
              op={problem.steps[1].op}
              b={problem.steps[1].b.text}
              result={problem.steps[1].result}
              refPos={refPos}
              litRef={showFind || (showSub && !landed)}
              hideTail={landed}
              injected={
                landed && refPos !== 0
                  ? { pos: refPos, tokens: stepTokens(problem.steps[0]) }
                  : null
              }
            />

            {/* 连线：得数 → 第二个算式里的目标数字（真正连到两个数上）*/}
            {link && (
              <div className="ce-link" aria-hidden>
                <span className="ce-link-dot" style={{ left: link.x1, top: link.y1 }} />
                <span
                  className="ce-link-line"
                  style={{
                    left: link.x1,
                    top: link.y1 - 1,
                    width: Math.hypot(link.x2 - link.x1, link.y2 - link.y1),
                    transform: `rotate(${Math.atan2(link.y2 - link.y1, link.x2 - link.x1)}rad)`,
                  }}
                />
                <span className="ce-link-dot" style={{ left: link.x2, top: link.y2 }} />
              </div>
            )}
          </div>

          {/* ── 阶段提示 ── */}
          <p className={`ce-hint ce-hint-${phase}${showCheck && checkSub === 0 && needParen ? " ce-hint-warn" : ""}`}>
            {hintText}
          </p>

          {/* ── 合并结果区 ── */}
          {(showCheck || done) && (
            <div className="ce-result-box" ref={resultBoxRef}>
              <p className="ce-result-label">综合算式</p>
              <MergedExpr
                tokens={problem.merged.tokens}
                litIndex={litToken}
                litKind={litKind}
                parensIn={parensIn}
                hug={hug}
                success={done}
              />
              {done && (
                <p className="ce-result-value">
                  = <b>{problem.answer}</b>
                  <span className="ce-ok">✓ 与分步算式的得数一致</span>
                </p>
              )}
              {done && needParen && (
                <p className="ce-paren-why">
                  🧷 括号里先算：<b>{bareText(problem.steps[0])} = {problem.steps[0].result}</b>
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ── 控制区 ── */}
      <div className="ce-actions">
        <button className="ce-btn ce-btn-primary" onClick={play} disabled={!problem || (phase !== "idle" && phase !== "done")}>
          {phase === "idle" ? "▶ 播放动画" : phase === "done" ? "↻ 再看一遍" : "播放中…"}
        </button>
        <button className="ce-btn" onClick={newProblem}>🎲 换一题</button>
      </div>

      {problem && (
        <p className="ce-answer-hidden">
          提示：{problem.hint}
        </p>
      )}

      {/* ── ② 换：飞行中的算式幽灵（视口坐标，不参与布局）── */}
      {ghost && (
        <span
          ref={ghostRef}
          className="ce-ghost"
          style={{ left: ghost.x, top: ghost.y }}
          aria-hidden
        >
          <ExprTokens tokens={ghost.tokens} />
        </span>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 易错示例卡（错误红闪 vs 正确绿闪）
// ────────────────────────────────────────────────────────────

function MistakeCard({ m }: { m: MistakeCase }) {
  const [showRight, setShowRight] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 滚到可见处：先让「❌ 错」抖一下，1.1s 后揭晓「✅ 对」（每张卡只演一次）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer: number | undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        setShowRight(false)
        timer = window.setTimeout(() => setShowRight(true), 1100)
      },
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="card ce-mistake" ref={ref}>
      <p className="ce-mistake-title">⚠️ {m.title}</p>
      <div className="ce-mistake-row ce-wrong">
        <span className="ce-mistake-tag">❌ 错</span>
        <span className="ce-mistake-expr ce-shake">{m.wrong}</span>
      </div>
      <div className={`ce-mistake-row ce-right${showRight ? " ce-right-in" : ""}`}>
        <span className="ce-mistake-tag">✅ 对</span>
        <span className="ce-mistake-expr">{m.right}</span>
      </div>
      <p className="ce-mistake-why">{m.why}</p>
      <p className="ce-mistake-tip">💡 {m.tip}</p>
    </div>
  )
}
