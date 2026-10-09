/** 三年级上 · 长度与质量单位换算 —— 规则引擎（零后端调用）
 *
 * ── 先认清真正的难点 ─────────────────────────────────────
 * 换算总错，根子几乎不在「记不住 1000」。孩子会把作业本上的西瓜写成「5克」，
 * 是因为他脑子里「克」和「千克」只是两个长得不一样的字，**没有重量**。
 * 没有重量的单位，填空只能靠猜；换算只能靠背「乘 1000 还是除 1000」的口令，
 * 口令一乱就全乱。
 *
 * 所以本引擎把三件事**分开**，并各自给出**能被验证的依据**：
 *   ① 量感 —— 每个单位配真实尺寸的参照物（`UnitDef.refs`），能拿尺子/秤去核对的
 *   ② 方向 —— 不背「大化小乘」，用**切开 / 拼合**推导（见 `planSteps`）
 *   ③ 进率 —— 不背 10 / 100 / 1000，用**切几轮**数出来（见 `roundsOf`）
 *
 * ── ★ 核心统一：进率里有几个 10，就切几轮 ────────────────
 *   10   ⇒ 1 轮（1米 切成 10 段 ⇒ 10分米）
 *   100  ⇒ 2 轮（1米 切成 100 段 ⇒ 100厘米）
 *   1000 ⇒ 3 轮（1千米 切成 1000 段 ⇒ 1000米，也就是 10×10×10）
 *   ⇒ 「1000」不是背来的数字，是**切了三轮**的结果。
 *
 * ── ★ 切分的语义（最容易讲错的一处）────────────────────
 * 每一轮把「当前最小的那一份」再切成 10 份 ⇒ **份数 ×10**，同时**每份变小**。
 * 总长度/总质量始终不变（守恒）。
 *   `1千米` 第1轮 ⇒ 10 份、每份 100米
 *              第2轮 ⇒ 100 份、每份 10米
 *              第3轮 ⇒ 1000 份、每份 1米
 * ⚠️ 只记「×10」而不记「每份同时在变小」，就会把第 1 轮讲成「10米」—— 错。
 *
 * 动画只负责照着 `planSteps` 的轨迹播，自己不参与任何计算。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 两个互不相通的单位族。长度基准 = 毫米，质量基准 = 克 */
export type UnitKind = "length" | "mass"

export type UnitId = "mm" | "cm" | "dm" | "m" | "km" | "g" | "kg" | "t"

/** 一个生活参照物。`real` 为真时页面会按**真实物理尺寸**画出来供学生拿尺子核对 */
export interface UnitRef {
  /**
   * mathIcons.ts 里的图标键。
   * ★ 用图画而不是 emoji：emoji 表达不了「厚度 / 大小」这类关系（🪪 看不出卡有多薄），
   *   而且同一个 emoji 在 Android / iOS / Windows 上长得都不一样。
   */
  icon: string
  /** 物品名。参照物卡上就这么显示，所以**越短越好**（控制在 6 字以内） */
  name: string
  /** 数值，如 "1 毫米" —— 只保留数字和单位，不要句子 */
  detail: string
  /** 真实尺寸示意：画一根这么长的条 / 一块这么厚的截面（只有毫米/厘米/分米有） */
  draw?: { form: "bar" | "slab"; baseAmount: number }
}

export interface UnitDef {
  id: UnitId
  kind: UnitKind
  name: string
  /** 英文缩写（尺子上、英文数学里就写这个） */
  symbol: string
  /** 英文全称 —— ★ 中文单位名旁边要标注的就是它 */
  en: string
  /** 相对**基准单位**的倍数（长度基准毫米 / 质量基准克）。换算一律先化基准再化目标 */
  base: number
  /** 怎么用手比出来 */
  sense: string
  refs: UnitRef[]
  /** 屏幕上能否按真实尺寸画出来（> 1米 就放不下了） */
  onScreenReal: boolean
}

/** 切分/拼合的一轮 */
export interface CutRound {
  /** 第几轮（1 起） */
  round: number
  /** 这一轮之后的份数 */
  count: number
  /** 这一轮之后每份 = 多少个基准单位 */
  pieceBase: number
  /** 每份的友好说法，如 "100米" / "1分米" */
  pieceLabel: string
  /** 每份恰好是某个命名单位时给出它（用于高亮"现在叫分米了"） */
  namedUnit: UnitDef | null
}

