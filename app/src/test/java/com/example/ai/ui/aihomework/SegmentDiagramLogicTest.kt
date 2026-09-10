package com.example.ai.ui.aihomework

import com.example.ai.data.aihomework.QuantityItem
import com.example.ai.data.aihomework.QuantityRelation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 线段图关系归一化 + 链式推算的单元测试（对应 SegmentDiagramLogic.kt） */
class SegmentDiagramLogicTest {

    private fun q(name: String, value: Float? = null, unit: String = "") = QuantityItem(name, value, unit)

    private fun rel(a: String, b: String, type: String, amount: Float = 0f, parts: List<String> = emptyList()) =
        QuantityRelation(a = a, b = b, type = type, amount = amount, parts = parts)

    // ── firstRelFor：双向视角 ──

    @Test
    fun `times 关系 - 主体方视角不 inverted，基准方视角 inverted`() {
        val quantities = listOf(q("前年", 9f), q("去年"), q("今年"))
        val relations = listOf(rel("去年", "前年", "times", 4f))

        val qiannian = quantities.first { it.name == "前年" }
        val qunian = quantities.first { it.name == "去年" }

        // 去年（主体 a）：正向，base=前年
        val vQunian = firstRelFor(qunian, quantities, relations)
        assertNotNull(vQunian)
        assertEquals("times", vQunian!!.type)
        assertEquals("前年", vQunian.base?.name)
        assertFalse(vQunian.inverted)

        // 前年（基准 b）：inverted=true —— 关键：基准方不应被切分
        val vQiannian = firstRelFor(qiannian, quantities, relations)
        assertNotNull(vQiannian)
        assertEquals("times", vQiannian!!.type)
        assertEquals("去年", vQiannian.base?.name)
        assertTrue(vQiannian.inverted)
    }

    @Test
    fun `more 关系 - 基准方视角倒转成 less`() {
        val quantities = listOf(q("小明", 5f), q("小红"))
        val relations = listOf(rel("小明", "小红", "more", 3f))  // 小明比小红多3

        // 小红（基准 b）视角：应变成 "小红比小明少3" 且 inverted
        val xiaohong = quantities.first { it.name == "小红" }
        val v = firstRelFor(xiaohong, quantities, relations)
        assertNotNull(v)
        assertEquals("less", v!!.type)
        assertTrue(v.inverted)
        assertEquals("小明", v.base?.name)
        assertEquals(3f, v.amount)
    }

    @Test
    fun `total 关系 - 主体方解析 parts，基准方无关系`() {
        val quantities = listOf(q("小明", 5f), q("小红", 3f), q("一共"))
        val relations = listOf(rel("一共", "", "total", parts = listOf("小明", "小红")))

        val yigong = quantities.first { it.name == "一共" }
        val v = firstRelFor(yigong, quantities, relations)
        assertNotNull(v)
        assertEquals("total", v!!.type)
        assertEquals(2, v.parts.size)

        // 小明不参与 total（它是分量不是主体）
        val xiaoming = quantities.first { it.name == "小明" }
        assertNull(firstRelFor(xiaoming, quantities, relations))
    }

    // ── effectiveValue：链式推算 ──

    @Test
    fun `链式推算 - 前年9 去年x4 今年+6`() {
        val quantities = listOf(q("前年", 9f), q("去年"), q("今年"))
        val relations = listOf(
            rel("去年", "前年", "times", 4f),
            rel("今年", "去年", "more", 6f),
        )

        assertEquals(9f, effectiveValue(quantities.first { it.name == "前年" }, quantities, relations))
        assertEquals(36f, effectiveValue(quantities.first { it.name == "去年" }, quantities, relations))
        // 关键回归：今年依赖推算出来的去年（value=null），必须算出 42 而非失败
        assertEquals(42f, effectiveValue(quantities.first { it.name == "今年" }, quantities, relations))
    }

    @Test
    fun `times 倒转 - 基准方未知时 q = a 除以倍数`() {
        // 文具盒 6 元，是铅笔的 3 倍 → 铅笔 = 6 ÷ 3 = 2
        val quantities = listOf(q("文具盒", 6f), q("铅笔"))
        val relations = listOf(rel("文具盒", "铅笔", "times", 3f))

        assertEquals(2f, effectiveValue(quantities.first { it.name == "铅笔" }, quantities, relations))
    }

    @Test
    fun `total - 全部分量已知时求和`() {
        val quantities = listOf(q("小明", 5f), q("小红", 3f), q("一共"))
        val relations = listOf(rel("一共", "", "total", parts = listOf("小明", "小红")))

        assertEquals(8f, effectiveValue(quantities.first { it.name == "一共" }, quantities, relations))
    }

    @Test
    fun `total - 分量有未知时无法求和返回 null`() {
        val quantities = listOf(q("小明", 5f), q("小红"), q("一共"))
        val relations = listOf(rel("一共", "", "total", parts = listOf("小明", "小红")))

        assertNull(effectiveValue(quantities.first { it.name == "一共" }, quantities, relations))
    }

    @Test
    fun `无关系可推算时返回 null`() {
        val quantities = listOf(q("未知量"))
        assertEquals(null, effectiveValue(quantities.first(), emptyList(), emptyList()))
    }

    @Test
    fun `关系成环时不死循环返回 null`() {
        // A = B×2, B = A×2 的异常环
        val quantities = listOf(q("A"), q("B"))
        val relations = listOf(
            rel("A", "B", "times", 2f),
            rel("B", "A", "times", 2f),
        )

        assertNull(effectiveValue(quantities.first { it.name == "A" }, quantities, relations))
    }

    // ── fmt ──

