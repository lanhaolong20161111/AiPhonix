package com.example.ai.data.units

import com.example.ai.ui.icon.MathIcons
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * 长度与质量单位换算引擎单测 —— 移植自 `web/src/lib/units.test.ts`。
 *
 * ── 核心判据：一个换算结果要能被**两条互不相干的路径**算出同一个数 ──
 *   裁判① 基准单位法 [convert]（引擎实际用法：先化基准，再化目标）
 *   裁判② 沿链逐级法 [convertChain]（另一份实现：在单位链上逐级乘除）
 *
 * 期望值来源：**用 `npx tsx` 跑 web 真实现打印出来的**，不是自己推导的
 * （见本轮 `web/_mo_units_expect.ts` 的输出）。典型值：
 *   1米 = 100厘米、1米 = 1000毫米、1千米 = 1000米、1吨 = 1000000克、1毫米 = 0.1厘米
 *
 * ── 另外三件容易悄悄坏掉的事 ──
 *   · 「份数 × 每份 = 总量」在**每一轮**都必须成立（守恒；少乘一个 10 也看不出来）
 *   · [unitNumStr]：Kotlin `Double.toString()` 会把 300.0 打成 "300.0"，题面就成了「300.0厘米」
 *   · [unitRndInclusive]：JS 跨度 ≤ 0 时返回 min，Kotlin `nextInt` 会抛错
 */
class UnitsTest {

    private val L = UnitKind.LENGTH
    private val M = UnitKind.MASS

    // ── 单位表 ─────────────────────────────────────────────

    @Test
    fun `单位表的 base 与 onScreenReal 逐条对齐 web`() {
        // web 实测输出：mm:1:length:real=true cm:10:length:real=true dm:100:length:real=true
        //               m:1000:length:real=false km:1000000:length:real=false
        //               g:1:mass:real=false kg:1000:mass:real=false t:1000000:mass:real=false
        val expected = mapOf(
            UnitId.MM to Triple(1.0, L, true),
            UnitId.CM to Triple(10.0, L, true),
            UnitId.DM to Triple(100.0, L, true),
            UnitId.M to Triple(1000.0, L, false),
            UnitId.KM to Triple(1_000_000.0, L, false),
            UnitId.G to Triple(1.0, M, false),
            UnitId.KG to Triple(1000.0, M, false),
            UnitId.T to Triple(1_000_000.0, M, false),
        )
        assertEquals("单位个数应与 web 一致", 8, UNITS.size)
        for ((id, e) in expected) {
            val u = unitOf(id)
            assertEquals("${id.key} 的 base", e.first, u.base, 0.0)
            assertEquals("${id.key} 的族", e.second, u.kind)
            assertEquals("${id.key} 能否按真实尺寸画", e.third, u.onScreenReal)
        }
    }

    @Test
    fun `单位链按 base 升序，长度 5 个、质量 3 个`() {
        assertEquals(listOf(UnitId.MM, UnitId.CM, UnitId.DM, UnitId.M, UnitId.KM), unitsOf(L).map { it.id })
        assertEquals(listOf(UnitId.G, UnitId.KG, UnitId.T), unitsOf(M).map { it.id })
    }

    // ── 相邻单位：进率与轮数（web 实测值）────────────────────

    @Test
    fun `相邻单位对的进率与轮数逐条对齐 web 实测`() {
        // web 输出：mm-cm rate=10 rounds=1 / cm-dm rate=10 rounds=1 / dm-m rate=10 rounds=1
        //           m-km rate=1000 rounds=3 / g-kg rate=1000 rounds=3 / kg-t rate=1000 rounds=3
        val expected = mapOf(
            "mm-cm" to (10.0 to 1),
            "cm-dm" to (10.0 to 1),
            "dm-m" to (10.0 to 1),
            "m-km" to (1000.0 to 3),
            "g-kg" to (1000.0 to 3),
            "kg-t" to (1000.0 to 3),
        )
        assertEquals("相邻对共 6 个", 6, ADJACENT_PAIRS.size)
        for (p in ADJACENT_PAIRS) {
            val e = expected[p.key] ?: error("多出一对 ${p.key}")
            assertEquals("${p.key} 的进率", e.first, p.ratio, 0.0)
            assertEquals("${p.key} 的轮数", e.second, roundsOf(p.big, p.small))
            assertEquals("${p.key} 小单位应更小", true, p.small.base < p.big.base)
            assertEquals("${p.key} 的进率应由 base 推出", p.big.base / p.small.base, p.ratio, 0.0)
        }
        assertEquals("长度 4 对", 4, pairsOf(L).size)
        assertEquals("质量 2 对", 2, pairsOf(M).size)
    }

