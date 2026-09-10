package com.example.ai.ui.aihomework

import com.example.ai.data.aihomework.AutoBrace
import com.example.ai.data.aihomework.AutoBuildResult
import com.example.ai.data.aihomework.AutoDiff
import com.example.ai.data.aihomework.AutoSegment
import com.example.ai.data.aihomework.AutoTimes
import com.example.ai.data.aihomework.BlockSuggestion
import com.example.ai.data.aihomework.BraceBlock
import com.example.ai.data.aihomework.BuilderBlock
import com.example.ai.data.aihomework.DynamicBlock
import com.example.ai.data.aihomework.MidPoint
import com.example.ai.data.aihomework.NodeCircleBlock
import com.example.ai.data.aihomework.PersonBlock
import com.example.ai.data.aihomework.SegmentBlock
import com.example.ai.data.aihomework.TextBlock
import com.example.ai.data.aihomework.ValueLabelBlock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** BlockBuilderLogic 纯函数单测：积木创建 / 移动缩放 / 序列化语义描述 / 撤销栈 */
class BlockBuilderLogicTest {

    // ── 积木创建 ──

    @Test
    fun newSegment_defaultIsSolid() {
        val s = newSegmentBlock()
        assertFalse(s.dashed)
        assertTrue(s.id.isNotBlank())
        assertEquals(0.5f, s.x) // 默认居中，完整落在画布内
    }

    @Test
    fun newSegment_dashedFlag() {
        assertTrue(newSegmentBlock(dashed = true).dashed)
    }

    @Test
    fun newBrace_allFourDirections() {
        for (d in listOf("down", "up", "left", "right")) {
            assertEquals(d, newBraceBlock(d).direction)
        }
    }

    @Test
    fun newDynamicBlock_copiesSuggestion() {
        val sug = BlockSuggestion(
            type = "multi-segment", name = "倍数条",
            params = mapOf("segments" to "3", "color" to "green"),
            usage = "用3段拼成",
        )
        val b = newDynamicBlock(sug)
        assertEquals("multi-segment", b.type)
        assertEquals("倍数条", b.name)
        assertEquals("3", b.params["segments"])
        assertEquals("用3段拼成", b.note)
        assertEquals(3, b.segments)
        assertEquals("green", b.defaultColor)
    }

    @Test
    fun newDynamicBlock_segmentsFallback() {
        val b = DynamicBlock(id = "x", type = "multi-segment", name = "条")
        assertEquals(2, b.segments)
    }

    @Test
    fun newBlockId_unique() {
        assertNotEquals(newBlockId(), newBlockId())
    }

    // ── 移动 / 缩放 ──

    @Test
    fun moveBlock_clampsToCanvas() {
        val s = newSegmentBlock()
        val m = moveBlock(s, 5f, 5f)
        assertEquals(1f, m.x)
        assertEquals(1f, m.y)
        val m2 = moveBlock(s, -5f, -5f)
        assertEquals(0f, m2.x)
        assertEquals(0f, m2.y)
    }

    @Test
    fun moveBlock_preservesIdentity() {
        val s = newSegmentBlock()
        val m = moveBlock(s, 0.1f, -0.2f)
        assertEquals(s.id, m.id)
        assertEquals(s.label, (m as SegmentBlock).label) // 其他字段不变
        assertEquals(s.w, m.w)
    }

    @Test
    fun resizeBlock_clampsWidth() {
        val b = newBraceBlock("down")
        assertEquals(1f, resizeBlock(b, 3f).w)
        assertEquals(0.08f, resizeBlock(b, -1f).w)
        assertEquals(0.4f, resizeBlock(b, 0.4f).w)
    }

    // ── 序列化 / 语义描述 ──

    @Test
    fun toBuildItems_segmentKindsAndNotes() {
        val known = SegmentBlock(id = "a", label = "故事书", value = "126", unit = "本")
        val unknown = SegmentBlock(id = "b", label = "科技书", value = "")
        val dashed = SegmentBlock(id = "c", label = "差值", value = "3", unit = "个", dashed = true)
        val items = toBuildItems(listOf(known, unknown, dashed))
        assertEquals(listOf("segment", "segment", "dashed_segment"), items.map { it.kind })
        assertEquals("线段「故事书」= 126本（已知量）", items[0].note)
        assertEquals("未知量线段「科技书」（题目所求）", items[1].note)
        assertEquals("虚线线段「差值」= 3个（差值/关系标注）", items[2].note)
    }

    @Test
    fun toBuildItems_braceSemantic() {
        val b = BraceBlock(id = "x", direction = "down", label = "一共？个")
        val item = toBuildItems(listOf(b)).single()
        assertEquals("brace", item.kind)
        assertEquals("down", item.direction)
        assertEquals("大括号开口向下「一共？个」（框住跨度内几个量，表示这些量合并/一共）", item.note)
    }

    @Test
    fun toBuildItems_textAndLabels() {
        val t = TextBlock(id = "t", text = "多3个")
        val v = ValueLabelBlock(id = "v", text = "126本")
        val n = NodeCircleBlock(id = "n", name = "一共", unknown = true)
        val items = toBuildItems(listOf(t, v, n))
        assertEquals(listOf("text", "value_label", "node_circle"), items.map { it.kind })
        assertEquals("自由文本「多3个」", items[0].note)
        assertEquals("数值标签「126本」", items[1].note)
        assertEquals("未知量节点圆「一共」（题目所求）", items[2].note)
    }

