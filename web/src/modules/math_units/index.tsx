/** 三年级上 · 长度与质量单位换算 —— 「切开 / 拼合」+「米尺刻度」双机制演示页
 *
 * ── 这一页要解决的真问题 ──────────────────────────────────
 * 换算总错，根子不在「记不住 1000」。孩子把西瓜写成「5 克」，是因为他脑子里
 * 「克」和「千克」只是两个长得不一样的字，**没有重量**。没有量感的单位，
 * 填空只能猜；换算只能背「乘还是除」的口令，口令一乱就全乱。
 *
 * 所以本页按「量感 → 方向 → 进率」的顺序，每一层都给一条**能被验证的依据**：
 *   ① 量感 —— 参照物墙，每个单位配真实尺寸的实物；毫米/厘米/分米还按
 *             **真实物理尺寸**画出来，学生可以拿真尺子对着屏幕量
 *   ② 方向 —— 主舞台的「切开 / 拼合」：把 1 米切成 10 段就是 10 分米。
 *             切开 ⇒ 份数变多 ⇒ 乘；拼起来 ⇒ 份数变少 ⇒ 除。**可推导，不用背**
 *   ③ 进率 —— 同一个「切成 10 份」的动作重复 k 轮。10⇒1轮、100⇒2轮、1000⇒3轮
 *             ⇒ 「1000」是**数出来**的，不是背来的
 *
 * ── 两套机制为什么都要 ────────────────────────────────────
 * 「切开」讲的是**为什么乘**（推导），「米尺」讲的是**进率到底是多少**（清点）。
 * 学生从米尺上真的能数出 10 个 10 个 10，两个模型互相印证。
 *
 * ── 页面骨架 ──────────────────────────────────────────────
 *   主舞台（切开/拼合）→ 数一数（米尺 + 关系式）→ 参照物墙
 *   → 换算工作台 → 易错警示 → 一步一填练习
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import MathIcon from "../../components/MathIcon"
import { useNavigate } from "react-router-dom"
import {
  ADJACENT_PAIRS,
  METER_RULER_CM,
  MISTAKE_CASES,
  PROBLEM_GROUPS,
  RULES,
  convert,
  factsOf,
  genProblemSet,
  meterExamples,
  pairsOf,
  planSteps,
  qty,
  qtyEn,
  rulerExamples,
  unitOf,
  unitsOf,
  type MistakeCase,
  type ProblemGroupKey,
  type RulerReading,
  type UnitDef,
  type UnitKind,
  type UnitPair,
  type UnitPlan,
  type UnitProblem,
} from "./units"

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

/** 未校准时的兜底：CSS 规定 1in = 96px、1in = 25.4mm ⇒ 1mm ≈ 3.7795px */
const FALLBACK_MM_PX = 96 / 25.4

/** 份数 → 网格布局。份数越多格子越小，但**舞台高度恒定**，避免布局跳动 */
function gridPlan(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 }
  if (count <= 10) return { cols: count, rows: 1 }
  if (count <= 100) return { cols: 10, rows: Math.ceil(count / 10) }
  return { cols: 50, rows: Math.ceil(count / 50) }
}

type Phase = "idle" | "cut" | "split" | "count" | "done"

const T_CUT = 560
const T_SPLIT = 620
/** 一轮「切开 → 报数」用掉的时间 */
const T_ROUND = T_CUT + T_SPLIT

// ────────────────────────────────────────────────────────────
// 主舞台：切开 / 拼合
// ────────────────────────────────────────────────────────────

