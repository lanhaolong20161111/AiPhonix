package com.example.ai.data.math

import com.example.ai.ui.icon.MathIcons
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * 综合算式引擎单测 —— 核心判据：生成的每道题**数值必须自洽**。
 *
 * 用手法（移植自 web/src/lib/compoundExpr.test.ts）：
 *   ① 分步算式自身要算对（用本文件独立写的 evalStep 重算）
 *   ② 代入第①步得数后，第②步结果必须等于记录的 result
 *   ③ **综合算式 token 重新求值必须等于 answer** —— 且用**两个互相独立的裁判**交叉验算：
 *      · 裁判 A：本文件独立写的递归下降 evalTokens
 *      · 裁判 B：[Precedence.planSteps] 的逐步化简终点（另一份移植、另一套思路）
 *   两个不同实现给出同一个整数，才把「生成的题是对的」从信仰变成证明。
 *   ④ 括号判据必须与「不补括号会不会算错」一致（宁可自己重算一遍验证）
 */

// ────────────────────────────────────────────────────────────
// 裁判 A：独立递归下降求值（与本文件之外的实现无关）
// ────────────────────────────────────────────────────────────

private fun evalTokensByHand(tokens: List<ExprToken>): Int {
    var pos = 0
    fun peek(): ExprToken? = if (pos < tokens.size) tokens[pos] else null
    fun eat(): ExprToken = tokens[pos++]

    // ⚠️ 局部函数不能前向引用（Kotlin 与 JS 的差异）：最外层那个用 lateinit lambda 承接
    lateinit var parseExpr: () -> Int

    fun parseFactor(): Int {
        val t = peek() ?: throw AssertionError("意外的算式结束")
        if (t.text == "(") {
            eat()
            val v = parseExpr()
            val close = eat()
            assertEquals("括号不配对", ")", close.text)
            return v
        }
        eat()
        return t.text.toInt()
    }

    fun parseTerm(): Int {
        var left = parseFactor()
        while (true) {
            val p = peek() ?: break
            if (p.type != TokenType.OP || (p.text != "×" && p.text != "÷")) break
            val op = eat().text
            val right = parseFactor()
            left = if (op == "×") left * right else left / right
        }
        return left
    }

    parseExpr = {
        var left = parseTerm()
        while (true) {
            val p = peek() ?: break
            if (p.type != TokenType.OP || (p.text != "+" && p.text != "-")) break
            val op = eat().text
            val right = parseTerm()
            left = if (op == "+") left + right else left - right
        }
        left
    }

    val v = parseExpr()
    assertEquals("token 未全部消费完", tokens.size, pos)
    return v
}

/** 裁判 B：交给「运算优先级」引擎的逐步化简轨迹（另一份移植，思路完全不同） */
private fun evalTokensByPlan(tokens: List<ExprToken>): Int {
    val pt = tokens.map { PToken(it.text, it.type) }
    return finalValue(planSteps(pt))
}

/** 分步算式独立求值 */
private fun evalStep(a: Int, op: String, b: Int): Int = when (op) {
    "+" -> a + b
    "-" -> a - b
    "×" -> a * b
    "÷" -> a / b
    else -> throw IllegalArgumentException("未知运算符 $op")
}

private fun eq(exp: Int, act: Int, msg: String) = assertEquals(msg, exp.toLong(), act.toLong())

/** 生成必须成功（失败即断言失败；不能靠 JUnit 的 fail() 做 Elvis 右值 —— 它返回 Unit，类型会对不上） */
private fun mustProblem(kinds: List<CompoundKind>? = null, rnd: Random): CompoundProblem =
    generateProblem(kinds, rnd) ?: throw AssertionError("生成题目失败 kinds=$kinds")

