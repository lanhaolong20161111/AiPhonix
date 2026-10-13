/** 句子小医生 —— 提示语标点 + 修改病句，两册练习合一页
 *
 * ── 这一页要练的两件事，其实是同一件事 ─────────────────────────────
 * 标点（说话句）和病句（修改符号）在课本里分属两个语文园地，但孩子犯的错是同一个：
 * **把句子当成一串字，而不是一个「有部件、有停顿」的结构**。
 *   · 提示语标点：找不出「谁在说」，就不知道在哪儿下冒号、在哪儿合引号；
 *   · 修改病句：找不出「哪个部件坏了」，就只好整句划掉重写。
 * 所以两册共用同一套动作：**先定位（点出来）→ 再决定（选标点 / 选手术刀）→ 最后讲理由**。
 *
 * ── 三个按钮的分工（刻意不重叠）──────────────────────────────────
 *   🔊 读一读 —— 读**孩子当前填的样子**。标点没填全就会读成一口气憋到底，
 *               「听着别扭」本身就是最直接的反馈；听完再填，比先看答案有用。
 *               看答案之后多出一个「读标准答案」的入口，用来对照。
 *   ✨ 提  示 —— 只给通关口诀和「该往哪儿看」，不给答案。
 *   👀 看答案 —— 把每空的标点和理由摊开。
 *
 * ── 判对为什么用「前缀」而不是「相等」────────────────────────────
 * 一个空位常常要写两个标点（「：“」= 冒号 + 前引号）。孩子先点冒号时，
 * 既不算对也不算错，只是「还没写完」——所以按下述四态判：
 *   空 / 正好等于答案（对）/ 是某个答案的前缀（待续，中性）/ 其余（错）。
 * 这样就不会「点第一下就报红」，把正在操作的正常过程判成错误。
 *
 * ── 两个「看得见」的辅助（都要孩子自己点，不自动给）──────────────
 *   🔆 提示语在哪儿（标点册）—— 把提示语那一段高亮、并在牌子上标出「在前/在中/在后」。
 *      为什么不默认打开：**「找出谁在说」本来就是这一册要练的那件事**，
 *      一直亮着等于把题做了。它是给卡住的孩子一个台阶，不是给所有人发答案。
 *   ✏️ 画  笔（两册都有）—— 打开后可以在「订正栏」上随手画。修改符号本来就该手画：
 *      课本第一关留的作业就是「请画出三种手术刀的样子」。孩子先自己画，
 *      再对照下面自动打出来的红笔标记，比直接看答案印象深得多。
 *
 * ── 病句册为什么把红笔画在**原句**上 ─────────────────────────────
 * 原来的做法是：选完刀、选完病因，最后给一句「订正后（参考答案）」。
 * 可孩子真正要学的是**在原句上指出哪一处坏了**——那才是修改符号的用场。
 * 所以现在只要某一处诊断对了，那处的符号就立刻画到原句上（框住病灶、
 * 引线牵到订正栏写字）；全部看答案时把所有处一起画出来。
 * 位置不靠 diff 猜，由内容里的 SpotMark 显式给出，并由 marks.test.ts
 * 的「重建 == fixed」钉死 —— 见 data.ts 里 SpotMark 的注释。
 *
 * ── 记录口径 ─────────────────────────────────────────────────
 * 「已掌握」记账后不再因为改动而撤销（除非按「重来」）——孩子做对过就值得留痕，
 * 后面手滑点乱不该把成绩抹掉。进度存在 localStorage，换设备不同步（这是练习页，不需要）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { useTts } from "../../hooks/useTts"
import {
  FIX_LEVELS,
  FIX_TOOLS,
  PUNCT_KEYS,
  PUNCT_LEVELS,
  SLOT_HINT,
  type FixTool,
  type PunctItem,
  type PunctSlot,
  type SpotMark,
} from "./data"
import { describeMark, locateMark } from "./marks"
import { TAG_POS_LABEL, tagPartIndexOf, tagPositionOf } from "./tags"

type Mode = "punct" | "fix"

interface PItemState {
  /** 与 item.slots 等长；无标点的空位恒为 "" */
  vals: string[]
  hint: boolean
  revealed: boolean
  /** 🔆 是否点亮提示语 */
  tagOn: boolean
}

interface FItemState {
  tools: (FixTool | "")[]
  picks: number[]
  hint: boolean
  revealed: boolean
}

type SlotState = "empty" | "typing" | "ok" | "wrong"

const STORE_KEY = "sd_solved_v1"

/** 四态判定：空 / 待续 / 对 / 错（见文件头「判对为什么用前缀」） */
function slotStateOf(val: string, s: PunctSlot): SlotState {
  if (!val) return "empty"
  const all = s.ok ? [s.a, ...s.ok] : [s.a]
  if (all.includes(val)) return "ok"
  if (all.some((x) => x.length > val.length && x.startsWith(val))) return "typing"
  return "wrong"
}

