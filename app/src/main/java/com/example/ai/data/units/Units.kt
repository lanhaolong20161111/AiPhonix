package com.example.ai.data.units

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * 三年级上 · 长度与质量单位换算 —— 规则引擎（零后端调用）
 *
 * 移植自 `web/src/lib/units.ts`，逐函数对齐。与 web 的差异只有三处，且都是**必要的**：
 *   1. web 用 `Math.random()`，Kotlin 侧改为注入 [Random]（默认 `Random.Default`）——
 *      否则单测无法复现「抽到的题确实属于它宣称的题组」。
 *   2. web 的 `number` 是双精度浮点，Kotlin 侧一律显式用 [Double]（严禁用 Int，
 *      否则 `1毫米 → 厘米` 会**静默截断成 0**）。
 *   3. 数字转字符串走 [unitNumStr]：Kotlin `Double.toString()` 会把 `300.0` 打成 `"300.0"`，
 *      而 JS `String(300)` 是 `"300"`。
 *
 * ── 先认清真正的难点 ─────────────────────────────────────
 * 换算总错，根子几乎不在「记不住 1000」。孩子会把作业本上的西瓜写成「5克」，
 * 是因为他脑子里「克」和「千克」只是两个长得不一样的字，**没有重量**。
 *
 * 所以本引擎把三件事**分开**，并各自给出能被验证的依据：
 *   ① 量感 —— 每个单位配真实尺寸的参照物（[UnitDef.refs]）
 *   ② 方向 —— 不背「大化小乘」，用**切开 / 拼合**推导（见 [planSteps]）
 *   ③ 进率 —— 不背 10 / 100 / 1000，用**切几轮**数出来（见 [roundsOf]）
 *
 * ── 核心统一：进率里有几个 10，就切几轮 ────────────────
 *   10 ⇒ 1 轮、100 ⇒ 2 轮、1000 ⇒ 3 轮 ⇒ 「1000」不是背来的，是**切了三轮**的结果。
 *
 * ── 切分的语义（最容易讲错的一处）────────────────────
 * 每一轮把「当前最小的那一份」再切成 10 份 ⇒ **份数 ×10**，同时**每份变小**。
 *   1千米 第1轮 ⇒ 10 份、每份 100米；第2轮 ⇒ 100 份、每份 10米；第3轮 ⇒ 1000 份、每份 1米
 * ⚠️ 只记「×10」而不记「每份同时在变小」，就会把第 1 轮讲成「10米」—— 错。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 两个互不相通的单位族。长度基准 = 毫米，质量基准 = 克 */
enum class UnitKind { LENGTH, MASS }

/** 八个单位。用枚举而不是裸字符串，避免「拼错 id 静默失败」 */
enum class UnitId(val key: String) {
    MM("mm"), CM("cm"), DM("dm"), M("m"), KM("km"),
    G("g"), KG("kg"), T("t");

    companion object {
        fun fromKey(key: String): UnitId =
            entries.firstOrNull { it.key == key } ?: throw IllegalArgumentException("未知单位：$key")
    }
}

/** 真实尺寸示意：bar = 画一根这么长的条；slab = 画一个这么厚的截面 */
data class UnitDraw(val form: String, val baseAmount: Double)

/** 一个生活参照物。`real` 为真时页面会按**真实物理尺寸**画出来供学生拿尺子核对 */
data class UnitRef(
    val emoji: String,
    val name: String,
    val detail: String,
    val draw: UnitDraw? = null,
)

data class UnitDef(
    val id: UnitId,
    val kind: UnitKind,
    val name: String,
    val symbol: String,
    /** 相对**基准单位**的倍数（长度基准毫米 / 质量基准克） */
    val base: Double,
    /** 怎么用手比出来 */
    val sense: String,
    val refs: List<UnitRef>,
    /** 屏幕上能否按真实尺寸画出来（> 1米 就放不下了） */
    val onScreenReal: Boolean,
)

/** 切分/拼合的一轮 */
data class CutRound(
    /** 第几轮（1 起） */
    val round: Int,
    /** 这一轮之后的份数 */
    val count: Double,
    /** 这一轮之后每份 = 多少个基准单位 */
    val pieceBase: Double,
    /** 每份的友好说法，如 "100米" / "1分米" */
    val pieceLabel: String,
    /** 每份恰好是某个命名单位时给出它（用于高亮「现在叫分米了」） */
    val namedUnit: UnitDef?,
)

