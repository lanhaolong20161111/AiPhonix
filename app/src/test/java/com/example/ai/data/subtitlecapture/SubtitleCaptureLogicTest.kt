package com.example.ai.data.subtitlecapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 字幕采集纯逻辑单测。
 *
 * ★ 期望值来源：`web/_subcap_probe.mjs` —— 把 `SubtitleCapturePage.tsx` 里的 `fmt` /
 * `restoreRectForMovie` / 近邻分组 / 书签命中 / `openUrl` 取名 / `mousemove` 的 clamp
 * **原样复制**到 node 里跑出来的输出（**不是**我自己按语义推导的）。
 * 这是把「照抄没抄错」变成可验证的唯一手段 —— 这类页面差 1px/1ms 就是「框不到字幕 / 书签不亮」。
 */
class SubtitleCaptureLogicTest {

    private fun r(x: Int, y: Int, w: Int, h: Int) = CaptureRect(x, y, w, h)
    private fun item(seq: Int, ms: Long, movie: String = "m") =
        CaptureItem(seq = seq, movieName = movie, timestampMs = ms)

    // ────────────────────────── 时间戳 ──────────────────────────

    @Test
    fun `时间戳格式与 web fmt 逐位一致`() {
        val cases = listOf(
            0L to "00:00:00.000",
            1L to "00:00:00.001",
            999L to "00:00:00.999",
            1000L to "00:00:01.000",
            1234L to "00:00:01.234",
            61234L to "00:01:01.234",
            3_600_000L to "01:00:00.000",
            3_661_001L to "01:01:01.001",
            86_399_999L to "23:59:59.999",
            90_061_000L to "25:01:01.000", // 小时不封顶（web 也只补 2 位）
            45_296_789L to "12:34:56.789",
        )
        for ((ms, expect) in cases) {
            assertEquals("fmt($ms)", expect, SubtitleCaptureLogic.fmtTimestamp(ms))
        }
    }

    @Test
    fun `时间戳负数按 0 处理`() {
        // 服务端 `Math.max(0, Number(meta.timestamp_ms) || 0)`；本地预览不能显示 -00:00:00.-5
        assertEquals("00:00:00.000", SubtitleCaptureLogic.fmtTimestamp(-1))
        assertEquals("00:00:00.000", SubtitleCaptureLogic.fmtTimestamp(-999_999))
    }

    // ────────────────────────── 画框换算 ──────────────────────────

    @Test
    fun `显示区画框换算成视频像素与 web cropBlob 一致`() {
        assertEquals(r(192, 504, 1536, 180), SubtitleCaptureLogic.toVideoRect(r(96, 252, 768, 90), 960, 540, 1920, 1080))
        assertEquals(r(20, 40, 600, 80), SubtitleCaptureLogic.toVideoRect(r(10, 20, 300, 40), 640, 360, 1280, 720))
        // 非整数缩放：四舍五入（151.5→152 这类边界与 JS Math.round 同向）
        assertEquals(r(11, 21, 301, 41), SubtitleCaptureLogic.toVideoRect(r(11, 21, 301, 41), 1000, 1000, 999, 1001))
    }

    @Test
    fun `画框换算缺任一尺寸返回 null 而不是拿 0 当缩放因子`() {
        assertNull(SubtitleCaptureLogic.toVideoRect(r(0, 0, 10, 10), 0, 540, 1920, 1080))
        assertNull(SubtitleCaptureLogic.toVideoRect(r(0, 0, 10, 10), 960, 0, 1920, 1080))
        assertNull(SubtitleCaptureLogic.toVideoRect(r(0, 0, 10, 10), 960, 540, 0, 1080))
        assertNull(SubtitleCaptureLogic.toVideoRect(r(0, 0, 10, 10), 960, 540, 1920, 0))
    }

    @Test
    fun `记忆画框按新容器尺寸等比恢复`() {
        // 1000x500 时记的框，换到 2000x1000 的容器 → 整体 ×2
        assertEquals(
            r(200, 400, 600, 800),
            SubtitleCaptureLogic.restoreRect(RectMemory(100, 200, 300, 400, 1000, 500), 2000, 1000),
        )
        // 640x360 → 960x540（×1.5），四舍五入：151.5→152 / 304.5→305 / 451.5→452 / 610.5→611
        assertEquals(
            r(152, 305, 452, 611),
            SubtitleCaptureLogic.restoreRect(RectMemory(101, 203, 301, 407, 640, 360), 960, 540),
        )
    }

    @Test
    fun `记忆画框缺任一尺寸放弃恢复`() {
        assertNull(SubtitleCaptureLogic.restoreRect(null, 960, 540))
        assertNull(SubtitleCaptureLogic.restoreRect(RectMemory(1, 1, 1, 1, 0, 0), 960, 540))
        assertNull(SubtitleCaptureLogic.restoreRect(RectMemory(1, 1, 1, 1, 100, 100), 0, 540))
        assertNull(SubtitleCaptureLogic.restoreRect(RectMemory(1, 1, 1, 1, 100, 100), 960, 0))
    }

