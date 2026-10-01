package com.example.ai.data.math

import com.example.ai.ui.icon.MathIcons
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * 移项变号引擎单测 —— 核心判据：**每一次动作都必须保持等式成立**。
 *
 * 两个**互相独立**的裁判给同一个数，才把「移项是合法的等价变形」从信仰变成证明：
 *   · 裁判 A：按 [EqTerm] 序列逐项求值（不复用引擎的任何算术与判据）
 *   · 裁判 B：把算式**渲染成文本**（如 `14 - 8`）再解析求值 —— 另一条实现路径，只认字符串
 *
 * 断言链：
 *   原式成立 → 每做一步都还成立 → 搬的项只是符号变了 / 换位的项符号没动 / 合并的项求值没变
 *   → x 从未被反复搬 → 末态右侧求值 === x → 而且把答案代回**原式**也成立（证明解是对的）
 *
 * 移植自 web/src/lib/equationMove.test.ts（逐条对齐，含 swap / combine / flip 三种新动作的判据）。
 */

// ────────────────────────────────────────────────────────────
// 裁判 A：按 term 序列求值
// ────────────────────────────────────────────────────────────

/** 项的数值：`5x` 在 x=3 时是 15（系数必须算进去 —— 这是新题型的重点） */
private fun valueOf(t: EqTerm, xVal: Int): Int = if (t.isVar) eqCoefOf(t) * xVal else t.value.toInt()

private fun evalSide(side: EqSideList, xVal: Int): Int {
    require(side.isNotEmpty()) { "空的一侧无法求值" }
    var acc = if (side[0].op == EqOp.SUB) -valueOf(side[0], xVal) else valueOf(side[0], xVal)
    for (i in 1 until side.size) {
        val t = side[i]
        val m = valueOf(t, xVal)
        acc = when (t.op) {
            EqOp.ADD -> acc + m
            EqOp.SUB -> acc - m
            EqOp.MUL -> acc * m
            EqOp.DIV -> {
                // JS 的 3/2 给 1.5，Kotlin 的 3/2 会**静默截断**成 1 ⇒ 显式要求整除
                require(acc % m == 0) { "Int 除法不整除：$acc ÷ $m" }
                acc / m
            }
            null -> throw AssertionError("非首项缺少运算符：${eqSideToText(side)}")
        }
    }
    return acc
}

// ────────────────────────────────────────────────────────────
// 裁判 B：只认「渲染出来的文本」，重新解析求值
// ────────────────────────────────────────────────────────────

/** 解析形如 `14 - 8` / `128 ÷ 8` 的两项算式（[eqSideToText] 的产物） */
private fun evalTwoTermText(text: String): Int {
    val p = text.trim().split(" ")
    require(p.size == 3) { "裁判 B 只支持两项算式，收到：$text" }
    val a = p[0].toInt()
    val b = p[2].toInt()
    return when (p[1]) {
        "+" -> a + b
        "-" -> a - b
        "×" -> a * b
        "÷" -> {
            require(a % b == 0) { "裁判 B：$a ÷ $b 不整除" }
            a / b
        }
        else -> throw AssertionError("未知运算符：${p[1]}")
    }
}

/** 纯数字算式（可能是单个数字）：`14` ⇒ 14 · `6 + 8` ⇒ 14 */
private fun evalNumExpr(text: String): Int {
    val t = text.trim()
    if (!t.contains(" ")) return t.toInt()
    return evalTwoTermText(t)
}

/**
 * 两路裁判必须一致。
 * ⚠️ 裁判 A 是**严格从左往右**算的，只在「一侧里不混优先级」时等价 ——
 *    乘除链只出现在两项的一侧（`a × x` / `b ÷ a`），其余多项目的一侧只有加减。这里把它钉住。
 */
private fun bothAgree(side: EqSideList, xVal: Int, label: String): Int {
    assertTrue("$label: 一侧不该为空", side.isNotEmpty())
    if (side.any { it.op == EqOp.MUL || it.op == EqOp.DIV }) {
        assertTrue("$label: 乘除链只允许出现在两项的一侧，实际 ${side.size} 项", side.size <= 2)
    }
    val a = evalSide(side, xVal)
    if (side.size == 2) {
        val txt = eqSideToText(side, xVal)
        val b = evalTwoTermText(txt)
        assertEquals("$label: 两路裁判不一致（自己 $a / 文本 $b）—— $txt", a, b)
    }
    return a
}

/** 一侧的「组成」（值 + 身份），判断换位时组成有没有被改动 */
private fun composition(side: EqSideList): String =
    side.map { "${it.value}:${it.isVar}" }.sorted().joinToString("|")

private fun sideOf(st: EqState, from: EqSide): EqSideList = if (from == EqSide.LEFT) st.left else st.right

private fun otherSide(from: EqSide): EqSide = if (from == EqSide.LEFT) EqSide.RIGHT else EqSide.LEFT

/** 动作构成（按 type 计），与 web 的 EXPECTED_ACTIONS 逐字对齐 */
internal fun actionSeq(p: MoveProblem): String = p.actions.joinToString(",") { it.type.name.lowercase() }

private val EXPECTED_ACTIONS: Map<MoveKind, String> = mapOf(
    MoveKind.PLUS to "move",
    MoveKind.MINUS to "move",
    MoveKind.TIMES to "move",
    MoveKind.DIVIDE to "move",
    MoveKind.MINUS_VAR to "move,swap,move",
    MoveKind.DIVIDE_VAR to "move,swap,move",
    MoveKind.REVEAL_PLUS to "swap,move",
    MoveKind.REVEAL_TIMES to "swap,move",
    MoveKind.X_RIGHT to "flip,move",
    MoveKind.THREE_TERMS to "move,move",
    MoveKind.BOTH_SIDES to "swap,move,combine",
    MoveKind.MULTI_STEP to "move,swap,move,combine",
    MoveKind.SAME_SIDE to "swap",
)

// ────────────────────────────────────────────────────────────
// 判据链
// ────────────────────────────────────────────────────────────

