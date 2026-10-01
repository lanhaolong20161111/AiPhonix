package com.example.ai.data.math

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * 多位数乘一位数引擎单测 —— 移植自 `web/src/lib/mulOne.test.ts`。
 *
 * ── 核心判据：一个积要能被**四条互不相干的路径**算出同一个数 ──
 *   裁判① 竖式逐位相乘（[moPlanSteps]，引擎实际用法：逐位乘、满十进位、把进位加回下一位）
 *   裁判② 直接交给语言运行时乘（[moProductOf]）
 *   裁判③ 分位展开相加（[moProductByExpansion]：100×6 + 30×6 + 7×6）
 *   裁判④ 把竖式**写下来的各位**重新拼回一个数（[moProductFromPlan]）
 *
 * ── 另外三件容易悄悄坏掉的事 ──
 *   · [moViewOf] 推出的**高亮区域必须指向真实存在的格子** —— 高亮指向一个还没写出来的格子，
 *     动画就会「发光发在空气上」，而截图里完全看不出来
 *   · 出题器产出的题必须**真的属于它宣称的题型**（判据 [moKindOf] 与生成器共用同一套）
 *   · 练习的每一步：选项互不重复、答案恰好出现一次、答案确实在选项里
 */
class MulOneTest {

    private val kinds = MoKind.entries.toList()

    private fun pow10(n: Int): Int {
        var v = 1
        repeat(n) { v *= 10 }
        return v
    }

    /** 全量样本：所有两三位数 × 2..9，共 7650 个轨迹 */
    private val allPlans: List<MoPlan> by lazy {
        (10..999).flatMap { v -> (2..9).map { f -> moPlanSteps(v, f) } }
    }

    // ── 口诀与中文数字 ──────────────────────────────────────

    @Test
    fun `中文数字：10 是一十、12 是十二、20 是二十`() {
        assertEquals("一十", moCnNum(10))
        assertEquals("十二", moCnNum(12))
        assertEquals("二十", moCnNum(20))
        assertEquals("二十四", moCnNum(24))
        assertEquals("九", moCnNum(9))
        assertEquals("八十一", moCnNum(81))
    }

    @Test
    fun `口诀：小数在前、不满十带「得」、有 0 就没有口诀`() {
        // ★ 教材口径是**小数在前**：「8 × 3」写「三八二十四」
        assertEquals("三八二十四", moChant(8, 3))
        assertEquals("三八二十四", moChant(3, 8))
        assertEquals("二三得六", moChant(2, 3))
        assertEquals("二三得六", moChant(3, 2))
        assertEquals("二五一十", moChant(5, 2))
        assertEquals("六九五十四", moChant(9, 6))
        // 有 0 的算式没有口诀（教材只说「0 乘任何数都得 0」）
        assertEquals("", moChant(0, 5))
        assertEquals("", moChant(5, 0))
    }

    @Test
    fun `各位数字从个位起，能拼回去`() {
        assertEquals(listOf(7, 2), moDigitsOf(27))
        assertEquals(listOf(0, 0, 1), moDigitsOf(100))
        assertEquals(listOf(0), moDigitsOf(0))
        assertEquals(listOf(9, 9, 9), moDigitsOf(999))
        for (n in 0..999) assertEquals("$n 拼回去不一致", n, moFromDigits(moDigitsOf(n)))
    }

    // ── 竖式轨迹的结构自洽 ──────────────────────────────────

