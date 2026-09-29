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
 * ── 四种动作（[MoveAction.type]）────────────────────────────
 *   MOVE    跨过等号搬一项 —— **符号必须翻转**（这是本页的主角）
 *   SWAP    同一侧交换两项位置 —— **符号一点不动**
 *   COMBINE 同一侧合并两个同类项（3x 和 -2x 得 x）—— 求值不变，只是写法变短
 *   FLIP    等式两边整体对调（b = x + a 即 x + a = b）—— 等式对称性
 *
 * 为什么需要 SWAP：**首项不写符号**是个纯显示约定，可学生看不见符号就没法判断
 *   「跨过去该变成什么」。所以搬首项之前，先在**同侧**把它换到后面 —— 符号一旦
 *   露出来（`5 + x` 变成 `x + 5`），再跨线变号就一目了然。
 *   注意：同侧换位只对 + 和 × 合法（交换律）。`a ÷ x` 不等于 `x ÷ a`，所以中间是 ÷ 时禁止 swap。
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

/** 等式一侧里的一项：写在它**前面**的符号 + 值。
 *  [value] 可以是 "x" / "5x" / "12" —— 系数紧贴着写（`5x` 表示 5 个 x） */
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

/** 一步动作的类型 —— 决定动画怎么演（见文件头「四种动作」） */
enum class EqActionType {
    /** 跨过等号搬一项，符号翻转（有落位槽、走「幽灵飞越」） */
    MOVE,

    /** 同一侧交换两项位置，符号一点不动（只在一侧内部滑动） */
    SWAP,

    /** 同一侧合并同类项（3x 与 -2x 得 x），值不变只是写法变短 */
    COMBINE,

    /** 等式两边整体对调（b = x + a 即 x + a = b） */
    FLIP,
}

/** 题型（决定演示哪条规律） */
enum class MoveKind {
    /** x + a = b ⇒ x = b - a（加数跨过去变减） */
    PLUS,

    /** x - a = b ⇒ x = b + a（减数跨过去变加） */
    MINUS,

    /** x × a = b ⇒ x = b ÷ a（乘的因子跨过去变除） */
    TIMES,

    /** x ÷ a = b ⇒ x = b × a（除的因子跨过去变乘） */
    DIVIDE,

    /** a - x = b ⇒ a = b + x ⇒ x = a - b（要搬两次，第二步先显形） */
    MINUS_VAR,

    /** a ÷ x = b ⇒ a = b × x ⇒ x = a ÷ b（要搬两次，第二步先显形） */
    DIVIDE_VAR,

    /** a + x = b ⇒ 先同侧换位把 a 换到后面显形，再跨线 ⇒ x = b - a */
    REVEAL_PLUS,

    /** a × x = b ⇒ 先同侧换位显形，再跨线 ⇒ x = b ÷ a */
    REVEAL_TIMES,

    /** b = x + a（x 在等号右边）⇒ 两边对调，再跨线 ⇒ x = b - a */
    X_RIGHT,

    /** x + a + c = b（同一边好几个数）⇒ 一个一个有顺序地搬 */
    THREE_TERMS,

    /** kx = mx + c（两边都有 x）⇒ 搬到一起再合并 */
    BOTH_SIDES,

    /** kx + a = mx + c（多项多步）⇒ 搬常数、移 x、合并 */
    MULTI_STEP,

    /** 反例：a + x = b ⇒ x + a = b（同侧换位置，符号不动） */
    SAME_SIDE,
}

/** 题型分组 —— 页面按这个分四组渲染，别把 13 个按钮平铺成一排 */
data class EqKindGroup(val title: String, val kinds: List<MoveKind>)

val EQ_KIND_GROUPS: List<EqKindGroup> = listOf(
    EqKindGroup(
        "基础 · 跨线变号",
        listOf(MoveKind.PLUS, MoveKind.MINUS, MoveKind.TIMES, MoveKind.DIVIDE),
    ),
    EqKindGroup(
        "进阶 · 要搬两次",
        listOf(MoveKind.MINUS_VAR, MoveKind.DIVIDE_VAR, MoveKind.REVEAL_PLUS, MoveKind.REVEAL_TIMES),
    ),
    EqKindGroup(
        "进阶 · 结构变化",
        listOf(MoveKind.X_RIGHT, MoveKind.THREE_TERMS, MoveKind.BOTH_SIDES, MoveKind.MULTI_STEP),
    ),
    EqKindGroup("反例 · 同侧不变号", listOf(MoveKind.SAME_SIDE)),
)

/**
 * 一次动作。字段含义随 [type] 变化，别混用：
 *   · MOVE    [index] = 被搬走项的下标 · [srcOp]/[fromOp]/[toOp] = 原写符号/等效符号/跨线后符号
 *   · SWAP    [index]/[index2] = 交换的两项下标（相邻）· [fromOp] 与 [toOp] 相同（不变号）
 *   · COMBINE [index] = 保留的位置 · [index2] = 被并入的项 · [value] 为被并入项的值 · [combined] 为合并后的文本
 *   · FLIP    [index]/[index2] 无意义 · before/after 就是左右互换
 */
