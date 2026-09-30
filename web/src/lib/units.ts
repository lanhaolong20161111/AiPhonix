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
  emoji: string
  name: string
  detail: string
  /** 真实尺寸示意：length = 画一根这么长的条；thickness = 画一个这么厚的截面 */
  draw?: { form: "bar" | "slab"; baseAmount: number }
}

export interface UnitDef {
  id: UnitId
  kind: UnitKind
  name: string
  symbol: string
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
    base: 1,
    sense: "用拇指和食指轻轻夹住一张银行卡，抽出卡片后两指间的缝隙大约是 1 毫米",
    refs: [
      { emoji: "🪪", name: "身份证的厚度", detail: "约 1 毫米", draw: { form: "slab", baseAmount: 1 } },
      { emoji: "🪙", name: "1 分硬币的厚度", detail: "约 1 毫米" },
      { emoji: "📄", name: "10 张纸的厚度", detail: "约 1 毫米" },
      { emoji: "📏", name: "尺子上 1 厘米里的一小格", detail: "就是 1 毫米" },
    ],
    onScreenReal: true,
  },
  {
    id: "cm",
    kind: "length",
    name: "厘米",
    symbol: "cm",
    base: 10,
    sense: "食指指甲盖的宽度，大约就是 1 厘米",
    refs: [
      { emoji: "💅", name: "食指指甲盖的宽度", detail: "约 1 厘米", draw: { form: "bar", baseAmount: 10 } },
      { emoji: "🔠", name: "田字格一个方格的边长", detail: "约 1 厘米" },
      { emoji: "📌", name: "一个图钉的长度", detail: "约 1 厘米" },
    ],
    onScreenReal: true,
  },
  {
    id: "dm",
    kind: "length",
    name: "分米",
    symbol: "dm",
    base: 100,
    sense: "手掌张开，拇指尖到中指指尖（一拃），大约是 1 分米",
    refs: [
      { emoji: "🖐️", name: "一拃（拇指尖到中指指尖）", detail: "约 1 分米", draw: { form: "bar", baseAmount: 100 } },
      { emoji: "🔲", name: "墙壁开关面板的边长", detail: "约 1 分米" },
      { emoji: "✋", name: "大人手掌的宽度", detail: "约 1 分米" },
    ],
    onScreenReal: true,
  },
  {
    id: "m",
    kind: "length",
    name: "米",
    symbol: "m",
    base: 1000,
    sense: "把两臂平平伸开，左右手指尖之间的距离大约是 1 米",
    refs: [
      { emoji: "🚪", name: "教室门的宽度", detail: "约 1 米" },
      { emoji: "🧒", name: "小朋友双臂平伸的长度", detail: "约 1 米" },
      { emoji: "🪑", name: "讲台桌的高度", detail: "约 1 米" },
      { emoji: "🛏️", name: "课桌的高度", detail: "约 70 厘米，比 1 米矮一点" },
    ],
    onScreenReal: false,
  },
  {
    id: "km",
    kind: "length",
    name: "千米",
    symbol: "km",
    base: 1_000_000,
    sense: "跑道上跑 2 圈半（400 米一圈），或者一直走大约 15 分钟",
    refs: [
      { emoji: "🏃", name: "400 米跑道跑 2 圈半", detail: "正好 1000 米" },
      { emoji: "🚶", name: "不停走大约 15 分钟", detail: "约 1 千米" },
      { emoji: "🚌", name: "公交车大约坐 1 站", detail: "约 1 千米" },
    ],
    onScreenReal: false,
  },

  // ── 质量（基准 = 克）──
  {
    id: "g",
    kind: "mass",
    name: "克",
    symbol: "g",
    base: 1,
    sense: "把一粒花生米放在手心，几乎感觉不到重量 —— 那大约就是 1 克",
    refs: [
      { emoji: "🪙", name: "1 枚 2 分硬币", detail: "约 1 克" },
      { emoji: "📎", name: "1 个回形针", detail: "约 1 克" },
      { emoji: "🥜", name: "两三粒花生米", detail: "约 1 克" },
      { emoji: "🍚", name: "五六颗黄豆", detail: "约 1 克" },
    ],
    onScreenReal: false,
  },
  {
    id: "kg",
    kind: "mass",
    name: "千克",
    symbol: "kg",
    base: 1000,
    sense: "一只手提两瓶 500 毫升的矿泉水 —— 差不多就是 1 千克",
    refs: [
      { emoji: "🧂", name: "两袋 500 克的盐", detail: "正好 1 千克" },
      { emoji: "💧", name: "两瓶 500 毫升的矿泉水", detail: "约 1 千克" },
      { emoji: "🍎", name: "5 个中等个头的苹果", detail: "约 1 千克" },
      { emoji: "🧒", name: "三年级小朋友的体重", detail: "约 25 千克" },
    ],
    onScreenReal: false,
  },
  {
    id: "t",
    kind: "mass",
    name: "吨",
    symbol: "t",
    base: 1_000_000,
    sense: "吨没法用手掂，只能用数量堆出来 —— 要 40 个小朋友加起来才有 1 吨",
    refs: [
      { emoji: "🧒", name: "40 个小朋友（每人 25 千克）", detail: "正好 1 吨" },
      { emoji: "🍚", name: "10 袋 100 千克的大米", detail: "正好 1 吨" },
      { emoji: "🚗", name: "一辆小轿车", detail: "约 1 吨" },
      { emoji: "💧", name: "2000 瓶 500 克的水", detail: "正好 1 吨" },
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
  { text: "1米 = 10分米", note: "把 1 米切成 10 段，每段就是 1 分米" },
  { text: "1分米 = 10厘米", note: "把 1 分米切成 10 段，每段就是 1 厘米" },
  { text: "1厘米 = 10毫米", note: "把 1 厘米切成 10 段，每段就是 1 毫米" },
  { text: "1米 = 100厘米", note: "切了两轮：10 × 10 = 100" },
  { text: "1米 = 1000毫米", note: "切了三轮：10 × 10 × 10 = 1000" },
  { text: "1千米 = 1000米", note: "这一对进率是 1000，不是 10 —— 最容易记错的一个" },
]

export const MASS_FACTS: ChainFact[] = [
  { text: "1千克 = 1000克", note: "把 1 千克切成 1000 份，每份就是 1 克" },
  { text: "1吨 = 1000千克", note: "把 1 吨切成 1000 份，每份就是 1 千克" },
  { text: "1吨 = 1000000克", note: "切了六轮，所以是 1000 × 1000（这一步三年级不要求算，只要知道很大）" },
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
    body:
      "单位变小了（米 → 分米），就要把一个大的切开成很多小的，份数变多 ⇒ 用乘。" +
      "单位变大了（分米 → 米），就要把很多小的拼成一个大的，份数变少 ⇒ 用除。" +
      "口诀只有一句：单位变小数变大，单位变大树变小。",
  },
  {
    title: "进率不用背，数一数是几个 10",
    body:
      "长度单位里，毫米、厘米、分米、米每相邻两个都是 10，所以 1 米 = 10×10×10 = 1000 毫米。" +
      "但米和千米之间是 1000，不是 10 —— 这一对单独记。质量单位克、千克、吨相邻两个都是 1000。",
  },
  {
    title: "换算前先想「它有多大」",
    body:
      "一个西瓜重 5 千克，不是 5 克；一个小朋友重 25 千克，不是 25 克。" +
      "拿不准单位的时候，先在心里掂一掂、比一比，再动笔算。",
  },
]

