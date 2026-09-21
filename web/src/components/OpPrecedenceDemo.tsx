/** 「先算谁？」运算优先级小动画 —— 页内**可展开**的一小块（自包含，不参与主时间轴）
 *
 * 讲两条规矩：
 *   ① 不同级 —— 先乘除、后加减（跟在左边还是右边**无关**）
 *   ② 同级   —— 从左往右，先碰到谁先算
 *
 * 每一轮化简都走同一套四拍：判级 → 选中 → 趁手 → 并成一个数
 *   · 「不同级」：乘除**抬起一格**、加减**下沉一格** —— 让「级别高低」看得见。
 *      加号明明在最左边却轮不到它，这一帧就是全篇的重点。
 *   · 「同级」：一条扫描条**从左往右**掠过，扫到谁谁先算 —— 位置才是唯一依据。
 *
 * ⚠️ 版面用**定宽槽位**（数字 38px · 运算符 30px · 间隔 7px）：
 *    宽度可预知 ⇒ 「三块并成一个数」只用 CSS 过渡，不必量尺寸，中途也不会跳版。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isMd, planSteps, PR_DEMO_CASES, type PToken, type PStep } from "../lib/precedence"

/** 每个化简轮的节拍（ms）—— 合并起来就是整段动画的时长 */
const T_INTRO = 420 // 算式亮相
const T_JUDGE = 780 // 判级：级别高低 / 从左往右扫描
const T_PICK = 460 // 选中：高亮 + 其余让位
const T_JOIN = 540 // 并成一个数（三块收缩 + 结果块长出）
const T_COMMIT = 80 // 交接给新算式
const T_OUTRO = 860 // 收尾（亮出答案与常见错法）

type Phase = "idle" | "intro" | "judge" | "pick" | "join" | "settle" | "done"

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

/** 版面里的一个槽位 */
interface Slot {
  key: string
  kind: "num" | "op" | "paren"
  text: string
  /** 在 tokens 里的原始下标（结果块为 -1） */
  src: number
  computed?: boolean
  /** 正在被「吃」掉（宽度收缩到 0） */
  eaten?: boolean
  /** 结果块 */
  res?: boolean
  /** 结果块已完成长出 */
  grown?: boolean
}

function slotOf(t: PToken, src: number, key: string): Slot {
  return {
    key,
    kind: t.type,
    text: t.text,
    src,
    computed: t.computed,
  }
}

