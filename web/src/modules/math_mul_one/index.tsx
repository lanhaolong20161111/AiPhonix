/** 三年级上 · 多位数乘一位数 —— 「竖式逐位四拍」+「位值点阵」双机制演示页
 *
 * ── 这一页要解决的真问题 ──────────────────────────────────
 * 孩子算 `27 × 4` 写成 88，不是不会背「四七二十八」，而是**算完十位就忘了
 * 把个位进上来的 2 加进去**。也就是说：错的不是乘法，是「进位」这一步
 * 从来没有成为一个看得见的动作。
 *
 * 所以本页把竖式拆成**逐位的四拍**，每一拍都配一个视觉动作 + 高亮，并同时
 * 用**位值点阵**把「进位到底是什么」演出来：
 *   ① 乘：这一位的数字 × 一位数（口诀）    ⇒ 竖式上被乘数这一位 + × 号一起发光
 *   ② 加：再加上右边进上来的数            ⇒ 竖式上那个小数字发光 ★错得最多的一拍
 *   ③ 写：sum 的个位写在结果这一位        ⇒ 结果格闪绿
 *   ④ 进：sum 的十位送到前一位头上        ⇒ 左边那个进位槽闪蓝
 *
 * ── 两套机制为什么都要 ────────────────────────────────────
 * 「竖式四拍」讲的是**怎么做**（一条可执行的流程）；
 * 「位值点阵」讲的是**为什么这样做**—— 个位的点满 10 个捆成一捆、往左飞，
 * 十位才知道自己要多加一捆。这直接回答了本页最难的一个问题：
 * **为什么一定要从个位乘起？** 因为进位只能往左走，左边那位在右边算完之前
 * 根本不知道该加几。从高位起也能算对，但每算一位都要回头改。
 *
 * ── 页面骨架 ──────────────────────────────────────────────
 *   规律卡 → 主舞台（竖式 + 位值点阵 + 关键区域说明条）→ 为什么从个位起
 *   → 巧算对照（末尾有 0 时才出现）→ 易错警示 → 一步一填练习
 *
 * 所有数字（含高亮位置）都来自 `lib/mulOne.ts` 的 `planSteps` / `viewOf`，
 * 页面自己不做任何加减，也不自己判断该亮哪一格。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import MathIcon from "../../components/MathIcon"
import {
  BEAT_MS,
  KIND_GROUPS,
  MISTAKE_CASES,
  RULES,
  genPlan,
  genProblemSet,
  placeName,
  productFromPlan,
  tailZeroHint,
  viewOf,
  type Beat,
  type MistakeCase,
  type MulKind,
  type MulPlan,
  type MulProblem,
  type MulTrap,
  type SolveStep,
} from "./mulOne"

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

const BEAT_LABEL: Record<Beat, string> = {
  idle: "准备",
  mul: "① 乘",
  add: "② 加进位",
  write: "③ 写",
  carry: "④ 进",
  done: "完成",
}

/** 这一拍的「算式条」—— 高亮关键区域时，把此刻在算的那一步单独写出来 */
function beatEquation(plan: MulPlan, index: number): string {
  const view = viewOf(plan, index)
  const s = plan.steps[Math.min(view.place, plan.steps.length - 1)]
  switch (view.beat) {
    case "mul":
      return s.digit === 0 ? `0 × ${plan.factor} = 0` : `${s.digit} × ${plan.factor} = ${s.base}`
    case "add":
      return `${s.base} + ${s.carryIn} = ${s.sum}`
    case "write":
      return s.carryOut > 0 ? `${s.sum} → 写 ${s.write}，留 ${s.carryOut}` : `${s.sum} → 直接写 ${s.write}`
    case "carry":
      return view.place === plan.steps.length - 1
        ? `最前面写 ${s.carryOut} · 积多一位`
        : `送 ${s.carryOut} 给${placeName(view.place + 1)}`
    case "done":
      return `${plan.value} × ${plan.factor} = ${plan.product}`
    default:
      return "从个位开始"
  }
}

// ────────────────────────────────────────────────────────────
// 主舞台 ①：竖式（高亮关键区域）
// ────────────────────────────────────────────────────────────