private fun checkProblem(p: MoveProblem, tag: String) {
    val x = p.x
    val where = "$tag【${p.kind}】${eqToText(p.initial)}"

    // ① 答案必须是正整数，且与 x 一致
    assertTrue("$where：解应为正整数，实为 $x", x > 0)
    assertEquals("$where：answer 与 x 不等", x, p.answer)

    // ② 原等式成立（两路裁判都同意）
    assertEquals("$where：原式本身不成立 —— ${eqToText(p.initial, x)}", evalSide(p.initial.left, x), evalSide(p.initial.right, x))

    // ③ 动作构成与题型对得上
    assertEquals("$where：动作构成与题型不符", EXPECTED_ACTIONS.getValue(p.kind), actionSeq(p))

    // ④ 每一步做完，等式都必须**仍然成立**（这就是「等价变形」的证明）
    var prev: EqState = p.initial
    var varMoves = 0
    p.actions.forEachIndexed { k, a ->
        val w = "$where 第${k + 1}步(${a.type})"
        assertEquals("$w: before 与上一步的 after 不衔接", eqToText(prev), eqToText(a.before))

        val srcBefore = sideOf(a.before, a.from)
        val srcAfter = sideOf(a.after, a.from)

        when (a.type) {
            EqActionType.MOVE -> {
                // 符号翻转必须正好是「变相反」，而且翻转两次回到原值
                assertEquals("$w: 符号没有按规则翻转", eqFlipOp(a.fromOp), a.toOp)
                assertEquals("$w: flip 不是自反的", a.fromOp, eqFlipOp(eqFlipOp(a.fromOp)))

                // 写了符号的项：等效符号 === 写出来的符号
                if (a.srcOp != null) {
                    assertEquals("$w: 显式符号与等效符号不符", a.srcOp, a.fromOp)
                } else {
                    assertTrue(
                        "$w: 首项没写符号时，等效只可能是 + 或 ×，实际 ${a.fromOp}",
                        a.fromOp == EqOp.ADD || a.fromOp == EqOp.MUL,
                    )
                }

                // 项数守恒：源侧 -1、目标侧 +1
                val dstBefore = sideOf(a.before, otherSide(a.from))
                val dstAfter = sideOf(a.after, otherSide(a.from))
                assertEquals("$w: 源侧项数没减 1", srcBefore.size - 1, srcAfter.size)
                assertEquals("$w: 目标侧项数没加 1", dstBefore.size + 1, dstAfter.size)

                // ★ 搬过去的必须是「同一块」，只有符号变
                val landed = dstAfter.last()
                assertEquals("$w: 搬过去的数值变了", a.value, landed.value)
                assertEquals("$w: 搬过去的项身份变了", a.isVar, landed.isVar)
                assertEquals("$w: 落位项的符号不对", a.toOp, landed.op)

                if (a.isVar) {
                    varMoves++
                    assertTrue("$w: x 项被搬了不止一次", varMoves <= 1)
                }
            }

            EqActionType.SWAP -> {
                // ★ 同侧换位：符号**一点不动**，组成不变，这一侧求值不变
                assertEquals("$w: 同侧换位不许改符号", a.fromOp, a.toOp)
                assertEquals("$w: 只支持相邻换位", a.index + 1, a.index2)
                assertTrue("$w: 换位下标越界", a.index2!! < srcBefore.size)
                assertNotEquals("$w: 中间是 ÷，换位不成立", EqOp.DIV, srcBefore[a.index2].op)
                assertEquals("$w: 换位不该改变项数", srcBefore.size, srcAfter.size)
                assertEquals("$w: 换位不该改变这一侧的组成", composition(srcBefore), composition(srcAfter))
                assertEquals(
                    "$w: 换位后这一侧求值变了 —— 说明不该变号的地方变号了",
                    evalSide(srcBefore, x),
                    evalSide(srcAfter, x),
                )
            }

            EqActionType.COMBINE -> {
                // 合并同类项：项数 -1，但这一侧求值不变；合并后的文本要能对上
                assertEquals("$w: 只支持相邻合并", a.index + 1, a.index2)
                assertEquals("$w: 合并后项数应减 1", srcBefore.size - 1, srcAfter.size)
                assertEquals(
                    "$w: 合并是「改写」不是「运算」，求值必须不变",
                    evalSide(srcBefore, x),
                    evalSide(srcAfter, x),
                )
                assertTrue("$w: 缺合并后的文本", !a.combined.isNullOrEmpty())
                assertEquals("$w: 合并后的文本没落到位置上", a.combined, srcAfter[a.index].value)
                // 合并结果必须真的等于那两项的和
                val sum = eqSignedCoef(srcBefore[a.index]) + eqSignedCoef(srcBefore[a.index2!!])
                assertEquals("$w: 合并后的系数 ${eqCoefOf(srcAfter[a.index])} ≠ $sum", sum, eqCoefOf(srcAfter[a.index]))
            }

            EqActionType.FLIP -> {
                // 两边整体对调：左变右、右变左，内容一模一样
                assertEquals("$w: 对调后左边应等于原右边", eqSideToText(a.before.right), eqSideToText(a.after.left))
                assertEquals("$w: 对调后右边应等于原左边", eqSideToText(a.before.left), eqSideToText(a.after.right))
            }
        }

        // ★ 做任何一步之后，等式都必须依然成立（两路裁判）
        val l = bothAgree(a.after.left, x, "$w after.left")
        val r = bothAgree(a.after.right, x, "$w after.right")
        assertEquals("$w: 做完这一步等式不成立了 —— ${eqToText(a.after, x)}", l, r)

        prev = a.after
    }

    // ⑤ x 项最多被搬一次（不许来回搬）
    assertTrue("$where：x 项被搬了不止一次", varMoves <= 1)

    // ⑥ 末态：x 单独在一边，另一边是能算出答案的式子（且不该再留着 x）
    if (!p.isSameSide) {
        assertEquals("$where：末态左边应只有一项", 1, p.final.left.size)
        assertTrue("$where：末态左边应是 x", p.final.left[0].isVar)
        assertEquals("$where：x 不应带符号", null, p.final.left[0].op)
        assertEquals("$where：末态左边应当是 1 个 x（不是 2x）", 1, eqCoefOf(p.final.left[0]))
        assertTrue("$where：末态右边不该为空", p.final.right.isNotEmpty())
        assertEquals("$where：末态右边不该还留着 x", 0, p.final.right.count { it.isVar })
        assertEquals("$where：末态右边求值 != answer", p.answer, evalSide(p.final.right, x))
    }

    // ⑦ ★ 把答案代回**原式**也必须成立（证明这个解是对的）
    assertEquals(
        "$where：把 x=${p.answer} 代回原式不成立 —— ${eqToText(p.initial, p.answer)}",
        evalSide(p.initial.left, p.answer),
        evalSide(p.initial.right, p.answer),
    )

    // ⑧ 数值规模 & 无退化（三年级教材范围）
    for (side in listOf(p.initial.left, p.initial.right, p.final.left, p.final.right)) {
        for (t in side) {
            if (t.isVar) {
                val k = eqCoefOf(t)
                assertTrue("$where：x 的系数超范围 ${t.value}", k in 1..9)
                continue
            }
            val n = t.value.toInt()
            assertTrue("$where：数字超范围 $n", n in 1..100)
        }
    }
    // 乘除题：因子不许是 1（×1 / ÷1 看不出规律，是退化题）
    for (side in listOf(p.initial.left, p.initial.right)) {
        for (t in side) {
            if ((t.op == EqOp.MUL || t.op == EqOp.DIV) && !t.isVar) {
                assertTrue("$where：乘除因子退化为 1", t.value.toInt() >= 2)
            }
        }
    }

    // ⑨ 同侧交换题：只换位置，不搬运
    if (p.isSameSide) {
        assertEquals("$where：同侧交换不该有搬运", 0, p.actions.count { it.type == EqActionType.MOVE })
        assertEquals("$where：同侧交换后左边求值变了", evalSide(p.initial.left, x), evalSide(p.final.left, x))
        assertEquals("$where：同侧交换的 answer 应等于 x", x, p.answer)
    }

    // ⑩ 需要末尾对调的题（a - x = b / a ÷ x = b）
    if (p.kind == MoveKind.MINUS_VAR || p.kind == MoveKind.DIVIDE_VAR) {
        assertTrue("$where：${p.kind} 需要末尾左右对调", p.flipSides)
        assertEquals("$where：${p.kind} 要搬两次", 2, p.actions.count { it.type == EqActionType.MOVE })
    } else {
        assertTrue("$where：只有 minusVar / divideVar 需要末尾对调", !p.flipSides)
    }
}