export function OpPrecedenceDemo() {
  const reduced = useReducedMotion()
  const [caseKey, setCaseKey] = useState(PR_DEMO_CASES[0].key)
  const [phase, setPhase] = useState<Phase>("idle")
  /** 当前是第几轮化简 */
  const [cursor, setCursor] = useState(0)
  /** 当前显示的算式 token */
  const [tokens, setTokens] = useState<PToken[]>(PR_DEMO_CASES[0].tokens)
  /** 「并」这一步是否已经开动（用于触发 CSS 过渡，见下方 effect） */
  const [joined, setJoined] = useState(false)
  const timerRef = useRef<number[]>([])
  const rowRef = useRef<HTMLDivElement>(null)
  const sweeperRef = useRef<HTMLSpanElement>(null)

  const demo = useMemo(
    () => PR_DEMO_CASES.find((c) => c.key === caseKey) ?? PR_DEMO_CASES[0],
    [caseKey],
  )
  const trace = useMemo(() => planSteps(demo.tokens), [demo])

  const clearTimers = useCallback(() => {
    for (const t of timerRef.current) window.clearTimeout(t)
    timerRef.current = []
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timerRef.current.push(id)
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const playing = phase !== "idle" && phase !== "done"

  /** 换一组示例：立刻回到静置态 */
  const pickCase = useCallback(
    (key: string) => {
      if (key === caseKey) return
      clearTimers()
      const next = PR_DEMO_CASES.find((c) => c.key === key) ?? PR_DEMO_CASES[0]
      setCaseKey(key)
      setTokens(next.tokens)
      setCursor(0)
      setJoined(false)
      setPhase("idle")
    },
    [caseKey, clearTimers],
  )

  /** 播放：整条时间轴一次性排好（与主页面同一套写法） */
  const play = useCallback(() => {
    clearTimers()
    const steps = planSteps(demo.tokens)
    if (steps.length === 0) return
    if (reduced) {
      setTokens(steps[steps.length - 1].after)
      setCursor(steps.length)
      setPhase("done")
      return
    }
    setTokens(demo.tokens)
    setCursor(0)
    setJoined(false)
    setPhase("intro")

    let at = T_INTRO
    steps.forEach((s, i) => {
      later(() => {
        setCursor(i)
        setPhase("judge")
      }, at)
      later(() => setPhase("pick"), at + T_JUDGE)
      later(() => setPhase("join"), at + T_JUDGE + T_PICK)
      // 交接：算式换成化简后的样子（尺寸与「并」的结果完全一致 ⇒ 看不出替换）
      later(() => {
        setTokens(s.after)
        setPhase("settle")
      }, at + T_JUDGE + T_PICK + T_JOIN)
      at += T_JUDGE + T_PICK + T_JOIN + T_COMMIT
    })
    later(() => {
      setCursor(steps.length)
      setPhase("done")
    }, at + T_OUTRO)
  }, [clearTimers, demo, later, reduced])

  // ── 「并」的开动时机：先渲染一帧「结果块宽 0 + 三块未收缩」，再打开过渡 ──
  useEffect(() => {
    if (phase !== "join") return
    let raf = 0
    const outer = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setJoined(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(raf)
    }
  }, [phase])

  const step: PStep | null =
    phase === "judge" || phase === "pick" ? (trace[cursor] ?? null) : null
  const joining: PStep | null = phase === "join" ? (trace[cursor] ?? null) : null

  /** 「同级」这一支：扫描条从左往右掠过（目标 = 本轮要算的那个运算符）
   *  ⚠️ 只剩一个运算符时不扫 —— 没有可比的对象，「从左往右数」也就无从谈起 */
  const sweeping = phase === "judge" && step?.why === "same-level" && step.siblings.length > 0

  useEffect(() => {
    const row = rowRef.current
    const sw = sweeperRef.current
    if (!row || !sw || !sweeping || !step || reduced) return
    const target = row.querySelector<HTMLElement>(`[data-pr-src="${step.index}"]`)
    if (!target) return
    const r0 = row.getBoundingClientRect()
    const r1 = target.getBoundingClientRect()
    // 扫描条的几何：18px 宽，中心在 9px 处（CSS 里三角形也按这个中心对齐）
    const from = -10
    const to = r1.left + r1.width / 2 - r0.left - 9
    const anim = sw.animate(
      [
        { transform: `translateX(${from}px)`, opacity: 0, offset: 0 },
        { transform: `translateX(${from}px)`, opacity: 1, offset: 0.12 },
        { transform: `translateX(${to}px)`, opacity: 1, offset: 0.86 },
        { transform: `translateX(${to}px)`, opacity: 0, offset: 1 },
      ],
      { duration: Math.round(T_JUDGE * 0.72), easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
    )
    return () => anim.cancel()
  }, [sweeping, step, reduced, cursor])

  // ── 槽位表：静置 = 原样；「并」= 三块 + 一个结果块 ──
  const pickedIdx = step?.index ?? joining?.index ?? -1
  const lvOn = phase === "judge" && step?.why === "higher"

  const slots = useMemo<Slot[]>(() => {
    if (!joining) return tokens.map((t, i) => slotOf(t, i, `t${i}`))
    const i = joining.index
    const out: Slot[] = []
    tokens.slice(0, i - 1).forEach((t, k) => out.push(slotOf(t, k, `a${k}`)))
    tokens.slice(i - 1, i + 2).forEach((t, k) => out.push({ ...slotOf(t, i - 1 + k, `e${k}`), eaten: joined }))
    out.push({
      key: "res",
      kind: "num",
      text: String(joining.value),
      src: -1,
      computed: true,
      res: true,
      grown: joined,
    })
    tokens.slice(i + 2).forEach((t, k) => out.push(slotOf(t, i + 2 + k, `b${k}`)))
    return out
  }, [tokens, joining, joined])

  const hint = useMemo(() => {
    switch (phase) {
      case "idle":
        return "点「演一遍」，看看这两个运算符到底谁先算。"
      case "intro":
        return "算式摆好了 —— 先别急着从左往右，得先比一比谁有资格先算。"
      case "judge":
      case "pick": {
        if (!step) return ""
        if (step.why === "higher") {
          return `看高度：乘除「${step.op}」站得高一级，加减「${step.siblings.join("、")}」在下面。高一级的先算 —— 哪怕「${step.siblings.join("、")}」写在最左边，也得等一等。`
        }
        if (step.why === "same-level") {
          if (step.siblings.length === 0) return `现在只剩一个运算符「${step.op}」了，直接算它。`
          return `「${step.op}」和「${step.siblings.join("、")}」是同一个级别，谁也不能插队 —— 那就从左往右数，先碰到谁先算。`
        }
        return step.siblings.length === 0
          ? `括号里先算。括号里还是那句老规矩：先乘除、后加减。`
          : `括号里先算 —— 而且括号里的规矩不变：先乘除「${step.op}」、后加减「${step.siblings.join("、")}」。`
      }
      case "join":
        return joining
          ? `第 ${cursor + 1} 步：先算 ${joining.left} ${joining.op} ${joining.right} = ${joining.value} —— 这三个块并成一个数，算式就短一段。`
          : ""
      case "settle":
        return `化简一步之后：${tokens.map((t) => t.text).join(" ")}`
      default:
        return `一路算下来：${trace
          .map((s) => `${s.left} ${s.op} ${s.right} = ${s.value}`)
          .join("，然后 ")}。`
    }
  }, [phase, step, joining, cursor, tokens, trace])

  return (
    <div className="card ce-prec">
      <p className="pr-head">🔢 先算谁？—— 加减乘除的优先级</p>

      <div className="pr-chips">
        {PR_DEMO_CASES.map((c) => (
          <button
            key={c.key}
            className={`pr-chip${c.key === caseKey ? " on" : ""}`}
            onClick={() => pickCase(c.key)}
            disabled={playing}
          >
            {c.chip}
          </button>
        ))}
      </div>

      <p className="pr-label">{demo.label}</p>

      <div className="pr-expr" ref={rowRef}>
        {slots.map((s) => {
          const slotCls = ["pr-slot"]
          if (s.kind === "num") slotCls.push("pr-slot-num")
          else if (s.kind === "op") slotCls.push("pr-slot-op")
          else slotCls.push("pr-slot-paren")
          if (s.eaten) slotCls.push("pr-eaten")
          if (s.res) {
            slotCls.push("pr-slot-num", "pr-res")
            if (s.grown) slotCls.push("pr-grow")
          }
          const tokCls = ["pr-tok"]
          if (s.kind === "num") tokCls.push("pr-num")
          else if (s.kind === "op") tokCls.push("pr-op", isMd(s.text) ? "pr-md" : "pr-as")
          else tokCls.push("pr-paren")
          if (s.computed && s.kind === "num") tokCls.push("pr-done")
          if (s.kind === "op" && s.src === pickedIdx && (phase === "pick" || phase === "join")) {
            tokCls.push("pr-pick")
          }
          if (s.kind === "op" && lvOn) tokCls.push(isMd(s.text) ? "pr-lv2" : "pr-lv1")
          if (s.kind === "op" && s.src !== pickedIdx && phase === "pick") tokCls.push("pr-wait")
          return (
            <span key={s.key} className={slotCls.join(" ")} data-pr-src={s.kind === "op" ? s.src : undefined}>
              <span className={tokCls.join(" ")}>{s.text}</span>
            </span>
          )
        })}
        {sweeping && <span className="pr-sweeper" ref={sweeperRef} aria-hidden />}
      </div>

      <p className={`pr-hint${phase === "done" ? " pr-hint-done" : ""}`}>{hint}</p>

      {phase === "done" && (
        <>
          <p className="pr-answer">
            = <b>{demo.answer}</b>
            <span className="pr-ok">按这个顺序算才对</span>
          </p>
          <p className="pr-wrong">
            ❌ 常见错法：<b>{demo.wrong}</b> —— {demo.wrongWhy}
          </p>
        </>
      )}

      <div className="pr-actions">
        <button className="pr-btn" onClick={play} disabled={playing}>
          {phase === "idle" ? "▶ 演一遍" : phase === "done" ? "↻ 再看一遍" : "播放中…"}
        </button>
      </div>

      <p className="pr-note">
        三条规矩：有小括号先算括号里 · 没有括号先乘除、后加减 · 同级从左往右，一个一个来。
        <br />
        算式里<span className="pr-legend">绿底</span>的数，就是前面已经算出来的。
      </p>
    </div>
  )
}