data class UnitPlan(
    val from: UnitDef,
    val to: UnitDef,
    val value: Double,
    val result: Double,
    /** 进率（大 ÷ 小，恒 > 1） */
    val ratio: Double,
    /** 切 / 拼几轮 = log10(ratio) */
    val rounds: Int,
    /** SPLIT = 单位变小（要切开，×）；MERGE = 单位变大（要拼合，÷） */
    val direction: UnitDirection,
    val op: String,
    val cuts: List<CutRound>,
    /** 渲染格子上限（= 参与动画的最大份数），页面据此决定用条还是用网格 */
    val maxCells: Double,
)

enum class UnitDirection { SPLIT, MERGE }

/** 一步一填里的一步 */
data class UnitStep(
    val key: String,
    val ask: String,
    val options: List<String>,
    val answer: String,
    /** 答对/答错后都要讲的话（讲「为什么」，不复述对错） */
    val tip: String,
)

data class UnitProblem(
    val groupKey: ProblemGroupKey,
    val from: UnitDef,
    val to: UnitDef,
    val value: Double,
    val result: Double,
    val ratio: Double,
    val op: String,
    val rounds: Int,
    /** 题面，如 "3米 = ?分米" */
    val fullText: String,
    val steps: List<UnitStep>,
    /** 答完之后的一句话总结 */
    val finalNote: String,
    /** 易错陷阱：只翻方向的错答（用于最终揭晓） */
    val trap: Double?,
)

data class UnitMistakeCase(
    val wrong: String,
    val right: String,
    val why: String,
    val tip: String,
)

data class UnitRule(val title: String, val body: String)

data class ChainFact(val text: String, val note: String)

// ────────────────────────────────────────────────────────────
// 数字转字符串（对齐 JS `String(number)`）
// ────────────────────────────────────────────────────────────

/**
 * ★ 对齐 JS `String(n)`：整数值不带小数点。
 * Kotlin `Double.toString()` 会把 `300.0` 打成 `"300.0"`，直接拼进题面就是 `300.0厘米`。
 */
fun unitNumStr(v: Double): String {
    if (v.isNaN()) return "NaN"
    if (v == v.toLong().toDouble()) return v.toLong().toString()
    // 本库所有数都是 k×10^n 形态，Java 的 Double.toString 会给出最短往返表示（0.1 / 0.001）
    return v.toString()
}

/** 题面/答案里的数量写法：中文数学题里数字和单位之间不空格 */
fun qty(value: Double, unit: UnitDef): String = unitNumStr(value) + unit.name

// ────────────────────────────────────────────────────────────
// 单位表
// ★ 参照物全部按人教版三年级上「测量」单元的通行口径，并逐条用「约」限定；
//   其中毫米/厘米/分米三项可由页面按真实尺寸画出来，学生能拿真尺子核对。
// ────────────────────────────────────────────────────────────

