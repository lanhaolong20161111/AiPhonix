package com.example.ai.data.wordbank

import com.example.ai.data.userimport.UserImportItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * mergeUserEntries 合并逻辑测试（纯 JVM，无 Android 依赖）。
 */
class UserImportMergeTest {

    private val innerChars = listOf(
        WordBankEntry("春", listOf("二年级下", "识字", "写字"), "char", "chun1"),
        WordBankEntry("花", listOf("二年级下", "识字", "写字"), "char", "hua1"),
    )
    private val innerWords = listOf(
        WordBankEntry("春天", listOf("二年级下", "词语"), "word"),
    )

    private fun charItem(
        text: String,
        pinyin: String = "",
        tags: List<String> = emptyList(),
        status: String = "active",
    ) = UserImportItem(id = "id-$text", kind = "char", text = text, pinyin = pinyin, tags = tags, status = status)

    private fun wordItem(
        text: String,
        tags: List<String> = emptyList(),
        status: String = "active",
    ) = UserImportItem(id = "id-$text", kind = "word", text = text, tags = tags, status = status)

    @Test
    fun `empty user items returns inner list unchanged`() {
        val result = mergeUserEntries(innerChars, emptyList(), "char", listOf("识字", "写字"))
        assertEquals(innerChars, result)
    }

    @Test
    fun `char item gets 识字 and 写字 tags and keeps pinyin`() {
        val result = mergeUserEntries(
            innerChars,
            listOf(charItem("夏", pinyin = "xia4", tags = listOf("二年级下"))),
            "char",
            listOf("识字", "写字"),
        )
        assertEquals(3, result.size)
        val xia = result.first { it.text == "夏" }
        assertEquals("char", xia.type)
        assertEquals("xia4", xia.pinyin)
        assertEquals(listOf("二年级下", "识字", "写字"), xia.tags)
    }

    @Test
    fun `existing inner tags not duplicated`() {
        val result = mergeUserEntries(
            innerChars,
            listOf(charItem("夏", tags = listOf("二年级下", "识字"))),
            "char",
            listOf("识字", "写字"),
        )
        val xia = result.first { it.text == "夏" }
        assertEquals(listOf("二年级下", "识字", "写字"), xia.tags)
    }

    @Test
    fun `duplicate text with inner entries is skipped`() {
        // "春" 已在内置词库，用户导入的同 text char 应被跳过
        val result = mergeUserEntries(
            innerChars,
            listOf(charItem("春", pinyin = "chun1")),
            "char",
            listOf("识字", "写字"),
        )
        assertEquals(2, result.size)
        assertTrue(result.none { it.text == "春" && it.pinyin.isEmpty() && it.tags.contains("识字") })
        // 内置的春仍在
        assertEquals(1, result.count { it.text == "春" })
    }

    @Test
    fun `word item gets 词语 tag and word type`() {
        val result = mergeUserEntries(
            innerWords,
            listOf(wordItem("阳光", tags = listOf("二年级下"))),
            "word",
            listOf("词语"),
        )
        assertEquals(2, result.size)
        val yang = result.first { it.text == "阳光" }
        assertEquals("word", yang.type)
        assertEquals(listOf("二年级下", "词语"), yang.tags)
    }

    @Test
    fun `non char kinds are filtered out`() {
        val article = UserImportItem(id = "a1", kind = "article", text = "春天来了")
        val sentence = UserImportItem(id = "s1", kind = "sentence", text = "春天来了。")
        val result = mergeUserEntries(
            innerChars,
            listOf(charItem("夏"), article, sentence),
            "char",
            listOf("识字", "写字"),
        )
        assertEquals(3, result.size) // 内置2 + 用户"夏"，article/sentence 不进来
        assertTrue(result.none { it.text == "春天来了" })
    }

    @Test
    fun `inactive items are skipped`() {
        val result = mergeUserEntries(
            innerChars,
            listOf(charItem("夏"), charItem("秋", status = "deleted")),
            "char",
            listOf("识字", "写字"),
        )
        assertEquals(3, result.size)
        assertTrue(result.none { it.text == "秋" })
    }

    @Test
    fun `blank text items are skipped`() {
        val blank = charItem("   ")
        val result = mergeUserEntries(
            innerChars,
            listOf(blank, charItem("夏")),
            "char",
            listOf("识字", "写字"),
        )
        assertEquals(3, result.size)
        assertTrue(result.none { it.text.isBlank() })
    }

    @Test
    fun `duplicate user items deduped`() {
        val result = mergeUserEntries(
            innerChars,
            listOf(charItem("夏"), charItem("夏")),
            "char",
            listOf("识字", "写字"),
        )
        assertEquals(3, result.size)
        assertEquals(1, result.count { it.text == "夏" })
    }
}
