package com.example.ai.data.joy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `highlightJoyText` 的期望值**全部取自 web 真实实现的输出**
 * （用 `npx tsx` 跑 `web/src/services/joy.ts` 的 highlightJoyText 逐例打印）。
 */
class JoyHighlightTest {

    private fun seg(text: String, hit: Boolean) = JoySegment(text, hit)

    @Test
    fun `单字目标逐个高亮`() {
        assertEquals(
            listOf(seg("清", true), seg("清", true), seg("的水", false)),
            highlightJoyText("清清的水", "清", ""),
        )
    }

    @Test
    fun `整词高亮`() {
        assertEquals(
            listOf(seg("我喜欢", false), seg("小猫", true)),
            highlightJoyText("我喜欢小猫", "", "小猫"),
        )
    }

    @Test
    fun `多目标取最早出现者`() {
        // "今天是晴天"：先命中位置 1 的「天」，再命中「晴」，最后又命中「天」
        assertEquals(
            listOf(
                seg("今", false), seg("天", true), seg("是", false),
                seg("晴", true), seg("天", true),
            ),
            highlightJoyText("今天是晴天", "晴,天", ""),
        )
    }

    @Test
    fun `同位置时词胜出`() {
        // targets 里 words 在 chars 之前，比较用严格小于 ⇒ 同起点时先入列的「词」保住
        assertEquals(
            listOf(seg("小猫", true)),
            highlightJoyText("小猫", "小", "小猫"),
        )
        assertEquals(
            listOf(seg("水泡", true), seg("和", false), seg("泡", true), seg("泡", true)),
            highlightJoyText("水泡和泡泡", "泡", "水泡"),
        )
    }

    @Test
    fun `重复词各自成段`() {
        assertEquals(
            listOf(
                seg("他抱着一只", false), seg("小猫", true),
                seg("，", false), seg("小猫", true), seg("在睡觉", false),
            ),
            highlightJoyText("他抱着一只小猫，小猫在睡觉", "", "小猫"),
        )
    }

    @Test
    fun `英文与空格保留在非命中段`() {
        assertEquals(
            listOf(seg("xiao ", false), seg("mao", true)),
            highlightJoyText("xiao mao", "", "mao"),
        )
    }

    @Test
    fun `空文本与无目标`() {
        assertTrue(highlightJoyText("", "清", "").isEmpty())
        assertEquals(listOf(seg("abc", false)), highlightJoyText("abc", "", ""))
    }
}
