package com.example.ai.data.zhteach

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 期望值全部取自 `web/_artsplit_probe.mts` 打印的 web 真实实现输出
 * （探针直接 `import { splitSentences, mergeShorts } from "./src/lib/articleSplit"`），
 * **不是手抄或自推**。探针用完即删，故把关键输出固化在这里。
 *
 * 重点钉住 3 条反直觉行为：
 *  1. 连续句末标点各自成句；
 *  2. 只有紧跟句末标点的收尾引号才被吸收（`！` 之后的 `」` 会被吸收，但 `！」` 之后的 `！` 不会）；
 *  3. mergeShorts 的「文本没命中就回退下标」会让句子拿到别的句子的缩写。
 */
class ArticleSplitTest {

    @Test
    fun splitSentences_basic() {
        assertEquals(emptyList<String>(), ArticleSplit.splitSentences(""))
        assertEquals(
            listOf("第一句。", "第二句！", "第三句？"),
            ArticleSplit.splitSentences("第一句。第二句！第三句？"),
        )
        assertEquals(
            listOf(
                "秋天的雨，是一把钥匙。",
                "它带着清凉和温柔，轻轻地，轻轻地，趁你没留意，把秋天的大门打开了。",
            ),
            ArticleSplit.splitSentences(
                "秋天的雨，是一把钥匙。它带着清凉和温柔，轻轻地，轻轻地，趁你没留意，把秋天的大门打开了。",
            ),
        )
    }

    @Test
    fun splitSentences_semicolonAndNewline() {
        // ；是全角句末标点，; 也是
        assertEquals(listOf("甲；", "乙;", "丙"), ArticleSplit.splitSentences("甲；乙;丙"))
        // 换行强制断句
        assertEquals(listOf("上句。", "下句。"), ArticleSplit.splitSentences("上句。\n下句。"))
        // \r 先被去掉，故 \r\n 等价于 \n
        assertEquals(listOf("回车", "换行也断。"), ArticleSplit.splitSentences("回车\r\n换行也断。"))
    }

    @Test
    fun splitSentences_ellipsisIsSentenceEnd() {
        // 单个「…」当句末 ⇒ 句子中间出现省略号会被误切（web 已接受的取舍）
        assertEquals(listOf("我…", "不知道。", "他走了。"), ArticleSplit.splitSentences("我…不知道。他走了。"))
        assertEquals(listOf("结尾省略号……"), ArticleSplit.splitSentences("结尾省略号……"))
    }

    @Test
    fun splitSentences_absorbsTrailingQuotes() {
        assertEquals(
            listOf("他说：「今天天气真好。」", "然后笑了。"),
            ArticleSplit.splitSentences("他说：「今天天气真好。」然后笑了。"),
        )
        assertEquals(
            listOf("他说“好”。", "她说‘行’。"),
            ArticleSplit.splitSentences("他说“好”。她说‘行’。"),
        )
        // 句子中间没有句末标点 ⇒ 整体一句
        assertEquals(
            listOf("句号后的右引号」不该被切走。"),
            ArticleSplit.splitSentences("句号后的右引号」不该被切走。"),
        )
    }

    @Test
    fun splitSentences_consecutivePunctuationEachBecomesOwnSentence() {
        // 反直觉但真实：每个句末标点都触发一次断句
        assertEquals(
            listOf("只有标点。", "。", "。"),
            ArticleSplit.splitSentences("只有标点。。。"),
        )
        assertEquals(
            listOf("连续标点？", "？", "！", "！", "然后继续。"),
            ArticleSplit.splitSentences("连续标点？？！！然后继续。"),
        )
        // 「！」之后的「」」被吸收 ⇒ 得到 "！」"；再之后的「然后走了。」不受影响
        assertEquals(
            listOf("多个收尾符号：他说「真的！", "！", "！」", "然后走了。"),
            ArticleSplit.splitSentences("多个收尾符号：他说「真的！！！」然后走了。"),
        )
    }

    @Test
    fun splitSentences_trimsOnlyEnds() {
        // 只 trim 首尾，句子中间的空格保留（"前后有空白  。" 里面有两个空格）
        assertEquals(
            listOf("前后有空白  。", "下一句。"),
            ArticleSplit.splitSentences("  前后有空白  。 下一句。  "),
        )
    }

    @Test
    fun splitSentences_halfWidthPeriodIsNotSentenceEnd() {
        // 半角句点「.」不在句末标点集合里（只有 。！？!?；;…）⇒ 不切
        assertEquals(
            listOf("英文句号.也算吗？", "算。"),
            ArticleSplit.splitSentences("英文句号.也算吗？算。"),
        )
    }

    @Test
    fun mergeShorts_byNormalizedText() {
        assertEquals(
            listOf(ArticleLine("甲句。", "甲"), ArticleLine("乙句。", "乙")),
            ArticleSplit.mergeShorts(
                listOf("甲句。", "乙句。"),
                listOf(ArticleLine("甲句", "甲"), ArticleLine("乙句", "乙")),
            ),
        )
    }

    @Test
    fun mergeShorts_fallsBackToIndex() {
        assertEquals(
            listOf(ArticleLine("甲句。", "兜底A"), ArticleLine("乙句。", "兜底B")),
            ArticleSplit.mergeShorts(
                listOf("甲句。", "乙句。"),
                listOf(ArticleLine("完全不匹配A", "兜底A"), ArticleLine("完全不匹配B", "兜底B")),
            ),
        )
    }

    @Test
    fun mergeShorts_partialHitStillBleedsViaIndexFallback() {
        // 古怪但必须复刻：甲句文本没命中 ⇒ 回退到 items[0].short（"只有乙"）
        assertEquals(
            listOf(ArticleLine("甲句。", "只有乙"), ArticleLine("乙句。", "只有乙")),
            ArticleSplit.mergeShorts(
                listOf("甲句。", "乙句。"),
                listOf(ArticleLine("乙句。", "只有乙")),
            ),
        )
    }

    @Test
    fun mergeShorts_blankAndMissingItems() {
        assertEquals(listOf(ArticleLine("甲句。", "")), ArticleSplit.mergeShorts(listOf("甲句。"), null))
        assertEquals(
            listOf(ArticleLine("甲句。", "")),
            ArticleSplit.mergeShorts(listOf("甲句。"), listOf(ArticleLine("甲句", "   "))),
        )
        assertEquals(emptyList<ArticleLine>(), ArticleSplit.mergeShorts(emptyList(), listOf(ArticleLine("x", "y"))))
    }

    @Test
    fun mergeShorts_duplicateSentenceKeepsFirstShort() {
        // byText 只取首个 ⇒ 两句都拿「首个」
        assertEquals(
            listOf(ArticleLine("甲句。", "首个"), ArticleLine("甲句。", "首个")),
            ArticleSplit.mergeShorts(
                listOf("甲句。", "甲句。"),
                listOf(ArticleLine("甲句", "首个"), ArticleLine("甲句", "第二个")),
            ),
        )
    }
}