export interface UnitPlan {
  from: UnitDef
  to: UnitDef
  value: number
  result: number
  /** 进率（大 ÷ 小，恒 > 1） */
  ratio: number
  /** 切 / 拼几轮 = log10(ratio) */
  rounds: number
  /** split = 单位变小（要切开，×）；merge = 单位变大（要拼合，÷） */
  direction: "split" | "merge"
  op: "×" | "÷"
  cuts: CutRound[]
  /** 渲染格子上限（= 参与动画的最大份数），页面据此决定用条还是用网格 */
  maxCells: number
}

/** 一步一填里的一步 */
export interface UnitStep {
  key: "op" | "rate" | "calc"
  ask: string
  options: string[]
  answer: string
  /** 答对/答错后都要讲的话（讲"为什么"，不复述对错） */
  tip: string
}

export interface UnitProblem {
  groupKey: ProblemGroupKey
  from: UnitDef
  to: UnitDef
  value: number
  result: number
  ratio: number
  op: "×" | "÷"
  rounds: number
  /** 题面，如 "3米 = ?分米" */
  fullText: string
  steps: UnitStep[]
  /** 答完之后的一句话总结 */
  finalNote: string
  /** 易错陷阱：只翻方向的错答（用于最终揭晓） */
  trap: number | null
}

export interface MistakeCase {
  wrong: string
  right: string
  why: string
  tip: string
}

// ────────────────────────────────────────────────────────────
// 单位表
// ★ 参照物全部按人教版三年级上「测量」单元的通行口径，并逐条用「约」限定；
//   其中毫米/厘米/分米三项可由页面按真实尺寸画出来，学生能拿真尺子核对。
// ────────────────────────────────────────────────────────────

export const UNITS: UnitDef[] = [
  // ── 长度（基准 = 毫米）──
  {
    id: "mm",
    kind: "length",
    name: "毫米",
    symbol: "mm",
    en: "millimeter",
    base: 1,
    sense: "两指夹卡的缝",
    refs: [
      { icon: "card", name: "银行卡", detail: "1 毫米", draw: { form: "slab", baseAmount: 1 } },
      { icon: "coin", name: "1 分硬币", detail: "1 毫米" },
      { icon: "papers", name: "10 张纸", detail: "1 毫米" },
      { icon: "ruler", name: "尺子一小格", detail: "1 毫米" },
    ],
    onScreenReal: true,
  },
  {
    id: "cm",
    kind: "length",
    name: "厘米",
    symbol: "cm",
    en: "centimeter",
    base: 10,
    sense: "食指指甲盖",
    refs: [
      { icon: "nail", name: "指甲盖", detail: "1 厘米", draw: { form: "bar", baseAmount: 10 } },
      { icon: "grid", name: "田字格边长", detail: "1 厘米" },
      { icon: "pin", name: "图钉", detail: "1 厘米" },
    ],
    onScreenReal: true,
  },
  {
    id: "dm",
    kind: "length",
    name: "分米",
    symbol: "dm",
    en: "decimeter",
    base: 100,
    sense: "张开手，一拃",
    refs: [
      { icon: "hand", name: "一拃", detail: "1 分米", draw: { form: "bar", baseAmount: 100 } },
      { icon: "switch", name: "开关面板", detail: "1 分米" },
      { icon: "hand", name: "手掌宽", detail: "1 分米" },
    ],
    onScreenReal: true,
  },
  {
    id: "m",
    kind: "length",
    name: "米",
    symbol: "m",
    en: "meter",
    base: 1000,
    sense: "两臂平伸",
    refs: [
      { icon: "door", name: "教室门宽", detail: "1 米" },
      { icon: "childArms", name: "双臂平伸", detail: "1 米" },
      { icon: "podium", name: "讲台桌高", detail: "1 米" },
      { icon: "desk", name: "课桌高", detail: "70 厘米" },
    ],
    onScreenReal: false,
  },
  {
    id: "km",
    kind: "length",
    name: "千米",
    symbol: "km",
    en: "kilometer",
    base: 1_000_000,
    sense: "走 15 分钟",
    refs: [
      { icon: "track", name: "跑道 2 圈半", detail: "1 千米" },
      { icon: "walk", name: "走 15 分钟", detail: "1 千米" },
      { icon: "bus", name: "公交 1 站", detail: "1 千米" },
    ],
    onScreenReal: false,
  },

  // ── 质量（基准 = 克）──
  {
    id: "g",
    kind: "mass",
    name: "克",
    symbol: "g",
    en: "gram",
    base: 1,
    sense: "一粒花生米",
    refs: [
      { icon: "coin", name: "2 分硬币", detail: "1 克" },
      { icon: "clip", name: "回形针", detail: "1 克" },
      { icon: "peanut", name: "两三粒花生", detail: "1 克" },
      { icon: "bean", name: "五六颗黄豆", detail: "1 克" },
    ],
    onScreenReal: false,
  },
  {
    id: "kg",
    kind: "mass",
    name: "千克",
    symbol: "kg",
    en: "kilogram",
    base: 1000,
    sense: "两瓶矿泉水",
    refs: [
      { icon: "sack", name: "两袋盐", detail: "1 千克" },
      { icon: "bottle", name: "两瓶矿泉水", detail: "1 千克" },
      { icon: "apple", name: "5 个苹果", detail: "1 千克" },
      { icon: "kid", name: "三年级小朋友", detail: "25 千克" },
    ],
    onScreenReal: false,
  },
  {
    id: "t",
    kind: "mass",
    name: "吨",
    symbol: "t",
    en: "ton",
    base: 1_000_000,
    sense: "40 个小朋友",
    refs: [
      { icon: "kid", name: "40 个小朋友", detail: "1 吨" },
      { icon: "sack", name: "10 袋大米", detail: "1 吨" },
      { icon: "car", name: "一辆小轿车", detail: "1 吨" },
      { icon: "bottle", name: "2000 瓶水", detail: "1 吨" },
    ],
    onScreenReal: false,
  },
]