/** 把「孩子填成什么样」拼成一句话（用于 🔊 读一读） */
function composeSentence(item: PunctItem, vals: string[]): string {
  let out = vals[0] ?? ""
  item.parts.forEach((p, i) => {
    out += p + (vals[i + 1] ?? "")
  })
  return out
}

const emptyP = (n: number): PItemState => ({
  vals: Array.from({ length: n }, () => ""),
  hint: false,
  revealed: false,
  tagOn: false,
})

const emptyF = (n: number): FItemState => ({
  tools: Array.from({ length: n }, () => "" as FixTool | ""),
  picks: Array.from({ length: n }, () => -1),
  hint: false,
  revealed: false,
})

function loadSolved(): Record<string, true> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, true>) : {}
  } catch {
    return {}
  }
}

function saveSolved(m: Record<string, true>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(m))
  } catch {
    /* 隐私模式等写不了 → 不影响使用 */
  }
}

/**
 * 五个修改符号的实际画法（红笔）。
 *
 * 这是**符号卡**上的符号真源 —— 画在原句上的那种「现场标记」见 <MarkedSentence />，
 * 那里是逐个笔画贴着字画的，形状不同（一个是图标，一个是标记）。
 * 画法依据课本范例（不是网上流传的「圆圈版」）：
 *   改正 = 左下小方框（错的）+ 引线 + 右上方框（对的）
 *   增补 = 方框（要补的字）+ 横平线 → 竖下 → 末端「人」形小分叉（插入点）
 *   删除 = 方框（要删的）+ 右上一条藤，藤上两个小环
 *   对调 = 一条折线，形如两节城垛（下—右—上—右—下），直连紧挨的两处
 *   移动 = 方框（要移的）+ 横线向右 → 上折 → 顶端「Y」形分叉（目标位）
 *
 * stroke 写死红色而不跟随 currentColor：修改符号本来就是红笔写的，
 * 而且按钮选中态用的是边框和底色，符号跟着变色反而让孩子以为「符号变了」。
 */