/** 单题全面校验 */
private fun checkProblem(p: CompoundProblem) {
    val tag = "[${p.kind}]"

    // ① 分步算式必须算对；第②步里必须出现第①步的得数
    val s0 = p.steps[0]
    eq(evalStep(s0.a.text.toInt(), s0.op, s0.b.text.toInt()), s0.result, "$tag 第①步算式自身算错")
    assertTrue("$tag 第①步结果非正", s0.result > 0)

    val hasRef = p.steps[1].a.fromStep == 1 || p.steps[1].b.fromStep == 1
    assertTrue("$tag 第②步没有引用第①步的得数（无法「替换」）", hasRef)

    // ② 代入第①步得数后，第②步结果必须等于记录值
    val s1 = p.steps[1]
    val a2 = if (s1.a.fromStep == 1) s0.result else s1.a.text.toInt()
    val b2 = if (s1.b.fromStep == 1) s0.result else s1.b.text.toInt()
    val r2 = evalStep(a2, s1.op, b2)
    eq(r2, s1.result, "$tag 第②步结果错（代入得数后算不出记录值）")
    assertTrue("$tag 第②步结果非正", r2 > 0)

    // ③ 综合算式 token 求值必须等于最终结果（最重要的一条）—— 两个独立裁判
    val mergedA = evalTokensByHand(p.merged.tokens)
    eq(mergedA, p.merged.value, "$tag 综合算式求值（手写裁判）与记录值不符")
    eq(evalTokensByPlan(p.merged.tokens), mergedA, "$tag 两个独立裁判结果不一致")
    eq(mergedA, r2, "$tag 综合算式求值 ≠ 分步第②步结果")
    eq(p.answer, mergedA, "$tag answer 字段与综合式求值不符")

    // ④ 括号判据必须与「不补括号会不会算错」一致
    val bare = p.merged.tokens.filter { it.type != TokenType.PAREN }
    val bareVal = if (p.merged.parens.isNotEmpty()) evalTokensByHand(bare) else mergedA
    if (p.how.check.needParen) {
        assertTrue("$tag 判定需括号但 token 里没有括号", p.merged.parens.isNotEmpty())
        assertNotEquals(
            "$tag 判定需括号，但不加括号答案居然一样（判据可疑）",
            mergedA.toLong(), bareVal.toLong(),
        )
    } else {
        eq(p.merged.parens.size, 0, "$tag 判定不需括号但 token 里有括号")
    }

    // ⑤ 括号必须成对
    val bal = p.merged.tokens.sumOf {
        when (it.text) {
            "(" -> 1
            ")" -> -1
            else -> 0
        }
    }
    eq(bal, 0, "$tag 括号不配对")

    // ⑥ 数值规模适合三年级（两位数以内为主）
    for (s in p.steps) {
        assertTrue("$tag 数字过大 ${s.a.text}", s.a.text.toInt() <= 99)
        assertTrue("$tag 数字过大 ${s.b.text}", s.b.text.toInt() <= 99)
        assertTrue("$tag 结果过大 ${s.result}", s.result <= 99)
    }
}

// ────────────────────────────────────────────────────────────
// 测试
// ────────────────────────────────────────────────────────────

class CompoundExprTest {

    private val rnd = Random(20260922)

    @Test
    fun `单题 1000 道随机生成全部数值自洽`() {
        repeat(1000) {
            val p = mustProblem(rnd = rnd)
            checkProblem(p)
        }
    }

    @Test
    fun `分题型 每种题型的括号判据都正确`() {
        val kinds = listOf(
            CompoundKind.ADDSUB_THEN_MULDIV,
            CompoundKind.MULDIV_THEN_ADDSUB,
            CompoundKind.AS_DIVIDEND,
            CompoundKind.AS_SUBTRAHEND,
        )
        for (k in kinds) {
            repeat(200) {
                val p = mustProblem(listOf(k), rnd)
                assertEquals("指定题型 $k 却生成了 ${p.kind}", k, p.kind)
                checkProblem(p)
                // 题型与括号判据的固定对应关系
                if (k == CompoundKind.MULDIV_THEN_ADDSUB) {
                    eq(p.merged.parens.size, 0, "$k 不该有括号")
                } else {
                    assertTrue("$k 必须有括号", p.merged.parens.isNotEmpty())
                }
            }
        }
    }