const BY_ID: Record<string, UnitDef> = Object.fromEntries(UNITS.map((u) => [u.id, u]))

export function unitOf(id: UnitId | string): UnitDef {
  const u = BY_ID[id]
  if (!u) throw new Error(`未知单位：${id}`)
  return u
}

/** 同一族内按 base 升序（= 从小到大）。单位链的顺序就是它 */
export function unitsOf(kind: UnitKind): UnitDef[] {
  return UNITS.filter((u) => u.kind === kind).sort((a, b) => a.base - b.base)
}

// ────────────────────────────────────────────────────────────
// 换算
// ★ 两套算法并存，是为了让单测能用**两个独立裁判**互相印证：
//   `convert` 走基准单位（引擎实际用法）
//   `convertChain` 沿单位链逐级乘除（单测的对拍用）
//   两者思路完全不同，若某天有人改错了进率，必然只有一边跟着错。
// ────────────────────────────────────────────────────────────

/** 换算（基准单位法）。`3米 → 厘米` = 3×1000/10 = 300 */
export function convert(value: number, from: UnitDef, to: UnitDef): number {
  assertSameKind(from, to)
  return (value * from.base) / to.base
}

/** 换算（沿链逐级法）。只用于对拍，别在生产路径上调。
 *
 * ⚠️ 两个分支的乘除方向极易写反（我第一版就反了，被对拍当场抓出）：
 *   往**大**单位走 ⇒ 数字变**小** ⇒ **除**；往**小**单位走 ⇒ 数字变**大** ⇒ **乘**。
 *   反过来写，`1毫米 → 厘米` 会得到 10 而不是 0.1。
 */
export function convertChain(value: number, from: UnitDef, to: UnitDef): number {
  assertSameKind(from, to)
  const chain = unitsOf(from.kind)
  const i = chain.findIndex((u) => u.id === from.id)
  const j = chain.findIndex((u) => u.id === to.id)
  let v = value
  if (i < j) {
    // 往大单位走 → 除以每一级的进率
    for (let k = i; k < j; k++) v = (v * chain[k].base) / chain[k + 1].base
  } else {
    // 往小单位走 → 乘以每一级的进率
    for (let k = i; k > j; k--) v = (v * chain[k].base) / chain[k - 1].base
  }
  return v
}