    @Test
    fun `竖式结构自洽：sum = base + carryIn、write = sum 的个位、carryOut = sum 的十位`() {
        var n = 0
        for (p in allPlans) {
            assertEquals("个位的 carryIn 必须为 0", 0, p.steps[0].carryIn)
            for ((i, s) in p.steps.withIndex()) {
                assertEquals("${p.value}×${p.factor} 第 $i 位 place", i, s.place)
                assertEquals("被乘数这一位的数字", p.digits[i], s.digit)
                assertEquals("base 必须是这一位数字乘一位数", s.digit * p.factor, s.base)
                if (i > 0) assertEquals("carryIn 必须来自右一位的 carryOut", p.steps[i - 1].carryOut, s.carryIn)
                assertEquals("★ sum ≠ base + carryIn", s.sum, s.base + s.carryIn)
                assertEquals("write 必须是 sum 的个位", s.sum % 10, s.write)
                assertEquals("carryOut 必须是 sum 的十位", s.sum / 10, s.carryOut)
                assertTrue("write 必须是一位数", s.write in 0..9)
                // ★ carryOut 可以是 2..8，不是只有 0/1 —— 这是「满几十只进 1」这个高频错的源头
                assertTrue("carryOut 越界：${s.carryOut}", s.carryOut in 0..8)
                if (s.digit == 0) assertEquals("0 的算式没有口诀", "", s.chant)
                else assertTrue("口诀不能空", s.chant.isNotEmpty())
                n++
            }
        }
        assertTrue("样本太少：$n", n > 20000)
    }

    @Test
    fun `★ 四个裁判对拍：四条互不相干的路径必须给出同一个积`() {
        for (p in allPlans) {
            val a = p.product
            val b = moProductOf(p.value, p.factor)
            val c = moProductByExpansion(p.value, p.factor)
            val d = moProductFromPlan(p)
            assertEquals("${p.value}×${p.factor}：竖式 vs 直接乘", b, a)
            assertEquals("${p.value}×${p.factor}：分位展开 vs 直接乘", c, a)
            assertEquals("${p.value}×${p.factor}：把写下的各位拼回去 vs 直接乘", d, a)
        }
    }

    @Test
    fun `积的位数：grewTop 恰好对应「积比被乘数多一位」`() {
        for (p in allPlans) {
            assertEquals("resultDigits 长度 = steps 长度 + grewTop", p.steps.size + if (p.grewTop) 1 else 0, p.resultDigits.size)
            val productDigits = moDigitsOf(p.product).size
            val wantTop = productDigits > moDigitsOf(p.value).size
            assertEquals("${p.value}×${p.factor} 的 grewTop", wantTop, p.grewTop)
            assertEquals("cols 应为两者较大者", maxOf(moDigitsOf(p.value).size, p.resultDigits.size), p.cols)
        }
    }

    @Test
    fun `★ 时间轴合法：add 只在真进位时出现、carry 只在真进位时出现、place 单调不减`() {
        for (p in allPlans) {
            var lastPlace = -1
            for (node in p.timeline) {
                assertEquals("timeline 的 index 必须与下标一致", p.timeline.indexOf(node), node.index)
                assertTrue("place 不许回退", node.place >= lastPlace)
                lastPlace = node.place
                val s = p.steps[node.place]
                when (node.beat) {
                    MoBeat.MUL, MoBeat.WRITE -> Unit
                    MoBeat.ADD -> assertTrue("没有进位就不该有「加」这一拍", s.carryIn > 0)
                    MoBeat.CARRY -> assertTrue("没有进位就不该有「进」这一拍", s.carryOut > 0)
                    else -> throw AssertionError("timeline 里不该出现 ${node.beat}")
                }
            }
            // 每一位都必须有「乘」和「写」
            for (s in p.steps) {
                val nodes = p.timeline.filter { it.place == s.place }
                assertEquals("每一位必须以「乘」开头", MoBeat.MUL, nodes.first().beat)
                assertTrue("每一位必须有「写」", nodes.any { it.beat == MoBeat.WRITE })
                assertEquals(
                    "「加/进」两拍的出现必须与 carryIn/carryOut 完全对应",
                    2 + (if (s.carryIn > 0) 1 else 0) + (if (s.carryOut > 0) 1 else 0),
                    nodes.size,
                )
            }
        }
    }