    @Test
    fun toBuildItems_dynamicMultiSegment() {
        val d = DynamicBlock(
            id = "d", type = "multi-segment", name = "倍数条",
            params = mapOf("segments" to "3"), note = "用3段拼成",
        )
        val item = toBuildItems(listOf(d)).single()
        assertEquals("dynamic", item.kind)
        assertEquals("multi-segment", item.type)
        assertTrue(item.note.contains("分 3 段"))
        assertTrue(item.note.contains("倍数/均分关系"))
        assertTrue(item.note.contains("用3段拼成"))
    }

    // ── 磁吸（仅两端点，同类型） ──

    private fun seg(id: String, x: Float, y: Float, w: Float = 0.2f) =
        SegmentBlock(id = id, x = x, y = y, w = w)

    @Test
    fun snapBlock_xFarDoesNotSnapEvenIfYNear() {
        // y 接近但 x 端点很远（x=0.8 vs 0.5）→ 不吸附（端点必须接近）
        val target = seg("a", x = 0.5f, y = 0.5f)
        val moving = seg("b", x = 0.8f, y = 0.48f)
        val snapped = snapBlock(moving, listOf(target), 1000f, 280f, 20f)
        assertEquals(0.8f, snapped.x)
        assertEquals(0.48f, snapped.y)
    }

    @Test
    fun snapBlock_endpointAligns() {
        // 拖动块左端 → 目标右端（x、y 都接近）→ 端点对齐
        val target = seg("a", x = 0.5f, y = 0.5f, w = 0.2f) // 右端 x = 0.6
        val moving = seg("b", x = 0.695f, y = 0.5f, w = 0.2f) // 左端 x = 0.595，距右端 0.005
        val snapped = snapBlock(moving, listOf(target), 1000f, 280f, 20f)
        // 吸附后 moving 左端 = target 右端 → x = 0.6 + 0.1 = 0.7
        assertEquals(0.7f, snapped.x, 0.0001f)
        assertEquals(0.5f, snapped.y)
    }

    @Test
    fun snapBlock_leftEndToLeftEndAligns() {
        // 左端对左端同样磁吸
        val target = seg("a", x = 0.5f, y = 0.5f, w = 0.2f) // 左端 x = 0.4
        val moving = seg("b", x = 0.495f, y = 0.5f, w = 0.2f) // 左端 x = 0.395，距 0.4 差 0.005
        val snapped = snapBlock(moving, listOf(target), 1000f, 280f, 20f)
        // moving 左端 0.395 → target 左端 0.4：x = 0.495 - (0.395 - 0.4) = 0.5
        assertEquals(0.5f, snapped.x, 0.0001f)
        assertEquals(0.5f, snapped.y)
    }

    @Test
    fun snapBlock_yFarDoesNotSnapEvenIfXEndpointNear() {
        // 端点 x 接近但 y 差大（0.5 vs 0.2，差 0.3 > 阈值 0.071）→ 不吸附
        val target = seg("a", x = 0.5f, y = 0.5f, w = 0.2f)
        val moving = seg("b", x = 0.695f, y = 0.2f, w = 0.2f) // 左端 0.595 距右端 0.6 差 0.005，但 y 差 0.3
        val snapped = snapBlock(moving, listOf(target), 1000f, 280f, 20f)
        assertEquals(0.695f, snapped.x)
        assertEquals(0.2f, snapped.y)
    }

    @Test
    fun snapBlock_noSnapWhenFar() {
        val target = seg("a", x = 0.5f, y = 0.5f)
        val moving = seg("b", x = 0.8f, y = 0.2f) // 距离远超阈值
        val snapped = snapBlock(moving, listOf(target), 1000f, 280f, 20f)
        assertEquals(0.8f, snapped.x)
        assertEquals(0.2f, snapped.y)
    }

    @Test
    fun snapBlock_ignoresDifferentTypes() {
        val target = seg("a", x = 0.5f, y = 0.5f)
        val movingNode = NodeCircleBlock(id = "n", x = 0.51f, y = 0.51f)
        val snapped = snapBlock(movingNode, listOf(target), 1000f, 280f, 20f)
        assertEquals(0.51f, snapped.x) // 不同类型不吸附
        assertEquals(0.51f, snapped.y)
    }

    @Test
    fun snapBlock_circleAlignsCenter() {
        val a = NodeCircleBlock(id = "a", x = 0.5f, y = 0.5f)
        val b = NodeCircleBlock(id = "b", x = 0.505f, y = 0.505f)
        val snapped = snapBlock(b, listOf(a), 1000f, 280f, 20f)
        assertEquals(0.5f, snapped.x)
        assertEquals(0.5f, snapped.y)
    }

    // ── 均分切割 / 倍数拼接 语义 ──

    @Test
    fun toBuildItems_segmentSplitNote() {
        val s = SegmentBlock(id = "a", label = "苹果", value = "90", unit = "个", segments = 3)
        val item = toBuildItems(listOf(s)).single()
        assertEquals(3, item.segments)
        assertTrue(item.note.contains("平均分成 3 份"))
        assertTrue(item.note.contains("总量不变"))
    }

