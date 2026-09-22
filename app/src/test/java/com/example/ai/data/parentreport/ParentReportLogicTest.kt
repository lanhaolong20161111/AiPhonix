package com.example.ai.data.parentreport

import com.example.ai.data.soerecord.SoeRecord
import com.example.ai.util.jsNumber
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/**
 * 家长周报纯函数引擎的单测。
 *
 * ★ 所有期望值都来自把 web `ParentReportPage.tsx` 的 `days` / `weekCount` / `weekAvg` /
 * `weakWords` **原样复制到 node** 跑出的探针（`web/_parentreport_probe.mjs`，
 * `TZ=Asia/Shanghai`），**不是**按语义推导 —— 否则等于「自己实现自己验」。
 * 探针同时也跑了一个空集场景。
 */
class ParentReportLogicTest {

    /** 2026-09-22T10:00:00+08:00 */
    private val now = Instant.parse("2026-09-22T02:00:00Z").toEpochMilli()
    private val shanghai = ZoneId.of("Asia/Shanghai")

    private fun rec(ref: String, score: Float, at: String? = null) =
        SoeRecord(refText = ref, suggestedScore = score, createdAt = at ?: "")

    /** 与探针里那份记录集逐条一致 */
    private val records = listOf(
        rec("苹果", 90.5f, "2026-09-22T01:50:00Z"),        // 本地 22 日 09:50
        rec("苹果", 70f, "2026-09-21T16:10:00Z"),          // ★ 本地 22 日 00:10 ⇒ 前 10 位是 21 日
        rec("香蕉", 0f, "2026-09-20T12:00:00Z"),           // 0 分：计入次数、不计入均分
        rec("苹 果", 55.4f, "2026-09-19T12:00:00Z"),       // 去空白后与「苹果」同组
        rec("葡萄", 40f, "2026-08-23T00:00:00Z"),          // 恰好等于 cutoff
        rec("西瓜", 30f, "2026-08-22T23:59:00Z"),          // 早于 cutoff ⇒ 出局
        rec("芒果", 85f, "2026-09-18T05:00:00Z"),          // ≥80 ⇒ 不进「需多练」
        rec("\u3000柠\u00A0檬\uFEFF", 12.5f, "2026-09-17T05:00:00Z"),
        rec("龙眼", 10f, null),                            // 无时间戳 ⇒ 不进任何一天
        rec("梨", 100f, "2026-09-16T00:00:00Z"),
        rec("桃", 20f, "2026-09-15T00:00:00Z"),            // 7 天窗外、30 天窗内
        rec("杏", 12.5f, "2026-09-17T05:00:00Z"),          // 与「柠檬」同分 ⇒ 验稳定性
        rec("枇杷", 78f, "2026-09-17T05:00:00Z"),
        rec("杨梅", 77f, "2026-09-17T05:00:00Z"),
        rec("火龙果", 76f, "2026-09-17T05:00:00Z"),
        rec("哈密瓜", 79f, "2026-09-17T05:00:00Z"),
        rec("一二三四五六七八九十", 5f, "2026-09-17T05:00:00Z"),    // 截前 8 字
        rec("一二三四五六七八AB", 60f, "2026-09-17T05:00:00Z"),   // 同组 ⇒ 取最低分 5
    )

    // ── days ──────────────────────────────────────────────────────────────

    @Test
    fun `近7天日期key与web一致且今天在最右`() {
        val days = ParentReportLogic.days7(records, now, shanghai)
        assertEquals(
            listOf(
                "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19",
                "2026-09-20", "2026-09-21", "2026-09-22",
            ),
            days.map { it.date },
        )
    }

    @Test
    fun `逐日计数与平均分与web一致`() {
        val days = ParentReportLogic.days7(records, now, shanghai)
        assertEquals(listOf(1, 8, 1, 1, 1, 1, 1), days.map { it.count })
        assertEquals(listOf(100, 50, 85, 55, null, 70, 91), days.map { it.avgScore })
    }

