/** 数量关系与交换 —— 规则引擎（零后端调用）
 *
 * ── 这一页要解决的真问题 ──────────────────────────────────────────
 * 孩子把「小明比小红多 3 个」和「小红比小明多 3 个」当成同一句话。
 * 他不是没算对差，而是**没看出这两句话的主语换了**——数一个没动，
 * 变的只是「谁站在哪个角色上」。
 *
 * 所以本页把四类数量关系摆在一起，只演一件事：**换个位置会怎样**。
 *
 *   一共    3 + 5 = 8  ⇄  5 + 3 = 8        ⇒  结论**不变**（加法交换律）
 *   比多少  7 比 4 多 3  ⇄  4 比 7 **少** 3   ⇒  数没变，**词翻了**
 *   倍数    6 是 2 的 3 倍 ⇄ 2 是 6 的 1/3  ⇒  关系**翻了**
 *   平均分  12÷3=4（每份几个）⇄ 12÷4=3（分成几份）⇒ **问的不是一件事**
 *
 * ── ★ 颜色该标什么：角色，不是大小 ────────────────────────────────
 * 「按大小上色」（多的红、少的蓝）在这页**必然失效**：交换前后 7 还是 7、
 * 4 还是 4，颜色一模一样，学生看不出发生过任何事。
 * 按**角色**上色才对：颜色挂在**槽位**上。交换时量在**位移**、槽位不动，
 * 于是两个色块**对调** —— 学生看到的是「还是那 4 个，但它变成橙色的了」，
 * 一句话就懂：**它的角色变了，所以结论变了**。
 *
 * 由此得到全页唯一的一条纲：
 *   两边同色（对等）⇒ 能换；一青一橙（有方向）⇒ 换了就变。
 *
 * ── 为什么不用大模型出题 ──────────────────────────────────────────
 * 本题型是纯逻辑（关系句、算式、交换后果必须三者自洽）。
 * 规则引擎 = 0 延迟 + 0 成本 + 可离线 + 100% 正确，且每条结论都能写进单测。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 四类数量关系。★ 页面渲染按钮、引擎抽题都读 `KIND_GROUPS`，页面绝不手写清单 */
export type RelKind =
  /** 一共：两个部分合成总量 —— **对称**，交换律成立 */
  | "total"
  /** 比多少：多 / 少 —— 有方向，交换主宾后词翻转 */
  | "compare"
  /** 倍数：谁是谁的几倍 —— 有方向，交换主宾后关系翻转 */
  | "times"
  /** 平均分：等分除 / 包含除 —— 有方向，交换后含义改变 */
  | "share"

/**
 * ★ 角色 —— 颜色就挂在这上面。**交换位置时角色不动**，动的是量。
 * 这是本页最核心的一条设计：标「角色」才对，标「大小」必错。
 */
export type Role =
  /** 对等的部分（一共的两个加数）—— 中性灰：两边同色 ⇒ 能换 */
  | "part"
  /** 总量 / 差 / 倍数这类「合出来」的结果 —— 深色 */
  | "whole"
  /** 基准量 / 1 倍量 / 每份数 —— 青绿：跟谁比的那一个 */
  | "base"
  /** 比较量 / 份数 —— 橙红：拿它去比的那一个 */
  | "cmp"

/** ★ 交换的后果 —— 全页就讲这张表 */
export type SwapEffect =
  /** 结论完全不变（一共：加法交换律） */
  | "keep"
  /** 数值不变、词翻转（比多少：多 ⇄ 少） */
  | "flipWord"
  /** 关系翻转（倍数：n 倍 ⇄ 1/n） */
  | "flipRate"
  /** 含义改变（平均分：份数 ⇄ 每份数） */
  | "flipMeaning"

/** 图上「几个点」的排布；`rows * cols ≥ value`，前 `value` 个点亮 */
export interface Shape {
  rows: number
  cols: number
}

/** 一个量：谁、多少、什么单位、怎么摆 */
export interface Quantity {
  who: string
  value: number
  unit: string
  shape: Shape
}

/** 一句关系句 + 要拿出来对照的那一小段 */
export interface RelLine {
  text: string
  /** 交换前后要并排比的那一小段（「多 3 个」/「3 倍」/「每份 4 个」） */
  key: string
}

