package com.example.ai.data.math

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * 运算优先级引擎单测
 *
 * 核心手法：**三个互相独立的裁判**交叉验算同一条化简轨迹
 *   ① 递归下降求值（[evalExpr]）
 *   ② 逐步化简的终点（[planSteps] → [finalValue]）
 *   ③ **另一份移植**：[CompoundExpr.evalTokens]（综合算式引擎里的独立求值器，思路与 ① 不同）
 * 三个不同思路的实现必须给出同一个整数 —— 这才把「轨迹一定对」从信仰变成证明。
 *
 * 另外对两组页内示例做**硬编码常量**断言（数值人工验算过，不依赖引擎自证）。
 *
 * ⚠️ Kotlin 与 JS 的一处关键差异：JS 的 `3 / 2 === 1.5`（非整数，能被 Number.isInteger 筛掉），
 * 而 Kotlin 的 Int 除法会**截断**成 1。所以随机造题的精筛不能照抄「isInteger」，
 * 必须改成「每一步的除法都整除」—— 否则截断会让「轨迹对」的证明变弱。
 */

// ────────────────────────────────────────────────────────────
// 裁判 ③：交给「另一份移植」的求值器（本文件与 precedence 之外）
// ────────────────────────────────────────────────────────────

private fun evalByOtherEngine(tokens: List<PToken>): Int =
    evalTokens(tokens.map { ExprToken(it.text, it.type) })

private fun eq(exp: Int, act: Int, msg: String) = assertEquals(msg, exp.toLong(), act.toLong())

private fun texts(tokens: List<PToken>): List<String> = tokens.map { it.text }

private fun expectIae(msg: String, block: () -> Unit) {
    try {
        block()
    } catch (_: IllegalArgumentException) {
        return
    }
    throw AssertionError("$msg：应当抛出 IllegalArgumentException 但没有")
}

// ────────────────────────────────────────────────────────────
// 示例题的硬编码断言（人工验算，防引擎自证）
// ────────────────────────────────────────────────────────────

class PrecedenceTest {

    private val rnd = Random(20260922)

    @Test
    fun `页内两组示例 顺序判据与结果必须等于人工验算的常量`() {
        data class Expect(val key: String, val firstOpIdx: Int, val firstOp: String, val firstWhy: PWhy, val answer: Int)

        val expects = listOf(
            Expect("diff", 3, "×", PWhy.HIGHER, 22),
            Expect("same", 1, "-", PWhy.SAME_LEVEL, 29),
        )
        for (e in expects) {
            val c = PR_DEMO_CASES.firstOrNull { it.key == e.key }
                ?: throw AssertionError("找不到示例 ${e.key}")

            // 人工验算的常量
            eq(e.answer, c.answer, "${e.key}: 答案常量被改动过？")
            eq(e.answer, evalExpr(c.tokens), "${e.key}: 求值与常量不一致")
            eq(e.answer, evalByOtherEngine(c.tokens), "${e.key}: 另一份移植与常量不一致")

            val steps = planSteps(c.tokens)
            eq(2, steps.size, "${e.key}: 两个运算符应化简两步")
            eq(e.firstOpIdx, steps[0].index, "${e.key}: 第一个该算的运算符下标错了")
            assertEquals("${e.key}: 第一个该算的运算符错了", e.firstOp, steps[0].op)
            assertEquals("${e.key}: 第一个该算的依据错了", e.firstWhy, steps[0].why)
            eq(e.answer, finalValue(steps), "${e.key}: 轨迹终点与常量不一致")
        }
    }

    @Test
    fun `4 + 6 × 3 加号在左边也轮不到它`() {
        val c = PR_DEMO_CASES[0]
        val steps = planSteps(c.tokens)
        assertEquals("应把同层的加号列出来（讲解要用）", listOf("+"), steps[0].siblings)
        assertEquals(listOf("4", "+", "6", "×", "3"), texts(steps[0].before))
        assertEquals(listOf("4", "+", "18"), texts(steps[0].after))
        assertEquals("第二步只剩加减，按同级从左往右", PWhy.SAME_LEVEL, steps[1].why)
        assertEquals(listOf("22"), texts(steps[1].after))
    }

    @Test
    fun `24 - 13 + 18 减法不比加法厉害 同级从左往右`() {
        val c = PR_DEMO_CASES[1]
        val steps = planSteps(c.tokens)
        assertEquals("两个都是加减，同层且同级", listOf("+"), steps[0].siblings)
        assertEquals(listOf("11", "+", "18"), texts(steps[0].after))
        eq(29, steps[1].value, "第二步的值")
    }