private val ALL_KINDS: List<MoveKind> = MoveKind.values().toList()

// ────────────────────────────────────────────────────────────
// 分步解方程练习的判据
// ────────────────────────────────────────────────────────────

/** 四个「变号」+ 一个「不变」—— 卡片上按这个顺序渲染 */
private val OP_OPTIONS = listOf("+", "-", "×", "÷", "不变")

/** 等式两侧都用两路裁判算一遍，并且必须相等 */
private fun stateHolds(st: EqState, xVal: Int, label: String): Pair<Int, Int> {
    val l = bothAgree(st.left, xVal, "$label 左边")
    val r = bothAgree(st.right, xVal, "$label 右边")
    assertEquals("$label: 等式不成立（$l ≠ $r）", l, r)
    return l to r
}

/**
 * 一步动作在数值上只有两种可能：
 *   · MOVE —— 两侧的值**都会变**（这正是「搬运」的含义），但**等式照旧成立**
 *   · SWAP / COMBINE / FLIP / SOLVE —— 两侧的值**一分不动**，只有写法变了
 *
 * ⇒ 学生只要用「数值变没变」就能替我们判「这一步到底跨没跨等号线」。
 */
private fun stepKeepsValue(step: EqSolveStep, xVal: Int, label: String) {
    val before = stateHolds(step.before, xVal, "$label 变形前")
    val after = stateHolds(step.after, xVal, "$label 变形后")
    if (step.type == EqStepType.MOVE) {
        assertTrue("$label: 搬运必然同时改变两侧的值，实际 $before → $after", before != after)
    } else {
        assertEquals("$label: 同侧动作/求解步不该改变任何一侧的值", before, after)
    }
}

/** 一步自己的数据必须自洽：选项、答案、标签、文案、动作类型 */
private fun checkStep(step: EqSolveStep, label: String) {
    assertTrue("$label: 选项不能为空", step.options.isNotEmpty())
    assertTrue("$label: 答案「${step.answer}」必须出现在选项里", step.options.contains(step.answer))
    assertEquals("$label: 选项不该重复", step.options.size, step.options.toSet().size)
    assertTrue("$label: 标签不能为空", step.label.isNotBlank())
    assertTrue(
        "$label: 问法 / 讲解 / 提示都不能为空",
        step.ask.isNotBlank() && step.why.isNotBlank() && step.wrongTip.isNotBlank(),
    )
    when (step.type) {
        EqStepType.MOVE -> {
            assertNotEquals("$label: 跨线步的答案不该是「不变」", "不变", step.answer)
            assertTrue("$label: 跨线步必须带着原始动作", step.action != null)
            assertEquals("$label: 跨线步的动作类型应当一致", EqActionType.MOVE, step.action?.type)
        }
        EqStepType.SWAP -> {
            assertEquals("$label: 同侧换位的答案应当是「不变」", "不变", step.answer)
            assertEquals("$label: 换位步的动作类型应当一致", EqActionType.SWAP, step.action?.type)
        }
        EqStepType.COMBINE -> {
            assertEquals("$label: 同侧合并的答案应当是「不变」", "不变", step.answer)
            assertEquals("$label: 合并步的动作类型应当一致", EqActionType.COMBINE, step.action?.type)
        }
        EqStepType.FLIP -> {
            // ⚠️ flipSides 补出来的那次「两边对调」**没有**原始动作（引擎不给）
            assertEquals("$label: 两边对调的答案应当是「不变」", "不变", step.answer)
            if (step.action != null) {
                assertEquals("$label: 对调步的动作类型应当一致", EqActionType.FLIP, step.action?.type)
            }
        }
        EqStepType.SOLVE -> {
            assertTrue("$label: 「算出来」的答案必须是数字", step.answer.toIntOrNull() != null)
            assertTrue("$label: 「算出来」不该带动作（它没有可演的动作）", step.action == null)
        }
    }
    if (step.type != EqStepType.SOLVE) {
        // 符号步的选项顺序固定：四个变号 + 一个「不变」
        assertEquals(
            "$label: 符号步的选项应当是「+ - × ÷ 不变」",
            OP_OPTIONS,
            step.options.map { if (it == "不变") "不变" else it.take(1) },
        )
    }
}
class EqMoveTest {

    // ── 核心规则 ──────────────────────────────────────────────