data class MoveAction(
    val type: EqActionType,
    val from: EqSide,
    val index: Int,
    /** SWAP 的另一项下标 / COMBINE 被并入项的下标 */
    val index2: Int? = null,
    /** 被搬的项原本**写出来**的符号（首项为 null —— 屏幕上它前面真的什么都没写） */
    val srcOp: EqOp?,
    /** MOVE：被搬项在式子里**等效**的运算符（首项 / 因数也算得出来）—— 决定它跨过去会变成什么。
     *  SWAP：左侧那一项的等效符号（换位前后一致）。COMBINE / FLIP：无意义，恒为 ADD。 */
    val fromOp: EqOp,
    /** MOVE：跨过等号后变成的符号。SWAP / COMBINE / FLIP：与 [fromOp] 相同。 */
    val toOp: EqOp,
    val value: String,
    val isVar: Boolean,
    /** COMBINE 专用：合并后的显示文本（如 "8" / "2x"） */
    val combined: String? = null,
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
 *     [5x] 的 5x ⇒ +（`5x` 是**一个**加数，不是「5 乘 x」两步 —— 系数剥离是另一回事）
 */
fun eqEffectiveOp(side: EqSideList, i: Int): EqOp {
    val t = side[i]
    if (t.op == EqOp.SUB) return EqOp.SUB
    if (t.op == EqOp.MUL || t.op == EqOp.DIV) return t.op
    val next = side.getOrNull(i + 1)
    if (next != null && (next.op == EqOp.MUL || next.op == EqOp.DIV)) return EqOp.MUL
    return EqOp.ADD
}

/** 项的系数：x ⇒ 1，5x ⇒ 5，12 ⇒ 12 */
fun eqCoefOf(t: EqTerm): Int {
    if (!t.isVar) return t.value.toIntOrNull() ?: 0
    val n = t.value.removeSuffix("x").toIntOrNull() ?: 0
    return if (n != 0) n else 1
}

/** 带符号的系数（前面写 - 的就是负）—— 合并同类项时直接加起来 */
fun eqSignedCoef(t: EqTerm): Int = (if (t.op == EqOp.SUB) -1 else 1) * eqCoefOf(t)

/** 代入 x 后该项的**纯数值**（`5x` 且 x=3 ⇒ 15） */
fun eqTermValueAt(t: EqTerm, xVal: Int): Int = if (t.isVar) eqCoefOf(t) * xVal else eqCoefOf(t)

/** 按系数生成 x 项的显示文本：1 ⇒ "x"，5 ⇒ "5x" */
fun eqVarText(coef: Int): String = if (coef == 1) "x" else "${coef}x"

/** 规范化首项：首项只可能在「-」时写符号，+ / × / ÷ 一律不写 */
private fun eqNormFirst(side: EqSideList): EqSideList {
    if (side.isEmpty()) return side
    val h = side.first()
    return listOf(h.copy(op = if (h.op == EqOp.SUB) EqOp.SUB else null)) + side.drop(1)
}

/** 移走第 i 项之后，把新的首项规范化 */
private fun eqRemoveTerm(side: EqSideList, i: Int): EqSideList {
    val rest = side.filterIndexed { k, _ -> k != i }
    if (rest.isEmpty()) return emptyList()
    val h = rest.first()
    return listOf(h.copy(op = if (h.op == EqOp.SUB) EqOp.SUB else null)) + rest.drop(1)
}

/** 往一侧的末尾追加一项（搬到对面后排在最后） */
private fun eqAppendTerm(side: EqSideList, op: EqOp, value: String, isVar: Boolean): EqSideList =
    side + EqTerm(op, value, isVar)

private fun eqPutSide(st: EqState, from: EqSide, side: EqSideList): EqState =
    if (from == EqSide.LEFT) EqState(side, st.right) else EqState(st.left, side)

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
    return MoveAction(
        type = EqActionType.MOVE,
        from = from,
        index = index,
        srcOp = t.op,
        fromOp = fromOp,
        toOp = toOp,
        value = t.value,
        isVar = t.isVar,
        before = st,
        after = after,
        note = note,
    )
}

/**
 * 构造一次「同侧换位」：把第 [i] 项与它**右边相邻**的第 i+1 项交换，符号一点不动。
 *
 * 交换后每项写出的符号 = 它**自己**的等效符号，再套一遍「首项不写符号」的约定。
 *   `5 + x` 变成 `x + 5`   ·   `3 × x` 变成 `x × 3`   ·   `15 - x` 变成 `-x + 15`
 *   `2x + 5` 变成 `5 + 2x`（右边反向同理）
 *
 * 中间是 **÷** 时**禁止**调用 —— `a ÷ x` 不等于 `x ÷ a`，换位不成立（直接抛错，别静默出错）。
 */
fun eqBuildSwap(st: EqState, from: EqSide, i: Int, note: String): MoveAction {
    val side: EqSideList = if (from == EqSide.LEFT) st.left else st.right
    val j = i + 1
    require(i >= 0 && j < side.size) { "swap: 下标越界 $i/$j（该侧只有 ${side.size} 项）" }
    val a = side[i]
    val b = side[j]
    require(b.op != EqOp.DIV) { "swap: 中间是 ÷，同侧换位不成立" }
    require(b.op != null) { "swap: 右边那项没有写出来的符号，无法换位" }
    val aOp = eqEffectiveOp(side, i)
    val next = side.toMutableList()
    next[i] = EqTerm(op = if (b.op == EqOp.SUB) EqOp.SUB else null, value = b.value, isVar = b.isVar)
    next[j] = EqTerm(op = aOp, value = a.value, isVar = a.isVar)
    return MoveAction(
        type = EqActionType.SWAP,
        from = from,
        index = i,
        index2 = j,
        srcOp = a.op,
        fromOp = aOp,
        toOp = aOp,
        value = a.value,
        isVar = a.isVar,
        before = st,
        after = eqPutSide(st, from, eqNormFirst(next)),
        note = note,
    )
}

/**
 * 构造一次「合并同类项」：把第 [i] 项与它**右边相邻**的第 i+1 项（必须同类：都是 x、或都是数）合并。
 *   3x 与 -2x 得 x      ·    3 与 5 得 8
 * [MoveAction.value] 记被并入那一项的值，[MoveAction.combined] 记合并后的文本。
 */
fun eqBuildCombine(st: EqState, from: EqSide, i: Int, note: String): MoveAction {
    val side: EqSideList = if (from == EqSide.LEFT) st.left else st.right
    val j = i + 1
    require(j < side.size) { "combine: 下标越界 $i/$j" }
    val a = side[i]
    val b = side[j]
    require(a.isVar == b.isVar) { "combine: 一个是 x 一个是数，不是同类项，不能合并" }
    val sum = eqSignedCoef(a) + eqSignedCoef(b)
    val combined = if (a.isVar) eqVarText(sum) else sum.toString()
    val next = side.toMutableList()
    next[i] = EqTerm(op = a.op, value = combined, isVar = a.isVar)
    next.removeAt(j)
    return MoveAction(
        type = EqActionType.COMBINE,
        from = from,
        index = i,
        index2 = j,
        srcOp = b.op,
        fromOp = EqOp.ADD,
        toOp = EqOp.ADD,
        value = b.value,
        isVar = b.isVar,
        combined = combined,
        before = st,
        after = eqPutSide(st, from, eqNormFirst(next)),
        note = note,
    )
}

/** 构造一次「两边对调」（等式对称性）：b = x + a 就是 x + a = b */
fun eqBuildFlip(st: EqState, note: String): MoveAction = MoveAction(
    type = EqActionType.FLIP,
    from = EqSide.LEFT,
    index = 0,
    srcOp = null,
    fromOp = EqOp.ADD,
    toOp = EqOp.ADD,
    value = "",
    isVar = false,
    before = st,
    after = EqState(eqNormFirst(st.right), eqNormFirst(st.left)),
    note = note,
)

// ────────────────────────────────────────────────────────────
// 文本
// ────────────────────────────────────────────────────────────

