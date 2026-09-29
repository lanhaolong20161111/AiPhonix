package com.example.ai.data.math

import kotlin.random.Random

/**
 * 三年级数学 · 等式变变变 —— 「移项变号」规则引擎（纯逻辑，零网络）
 *
 * 核心规律：把一个数（或未知数）从等号**一侧挪到另一侧**，符号必须**变相反**
 *     + 与 - 互换、  × 与 ÷ 互换
 * 而在**等号同一侧**交换左右位置，符号一点不用调。
 *
 * 三条业务规则（缺一不可）：
 *   ① 只有**跨过等号**才变号 —— 同侧换位置符号不动（见 [MoveProblem.isSameSide]）
 *   ② 搬走的是**整个数字连同它前面的运算符**（见 [MoveAction.srcOp]）—— 负号不是数字自带的
 *   ③ 加减法搬的是「项」⇒ 变相反符号；乘除法搬的是「因子」⇒ 到对面变倒数
 *
 * 出题全部**反推参数**（先定 x 与操作数，再算出得数）⇒ 每道题恒成立；
 * 动画只负责照着 [MoveAction] 播，自己不参与任何计算。
 *
 * 移植自 web/src/lib/equationMove.ts（逐行对照，行为必须一致）。
 * 减号统一用 ASCII "-"（与 web 全站算式一致），避免和 U+2212 混用导致求值对不上。
 *
 * ⚠️ 命名全部带 `Eq` / `eq` / `EQ_` 前缀 —— 本文件与 [CompoundExpr]、[Precedence] **同处
 *    `com.example.ai.data.math` 一个 package**，Kotlin 顶层声明在同包内不能重名。
 *    那边已有 `KIND_LABEL` / `RULES` / `MISTAKE_CASES` / `rndInclusive` / `generateProblem`，
 *    照抄 web 的裸名会直接编译不过（`Overload resolution ambiguity` / `Conflicting declarations`）。
 *    `Precedence.kt` 也是靠 `P` / `Pr` / `PR_` 前缀在同一包里避让的 —— 这里沿用同一惯例。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 四则运算符。[sym] 是屏幕上显示的字符；[flip] = 跨过等号后的符号（本页全部规律的基础） */
enum class EqOp(val sym: String) {
    ADD("+"),
    SUB("-"),
    MUL("×"),
    DIV("÷"),
    ;

    /**
     * 跨过等号 ⇒ 变相反。
     * 加减互换（项移过去变号）、乘除互换（因子移过去变倒数），两者不能串门。
     */
    val flip: EqOp
        get() = when (this) {
            ADD -> SUB
            SUB -> ADD
            MUL -> DIV
            DIV -> MUL
        }
}

/** 等式一侧里的一项：写在它**前面**的符号 + 值 */
data class EqTerm(
    /** 该项前面的运算符；null = 首项正项（屏幕上不写符号） */
    val op: EqOp?,
    val value: String,
    val isVar: Boolean,
)

/** 等式的一侧 */
typealias EqSideList = List<EqTerm>

/** 一个等式（左右两侧） */
data class EqState(val left: EqSideList, val right: EqSideList)

/** 是哪一侧 */
enum class EqSide { LEFT, RIGHT }

/** 题型（决定演示哪条规律） */
enum class MoveKind {
    /** x + a = b ⇒ x = b - a（加数跨过去变减） */
    PLUS,

    /** x - a = b ⇒ x = b + a（减数跨过去变加） */
    MINUS,

    /** a - x = b ⇒ a = b + x ⇒ x = a - b（要搬两次） */
    MINUS_VAR,

    /** x × a = b ⇒ x = b ÷ a（乘的因子跨过去变除） */
    TIMES,

    /** x ÷ a = b ⇒ x = b × a（除的因子跨过去变乘） */
    DIVIDE,

    /** a ÷ x = b ⇒ a = b × x ⇒ x = a ÷ b（要搬两次） */
    DIVIDE_VAR,

    /** 反例：a + x = b ⇒ x + a = b（同侧换位置，符号不动） */
    SAME_SIDE,
}