    @Test
    fun `默认框与起手框的取整规则`() {
        // web 截屏按钮：x=10% / y=70% / w=80% / h=25%（round）
        assertEquals(r(96, 378, 768, 135), SubtitleCaptureLogic.defaultRect(960, 540))
        // web 空白处按下：x=0 / y=0 / w=30% / h=20%
        assertEquals(r(0, 0, 288, 108), SubtitleCaptureLogic.draftRect(960, 540))
    }

    @Test
    fun `画框可用性门槛是 8 像素`() {
        assertTrue(SubtitleCaptureLogic.isUsable(r(0, 0, 8, 8)))
        assertTrue(SubtitleCaptureLogic.isUsable(r(0, 0, 100, 8)))
        assertTrue(!SubtitleCaptureLogic.isUsable(r(0, 0, 7, 8)))
        assertTrue(!SubtitleCaptureLogic.isUsable(r(0, 0, 8, 7)))
        assertTrue(!SubtitleCaptureLogic.isUsable(null))
    }

    // ────────────────────────── 拖拽 ──────────────────────────

    @Test
    fun `拖拽移动与八向缩放与 web mousemove 一致`() {
        val s = r(100, 200, 300, 100)
        val cases = listOf(
            Triple("move", 50 to 30, r(150, 230, 300, 100)),
            Triple("move", -500 to -500, r(0, 0, 300, 100)),
            Triple("move", 5000 to 5000, r(660, 440, 300, 100)), // 右/下边界 = 容器 - 框
            Triple("e", 20 to 0, r(100, 200, 320, 100)),
            Triple("e", -500 to 0, r(100, 200, 8, 100)),         // 最小边 8
            Triple("e", 5000 to 0, r(100, 200, 860, 100)),
            Triple("s", 0 to 20, r(100, 200, 300, 120)),
            Triple("s", 0 to -500, r(100, 200, 300, 8)),
            Triple("w", 30 to 0, r(130, 200, 270, 100)),
            Triple("w", -500 to 0, r(0, 200, 400, 100)),         // 左沿贴 0，边长反推
            Triple("w", 5000 to 0, r(392, 200, 8, 100)),
            Triple("n", 0 to 30, r(100, 230, 300, 70)),
            Triple("n", 0 to -500, r(100, 0, 300, 300)),
            Triple("n", 0 to 5000, r(100, 292, 300, 8)),
            Triple("nw", -20 to -30, r(80, 170, 320, 130)),
            Triple("se", 40 to 40, r(100, 200, 340, 140)),
            Triple("ne", 40 to -30, r(100, 170, 340, 130)),
            Triple("sw", -20 to 30, r(80, 200, 320, 130)),
        )
        for ((handle, d, expect) in cases) {
            val got = SubtitleCaptureLogic.dragRect(s, handle, d.first, d.second, 960, 540)
            assertEquals("$handle d=${d.first},${d.second}", expect, got)
        }
    }

    @Test
    fun `框比容器还大时不抛错而是退化成边界值`() {
        // 只可能来自「换分辨率后恢复的记忆框」；web 靠 clamp 的 min>max 退化行为兜住，不能抛
        val big = r(10, 10, 2000, 2000)
        assertEquals(r(10, 10, 950, 2000), SubtitleCaptureLogic.dragRect(big, "e", 5, 5, 960, 540))
        assertEquals(r(0, 0, 2000, 2000), SubtitleCaptureLogic.dragRect(big, "move", 5, 5, 960, 540))
    }

    // ────────────────────────── 列表 / 书签 ──────────────────────────

    @Test
    fun `本片截图按时间戳升序筛选`() {
        val items = listOf(
            item(3, 3000, "m"),
            item(1, 1000, "m"),
            item(2, 2000, "other"),
            item(4, 500, "m"),
        )
        val got = SubtitleCaptureLogic.marksOfMovie(items, "m")
        assertEquals(listOf(4, 1, 3), got.map { it.seq })
    }

    @Test
    fun `相邻截图 1500ms 内才成组高亮`() {
        // 混合顺序传入（内部要排序）
        assertEquals(
            setOf(1, 2, 3, 4),
            SubtitleCaptureLogic.nearDuplicateSeqs(listOf(item(2, 1000), item(1, 0), item(4, 3100), item(3, 3000))),
        )
        // 恰好 1500ms 不算（严格小于）
        assertEquals(
            emptySet<Int>(),
            SubtitleCaptureLogic.nearDuplicateSeqs(listOf(item(1, 0), item(2, 1500), item(3, 3000))),
        )
        assertEquals(emptySet<Int>(), SubtitleCaptureLogic.nearDuplicateSeqs(listOf(item(5, 5000))))
        assertEquals(emptySet<Int>(), SubtitleCaptureLogic.nearDuplicateSeqs(emptyList()))
    }

