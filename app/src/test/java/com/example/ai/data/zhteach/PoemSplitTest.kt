package com.example.ai.data.zhteach

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 期望值取自 `web/_poemsplit_probe.mjs`（在 Node 里跑 web 页面内联的那行同款正则）打印的输出。
 *
 * 重点钉住 3 条：
 *  1. 逗号「，」是切分点（古诗的"顿"），这与 [ArticleSplit] 完全不同；
 *  2. 半角 `,` `.` 不切；
 *  3. 换行被丢弃且不产生空段。
 */
class PoemSplitTest {

    @Test
    fun empty() {
        assertEquals(emptyList<String>(), PoemSplit.split(""))
    }

    @Test
    fun splitsOnCommaAndPeriod() {
        assertEquals(listOf("床前明月光，", "疑是地上霜。"), PoemSplit.split("床前明月光，疑是地上霜。"))
    }

    @Test
    fun newlineIsSkippedWithoutBlankSegment() {
        assertEquals(
            listOf("床前明月光，", "疑是地上霜。", "举头望明月，", "低头思故乡。"),
            PoemSplit.split("床前明月光，疑是地上霜。\n举头望明月，低头思故乡。"),
        )
        // 连续换行只被跳过，不产生空段
        assertEquals(listOf("空行", "也断。"), PoemSplit.split("空行\n\n也断。"))
    }

    @Test
    fun fourLineQuatrain() {
        assertEquals(
            listOf("远上寒山石径斜，", "白云生处有人家。", "停车坐爱枫林晚，", "霜叶红于二月花。"),
            PoemSplit.split("远上寒山石径斜，白云生处有人家。停车坐爱枫林晚，霜叶红于二月花。"),
        )
    }

    @Test
    fun exclamationAndQuestionAndColonAndSemicolon() {
        assertEquals(
            listOf("春眠不觉晓，", "处处闻啼鸟！", "夜来风雨声，", "花落知多少？"),
            PoemSplit.split("春眠不觉晓，处处闻啼鸟！夜来风雨声，花落知多少？"),
        )
        assertEquals(
            listOf("千山鸟飞绝；", "万径人踪灭：", "孤舟蓑笠翁。"),
            PoemSplit.split("千山鸟飞绝；万径人踪灭：孤舟蓑笠翁。"),
        )
    }

    @Test
    fun halfWidthPunctuationDoesNotSplit() {
        assertEquals(listOf("床前明月光,疑是地上霜."), PoemSplit.split("床前明月光,疑是地上霜."))
    }

    @Test
    fun trimsEachSegment() {
        assertEquals(listOf("前后有空白  ，", "下一句。"), PoemSplit.split("  前后有空白  ，  下一句。  "))
    }

    @Test
    fun lineWithoutPunctuationStaysWhole() {
        assertEquals(listOf("没有标点的一整行"), PoemSplit.split("没有标点的一整行"))
        // 「…」不在切分集合里 ⇒ 不切
        assertEquals(listOf("……省略号开头"), PoemSplit.split("……省略号开头"))
    }
}