    @Test
    fun flipOpIsInvolution() {
        for (op in EqOp.values()) {
            assertEquals("「${op.sym}」取反两次应回到自己", op, eqFlipOp(eqFlipOp(op)))
        }
        assertEquals(EqOp.SUB, eqFlipOp(EqOp.ADD))
        assertEquals(EqOp.ADD, eqFlipOp(EqOp.SUB))
        assertEquals(EqOp.DIV, eqFlipOp(EqOp.MUL))
        assertEquals(EqOp.MUL, eqFlipOp(EqOp.DIV))
        // 加减与乘除不能串门
        assertNotEquals(EqOp.MUL, eqFlipOp(EqOp.ADD))
        assertNotEquals(EqOp.DIV, eqFlipOp(EqOp.ADD))
        assertNotEquals(EqOp.ADD, eqFlipOp(EqOp.MUL))
        assertNotEquals(EqOp.SUB, eqFlipOp(EqOp.MUL))
    }

    @Test
    fun effectiveOpHandlesImplicitFirstTerm() {
        // 写出来的符号直接用
        assertEquals(EqOp.ADD, eqEffectiveOp(listOf(term(null, "x", true), term(EqOp.ADD, "5")), 1))
        assertEquals(EqOp.SUB, eqEffectiveOp(listOf(term(null, "x", true), term(EqOp.SUB, "5")), 1))
        assertEquals(EqOp.MUL, eqEffectiveOp(listOf(term(null, "x", true), term(EqOp.MUL, "5")), 1))
        assertEquals(EqOp.DIV, eqEffectiveOp(listOf(term(null, "x", true), term(EqOp.DIV, "5")), 1))

        // 首项没写符号：后面跟 × / ÷ ⇒ 它是乘除链的第一个因数，等效 ×
        assertEquals(EqOp.MUL, eqEffectiveOp(listOf(term(null, "4"), term(EqOp.MUL, "x", true)), 0))
        assertEquals(EqOp.MUL, eqEffectiveOp(listOf(term(null, "4"), term(EqOp.DIV, "x", true)), 0))
        // 否则等效 +
        assertEquals(EqOp.ADD, eqEffectiveOp(listOf(term(null, "15"), term(EqOp.SUB, "x", true)), 0))
        assertEquals(EqOp.ADD, eqEffectiveOp(listOf(term(null, "15"), term(EqOp.ADD, "x", true)), 0))
        // `5x` 是**一个**加数，不是「5 乘 x」—— 等效符号仍是 +
        assertEquals(EqOp.ADD, eqEffectiveOp(listOf(term(null, "5x", true)), 0))
    }

    @Test
    fun rndInclusiveNeverThrowsOnEmptySpan() {
        val rnd = Random(1)
        // JS 的 rnd(min,max) 在跨度 <= 0 时返回 min；Kotlin 的 nextInt(min,max) 会抛 IllegalArgumentException
        assertEquals(5, eqRndInclusive(5, 5, rnd))
        assertEquals(5, eqRndInclusive(5, 4, rnd))
        assertEquals(5, eqRndInclusive(5, -3, rnd))
        // 正常区间：闭区间两端都要能取到
        val seen = mutableSetOf<Int>()
        repeat(2000) { seen.add(eqRndInclusive(1, 3, rnd)) }
        assertEquals(setOf(1, 2, 3), seen)
    }

    @Test
    fun coefHandlesVarAndNumber() {
        // `x` 的系数是 1、`5x` 是 5、`12` 是 12（系数是 bothSides / multiStep 的命脉）
        assertEquals(1, eqCoefOf(term(null, "x", true)))
        assertEquals(5, eqCoefOf(term(null, "5x", true)))
        assertEquals(12, eqCoefOf(term(null, "12")))
        assertEquals(-5, eqSignedCoef(term(EqOp.SUB, "5x", true)))
        assertEquals(3, eqSignedCoef(term(null, "3")))
        // 代入 x 后：`5x` 且 x=3 ⇒ 15
        assertEquals(15, eqTermValueAt(term(null, "5x", true), 3))
        assertEquals(12, eqTermValueAt(term(null, "12"), 3))
    }

    // ── 十三种题型，逐一跑完整判据链 ───────────────────────────

    @Test
    fun everyKindKeepsEqualityAtEveryStep() {
        val rnd = Random(20260929)
        for (kind in ALL_KINDS) {
            repeat(300) { i -> checkProblem(generateEqProblem(kind, rnd), "第${i + 1}题") }
        }
    }

    @Test
    fun mixedRandomAlsoPasses() {
        val rnd = Random(31)
        repeat(1000) { i -> checkProblem(generateEqProblem(null, rnd), "混合第${i + 1}题") }
    }

    @Test
    fun kindLabelTipAndGroupsAreComplete() {
        for (kind in ALL_KINDS) {
            assertTrue("$kind 缺 label", !EQ_KIND_LABEL[kind].isNullOrEmpty())
            assertTrue("$kind 缺 tip", !EQ_KIND_TIP[kind].isNullOrEmpty())
            // ★ 题型提示行左边的那个图标 —— 名字打错渲染件会安静地什么都不画
            assertNotNull(
                "$kind 的配图「${EQ_KIND_ICON[kind]}」不在 MathIcons 里",
                MathIcons[EQ_KIND_ICON[kind].orEmpty()],
            )
        }
        val grouped = EQ_KIND_GROUPS.flatMap { it.kinds }
        assertEquals("分组里出现重复题型", grouped.size, grouped.toSet().size)
        assertEquals("分组必须恰好覆盖全部题型", ALL_KINDS.sortedBy { it.name }, grouped.sortedBy { it.name })
    }

    // ── 新题型的专项判据 ──────────────────────────────────────

    @Test
    fun revealKindsSwapFirstThenMove() {
        for (i in 1..200) {
            for (kind in listOf(MoveKind.REVEAL_PLUS, MoveKind.REVEAL_TIMES)) {
                val p = generateEqProblem(kind)
                val swap = p.actions[0]
                assertEquals("$kind：第一步应是同侧换位", EqActionType.SWAP, swap.type)
                assertEquals("$kind：换位必须发生在首项上", 0, swap.index)
                // 换之前：首项真的没写符号（这就是那个「看不见」的坑）
                assertEquals("$kind：换位前首项应当没写符号", null, sideOf(swap.before, swap.from)[0].op)
                // 换位不动号
                assertEquals("$kind：换位不许改符号", swap.fromOp, swap.toOp)
                // 换之后：原来那个首项落到第二位，写上了自己的符号
                val landed = sideOf(swap.after, swap.from)[1]
                assertEquals("$kind：换过来的还是同一个数", swap.value, landed.value)
                assertEquals("$kind：换到后面应当写出它的等效符号", swap.fromOp, landed.op)
                // 然后再跨线变号
                val move = p.actions[1]
                assertEquals("$kind：第二步应是跨线搬运", EqActionType.MOVE, move.type)
                assertEquals("$kind：搬的时候它已经写在屏幕上了", swap.fromOp, move.srcOp)
                assertEquals("$kind：跨过等号才变号", eqFlipOp(swap.fromOp), move.toOp)
            }
        }
    }

