package com.example.ai.data.math

import com.example.ai.ui.icon.MathIcons
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * 数量关系与交换 —— 引擎单测（移植自 web 侧 `relations.test.ts`）。
 *
 * ── 核心判据：关系句、算式、交换后果**三者必须自洽**，且由独立裁判重算 ──
 * 引擎记录的 `nums` / `result` 是它的**主张**，测试不能拿主张当证明。
 * 所以这里把 `eq.before` / `eq.after` 的**字符串**重新解析求值（[splitEq]），
 * 用另一条路径算出「不变量」，再与 `nums` / `result` 对拍。
 *
 * ── 另外三件容易悄悄坏掉的事 ──
 *   · ★ 全页的纲：**两边同色 ⇔ 交换后结论不变**。
 *     写成断言就是 `effect == KEEP` ⟺ `slotRole[0] == slotRole[1]` ——
 *     这条一破，页面上的颜色教学就与事实矛盾了。
 *   · 交换后**每个数的角色确实换了**（否则「颜色对调」只是视觉花招，没有数学含义）
 *   · 退化的题必须被拦掉：1 倍、差为 0、份数 == 每份数 —— 这些题**看不出交换的效果**
 *
 * ★ 随机源一律走 `Random(seed)`：Math.random 那种全局随机在单测里没法复现，
 *   一旦某条只在特定组合下失败，就永远抓不到了。
 */
class RelationsTest {

    private val kinds = RlKind.entries.toList()

    // ────────────────────────────────────────────────────────────
    // 独立裁判：把算式**字符串**重新解析求值
    // ────────────────────────────────────────────────────────────

    /** 求一条两步算式的值（只认 数字 运算符 数字，别的一律抛错 → 测试当场炸） */
    private fun evalExpr(src: String): Double {
        val parts = src.trim().split(" ").filter { it.isNotBlank() }
        assertEquals("不是两步算式：$src", 3, parts.size)
        val a = parts[0].toDoubleOrNull()
        val b = parts[2].toDoubleOrNull()
        assertNotNull("操作数不是数：$src", a)
        assertNotNull("操作数不是数：$src", b)
        return when (parts[1]) {
            "＋" -> a!! + b!!
            "－" -> a!! - b!!
            "×" -> a!! * b!!
            "÷" -> a!! / b!!
            else -> throw AssertionError("认不出运算符：$src")
        }
    }

    /** 把 `"a ＋ b ＝ c"` 拆成 [左边算出来的值, 右边写的值] */
    private fun splitEq(src: String): Pair<Double, Double> {
        val seg = src.split("＝")
        assertEquals("不是等式：$src", 2, seg.size)
        val rhs = seg[1].trim().toDoubleOrNull()
        assertNotNull("右边不是数：$src", rhs)
        return evalExpr(seg[0]) to rhs!!
    }

    /** 独立裁判：一道题的不变量（交换前后必须相同的那一个数） */
    private fun invariantOf(p: RlProblem): Double = when (p.kind) {
        // 两个加数互换 ⇒ 和不变
        RlKind.TOTAL -> evalExpr(p.eq.before.split("＝")[0])
        // 差不变
        RlKind.COMPARE -> evalExpr(p.eq.before.split("＝")[0])
        // 乘积不变
        RlKind.TIMES -> evalExpr(p.eq.before.split("＝")[0])
        // 总数不变
        RlKind.SHARE -> p.result.value.toDouble()
    }

    /**
     * 不变量在数据结构里**住哪**（★ 四类并不统一，测试必须知道这件事）：
     *   total / compare / share → `result.value` 就是那个不变量
     *   times                   → `result.value` 是**倍数**（求出来的第三个数），
     *                             不变量是乘积，住在 `left.value`
     */
    private fun invariantField(p: RlProblem): Double =
        if (p.kind == RlKind.TIMES) p.left.value.toDouble() else p.result.value.toDouble()

    private fun gen(kind: RlKind, seed: Int): RlProblem {
        val p = rlGenerateProblem(kind, Random(seed))
        assertNotNull("$kind 生成失败（seed=$seed）", p)
        return p!!
    }

    // ────────────────────────────────────────────────────────────
    // 1. 每个生成器都把「结果」反推对了
    // ────────────────────────────────────────────────────────────