/** 一次「搬项」。跨过等号 ⇒ 符号翻转 */
data class MoveAction(
    val from: EqSide,
    val index: Int,
    /** 被搬的项原本**写出来**的符号（首项为 null —— 屏幕上它前面真的什么都没写） */
    val srcOp: EqOp?,
    /** 被搬的项在式子里**等效**的运算符（首项 / 因数也算得出来）—— 决定它跨过去会变成什么 */
    val fromOp: EqOp,
    /** 跨过等号后变成的符号 */
    val toOp: EqOp,
    val value: String,
    val isVar: Boolean,
    val before: EqState,
    val after: EqState,
    val note: String,
)

/** 一道完整的移项题 */
data class MoveProblem(
    val kind: MoveKind,
    val kindLabel: String,
    val kindTip: String,
    val initial: EqState,
    val actions: List<MoveAction>,
    /** 全部搬完后要「左右对调」才写成 x = 数字 的标准形态（a - x = b 这类） */
    val flipSides: Boolean,
    /** 最终规范形态：x = 一个数 */
    val final: EqState,
    /** x 的解 */
    val x: Int,
    /** 末态右侧算出来的数（恒等于 x） */
    val answer: Int,
    /** 同侧交换（反例）：压根没跨等号，符号不变 */
    val isSameSide: Boolean,
    val hint: String,
)

// ────────────────────────────────────────────────────────────
// 核心规则
// ────────────────────────────────────────────────────────────

/** 跨过等号 ⇒ 符号必须变相反（本页唯一的核心规则，写成函数便于单测与 UI 直接引用） */
fun eqFlipOp(op: EqOp): EqOp = op.flip

/**
 * 某一项在式子里**等效**的运算符 —— 即它跨过等号时会以什么身份变号。
 *
 *  · 写出来的符号（+ / - / × / ÷）直接用
 *  · 首项没写符号时：若它**后面跟的是 × / ÷**，说明它是乘除链的第一个因数 ⇒ 等效 ×
 *    否则等效 +
 *
 * 例：[x, +5] 的 5 ⇒ +  ·  [4, ×x] 的 4 ⇒ ×  ·  [15, -x] 的 15 ⇒ +
 */
fun eqEffectiveOp(side: EqSideList, i: Int): EqOp {
    val t = side[i]
    if (t.op == EqOp.SUB) return EqOp.SUB
    if (t.op == EqOp.MUL || t.op == EqOp.DIV) return t.op
    val next = side.getOrNull(i + 1)
    if (next != null && (next.op == EqOp.MUL || next.op == EqOp.DIV)) return EqOp.MUL
    return EqOp.ADD
}

/** 移走第 i 项之后，把新的首项规范化：只有「负项」才写出 -，+ / × / ÷ 都不写 */
private fun eqRemoveTerm(side: EqSideList, i: Int): EqSideList {
    val rest = side.filterIndexed { k, _ -> k != i }
    if (rest.isEmpty()) return emptyList()
    val h = rest.first()
    return listOf(h.copy(op = if (h.op == EqOp.SUB) EqOp.SUB else null)) + rest.drop(1)
}

/** 往一侧的末尾追加一项（搬到对面后排在最后） */
private fun eqAppendTerm(side: EqSideList, op: EqOp, value: String, isVar: Boolean): EqSideList =
    side + EqTerm(op, value, isVar)

/** 构造一次搬运动作：从 [st] 的某一侧搬走第 [index] 项，跨等号到对侧末尾，符号翻转 */
fun eqBuildAction(st: EqState, from: EqSide, index: Int, note: String): MoveAction {
    val src: EqSideList = if (from == EqSide.LEFT) st.left else st.right
    val t = src[index]
    val fromOp = eqEffectiveOp(src, index)
    val toOp = eqFlipOp(fromOp)
    val after = if (from == EqSide.LEFT) {
        EqState(eqRemoveTerm(st.left, index), eqAppendTerm(st.right, toOp, t.value, t.isVar))
    } else {
        EqState(eqAppendTerm(st.left, toOp, t.value, t.isVar), eqRemoveTerm(st.right, index))
    }
    return MoveAction(from, index, t.op, fromOp, toOp, t.value, t.isVar, st, after, note)
}

// ────────────────────────────────────────────────────────────
// 文本
// ────────────────────────────────────────────────────────────

