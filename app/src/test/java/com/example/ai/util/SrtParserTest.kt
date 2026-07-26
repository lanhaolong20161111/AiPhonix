package com.example.ai.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SrtParser 单元测试 — 纯函数，无 Android 依赖。
 */
class SrtParserTest {

    @Test
    fun `parse normal SRT content`() {
        val srt = """
1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,500 --> 00:00:08,200
This is a test
Second line
        """.trimIndent()

        val entries = SrtParser.parse(srt)
        assertEquals(2, entries.size)

        assertEquals(1, entries[0].index)
        assertEquals(1000L, entries[0].startMs)
        assertEquals(4000L, entries[0].endMs)
        assertEquals("Hello world", entries[0].text)

        assertEquals(2, entries[1].index)
        assertEquals(5500L, entries[1].startMs)
        assertEquals(8200L, entries[1].endMs)
        assertEquals("This is a test Second line", entries[1].text)
    }

    @Test
    fun `parse with HTML tags strips them`() {
        val srt = """
1
00:00:01,000 --> 00:00:02,000
<b>Bold</b> and <i>italic</i>
        """.trimIndent()

        val entries = SrtParser.parse(srt)
        assertEquals(1, entries.size)
        assertEquals("Bold and italic", entries[0].text)
    }

    @Test
    fun `parse with style markers strips them`() {
        val srt = """
1
00:00:01,000 --> 00:00:02,000
Hello {italic}World{/italic}
        """.trimIndent()

        val entries = SrtParser.parse(srt)
        assertEquals("Hello World", entries[0].text)
    }

    @Test
    fun `parse with music description strips bracket markers`() {
        val srt = """
1
00:00:01,000 --> 00:00:02,000
[Music playing] Hello
        """.trimIndent()

        val entries = SrtParser.parse(srt)
        assertEquals("Hello", entries[0].text)
    }

    @Test
    fun `parse with dot decimal separator`() {
        val srt = """
1
00:00:01.500 --> 00:00:02.800
Dot format
        """.trimIndent()

        val entries = SrtParser.parse(srt)
        assertEquals(1500L, entries[0].startMs)
        assertEquals(2800L, entries[0].endMs)
    }

    @Test
    fun `parse empty content returns empty list`() {
        assertTrue(SrtParser.parse("").isEmpty())
    }

    @Test
    fun `parse whitespace only returns empty list`() {
        assertTrue(SrtParser.parse("   \n\n  ").isEmpty())
    }

    @Test
    fun `parse invalid index skips block`() {
        val srt = """
abc
00:00:01,000 --> 00:00:02,000
Text
        """.trimIndent()

        assertTrue(SrtParser.parse(srt).isEmpty())
    }

    @Test
    fun `parse missing timestamp line skips block`() {
        val srt = """
1
Missing timestamp
Text
        """.trimIndent()

        assertTrue(SrtParser.parse(srt).isEmpty())
    }

    @Test
    fun `parse block with only index and timestamp skips`() {
        val srt = """
1
00:00:01,000 --> 00:00:02,000
        """.trimIndent()

        assertTrue(SrtParser.parse(srt).isEmpty())
    }

    @Test
    fun `parse handles CRLF line endings`() {
        val srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld"
        val entries = SrtParser.parse(srt)
        assertEquals(2, entries.size)
    }

    @Test
    fun `parse large time values`() {
        val srt = """
1
01:59:59,999 --> 02:00:00,001
Edge case
        """.trimIndent()

        val entries = SrtParser.parse(srt)
        assertEquals(1, entries.size)
        assertEquals(7199999L, entries[0].startMs)  // 1*3600000 + 59*60000 + 59*1000 + 999
        assertEquals(7200001L, entries[0].endMs)
    }

    // ── findCurrentSubtitle ──

    @Test
    fun `findCurrentSubtitle returns matching entry`() {
        val entries = listOf(
            SubtitleEntry(1, 1000, 4000, "First"),
            SubtitleEntry(2, 5000, 8000, "Second"),
        )

        assertEquals("First", SrtParser.findCurrentSubtitle(entries, 1000)?.text)
        assertEquals("First", SrtParser.findCurrentSubtitle(entries, 2500)?.text)
        assertEquals("First", SrtParser.findCurrentSubtitle(entries, 4000)?.text)
        assertEquals("Second", SrtParser.findCurrentSubtitle(entries, 5000)?.text)
        assertEquals("Second", SrtParser.findCurrentSubtitle(entries, 6500)?.text)
    }

    @Test
    fun `findCurrentSubtitle returns null for gap`() {
        val entries = listOf(
            SubtitleEntry(1, 1000, 4000, "First"),
            SubtitleEntry(2, 5000, 8000, "Second"),
        )

        assertNull(SrtParser.findCurrentSubtitle(entries, 0))
        assertNull(SrtParser.findCurrentSubtitle(entries, 4500))
        assertNull(SrtParser.findCurrentSubtitle(entries, 9999))
    }

    @Test
    fun `findCurrentSubtitle with empty list returns null`() {
        assertNull(SrtParser.findCurrentSubtitle(emptyList(), 5000))
    }
}