// ────────────────────────────────────────────────────────────
// 易错案例（每一条都人工验算过；页面滚动进入视口时先抖红的、再揭晓绿的）
// ────────────────────────────────────────────────────────────

export const MISTAKE_CASES: MistakeCase[] = [
  {
    wrong: "5米 = 500分米",
    right: "5米 = 50分米",
    why: "把「米 → 厘米」的进率 100 用在了「米 → 分米」上。米和分米是**相邻**单位，进率是 10。",
    tip: "米 → 分米：切开一轮，5×10 = 50。要乘 100 那是换成厘米。",
  },
  {
    wrong: "1千米 = 100米",
    right: "1千米 = 1000米",
    why: "米和千米的进率是整个长度单位里的例外 —— 它不是 10，而是 1000。",
    tip: "400 米的跑道跑 2 圈半才到 1 千米，怎么可能只有 100 米。",
  },
  {
    wrong: "3000克 = 300千克",
    right: "3000克 = 3千克",
    why: "克 → 千克的进率是 1000，不是 10，所以是除以 1000。",
    tip: "1000 克才是 1 千克，3000 克里正好有 3 个 1000。",
  },
  {
    wrong: "4吨 = 400千克",
    right: "4吨 = 4000千克",
    why: "吨 → 千克要乘 1000。写成 400 相当于只乘了 100。",
    tip: "1 吨就是 10 袋 100 千克的大米，4 吨就是 40 袋。",
  },
  {
    wrong: "20毫米 = 2米",
    right: "20毫米 = 2厘米",
    why: "毫米换成米要跨过厘米、分米两道，进率是 1000；换成厘米只需一步，进率是 10。",
    tip: "20 毫米还没有一根手指宽，怎么可能是 2 米（比门还高）。",
  },
  {
    wrong: "一个西瓜重5克",
    right: "一个西瓜重5千克",
    why: "5 克大约只有一粒花生米那么重。错在单位选错，不在算错。",
    tip: "拿不准的时候先掂一掂：两瓶矿泉水就是 1 千克，西瓜比它重得多。",
  },
  {
    wrong: "3米 + 50厘米 = 53米",
    right: "3米 + 50厘米 = 350厘米（也就是 3米50厘米）",
    why: "单位不同不能直接相加，要先把 3 米化成 300 厘米再算。",
    tip: "不同单位的数相加相减之前，第一步永远是「单位对齐」。",
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

  const cutWord = split ? "切开" : "拼合"
  const opTip = split
    ? `「${from.name}」比「${to.name}」大。把 1 个${from.name}${cutWord}成很多个${to.name}，份数变多 ⇒ 用乘。`
    : `「${from.name}」比「${to.name}」小。要把很多个${from.name}${cutWord}成 1 个${to.name}，份数变少 ⇒ 用除。`

  const rateTip =
    `${from.name} 和 ${to.name} ${rounds === 1 ? "是相邻单位，进率是 10" : `之间隔着 ${rounds - 1} 个单位，进率是 10 乘 ${rounds} 次`}` +
    `，所以进率是 ${ratio}。`

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
      tip: `${value}${op === "×" ? "×" : "÷"}${ratio} = ${result}。所以 ${qty(value, from)} = ${qty(result, to)}。`,
    },
  ]

  // 只翻方向的错答（学生最典型的一种错）—— 最终揭晓时用来点破
  const flipped = split ? value / ratio : value * ratio
  const trap = Number.isInteger(flipped) && flipped > 0 ? flipped : null

  const cutDesc =
    rounds === 1
      ? `只需切 1 轮：10 份`
      : `要切 ${rounds} 轮：${Array.from({ length: rounds }, () => 10).join(" × ")} = ${ratio} 份`

  return {
    groupKey,
    from,
    to,
    value,
    result,
    ratio,
    op,
    rounds,
    fullText: `${qty(value, from)} = ?${to.name}`,
    steps,
    finalNote: `${qty(value, from)} = ${qty(result, to)}。${cutDesc}。`,
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