/** 一侧 → 可读文本；给了 [xVal] 就把未知数替换成具体数字（验算用） */
fun eqSideToText(side: EqSideList, xVal: Int? = null): String =
    side.mapIndexed { i, t ->
        val v = if (t.isVar && xVal != null) xVal.toString() else t.value
        if (i == 0) {
            if (t.op == EqOp.SUB) "-$v" else v
        } else {
            " ${requireNotNull(t.op).sym} $v"
        }
    }.joinToString("")

/** 整个等式 → 文本 */
fun eqToText(st: EqState, xVal: Int? = null): String =
    "${eqSideToText(st.left, xVal)} = ${eqSideToText(st.right, xVal)}"

/** 一行解答：x = 12 - 5 = 7 */
fun eqSolutionText(p: MoveProblem): String = "x = ${eqSideToText(p.final.right)} = ${p.answer}"

// ────────────────────────────────────────────────────────────
// 出题（全部**反推参数**：先定答案，再算出得数 ⇒ 恒成立）
// ────────────────────────────────────────────────────────────

/**
 * [min, max] 闭区间随机整数。
 *
 * 复刻 JS 端 `rnd` 的语义：`max <= min` 时**返回 min 而不抛异常** ——
 * 直接换成 `random.nextInt(min, max)` 会在跨度 <= 0 时抛 IllegalArgumentException，
 * 且只在特定随机值下出现，极难复现。
 */
internal fun eqRndInclusive(min: Int, max: Int, random: Random): Int {
    val span = max - min + 1
    if (span <= 0) return min
    return min + random.nextInt(span)
}

private fun xv(op: EqOp? = null): EqTerm = EqTerm(op, "x", true)
private fun nu(v: Int, op: EqOp? = null): EqTerm = EqTerm(op, v.toString(), false)

val EQ_KIND_LABEL: Map<MoveKind, String> = mapOf(
    MoveKind.PLUS to "x + a = b",
    MoveKind.MINUS to "x - a = b",
    MoveKind.MINUS_VAR to "a - x = b",
    MoveKind.TIMES to "x × a = b",
    MoveKind.DIVIDE to "x ÷ a = b",
    MoveKind.DIVIDE_VAR to "a ÷ x = b",
    MoveKind.SAME_SIDE to "同侧交换 · 不变号",
)

val EQ_KIND_TIP: Map<MoveKind, String> = mapOf(
    MoveKind.PLUS to "加数跨过等号 ⇒ 变减",
    MoveKind.MINUS to "减数跨过等号 ⇒ 变加",
    MoveKind.MINUS_VAR to "x 前面是减号 —— 要搬两次",
    MoveKind.TIMES to "乘数跨过等号 ⇒ 变除",
    MoveKind.DIVIDE to "除数跨过等号 ⇒ 变乘",
    MoveKind.DIVIDE_VAR to "x 在除数位置 —— 要搬两次",
    MoveKind.SAME_SIDE to "没跨等号 ⇒ 符号不动",
)

/** x + a = b ⇒ x = b - a */
private fun buildPlus(random: Random): MoveProblem {
    val x = eqRndInclusive(2, 9, random)
    val a = eqRndInclusive(2, 9, random)
    val b = x + a
    val initial = EqState(listOf(xv(), nu(a, EqOp.ADD)), listOf(nu(b)))
    val act = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "把 +$a 搬到等号右边 —— 跨过等号，「+」就要变成「-」。",
    )
    return MoveProblem(
        kind = MoveKind.PLUS,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.PLUS),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.PLUS),
        initial = initial,
        actions = listOf(act),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(b), nu(a, EqOp.SUB))),
        x = x,
        answer = b - a,
        isSameSide = false,
        hint = "x + $a = $b　⇒　x = $b - $a = $x",
    )
}

/** x - a = b ⇒ x = b + a */
private fun buildMinus(random: Random): MoveProblem {
    val x = eqRndInclusive(11, 20, random)
    val a = eqRndInclusive(2, 9, random)
    val b = x - a
    val initial = EqState(listOf(xv(), nu(a, EqOp.SUB)), listOf(nu(b)))
    val act = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "要搬的是连在一起的「-$a」这一整块 —— 跨过等号，「-」变成「+」。",
    )
    return MoveProblem(
        kind = MoveKind.MINUS,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.MINUS),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.MINUS),
        initial = initial,
        actions = listOf(act),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(b), nu(a, EqOp.ADD))),
        x = x,
        answer = b + a,
        isSameSide = false,
        hint = "x - $a = $b　⇒　x = $b + $a = $x",
    )
}