/** 一侧 → 可读文本；给了 [xVal] 就把未知数替换成具体数字（验算用，`5x` 且 x=3 ⇒ "15"） */
fun eqSideToText(side: EqSideList, xVal: Int? = null): String =
    side.mapIndexed { i, t ->
        val v = if (t.isVar && xVal != null) eqTermValueAt(t, xVal).toString() else t.value
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

/** k 个 x（k=1 就写成 "x"） */
private fun kv(k: Int, op: EqOp? = null): EqTerm = EqTerm(op, eqVarText(k), true)

val EQ_KIND_LABEL: Map<MoveKind, String> = mapOf(
    MoveKind.PLUS to "x + a = b",
    MoveKind.MINUS to "x - a = b",
    MoveKind.TIMES to "x × a = b",
    MoveKind.DIVIDE to "x ÷ a = b",
    MoveKind.MINUS_VAR to "a - x = b",
    MoveKind.DIVIDE_VAR to "a ÷ x = b",
    MoveKind.REVEAL_PLUS to "a + x = b",
    MoveKind.REVEAL_TIMES to "a × x = b",
    MoveKind.X_RIGHT to "b = x + a",
    MoveKind.THREE_TERMS to "x + a + c = b",
    MoveKind.BOTH_SIDES to "3x = 2x + 5",
    MoveKind.MULTI_STEP to "2x + 3 = x + 8",
    MoveKind.SAME_SIDE to "同侧交换 · 不变号",
)

val EQ_KIND_TIP: Map<MoveKind, String> = mapOf(
    MoveKind.PLUS to "加数跨过等号 ⇒ 变减",
    MoveKind.MINUS to "减数跨过等号 ⇒ 变加",
    MoveKind.TIMES to "乘数跨过等号 ⇒ 变除",
    MoveKind.DIVIDE to "除数跨过等号 ⇒ 变乘",
    MoveKind.MINUS_VAR to "x 前面是减号 —— 要搬两次",
    MoveKind.DIVIDE_VAR to "x 在除数位置 —— 要搬两次",
    MoveKind.REVEAL_PLUS to "最前面的数没写符号 ⇒ 先换位显形，再跨线",
    MoveKind.REVEAL_TIMES to "最前面的因数是隐藏的「×」⇒ 先换位显形，再跨线",
    MoveKind.X_RIGHT to "x 在等号右边 ⇒ 两边对调回来，再搬",
    MoveKind.THREE_TERMS to "同一边有好几个数 ⇒ 一个一个有顺序地搬",
    MoveKind.BOTH_SIDES to "两边都有 x ⇒ 先把 x 都搬到一边，再合并",
    MoveKind.MULTI_STEP to "多项多步 ⇒ 先搬常数，再移 x，最后合并",
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

/**
 * a - x = b ⇒ -x = b - a ⇒ x = a - b（搬两次 + 两边对调）。
 * 第二步搬的是**右侧首项** b（前面不写符号）⇒ 先同侧换位显形。
 */
private fun buildMinusVar(random: Random): MoveProblem {
    val a = eqRndInclusive(11, 20, random)
    val x = eqRndInclusive(2, 9, random)
    val b = a - x
    val initial = EqState(listOf(nu(a), xv(EqOp.SUB)), listOf(nu(b)))
    val s1 = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "「-x」是一整块 —— 先把它整个搬到等号右边：「-」跨过等号变成「+」，得到 $a = $b + x。",
    )
    val swap = eqBuildSwap(
        s1.after, EqSide.RIGHT, 0,
        "$b 站在右边最前面，前面不写符号 —— 先把它和 x 换个位置：同一边换位置符号不变，得到 $a = x + $b。",
    )
    val s2 = eqBuildAction(
        swap.after, EqSide.RIGHT, 1,
        "现在看得见它是「+$b」了 —— 跨过等号搬到左边，「+」变成「-」，得到 $a - $b = x。",
    )
    return MoveProblem(
        kind = MoveKind.MINUS_VAR,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.MINUS_VAR),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.MINUS_VAR),
        initial = initial,
        actions = listOf(s1, swap, s2),
        flipSides = true,
        final = EqState(listOf(xv()), listOf(nu(a), nu(b, EqOp.SUB))),
        x = x,
        answer = a - b,
        isSameSide = false,
        hint = "$a - x = $b　⇒　$a = $b + x　⇒　x = $a - $b = $x",
    )
}

/**
 * a ÷ x = b ⇒ a = b × x ⇒ x = a ÷ b（搬两次 + 两边对调）。
 * 第二步搬的同样是**右侧首项** b ⇒ 先同侧换位显形。
 */
private fun buildDivideVar(random: Random): MoveProblem {
    val b = eqRndInclusive(2, 9, random)
    val x = eqRndInclusive(2, 9, random)
    val a = b * x
    val initial = EqState(listOf(nu(a), xv(EqOp.DIV)), listOf(nu(b)))
    val s1 = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "「÷x」是一整块 —— 先把它整个搬到等号右边：「÷」跨过等号变成「×」，得到 $a = $b × x。",
    )
    val swap = eqBuildSwap(
        s1.after, EqSide.RIGHT, 0,
        "$b 站在右边最前面，前面不写符号 —— 先把它和 x 换个位置：同一边换位置符号不变，得到 $a = x × $b。",
    )
    val s2 = eqBuildAction(
        swap.after, EqSide.RIGHT, 1,
        "$b 在这里是「乘的因子」—— 跨过等号搬到左边，「×」变成「÷」，得到 $a ÷ $b = x。",
    )
    return MoveProblem(
        kind = MoveKind.DIVIDE_VAR,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.DIVIDE_VAR),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.DIVIDE_VAR),
        initial = initial,
        actions = listOf(s1, swap, s2),
        flipSides = true,
        final = EqState(listOf(xv()), listOf(nu(a), nu(b, EqOp.DIV))),
        x = x,
        answer = a / b,
        isSameSide = false,
        hint = "$a ÷ x = $b　⇒　$a = $b × x　⇒　x = $a ÷ $b = $x",
    )
}

/**
 * a + x = b ⇒ ① 同侧换位把 a 换到后面（符号「+」这才露出来）② 跨线变号 ⇒ x = b - a。
 * 这是「首项不写符号」的招牌演示：不先换位，学生看不见 a 前面有个「+」。
 */