    @Test
    fun `书签命中容差 800ms 含边界`() {
        val marks = listOf(SubtitleMark(ts = 1000), SubtitleMark(ts = 5000), SubtitleMark(ts = 9000))
        assertEquals(1000L, SubtitleCaptureLogic.findActiveMark(marks, 1800)?.ts)  // 差 800 → 命中
        assertNull(SubtitleCaptureLogic.findActiveMark(marks, 1801))               // 差 801 → 不命中
        assertEquals(5000L, SubtitleCaptureLogic.findActiveMark(marks, 5500)?.ts)
        assertEquals(5000L, SubtitleCaptureLogic.findActiveMark(marks, 5501)?.ts)
        assertNull(SubtitleCaptureLogic.findActiveMark(emptyList(), 1000))
    }

    @Test
    fun `自动复习容差 400ms 且不重复触发同一书签`() {
        val marks = listOf(SubtitleMark(ts = 1000), SubtitleMark(ts = 5000))
        assertEquals(1000L, SubtitleCaptureLogic.findAutoReviewHit(marks, 1300, -1)?.ts)
        assertNull(SubtitleCaptureLogic.findAutoReviewHit(marks, 1400, -1))            // 恰好 400 不算（严格小于）
        assertNull(SubtitleCaptureLogic.findAutoReviewHit(marks, 1000, 1000))          // 同一书签不重复
        assertEquals(5000L, SubtitleCaptureLogic.findAutoReviewHit(marks, 5000, 1000)?.ts)
    }

    @Test
    fun `回灌历史测评按 seq 去重并按 seq 倒序`() {
        val prev = listOf(EvalCardModel(seq = 5), EvalCardModel(seq = 2))
        val incoming = listOf(EvalCardModel(seq = 2, cached = true), EvalCardModel(seq = 9, cached = true))
        val got = SubtitleCaptureLogic.mergeEvalCards(prev, incoming)
        assertEquals(listOf(9, 5, 2), got.map { it.seq })
        // 已存在的不被覆盖（web 用 `have` 集合过滤，保留本地那份 live 结果）
        assertEquals(false, got.first { it.seq == 2 }.cached)
    }

    // ────────────────────────── 影片名 ──────────────────────────

    @Test
    fun `URL 推导影片名与 web openUrl 一致`() {
        val cases = listOf(
            "https://cdn.example.com/videos/ep01.mp4" to "cdn.example.com · ep01",
            "example.com/a/b/c.webm" to "example.com · c",
            "https://example.com/" to "example.com",
            "https://example.com" to "example.com",
            "  https://x.com/very/long/path/to/some/movie.file.mp4  " to "x.com · movie.file", // 只去最后一个扩展名
            "not a url at all with spaces" to "not a url at all with sp",                        // 解析失败 → 截断 24 字符
            "https://x.com/0123456789012345678901234567890.mp4" to "x.com · 0123456789012345678901234567890",
        )
        for ((url, expect) in cases) {
            assertEquals(url, expect, SubtitleCaptureLogic.movieNameFromUrl(url))
        }
        assertEquals("", SubtitleCaptureLogic.movieNameFromUrl("   "))
    }

    @Test
    fun `本地文件名去扩展名`() {
        assertEquals("小猪佩奇 S1E01", SubtitleCaptureLogic.stripExtension("小猪佩奇 S1E01.mp4"))
        assertEquals("a.b", SubtitleCaptureLogic.stripExtension("a.b.mp4"))
        assertEquals("没有扩展名", SubtitleCaptureLogic.stripExtension("没有扩展名"))
        // JS 的 `/\.[^.]+$/` 会把 `.hidden` 整段吃掉 → 空串（照抄，别"修正"）
        assertEquals("", SubtitleCaptureLogic.stripExtension(".hidden"))
    }

    @Test
    fun `B站预览地址参数与 web 一致`() {
        assertEquals(
            "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1&high_quality=1&danmaku=0",
            SubtitleCaptureLogic.biliPlayerUrl("BV1xx411c7mD"),
        )
    }

    // ────────────────────────── 来源 ──────────────────────────

    @Test
    fun `只有本地与云端直链可以采集`() {
        assertTrue(MovieSource.LOCAL.canCapture)
        assertTrue(MovieSource.URL.canCapture)
        // B站是 iframe 预览，跨域拿不到画面也读不到时间戳 —— web 明确禁止采集
        assertFalse(MovieSource.BILI.canCapture)
        assertFalse(MovieSource.NONE.canCapture)
    }
}
