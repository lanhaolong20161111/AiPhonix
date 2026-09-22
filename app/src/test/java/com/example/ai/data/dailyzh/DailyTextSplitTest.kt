package com.example.ai.data.dailyzh

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 每日一练文本切分 —— 期望值**全部取自 web 真实实现**：
 * 探针从 `web/src/pages/DailyChinesePage.tsx` / `DailyEnglishPage.tsx` / `SentencePracticePage.tsx`
 * 里**抽出源码原文**（不是抄一遍）后用 `npx tsx` 逐项打印，此处照抄打印结果。
 *
 * 重点覆盖两处容易踩的差异：
 * ① JS 的 `\s` 含 U+3000 / U+00A0 / U+FEFF，Java 默认不含 ⇒ 全角空格必须能切开；
 * ② [DailyTextSplit.todaySentences] 的分隔符是**零宽**的（句号/分号留在上一段末尾），与 [DailyTextSplit.sentences] 不同。
 */
class DailyTextSplitTest {

    // ── web splitText（每日语文的 chars / words / sentences 统计都用它） ──

    @Test
    fun `chars 按逗号顿号分号空白切分`() {
        assertEquals(listOf("日", "月", "水", "火"), DailyTextSplit.chars("日 月 水 火"))
        assertEquals(listOf("春天", "朋友", "认真"), DailyTextSplit.chars("春天，朋友，认真"))
        assertEquals(listOf("a", "b", "c", "d", "e"), DailyTextSplit.chars("a,b、c;d\ne"))
        assertEquals(listOf("a", "b"), DailyTextSplit.chars("a\n\nb"))
        assertEquals(listOf("只有一个"), DailyTextSplit.chars("只有一个"))
    }

    @Test
    fun `chars 不切句号与问号`() {
        // web 实测：逗号/顿号/分号/空白才切，句号不是分隔符
        assertEquals(
            listOf("用「因为…所以…」造句；用「有的…有的…」写一段话"),
            DailyTextSplit.chars("用「因为…所以…」造句；用「有的…有的…」写一段话"),
        )
        assertEquals(
            listOf("第一句。第二句；第三句", "第四句"),
            DailyTextSplit.chars("第一句。第二句；第三句;第四句"),
        )
        assertEquals(listOf("。a"), DailyTextSplit.chars("。a"))
        assertEquals(listOf("a；"), DailyTextSplit.chars("a；"))
    }

    @Test
    fun `chars 空串与纯空白得空列表`() {
        assertEquals(emptyList<String>(), DailyTextSplit.chars(""))
        assertEquals(emptyList<String>(), DailyTextSplit.chars("   "))
        // 前导分隔符只产生空段，被 filter 掉
        assertEquals(listOf("a"), DailyTextSplit.chars(";a"))
    }

    @Test
    fun `chars 认 JS 的空白集（全角空格 NBSP BOM）`() {
        // ★ JS `\s` 含 U+3000；Java `\s` 不含 —— 若不显式补上就会少切一刀
        assertEquals(listOf("日", "月"), DailyTextSplit.chars("日\u3000月"))
        assertEquals(listOf("a", "b"), DailyTextSplit.chars("a\u00A0b"))
        assertEquals(listOf("a", "b"), DailyTextSplit.chars("a\uFEFFb"))
    }

    @Test
    fun `words 与 chars 同实现`() {
        // web 里 splitWords 与 splitText 的表达式完全一致（探针已确认），这里钉住这个事实
        val samples = listOf("日 月 水 火", "春天，朋友，认真", "a,b、c;d\ne", "I like apples.; She is a student.")
        samples.forEach { s ->
            assertEquals(DailyTextSplit.chars(s), DailyTextSplit.words(s))
        }
    }

    // ── web splitSentences（每日英语的句子列表） ──

    @Test
    fun `sentences 只按分号与换行切分`() {
        assertEquals(
            listOf("I like apples.", "She is a student."),
            DailyTextSplit.sentences("I like apples.; She is a student."),
        )
        assertEquals(
            listOf("a,b、c", "d", "e"),
            DailyTextSplit.sentences("a,b、c;d\ne"),
        )
        assertEquals(
            listOf("用「因为…所以…」造句", "用「有的…有的…」写一段话"),
            DailyTextSplit.sentences("用「因为…所以…」造句；用「有的…有的…」写一段话"),
        )
        assertEquals(
            listOf("第一句。第二句", "第三句", "第四句"),
            DailyTextSplit.sentences("第一句。第二句；第三句;第四句"),
        )
    }

    @Test
    fun `sentences 不切逗号与空格`() {
        assertEquals(listOf("日 月 水 火"), DailyTextSplit.sentences("日 月 水 火"))
        assertEquals(listOf("日\u3000月"), DailyTextSplit.sentences("日\u3000月"))
        assertEquals(listOf("a"), DailyTextSplit.sentences("a；"))
    }

    // ── web todaySentences（造句练习的今日句型列表） ──

    @Test
    fun `todaySentences 是零宽切分_终止符留在上一段`() {
        // ★ 与 sentences 的关键差异：句号/分号不消失，附着在前一段末尾
        assertEquals(
            listOf("第一句。", "第二句；", "第三句;", "第四句"),
            DailyTextSplit.todaySentences("第一句。第二句；第三句;第四句"),
        )
        assertEquals(
            listOf("a,b、c;", "d", "e"),
            DailyTextSplit.todaySentences("a,b、c;d\ne"),
        )
        assertEquals(
            listOf("I like apples.;", "She is a student."),
            DailyTextSplit.todaySentences("I like apples.; She is a student."),
        )
        assertEquals(
            listOf("用「因为…所以…」造句；", "用「有的…有的…」写一段话"),
            DailyTextSplit.todaySentences("用「因为…所以…」造句；用「有的…有的…」写一段话"),
        )
    }

    @Test
    fun `todaySentences 前导终止符产生单字符段`() {
        assertEquals(listOf("。", "a"), DailyTextSplit.todaySentences("。a"))
        assertEquals(listOf(";", "a"), DailyTextSplit.todaySentences(";a"))
        assertEquals(listOf("a；"), DailyTextSplit.todaySentences("a；"))
    }

    @Test
    fun `todaySentences 句号加换行不产生空段`() {
        assertEquals(listOf("第一句。", "第二句"), DailyTextSplit.todaySentences("第一句。\n第二句"))
        assertEquals(listOf("a", "b"), DailyTextSplit.todaySentences("a\n\nb"))
        assertEquals(emptyList<String>(), DailyTextSplit.todaySentences("   "))
    }
}
