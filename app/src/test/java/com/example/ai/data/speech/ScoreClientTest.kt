package com.example.ai.data.speech

import com.example.ai.data.model.ScoreLevel
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ScoreClient.parseJsonResponse 的单元测试。
 * 纯函数，无需 Android 设备，无需 Mock。
 */
class ScoreClientTest {

    // ── 正常场景 ──

    @Test
    fun `parse normal valid response`() {
        val json = """
        {
            "pron_accuracy": 85,
            "pron_fluency": 0.75,
            "pron_completion": 0.9,
            "suggested_score": 0.8,
            "words": [
                {
                    "word": "hello",
                    "accuracy": 85.0,
                    "match_tag": 0,
                    "phone_infos": [
                        { "phone": "/h/", "accuracy": 90.0 },
                        { "phone": "/ə/", "accuracy": 80.0 }
                    ]
                },
                {
                    "word": "world",
                    "accuracy": 70.0,
                    "match_tag": 1,
                    "phone_infos": [
                        { "phone": "/w/", "accuracy": 70.0 }
                    ]
                }
            ]
        }
        """.trimIndent()

        val result = ScoreClient.parseJsonResponse(json, "hello world")

        assertEquals(85, result.totalScore)
        assertEquals(85.0, result.accuracyScore, 0.001)
        assertEquals(0.75, result.fluencyScore, 0.001)
        assertEquals(0.9, result.integrityScore, 0.001)
        assertEquals(0.8, result.standardScore, 0.001)
        assertEquals("读得很好！🎉", result.feedback)
        assertEquals("hello world", result.word.text)

        // WordScores
        assertEquals(2, result.wordScores.size)
        assertEquals("hello", result.wordScores[0].word)
        assertEquals(85.0f, result.wordScores[0].pronAccuracy, 0.001f)
        assertEquals(0, result.wordScores[0].matchTag)
        assertEquals("world", result.wordScores[1].word)
        assertEquals(70.0f, result.wordScores[1].pronAccuracy, 0.001f)
        assertEquals(1, result.wordScores[1].matchTag)

        // PhonemeScores
        assertEquals(3, result.phonemeScores.size)
        assertEquals("/h/", result.phonemeScores[0].phoneme)
        assertEquals(90, result.phonemeScores[0].score)
        assertEquals(ScoreLevel.GOOD, result.phonemeScores[0].level)
        assertEquals("/ə/", result.phonemeScores[1].phoneme)
        assertEquals(80, result.phonemeScores[1].score)
        assertEquals(ScoreLevel.GOOD, result.phonemeScores[1].level)
        assertEquals("/w/", result.phonemeScores[2].phoneme)
        assertEquals(70, result.phonemeScores[2].score)
        assertEquals(ScoreLevel.OKAY, result.phonemeScores[2].level)
    }

    @Test
    fun `parse minimal response with empty words`() {
        val json = """{"pron_accuracy": 95}""".trimIndent()

        val result = ScoreClient.parseJsonResponse(json, "test")

        assertEquals(95, result.totalScore)
        assertEquals(0.0, result.fluencyScore, 0.001)
        assertEquals(0.0, result.integrityScore, 0.001)
        assertEquals(0.0, result.standardScore, 0.001)
        assertTrue(result.wordScores.isEmpty())
        assertTrue(result.phonemeScores.isEmpty())
    }

    // ── 边界值 ──

    @Test
    fun `clamp score to 0-100 range`() {
        val json = """{"pron_accuracy": 999}""".trimIndent()
        val result = ScoreClient.parseJsonResponse(json, "x")
        assertEquals(100, result.totalScore)

        val json2 = """{"pron_accuracy": -50}""".trimIndent()
        val result2 = ScoreClient.parseJsonResponse(json2, "x")
        assertEquals(0, result2.totalScore)
    }

    @Test
    fun `missing pron_accuracy defaults to 0`() {
        val json = """{}""".trimIndent()
        val result = ScoreClient.parseJsonResponse(json, "x")
        assertEquals(0, result.totalScore)
        assertEquals("多跟读几遍", result.feedback)
    }

    @Test
    fun `phone score level thresholds`() {
        val json = """
        {
            "words": [{
                "word": "a",
                "accuracy": 50.0,
                "phone_infos": [
                    { "phone": "/a/", "accuracy": 85.0 },
                    { "phone": "/b/", "accuracy": 65.0 },
                    { "phone": "/c/", "accuracy": 40.0 }
                ]
            }]
        }
        """.trimIndent()

        val result = ScoreClient.parseJsonResponse(json, "a")
        assertEquals(3, result.phonemeScores.size)
        assertEquals(ScoreLevel.GOOD, result.phonemeScores[0].level)    // 85 >= 80
        assertEquals(ScoreLevel.OKAY, result.phonemeScores[1].level)     // 65 >= 60
        assertEquals(ScoreLevel.NEEDS_WORK, result.phonemeScores[2].level) // 40 < 60
    }

    @Test
    fun `parse float pron_accuracy`() {
        val json = """{"pron_accuracy": 85.5}""".trimIndent()
        val result = ScoreClient.parseJsonResponse(json, "x")
        assertEquals(85, result.totalScore) // 85.5 → 85 (toInt 截断)
    }

    @Test
    fun `score feedback boundaries`() {
        // 80+ → 很好
        assertEquals("读得很好！🎉", ScoreClient.parseJsonResponse("""{"pron_accuracy":80}""", "x").feedback)
        assertEquals("读得很好！🎉", ScoreClient.parseJsonResponse("""{"pron_accuracy":81}""", "x").feedback)
        // 60-79 → 不错
        assertEquals("不错，再练练！", ScoreClient.parseJsonResponse("""{"pron_accuracy":60}""", "x").feedback)
        assertEquals("不错，再练练！", ScoreClient.parseJsonResponse("""{"pron_accuracy":79}""", "x").feedback)
        // < 60 → 多跟读
        assertEquals("多跟读几遍", ScoreClient.parseJsonResponse("""{"pron_accuracy":59}""", "x").feedback)
        assertEquals("多跟读几遍", ScoreClient.parseJsonResponse("""{"pron_accuracy":0}""", "x").feedback)
    }

    // ── 可选字段缺失 ──

    @Test
    fun `missing words array yields empty lists`() {
        val json = """{"pron_accuracy": 75}""".trimIndent()
        val result = ScoreClient.parseJsonResponse(json, "hello")
        assertTrue(result.wordScores.isEmpty())
        assertTrue(result.phonemeScores.isEmpty())
    }

    @Test
    fun `word without phone_infos yields empty phonemeScores`() {
        val json = """
        {
            "words": [{
                "word": "hello",
                "accuracy": 75.0
            }]
        }
        """.trimIndent()
        val result = ScoreClient.parseJsonResponse(json, "hello")
        assertEquals(1, result.wordScores.size)
        assertTrue(result.phonemeScores.isEmpty())
    }

    @Test
    fun `word without accuracy defaults to 0`() {
        val json = """
        {
            "words": [{
                "word": "hello"
            }]
        }
        """.trimIndent()
        val result = ScoreClient.parseJsonResponse(json, "hello")
        assertEquals(1, result.wordScores.size)
        assertEquals(0.0f, result.wordScores[0].pronAccuracy, 0.001f)
    }

    // ── 异常输入 ──

    @Test
    fun `malformed json throws exception`() {
        assertThrows(SerializationException::class.java) {
            ScoreClient.parseJsonResponse("not json", "x")
        }
    }

    @Test
    fun `empty string throws exception`() {
        assertThrows(SerializationException::class.java) {
            ScoreClient.parseJsonResponse("", "x")
        }
    }
}
