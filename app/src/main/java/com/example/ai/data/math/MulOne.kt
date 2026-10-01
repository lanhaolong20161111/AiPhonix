package com.example.ai.data.math

import kotlin.random.Random

/**
 * 三年级上 · 多位数乘一位数 —— 规则引擎（零后端调用）
 *
 * 移植自 `web/src/lib/mulOne.ts`，逐函数对齐。
 *
 * ⚠️ **顶层名字一律加 `Mo` / `mo` / `MO_` 前缀**：本文件与 `CompoundExpr.kt`、
 *    `Precedence.kt`、`EqMove.kt` 同处 `com.example.ai.data.math` 包，
 *    Kotlin **同包顶层声明不能重名**（`MistakeCase` / `RULES` / `MISTAKE_CASES` /
 *    `planSteps` / `rndInclusive` / `generateProblem` 都已被占用）。
 *    这与 `EqMove.kt` 用 `Eq` 前缀是同一套惯例。
 *
 * ── 这一页要解决的真问题 ──────────────────────────────────
 * 孩子算 `27 × 4` 常常写成 88。他并不是不会背「四七二十八」，
 * 而是**算完十位就忘了把个位进上来的 2 加进去**。
 * 也就是说：错的不是乘法，错在「进位」这一步没有成为**看得见的动作**。
 *
 * 所以本引擎把竖式拆成**逐位的四拍**，每一拍都对应一个视觉动作：
 *   ① 乘 —— 这一位的数字 × 一位数（口诀）  ⇒ 得到 base
 *   ② 加 —— 再加上右边进上来的数           ⇒ 得到 sum    ★ 错得最多的一拍
 *   ③ 写 —— sum 的个位写在这一位下面        ⇒ write
 *   ④ 进 —— sum 的十位送到前一位头上        ⇒ carryOut
 *
 * ── ★ 为什么「从个位乘起」不是死记 ─────────────────────────
 * 因为**进位只能往左走**：只有个位先攒够 10，才谈得上送 1 个给十位。
 * 十位在个位算完之前根本不知道该加几。所以顺序是被进位的方向**逼**出来的，不是规定。
 *
 * ── 四个题型，各自的「坑」不一样 ───────────────────────────
 *   noCarry / carry / carryChain / tailZero / midZero（见 [MO_KIND_GROUPS]）
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 五个题型。★ 页面渲染题型按钮、引擎抽题都读 [MO_KIND_GROUPS]，页面绝不手写清单 */
enum class MoKind(val key: String) {
    NO_CARRY("noCarry"),
    CARRY("carry"),
    CARRY_CHAIN("carryChain"),
    TAIL_ZERO("tailZero"),
    MID_ZERO("midZero");

    companion object {
        fun fromKey(key: String): MoKind =
            entries.firstOrNull { it.key == key } ?: throw IllegalArgumentException("未知题型：$key")
    }
}

/** 竖式里「这一位」的四拍。`IDLE` / `DONE` 只用于整段动画的首尾 */
enum class MoBeat { IDLE, MUL, ADD, WRITE, CARRY, DONE }

/** 竖式逐位的一步（全部按「从个位起」的下标） */
data class MoStep(
    /** 第几位，0 = 个位 */
    val place: Int,
    /** 被乘数在这一位上的数字 */
    val digit: Int,
    /** 这一位乘一位数的口诀结果（还没加进位） */
    val base: Int,
    /** 从右边进上来的数（个位恒为 0） */
    val carryIn: Int,
    /** ★ base + carryIn —— 「忘加进位」错的就是把这个数算成了 base */
    val sum: Int,
    /** 写在结果这一位上的数 = sum 的个位 */
    val write: Int,
    /** 向前一位进的数 = sum 的十位（可能是 2..8，不是只有 1） */
    val carryOut: Int,
    /** 口诀原文，如「三八二十四」；某一位是 0 时为空串 */
    val chant: String,
)

/** 时间轴上的一拍 */
data class MoBeatNode(val index: Int, val place: Int, val beat: MoBeat)

data class MoPlan(
    val value: Int,
    val factor: Int,
    val product: Int,
    /** 被乘数各位，**从个位起**（digits[0] 是个位） */
    val digits: List<Int>,
    val steps: List<MoStep>,
    /** 最高位算完还有进位 ⇒ 积比被乘数多一位 */
    val grewTop: Boolean,
    /** 积的各位，**从个位起**；`grewTop` 时最后一项是新增的那一位 */
    val resultDigits: List<Int>,
    /** 竖式一共几列（结果位数 ≥ 被乘数位数） */
    val cols: Int,
    /** ★ 唯一的播片脚本：页面只需按 index 往前走 */
    val timeline: List<MoBeatNode>,
)

data class MoBeatState(val index: Int, val place: Int, val beat: MoBeat, val total: Int)

/** 高亮槽位。★ 由 (index) 推出的全部可视状态 —— 纯函数，单测可以直接钉住 */
data class MoHl(
    /** 被乘数哪一位在发光（null = 没有） */
    val digit: Int? = null,
    /** 一位数因数在发光 */
    val factor: Boolean = false,
    /** × 号在发光 */
    val op: Boolean = false,
    /** 哪个进位槽在发光 */
    val carryIn: Int? = null,
    /** 结果行哪一格刚写下（发光） */
    val write: Int? = null,
    /** 积最前面新长出来的那一格在发光 */
    val topCarry: Boolean = false,
    /** 口诀是否亮相 */
    val chant: Boolean = false,
    /** 本拍露出的中间得数（base / sum / 都不露） */
    val shown: MoShown? = null,
)