val UNITS: List<UnitDef> = listOf(
    // ── 长度（基准 = 毫米）──
    UnitDef(
        id = UnitId.MM, kind = UnitKind.LENGTH, name = "毫米", symbol = "mm", base = 1.0,
        sense = "用拇指和食指轻轻夹住一张银行卡，抽出卡片后两指间的缝隙大约是 1 毫米",
        refs = listOf(
            UnitRef("🪪", "身份证的厚度", "约 1 毫米", UnitDraw("slab", 1.0)),
            UnitRef("🪙", "1 分硬币的厚度", "约 1 毫米"),
            UnitRef("📄", "10 张纸的厚度", "约 1 毫米"),
            UnitRef("📏", "尺子上 1 厘米里的一小格", "就是 1 毫米"),
        ),
        onScreenReal = true,
    ),
    UnitDef(
        id = UnitId.CM, kind = UnitKind.LENGTH, name = "厘米", symbol = "cm", base = 10.0,
        sense = "食指指甲盖的宽度，大约就是 1 厘米",
        refs = listOf(
            UnitRef("💅", "食指指甲盖的宽度", "约 1 厘米", UnitDraw("bar", 10.0)),
            UnitRef("🔠", "田字格一个方格的边长", "约 1 厘米"),
            UnitRef("📌", "一个图钉的长度", "约 1 厘米"),
        ),
        onScreenReal = true,
    ),
    UnitDef(
        id = UnitId.DM, kind = UnitKind.LENGTH, name = "分米", symbol = "dm", base = 100.0,
        sense = "手掌张开，拇指尖到中指指尖（一拃），大约是 1 分米",
        refs = listOf(
            UnitRef("🖐️", "一拃（拇指尖到中指指尖）", "约 1 分米", UnitDraw("bar", 100.0)),
            UnitRef("🔲", "墙壁开关面板的边长", "约 1 分米"),
            UnitRef("✋", "大人手掌的宽度", "约 1 分米"),
        ),
        onScreenReal = true,
    ),
    UnitDef(
        id = UnitId.M, kind = UnitKind.LENGTH, name = "米", symbol = "m", base = 1000.0,
        sense = "把两臂平平伸开，左右手指尖之间的距离大约是 1 米",
        refs = listOf(
            UnitRef("🚪", "教室门的宽度", "约 1 米"),
            UnitRef("🧒", "小朋友双臂平伸的长度", "约 1 米"),
            UnitRef("🪑", "讲台桌的高度", "约 1 米"),
            UnitRef("🛏️", "课桌的高度", "约 70 厘米，比 1 米矮一点"),
        ),
        onScreenReal = false,
    ),
    UnitDef(
        id = UnitId.KM, kind = UnitKind.LENGTH, name = "千米", symbol = "km", base = 1_000_000.0,
        sense = "跑道上跑 2 圈半（400 米一圈），或者一直走大约 15 分钟",
        refs = listOf(
            UnitRef("🏃", "400 米跑道跑 2 圈半", "正好 1000 米"),
            UnitRef("🚶", "不停走大约 15 分钟", "约 1 千米"),
            UnitRef("🚌", "公交车大约坐 1 站", "约 1 千米"),
        ),
        onScreenReal = false,
    ),

    // ── 质量（基准 = 克）──
    UnitDef(
        id = UnitId.G, kind = UnitKind.MASS, name = "克", symbol = "g", base = 1.0,
        sense = "把一粒花生米放在手心，几乎感觉不到重量 —— 那大约就是 1 克",
        refs = listOf(
            UnitRef("🪙", "1 枚 2 分硬币", "约 1 克"),
            UnitRef("📎", "1 个回形针", "约 1 克"),
            UnitRef("🥜", "两三粒花生米", "约 1 克"),
            UnitRef("🍚", "五六颗黄豆", "约 1 克"),
        ),
        onScreenReal = false,
    ),
    UnitDef(
        id = UnitId.KG, kind = UnitKind.MASS, name = "千克", symbol = "kg", base = 1000.0,
        sense = "一只手提两瓶 500 毫升的矿泉水 —— 差不多就是 1 千克",
        refs = listOf(
            UnitRef("🧂", "两袋 500 克的盐", "正好 1 千克"),
            UnitRef("💧", "两瓶 500 毫升的矿泉水", "约 1 千克"),
            UnitRef("🍎", "5 个中等个头的苹果", "约 1 千克"),
            UnitRef("🧒", "三年级小朋友的体重", "约 25 千克"),
        ),
        onScreenReal = false,
    ),
    UnitDef(
        id = UnitId.T, kind = UnitKind.MASS, name = "吨", symbol = "t", base = 1_000_000.0,
        sense = "吨没法用手掂，只能用数量堆出来 —— 要 40 个小朋友加起来才有 1 吨",
        refs = listOf(
            UnitRef("🧒", "40 个小朋友（每人 25 千克）", "正好 1 吨"),
            UnitRef("🍚", "10 袋 100 千克的大米", "正好 1 吨"),
            UnitRef("🚗", "一辆小轿车", "约 1 吨"),
            UnitRef("💧", "2000 瓶 500 克的水", "正好 1 吨"),
        ),
        onScreenReal = false,
    ),
)

private val BY_ID: Map<UnitId, UnitDef> = UNITS.associateBy { it.id }

fun unitOf(id: UnitId): UnitDef = BY_ID[id] ?: throw IllegalArgumentException("未知单位：$id")