    @Test
    fun `beatStateAt：越界安全落 idle done`() {
        val p = moPlanSteps(27, 4)
        val total = p.timeline.size
        val before = moBeatStateAt(p, -1)
        assertEquals(MoBeat.IDLE, before.beat)
        assertEquals(-1, before.index)
        assertEquals(total, before.total)
        val at0 = moBeatStateAt(p, 0)
        assertEquals(0, at0.index)
        assertEquals(MoBeat.MUL, at0.beat)
        val after = moBeatStateAt(p, total)
        assertEquals(MoBeat.DONE, after.beat)
        assertEquals(total, after.index)
        val wayAfter = moBeatStateAt(p, total + 99)
        assertEquals(MoBeat.DONE, wayAfter.beat)
        assertEquals(total, wayAfter.index)
    }

    // ── ★ viewOf：高亮必须指向真实存在的格子 ────────────────

    @Test
    fun `★ viewOf 全 index 扫描：结果行单调填满，进位槽只在送到时出现`() {
        for (p in allPlans) {
            val total = p.timeline.size
            var prev: List<Int?> = List(p.resultDigits.size) { null }
            for (idx in -1..total) {
                val v = moViewOf(p, idx)
                assertEquals("total 必须与 timeline 一致", total, v.total)
                assertEquals("结果行长度 = resultDigits 长度", p.resultDigits.size, v.resultCells.size)
                assertEquals("进位槽长度 = steps 长度", p.steps.size, v.carryCells.size)

                // ① 结果行不回退也不擦除：一旦写下就一直在
                for (i in v.resultCells.indices) {
                    val now = v.resultCells[i]
                    if (prev[i] != null) {
                        assertEquals("${p.value}×${p.factor} 第 $idx 拍把已写下的第 $i 位擦掉了", prev[i], now)
                    }
                }
                // ② 每一格写下的数必须与轨迹一致
                for (i in v.resultCells.indices) {
                    val shown = v.resultCells[i]
                    if (shown != null) assertEquals("第 $i 格写错", p.resultDigits[i], shown)
                }
                // ③ 进位槽里的数只能来自轨迹
                for (i in v.carryCells.indices) {
                    val c = v.carryCells[i]
                    if (c != null) assertEquals("第 $i 个进位槽装错", p.steps[i].carryIn, c)
                }
                prev = v.resultCells
            }
            // ④ ★ 播完之后结果行必须**写满**（web 曾在这里丢过数字）
            val done = moViewOf(p, total)
            assertTrue("播完之后应当 finished", done.finished)
            assertEquals("播完之后结果行必须写满", p.resultDigits.map { it as Int? }, done.resultCells)
            for (i in p.steps.indices) {
                if (p.steps[i].carryIn > 0) assertEquals("播完之后进位槽应当都露出来", p.steps[i].carryIn, done.carryCells[i])
            }
        }
    }

    @Test
    fun `★ 高亮永远指向真实存在的格子（高亮发在空气上截图看不出来）`() {
        for (p in allPlans) {
            for (idx in -1..p.timeline.size) {
                val v = moViewOf(p, idx)
                val hl = v.hl
                val tag = "${p.value}×${p.factor}@$idx(${v.beat})"
                hl.digit?.let { assertTrue("$tag 高亮的被乘数位越界：$it", it in p.digits.indices) }
                hl.write?.let {
                    assertTrue("$tag 高亮的结果格越界：$it", it in v.resultCells.indices)
                    assertTrue("$tag 高亮了一格还没写出来的结果格", v.resultCells[it] != null)
                    assertEquals("$tag 高亮格与轨迹不符", p.steps[it].write, v.resultCells[it])
                }
                hl.carryIn?.let {
                    assertTrue("$tag 高亮的进位槽越界：$it", it in v.carryCells.indices)
                    assertTrue("$tag 高亮了一个空进位槽", v.carryCells[it] != null)
                }
                // 每拍都必须有话讲（除了极短的起始态也要有台词）
                assertTrue("$tag 没有台词", v.say.isNotEmpty())
                // 提醒行只在真有内容时才非空，且不许混进 markdown 星号
                assertFalse("$tag 的提醒混进了星号", v.warn.contains("**"))
                assertFalse("$tag 的台词混进了星号", v.say.contains("**"))
            }
        }
    }