    @Test
    fun `括号里也要看优先级 (12 + 8 × 3) ÷ 4 = 9`() {
        // MISTAKE_CASES 里「括号里也要看优先级」那条，必须与下方算式文字一致
        val tokens = listOf(
            parenTok("("), numTok(12), opTok("+"), numTok(8), opTok("×"), numTok(3), parenTok(")"),
            opTok("÷"), numTok(4),
        )
        val steps = planSteps(tokens)
        assertEquals(listOf("×", "+", "÷"), steps.map { it.op })
        assertEquals(listOf(PWhy.PAREN, PWhy.PAREN, PWhy.SAME_LEVEL), steps.map { it.why })
        eq(24, steps[0].value, "括号里先乘除")
        eq(36, steps[1].value, "再算括号内加减")
        eq(9, finalValue(steps), "轨迹终点")
        eq(9, evalExpr(tokens), "递归下降")
        eq(9, evalByOtherEngine(tokens), "另一份移植")
    }

    @Test
    fun `nextOpIndex 两条规矩 级别高的压倒位置 同级取最左`() {
        eq(3, nextOpIndex(listOf(numTok(4), opTok("+"), numTok(6), opTok("×"), numTok(3))), "× 级别高，忽略它更靠右")
        eq(1, nextOpIndex(listOf(numTok(24), opTok("-"), numTok(13), opTok("+"), numTok(18))), "同级取最左的 -")
        eq(1, nextOpIndex(listOf(numTok(2), opTok("÷"), numTok(3), opTok("×"), numTok(4))), "乘除之间也取最左")
        eq(-1, nextOpIndex(listOf(numTok(7))), "没有运算符")
    }

    @Test
    fun `reduceAt 三个 token 并成一个 并把只包一个数的括号拆掉`() {
        val t = listOf(numTok(6), opTok("×"), numTok(3))
        assertEquals(listOf("18"), texts(reduceAt(t, 1)))
        assertTrue("化简产出的数要打上「已算出」标记", reduceAt(t, 1)[0].computed)

        // 括号里算完只剩一个数，这层括号就没用了，顺手拆掉
        val wrapped = listOf(
            parenTok("("), numTok(12), opTok("+"), numTok(24), parenTok(")"), opTok("÷"), numTok(4),
        )
        assertEquals(listOf("36", "÷", "4"), texts(reduceAt(wrapped, 2)))

        expectIae("两侧不是数字") { reduceAt(listOf(numTok(1), opTok("+"), parenTok("(")), 1) }
    }

    @Test
    fun `applyOp 与 isMd 与配色约定一致`() {
        eq(18, applyOp(6, "×", 3), "×")
        eq(11, applyOp(24, "-", 13), "-")
        eq(9, applyOp(36, "÷", 4), "÷")
        assertEquals(listOf(true, true), listOf("×", "÷").map { isMd(it) })
        assertEquals(listOf(false, false), listOf("+", "-").map { isMd(it) })
    }

    // ────────────────────────────────────────────────────────
    // 轨迹不变量（对随机算式成立）
    // ────────────────────────────────────────────────────────

    /**
     * 随机造一条算式：保证每一步都能整除成整数，否则返回 null 重摇。
     * 移植自 web precedence.test.ts 的 randTokens（精筛改为「每步整除」，见文件头说明）。
     */
    private fun randTokens(random: Random): List<PToken>? {
        val n = 3 + random.nextInt(3) // 3~5 个操作数
        val nums = List(n) { 1 + random.nextInt(9) }
        val opPool = listOf("+", "-", "×", "÷")
        val ops = List(n - 1) { opPool[random.nextInt(4)] }

        // 先粗筛：左往右的除法必须整除（省得大量无效样本）
        for (i in ops.indices) {
            if (ops[i] == "÷" && (nums[i + 1] == 0 || nums[i] % nums[i + 1] != 0)) return null
        }

        val flat = mutableListOf<PToken>()
        for (i in 0 until n) {
            flat.add(numTok(nums[i]))
            if (i < n - 1) flat.add(opTok(ops[i]))
        }

        // 半数样本随手套一层括号（只套一层、覆盖连续的一段操作数）
        if (random.nextDouble() < 0.5) {
            val a = random.nextInt(n - 1)
            val b = a + 1 + random.nextInt(n - 1 - a)
            flat.add(b * 2 + 1, parenTok(")"))
            flat.add(a * 2, parenTok("("))
        }

        // 精筛：套括号后每一步仍须整除，否则本样本作废
        return try {
            val steps = planSteps(flat)
            if (steps.isEmpty()) return null
            for (s in steps) {
                if (s.op == "÷") {
                    val l = s.left.toInt()
                    val r = s.right.toInt()
                    if (r == 0 || l % r != 0) return null
                }
            }
            evalExpr(flat)
            evalByOtherEngine(flat)
            flat
        } catch (_: Exception) {
            null
        }
    }