    @Test
    fun toBuildItems_segmentSplitWithRemainderNote() {
        // 25 平均分 3 段：每份 8，余 1（橙色段）
        val s = SegmentBlock(id = "a", label = "苹果", value = "25", unit = "个", segments = 3)
        val item = toBuildItems(listOf(s)).single()
        assertTrue(item.note.contains("平均分成 3 份每份 8"))
        assertTrue(item.note.contains("余 1个 用橙色段表示"))
    }

    @Test
    fun toBuildItems_segmentTimesNote() {
        val s = SegmentBlock(id = "a", label = "科技书", value = "60", unit = "本", times = 3)
        val item = toBuildItems(listOf(s)).single()
        assertEquals(3, item.times)
        assertTrue(item.note.contains("3 段等长复制拼接"))
        assertTrue(item.note.contains("3 倍关系"))
    }

    @Test
    fun toBuildItems_segmentExtraNote() {
        val s = SegmentBlock(id = "a", label = "去年产量", value = "36", unit = "千克", extra = 6f)
        val item = toBuildItems(listOf(s)).single()
        assertEquals(6f, item.extra, 0.001f)
        assertTrue(item.note.contains("另向右增加 6千克（绿色虚线延长段）"))
    }

    @Test
    fun toBuildItems_segmentExtraLeftNote() {
        val s = SegmentBlock(id = "a", label = "前年产量", value = "36", unit = "千克", extra = 6f, extraDir = "left")
        val item = toBuildItems(listOf(s)).single()
        assertEquals("left", item.extraDir)
        assertTrue(item.note.contains("另向左增加 6千克（绿色虚线延长段）"))
    }

    @Test
    fun toBuildItems_segmentEndpointLabelsNote() {
        val s = SegmentBlock(
            id = "a", label = "行驶时间", value = "60", unit = "分钟",
            leftLabel = "9:00 出发", rightLabel = "10:00 到达",
        )
        val item = toBuildItems(listOf(s)).single()
        assertTrue(item.note.contains("左端点：9:00 出发"))
        assertTrue(item.note.contains("右端点：10:00 到达"))
    }

    @Test
    fun toBuildItems_segmentNoEndpointLabelsNoNote() {
        val s = SegmentBlock(id = "a", label = "故事书", value = "126", unit = "本")
        val item = toBuildItems(listOf(s)).single()
        assertFalse(item.note.contains("端点"))
    }

    @Test
    fun toBuildItems_segmentMidEndpointNote() {
        val s = SegmentBlock(
            id = "a", label = "路程", value = "60", unit = "米",
            midPoints = listOf(MidPoint(label = "第一次休息", pos = "10"), MidPoint(label = "第二次休息", pos = "30")),
        )
        val item = toBuildItems(listOf(s)).single()
        assertTrue(item.note.contains("中间端点：「第一次休息」距左端 10、「第二次休息」距左端 30"))
        assertTrue(item.note.contains("各段数量：10、20、30米"))
    }

    @Test
    fun parseMidPoints_acceptsMultiple() {
        val pts = parseMidPoints("10=第一次; 30=第二次, 45:第三次")
        assertNotNull(pts)
        assertEquals(3, pts!!.size)
        assertEquals("第一次", pts[0].label)
        assertEquals("10", pts[0].pos)
        assertEquals("第三次", pts[2].label)
        assertEquals("45", pts[2].pos)
    }

    @Test
    fun parseMidPoints_rejectsGarbage() {
        assertNull(parseMidPoints("abc=第一次"))
        assertNull(parseMidPoints("10=第一次; 坏格式"))
        assertNull(parseMidPoints("-5=第一次"))
        assertNull(parseMidPoints("10="))
        assertNull(parseMidPoints("10"))
    }

    @Test
    fun parseMidPoints_emptyIsEmptyList() {
        assertEquals(emptyList<MidPoint>(), parseMidPoints(""))
    }