function CutStage({ plan, mmPx }: { plan: UnitPlan; mmPx: number }) {
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>("idle")
  /** 当前显示的份数。起始总是 `value`（= 几个「1 个 from 单位」） */
  const [count, setCount] = useState(plan.value)
  /** ★ 用「**已完成**的轮数」派生份数与每份标签，绝不用「当前轮下标」。
   *  踩过的坑：1 轮的题切完之后，当前轮下标仍是 0，和「还没开始」撞成同一个值 ⇒
   *  报数区把「每份 1分米」显示成「每份 1米」，而「切成 10 段每段 1 米」在教学上正好教反。 */
  const [done, setDone] = useState(0)
  /** 正在进行的轮（0 基，只用于解说文案） */
  const [active, setActive] = useState(0)
  const timers = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  // 换题（换单位对 / 换方向）时回到起始态
  useEffect(() => {
    clearTimers()
    setPhase("idle")
    setDone(0)
    setActive(0)
    setCount(plan.value)
    return clearTimers
  }, [plan, clearTimers])

  const play = useCallback(() => {
    clearTimers()
    if (reduced) {
      // 直接跳完成态：尊重「减少动态效果」
      setDone(plan.rounds)
      setActive(Math.max(0, plan.rounds - 1))
      setCount(plan.result)
      setPhase("done")
      return
    }
    setDone(0)
    setActive(0)
    setCount(plan.value)
    setPhase("cut")
    let t = 0
    plan.cuts.forEach((c, i) => {
      later(() => {
        setPhase("cut")
        setActive(i)
      }, t)
      later(() => {
        setCount(c.count)
        setDone(i + 1)
        setPhase("split")
      }, t + T_CUT)
      t += T_ROUND
    })
    later(() => setPhase("done"), t)
  }, [plan, reduced, clearTimers, later])

  const dirWord = plan.direction === "split" ? "切开" : "拼合"
  // 每份是多少：还没切过 ⇒ 整块就是 1 个 from 单位；切过 k 轮 ⇒ 取第 k 轮的标签
  const pieceLabel = done === 0 ? `1${plan.from.name}` : plan.cuts[done - 1].pieceLabel
  const { cols, rows } = gridPlan(count)
  const showCells = count > 1
  const answered = phase === "done"

  return (
    <div className="uc-stage">
      {/* 题面 */}
      <p className="uc-question">
        <span className="uc-q-num">{plan.value}</span>
        <span className="uc-q-unit">{plan.from.name}({plan.from.symbol})</span>
        <span className="uc-q-eq">=</span>
        <span className={`uc-q-ans${answered ? " uc-q-ans-ok" : ""}`}>
          {answered ? plan.result : "?"}
        </span>
        <span className="uc-q-unit">{plan.to.name}({plan.to.symbol})</span>
      </p>

      {/* 图形舞台：高度恒定，份数越多格子越小 */}
      <div className="uc-board">
        {showCells ? (
          <div
            className={`uc-grid uc-grid-${plan.direction}`}
            style={{ "--cols": cols, "--rows": rows } as React.CSSProperties}
          >
            {Array.from({ length: count }, (_, i) => (
              <span
                key={`${done}-${count}-${i}`}
                className={
                  "uc-cell" +
                  (phase === "split" ? " uc-cell-pop" : "") +
                  (phase === "cut" ? " uc-cell-cut" : "") +
                  (count <= 10 ? " uc-cell-labeled" : "")
                }
                style={{ animationDelay: `${Math.min(i, 60) * 9}ms` }}
              >
                {/* 份数不多时把「每份是多少」直接写在格子上 —— 光看报数区还不够直观 */}
                {count <= 10 && <b className="uc-cell-tag">{pieceLabel}</b>}
              </span>
            ))}
          </div>
        ) : (
          <div className={`uc-grid uc-grid-${plan.direction}`} style={{ "--cols": 1, "--rows": 1 } as React.CSSProperties}>
            <span
              key={`solo-${count}`}
              className={"uc-cell uc-cell-solo" + (phase === "cut" ? " uc-cell-cut" : "")}
            >
              <b>{pieceLabel}</b>
            </span>
          </div>
        )}
        {phase === "cut" && (
          <span className="uc-knife" aria-hidden="true">
            {plan.direction === "split" ? "🔪" : "🧲"}
          </span>
        )}
      </div>

      {/* 报数区 */}
      <div className="uc-tally">
        <div className="uc-tally-item">
          <span className="uc-tally-num">{count}</span>
          <span className="uc-tally-cap">份</span>
        </div>
        <div className="uc-tally-sep">×</div>
        <div className="uc-tally-item">
          <span className="uc-tally-piece">{pieceLabel}</span>
          <span className="uc-tally-cap">每份</span>
        </div>
        <div className="uc-tally-sep">=</div>
        <div className="uc-tally-item">
          <span className="uc-tally-num">{plan.value}</span>
          <span className="uc-tally-cap">{plan.from.name}</span>
        </div>
      </div>

      {/* 动作说明 —— 讲「当下正在发生什么」，不复述结论 */}
      <p className={`uc-say uc-say-${phase}`}>{sayText(phase, plan, active, done, dirWord)}</p>

      <div className="uc-stage-actions">
        <button type="button" className="uc-btn uc-btn-primary" onClick={play} disabled={phase !== "idle" && phase !== "done"}>
          {phase === "done" ? "▶ 再看一遍" : "▶ 播放动画"}
        </button>
        <button
          type="button"
          className="uc-btn"
          onClick={() => {
            clearTimers()
            setPhase("idle")
            setDone(0)
            setActive(0)
            setCount(plan.value)
          }}
        >
          ⟲ 重来
        </button>
      </div>

      {answered && (
        <div className="uc-conclusion">
          <p className="uc-conclusion-eq">
            {qtyEn(plan.value, plan.from)} = <b>{qtyEn(plan.result, plan.to)}</b>
          </p>
          <p className="uc-conclusion-why">
            {plan.direction === "split"
              ? `「${plan.from.name}」大 ⇒ 切开 ${plan.rounds} 轮 ⇒ 份数变多 ⇒ 用乘：`
              : `「${plan.from.name}」小 ⇒ 拼合 ⇒ 份数变少 ⇒ 用除：`}
            <code>
              {plan.value} {plan.op} {plan.ratio} = {plan.result}
            </code>
          </p>
        </div>
      )}

      <p className="uc-hint-sm">
        {plan.from.kind === "length" ? (
          <>
            💡 按下面「数一数」里校准好的比例，1{plan.from.name}({plan.from.symbol}) 的真实宽度大约是{" "}
            <b>{Math.round(plan.from.base * mmPx)}</b> 像素
            {plan.from.base * mmPx > 600 ? " —— 屏幕放不下，所以上面画的是示意图" : ""}。
          </>
        ) : (
          <>💡 质量没法画成尺寸：1{plan.from.name}({plan.from.symbol})有多重，看下面的参照物。</>
        )}
        <button
          type="button"
          className="uc-link"
          onClick={() =>
            document.getElementById("uc-sense")?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          看看 1{plan.from.name}({plan.from.symbol}) 有多大
        </button>
      </p>
    </div>
  )
}

function sayText(phase: Phase, plan: UnitPlan, active: number, done: number, dirWord: string): string {
  // ⚠️ 「正在开始的那一轮」和「刚完成的那一轮」是两个不同的下标，别混用：
  //    cut 阶段还没切完，要讲 active 这一轮；split 阶段已经切完，要讲 done-1 这一轮。
  const starting = plan.cuts[active]
  const finished = done > 0 ? plan.cuts[done - 1] : undefined
  switch (phase) {
    case "idle":
      return `现在有 ${qty(plan.value, plan.from)}。点「播放动画」，我们要把它一步步${dirWord}成${plan.to.name}。`
    case "cut":
      return plan.direction === "split"
        ? `看 —— 第 ${active + 1} 轮：把这 ${starting ? starting.count / 10 : plan.value} 份里的每一份，都切成 10 小份。`
        : `看 —— 第 ${active + 1} 轮：每 10 份拼成 1 份。`
    case "split":
      return plan.direction === "split"
        ? `份数变成了 ${finished?.count} 份，而每一份变小了 —— 现在每一份是 ${finished?.pieceLabel}。`
        : `份数减少到 ${finished?.count} 份，每一份变大了 —— 现在每一份是 ${finished?.pieceLabel}。`
    case "count":
      return `数一数：${finished?.count} 份。`
    case "done":
      return `${dirWord} ${plan.rounds} 轮之后，每一份正好是 1${plan.to.name}，一共 ${plan.result} 份。`
    default:
      return ""
  }
}

// ────────────────────────────────────────────────────────────
// 数一数：米尺 + 关系式（「可数出来的 1000」）
// ────────────────────────────────────────────────────────────

function Ruler({ mmPx }: { mmPx: number }) {
  const totalMm = 100 // 一把 10 厘米的尺子
  const w = totalMm * mmPx
  return (
    <div className="uc-ruler" style={{ width: `${w}px` }}>
      {/* ★ 刻度与数字**全部**按同一个 `i/100` 网格绝对定位。
          踩过的坑：红刻度用 justify-content:space-between、数字用 translateX(-50%)、
          黑刻度用 flex 均分 —— 三套网格各算各的，实测红刻度与大刻度错开 1~3px、
          数字间距只有 36.6px（应 37.8px），"10" 落在 352 而不是 378。
          而且 100 个小格只有 100 条左边框 ⇒ 10cm 处**根本没有刻度**。
          现在 101 条刻度逐条按 `left: i%` 落位，对齐由构造保证。 */}
      <div className="uc-ruler-marks">
        {Array.from({ length: totalMm + 1 }, (_, i) => (
          <span
            key={i}
            className={"uc-tick" + (i % 10 === 0 ? " uc-tick-cm" : i % 5 === 0 ? " uc-tick-mid" : "")}
            style={{ left: `${i}%` }}
          />
        ))}
      </div>
      <div className="uc-ruler-nums">
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} className="uc-ruler-num" style={{ left: `${i * 10}%` }}>
            {i}
          </span>
        ))}
      </div>
      <div className="uc-ruler-cap">厘米 cm · 10 小格 = 1 厘米</div>
    </div>
  )
}