    @Test
    fun `随机 3000 例 三个独立裁判必须给出同一个结果`() {
        var checked = 0
        var i = 0
        while (i < 3000) {
            i++
            val t = randTokens(rnd) ?: continue
            checked++
            val a = evalExpr(t)
            val b = finalValue(planSteps(t))
            val c = evalByOtherEngine(t)
            eq(a, b, "逐步化简与递归下降不一致：${texts(t).joinToString(" ")}")
            eq(a, c, "另一份移植与递归下降不一致：${texts(t).joinToString(" ")}")
        }
        assertTrue("有效样本太少（$checked），随机造题被筛掉太多", checked >= 300)
    }

    @Test
    fun `轨迹不变量 下标合法 逐层收缩 终点只剩一个数`() {
        var checked = 0
        var i = 0
        while (i < 1200) {
            i++
            val t = randTokens(rnd) ?: continue
            checked++
            var prev = t
            val steps = planSteps(t)
            for (s in steps) {
                // before 必须接上上一轮的 after（轨迹是连续的，不是各算各的）
                assertEquals(texts(prev), texts(s.before))
                // 下标两侧必须是数字，否则动画会去「吃」括号或越界
                assertEquals(TokenType.OP, s.before[s.index].type)
                assertEquals(TokenType.NUM, s.before[s.index - 1].type)
                assertEquals(TokenType.NUM, s.before[s.index + 1].type)
                // 依据必须是真的：说「级别更高」，同层就得同时存在加减
                if (s.why == PWhy.HIGHER) {
                    val level = s.before.filterIndexed { k, x ->
                        x.type == TokenType.OP && !hasParenBetween(s.before, k, s.index)
                    }
                    assertTrue("说是「级别更高」却找不到更低一级的运算符", level.any { !isMd(it.text) })
                }
                // 化简必须真的变短
                assertTrue("化简后没有变短", s.after.size < s.before.size)
                prev = s.after
            }
            eq(1, prev.size, "轨迹终点不是单独一个数")
            assertEquals(TokenType.NUM, prev[0].type)
            eq(evalExpr(t), prev[0].text.toInt(), "终点值与原算式求值不一致")
        }
        assertTrue("有效样本太少（$checked）", checked >= 150)
    }

    /** 两个下标之间是否隔着括号边界（隔着就不同层，不参与「级别比较」） */
    private fun hasParenBetween(tokens: List<PToken>, a: Int, b: Int): Boolean {
        val lo = minOf(a, b)
        val hi = maxOf(a, b)
        for (i in lo + 1 until hi) if (tokens[i].type == TokenType.PAREN) return true
        return false
    }

    @Test
    fun `页内示例的练习资料自洽 错法答案必须与正解不同且数值可核`() {
        for (c in PR_DEMO_CASES) {
            assertTrue("${c.key} 缺 chip 文案", c.chip.isNotEmpty())
            assertTrue("${c.key} 缺 label 文案", c.label.isNotEmpty())
            assertTrue("${c.key} 缺错法文案", c.wrong.isNotEmpty())
            assertTrue("${c.key} 缺错因文案", c.wrongWhy.length > 8)
            assertTrue("${c.key} 应有 2 个运算符（化简两步）", planSteps(c.tokens).size == 2)
            eq(c.answer, evalExpr(c.tokens), "${c.key} 常量与引擎不一致")
        }
        // 不同级示例的「错法」必须真的算出 30（人工验算：(4+6)×3 = 30）
        eq(30, evalExpr(listOf(parenTok("("), numTok(4), opTok("+"), numTok(6), parenTok(")"), opTok("×"), numTok(3))), "错法 (4+6)×3 应为 30")
        assertNotEquals("两个示例不该是同一组", PR_DEMO_CASES[0].key, PR_DEMO_CASES[1].key)
    }
}