    @Test
    fun bothSidesMergesToSingleX() {
        for (i in 1..300) {
            val p = generateEqProblem(MoveKind.BOTH_SIDES)
            assertEquals("动作顺序", "swap,move,combine", actionSeq(p))
            val swap = p.actions[0]
            val move = p.actions[1]
            val comb = p.actions[2]
            assertEquals("换位发生在右边（右边的 x 项是首项）", EqSide.RIGHT, swap.from)
            assertTrue("第二步搬的是 x 项", move.isVar)
            assertEquals("右边的 x 项搬到左边要变号", EqOp.SUB, move.toOp)
            assertTrue("合并的是两个 x 项", comb.isVar)
            // 合并后左边只剩一个 x（系数 1）—— 这是「k - m = 1」的设计目的
            assertEquals("合并后应是 1 个 x", 1, eqCoefOf(p.final.left[0]))
            assertEquals("右边只剩一个常数", 1, p.final.right.size)
            assertEquals("末态右边的数就是答案", p.answer, p.final.right[0].value.toInt())
        }
    }

    @Test
    fun multiStepOrderIsFixed() {
        for (i in 1..300) {
            val p = generateEqProblem(MoveKind.MULTI_STEP)
            assertEquals("move,swap,move,combine", actionSeq(p))
            assertTrue("第一步先搬常数", !p.actions[0].isVar)
            assertEquals(EqSide.LEFT, p.actions[0].from)
            assertEquals(EqOp.SUB, p.actions[0].toOp)
            assertEquals(EqActionType.SWAP, p.actions[1].type)
            assertEquals(EqSide.RIGHT, p.actions[1].from)
            assertTrue("第三步才搬 x 项", p.actions[2].isVar)
            assertEquals(EqActionType.COMBINE, p.actions[3].type)
            // 末态右边是「常数 - 常数」，两项都是数
            assertEquals(2, p.final.right.size)
            assertTrue("末态右边两项都应是数", p.final.right.none { it.isVar })
        }
    }

    @Test
    fun xRightFlipsThenMoves() {
        for (i in 1..200) {
            val p = generateEqProblem(MoveKind.X_RIGHT)
            assertEquals("第一步是两边整体对调", EqActionType.FLIP, p.actions[0].type)
            assertTrue("原式里 x 不在左边", p.initial.left.none { it.isVar })
            assertTrue("原式里 x 在右边（首项）", p.initial.right[0].isVar)
            assertEquals(EqActionType.MOVE, p.actions[1].type)
            assertEquals(EqOp.SUB, p.actions[1].toOp)
            assertEquals(
                "${p.initial.left[0].value} = x + ${p.initial.right[1].value}",
                eqToText(p.initial),
            )
        }
    }

    @Test
    fun threeTermsMovesTwiceBothPlusToMinus() {
        for (i in 1..200) {
            val p = generateEqProblem(MoveKind.THREE_TERMS)
            assertEquals(3, p.initial.left.size)
            assertTrue(p.initial.left[0].isVar)
            for (a in p.actions) {
                assertEquals(EqActionType.MOVE, a.type)
                assertEquals(EqOp.ADD, a.srcOp)
                assertEquals(EqOp.SUB, a.toOp)
            }
            assertEquals("右边攒下 3 项：b - a - c", 3, p.final.right.size)
            assertTrue(!p.final.right[0].isVar)
        }
    }

    @Test
    fun sameSideExchangeChangesNothing() {
        for (i in 1..200) {
            val p = generateEqProblem(MoveKind.SAME_SIDE)
            assertTrue("同侧交换题必须标记 isSameSide", p.isSameSide)

            val a = p.initial.left
            val b = p.final.left
            assertEquals("同侧换序不能改变项的个数", a.size, b.size)

            // ① 与 web 单测逐条对齐：x 从后面挪到前面，写出来的「+」还在第二项上
            assertTrue("原式首项应是数字", !a[0].isVar)
            assertTrue("原式次项应是 x", a[1].isVar)
            assertTrue("换序后首项应是 x", b[0].isVar)
            assertTrue("换序后次项应是数字", !b[1].isVar)
            assertEquals("原式次项的符号应是「+」", EqOp.ADD, a[1].op)
            assertEquals("换序后次项的符号仍应是「+」—— 一点没动", EqOp.ADD, b[1].op)

            // ② ★ 独立复算：每一项的**语义**符号与值必须逐项一致（只有顺序变了）
            assertEquals("同侧换序不许改动任何符号", signedTerms(a).sorted(), signedTerms(b).sorted())

            // ③ 顺序不影响加法 ⇒ 左边整体求值必须一模一样
            assertEquals("同侧换序后左边求值变了", evalSide(a, p.x), evalSide(b, p.x))

            // ④ 等号右边原封不动
            assertEquals("同侧换序不该动等号右边", eqSideToText(p.initial.right), eqSideToText(p.final.right))

            // ⑤ 唯一那一步就是换位，而且是「符号零变化」—— 与 sameSide 的定义互证
            assertEquals("同侧交换只有一步", 1, p.actions.size)
            assertEquals(EqActionType.SWAP, p.actions[0].type)
            assertEquals(p.actions[0].fromOp, p.actions[0].toOp)
        }
    }

