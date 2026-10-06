/** 数量关系与交换 —— 教学演示页
 *
 * ── 这一页只演一件事：**换个位置会怎样** ──────────────────────────
 *   一共    两边同色 ⇒ 换了**什么都不变**
 *   比多少  一青一橙 ⇒ 换了，**词从「多」翻成「少」**
 *   倍数    一青一橙 ⇒ 换了，**从 n 倍掉到 1/n**
 *   平均分  一青一橙 ⇒ 换了，**问的已经不是同一个问题**
 *
 * ── ★ 颜色标的是「角色」，不是「大小」 ──────────────────────────
 * 「按大小上色」（多的红、少的蓝）在这一页必然失效：交换前后 7 还是 7、
 * 4 还是 4，颜色一模一样，学生看不出发生过任何事。
 * 所以颜色**挂在槽位上**：交换时量在**位移**、槽位不动 ⇒ 两个色块**对调**。
 * 学生看到的是「还是那 4 个，但它变成橙色的了」——一句话就懂：
 * **它的角色变了，所以结论变了。**
 *
 * 落位与染色必须**同一帧**发生（`flying → landed` 一次 setState 两处变）：
 * 位移的终点与槽位原位重合，于是肉眼看不出接缝，只看到颜色换了。
 *
 * 所有数字、句子、点阵排布都来自 `./relations`，页面自己不做任何运算，
 * 也不自己判断该说「多」还是「少」。
 */

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import MathIcon from "../../components/MathIcon"
import {
  EFFECT_LABEL,
  KIND_GROUPS,
  KIND_LABEL,
  MISTAKE_CASES,
  ROLE_META,
  RULES,
  SWAP_TABLE,
  generateProblem,
  generateProblems,
  type MistakeCase,
  type RelKind,
  type RelLine,
  type RelProblem,
  type Role,
  type Shape,
  type SolveStep,
} from "./relations"

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

/**
 * ★ 类名一律用**字面量表**查，不写模板拼接（`rr-say-${phase}`）。
 * 原因有二：
 *   1. `tools/cssSkillMark.py` 靠「tsx 里出现的字面类名」判定样式归属 ——
 *      拼出来的类名它找不到，会把本页的规则误判成共享样式，门禁直接红。
 *   2. 拼接出来的类名改名字时编译器不报错，会静默丢样式。
 */
const SAY_CLASS: Record<Phase, string> = {
  idle: "rr-say rr-say-idle",
  relate: "rr-say rr-say-relate",
  flying: "rr-say rr-say-flying",
  landed: "rr-say rr-say-landed",
  check: "rr-say rr-say-check",
}

type SentenceTone = "plain" | "same" | "changed"

const SENTENCE_CLASS: Record<SentenceTone, string> = {
  plain: "rr-sentence rr-sentence-plain",
  same: "rr-sentence rr-sentence-same",
  changed: "rr-sentence rr-sentence-changed",
}

/**
 * ★ 位移由**类名驱动 keyframes**，不用内联 `transform`。
 *   内联 transform 只能靠 transition 补间，两块会**正面穿过彼此**、
 *   在中点叠成一个数（移项页踩过这个坑）；两组 keyframes 才能让它们上下错开。
 *   同一个理由，类名同样写成字面量表。
 */
type FlyDir = "toRight" | "toLeft" | "none"

const WRAP_CLASS: Record<FlyDir, string> = {
  toRight: "rr-block-wrap rr-fly-to-r",
  toLeft: "rr-block-wrap rr-fly-to-l",
  none: "rr-block-wrap",
}

const MINI_CLASS: Record<FlyDir, string> = {
  toRight: "rr-mini rr-fly-to-r",
  toLeft: "rr-mini rr-fly-to-l",
  none: "rr-mini",
}

/** 槽位角色 → 内联 CSS 变量（颜色只从 ROLE_META 来，页面不自己发明色值） */
function roleStyle(role: Role): React.CSSProperties {
  const m = ROLE_META[role]
  return { ["--rr-fg" as string]: m.fg, ["--rr-bg" as string]: m.bg, ["--rr-dot" as string]: m.dot }
}

/** 点阵格子间距（px）。★ 定宽是「不量尺寸也能精确落位」的前提 */
const PITCH = 10
const CELL = 7