fun unitOf(key: String): UnitDef = unitOf(UnitId.fromKey(key))

/** 同一族内按 base 升序（= 从小到大）。单位链的顺序就是它 */
fun unitsOf(kind: UnitKind): List<UnitDef> = UNITS.filter { it.kind == kind }.sortedBy { it.base }

// ────────────────────────────────────────────────────────────
// 换算
// ★ 两套算法并存，是为了让单测能用**两个独立裁判**互相印证：
//   [convert] 走基准单位（引擎实际用法）；[convertChain] 沿单位链逐级乘除（单测对拍用）
//   两者思路完全不同，若某天有人改错了进率，必然只有一边跟着错。
// ────────────────────────────────────────────────────────────

/** 换算（基准单位法）。`3米 → 厘米` = 3×1000/10 = 300 */
fun convert(value: Double, from: UnitDef, to: UnitDef): Double {
    assertSameKind(from, to)
    return value * from.base / to.base
}

/**
 * 换算（沿链逐级法）。只用于对拍，别在生产路径上调。
 *
 * ⚠️ 两个分支的乘除方向极易写反（web 第一版就反了，被对拍当场抓出）：
 *   往**大**单位走 ⇒ 数字变**小** ⇒ **除**；往**小**单位走 ⇒ 数字变**大** ⇒ **乘**。
 */
fun convertChain(value: Double, from: UnitDef, to: UnitDef): Double {
    assertSameKind(from, to)
    val chain = unitsOf(from.kind)
    val i = chain.indexOfFirst { it.id == from.id }
    val j = chain.indexOfFirst { it.id == to.id }
    require(i >= 0 && j >= 0) { "单位不在链上：${from.id}/${to.id}" }
    var v = value
    if (i < j) {
        // 往大单位走 → 除以每一级的进率
        for (k in i until j) v = v * chain[k].base / chain[k + 1].base
    } else {
        // 往小单位走 → 乘以每一级的进率
        for (k in i downTo j + 1) v = v * chain[k].base / chain[k - 1].base
    }
    return v
}

private fun assertSameKind(from: UnitDef, to: UnitDef) {
    require(from.kind == to.kind) { "长度和质量不能互相换算：${from.name} → ${to.name}" }
}

/** 进率 = 大单位 ÷ 小单位（恒 > 1）。相邻长度单位是 10，米↔千米与质量单位是 1000 */
fun rateOf(from: UnitDef, to: UnitDef): Double {
    assertSameKind(from, to)
    return max(from.base, to.base) / min(from.base, to.base)
}

/** 切 / 拼几轮 = 进率里有几个 10。10⇒1、100⇒2、1000⇒3 */
fun roundsOf(from: UnitDef, to: UnitDef): Int {
    val r = rateOf(from, to)
    val n = kotlin.math.log10(r).roundToInt()
    // 本库所有单位都取 10 的整数次幂倍数，所以进率必然是 10 的整数次幂。
    // 一旦有人加了个非 10 幂的单位，这里必须炸，不能悄悄四舍五入。
    require(abs(10.0.pow(n) - r) <= 1e-9) { "进率 $r 不是 10 的整数次幂，无法用「切几轮」表示" }
    return n
}

/** 把「多少个基准单位」说成人话：100000 毫米 ⇒ "100米"；10 毫米 ⇒ "1厘米" */
private fun labelBaseAmount(baseAmount: Double, kind: UnitKind): Pair<String, UnitDef?> {
    val cands = unitsOf(kind).filter { baseAmount % it.base == 0.0 }
    if (cands.isEmpty()) return unitNumStr(baseAmount) to null
    val u = cands.last() // base 升序 ⇒ 最后一个最大
    val coef = baseAmount / u.base
    return if (coef == 1.0) "1${u.name}" to u else unitNumStr(coef) + u.name to null
}

/**
 * 切开 / 拼合的完整轨迹。
 *
 * SPLIT（单位变小，要切开）：第 r 轮 ⇒ 份数 = value×10^r，每份 = from.base / 10^r
 * MERGE（单位变大，要拼合）：第 r 轮 ⇒ 份数 = value/10^r，每份 = from.base × 10^r
 * 两种情形下 `份数 × 每份` 恒等于 `value × from.base`（总量守恒）。
 */