    @Test
    fun twoStepProblemsNeedTwoMovesAndARevealSwap() {
        val rnd = Random(5)
        repeat(200) {
            val p1 = generateEqProblem(MoveKind.MINUS_VAR, rnd)
            assertEquals("a - x = b 要搬两次", 2, p1.actions.count { it.type == EqActionType.MOVE })
            assertTrue("a - x = b 末态要左右对调", p1.flipSides)
            val mv = p1.actions.filter { it.type == EqActionType.MOVE }
            assertEquals("a - x 的第一步必须先把 -x 整块搬走", "x", mv[0].value)
            assertEquals(EqOp.SUB, mv[0].fromOp)
            assertEquals(EqOp.ADD, mv[0].toOp)
            // 第二步里那个数原本是首项（屏幕上不写符号）—— 换位显形之后才搬
            assertEquals("第二步之前先同侧换位显形", EqActionType.SWAP, p1.actions[1].type)
            assertEquals("换位后它已经写上符号了", EqOp.ADD, mv[1].srcOp)
            assertEquals(EqOp.ADD, mv[1].fromOp)
            assertEquals(EqOp.SUB, mv[1].toOp)

            val p2 = generateEqProblem(MoveKind.DIVIDE_VAR, rnd)
            assertEquals("a ÷ x = b 要搬两次", 2, p2.actions.count { it.type == EqActionType.MOVE })
            assertTrue("a ÷ x = b 末态要左右对调", p2.flipSides)
            val dv = p2.actions.filter { it.type == EqActionType.MOVE }
            assertEquals("a ÷ x 的第一步必须先把 ÷x 整块搬走", "x", dv[0].value)
            assertEquals(EqOp.DIV, dv[0].fromOp)
            assertEquals(EqOp.MUL, dv[0].toOp)
            assertEquals(EqActionType.SWAP, p2.actions[1].type)
            assertEquals("换位后它已经写上「×」了", EqOp.MUL, dv[1].srcOp)
            assertEquals(EqOp.MUL, dv[1].fromOp)
            assertEquals(EqOp.DIV, dv[1].toOp)

            val p3 = generateEqProblem(MoveKind.PLUS, rnd)
            assertEquals("x + a = b 只需搬一次", 1, p3.actions.size)
            assertTrue("x + a = b 不需要对调", !p3.flipSides)
        }
    }

    @Test
    fun crossMoveAlwaysFlipsWithinItsOwnFamily() {
        for (i in 1..200) {
            fun movesOf(k: MoveKind) = generateEqProblem(k).actions.filter { it.type == EqActionType.MOVE }
            assertEquals("加数过去必须变减", EqOp.SUB, movesOf(MoveKind.PLUS)[0].toOp)
            assertEquals("减数过去必须变加", EqOp.ADD, movesOf(MoveKind.MINUS)[0].toOp)
            assertEquals("乘数过去必须变除", EqOp.DIV, movesOf(MoveKind.TIMES)[0].toOp)
            assertEquals("除数过去必须变乘", EqOp.MUL, movesOf(MoveKind.DIVIDE)[0].toOp)
            assertEquals("显形后的加数过去变减", EqOp.SUB, movesOf(MoveKind.REVEAL_PLUS)[0].toOp)
            assertEquals("显形后的因数过去变除", EqOp.DIV, movesOf(MoveKind.REVEAL_TIMES)[0].toOp)
        }
    }

    // ── 文本 ──────────────────────────────────────────────────

    @Test
    fun textOutputMatchesOriginalSemantics() {
        for (kind in ALL_KINDS) {
            val p = generateEqProblem(kind)
            val txt = eqToText(p.initial)
            assertTrue("$kind：等式文本缺等号", txt.contains("="))
            // 文本里 x 的个数与原式里的未知数项一致（`5x` 也算一个）
            assertEquals(
                "$kind：x 个数对不上 —— $txt",
                p.initial.left.count { it.isVar } + p.initial.right.count { it.isVar },
                txt.count { it == 'x' },
            )
        }
        val p = generateEqProblem(MoveKind.PLUS)
        assertTrue("解答应是「x = a - b = c」形式", Regex("^x = \\d+ - \\d+ = \\d+$").matches(eqSolutionText(p)))
        // 系数要写进文本：3x ⇒ "3x"，1x ⇒ "x"
        assertEquals("3x", eqSideToText(listOf(term(null, "3x", true))))
        assertEquals("x", eqSideToText(listOf(term(null, "x", true))))
        // 代入 x 时系数必须算进去（否则验算会静默错）
        assertEquals("12", eqSideToText(listOf(term(null, "3x", true)), 4))
    }

    // ── 教材范围的数值上限 ─────────────────────────────────────

    @Test
    fun numbersStayInPrimarySchoolRange() {
        val rnd = Random(77)
        repeat(800) {
            val p = generateEqProblem(null, rnd)
            for (side in listOf(p.initial.left, p.initial.right)) {
                for (t in side) {
                    if (t.isVar) continue
                    val n = t.value.toInt()
                    val mul = p.kind == MoveKind.TIMES || p.kind == MoveKind.DIVIDE ||
                        p.kind == MoveKind.DIVIDE_VAR || p.kind == MoveKind.REVEAL_TIMES
                    if (mul) {
                        assertTrue("${p.kind}：$n 超出表内乘法范围（<= 81）", n <= 81)
                    } else {
                        assertTrue("${p.kind}：$n 超出 20 以内范围", n <= 20)
                    }
                }
            }
        }
    }

    // ── 分步解方程练习（默认 6 道）────────────────────────────

    /** 一步步首尾相接：第一步就是原式，最后一步落回 final，且「算出来」只出现在最后 */
    @Test
    fun solveStepsAreChainedFromInitialToFinal() {
        repeat(200) {
            val items = eqGenerateSolveItems(6)
            assertEquals("默认应生成 6 道", 6, items.size)
            for (it2 in items) {
                assertTrue("${it2.kindLabel}: 至少要有一问", it2.steps.isNotEmpty())
                assertEquals("${it2.kindLabel}: 第一步不是从原式开始", it2.initial, it2.steps[0].before)
                assertEquals("${it2.kindLabel}: 最后一步没落回最终形态", it2.final, it2.steps.last().after)
                // 第 k 步做完的样子，必须**逐字段等于**第 k+1 步开始的样子
                for (k in 0 until it2.steps.size - 1) {
                    assertEquals(
                        "${it2.kindLabel}: 第 ${k + 2} 步接不上第 ${k + 1} 步",
                        it2.steps[k].after,
                        it2.steps[k + 1].before,
                    )
                }
                val solveAt = it2.steps.mapIndexedNotNull { i, s -> if (s.type == EqStepType.SOLVE) i else null }
                assertEquals(
                    "${it2.kindLabel}: 「算出来」的步数与 solved 不符",
                    if (it2.solved) 1 else 0,
                    solveAt.size,
                )
                if (solveAt.isNotEmpty()) {
                    assertEquals("${it2.kindLabel}: 「算出来」必须是最后一步", it2.steps.size - 1, solveAt[0])
                }
            }
        }
    }