    @Test
    fun `一共：a ＋ b ＝ 总量，且交换前后都是同一个和`() {
        for (i in 0 until 300) {
            val p = gen(RlKind.TOTAL, i * 7 + 1)
            val (b1, r1) = splitEq(p.eq.before)
            val (b2, r2) = splitEq(p.eq.after)
            assertEquals("等式不成立：${p.eq.before}", r1, b1, 0.0)
            assertEquals("等式不成立：${p.eq.after}", r2, b2, 0.0)
            assertEquals("换位置后和变了 —— 加法交换律不成立？", b1, b2, 0.0)
            assertEquals("result.value 与算式对不上", b1, p.result.value.toDouble(), 0.0)
            // 两个加数确实互换（不是原地不动）
            assertEquals(listOf(p.left.value, p.right.value), listOf(p.nums.before.first, p.nums.before.second))
            assertEquals(listOf(p.right.value, p.left.value), listOf(p.nums.after.first, p.nums.after.second))
            assertNotEquals("退化题：两个加数一样，换位置看不出效果", p.left.value, p.right.value)
        }
    }

    @Test
    fun `比多少：大数 － 小数 ＝ 差，交换前后差不变、两个数确实换了位`() {
        for (i in 0 until 300) {
            val p = gen(RlKind.COMPARE, i * 11 + 3)
            val (b1, r1) = splitEq(p.eq.before)
            val (b2, r2) = splitEq(p.eq.after)
            assertEquals("等式不成立：${p.eq.before}", r1, b1, 0.0)
            assertEquals("等式不成立：${p.eq.after}", r2, b2, 0.0)
            assertEquals("交换后差不相等", b1, b2, 0.0)
            assertEquals("相差与算式对不上", b1, p.result.value.toDouble(), 0.0)
            assertTrue("退化了：差为 0 就看不出「多 / 少」", b1 > 0)
            // 左量确实是大数（句子「A 比 B 多」要求 A > B）
            assertTrue("「比…多」句子里左值必须更大", p.left.value > p.right.value)
            assertEquals(listOf(p.right.value, p.left.value), listOf(p.nums.after.first, p.nums.after.second))
        }
    }

    @Test
    fun `倍数：1倍量 × 倍数 ＝ 比较量；交换后是它的 n 分之一`() {
        for (i in 0 until 300) {
            val p = gen(RlKind.TIMES, i * 13 + 5)
            val (b1, r1) = splitEq(p.eq.before)
            val (b2, r2) = splitEq(p.eq.after)
            assertEquals("等式不成立：${p.eq.before}", b1, r1, 0.0)
            assertEquals("交换后乘积变了 —— 乘法交换律不成立？", b1, b2, 0.0)
            assertEquals("比较量 ≠ 1倍量 × 倍数", b1, p.left.value.toDouble(), 0.0)
            assertEquals("等式不成立：${p.eq.after}", b2, r2, 0.0)
            val n = p.result.value
            assertTrue("退化了：$n 倍不是「倍」", n >= 2)
            assertEquals("1倍量 × 倍数 ≠ 比较量", p.left.value.toDouble(), (p.right.value * n).toDouble(), 0.0)
            assertNotEquals("退化了：两个数一样", p.left.value, p.right.value)
            // 交换后：右量 ÷ 左量 恰好是 1/n（用独立除法重算，不看引擎字段）
            assertEquals(
                "交换后应是 1/n",
                1.0 / n,
                p.nums.after.first.toDouble() / p.nums.after.second.toDouble(),
                1e-9,
            )
            // 因数交换这一级必须**不变**（与主宾交换形成对照）
            val fs = p.factorSwap
            assertNotNull("倍数题必须给出「换因数」的对照", fs)
            assertEquals("换因数后乘积应不变", fs!!.value, fs.n * fs.b)
            assertEquals("换因数后的积应等于比较量", fs.value, p.left.value)
        }
    }