/** x × a = b ⇒ x = b ÷ a */
private fun buildTimes(random: Random): MoveProblem {
    val x = eqRndInclusive(2, 9, random)
    val a = eqRndInclusive(2, 9, random)
    val b = x * a
    val initial = EqState(listOf(xv(), nu(a, EqOp.MUL)), listOf(nu(b)))
    val act = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "把 ×$a 搬到等号右边 —— 乘的因子跨过等号，就变成「除以 $a」。",
    )
    return MoveProblem(
        kind = MoveKind.TIMES,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.TIMES),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.TIMES),
        initial = initial,
        actions = listOf(act),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(b), nu(a, EqOp.DIV))),
        x = x,
        answer = b / a,
        isSameSide = false,
        hint = "x × $a = $b　⇒　x = $b ÷ $a = $x",
    )
}

/** x ÷ a = b ⇒ x = b × a */
private fun buildDivide(random: Random): MoveProblem {
    val a = eqRndInclusive(2, 9, random)
    val b = eqRndInclusive(2, 9, random)
    val x = a * b
    val initial = EqState(listOf(xv(), nu(a, EqOp.DIV)), listOf(nu(b)))
    val act = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "把 ÷$a 搬到等号右边 —— 除的因子跨过等号，就变成「乘以 $a」。",
    )
    return MoveProblem(
        kind = MoveKind.DIVIDE,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.DIVIDE),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.DIVIDE),
        initial = initial,
        actions = listOf(act),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(b), nu(a, EqOp.MUL))),
        x = x,
        answer = b * a,
        isSameSide = false,
        hint = "x ÷ $a = $b　⇒　x = $b × $a = $x",
    )
}

/** a - x = b ⇒ -x = b - a ⇒ x = a - b（搬两次 + 两边对调） */
private fun buildMinusVar(random: Random): MoveProblem {
    val a = eqRndInclusive(11, 20, random)
    val x = eqRndInclusive(2, 9, random)
    val b = a - x
    val initial = EqState(listOf(nu(a), xv(EqOp.SUB)), listOf(nu(b)))
    val s1 = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "「-x」是一整块 —— 先把它整个搬到等号右边：「-」跨过等号变成「+」，得到 $a = $b + x。",
    )
    val s2 = eqBuildAction(
        s1.after, EqSide.RIGHT, 0,
        "再把 $b 搬到等号左边：「+」跨过等号变成「-」，得到 $a - $b = x。",
    )
    return MoveProblem(
        kind = MoveKind.MINUS_VAR,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.MINUS_VAR),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.MINUS_VAR),
        initial = initial,
        actions = listOf(s1, s2),
        flipSides = true,
        final = EqState(listOf(xv()), listOf(nu(a), nu(b, EqOp.SUB))),
        x = x,
        answer = a - b,
        isSameSide = false,
        hint = "$a - x = $b　⇒　$a = $b + x　⇒　x = $a - $b = $x",
    )
}

/** a ÷ x = b ⇒ a = b × x ⇒ x = a ÷ b（搬两次 + 两边对调） */
private fun buildDivideVar(random: Random): MoveProblem {
    val b = eqRndInclusive(2, 9, random)
    val x = eqRndInclusive(2, 9, random)
    val a = b * x
    val initial = EqState(listOf(nu(a), xv(EqOp.DIV)), listOf(nu(b)))
    val s1 = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "「÷x」是一整块 —— 先把它整个搬到等号右边：「÷」跨过等号变成「×」，得到 $a = $b × x。",
    )
    val s2 = eqBuildAction(
        s1.after, EqSide.RIGHT, 0,
        "$b 在这里是「乘的因子」—— 把它搬到等号左边就变成「÷」，得到 $a ÷ $b = x。",
    )
    return MoveProblem(
        kind = MoveKind.DIVIDE_VAR,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.DIVIDE_VAR),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.DIVIDE_VAR),
        initial = initial,
        actions = listOf(s1, s2),
        flipSides = true,
        final = EqState(listOf(xv()), listOf(nu(a), nu(b, EqOp.DIV))),
        x = x,
        answer = a / b,
        isSameSide = false,
        hint = "$a ÷ x = $b　⇒　$a = $b × x　⇒　x = $a ÷ $b = $x",
    )
}