    // ── 教材事实 + 两个裁判对拍 ─────────────────────────────

    @Test
    fun `教材事实逐条钉死，且两条独立路径给出同一个数`() {
        // 全部为 web 实测输出（左列 = 事实，右列 = convertChain 的独立复核值）
        val facts = listOf(
            Triple(1.0, UnitId.M to UnitId.CM, 100.0),
            Triple(1.0, UnitId.M to UnitId.MM, 1000.0),
            Triple(1.0, UnitId.M to UnitId.DM, 10.0),
            Triple(1.0, UnitId.KM to UnitId.M, 1000.0),
            Triple(1.0, UnitId.KG to UnitId.G, 1000.0),
            Triple(1.0, UnitId.T to UnitId.KG, 1000.0),
            Triple(1.0, UnitId.T to UnitId.G, 1_000_000.0),
            Triple(1.0, UnitId.CM to UnitId.MM, 10.0),
            Triple(1.0, UnitId.DM to UnitId.CM, 10.0),
            Triple(1.0, UnitId.MM to UnitId.CM, 0.1),
            Triple(1.0, UnitId.MM to UnitId.M, 0.001),
        )
        for ((v, pair, want) in facts) {
            val (a, b) = pair
            val A = unitOf(a)
            val B = unitOf(b)
            assertEquals("$v${A.name} = ?${B.name}（基准单位法）", want, convert(v, A, B), 1e-9)
            assertEquals("$v${A.name} = ?${B.name}（沿链逐级法）", want, convertChain(v, A, B), 1e-9)
        }
    }

    @Test
    fun `全量对拍：所有同族单位对 × 每档取值，两条路径必须一致`() {
        var n = 0
        for (kind in listOf(L, M)) {
            val chain = unitsOf(kind)
            for (a in chain) {
                for (b in chain) {
                    for (v in listOf(1.0, 3.0, 7.0, 45.0, 100.0, 2500.0)) {
                        assertEquals(
                            "${v}${a.name}->${b.name} 两条路径不一致",
                            convert(v, a, b),
                            convertChain(v, a, b),
                            1e-9,
                        )
                        n++
                    }
                }
            }
        }
        assertTrue("对拍样本太少：$n", n >= 200)
    }

    @Test
    fun `跨族换算必须抛错，不能悄悄算出一个数`() {
        for ((a, b) in listOf(UnitId.M to UnitId.G, UnitId.KG to UnitId.MM, UnitId.T to UnitId.KM)) {
            val A = unitOf(a)
            val B = unitOf(b)
            for (f in listOf<() -> Any>(
                { convert(1.0, A, B) },
                { convertChain(1.0, A, B) },
                { rateOf(A, B) },
                { roundsOf(A, B) },
                { planSteps(A, B, 1.0) },
            )) {
                val threw = try {
                    f(); false
                } catch (e: IllegalArgumentException) {
                    true
                }
                assertTrue("${A.name}->${B.name} 应当抛错", threw)
            }
        }
    }

    // ── planSteps 轨迹 ──────────────────────────────────────

    @Test
    fun `planSteps 轨迹逐条对齐 web 实测（3米=厘米 30-100 300-10）`() {
        val p = planSteps(unitOf(UnitId.M), unitOf(UnitId.CM), 3.0)
        assertEquals(UnitDirection.SPLIT, p.direction)
        assertEquals("×", p.op)
        assertEquals(100.0, p.ratio, 0.0)
        assertEquals(2, p.rounds)
        assertEquals(300.0, p.result, 1e-9)
        assertEquals(300.0, p.maxCells, 0.0)
        assertEquals("要切 2 轮 ⇒ 两条切分记录", 2, p.cuts.size)
        // web: r1 count=30 pieceBase=100 pieceLabel=1分米 named=dm
        assertEquals(1, p.cuts[0].round)
        assertEquals(30.0, p.cuts[0].count, 1e-9)
        assertEquals(100.0, p.cuts[0].pieceBase, 1e-9)
        assertEquals("1分米", p.cuts[0].pieceLabel)
        assertEquals(UnitId.DM, p.cuts[0].namedUnit?.id)
        // web: r2 count=300 pieceBase=10 pieceLabel=1厘米 named=cm
        assertEquals(300.0, p.cuts[1].count, 1e-9)
        assertEquals(10.0, p.cuts[1].pieceBase, 1e-9)
        assertEquals("1厘米", p.cuts[1].pieceLabel)
        assertEquals(UnitId.CM, p.cuts[1].namedUnit?.id)
    }

