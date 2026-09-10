package com.example.ai.ui.aihomework

import com.example.ai.data.aihomework.QuestionItem
import com.example.ai.data.aihomework.QuantityItem
import com.example.ai.data.aihomework.QuantityRelation
import com.example.ai.data.aihomework.SentenceInfo
import com.example.ai.data.aihomework.SolutionStep
import com.example.ai.data.aihomework.SolutionStepDraw
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** ReverseGuide 纯函数单测：倒推引导的 needs 提取 / 答案推算 / 校验 / 干扰项 */
class ReverseGuideLogicTest {

    private fun q(name: String, value: Float? = null, unit: String = ""): QuantityItem =
        QuantityItem(name = name, value = value, unit = unit)

    private fun rel(a: String, b: String, type: String, amount: Float = 0f, parts: List<String> = emptyList()): QuantityRelation =
        QuantityRelation(a = a, b = b, type = type, amount = amount, parts = parts)

    // ── needsFor ──

    @Test
    fun needsFor_returnsNeeds() {
        val qi = QuestionItem(text = "足球有几个？", target = "足球", needs = listOf("篮球"), hint = "")
        assertEquals(listOf("篮球"), needsFor(qi))
    }

    @Test
    fun needsFor_emptyNeedsFallsBackToTarget() {
        val qi = QuestionItem(text = "足球有几个？", target = "足球", needs = emptyList(), hint = "")
        assertEquals(listOf("足球"), needsFor(qi))
    }

    @Test
    fun needsFor_blankEntriesDropped() {
        val qi = QuestionItem(text = "一共多少？", target = "一共", needs = listOf(" 篮球 ", "", "  "), hint = "")
        assertEquals(listOf("篮球"), needsFor(qi))
    }

    // ── expectedValueOf ──

    @Test
    fun expectedValueOf_knownQuantity() {
        val quantities = listOf(q("篮球", 12f), q("足球"))
        assertEquals(12f, expectedValueOf("篮球", quantities, emptyList()))
    }

    @Test
    fun expectedValueOf_chainInference_more() {
        val quantities = listOf(q("篮球", 12f), q("足球"))
        val relations = listOf(rel("足球", "篮球", "less", 4f))
        assertEquals(8f, expectedValueOf("足球", quantities, relations))
    }

    @Test
    fun expectedValueOf_chainInference_total() {
        val quantities = listOf(q("篮球", 12f), q("足球", 8f), q("一共"))
        val relations = listOf(rel("一共", "", "total", parts = listOf("篮球", "足球")))
        assertEquals(20f, expectedValueOf("一共", quantities, relations))
    }

    @Test
    fun expectedValueOf_unknownReturnsNull() {
        val quantities = listOf(q("篮球", 12f))
        assertNull(expectedValueOf("不存在的量", quantities, emptyList()))
    }

    @Test
    fun expectedValueOf_blankTargetReturnsNull() {
        assertNull(expectedValueOf("", emptyList(), emptyList()))
    }

    // ── checkAnswer ──

    @Test
    fun checkAnswer_exactMatch() {
        assertTrue(checkAnswer("8", 8f))
        assertTrue(checkAnswer("20", 20f))
    }

    @Test
    fun checkAnswer_smallErrorAccepted() {
        assertTrue(checkAnswer("8.01", 8f))
        assertTrue(checkAnswer("79.5", 80f))
    }

    @Test
    fun checkAnswer_nonNumericRejected() {
        assertFalse(checkAnswer("abc", 8f))
        assertFalse(checkAnswer("", 8f))
        assertFalse(checkAnswer("  ", 8f))
    }

    @Test
    fun checkAnswer_wrongRejected() {
        assertFalse(checkAnswer("9", 8f))
        assertFalse(checkAnswer("7", 8f))
    }

    // ── distractorCandidates ──

    @Test
    fun distractorCandidates_excludesOwnNeedsAndTarget() {
        val q1 = QuestionItem(text = "足球几个？", target = "足球", needs = listOf("篮球"), hint = "")
        val q2 = QuestionItem(text = "一共多少？", target = "一共", needs = listOf("篮球", "足球"), hint = "")
        val quantities = listOf(q("篮球"), q("足球"), q("牛奶"))
        val cands = distractorCandidates(q1, listOf(q1, q2), quantities)
        assertTrue("篮球" !in cands)          // 本问 needs 排除
        assertTrue("足球" !in cands)          // target 排除
        assertTrue("牛奶" in cands)           // 干扰实体在
        // q2 视角：篮球/足球 是它自己的 needs，都不应出现在干扰项；牛奶是干扰项
        val cands2 = distractorCandidates(q2, listOf(q1, q2), quantities)
        assertTrue("篮球" !in cands2)
        assertTrue("足球" !in cands2)
        assertTrue("牛奶" in cands2)
    }

    @Test
    fun distractorCandidates_cappedAtSix() {
        val q1 = QuestionItem(text = "Q1", target = "A", needs = listOf("B"), hint = "")
        val many = (0 until 20).map { QuestionItem(text = "Q$it", target = "T$it", needs = listOf("B", "N$it"), hint = "") }
        val quantities = (0 until 20).map { q("E$it") }
        assertTrue(distractorCandidates(q1, listOf(q1) + many, quantities).size <= 6)
    }

    // ── nameMatches ──

    @Test
    fun nameMatches_exactAndContains() {
        assertTrue(nameMatches("足球", listOf("足球")))
        assertTrue(nameMatches("足球个数", listOf("足球")))
        assertTrue(nameMatches("足球", listOf("足球个数")))
        assertFalse(nameMatches("足球", listOf("篮球")))
    }

    @Test
    fun sourceSentenceFor_findsByContains() {
        val sentences = listOf(
            SentenceInfo(text = "商店有12个篮球", isKey = true),
            SentenceInfo(text = "足球比篮球少4个", isKey = true),
        )
        val src = sourceSentenceFor("篮球", sentences)
        assertNotNull(src)
        assertTrue(src!!.contains("篮球"))
    }

    @Test
    fun sourceSentenceFor_missingReturnsNull() {
        val sentences = listOf(SentenceInfo(text = "商店有12个篮球", isKey = true))
        assertNull(sourceSentenceFor("牛奶", sentences))
    }
}
