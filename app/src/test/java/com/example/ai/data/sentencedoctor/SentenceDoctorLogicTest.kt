package com.example.ai.data.sentencedoctor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 句子小医生 · 内容与引擎自检
 *
 * 移植自 web 的 `modules/sentence_doctor/marks.test.ts` + `data.test.ts`，逐条对齐。
 * 最狠的是**重建**那条：把每处 mark 依次作用到原句上，必须**逐字等于**订正句。
 * 它一次挡住三类错 —— cut 抄错一个字（定位不到→抛错）、插补位置选错（重建出另一句）、
 * 顺序错位（病灶与答案对不上）。修改符号要**画在原句上**，位置错了比不画更坏：
 * 孩子会照着错的框去改。
 *
 * 另一半是结构自检：数量对不上、前后引号写反、五个符号里有死按钮 —— 这些在页面上
 * 都不报错，只是悄悄教错。
 */
class SentenceDoctorLogicTest {

    private fun allSpotRefs(): List<Triple<String, SdFixCase, SdFixSpot>> {
        val out = ArrayList<Triple<String, SdFixCase, SdFixSpot>>()
        for (lv in SD_FIX_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                item.spots.forEachIndexed { si, spot ->
                    out.add(Triple("${lv.key} 第 ${i + 1} 句第 ${si + 1} 处", item, spot))
                }
            }
        }
        return out
    }

    // ══════════════════════════════════════════════════════════
    //  病灶坐标 · 字段与工具一致
    // ══════════════════════════════════════════════════════════

    /** cut / with / at 在原句里都只出现一次（重复就画不准） */
    @Test
    fun `cut with at 在原句里都唯一`() {
        for ((where, item, spot) in allSpotRefs()) {
            val m = spot.mark
            for ((key, v) in listOf("cut" to m.cut, "with" to m.with, "at" to m.at)) {
                if (v == null) continue
                assertTrue("$where 的 $key 是空串", v.isNotEmpty())
                assertTrue(
                    "$where 的 $key「$v」在原句里找不到或出现多次（原句：${item.text}）",
                    sdFindOnce(item.text, v) >= 0,
                )
            }
        }
    }

    /** 四种工具各自该有的字段都在 */
    @Test
    fun `五种手术刀的字段组合正确`() {
        for ((where, _, spot) in allSpotRefs()) {
            val m = spot.mark
            when (spot.tool) {
                SdTool.CORRECT -> {
                    assertTrue("$where 改正刀要 cut + put", !m.cut.isNullOrEmpty() && !m.put.isNullOrEmpty())
                    assertTrue("$where 改正刀不该有 with", m.with == null)
                }
                SdTool.DELETE -> {
                    assertTrue("$where 删除刀要 cut", !m.cut.isNullOrEmpty())
                    assertTrue("$where 删除刀只能有 cut", m.put == null && m.with == null)
                }
                SdTool.ADD -> {
                    assertTrue("$where 增补刀要 put", !m.put.isNullOrEmpty())
                    assertTrue("$where 增补刀要 at 或 cut 指明补在哪儿", !m.at.isNullOrEmpty() || !m.cut.isNullOrEmpty())
                    assertTrue("$where 增补刀不该有 with", m.with == null)
                }
                SdTool.SWAP -> {
                    assertTrue("$where 对调刀要 cut + with", !m.cut.isNullOrEmpty() && !m.with.isNullOrEmpty())
                    assertTrue("$where 对调刀不该有 put/at", m.put == null && m.at == null)
                }
                SdTool.MOVE -> {
                    assertTrue("$where 移动刀要 cut + with", !m.cut.isNullOrEmpty() && !m.with.isNullOrEmpty())
                    assertTrue("$where 移动刀不该有 put/at", m.put == null && m.at == null)
                    assertNotEquals("$where 移动刀的两处不能是同一段", m.cut, m.with)
                }
            }
        }
    }

    /** 对调刀的两处必须紧挨着（隔开一段就该用移动刀了） */
    @Test
    fun `对调刀的两处紧挨着`() {
        for ((where, item, spot) in allSpotRefs()) {
            if (spot.tool != SdTool.SWAP) continue
            val g = sdLocateMark(item.text, spot.mark)
            val cut = g.cut
            val with = g.with
            assertNotNull("$where 对调刀的坐标没算出来", cut)
            assertNotNull("$where 对调刀的坐标没算出来", with)
            val cs = cut!!.first
            val ce = cut.second
            val ws = with!!.first
            val we = ws + spot.mark.with!!.length
            assertEquals(
                "$where 对调刀的两处「${spot.mark.cut}」「${spot.mark.with}」不紧挨 —— 中间隔着别的字，只能用移动刀",
                0,
                maxOf(cs, ws) - minOf(ce, we),
            )
        }
    }

    /** 同一句里两处病灶的框不能重叠（画上去会叠成一团） */
    @Test
    fun `同一句两处病灶的框不重叠`() {
        for (lv in SD_FIX_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                val ranges = sdOccupiedRanges(item.text, item.spots)
                for (a in ranges.indices) {
                    for (b in a + 1 until ranges.size) {
                        for ((x0, x1) in ranges[a]) {
                            for ((y0, y1) in ranges[b]) {
                                assertTrue(
                                    "${lv.key} 第 ${i + 1} 句：第 ${a + 1} 处与第 ${b + 1} 处的框重叠了",
                                    x1 <= y0 || y1 <= x0,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  病灶坐标 · 重建（最重要的一条）
    // ══════════════════════════════════════════════════════════

    @Test
    fun `把每一处 mark 依次治好 必须逐字等于 fixed`() {
        var n = 0
        for (lv in SD_FIX_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                val got = runCatching { sdApplyMarks(item) }.getOrElse { e -> "⚠️${e.message}" }
                assertEquals("${lv.key} 第 ${i + 1} 句重建结果对不上：\n  得到：$got\n  期望：${item.fixed}", item.fixed, got)
                n++
            }
        }
        assertEquals(30, n)
    }

    /** 切分出来的片段必须能逐字拼回原句，否则页面上画的框会错位 */
    @Test
    fun `标记切分能还原原句`() {
        for (lv in SD_FIX_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                val marks = item.spots.map { it.tool to it.mark }
                val pieces = sdSentencePieces(item.text, marks)
                assertEquals(
                    "${lv.key} 第 ${i + 1} 句：切分后拼不回原句",
                    item.text,
                    pieces.joinToString("") { it.text },
                )
                // 带框的片段必须在原句里出现在它声称的位置
                for (p in pieces) {
                    val b = p.box ?: continue
                    if (b.start < b.end) {
                        assertEquals("框内文字与原句不一致", item.text.substring(b.start, b.end), p.text)
                    } else {
                        assertEquals("零宽插入点不该有文字", "", p.text)
                    }
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  提示语位置 · 反推
    // ══════════════════════════════════════════════════════════

    /** 19 句的提示语原文与位置 —— 顺序 = SD_PUNCT_LEVELS 的句序 */
    private val expectedTags: List<Pair<String, SdTagPos>> = listOf(
        "老屋说" to SdTagPos.FRONT,
        "蜗牛难过地告诉陶陶" to SdTagPos.FRONT,
        "我问老板" to SdTagPos.FRONT,
        "老师问" to SdTagPos.FRONT,
        "同学们激动地欢呼" to SdTagPos.FRONT,
        "说完" to SdTagPos.BACK,
        "蜗牛几乎带着哭腔说" to SdTagPos.BACK,
        "陶陶说" to SdTagPos.BACK,
        "小狗对小公鸡说道" to SdTagPos.BACK,
        "老师站在讲台上说" to SdTagPos.BACK,
        "老师说" to SdTagPos.MID,
        "他说" to SdTagPos.MID,
        "爸爸大喊" to SdTagPos.MID,
        "狐狸说道" to SdTagPos.MID,
        "妈妈问" to SdTagPos.MID,
        "小公鸡说" to SdTagPos.FRONT,
        "小公鸡说" to SdTagPos.BACK,
        "小公鸡说" to SdTagPos.MID,
        "老师问" to SdTagPos.BACK,
    )

    @Test
    fun `19 句的提示语逐句对得上 位置也对`() {
        var n = 0
        for (lv in SD_PUNCT_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                val (want, wantPos) = expectedTags[n++]
                val ti = sdTagPartIndexOf(item)
                val where = "${lv.key} 第 ${i + 1} 句"
                assertTrue("$where 推不出提示语所在段（ti=$ti）", ti in item.parts.indices)
                assertEquals("$where 提示语推成了「${item.parts[ti]}」，应为「$want」", want, item.parts[ti])
                assertEquals("$where 位置推错了", wantPos, sdTagPositionOf(item))
            }
        }
        assertEquals("标点册的句数变了（$n 句）", expectedTags.size, n)
    }

    @Test
    fun `四关的提示语位置覆盖前中后三种`() {
        val got = HashSet<SdTagPos>()
        for (lv in SD_PUNCT_LEVELS) for (it in lv.items) sdTagPositionOf(it)?.let { got.add(it) }
        for (p in SdTagPos.entries) assertTrue("没有一句「${p.label}」的题", got.contains(p))
    }

    // ══════════════════════════════════════════════════════════
    //  内容结构自检
    // ══════════════════════════════════════════════════════════

    @Test
    fun `每一句的 slots 数量 = parts 数量 + 1`() {
        for (lv in SD_PUNCT_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                assertEquals(
                    "${lv.key} 第 ${i + 1} 句：slots=${item.slots.size} 但 parts=${item.parts.size}（应为 parts+1）",
                    item.parts.size + 1,
                    item.slots.size,
                )
            }
        }
    }

    @Test
    fun `每句至少两个练习空位 且 tip 不为空`() {
        for (lv in SD_PUNCT_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                val real = item.slots.count { it != null }
                assertTrue("${lv.key} 第 ${i + 1} 句只有 $real 个空位", real >= 2)
                assertTrue("${lv.key} 第 ${i + 1} 句的 tip 太短", item.tip.trim().length > 6)
            }
        }
    }

    @Test
    fun `每个空位的 kind 都有对应提示语 且理由够长`() {
        for (lv in SD_PUNCT_LEVELS) {
            for (item in lv.items) {
                for (s in item.slots) {
                    if (s == null) continue
                    assertTrue("未定义的 kind：${s.kind}", SD_SLOT_HINT.containsKey(s.kind))
                    assertTrue("空位「${s.a}」的理由太短", s.why.trim().length > 8)
                }
            }
        }
    }

    /** 引号方向：前引号只出现在开头/中段，后引号只出现在收尾（写反了孩子怎么填都被判对） */
    @Test
    fun `引号方向正确`() {
        for (lv in SD_PUNCT_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                item.slots.forEachIndexed { si, s ->
                    if (s == null) return@forEachIndexed
                    val where = "${lv.key} 第 ${i + 1} 句第 ${si + 1} 空（${s.kind}，「${s.a}」）"
                    for (alt in listOf(s.a) + s.ok) {
                        when (s.kind) {
                            SdSlotKind.TAG, SdSlotKind.MID -> {
                                assertTrue("$where 提示语后面应从冒号或逗号起头", alt.startsWith("：") || alt.startsWith("，"))
                                if (alt.contains(SD_OQ)) assertTrue("$where 前引号应在末尾", alt.endsWith(SD_OQ))
                                assertFalse("$where 提示语后面不该出现后引号", alt.contains(SD_CQ))
                            }
                            SdSlotKind.OPEN -> {
                                assertTrue("$where 话的开头应是前引号", alt.startsWith(SD_OQ))
                                assertFalse("$where 不该出现后引号", alt.contains(SD_CQ))
                            }
                            SdSlotKind.CLOSE -> {
                                assertTrue("$where 收尾必须以后引号结束", alt.endsWith(SD_CQ))
                                assertFalse("$where 不该出现前引号", alt.contains(SD_OQ))
                            }
                            SdSlotKind.IN -> assertEquals("$where 话中间只能用逗号", "，", alt)
                            SdSlotKind.END, SdSlotKind.NARR -> {
                                assertFalse("$where 引号外不该有引号", alt.contains("\"") || alt.contains(SD_OQ) || alt.contains(SD_CQ))
                            }
                        }
                    }
                }
            }
        }
    }

    @Test
    fun `答案下标在选项范围内 且选项不重复`() {
        for (lv in SD_FIX_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                item.spots.forEachIndexed { si, s ->
                    val where = "${lv.key} 第 ${i + 1} 句第 ${si + 1} 处"
                    assertTrue("$where 的 answer 越界", s.answer in s.options.indices)
                    assertEquals("$where 有重复选项", s.options.size, s.options.toSet().size)
                    assertTrue("$where 选项太少（${s.options.size}）", s.options.size >= 3)
                    assertTrue("$where 的理由太短", s.why.trim().length > 15)
                }
            }
        }
    }

    /** 五把刀都在题目里出现过（工具栏不留死按钮 —— 孩子点了没反应会以为是坏了） */
    @Test
    fun `五种手术刀都用到 且不重复`() {
        val used = HashSet<SdTool>()
        for (lv in SD_FIX_LEVELS) for (it in lv.items) for (s in it.spots) used.add(s.tool)
        for (t in SdTool.entries) assertTrue("「${t.label}刀」摆在工具栏上，但没有任何一道题用到它", used.contains(t))
        assertEquals("SdTool 里有重复的符号", SdTool.entries.size, SdTool.entries.map { it.label }.toSet().size)
    }

    @Test
    fun `每句都有订正句 且与原句不同`() {
        for (lv in SD_FIX_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                assertTrue("${lv.key} 第 ${i + 1} 句缺订正句", item.fixed.trim().isNotEmpty())
                assertNotEquals("${lv.key} 第 ${i + 1} 句的订正句和原句一样，等于没治病", item.text, item.fixed)
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  四态判定 / 拼句 / 描述
    // ══════════════════════════════════════════════════════════

    /** ★ 「待续」这一态是本模块判对的关键：点第一下不能报红 */
    @Test
    fun `判对四态 前缀算待续不算错`() {
        val tag = SdPunctSlot(a = "：$SD_OQ", ok = emptyList(), kind = SdSlotKind.TAG, why = "x")
        assertEquals(SdSlotState.EMPTY, sdSlotStateOf("", tag))
        assertEquals(SdSlotState.TYPING, sdSlotStateOf("：", tag))
        assertEquals(SdSlotState.OK, sdSlotStateOf("：$SD_OQ", tag))
        assertEquals(SdSlotState.WRONG, sdSlotStateOf("。", tag))
        assertEquals(SdSlotState.WRONG, sdSlotStateOf("：$SD_OQ。", tag))

        val close = SdPunctSlot(a = "？$SD_CQ", ok = listOf("。$SD_CQ"), kind = SdSlotKind.CLOSE, why = "x")
        assertEquals(SdSlotState.OK, sdSlotStateOf("？$SD_CQ", close))
        assertEquals("备选写法也要算对", SdSlotState.OK, sdSlotStateOf("。$SD_CQ", close))
        assertEquals(SdSlotState.TYPING, sdSlotStateOf("？", close))
    }

    @Test
    fun `按标准答案拼句 与 按填写拼句 同口径`() {
        val item = SD_PUNCT_LEVELS[0].items[0]
        val model = sdModelSentence(item)
        assertEquals(model, sdComposeSentence(item, item.slots.map { it?.a ?: "" }))
        assertTrue("标准句应含前引号", model.contains(SD_OQ))
        assertTrue("标准句应含后引号", model.contains(SD_CQ))
        // 一个标点都没填时，拼出来就是 parts 直接相连
        assertEquals(item.parts.joinToString(""), sdComposeSentence(item, emptyList()))
    }

    @Test
    fun `主关卡的整句判定 与 单处判定一致`() {
        val item = SD_FIX_LEVELS[0].items[0]
        val tools = item.spots.map { it.tool }
        val picks = item.spots.map { it.answer }
        assertTrue(sdFixCaseSolved(item, tools, picks))
        assertFalse(sdFixCaseSolved(item, tools, picks.map { (it + 1) % item.spots[0].options.size }))
        assertFalse(sdFixCaseSolved(item, tools, emptyList()))
    }

    @Test
    fun `去掉 markdown 粗体标记`() {
        assertFalse(sdStripBold(SD_FIX_LEVELS[0].intro).contains("**"))
        assertTrue(sdStripBold("**改正手术刀**") == "改正手术刀")
    }

    /** 描述文字要与工具对得上（「看答案」里那行 ✍️ 操作说明） */
    @Test
    fun `描述文字覆盖五种工具且不为空`() {
        val seen = HashSet<SdTool>()
        for ((_, _, spot) in allSpotRefs()) {
            val d = sdDescribeMark(spot)
            assertTrue("${spot.tool} 的描述是空的", d.isNotBlank())
            seen.add(spot.tool)
        }
        assertEquals(SdTool.entries.toSet(), seen)
    }
}