/** 反例：a + x = b ⇒ x + a = b —— 同一侧换位置，符号一点都不用动 */
private fun buildSameSide(random: Random): MoveProblem {
    val a = eqRndInclusive(2, 9, random)
    val x = eqRndInclusive(2, 9, random)
    val b = a + x
    val initial = EqState(listOf(nu(a), xv(EqOp.ADD)), listOf(nu(b)))
    return MoveProblem(
        kind = MoveKind.SAME_SIDE,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.SAME_SIDE),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.SAME_SIDE),
        initial = initial,
        actions = emptyList(),
        flipSides = false,
        final = EqState(listOf(xv(), nu(a, EqOp.ADD)), listOf(nu(b))),
        x = x,
        answer = x,
        isSameSide = true,
        hint = "$a + x = $b　⇒　x + $a = $b　（同一侧换位置，符号一点没变）",
    )
}

private fun buildProblem(kind: MoveKind, random: Random): MoveProblem = when (kind) {
    MoveKind.PLUS -> buildPlus(random)
    MoveKind.MINUS -> buildMinus(random)
    MoveKind.MINUS_VAR -> buildMinusVar(random)
    MoveKind.TIMES -> buildTimes(random)
    MoveKind.DIVIDE -> buildDivide(random)
    MoveKind.DIVIDE_VAR -> buildDivideVar(random)
    MoveKind.SAME_SIDE -> buildSameSide(random)
}

/** 加权抽题型（加减法最常见；同侧交换作为反例偶尔出现） */
private val POOL: List<MoveKind> = listOf(
    MoveKind.PLUS, MoveKind.PLUS, MoveKind.PLUS,
    MoveKind.MINUS, MoveKind.MINUS, MoveKind.MINUS,
    MoveKind.TIMES, MoveKind.TIMES,
    MoveKind.DIVIDE, MoveKind.DIVIDE,
    MoveKind.MINUS_VAR, MoveKind.DIVIDE_VAR,
    MoveKind.SAME_SIDE,
)

/** 出一题；不指定 [kind] 就按加权池随机 */
fun generateEqProblem(kind: MoveKind? = null, random: Random = Random.Default): MoveProblem =
    buildProblem(kind ?: POOL[eqRndInclusive(0, POOL.size - 1, random)], random)

// ────────────────────────────────────────────────────────────
// 随机练习：5 道，专练「跨过等号 ⇒ 符号变相反」
// ────────────────────────────────────────────────────────────

/**
 * 一道练习题。
 *
 * [movedLabel] 普通题不用给（默认显示「符号 + 数字」如「+8」）；
 * 两步型要显式给，因为搬的是 x 本身（「-x」「÷x」）。
 */
data class EqPracticeItem(
    /** 原式 */
    val before: String,
    /** 要搬走的项 */
    val sym: EqOp,
    val num: Int,
    /** 搬过去变成的符号 */
    val answer: EqOp,
    /** 完整结果 */
    val result: String,
    val why: String,
    /** 未知数的值 —— 练习反馈要显示它，单测也拿它代回原式验算 */
    val x: Int,
    val movedLabel: String? = null,
)

/** 随机练习的题型：前 4 种覆盖「加减互换 / 乘除互换」四条规律，后 2 种是「要搬两次」的易错型 */
enum class EqPracticeKind { PLUS, MINUS, TIMES, DIVIDE, MINUS_VAR, DIVIDE_VAR }

/** 4 种基本题型：每轮练习各来一道，保证四条变号规律全练到 */
private val DRILL_BASIC: List<EqPracticeKind> =
    listOf(EqPracticeKind.PLUS, EqPracticeKind.MINUS, EqPracticeKind.TIMES, EqPracticeKind.DIVIDE)

/** 全部题型池（第 5 道起从这里随机，含「要搬两次」的两步型） */
private val DRILL_POOL: List<EqPracticeKind> = DRILL_BASIC +
    listOf(EqPracticeKind.MINUS_VAR, EqPracticeKind.DIVIDE_VAR)