/** 平均分专属：同一个总数，两种分法的排布 */
export interface ShareGrid {
  total: number
  /** 交换前：分成 k 份 ⇒ k 行 p 列 */
  before: Shape
  /** 交换后：每份 p 个 ⇒ p 行 k 列 */
  after: Shape
}

export interface RelProblem {
  id: string
  kind: RelKind
  /** ★ 槽位角色（交换时**不动** —— 颜色挂在这里） */
  slotRole: [Role, Role]
  /** 交换前站在左 / 右槽位的两个量 */
  left: Quantity
  right: Quantity
  /** 关系句：交换前 / 交换后 */
  before: RelLine
  after: RelLine
  effect: SwapEffect
  /** 交换后到底变了什么（一句话点破） */
  reveal: string
  /** 两态算式 —— 供单测**独立重算** */
  eq: { before: string; after: string }
  /** 交换后**没变**的那个东西 */
  invariant: string
  /** 第三个数（总量 / 差 / 倍数 / 总数） */
  result: { label: string; value: number; unit: string; role: Role }
  /** 两态的数值快照 —— 用来断言「数一个没动、角色却换了」 */
  nums: { before: [number, number]; after: [number, number] }
  /** 倍数的**第二级**交换：换因数（乘法交换律）⇒ 这一级**不变** */
  factorSwap?: { n: number; b: number; value: number; text: string }
  /** 平均分：同一个算式的两种含义 */
  shareSenses?: { divide: string; contain: string }
  /** 平均分：点数排布 */
  shareGrid?: ShareGrid
  /** 一步一填的步骤（由本道题派生，页面不另写数学） */
  solveSteps: SolveStep[]
}

/** 一步一填的一步 */
export interface SolveStep {
  key: string
  label: string
  ask: string
  options: string[]
  answer: string
  tip: string
}

/** 易错点类型 */
export type MistakeKind = "sayWrong" | "reverse" | "factorConfuse" | "senseMix" | "overSwap" | "diffVsTimes"

export interface MistakeCase {
  kind: MistakeKind
  title: string
  wrong: string
  right: string
  why: string
  tip: string
  icon: string
}

// ────────────────────────────────────────────────────────────
// 配色 / 文案表（页面直接取，绝不自己发明颜色）
// ────────────────────────────────────────────────────────────

/** ★ 角色 → 颜色。青绿 = 基准，橙红 = 比较，灰 = 对等/结果 */
export const ROLE_META: Record<Role, { label: string; hint: string; fg: string; bg: string; dot: string }> = {
  part: { label: "部分", hint: "地位对等", fg: "#475569", bg: "#e2e8f0", dot: "#94a3b8" },
  whole: { label: "结果", hint: "合出来的", fg: "#0f172a", bg: "#e2e8f0", dot: "#334155" },
  base: { label: "基准", hint: "跟谁比", fg: "#0f766e", bg: "#ccfbf1", dot: "#0d9488" },
  cmp: { label: "比较", hint: "拿它去比", fg: "#c2410c", bg: "#ffedd5", dot: "#ea580c" },
}

/** 交换后果 → 短标签（对照表用） */
export const EFFECT_LABEL: Record<SwapEffect, { label: string; changed: boolean }> = {
  keep: { label: "不变", changed: false },
  flipWord: { label: "词翻了", changed: true },
  flipRate: { label: "关系翻了", changed: true },
  flipMeaning: { label: "问题变了", changed: true },
}

// ────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────