    @Test
    fun `「加进位」那一拍必须把 base + carryIn 讲出来`() {
        val p = moPlanSteps(39, 6) // 个位 9×6=54 进 5；十位 3×6+5=23
        val addIdx = p.timeline.indexOfFirst { it.beat == MoBeat.ADD }
        assertTrue("39×6 应当有「加进位」这一拍", addIdx >= 0)
        val v = moViewOf(p, addIdx)
        assertEquals(1, v.place)
        assertTrue("台词里应当出现 18 + 5 = 23，实际：${v.say}", v.say.contains("18 + 5 = 23"))
        mapOf(1 to 5).forEach { (slot, want) -> assertEquals(want, v.carryCells[slot]) }
        assertEquals(1, v.hl.carryIn)
        assertTrue("这一步必须给出易错提醒", v.warn.isNotEmpty())
    }

    @Test
    fun `「进」那一拍：中间位指左一格、最高位变成积新一位`() {
        val p = moPlanSteps(39, 6)
        val carryIdx = p.timeline.indexOfFirst { it.beat == MoBeat.CARRY }
        val v = moViewOf(p, carryIdx)
        assertEquals(0, v.place)
        assertEquals("应当高亮左边那一格的进位槽", 1, v.hl.carryIn)
        assertEquals("送过去的数应当是 5", 5, v.carryCells[1])

        // 最高位的「进」：积多出一位
        val q = moPlanSteps(38, 3) // 8×3=24 进 2；3×3+2=11 进 1 ⇒ 114
        val topIdx = q.timeline.indexOfLast { it.beat == MoBeat.CARRY }
        val w = moViewOf(q, topIdx)
        assertEquals(1, w.place)
        assertTrue("最高位的进位应当点亮「积新长出来的那一格」", w.hl.topCarry)
        assertEquals("新那一位应当是 1（就是结果的最高位）", 1, w.resultCells.last())
    }

    // ── 已知案例逐个钉死 ────────────────────────────────────

    @Test
    fun `已知案例逐个钉死`() {
        data class C(val v: Int, val f: Int, val product: Int, val digitsLe: List<Int>, val grewTop: Boolean, val run: Int, val kind: MoKind)

        val cases = listOf(
            C(38, 2, 76, listOf(6, 7), false, 1, MoKind.CARRY),
            C(38, 3, 114, listOf(4, 1, 1), true, 2, MoKind.CARRY_CHAIN),
            C(137, 6, 822, listOf(2, 2, 8), false, 2, MoKind.CARRY_CHAIN),
            C(305, 6, 1830, listOf(0, 3, 8, 1), true, 1, MoKind.MID_ZERO),
            C(280, 3, 840, listOf(0, 4, 8), false, 1, MoKind.TAIL_ZERO),
            C(403, 2, 806, listOf(6, 0, 8), false, 0, MoKind.MID_ZERO),
            C(999, 9, 8991, listOf(1, 9, 9, 8), true, 3, MoKind.CARRY_CHAIN),
            C(220, 5, 1100, listOf(0, 0, 1, 1), true, 2, MoKind.TAIL_ZERO),
            C(21, 3, 63, listOf(3, 6), false, 0, MoKind.NO_CARRY),
            C(132, 3, 396, listOf(6, 9, 3), false, 0, MoKind.NO_CARRY),
        )
        for (c in cases) {
            val p = moPlanSteps(c.v, c.f)
            assertEquals("${c.v}×${c.f} 的积", c.product, p.product)
            assertEquals("${c.v}×${c.f} 写下来的各位", c.digitsLe, p.resultDigits)
            assertEquals("${c.v}×${c.f} 的 grewTop", c.grewTop, p.grewTop)
            assertEquals("${c.v}×${c.f} 的最长进位连段", c.run, moMaxCarryRun(p.steps))
            assertEquals("${c.v}×${c.f} 的题型", c.kind, moKindOf(p))
        }
    }