/** 造一道练习题：先定 x 与操作数 → 反推等式另一端，保证恒成立且答案是非负整数 */
private fun buildPracticeItem(kind: EqPracticeKind, random: Random): EqPracticeItem = when (kind) {
    EqPracticeKind.PLUS -> {
        val x = eqRndInclusive(2, 9, random)
        val a = eqRndInclusive(2, 9, random)
        val b = x + a
        EqPracticeItem(
            before = "x + $a = $b",
            sym = EqOp.ADD, num = a, answer = EqOp.SUB, x = x,
            result = "x = $b - $a = $x",
            why = "加号跨过等号 ⇒ 变成减号。",
        )
    }

    EqPracticeKind.MINUS -> {
        val x = eqRndInclusive(11, 20, random)
        val a = eqRndInclusive(2, 9, random)
        val b = x - a
        EqPracticeItem(
            before = "x - $a = $b",
            sym = EqOp.SUB, num = a, answer = EqOp.ADD, x = x,
            result = "x = $b + $a = $x",
            why = "减号跨过等号 ⇒ 变成加号。",
        )
    }

    EqPracticeKind.TIMES -> {
        val x = eqRndInclusive(2, 9, random)
        val a = eqRndInclusive(2, 9, random)
        val b = x * a
        EqPracticeItem(
            before = "x × $a = $b",
            sym = EqOp.MUL, num = a, answer = EqOp.DIV, x = x,
            result = "x = $b ÷ $a = $x",
            why = "乘号跨过等号 ⇒ 变成除号（因子到对面变倒数）。",
        )
    }

    EqPracticeKind.DIVIDE -> {
        val a = eqRndInclusive(2, 9, random)
        val b = eqRndInclusive(2, 9, random)
        val x = a * b
        EqPracticeItem(
            before = "x ÷ $a = $b",
            sym = EqOp.DIV, num = a, answer = EqOp.MUL, x = x,
            result = "x = $b × $a = $x",
            why = "除号跨过等号 ⇒ 变成乘号（因子到对面变倒数）。",
        )
    }

    EqPracticeKind.MINUS_VAR -> {
        val a = eqRndInclusive(11, 20, random)
        val x = eqRndInclusive(2, 9, random)
        val b = a - x
        EqPracticeItem(
            before = "$a - x = $b",
            sym = EqOp.SUB, num = x, answer = EqOp.ADD, x = x, movedLabel = "-x",
            result = "$a = $b + x　⇒　x = $a - $b = $x",
            why = "「-x」是一整块 —— 跨过等号，「-」变成「+」。",
        )
    }

    EqPracticeKind.DIVIDE_VAR -> {
        val b = eqRndInclusive(2, 9, random)
        val x = eqRndInclusive(2, 9, random)
        val a = b * x
        EqPracticeItem(
            before = "$a ÷ x = $b",
            sym = EqOp.DIV, num = x, answer = EqOp.MUL, x = x, movedLabel = "÷x",
            result = "$a = $b × x　⇒　x = $a ÷ $b = $x",
            why = "「÷x」是一整块 —— 跨过等号，「÷」变成「×」。",
        )
    }
}

/**
 * 生成一组随机练习题（默认 5 道）。
 *
 * 组合策略：**4 种基本变号规律各一道**（顺序打乱）＋ 其余从全池随机 ——
 * 只要 n >= 4，「加减互换 / 乘除互换」四条规律每轮都必被练到，第 5 道再带来变化
 * （可能是「要搬两次」的易错型）。
 *
 * 用 Fisher-Yates 打乱，避免每轮都是「+ - × ÷」同一个次序。
 */
fun generateEqDrill(n: Int = 5, random: Random = Random.Default): List<EqPracticeItem> {
    val kinds = DRILL_BASIC.toMutableList()
    while (kinds.size < n) kinds.add(DRILL_POOL[eqRndInclusive(0, DRILL_POOL.size - 1, random)])
    for (i in kinds.size - 1 downTo 1) {
        val j = eqRndInclusive(0, i, random)
        val tmp = kinds[i]
        kinds[i] = kinds[j]
        kinds[j] = tmp
    }
    return kinds.take(n).map { buildPracticeItem(it, random) }
}