/**
 * 点阵 —— 绝对定位 + `transform` 位移。
 * ★ 容器尺寸写死成「最大可能」，于是**排布变化时容器不重排**，
 * 每个点自己 `transition` 到新位置 ⇒ 平均分那 12 个点会真的「重排一遍」。
 *
 * ★ 点一律**从左上角起算，不居中**。居中是错的：
 *   · 「3 行 × 7」与「1 行 × 7」居中了就一样高 ⇒ 倍数看不见；
 *   · 「13 个」与「8 个」居中了就两头各缩一点 ⇒ 差几个数不出来。
 *   容器的宽度/高度都取 `max`（两块**同尺寸**），所以比的是
 *   **「填进去多长」**，而不是「画在哪儿」——这也是底轨存在的意义（见 App.css）。
 */
function DotGrid({ shape, value, max }: { shape: Shape; value: number; max: Shape }) {
  const w = max.cols * PITCH
  const h = max.rows * PITCH
  return (
    <div className="rr-grid" style={{ width: w, height: h }} data-rr-grid={`${shape.rows}x${shape.cols}`}>
      {Array.from({ length: value }, (_, i) => {
        const r = Math.floor(i / shape.cols)
        const c = i % shape.cols
        return (
          <span
            key={i}
            className="rr-cell"
            style={{
              width: CELL,
              height: CELL,
              transform: `translate(${c * PITCH}px, ${r * PITCH}px)`,
            }}
          />
        )
      })}
    </div>
  )
}

/** 一个量块：名字 + 点阵 + 数值。颜色由**槽位角色**给（不是由数值给） */
function QBlock({ who, value, unit, shape, max, role }: {
  who: string
  value: number
  unit: string
  shape: Shape
  max: Shape
  role: Role
}) {
  return (
    <div className="rr-block" style={roleStyle(role)}>
      <span className="rr-block-role">{ROLE_META[role].label}</span>
      <span className="rr-block-who">{who}</span>
      <DotGrid shape={shape} value={value} max={max} />
      <span className="rr-block-val">
        {value} {unit}
      </span>
    </div>
  )
}

/** 关系句：把「要对照的那一小段」挑出来高亮 */
function Sentence({ line, tone }: { line: RelLine; tone: SentenceTone }) {
  const i = line.text.indexOf(line.key)
  return (
    <p className={SENTENCE_CLASS[tone]} data-rr-key={line.key}>
      {i < 0 ? (
        line.text
      ) : (
        <>
          {line.text.slice(0, i)}
          <b className="rr-key">{line.key}</b>
          {line.text.slice(i + line.key.length)}
        </>
      )}
    </p>
  )
}

// ────────────────────────────────────────────────────────────
// 时间轴
// ────────────────────────────────────────────────────────────

type Phase = "idle" | "relate" | "flying" | "landed" | "check"

const ORDER: Phase[] = ["idle", "relate", "flying", "landed", "check"]

/** 每一阶段**停留多久**再自动进下一阶段（ms） */
const DUR: Record<Phase, number> = { idle: 700, relate: 1500, flying: 950, landed: 1000, check: 0 }

const PHASE_LABEL: Record<Phase, string> = {
  idle: "① 摆量",
  relate: "② 看关系",
  flying: "③ 换位置",
  landed: "④ 落位",
  check: "⑤ 再查一遍",
}

const PHASE_SAY: Record<Phase, string> = {
  idle: "先看清两边各是几",
  relate: "看清这句话在说什么",
  flying: "换个位置 —— 看好了",
  landed: "颜色跟着槽位走，不跟着数走",
  check: "同一个数，说法变了没有",
}

// ────────────────────────────────────────────────────────────
// 主舞台
// ────────────────────────────────────────────────────────────