function FixSign({ tool }: { tool: FixTool }) {
  const p = {
    fill: "none",
    stroke: "#dc2626",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
  return (
    <svg className="sd-sign" viewBox="0 0 44 30" aria-hidden="true">
      {tool === "改正" && (
        <>
          <rect x="1.5" y="16.5" width="16" height="11" rx="2" {...p} />
          <rect x="26.5" y="3.5" width="16" height="12" rx="2" {...p} />
          <path d="M17.5,17.5 L26.5,10" {...p} />
        </>
      )}
      {tool === "增补" && (
        <>
          <rect x="27.5" y="1.5" width="15" height="10" rx="2" {...p} />
          <path d="M27.5,6.5 L12,6.5 L12,17" {...p} />
          <path d="M8,22.5 L12,17 L16,21.5" {...p} />
        </>
      )}
      {tool === "删除" && (
        <>
          <rect x="1.5" y="14.5" width="18" height="12" rx="2" {...p} />
          <path d="M19.5,14.5 Q 29,5 40,4" {...p} />
          <circle cx="26.5" cy="10.8" r="2.4" {...p} />
          <circle cx="32" cy="7.6" r="2.4" {...p} />
        </>
      )}
      {tool === "对调" && <path d="M6,4 L6,22 L16,22 L16,5 L30,5 L30,24" {...p} />}
      {tool === "移动" && (
        <>
          <rect x="1.5" y="13.5" width="17" height="11" rx="2" {...p} />
          <path d="M18.5,19 L36,19 L36,9" {...p} />
          <path d="M30,2.5 L36,9 L42,3.5" {...p} />
        </>
      )}
    </svg>
  )
}

// ──────────────────────────────────────────────────────────────
//  原句上的红笔标记
// ──────────────────────────────────────────────────────────────

/** 一处要画在原句上的框 */
interface MarkBox {
  start: number
  end: number
  tool: FixTool
  /** cut = 病灶本身；with = 对调/移动的另一处；at = 纯插入的插入点（零宽） */
  role: "cut" | "with" | "at"
  put?: string
}

/**
 * 把原句按病灶切成「红笔标记 + 普通文字」交错的一串。
 *
 * 每处标记都紧贴在**它框住的那几个字**上，靠 position:relative 的子元素
 * 往上「长」出引线/方框/藤——不用量坐标，句子折行也不会画歪。
 * 缺点也明说：**跨行的长引线画不出来**（比如「移动」要挪到上一行的某处），
 * 所以移动、对调两处用 ① ② 编号配对，而不是硬拉一条穿过好几行的线。
 */
function MarkedSentence({ text, marks }: { text: string; marks: { tool: FixTool; mark: SpotMark }[] }) {
  const nodes = useMemo(() => {
    const boxes: MarkBox[] = []
    for (const { tool, mark } of marks) {
      const g = locateMark(text, mark)
      if (g.cut) boxes.push({ start: g.cut[0], end: g.cut[1], tool, role: "cut", put: mark.put })
      if (g.with) boxes.push({ start: g.with[0], end: g.with[1], tool, role: "with", put: mark.put })
      if (!g.cut && !g.with && g.at !== null) boxes.push({ start: g.at, end: g.at, tool, role: "at", put: mark.put })
    }
    boxes.sort((a, b) => a.start - b.start || a.end - b.end)

    const out: { key: string; node: React.ReactNode | string }[] = []
    let cur = 0
    boxes.forEach((b, i) => {
      if (b.start > cur) out.push({ key: `t${i}`, node: text.slice(cur, b.start) })
      const inner = text.slice(b.start, b.end)
      const boxed = b.tool === "改正" || b.tool === "删除" || b.role === "cut"
      out.push({
        key: `b${i}`,
        node: (
          <span className={`sd-mk sd-mk-${b.role}${boxed ? " sd-mk-box" : ""}`}>
            {inner}
            {/* 改正 / 增补（换+补那种）：引线牵到订正栏，写上新的字 */}
            {(b.tool === "改正" || b.tool === "增补") && b.role === "cut" && (
              <>
                <svg className="sd-lead" viewBox="0 0 30 16" aria-hidden="true">
                  <path d="M1,15 L27,2" />
                </svg>
                <span className="sd-putbox">{b.put}</span>
              </>
            )}
            {b.tool === "删除" && b.role === "cut" && (
              <svg className="sd-vine" viewBox="0 0 32 14" aria-hidden="true">
                <path d="M1,13 Q15,2 31,2" />
                <circle cx="13" cy="6.8" r="2" />
                <circle cx="22" cy="3.6" r="2" />
              </svg>
            )}
            {/* 增补：方框(新字) + 竖线 + 「人」形分叉，分叉的尖就落在插入点上 */}
            {b.tool === "增补" && b.role === "at" && (
              <>
                <svg className="sd-fork" viewBox="0 0 16 22" aria-hidden="true">
                  <path d="M8,1 L8,14" />
                  <path d="M1,21 L8,14 L15,21" />
                </svg>
                <span className="sd-putbox sd-putbox-add">{b.put}</span>
              </>
            )}
            {/* 对调：两个框紧挨着，中间架一条两节城垛的折线（课本画法） */}
            {b.tool === "对调" && b.role === "cut" && (
              <svg className="sd-crenel" viewBox="0 0 30 22" aria-hidden="true">
                <path d="M2,2 L2,19 L14,19 L14,2 L26,2 L26,19" />
              </svg>
            )}
            {/* 移动：源处画框挂 ①，目标处画「人」形分叉挂 ②。
                跨行时不硬拉一条穿过好几行的引线 —— 用编号配对，孩子照样看得出谁搬到谁那儿。 */}
            {b.tool === "移动" && b.role === "cut" && <span className="sd-chip">①</span>}
            {b.tool === "移动" && b.role === "with" && (
              <>
                <svg className="sd-fork" viewBox="0 0 16 22" aria-hidden="true">
                  <path d="M8,1 L8,14" />
                  <path d="M1,21 L8,14 L15,21" />
                </svg>
                <span className="sd-chip">②</span>
              </>
            )}
          </span>
        ),
      })
      cur = b.end
    })
    if (cur < text.length) out.push({ key: "tail", node: text.slice(cur) })
    return out
  }, [text, marks])

  return (
    <p className="sd-case">
      {nodes.map((n) => (
        <span key={n.key}>{n.node}</span>
      ))}
    </p>
  )
}

// ──────────────────────────────────────────────────────────────
//  画笔层
// ──────────────────────────────────────────────────────────────

/** 归一化坐标（0~1）× 视口 1000，配合 preserveAspectRatio="none" + non-scaling-stroke */
interface Pt {
  x: number
  y: number
}

/**
 * 订正栏上的自由画笔。
 *
 * 三个刻意的选择：
 *   · 坐标**按容器尺寸归一化**存 —— 手机横竖屏切换、字号变化都不会让笔迹跑偏；
 *   · 只铺在「订正栏」那一块上，不铺整张卡 —— 否则手指在卡片上滑动就被笔吃掉，
 *     孩子没法滚页面了（整页只有订正栏是 touch-action:none）；
 *   · 关掉画笔时 pointer-events:none —— 笔迹留着不挡答题。
 */
function PenLayer({
  on,
  strokes,
  setStrokes,
}: {
  on: boolean
  strokes: Pt[][]
  setStrokes: (s: Pt[][]) => void
}) {
  const ref = useRef<SVGSVGElement | null>(null)
  const live = useRef<Pt[] | null>(null)
  const [, tick] = useState(0)

  const norm = (e: React.PointerEvent): Pt => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return { x: 0, y: 0 }
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const down = (e: React.PointerEvent) => {
    if (!on) return
    live.current = [norm(e)]
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 个别环境不允许指针捕获 → 不影响画，只是手指滑出这块后收不到 move */
    }
    tick((n) => n + 1)
  }
  const move = (e: React.PointerEvent) => {
    if (!on || !live.current) return
    live.current.push(norm(e))
    tick((n) => n + 1)
  }
  const up = () => {
    const s = live.current
    live.current = null
    if (s && s.length > 1) setStrokes([...strokes, s])
    else tick((n) => n + 1)
  }
  const d = (pts: Pt[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${(p.x * 1000).toFixed(1)},${(p.y * 1000).toFixed(1)}`).join(" ")
  const all = live.current ? [...strokes, live.current] : strokes
  return (
    <svg
      ref={ref}
      className={`sd-pen${on ? " sd-pen-on" : ""}`}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-hidden="true"
    >
      {all.map((s, i) => (
        <path key={i} d={d(s)} />
      ))}
    </svg>
  )
}

/** 订正栏：原句 + 红笔标记 + 画笔层，共用一个 position:relative 的框 */
function Paper({
  children,
  penOn,
  penStrokes,
  setPenStrokes,
  wide,
}: {
  children: React.ReactNode
  penOn: boolean
  penStrokes: Pt[][]
  setPenStrokes: (s: Pt[][]) => void
  wide?: boolean
}) {
  return (
    <div className={`sd-paper${wide ? " sd-paper-wide" : ""}`}>
      {children}
      <PenLayer on={penOn} strokes={penStrokes} setStrokes={setPenStrokes} />
    </div>
  )
}

export function SentenceDoctorPage() {
  const navigate = useNavigate()
  const { speaking, speak } = useTts()

  const [mode, setMode] = useState<Mode>("punct")
  const [lvIdx, setLvIdx] = useState<Record<Mode, number>>({ punct: 0, fix: 0 })
  const [pItems, setPItems] = useState<Record<string, PItemState>>({})
  const [fItems, setFItems] = useState<Record<string, FItemState>>({})
  const [active, setActive] = useState<{ key: string; slot: number } | null>(null)
  const [solved, setSolved] = useState<Record<string, true>>(loadSolved)
  /** 病句门诊顶部「五个修改符号」里点开的那一个（null = 没点开） */
  const [signPick, setSignPick] = useState<FixTool | null>(null)
  /** ✏️ 画笔总开关（两册共用）；笔迹按卡片 key 分开存，换关回来还在 */
  const [penOn, setPenOn] = useState(false)
  const [strokes, setStrokes] = useState<Record<string, Pt[][]>>({})
  const levelBarRef = useRef<HTMLDivElement | null>(null)

  /* 关卡条在手机上是要横滑的（病句那边有 6 关），当前关可能整个滚在屏幕外——
     孩子点了「下一关」却没看到哪一关被选中。每次换关把当前项滚到中间。
     只动这个容器的 scrollLeft，不调 scrollIntoView：后者会把整个页面一起纵向拽动。 */
  useEffect(() => {
    const bar = levelBarRef.current
    const el = bar?.children[lvIdx[mode]] as HTMLElement | undefined
    if (!bar || !el) return
    bar.scrollLeft = el.offsetLeft - (bar.clientWidth - el.clientWidth) / 2
  }, [mode, lvIdx])

  const pLevel = PUNCT_LEVELS[lvIdx.punct]
  const fLevel = FIX_LEVELS[lvIdx.fix]

  const pLevelDone = pLevel.items.filter((_, i) => solved[`p:${pLevel.key}:${i}`]).length
  const fLevelDone = fLevel.items.filter((_, i) => solved[`f:${fLevel.key}:${i}`]).length
  const levelDone = mode === "punct" ? pLevelDone : fLevelDone
  const levelTotal = mode === "punct" ? pLevel.items.length : fLevel.items.length

  // ── 自动记账：每次状态变化扫一遍，全对即记「已掌握」
  useEffect(() => {
    setSolved((prev) => {
      const next: Record<string, true> = { ...prev }
      let changed = false
      for (const l of PUNCT_LEVELS) {
        l.items.forEach((it, i) => {
          const k = `p:${l.key}:${i}`
          const st = pItems[k]
          if (!st || next[k]) return
          if (it.slots.every((s, j) => !s || slotStateOf(st.vals[j] ?? "", s) === "ok")) {
            next[k] = true
            changed = true
          }
        })
      }
      for (const l of FIX_LEVELS) {
        l.items.forEach((it, i) => {
          const k = `f:${l.key}:${i}`
          const st = fItems[k]
          if (!st || next[k]) return
          if (it.spots.every((s, j) => st.tools[j] === s.tool && st.picks[j] === s.answer)) {
            next[k] = true
            changed = true
          }
        })
      }
      if (!changed) return prev
      saveSolved(next)
      return next
    })
  }, [pItems, fItems])

  const updP = useCallback((k: string, n: number, patch: Partial<PItemState>) => {
    setPItems((m) => ({ ...m, [k]: { ...(m[k] ?? emptyP(n)), ...patch } }))
  }, [])

  const updF = useCallback((k: string, n: number, patch: Partial<FItemState>) => {
    setFItems((m) => ({ ...m, [k]: { ...(m[k] ?? emptyF(n)), ...patch } }))
  }, [])

  const forget = useCallback((k: string) => {
    setSolved((prev) => {
      if (!prev[k]) return prev
      const next: Record<string, true> = { ...prev }
      delete next[k]
      saveSolved(next)
      return next
    })
  }, [])

  /** 只清一张卡的笔迹（按「重来」时用） */
  const clearStrokes = useCallback((k: string) => {
    setStrokes((m) => {
      if (!m[k]) return m
      const next = { ...m }
      delete next[k]
      return next
    })
  }, [])

  const readAloud = useCallback(
    async (text: string) => {
      if (speaking) return
      await speak(text)
    },
    [speak, speaking],
  )

  const resetLevel = useCallback(() => {
    if (mode === "punct") {
      setPItems((m) => {
        const next = { ...m }
        pLevel.items.forEach((_, i) => delete next[`p:${pLevel.key}:${i}`])
        return next
      })
      pLevel.items.forEach((_, i) => {
        forget(`p:${pLevel.key}:${i}`)
        clearStrokes(`p:${pLevel.key}:${i}`)
      })
    } else {
      setFItems((m) => {
        const next = { ...m }
        fLevel.items.forEach((_, i) => delete next[`f:${fLevel.key}:${i}`])
        return next
      })
      fLevel.items.forEach((_, i) => {
        forget(`f:${fLevel.key}:${i}`)
        clearStrokes(`f:${fLevel.key}:${i}`)
      })
    }
    setActive(null)
  }, [mode, pLevel, fLevel, forget, clearStrokes])

  // 两册的关卡数组结构不同，这里只取共有的两个字段用于渲染标签（避免联合类型调 map 报错）
  const levels: { key: string; name: string }[] = mode === "punct" ? PUNCT_LEVELS : FIX_LEVELS

  const isSlotActive = (k: string, si: number) => active?.key === k && active.slot === si

  /** 这一关有没有笔迹 —— 决定「清空笔迹」要不要出现 */
  const hasStrokes = useMemo(() => {
    const pre = mode === "punct" ? `p:${pLevel.key}:` : `f:${fLevel.key}:`
    return Object.keys(strokes).some((k) => k.startsWith(pre) && strokes[k].length > 0)
  }, [strokes, mode, pLevel, fLevel])

  const clearLevelStrokes = useCallback(() => {
    const pre = mode === "punct" ? `p:${pLevel.key}:` : `f:${fLevel.key}:`
    setStrokes((m) => {
      const next = { ...m }
      for (const k of Object.keys(next)) if (k.startsWith(pre)) delete next[k]
      return next
    })
  }, [mode, pLevel, fLevel])

  return (
    <div className={`page sd-page${penOn ? " sd-pen-mode" : ""}`}>
      <div className="module-header">
        <button type="button" className="back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
        <h1>句子小医生</h1>
        <span className="module-level">
          {levelDone}/{levelTotal}
        </span>
      </div>
      <p className="module-hint">
        标点和病句练的是同一件事：先<b>找出句子的部件</b>，再下笔。
      </p>

      <div className="sd-tabs">
        <button
          type="button"
          className={`sd-tab${mode === "punct" ? " sd-on" : ""}`}
          onClick={() => {
            setMode("punct")
            setActive(null)
          }}
        >
          🎩 标点的幻术
        </button>
        <button
          type="button"
          className={`sd-tab${mode === "fix" ? " sd-on" : ""}`}
          onClick={() => {
            setMode("fix")
            setActive(null)
          }}
        >
          🩺 病句门诊
        </button>
      </div>

      <div className="sd-penbar">
        <button
          type="button"
          className={`sd-pentog${penOn ? " sd-on" : ""}`}
          onClick={() => setPenOn((v) => !v)}
        >
          ✏️ 画笔{penOn ? "：开" : ""}
        </button>
        {penOn && hasStrokes && (
          <button type="button" className="sd-mini" onClick={clearLevelStrokes}>
            🧽 清空笔迹
          </button>
        )}
        <span className="sd-pentip">
          {penOn ? "现在可以在「订正栏」上随手画，标点牌先点不动 —— 再按一下关掉画笔" : "想自己动手画修改符号？打开画笔"}
        </span>
      </div>

      <div className="sd-levels" ref={levelBarRef}>
        {levels.map((l, i) => (
          <button
            key={l.key}
            type="button"
            className={`sd-level${i === lvIdx[mode] ? " sd-on" : ""}`}
            onClick={() => {
              setLvIdx((cur) => ({ ...cur, [mode]: i }))
              setActive(null)
            }}
          >
            {l.name}
          </button>
        ))}
      </div>

      <div className="sd-rule">
        {mode === "punct" ? (
          <>
            <span className="sd-rule-tag">通关口诀</span>
            <span>{pLevel.rule}</span>
          </>
        ) : (
          <span>{fLevel.intro.replace(/\*\*/g, "")}</span>
        )}
      </div>

      {mode === "fix" && (
        <div className="sd-signs">
          <div className="sd-signs-head">
            <span className="sd-rule-tag">五个修改符号</span>
            <span className="sd-signs-tip">课本一共就教这五个，点一下看怎么用</span>
          </div>
          <div className="sd-signs-row">
            {FIX_TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                title={t.when}
                className={`sd-sign-chip${signPick === t.key ? " sd-on" : ""}`}
                onClick={() => setSignPick(signPick === t.key ? null : t.key)}
              >
                <FixSign tool={t.key} />
                <span className="sd-sign-chip-n">{t.key}号</span>
              </button>
            ))}
          </div>
          {signPick && (
            <p className="sd-sign-note">
              <b>{signPick}号</b>
              {FIX_TOOLS.find((t) => t.key === signPick)?.when} 时用它。
            </p>
          )}
        </div>
      )}

      {mode === "punct"
        ? pLevel.items.map((item, i) => {
            const k = `p:${pLevel.key}:${i}`
            const st = pItems[k] ?? emptyP(item.slots.length)
            const done = !!solved[k]
            const tagIdx = tagPartIndexOf(item)
            const tagPos = tagPositionOf(item)
            return (
              <div key={k} className={`sd-card${done ? " sd-done" : ""}`}>
                <div className="sd-card-head">
                  <span className="sd-no">{i + 1}</span>
                  <span className="sd-head-right">
                    {done && <span className="sd-badge">✓ 全对</span>}
                    {st.tagOn && tagPos && <span className="sd-badge sd-badge-tag">{TAG_POS_LABEL[tagPos]}</span>}
                    <button
                      type="button"
                      className={`sd-tagbtn${st.tagOn ? " sd-on" : ""}`}
                      title="把提示语那一段点亮（先自己找，卡住了再点）"
                      onClick={() => updP(k, item.slots.length, { tagOn: !st.tagOn })}
                    >
                      🔆 提示语在哪儿
                    </button>
                  </span>
                </div>

                <Paper
                  penOn={penOn}
                  penStrokes={strokes[k] ?? []}
                  setPenStrokes={(s) => setStrokes((m) => ({ ...m, [k]: s }))}
                >
                  <div className="sd-sent">
                    {item.slots.map((s, si) => (
                      <span key={`seg${si}`}>
                        {s ? (
                          <button
                            type="button"
                            className={`sd-slot st-${slotStateOf(st.vals[si] ?? "", s)}${
                              isSlotActive(k, si) ? " sd-on" : ""
                            }`}
                            onClick={() => setActive(isSlotActive(k, si) ? null : { key: k, slot: si })}
                            aria-label={`第 ${si + 1} 个标点空位`}
                          >
                            {st.vals[si] || "?"}
                          </button>
                        ) : null}
                        {si < item.parts.length ? (
                          <span className={st.tagOn && si === tagIdx ? "sd-txt sd-tagpart" : "sd-txt"}>
                            {item.parts[si]}
                            {st.tagOn && si === tagIdx && <span className="sd-taglabel">提示语</span>}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </Paper>

                <div className="sd-acts">
                  <button
                    type="button"
                    className="sd-act"
                    disabled={speaking}
                    title="按你填的标点读一遍，听听通不通"
                    onClick={() => void readAloud(composeSentence(item, st.vals))}
                  >
                    🔊 读一读
                  </button>
                  <button
                    type="button"
                    className={`sd-act${st.hint ? " sd-on" : ""}`}
                    onClick={() => updP(k, item.slots.length, { hint: !st.hint })}
                  >
                    ✨ 提示
                  </button>
                  <button type="button" className="sd-act" onClick={() => updP(k, item.slots.length, { revealed: true })}>
                    👀 看答案
                  </button>
                  <button
                    type="button"
                    className="sd-act sd-ghost"
                    onClick={() => {
                      updP(k, item.slots.length, emptyP(item.slots.length))
                      forget(k)
                      clearStrokes(k)
                    }}
                  >
                    ↺ 重来
                  </button>
                </div>

                {st.hint && (
                  <div className="sd-pop">
                    <div className="sd-pop-tag">看这儿</div>
                    <p className="sd-pop-main">{item.tip}</p>
                    <ul className="sd-pop-list">
                      {item.slots.map((s, si) =>
                        s ? (
                          <li key={`h${si}`}>
                            <b>第 {si + 1} 空</b>：{SLOT_HINT[s.kind]}
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </div>
                )}

                {active?.key === k ? (
                  <div className="sd-palette">
                    <div className="sd-palette-head">
                      <span>选标点 —— 可以连点两个（比如冒号 + 前引号）</span>
                      <button type="button" className="sd-mini" onClick={() => setActive(null)}>
                        收起
                      </button>
                    </div>
                    <div className="sd-keys">
                      {PUNCT_KEYS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          className="sd-key"
                          onClick={() =>
                            updP(k, item.slots.length, {
                              vals: st.vals.map((v, vi) => (vi === active?.slot ? (v ?? "") + p.c : v)),
                            })
                          }
                        >
                          <span className="sd-key-c">{p.c}</span>
                          <span className="sd-key-l">{p.label}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="sd-key sd-key-fn"
                        onClick={() =>
                          updP(k, item.slots.length, {
                            vals: st.vals.map((v, vi) => (vi === active?.slot ? (v ?? "").slice(0, -1) : v)),
                          })
                        }
                      >
                        <span className="sd-key-c">⌫</span>
                        <span className="sd-key-l">退一格</span>
                      </button>
                      <button
                        type="button"
                        className="sd-key sd-key-fn"
                        onClick={() =>
                          updP(k, item.slots.length, {
                            vals: st.vals.map((v, vi) => (vi === active?.slot ? "" : v)),
                          })
                        }
                      >
                        <span className="sd-key-c">␡</span>
                        <span className="sd-key-l">清空这空</span>
                      </button>
                    </div>
                  </div>
                ) : null}

                {st.revealed && (
                  <div className="sd-answer">
                    <div className="sd-answer-head">
                      <span>{done ? "答案对了，理由再顺一遍" : "对照一下"}</span>
                      <button
                        type="button"
                        className="sd-mini"
                        disabled={speaking}
                        onClick={() =>
                          void readAloud(
                            composeSentence(
                              item,
                              item.slots.map((s) => (s ? s.a : "")),
                            ),
                          )
                        }
                      >
                        🔊 读标准答案
                      </button>
                    </div>
                    <ol className="sd-why">
                      {item.slots.map((s, si) =>
                        s ? (
                          <li key={`w${si}`}>
                            <span className="sd-why-a">{s.a}</span>
                            <span className="sd-why-t">{s.why}</span>
                          </li>
                        ) : null,
                      )}
                    </ol>
                  </div>
                )}
              </div>
            )
          })
        : fLevel.items.map((item, i) => {
            const k = `f:${fLevel.key}:${i}`
            const st = fItems[k] ?? emptyF(item.spots.length)
            const done = !!solved[k]
            /** 诊断对了（或已看答案）的病灶 —— 只有它们才画到原句上 */
            const spotOk = (si: number) =>
              st.tools[si] === item.spots[si].tool && st.picks[si] === item.spots[si].answer
            const marked = item.spots.filter((_, si) => spotOk(si) || st.revealed)
            return (
              <div key={k} className={`sd-card${done ? " sd-done" : ""}`}>
                <div className="sd-card-head">
                  <span className="sd-no">{i + 1}</span>
                  <span className="sd-head-right">
                    {done && <span className="sd-badge">✓ 全都治好了</span>}
                    {!done && marked.length > 0 && (
                      <span className="sd-badge sd-badge-tag">
                        已标出 {marked.length}/{item.spots.length} 处
                      </span>
                    )}
                  </span>
                </div>

                <Paper
                  wide
                  penOn={penOn}
                  penStrokes={strokes[k] ?? []}
                  setPenStrokes={(s) => setStrokes((m) => ({ ...m, [k]: s }))}
                >
                  <span className="sd-paper-cap">订正栏</span>
                  <MarkedSentence text={item.text} marks={marked} />
                </Paper>

                <div className="sd-acts">
                  <button type="button" className="sd-act" disabled={speaking} onClick={() => void readAloud(item.text)}>
                    🔊 读一读
                  </button>
                  <button
                    type="button"
                    className={`sd-act${st.hint ? " sd-on" : ""}`}
                    onClick={() => updF(k, item.spots.length, { hint: !st.hint })}
                  >
                    ✨ 提示
                  </button>
                  <button
                    type="button"
                    className="sd-act"
                    onClick={() => updF(k, item.spots.length, { revealed: true })}
                  >
                    👀 看答案
                  </button>
                  <button
                    type="button"
                    className="sd-act sd-ghost"
                    onClick={() => {
                      updF(k, item.spots.length, emptyF(item.spots.length))
                      forget(k)
                      clearStrokes(k)
                    }}
                  >
                    ↺ 重来
                  </button>
                </div>

                {st.hint && (
                  <div className="sd-pop">
                    <div className="sd-pop-tag">看这儿</div>
                    <p className="sd-pop-main">
                      小声读两遍，<b>读不通的地方就是病处</b>。再问自己三句话：
                      ① 这个词跟旁边的话<b>搭得上</b>吗？② 谁、做了什么、对谁做，<b>齐了吗</b>？③ 有没有<b>说了两遍</b>或<b>前后打架</b>？
                    </p>
                    <ul className="sd-pop-list">
                      <li>
                        <b>这一段要用的刀</b>：{fLevel.intro.replace(/\*\*/g, "")}
                      </li>
                      {item.spots.length > 1 && <li>这句有 {item.spots.length} 处病，一处一处来。</li>}
                      <li>改完再把整句读一遍——顺了才算治好。</li>
                    </ul>
                  </div>
                )}

                {item.spots.map((spot, si) => {
                  const tool = st.tools[si] ?? ""
                  const pick = st.picks[si] ?? -1
                  const ok = spotOk(si)
                  const showWhy = ok || st.revealed
                  return (
                    <div key={`sp${si}`} className={`sd-spot${ok ? " sd-ok" : ""}`}>
                      <div className="sd-spot-head">
                        <span className="sd-spot-no">
                          {item.spots.length > 1 ? `第 ${si + 1} 处` : "选刀，再找出病处"}
                        </span>
                        {ok && <span className="sd-spot-ok">✓ 治好 · 已画到原句上</span>}
                      </div>

                      <div className="sd-tools">
                        {FIX_TOOLS.map((t) => {
                          const picked = tool === t.key
                          return (
                            <button
                              key={t.key}
                              type="button"
                              title={`${t.key}号：${t.when}`}
                              className={`sd-tool${picked ? " sd-on" : ""}${
                                picked && t.key !== spot.tool ? " sd-bad" : ""
                              }`}
                              onClick={() =>
                                updF(k, item.spots.length, {
                                  tools: st.tools.map((v, vi) => (vi === si ? t.key : v)),
                                })
                              }
                            >
                              <FixSign tool={t.key} />
                              <span className="sd-tool-name">{t.key}刀</span>
                            </button>
                          )
                        })}
                      </div>

                      <div className="sd-opts">
                        {spot.options.map((o, oi) => {
                          const picked = pick === oi
                          const right = picked && oi === spot.answer
                          return (
                            <button
                              key={`o${oi}`}
                              type="button"
                              className={`sd-opt${right ? " sd-ok" : ""}${picked && !right ? " sd-bad" : ""}`}
                              onClick={() =>
                                updF(k, item.spots.length, {
                                  picks: st.picks.map((v, vi) => (vi === si ? oi : v)),
                                })
                              }
                            >
                              {o}
                            </button>
                          )
                        })}
                      </div>

                      {showWhy && (
                        <div className="sd-why-box">
                          <div className="sd-why-head">
                            <b>正确操作</b>
                            <span className="sd-why-tool">{spot.tool}手术刀</span>
                          </div>
                          <div className="sd-why-first">{spot.options[spot.answer]}</div>
                          <div className="sd-why-mark">✍️ {describeMark(spot)}</div>
                          <div className="sd-why-t">{spot.why}</div>
                        </div>
                      )}
                    </div>
                  )
                })}

                {(done || st.revealed) && (
                  <div className="sd-answer">
                    <div className="sd-answer-head">
                      <span>订正后（参考答案）</span>
                      <button
                        type="button"
                        className="sd-mini"
                        disabled={speaking}
                        onClick={() => void readAloud(item.fixed)}
                      >
                        🔊 读一读
                      </button>
                    </div>
                    <p className="sd-fixed">{item.fixed}</p>
                  </div>
                )}
              </div>
            )
          })}

      <div className="sd-foot">
        <button type="button" className="sd-act" onClick={resetLevel}>
          ↺ 这一关重做
        </button>
        {levelDone === levelTotal && levelTotal > 0 && (
          <p className="sd-alldone">这一关全做完了，试试下一关 👆</p>
        )}
        <p className="sd-note">
          标点题有标准答案；<b>病句题的改法不止一种</b>，这里判的是「有没有找到那一处」，
          订正句仅供参考，以老师讲评为准。红笔标记画的是**参考改法**，
          自己用画笔画的算数——两种画法对得上，才算真会了。
        </p>
        <p className="sd-credit">内容整理自廖敏老师自制练习册《提示语及修改病句专项练习》</p>
      </div>
    </div>
  )
}