function assertSameKind(from: UnitDef, to: UnitDef): void {
  if (from.kind !== to.kind) {
    throw new Error(`长度和质量不能互相换算：${from.name} → ${to.name}`)
  }
}

/** 进率 = 大单位 ÷ 小单位（恒 > 1）。相邻长度单位是 10，米↔千米与质量单位是 1000 */
export function rateOf(from: UnitDef, to: UnitDef): number {
  assertSameKind(from, to)
  return Math.max(from.base, to.base) / Math.min(from.base, to.base)
}

/** 切 / 拼几轮 = 进率里有几个 10。10⇒1、100⇒2、1000⇒3 */
export function roundsOf(from: UnitDef, to: UnitDef): number {
  const r = rateOf(from, to)
  const n = Math.round(Math.log10(r))
  // 本库所有单位都取 10 的整数次幂倍数，所以进率必然是 10 的整数次幂。
  // 一旦有人加了个非 10 幂的单位（比如 1/3），这里必须炸，不能悄悄四舍五入。
  if (Math.abs(Math.pow(10, n) - r) > 1e-9) {
    throw new Error(`进率 ${r} 不是 10 的整数次幂，无法用「切几轮」表示`)
  }
  return n
}

/** 把「多少个基准单位」说成人话：100000 毫米 ⇒ "100米"；10 毫米 ⇒ "1厘米" */
function labelBaseAmount(baseAmount: number, kind: UnitKind): { label: string; named: UnitDef | null } {
  const cands = unitsOf(kind).filter((u) => baseAmount % u.base === 0)
  if (cands.length === 0) return { label: `${baseAmount}`, named: null }
  const u = cands[cands.length - 1] // base 升序 ⇒ 最后一个最大
  const coef = baseAmount / u.base
  return coef === 1 ? { label: `1${u.name}`, named: u } : { label: `${coef}${u.name}`, named: null }
}

/**
 * 切开 / 拼合的完整轨迹。
 *
 * `split`（单位变小，要切开）：第 r 轮 ⇒ 份数 = value×10^r，每份 = from.base / 10^r
 * `merge`（单位变大，要拼合）：第 r 轮 ⇒ 份数 = value/10^r，每份 = from.base × 10^r
 * 两种情形下 `份数 × 每份` 恒等于 `value × from.base`（总量守恒）。
 */
export function planSteps(from: UnitDef, to: UnitDef, value: number): UnitPlan {
  assertSameKind(from, to)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`参与换算的数必须是正数：${value}`)
  }
  const ratio = rateOf(from, to)
  const rounds = roundsOf(from, to)
  const split = from.base > to.base // 大单位变小单位 ⇒ 切开
  const direction: UnitPlan["direction"] = split ? "split" : "merge"
  const op: UnitPlan["op"] = split ? "×" : "÷"

  const cuts: CutRound[] = []
  for (let r = 1; r <= rounds; r++) {
    const f = Math.pow(10, r)
    const count = split ? value * f : value / f
    const pieceBase = split ? from.base / f : from.base * f
    const { label, named } = labelBaseAmount(pieceBase, from.kind)
    cuts.push({ round: r, count, pieceBase, pieceLabel: label, namedUnit: named })
  }

  const result = convert(value, from, to)
  const maxCells = Math.max(value, result)

  return { from, to, value, result, ratio, rounds, direction, op, cuts, maxCells }
}

/** 题面/答案里的数量写法：中文数学题里数字和单位之间不空格 */
export function qty(value: number, unit: UnitDef): string {
  return `${value}${unit.name}`
}

/** 数量写法 + 英文标注：`7厘米(cm)`。★ 页面要「中文单位旁标英文」就用它，别在页面里手拼 */
export function qtyEn(value: number, unit: UnitDef): string {
  return `${value}${unit.name}(${unit.symbol})`
}

// ────────────────────────────────────────────────────────────
// 尺子实例「亮出这一段」—— 拿尺子做基准，用实例子建立量感
// ────────────────────────────────────────────────────────────