private fun buildRevealPlus(random: Random): MoveProblem {
    val a = eqRndInclusive(2, 9, random)
    val x = eqRndInclusive(2, 9, random)
    val b = a + x
    val initial = EqState(listOf(nu(a), xv(EqOp.ADD)), listOf(nu(b)))
    val swap = eqBuildSwap(
        initial, EqSide.LEFT, 0,
        "$a 站在最前面，前面不写符号 —— 先把它和 x 换个位置：同一边换位置，符号一点不用动，得到 x + $a = $b。",
    )
    val act = eqBuildAction(
        swap.after, EqSide.LEFT, 1,
        "现在能看见它是「+$a」了 —— 跨过等号，「+」变成「-」，得到 x = $b - $a。",
    )
    return MoveProblem(
        kind = MoveKind.REVEAL_PLUS,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.REVEAL_PLUS),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.REVEAL_PLUS),
        initial = initial,
        actions = listOf(swap, act),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(b), nu(a, EqOp.SUB))),
        x = x,
        answer = b - a,
        isSameSide = false,
        hint = "$a + x = $b　⇒　x + $a = $b　⇒　x = $b - $a = $x",
    )
}

/** a × x = b ⇒ ① 同侧换位把 a 换到后面（隐藏的「×」这才露出来）② 跨线变号 ⇒ x = b ÷ a */
private fun buildRevealTimes(random: Random): MoveProblem {
    val a = eqRndInclusive(2, 9, random)
    val x = eqRndInclusive(2, 9, random)
    val b = a * x
    val initial = EqState(listOf(nu(a), xv(EqOp.MUL)), listOf(nu(b)))
    val swap = eqBuildSwap(
        initial, EqSide.LEFT, 0,
        "$a 站在最前面，前面不写符号 —— 先把它和 x 换个位置：同一边换位置，符号一点不用动，得到 x × $a = $b。",
    )
    val act = eqBuildAction(
        swap.after, EqSide.LEFT, 1,
        "现在能看见它是「×$a」了 —— 跨过等号，「×」变成「÷」，得到 x = $b ÷ $a。",
    )
    return MoveProblem(
        kind = MoveKind.REVEAL_TIMES,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.REVEAL_TIMES),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.REVEAL_TIMES),
        initial = initial,
        actions = listOf(swap, act),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(b), nu(a, EqOp.DIV))),
        x = x,
        answer = b / a,
        isSameSide = false,
        hint = "$a × x = $b　⇒　x × $a = $b　⇒　x = $b ÷ $a = $x",
    )
}

/** b = x + a（x 在等号右边）⇒ ① 两边对调 ② 跨线变号 ⇒ x = b - a */
private fun buildXRight(random: Random): MoveProblem {
    val a = eqRndInclusive(2, 9, random)
    val x = eqRndInclusive(2, 9, random)
    val b = x + a
    val initial = EqState(listOf(nu(b)), listOf(xv(), nu(a, EqOp.ADD)))
    val flip = eqBuildFlip(
        initial,
        "x 跑到等号右边去了 —— 等式两边可以整个对调：$b = x + $a 就是 x + $a = $b。",
    )
    val act = eqBuildAction(
        flip.after, EqSide.LEFT, 1,
        "回到熟悉的写法了 —— 把 +$a 跨过等号搬走，「+」变成「-」，得到 x = $b - $a。",
    )
    return MoveProblem(
        kind = MoveKind.X_RIGHT,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.X_RIGHT),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.X_RIGHT),
        initial = initial,
        actions = listOf(flip, act),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(b), nu(a, EqOp.SUB))),
        x = x,
        answer = b - a,
        isSameSide = false,
        hint = "$b = x + $a　⇒　x + $a = $b　⇒　x = $b - $a = $x",
    )
}

/**
 * x + a + c = b ⇒ 同一边好几个数，一个一个有顺序地搬两次（每项都写了符号，不用显形）。
 * ⚠️ 三项相加最容易冲出「20 以内加减法」这条线（9+9+9=27）—— 参数刻意收到 x <= 8、a/c <= 6 ⇒ b <= 20
 */
private fun buildThreeTerms(random: Random): MoveProblem {
    val x = eqRndInclusive(2, 8, random)
    val a = eqRndInclusive(2, 6, random)
    val c = eqRndInclusive(2, 6, random)
    val b = x + a + c
    val initial = EqState(listOf(xv(), nu(a, EqOp.ADD), nu(c, EqOp.ADD)), listOf(nu(b)))
    val s1 = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "同一边有好几个数，一个一个来 —— 先把 +$a 搬过去，「+」变成「-」，得到 x + $c = $b - $a。",
    )
    val s2 = eqBuildAction(
        s1.after, EqSide.LEFT, 1,
        "再把 +$c 搬过去 —— 同样「+」变成「-」，得到 x = $b - $a - $c。",
    )
    return MoveProblem(
        kind = MoveKind.THREE_TERMS,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.THREE_TERMS),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.THREE_TERMS),
        initial = initial,
        actions = listOf(s1, s2),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(b), nu(a, EqOp.SUB), nu(c, EqOp.SUB))),
        x = x,
        answer = b - a - c,
        isSameSide = false,
        hint = "x + $a + $c = $b　⇒　x = $b - $a - $c = $x",
    )
}

/**
 * kx = mx + c（两边都有 x，且 k - m = 1）⇒ ①右侧换位显形 ②把 mx 搬到左边 ③合并同类项 ⇒ x = c。
 * 刻意让 k - m = 1：合并后系数正好是 1 ⇒ 不需要再做「系数剥离」，把焦点留在「搬到一起 + 合并」。
 */
private fun buildBothSides(random: Random): MoveProblem {
    val k = eqRndInclusive(2, 9, random)
    val m = k - 1
    val x = eqRndInclusive(2, 9, random)
    val c = x
    val kx = eqVarText(k)
    val mx = eqVarText(m)
    val initial = EqState(listOf(kv(k)), listOf(kv(m), nu(c, EqOp.ADD)))
    val swap = eqBuildSwap(
        initial, EqSide.RIGHT, 0,
        "$mx 站在右边最前面，前面不写符号 —— 先把它和 $c 换个位置：同一边换位置符号不变，得到 $kx = $c + $mx。",
    )
    val act = eqBuildAction(
        swap.after, EqSide.RIGHT, 1,
        "现在看得见它是「+$mx」了 —— 把 x 项都搬到等号左边：「+」变成「-」，得到 $kx - $mx = $c。",
    )
    val comb = eqBuildCombine(
        act.after, EqSide.LEFT, 0,
        "$kx 和 $mx 都带 x，是一类 —— 合起来：$k - $m 个 x，也就是 x。",
    )
    return MoveProblem(
        kind = MoveKind.BOTH_SIDES,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.BOTH_SIDES),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.BOTH_SIDES),
        initial = initial,
        actions = listOf(swap, act, comb),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(c))),
        x = x,
        answer = c,
        isSameSide = false,
        hint = "$kx = $mx + $c　⇒　$kx - $mx = $c　⇒　x = $c",
    )
}