    @Test
    fun `批量生成不重复`() {
        val ps = generateProblems(20, random = rnd)
        eq(20, ps.size, "批量生成数量不足")
        val sigs = ps.map { tokensToText(it.merged.tokens) }.toSet()
        eq(20, sigs.size, "批量生成出现重复题")
        ps.forEach { checkProblem(it) }
    }

    @Test
    fun `易错示例 每条都必须错误列式不等于正确列式`() {
        assertTrue("易错示例不足 6 条", MISTAKE_CASES.size >= 6)
        for (m in MISTAKE_CASES) {
            assertTrue("${m.title} 缺列式", m.wrong.isNotEmpty() && m.right.isNotEmpty())
            assertNotEquals("${m.title} 错误与正确列式一模一样", m.wrong, m.right)
            assertTrue("${m.title} 缺原因说明", m.why.length >= 8)
            assertTrue("${m.title} 缺口诀", m.tip.length >= 6)
            // ★ 卡片配图键打错的话渲染件会安静地什么都不画 ⇒ 这里当场拦住
            assertNotNull("易错卡「${m.title}」的配图「${m.icon}」不在 MathIcons 里", MathIcons[m.icon])
        }
    }

    @Test
    fun `题型中文名齐全`() {
        for (k in CompoundKind.entries) {
            assertTrue("缺题型名 $k", KIND_LABEL[k]?.isNotEmpty() == true)
            // ★ 题型行左边那个图标 —— 名字打错会静默变成空白
            assertNotNull(
                "$k 的配图「${KIND_ICON[k]}」不在 MathIcons 里",
                MathIcons[KIND_ICON[k].orEmpty()],
            )
        }
        eq(4, KIND_LABEL.size, "题型名条数与题型数不符")
    }

    @Test
    fun `口诀卡 每张都有标题内容行与配图`() {
        assertTrue("口诀卡太少（找→换→查 + 括号判据，至少 4 张）", RULES.size >= 4)
        for (r in RULES) {
            assertTrue("口诀卡缺标题", r.title.isNotBlank())
            assertTrue("口诀卡「${r.title}」没有内容行", r.lines.isNotEmpty())
            for (l in r.lines) assertTrue("口诀卡「${r.title}」有空白行", l.isNotBlank())
            assertNotNull("口诀卡「${r.title}」的配图「${r.icon}」不在 MathIcons 里", MathIcons[r.icon])
        }
    }

    @Test
    fun `同一题型的判据一致性 需括号的题去掉括号必须变值`() {
        val withParen = generateProblems(30, listOf(CompoundKind.ADDSUB_THEN_MULDIV), rnd)
        for (p in withParen) {
            val bare = p.merged.tokens.filter { it.type != TokenType.PAREN }
            assertNotEquals(
                "[${p.kind}] ${tokensToText(p.merged.tokens)} 去掉括号后答案不变，则不该判为「需括号」",
                p.merged.value.toLong(), evalTokensByHand(bare).toLong(),
            )
        }
    }

    @Test
    fun `动画不变量 换进来的部分必须是 a op b 连续整块`() {
        repeat(300) {
            val p = mustProblem(rnd = rnd)
            val idx = p.merged.tokens.mapIndexedNotNull { i, t -> if (t.fromFirst) i else null }
            assertTrue("[${p.kind}] fromFirst 的 token 不足 3 个（应为一整块算式）", idx.size >= 3)
            eq(
                idx.size,
                idx.last() - idx.first() + 1,
                "[${p.kind}] fromFirst 的 token 不连续 —— 动画里「换进来的部分」会看着是碎片",
            )
            assertEquals(
                "[${p.kind}] 整块中间那个不是运算符",
                TokenType.OP, p.merged.tokens[idx.first() + 1].type,
            )
        }
    }