    @Test
    fun `本地凌晨的记录会归到前一天这是web的时区口径`() {
        // 记录 created_at = 2026-09-21T16:10Z，本地其实是 22 日 00:10，
        // 但 web 拿 createdAt 的前 10 位（UTC 日期）去比本地 key ⇒ 落在 09-21 那一列。
        val days = ParentReportLogic.days7(
            listOf(rec("苹果", 70f, "2026-09-21T16:10:00Z")),
            now,
            shanghai,
        )
        val d21 = days.first { it.date == "2026-09-21" }
        val d22 = days.first { it.date == "2026-09-22" }
        assertEquals(1, d21.count)
        assertEquals(70, d21.avgScore)
        assertEquals(0, d22.count)
        assertNull(d22.avgScore)
    }

    @Test
    fun `零分记录计入次数但不计入均分`() {
        val days = ParentReportLogic.days7(records, now, shanghai)
        val d20 = days.first { it.date == "2026-09-20" }   // 只有一条 0 分
        assertEquals(1, d20.count)
        assertNull(d20.avgScore)
    }

    @Test
    fun `7天窗口边界最早那天算在内再早一天不算`() {
        val days = ParentReportLogic.days7(records, now, shanghai)
        // 梨（09-16，100 分）在窗内；桃（09-15，20 分）在窗外
        assertEquals(1, days.first { it.date == "2026-09-16" }.count)
        assertEquals(20, records.first { it.refText == "桃" }.suggestedScore.toInt())
        assertEquals(14, ParentReportLogic.weekCount(days))
    }

    @Test
    fun `无时间戳的记录不进任何一天`() {
        val days = ParentReportLogic.days7(listOf(rec("龙眼", 10f, null)), now, shanghai)
        assertEquals(0, ParentReportLogic.weekCount(days))
        assertEquals(List(7) { null }, days.map { it.avgScore })
    }

    // ── weekAvg ───────────────────────────────────────────────────────────

    @Test
    fun `本周次数与平均分与web一致`() {
        val days = ParentReportLogic.days7(records, now, shanghai)
        assertEquals(14, ParentReportLogic.weekCount(days))
        assertEquals(62, ParentReportLogic.weekAvg(records, days))
    }

    @Test
    fun `本周均分排除7天窗外的记录`() {
        val days = ParentReportLogic.days7(records, now, shanghai)
        assertNull(ParentReportLogic.weekAvg(listOf(rec("桃", 20f, "2026-09-15T00:00:00Z")), days))
    }

    @Test
    fun `本周均分排除无时间戳的记录`() {
        val days = ParentReportLogic.days7(records, now, shanghai)
        // 空串与 "2026-09-16" 比字符串是 false ⇒ 出局
        assertNull(ParentReportLogic.weekAvg(listOf(rec("龙眼", 10f, null)), days))
    }

    @Test
    fun `本周均分排除零分记录且无合格记录时返回null`() {
        val days = ParentReportLogic.days7(records, now, shanghai)
        assertNull(ParentReportLogic.weekAvg(listOf(rec("香蕉", 0f, "2026-09-20T12:00:00Z")), days))
    }

    // ── weakWords ─────────────────────────────────────────────────────────

    @Test
    fun `需多练的词与web一致`() {
        val weak = ParentReportLogic.weakWords(records, now)
        assertEquals(
            listOf("一二三四五六七八", "柠檬", "杏", "桃", "葡萄", "苹果", "火龙果", "杨梅"),
            weak.map { it.key },
        )
        assertEquals(
            listOf(5f, 12.5f, 12.5f, 20f, 40f, 55.4f, 76f, 77f),
            weak.map { it.score },
        )
    }

    @Test
    fun `需多练超过8条时按分数升序截断丢掉最高分的几条`() {
        // 候选中 78 / 79 分两条因已满 8 条而出局
        val keys = ParentReportLogic.weakWords(records, now).map { it.key }
        assertEquals(8, keys.size)
        assertEquals(false, keys.contains("枇杷"))
        assertEquals(false, keys.contains("哈密瓜"))
    }