/** kx + a = mx + c（多项多步，且 k - m = 1）⇒ ①搬常数 ②右侧换位显形 ③把 mx 搬到左边 ④合并 */
private fun buildMultiStep(random: Random): MoveProblem {
    val k = eqRndInclusive(2, 9, random)
    val m = k - 1
    val x = eqRndInclusive(2, 9, random)
    val a = eqRndInclusive(2, 9, random)
    val c = x + a
    val kx = eqVarText(k)
    val mx = eqVarText(m)
    val initial = EqState(listOf(kv(k), nu(a, EqOp.ADD)), listOf(kv(m), nu(c, EqOp.ADD)))
    val s1 = eqBuildAction(
        initial, EqSide.LEFT, 1,
        "先把左边的常数 +$a 搬到右边 —— 「+」变成「-」，得到 $kx = $mx + $c - $a。",
    )
    val swap = eqBuildSwap(
        s1.after, EqSide.RIGHT, 0,
        "$mx 在右边最前面，前面不写符号 —— 先把它和 $c 换个位置：符号不变，得到 $kx = $c + $mx - $a。",
    )
    val s2 = eqBuildAction(
        swap.after, EqSide.RIGHT, 1,
        "把 $mx 也搬到左边来 —— 「+」变成「-」，得到 $kx - $mx = $c - $a。",
    )
    val comb = eqBuildCombine(
        s2.after, EqSide.LEFT, 0,
        "$kx 和 $mx 合并：$k - $m 个 x，也就是 x。",
    )
    return MoveProblem(
        kind = MoveKind.MULTI_STEP,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.MULTI_STEP),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.MULTI_STEP),
        initial = initial,
        actions = listOf(s1, swap, s2, comb),
        flipSides = false,
        final = EqState(listOf(xv()), listOf(nu(c), nu(a, EqOp.SUB))),
        x = x,
        answer = c - a,
        isSameSide = false,
        hint = "$kx + $a = $mx + $c　⇒　$kx - $mx = $c - $a　⇒　x = $c - $a = $x",
    )
}