// ────────────────────────────────────────────────────────────
// 静态教学资料（全部逐条验算过）
// ────────────────────────────────────────────────────────────

/** 口诀卡 */
data class EqRuleCard(val title: String, val lines: List<String>)

val EQ_RULES: List<EqRuleCard> = listOf(
    EqRuleCard(
        title = "一句话规律（背下来）",
        lines = listOf(
            "等式两边移动数，跨过等号才变号；",
            "加变减，减变加，乘变除，除变乘。",
            "等号同侧换顺序，符号一点不用调。",
        ),
    ),
    EqRuleCard(
        title = "加减法口诀",
        lines = listOf(
            "同一边，随便换，符号不变；跨过等号，加减互换。",
            "移的是「加减法里的项」⇒ 移项变号（+ 变 -，- 变 +）。",
            "要搬走的，是「整个数字连同它前面的符号」—— 例：搬的是「-6」，不是「-」也不是「6」。",
        ),
    ),
    EqRuleCard(
        title = "乘除法口诀",
        lines = listOf(
            "同一边，随便换，符号不变；跨过等号，乘除互换。",
            "移的是「乘除法里的因子」⇒ 移到对面变成倒数（× 变 ÷，÷ 变 ×）。",
            "x 在除数位置上（如 24 ÷ x = 4）时，先把「÷x」整块搬过去，再搬第二个数。",
        ),
    ),
)

/** 易错卡 */
data class EqMistakeCase(
    val title: String,
    val wrong: String,
    val right: String,
    val why: String,
    val tip: String,
)

val EQ_MISTAKE_CASES: List<EqMistakeCase> = listOf(
    EqMistakeCase(
        title = "没跨等号，却也把符号改了",
        wrong = "2 + x = 8　⇒　x - 2 = 8",
        right = "2 + x = 8　⇒　x + 2 = 8",
        why = "2 只是从等号左边挪到了 x 的后面，它压根没跨过等号 —— 同一边换位置，符号一点不用动。",
        tip = "只有跨过等号，才变号。",
    ),
    EqMistakeCase(
        title = "移项时把「前面的符号」弄丢了",
        wrong = "x - 6 = 10　⇒　x = 10 - 6",
        right = "x - 6 = 10　⇒　x = 10 + 6",
        why = "要搬走的是连在一起的「-6」这一整块。6 前面是减号，跨过等号就得变成加号；只搬「6」就等于把那个减号丢了。",
        tip = "移项是「整个数字连同它前面的符号」一起搬。",
    ),
    EqMistakeCase(
        title = "把 x 前面的减号当成了 x 自己的",
        wrong = "10 - x = 3　⇒　x = 3 - 10",
        right = "10 - x = 3　⇒　x = 10 - 3",
        why = "x 本身没有「负号」，那个减号是它「前面的运算符」，管的是「10 减掉 x」。把 -x 整块搬过去、两边再同时变号，才对。",
        tip = "负号不是数字自带的，是它前面的运算符。",
    ),
)

/** 教材给的固定对比练习（四种符号变化并排看） */
val EQ_PRACTICE: List<EqPracticeItem> = listOf(
    EqPracticeItem(
        before = "x + 8 = 14",
        sym = EqOp.ADD, num = 8, answer = EqOp.SUB, x = 6,
        result = "x = 14 - 8 = 6",
        why = "加号跨过等号 ⇒ 变成减号。",
    ),
    EqPracticeItem(
        before = "x - 8 = 14",
        sym = EqOp.SUB, num = 8, answer = EqOp.ADD, x = 22,
        result = "x = 14 + 8 = 22",
        why = "减号跨过等号 ⇒ 变成加号。",
    ),
    EqPracticeItem(
        before = "x × 8 = 16",
        sym = EqOp.MUL, num = 8, answer = EqOp.DIV, x = 2,
        result = "x = 16 ÷ 8 = 2",
        why = "乘号跨过等号 ⇒ 变成除号（因子到对面变倒数）。",
    ),
    EqPracticeItem(
        before = "x ÷ 8 = 16",
        sym = EqOp.DIV, num = 8, answer = EqOp.MUL, x = 128,
        result = "x = 16 × 8 = 128",
        why = "除号跨过等号 ⇒ 变成乘号（因子到对面变倒数）。",
    ),
)
