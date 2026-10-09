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

/**
 * 一个生活参照物。
 *
 * `icon` 是 `ui/icon/MathIcons.kt` 里的图画键（★ 用图画而不是 emoji ——
 * emoji 表达不了「厚度 / 大小」这类关系，且同一 emoji 在各平台长得都不一样）。
 * `draw` 非空时页面会按**真实物理尺寸**画一根条，供学生拿尺子核对。
 */
data class UnitRef(
    val icon: String,
    val name: String,
    val detail: String,
    val draw: UnitDraw? = null,
)

data class UnitDef(
    val id: UnitId,
    val kind: UnitKind,
    val name: String,
    /** 英文缩写（尺子上、英文数学里就写这个） */
    val symbol: String,
    /** 英文全称 —— ★ 中文单位名旁边要标注的就是它 */
    val en: String,
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

/** 数量写法 + 英文标注：`7厘米(cm)`。★ 页面要「中文单位旁标英文」就用它，别在页面里手拼 */
fun qtyEn(value: Double, unit: UnitDef): String = qty(value, unit) + "(" + unit.symbol + ")"

// ────────────────────────────────────────────────────────────
// 尺子实例「亮出这一段」—— 拿尺子做基准，用实例子建立量感
// ────────────────────────────────────────────────────────────

/** 复合读法里的一段（「7厘米3毫米」⇒ 7厘米 + 3毫米） */
data class UnitReadingPart(
    /** 这一部分的数值，如 7 */
    val value: Double,
    /** 这一部分的单位，如 厘米 */
    val unit: UnitDef,
    /** 这一部分折成多少毫米（= value × unit.base）。页面按它把亮区**分段**，不自己算 */
    val mm: Double,
)

/** 复合读法：整段长度的毫米数 + 中文写法 + 拆开的部分 */
data class UnitCompound(
    /** 这一段一共多少毫米 */
    val mm: Int,
    /** 中文复合写法，如 "7厘米3毫米"（三年级就是这么读长度的，不说「73毫米」） */
    val label: String,
    /** 拆开的部分，从大到小。页面按它把亮区**画成几段** */
    val parts: List<UnitReadingPart>,
)

/** 一段长度的一套读法（页面「亮出这一段」的数据来源） */
data class UnitRulerReading(
    /** 这一段一共多少毫米（= 尺子上亮到第几小格） */
    val mm: Int,
    /** 中文复合写法，如 "7厘米3毫米" */
    val label: String,
    /** 拆开的部分，从大到小 */
    val parts: List<UnitReadingPart>,
    /** 同一段长度的整数写法（带英文标注），从大到小，如 ["73毫米(mm)"] */
    val same: List<String>,
)

/**
 * ★ 同一段长度、不同单位写法 —— **由单位表派生，绝不手写**。
 * 只取「base 能整除 mm」的长度单位（只到米为止；千米一把尺子放不下）：
 *   70  ⇒ [7厘米, 70毫米]
 *   100 ⇒ [1分米, 10厘米, 100毫米]
 * 之所以要「整除」，是因为尺子上读出来的必须是整数 —— 7 厘米就是 7 厘米，
 * 不许变成 0.7 分米（三年级不要求）。
 */
fun readingsOf(mm: Int): List<UnitReadingPart> {
    require(mm > 0) { "尺子例子必须是正整数毫米：$mm" }
    return unitsOf(UnitKind.LENGTH)
        .filter { it.base <= 1000.0 && mm % it.base.toInt() == 0 }
        .sortedByDescending { it.base } // 大单位在前 = 读起来最自然的那个
        .map {
            val v = (mm / it.base.toInt()).toDouble()
            UnitReadingPart(v, it, v * it.base)
        }
}

/** 能在一把尺子上读出来的长度单位（毫米/厘米/分米/米；千米要 378 万像素，放不下） */
fun rulerUnits(): List<UnitDef> =
    unitsOf(UnitKind.LENGTH).filter { it.base <= 1000.0 }.sortedByDescending { it.base }

/**
 * ★ 复合读法：像「7厘米3毫米」这样，用**两个单位**说同一段长度。
 *
 * 这里用**贪心拆解**（从大单位往小单位走）把它算出来，页面绝不手写这些数字：
 *   73   ⇒ 7厘米3毫米   （7×10 + 3）
 *   1200 ⇒ 1米2分米     （1×1000 + 2×100）
 *   1500 ⇒ 1米5分米     （中间那级恰好是 0 就跳过，不写「0分米」）
 *   5    ⇒ 5毫米        （只有一级）
 */
fun compoundOf(mm: Int): UnitCompound {
    require(mm > 0) { "尺子例子必须是正整数毫米：$mm" }
    val parts = mutableListOf<UnitReadingPart>()
    var rest = mm
    for (u in rulerUnits()) {
        val base = u.base.toInt()
        val value = rest / base
        if (value <= 0) continue
        parts += UnitReadingPart(value.toDouble(), u, (value * base).toDouble())
        rest -= value * base
    }
    check(rest == 0) { "$mm 毫米拆不出整数单位（不该发生）" }
    return UnitCompound(mm, parts.joinToString("") { unitNumStr(it.value) + it.unit.name }, parts)
}

/** 学生尺（**真实尺寸** 0..100 毫米 = 10 厘米）上的例子 —— 含复合读法 */
val RULER_EXAMPLE_MM: List<Int> = listOf(5, 10, 25, 37, 70, 73, 98, 100)

/** 米尺（**示意图** 0..1.5 米）上的例子，用毫米表示 —— 分米 / 米 / 复合 */
val METER_EXAMPLE_MM: List<Int> = listOf(100, 500, 1000, 1200)

/** 米尺画到多少厘米（= 15 大格，刚好把「1米2分米」这种复合例子装进来） */
const val METER_RULER_CM = 150

/** 一段长度的一套读法：复合中文写法 + 各种整数写法（带英文标注） */
private fun unitReadingOf(mm: Int): UnitRulerReading {
    val c = compoundOf(mm)
    return UnitRulerReading(mm, c.label, c.parts, readingsOf(mm).map { qtyEn(it.value, it.unit) })
}

fun rulerExamples(): List<UnitRulerReading> = RULER_EXAMPLE_MM.sorted().map(::unitReadingOf)

fun meterExamples(): List<UnitRulerReading> = METER_EXAMPLE_MM.sorted().map(::unitReadingOf)

// ────────────────────────────────────────────────────────────
// 单位表
// ★ 参照物全部按人教版三年级上「测量」单元的通行口径，并逐条用「约」限定；
//   其中毫米/厘米/分米三项可由页面按真实尺寸画出来，学生能拿真尺子核对。
// ────────────────────────────────────────────────────────────

val UNITS: List<UnitDef> = listOf(
    // ── 长度（基准 = 毫米）──
    UnitDef(
        id = UnitId.MM, kind = UnitKind.LENGTH, name = "毫米", symbol = "mm", en = "millimeter", base = 1.0,
        sense = "两指夹卡的缝",
        refs = listOf(
            UnitRef("card", "银行卡", "1 毫米", UnitDraw("slab", 1.0)),
            UnitRef("coin", "1 分硬币", "1 毫米"),
            UnitRef("papers", "10 张纸", "1 毫米"),
            UnitRef("ruler", "尺子一小格", "1 毫米"),
        ),
        onScreenReal = true,
    ),
    UnitDef(
        id = UnitId.CM, kind = UnitKind.LENGTH, name = "厘米", symbol = "cm", en = "centimeter", base = 10.0,
        sense = "食指指甲盖",
        refs = listOf(
            UnitRef("nail", "指甲盖", "1 厘米", UnitDraw("bar", 10.0)),
            UnitRef("grid", "田字格边长", "1 厘米"),
            UnitRef("pin", "图钉", "1 厘米"),
        ),
        onScreenReal = true,
    ),
    UnitDef(
        id = UnitId.DM, kind = UnitKind.LENGTH, name = "分米", symbol = "dm", en = "decimeter", base = 100.0,
        sense = "张开手，一拃",
        refs = listOf(
            UnitRef("hand", "一拃", "1 分米", UnitDraw("bar", 100.0)),
            UnitRef("switch", "开关面板", "1 分米"),
            UnitRef("hand", "手掌宽", "1 分米"),
        ),
        onScreenReal = true,
    ),
    UnitDef(
        id = UnitId.M, kind = UnitKind.LENGTH, name = "米", symbol = "m", en = "meter", base = 1000.0,
        sense = "两臂平伸",
        refs = listOf(
            UnitRef("door", "教室门宽", "1 米"),
            UnitRef("childArms", "双臂平伸", "1 米"),
            UnitRef("podium", "讲台桌高", "1 米"),
            UnitRef("desk", "课桌高", "70 厘米"),
        ),
        onScreenReal = false,
    ),
    UnitDef(
        id = UnitId.KM, kind = UnitKind.LENGTH, name = "千米", symbol = "km", en = "kilometer", base = 1_000_000.0,
        sense = "走 15 分钟",
        refs = listOf(
            UnitRef("track", "跑道 2 圈半", "1 千米"),
            UnitRef("walk", "走 15 分钟", "1 千米"),
            UnitRef("bus", "公交 1 站", "1 千米"),
        ),
        onScreenReal = false,
    ),

    // ── 质量（基准 = 克）──
    UnitDef(
        id = UnitId.G, kind = UnitKind.MASS, name = "克", symbol = "g", en = "gram", base = 1.0,
        sense = "一粒花生米",
        refs = listOf(
            UnitRef("coin", "2 分硬币", "1 克"),
            UnitRef("clip", "回形针", "1 克"),
            UnitRef("peanut", "两三粒花生", "1 克"),
            UnitRef("bean", "五六颗黄豆", "1 克"),
        ),
        onScreenReal = false,
    ),
    UnitDef(
        id = UnitId.KG, kind = UnitKind.MASS, name = "千克", symbol = "kg", en = "kilogram", base = 1000.0,
        sense = "两瓶矿泉水",
        refs = listOf(
            UnitRef("sack", "两袋盐", "1 千克"),
            UnitRef("bottle", "两瓶矿泉水", "1 千克"),
            UnitRef("apple", "5 个苹果", "1 千克"),
            UnitRef("kid", "三年级小朋友", "25 千克"),
        ),
        onScreenReal = false,
    ),
    UnitDef(
        id = UnitId.T, kind = UnitKind.MASS, name = "吨", symbol = "t", en = "ton", base = 1_000_000.0,
        sense = "40 个小朋友",
        refs = listOf(
            UnitRef("kid", "40 个小朋友", "1 吨"),
            UnitRef("sack", "10 袋大米", "1 吨"),
            UnitRef("car", "一辆小轿车", "1 吨"),
            UnitRef("bottle", "2000 瓶水", "1 吨"),
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
    ChainFact("1米(m) = 10分米(dm)", "把 1 米切成 10 段，每段就是 1 分米"),
    ChainFact("1分米(dm) = 10厘米(cm)", "把 1 分米切成 10 段，每段就是 1 厘米"),
    ChainFact("1厘米(cm) = 10毫米(mm)", "把 1 厘米切成 10 段，每段就是 1 毫米"),
    ChainFact("1米(m) = 100厘米(cm)", "切了两轮：10 × 10 = 100"),
    ChainFact("1米(m) = 1000毫米(mm)", "切了三轮：10 × 10 × 10 = 1000"),
    ChainFact("1千米(km) = 1000米(m)", "这一对进率是 1000，不是 10 —— 最容易记错的一个"),
)

val MASS_FACTS: List<ChainFact> = listOf(
    ChainFact("1千克(kg) = 1000克(g)", "把 1 千克切成 1000 份，每份就是 1 克"),
    ChainFact("1吨(t) = 1000千克(kg)", "把 1 吨切成 1000 份，每份就是 1 千克"),
    ChainFact("1吨(t) = 1000000克(g)", "切了六轮，所以是 1000 × 1000（这一步三年级不要求算，只要知道很大）"),
)

fun factsOf(kind: UnitKind): List<ChainFact> = if (kind == UnitKind.LENGTH) LENGTH_FACTS else MASS_FACTS

// ────────────────────────────────────────────────────────────
// 口诀（页面的「规律卡」）
// ────────────────────────────────────────────────────────────

val UNIT_RULES: List<UnitRule> = listOf(
    UnitRule(
        title = "先看清是「切开」还是「拼合」",
        body = "切开 ⇒ 份数变多 ⇒ 乘　｜　拼合 ⇒ 份数变少 ⇒ 除",
    ),
    UnitRule(
        title = "进率不用背，数一数是几个 10",
        body = "长度相邻都是 10（米 m↔千米 km 例外，是 1000）；质量相邻都是 1000",
    ),
    UnitRule(
        title = "换算前先想「它有多大」",
        body = "西瓜 5 千克(kg) 不是 5 克(g)。先掂一掂，再动笔",
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
        wrong = "5米(m) = 500分米(dm)",
        right = "5米(m) = 50分米(dm)",
        why = "米(m)和分米(dm)相邻，进率 10",
        tip = "乘 100 那是换成厘米(cm)",
    ),
    UnitMistakeCase(
        wrong = "1千米(km) = 100米(m)",
        right = "1千米(km) = 1000米(m)",
        why = "米(m)和千米(km)是唯一的例外：进率 1000",
        tip = "跑道 2 圈半才 1 千米(km)",
    ),
    UnitMistakeCase(
        wrong = "3000克(g) = 300千克(kg)",
        right = "3000克(g) = 3千克(kg)",
        why = "克(g)→千克(kg)进率是 1000，不是 10",
        tip = "1000 克(g) 才是 1 千克(kg)",
    ),
    UnitMistakeCase(
        wrong = "4吨(t) = 400千克(kg)",
        right = "4吨(t) = 4000千克(kg)",
        why = "吨(t)→千克(kg)要乘 1000",
        tip = "1 吨(t) = 10 袋 100 千克(kg)的米",
    ),
    UnitMistakeCase(
        wrong = "20毫米(mm) = 2米(m)",
        right = "20毫米(mm) = 2厘米(cm)",
        why = "毫米(mm)→米(m)要跨两道，进率 1000",
        tip = "20 毫米(mm)还没一根手指宽",
    ),
    UnitMistakeCase(
        wrong = "一个西瓜重 5 克(g)",
        right = "一个西瓜重 5 千克(kg)",
        why = "5 克(g)只有一粒花生米重",
        tip = "两瓶矿泉水就是 1 千克(kg)",
    ),
    UnitMistakeCase(
        wrong = "3米(m) + 50厘米(cm) = 53米(m)",
        right = "3米(m) + 50厘米(cm) = 350厘米(cm)（也就是 3米50厘米）",
        why = "单位不同不能直接相加",
        tip = "先化成 300 厘米(cm)再算",
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
        fullText = "${qtyEn(value, from)} = ?${to.name}(${to.symbol})",
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