    @Test
    fun rescale_extraCountsInMaxTotal() {
        // A=100（主段）+ extra 200 → 总长 300 为最大；B=150 → 总长 150
        val blocks = listOf(
            SegmentBlock(id = "a", label = "A", value = "100", unit = "米", w = 0.5f, extra = 200f),
            SegmentBlock(id = "b", label = "B", value = "150", unit = "米", w = 0.5f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        // 主段宽度 = k × value（k = 0.9/300）
        assertEquals(0.3f, a.w, 0.001f) // 100/300×0.9
        assertEquals(0.45f, b.w, 0.001f) // 150/300×0.9
    }

    @Test
    fun toBuildItems_segmentPlainDefaults() {
        val s = SegmentBlock(id = "a", label = "故事书", value = "126", unit = "本")
        val item = toBuildItems(listOf(s)).single()
        assertEquals(1, item.segments) // 默认不切割
        assertEquals(1, item.times) // 默认不放大
        assertEquals("线段「故事书」= 126本（已知量）", item.note)
    }

    // ── 新积木错位放置（避免重叠） ──

    @Test
    fun placeNewBlock_firstStaysDefault() {
        val b = newSegmentBlock()
        val placed = placeNewBlock(b, emptyList())
        assertEquals(0.5f, placed.x)
        assertEquals(0.3f, placed.y)
    }

    @Test
    fun placeNewBlock_sameTypeOffsetsDown() {
        val first = newSegmentBlock()
        val second = placeNewBlock(newSegmentBlock(), listOf(first))
        assertEquals(first.y + 0.11f, second.y, 0.0001f) // 向下错开
        assertEquals(first.x, second.x)
    }

    @Test
    fun placeNewBlock_ignoresDifferentTypes() {
        val seg = newSegmentBlock()
        val brace = placeNewBlock(newBraceBlock("down"), listOf(seg))
        assertEquals(0.4f, brace.x) // 不同类型不计数，保持默认
        assertEquals(0.5f, brace.y)
    }

    @Test
    fun placeNewBlock_wrapsColumnEvery7() {
        val segs = List(7) { newSegmentBlock() }
        val eighth = placeNewBlock(newSegmentBlock(), segs)
        assertEquals(segs[0].x + 0.15f, eighth.x, 0.0001f) // 换列
        assertEquals(segs[0].y, eighth.y, 0.0001f)
    }

    // ── 线段长度全局等比缩放（无基准） ──

    private fun seg2(id: String, label: String, value: String, w: Float) =
        SegmentBlock(id = id, label = label, value = value, w = w)

    @Test
    fun rescale_initialK_scalesLongestTo090() {
        // 无 k 传入：最长线段 = 0.9，其余按数值比例
        val blocks = listOf(
            seg2("a", "故事书", "126", 0.6f),
            seg2("b", "科技书", "63", 0.6f),
            seg2("c", "童话书", "252", 0.6f),
        )
        val (out, k) = rescaleSegmentLengths(blocks)
        assertTrue(k > 0f)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        val c = out.filterIsInstance<SegmentBlock>().first { it.id == "c" }
        assertEquals(0.9f, c.w, 0.001f) // 最长 252 → 0.9
        assertEquals(0.45f, a.w, 0.001f) // 126/252×0.9
        assertEquals(0.225f, b.w, 0.001f) // 63/252×0.9
        assertEquals(c.w / a.w, 2f, 0.001f) // 比例保持
        assertEquals(c.w / b.w, 4f, 0.001f)
    }

    @Test
    fun rescale_existingK_preserved() {
        // 传入 k：长度 = k × 数值，保持比例
        val blocks = listOf(
            seg2("a", "A", "100", 0.5f),
            seg2("b", "B", "50", 0.5f),
            seg2("c", "C", "25", 0.5f),
        )
        val (out, k) = rescaleSegmentLengths(blocks, kIn = 0.006f)
        assertEquals(0.006f, k, 0.0001f)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        val c = out.filterIsInstance<SegmentBlock>().first { it.id == "c" }
        assertEquals(0.6f, a.w, 0.001f) // 100×0.006
        assertEquals(0.3f, b.w, 0.001f)
        assertEquals(0.15f, c.w, 0.001f)
    }

    @Test
    fun rescale_scaleDownWhenExceedsCanvas() {
        // 传入 k 过大 → 最长超画布 → 仅本次显示等比缩小（k 不被污染）
        val blocks = listOf(
            seg2("a", "A", "100", 0.5f),
            seg2("b", "B", "200", 0.5f),
            seg2("c", "C", "400", 0.5f),
        )
        val (out, k) = rescaleSegmentLengths(blocks, kIn = 0.01f) // 400×0.01 = 4 > 1
        assertEquals(0.01f, k, 0.0001f) // k 保持用户设定
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        val c = out.filterIsInstance<SegmentBlock>().first { it.id == "c" }
        assertEquals(0.25f, a.w, 0.001f) // 100×0.01×0.25
        assertEquals(0.5f, b.w, 0.001f)
        assertEquals(1f, c.w, 0.001f) // 最大贴满画布
        assertEquals(c.w / a.w, 4f, 0.001f) // 比例保持
    }

    @Test
    fun rescale_bigThenSmallRecoversProportion() {
        // 回归：A=100 初始化 k → B 填超大超画布 → B 改小，A 长度恢复（k 不被超画布缩小污染）
        // 1) A=100 → k = 0.9/100
        val (_, k) = rescaleSegmentLengths(listOf(seg2("a", "A", "100", 0.5f)))
        // 2) B=10000 → 超画布：仅显示缩放，k 保持
        val big = listOf(
            seg2("a", "A", "100", 0.5f),
            seg2("b", "B", "10000", 0.5f),
        )
        val (outBig, kBig) = rescaleSegmentLengths(big, k)
        assertEquals(k, kBig, 0.0001f) // k 不被污染
        val bBig = outBig.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(1f, bBig.w, 0.001f) // B 显示贴满画布（超画布时最长贴 1）
        // 3) B 改回 50 → 同一 k → 比例恢复
        val small = listOf(
            seg2("a", "A", "100", 0.5f),
            seg2("b", "B", "50", 0.5f),
        )
        val (out2, k2) = rescaleSegmentLengths(small, k)
        assertEquals(k, k2, 0.0001f)
        val a2 = out2.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b2 = out2.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a2.w, 0.001f) // A 恢复最长 0.9
        assertEquals(0.45f, b2.w, 0.001f) // B 恢复 0.45（100:50 比例）
    }

    @Test
    fun rescale_unitSwitchCycleRecovers() {
        // 回归：反复切换 B 的单位（米→千米超画布→米），切回后比例恢复
        // 1) A=100米 初始化 k
        var blocks: List<BuilderBlock> = listOf(SegmentBlock(id = "a", label = "A", value = "100", unit = "米", w = 0.5f))
        var (nb, k) = rescaleSegmentLengths(blocks)
        blocks = nb
        // 2) B=50米
        blocks = blocks + SegmentBlock(id = "b", label = "B", value = "50", unit = "米", w = 0.5f)
        val r2 = rescaleSegmentLengths(blocks, k)
        blocks = r2.first; k = r2.second
        // 3) B 单位 → 千米（50千米=50000米，超画布）
        blocks = blocks.map { if (it.id == "b") (it as SegmentBlock).copy(unit = "千米") else it }
        val r3 = rescaleSegmentLengths(blocks, k)
        blocks = r3.first; k = r3.second
        val bKm = blocks.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(1f, bKm.w, 0.001f) // 超画布 → 显示贴满
        // 4) B 单位 → 米（恢复）
        blocks = blocks.map { if (it.id == "b") (it as SegmentBlock).copy(unit = "米") else it }
        val r4 = rescaleSegmentLengths(blocks, k)
        blocks = r4.first; k = r4.second
        val a4 = blocks.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b4 = blocks.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a4.w, 0.001f) // A 恢复最长
        assertEquals(0.45f, b4.w, 0.001f) // B 恢复 0.45
    }