    /**
     * 每一步都是等价变形，且每一步的答案都跟「跨没跨等号线」严格一致。
     * ★ 13 种题型**逐个**扫 —— 确定性覆盖 threeTerms / bothSides / multiStep 这些结构题型
     *   （尤其是只有它们才有的 combine：靠随机抽签经常抽不到，必须钉死跑）。
     */
    @Test
    fun solveEveryStepIsAnEquivalentTransform() {
        for (kind in MoveKind.values()) {
            repeat(30) {
                val it2 = eqBuildSolveItem(kind)
                assertEquals("题型应原样带出", kind, it2.kind)
                it2.steps.forEachIndexed { k, s ->
                    val tag = "$kind 第 ${k + 1} 步(${s.type})"
                    stepKeepsValue(s, it2.x, tag)
                    checkStep(s, tag)
                }
            }
        }
        repeat(60) {
            for (it2 in eqGenerateSolveItems(6)) {
                it2.steps.forEachIndexed { k, s ->
                    val tag = "${it2.kindLabel} 第 ${k + 1} 步(${s.type})"
                    stepKeepsValue(s, it2.x, tag)
                    checkStep(s, tag)
                }
            }
        }
    }

    @Test
    fun solveAlwaysCoversFourBasicPlusOneStepPlusSameSide() {
        val stepKinds = listOf(
            MoveKind.MINUS_VAR, MoveKind.DIVIDE_VAR, MoveKind.REVEAL_PLUS, MoveKind.REVEAL_TIMES,
            MoveKind.X_RIGHT, MoveKind.THREE_TERMS, MoveKind.BOTH_SIDES, MoveKind.MULTI_STEP,
        )
        repeat(200) { round ->
            val kinds = eqGenerateSolveItems(6).map { it.kind }
            for (k in listOf(MoveKind.PLUS, MoveKind.MINUS, MoveKind.TIMES, MoveKind.DIVIDE)) {
                assertEquals("第 ${round + 1} 轮「$k」应当正好 1 道", 1, kinds.count { it == k })
            }
            assertTrue(
                "第 ${round + 1} 轮缺「要多步才解得完」的题",
                kinds.any { stepKinds.contains(it) },
            )
            assertEquals(
                "第 ${round + 1} 轮「同侧不变号」反例应当正好 1 道",
                1,
                kinds.count { it == MoveKind.SAME_SIDE },
            )
            assertEquals(6, kinds.size)
        }
    }

    @Test
    fun solveSameSideItemIsSingleStepAndUnsolved() {
        repeat(60) {
            val it2 = eqBuildSolveItem(MoveKind.SAME_SIDE)
            assertTrue("同侧反例题不该声称解出了 x", !it2.solved)
            assertEquals("同侧反例题只演一步", 1, it2.steps.size)
            assertEquals(EqStepType.SWAP, it2.steps[0].type)
            assertEquals("不变", it2.steps[0].answer)
            assertTrue("收尾文案要点明「同一侧」", it2.finalNote.contains("同一侧"))
            // 它确实**没有**把 x 解出来 —— 末态的 x 不孤单，还得再跨一次线
            assertTrue(
                "同侧反例题的末态不该已经只剩「x = 一个数」",
                it2.final.left.size + it2.final.right.size > 1,
            )
        }
    }

    /** 把答案代回**原式**必须成立；用两路裁判各算一遍（term 序列 + 渲染文本） */
    @Test
    fun solveAnswerBackInOriginalHolds() {
        fun check(it2: EqSolveItem) {
            val (l, r) = stateHolds(it2.initial, it2.answer, "${it2.kindLabel}: x=${it2.answer} 代回原式")
            assertEquals("${it2.kindLabel}: 代回原式应当两侧相等", l, r)
            if (it2.solved) {
                assertEquals("${it2.kindLabel}: 解出来后左边应当只剩一项", 1, it2.final.left.size)
                assertTrue("${it2.kindLabel}: 左边那一项应当就是 x", it2.final.left[0].isVar)
                assertEquals(
                    "${it2.kindLabel}: 解答文案应当与末态一致",
                    "x = ${eqSideToText(it2.final.right)} = ${it2.answer}",
                    it2.solution,
                )
                assertEquals(
                    "${it2.kindLabel}: 最后一步「算出来」的答案应当是 ${it2.answer}",
                    it2.answer.toString(),
                    it2.steps.last().answer,
                )
            }
        }
        for (kind in MoveKind.values()) repeat(30) { check(eqBuildSolveItem(kind)) }
        repeat(80) { for (it2 in eqGenerateSolveItems(6)) check(it2) }
    }

    @Test
    fun solveNumbersInPrimaryRange() {
        val cap = mapOf(
            MoveKind.TIMES to 81,
            MoveKind.DIVIDE to 81,
            MoveKind.DIVIDE_VAR to 81,
            MoveKind.REVEAL_TIMES to 81,
        )
        repeat(200) {
            for (it2 in eqGenerateSolveItems(6)) {
                val c = cap[it2.kind] ?: 20
                for (side in listOf(it2.initial.left, it2.initial.right, it2.final.left, it2.final.right)) {
                    for (t in side) {
                        if (t.isVar) continue
                        assertTrue("${it2.kindLabel}: ${t.value} 超出「$c 以内」范围", t.value.toInt() <= c)
                    }
                }
                assertTrue("${it2.kindLabel}: 解 ${it2.answer} 越界", it2.answer in 2..81)
            }
        }
    }

    @Test
    fun solveDiffersBetweenRounds() {
        val seen = mutableSetOf<String>()
        repeat(40) { seen.add(eqGenerateSolveItems(6).joinToString(" | ") { eqToText(it.initial) }) }
        assertTrue("40 轮只出现 ${seen.size} 种题组 —— 随机性不足", seen.size > 5)
    }

    @Test
    fun solveCountParameterDegradesGracefully() {
        repeat(60) {
            for (n in listOf(1, 2, 4, 5, 6, 8, 12)) {
                val items = eqGenerateSolveItems(n)
                assertEquals("n=$n 时应当正好生成 $n 道", n, items.size)
                if (n >= 4) {
                    val kinds = items.map { it.kind }.toSet()
                    for (k in listOf(MoveKind.PLUS, MoveKind.MINUS, MoveKind.TIMES, MoveKind.DIVIDE)) {
                        assertTrue("n=$n 缺 $k", kinds.contains(k))
                    }
                }
            }
        }
    }

    // ── 静态资料 ──────────────────────────────────────────────

