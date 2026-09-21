/** 三年级上 · 综合算式动画 — 「把两个分步算式合并成一个综合算式」
 *
 * 教学法：找 → 换 → 查
 *   ① 找：两个算式里相同的那个数（第一步的得数）
 *   ② 换：用第一步的整个算式替换掉它
 *   ③ 查：运算顺序变了吗？变了 ⇒ 补小括号
 *
 * 动画设计（分步播放，每步一个明确的视觉动作）：
 *   ① 找 —— 得数在两式里同时脉动高亮 + 连线
 *   ② 换 —— 数字淡出 → 算式从下方滑入替换位（位移 + 缩放）
 *   ③ 查 —— 合并式按优先级分色（乘除蓝 / 加减橙）→ 逐 token 播放「谁先算」→ 括号飞入
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

// ────────────────────────────────────────────────────────────
// 分步算式卡片（① / ②）
// ────────────────────────────────────────────────────────────

function StepCard({
  index,
  a,
  op,
  b,
  result,
  /** 高亮该卡片里的得数（「找」这一步） */
  litResult,
  /** 高亮某个操作数（它是被替换的目标） */
  litOperand,
  /** 淡出被替换的操作数（「换」这一步） */
  fading,
}: {
  index: 1 | 2
  a: string
  op: string
  b: string
  result: number
  litResult?: boolean
  litOperand?: number
  fading?: number
  }) {
  const operandCls = (which: 1 | 2) => {
    const lit = litOperand === which
    const cls = ["ce-num"]
    if (lit) cls.push("ce-lit")
    if (lit && fading) cls.push("ce-fade-out")
    return cls.join(" ")
  }
  return (
    <div className={`ce-step ce-step-${index}`}>
      <span className="ce-step-no">{index === 1 ? "①" : "②"}</span>
      <span className="ce-expr">
        <span className={operandCls(1)}>{a}</span>
        <span className={`ce-op ${precClass(op)}`}>{op}</span>
        <span className={operandCls(2)}>{b}</span>
        <span className="ce-eq">=</span>
        <span className={`ce-num ce-result${litResult ? " ce-lit" : ""}`}>{result}</span>
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
  /** 括号是否已飞入 */
  parensIn,
  /** 震动（错误演示） */
  shake,
  /** 成功闪光 */
  success,
}: {
  tokens: Token[]
  litIndex: number
  litKind: "warn" | "ok" | null
  parensIn: boolean
  shake?: boolean
  success?: boolean
}) {
  const cls = ["ce-merged"]
  if (shake) cls.push("ce-shake")
  if (success) cls.push("ce-success")

  return (
    <div className={cls.join(" ")}>
      {tokens.map((t, i) => {
        const isParen = t.type === "paren"
        const flipIn = isParen && parensIn
        const c = ["ce-tok"]
        if (t.type === "num") c.push("ce-num")
        if (t.type === "op") c.push("ce-op", precClass(t.text))
        if (t.type === "paren") c.push("ce-paren")
        if (t.fromFirst) c.push("ce-from-first")
        if (i === litIndex) {
          c.push("ce-tok-lit")
          if (litKind === "warn") c.push("ce-tok-warn")
          if (litKind === "ok") c.push("ce-tok-ok")
        }
        if (flipIn) c.push("ce-paren-in")
        return (
          <span key={i} className={c.join(" ")} style={{ animationDelay: `${i * 30}ms` }}>
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
const T_SUB = 4200 // ② 换
const T_WARN = 1700 // 查：暴露「不加括号会先算谁」
const T_RECHECK = 1100 // 查：括号飞入 → 停顿
const T_OP = 700 // 查：每个运算符高亮的间隔

export function MathCompoundExprPage() {
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const [problem, setProblem] = useState<CompoundProblem | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  /** 「查」的三小步：0 = 暴露「不加括号会先算谁」· 1 = 括号飞入 · 2 = 按正确顺序逐项确认 */
  const [checkSub, setCheckSub] = useState<0 | 1 | 2>(0)
  /** 「查」③ 已确认到第几个运算符 */
  const [checkStep, setCheckStep] = useState(0)
  const [showRules, setShowRules] = useState(false)
  const [showMistakes, setShowMistakes] = useState(false)
  const timerRef = useRef<number[]>([])

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
    setPhase("idle")
    setCheckSub(0)
    setCheckStep(0)
    setProblem(generateProblem())
  }, [clearTimers])

  useEffect(() => {
    newProblem()
    return clearTimers
  }, [newProblem, clearTimers])

  const play = useCallback(() => {
    if (!problem) return
    clearTimers()
    setCheckSub(0)
    setCheckStep(0)
    if (reduced) {
      setCheckSub(2)
      setPhase("done")
      return
    }
    setPhase("find")
    later(() => setPhase("substitute"), T_FIND)
    later(() => setPhase("check"), T_SUB)
    // 「查」：① 先暴露「不加括号会先算谁」→ ② 括号飞入 → ③ 按正确顺序逐项确认
    later(() => setCheckSub(1), T_SUB + T_WARN)
    const recheckAt = T_SUB + T_WARN + T_RECHECK
    later(() => setCheckSub(2), recheckAt)
    const n = Math.max(1, countOps(problem.merged.tokens))
    later(() => setPhase("done"), recheckAt + 400 + T_OP * (n - 1) + 1300)
  }, [problem, reduced, clearTimers, later])

  // ── 各阶段派生状态 ──
  const steps = problem?.steps
  const merged = problem?.merged
  const needParen = problem?.how.check.needParen ?? false

  /** 第二个算式里，被替换的操作数位置（1 = a 位，2 = b 位） */
  const refPos: 1 | 2 | 0 = useMemo(() => {
    if (!steps) return 0
    if (steps[1].a.fromStep === 1) return 1
    if (steps[1].b.fromStep === 1) return 2
    return 0
  }, [steps])

  /** 第一阶段：找 —— 得数高亮 + 第二个算式里目标数字高亮 */
  const showFind = phase === "find"
  /** 第二阶段：换 —— 目标数字淡出 */
  const showSub = phase === "substitute"
  /** 第三阶段：查 —— 判断顺序 + 逐项确认 */
  const showCheck = phase === "check"
  const done = phase === "done"

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

  // 括号飞入时机：「查」的第 1 小步之后
  const parensIn = done || (showCheck && checkSub >= 1)

  const warnOpText = merged && wrongFirstIdx >= 0 ? merged.tokens[wrongFirstIdx].text : ""
  const step0Text = problem ? bareText(problem.steps[0]) : ""

  const hintText = useMemo(() => {
    if (!problem) return ""
    switch (phase) {
      case "find":
        return `两个式子里都有 ${problem.steps[0].result} —— 它就是第一步算出来的得数。`
      case "substitute":
        return `把 ${problem.steps[0].result} 换成整段「${bareText(problem.steps[0])}」。`
      case "check":
        if (checkSub === 0) {
          return needParen
            ? `先别急着加括号 —— 按规矩「从左往右、先乘除后加减」，第一个轮到的会是这个「${warnOpText}」。可原题要先算 ①「${step0Text}」呀，顺序被换掉了！`
            : `按规矩「从左往右、先乘除后加减」，第一个轮到的正是这个「${warnOpText}」—— 原题也是先算它，顺序没变。`
        }
        if (checkSub === 1) {
          return needParen
            ? `顺序既然变了，就必须请出小括号，让 ①「${step0Text}」重新排到前面先算。`
            : `顺序没变 ⇒ 小括号是多余的，直接写下来就好。`
        }
        return needParen
          ? `括号一加，第一个被算的换成了 ①「${step0Text}」—— 顺序对上了，答案才一致。`
          : `顺序没变，答案也已经一致了。`
      case "done":
        return `合并成功：${tokensToText(problem.merged.tokens)} = ${problem.answer}`
      default:
        return "点「播放动画」，看两个算式怎样合成一个。"
    }
  }, [problem, phase, checkSub, needParen, warnOpText, step0Text])

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
          <div className="ce-stage">
            <StepCard
              index={1}
              a={problem.steps[0].a.text}
              op={problem.steps[0].op}
              b={problem.steps[0].b.text}
              result={problem.steps[0].result}
              litResult={showFind || showSub}
            />
            <StepCard
              index={2}
              a={problem.steps[1].a.text}
              op={problem.steps[1].op}
              b={problem.steps[1].b.text}
              result={problem.steps[1].result}
              litOperand={showFind || showSub ? refPos : 0}
              fading={showSub ? refPos : 0}
            />

            {/* 连线：得数 → 第二个算式里的目标数字 */}
            {(showFind || showSub) && (
              <div className="ce-link" aria-hidden>
                <span className="ce-link-dot" />
                <span className="ce-link-line" />
                <span className="ce-link-dot" />
              </div>
            )}
          </div>

          {/* ── 阶段提示 ── */}
          <p className={`ce-hint ce-hint-${phase}${showCheck && checkSub === 0 && needParen ? " ce-hint-warn" : ""}`}>
            {hintText}
          </p>

          {/* ── 合并结果区 ── */}
          {(showCheck || done) && (
            <div className="ce-result-box">
              <p className="ce-result-label">综合算式</p>
              <MergedExpr
                tokens={problem.merged.tokens}
                litIndex={litToken}
                litKind={litKind}
                parensIn={parensIn}
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
