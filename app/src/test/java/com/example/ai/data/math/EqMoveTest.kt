package com.example.ai.data.math

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * 移项变号引擎单测 —— 核心判据：**每一次搬运都必须保持等式成立**。
 *
 * 两个**互相独立**的裁判给同一个数，才把「移项是合法的等价变形」从信仰变成证明：
 *   · 裁判 A：按 [EqTerm] 序列逐项求值（不复用引擎的任何算术与判据）
 *   · 裁判 B：把算式**渲染成文本**（如 `14 - 8`）再解析求值 —— 另一条实现路径，只认字符串
 *
 * 断言链：
 *   原式成立 → 每搬一步都还成立 → 搬的项只是符号取反、值一字未改 → 末态右侧求值 === x
 *   → 而且把答案代回**原式**也成立（证明解是对的）
 */

// ────────────────────────────────────────────────────────────
// 裁判 A：按 term 序列求值
// ────────────────────────────────────────────────────────────

private fun valueOf(t: EqTerm, xVal: Int): Int = if (t.isVar) xVal else t.value.toInt()

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

// ────────────────────────────────────────────────────────────
// 判据链
// ────────────────────────────────────────────────────────────

private fun checkProblem(p: MoveProblem, tag: String) {
    val where = "$tag【${p.kind}】${eqToText(p.initial)}"

    // ① 解是正整数 + 原式成立
    assertTrue("$where：解应为正整数，实为 ${p.x}", p.x > 0)
    assertEquals("$where：原式代入 x=${p.x} 后两边不等", evalSide(p.initial.left, p.x), evalSide(p.initial.right, p.x))

    // ② 每搬一步，等式都必须仍然成立（不只是首末态对）
    for ((i, a) in p.actions.withIndex()) {
        assertEquals(
            "$where 第 ${i + 1} 步搬运**前**等式不成立",
            evalSide(a.before.left, p.x), evalSide(a.before.right, p.x),
        )
        assertEquals(
            "$where 第 ${i + 1} 步搬运**后**等式不成立",
            evalSide(a.after.left, p.x), evalSide(a.after.right, p.x),
        )
        // ③ 搬的项只是符号取反，值一个字都没变
        assertEquals("$where 第 ${i + 1} 步：跨过等号后符号应为原符号取反", eqFlipOp(a.fromOp), a.toOp)
        val appended = if (a.from == EqSide.LEFT) a.after.right.last() else a.after.left.last()
        assertEquals("$where 第 ${i + 1} 步：搬到对面那一项的值不能变", a.value, appended.value)
    }

    if (!p.isSameSide) {
        // ④ 末态：x 单独在一边，另一边求值 === answer === x
        assertEquals("$where：末态左边应只剩一项", 1, p.final.left.size)
        assertTrue("$where：末态左边那一项必须是 x", p.final.left[0].isVar)
        assertEquals("$where：末态右边不得再含 x", 0, p.final.right.count { it.isVar })
        assertEquals("$where：末态右侧求值 != answer", evalSide(p.final.right, p.x), p.answer)
        assertEquals("$where：answer 必须等于解 x", p.x, p.answer)

        // ★ 裁判 B 交叉验算（另一条实现路径，只认文本）
        if (p.final.right.size == 2) {
            val txt = eqSideToText(p.final.right)
            assertEquals("$where：裁判 B 对「$txt」的求值与裁判 A 不一致", p.answer, evalTwoTermText(txt))
        }
        if (p.initial.left.size == 2 && p.initial.right.size == 1) {
            val l = eqSideToText(p.initial.left, p.x)
            val r = eqSideToText(p.initial.right, p.x)
            assertEquals("$where：裁判 B 认为原式不成立（$l vs $r）", evalTwoTermText(l), r.toInt())
        }
    } else {
        assertEquals("$where：同侧交换不该有任何搬运", 0, p.actions.size)
        assertEquals("$where：同侧交换的解就是 x 本身", p.x, p.answer)
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

    // ── 七种题型，逐一跑完整判据链 ─────────────────────────────

    @Test
    fun everyKindKeepsEqualityAtEveryStep() {
        val rnd = Random(20260929)
        for (kind in MoveKind.values()) {
            repeat(300) { i -> checkProblem(generateEqProblem(kind, rnd), "第${i + 1}题") }
        }
    }

    @Test
    fun mixedRandomAlsoPasses() {
        val rnd = Random(31)
        repeat(1000) { i -> checkProblem(generateEqProblem(null, rnd), "混合第${i + 1}题") }
    }

    @Test
    fun twoStepProblemsNeedTwoActionsAndFlipSides() {
        val rnd = Random(5)
        repeat(200) {
            val p1 = generateEqProblem(MoveKind.MINUS_VAR, rnd)
            assertEquals("a - x = b 要搬两次", 2, p1.actions.size)
            assertTrue("a - x = b 末态要左右对调", p1.flipSides)

            val p2 = generateEqProblem(MoveKind.DIVIDE_VAR, rnd)
            assertEquals("a ÷ x = b 要搬两次", 2, p2.actions.size)
            assertTrue("a ÷ x = b 末态要左右对调", p2.flipSides)

            val p3 = generateEqProblem(MoveKind.PLUS, rnd)
            assertEquals("x + a = b 只需搬一次", 1, p3.actions.size)
            assertTrue("x + a = b 不需要对调", !p3.flipSides)
        }
    }

    @Test
    fun sameSideExchangeChangesNothing() {
        val rnd = Random(9)
        repeat(200) {
            val p = generateEqProblem(MoveKind.SAME_SIDE, rnd)
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
        }
    }

    // ── 教材范围的数值上限 ─────────────────────────────────────

    @Test
    fun numbersStayInPrimarySchoolRange() {
        val rnd = Random(77)
        repeat(500) {
            val p = generateEqProblem(null, rnd)
            for (side in listOf(p.initial.left, p.initial.right)) {
                for (t in side) {
                    if (t.isVar) continue
                    val n = t.value.toInt()
                    if (p.kind == MoveKind.TIMES || p.kind == MoveKind.DIVIDE || p.kind == MoveKind.DIVIDE_VAR) {
                        assertTrue("${p.kind}：$n 超出表内乘法范围（<= 81）", n <= 81)
                    } else {
                        assertTrue("${p.kind}：$n 超出 20 以内范围", n <= 20)
                    }
                }
            }
        }
    }

    // ── 随机练习（5 道）────────────────────────────────────────

    @Test
    fun drillIsFiveItemsAndAllAnswersAreFlipped() {
        val rnd = Random(41)
        repeat(300) {
            val items = generateEqDrill(5, rnd)
            assertEquals("默认应生成 5 道", 5, items.size)
            for (it2 in items) {
                assertEquals(
                    "${it2.before}：把「${it2.sym.sym}」搬过等号应变成「${it2.sym.flip.sym}」",
                    eqFlipOp(it2.sym), it2.answer,
                )
            }
        }
    }

    @Test
    fun drillAlwaysCoversFourBasicRules() {
        val rnd = Random(11)
        repeat(300) {
            val syms = generateEqDrill(5, rnd).map { it.sym }.toSet()
            for (s in EqOp.values()) {
                assertTrue("缺少「${s.sym}」这一类题", syms.contains(s))
            }
        }
    }

    @Test
    fun drillAnswersVerifiedBySecondEvaluator() {
        val rnd = Random(7)
        val twoStep = Regex("^(\\d+) ([+×÷-]) x = (\\d+)$")
        repeat(300) {
            for (it2 in generateEqDrill(5, rnd)) {
                val m = twoStep.find(it2.before)
                if (m != null) {
                    // 两步型 a - x = b / a ÷ x = b：移项后 b 与 x 组合应还原出 a
                    val a = m.groupValues[1].toInt()
                    val b = m.groupValues[3].toInt()
                    val txt = "$b ${it2.answer.sym} ${it2.x}"
                    assertEquals("${it2.before}：移项后 $txt 应等于 $a", a, evalTwoTermText(txt))
                } else {
                    // 基本型 x op a = b：移项后 b 与 a 组合应等于解
                    val b = it2.before.substringAfter("= ").trim().toInt()
                    val txt = "$b ${it2.answer.sym} ${it2.num}"
                    assertEquals("${it2.before}：移项后 $txt 应等于解 ${it2.x}", it2.x, evalTwoTermText(txt))
                }
                assertTrue("${it2.before} 的 result 应含最终答案 ${it2.x}", it2.result.contains("= ${it2.x}"))
            }
        }
    }

    @Test
    fun drillNumbersInPrimaryRange() {
        val rnd = Random(13)
        repeat(300) {
            for (it2 in generateEqDrill(5, rnd)) {
                val b = it2.before.substringAfter("= ").trim().toInt()
                assertTrue("${it2.before}：等号右侧 $b 越界", b in 2..81)
                assertTrue("${it2.before}：被搬的数是 ${it2.num}，超出 2..9", it2.num in 2..9)
                assertTrue("${it2.before}：解 ${it2.x} 越界", it2.x in 2..81)
            }
        }
    }

    @Test
    fun drillDiffersBetweenRounds() {
        val rnd = Random(2026)
        val seen = mutableSetOf<String>()
        repeat(40) { seen.add(generateEqDrill(5, rnd).joinToString(" | ") { it.before }) }
        assertTrue("40 轮只出现 ${seen.size} 种题组 —— 随机性不足", seen.size > 5)
    }

    // ── 静态资料 ──────────────────────────────────────────────

    @Test
    fun staticTeachingDataIsComplete() {
        assertEquals("口诀应有三张卡", 3, EQ_RULES.size)
        for (r in EQ_RULES) {
            assertTrue("口诀卡缺标题", r.title.isNotBlank())
            assertTrue("口诀卡「${r.title}」没有内容行", r.lines.isNotEmpty())
            for (l in r.lines) assertTrue("口诀卡「${r.title}」有空白行", l.isNotBlank())
        }

        assertEquals("易错卡应有三张", 3, EQ_MISTAKE_CASES.size)
        for (m in EQ_MISTAKE_CASES) {
            assertTrue("易错卡缺字段：${m.title}", m.title.isNotBlank() && m.wrong.isNotBlank() &&
                m.right.isNotBlank() && m.why.isNotBlank() && m.tip.isNotBlank())
            assertTrue("易错卡「${m.title}」的错式与对式不能相同", m.wrong != m.right)
        }

        assertEquals("教材对比练习应有 4 道", 4, EQ_PRACTICE.size)
    }

    @Test
    fun practiceCardsAreArithmeticallyTrue() {
        for (it2 in EQ_PRACTICE) {
            assertEquals("${it2.before}：答案应为被搬符号取反", eqFlipOp(it2.sym), it2.answer)
            val b = it2.before.substringAfter("= ").trim().toInt()
            val txt = "$b ${it2.answer.sym} ${it2.num}"
            // ★ 用裁判 B 独立算一遍：移项后的算式必须正好等于卡片上写的解
            assertEquals("${it2.before}：移项后 $txt 应等于解 ${it2.x}", it2.x, evalTwoTermText(txt))
            assertTrue("${it2.before} 的 result 应含最终答案 ${it2.x}", it2.result.contains("= ${it2.x}"))
        }
    }

    @Test
    fun mistakeCardsReallyAreWrong() {
        // 把正确解代回**错误**变形式，必须真的不成立（否则这张卡在教错东西）
        // ① 2 + x = 8 ⇒ 解 6；错式 x - 2 = 8
        assertEquals(8, 2 + 6)
        assertTrue("2 + 6 = 8，原式的解就是 6；而 6 - 2 = 4 != 8 ⇒ 错式确实错了", 6 - 2 != 8)
        assertEquals("正确变形 x + 2 = 8 应成立", 8, 6 + 2)

        // ② x - 6 = 10 ⇒ 解 16；错式误算成 10 - 6
        assertEquals(10, 16 - 6)
        assertTrue("把错解 4 代回原式：4 - 6 = -2 != 10 ⇒ 错式确实错了", 4 - 6 != 10)

        // ③ 10 - x = 3 ⇒ 解 7；错式误算成 3 - 10
        assertEquals(3, 10 - 7)
        assertTrue("把错解 -7 代回原式：10 - (-7) = 17 != 3 ⇒ 错式确实错了", 10 - (3 - 10) != 3)
        assertEquals("正确变形 x = 10 - 3 算出 7", 7, 10 - 3)

        // 文案对照
        assertTrue(EQ_MISTAKE_CASES[0].wrong.contains("x - 2 = 8"))
        assertTrue(EQ_MISTAKE_CASES[1].right.contains("10 + 6"))
        assertTrue(EQ_MISTAKE_CASES[2].right.contains("10 - 3"))
    }
}