    @Test
    fun `需多练的30天cutoff用的是UTC日期`() {
        val keys = ParentReportLogic.weakWords(records, now).map { it.key }
        // 葡萄 08-23T00:00Z 恰好等于 cutoff（UTC 2026-08-23）⇒ 入选
        assertEquals(true, keys.contains("葡萄"))
        // 西瓜 08-22T23:59Z 差一分钟 ⇒ 出局
        assertEquals(false, keys.contains("西瓜"))
    }

    @Test
    fun `恰好80分不进需多练`() {
        val weak = ParentReportLogic.weakWords(listOf(rec("恰好八十", 80f, "2026-09-17T05:00:00Z")), now)
        assertEquals(emptyList<WeakWord>(), weak)
    }

    @Test
    fun `同分时保持首次出现顺序`() {
        val weak = ParentReportLogic.weakWords(records, now)
        val lemon = weak.indexOfFirst { it.key == "柠檬" }
        val apricot = weak.indexOfFirst { it.key == "杏" }
        assertEquals(true, lemon in 0 until apricot)
    }

    @Test
    fun `分组key会去掉全角空格NBSP与BOM`() {
        // ref_text 是 "\u3000柠\u00A0檬\uFEFF"，去空白后应为「柠檬」
        val weak = ParentReportLogic.weakWords(listOf(rec("\u3000柠\u00A0檬\uFEFF", 12.5f, "2026-09-17T05:00:00Z")), now)
        assertEquals(listOf("柠檬"), weak.map { it.key })
    }

    @Test
    fun `分组key会去掉普通空格把同一词合并`() {
        val weak = ParentReportLogic.weakWords(
            listOf(
                rec("苹 果", 55.4f, "2026-09-19T12:00:00Z"),
                rec("苹果", 90.5f, "2026-09-22T01:50:00Z"),
            ),
            now,
        )
        assertEquals(listOf("苹果"), weak.map { it.key })
        assertEquals(listOf(55.4f), weak.map { it.score })   // 取最低分
    }

    @Test
    fun `分组key截前8个字符`() {
        val weak = ParentReportLogic.weakWords(records, now)
        val first = weak.first { it.key == "一二三四五六七八" }
        assertEquals(5f, first.score)                          // 两条同组取最低
        assertEquals(false, weak.any { it.key.length > ParentReportLogic.WEAK_KEY_LEN })
    }

    @Test
    fun `空记录集时一切归零且不崩`() {
        val empty = emptyList<SoeRecord>()
        val days = ParentReportLogic.days7(empty, now, shanghai)
        assertEquals(7, days.size)
        assertEquals(List(7) { 0 }, days.map { it.count })
        assertEquals(List(7) { null }, days.map { it.avgScore })
        assertEquals(0, ParentReportLogic.weekCount(days))
        assertNull(ParentReportLogic.weekAvg(empty, days))
        assertEquals(emptyList<WeakWord>(), ParentReportLogic.weakWords(empty, now))
    }

    // ── 配套小工具 ─────────────────────────────────────────────────────────

    @Test
    fun `dayKeyOf不足10位时原样返回`() {
        assertEquals("", ParentReportLogic.dayKeyOf(""))
        assertEquals("2026-09", ParentReportLogic.dayKeyOf("2026-09"))
        assertEquals("2026-09-22", ParentReportLogic.dayKeyOf("2026-09-22T01:50:00Z"))
    }

    @Test
    fun `jsNumber复刻JS的数字转字符串`() {
        assertEquals("85", jsNumber(85f))
        assertEquals("85.3", jsNumber(85.3f))
        assertEquals("12.5", jsNumber(12.5f))
        assertEquals("0", jsNumber(0f))
        assertEquals("100", jsNumber(100f))
        assertEquals("-1.5", jsNumber(-1.5f))
    }
}