fun planSteps(from: UnitDef, to: UnitDef, value: Double): UnitPlan {
    assertSameKind(from, to)
    require(value.isFinite() && value > 0) { "参与换算的数必须是正数：$value" }
    val ratio = rateOf(from, to)
    val rounds = roundsOf(from, to)
    val split = from.base > to.base // 大单位变小单位 ⇒ 切开
    val direction = if (split) UnitDirection.SPLIT else UnitDirection.MERGE
    val op = if (split) "×" else "÷"

    val cuts = ArrayList<CutRound>(rounds)
    for (r in 1..rounds) {
        val f = 10.0.pow(r)
        val count = if (split) value * f else value / f
        val pieceBase = if (split) from.base / f else from.base * f
        val (label, named) = labelBaseAmount(pieceBase, from.kind)
        cuts += CutRound(r, count, pieceBase, label, named)
    }

    val result = convert(value, from, to)
    val maxCells = max(value, result)

    return UnitPlan(from, to, value, result, ratio, rounds, direction, op, cuts, maxCells)
}

// ────────────────────────────────────────────────────────────
// 相邻单位对（主舞台只演示这些）
// ────────────────────────────────────────────────────────────

data class UnitPair(
    val key: String,
    val kind: UnitKind,
    /** 小单位 */
    val small: UnitDef,
    /** 大单位 */
    val big: UnitDef,
    val ratio: Double,
)

private fun buildPairs(kind: UnitKind): List<UnitPair> {
    val chain = unitsOf(kind)
    val out = ArrayList<UnitPair>()
    for (i in 0 until chain.size - 1) {
        val small = chain[i]
        val big = chain[i + 1]
        out += UnitPair("${small.id.key}-${big.id.key}", kind, small, big, big.base / small.base)
    }
    return out
}

val ADJACENT_PAIRS: List<UnitPair> = buildPairs(UnitKind.LENGTH) + buildPairs(UnitKind.MASS)

fun pairsOf(kind: UnitKind): List<UnitPair> = ADJACENT_PAIRS.filter { it.kind == kind }

// ────────────────────────────────────────────────────────────
// 单位关系（米尺对照块的事实来源 —— 页面不许自己手写这些式子）
// ────────────────────────────────────────────────────────────

/** 长度链条：三个 10 叠成 1000，这就是「可数出来的 1000」 */
val LENGTH_FACTS: List<ChainFact> = listOf(
    ChainFact("1米 = 10分米", "把 1 米切成 10 段，每段就是 1 分米"),
    ChainFact("1分米 = 10厘米", "把 1 分米切成 10 段，每段就是 1 厘米"),
    ChainFact("1厘米 = 10毫米", "把 1 厘米切成 10 段，每段就是 1 毫米"),
    ChainFact("1米 = 100厘米", "切了两轮：10 × 10 = 100"),
    ChainFact("1米 = 1000毫米", "切了三轮：10 × 10 × 10 = 1000"),
    ChainFact("1千米 = 1000米", "这一对进率是 1000，不是 10 —— 最容易记错的一个"),
)

val MASS_FACTS: List<ChainFact> = listOf(
    ChainFact("1千克 = 1000克", "把 1 千克切成 1000 份，每份就是 1 克"),
    ChainFact("1吨 = 1000千克", "把 1 吨切成 1000 份，每份就是 1 千克"),
    ChainFact("1吨 = 1000000克", "切了六轮，所以是 1000 × 1000（这一步三年级不要求算，只要知道很大）"),
)

fun factsOf(kind: UnitKind): List<ChainFact> = if (kind == UnitKind.LENGTH) LENGTH_FACTS else MASS_FACTS

// ────────────────────────────────────────────────────────────
// 口诀（页面的「规律卡」）
// ────────────────────────────────────────────────────────────