enum class MoShown { BASE, SUM }

data class MoView(
    val index: Int,
    val total: Int,
    val place: Int,
    val beat: MoBeat,
    val finished: Boolean,
    /** 结果行每一格写了什么（从个位起；null = 还没写到） */
    val resultCells: List<Int?>,
    /** 进位槽：第 i 格是「被送进第 i 位」的那个数（写在竖式上方；null = 还没送到） */
    val carryCells: List<Int?>,
    val hl: MoHl,
    /** 这一拍在讲什么 */
    val say: String,
    /** 这一拍的易错提醒（没有则空串） */
    val warn: String,
)

data class MoSolveStep(
    val key: String,
    val label: String,
    val ask: String,
    val options: List<String>,
    val answer: String,
    val tip: String,
)

data class MoTrap(val label: String, val value: Int, val why: String)

data class MoTailHint(
    /** 去掉末尾 0 之后的数 */
    val core: Int,
    /** 末尾有几个 0 */
    val zeros: Int,
    /** core × factor */
    val coreProduct: Int,
)

data class MoProblem(
    val groupKey: MoKind,
    val value: Int,
    val factor: Int,
    val product: Int,
    val plan: MoPlan,
    val fullText: String,
    val tail: MoTailHint?,
    val solveSteps: List<MoSolveStep>,
    /** 经典错答 —— 练习收尾时用来点破 */
    val traps: List<MoTrap>,
    val finalNote: String,
)

data class MoKindGroup(
    val key: MoKind,
    /** ★ 题型卡的图（MathIcons 的键）—— 用它代替 emoji + 长描述 */
    val icon: String,
    val title: String,
    val desc: String,
)

data class MoMistakeCase(
    val wrong: String,
    val right: String,
    val why: String,
    val tip: String,
    /** ★ 可核验的算式：单测逐条重算 `value × factor === product`，避免展示数据和引擎脱节 */
    val check: MoCheck? = null,
)

data class MoCheck(val value: Int, val factor: Int, val product: Int)

data class MoRule(
    /** ★ 规律卡的配图（MathIcons 的键）—— 一句话配一幅画，少写一段字 */
    val icon: String,
    val title: String,
    val body: String,
)

/** 每拍用多久（ms）。`ADD` 只在真的进上来了数时才走，所以「无进位」的位会快很多 */
val MO_BEAT_MS: Map<MoBeat, Long> = mapOf(
    MoBeat.MUL to 700L,
    MoBeat.ADD to 620L,
    MoBeat.WRITE to 460L,
    MoBeat.CARRY to 620L,
)

/** 收尾停顿 */
const val MO_TAIL_MS: Long = 420L

private val MO_PLACE_NAMES = listOf("个位", "十位", "百位", "千位", "万位")

fun moPlaceName(i: Int): String =
    MO_PLACE_NAMES.getOrNull(i) ?: "从右往左第 ${i + 1} 位"

// ────────────────────────────────────────────────────────────
// 中文数字与乘法口诀
// ────────────────────────────────────────────────────────────

private val MO_CN_DIGIT = listOf("", "一", "二", "三", "四", "五", "六", "七", "八", "九")

/** 10 ⇒ 一十（口诀里就是「二五一十」）、12 ⇒ 十二、20 ⇒ 二十、24 ⇒ 二十四 */
fun moCnNum(n: Int): String {
    if (n < 10) return MO_CN_DIGIT[n]
    if (n == 10) return "一十"
    val t = n / 10
    val u = n % 10
    return (if (t == 1) "十" else MO_CN_DIGIT[t] + "十") + (if (u != 0) MO_CN_DIGIT[u] else "")
}

/**
 * 口诀原文。★ 教材口径是**小数在前**：「8 × 3」写「三八二十四」，不写「八三二十四」。
 * 积不满十要带「得」：「二三得六」。
 * 有 0 的算式没有口诀（`0 × 5` 教材只说「0 乘任何数都得 0」）⇒ 返回空串。
 */
fun moChant(a: Int, b: Int): String {
    if (a == 0 || b == 0) return ""
    val (x, y) = if (a <= b) a to b else b to a
    val p = a * b
    return if (p < 10) "${MO_CN_DIGIT[x]}${MO_CN_DIGIT[y]}得${MO_CN_DIGIT[p]}"
    else "${MO_CN_DIGIT[x]}${MO_CN_DIGIT[y]}${moCnNum(p)}"
}

// ────────────────────────────────────────────────────────────
// 数字分解 / 拼装
// ────────────────────────────────────────────────────────────

/** 各位数字，**从个位起** */
fun moDigitsOf(n: Int): List<Int> {
    var v = if (n < 0) -n else n
    if (v == 0) return listOf(0)
    val out = ArrayList<Int>(4)
    while (v > 0) {
        out += v % 10
        v /= 10
    }
    return out
}

/** 把「从个位起」的各位拼回一个整数 */
fun moFromDigits(digitsLe: List<Int>): Int {
    var v = 0
    for (i in digitsLe.indices.reversed()) v = v * 10 + digitsLe[i]
    return v
}

// ────────────────────────────────────────────────────────────
// 竖式轨迹
// ────────────────────────────────────────────────────────────

private fun moBeatsOf(s: MoStep): List<MoBeat> {
    val b = ArrayList<MoBeat>(4)
    b += MoBeat.MUL
    // ★ 没有进上来的数就**不走**这一拍 —— 既省时间，也避免把「加 0」讲成一个动作
    if (s.carryIn > 0) b += MoBeat.ADD
    b += MoBeat.WRITE
    if (s.carryOut > 0) b += MoBeat.CARRY
    return b
}