export interface ReadingPart {
  /** 这一部分的数值，如 7 */
  value: number
  /** 这一部分的单位，如 厘米 */
  unit: UnitDef
  /** 这一部分折成多少毫米（= value × unit.base）。页面按它把亮区**分段**，不自己算 */
  mm: number
}

export interface RulerReading {
  /** 这一段一共多少毫米（= 尺子上亮到第几小格） */
  mm: number
  /**
   * 中文复合写法，如 "7厘米3毫米"。
   * ★ 三年级课本就是这么读长度的（不说「73毫米」）—— 但它和「73毫米」是同一段。
   */
  label: string
  /** 拆开的部分，从大到小（"7厘米3毫米" ⇒ 7厘米 + 3毫米）。页面按它把亮区**画成几段** */
  parts: ReadingPart[]
  /** 同一段长度的整数写法（带英文标注），从大到小，如 ["73毫米(mm)"] */
  same: string[]
}

/**
 * ★ 同一段长度、不同单位写法 —— **由单位表派生，绝不手写**。
 * 找出所有「base 能整除 mm」的长度单位（只到米为止；千米一把尺子放不下）。
 *   70  ⇒ [{7,厘米}, {70,毫米}]
 *   100 ⇒ [{1,分米}, {10,厘米}, {100,毫米}]
 * 之所以要「整除」，是因为尺子上读出来的必须是整数 —— 7 厘米就是 7 厘米，
 * 不许变成 `0.7 分米`（三年级不要求）。
 */
export function readingsOf(mm: number): { value: number; unit: UnitDef }[] {
  if (!Number.isInteger(mm) || mm <= 0) {
    throw new Error(`尺子例子必须是正整数毫米：${mm}`)
  }
  return unitsOf("length")
    .filter((u) => u.base <= 1000 && mm % u.base === 0)
    .sort((a, b) => b.base - a.base) // 大单位在前 = 读起来最自然的那个
    .map((u) => ({ value: mm / u.base, unit: u }))
}

/** 能在一把尺子上读出来的长度单位（毫米/厘米/分米/米；千米要 378 万像素，放不下） */
export function rulerUnits(): UnitDef[] {
  return unitsOf("length")
    .filter((u) => u.base <= 1000)
    .sort((a, b) => b.base - a.base)
}

/**
 * ★ 复合读法：像「7厘米3毫米」这样，用**两个单位**说同一段长度。
 *
 * 三年级读「7厘米3毫米」而不是「73毫米」—— 两者是同一段。这里用**贪心拆解**
 * （从大单位往小单位走）把它算出来，页面绝不手写这些数字：
 *   73   ⇒ 7厘米3毫米   （7×10 + 3）
 *   1200 ⇒ 1米2分米     （1×1000 + 2×100）
 *   1500 ⇒ 1米5分米     （中间那级恰好是 0 就跳过，不写「0分米」）
 *   5    ⇒ 5毫米        （只有一级）
 */
export function compoundOf(mm: number): { mm: number; label: string; parts: ReadingPart[] } {
  if (!Number.isInteger(mm) || mm <= 0) {
    throw new Error(`尺子例子必须是正整数毫米：${mm}`)
  }
  const parts: ReadingPart[] = []
  let rest = mm
  for (const u of rulerUnits()) {
    const value = Math.floor(rest / u.base)
    if (value <= 0) continue
    parts.push({ value, unit: u, mm: value * u.base })
    rest -= value * u.base
  }
  if (rest !== 0) throw new Error(`${mm} 毫米拆不出整数单位（不该发生）`)
  return { mm, label: parts.map((p) => `${p.value}${p.unit.name}`).join(""), parts }
}

/** 学生尺（**真实尺寸** 0..100 毫米 = 10 厘米）上的例子 —— 含复合读法 */
export const RULER_EXAMPLE_MM = [5, 10, 25, 37, 70, 73, 98, 100]

/** 米尺（**示意图** 0..1.5 米）上的例子，用毫米表示 —— 分米 / 米 / 复合 */
export const METER_EXAMPLE_MM = [100, 500, 1000, 1200]

