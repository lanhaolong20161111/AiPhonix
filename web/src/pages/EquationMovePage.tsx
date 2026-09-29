/** 三年级数学 · 等式变变变 —— 「移项变号」动画
 *
 * 教学核心：**把一个数从等号一侧挪到另一侧，它的符号必须变相反**
 *     + ↔ -        × ↔ ÷
 *   而在等号**同一侧**交换左右位置，符号一点不用调。
 *
 * 动画设计（分步播放，每步一个明确的视觉动作）—— 四种动作各有一套演法：
 *   move（搬）    ① 找 —— 要搬走的那一项脉动高亮，并点明「它跨过等号，符号要变」
 *                 ② 飞 —— ★ 整块起飞越过等号线；**跨线那一瞬间符号翻牌**，
 *                        同时等号线闪一下 ⇒ 把「这条线就是分界」演出来
 *                 ③ 落 —— 停在等号另一侧的末尾原位；源侧原位置**只变灰划掉、不删除**
 *   swap（换位）  ★ 「首项没写符号」的招牌演示：**5 + x ⇒ x + 5**
 *                 只在**同一侧**滑动换位（FLIP：两项上下错开擦身而过），
 *                 **一个字节都不跨过等号线** ⇒ 符号自然一点不动，换完「+」才露出来
 *   combine（合并）3x 和 -2x 合成 x —— 同侧合并，没有搬运，也没有变号
 *   flip（对调）  b = x + a ⇒ x + a = b —— 等式两边整体对调
 *
 * ★ 布局零重排是落位精度（也是本页好看）的前提：
 *   move 的目标侧**从动画一开始就预留落位槽**（隐形占位），源侧搬走后只变灰不删 ⇒
 *   飞越期间两侧宽度完全不变，幽灵落点像素级准确。
 *   ⚠️ 但 swap / combine / flip **不能用这套**（它们会真的改变某一侧的项数或顺序）——
 *      那三种走「先量旧位 → 换 state → 倒推回旧位 → 动画滑到新位」的 FLIP 路子。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import {
  generateProblem,
  flipOp,
  sideToText,
  solutionText,
  RULES,
  MISTAKE_CASES,
  PRACTICE,
  generatePracticeItems,
  KIND_GROUPS,
  KIND_LABEL,
  KIND_TIP,
  type EqState,
  type MoveAction,
  type MoveKind,
  type MoveProblem,
  type Op,
  type PracticeAnswer,
  type PracticeItem,
  type Side,
} from "../lib/equationMove"

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

/** 运算符配色（全站一致）：乘除 = 蓝 · 加减 = 橙 */
function opCls(op: Op): string {
  return op === "×" || op === "÷" ? "eq-op eq-op-md" : "eq-op eq-op-as"
}

/** 选项：四个「变号」+ 一个「不变」—— 后者是「同侧换位」反例题的正确答案 */
const OPS: PracticeAnswer[] = ["+", "-", "×", "÷", "same"]

/** 选项上显示的文字（"same" ⇒ 「不变」，且后面不跟 x / 8） */
const OP_TEXT: Record<PracticeAnswer, string> = { "+": "+", "-": "-", "×": "×", "÷": "÷", same: "不变" }

/** 是不是「搬运」动作（要跨过等号线、要翻符号）。
 *  swap / combine / flip 只在**同一侧**重排 —— 既没有落位槽，也得走 FLIP 那条渲染路子。
 *  ⚠️ **不要**写成类型谓词 `a is MoveAction`：`MoveAction` 是「所有动作」的类型，
 *     它的 `type` 是联合字段 ⇒ `!isMove(x)` 会把 x 收窄成 `never`，读 `x.from` 直接报 TS2339。
 *     需要排除 undefined 时，另写 `!act` 这样的显式守卫。 */
const isMove = (a?: MoveAction) => a?.type === "move"

/** 动画时间轴（ms） */
const T_FIND = 2000 // ① 找
const T_FLY = 1250 // ② 飞（含跨线翻牌）
const T_LAND = 1500 // ③ 落（停住看清）
const T_SOLVE = 1500 // ④ 算 + 验算
const T_SLIDE = 1400 // 同侧换位：滑动
const T_MERGE = 1300 // 同侧合并 / 两边对调：看清「组成变了，值没变」

type Phase = "idle" | "find" | "fly" | "land" | "slide" | "solve" | "done"

/** 飞行中的幽灵（视口坐标，position:fixed，不参与布局） */
interface Ghost {
  /** 起点中心（视口坐标） */
  cx: number
  cy: number
  /** 终点中心 */
  tx: number
  ty: number
  /** 跨过等号线的进度比例（0~1）—— 符号就在这一刻翻牌 */
  cross: number
  srcOp: Op | null
  fromOp: Op
  toOp: Op
  value: string
}

/** 等号那条「分界线」：竖线从等号上方、下方各延伸一段，等号自己是门 */
interface Border {
  x: number
  topH: number
  botTop: number
  botH: number
}