    @Test
    fun `错答生成器的已知值（人工算过）`() {
        // 27×4 = 108，漏加进位 ⇒ 88
        assertEquals(88, moDroppingCarries(27, 4))
        // 68×4 = 272，每处只进 1 ⇒ 252（最高位整块写下，不套这条错规则）
        assertEquals(252, moCarryOneOnly(68, 4))
        // 305×6 = 1830，0 位直接写 0 ⇒ 1800；漏加进位 ⇒ 800
        assertEquals(1800, moZeroDropsCarry(305, 6))
        assertEquals(800, moDroppingCarries(305, 6))
        // ★ 退化：202×5 每一位都漏加进位，写下来正好是 0（必须被滤掉，不许进选项）
        assertEquals(0, moDroppingCarries(202, 5))
        assertEquals(0, moDroppingCarries(220, 5))
        // 38×2 = 76，漏加进位 ⇒ 66
        assertEquals(66, moDroppingCarries(38, 2))
        // 39×6 = 234，每处只进 1 ⇒ 194（个位 54 只进 1，十位 18+1=19 ⇒ 4 | 9 | 最高位 1）
        assertEquals(194, moCarryOneOnly(39, 6))
        // 没有进位的题，两个生成器都不会给出「不同的答案」（所以不该产生错答）
        assertEquals(63, moDroppingCarries(21, 3))
        assertEquals(63, moCarryOneOnly(21, 3))
        assertEquals(63, moZeroDropsCarry(21, 3))
    }

    @Test
    fun `maxCarryRun 手算例`() {
        assertEquals(0, moMaxCarryRun(moPlanSteps(132, 3).steps))
        assertEquals(1, moMaxCarryRun(moPlanSteps(38, 2).steps))
        assertEquals(2, moMaxCarryRun(moPlanSteps(137, 6).steps))
        assertEquals(3, moMaxCarryRun(moPlanSteps(999, 9).steps))
    }

    // ── 出题器 ─────────────────────────────────────────────

    @Test
    fun `★ 出题器：每型 300 道，必须真的属于该型，且题面自洽`() {
        for (kind in kinds) {
            repeat(300) { i ->
                val p = moGenProblem(kind, Random(kind.ordinal * 1000 + i))
                val tag = "${kind.key} 抽到 ${p.value}×${p.factor}"
                assertEquals("$tag 不属于本型", kind, moKindOf(p.plan))
                assertEquals("$tag 的题面", "${p.value} × ${p.factor} = ?", p.fullText)
                assertEquals("$tag 的积", moProductOf(p.value, p.factor), p.product)
                assertTrue("$tag 被乘数必须 ≥ 10", p.value >= 10)
                assertTrue("$tag 一位数必须在 2..9", p.factor in 2..9)
                assertTrue("$tag 结语不能空", p.finalNote.isNotEmpty())
                assertFalse("$tag 结语混进星号", p.finalNote.contains("**"))
            }
        }
    }

    @Test
    fun `出题器：兜底题也必须自证属于本组（不允许悄悄换题型）`() {
        // 直接验兜底表：它对每种题型都必须真的成立，否则 moGenPlan 会抛错
        for (kind in kinds) {
            // 反复换种子抽，覆盖到兜底路径以外的正常路径
            val plans = (0 until 60).map { moGenPlan(kind, Random(it)) }
            for (p in plans) assertEquals("兜底或抽出题不属于 ${kind.key}", kind, moKindOf(p))
        }
    }