    @Test
    fun `平均分：总数 ÷ 份数 ＝ 每份数，交换后是另一个问题；份数 ≠ 每份数`() {
        for (i in 0 until 300) {
            val p = gen(RlKind.SHARE, i * 17 + 7)
            val (b1, r1) = splitEq(p.eq.before)
            val (b2, r2) = splitEq(p.eq.after)
            assertEquals("等式不成立：${p.eq.before}", r1, b1, 0.0)
            assertEquals("等式不成立：${p.eq.after}", r2, b2, 0.0)
            val k = p.nums.before.first
            val per = p.nums.before.second
            assertEquals("总数 ÷ 份数 应得每份数", b1, per.toDouble(), 0.0)
            assertEquals("总数 ÷ 每份数 应得份数", b2, k.toDouble(), 0.0)
            assertEquals("总数 ≠ 份数 × 每份数", p.result.value, k * per)
            assertNotEquals("退化了：份数 == 每份数，两种分法长得一模一样", k, per)
            // 点阵排布必须真的换了个形状（否则「12 个重新排一遍」这一帧演不出来）
            val g = p.shareGrid
            assertNotNull("平均分必须给出点阵排布", g)
            assertEquals("交换前排布点数 ≠ 总数", p.result.value, g!!.before.rows * g.before.cols)
            assertEquals("交换后排布点数 ≠ 总数", p.result.value, g.after.rows * g.after.cols)
            assertNotEquals("交换前后排布一样，看不出重排", g.before, g.after)
        }
    }

    // ────────────────────────────────────────────────────────────
    // 2. ★ 全页的纲：同色 ⇔ 不变
    // ────────────────────────────────────────────────────────────

    /** 逐题体检（批量测试复用） */
    private fun checkProblem(p: RlProblem) {
        val roleL = p.slotRole.first
        val roleR = p.slotRole.second
        val sameColor = roleL == roleR

        // ★ 纲：两边同角色 ⇒ 交换后果必须是「不变」；异角色 ⇒ 必须真的变了
        if (sameColor) {
            assertEquals("${p.kind}：同色却宣称会变", RlSwapEffect.KEEP, p.effect)
            assertEquals("${p.kind}：同色但结论片段不同", p.before.key, p.after.key)
            assertFalse(RL_EFFECT_LABEL.getValue(p.effect).changed)
        } else {
            assertNotEquals("${p.kind}：异色却宣称不变", RlSwapEffect.KEEP, p.effect)
            assertTrue(RL_EFFECT_LABEL.getValue(p.effect).changed)
        }

        // 交换后「每个数的角色确实换了」—— 否则颜色对调只是花招
        // 左槽角色不动，站在左槽的**人**从 left 换成了 right ⇒ 那个数的角色确实变了
        assertNotEquals("${p.kind}：交换后左槽还是原来那个数", p.nums.before.first, p.nums.after.first)
        assertNotEquals("${p.kind}：交换没改变任何东西", p.nums.before, p.nums.after)

        // 不变量（独立裁判重算：把算式字符串重新求值，再与结构里的字段对拍）
        assertEquals(
            "${p.kind}：独立重算的不变量与结构字段对不上",
            invariantOf(p),
            invariantField(p),
            0.0,
        )

        // ★ 结构字段之间的交叉验算（不看字符串，另走一条路）
        when (p.kind) {
            RlKind.TOTAL -> assertEquals("一共 ≠ 两部分之和", p.result.value, p.left.value + p.right.value)
            RlKind.COMPARE -> assertEquals("差 ≠ 大数 － 小数", p.result.value, p.left.value - p.right.value)
            RlKind.TIMES -> assertEquals("1倍量 × 倍数 ≠ 比较量", p.left.value, p.right.value * p.result.value)
            RlKind.SHARE ->
                assertEquals("总数 ≠ 份数 × 每份数", p.result.value, p.nums.before.first * p.nums.before.second)
        }

        // 句子里的「词」要跟交换后果对上
        when (p.effect) {
            RlSwapEffect.FLIP_WORD -> {
                val hasMore = p.before.key.contains("多")
                val hasLess = p.before.key.contains("少")
                assertTrue("${p.kind}：交换前既不是「多」也不是「少」：${p.before.key}", hasMore != hasLess)
                assertTrue("${p.kind}：交换后没有多/少：${p.after.key}", p.after.key.contains("多") || p.after.key.contains("少"))
                // 多 ⇄ 少 必须真的翻过来
                assertNotEquals(
                    "${p.kind}：多/少没有翻转",
                    p.before.key.contains("多"),
                    p.after.key.contains("多"),
                )
            }
            RlSwapEffect.FLIP_RATE -> {
                assertTrue("${p.kind}：交换前不是「几倍」：${p.before.key}", p.before.key.contains("倍"))
                assertTrue("${p.kind}：交换后不是 1/n：${p.after.key}", p.after.key.contains("1/"))
            }
            RlSwapEffect.FLIP_MEANING ->
                assertNotEquals("${p.kind}：交换后问的还是同一件事", p.before.key, p.after.key)
            RlSwapEffect.KEEP -> Unit
        }

        // 一步一填：选项互不重复、答案恰好出现一次、答案确实在选项里
        assertTrue("${p.kind}：步骤太少", p.solveSteps.size >= 2)
        for (s in p.solveSteps) {
            assertTrue("${s.key}：选项太少", s.options.size >= 2)
            assertEquals("${s.key}：选项有重复", s.options.size, s.options.toSet().size)
            assertEquals("${s.key}：答案在选项里出现了非 1 次", 1, s.options.count { it == s.answer })
            assertTrue("${s.key}：文案缺失", s.label.isNotBlank() && s.ask.isNotBlank() && s.tip.isNotBlank())
        }
    }