/** 米尺画到多少厘米（= 15 大格，刚好把「1米2分米」这种复合例子装进来） */
export const METER_RULER_CM = 150

/** 一段长度的一套读法：复合中文写法 + 各种整数写法（带英文标注） */
function readingOf(mm: number): RulerReading {
  const c = compoundOf(mm)
  return {
    mm,
    label: c.label,
    parts: c.parts,
    same: readingsOf(mm).map((r) => qtyEn(r.value, r.unit)),
  }
}

export function rulerExamples(): RulerReading[] {
  return [...RULER_EXAMPLE_MM].sort((a, b) => a - b).map(readingOf)
}

export function meterExamples(): RulerReading[] {
  return [...METER_EXAMPLE_MM].sort((a, b) => a - b).map(readingOf)
}

// ────────────────────────────────────────────────────────────
// 相邻单位对（主舞台只演示这些 —— 用户要的就是「相邻单位之间的转换」）
// ────────────────────────────────────────────────────────────

export interface UnitPair {
  key: string
  kind: UnitKind
  /** 小单位 */
  small: UnitDef
  /** 大单位 */
  big: UnitDef
  ratio: number
}

function buildPairs(kind: UnitKind): UnitPair[] {
  const chain = unitsOf(kind)
  const out: UnitPair[] = []
  for (let i = 0; i < chain.length - 1; i++) {
    const small = chain[i]
    const big = chain[i + 1]
    out.push({ key: `${small.id}-${big.id}`, kind, small, big, ratio: big.base / small.base })
  }
  return out
}

export const ADJACENT_PAIRS: UnitPair[] = [...buildPairs("length"), ...buildPairs("mass")]

export function pairsOf(kind: UnitKind): UnitPair[] {
  return ADJACENT_PAIRS.filter((p) => p.kind === kind)
}

// ────────────────────────────────────────────────────────────
// 单位关系（米尺对照块的事实来源 —— 页面不许自己手写这些式子）
// ────────────────────────────────────────────────────────────

export interface ChainFact {
  text: string
  note: string
}

/** 长度链条：三个 10 叠成 1000，这就是「可数出来的 1000」 */
export const LENGTH_FACTS: ChainFact[] = [
  { text: "1米(m) = 10分米(dm)", note: "把 1 米切成 10 段，每段就是 1 分米" },
  { text: "1分米(dm) = 10厘米(cm)", note: "把 1 分米切成 10 段，每段就是 1 厘米" },
  { text: "1厘米(cm) = 10毫米(mm)", note: "把 1 厘米切成 10 段，每段就是 1 毫米" },
  { text: "1米(m) = 100厘米(cm)", note: "切了两轮：10 × 10 = 100" },
  { text: "1米(m) = 1000毫米(mm)", note: "切了三轮：10 × 10 × 10 = 1000" },
  { text: "1千米(km) = 1000米(m)", note: "这一对进率是 1000，不是 10 —— 最容易记错的一个" },
]

export const MASS_FACTS: ChainFact[] = [
  { text: "1千克(kg) = 1000克(g)", note: "把 1 千克切成 1000 份，每份就是 1 克" },
  { text: "1吨(t) = 1000千克(kg)", note: "把 1 吨切成 1000 份，每份就是 1 千克" },
  { text: "1吨(t) = 1000000克(g)", note: "切了六轮，所以是 1000 × 1000（这一步三年级不要求算，只要知道很大）" },
]

export function factsOf(kind: UnitKind): ChainFact[] {
  return kind === "length" ? LENGTH_FACTS : MASS_FACTS
}

// ────────────────────────────────────────────────────────────
// 口诀（页面的「规律卡」）
// ────────────────────────────────────────────────────────────

export interface Rule {
  title: string
  body: string
}

export const RULES: Rule[] = [
  {
    title: "先看清是「切开」还是「拼合」",
    body: "切开 ⇒ 份数变多 ⇒ 乘　｜　拼合 ⇒ 份数变少 ⇒ 除",
  },
  {
    title: "进率不用背，数一数是几个 10",
    body: "长度相邻都是 10（米 m↔千米 km 例外，是 1000）；质量相邻都是 1000",
  },
  {
    title: "换算前先想「它有多大」",
    body: "西瓜 5 千克(kg) 不是 5 克(g)。先掂一掂，再动笔",
  },
]