/**
 * 竖式逐位相乘。**这里是全页唯一的算术出处**：页面上的每一个数字（包括高亮）
 * 都来自这条轨迹，页面自己不做任何加减。
 */
fun moPlanSteps(value: Int, factor: Int): MoPlan {
    moAssertOperands(value, factor)
    val digits = moDigitsOf(value)
    val steps = ArrayList<MoStep>(digits.size)
    var carry = 0

    for (place in digits.indices) {
        val digit = digits[place]
        val base = digit * factor
        val carryIn = carry // 个位恒为 0；其余位 = 右一位的 carryOut
        val sum = base + carryIn
        steps += MoStep(
            place = place,
            digit = digit,
            base = base,
            carryIn = carryIn,
            sum = sum,
            write = sum % 10,
            carryOut = sum / 10,
            chant = moChant(digit, factor),
        )
        carry = sum / 10
    }

    val grewTop = carry > 0
    val resultDigits = steps.map { it.write }.toMutableList()
    if (grewTop) resultDigits += carry

    val timeline = ArrayList<MoBeatNode>()
    for (s in steps) {
        for (beat in moBeatsOf(s)) {
            timeline += MoBeatNode(timeline.size, s.place, beat)
        }
    }

    return MoPlan(
        value = value,
        factor = factor,
        product = value * factor,
        digits = digits,
        steps = steps,
        grewTop = grewTop,
        resultDigits = resultDigits,
        cols = maxOf(digits.size, resultDigits.size),
        timeline = timeline,
    )
}

private fun moAssertOperands(value: Int, factor: Int) {
    require(value >= 10) { "被乘数必须是 ≥ 10 的整数（多位数），收到 $value" }
    require(factor in 2..9) { "一位数必须是 2..9 的整数，收到 $factor" }
}

// ────────────────────────────────────────────────────────────
// ★ 四个互不相干的「裁判」—— 单测用它们交叉验算
// ────────────────────────────────────────────────────────────

/** 裁判②：直接交给语言运行时乘 */
fun moProductOf(value: Int, factor: Int): Int = value * factor

/** 裁判③：分位展开相加（`137×6 = 100×6 + 30×6 + 7×6`），跟竖式的循环完全不同 */
fun moProductByExpansion(value: Int, factor: Int): Int {
    var sum = 0
    var v = if (value < 0) -value else value
    var place = 1
    while (v > 0) {
        sum += (v % 10) * place * factor
        v /= 10
        place *= 10
    }
    return sum
}

/** 裁判④：把竖式**写下来的各位**重新拼回一个数 */
fun moProductFromPlan(plan: MoPlan): Int = moFromDigits(plan.resultDigits)

/**
 * ★ 错答生成器①：每一位都忘了加进上来的数。
 * 这是全章最高频的错误（`27 × 4` ⇒ 88），所以它必须由**独立的规则**重算。
 */
fun moDroppingCarries(value: Int, factor: Int): Int =
    moFromDigits(moDigitsOf(value).map { (it * factor) % 10 })

/**
 * ★ 错答生成器②：每处进位都只进 1（满几十也只进 1）。
 * `68 × 4` 应该进 3，只进 1 ⇒ 252（正确 272）。
 *
 * ⚠️ 最高位（最后一次）**不能**套这条错误规则：那里算出来的数整块写在最前面，
 * 根本没有「写几进几」这一步。web 第一版就在这里栽了 —— 把 68×4 算成 152 而不是 252。
 */
fun moCarryOneOnly(value: Int, factor: Int): Int {
    val digits = moDigitsOf(value)
    val out = ArrayList<Int>(digits.size + 1)
    var carry = 0
    for (i in digits.indices) {
        val sum = digits[i] * factor + carry
        if (i == digits.size - 1) {
            // 最高位：整块写下（sum ≤ 9×9+8 = 89，十位最多是 8）
            out += sum % 10
            val hi = sum / 10
            if (hi > 0) out += hi
            break
        }
        out += sum % 10
        carry = if (sum >= 10) 1 else 0 // ★ 错在「不管满几十都只进 1」
    }
    return moFromDigits(out)
}

/**
 * ★ 错答生成器③：被乘数哪一位是 0，就直接写 0 —— 忘了 0 还要加上进上来的数。
 * `305 × 6` ⇒ 1800（正确 1830）。
 */
fun moZeroDropsCarry(value: Int, factor: Int): Int {
    val out = ArrayList<Int>(4)
    var carry = 0
    for (d in moDigitsOf(value)) {
        // ★ 错在把「0 乘任何数都得 0」当成了「这一位就是 0」
        val sum = if (d == 0) 0 else d * factor + carry
        out += sum % 10
        carry = sum / 10
    }
    if (carry > 0) out += carry
    return moFromDigits(out)
}

// ────────────────────────────────────────────────────────────
// 题型判定（生成器与单测共用同一套判据，避免两处口径漂移）
// ────────────────────────────────────────────────────────────

/** 连续进位的**最长连段**长度 */
fun moMaxCarryRun(steps: List<MoStep>): Int {
    var best = 0
    var cur = 0
    for (s in steps) {
        if (s.carryOut > 0) {
            cur++
            if (cur > best) best = cur
        } else {
            cur = 0
        }
    }
    return best
}