    @Test
    fun `★ 全页的纲：两边同色 ⇔ 交换后结论不变（四类逐一体检）`() {
        for (k in RL_REL_KINDS) {
            for (i in 0 until 120) {
                checkProblem(gen(k, i * 31 + k.ordinal * 97 + 11))
            }
        }
        // 只有「一共」是对称的 —— 这条写死，防止以后有人把某类改成同色
        val same = RL_REL_KINDS.filter { k ->
            val p = rlGenerateProblem(k, Random(20261007))
            p != null && p.slotRole.first == p.slotRole.second
        }
        assertEquals("只有「一共」该是对称（同色）的", listOf(RlKind.TOTAL), same)
    }

    @Test
    fun `随机 1000 道（不限题型）全部自洽`() {
        val rnd = Random(424242)
        val seen = mutableSetOf<RlKind>()
        repeat(1000) {
            val p = rlGenerateProblem(null, rnd)
            assertNotNull("随机生成失败", p)
            seen.add(p!!.kind)
            checkProblem(p)
        }
        assertEquals("随机 1000 道没能覆盖全部四类", RL_REL_KINDS.size, seen.size)
    }

    @Test
    fun `批量生成：不重复、数量够、每道都自洽`() {
        val rnd = Random(987654321)
        val set = rlGenerateProblems(12, null, rnd)
        assertEquals("只生成了 ${set.size} 道", 12, set.size)
        assertEquals("批量题里有重复", 12, set.map { it.before.text }.toSet().size)
        set.forEach { checkProblem(it) }
        for (k in RL_REL_KINDS) {
            val one = rlGenerateProblems(5, k, Random(k.ordinal * 991 + 17))
            assertTrue("$k 只能生成 ${one.size} 道", one.size >= 3)
            assertTrue("指定题型却混进了别的题型", one.all { it.kind == k })
        }
    }

    // ────────────────────────────────────────────────────────────
    // 3. 静态教学资料
    // ────────────────────────────────────────────────────────────

    @Test
    fun `题型清单：四类齐全、顺序与生成器一致、都有图标与配色档`() {
        assertEquals(RL_REL_KINDS, RL_KIND_GROUPS.map { it.key })
        for (g in RL_KIND_GROUPS) {
            assertTrue("${g.key} 文案缺失", g.title.isNotBlank() && g.desc.isNotBlank())
            assertTrue("${g.key} 的副标题超过 8 字：${g.desc}", g.desc.length <= 8)
            assertNotNull("${g.key} 的图标 ${g.icon} 不存在", MathIcons[g.icon])
        }
        assertEquals("只该有一类是对称的", 1, RL_KIND_GROUPS.count { !it.dir })
        assertEquals(RlKind.TOTAL, RL_KIND_GROUPS.first { !it.dir }.key)
    }