val UNIT_RULES: List<UnitRule> = listOf(
    UnitRule(
        title = "先看清是「切开」还是「拼合」",
        body = "单位变小了（米 → 分米），就要把一个大的切开成很多小的，份数变多 ⇒ 用乘。" +
            "单位变大了（分米 → 米），就要把很多小的拼成一个大的，份数变少 ⇒ 用除。" +
            "口诀只有一句：单位变小数变大，单位变大树变小。",
    ),
    UnitRule(
        title = "进率不用背，数一数是几个 10",
        body = "长度单位里，毫米、厘米、分米、米每相邻两个都是 10，所以 1 米 = 10×10×10 = 1000 毫米。" +
            "但米和千米之间是 1000，不是 10 —— 这一对单独记。质量单位克、千克、吨相邻两个都是 1000。",
    ),
    UnitRule(
        title = "换算前先想「它有多大」",
        body = "一个西瓜重 5 千克，不是 5 克；一个小朋友重 25 千克，不是 25 克。" +
            "拿不准单位的时候，先在心里掂一掂、比一比，再动笔算。",
    ),
)

// ────────────────────────────────────────────────────────────
// 易错案例（每一条都人工验算过）
// ⚠️ 这里的 `why` 里有一条**故意**保留了 web 的写法（含一个未成对的星号），
//    移植时照抄 —— 但页面上是纯文本渲染，所以 Kotlin 侧把星号去掉了，
//    否则屏幕上会明晃晃露出两个 `**`。这一处差异已记录在文档的「有意差异」里。
// ────────────────────────────────────────────────────────────

val UNIT_MISTAKE_CASES: List<UnitMistakeCase> = listOf(
    UnitMistakeCase(
        wrong = "5米 = 500分米",
        right = "5米 = 50分米",
        why = "把「米 → 厘米」的进率 100 用在了「米 → 分米」上。米和分米是相邻单位，进率是 10。",
        tip = "米 → 分米：切开一轮，5×10 = 50。要乘 100 那是换成厘米。",
    ),
    UnitMistakeCase(
        wrong = "1千米 = 100米",
        right = "1千米 = 1000米",
        why = "米和千米的进率是整个长度单位里的例外 —— 它不是 10，而是 1000。",
        tip = "400 米的跑道跑 2 圈半才到 1 千米，怎么可能只有 100 米。",
    ),
    UnitMistakeCase(
        wrong = "3000克 = 300千克",
        right = "3000克 = 3千克",
        why = "克 → 千克的进率是 1000，不是 10，所以是除以 1000。",
        tip = "1000 克才是 1 千克，3000 克里正好有 3 个 1000。",
    ),
    UnitMistakeCase(
        wrong = "4吨 = 400千克",
        right = "4吨 = 4000千克",
        why = "吨 → 千克要乘 1000。写成 400 相当于只乘了 100。",
        tip = "1 吨就是 10 袋 100 千克的大米，4 吨就是 40 袋。",
    ),
    UnitMistakeCase(
        wrong = "20毫米 = 2米",
        right = "20毫米 = 2厘米",
        why = "毫米换成米要跨过厘米、分米两道，进率是 1000；换成厘米只需一步，进率是 10。",
        tip = "20 毫米还没有一根手指宽，怎么可能是 2 米（比门还高）。",
    ),
    UnitMistakeCase(
        wrong = "一个西瓜重5克",
        right = "一个西瓜重5千克",
        why = "5 克大约只有一粒花生米那么重。错在单位选错，不在算错。",
        tip = "拿不准的时候先掂一掂：两瓶矿泉水就是 1 千克，西瓜比它重得多。",
    ),
    UnitMistakeCase(
        wrong = "3米 + 50厘米 = 53米",
        right = "3米 + 50厘米 = 350厘米（也就是 3米50厘米）",
        why = "单位不同不能直接相加，要先把 3 米化成 300 厘米再算。",
        tip = "不同单位的数相加相减之前，第一步永远是「单位对齐」。",
    ),
)

// ────────────────────────────────────────────────────────────
// 一步一填的题组
// ────────────────────────────────────────────────────────────

enum class ProblemGroupKey(val key: String) {
    LENGTH_ADJACENT("lengthAdjacent"),
    LENGTH_KM("lengthKm"),
    MASS("mass"),
    CROSS("cross");

    companion object {
        fun fromKey(key: String): ProblemGroupKey =
            entries.firstOrNull { it.key == key } ?: throw IllegalArgumentException("未知题组：$key")
    }
}

data class ProblemGroup(
    val key: ProblemGroupKey,
    val title: String,
    val desc: String,
    val pairs: List<Pair<UnitId, UnitId>>,
)