function rnd(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function pick<T>(xs: readonly T[]): T {
  return xs[rnd(0, xs.length - 1)]
}

/** 从池里取两个不同的名字 */
function twoNames(): [string, string] {
  const a = pick(NAMES)
  let b = pick(NAMES)
  for (let i = 0; i < 20 && b === a; i++) b = pick(NAMES)
  return [a, b]
}

const NAMES = ["小明", "小红", "小刚", "小丽", "冬冬", "丫丫"] as const

let SEQ = 0
function nextId(kind: RelKind): string {
  SEQ += 1
  return `${kind}-${SEQ}-${Date.now().toString(36)}`
}

/**
 * 选项去重 —— ★ 陷阱项**可能与正确答案撞车**（如比多少里 `差 === 小数` 时，
 * 「多 3 个」既是错答又是另一个错答），也可能彼此相同。
 * 直接拼数组会让同一句话出现两次，学生一眼就看出答案 ⇒ 必须过滤。
 * 实测就是这么被单测抓到的。
 */
function opts(answer: string, ...traps: string[]): string[] {
  const out = [answer]
  for (const t of traps) if (!out.includes(t)) out.push(t)
  return out
}

// ────────────────────────────────────────────────────────────
// 四个生成器 —— 一律「先定结果，再反推操作数」
// ────────────────────────────────────────────────────────────

/** 一共：a + b = total。两个部分**同色**（对等）⇒ 交换后什么也不变 */
function genTotal(): RelProblem | null {
  const a = rnd(2, 9)
  const b = rnd(2, 9)
  // 教材感：两个加数不一样（3 + 3 数学上没错，但不像例题）
  if (a === b) return null
  const total = a + b
  const [wa, wb] = twoNames()
  const cols = Math.max(a, b)

  const before: RelLine = {
    text: `${wa} ${a} 个 ＋ ${wb} ${b} 个 ＝ 一共 ${total} 个`,
    key: `一共 ${total} 个`,
  }
  const after: RelLine = {
    text: `${wb} ${b} 个 ＋ ${wa} ${a} 个 ＝ 一共 ${total} 个`,
    key: `一共 ${total} 个`,
  }

  return {
    id: nextId("total"),
    kind: "total",
    // ★ 两个部分同角色 ⇒ 同色 ⇒ 交换后视觉上什么都不变
    slotRole: ["part", "part"],
    left: { who: wa, value: a, unit: "个", shape: { rows: 1, cols } },
    right: { who: wb, value: b, unit: "个", shape: { rows: 1, cols } },
    before,
    after,
    effect: "keep",
    reveal: `换了位置，一共还是 ${total} 个`,
    eq: { before: `${a} ＋ ${b} ＝ ${total}`, after: `${b} ＋ ${a} ＝ ${total}` },
    invariant: "两堆还是那些，一个没多一个没少",
    result: { label: "一共", value: total, unit: "个", role: "whole" },
    nums: { before: [a, b], after: [b, a] },
    solveSteps: [
      {
        key: "effect",
        label: "先猜一猜",
        ask: "把两堆换个位置，一共会变吗？",
        options: ["不变", "会变"],
        answer: "不变",
        tip: "两边地位一样，换了也是同一堆",
      },
      {
        key: "say",
        label: "再算一算",
        ask: `换完之后，一共是多少？`,
        options: opts(String(total), String(Math.max(a, b)), String(total + 1)),
        answer: String(total),
        tip: "加法换位置，和不变",
      },
    ],
  }
}

/** 比多少：M － m = d。交换主宾 ⇒ 数值不变，**词从「多」翻成「少」** */
function genCompare(): RelProblem | null {
  const m = rnd(2, 9)
  const d = rnd(2, 9)
  const M = m + d
  if (M > 18) return null
  const [wBig, wSmall] = twoNames()

  const before: RelLine = { text: `${wBig}比${wSmall}多 ${d} 个`, key: `多 ${d} 个` }
  const after: RelLine = { text: `${wSmall}比${wBig}少 ${d} 个`, key: `少 ${d} 个` }

  return {
    id: nextId("compare"),
    kind: "compare",
    // 左槽 = 句子的主语（比较量，橙红）｜右槽 = 跟谁比（基准量，青绿）
    slotRole: ["cmp", "base"],
    left: { who: wBig, value: M, unit: "个", shape: { rows: 1, cols: M } },
    right: { who: wSmall, value: m, unit: "个", shape: { rows: 1, cols: M } },
    before,
    after,
    effect: "flipWord",
    reveal: `${M} 和 ${m} 一个没动，说法却从「多」翻成了「少」`,
    eq: { before: `${M} － ${m} ＝ ${d}`, after: `${M} － ${m} ＝ ${d}` },
    invariant: "两个数没变，差也没变 —— 变的只是「谁跟谁比」",
    result: { label: "相差", value: d, unit: "个", role: "whole" },
    nums: { before: [M, m], after: [m, M] },
    solveSteps: [
      {
        key: "effect",
        label: "先猜一猜",
        ask: "把两个人换个位置，说法会变吗？",
        options: ["会变", "不变"],
        answer: "会变",
        tip: "一青一橙，说明两边不一样",
      },
      {
        key: "say",
        label: "再想一想",
        ask: `换成「${wSmall}比${wBig}……」该怎么说？`,
        options: opts(`少 ${d} 个`, `多 ${d} 个`, `少 ${M} 个`),
        answer: `少 ${d} 个`,
        tip: "主语换成小的那个，词就得翻过来",
      },
    ],
  }
}

/** 倍数：M = b × n。交换主宾 ⇒ 从 n 倍掉到 1/n；但换**因数**不变（乘法交换律） */
function genTimes(): RelProblem | null {
  const b = rnd(2, 9)
  const n = rnd(2, 5)
  const M = b * n
  if (M > 45 || n === 1 || M === b) return null
  const [wBig, wSmall] = twoNames()

  const before: RelLine = { text: `${wBig}是${wSmall}的 ${n} 倍`, key: `${n} 倍` }
  const after: RelLine = { text: `${wSmall}是${wBig}的 1/${n}（不到 1 倍）`, key: `1/${n}` }

  return {
    id: nextId("times"),
    kind: "times",
    // 左槽 = 比较量（橙红）｜右槽 = 1 倍量（基准，青绿）
    slotRole: ["cmp", "base"],
    // 1 倍量 = 一行 b 个；比较量 = n 行 b 个（一眼看出「3 个这样的 1 份」）
    left: { who: wBig, value: M, unit: "个", shape: { rows: n, cols: b } },
    right: { who: wSmall, value: b, unit: "个", shape: { rows: 1, cols: b } },
    before,
    after,
    effect: "flipRate",
    reveal: `同一个 ${M} 和 ${b}，换个说法就从 ${n} 倍掉到 1/${n}`,
    eq: { before: `${b} × ${n} ＝ ${M}`, after: `${b} × ${n} ＝ ${M}` },
    invariant: `${M} 和 ${b} 都没变，乘积也没变`,
    result: { label: "倍数", value: n, unit: "倍", role: "whole" },
    nums: { before: [M, b], after: [b, M] },
    factorSwap: { n, b, value: M, text: `${b} 的 ${n} 倍 ＝ ${n} 的 ${b} 倍 ＝ ${M}` },
    solveSteps: [
      {
        key: "effect",
        label: "先猜一猜",
        ask: "把主宾换个位置，结论会变吗？",
        options: ["会变", "不变"],
        answer: "会变",
        tip: "问「谁是谁的几倍」，主宾不能乱换",
      },
      {
        key: "say",
        label: "再想一想",
        ask: `换成「${wSmall}是${wBig}的……」，是几倍？`,
        options: opts(`1/${n}`, `${n} 倍`, `${b} 倍`, `1/${M}`),
        answer: `1/${n}`,
        tip: "反过来就不到 1 倍了",
      },
      {
        key: "factor",
        label: "⚠️ 换个地方换",
        ask: `那「${b} 的 ${n} 倍」和「${n} 的 ${b} 倍」呢？`,
        options: [`一样，都是 ${M}`, "不一样"],
        answer: `一样，都是 ${M}`,
        tip: "换因数可以，乘法交换律",
      },
    ],
  }
}

/** 平均分：T = k × p。交换「份数」与「每份数」⇒ 同一个 T，**问的不是一件事** */
function genShare(): RelProblem | null {
  const k = rnd(2, 6)
  const p = rnd(2, 9)
  const T = k * p
  // k = p 时两种分法长得一模一样，看不出区别 ⇒ 丢弃
  if (T > 36 || k === p) return null

  const before: RelLine = { text: `${T} 个平均分成 ${k} 份，每份 ${p} 个`, key: `每份 ${p} 个` }
  const after: RelLine = { text: `${T} 个，每份 ${p} 个，能分成 ${k} 份`, key: `分成 ${k} 份` }

  return {
    id: nextId("share"),
    kind: "share",
    // 左槽 = 份数（橙红）｜右槽 = 每份数（青绿）
    slotRole: ["cmp", "base"],
    left: { who: "份数", value: k, unit: "份", shape: { rows: 1, cols: k } },
    right: { who: "每份", value: p, unit: "个", shape: { rows: 1, cols: p } },
    before,
    after,
    effect: "flipMeaning",
    reveal: `同一个 ${T}，问「分成几份」还是问「每份几个」，是两个问题`,
    eq: { before: `${T} ÷ ${k} ＝ ${p}`, after: `${T} ÷ ${p} ＝ ${k}` },
    invariant: `${T} 个一个没多、一个没少`,
    result: { label: "总数", value: T, unit: "个", role: "whole" },
    nums: { before: [k, p], after: [p, k] },
    shareGrid: { total: T, before: { rows: k, cols: p }, after: { rows: p, cols: k } },
    shareSenses: {
      divide: `${T} ÷ ${k} ＝ ${p}　求每份几个`,
      contain: `${T} ÷ ${p} ＝ ${k}　求分成几份`,
    },
    solveSteps: [
      {
        key: "effect",
        label: "先猜一猜",
        ask: "把「几份」和「每份几个」换个位置，同一件事吗？",
        options: ["不是一件事", "是同一件事"],
        answer: "不是一件事",
        tip: "一个求每份数，一个求份数",
      },
      {
        key: "say",
        label: "再想一想",
        ask: `${T} ÷ ${p} 问的是什么？`,
        options: opts("能分成几份", "每份几个", "一共几个", "剩下几个"),
        answer: "能分成几份",
        tip: "除以每份数，得份数",
      },
    ],
  }
}

// ────────────────────────────────────────────────────────────
// 对外：出题
// ────────────────────────────────────────────────────────────

/** ⚠️ 顺序即索引，必须与 GENERATORS 严格一致 */
const GENERATORS: Array<{ kind: RelKind; gen: () => RelProblem | null }> = [
  { kind: "total", gen: genTotal },
  { kind: "compare", gen: genCompare },
  { kind: "times", gen: genTimes },
  { kind: "share", gen: genShare },
]

const BY_KIND = new Map<RelKind, () => RelProblem | null>(GENERATORS.map((g) => [g.kind, g.gen]))

export const REL_KINDS: RelKind[] = GENERATORS.map((g) => g.kind)

/**
 * 生成一道题。
 * @param kind 指定题型（不传 = 四类等权随机）
 */
export function generateProblem(kind?: RelKind): RelProblem | null {
  // 指定题型：直接取对应生成器（多次尝试，躲开内部 return null 的苛刻条件）
  if (kind) {
    const g = BY_KIND.get(kind)
    if (!g) return null
    for (let i = 0; i < 200; i++) {
      const p = g()
      if (p) return p
    }
    return null
  }
  // 未指定：四类等权随机
  for (let i = 0; i < 200; i++) {
    const p = GENERATORS[rnd(0, GENERATORS.length - 1)].gen()
    if (p) return p
  }
  return null
}

/** 批量生成 n 道（按「关系句」去重；生成不出足够多时按实际数量返回） */
export function generateProblems(n: number, kind?: RelKind): RelProblem[] {
  const out: RelProblem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < n * 40 && out.length < n; i++) {
    const p = generateProblem(kind)
    if (!p) continue
    const sig = `${p.kind}|${p.before.text}`
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(p)
  }
  return out
}