    @Test
    fun `fmt 整数不带小数`() {
        assertEquals("9", fmt(9f))
        assertEquals("36", fmt(36f))
    }

    @Test
    fun `fmt 非整数保留一位`() {
        assertEquals("2.5", fmt(2.5f))
        assertEquals("0.3", fmt(1f / 3f))
    }

    // ── findItem：名称容错匹配 ──

    @Test
    fun `findItem 支持包含关系匹配`() {
        val quantities = listOf(q("前年"), q("去年的产量"), q("一共"))
        assertNotNull(findItem("去年", quantities))
        assertEquals("去年的产量", findItem("去年", quantities)!!.name)
        assertNull(findItem("不存在", quantities))
    }

    // ── isDerivedDiffQuantity：差值派生实体不画独立行 ──

    @Test
    fun `贵的金额 仅作 amount=0 的 more 主体时判定为差值派生`() {
        val relations = listOf(
            rel("成人票", "儿童票", "times", 3f),
            rel("成人票", "儿童票", "more", 0f),  // 求贵多少 → 贵的金额是派生差值
        )
        val gui = q("贵的金额")
        assertTrue(isDerivedDiffQuantity(gui, relations))
    }

    @Test
    fun `已知量不是差值派生`() {
        val relations = listOf(rel("成人票", "儿童票", "more", 0f))
        assertFalse(isDerivedDiffQuantity(q("儿童票", 8f), relations))
    }

    @Test
    fun `参与其他角色时不判定为差值派生`() {
        val relations = listOf(
            rel("成人票", "儿童票", "more", 0f),
            rel("成人票", "贵的金额", "more", 3f),
        )
        // 贵的金额 是 other 关系的基准方 → 有角色，不跳过
        assertFalse(isDerivedDiffQuantity(q("贵的金额"), relations))
    }

    // ── diffSegmentValues：差值实体 = 基准段 + 红色差值段 ──

    @Test
    fun `贵的金额 差值段 = 成人票推算 - 儿童票`() {
        val quantities = listOf(q("儿童票", 8f), q("成人票"), q("贵的金额"))
        val relations = listOf(
            rel("成人票", "儿童票", "times", 3f),
            rel("成人票", "儿童票", "more", 0f),
        )
        val seg = diffSegmentValues(
            quantities.first { it.name == "贵的金额" }, quantities, relations,
        )
        assertNotNull(seg)
        assertEquals(8f, seg!!.first)    // 基准段 = 儿童票
        assertEquals(16f, seg.second)    // 差值段 = 24 - 8 = 16
    }

    @Test
    fun `非差值实体 diffSegmentValues 返回 null`() {
        val quantities = listOf(q("儿童票", 8f), q("成人票"))
        val relations = listOf(rel("成人票", "儿童票", "times", 3f))
        assertNull(diffSegmentValues(quantities.first { it.name == "成人票" }, quantities, relations))
    }

    // ── describeRelation / describeRelations：关系说明自然语言 ──

    @Test
    fun `times 关系 - 牛奶是牛角包的2倍`() {
        val quantities = listOf(q("牛奶"), q("牛角包", 4f))
        val r = rel("牛奶", "牛角包", "times", 2f)
        assertEquals("牛奶是牛角包的2倍", describeRelation(r, quantities))
    }

    @Test
    fun `more less 关系 - 带单位`() {
        val quantities = listOf(
            q("剩下的钱"), q("妈妈的钱", 20f, "元"),
            q("成人票"), q("儿童票", 8f, "元"),
        )
        assertEquals("剩下的钱比妈妈的钱少5元", describeRelation(rel("剩下的钱", "妈妈的钱", "less", 5f), quantities))
        assertEquals("成人票比儿童票多3元", describeRelation(rel("成人票", "儿童票", "more", 3f), quantities))
    }

    @Test
    fun `more 关系 - amount 为 0 时是求差值问句`() {
        val quantities = listOf(q("成人票"), q("儿童票", 8f))
        assertEquals("成人票比儿童票多多少？", describeRelation(rel("成人票", "儿童票", "more", 0f), quantities))
    }

    @Test
    fun `total 关系 - 一共 = 分量相加`() {
        val quantities = listOf(q("牛奶"), q("牛角包"), q("一共"))
        val r = rel("一共", "", "total", parts = listOf("牛奶", "牛角包"))
        assertEquals("一共 = 牛奶 + 牛角包", describeRelation(r, quantities))
    }

    @Test
    fun `结构不完整的关系返回 null`() {
        val quantities = listOf(q("牛奶"))
        assertNull(describeRelation(rel("", "牛角包", "times", 2f), quantities))  // 缺主体
        assertNull(describeRelation(rel("牛奶", "", "times", 2f), quantities))    // 缺基准
        assertNull(describeRelation(rel("一共", "", "total"), quantities))        // total 无分量
        assertNull(describeRelation(rel("牛奶", "牛角包", "unknown", 2f), quantities)) // 未知类型
    }

    @Test
    fun `describeRelations 保持顺序并跳过无效`() {
        val quantities = listOf(q("牛奶"), q("牛角包", 4f), q("妈妈的钱", 20f, "元"), q("剩下的钱"), q("一共"))
        val relations = listOf(
            rel("牛奶", "牛角包", "times", 2f),
            rel("", "", "times", 3f),                       // 无效，跳过
            rel("剩下的钱", "妈妈的钱", "less", 5f),
            rel("一共", "", "total", parts = listOf("牛奶", "牛角包")),
        )
        assertEquals(
            listOf("牛奶是牛角包的2倍", "剩下的钱比妈妈的钱少5元", "一共 = 牛奶 + 牛角包"),
            describeRelations(relations, quantities),
        )
    }
}