/** ★ 题组是**唯一来源**：页面渲染题组按钮、引擎抽题都读这里，页面绝不手写清单 */
val PROBLEM_GROUPS: List<ProblemGroup> = listOf(
    ProblemGroup(
        ProblemGroupKey.LENGTH_ADJACENT, "长度 · 相邻", "毫米↔厘米↔分米↔米，进率都是 10",
        listOf(UnitId.MM to UnitId.CM, UnitId.CM to UnitId.DM, UnitId.DM to UnitId.M),
    ),
    ProblemGroup(
        ProblemGroupKey.LENGTH_KM, "长度 · 米和千米", "进率是 1000，不是 10 —— 最爱错的一对",
        listOf(UnitId.M to UnitId.KM),
    ),
    ProblemGroup(
        ProblemGroupKey.MASS, "质量 · 相邻", "克↔千克↔吨，进率都是 1000",
        listOf(UnitId.G to UnitId.KG, UnitId.KG to UnitId.T),
    ),
    ProblemGroup(
        ProblemGroupKey.CROSS, "跨级换算", "中间隔着一两个单位，进率是 100 或 1000",
        listOf(UnitId.MM to UnitId.DM, UnitId.CM to UnitId.M, UnitId.MM to UnitId.M),
    ),
)

/** 进率候选只有这三个 —— 学生真正会混的就是它们 */
private val RATE_CHOICES = listOf(10.0, 100.0, 1000.0)

/**
 * ★ 对齐 JS `min + floor(random*(max-min+1))`：**跨度 ≤ 0 时返回 min，不抛错**。
 * Kotlin `nextInt(2,1)` 会抛 `IllegalArgumentException`，只在特定随机值下复现，极难查。
 */
internal fun unitRndInclusive(min: Int, max: Int, random: Random): Int {
    val span = max - min + 1
    if (span <= 0) return min
    return min + random.nextInt(span)
}

internal fun <T> unitShuffle(arr: List<T>, random: Random): List<T> {
    val a = arr.toMutableList()
    for (i in a.size - 1 downTo 1) {
        val j = random.nextInt(i + 1)
        val t = a[i]; a[i] = a[j]; a[j] = t
    }
    return a
}

/**
 * 选项拼装：保证**答案只出现一次**、选项互不重复、至少 2 个。
 * ★ 单测会逐条断言这三件事 —— 选项重复或漏掉答案是最容易悄悄发生的事故。
 */
internal fun unitOptsFor(answer: String, cands: List<String>, filler: List<String> = emptyList()): List<String> {
    val out = mutableListOf(answer)
    for (c in cands + filler) {
        if (out.size >= 4) break
        if (c.isEmpty() || c == answer || out.contains(c)) continue
        out += c
    }
    return unitShuffle(out, Random.Default).ifEmpty { listOf(answer) }
}

private fun numFillers(answer: Double): List<String> =
    listOf(answer + 10, answer - 10, answer + 1, answer - 1, answer * 10, answer / 10)
        .filter { it.isFinite() && it > 0 && it != answer }
        .map { unitNumStr(it) }

/**
 * 反推参数出题（★ 先定「要走的这一步」，再定操作数 —— 保证结果永远是整数）。
 *
 * 单位变小（要乘）：操作数取 1..9，结果 = 操作数 × 进率
 * 单位变大（要除）：操作数取 进率×1..9，结果 = 操作数 ÷ 进率
 */