    @Test
    fun rescale_unitSwitchRefUnitRecovers() {
        // 回归：切换 ref（第一根有值线段）的单位，切回后比例恢复
        var blocks: List<BuilderBlock> = listOf(SegmentBlock(id = "a", label = "A", value = "100", unit = "米", w = 0.5f))
        var (nb, k) = rescaleSegmentLengths(blocks)
        blocks = nb
        blocks = blocks + SegmentBlock(id = "b", label = "B", value = "50", unit = "米", w = 0.5f)
        val r2 = rescaleSegmentLengths(blocks, k)
        blocks = r2.first; k = r2.second
        // A 单位 → 千米（100千米超画布）
        blocks = blocks.map { if (it.id == "a") (it as SegmentBlock).copy(unit = "千米") else it }
        val r3 = rescaleSegmentLengths(blocks, k)
        blocks = r3.first; k = r3.second
        // A 单位 → 米（恢复）
        blocks = blocks.map { if (it.id == "a") (it as SegmentBlock).copy(unit = "米") else it }
        val r4 = rescaleSegmentLengths(blocks, k)
        blocks = r4.first
        val a4 = blocks.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b4 = blocks.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a4.w, 0.001f)
        assertEquals(0.45f, b4.w, 0.001f)
    }

    @Test
    fun rescale_deleteKeepsScale() {
        // 删除一根：k 不变，剩余线长度不变（比例保持）
        val blocks = listOf(
            seg2("a", "A", "100", 0.5f),
            seg2("b", "B", "50", 0.5f),
            seg2("c", "C", "25", 0.5f),
        )
        val (out, k) = rescaleSegmentLengths(blocks.filter { it.id != "a" }, kIn = 0.006f)
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        val c = out.filterIsInstance<SegmentBlock>().first { it.id == "c" }
        assertEquals(0.3f, b.w, 0.001f) // 50×0.006
        assertEquals(0.15f, c.w, 0.001f)
        assertEquals(0.006f, k, 0.0001f)
    }

    @Test
    fun rescale_unknownValueUntouched() {
        val blocks = listOf(
            seg2("a", "已知", "100", 0.5f),
            SegmentBlock(id = "u", label = "未知", value = "", w = 0.4f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        val u = out.filterIsInstance<SegmentBlock>().first { it.id == "u" }
        assertEquals(0.4f, u.w, 0.001f) // 未知量不动
    }

    @Test
    fun rescale_noValidSegmentsReturnsUnchanged() {
        val blocks = listOf(
            SegmentBlock(id = "a", label = "甲", value = "", w = 0.4f),
            SegmentBlock(id = "b", label = "乙", value = "", w = 0.5f),
        )
        val (out, k) = rescaleSegmentLengths(blocks)
        assertSame(blocks, out) // 无有效数值线段：原样返回
        assertEquals(-1f, k, 0.0001f)
    }

    @Test
    fun rescale_zeroValuesOnlyIgnored() {
        val blocks = listOf(
            seg2("a", "A", "0", 0.3f),
            seg2("b", "B", "0", 0.6f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        assertSame(blocks, out)
    }

    // ── 单位换算比例 ──

    @Test
    fun rescale_unitConversionLength() {
        // 1米 vs 50厘米 → 归一化 1000:500 → 长度 2:1
        val blocks = listOf(
            SegmentBlock(id = "a", label = "长绳", value = "1", unit = "米", w = 0.6f),
            SegmentBlock(id = "b", label = "短绳", value = "50", unit = "厘米", w = 0.6f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a.w, 0.001f) // 最长(1米=1000) → 0.9
        assertEquals(0.45f, b.w, 0.001f) // 500/1000×0.9
    }

    @Test
    fun rescale_unitConversionTime() {
        // 2时 vs 30分 → 归一化 7200:1800 → 4:1
        val blocks = listOf(
            SegmentBlock(id = "a", label = "上午", value = "2", unit = "时", w = 0.6f),
            SegmentBlock(id = "b", label = "课间", value = "30", unit = "分", w = 0.6f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a.w, 0.001f)
        assertEquals(0.225f, b.w, 0.001f) // 1800/7200×0.9
    }

    @Test
    fun rescale_unitConversionMoney() {
        // 1元 vs 50分 → 100:50 → 2:1（歧义单位"分"按货币表）
        val blocks = listOf(
            SegmentBlock(id = "a", label = "铅笔", value = "1", unit = "元", w = 0.6f),
            SegmentBlock(id = "b", label = "橡皮", value = "50", unit = "分", w = 0.6f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a.w, 0.001f)
        assertEquals(0.45f, b.w, 0.001f)
    }

    @Test
    fun rescale_differentUnitTypesUntouched() {
        // 元 vs 千克：不同类型不比较 → 千克线保持原长（元线是唯一组员 → 缩放）
        val blocks = listOf(
            SegmentBlock(id = "a", label = "苹果", value = "10", unit = "元", w = 0.6f),
            SegmentBlock(id = "b", label = "大米", value = "2", unit = "千克", w = 0.4f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a.w, 0.001f) // 唯一组员 → 最长 0.9
        assertEquals(0.4f, b.w, 0.001f) // 不参与比例
    }

    @Test
    fun rescale_blankUnitTreatedAsSame() {
        // 4米 + 3（单位未填）→ 视为同单位，按 4:3
        val blocks = listOf(
            SegmentBlock(id = "a", label = "A", value = "4", unit = "米", w = 0.6f),
            SegmentBlock(id = "b", label = "B", value = "3", unit = "", w = 0.6f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a.w, 0.001f)
        assertEquals(0.675f, b.w, 0.001f) // 3/4×0.9
    }

    @Test
    fun rescale_largeRatioGivesProportionalButVisible() {
        // 100米 vs 1米：长度 100:1，但 1 米线至少可见（最小可见长度 0.04）
        val blocks = listOf(
            SegmentBlock(id = "a", label = "A", value = "100", unit = "米", w = 0.55f),
            SegmentBlock(id = "b", label = "B", value = "1", unit = "米", w = 0.55f),
        )
        val (out, _) = rescaleSegmentLengths(blocks)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.9f, a.w, 0.001f) // 最长(100米) → 0.9
        assertEquals(0.04f, b.w, 0.001f) // 最小可见
    }

    // ── 输入校验 ──

    @Test
    fun isValidNumber_acceptsNumbers() {
        assertTrue(isValidNumber(""))
        assertTrue(isValidNumber("12"))
        assertTrue(isValidNumber("3.5"))
        assertTrue(isValidNumber("0"))
        assertTrue(isValidNumber("-8"))
        assertTrue(isValidNumber(" 100 "))
    }

    @Test
    fun isValidNumber_rejectsGarbage() {
        assertFalse(isValidNumber("abc"))
        assertFalse(isValidNumber("12米"))
        assertFalse(isValidNumber("1.2.3"))
        assertFalse(isValidNumber("3."))
        assertFalse(isValidNumber("--5"))
        assertFalse(isValidNumber("十二"))
    }

    @Test
    fun isValidUnit_acceptsChineseAndEnglish() {
        assertTrue(isValidUnit(""))
        assertTrue(isValidUnit("米"))
        assertTrue(isValidUnit("厘米"))
        assertTrue(isValidUnit("kg"))
        assertTrue(isValidUnit("个"))
        assertTrue(isValidUnit(" 元 "))
    }

    @Test
    fun isValidUnit_rejectsGarbage() {
        assertFalse(isValidUnit("1米"))
        assertFalse(isValidUnit("米!"))
        assertFalse(isValidUnit("m 2"))
        assertFalse(isValidUnit("元/个"))
        assertFalse(isValidUnit("米-"))
    }

    // ── 左/右对齐（以最上面线段为边界） ──

    @Test
    fun alignLeft_snapsAllLeftEndsToTopmost() {
        // 最上面线段：A（y=0.2, x=0.5, w=0.4 → 左端 0.3）；B（y=0.5, x=0.7, w=0.2 → 左端 0.6）
        val blocks = listOf(
            SegmentBlock(id = "a", label = "A", value = "100", w = 0.4f, x = 0.5f, y = 0.2f),
            SegmentBlock(id = "b", label = "B", value = "50", w = 0.2f, x = 0.7f, y = 0.5f),
        )
        val out = alignSegmentsLeft(blocks)
        val a = out.filterIsInstance<SegmentBlock>().first { it.id == "a" }
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.5f, a.x, 0.001f) // 边界线不动
        assertEquals(0.4f, b.x, 0.001f) // B 左端 0.3 → x = 0.3 + 0.1 = 0.4
    }

    @Test
    fun alignRight_snapsAllRightEndsToTopmost() {
        // 最上面线段：A（x=0.5, w=0.4 → 右端 0.7）；B（x=0.7, w=0.2 → 右端 0.8）
        val blocks = listOf(
            SegmentBlock(id = "a", label = "A", value = "100", w = 0.4f, x = 0.5f, y = 0.2f),
            SegmentBlock(id = "b", label = "B", value = "50", w = 0.2f, x = 0.7f, y = 0.5f),
        )
        val out = alignSegmentsRight(blocks)
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.6f, b.x, 0.001f) // B 右端 0.7 → x = 0.7 - 0.1 = 0.6
    }

    @Test
    fun align_usesVisualWidthWithTimesAndExtra() {
        // A：times=2, w=0.2 → 视觉总宽 0.4，左端 = 0.5-0.2 = 0.3；B 普通 w=0.2
        val blocks = listOf(
            SegmentBlock(id = "a", label = "A", value = "10", w = 0.2f, x = 0.5f, y = 0.2f, times = 2),
            SegmentBlock(id = "b", label = "B", value = "50", w = 0.2f, x = 0.7f, y = 0.5f),
        )
        assertEquals(0.4f, segmentVisualWidth(blocks[0] as SegmentBlock), 0.001f)
        val out = alignSegmentsLeft(blocks)
        val b = out.filterIsInstance<SegmentBlock>().first { it.id == "b" }
        assertEquals(0.4f, b.x, 0.001f) // B 左端对齐 A 左端 0.3 → x = 0.3 + 0.1
    }

    @Test
    fun align_singleSegmentUnchanged() {
        val blocks = listOf(SegmentBlock(id = "a", label = "A", value = "10", w = 0.3f, x = 0.5f, y = 0.3f))
        assertEquals(blocks, alignSegmentsLeft(blocks))
        assertEquals(blocks, alignSegmentsRight(blocks))
    }

    @Test
    fun snapBlock_personSnapsToSegmentEndpoints() {
        // 小人靠近线段右端（x=0.6）→ 吸附到端点
        val seg = SegmentBlock(id = "s", label = "小明", value = "10", w = 0.2f, x = 0.5f, y = 0.5f)
        val person = PersonBlock(id = "p", name = "小明", x = 0.605f, y = 0.5f)
        val snapped = snapBlock(person, listOf(seg), 1000f, 280f, 20f)
        assertEquals(0.6f, snapped.x, 0.001f) // 右端
        assertEquals(0.5f, snapped.y)
    }

    @Test
    fun snapBlock_personSnapsToLeftEndpoint() {
        val seg = SegmentBlock(id = "s", label = "小红", value = "10", w = 0.2f, x = 0.5f, y = 0.5f)
        val person = PersonBlock(id = "p", name = "小红", x = 0.395f, y = 0.5f) // 左端 0.4 附近
        val snapped = snapBlock(person, listOf(seg), 1000f, 280f, 20f)
        assertEquals(0.4f, snapped.x, 0.001f) // 左端
    }

    @Test
    fun snapBlock_personFarNoSnap() {
        val seg = SegmentBlock(id = "s", label = "小明", value = "10", w = 0.2f, x = 0.5f, y = 0.5f)
        val person = PersonBlock(id = "p", name = "小明", x = 0.8f, y = 0.2f)
        val snapped = snapBlock(person, listOf(seg), 1000f, 280f, 20f)
        assertEquals(0.8f, snapped.x)
        assertEquals(0.2f, snapped.y)
    }

    @Test
    fun toBuildItems_personNote() {
        val p = PersonBlock(id = "p", name = "小明")
        val item = toBuildItems(listOf(p)).single()
        assertEquals("person", item.kind)
        assertEquals("小明", item.label)
        assertTrue(item.note.contains("小人「小明」"))
    }

    @Test
    fun midPointFromDraft_fromLeft() {
        // 线段 x=0.5 w=0.4（mainW=0.4，左端 0.3 右端 0.7），value=60
        val s = SegmentBlock(id = "a", label = "路程", value = "60", unit = "米", w = 0.4f, x = 0.5f)
        // 拖到 0.5（中间）→ 距左端 = 60 × 0.5/0.4 ... relX = (0.5-0.3)/0.4 = 0.5 → pos 30
        val mp = midPointFromDraft(s, 0.5f, fromRight = false, mainWidth = 0.4f)
        assertNotNull(mp)
        assertEquals("30", mp!!.pos)
        assertEquals("30米", mp.label)
    }

    @Test
    fun midPointFromDraft_fromRight() {
        val s = SegmentBlock(id = "a", label = "路程", value = "60", unit = "米", w = 0.4f, x = 0.5f)
        // 从右拖到 0.5 → relX = 0.5 → pos = 60 × 0.5 = 30
        val mp = midPointFromDraft(s, 0.5f, fromRight = true, mainWidth = 0.4f)
        assertNotNull(mp)
        assertEquals("30", mp!!.pos)
    }

    @Test
    fun midPointFromDraft_clampsAndNull() {
        val s = SegmentBlock(id = "a", label = "路程", value = "60", unit = "米", w = 0.4f, x = 0.5f)
        // 超出左端 → clamp 0 → pos 0 → null
        assertNull(midPointFromDraft(s, 0.1f, fromRight = false, mainWidth = 0.4f))
        // 无数值 → null
        val empty = SegmentBlock(id = "b", label = "未知", value = "", w = 0.4f, x = 0.5f)
        assertNull(midPointFromDraft(empty, 0.5f, fromRight = false, mainWidth = 0.4f))
    }

    // ── 大模型自动搭建 ──

    @Test
    fun autoBlocksFrom_segmentsProportionalLeftAligned() {
        val r = AutoBuildResult(
            segments = listOf(
                AutoSegment(label = "前年产量", value = 9f, unit = "千克"),
                AutoSegment(label = "去年产量", value = 36f, unit = "千克"),
                AutoSegment(label = "今年产量", value = null, unit = "千克", isUnknown = true),
            ),
            relation = "times",
            times = AutoTimes(a = "去年产量", b = "前年产量"),
        )
        val blocks = autoBlocksFrom(r)
        val segs = blocks.filterIsInstance<SegmentBlock>()
        assertEquals(3, segs.size)
        val qian = segs.first { it.label == "前年产量" }
        val qu = segs.first { it.label == "去年产量" }
        val jin = segs.first { it.label == "今年产量" }
        assertEquals(0.6f, qu.w, 0.001f) // 最大 36 → 0.6
        assertEquals(0.15f, qian.w, 0.001f) // 9/36×0.6 = 0.15
        assertEquals(4, qu.times) // 36 是 9 的 4 倍 → 分段
        assertEquals("", jin.value) // 未知量空
        assertEquals(0.45f, jin.w, 0.001f)
        // 左端对齐
        assertEquals(0.15f + qian.w / 2f, qian.x, 0.001f)
        assertEquals(0.15f + qu.w / 2f, qu.x, 0.001f)
    }

    @Test
    fun autoBlocksFrom_diffAddsDashedSegment() {
        val r = AutoBuildResult(
            segments = listOf(
                AutoSegment(label = "小明", value = 20f, unit = "个"),
                AutoSegment(label = "小红", value = 30f, unit = "个"),
            ),
            relation = "diff",
            diff = AutoDiff(a = "小红", b = "小明", text = "多10个", value = 10f),
        )
        val blocks = autoBlocksFrom(r)
        val dashed = blocks.filterIsInstance<SegmentBlock>().first { it.dashed }
        assertEquals("多10个", dashed.label)
        assertEquals("10", dashed.value)
    }

    @Test
    fun autoBlocksFrom_braceAddsBrace() {
        val r = AutoBuildResult(
            segments = listOf(
                AutoSegment(label = "小明", value = 20f, unit = "个"),
                AutoSegment(label = "小红", value = 30f, unit = "个"),
            ),
            relation = "total",
            brace = AutoBrace(label = "一共？个", parts = listOf("小明", "小红")),
        )
        val blocks = autoBlocksFrom(r)
        val braces = blocks.filterIsInstance<BraceBlock>()
        assertEquals(1, braces.size)
        assertEquals("一共？个", braces[0].label)
        assertEquals("down", braces[0].direction)
    }

    @Test
    fun autoBlocksFrom_empty() {
        assertTrue(autoBlocksFrom(AutoBuildResult()).isEmpty())
    }

    @Test
    fun snapBlock_overlappingDoesNotSnapBack() {
        // 回归：两条完全重叠的线段（端点重合 dx=0）→ 不磁吸，可自由拖开
        val a = seg("a", x = 0.5f, y = 0.5f, w = 0.2f)
        val b = seg("b", x = 0.5f, y = 0.5f, w = 0.2f)
        val snapped = snapBlock(b, listOf(a), 1000f, 280f, 20f)
        assertEquals(0.5f, snapped.x) // 不被吸住
        assertEquals(0.5f, snapped.y)
    }

    @Test
    fun snapBlock_circleOverlappingDoesNotSnapBack() {
        val a = NodeCircleBlock(id = "a", x = 0.5f, y = 0.5f)
        val b = NodeCircleBlock(id = "b", x = 0.5f, y = 0.5f)
        val snapped = snapBlock(b, listOf(a), 1000f, 280f, 20f)
        assertEquals(0.5f, snapped.x)
        assertEquals(0.5f, snapped.y)
    }

    @Test
    fun snapBlock_personOnEndpointCanBeDraggedAway() {
        // 小人已吸附在端点（dx=0）→ 不磁吸，可拖走
        val seg = SegmentBlock(id = "s", label = "小明", value = "10", w = 0.2f, x = 0.5f, y = 0.5f)
        val person = PersonBlock(id = "p", name = "小明", x = 0.6f, y = 0.5f) // 恰在右端
        val snapped = snapBlock(person, listOf(seg), 1000f, 280f, 20f)
        assertEquals(0.6f, snapped.x) // 不被吸住（可拖开）
    }

    // ── 撤销栈 ──

    @Test
    fun undoStack_pushAndUndo() {
        val a = listOf(newSegmentBlock())
        val b = listOf(newSegmentBlock(), newSegmentBlock())
        var stack = UndoStack()
        stack = stack.push(a) // 操作前快照 a（随后发生了变更）
        stack = stack.push(b) // 操作前快照 b
        val c = listOf(newSegmentBlock()) // 第三次变更后的状态
        val (restored, s2) = stack.undo(c) // 撤销：回到 b
        assertEquals(b, restored)
        val (restored2, _) = s2.undo(b) // 再撤销：回到 a
        assertEquals(a, restored2)
    }

    @Test
    fun undoStack_emptyHistoryReturnsCurrent() {
        val cur = listOf(newSegmentBlock())
        val (restored, stack) = UndoStack().undo(cur)
        assertEquals(cur, restored)
        assertTrue(stack.history.isEmpty())
    }

    @Test
    fun undoStack_cappedAt30() {
        var stack = UndoStack()
        var cur: List<SegmentBlock> = emptyList()
        repeat(40) {
            stack = stack.push(cur)
            cur = listOf(newSegmentBlock())
        }
        assertEquals(30, stack.history.size)
    }
}