    @Test
    fun `genProblemSet：一组内不重复，且每道都对`() {
        for (kind in kinds) {
            val set = moGenProblemSet(kind, 4, Random(20261001))
            assertEquals("${kind.key} 应当抽到 4 道", 4, set.size)
            val tags = set.map { "${it.value}-${it.factor}" }
            assertEquals("${kind.key} 一组内出现了重复题", tags.size, tags.toSet().size)
            for (p in set) {
                assertEquals(moKindOf(p.plan), kind)
                assertEquals(moProductOf(p.value, p.factor), p.product)
            }
        }
    }

    // ── 一步一填 ───────────────────────────────────────────

    @Test
    fun `★ 练习：选项互不重复、答案恰好一次、无 markdown 星号、末步就是「积」`() {
        for (kind in kinds) {
            repeat(120) { i ->
                val p = moGenProblem(kind, Random(i * 37 + kind.ordinal))
                val tag = "${kind.key} ${p.fullText}"
                assertTrue("$tag 应当至少 3 步", p.solveSteps.size >= 3)
                for (s in p.solveSteps) {
                    assertTrue("$tag 的选项少于 2 个", s.options.size >= 2)
                    assertEquals("$tag 的选项有重复：${s.options}", s.options.size, s.options.toSet().size)
                    assertEquals("$tag 的答案必须恰好出现一次：${s.key}=${s.answer}", 1, s.options.count { it == s.answer })
                    assertTrue("$tag 的 tip 不能空", s.tip.isNotEmpty())
                    for (t in listOf(s.ask, s.tip) ) assertFalse("$tag 混进星号：$t", t.contains("**"))
                    for (o in s.options) assertFalse("$tag 的选项混进星号：$o", o.contains("**"))
                }
                // 键不许重复（web 曾出现 final, final）
                val keys = p.solveSteps.map { it.key }
                assertEquals("$tag 的步骤键重复：$keys", keys.size, keys.toSet().size)
                // ★ 末步问的就是「积」
                assertEquals("$tag 的末步应当是「积」", p.product.toString(), p.solveSteps.last().answer)
            }
        }
    }

    @Test
    fun `★ 竖式路线的「乘」那一步答案必须等于引擎的 sum`() {
        for (kind in kinds) {
            repeat(120) { i ->
                val p = moGenProblem(kind, Random(i + 11 + kind.ordinal * 100))
                if (p.tail != null) return@repeat // 末尾有 0 走巧算三问，没有逐位的「乘」
                for (s in p.plan.steps) {
                    val step = p.solveSteps.firstOrNull { it.key == "mul${s.place}" }
                    if (step != null) {
                        assertEquals(
                            "${p.value}×${p.factor} 第 ${s.place} 位的「乘」选项答案与轨迹不符",
                            s.sum.toString(),
                            step.answer,
                        )
                    }
                }
            }
        }
    }

    @Test
    fun `★ 末尾有 0 的题必须走巧算三问，且第三步就是积`() {
        val p = moGenProblem(MoKind.TAIL_ZERO, Random(3))
        assertTrue("末尾有 0 应当给出巧算提示", p.tail != null)
        assertEquals(listOf("core", "zeros", "final"), p.solveSteps.map { it.key })
        assertEquals(MoKind.TAIL_ZERO, p.groupKey)
        val t = p.tail!!
        assertEquals("core × factor 必须自洽", t.core * p.factor, t.coreProduct)
        assertEquals("补 0 后必须等于积", p.product, t.coreProduct * 10.let { var v = 1; repeat(t.zeros) { v *= 10 }; v })
        assertEquals(p.product.toString(), p.solveSteps.last().answer)

        // 全量：所有末尾有 0 的题都走巧算路线
        for (kind in kinds) {
            repeat(60) {
                val q = moGenProblem(kind, Random(it))
                if (q.tail != null) assertEquals("${q.value}×${q.factor} 应当走巧算", listOf("core", "zeros", "final"), q.solveSteps.map { it.key })
            }
        }
    }