    @Test
    fun `题面规范 加法不出现重复加数`() {
        repeat(400) {
            val p = mustProblem(rnd = rnd)
            for (s in p.steps) {
                if (s.op == "+") {
                    assertNotEquals(
                        "[${p.kind}] 出现重复加数 ${s.a.text} + ${s.b.text}",
                        s.a.text, s.b.text,
                    )
                }
            }
        }
    }

    @Test
    fun `巧合题拦截 需括号的题绝不能出现「漏括号也算对」`() {
        // ⚠️ web 源码注释里举的 4 × (14 + 7) 其实**不是**巧合题（注释本身是错的）：
        //    带括号 4 × 21 = 84，去括号 4 × 14 + 7 = 63 —— 两者不等，
        //    它恰恰是一个「去掉括号一定会变值」的**合格**题。
        //    流传的「恰好也等于 63」是把「去括号后的值」误当成了「两种写法同值」。
        val demo = listOf(
            ExprToken("4", TokenType.NUM),
            ExprToken("×", TokenType.OP, prec = OpPrec.MD),
            ExprToken("(", TokenType.PAREN),
            ExprToken("14", TokenType.NUM),
            ExprToken("+", TokenType.OP, prec = OpPrec.AS),
            ExprToken("7", TokenType.NUM),
            ExprToken(")", TokenType.PAREN),
        )
        eq(84, evalTokensByHand(demo), "4 × (14 + 7) 口算应为 84")
        eq(
            63,
            evalTokensByHand(demo.filter { it.type != TokenType.PAREN }),
            "去掉括号 4 × 14 + 7 应为 63",
        )
        assertNotEquals(
            "这题的括号判据成立（去括号必变值）",
            evalTokensByHand(demo).toLong(),
            evalTokensByHand(demo.filter { it.type != TokenType.PAREN }).toLong(),
        )

        // 引擎层面：需括号的题，去括号后求值必须与原值不同（否则学生漏括号也算对，题目失去意义）
        repeat(500) {
            val p = mustProblem(
                listOf(
                    CompoundKind.ADDSUB_THEN_MULDIV,
                    CompoundKind.AS_DIVIDEND,
                    CompoundKind.AS_SUBTRAHEND,
                ),
                rnd,
            )
            val bare = p.merged.tokens.filter { it.type != TokenType.PAREN }
            assertNotEquals(
                "[${p.kind}] 漏加括号也恰好算对（巧合题未被拦截）",
                p.merged.value.toLong(), evalTokensByHand(bare).toLong(),
            )
        }
    }

    @Test
    fun `rndInclusive 复刻 JS 语义 max 小于 min 时返回 min 而不抛错`() {
        // JS: min + Math.floor(random * (max - min + 1))，跨度为 0 时 floor 恒为 0
        repeat(50) {
            assertEquals("跨度 <= 0 应返回 min", 2, rndInclusive(2, 1, rnd))
            assertEquals("跨度 <= 0 应返回 min", 5, rndInclusive(5, 0, rnd))
        }
        // 正常区间必须落在闭区间内，且两端都能取到
        val seen = mutableSetOf<Int>()
        repeat(200) { seen.add(rndInclusive(3, 5, rnd)) }
        assertEquals("闭区间三个整数都应出现", setOf(3, 4, 5), seen)
    }

    @Test
    fun `per type 括号判据与 check reason 文案一致`() {
        repeat(100) {
            val p = mustProblem(rnd = rnd)
            assertEquals(
                "[${p.kind}] needParen 与 token 里是否有括号不一致",
                p.how.check.needParen, p.merged.parens.isNotEmpty(),
            )
            assertTrue("[${p.kind}] 缺 reason 文案", p.how.check.reason.length > 10)
            assertTrue("[${p.kind}] 缺 hint 文案", p.hint.length > 10)
            assertTrue("[${p.kind}] substitute 文本不该带括号", !p.how.substitute.contains('('))
        }
    }
}