fun moKindOf(plan: MoPlan): MoKind {
    // ① 末尾有 0：这一组的教学点是**巧算**，优先判
    if (plan.value % 10 == 0) return MoKind.TAIL_ZERO
    // ② 中间有 0（只可能是三位数的十位）：教学点是「0 也要加进位 / 不能漏写 0」
    val digits = plan.digits
    if (digits.size >= 3 && digits.subList(1, digits.size - 1).any { it == 0 }) return MoKind.MID_ZERO
    // ③ 按进位连段分
    val run = moMaxCarryRun(plan.steps)
    return when {
        run == 0 -> MoKind.NO_CARRY
        run == 1 -> MoKind.CARRY
        else -> MoKind.CARRY_CHAIN
    }
}

// ────────────────────────────────────────────────────────────
// 题型清单（★ 单一来源）
// ────────────────────────────────────────────────────────────

val MO_KIND_GROUPS: List<MoKindGroup> = listOf(
    MoKindGroup(MoKind.NO_CARRY, "rowSticks", "不进位", "每位都不满十"),
    MoKindGroup(MoKind.CARRY, "bundle", "进位", "满十往左送"),
    MoKindGroup(MoKind.CARRY_CHAIN, "bundleChain", "连续进位", "一层层往左传"),
    MoKindGroup(MoKind.TAIL_ZERO, "zeroTail", "末尾有 0", "先算前面，末尾补 0"),
    MoKindGroup(MoKind.MID_ZERO, "zeroMid", "中间有 0", "0 也要加进位"),
)

// ────────────────────────────────────────────────────────────
// 视图推导（纯函数）—— 页面只渲染，不判断
// ────────────────────────────────────────────────────────────

fun moBeatStateAt(plan: MoPlan, index: Int): MoBeatState {
    val total = plan.timeline.size
    if (total == 0) return MoBeatState(0, 0, MoBeat.DONE, 0)
    if (index < 0) return MoBeatState(-1, 0, MoBeat.IDLE, total)
    if (index >= total) {
        val last = plan.timeline[total - 1]
        return MoBeatState(total, last.place, MoBeat.DONE, total)
    }
    val n = plan.timeline[index]
    return MoBeatState(index, n.place, n.beat, total)
}

fun moViewOf(plan: MoPlan, index: Int): MoView {
    val st = moBeatStateAt(plan, index)
    val place = st.place
    val beat = st.beat
    val total = st.total
    val finished = index >= total
    val len = plan.steps.size
    val step = plan.steps[place.coerceIn(0, len - 1)]

    // ── 结果行 ──
    // 第 i 位（0 = 个位）什么时候被写下来？
    // ⚠️ 必须先判 `finished`：否则「播完」这一帧会走进 `DONE` 的分支、
    //    把已经写出来的格子**又变回 null** —— 表现是「动画放完，个位数字消失了」。
    //    （这是 web 单测里「播完结果行应当写满」那条当场抓出来的。）
    val resultCells: List<Int?> = plan.resultDigits.mapIndexed { i, v ->
        when {
            finished -> v
            i < len -> {
                if (i < place) plan.steps[i].write
                else if (i == place && (beat == MoBeat.WRITE || beat == MoBeat.CARRY)) plan.steps[i].write
                else null
            }
            // 多出来的最高位：只有最后一位「进」的那一拍才露面
            else -> if (place == len - 1 && beat == MoBeat.CARRY) v else null
        }
    }

    // ── 进位槽 ──
    // 槽 i 里装的是「被送进第 i 位」的数 = steps[i].carryIn。它由第 i-1 位的「进」那一拍填上。
    val carryCells: List<Int?> = (0 until len).map { i ->
        val v = plan.steps[i].carryIn
        when {
            v == 0 -> null
            i - 1 < place -> v
            i - 1 == place && beat == MoBeat.CARRY -> v
            else -> null
        }
    }

    var hl = MoHl()
    var say = ""
    var warn = ""

    when (beat) {
        MoBeat.MUL -> {
            hl = hl.copy(
                digit = place,
                factor = true,
                op = true,
                chant = step.digit > 0,
                shown = MoShown.BASE,
            )
            say = if (step.digit == 0) {
                if (step.carryIn > 0) {
                    "${moPlaceName(place)}是 0 —— 先记 0，进位等一下再加"
                } else {
                    "${moPlaceName(place)}是 0 —— 0 乘几都得 0"
                }
            } else {
                "${moPlaceName(place)}：${step.digit} × ${plan.factor} = ${step.base}　${step.chant}"
            }
            if (step.digit * plan.factor >= 10) {
                warn = "⚠️ ${step.chant} 满十，等一下往左送"
            }
        }

        MoBeat.ADD -> {
            hl = hl.copy(carryIn = place, shown = MoShown.SUM)
            say = "${step.base} + ${step.carryIn} = ${step.sum}　（${moPlaceName(place - 1)}进上来的）"
            warn = if (step.digit == 0) {
                "⚠️ 这一位是 0，但 0 + ${step.carryIn} = ${step.sum} —— 直接写 0 就错了"
            } else {
                "⚠️ 别漏了刚进上来的 ${step.carryIn} —— 全章错得最多的一步"
            }
        }

        MoBeat.WRITE -> {
            hl = hl.copy(write = place, shown = MoShown.SUM)
            say = if (step.carryOut > 0) {
                "${moPlaceName(place)}写 ${step.write}，${step.carryOut} 记在头顶"
            } else {
                "${step.sum} 不满十 —— 写 ${step.write}，不进位"
            }
            if (step.carryOut > 1) warn = "⚠️ 满 ${step.sum} 要进 ${step.carryOut}，不是进 1"
        }

        MoBeat.CARRY -> {
            hl = hl.copy(shown = MoShown.SUM)
            if (place == len - 1) {
                hl = hl.copy(topCarry = true)
                say = "${step.sum} 满十 —— ${step.carryOut} 写在最前面，积多一位"
            } else {
                hl = hl.copy(carryIn = place + 1)
                say = "${step.sum} 满十 —— ${step.carryOut} 送到${moPlaceName(place + 1)}头上，算到那一位要加上它"
            }
        }

        MoBeat.DONE -> {
            hl = hl.copy(shown = MoShown.SUM)
            say = "${plan.value} × ${plan.factor} = ${plan.product}　✓ 每位都乘完、进位都加了"
        }

        MoBeat.IDLE -> {
            say = "从个位起，一位一位地乘"
        }
    }

    return MoView(
        index = index,
        total = total,
        place = st.place,
        beat = beat,
        finished = finished,
        resultCells = resultCells,
        carryCells = carryCells,
        hl = hl,
        say = say,
        warn = warn,
    )
}