    @Test
    fun `planSteps 合并方向：3000克=千克，份数一路变小、每份一路变大`() {
        val p = planSteps(unitOf(UnitId.G), unitOf(UnitId.KG), 3000.0)
        assertEquals(UnitDirection.MERGE, p.direction)
        assertEquals("÷", p.op)
        assertEquals(3, p.rounds)
        assertEquals(3.0, p.result, 1e-9)
        assertEquals(3000.0, p.maxCells, 0.0)
        // web: count 300 / 30 / 3，pieceBase 10 / 100 / 1000，最后一份才是「1千克」
        assertEquals(listOf(300.0, 30.0, 3.0), p.cuts.map { it.count })
        assertEquals(listOf(10.0, 100.0, 1000.0), p.cuts.map { it.pieceBase })
        assertEquals(listOf("10克", "100克", "1千克"), p.cuts.map { it.pieceLabel })
        assertEquals(null, p.cuts[0].namedUnit?.id)
        assertEquals(null, p.cuts[1].namedUnit?.id)
        assertEquals(UnitId.KG, p.cuts[2].namedUnit?.id)
    }

    @Test
    fun `planSteps 千米=米：第一轮是 10 份每份 100米，不是「10米」`() {
        // ★ 这条钉住最容易讲错的一处：只记「×10」而忘了「每份同时在变小」
        val p = planSteps(unitOf(UnitId.KM), unitOf(UnitId.M), 1.0)
        assertEquals(3, p.rounds)
        assertEquals(10.0, p.cuts[0].count, 1e-9)
        assertEquals(100_000.0, p.cuts[0].pieceBase, 1e-9)
        assertEquals("100米", p.cuts[0].pieceLabel)
        assertEquals(100.0, p.cuts[1].count, 1e-9)
        assertEquals(10_000.0, p.cuts[1].pieceBase, 1e-9)
        assertEquals("10米", p.cuts[1].pieceLabel)
        assertEquals(1000.0, p.cuts[2].count, 1e-9)
        assertEquals(1000.0, p.cuts[2].pieceBase, 1e-9)
        assertEquals("1米", p.cuts[2].pieceLabel)
        assertEquals(UnitId.M, p.cuts[2].namedUnit?.id)
    }

    @Test
    fun `★ 守恒：每一轮「份数 × 每份」都恒等于「原值 × from的基准倍数」`() {
        var n = 0
        for (kind in listOf(L, M)) {
            val chain = unitsOf(kind)
            for (a in chain) {
                for (b in chain) {
                    if (a.id == b.id) continue
                    for (v in listOf(1.0, 2.0, 9.0, 250.0)) {
                        val p = planSteps(a, b, v)
                        val total = v * a.base
                        for (c in p.cuts) {
                            assertEquals(
                                "${v}${a.name}->${b.name} 第 ${c.round} 轮不守恒",
                                total,
                                c.count * c.pieceBase,
                                total * 1e-9,
                            )
                            n++
                        }
                        assertEquals("末轮的「每份」必须等于目标单位的 base", b.base, p.cuts.last().pieceBase, 1e-9)
                    }
                }
            }
        }
        assertTrue("守恒样本太少：$n", n >= 200)
    }

    @Test
    fun `roundsOf：非 10 的整数次幂一律抛错，不许四舍五入`() {
        val weird = UnitDef(
            id = UnitId.MM, kind = L, name = "怪单位", symbol = "?", base = 3.0,
            sense = "", refs = emptyList(), onScreenReal = false,
        )
        val threw = try {
            roundsOf(weird, unitOf(UnitId.MM))
            false
        } catch (e: IllegalArgumentException) {
            true
        }
        assertTrue("进率 3 不是 10 的幂，必须抛错", threw)
    }

    @Test
    fun `planSteps 拒绝非正数`() {
        for (v in listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
            val threw = try {
                planSteps(unitOf(UnitId.M), unitOf(UnitId.CM), v)
                false
            } catch (e: IllegalArgumentException) {
                true
            }
            assertTrue("value=$v 应当抛错", threw)
        }
    }

    // ── 数字转字符串 ────────────────────────────────────────