/** 1 分米 = 100 毫米 的方格：10×10 让学生真的能数 */
function HundredGrid() {
  return (
    <div className="uc-hundred">
      <div className="uc-hundred-label">
        <b>1 分米(dm)</b> = 100 个 <b>1 毫米(mm)</b>
      </div>
      <div className="uc-hundred-grid">
        {Array.from({ length: 100 }, (_, i) => (
          <span key={i} className="uc-hundred-cell" />
        ))}
      </div>
      <p className="uc-hundred-note">10 × 10 = 100 格；1 米(m) = 10 块 ⇒ 1000 毫米(mm)</p>
    </div>
  )
}

function CountSection({ kind, mmPx, onCalib, calib }: {
  kind: UnitKind
  mmPx: number
  calib: number
  onCalib: (v: number) => void
}) {
  const facts = factsOf(kind)
  return (
    <section className="card uc-count" id="uc-count">
      <h2 className="uc-sec-title">📐 数一数，不靠背</h2>
      <p className="uc-sec-sub">拿你的尺子比一比，不一样就拖校准条。</p>

      {kind === "length" && (
        <>
          <div className="uc-ruler-wrap">
            <Ruler mmPx={mmPx} />
          </div>
          <div className="uc-calib">
            <label className="uc-calib-label" htmlFor="uc-calib-range">
              屏幕校准（把真尺子的 0 对准上面尺子的 0，拖动滑块，直到两把尺子在{" "}
              <b>5 厘米</b>处一样长）
            </label>
            <input
              id="uc-calib-range"
              type="range"
              min="0.5"
              max="1.8"
              step="0.01"
              value={calib}
              onChange={(e) => onCalib(Number(e.target.value))}
            />
            <span className="uc-calib-val">
              当前 1 毫米 ≈ {mmPx.toFixed(2)} 像素（{calib === 1 ? "浏览器默认" : `手动 ×${calib.toFixed(2)}`}）
            </span>
            {calib !== 1 && (
              <button type="button" className="uc-btn uc-btn-sm" onClick={() => onCalib(1)}>
                恢复默认
              </button>
            )}
          </div>
          <HundredGrid />
        </>
      )}

      <ul className="uc-facts">
        {facts.map((f) => (
          <li key={f.text} className="uc-fact">
            <span className="uc-fact-eq">{f.text}</span>
            <span className="uc-fact-note">{f.note}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ────────────────────────────────────────────────────────────
// 尺子上看例子：点一个长度，看它在尺子上亮到哪儿
// ★ 「亮出 7 厘米那一段」比任何一句话都直观 —— 单位不是符号，是一段真实长度
// ────────────────────────────────────────────────────────────

/** 学生尺总长（毫米）—— 一把 10 厘米的尺子 */
const EG_RULER_MM = 100
/** 默认停在那个被点名的例子：7 厘米 3 毫米 */
const EG_DEFAULT_MM = 73
/** 米尺示意图的固定像素宽（0..METER_RULER_CM 厘米 ⇒ 15 大格 × 24px） */
const EG_METER_PX = 360

/**
 * 把一段长度按**复合读法**切成并排的几块亮区。
 * 「7厘米3毫米」⇒ 前面 70 毫米一块、后面 3 毫米一块（两色 + 一条虚线分界）
 * ⇒ 孩子一眼看出「7厘米」和「多出来的 3毫米」是拼起来的一整段。
 */
function BandSegs({ read, pxPerMm, fullMm }: { read: RulerReading; pxPerMm: number; fullMm: number }) {
  let acc = 0
  const total = read.parts.reduce((a, p) => a + p.mm, 0)
  return (
    <>
      {read.parts.map((p, i) => {
        const left = acc * pxPerMm
        acc += p.mm
        const last = i === read.parts.length - 1
        // ⚠️ 分类名必须**逐字写出来**（不能用 "uc-eg-seg-" + i 拼）——
        //    tools/cssSkillMark.py 是靠「源码里出现该 class 字面量」判样式归属的，
        //    拼出来的名字查不到 ⇒ 这条规则被判成共享样式、从 math_units 的裁剪块里漏掉。
        const cls = [
          "uc-eg-seg",
          i % 2 === 0 ? "uc-eg-seg-0" : "uc-eg-seg-1",
          i === 0 ? "uc-eg-seg-start" : "",
          i > 0 ? "uc-eg-seg-split" : "",
          last ? "uc-eg-seg-last" : "",
          // 亮区正好铺满整把尺子时，右端要跟着尺子的圆角走（否则方角会戳出圆角外）
          last && total === fullMm ? "uc-eg-seg-end" : "",
        ]
          .filter(Boolean)
          .join(" ")
        return (
          <span
            key={`${read.mm}-${p.unit.id}`}
            className={cls}
            style={{ left: `${left}px`, width: `${p.mm * pxPerMm}px` }}
            aria-hidden="true"
          />
        )
      })}
    </>
  )
}

/** ★ 标签默认右对齐、贴住亮区右端；亮区太窄（< 60px）时改挂到右端**外侧** ——
 *  否则「5毫米」这种小标签比亮区还宽，会被左边裁掉一半。 */
function tagStyleFor(bandW: number): React.CSSProperties {
  return bandW < 60
    ? { left: `${bandW + 4}px` }
    : { left: `${bandW - 4}px`, transform: "translateX(-100%)" }
}

function RulerSection({ mmPx }: { mmPx: number }) {
  const examples = useMemo(() => rulerExamples(), [])
  const meters = useMemo(() => meterExamples(), [])
  const [mm, setMm] = useState(EG_DEFAULT_MM)
  /** 米尺默认停在 1 米 —— 这一档里最重要的锚点 */
  const [meterMm, setMeterMm] = useState(1000)
  const cur = examples.find((e) => e.mm === mm) ?? examples[0]
  const curM = meters.find((e) => e.mm === meterMm) ?? meters[0]

  const rulerW = EG_RULER_MM * mmPx
  const bandW = cur.mm * mmPx
  /** 米尺是**示意图**（屏幕装不下 1.5 米）⇒ 它有自己的固定比例，与校准无关 */
  const mPxPerMm = EG_METER_PX / (METER_RULER_CM * 10)
  const mBandW = curM.mm * mPxPerMm
  /** 米尺每个大格 = 1分米 = 10厘米 */
  const mCells = METER_RULER_CM / 10

  return (
    <section className="card uc-eg" id="uc-ruler-eg">
      <h2 className="uc-sec-title">📏 尺子上看例子</h2>
      <p className="uc-sec-sub">点一个长度，看它从 0 亮到哪儿。</p>

      <h3 className="uc-eg-h3">
        学生尺 <span className="uc-eg-h3-note">真实大小 · 0–10 厘米</span>
      </h3>

      <div className="uc-eg-chips">
        {examples.map((e) => (
          <button
            key={e.mm}
            type="button"
            className={"uc-eg-chip" + (e.mm === cur.mm ? " uc-eg-chip-on" : "")}
            onClick={() => setMm(e.mm)}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* ★ 真实尺寸尺子（1 毫米 ≈ 3.78 像素 ⇒ 10 厘米 ≈ 378px），手机上卡片放不下
          ⇒ 和「数一数」那把一样出血 + 自己横向滚，绝不把整页撑宽。 */}
      <div className="uc-eg-scroll">
        <div className="uc-eg-stage" data-ruler="cm" style={{ width: `${rulerW}px` }}>
          <div className="uc-eg-tagrow">
            <span className={"uc-eg-tag" + (bandW < 60 ? " uc-eg-tag-out" : "")} style={tagStyleFor(bandW)}>
              {cur.label}
            </span>
          </div>
          <div className="uc-ruler uc-eg-ruler" style={{ width: `${rulerW}px` }}>
            {/* 亮出来的这一段：按复合读法分成几块，右端一道实心端线 */}
            <BandSegs read={cur} pxPerMm={mmPx} fullMm={EG_RULER_MM} />
            <div className="uc-ruler-marks">
              {Array.from({ length: EG_RULER_MM + 1 }, (_, i) => (
                <span
                  key={i}
                  className={"uc-tick" + (i % 10 === 0 ? " uc-tick-cm" : i % 5 === 0 ? " uc-tick-mid" : "")}
                  style={{ left: `${i}%` }}
                />
              ))}
            </div>
            <div className="uc-ruler-nums">
              {Array.from({ length: 11 }, (_, i) => (
                <span key={i} className="uc-ruler-num" style={{ left: `${i * 10}%` }}>
                  {i}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ★ 同一段长度的各种写法由引擎派生（7厘米3毫米 = 73毫米），页面不手写 */}
      <p className="uc-eg-out">
        <b>{cur.label}</b>
        {cur.same.map((s) => (
          <span key={s}>
            <span className="uc-eg-eqs"> = </span>
            <span className="uc-eg-alt">{s}</span>
          </span>
        ))}
      </p>
      <p className="uc-eg-note">
        {cur.parts.length > 1 ? (
          <>
            {cur.parts.map((p, i) => (
              <span key={p.unit.id}>
                {i > 0 ? " + " : ""}
                <b>
                  {p.value}
                  {p.unit.name}
                </b>
                （{p.mm} 小格）
              </span>
            ))}
            <span> = {cur.mm} 毫米</span>
          </>
        ) : (
          <>
            从 0 亮到第 <b>{cur.mm}</b> 个小格（1 小格 = 1 毫米）
          </>
        )}
      </p>

      <h3 className="uc-eg-h3">
        米尺 <span className="uc-eg-h3-note">示意图 · 0–1.5 米</span>
      </h3>

      <div className="uc-eg-chips">
        {meters.map((e) => (
          <button
            key={e.mm}
            type="button"
            className={"uc-eg-chip" + (e.mm === curM.mm ? " uc-eg-chip-on" : "")}
            onClick={() => setMeterMm(e.mm)}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div className="uc-eg-scroll">
        <div className="uc-eg-stage" data-ruler="m" style={{ width: `${EG_METER_PX}px` }}>
          <div className="uc-eg-tagrow">
            <span className={"uc-eg-tag" + (mBandW < 60 ? " uc-eg-tag-out" : "")} style={tagStyleFor(mBandW)}>
              {curM.label}
            </span>
          </div>
          {/* 15 个大格，每格 1 分米；第 10 格的右边正好是 1 米 */}
          <div className="uc-mr">
            <BandSegs read={curM} pxPerMm={mPxPerMm} fullMm={METER_RULER_CM * 10} />
            <div className="uc-mr-cells">
              {Array.from({ length: mCells }, (_, i) => (
                <span key={i} className={"uc-mr-cell" + (i === 9 ? " uc-mr-cell-m" : "")}>
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="uc-eg-out">
        <b>{curM.label}</b>
        {curM.same.map((s) => (
          <span key={s}>
            <span className="uc-eg-eqs"> = </span>
            <span className="uc-eg-alt">{s}</span>
          </span>
        ))}
      </p>
      <p className="uc-eg-note">
        亮到第 <b>{curM.mm / 100}</b> 大格（1 大格 = 1分米(dm) = 10厘米(cm)）
      </p>
      <p className="uc-eg-note">
        第 10 大格的右边就是 1米(m) = 100厘米(cm) = 1000毫米(mm)。
      </p>

      <p className="uc-eg-hint">
        ★ 米尺是示意图，不是真实大小 —— 屏幕上按真实尺寸画 1 米(m) 要{" "}
        {Math.round(1000 * mmPx).toLocaleString("zh-CN")} 像素宽，卡片装不下。米尺上只数格，别量长度；
        要量真实大小，用上面那把学生尺。
      </p>
      <p className="uc-eg-hint">
        ★ 千米(km)连示意图都不画：1千米(km) = 1000米(m)，按真实尺寸要{" "}
        {Math.round(1_000_000 * mmPx).toLocaleString("zh-CN")} 像素宽。它的量感看下面「参照物墙」。
      </p>
    </section>
  )
}

// ────────────────────────────────────────────────────────────
// 参照物墙
// ────────────────────────────────────────────────────────────

function RealSize({ unit, mmPx, availPx }: { unit: UnitDef; mmPx: number; availPx: number }) {
  const withDraw = unit.refs.find((r) => r.draw)
  if (!withDraw?.draw) return null
  const { form, baseAmount } = withDraw.draw

  if (!unit.onScreenReal) {
    return (
      <p className="uc-real-off">
        {unit.name}太大了，屏幕上放不下（1{unit.name} 画成真实大小需要大约{" "}
        {Math.round((unit.base / 1000) * mmPx * 1000).toLocaleString("zh-CN")} 像素宽）。
        用下面的参照物去想象它。
      </p>
    )
  }

  const px = baseAmount * mmPx
  // ★ 卡里放不下就**不画**，而不是画一条被裁掉的。
  //   `px` 是真实尺寸：1分米 = 100mm ≈ 378px，而卡片内容区在手机上只有 300~340px。
  //   裁掉右端之后，学生拿尺子量到的是「约 9 厘米」—— 比不画更误导。
  //   ⚠️ 也不能「按容器宽度缩小了画」：缩小就不是真实大小了，整段量感教学的前提就没了。
  //   放不下时改去指上面那把 **真实大小** 的米尺（0→10 那一段），同一个页面里已有权威参照。
  //   availPx 由父级实测（首帧为 0，此时不拦，靠 .uc-real-scroll 兜住溢出）。
  if (availPx > 0 && px > availPx) {
    const mm = Math.round(px / mmPx)
    return (
      <p className="uc-real-off">
        1{unit.name} 的真实长度约 {Math.round(px)} 像素（{mm} 毫米），这张卡片（{Math.round(availPx)}{" "}
        像素）装不下。这里<b>不缩小着画</b> —— 缩小就不是真实大小了。想感受它：把真尺子贴到上面那把米尺上，
        看 0 到 {mm / 10} 厘米这一段。
      </p>
    )
  }

  return (
    <div className="uc-real">
      {/* 条子按**真实尺寸**画。正常情况下宽度已经过 availPx 检查，不会超出；
          这层滚动容器是首帧（还没量到宽度）的兜底，同时也保证格子 min-width:auto
          永远不会被它顶开、把整页撑宽。 */}
      <div className="uc-real-scroll">
        {form === "slab" ? (
          // 厚度类：高度就是真实厚度，宽度给够好看
          <span className="uc-real-slab" style={{ height: `${Math.max(2, px)}px` }} />
        ) : (
          <span className="uc-real-bar" style={{ width: `${px}px` }} />
        )}
      </div>
      <span className="uc-real-cap">
        屏幕上这段 = 真实的 1{unit.name}（1{unit.symbol}，约 {Math.round(px)} 像素）
      </span>
    </div>
  )
}

function SenseSection({ kind, mmPx }: { kind: UnitKind; mmPx: number }) {
  const list = unitsOf(kind)

  // ★ 实测卡片的**内容宽**，交给 RealSize 判断「这条真实尺寸画得下吗」。
  //   不能写死常量：视口 430px 时内容区 340px，视口 360px 时只剩约 270px，
  //   写死了窄屏上又会退回「画一条被裁掉的条」。
  //   用 useLayoutEffect + ResizeObserver：量在**绘制前**完成，避免先画 378px 的条
  //   再被替换成文字（那会闪一帧）。
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [availPx, setAvailPx] = useState(0)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const card = el.firstElementChild as HTMLElement | null
      if (!card) return setAvailPx(el.clientWidth)
      const cs = getComputedStyle(card)
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      setAvailPx(card.getBoundingClientRect().width - pad)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <section className="card uc-sense" id="uc-sense">
      <h2 className="uc-sec-title">👀 1{list[0].name}（{list[0].symbol}）有多大</h2>
      <div className="uc-sense-grid" ref={gridRef}>
        {list.map((u) => (
          <div key={u.id} className="uc-sense-card">
            <div className="uc-sense-head">
              <span className="uc-sense-name">{u.name}</span>
              <span className="uc-sense-en">{u.en}</span>
              <span className="uc-sense-sym">{u.symbol}</span>
            </div>
            <RealSize unit={u} mmPx={mmPx} availPx={availPx} />
            <ul className="uc-sense-refs">
              {u.refs.map((r) => (
                <li key={r.name}>
                  <MathIcon name={r.icon} size={38} className="uc-ref-icon" />
                  <span className="uc-ref-name">{r.name}</span>
                  <span className="uc-ref-detail">{r.detail}</span>
                </li>
              ))}
            </ul>
            <p className="uc-sense-hand">{u.sense}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────
// 换算工作台
// ────────────────────────────────────────────────────────────

function Bench({ mmPx }: { mmPx: number }) {
  const [kind, setKind] = useState<UnitKind>("length")
  const chain = useMemo(() => unitsOf(kind), [kind])
  const [fromId, setFromId] = useState(chain[0].id)
  const [toId, setToId] = useState(chain[1].id)
  const [raw, setRaw] = useState("3")

  // 换族时把两个单位重置回该族的头两个，避免出现「米 → 克」这种非法组合
  useEffect(() => {
    const c = unitsOf(kind)
    setFromId(c[0].id)
    setToId(c[1].id)
  }, [kind])

  const value = Number(raw)
  const valid = Number.isFinite(value) && value > 0
  const from = unitOf(fromId)
  const to = unitOf(toId)

  const result = valid ? convert(value, from, to) : null
  const plan = valid && from.id !== to.id ? planSteps(from, to, value) : null
  const pretty = result === null ? "" : Number.isInteger(result) ? String(result) : result.toFixed(6).replace(/0+$/, "")

  return (
    <section className="card uc-bench">
      <h2 className="uc-sec-title">🔢 换算工作台</h2>

      <div className="uc-bench-row">
        <input
          className="uc-input"
          type="number"
          min="1"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          aria-label="要换算的数"
        />
        <select className="uc-select" value={kind} onChange={(e) => setKind(e.target.value as UnitKind)} aria-label="单位族">
          <option value="length">长度</option>
          <option value="mass">质量</option>
        </select>
        <select
          className="uc-select"
          value={fromId}
          onChange={(e) => setFromId(e.target.value as UnitDef["id"])}
          aria-label="从哪个单位"
        >
          {chain.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}({u.symbol})
            </option>
          ))}
        </select>
        <span className="uc-arrow">→</span>
        <select
          className="uc-select"
          value={toId}
          onChange={(e) => setToId(e.target.value as UnitDef["id"])}
          aria-label="换成哪个单位"
        >
          {chain.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {!valid && <p className="uc-bench-bad">请填一个大于 0 的数（三年级只做整数换算）。</p>}

      {valid && from.id === to.id && <p className="uc-bench-bad">两个单位一样，数不用变。</p>}

      {valid && plan && result !== null && (
        <>
          <p className="uc-bench-out">
            {qtyEn(value, from)} = <b>{pretty}{to.name}({to.symbol})</b>
          </p>
          <p className="uc-bench-calc">
            <code>
              {value} {plan.op} {plan.ratio} = {pretty}
            </code>
            <span className="uc-bench-why">
              {plan.direction === "split"
                ? `单位变小 ⇒ 切开 ⇒ 份数变多 ⇒ 用乘（切 ${plan.rounds} 轮，进率 ${plan.ratio}）`
                : `单位变大 ⇒ 拼合 ⇒ 份数变少 ⇒ 用除（拼 ${plan.rounds} 轮，进率 ${plan.ratio}）`}
            </span>
          </p>
          <ul className="uc-bench-steps">
            {plan.cuts.map((c) => (
              <li key={c.round}>
                第 {c.round} 轮 ⇒ <b>{c.count}</b> 份，每份 <b>{c.pieceLabel}</b>
              </li>
            ))}
          </ul>
          <p className="uc-bench-note">
            这一对是{from.name}({from.symbol})↔{to.name}({to.symbol})，进率 {plan.ratio}，要 {plan.rounds} 轮 ——{" "}
            {plan.rounds === 1 ? "切一轮就到了" : `10 要乘 ${plan.rounds} 次`}。
            <span className="uc-bench-mm">（参照物比例尺：1 毫米 ≈ {mmPx.toFixed(2)} 像素）</span>
          </p>
        </>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────
// 易错警示（滚动进入视口时先抖红的，再揭晓绿的）
// ────────────────────────────────────────────────────────────

function MistakeSection() {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<Set<number>>(new Set())

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer: number | undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        // 先抖红的
        setShown(new Set(MISTAKE_CASES.map((_, i) => i)))
        // ⚠️ 回调里 return 清理函数是无效的（返回值被丢弃）⇒ 定时器必须在 effect 的 cleanup 里清
        timer = window.setTimeout(() => setShown(new Set()), 1100)
        io.disconnect()
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      io.disconnect()
    }
  }, [])

  return (
    <section className="card uc-mistake" ref={ref}>
      <h2 className="uc-sec-title">⚠️ 最容易错的 7 个地方</h2>
      <div className="uc-mistake-list">
        {MISTAKE_CASES.map((c, i) => (
          <MistakeCard key={c.wrong} c={c} shake={shown.has(i)} />
        ))}
      </div>
    </section>
  )
}

function MistakeCard({ c, shake }: { c: MistakeCase; shake: boolean }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className={`uc-mistake-card${revealed ? " uc-revealed" : ""}`}>
      <div className={`uc-mistake-wrong${shake ? " uc-shake" : ""}`}>
        <span className="uc-mk">❌</span> {c.wrong}
      </div>
      {revealed ? (
        <div className="uc-mistake-right">
          <span className="uc-mk">✅</span> {c.right}
          <p className="uc-mistake-why">{c.why}</p>
          <p className="uc-mistake-tip">💡 {c.tip}</p>
        </div>
      ) : (
        <button type="button" className="uc-btn uc-btn-sm uc-reveal" onClick={() => setRevealed(true)}>
          想好了，看正确答案
        </button>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 一步一填练习
// ────────────────────────────────────────────────────────────

const STEP_LABEL: Record<UnitProblem["steps"][number]["key"], string> = {
  op: "① 判方向",
  rate: "② 找进率",
  calc: "③ 算结果",
}

interface CardState {
  stepIndex: number
  /** 当前这一步选了哪个选项（null = 还没选） */
  picked: string | null
  /** 已完成步骤的选择记录 */
  trail: string[]
}

function freshCard(): CardState {
  return { stepIndex: 0, picked: null, trail: [] }
}

function SolveCard({ p, index, onStep, onFinished }: {
  p: UnitProblem
  index: number
  onStep: (right: boolean) => void
  onFinished: () => void
}) {
  const [st, setSt] = useState<CardState>(freshCard)
  const step = p.steps[st.stepIndex]
  const answered = st.picked !== null
  const isRight = answered && st.picked === step.answer
  const isLast = st.stepIndex === p.steps.length - 1
  const done = st.stepIndex >= p.steps.length

  useEffect(() => {
    setSt(freshCard())
  }, [p])

  const choose = (opt: string) => {
    if (answered) return
    setSt((s) => ({ ...s, picked: opt }))
    onStep(opt === step.answer)
  }

  const next = () => {
    if (isLast) {
      setSt((s) => ({ ...s, stepIndex: s.stepIndex + 1, picked: null, trail: [...s.trail, s.picked ?? ""] }))
      onFinished()
      return
    }
    setSt((s) => ({ ...s, stepIndex: s.stepIndex + 1, picked: null, trail: [...s.trail, s.picked ?? ""] }))
  }

  return (
    <div className={`uc-pcard${done ? " uc-pcard-done" : ""}`}>
      <div className="uc-pcard-head">
        <span className="uc-pcard-no">第 {index + 1} 题</span>
        <span className="uc-pcard-q">{p.fullText}</span>
      </div>

      {/* 进度点 */}
      <div className="uc-pcard-prog">
        {p.steps.map((s, i) => (
          <span
            key={s.key}
            className={
              "uc-pdot" +
              (i < st.stepIndex ? " uc-pdot-done" : "") +
              (i === st.stepIndex && !done ? " uc-pdot-cur" : "")
            }
            title={STEP_LABEL[s.key]}
          />
        ))}
      </div>

      {!done && (
        <>
          <p className="uc-pcard-step">{STEP_LABEL[step.key]}</p>
          <p className="uc-pcard-ask">{step.ask}</p>
          <div className="uc-pcard-opts">
            {step.options.map((o) => (
              <button
                key={o}
                type="button"
                className={
                  "uc-opt" +
                  (answered && o === step.answer ? " uc-opt-ok" : "") +
                  (answered && o === st.picked && o !== step.answer ? " uc-opt-bad" : "") +
                  (answered && o !== st.picked && o !== step.answer ? " uc-opt-dim" : "")
                }
                onClick={() => choose(o)}
                disabled={answered}
              >
                {o}
              </button>
            ))}
          </div>
          {answered && (
            <>
              <p className={`uc-pcard-tip${isRight ? " uc-tip-ok" : " uc-tip-bad"}`}>
                {isRight ? "✅ " : "❌ "}
                {step.tip}
              </p>
              <button type="button" className="uc-btn uc-btn-sm uc-pcard-next" onClick={next}>
                {isLast ? "看看完整算式" : "下一步 ›"}
              </button>
            </>
          )}
        </>
      )}

      {done && (
        <div className="uc-pcard-final">
          <p className="uc-pcard-ans">
            {qtyEn(p.value, p.from)} = <b>{qtyEn(p.result, p.to)}</b>
          </p>
          <p className="uc-pcard-note">{p.finalNote}</p>
          {p.trap !== null && (
            <p className="uc-pcard-trap">
              ⚠️ 如果方向判反了，会算成 <b>{p.trap}</b>{p.to.name}({p.to.symbol})。记住：{p.from.name}
              {p.from.base > p.to.base ? "大、要切开" : "小、要拼合"}，所以是{planDirWord(p)}。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function planDirWord(p: UnitProblem): string {
  return p.op === "×" ? "乘" : "除"
}

function PracticeSection() {
  const [group, setGroup] = useState<ProblemGroupKey>("lengthAdjacent")
  const [problems, setProblems] = useState<UnitProblem[]>(() => genProblemSet("lengthAdjacent", 6))
  const [stat, setStat] = useState({ steps: 0, right: 0 })
  const [rounds, setRounds] = useState(0)

  const regen = useCallback((g: ProblemGroupKey) => {
    setProblems(genProblemSet(g, 6))
    setStat({ steps: 0, right: 0 })
    setRounds((r) => r + 1)
  }, [])

  const onStep = useCallback((right: boolean) => {
    setStat((s) => ({ steps: s.steps + 1, right: s.right + (right ? 1 : 0) }))
  }, [])

  const onFinished = useCallback(() => {
    setRounds((r) => r + 1)
  }, [])

  const pct = stat.steps === 0 ? 0 : Math.round((stat.right / stat.steps) * 100)

  return (
    <section className="card uc-practice">
      <h2 className="uc-sec-title">✍️ 练一练：一步一步来</h2>
      <p className="uc-sec-sub">每道题都拆成三步，别一步算完。</p>

      <div className="uc-groups">
        {PROBLEM_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`uc-chip${group === g.key ? " uc-chip-on" : ""}`}
            onClick={() => {
              setGroup(g.key)
              regen(g.key)
            }}
          >
            <b>{g.title}</b>
            <span>{g.desc}</span>
          </button>
        ))}
      </div>

      <div className="uc-stat">
        <span>
          已经填了 <b>{stat.steps}</b> 步，对了 <b>{stat.right}</b> 步
          {stat.steps > 0 && `（${pct}%）`}
        </span>
        <button type="button" className="uc-btn uc-btn-sm" onClick={() => regen(group)}>
          🎲 换一组题
        </button>
      </div>

      <div className="uc-pgrid" key={rounds}>
        {problems.map((p, i) => (
          <SolveCard key={`${p.from.id}-${p.to.id}-${p.value}-${i}`} p={p} index={i} onStep={onStep} onFinished={onFinished} />
        ))}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────
// 主舞台的选题条
// ────────────────────────────────────────────────────────────

function PairChips({ pairs, active, onPick }: {
  pairs: UnitPair[]
  active: UnitPair | null
  onPick: (p: UnitPair) => void
}) {
  return (
    <div className="uc-chips">
      {pairs.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`uc-chip uc-chip-tight${active?.key === p.key ? " uc-chip-on" : ""}`}
          onClick={() => onPick(p)}
        >
          <b>
            {p.small.name}({p.small.symbol}) ⟷ {p.big.name}({p.big.symbol})
          </b>
          <span>进率 {p.ratio}</span>
        </button>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 页面
// ────────────────────────────────────────────────────────────

export function MathUnitsPage() {
  const navigate = useNavigate()
  const [kind, setKind] = useState<UnitKind>("length")
  const [pair, setPair] = useState<UnitPair>(() => pairsOf("length")[2] ?? ADJACENT_PAIRS[0])
  /** 演示方向：true = 大单位 → 小单位（切开） */
  const [toSmaller, setToSmaller] = useState(true)

  // ── 屏幕校准 ──
  const probeRef = useRef<HTMLSpanElement>(null)
  const [calib, setCalib] = useState(() => {
    const v = Number(localStorage.getItem("uc_calib") || "1")
    return Number.isFinite(v) && v > 0 ? v : 1
  })
  const [baseMmPx, setBaseMmPx] = useState(FALLBACK_MM_PX)

  useEffect(() => {
    // 量一个 10mm 的探针，得到浏览器认为的 1 毫米有多少像素
    const el = probeRef.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    if (w > 0) setBaseMmPx(w / 10)
  }, [])

  const mmPx = baseMmPx * calib

  const onCalib = useCallback((v: number) => {
    setCalib(v)
    localStorage.setItem("uc_calib", String(v))
  }, [])

  // 换族时把选题条切到该族的第一个
  const pairs = useMemo(() => pairsOf(kind), [kind])
  useEffect(() => {
    const list = pairsOf(kind)
    if (!list.some((p) => p.key === pair.key)) setPair(list[list.length - 1] ?? list[0])
  }, [kind, pair.key])

  const plan: UnitPlan = useMemo(() => {
    const from = toSmaller ? pair.big : pair.small
    const to = toSmaller ? pair.small : pair.big
    return planSteps(from, to, toSmaller ? 1 : pair.ratio)
  }, [pair, toSmaller])

  const groupTitle = kind === "length" ? "长度单位" : "质量单位"

  return (
    <div className="page uc-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)} type="button">
          ← 返回
        </button>
        <h1>📏 长度与质量单位</h1>
      </header>

      {/* ⚠️ .module-header 是 flex ⇒ 副标题必须放 header **外面**，否则 h1 被挤成省略号 */}
      <p className="uc-sub">
        毫米 mm · 厘米 cm · 分米 dm · 米 m · 千米 km ｜ 克 g · 千克 kg · 吨 t
      </p>

      {/* ── 规律卡 ── */}
      <div className="card uc-rules">
        {RULES.map((r) => (
          <div key={r.title} className="uc-rule">
            <b className="uc-rule-title">{r.title}</b>
            <span className="uc-rule-body">{r.body}</span>
          </div>
        ))}
      </div>

      {/* ── 主舞台 ── */}
      <section className="card uc-main">
        <h2 className="uc-sec-title">✂️ 切开与拼合：为什么该乘、该除？</h2>
        <p className="uc-sec-sub">不用背口诀 —— 看动画自己推。切几轮 = 进率里有几个 10。</p>

        <div className="uc-kindrow">
          <button
            type="button"
            className={`uc-chip uc-chip-tight${kind === "length" ? " uc-chip-on" : ""}`}
            onClick={() => setKind("length")}
          >
            <b>📏 长度</b>
            <span>{groupTitle}：毫米 mm / 厘米 cm / 分米 dm / 米 m / 千米 km</span>
          </button>
          <button
            type="button"
            className={`uc-chip uc-chip-tight${kind === "mass" ? " uc-chip-on" : ""}`}
            onClick={() => setKind("mass")}
          >
            <b>⚖️ 质量</b>
            <span>克 g / 千克 kg / 吨 t</span>
          </button>
        </div>

        <PairChips pairs={pairs} active={pair} onPick={setPair} />

        <div className="uc-dirrow">
          <button
            type="button"
            className={`uc-btn uc-btn-sm${toSmaller ? " uc-btn-on" : ""}`}
            onClick={() => setToSmaller(true)}
          >
            {pair.big.name}({pair.big.symbol}) → {pair.small.name}({pair.small.symbol})（切开 · 乘）
          </button>
          <button
            type="button"
            className={`uc-btn uc-btn-sm${!toSmaller ? " uc-btn-on" : ""}`}
            onClick={() => setToSmaller(false)}
          >
            {pair.small.name}({pair.small.symbol}) → {pair.big.name}({pair.big.symbol})（拼合 · 除）
          </button>
        </div>

        <CutStage key={`${pair.key}-${toSmaller}`} plan={plan} mmPx={mmPx} />
      </section>

      {/* ── 数一数 ── */}
      <CountSection kind={kind} mmPx={mmPx} calib={calib} onCalib={onCalib} />

      {/* ── 尺子上看例子 ── */}
      <RulerSection mmPx={mmPx} />

      {/* ── 参照物墙 ── */}
      <SenseSection kind={kind} mmPx={mmPx} />

      {/* ── 换算工作台 ── */}
      <Bench mmPx={mmPx} />

      {/* ── 易错警示 ── */}
      <MistakeSection />

      {/* ── 练习 ── */}
      <PracticeSection />

      {/* 隐藏探针：量浏览器认为的 1 毫米 */
      }
      <span
        ref={probeRef}
        aria-hidden="true"
        style={{ display: "inline-block", width: "10mm", height: "1px", position: "absolute", visibility: "hidden" }}
      />
    </div>
  )
}