    @Test
    fun `★ 「忘加进位」这个最高频错答必须进「乘」的选项`() {
        var seen = 0
        for (kind in kinds) {
            repeat(200) { i ->
                val p = moGenProblem(kind, Random(i * 13 + 5))
                for (s in p.plan.steps) {
                    if (s.carryIn == 0) continue
                    val step = p.solveSteps.firstOrNull { it.key == "mul${s.place}" } ?: continue
                    assertTrue(
                        "${p.value}×${p.factor} 第 ${s.place} 位的选项里应当有「漏加进位」的 ${s.base}：${step.options}",
                        step.options.contains(s.base.toString()),
                    )
                    seen++
                }
            }
        }
        assertTrue("漏加进位的样本太少：$seen", seen > 200)
    }

    @Test
    fun `★ 退化的错答（0）不许进选项：问积的那一步不能出现「0」`() {
        val p = moBuildProblem(moPlanSteps(202, 5), MoKind.MID_ZERO, Random(1))
        assertEquals("202×5 漏加进位写下来正好是 0", 0, moDroppingCarries(202, 5))
        for (t in p.traps) assertNotEquals("退化的 0 不许当错答", 0, t.value)
        val final = p.solveSteps.firstOrNull { it.key == "final" }
        assertTrue("应当有收尾的「写完整」一步", final != null)
        assertFalse("问积的选项里不该出现 0：${final!!.options}", final.options.contains("0"))
        assertTrue(final.options.contains(p.product.toString()))

        // 全量兜底：任何题型的收尾步都不许出现 0
        for (kind in kinds) {
            repeat(100) { i ->
                val q = moGenProblem(kind, Random(i + 300))
                val last = q.solveSteps.last()
                assertFalse("${kind.key} ${q.value}×${q.factor} 的收尾选项里出现了 0：${last.options}", last.options.contains("0"))
                for (t in q.traps) assertTrue("${kind.key} ${q.value}×${q.factor} 的错答不是正整数", t.value > 0)
            }
        }
    }

    // ── 错答讲解（traps）────────────────────────────────────

    @Test
    fun `traps：错答与正确答案不同、是正整数、且文案点出原因`() {
        for (kind in kinds) {
            repeat(120) { i ->
                val p = moGenProblem(kind, Random(i * 17 + kind.ordinal))
                for (t in p.traps) {
                    assertNotEquals("${kind.key} ${p.value}×${p.factor} 的错答与正确答案相同", p.product, t.value)
                    assertTrue("错答应当是正整数", t.value > 0)
                    assertTrue("错答必须带解释", t.why.isNotEmpty() && t.label.isNotEmpty())
                    assertFalse("错答解释里混进了 markdown 星号", t.why.contains("**"))
                }
                // 同一个错答不许出现两次
                val vals = p.traps.map { it.value }
                assertEquals("${kind.key} ${p.value}×${p.factor} 的错答重复了", vals.size, vals.toSet().size)
            }
        }
    }

    @Test
    fun `★ 错答必须真的来自那三个生成器 —— 不许手写一个「看起来像」的数字`() {
        var checked = 0
        for (kind in kinds) {
            repeat(120) { i ->
                val p = moGenProblem(kind, Random(i * 23 + kind.ordinal))
                val allowed = setOf(
                    moDroppingCarries(p.value, p.factor),
                    moCarryOneOnly(p.value, p.factor),
                    moZeroDropsCarry(p.value, p.factor),
                ).filter { it > 0 }.toSet()
                for (t in p.traps) {
                    assertTrue(
                        "${p.value}×${p.factor} 的错答 ${t.value} 不在三个生成器的输出里（可能是手写的）",
                        allowed.contains(t.value),
                    )
                    assertEquals("错答标签与数值对不上", "算成 ${t.value}", t.label)
                    checked++
                }
            }
        }
        assertTrue("错答抽样太少（$checked）", checked > 40)
    }

    // ── 巧算 ───────────────────────────────────────────────