    @Test
    fun `规律卡与易错卡：图标都存在，文案都在字数预算内`() {
        for (r in RL_RULES) {
            assertNotNull("规律卡图标 ${r.icon} 不存在", MathIcons[r.icon])
            assertTrue("规律卡正文超预算（${r.body.length} 字）：${r.body}", r.body.length <= 35)
        }
        for (c in RL_MISTAKE_CASES) {
            assertNotNull("易错卡图标 ${c.icon} 不存在", MathIcons[c.icon])
            // 预算口径：与已合规的 units 页齐平（why ≤18 / tip ≤18 字符）
            assertTrue("易错 why 超预算（${c.why.length} 字）：${c.why}", c.why.length <= 18)
            assertTrue("易错 tip 超预算（${c.tip.length} 字）：${c.tip}", c.tip.length <= 18)
            assertTrue("易错卡字段缺失", c.title.isNotBlank() && c.wrong.isNotBlank() && c.right.isNotBlank())
            assertNotEquals(c.wrong, c.right)
        }
        // 每类关系至少有一条易错卡（用图标多样性近似）
        assertTrue("易错卡覆盖的概念太少", RL_MISTAKE_CASES.map { it.icon }.toSet().size >= 3)
    }

    @Test
    fun `★ 静态示例的数值逐条人工验算（引擎注释里的数字一律自己重算）`() {
        // 易错卡 1：4 比 7 少 3 ⇒ |7-4| = 3
        assertEquals(3, 7 - 4)
        // 易错卡 2：6 是 2 的 3 倍；2 是 6 的 1/3
        assertEquals(6, 2 * 3)
        assertEquals(1.0 / 3.0, 2.0 / 6.0, 1e-12)
        // 易错卡 3：2 的 3 倍 == 3 的 2 倍 == 6
        assertEquals(2 * 3, 3 * 2)
        // 易错卡 5：3 ＋ 5 == 5 ＋ 3 == 8
        assertEquals(3 + 5, 5 + 3)
        // 易错卡 6：7 - 4 = 3，且 7 ÷ 4 = 1.75（「1 倍多」，不是 3 倍）
        assertEquals(3, 7 - 4)
        assertEquals(1.75, 7.0 / 4.0, 1e-12)
        assertNotEquals(7, 4 * 3)

        // ★ 对照表里每一行都得自己重算
        val byKind = RL_SWAP_TABLE.associateBy { it.kind }
        assertEquals("对照表行数应等于关系类数", RL_REL_KINDS.size, RL_SWAP_TABLE.size)

        val total = byKind.getValue(RlKind.TOTAL)
        assertEquals(splitEq(total.before).first, splitEq(total.before).second, 0.0)
        assertEquals(splitEq(total.after).first, splitEq(total.before).first, 0.0)
        assertEquals(RlSwapEffect.KEEP, total.effect)

        val cmp = byKind.getValue(RlKind.COMPARE)
        run {
            val m = Regex("(\\d+)\\s*比\\s*(\\d+)\\s*多\\s*(\\d+)").find(cmp.before)
            assertNotNull("对照表「比多少」行格式不对：${cmp.before}", m)
            val g = m!!.groupValues
            assertEquals(g[3].toInt(), g[1].toInt() - g[2].toInt())
            val a = Regex("(\\d+)\\s*比\\s*(\\d+)\\s*少\\s*(\\d+)").find(cmp.after)
            assertNotNull("对照表「比多少」交换后格式不对：${cmp.after}", a)
            val h = a!!.groupValues
            // 主语确实换了，差确实没变
            assertEquals(g[2], h[1])
            assertEquals(g[1], h[2])
            assertEquals(-h[3].toInt(), h[1].toInt() - h[2].toInt())
        }

        val tm = byKind.getValue(RlKind.TIMES)
        run {
            val m = Regex("(\\d+)\\s*是\\s*(\\d+)\\s*的\\s*(\\d+)\\s*倍").find(tm.before)
            assertNotNull("对照表「倍数」行格式不对：${tm.before}", m)
            val g = m!!.groupValues
            assertEquals(g[1].toInt(), g[2].toInt() * g[3].toInt())
            val a = Regex("(\\d+)\\s*是\\s*(\\d+)\\s*的\\s*1/(\\d+)").find(tm.after)
            assertNotNull("对照表「倍数」交换后格式不对：${tm.after}", a)
            val h = a!!.groupValues
            assertEquals(g[2], h[1])
            assertEquals(g[1], h[2])
            assertEquals(1.0 / h[3].toDouble(), h[1].toDouble() / h[2].toDouble(), 1e-12)
        }

        val sh = byKind.getValue(RlKind.SHARE)
        run {
            val b = Regex("(\\d+)\\s*÷\\s*(\\d+)\\s*＝\\s*(\\d+)").find(sh.before)
            val a = Regex("(\\d+)\\s*÷\\s*(\\d+)\\s*＝\\s*(\\d+)").find(sh.after)
            assertNotNull("对照表「平均分」行格式不对", b)
            assertNotNull("对照表「平均分」交换后格式不对", a)
            val g = b!!.groupValues
            val h = a!!.groupValues
            assertEquals(g[1].toInt(), g[2].toInt() * g[3].toInt())
            assertEquals(h[1].toInt(), h[2].toInt() * h[3].toInt())
            // 同一个总数，除数与商互换
            assertEquals(g[1], h[1])
            assertEquals(g[3], h[2])
            assertEquals(g[2], h[3])
        }
    }