// ────────────────────────────────────────────────────────────
// 题型清单（页面渲染 chips 只读这里）
// ────────────────────────────────────────────────────────────

export const KIND_GROUPS: ReadonlyArray<{
  key: RelKind
  title: string
  desc: string
  icon: string
  /** 卡片配色档：'both' = 交换后不变（同色），'dir' = 交换后会变（异色） */
  kindOfSwap: "both" | "dir"
}> = [
  { key: "total", title: "一共", desc: "两边对等", icon: "mergeTerms", kindOfSwap: "both" },
  { key: "compare", title: "比多少", desc: "谁跟谁比", icon: "moreLess", kindOfSwap: "dir" },
  { key: "times", title: "倍数", desc: "谁是谁的几倍", icon: "timesCopies", kindOfSwap: "dir" },
  { key: "share", title: "平均分", desc: "分成几份", icon: "shareEqual", kindOfSwap: "dir" },
]

export const KIND_LABEL: Record<RelKind, string> = {
  total: "一共",
  compare: "比多少",
  times: "倍数",
  share: "平均分",
}

// ────────────────────────────────────────────────────────────
// 规律卡（口诀）
// ────────────────────────────────────────────────────────────

export const RULES: ReadonlyArray<{ title: string; body: string; icon: string }> = [
  { title: "① 颜色标的是角色", body: "不是谁多谁少", icon: "swapRoles" },
  { title: "② 两边同色 ⇒ 能换", body: "对等，换了结论一样", icon: "mergeTerms" },
  { title: "③ 一青一橙 ⇒ 换了就变", body: "有方向，角色一换说法就翻", icon: "moreLess" },
  { title: "④ 数是位置搬，角色不搬", body: "数一个没变，变的是谁站哪儿", icon: "timesCopies" },
]