    @Test
    fun `tailZeroHint：只有末尾有 0 才给，且能还原被乘数`() {
        assertNull(moTailZeroHint(28, 3))
        assertNull(moTailZeroHint(123, 4))
        for (v in listOf(10, 20, 100, 280, 160, 1200, 330)) {
            val h = moTailZeroHint(v, 3)!!
            assertEquals("还原 $v", v, h.core * 10.let { var x = 1; repeat(h.zeros) { x *= 10 }; x })
            assertNotEquals("core 不该还带 0", 0, h.core % 10)
            assertEquals("coreProduct", h.core * 3, h.coreProduct)
        }
    }

    // ── 静态资料 ───────────────────────────────────────────

    @Test
    fun `易错案例逐条重算：wrong 与 right 必须能对上引擎`() {
        var checked = 0
        for (c in MO_MISTAKE_CASES) {
            assertNotEquals(c.wrong, c.right)
            assertTrue("why/tip 不能为空", c.why.isNotEmpty() && c.tip.isNotEmpty())
            for (s in listOf(c.wrong, c.right, c.why, c.tip)) {
                assertFalse("文案里混进了 markdown 星号（页面上会原样露出来）：$s", s.contains("**"))
            }
            c.check?.let { ck ->
                assertEquals(
                    "「${c.right}」与引擎算出来的不一致",
                    ck.product,
                    moProductOf(ck.value, ck.factor),
                )
                assertEquals("check 里的积应当等于 竖式 的结果", ck.product, moPlanSteps(ck.value, ck.factor).product)
                // 错误写法确实应该能由某个错答生成器复现，或者至少不等于正确答案
                assertNotEquals("「${c.wrong}」不可能等于正确答案", ck.product.toString(), c.wrong.substringAfterLast("= ").trim())
                checked++
            }
        }
        assertTrue("带 check 的案例太少：$checked", checked >= 5)
    }

    @Test
    fun `题型清单是唯一来源：5 个题型、key 唯一、文案齐全`() {
        assertEquals(5, MO_KIND_GROUPS.size)
        assertEquals(kinds.toSet(), MO_KIND_GROUPS.map { it.key }.toSet())
        assertEquals("key 不许重复", MO_KIND_GROUPS.size, MO_KIND_GROUPS.map { it.key.key }.toSet().size)
        for (g in MO_KIND_GROUPS) {
            assertTrue("emoji/title/desc 都不能空", g.emoji.isNotEmpty() && g.title.isNotEmpty() && g.desc.isNotEmpty())
            assertFalse("题型文案混进星号", g.desc.contains("**"))
        }
    }

    @Test
    fun `规律卡四条都在，且文案里没有 markdown 星号`() {
        assertEquals(4, MO_RULES.size)
        for (r in MO_RULES) {
            assertTrue(r.title.isNotEmpty() && r.body.isNotEmpty())
            assertFalse("规律卡混进了星号：${r.title}", r.title.contains("**") || r.body.contains("**"))
        }
    }

    // ── 随机工具与非法输入 ──────────────────────────────────

    @Test
    fun `★ moRndInclusive 对齐 JS rnd：跨度 ≤ 0 返回 min，不抛错`() {
        val r = Random(1)
        assertEquals(5, moRndInclusive(5, 4, r))
        assertEquals(5, moRndInclusive(5, 5, r))
        val seen = HashSet<Int>()
        repeat(500) { seen += moRndInclusive(2, 4, r) }
        assertEquals(setOf(2, 3, 4), seen)
    }

    @Test
    fun `非法输入要报错，不能悄悄算出错数`() {
        for ((v, f) in listOf(9 to 3, 0 to 3, 100 to 1, 100 to 10, 100 to 0, 100 to -2)) {
            val threw = try {
                moPlanSteps(v, f); false
            } catch (e: IllegalArgumentException) {
                true
            }
            assertTrue("$v × $f 应当被拒绝", threw)
        }
        val threwKind = try {
            MoKind.fromKey("nope"); false
        } catch (e: IllegalArgumentException) {
            true
        }
        assertTrue(threwKind)
    }
}