function Stage({ p, phase }: { p: RelProblem; phase: Phase }) {
  const flying = phase === "flying"
  const landed = phase === "landed" || phase === "check"
  // 交换后：两个量对调槽位（**槽位角色不动** ⇒ 颜色跟着槽位走）
  const leftQ = landed ? p.right : p.left
  const rightQ = landed ? p.left : p.right
  const [roleL, roleR] = p.slotRole

  /** 飞行方向：左块去右、右块去左；落位那一帧同时撤掉动画 ⇒ 位置重合、看不出接缝 */
  const dirL: FlyDir = flying ? "toRight" : "none"
  const dirR: FlyDir = flying ? "toLeft" : "none"

  if (p.kind === "share" && p.shareGrid) {
    const g = landed ? p.shareGrid.after : p.shareGrid.before
    const max: Shape = {
      rows: Math.max(p.shareGrid.before.rows, p.shareGrid.after.rows),
      cols: Math.max(p.shareGrid.before.cols, p.shareGrid.after.cols),
    }
    return (
      <div className="rr-stage rr-stage-share" data-rr-stage="share">
        <div className="rr-share-total" style={roleStyle(landed ? "whole" : "whole")}>
          <span className="rr-block-role">总数</span>
          <DotGrid shape={g} value={p.shareGrid.total} max={max} />
          <span className="rr-block-val">
            {p.shareGrid.total} 个
          </span>
        </div>
        <div className="rr-slots">
          <div className="rr-slot" data-rr-slot="l">
            <div className={MINI_CLASS[dirL]} style={roleStyle(roleL)}>
              <span className="rr-mini-role" style={{ color: ROLE_META[roleL].fg }}>
                {ROLE_META[roleL].label}
              </span>
              <b>{leftQ.value}</b>
              <span>{leftQ.unit}</span>
            </div>
          </div>
          <div className="rr-slot" data-rr-slot="r">
            <div className={MINI_CLASS[dirR]} style={roleStyle(roleR)}>
              <span className="rr-mini-role" style={{ color: ROLE_META[roleR].fg }}>
                {ROLE_META[roleR].label}
              </span>
              <b>{rightQ.value}</b>
              <span>{rightQ.unit}</span>
            </div>
          </div>
        </div>
        <p className="rr-share-cap">
          {landed
            ? `${p.nums.after[0]} 份 × 每份 ${p.nums.after[1]} 个 —— ${g.rows} 行 ${g.cols} 列`
            : `分成 ${p.nums.before[0]} 份，每份 ${p.nums.before[1]} 个 —— ${g.rows} 行 ${g.cols} 列`}
        </p>
      </div>
    )
  }

  // 一共 / 比多少 / 倍数：两个量块并排；比较与一共共用「同宽条」便于比长短
  const max: Shape = { rows: Math.max(leftQ.shape.rows, rightQ.shape.rows), cols: Math.max(leftQ.shape.cols, rightQ.shape.cols) }
  const common: Shape = p.kind === "times" ? max : { rows: 1, cols: max.cols }
  return (
    <div className="rr-stage" data-rr-stage={p.kind}>
      <div className="rr-slots">
        <div className="rr-slot" data-rr-slot="l">
          <div className={WRAP_CLASS[dirL]}>
            <QBlock {...leftQ} max={common} role={roleL} />
          </div>
        </div>
        <div className="rr-slot" data-rr-slot="r">
          <div className={WRAP_CLASS[dirR]}>
            <QBlock {...rightQ} max={common} role={roleR} />
          </div>
        </div>
      </div>
      <div className="rr-result" style={roleStyle("whole")}>
        <span className="rr-result-label">{p.result.label}</span>
        <b>
          {p.result.value} {p.result.unit}
        </b>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 易错警示
// ────────────────────────────────────────────────────────────

function MistakeCard({ c, shake }: { c: MistakeCase; shake: boolean }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="rr-mistake-card">
      <div className={`rr-mistake-wrong${shake ? " rr-shake" : ""}`}>
        <span className="rr-mk">❌</span>
        <span>{c.wrong}</span>
      </div>
      {revealed ? (
        <div className="rr-mistake-right">
          <div className="rr-mistake-line">
            <span className="rr-mk">✅</span>
            <span>{c.right}</span>
          </div>
          <p className="rr-mistake-why">{c.why}</p>
          <p className="rr-mistake-tip">💡 {c.tip}</p>
        </div>
      ) : (
        <button type="button" className="rr-btn rr-btn-sm rr-reveal" onClick={() => setRevealed(true)}>
          看正确答案
        </button>
      )}
    </div>
  )
}

function MistakeSection() {
  const [shown, setShown] = useState<Set<number>>(new Set())
  const [ref, setRef] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!ref) return
    let timer: number | undefined
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          setShown((s) => new Set(s).add(1))
          // 先抖红卡，1.1s 后再给人看绿卡 —— 留一点「想想再揭晓」的节奏
          if (timer === undefined) timer = window.setTimeout(() => setShown(new Set([0, 1, 2, 3, 4, 5])), 1100)
        }
        io.disconnect()
      },
      { threshold: 0.2 },
    )
    io.observe(ref)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      io.disconnect()
    }
  }, [ref])

  return (
    <section className="card rr-mistake" ref={setRef}>
      <h2 className="rr-sec-title">最容易错的 6 个地方</h2>
      <div className="rr-mistake-list">
        {MISTAKE_CASES.map((c, i) => (
          <div key={c.wrong} className="rr-mistake-item">
            <div className="rr-mistake-title">
              <MathIcon name={c.icon} size={20} className="rr-mistake-icon" />
              <b>{c.title}</b>
            </div>
            <MistakeCard c={c} shake={shown.has(i)} />
          </div>
        ))}
      </div>
    </section>
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

function SolveCard({ p, onStep, onFinished }: {
  p: RelProblem
  onStep: (right: boolean) => void
  onFinished: () => void
}) {
  const [st, setSt] = useState<CardState>({ stepIndex: 0, picked: null, trail: [] })
  useEffect(() => {
    setSt({ stepIndex: 0, picked: null, trail: [] })
  }, [p])

  const step: SolveStep | undefined = p.solveSteps[st.stepIndex]
  const answered = st.picked !== null
  const done = st.stepIndex >= p.solveSteps.length
  const isRight = answered && st.picked === step?.answer
  const isLast = st.stepIndex === p.solveSteps.length - 1

  if (done) {
    const right = st.trail.filter((t) => t.ok).length
    return (
      <div className="rr-card rr-card-done">
        <div className="rr-card-q">
          {KIND_LABEL[p.kind]}：{p.after.text}
        </div>
        <p className="rr-card-note">{p.reveal}</p>
        <p className="rr-card-note rr-card-inv">{p.invariant}</p>
        <div className="rr-card-foot">
          答对 {right} / {p.solveSteps.length}
        </div>
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
    <div className="rr-card">
      <div className="rr-card-head">
        <span className="rr-card-q">{p.before.text}</span>
        <span className="rr-card-progress">
          第 {st.stepIndex + 1} / {p.solveSteps.length} 步
        </span>
      </div>

      <div className="rr-card-trail">
        {st.trail.map((t, i) => (
          <span key={i} className={`rr-trail-pill${t.ok ? " rr-trail-ok" : " rr-trail-bad"}`}>
            {t.ok ? "✓" : "✗"} {t.label}
          </span>
        ))}
      </div>

      {step && (
        <>
          <div className="rr-card-label">{step.label}</div>
          <p className="rr-card-ask">{step.ask}</p>
          <div className="rr-opts">
            {step.options.map((o) => {
              const cls = !answered
                ? ""
                : o === step.answer
                  ? " rr-opt-ok"
                  : o === st.picked
                    ? " rr-opt-bad"
                    : " rr-opt-dim"
              return (
                <button key={o} type="button" className={`rr-opt${cls}`} onClick={() => choose(o)} disabled={answered}>
                  {o}
                </button>
              )
            })}
          </div>
          {answered && (
            <div className={`rr-feedback${isRight ? " rr-fb-ok" : " rr-fb-bad"}`}>
              <div className="rr-fb-head">{isRight ? "✓ 答对了" : `✗ 正确答案是「${step.answer}」`}</div>
              <p className="rr-fb-tip">{step.tip}</p>
              <button type="button" className="rr-btn rr-btn-primary rr-btn-sm" onClick={next}>
                {isLast ? "完成这道题" : "下一步 →"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PracticeSection() {
  const [kind, setKind] = useState<RelKind>("compare")
  const [set, setSet] = useState<RelProblem[]>(() => generateProblems(3, "compare"))
  const [stat, setStat] = useState({ right: 0, total: 0 })
  const [finished, setFinished] = useState(0)

  const reload = useCallback((k: RelKind) => {
    setKind(k)
    setSet(generateProblems(3, k))
    setStat({ right: 0, total: 0 })
    setFinished(0)
  }, [])

  return (
    <section className="card rr-practice">
      <h2 className="rr-sec-title">一步一填</h2>

      <div className="rr-chips">
        {KIND_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            data-rr-pkind={g.key}
            className={`rr-chip${kind === g.key ? " rr-chip-on" : ""}`}
            onClick={() => reload(g.key)}
          >
            <MathIcon name={g.icon} size={22} className="rr-chip-icon" />
            <b>{g.title}</b>
          </button>
        ))}
      </div>

      <div className="rr-score">
        答对 <b>{stat.right}</b> / {stat.total}
        {finished >= set.length && set.length > 0 && <span className="rr-score-done"> · 本组完成 🎉</span>}
      </div>

      <div className="rr-set">
        {set.map((p) => (
          <SolveCard
            key={p.id}
            p={p}
            onStep={(ok) => setStat((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))}
            onFinished={() => setFinished((n) => n + 1)}
          />
        ))}
      </div>

      <div className="rr-row">
        <button type="button" className="rr-btn rr-btn-primary" onClick={() => reload(kind)}>
          ⟳ 换一组
        </button>
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────
// 页面
// ────────────────────────────────────────────────────────────

export function MathRelationsPage() {
  const navigate = useNavigate()
  const reduced = useReducedMotion()

  const [kind, setKind] = useState<RelKind>("compare")
  const [problem, setProblem] = useState<RelProblem>(() => generateProblem("compare")!)
  const [phase, setPhase] = useState<Phase>("idle")
  const [playing, setPlaying] = useState(false)

  // ★ newProblem 的依赖里**没有** kind —— 否则 setKind 会让它重建，
  //   触发下面的初始 effect 又跑一遍，表现为「点 chip 完全没反应」
  const newProblem = useCallback((k?: RelKind) => {
    const p = generateProblem(k)
    if (!p) return
    setProblem(p)
    setPhase("idle")
    setPlaying(false)
  }, [])

  const pickKind = (k: RelKind) => {
    setKind(k)
    newProblem(k)
  }

  // 自动播：一阶段一个 timer
  useEffect(() => {
    if (!playing) return
    if (reduced) {
      setPhase("check")
      setPlaying(false)
      return
    }
    const i = ORDER.indexOf(phase)
    if (i < 0 || i >= ORDER.length - 1) {
      setPlaying(false)
      return
    }
    const t = window.setTimeout(() => setPhase(ORDER[i + 1]), DUR[phase])
    return () => window.clearTimeout(t)
  }, [playing, phase, reduced])

  const step = useCallback(() => {
    setPlaying(false)
    setPhase((cur) => {
      const i = ORDER.indexOf(cur)
      return i >= ORDER.length - 1 ? cur : ORDER[i + 1]
    })
  }, [])

  const replay = () => {
    setPhase("idle")
    setPlaying(true)
  }

  const group = KIND_GROUPS.find((g) => g.key === kind) ?? KIND_GROUPS[0]
  const finished = phase === "check"
  const showAfter = phase === "landed" || phase === "check"

  return (
    <div className="page rr-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)} type="button">
          ← 返回
        </button>
        <h1>🔁 数量关系与交换</h1>
      </header>

      {/* ⚠️ .module-header 是 flex ⇒ 副标题必须放 header **外面** */}
      <p className="rr-sub">一共 · 比多少 · 倍数 · 平均分 —— 换个位置，谁变了、谁没变。</p>

      {/* ── 规律卡：颜色说明 ── */}
      <div className="card rr-rules">
        {RULES.map((r) => (
          <div key={r.title} className="rr-rule">
            <MathIcon name={r.icon} size={30} className="rr-rule-icon" />
            <div className="rr-rule-text">
              <b className="rr-rule-title">{r.title}</b>
              <span className="rr-rule-body">{r.body}</span>
            </div>
          </div>
        ))}
        <div className="rr-legend">
          <span className="rr-legend-item" style={roleStyle("base")}>
            <i />
            基准量
          </span>
          <span className="rr-legend-item" style={roleStyle("cmp")}>
            <i />
            比较量
          </span>
          <span className="rr-legend-item" style={roleStyle("part")}>
            <i />
            对等（两边一样）
          </span>
        </div>
      </div>

      {/* ── 主舞台 ── */}
      <section className="card rr-main">
        <h2 className="rr-sec-title">🔁 换个位置试试</h2>

        <div className="rr-chips">
          {KIND_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              data-rr-kind={g.key}
              className={`rr-chip${kind === g.key ? " rr-chip-on" : ""}${
                g.kindOfSwap === "dir" ? " rr-chip-dir" : " rr-chip-both"
              }`}
              onClick={() => pickKind(g.key)}
            >
              <MathIcon name={g.icon} size={30} className="rr-chip-icon" />
              <b>{g.title}</b>
              <span>{g.desc}</span>
            </button>
          ))}
        </div>

        <div className="rr-qbar">
          <span className="rr-qtag">
            {group.kindOfSwap === "both" ? "同色 · 换了不变" : "异色 · 换了就变"}
          </span>
          <span className="rr-qphase" data-rr-phase={phase}>
            {PHASE_LABEL[phase]}
          </span>
        </div>

        <Stage p={problem} phase={phase} />

        <div className={SAY_CLASS[phase]} data-rr-say={phase}>
          <p className="rr-say-text">{PHASE_SAY[phase]}</p>
          {phase === "idle" ? (
            <Sentence line={problem.before} tone="plain" />
          ) : showAfter ? (
            <Sentence line={problem.after} tone={EFFECT_LABEL[problem.effect].changed ? "changed" : "same"} />
          ) : (
            <Sentence line={problem.before} tone="plain" />
          )}
          {finished && (
            <p className="rr-say-reveal">
              {problem.reveal}　　
              <span className="rr-say-inv">{problem.invariant}</span>
            </p>
          )}
          {problem.factorSwap && finished && (
            <p className="rr-say-extra">★ 换个别的位置就不一样了：{problem.factorSwap.text}</p>
          )}
        </div>

        <div className="rr-row">
          <button type="button" className="rr-btn rr-btn-primary" onClick={replay} disabled={playing}>
            {finished ? "↻ 再演一遍" : "▶ 播一遍"}
          </button>
          <button type="button" className="rr-btn" onClick={step} disabled={finished}>
            ⏭ 下一步
          </button>
          <button type="button" className="rr-btn" onClick={() => setPhase("idle")} disabled={phase === "idle"}>
            ⟲ 重来
          </button>
          <button type="button" className="rr-btn" onClick={() => newProblem(kind)}>
            🎲 换一题
          </button>
        </div>
      </section>

      {/* ── 四类对照（一条纲） ── */}
      <section className="card rr-table-card">
        <h2 className="rr-sec-title">一条纲：哪种能换、哪种不能</h2>
        <div className="rr-table">
          {SWAP_TABLE.map((row) => {
            const changed = EFFECT_LABEL[row.effect].changed
            return (
              <div key={row.kind} className={`rr-trow${changed ? " rr-trow-changed" : ""}`} data-rr-row={row.kind}>
                <div className="rr-tcell rr-tname">
                  <MathIcon name={row.icon} size={20} className="rr-tname-icon" />
                  <b>{row.title}</b>
                </div>
                <div className="rr-tcell rr-tbef">{row.before}</div>
                <div className="rr-tcell rr-tarrow">⇄</div>
                <div className="rr-tcell rr-taft">{row.after}</div>
                <div className="rr-tcell rr-tverdict">
                  <span className={`rr-verdict${changed ? " rr-verdict-bad" : " rr-verdict-ok"}`}>
                    {EFFECT_LABEL[row.effect].label}
                  </span>
                  <span className="rr-tnote">{row.note}</span>
                </div>
              </div>
            )
          })}
        </div>
        <p className="rr-table-foot">
          看到<span className="rr-tip-both">两边同色</span>就知道能换；看到
          <span className="rr-tip-cmp">橙</span>/<span className="rr-tip-base">绿</span>就知道换了会变。
        </p>
      </section>

      <MistakeSection />
      <PracticeSection />
    </div>
  )
}
