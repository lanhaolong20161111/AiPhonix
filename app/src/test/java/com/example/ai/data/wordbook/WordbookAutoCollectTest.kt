package com.example.ai.data.wordbook

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 生词本「点读自动收录」的口径与去重。
 *
 * `isWordbookWorthy` 的**全部期望值取自 web 真实实现**：
 * 用 `npx tsx` 跑探针从 `web/src/pages/AiParseResultPage.tsx` 里**抽出源码原文**再求值
 * （不是抄一遍、也不是自己推导），避免「自己实现自己验」。
 * 注意结果里有几个反直觉点：整段中文块 `/^[\u4e00-\u9fff]+$/` 命中 ⇒ `"认字"` 为 true；
 * 但混入拉丁/数字/标点（`"中文abc"`、`"abc123"`、`"字，"`）一律 false；全角 `Ａ` 与带音标的 `é`/`naïve` 也不收。
 */
class WordbookAutoCollectTest {

    // ── 汇总口径：来自 web 探针的逐项实测输出 ──
    @Test
    fun `收录口径与 web 实测逐项一致`() {
        // true 组
        listOf(
            "字", "汉字", "认字", "字 ",           // 汉字（含首尾空白被 trim）
            "hello", "Hello", "English", "Z", "z", // 英文单词（大小写均可）
            "don't", "it's", "well-known",         // 内部的 ' / ’ / - 允许
        ).forEach { assertEquals("应收录: <$it>", true, WordbookAutoCollector.isWordbookWorthy(it)) }

        // false 组
        listOf(
            "", " ", "  \t ",                      // 空白
            "hello world",                          // 多个单词
            "abc123", "中文abc", "abc中文", "5", "A1", // 混入数字/跨语种
            "a-", "-a",                             // 连字符在首尾
            "\uFF21", "é", "naïve",                 // 全角字母 / 带音标字母
            "，", "。", "，字", "字，",              // 标点（含首尾带标点）
        ).forEach { assertEquals("不应收录: <$it>", false, WordbookAutoCollector.isWordbookWorthy(it)) }
    }

    @Test
    fun `整段中文块也符合口径（与 web 同构）`() {
        // web 注释原文：「汉字（单字或整段中文块均收单字）」
        assertTrue(WordbookAutoCollector.isWordbookWorthy("春天来了"))
        assertTrue(WordbookAutoCollector.isWordbookWorthy("春"))
    }

    // ── 会话内去重：服务端是 upsert，重复上报会污染 times/SRS ──
    @Test
    fun `同一页内同一 source 与 text 只收录一次`() {
        val collector = newCollector()
        assertTrue(collector.shouldCollect("字", WordbookSource.RECOG_CHINESE))
        assertFalse(collector.shouldCollect("字", WordbookSource.RECOG_CHINESE))
        assertFalse(collector.shouldCollect(" 字 ", WordbookSource.RECOG_CHINESE)) // trim 后同 key
    }

    @Test
    fun `不同 source 各自独立计数`() {
        val collector = newCollector()
        assertTrue(collector.shouldCollect("hello", WordbookSource.RECOG_ENGLISH))
        // 同一词换来源（如先识别、后对话点读）—— web 的 key 是 `${source}:${t}`，故仍算首次
        assertTrue(collector.shouldCollect("hello", WordbookSource.chat("english")))
        assertFalse(collector.shouldCollect("hello", WordbookSource.chat("english")))
    }

    @Test
    fun `不符合口径的输入不进入去重集合`() {
        val collector = newCollector()
        assertFalse(collector.shouldCollect("abc123", WordbookSource.RECOG_ENGLISH))
        assertFalse(collector.shouldCollect("abc123", WordbookSource.RECOG_ENGLISH))
        // 若被误记入集合，这里会返回 false（说明"不该收"被当成"已收过"而不是"口径不符"）——
        // 两种情况对外表现一致，但语义不同，故用符合口径的词再验一次集合是空的
        assertTrue(collector.shouldCollect("abc", WordbookSource.RECOG_ENGLISH))
    }

    @Test
    fun `点读标点或空白不发请求`() {
        val calls = mutableListOf<String>()
        val collector = WordbookAutoCollector(launch = { block -> calls.add(block.toString()) })
        assertFalse(collector.collect("，", WordbookSource.RECOG_CHINESE))
        assertFalse(collector.collect("   ", WordbookSource.RECOG_CHINESE))
        assertEquals(0, calls.size)
        assertTrue(collector.collect("字", WordbookSource.RECOG_CHINESE))
        assertEquals(1, calls.size)
    }

    /** 去重测试不碰网络：launch 只记录块（不执行）。 */
    private fun newCollector(): WordbookAutoCollector =
        WordbookAutoCollector(launch = { /* 不执行，纯测判定 */ })
}