    @Test
    fun `交换后果的四个标签齐全且「变没变」与 effect 自洽`() {
        for (e in RlSwapEffect.entries) assertNotNull("$e 缺标签", RL_EFFECT_LABEL[e])
        assertFalse(RL_EFFECT_LABEL.getValue(RlSwapEffect.KEEP).changed)
        assertTrue(RL_EFFECT_LABEL.getValue(RlSwapEffect.FLIP_WORD).changed)
        assertTrue(RL_EFFECT_LABEL.getValue(RlSwapEffect.FLIP_RATE).changed)
        assertTrue(RL_EFFECT_LABEL.getValue(RlSwapEffect.FLIP_MEANING).changed)
    }

    @Test
    fun `角色配色：青绿给「基准」，橙红给「比较」，两者必须不同色`() {
        for (r in RlRole.entries) {
            val m = RL_ROLE_META[r]
            assertNotNull("$r 缺配色", m)
            assertTrue("$r 缺配色", m!!.fg != 0L && m.bg != 0L)
        }
        assertNotEquals("基准与比较必须一眼可分", RL_ROLE_META.getValue(RlRole.BASE).dot, RL_ROLE_META.getValue(RlRole.CMP).dot)
        assertNotEquals("对等与比较必须一眼可分", RL_ROLE_META.getValue(RlRole.PART).dot, RL_ROLE_META.getValue(RlRole.CMP).dot)
    }

    @Test
    fun `引擎导出的题不依赖随机数之外的任何东西（连出 500 道不崩不空）`() {
        val rnd = Random(13579)
        var ok = 0
        repeat(500) { if (rlGenerateProblem(null, rnd) != null) ok++ }
        assertEquals(500, ok)
    }

    @Test
    fun `★ 随机数助手复刻 JS 语义：跨度 ≤ 0 时返回 min，不抛异常`() {
        // JS 的 rnd(min, max) = min + floor(random * (max - min + 1))
        // ⇒ max < min 时 floor 出负数…… 但 span ≤ 0 时 Math.random()*0 之类的组合
        //   仍返回 min 而不报错；Kotlin 的 nextInt(min, max + 1) 会直接抛。
        val r = Random(1)
        assertEquals(5, rlRndInclusive(5, 4, r))
        assertEquals(5, rlRndInclusive(5, 5 - 3, r))
        // 正常跨度两端都能取到
        val got = (0 until 400).map { rlRndInclusive(2, 4, r) }.toSet()
        assertEquals(setOf(2, 3, 4), got)
    }

    @Test
    fun `★ 选项去重：陷阱项与正确答案撞车时不重复`() {
        // 复刻 web 侧被抓到的那一类：差 == 小数 时「多 d 个」既是错答也是另一个错答
        val o = rlOpts("少 3 个", "多 3 个", "少 3 个")
        assertEquals(2, o.size)
        assertEquals(1, o.count { it == "少 3 个" })
        assertEquals(listOf("少 3 个", "多 3 个"), o)
    }

    /** 四类的题都必须真的能被生成出来（生成器内部有苛刻的 return null 条件） */
    @Test
    fun `四类生成器的成功率都不为 0`() {
        val r = Random(24680)
        for (k in kinds) {
            val hit = (0 until 60).count { rlGenerateProblem(k, r) != null }
            assertEquals("$k 生成器有 60 次全失败的时候", 60, hit)
        }
    }
}