// ────────────────────────────────────────────────────────────
// 易错示例（静态精选；每条都人工验算过）
// ────────────────────────────────────────────────────────────

export const MISTAKE_CASES: MistakeCase[] = [
  {
    kind: "sayWrong",
    title: "换了主语，词没跟着换",
    wrong: "4 比 7 多 3",
    right: "4 比 7 少 3（7 比 4 才是多 3）",
    why: "主语换了，多和少跟着换",
    tip: "先看主语，再定多还是少",
    icon: "moreLess",
  },
  {
    kind: "reverse",
    title: "「谁是谁的几倍」说反了",
    wrong: "2 是 6 的 3 倍",
    right: "6 是 2 的 3 倍（2 是 6 的 1/3）",
    why: "6 里才有 3 个 2",
    tip: "反过来不到 1 倍",
    icon: "timesCopies",
  },
  {
    kind: "factorConfuse",
    title: "以为「倍」怎么换都会变",
    wrong: "2 的 3 倍 ≠ 3 的 2 倍",
    right: "2 的 3 倍 ＝ 3 的 2 倍 ＝ 6",
    why: "换因数不变，换主宾才变",
    tip: "乘法交换律允许换因数",
    icon: "swapRoles",
  },
  {
    kind: "senseMix",
    title: "两种「平均分」混成一件事",
    wrong: "12 ÷ 3 和 12 ÷ 4 都在问每份几个",
    right: "12÷3 求每份几个；12÷4 求分成几份",
    why: "除以份数得每份数",
    tip: "先看问的是份数还是每份",
    icon: "shareEqual",
  },
  {
    kind: "overSwap",
    title: "以为换位置会把总数也换了",
    wrong: "3 + 5 和 5 + 3 结果不一样",
    right: "3 ＋ 5 ＝ 5 ＋ 3 ＝ 8",
    why: "两边对等，换位置和不变",
    tip: "同色就能换，换了不变",
    icon: "mergeTerms",
  },
  {
    kind: "diffVsTimes",
    title: "把「多几」当成「是几倍」",
    wrong: "7 是 4 的 3 倍",
    right: "7 比 4 多 3；7 是 4 的 1 倍多",
    why: "「多 3」是差，「3 倍」是乘",
    tip: "多几看差，几倍看乘",
    icon: "moreLess",
  },
]