function VerticalStage({ plan, index }: { plan: MulPlan; index: number }) {
  const view = viewOf(plan, index)
  const cols = plan.cols
  const { digit, factor, op, carryIn, write, topCarry } = view.hl

  // 左起第 c 列 → 位下标（最右列 = 个位）
  const placeOfCol = (c: number) => cols - 1 - c

  return (
    <div className="mo-v" style={{ ["--mo-cols" as string]: String(cols) }}>
      {/* ── 进位行：小数字写在**它要被加进去的那一位**头上 ── */}
      <div className="mo-vrow mo-vrow-carry">
        {Array.from({ length: cols }, (_, c) => {
          const place = placeOfCol(c)
          const v = place < view.carryCells.length ? view.carryCells[place] : null
          return (
            <span key={c} className="mo-cell mo-cell-carry">
              {v !== null && (
                <b className={`mo-carry${carryIn === place ? " mo-hl" : ""}`}>{v}</b>
              )}
            </span>
          )
        })}
      </div>

      {/* ── 被乘数行 ── */}
      <div className="mo-vrow">
        {Array.from({ length: cols }, (_, c) => {
          const place = placeOfCol(c)
          const d = place < plan.digits.length ? plan.digits[place] : null
          return (
            <span
              key={c}
              className={`mo-cell mo-num${d === null ? " mo-cell-empty" : ""}${
                digit === place ? " mo-hl-digit" : ""
              }`}
            >
              {d ?? ""}
            </span>
          )
        })}
      </div>

      {/* ── 一位数行：× 落在十位那一列，个位数落在个位列（教材写法）── */}
      <div className="mo-vrow mo-vrow-op">
        {Array.from({ length: cols }, (_, c) => {
          const place = placeOfCol(c)
          if (place === 0) {
            return (
              <span key={c} className={`mo-cell mo-num${factor ? " mo-hl-factor" : ""}`}>
                {plan.factor}
              </span>
            )
          }
          if (place === 1) {
            return (
              <span key={c} className={`mo-cell mo-op${op ? " mo-hl-op" : ""}`}>
                ×
              </span>
            )
          }
          return <span key={c} className="mo-cell mo-cell-empty" />
        })}
      </div>

      {/* ── 横线 ── */}
      <div className="mo-vline" />

      {/* ── 积 ── */}
      <div className="mo-vrow">
        {Array.from({ length: cols }, (_, c) => {
          const place = placeOfCol(c)
          const v = place < view.resultCells.length ? view.resultCells[place] : null
          const isTop = place === plan.resultDigits.length - 1 && plan.grewTop
          return (
            <span
              key={c}
              className={`mo-cell mo-num mo-num-ans${v === null ? " mo-cell-empty" : ""}${
                write === place ? " mo-hl-write" : ""
              }${topCarry && isTop ? " mo-hl-top" : ""}`}
            >
              {v ?? ""}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 主舞台 ②：位值点阵（进位到底是什么）
// ────────────────────────────────────────────────────────────

/** 每个点该穿什么颜色：这一拍里，它是「刚乘出来的 / 送来的 / 要被捆走的 / 留下的」 */
function dotClass(i: number, place: number, plan: MulPlan, index: number): string {
  const view = viewOf(plan, index)
  const s = plan.steps[Math.min(Math.max(place, 0), plan.steps.length - 1)]
  if (view.beat === "mul") return i < s.base ? "mo-dot-base" : "mo-dot"
  if (view.beat === "add") return i < s.base ? "mo-dot-base" : "mo-dot-in"
  // 一旦算完，就按「满十成捆」分：前 `sum - write` 个点要被扎成捆送到左边，其余留下
  return i < s.sum - s.write ? "mo-dot-bundle" : "mo-dot-left"
}

function PlaceStage({ plan, index }: { plan: MulPlan; index: number }) {
  const view = viewOf(plan, index)
  const place = Math.min(Math.max(view.place, 0), plan.steps.length - 1)
  const s = plan.steps[place]
  const hideDots = view.beat === "idle"

  // 点阵里一共露几个点：乘的那一拍只露出 base（进位还没来）
  const shown = view.beat === "idle" ? 0 : view.beat === "mul" ? s.base : s.sum
  const bundling = s.sum - s.write

  const caption =
    view.beat === "idle"
      ? `等一下算${placeName(place)}`
      : view.beat === "mul"
        ? `${s.digit} × ${plan.factor} ⇒ 先画 ${s.base} 个点`
        : view.beat === "add"
          ? s.carryIn > 0
            ? `加上右边送来的 ${s.carryIn} 个（蓝色）⇒ ${s.sum} 个`
            : `右边没送来，一共 ${s.base} 个`
          : view.beat === "write"
            ? s.carryOut > 0
              ? `每 10 个扎 1 捆 ⇒ ${s.carryOut} 捆，留 ${s.write} 个`
              : `${s.sum} 个不够扎一捆 ⇒ 全部留下`
            : view.beat === "carry"
              ? s.carryOut > 0
                ? `${s.carryOut} 捆往左送到${placeName(place + 1)} ⇒ 就是「进 ${s.carryOut}」`
                : `不满 10，不用往左送`
              : `${plan.value} × ${plan.factor} = ${plan.product}`

  return (
    <div className="mo-dotstage">
      <div className="mo-dot-head">
        <MathIcon name="bundle" size={26} className="mo-dot-icon" />
        <b>位值点阵</b>
        <span>满 10 扎 1 捆，往左送</span>
      </div>

      <div className="mo-dot-eq">
        <span className="mo-dot-tag">{placeName(place)}</span>
        <b>
          {s.digit} × {plan.factor} = {s.base}
          {/* ⚠️ 没有进位时别再写一次「= 35」：`5 × 7 = 35 = 35` 读起来像两个数 */}
          {s.carryIn > 0 && (
            <>
              {" ＋ "}
              {s.carryIn} = {s.sum}
            </>
          )}
        </b>
      </div>

      {shown === 0 ? (
        <p className="mo-dot-empty">这一位是 0 个点</p>
      ) : (
        <div className="mo-dots">
          {Array.from({ length: shown }, (_, i) => (
            <span
              key={i}
              className={`mo-dot ${hideDots ? "" : dotClass(i, place, plan, index)}`}
              style={{ animationDelay: `${Math.min(i, 40) * 7}ms` }}
            />
          ))}
        </div>
      )}

      <p className="mo-dot-cap">{caption}</p>

      {view.beat !== "idle" && s.carryOut > 0 && (view.beat === "carry" || view.beat === "write") && (
        <div className="mo-bundle">
          <span className="mo-bundle-pill">×{s.carryOut} 捆</span>
          <span className="mo-bundle-arrow">← 送 {s.carryOut} 到{placeName(place + 1)}</span>
          <span className="mo-bundle-left">留 {s.write} 个</span>
        </div>
      )}
      {view.beat !== "idle" && (view.beat === "carry" || view.beat === "write") && s.carryOut === 0 && (
        <div className="mo-bundle mo-bundle-none">
          <span>共 {s.sum} 个 · 不满 10，扎不成捆</span>
        </div>
      )}

      <p className="mo-dot-hint">
        {s.sum} 个点里有 {bundling} 个扎捆送左边。
        {place === 0 && s.carryOut > 0 ? "个位不先算完，十位不知道加几。" : ""}
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 巧算对照（末尾有 0）
// ────────────────────────────────────────────────────────────

function TailCard({ plan }: { plan: MulPlan }) {
  const t = tailZeroHint(plan.value, plan.factor)
  if (!t) return null
  return (
    <div className="mo-tail">
      <div className="mo-tail-head">
        <MathIcon name="zeroTail" size={26} className="mo-tail-icon" />
        末尾有 0：这样算更快
      </div>
      <div className="mo-tail-steps">
        <div className="mo-tail-step">
          <span className="mo-tail-n">①</span>
          <span>
            先算 <b>{t.core} × {plan.factor} = {t.coreProduct}</b>
          </span>
        </div>
        <div className="mo-tail-step">
          <span className="mo-tail-n">②</span>
          <span>
            末尾有 <b>{t.zeros} 个 0</b>
          </span>
        </div>
        <div className="mo-tail-step">
          <span className="mo-tail-n">③</span>
          <span>
            补 {t.zeros} 个 0 ⇒ <b>{plan.value} × {plan.factor} = {plan.product}</b>
          </span>
        </div>
      </div>
      <p className="mo-tail-warn">⚠️ 最容易漏第 ③ 步 —— 写完回头数一数有几个 0。</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 为什么一定要从个位乘起
// ────────────────────────────────────────────────────────────

function WhyOnes() {
  return (
    <section className="card mo-why">
      <h2 className="mo-sec-title">为什么从个位乘起</h2>
      <div className="mo-why-flow">
        <span className="mo-why-box mo-why-b2">百位</span>
        <span className="mo-why-arrow">←</span>
        <span className="mo-why-box mo-why-b1">十位</span>
        <span className="mo-why-arrow">←</span>
        <span className="mo-why-box mo-why-b0">个位</span>
        <MathIcon name="arrowLeft" size={38} className="mo-why-icon" />
      </div>
      <p className="mo-why-note">
        进位只能往左走：个位攒够 10 才送得出一捆，<b>十位在个位算完前不知道该加几</b>。
      </p>
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
        setShown(new Set(MISTAKE_CASES.map((_, i) => i)))
        // ⚠️ 回调里 return 清理函数是无效的（返回值被丢弃）⇒ 定时器必须在 effect 的 cleanup 里清
        timer = window.setTimeout(() => setShown(new Set()), 1100)
        io.disconnect()
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      io.disconnect()
    }
  }, [])

  return (
    <section className="card mo-mistake" ref={ref}>
      <h2 className="mo-sec-title">最容易错的 7 个地方</h2>
      <div className="mo-mistake-list">
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
    <div className={`mo-mistake-card${revealed ? " mo-revealed" : ""}`}>
      <div className={`mo-mistake-wrong${shake ? " mo-shake" : ""}`}>
        <span className="mo-mk">❌</span> {c.wrong}
      </div>
      {revealed ? (
        <div className="mo-mistake-right">
          <div>
            <span className="mo-mk">✅</span> {c.right}
          </div>
          <p className="mo-mistake-why">{c.why}</p>
          <p className="mo-mistake-tip">💡 {c.tip}</p>
        </div>
      ) : (
        <button type="button" className="mo-btn mo-btn-sm mo-reveal" onClick={() => setRevealed(true)}>
          看正确答案
        </button>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 一步一填练习
// ────────────────────────────────────────────────────────────

interface CardState {
  stepIndex: number
  picked: string | null
  trail: { label: string; ok: boolean }[]
}

function freshCard(): CardState {
  return { stepIndex: 0, picked: null, trail: [] }
}

function SolveCard({ p, onStep, onFinished }: {
  p: MulProblem
  onStep: (right: boolean) => void
  onFinished: () => void
}) {
  const [st, setSt] = useState<CardState>(freshCard)
  const step: SolveStep | undefined = p.solveSteps[st.stepIndex]
  const answered = st.picked !== null
  const done = st.stepIndex >= p.solveSteps.length
  const isRight = answered && st.picked === step?.answer
  const isLast = st.stepIndex === p.solveSteps.length - 1

  useEffect(() => {
    setSt(freshCard())
  }, [p])

  if (done) {
    const right = st.trail.filter((t) => t.ok).length
    return (
      <div className="mo-card mo-card-done">
        <div className="mo-card-q">
          {p.value} × {p.factor} = <b>{p.product}</b> ✓
        </div>
        <p className="mo-card-note">{p.finalNote}</p>
        {p.traps.length > 0 && (
          <div className="mo-traps">
            <div className="mo-traps-head">这几个答案也常有人写：</div>
            {p.traps.map((t) => (
              <TrapRow key={t.label} t={t} />
            ))}
          </div>
        )}
        <div className="mo-card-foot">答对 {right} / {p.solveSteps.length}</div>
      </div>
    )
  }

  const choose = (opt: string) => {
    if (answered || !step) return
    setSt((s) => ({ ...s, picked: opt }))
    onStep(opt === step.answer)
  }

  const next = () => {
    if (!step) return
    setSt((s) => ({
      stepIndex: s.stepIndex + 1,
      picked: null,
      trail: [...s.trail, { label: step.label, ok: s.picked === step.answer }],
    }))
    if (isLast) onFinished()
  }

  return (
    <div className="mo-card">
      <div className="mo-card-head">
        <span className="mo-card-q">
          {p.value} × {p.factor} = ?
        </span>
        <span className="mo-card-progress">
          第 {st.stepIndex + 1} / {p.solveSteps.length} 步
        </span>
      </div>

      <div className="mo-card-trail">
        {st.trail.map((t, i) => (
          <span key={i} className={`mo-trail-pill${t.ok ? " mo-trail-ok" : " mo-trail-bad"}`}>
            {t.ok ? "✓" : "✗"} {t.label}
          </span>
        ))}
      </div>

      {step && (
        <>
          <div className="mo-card-label">{step.label}</div>
          <p className="mo-card-ask">{step.ask}</p>
          <div className="mo-opts">
            {step.options.map((o) => {
              const cls = !answered
                ? ""
                : o === step.answer
                  ? " mo-opt-ok"
                  : o === st.picked
                    ? " mo-opt-bad"
                    : " mo-opt-dim"
              return (
                <button
                  key={o}
                  type="button"
                  className={`mo-opt${cls}`}
                  onClick={() => choose(o)}
                  disabled={answered}
                >
                  {o}
                </button>
              )
            })}
          </div>
          {answered && (
            <div className={`mo-feedback${isRight ? " mo-fb-ok" : " mo-fb-bad"}`}>
              <div className="mo-fb-head">{isRight ? "✓ 答对了" : `✗ 正确答案是「${step.answer}」`}</div>
              <p className="mo-fb-tip">{step.tip}</p>
              <button type="button" className="mo-btn mo-btn-primary mo-btn-sm" onClick={next}>
                {isLast ? "完成这道题" : "下一步 →"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TrapRow({ t }: { t: MulTrap }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`mo-trap${open ? " mo-trap-open" : ""}`}>
      <button type="button" className="mo-trap-btn" onClick={() => setOpen((v) => !v)}>
        <span className="mo-trap-label">{t.label}</span>
        <span className="mo-trap-more">{open ? "收起" : "错在哪？"}</span>
      </button>
      {open && <p className="mo-trap-why">{t.why}</p>}
    </div>
  )
}

function PracticeSection() {
  const [kind, setKind] = useState<MulKind>("noCarry")
  const [set, setSet] = useState<MulProblem[]>(() => genProblemSet("noCarry", 3))
  const [stat, setStat] = useState({ right: 0, total: 0 })
  const [finished, setFinished] = useState(0)

  const reload = useCallback((k: MulKind) => {
    setKind(k)
    setSet(genProblemSet(k, 3))
    setStat({ right: 0, total: 0 })
    setFinished(0)
  }, [])

  return (
    <section className="card mo-practice">
      <h2 className="mo-sec-title">一步一填</h2>

      <div className="mo-chips">
        {KIND_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            data-mo-pkind={g.key}
            className={`mo-chip${kind === g.key ? " mo-chip-on" : ""}`}
            onClick={() => reload(g.key)}
          >
            <MathIcon name={g.icon} size={22} className="mo-chip-icon" />
            <b>{g.title}</b>
          </button>
        ))}
      </div>

      <div className="mo-score">
        答对 <b>{stat.right}</b> / {stat.total}
        {finished >= set.length && set.length > 0 && <span className="mo-score-done"> · 本组完成 🎉</span>}
      </div>

      <div className="mo-set">
        {set.map((p) => (
          <SolveCard
            key={`${p.value}-${p.factor}`}
            p={p}
            onStep={(ok) => setStat((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))}
            onFinished={() => setFinished((n) => n + 1)}
          />
        ))}
      </div>

      <div className="mo-row">
        <button type="button" className="mo-btn mo-btn-primary" onClick={() => reload(kind)}>
          ⟳ 换一组
        </button>
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────
// 页面
// ────────────────────────────────────────────────────────────

export function MathMulOnePage() {
  const navigate = useNavigate()
  const reduced = useReducedMotion()

  const [kind, setKind] = useState<MulKind>("noCarry")
  const [plan, setPlan] = useState<MulPlan>(() => genPlan("noCarry"))
  /** 当前播到时间轴第几拍（-1 = 还没开始） */
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)

  const total = plan.timeline.length
  const view = useMemo(() => viewOf(plan, index), [plan, index])

  const reset = useCallback((next: MulPlan, nextKind: MulKind) => {
    setKind(nextKind)
    setPlan(next)
    setIndex(-1)
    setPlaying(false)
  }, [])

  const pickKind = (k: MulKind) => reset(genPlan(k), k)
  const nextProblem = () => reset(genPlan(kind), kind)

  const step = useCallback(() => {
    setPlaying(false)
    setIndex((i) => Math.min(i + 1, total))
  }, [total])

  const replay = useCallback(() => {
    setIndex(-1)
    setPlaying(true)
  }, [])

  // 自动播：一拍一个 timer，按这一拍该用多久决定间隔
  useEffect(() => {
    if (!playing) return
    if (reduced) {
      // 尊重「减少动态效果」：直接跳到完成态，别一帧一帧地闪
      setIndex(plan.timeline.length)
      setPlaying(false)
      return
    }
    if (index >= plan.timeline.length) {
      setPlaying(false)
      return
    }
    const beat = index < 0 ? "mul" : plan.timeline[index].beat
    const ms = BEAT_MS[beat as Exclude<Beat, "idle" | "done">] ?? 500
    const t = window.setTimeout(() => setIndex((i) => i + 1), ms)
    return () => window.clearTimeout(t)
  }, [playing, index, plan, reduced])

  const group = KIND_GROUPS.find((g) => g.key === kind) ?? KIND_GROUPS[0]
  const finished = index >= total

  return (
    <div className="page mo-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)} type="button">
          ← 返回
        </button>
        <h1>✏️ 多位数乘一位数</h1>
      </header>

      {/* ⚠️ .module-header 是 flex ⇒ 副标题必须放 header **外面**，否则 h1 被挤成省略号 */}
      <p className="mo-sub">逐位四拍：乘 → 加进位 → 写 → 进。点阵里满 10 扎 1 捆、往左送。</p>

      {/* ── 规律卡 ── */}
      <div className="card mo-rules">
        {RULES.map((r) => (
          <div key={r.title} className="mo-rule">
            <MathIcon name={r.icon} size={34} className="mo-rule-icon" />
            <div className="mo-rule-text">
              <b className="mo-rule-title">{r.title}</b>
              <span className="mo-rule-body">{r.body}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 主舞台 ── */}
      <section className="card mo-main">
        <h2 className="mo-sec-title">🧮 竖式逐位演一遍：{plan.value} × {plan.factor}</h2>

        <div className="mo-chips">
          {KIND_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              data-mo-kind={g.key}
              className={`mo-chip${kind === g.key ? " mo-chip-on" : ""}`}
              onClick={() => pickKind(g.key)}
            >
              <MathIcon name={g.icon} size={30} className="mo-chip-icon" />
              <b>{g.title}</b>
              <span>{g.desc}</span>
            </button>
          ))}
        </div>

        <div className="mo-qbar">
          <span className="mo-q">{plan.value} × {plan.factor} = ?</span>
          <span className="mo-qtag">
            {group.title} · 积 {plan.resultDigits.length} 位
          </span>
        </div>

        <div className="mo-stage">
          <VerticalStage plan={plan} index={index} />
        </div>

        {/* ── 关键区域说明条：告诉学生「现在看这里」 ── */}
        <div className={`mo-say mo-say-${view.beat}`}>
          <div className="mo-say-head">
            <span className="mo-say-tag">{BEAT_LABEL[view.beat]}</span>
            <span className="mo-say-eq">{beatEquation(plan, index)}</span>
            <span className="mo-say-prog">
              {Math.max(0, Math.min(index + 1, total))} / {total}
            </span>
          </div>
          <p className="mo-say-text">{view.say}</p>
          {view.warn && <p className="mo-say-warn">{view.warn}</p>}
        </div>

        <div className="mo-legend">
          <span>
            <i className="mo-sw mo-sw-want" />
            正在乘的这一位
          </span>
          <span>
            <i className="mo-sw mo-sw-carry" />
            进上来的数（写在头顶）
          </span>
          <span>
            <i className="mo-sw mo-sw-write" />
            刚写下的数
          </span>
        </div>

        <div className="mo-row">
          <button type="button" className="mo-btn mo-btn-primary" onClick={replay} disabled={playing}>
            {finished ? "↻ 再演一遍" : "▶ 播一遍"}
          </button>
          <button type="button" className="mo-btn" onClick={step} disabled={finished}>
            ⏭ 下一步
          </button>
          <button type="button" className="mo-btn" onClick={() => setIndex(-1)} disabled={index < 0}>
            ⟲ 重来
          </button>
          <button type="button" className="mo-btn" onClick={nextProblem}>
            🎲 换一题
          </button>
        </div>

        {/* ── 位值点阵（与竖式同一拍，不另起一段动画）── */}
        <PlaceStage plan={plan} index={index} />

        {/* ── 巧算对照：只有末尾有 0 时才出现 ── */}
        <TailCard plan={plan} />

        {finished && (
          <div className="mo-done">
            <div className="mo-done-big">
              {plan.value} × {plan.factor} = <b>{plan.product}</b>
            </div>
            <p className="mo-done-note">
              {plan.steps.length} 位 · {plan.steps.filter((s) => s.carryOut > 0).length} 次进位
              {plan.grewTop ? " · 最前面还长出一位" : ""}
              <br />
              校验：各位拼回去 = {productFromPlan(plan)} ✓
            </p>
          </div>
        )}
      </section>

      {/* ── 为什么要从个位乘起 ── */}
      <WhyOnes />

      {/* ── 易错警示 ── */}
      <MistakeSection />

      {/* ── 练习 ── */}
      <PracticeSection />
    </div>
  )
}