    @Test
    fun `unitNumStr 对齐 JS String(number)：整数不带小数点，小数不补零`() {
        assertEquals("300", unitNumStr(300.0))
        assertEquals("1000", unitNumStr(1000.0))
        assertEquals("1000000", unitNumStr(1_000_000.0))
        assertEquals("0.1", unitNumStr(0.1))
        assertEquals("0.001", unitNumStr(0.001))
        // 题面拼装：绝不能出现「300.0厘米」
        assertEquals("3米", qty(3.0, unitOf(UnitId.M)))
        assertEquals("300厘米", qty(300.0, unitOf(UnitId.CM)))
        assertEquals("1吨", qty(1.0, unitOf(UnitId.T)))
    }

    // ── 随机工具 ────────────────────────────────────────────

    @Test
    fun `★ unitRndInclusive 对齐 JS rnd：跨度 ≤ 0 返回 min，不抛错`() {
        val r = Random(1)
        assertEquals(5, unitRndInclusive(5, 4, r))
        assertEquals(5, unitRndInclusive(5, 5, r))
        assertEquals(7, unitRndInclusive(7, -3, r))
        // 正常跨度必须真的落在闭区间内、且两端都能取到
        val seen = HashSet<Int>()
        repeat(500) { seen += unitRndInclusive(2, 4, r) }
        assertEquals(setOf(2, 3, 4), seen)
    }

    // ── 题组（单一来源）────────────────────────────────────

    @Test
    fun `题组逐条对齐 web，且每对单位同族、可换算`() {
        val expected = mapOf(
            ProblemGroupKey.LENGTH_ADJACENT to listOf("mm-cm", "cm-dm", "dm-m"),
            ProblemGroupKey.LENGTH_KM to listOf("m-km"),
            ProblemGroupKey.MASS to listOf("g-kg", "kg-t"),
            ProblemGroupKey.CROSS to listOf("mm-dm", "cm-m", "mm-m"),
        )
        assertEquals("题组共 4 个", 4, PROBLEM_GROUPS.size)
        assertEquals(expected.keys.toList(), PROBLEM_GROUPS.map { it.key })
        for (g in PROBLEM_GROUPS) {
            val keys = g.pairs.map { "${it.first.key}-${it.second.key}" }
            assertEquals("${g.key} 的单位对", expected[g.key], keys)
            for ((a, b) in g.pairs) {
                val A = unitOf(a)
                val B = unitOf(b)
                assertEquals("${g.key} 里 ${A.name}/${B.name} 必须同族", A.kind, B.kind)
                assertNotEquals("${g.key} 里不能出现同一个单位互换", A.id, B.id)
                assertTrue("${g.key} 的进率必须 ≥ 10", rateOf(A, B) >= 10.0)
            }
        }
        // 跨级组必须真的跨级（进率不是 10）——这是它区别于「相邻」组的唯一理由
        for ((a, b) in PROBLEM_GROUPS.first { it.key == ProblemGroupKey.CROSS }.pairs) {
            assertNotEquals("跨级组的进率不该是 10", 10.0, rateOf(unitOf(a), unitOf(b)))
        }
    }

    // ── 出题 ───────────────────────────────────────────────