/** 反例：a + x = b ⇒ x + a = b —— 同一侧换位置，符号一点都不用动 */
private fun buildSameSide(random: Random): MoveProblem {
    val a = eqRndInclusive(2, 9, random)
    val x = eqRndInclusive(2, 9, random)
    val b = a + x
    val initial = EqState(listOf(nu(a), xv(EqOp.ADD)), listOf(nu(b)))
    val swap = eqBuildSwap(
        initial, EqSide.LEFT, 0,
        "$a 没跨过等号，只是和 x 换了位置 —— 同一边换位置，符号一点不用调。",
    )
    return MoveProblem(
        kind = MoveKind.SAME_SIDE,
        kindLabel = EQ_KIND_LABEL.getValue(MoveKind.SAME_SIDE),
        kindTip = EQ_KIND_TIP.getValue(MoveKind.SAME_SIDE),
        initial = initial,
        actions = listOf(swap),
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
    MoveKind.TIMES -> buildTimes(random)
    MoveKind.DIVIDE -> buildDivide(random)
    MoveKind.MINUS_VAR -> buildMinusVar(random)
    MoveKind.DIVIDE_VAR -> buildDivideVar(random)
    MoveKind.REVEAL_PLUS -> buildRevealPlus(random)
    MoveKind.REVEAL_TIMES -> buildRevealTimes(random)
    MoveKind.X_RIGHT -> buildXRight(random)
    MoveKind.THREE_TERMS -> buildThreeTerms(random)
    MoveKind.BOTH_SIDES -> buildBothSides(random)
    MoveKind.MULTI_STEP -> buildMultiStep(random)
    MoveKind.SAME_SIDE -> buildSameSide(random)
}

/** 加权抽题型（加减法最常见；同侧交换作为反例偶尔出现） */
private val POOL: List<MoveKind> = listOf(
    MoveKind.PLUS, MoveKind.PLUS, MoveKind.PLUS,
    MoveKind.MINUS, MoveKind.MINUS, MoveKind.MINUS,
    MoveKind.TIMES, MoveKind.TIMES,
    MoveKind.DIVIDE, MoveKind.DIVIDE,
    MoveKind.MINUS_VAR, MoveKind.DIVIDE_VAR,
    MoveKind.REVEAL_PLUS, MoveKind.REVEAL_TIMES,
    MoveKind.X_RIGHT, MoveKind.THREE_TERMS,
    MoveKind.BOTH_SIDES, MoveKind.MULTI_STEP,
    MoveKind.SAME_SIDE,
)

/** 出一题；不指定 [kind] 就按加权池随机 */
fun generateEqProblem(kind: MoveKind? = null, random: Random = Random.Default): MoveProblem =
    buildProblem(kind ?: POOL[eqRndInclusive(0, POOL.size - 1, random)], random)

// ────────────────────────────────────────────────────────────
// 分步解方程练习：学生跟着动画一步一填，直到把 x 解出来
// ────────────────────────────────────────────────────────────
//
// 与 web 侧 web/src/lib/equationMove.ts 的 SolveStep / SolveItem **逐行对照**，行为必须一致。
//
// 设计要点（改动前先看 web 那边）：
//   · 每道题都被拆成「一步一个问题」：学生答出这一步，卡片就**在卡内**把这一步的动画演给他看，
//     再填下一步，一路填到把 x 解出来。
//   · 步骤 = 每个动作一步 ＋（x 落在等号右边时）补一次「两边对调」 ＋ 最后「算出来」一步。
//   · ⚠️ 同侧反例题（[MoveKind.SAME_SIDE]）**没有**「算出来」那一步 —— 它只演示「同侧换位不变号」，
//     压根没打算求解，硬凑一步会把「这一步不用解」这个教学点抹掉。
//   · 数字选项里**必定含着「忘变号」会算出的那个数** —— 那正是这一页要防的错。
//   · 每一条数据都**从 [buildProblem] 生成的 [MoveProblem] 派生**，绝不自己另算一遍数学 ——
//     否则迟早会出现「练习说跨线变号、主舞台演的却是同侧换位」这种自相矛盾。

/** 跨线后符号变成什么；[Same] 表示同侧换位、符号不变 */
sealed class EqPracticeAnswer {
    data class Op(val op: EqOp) : EqPracticeAnswer()
    data object Same : EqPracticeAnswer()
}

/** 问法：CROSS = 跨过等号变成什么（默认）；SAME_SIDE = 同侧换位，符号怎么变 */
enum class EqPracticeAsk { CROSS, SAME_SIDE }

/**
 * 一道固定对比练习题（教材给的那四张）。
 *
 * [movedLabel] 普通题不用给（默认显示「符号 + 数字」如「+8」）；
 * 两步型要显式给，因为搬的是 x 本身（「-x」「÷x」）。
 */
data class EqPracticeItem(
    /** 原式 */
    val before: String,
    /** 要搬走（或换位）的那一项的符号 */
    val sym: EqOp,
    val num: Int,
    /** 跨线后变成的符号；同侧换位型是 [EqPracticeAnswer.Same]（不变号） */
    val answer: EqPracticeAnswer,
    /** 完整结果 */
    val result: String,
    val why: String,
    /** 未知数的值 —— 练习反馈要显示它，单测也拿它代回原式验算 */
    val x: Int,
    val movedLabel: String? = null,
    /** 问法：CROSS = 跨过等号变成什么（默认）；SAME_SIDE = 同侧换位，符号怎么变 */
    val ask: EqPracticeAsk? = null,
)

/** 分步练习里一步的类型 —— 决定卡片怎么演这一步的动画 */
enum class EqStepType {
    /** 跨等号搬运（全页唯一要变号的），走「幽灵飞越」 */
    MOVE,

    /** 同侧换位（只在一侧内部滑动，绝不跨等号线） */
    SWAP,

    /** 同侧合并同类项（值不变，只是写法变短） */
    COMBINE,

    /** 两边整体对调 */
    FLIP,

    /** 最后一步「把右边的数算出来」—— 没有可演的动作，直接亮结果 */
    SOLVE,
}

/** 分步练习里的一步：学生答一个问题，卡片就把这一步的动画演给他看 */
data class EqSolveStep(
    /** 这一步开始时等式的样子（卡片小舞台渲染它） */
    val before: EqState,
    /** 这一步做完的样子 —— 下一步的 before 必定等于它 */
    val after: EqState,
    val type: EqStepType,
    /** 步骤小标签：跨线变号 / 同侧换位 / 同侧合并 / 两边对调 / 算出来 */
    val label: String,
    /** 问法 */
    val ask: String,
    /** 选项文本（按钮上原样显示） */
    val options: List<String>,
    /** 正确答案 —— 必定是 [options] 里的一个 */
    val answer: String,
    /** 答对后点明的道理 */
    val why: String,
    /** 答错时的通用提示 */
    val wrongTip: String,
    /** ★ 这一步底下的原始动作 —— 卡片照着它演动画（「算出来」与补出来的「两边对调」没有） */
    val action: MoveAction? = null,
    /** 「算出来」专用：忘了变号会算出的那个数（选项里的经典陷阱） */
    val trapAnswer: String? = null,
    /** 「算出来」专用：选到陷阱项时点破的那句话 */
    val trapTip: String? = null,
)

/** 一道分步解方程练习 */
data class EqSolveItem(
    val kind: MoveKind,
    val kindLabel: String,
    /** 原式 */
    val initial: EqState,
    /** 解完的规范形态（同侧反例题就是「换完位置」的形态） */
    val final: EqState,
    /** 一步一步要填的步骤：actions 各一步（x 落在右边再补一次对调）＋ 最后「算出来」 */
    val steps: List<EqSolveStep>,
    val x: Int,
    val answer: Int,
    /** 一行解答：x = 14 - 8 = 6 */
    val solution: String,
    /** 是否真的把 x 解出来了（同侧反例题只演示一步，不解） */
    val solved: Boolean,
    /** 收尾文案 */
    val finalNote: String,
)

/** 步骤小标签（web 侧 [SOLVE_LABEL] 同款文案） */
private fun eqStepLabel(type: EqStepType): String = when (type) {
    EqStepType.MOVE -> "跨线变号"
    EqStepType.SWAP -> "同侧换位"
    EqStepType.COMBINE -> "同侧合并"
    EqStepType.FLIP -> "两边对调"
    EqStepType.SOLVE -> "算出来"
}

private fun eqSolveSide(s: EqSide): String = if (s == EqSide.LEFT) "左边" else "右边"

/** 一步「符号该变成什么」的选项：四个变号 + 一个「不变」（后者正是同侧动作的正确答案） */
private fun eqOpOptions(value: String): List<String> =
    listOf("+$value", "-$value", "×$value", "÷$value", "不变")

/**
 * 选项里跟在符号后面的那个「量」：
 *   搬运 = 被搬项本身 · 合并 = 合并后的结果 · 对调 = x（对调没有具体的被搬项）
 */
private fun eqStepValue(a: MoveAction): String = when (a.type) {
    EqActionType.FLIP -> "x"
    EqActionType.COMBINE -> a.combined ?: a.value
    else -> a.value
}

/**
 * 一侧在给定 x 下的数值（**只给练习选项用**：算「忘了变号会得到几」）。
 *
 * ⚠️ 必须用 [Double] 累积 —— web 那边是 JS number，除法会出小数；
 *    这里若用 Int，`8 ÷ 3` 会被**静默截断**成 2，然后被当成一个合法的整数选项混进去。
 *    调用方拿到的 Double 要自己判「是不是整数」。
 */
private fun eqSideValueAt(side: EqSideList, xVal: Int): Double {
    if (side.isEmpty()) return Double.NaN
    var acc = eqTermValueAt(side[0], xVal).toDouble()
    if (side[0].op == EqOp.SUB) acc = -acc
    for (i in 1 until side.size) {
        val t = side[i]
        val v = eqTermValueAt(t, xVal).toDouble()
        when (t.op) {
            EqOp.ADD -> acc += v
            EqOp.SUB -> acc -= v
            EqOp.MUL -> acc *= v
            EqOp.DIV -> acc /= v
            null -> return Double.NaN
        }
    }
    return acc
}

/** 洗牌（**返回新列表**，不动入参） */
private fun eqShuffled(items: List<String>, random: Random): List<String> {
    val a = items.toMutableList()
    for (i in a.size - 1 downTo 1) {
        val j = eqRndInclusive(0, i, random)
        val tmp = a[i]
        a[i] = a[j]
        a[j] = tmp
    }
    return a
}

/** 把一个动作变成「学生要填的那一步」 */
private fun eqStepOfAction(a: MoveAction): EqSolveStep {
    // ── 搬运：全页唯一跨等号的动作 ⇒ 唯一要变号的 ──
    if (a.type == EqActionType.MOVE) {
        val shown = if (a.srcOp == null) a.value else "${a.srcOp.sym}${a.value}"
        return EqSolveStep(
            before = a.before,
            after = a.after,
            type = EqStepType.MOVE,
            label = eqStepLabel(EqStepType.MOVE),
            action = a,
            ask = if (a.srcOp == null) {
                "「${a.value}」站在最前面、前面不写符号 —— 它其实带着一个看不见的「${a.fromOp.sym}」。把它挪到等号另一边，符号该变成什么？"
            } else {
                "把「$shown」挪到等号另一边，符号该变成什么？"
            },
            options = eqOpOptions(eqStepValue(a)),
            answer = "${a.toOp.sym}${a.value}",
            why = "它跨过了等号 ——「${a.fromOp.sym}」必须变成「${a.toOp.sym}」。",
            wrongTip = "它跨过了等号，符号一定要变相反：「${a.fromOp.sym}」要变成「${a.toOp.sym}」。",
        )
    }

    // ── 同侧重排三兄弟：一个字节都不跨等号线 ⇒ 符号一点不动 ──
    val where = eqSolveSide(a.from)
    if (a.type == EqActionType.SWAP) {
        return EqSolveStep(
            before = a.before,
            after = a.after,
            type = EqStepType.SWAP,
            label = eqStepLabel(EqStepType.SWAP),
            action = a,
            ask = "这一步只是在${where}内部把两项换个位置 —— 它跨过等号了吗？符号该变成什么？",
            options = eqOpOptions(eqStepValue(a)),
            answer = "不变",
            why = "它没跨过等号，只是在同一侧换了个位置 —— 符号一点不用动。",
            wrongTip = "这一步压根没碰那条等号线。只有「从等号一边搬到另一边」才变号。",
        )
    }
    if (a.type == EqActionType.COMBINE) {
        val merged = a.combined ?: a.value
        return EqSolveStep(
            before = a.before,
            after = a.after,
            type = EqStepType.COMBINE,
            label = eqStepLabel(EqStepType.COMBINE),
            action = a,
            ask = "这一步是把${where}的两个同类项合起来（${a.value} 并进旁边那一项，结果是 ${merged}）" +
                "—— 合并跨过等号了吗？符号该变成什么？",
            options = eqOpOptions(eqStepValue(a)),
            answer = "不变",
            why = "合并是同一侧内部的事，不跨等号线 —— 求值一分没变，只是写法变短了。",
            wrongTip = "合并就像把同一个篮子里的东西倒在一起，压根没跨等号线 ⇒ 符号不用变。",
        )
    }
    return EqSolveStep(
        before = a.before,
        after = a.after,
        type = EqStepType.FLIP,
        label = eqStepLabel(EqStepType.FLIP),
        action = a,
        ask = "这一步是把等号两边整体对调 —— 对调之后，x 的符号该变成什么？",
        options = eqOpOptions(eqStepValue(a)),
        answer = "不变",
        why = "等号两边本来就一样多，谁在左边谁在右边都行 —— 对调不改变任何一项的符号。",
        wrongTip = "对调只是把左右两边换个位置写，每一项都还待在原来那个算式里 ⇒ 符号不用变。",
    )
}

/**
 * 收尾那一步：把右边的数算出来。
 * ★ 选项里**必定含着「忘了变号」会算出的那个数** —— 那正是这一页要防的错。
 */
private fun eqSolveStepOf(p: MoveProblem, random: Random): EqSolveStep {
    val right = eqSideToText(p.final.right)
    // 忘变号：把末态右侧除首项以外的运算符全部翻回去再求值
    // （x 此时已单独在左边 ⇒ 右侧不含未知数，代 0 即得常数）
    val noFlip = eqSideValueAt(
        p.final.right.mapIndexed { i, t ->
            val op = t.op
            if (i == 0 || op == null) t else t.copy(op = eqFlipOp(op))
        },
        0,
    )
    val wrongs = mutableListOf<Int>()
    fun push(c: Double) {
        if (!c.isFinite() || c % 1.0 != 0.0 || c < 0.0) return
        val ci = c.toInt()
        if (ci == p.answer || wrongs.contains(ci) || wrongs.size >= 3) return
        wrongs.add(ci)
    }
    push(noFlip) // ← 经典陷阱：移项没变号
    push((p.answer + 1).toDouble())
    push((p.answer - 1).toDouble())
    push((p.answer * 2).toDouble())
    push((p.answer + 3).toDouble())
    val trap = if (noFlip.isFinite() && noFlip % 1.0 == 0.0 && noFlip >= 0.0 && noFlip.toInt() != p.answer) {
        noFlip.toInt().toString()
    } else {
        null
    }
    return EqSolveStep(
        before = p.final,
        after = p.final,
        type = EqStepType.SOLVE,
        label = eqStepLabel(EqStepType.SOLVE),
        ask = "最后一步：把右边的 $right 算出来，x 等于几？",
        options = eqShuffled(listOf(p.answer.toString()) + wrongs.map { it.toString() }, random),
        answer = p.answer.toString(),
        why = "x = $right = ${p.answer}。把 ${p.answer} 代回原式，等号两边一样。",
        wrongTip = "再算一遍：$right。",
        trapAnswer = trap,
        trapTip = "这正是「移项忘了变号」会算出来的数 —— 前面跨过等号时符号已经变过一次，别再翻回去。",
    )
}

/** flipSides 的题（a - x = b 这类）搬完后 x 单独落在**等号右边** —— 再对调一次才写成 x = … */
private fun eqFlipBackStep(from: EqState, to: EqState): EqSolveStep = EqSolveStep(
    before = from,
    after = to,
    type = EqStepType.FLIP,
    label = eqStepLabel(EqStepType.FLIP),
    ask = "x 已经单独待在等号右边了 —— 把两边整体对调一下，每一项的符号该变成什么？",
    options = eqOpOptions("x"),
    answer = "不变",
    why = "等号两边本来就一样多，谁在左边谁在右边都行 —— 对调不改变任何一项的符号。",
    wrongTip = "对调只是把左右两边换个位置写，每一项都还待在原来那个算式里 ⇒ 符号不用变。",
)

/**
 * 把一道题拆成「一步一填」的练习题。
 * ★ 步骤 = 每个动作一步 ＋（x 落在等号右边时）补一次两边对调 ＋ 最后「算出来」一步。
 * ⚠️ 同侧反例题（[MoveKind.SAME_SIDE]）**没有**「算出来」那一步 —— 它只演示「同侧换位不变号」，
 *    压根没打算求解，硬凑一步会把「这一步不用解」这个教学点抹掉。
 */
fun eqBuildSolveItem(kind: MoveKind, random: Random = Random.Default): EqSolveItem {
    val p = buildProblem(kind, random)
    val steps = p.actions.map { eqStepOfAction(it) }.toMutableList()
    val last = p.actions.lastOrNull()
    if (p.flipSides && last != null) steps.add(eqFlipBackStep(last.after, p.final))
    if (!p.isSameSide) steps.add(eqSolveStepOf(p, random))
    return EqSolveItem(
        kind = kind,
        kindLabel = p.kindLabel,
        initial = p.initial,
        final = p.final,
        steps = steps,
        x = p.x,
        answer = p.answer,
        solution = eqSolutionText(p),
        solved = !p.isSameSide,
        finalNote = if (p.isSameSide) {
            "这道题只演一步：同一侧换个位置，符号一点没变。要把 x 单独留下来，" +
                "下一步就得让最前面那个数跨过等号 —— 那时候才变号。"
        } else {
            "解出来了：x = ${p.answer}。把 ${p.answer} 代回原式 ${eqToText(p.initial)}，等号两边一样。"
        },
    )
}

/** 4 条基本变号规律：每轮各一道 */
private val EQ_SOLVE_BASIC: List<MoveKind> =
    listOf(MoveKind.PLUS, MoveKind.MINUS, MoveKind.TIMES, MoveKind.DIVIDE)

/** 「要多步才解得完」的进阶型：每轮**必出**一道（首项显形 / 两边都有 x / 多项多步…） */
private val EQ_SOLVE_STEP: List<MoveKind> = listOf(
    MoveKind.MINUS_VAR, MoveKind.DIVIDE_VAR,
    MoveKind.REVEAL_PLUS, MoveKind.REVEAL_TIMES,
    MoveKind.X_RIGHT, MoveKind.THREE_TERMS,
    MoveKind.BOTH_SIDES, MoveKind.MULTI_STEP,
)

/** 补齐名额时的题型池（含「同侧不变号」这个反例） */
private val EQ_SOLVE_POOL: List<MoveKind> = EQ_SOLVE_BASIC + EQ_SOLVE_STEP + MoveKind.SAME_SIDE

/**
 * 生成一组分步解方程练习（默认 **6** 道）。
 *
 * ★ 组合策略与「六种情形全练到」一致：**4 条基本变号规律各一道** ＋ **1 道多步题（必出）**
 *   ＋ **1 道「同侧换位不变号」反例（必出）**，整体打乱后取前 n 道。
 */
fun eqGenerateSolveItems(n: Int = 6, random: Random = Random.Default): List<EqSolveItem> {
    val kinds = EQ_SOLVE_BASIC.toMutableList()
    if (n > EQ_SOLVE_BASIC.size) kinds.add(EQ_SOLVE_STEP[eqRndInclusive(0, EQ_SOLVE_STEP.size - 1, random)])
    if (n > EQ_SOLVE_BASIC.size + 1) kinds.add(MoveKind.SAME_SIDE)
    while (kinds.size < n) kinds.add(EQ_SOLVE_POOL[eqRndInclusive(0, EQ_SOLVE_POOL.size - 1, random)])
    // Fisher–Yates 打乱，避免每轮都是「+ - × ÷」同一个次序
    for (i in kinds.size - 1 downTo 1) {
        val j = eqRndInclusive(0, i, random)
        val tmp = kinds[i]
        kinds[i] = kinds[j]
        kinds[j] = tmp
    }
    return kinds.take(n).map { k -> eqBuildSolveItem(k, random) }
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
            "站在最前面的那个数**不写符号**，但它其实带着一个隐藏的「+」（或「×」）。" +
                "看不出来就先跟后面换个位置，符号才露出来 —— 换位置不改符号。",
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
    EqRuleCard(
        title = "多步方程的口诀",
        lines = listOf(
            "先看哪边有 x：把 x 都搬到同一边去（搬的时候照旧变号）。",
            "再把同一边的 x 项合起来（3 个 x 减 2 个 x，就是 1 个 x）—— 合并是**同一边**的事，不用变号。",
            "最后把剩下的常数搬到另一边，x 就单独留下了。",
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
    EqMistakeCase(
        title = "首项没写符号，就以为它「没有符号」",
        wrong = "5 + x = 12　⇒　x = 12 + 5",
        right = "5 + x = 12　⇒　x = 12 - 5",
        why = "5 站在最前面才不写符号 —— 它其实是「+5」。看不出来就先跟 x 换个位置写成 x + 5 = 12（换位置不变号），" +
            "这下「+」露出来了，跨过等号自然要变成「-」。",
        tip = "首项不写符号 ≠ 没有符号；换到后面就看得见。",
    ),
    EqMistakeCase(
        title = "合并同类项时也去变号",
        wrong = "5x = 3x + 6　⇒　5x + 3x = 6",
        right = "5x = 3x + 6　⇒　5x - 3x = 6　⇒　2x = 6",
        why = "先把 3x 从右边搬到左边，这一步跨了等号 ⇒ 必须变号；而后面「5x 减 3x 合成 2x」是**同一边**的合并，不用变号。两步别混。",
        tip = "跨等号的要变号，同一边合并的不用变。",
    ),
)

/** 教材给的固定对比练习（四种符号变化并排看） */
val EQ_PRACTICE: List<EqPracticeItem> = listOf(
    EqPracticeItem(
        before = "x + 8 = 14",
        sym = EqOp.ADD, num = 8, answer = EqPracticeAnswer.Op(EqOp.SUB), x = 6,
        result = "x = 14 - 8 = 6",
        why = "加号跨过等号 ⇒ 变成减号。",
    ),
    EqPracticeItem(
        before = "x - 8 = 14",
        sym = EqOp.SUB, num = 8, answer = EqPracticeAnswer.Op(EqOp.ADD), x = 22,
        result = "x = 14 + 8 = 22",
        why = "减号跨过等号 ⇒ 变成加号。",
    ),
    EqPracticeItem(
        before = "x × 8 = 16",
        sym = EqOp.MUL, num = 8, answer = EqPracticeAnswer.Op(EqOp.DIV), x = 2,
        result = "x = 16 ÷ 8 = 2",
        why = "乘号跨过等号 ⇒ 变成除号（因子到对面变倒数）。",
    ),
    EqPracticeItem(
        before = "x ÷ 8 = 16",
        sym = EqOp.DIV, num = 8, answer = EqPracticeAnswer.Op(EqOp.MUL), x = 128,
        result = "x = 16 × 8 = 128",
        why = "除号跨过等号 ⇒ 变成乘号（因子到对面变倒数）。",
    ),
)