    @Test
    fun staticTeachingDataIsComplete() {
        assertTrue("口诀至少要四块（新增多步方程）", EQ_RULES.size >= 4)
        for (r in EQ_RULES) {
            assertTrue("口诀卡缺标题", r.title.isNotBlank())
            assertTrue("口诀卡「${r.title}」没有内容行", r.lines.isNotEmpty())
            for (l in r.lines) assertTrue("口诀卡「${r.title}」有空白行", l.isNotBlank())
            // ★ 配图键打错的话渲染件会安静地什么都不画 ⇒ 这里当场拦住
            assertNotNull("口诀卡「${r.title}」的配图「${r.icon}」不在 MathIcons 里", MathIcons[r.icon])
        }
        // 首项显形这条规律必须写进口诀里
        assertTrue(
            "口诀里要讲清「首项不写符号」这件事",
            EQ_RULES.any { r -> r.lines.any { it.contains("不写符号") } },
        )

        assertTrue("易错卡至少 5 张（新增了首项显形与合并同类项两张）", EQ_MISTAKE_CASES.size >= 5)
        for (m in EQ_MISTAKE_CASES) {
            assertTrue(
                "易错卡缺字段：${m.title}",
                m.title.isNotBlank() && m.wrong.isNotBlank() && m.right.isNotBlank() &&
                    m.why.isNotBlank() && m.tip.isNotBlank(),
            )
            assertNotEquals("易错卡「${m.title}」的错式与对式不能相同", m.right, m.wrong)
            assertTrue("易错卡「${m.title}」应含推导箭头", m.wrong.contains("⇒") && m.right.contains("⇒"))
        }

        assertEquals("教材对比练习应有 4 道", 4, EQ_PRACTICE.size)
        for (item in EQ_PRACTICE) {
            assertEquals("练习「${item.before}」的答案符号不对", EqPracticeAnswer.Op(eqFlipOp(item.sym)), item.answer)
            assertTrue("练习「${item.before}」的 result 应含被搬的数", item.result.contains(item.num.toString()))
        }
    }

    @Test
    fun practiceCardsAreArithmeticallyTrue() {
        val expected = listOf(
            Triple("x + 8 = 14", 6, 14),
            Triple("x - 8 = 14", 22, 14),
            Triple("x × 8 = 16", 2, 16),
            Triple("x ÷ 8 = 16", 128, 16),
        )
        EQ_PRACTICE.forEachIndexed { i, item ->
            assertEquals(expected[i].first, item.before)
            assertEquals("练习「${item.before}」的解应为 ${expected[i].second}", expected[i].second, item.x)
            // ★ 用裁判 B 独立算一遍：移项后的算式必须正好等于卡片上写的解
            val b = item.before.substringAfter("= ").trim().toInt()
            val txt = "$b ${eqFlipOp(item.sym).sym} ${item.num}"
            assertEquals("${item.before}：移项后 $txt 应等于解 ${item.x}", item.x, evalTwoTermText(txt))
            assertTrue("${item.before} 的 result 应含最终答案 ${item.x}", item.result.contains("= ${item.x}"))
        }
    }

    @Test
    fun mistakeCardsReallyAreWrong() {
        // 把正确解代回**错误**变形式，必须真的不成立（否则这张卡在教错东西）
        // ① 2 + x = 8 ⇒ 解 6；错式 x - 2 = 8
        assertEquals(8, 2 + 6)
        assertNotEquals("2 + 6 = 8，原式的解就是 6；而 6 - 2 = 4 != 8 ⇒ 错式确实错了", 8, 6 - 2)
        assertEquals("正确变形 x + 2 = 8 应成立", 8, 6 + 2)

        // ② x - 6 = 10 ⇒ 解 16；错式误算成 10 - 6
        assertEquals(10, 16 - 6)
        assertNotEquals("把错解 4 代回原式：4 - 6 = -2 != 10 ⇒ 错式确实错了", 10, 4 - 6)

        // ③ 10 - x = 3 ⇒ 解 7；错式误算成 3 - 10
        assertEquals(3, 10 - 7)
        assertNotEquals("把错解 -7 代回原式：10 - (-7) = 17 != 3 ⇒ 错式确实错了", 3, 10 - (3 - 10))
        assertEquals("正确变形 x = 10 - 3 算出 7", 7, 10 - 3)

        // ④ 5 + x = 12 ⇒ 解 7；错式误算出 12 + 5 = 17（首项其实带着 +）
        assertEquals(12, 5 + 7)
        assertNotEquals("12 + 5 = 17 != 7 ⇒ 确实错了", 7, 12 + 5)
        assertEquals("对式「x = 12 - 5」算出 7", 7, 12 - 5)

        // ⑤ 5x = 3x + 6 ⇒ x = 3；错式 5x + 3x 会算出 8x
        assertEquals(3 * 3 + 6, 5 * 3)
        assertNotEquals("5*3 + 3*3 = 24 != 6 ⇒ 确实错了", 6, 5 * 3 + 3 * 3)
        assertEquals("对式「5x - 3x = 6」成立", 6, 5 * 3 - 3 * 3)

        // 文案对照
        assertTrue(EQ_MISTAKE_CASES[0].wrong.contains("x - 2 = 8"))
        assertTrue(EQ_MISTAKE_CASES[1].right.contains("10 + 6"))
        assertTrue(EQ_MISTAKE_CASES[2].right.contains("10 - 3"))
        assertTrue(EQ_MISTAKE_CASES[3].right.contains("12 - 5"))
        assertTrue(EQ_MISTAKE_CASES[4].right.contains("5x - 3x = 6"))
    }
}

private fun term(op: EqOp?, value: String, isVar: Boolean = false) = EqTerm(op, value, isVar)

/**
 * 每一项的「**语义**符号 + 值」—— 与显示形态无关，供同侧交换比对用。
 *
 * ⚠️ 不能直接拿 `t.op?.sym ?: ""` 拼串比：**首项不写符号是显示约定**，不代表它没符号。
 *    `5 + x` 的项是 [(null,"5"), (+,"x")]、`x + 5` 是 [(null,"x"), (+,"5")] ——
 *    两边符号其实都是「+」，但按显示形态拼串会得到 ["5","+x"] vs ["x","+5"]，排序后永远不等。
 *    这里独立复算一遍「首项没写符号时它到底带的是 + 还是 ×」（与引擎的 eqEffectiveOp 各写一份）。
 */
private fun signedTerms(side: EqSideList): List<String> = side.mapIndexed { i, t ->
    val op = t.op ?: run {
        val next = side.getOrNull(i + 1)
        if (next != null && (next.op == EqOp.MUL || next.op == EqOp.DIV)) EqOp.MUL else EqOp.ADD
    }
    "${op.sym}${t.value}"
}