    @Test
    fun `★ 每一道抽出来的题：题面数值自洽、三步答案正确、选项完备`() {
        for (g in PROBLEM_GROUPS) {
            repeat(120) {
                val p = genProblem(g.key, Random(it * 31 + g.key.ordinal))
                val A = p.from
                val B = p.to

                // ① 这道题宣称属于本组，就要真的用本组里的一对单位
                val pairOk = g.pairs.any { (x, y) ->
                    (unitOf(x).id == A.id && unitOf(y).id == B.id) ||
                        (unitOf(x).id == B.id && unitOf(y).id == A.id)
                }
                assertTrue("${g.key} 抽到 ${A.name}->${B.name}，不在这组的单位对里", pairOk)

                // ② result 必须由引擎算出来，不许手写（两个裁判都验一遍）
                assertEquals("${p.fullText} 的答案", convert(p.value, A, B), p.result, 1e-9)
                assertEquals("${p.fullText} 的答案（另一路径）", convertChain(p.value, A, B), p.result, 1e-9)

                // ③ 进率 / 轮数 / 符号自洽
                assertEquals(rateOf(A, B), p.ratio, 1e-9)
                assertEquals(roundsOf(A, B), p.rounds)
                assertEquals(if (A.base > B.base) "×" else "÷", p.op)

                // ④ 题面里的两个数都是正整数（反推出题的初衷：绝不出现分数）
                assertTrue("${p.fullText} 的 value 应当是正整数", p.value > 0 && p.value == p.value.toLong().toDouble())
                assertTrue("${p.fullText} 的 result 应当是正整数", p.result > 0 && p.result == p.result.toLong().toDouble())

                // ⑤ 三步都要有选项、选项互不重复、答案恰好出现一次
                assertEquals("应当固定三步", 3, p.steps.size)
                assertEquals(listOf("op", "rate", "calc"), p.steps.map { it.key })
                for (s in p.steps) {
                    assertTrue("选项至少 2 个", s.options.size >= 2)
                    assertEquals("选项不许重复：${s.options}", s.options.size, s.options.toSet().size)
                    assertEquals("答案必须恰好出现一次：${s.key}=${s.answer}", 1, s.options.count { it == s.answer })
                    assertTrue("tip 不能空（要讲为什么）", s.tip.isNotBlank())
                    assertTrue("文案里不许混进 markdown 星号", !s.tip.contains("**") && !s.ask.contains("**"))
                }
                assertEquals(p.op, p.steps[0].answer)
                assertEquals(unitNumStr(p.ratio), p.steps[1].answer)
                assertEquals(unitNumStr(p.result), p.steps[2].answer)

                // ⑥ 题面 / 结语里不许出现「300.0厘米」这种 Kotlin 默认格式
                assertTrue("题面格式错：${p.fullText}", !p.fullText.contains(".0"))
                assertTrue("结语格式错：${p.finalNote}", !p.finalNote.contains(".0"))

                // ⑦ 方向陷阱（若给出）必须是另一个正整数、且不等于正确答案
                p.trap?.let {
                    assertNotEquals("${p.fullText} 的方向陷阱与答案相同", p.result, it, 1e-9)
                    assertTrue("陷阱应当是正整数", it > 0 && it == it.toLong().toDouble())
                }
            }
        }
    }

    @Test
    fun `★ 方向搞反的错答一定要被点破（进选项，或落在揭晓用的 trap 里）`() {
        // ★ 别把「方向错答必须进选项」当成设计约束 —— web 的第三步选项来自
        //   { 加错值，按错的进率算 }，方向错答（flipped）是单独放在 p.trap 里、
        //   等学生做完再点破的。实测 90厘米=?分米 时 flipped=900 就不在选项里。
        var seen = 0
        for (g in PROBLEM_GROUPS) {
            repeat(120) {
                val p = genProblem(g.key, Random(it + 7))
                val flipped = if (p.op == "×") p.value / p.ratio else p.value * p.ratio
                if (flipped > 0 && flipped == flipped.toLong().toDouble()) {
                    val s = unitNumStr(flipped)
                    assertTrue(
                        "${p.fullText} 的方向错答 $s 既没进选项、也没被 trap 点破 —— " +
                            "这个错答就永远不会被提到。options=${p.steps[2].options.joinToString("/")} trap=${p.trap}",
                        p.steps[2].options.contains(s) || p.trap == flipped,
                    )
                    seen++
                }
            }
        }
        assertTrue("方向陷阱样本太少：$seen", seen > 100)
    }

    @Test
    fun `genProblemSet：一组内不重复，且每道都对`() {
        for (g in PROBLEM_GROUPS) {
            val set = genProblemSet(g.key, 6, Random(20261001))
            assertEquals("${g.key} 应当抽到 6 道", 6, set.size)
            val tags = set.map { "${it.from.id.key}-${it.to.id.key}-${unitNumStr(it.value)}" }
            assertEquals("${g.key} 一组内出现了重复题", tags.size, tags.toSet().size)
            for (p in set) assertEquals(convert(p.value, p.from, p.to), p.result, 1e-9)
        }
    }

    @Test
    fun `未知题组、未知单位都要报错，不能悄悄返回一个默认值`() {
        val threwGroup = try {
            genProblem(ProblemGroupKey.fromKey("nope"))
            false
        } catch (e: IllegalArgumentException) {
            true
        }
        assertTrue(threwGroup)
        val threwUnit = try {
            unitOf("furlong")
            false
        } catch (e: IllegalArgumentException) {
            true
        }
        assertTrue(threwUnit)
    }

    // ── 静态教学资料 ────────────────────────────────────────