/** 题型清单**从引擎的 KIND_GROUPS 来**（13 种，分四组）—— 别再在这里手写一份，
 *  上一版就是因为页面里硬编码了 7 种，引擎加了新题型页面却一个都不显示。 */

// ────────────────────────────────────────────────────────────
// 主页面
// ────────────────────────────────────────────────────────────

export function EquationMovePage() {
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const [kind, setKind] = useState<MoveKind>("plus")
  const [problem, setProblem] = useState<MoveProblem | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  /** 当前是第几步搬运（0-based） */
  const [stepIndex, setStepIndex] = useState(0)
  /** 当前这一步是否已经落位 */
  const [stepDone, setStepDone] = useState(false)
  /** 幽灵的符号是否已经翻牌（跨线那一下） */
  const [symFlipped, setSymFlipped] = useState(false)
  /** 递增计数：每次跨线 +1，用 key 强制重播等号线的闪光 */
  const [borderHit, setBorderHit] = useState(0)
  /** 同侧交换：是否已换序 */
  const [swapped, setSwapped] = useState(false)
  const [solved, setSolved] = useState(false)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [border, setBorder] = useState<Border | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [showMistakes, setShowMistakes] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number[]>([])
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map())
  /** FLIP 这一拍要重排的是**哪一侧** —— swap/combine 可能发生在等号右边，不能写死 .eq-side-left */
  const slideSideRef = useRef<"left" | "right">("left")
  /** 随机练习：当前这一组的 6 道题 */
  const [drill, setDrill] = useState<PracticeItem[]>(() => generatePracticeItems(6))
  /** 换一组时 +1，用作 key 让每道题重新挂载（清掉上一组的作答状态） */
  const [drillRound, setDrillRound] = useState(0)
  /** 随机练习作答统计（每题只在首次点选时计一次） */
  const [drillStat, setDrillStat] = useState({ answered: 0, correct: 0 })

  /** 换一组：重新随机 6 道（四条基本变号规律各一道 + 一道两步型 + 一道同侧不变号反例） */
  const reshuffleDrill = useCallback(() => {
    setDrill(generatePracticeItems(6))
    setDrillRound((r) => r + 1)
    setDrillStat({ answered: 0, correct: 0 })
  }, [])

  const gradeDrill = useCallback((ok: boolean) => {
    setDrillStat((s) => ({ answered: s.answered + 1, correct: s.correct + (ok ? 1 : 0) }))
  }, [])

  const clearTimers = useCallback(() => {
    for (const t of timerRef.current) window.clearTimeout(t)
    timerRef.current = []
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timerRef.current.push(id)
  }, [])

  const resetPlayState = useCallback(() => {
    setPhase("idle")
    setStepIndex(0)
    setStepDone(false)
    setSymFlipped(false)
    setSwapped(false)
    setSolved(false)
    setGhost(null)
  }, [])

  /**
   * 换一道题。`k` 省略时随机抽题型。
   * 🔴 **别把 `kind` 放进依赖数组** —— 那样 `setKind()` 会重建这个回调，
   *    进而触发下面的初始化 effect 又跑一遍 `newProblem("plus")`，把刚点出来的题型覆盖掉。
   */
  const newProblem = useCallback(
    (k?: MoveKind) => {
      clearTimers()
      resetPlayState()
      setProblem(generateProblem(k))
    },
    [clearTimers, resetPlayState],
  )

  useEffect(() => {
    newProblem("plus")
    return () => clearTimers()
  }, [newProblem, clearTimers])

  // ── 当前步骤 / 当前舞台形态 ──
  const curAction = problem ? problem.actions[stepIndex] : undefined

  /** 舞台上此刻渲染的两侧。
   *  · move —— **只换涂装、不改 state**（停在 before 上，目标侧由隐形落位槽占位）⇒ 飞越期间布局零重排
   *  · swap / combine / flip —— 会真的改变某一侧的顺序或项数 ⇒ 到点切到 after，再靠 FLIP 补差值动画
   *  · 反例（sameSide）—— 没有「第几步」的概念，直接 initial ⇄ final */
  const view = useMemo<EqState | null>(() => {
    if (!problem) return null
    if (problem.isSameSide) return swapped ? problem.final : problem.initial
    const act = problem.actions[stepIndex]
    if (!act) return problem.final // 只有「系统关闭动画」那条路会把 stepIndex 直接推到末尾
    if (isMove(act)) return act.before
    return swapped ? act.after : act.before
  }, [problem, stepIndex, swapped])

  // ── 测量 ──
  const measure = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const src = stage.querySelector<HTMLElement>('[data-eq="src"]')
    const slot = stage.querySelector<HTMLElement>('[data-eq="slot"]')
    const eq = stage.querySelector<HTMLElement>('[data-eq="eq"]')
    if (!src || !slot || !eq) return null
    const s = src.getBoundingClientRect()
    const d = slot.getBoundingClientRect()
    const q = eq.getBoundingClientRect()
    if (s.width === 0 || d.width === 0) return null
    return {
      cx: s.left + s.width / 2,
      cy: s.top + s.height / 2,
      tx: d.left + d.width / 2,
      ty: d.top + d.height / 2,
      eqX: q.left + q.width / 2,
      stage: stage.getBoundingClientRect(),
      eq,
    }
  }, [])

  // ── 等号分界线：位置随布局变化重算 ──
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () => {
      const eq = stage.querySelector<HTMLElement>('[data-eq="eq"]')
      if (!eq) {
        setBorder(null)
        return
      }
      const s = stage.getBoundingClientRect()
      const q = eq.getBoundingClientRect()
      setBorder({
        x: q.left + q.width / 2 - s.left,
        topH: Math.max(0, q.top - s.top - 5),
        botTop: q.bottom - s.top + 5,
        botH: Math.max(0, s.bottom - q.bottom - 5),
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(stage)
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [problem, stepIndex, swapped])

  // ── ② 飞：起飞。造一块幽灵停在源项位置，稍后由 WAAPI 飞向落位槽 ──
  //    ⚠️ 只有 move 才「飞」。swap / combine / flip 不跨等号线，绝不能落进这里 ——
  //       否则会把它画成「整块飞过等号」，正好把「同侧换位不变号」教成反的。
  useEffect(() => {
    // act 单独取一次：`!act` 负责挡 undefined，`isMove(act)` 只管「是不是搬运」——
    // 两者合起来下面就能直接读 act.srcOp | fromOp | toOp | value，不用满地感叹号。
    const act = curAction
    if (reduced || phase !== "fly" || !problem || !act || !isMove(act)) return
    const m = measure()
    if (!m) return
    const span = m.tx - m.cx
    // 幽灵中心到达等号线时的进度比例（dx 为 0 时按一半算）
    let cross = Math.abs(span) < 1 ? 0.5 : (m.eqX - m.cx) / span
    cross = Math.max(0.3, Math.min(0.8, cross))
    setGhost({
      cx: m.cx,
      cy: m.cy,
      tx: m.tx,
      ty: m.ty,
      cross,
      srcOp: act.srcOp,
      fromOp: act.fromOp,
      toOp: act.toOp,
      value: act.value,
    })
    // ★ 跨线那一刻：符号翻牌 + 等号线闪一下
    later(() => {
      setSymFlipped(true)
      setBorderHit((n) => n + 1)
    }, T_FLY * cross)
  }, [phase, problem, curAction, reduced, measure, later])

  // 幽灵的飞行动画：蓄力 → 抬起 → 加速越过等号线 → 落位
  useEffect(() => {
    const el = ghostRef.current
    if (!el || !ghost || reduced) return
    const { cx, cy, tx, ty, cross } = ghost
    const gx = tx - cx
    const gy = ty - cy
    /**
     * 🔴 keyframe 里的位移必须是**相对起点**的。
     * 幽灵的 left/top 已经内联在起点上了（为了躲开「WAAPI 挂上前那一帧」闪到 0,0），
     * 这里若再写绝对视口坐标就会**叠加成两倍偏移** —— 实测落点直接飞出视口（偏 154,348px）。
     * 第 0 帧写成 translate(0,0) 正好与内联形态逐字一致 ⇒ 接管无跳变。
     */
    const t = (rx: number, ry: number, s: number) => `translate(${rx}px, ${ry}px) translate(-50%, -50%) scale(${s})`
    // ⚠️ offset 必须严格递增，否则 WAAPI 抛错并把整页带走
    const keys = [
      { transform: t(0, 0, 0.86), opacity: 0, offset: 0 },
      { transform: t(-6, -13, 1), opacity: 1, offset: 0.16, easing: "cubic-bezier(.34,1.56,.64,1)" },
      { transform: t(gx * cross, gy * cross - 32, 1.16), opacity: 1, offset: cross },
      { transform: t(gx, gy, 1), opacity: 1, offset: 1 },
    ]
    const safe = [...keys].sort((a, b) => a.offset - b.offset)
    const anim = el.animate(safe, { duration: T_FLY, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" })
    return () => anim.cancel()
  }, [ghost, reduced])

  // ── 同侧重排：FLIP（先量旧位 → 换 state → 倒推回旧位 → 动画滑到新位）──
  //    三个入口共用：反例（sameSide）· 首项换位显形（swap）· 两边对调（flip）
  useEffect(() => {
    if (reduced || phase !== "slide") return
    const stage = stageRef.current
    if (!stage) return
    const side: "left" | "right" = problem?.isSameSide
      ? "left"
      : curAction && !isMove(curAction)
        ? curAction.from
        : "left"
    slideSideRef.current = side
    const m = new Map<string, DOMRect>()
    stage.querySelectorAll<HTMLElement>(`.eq-side-${side} [data-eq="val"]`).forEach((el) => {
      m.set(el.textContent ?? "", el.getBoundingClientRect())
    })
    prevRectsRef.current = m
    setSwapped(true)
  }, [phase, problem, reduced, curAction])

  useLayoutEffect(() => {
    if (!swapped) return
    const stage = stageRef.current
    if (!stage) return
    stage.querySelectorAll<HTMLElement>(`.eq-side-${slideSideRef.current} [data-eq="val"]`).forEach((el) => {
      const prev = prevRectsRef.current.get(el.textContent ?? "")
      if (!prev) return // 找不到同名的旧位（比如 combine 后文本变了）⇒ 这一项不做位移，安静收场
      const now = el.getBoundingClientRect()
      const dx = prev.left - now.left
      if (Math.abs(dx) < 0.5) return // 位置没动（比如中间那个「+」）就别动它
      // ★ 上下错开：向右走的抬上去、向左走的沉下来。
      //   否则两项会在半路正面叠在一起（实测叠成一个「x5」，谁也看不清）
      const lift = dx > 0 ? -16 : 16
      el.style.zIndex = dx > 0 ? "3" : "2"
      el.animate(
        [
          { transform: `translate(${dx}px, 0px)` }, // 起点＝换序前的真实位置
          { transform: `translate(${dx * 0.5}px, ${lift}px)`, offset: 0.5 }, // 半路错开，擦身而过
          { transform: "translate(0px, 0px)" }, // 终点＝换序后的真实位置
        ],
        { duration: T_SLIDE, easing: "cubic-bezier(.34,1.16,.64,1)" },
      )
    })
  }, [swapped])

  // ── 播放 ──
  const play = useCallback(() => {
    if (!problem) return
    clearTimers()
    resetPlayState()
    prevRectsRef.current = new Map()

    if (reduced) {
      setStepIndex(problem.actions.length)
      setStepDone(true)
      setSwapped(true)
      setSolved(true)
      setPhase("done")
      return
    }

    // 同侧交换：只有「找」和「滑」两拍
    if (problem.isSameSide) {
      setPhase("find")
      later(() => setPhase("slide"), T_FIND)
      later(() => {
        setPhase("done")
        setSolved(true)
      }, T_FIND + T_SLIDE)
      return
    }

    let t = 0
    problem.actions.forEach((a, k) => {
      later(() => {
        setStepIndex(k)
        setStepDone(false)
        setSymFlipped(false)
        setSwapped(false)
        setGhost(null)
        setPhase("find")
      }, t)
      t += T_FIND
      if (isMove(a)) {
        later(() => setPhase("fly"), t)
        t += T_FLY
        later(() => {
          // 落位：幽灵退场，目标侧槽位显形（同一刻，位置重合）
          setStepDone(true)
          setSymFlipped(false)
          setGhost(null)
          setPhase("land")
        }, t)
        t += T_LAND
      } else {
        // ★ swap / combine / flip：**不飞、不跨等号线**，只在同一侧滑动重排。
        //   phase 一到 "slide"，下面的 FLIP effect 就接管位移（先量旧位再切 state）。
        later(() => setPhase("slide"), t)
        t += T_SLIDE
        later(() => {
          setStepDone(true)
          setGhost(null)
          setPhase("land")
        }, t)
        t += T_MERGE
      }
    })
    later(() => setPhase("solve"), t)
    later(() => {
      setPhase("done")
      setSolved(true)
    }, t + T_SOLVE)
  }, [problem, reduced, clearTimers, resetPlayState, later])

  // ── 渲染一侧（move：源侧被搬项变灰 + 目标侧预渲染隐形落位槽）──
  const renderSide = (side: Side, key: "left" | "right"): ReactNode[] => {
    const isSrc = !!curAction && curAction.from === key
    const move = isMove(curAction)
    const nodes: ReactNode[] = side.map((t, i) => {
      // move：只动 index 那 1 项 · swap/combine：index 与 index2 两项都参与
      const taking = move && isSrc && i === curAction!.index
      const involved =
        isSrc && (i === curAction!.index || (curAction!.index2 !== undefined && i === curAction!.index2))
      // 合并完成后，活下来的那一项亮一下 —— 它就是「两三块合起来的结果」
      const merged = curAction?.type === "combine" && swapped && isSrc && i === curAction.index
      const cls = ["eq-tok"]
      if (taking) {
        cls.push("eq-src")
        if (stepDone) cls.push("eq-taken")
        else if (phase === "find") cls.push("eq-lit")
      } else if (involved && (phase === "find" || phase === "slide")) {
        // 换位的另一项也要一起亮起来 —— 只亮一半会让学生以为只有它在动
        cls.push("eq-lit")
      }
      if (merged) cls.push("eq-merged")
      return (
        <span key={i} className={cls.join(" ")} data-eq={taking && !stepDone ? "src" : undefined}>
          {t.op && <span className={opCls(t.op)}>{t.op}</span>}
          <span className={`eq-val${t.isVar ? " eq-var" : ""}`} data-eq="val">
            {t.value}
          </span>
        </span>
      )
    })
    // ★ 落位槽只有 move 才该有。swap / combine / flip 根本不跨线 ——
    //   给它们凭空加一个槽，动画就会把「同侧换位」画成「整块飞过等号」，教学上正好相反。
    if (move && curAction && !isSrc) {
      nodes.push(
        <span
          key="slot"
          className={`eq-tok eq-slot${stepDone ? " eq-slot-on" : ""}`}
          data-eq="slot"
          aria-hidden={!stepDone}
        >
          <span className={opCls(curAction.toOp)}>{curAction.toOp}</span>
          <span className="eq-val">{curAction.value}</span>
        </span>,
      )
    }
    return nodes
  }

  // ── 提示语（描述**当下这一拍**在干什么）──
  const hintText = useMemo(() => {
    if (!problem) return ""
    if (problem.isSameSide) {
      const a = problem.initial.left[0].value
      const b = sideToText(problem.initial.right)
      switch (phase) {
        case "find":
          return `要挪走的是 ${a} —— 它现在待在 x 的前面。`
        case "slide":
          // ⚠️ 这里是纯文本渲染，别写 markdown 的 ** —— 星号会原样显示出来
          return `看：${a} 从 x 的前面挪到了后面。它可没跨过那条竖线 —— 所以「+」还是「+」，一点没变。这就是「同一边随便换，符号不用调」。`
        case "done":
          return `换好了：${sideToText(problem.final.left)} = ${b}　符号一个都没动 ✓`
        default:
          return "点「播放动画」，看把数挪到 x 后面时，符号会不会变。"
      }
    }
    const act = problem.actions[stepIndex]
    if (!act) {
      return phase === "done" ? `解出来啦：${solutionText(problem)}` : "点「播放动画」。"
    }
    const sideName = (s: "left" | "right") => (s === "left" ? "左边" : "右边")

    // ★ 非 move 动作的兜底文案：只有 **idle**（还没开始）才该说「去点播放」；
    //   solve 阶段是「算 + 验算」，正在播放中却提示「点播放动画」会自相矛盾 —— 按 phase 分开写。
    const tailText =
      phase === "done"
        ? `解出来啦：${solutionText(problem)}`
        : phase === "idle"
          ? "点「播放动画」。"
          : "这一拍完成了，看看等号两边多了什么、少了什么。"

    // ★ swap / combine / flip 的提示语跟 move 完全不是一回事 —— 它们都不跨等号线，
    //   绝不能复用「飞过去、符号翻转」那套话术，否则等于在教反的。
    if (act.type === "swap") {
      const where = sideName(act.from)
      switch (phase) {
        case "find":
          return `第 ${stepIndex + 1} 步：${where}最前面那一项，前面什么都没写 —— 它其实带着一个看不见的「${act.fromOp}」。先把它和后面那项换个位置。`
        case "slide":
          return `看：两项在${where}内部擦身而过，谁都没碰那条竖线 ⇒ 符号「${act.fromOp}」一点没动。现在它写在后面，符号露出来了！`
        case "land":
          return `换好了。接着再让它跨过等号 —— 到那时「${act.fromOp}」才要变成「${flipOp(act.fromOp)}」。`
        default:
          return phase === "done"
            ? `解出来啦：${solutionText(problem)}`
            : `同一边换位置，符号不用调 —— 记住这一拍，再看它跨线时才变号。`
      }
    }

    if (act.type === "combine") {
      switch (phase) {
        case "find":
          return `第 ${stepIndex + 1} 步：这一侧有两个同类项，「${act.value}」要和紧挨着的那一项合起来。`
        case "slide":
          return `看：同类项合起来，数量相加减，写法变短了。通通在等号同一侧完成 ⇒ 跟「变号」一点关系都没有。`
        case "land":
          return `合完了。这一侧的值一分没变，只是从两小块写成了一小块。`
        default:
          return tailText
      }
    }

    if (act.type === "flip") {
      switch (phase) {
        case "find":
          return `第 ${stepIndex + 1} 步：x 落在等号右边了 —— 先把等号两边整体对调一下。`
        case "slide":
          return `看：左右一换，等式照样成立 —— 等号两边本来就一样多，谁在左边谁在右边都行。`
        case "land":
          return `对调完成，x 回到了左边。接着照常搬 —— 还是那条规矩：跨过等号才变号。`
        default:
          return tailText
      }
    }

    const from = act.srcOp === null ? act.value : `${act.srcOp}${act.value}`
    switch (phase) {
      case "find":
        return (
          `第 ${stepIndex + 1} 步：要搬走的是「${from}」这一整块。` +
          (act.srcOp === null
            ? `它写在最前面、没带符号，其实等效于「${act.fromOp}${act.value}」—— 跨过等号就要变成「${act.toOp}」。`
            : `它跨过等号，符号必须变相反。`)
        )
      case "fly":
        return symFlipped
          ? `正好跨过等号线 ——「${act.fromOp}」翻成了「${act.toOp}」！这条竖线就是变号的分界。`
          : `「${from}」正整块飞向等号另一侧……`
      case "land":
        return act.from === "left"
          ? `落位了：右边多出「${act.toOp} ${act.value}」。左边刚才那个位置已经变灰 —— 它是从这儿搬走的。`
          : `落位了：左边多出「${act.toOp} ${act.value}」。右边刚才那个位置已经变灰 —— 它是从这儿搬走的。`
      case "solve":
        return problem.flipSides
          ? `现在 x 单独在等号右边了。等号两边可以互换位置 ⇒ x = ${sideToText(problem.final.right)}。`
          : `x 已经单独留在等号左边了 —— 右边就是答案。`
      case "done":
        return `解出来啦：${solutionText(problem)}　（把答案代回原式，两边一样 ✓）`
      default:
        return "点「播放动画」，看这个数怎样从等号一边跑到另一边。"
    }
  }, [problem, phase, stepIndex, symFlipped])

  const isPlaying = phase !== "idle" && phase !== "done"

  return (
    <div className="page eq-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
        <h1>⚖️ 等式变变变</h1>
      </header>
      <p className="eq-sub">把一个数从等号一边挪到另一边 —— 符号必须变相反</p>

      {/* ── 口诀 / 原理 / 易错 ── */}
      <div className="eq-rules-bar">
        <button className="eq-chip" onClick={() => setShowRules((v) => !v)}>
          {showRules ? "收起口诀" : "📌 一句话规律"}
        </button>
        <button className="eq-chip" onClick={() => setShowWhy((v) => !v)}>
          {showWhy ? "收起原理" : "🔍 为什么能移项？"}
        </button>
        <button className="eq-chip" onClick={() => setShowMistakes((v) => !v)}>
          {showMistakes ? "收起易错" : "⚠️ 易错警示"}
        </button>
      </div>

      {showRules && (
        <div className="card eq-rules">
          {RULES.map((r) => (
            <div key={r.title} className="eq-rule-block">
              <p className="eq-rule-title">{r.title}</p>
              <ul>
                {r.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {showWhy && <WhyMoveDemo />}

      {showMistakes && (
        <div className="eq-mistakes">
          {MISTAKE_CASES.map((m, i) => (
            <MistakeCard key={i} m={m} />
          ))}
        </div>
      )}

      {/* ── 题型选择（13 种，按引擎的 KIND_GROUPS 分四组 —— 别在这里再手写一份清单）── */}
      <div className="eq-kind-groups">
        {KIND_GROUPS.map((g) => (
          <div className="eq-kind-group" key={g.title}>
            <p className="eq-kind-group-title">{g.title}</p>
            <div className="eq-kind-row">
              {g.kinds.map((k) => (
                <button
                  key={k}
                  className={`eq-kind${kind === k ? " eq-kind-on" : ""}`}
                  onClick={() => {
                    setKind(k)
                    newProblem(k)
                  }}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {problem && (
        <>
          <p className="eq-kind-tip">{KIND_TIP[problem.kind]}</p>

          {/* ── 舞台 ── */}
          <div className="eq-stage" ref={stageRef}>
            <div className="eq-side eq-side-left">{renderSide(view!.left, "left")}</div>
            <span className="eq-eq" data-eq="eq">
              =
            </span>
            <div className="eq-side eq-side-right">{renderSide(view!.right, "right")}</div>

            {/* 等号分界线（上、下两段，等号自己是门） */}
            {border && (
              <div className="eq-border" aria-hidden>
                {border.topH > 2 && (
                  <span
                    key={`t${borderHit}`}
                    className={`eq-border-seg${borderHit > 0 ? " eq-border-hit" : ""}`}
                    style={{ left: border.x, top: 0, height: border.topH }}
                  />
                )}
                <span className="eq-border-seg" style={{ left: border.x, top: border.botTop, height: border.botH }} />
                <span className="eq-border-tag" style={{ left: border.x }}>
                  等号 = 分界
                </span>
              </div>
            )}
          </div>

          <p className={`eq-hint eq-hint-${phase}`}>{hintText}</p>

          {/* ── 结果区 ── */}
          {(phase === "solve" || solved) && (
            <div className="eq-result-box">
              <p className="eq-result-label">解出来</p>
              <p className="eq-result-main">
                x = <b>{problem.answer}</b>
              </p>
              <p className="eq-result-eq">
                过程：{sideToText(problem.final.left)} = {sideToText(problem.final.right)}
              </p>
              {solved && (
                <p className="eq-check">
                  代回原式：{sideToText(problem.initial.left, problem.answer)} ={" "}
                  {sideToText(problem.initial.right, problem.answer)}
                  <span className="eq-ok">✓ 两边一样</span>
                </p>
              )}
            </div>
          )}

          {/* ── 控制 ── */}
          <div className="eq-actions">
            <button className="eq-btn eq-btn-primary" onClick={play} disabled={isPlaying}>
              {phase === "idle" ? "▶ 播放动画" : phase === "done" ? "↻ 再看一遍" : "播放中…"}
            </button>
            <button className="eq-btn" onClick={() => newProblem(kind)} disabled={isPlaying}>
              🎲 换一题
            </button>
          </div>

          <p className="eq-hint-sm">💡 {problem.hint}</p>
        </>
      )}

      {/* ── 对比练习 ── */}
      <div className="eq-practice">
        <p className="eq-sec-title">✍️ 一组对比练习：跨过等号，符号该变成什么？</p>
        <p className="eq-sec-sub">
          先自己想一想，再点选答案 —— 选项里那四个是「变号」，最后一个「不变」是专门用来迷惑你的。
        </p>
        {PRACTICE.map((it) => (
          <PracticeCard key={it.before} item={it} />
        ))}
      </div>

      {/* ── 随机练习：6 道，可换一组 ── */}
      <div className="eq-practice eq-drill">
        <div className="eq-drill-head">
          <p className="eq-sec-title">🎯 随机 6 题 · 专练移项变号</p>
          <button type="button" className="eq-btn eq-btn-sm" onClick={reshuffleDrill}>
            🔄 换一组
          </button>
        </div>
        <p className="eq-sec-sub">
          每轮六种情形全练到：加变减 · 减变加 · 乘变除 · 除变乘 · 要搬两次（含首项显形）· 同侧换位不变号。
          先看清它到底跨没跨过等号，再点答案。
        </p>
        <p className="eq-drill-score" aria-live="polite">
          已答 <b>{drillStat.answered}</b> / {drill.length}　·　答对 <b>{drillStat.correct}</b> 道
          {drillStat.answered >= drill.length &&
            (drillStat.correct === drill.length ? (
              <span className="eq-drill-perfect">　🎉 全对！这条规律你已经拿下了</span>
            ) : (
              <span>　再点「换一组」接着练</span>
            ))}
        </p>
        {drill.map((it, i) => (
          <PracticeCard
            key={`${drillRound}-${i}`}
            item={it}
            index={i + 1}
            onGraded={gradeDrill}
          />
        ))}
      </div>

      {/* ── 飞行中的幽灵（视口坐标，不参与布局）── */}
      {ghost && (
        <span
          ref={ghostRef}
          className="eq-ghost"
          /* ⚠️ 必须**内联**起始位置与初始形态：WAAPI 动画挂上之前还有一帧，
             若只写 left:0/top:0，幽灵会在视口左上角闪一下（也会污染轨迹采样） */
          style={{
            left: ghost.cx,
            top: ghost.cy,
            transform: "translate(-50%, -50%) scale(0.86)",
            opacity: 0,
          }}
          aria-hidden
        >
          {symFlipped ? (
            /* ★ 跨线瞬间：旧符号转半圈缩走、新符号从对面转出来 —— 这就是「变号」那一帧 */
            <span className={`eq-flipwrap ${ghost.toOp === "×" || ghost.toOp === "÷" ? "eq-op-md" : "eq-op-as"}`}>
              <span className={`eq-fw-old${ghost.srcOp === null ? " eq-fw-invisible" : ""}`}>
                {ghost.srcOp ?? ghost.fromOp}
              </span>
              <span className="eq-fw-new">{ghost.toOp}</span>
            </span>
          ) : (
            <span className={`${opCls(ghost.srcOp ?? ghost.fromOp)}${ghost.srcOp === null ? " eq-op-off" : ""}`}>
              {ghost.srcOp ?? ghost.fromOp}
            </span>
          )}
          <span className="eq-val">{ghost.value}</span>
        </span>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 「为什么能移项」—— 两边同时减去同一个数
// ────────────────────────────────────────────────────────────

function WhyMoveDemo() {
  const reduced = useReducedMotion()
  const [step, setStep] = useState(3)

  useEffect(() => {
    if (reduced) {
      setStep(3)
      return
    }
    setStep(0)
    const ids = [1, 2, 3].map((s, i) => window.setTimeout(() => setStep(s), 1100 * (i + 1)))
    return () => ids.forEach((x) => window.clearTimeout(x))
  }, [reduced])

  const A = 5
  const B = 12

  return (
    <div className="card eq-why">
      <p className="eq-why-title">🔍 为什么能「挪过去」？因为等号两边像天平 —— 两边做同样的事，天平还是平的。</p>
      <div className="eq-why-row">
        <span className="eq-why-line">
          <span className="eq-var">x</span>
          {/* 抵消时分两半一起划掉 —— 只划掉「-5」会让人以为 +5 还留着 */}
          <span className={`eq-why-cancelwrap${step >= 2 ? " eq-why-cancel" : ""}`}>
            <span className="eq-op eq-op-as">+</span>
            <span className="eq-val">{A}</span>
          </span>
          {step >= 1 && (
            <span className={`eq-why-add${step >= 2 ? " eq-why-cancel" : ""}`}>
              <span className="eq-op eq-op-as">-</span>
              <span className="eq-val">{A}</span>
            </span>
          )}
        </span>
        <span className="eq-eq">=</span>
        <span className="eq-why-line">
          <span className="eq-val">{B}</span>
          {step >= 1 && (
            <span className="eq-why-add">
              <span className="eq-op eq-op-as">-</span>
              <span className="eq-val">{A}</span>
            </span>
          )}
        </span>
      </div>
      <p className="eq-why-note">
        {step < 1
          ? "看 —— 两边同时「减去 5」……"
          : step < 2
            ? "左边加了 +5 又减去 5，正好抵消；右边老老实实减掉 5。"
            : step < 3
              ? "一抵消，左边就只剩 x 了。"
              : `所以 x = ${B} - ${A} = ${B - A}，这和「把 +${A} 挪过去变 -${A}」结果完全一样 —— 移项变号就是这条捷径。`}
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 易错卡（滚进视口：先抖红的，再揭晓绿的）
// ────────────────────────────────────────────────────────────

function MistakeCard({ m }: { m: { title: string; wrong: string; right: string; why: string; tip: string } }) {
  const [showRight, setShowRight] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
    <div className="card eq-mistake" ref={ref}>
      <p className="eq-mistake-title">⚠️ {m.title}</p>
      <div className="eq-mistake-row eq-wrong">
        <span className="eq-mistake-tag">❌ 错</span>
        <span className="eq-mistake-expr eq-shake">{m.wrong}</span>
      </div>
      <div className={`eq-mistake-row eq-right${showRight ? " eq-right-in" : ""}`}>
        <span className="eq-mistake-tag">✅ 对</span>
        <span className="eq-mistake-expr">{m.right}</span>
      </div>
      <p className="eq-mistake-why">{m.why}</p>
      <p className="eq-mistake-tip">💡 {m.tip}</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 对比练习卡：先猜符号，再揭晓
// ────────────────────────────────────────────────────────────

function PracticeCard({
  item,
  index,
  onGraded,
}: {
  item: PracticeItem
  /** 题号（随机练习区用；教材对比练习不传） */
  index?: number
  /** 首次点选时上报对错 —— 随机练习区据此计分（每题只报一次） */
  onGraded?: (ok: boolean) => void
}) {
  const [picked, setPicked] = useState<PracticeAnswer | null>(null)
  const ok = picked === item.answer
  /** 「同侧换位」反例题：问法、选项、反馈都跟「跨线题」不一样 —— 答案是「不变」 */
  const sameSide = item.ask === "sameSide"
  /** 被搬走（或换位）那一块的显示文本：普通题是「+8」，两步型是「-x」 */
  const moved = item.movedLabel ?? `${item.sym}${item.num}`
  /** 选项里跟的数：两步型搬的是 x 本身，选项就该显示「+x」而不是「+8」 */
  const valLabel = item.movedLabel ? "x" : String(item.num)

  const pick = (o: PracticeAnswer) => {
    if (picked === null) onGraded?.(o === item.answer)
    setPicked(o)
  }

  return (
    <div className={`card eq-pcard${picked ? (ok ? " eq-pcard-ok" : " eq-pcard-bad") : ""}`}>
      <p className="eq-pcard-expr">
        {index !== undefined && <span className="eq-pcard-no">{index}</span>}
        {item.before}
      </p>
      <p className="eq-pcard-ask">
        {sameSide ? (
          <>
            它<b>没有</b>跨过等号，只是在等号同一边换了个位置 —— 符号该怎么变？
          </>
        ) : (
          <>
            把 <b>{moved}</b> 挪到等号右边，它该变成什么？
          </>
        )}
      </p>
      <div className="eq-pcard-opts">
        {OPS.map((o) => {
          const isSame = o === "same"
          const cls = [
            "eq-opt",
            isSame ? "eq-opt-same" : o === "×" || o === "÷" ? "eq-opt-md" : "eq-opt-as",
            picked === o ? (ok ? "eq-opt-right" : "eq-opt-wrong") : "",
          ]
            .filter(Boolean)
            .join(" ")
          return (
            <button key={o} type="button" className={cls} onClick={() => pick(o)}>
              <span className="eq-opt-sym">{OP_TEXT[o]}</span>
              {!isSame && valLabel}
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <div className={`eq-pcard-fb${ok ? " eq-fb-ok" : " eq-fb-bad"}`}>
          {ok ? (
            <>
              <span className="eq-fb-head">
                ✅ 对了！{item.why}（x = {item.x}）
              </span>
              <span className="eq-fb-res">{item.result}</span>
            </>
          ) : (
            <span className="eq-fb-head">
              {sameSide
                ? "❌ 再想想 —— 它压根没跨过等号，只是在同一侧换了个位置：符号一点不用动，该选「不变」。"
                : `❌ 再想想 —— 它跨过了等号，符号必须变相反：「${item.sym}」要变成「${flipOp(item.sym)}」。`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
