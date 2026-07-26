package com.example.ai.data.wordbank

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WordBank 数据模型与 Gson 反序列化测试。
 * 不依赖 Android Context，直接测试 JSON 解析逻辑。
 */
class WordBankRepositoryTest {

    private val gson = Gson()

    @Test
    fun `deserialize normal wordbank`() {
        val json = """
        {
            "version": 1,
            "chars": [
                { "text": "我", "tags": ["一年级上", "写字"], "type": "char", "pinyin": "wo3" },
                { "text": "你", "tags": ["一年级上", "写字"], "type": "char", "pinyin": "ni3" }
            ],
            "words": [
                { "text": "我们", "tags": ["一年级上", "词语"], "type": "word" }
            ]
        }
        """.trimIndent()

        val bank = gson.fromJson(json, WordBank::class.java)

        assertEquals(1, bank.version)
        assertEquals(2, bank.chars.size)
        assertEquals("我", bank.chars[0].text)
        assertEquals(listOf("一年级上", "写字"), bank.chars[0].tags)
        assertEquals("char", bank.chars[0].type)
        assertEquals("wo3", bank.chars[0].pinyin)
        assertEquals("你", bank.chars[1].text)

        assertEquals(1, bank.words.size)
        assertEquals("我们", bank.words[0].text)

        assertEquals(3, bank.allEntries().size)
    }

    @Test
    fun `deserialize with missing pinyin defaults to empty`() {
        val json = """
        {
            "version": 1,
            "chars": [
                { "text": "山", "tags": ["一年级上"], "type": "char" }
            ],
            "words": []
        }
        """.trimIndent()

        val bank = gson.fromJson(json, WordBank::class.java)
        assertEquals(null, bank.chars[0].pinyin)
    }

    @Test
    fun `deserialize empty wordbank`() {
        val json = """
        {
            "version": 1,
            "chars": [],
            "words": []
        }
        """.trimIndent()

        val bank = gson.fromJson(json, WordBank::class.java)
        assertTrue(bank.chars.isEmpty())
        assertTrue(bank.words.isEmpty())
        assertTrue(bank.allEntries().isEmpty())
    }

    @Test
    fun `entry can have multiple tags`() {
        val json = """
        {
            "version": 1,
            "chars": [
                { "text": "长", "tags": ["二年级上", "写字", "多音字"], "type": "char", "pinyin": "chang2" }
            ],
            "words": []
        }
        """.trimIndent()

        val bank = gson.fromJson(json, WordBank::class.java)
        val entry = bank.chars[0]
        assertTrue(entry.tags.contains("二年级上"))
        assertTrue(entry.tags.contains("写字"))
        assertTrue(entry.tags.contains("多音字"))
        assertEquals(3, entry.tags.size)
    }

    @Test
    fun `entry with empty tags list`() {
        val json = """
        {
            "version": 1,
            "chars": [
                { "text": "测", "tags": [], "type": "char" }
            ],
            "words": []
        }
        """.trimIndent()

        val bank = gson.fromJson(json, WordBank::class.java)
        assertTrue(bank.chars[0].tags.isEmpty())
    }
}