// ────────────────────────────────────────────────────────────
// 易错案例（每一条都人工验算过；页面滚动进入视口时先抖红的、再揭晓绿的）
// ────────────────────────────────────────────────────────────

export const MISTAKE_CASES: MistakeCase[] = [
  {
    wrong: "5米(m) = 500分米(dm)",
    right: "5米(m) = 50分米(dm)",
    why: "米(m)和分米(dm)相邻，进率 10",
    tip: "乘 100 那是换成厘米(cm)",
  },
  {
    wrong: "1千米(km) = 100米(m)",
    right: "1千米(km) = 1000米(m)",
    why: "米(m)和千米(km)是唯一的例外：进率 1000",
    tip: "跑道 2 圈半才 1 千米(km)",
  },
  {
    wrong: "3000克(g) = 300千克(kg)",
    right: "3000克(g) = 3千克(kg)",
    why: "克(g)→千克(kg)进率是 1000，不是 10",
    tip: "1000 克(g) 才是 1 千克(kg)",
  },
  {
    wrong: "4吨(t) = 400千克(kg)",
    right: "4吨(t) = 4000千克(kg)",
    why: "吨(t)→千克(kg)要乘 1000",
    tip: "1 吨(t) = 10 袋 100 千克(kg)的米",
  },
  {
    wrong: "20毫米(mm) = 2米(m)",
    right: "20毫米(mm) = 2厘米(cm)",
    why: "毫米(mm)→米(m)要跨两道，进率 1000",
    tip: "20 毫米(mm)还没一根手指宽",
  },
  {
    wrong: "一个西瓜重 5 克(g)",
    right: "一个西瓜重 5 千克(kg)",
    why: "5 克(g)只有一粒花生米重",
    tip: "两瓶矿泉水就是 1 千克(kg)",
  },
  {
    wrong: "3米(m) + 50厘米(cm) = 53米(m)",
    right: "3米(m) + 50厘米(cm) = 350厘米(cm)（也就是 3米50厘米）",
    why: "单位不同不能直接相加",
    tip: "先化成 300 厘米(cm)再算",
  },
]

// ────────────────────────────────────────────────────────────
// 一步一填的题组
// ────────────────────────────────────────────────────────────

export type ProblemGroupKey = "lengthAdjacent" | "lengthKm" | "mass" | "cross"

export interface ProblemGroup {
  key: ProblemGroupKey
  title: string
  desc: string
  pairs: [UnitId, UnitId][]
}

/** ★ 题组是**唯一来源**：页面渲染题组按钮、引擎抽题都读这里，页面绝不手写清单 */
export const PROBLEM_GROUPS: ProblemGroup[] = [
  {
    key: "lengthAdjacent",
    title: "长度 · 相邻",
    desc: "毫米↔厘米↔分米↔米，进率都是 10",
    pairs: [
      ["mm", "cm"],
      ["cm", "dm"],
      ["dm", "m"],
    ],
  },
  {
    key: "lengthKm",
    title: "长度 · 米和千米",
    desc: "进率是 1000，不是 10 —— 最爱错的一对",
    pairs: [["m", "km"]],
  },
  {
    key: "mass",
    title: "质量 · 相邻",
    desc: "克↔千克↔吨，进率都是 1000",
    pairs: [
      ["g", "kg"],
      ["kg", "t"],
    ],
  },
  {
    key: "cross",
    title: "跨级换算",
    desc: "中间隔着一两个单位，进率是 100 或 1000",
    pairs: [
      ["mm", "dm"],
      ["cm", "m"],
      ["mm", "m"],
    ],
  },
]

/** 进率候选只有这三个 —— 学生真正会混的就是它们 */
const RATE_CHOICES = [10, 100, 1000]