fun genProblem(groupKey: ProblemGroupKey, random: Random = Random.Default): UnitProblem {
    val group = PROBLEM_GROUPS.firstOrNull { it.key == groupKey }
        ?: throw IllegalArgumentException("未知题组：$groupKey")

    val (aId, bId) = group.pairs[random.nextInt(group.pairs.size)]
    val a = unitOf(aId)
    val b = unitOf(bId)
    val small = if (a.base < b.base) a else b
    val big = if (a.base < b.base) b else a
    val ratio = big.base / small.base

    val toSmaller = random.nextDouble() < 0.5
    val from = if (toSmaller) big else small
    val to = if (toSmaller) small else big

    val k = unitRndInclusive(1, 9, random).toDouble()
    val value = if (toSmaller) k else k * ratio
    val result = if (toSmaller) k * ratio else k

    val split = toSmaller // 单位变小 ⇒ 切开 ⇒ ×
    val op = if (split) "×" else "÷"
    val rounds = roundsOf(from, to)

    val cutWord = if (split) "切开" else "拼合"
    val opTip =
        if (split) {
            "「${from.name}」比「${to.name}」大。把 1 个${from.name}$cutWord 成很多个${to.name}，份数变多 ⇒ 用乘。"
        } else {
            "「${from.name}」比「${to.name}」小。要把很多个${from.name}$cutWord 成 1 个${to.name}，份数变少 ⇒ 用除。"
        }

    val rateTip =
        if (rounds == 1) {
            "${from.name} 和 ${to.name} 是相邻单位，进率是 10，所以进率是 ${unitNumStr(ratio)}。"
        } else {
            "${from.name} 和 ${to.name} 之间隔着 ${rounds - 1} 个单位，进率是 10 乘 $rounds 次，所以进率是 ${unitNumStr(ratio)}。"
        }

    // 第 3 步的干扰项：把乘当加（3×10 ⇒ 13）、进率用错。
    // ⚠️ 「方向用错」**不在这里** —— 方向错答是单独算出来的 `flipped`，只落在下面的
    //    `trap` 字段里、等学生做完再点破。实测 90厘米=?分米：选项是 [9, 100]，flipped=900 不在其中。
    //    别照注释想当然地断言「方向错答必进选项」。
    val trapSet = LinkedHashSet<Double>()
    val addWrong = value + ratio
    if (addWrong != result) trapSet += addWrong
    for (r in RATE_CHOICES) {
        val v = if (split) value * r else value / r
        if (v != result && v > 0 && v == v.toLong().toDouble()) trapSet += v
    }
    val calcOptions = unitShuffle(listOf(unitNumStr(result)) + trapSet.take(3).map { unitNumStr(it) }, random)

    val steps = listOf(
        UnitStep(
            key = "op",
            ask = "单位从「${from.name}」变成「${to.name}」，这一步该乘还是该除？",
            options = listOf("×", "÷"),
            answer = op,
            tip = opTip,
        ),
        UnitStep(
            key = "rate",
            ask = "${from.name}和${to.name}之间的进率是多少？",
            options = RATE_CHOICES.map { unitNumStr(it) },
            answer = unitNumStr(ratio),
            tip = rateTip,
        ),
        UnitStep(
            key = "calc",
            ask = "${unitNumStr(value)} $op ${unitNumStr(ratio)} = ?",
            options = calcOptions,
            answer = unitNumStr(result),
            tip = "${unitNumStr(value)}$op${unitNumStr(ratio)} = ${unitNumStr(result)}。" +
                "所以 ${qty(value, from)} = ${qty(result, to)}。",
        ),
    )

    // 只翻方向的错答（学生最典型的一种错）—— 最终揭晓时用来点破
    val flipped = if (split) value / ratio else value * ratio
    val trap = if (flipped > 0 && flipped == flipped.toLong().toDouble()) flipped else null

    val cutDesc =
        if (rounds == 1) "只需切 1 轮：10 份"
        else "要切 $rounds 轮：" + List(rounds) { "10" }.joinToString(" × ") + " = ${unitNumStr(ratio)} 份"

    return UnitProblem(
        groupKey = groupKey,
        from = from,
        to = to,
        value = value,
        result = result,
        ratio = ratio,
        op = op,
        rounds = rounds,
        fullText = "${qty(value, from)} = ?${to.name}",
        steps = steps,
        finalNote = "${qty(value, from)} = ${qty(result, to)}。$cutDesc。",
        trap = trap,
    )
}

/** 一次抽 n 道（页面用 6 道一组）。同一组内不重复同一对单位 */
fun genProblemSet(groupKey: ProblemGroupKey, n: Int = 6, random: Random = Random.Default): List<UnitProblem> {
    val out = ArrayList<UnitProblem>(n)
    val seen = HashSet<String>()
    var guard = 0
    while (out.size < n && guard < n * 60) {
        guard++
        val p = genProblem(groupKey, random)
        val tag = "${p.from.id.key}-${p.to.id.key}-${unitNumStr(p.value)}"
        if (!seen.add(tag)) continue
        out += p
    }
    return out
}