// ────────────────────────────────────────────────────────────
// 巧算（末尾有 0）
// ────────────────────────────────────────────────────────────

fun moTailZeroHint(value: Int, factor: Int): MoTailHint? {
    if (value % 10 != 0) return null
    var zeros = 0
    var core = value
    while (core % 10 == 0) {
        core /= 10
        zeros++
    }
    return MoTailHint(core, zeros, core * factor)
}

// ────────────────────────────────────────────────────────────
// 出题
// ────────────────────────────────────────────────────────────

/**
 * ★ 对齐 JS `min + floor(random*(max-min+1))`：**跨度 ≤ 0 时返回 min，不抛错**。
 * Kotlin `nextInt(2,1)` 会抛 `IllegalArgumentException`，只在特定随机值下复现。
 */
internal fun moRndInclusive(min: Int, max: Int, random: Random): Int {
    val span = max - min + 1
    if (span <= 0) return min
    return min + random.nextInt(span)
}

internal fun <T> moShuffle(arr: List<T>, random: Random): List<T> {
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
internal fun moOptsFor(
    answer: String,
    cands: List<String>,
    filler: List<String> = emptyList(),
    random: Random = Random.Default,
): List<String> {
    val out = mutableListOf(answer)
    for (c in cands + filler) {
        if (out.size >= 4) break
        if (c.isEmpty() || c == answer || out.contains(c)) continue
        out += c
    }
    return moShuffle(out, random)
}

/** 数值型选项的兜底干扰项（只在真正的错答凑不够时才用得上） */
private fun moNumFillers(answer: Int): List<String> =
    listOf(answer + 10, answer - 10, answer + 1, answer - 1, answer * 10, answer / 10)
        .filter { it > 0 && it != answer }
        .map { it.toString() }

/** 每个题型都放一个「怎么算都对不上」的兜底题，避免随机抽不到时死循环 */
private val MO_FALLBACK: Map<MoKind, Pair<Int, Int>> = mapOf(
    // 23 × 3 = 69：两位都不满十
    MoKind.NO_CARRY to (23 to 3),
    // 38 × 2 = 76：个位 8×2=16 进 1，十位 3×2+1=7 不进位 ⇒ 正好一段
    MoKind.CARRY to (38 to 2),
    // 137 × 6 = 822：个位进 4、十位进 2 ⇒ 连续两段
    MoKind.CARRY_CHAIN to (137 to 6),
    // 280 × 3 = 840：`28 × 3 = 84` 末尾补 1 个 0
    MoKind.TAIL_ZERO to (280 to 3),
    // 305 × 6 = 1830：十位 0×6=0，但必须加上个位进上来的 3
    MoKind.MID_ZERO to (305 to 6),
)

private fun moPickNoCarry(random: Random): Pair<Int, Int> {
    // factor ≥ 5 时每位只能填 1（1×5=5），题面太机械 ⇒ 只取 2..4
    val factor = moRndInclusive(2, 4, random)
    val maxDigit = 9 / factor // 2⇒4、3⇒3、4⇒2
    val len = if (random.nextDouble() < 0.5) 2 else 3
    repeat(40) {
        val digits = List(len) { moRndInclusive(1, maxDigit, random) }
        if (digits.toSet().size == 1) return@repeat // 222×3 这类太像抄写
        val value = moFromDigits(digits)
        if (value % 10 == 0) return@repeat
        if (moPlanSteps(value, factor).steps.any { it.carryOut > 0 }) return@repeat
        return value to factor
    }
    return MO_FALLBACK.getValue(MoKind.NO_CARRY)
}

private fun moPickCarry(random: Random): Pair<Int, Int> {
    repeat(200) {
        val factor = moRndInclusive(2, 9, random)
        val len = if (random.nextDouble() < 0.5) 2 else 3
        val digits = List(len) { moRndInclusive(1, 9, random) }
        val value = moFromDigits(digits)
        if (value % 10 == 0) return@repeat
        if (digits.subList(1, len - 1).any { it == 0 }) return@repeat // 中间有 0 留给 midZero
        if (moMaxCarryRun(moPlanSteps(value, factor).steps) != 1) return@repeat
        return value to factor
    }
    return MO_FALLBACK.getValue(MoKind.CARRY)
}

private fun moPickCarryChain(random: Random): Pair<Int, Int> {
    repeat(400) {
        val factor = moRndInclusive(3, 9, random)
        val len = if (random.nextDouble() < 0.45) 2 else 3
        // 低位先给大一点，进位才连得起来
        val digits = List(len) { i -> if (i == 0) moRndInclusive(5, 9, random) else moRndInclusive(2, 9, random) }
        val value = moFromDigits(digits)
        if (value % 10 == 0) return@repeat
        if (digits.subList(1, len - 1).any { it == 0 }) return@repeat
        if (moMaxCarryRun(moPlanSteps(value, factor).steps) >= 2) return value to factor
    }
    return MO_FALLBACK.getValue(MoKind.CARRY_CHAIN)
}

private fun moPickTailZero(random: Random): Pair<Int, Int> {
    repeat(200) {
        val core = moRndInclusive(12, 99, random)
        if (core % 10 == 0) return@repeat // core 自己带 0 就不是「末尾恰好一个 0」了
        val factor = moRndInclusive(2, 9, random)
        val value = core * 10
        if (moPlanSteps(value, factor).steps[0].carryOut != 0) return@repeat
        return value to factor
    }
    return MO_FALLBACK.getValue(MoKind.TAIL_ZERO)
}

private fun moPickMidZero(random: Random): Pair<Int, Int> {
    repeat(200) {
        val a = moRndInclusive(1, 9, random)
        // ★ 个位取 5..9 ⇒ 个位乘一位数必然满十 ⇒ 十位（那个 0）一定收到进位，
        //   于是「0 不能直接写 0」这个教学点必然出现，不用碰运气
        val c = moRndInclusive(5, 9, random)
        val factor = moRndInclusive(2, 9, random)
        val value = a * 100 + c
        val plan = moPlanSteps(value, factor)
        if (plan.steps[1].carryIn == 0) return@repeat
        if (moKindOf(plan) != MoKind.MID_ZERO) return@repeat
        return value to factor
    }
    return MO_FALLBACK.getValue(MoKind.MID_ZERO)
}

private fun moPick(kind: MoKind, random: Random): Pair<Int, Int> = when (kind) {
    MoKind.NO_CARRY -> moPickNoCarry(random)
    MoKind.CARRY -> moPickCarry(random)
    MoKind.CARRY_CHAIN -> moPickCarryChain(random)
    MoKind.TAIL_ZERO -> moPickTailZero(random)
    MoKind.MID_ZERO -> moPickMidZero(random)
}

fun moGenPlan(groupKey: MoKind, random: Random = Random.Default): MoPlan {
    repeat(8) {
        val (value, factor) = moPick(groupKey, random)
        val plan = moPlanSteps(value, factor)
        if (moKindOf(plan) == groupKey) return plan
    }
    val (fv, ff) = MO_FALLBACK.getValue(groupKey)
    val plan = moPlanSteps(fv, ff)
    check(moKindOf(plan) == groupKey) {
        // 兜底题也必须自证属于本组 —— 否则宁可炸掉，也不要悄悄换一个题型给学生
        "兜底题 $fv × $ff 不属于题型 ${groupKey.key}（实测 ${moKindOf(plan).key}）"
    }
    return plan
}

// ────────────────────────────────────────────────────────────
// 一步一填
// ────────────────────────────────────────────────────────────

private const val MO_WRITE_NONE = "不进位"

private fun moMakeVerticalSteps(plan: MoPlan, random: Random): List<MoSolveStep> {
    val out = ArrayList<MoSolveStep>()
    val len = plan.steps.size

    for (i in 0 until len) {
        val s = plan.steps[i]
        val pn = moPlaceName(i)

        // ── ① 乘（再加进位）──
        val mulCands = mutableListOf<String>()
        if (s.carryIn > 0) {
            mulCands += s.base.toString() // ★ 忘了加进上来的数（最高频错答）
            mulCands += (s.sum + s.carryIn).toString() // 把进位的数加了两次
        } else {
            val nb = s.digit * (if (plan.factor == 9) 8 else plan.factor + 1)
            if (nb != s.sum) mulCands += nb.toString() // 口诀背错
            val nb2 = (if (s.digit == 1) 2 else s.digit - 1) * plan.factor
            if (nb2 != s.sum) mulCands += nb2.toString()
        }
        out += MoSolveStep(
            key = "mul$i",
            label = "$pn · 乘",
            ask = if (s.carryIn > 0) {
                "$pn：${s.digit} × ${plan.factor} = ${s.base}，再加进上来的 ${s.carryIn} = ?"
            } else {
                "$pn：${s.digit} × ${plan.factor} = ?"
            },
            options = moOptsFor(s.sum.toString(), mulCands, moNumFillers(s.sum), random),
            answer = s.sum.toString(),
            tip = when {
                s.digit == 0 && s.carryIn > 0 ->
                    "0 × ${plan.factor} = 0 没错，但这一位还要加 ${s.carryIn}。"
                s.carryIn > 0 ->
                    "漏掉进位就会写成 ${s.base} —— 27 × 4 算成 88 就是这个原因。"
                else ->
                    "${s.chant.ifEmpty { "0 乘几都得 0" }} ⇒ ${s.sum}"
            },
        )

        // ── ② 写几、进几 ──
        val carryWord = if (s.carryOut > 0) "进 ${s.carryOut}" else MO_WRITE_NONE
        val answer = "写 ${s.write}，$carryWord"
        val writeCands = mutableListOf<String>()
        if (s.carryOut > 0) {
            writeCands += "写 ${s.write}，$MO_WRITE_NONE" // ★ 漏进位
            writeCands += "写 ${s.carryOut}，进 ${s.write}" // 写反
            if (s.carryOut != 1) writeCands += "写 ${s.write}，进 1" // ★ 满几十只进 1
        } else {
            writeCands += "写 ${s.write}，进 1" // 不该进位却进了一位
            writeCands += "写 ${s.sum}，$MO_WRITE_NONE" // 整块写下来
        }
        // 写「几」本身也有干扰项（改数字、保持进位说法）
        val writeFillers = listOf(s.write + 1, maxOf(0, s.write - 1), s.write + 2)
            .filter { it <= 9 && it != s.write }
            .map { "写 $it，$carryWord" }
        out += MoSolveStep(
            key = "write$i",
            label = "$pn · 写",
            ask = "${s.sum} —— $pn 写几？进几？",
            options = moOptsFor(answer, writeCands, writeFillers, random),
            answer = answer,
            tip = if (s.carryOut > 0) {
                "个位 ${s.write} 留在$pn，十位 ${s.carryOut} 送到前一位头上。" +
                    if (i == len - 1) "已经是最前面，直接写进积的最高位。" else ""
            } else {
                "${s.sum} 不到 10 —— 写 ${s.write}，不进位。"
            },
        )
    }

    return out
}

private fun moMakeTailZeroSteps(plan: MoPlan, tail: MoTailHint, random: Random): List<MoSolveStep> {
    val out = ArrayList<MoSolveStep>(3)
    val drop = moDroppingCarries(tail.core, plan.factor)
    val one = moCarryOneOnly(tail.core, plan.factor)
    val p = tail.coreProduct

    out += MoSolveStep(
        key = "core",
        label = "① 先算前面",
        ask = "先算 ${tail.core} × ${plan.factor} = ?",
        options = moOptsFor(
            p.toString(),
            listOf(drop, one).filter { it != p }.map { it.toString() },
            moNumFillers(p),
            random,
        ),
        answer = p.toString(),
        tip = "末尾的 0 先放一边 ⇒ 只要算两位数。",
    )

    out += MoSolveStep(
        key = "zeros",
        label = "② 数一数 0",
        ask = "${plan.value} 的末尾有几个 0？",
        options = listOf("没有 0", "1 个 0", "2 个 0"),
        answer = "${tail.zeros} 个 0",
        tip = "补 0 的时候一个也不能少。",
    )

    out += MoSolveStep(
        key = "final",
        label = "③ 补上 0",
        ask = "${p} 后补 ${tail.zeros} 个 0 = ?",
        options = moOptsFor(
            plan.product.toString(),
            listOf(p.toString(), (p * moPow10(tail.zeros + 1)).toString()),
            moNumFillers(plan.product),
            random,
        ),
        answer = plan.product.toString(),
        tip = "补 ${tail.zeros} 个 0 ⇒ ${plan.product}。漏补就变成 $p。",
    )

    return out
}

private fun moPow10(n: Int): Int {
    var v = 1
    repeat(n) { v *= 10 }
    return v
}

/**
 * 错答候选的准入标准。
 * ⚠️ 必须滤掉 ≤ 0 的退化值：`220 × 5` 要是每一位都漏加进位，写下来就是 0，
 * 而「0」摆在选项里毫无干扰作用。只留正整数候选。
 */
private fun moUsableTraps(values: List<Int>, answer: Int): List<String> =
    values.filter { it != answer && it > 0 }.map { it.toString() }

fun moMakeSolveSteps(plan: MoPlan, random: Random = Random.Default): List<MoSolveStep> {
    val tail = moTailZeroHint(plan.value, plan.factor)
    // ★ 巧算三问的最后一步问的就是积 —— 不要再追加一次通用的「写完整」，
    //   否则键会重名（final, final），同一个问题还会连着问两遍。
    if (tail != null) return moMakeTailZeroSteps(plan, tail, random)

    val out = moMakeVerticalSteps(plan, random).toMutableList()

    // 收尾：把竖式写完整，并且把经典错答摆出来让学生认一认
    val drop = moDroppingCarries(plan.value, plan.factor)
    val one = moCarryOnly(plan)
    val zero = moZeroDropsCarry(plan.value, plan.factor)
    out += MoSolveStep(
        key = "final",
        label = "写完整",
        ask = "${plan.value} × ${plan.factor} = ?",
        options = moOptsFor(
            plan.product.toString(),
            moUsableTraps(listOf(drop, one, zero), plan.product),
            moNumFillers(plan.product),
            random,
        ),
        answer = plan.product.toString(),
        tip = "${plan.value} × ${plan.factor} = ${plan.product}" +
            if (plan.grewTop) "，最前面还有进上来的一位" else "",
    )
    return out
}

private fun moCarryOnly(plan: MoPlan): Int = moCarryOneOnly(plan.value, plan.factor)

private fun moMakeTraps(plan: MoPlan): List<MoTrap> {
    val out = ArrayList<MoTrap>(3)
    val drop = moDroppingCarries(plan.value, plan.factor)
    val one = moCarryOneOnly(plan.value, plan.factor)
    val zero = moZeroDropsCarry(plan.value, plan.factor)
    val taken = mutableSetOf(plan.product)

    if (drop != plan.product && drop > 0) {
        taken += drop
        out += MoTrap(
            label = "算成 $drop",
            value = drop,
            why = "每位都忘了加右边进上来的数（27 × 4 算成 88）。",
        )
    }
    if (one != plan.product && one > 0 && taken.add(one)) {
        out += MoTrap(
            label = "算成 $one",
            value = one,
            why = "每处进位都只进 1 —— 8 × 6 = 48 要进 4，满几十就进几。",
        )
    }
    if (zero != plan.product && zero > 0 && taken.add(zero)) {
        out += MoTrap(
            label = "算成 $zero",
            value = zero,
            why = "中间那位是 0 就直接写 0，忘了还要加进位。",
        )
    }
    return out
}

// ────────────────────────────────────────────────────────────
// 组题
// ────────────────────────────────────────────────────────────

fun moBuildProblem(plan: MoPlan, groupKey: MoKind, random: Random = Random.Default): MoProblem {
    val tail = moTailZeroHint(plan.value, plan.factor)
    val note = when {
        groupKey == MoKind.TAIL_ZERO && tail != null ->
            "${tail.core} × ${plan.factor} = ${tail.coreProduct}，末尾补 ${tail.zeros} 个 0 ⇒ ${plan.product}"
        groupKey == MoKind.MID_ZERO ->
            "中间那位是 0，0 × ${plan.factor} = 0 —— 但要加进位，所以它不是 0"
        else -> "从个位起一位一位地乘，满十就往左进几"
    }

    return MoProblem(
        groupKey = groupKey,
        value = plan.value,
        factor = plan.factor,
        product = plan.product,
        plan = plan,
        fullText = "${plan.value} × ${plan.factor} = ?",
        tail = tail,
        solveSteps = moMakeSolveSteps(plan, random),
        traps = moMakeTraps(plan),
        finalNote = note,
    )
}

fun moGenProblem(groupKey: MoKind, random: Random = Random.Default): MoProblem =
    moBuildProblem(moGenPlan(groupKey, random), groupKey, random)

/** 一次抽 n 道（页面用 4 道一组）。同一组内不出现同一道题 */
fun moGenProblemSet(groupKey: MoKind, n: Int = 4, random: Random = Random.Default): List<MoProblem> {
    val out = ArrayList<MoProblem>(n)
    val seen = HashSet<String>()
    var guard = 0
    while (out.size < n && guard < n * 80) {
        guard++
        val p = moGenProblem(groupKey, random)
        if (!seen.add("${p.value}-${p.factor}")) continue
        out += p
    }
    return out
}

// ────────────────────────────────────────────────────────────
// 静态教学资料
// ────────────────────────────────────────────────────────────

val MO_RULES: List<MoRule> = listOf(
    MoRule(
        icon = "arrowLeft",
        title = "从个位乘起",
        body = "进位只能往左走。个位攒够 10 才送得出一捆；十位在个位算完前不知道该加几。",
    ),
    MoRule(
        icon = "bundle",
        title = "满几十就进几",
        body = "4 × 6 = 24 进 2，8 × 6 = 48 进 4。不是一律进 1 —— 68 × 4 只进 1 会算成 252。",
    ),
    MoRule(
        icon = "plusHead",
        title = "进上来的数要加",
        body = "乘法算完还要加它。27 × 4：7 × 4 = 28 写 8 进 2，十位 2 × 4 + 2 = 10。",
    ),
    MoRule(
        icon = "zeroTail",
        title = "末尾有 0 先算前面",
        body = "280 × 5：先算 28 × 5 = 140，末尾补 1 个 0 ⇒ 1400。补几个看原来末尾有几个。",
    ),
)

/**
 * ★ 每一条都人工验算过，并且带 [MoMistakeCase.check] 的那几条会被单测逐条重算。
 * ⚠️ 这里**不写 markdown 的星号** —— 页面上是纯文本渲染，星号会原样露出来。
 */
val MO_MISTAKE_CASES: List<MoMistakeCase> = listOf(
    MoMistakeCase(
        wrong = "27 × 4 = 88",
        right = "27 × 4 = 108",
        why = "十位 2 × 4 = 8 时忘了加进上来的 2 —— 该写 0 进 1。",
        tip = "「进几」的下一步一定「加上几」。在进位数旁边画个小圈提醒自己。",
        check = MoCheck(27, 4, 108),
    ),
    MoMistakeCase(
        wrong = "305 × 6 = 1800",
        right = "305 × 6 = 1830",
        why = "看见 0 × 6 = 0 就写了 0，忘了个位 5 × 6 = 30 还进了 3 —— 这一位是 0 + 3。",
        tip = "这一位要算的是「0 × 6 的积 再加进位数」。",
        check = MoCheck(305, 6, 1830),
    ),
    MoMistakeCase(
        wrong = "403 × 2 = 86",
        right = "403 × 2 = 806",
        why = "十位的 0 没写，百位的 8 就掉到了十位上。",
        tip = "算出来是 0 也要写在那一格 —— 0 占的是数位。",
        check = MoCheck(403, 2, 806),
    ),
    MoMistakeCase(
        wrong = "160 × 3 = 48",
        right = "160 × 3 = 480",
        why = "巧算先算了 16 × 3 = 48，末尾的 0 忘了补。",
        tip = "写完一定要回头数：被乘数末尾原来有几个 0。",
        check = MoCheck(160, 3, 480),
    ),
    MoMistakeCase(
        wrong = "68 × 4 = 252",
        right = "68 × 4 = 272",
        why = "个位 8 × 4 = 32 该进 3，却只进了 1。",
        tip = "进几看乘出来的数十位上是几：32 进 3，48 进 4。",
        check = MoCheck(68, 4, 272),
    ),
    MoMistakeCase(
        wrong = "45 × 3 = 1215",
        right = "45 × 3 = 135",
        why = "十位和个位各算各的、拼成 1215 —— 个位满十要往十位进。",
        tip = "每一位算完都要把进位交给前一位，最后只有一个数。",
        check = MoCheck(45, 3, 135),
    ),
    MoMistakeCase(
        wrong = "78 × 8 = 604",
        right = "78 × 8 = 624",
        why = "口诀背混：七八五十六记成了七八五十四。",
        tip = "背不牢就想 8 × 7 = 40 + 16。",
        check = MoCheck(78, 8, 624),
    ),
)