    @Test
    fun `米尺事实表的每条 text 都能被引擎复算出来`() {
        val facts = LENGTH_FACTS + MASS_FACTS
        val re = Regex("^(\\d+)(\\S+) = (\\d+)(\\S+)$")
        var checked = 0
        for (f in facts) {
            val m = re.matchEntire(f.text) ?: error("事实文案格式变了，无法复算：${f.text}")
            val (v, ua, want, ub) = m.destructured
            val A = UNITS.firstOrNull { it.name == ua } ?: error("未知单位名：$ua")
            val B = UNITS.firstOrNull { it.name == ub } ?: error("未知单位名：$ub")
            assertEquals("${f.text} 与引擎算出来的不一致", want.toDouble(), convert(v.toDouble(), A, B), 1e-9)
            assertTrue("note 不能空", f.note.isNotBlank())
            checked++
        }
        assertEquals("事实条数应为 9", 9, checked)
    }

    @Test
    fun `★ 易错案例：每条的「正确写法」引擎能复算、「错误写法」引擎算不出那个数`() {
        val re = Regex("^(\\d+)(\\S+?) = (\\d+)(\\S+?)$")
        var checked = 0
        for (c in UNIT_MISTAKE_CASES) {
            assertNotEquals(c.wrong, c.right)
            assertTrue("why/tip 不能为空", c.why.isNotBlank() && c.tip.isNotBlank())
            for (s in listOf(c.wrong, c.right, c.why, c.tip)) {
                assertTrue("文案里混进了 markdown 星号（页面上会原样露出来）：$s", !s.contains("**"))
            }
            val mr = re.matchEntire(c.right) ?: continue
            val (rv, ru, rwant, ru2) = mr.destructured
            val RA = UNITS.firstOrNull { it.name == ru } ?: continue
            val RB = UNITS.firstOrNull { it.name == ru2 } ?: continue
            if (RA.kind != RB.kind) continue
            // 正确写法必须与引擎一致
            assertEquals("「${c.right}」与引擎不一致", rwant.toDouble(), convert(rv.toDouble(), RA, RB), 1e-9)
            // 错误写法若也是同一种形态，必须真的算不出那个数
            val mw = re.matchEntire(c.wrong)
            if (mw != null) {
                val (wv, wu, wwant, wu2) = mw.destructured
                val WA = UNITS.firstOrNull { it.name == wu }
                val WB = UNITS.firstOrNull { it.name == wu2 }
                if (WA != null && WB != null && WA.kind == WB.kind) {
                    assertNotEquals(
                        "「${c.wrong}」居然是真事实，那它就不该出现在易错表里",
                        wwant.toDouble(),
                        convert(wv.toDouble(), WA, WB),
                        1e-9,
                    )
                    checked++
                }
            }
        }
        assertTrue("至少应验算到 4 条易错案例，实际 $checked", checked >= 4)
    }

    @Test
    fun `规律卡三条都在，且文案里没有 markdown 星号`() {
        assertEquals(3, UNIT_RULES.size)
        for (r in UNIT_RULES) {
            assertTrue(r.title.isNotBlank() && r.body.isNotBlank())
            assertTrue("规律卡混进了星号：${r.title}", !r.title.contains("**") && !r.body.contains("**"))
        }
    }

    @Test
    fun `每个单位的参照物都不为空，且 sense 讲的是「怎么用手比」`() {
        for (u in UNITS) {
            assertTrue("${u.name} 没有参照物", u.refs.isNotEmpty())
            assertTrue("${u.name} 的 sense 不能空", u.sense.isNotBlank())
            for (r in u.refs) {
                assertTrue("${u.name} 的参照物缺少名字/细节", r.name.isNotBlank() && r.detail.isNotBlank())
                assertTrue("${u.name} 的参照物缺少图标键", r.icon.isNotBlank())
                // ★ 图标键必须真的存在 —— 拼错了在页面上只表现为「这个参照物没图」，肉眼很难发现
                assertNotNull("${u.name} 的参照物图标「${r.icon}」不在 MathIcons 里", MathIcons[r.icon])
            }
        }
        // 能按真实尺寸画的只有毫米/厘米/分米 ——「1米 = 1000 毫米 ≈ 3779 像素，放不下」
        // ★ 与 web 实测一致：mm/cm/dm 的 onScreenReal 是 true，m 就是 false（别想当然地把米也算进去）
        assertEquals(
            listOf("毫米", "厘米", "分米"),
            UNITS.filter { it.onScreenReal }.map { it.name },
        )
        // 真实尺寸条只对 bar/slab 两种形态
        for (u in UNITS) for (r in u.refs) r.draw?.let {
            assertTrue("${u.name} 的绘制形态只能是 bar/slab，实际 ${it.form}", it.form == "bar" || it.form == "slab")
            assertTrue("baseAmount 必须是正数", it.baseAmount > 0)
        }
    }
}