function rnd(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 反推参数出题（★ 先定「要走的这一步」，再定操作数 —— 保证结果永远是整数）。
 *
 * - 单位变小（要乘）：操作数取 1..9，结果 = 操作数 × 进率
 * - 单位变大（要除）：操作数取 进率×1..9，结果 = 操作数 ÷ 进率
 * 两条路径的 `result` 都必然是 1..9 的整数，不会出现分数。
 */
export function genProblem(groupKey: ProblemGroupKey): UnitProblem {
  const group = PROBLEM_GROUPS.find((g) => g.key === groupKey)
  if (!group) throw new Error(`未知题组：${groupKey}`)

  const [aId, bId] = pick(group.pairs)
  const a = unitOf(aId)
  const b = unitOf(bId)
  const small = a.base < b.base ? a : b
  const big = a.base < b.base ? b : a
  const ratio = big.base / small.base

  const toSmaller = Math.random() < 0.5
  const from = toSmaller ? big : small
  const to = toSmaller ? small : big

  const k = rnd(1, 9)
  const value = toSmaller ? k : k * ratio
  const result = toSmaller ? k * ratio : k

  const split = toSmaller // 单位变小 ⇒ 切开 ⇒ ×
  // ⚠️ 注解必须是字面量联合，不能写 UnitStep["answer"]（那是 string）——
  //    否则赋给 UnitProblem.op（"×" | "÷"）会报 TS2322，而报错位置在 return 那一行。
  const op: "×" | "÷" = split ? "×" : "÷"
  const rounds = roundsOf(from, to)

  // ★ 文案刻意压短：一屏里每句话都长，学生就不看了 —— 能交给动画/图示的就不写句子。
  const opTip = split
    ? `「${from.name}」大、要切开 ⇒ 份数变多 ⇒ 用乘`
    : `「${from.name}」小、要拼合 ⇒ 份数变少 ⇒ 用除`

  const rateTip = rounds === 1
    ? `相邻单位，进率就是 ${ratio}`
    : `中间隔着 ${rounds - 1} 个单位：${Array.from({ length: rounds }, () => "10").join(" × ")} ⇒ ${ratio}`

  // 第 3 步的干扰项：把乘当加（3×10 ⇒ 13）、进率用错、方向用错
  const trapSet = new Set<number>()
  const addWrong = value + ratio
  if (addWrong !== result) trapSet.add(addWrong)
  for (const r of RATE_CHOICES) {
    const v = split ? value * r : value / r
    if (v !== result && Number.isInteger(v) && v > 0) trapSet.add(v)
  }
  const calcOptions = shuffle([result, ...[...trapSet].slice(0, 3)]).map(String)

  const steps: UnitStep[] = [
    {
      key: "op",
      ask: `单位从「${from.name}」变成「${to.name}」，这一步该乘还是该除？`,
      options: ["×", "÷"],
      answer: op,
      tip: opTip,
    },
    {
      key: "rate",
      ask: `${from.name}和${to.name}之间的进率是多少？`,
      options: RATE_CHOICES.map(String),
      answer: String(ratio),
      tip: rateTip,
    },
    {
      key: "calc",
      ask: `${value} ${op} ${ratio} = ?`,
      options: calcOptions,
      answer: String(result),
      tip: `${value} ${op} ${ratio} = ${result} ⇒ ${qty(value, from)} = ${qty(result, to)}`,
    },
  ]

  // 只翻方向的错答（学生最典型的一种错）—— 最终揭晓时用来点破
  const flipped = split ? value / ratio : value * ratio
  const trap = Number.isInteger(flipped) && flipped > 0 ? flipped : null

  const cutDesc = rounds === 1 ? "切 1 轮" : `切 ${rounds} 轮`

  return {
    groupKey,
    from,
    to,
    value,
    result,
    ratio,
    op,
    rounds,
    fullText: `${qtyEn(value, from)} = ?${to.name}(${to.symbol})`,
    steps,
    finalNote: `${qty(value, from)} = ${qty(result, to)}（${cutDesc}）`,
    trap,
  }
}

/** 一次抽 n 道（页面用 6 道一组）。同一组内不重复同一对单位 */
export function genProblemSet(groupKey: ProblemGroupKey, n = 6): UnitProblem[] {
  const out: UnitProblem[] = []
  const seen = new Set<string>()
  let guard = 0
  while (out.length < n && guard < n * 60) {
    guard++
    const p = genProblem(groupKey)
    const tag = `${p.from.id}-${p.to.id}-${p.value}`
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(p)
  }
  return out
}