// ────────────────────────────────────────────────────────────
// 四类对照（页面「一条纲」那张表）
// ────────────────────────────────────────────────────────────

export interface SwapRow {
  kind: RelKind
  title: string
  icon: string
  /** 交换前 / 后 的关键片段 */
  before: string
  after: string
  /** 交换的后果 */
  effect: SwapEffect
  /** 一句话 */
  note: string
}

export const SWAP_TABLE: SwapRow[] = [
  {
    kind: "total",
    title: "一共",
    icon: "mergeTerms",
    before: "3 ＋ 5 ＝ 8",
    after: "5 ＋ 3 ＝ 8",
    effect: "keep",
    note: "两边同色，换了不变",
  },
  {
    kind: "compare",
    title: "比多少",
    icon: "moreLess",
    before: "7 比 4 多 3",
    after: "4 比 7 少 3",
    effect: "flipWord",
    note: "数没变，词翻了",
  },
  {
    kind: "times",
    title: "倍数",
    icon: "timesCopies",
    before: "6 是 2 的 3 倍",
    after: "2 是 6 的 1/3",
    effect: "flipRate",
    note: "主宾一换，关系就翻",
  },
  {
    kind: "share",
    title: "平均分",
    icon: "shareEqual",
    // ★ 两格只留算式，「每份几个 / 分成几份」挪到 note：
    //   单元格实测只有 ~120px（比按 430px 视口估的窄 15%），
    //   加上括号里的 6 个全角字必折行，还把这一行撑高、四行高度不齐。
    //   note 占**整行**宽度（grid-column: 1/-1），放得下。
    //   单测的 /(\d+)\s*÷\s*(\d+)\s*＝\s*(\d+)/ 不要求有括号，照旧能验算。
    before: "12÷3＝4",
    after: "12÷4＝3",
    effect: "flipMeaning",
    note: "同一个 12，问每份还是份数",
  },
]
