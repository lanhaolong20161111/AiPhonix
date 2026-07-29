package com.example.ai.data.repository

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/**
 * 验证 wordbank.json 中所有单词的音素拆分是否符合 48 音标规则。
 *
 * 检查项：
 * 1. 每个音素都在 48 音标合法集合中
 * 2. 音素拼接后能还原 IPA（圆括号 r 容差）
 * 3. 无空音素列表
 * 4. 无重复单词
 * 5. letter 字段与单词首字母一致
 */
class WordPhonemeRulesTest {

    private val json = Json { ignoreUnknownKeys = true }

    /** 48 音标合法集合（与 app 内 phonemes 表一致） */
    private val validPhonemes = setOf(
        // 单元音
        "iː", "ɪ", "e", "æ", "ɜː", "ə", "ʌ", "ɔː", "ɒ", "ʊ", "uː", "ɑː",
        // 双元音
        "aɪ", "aʊ", "ɔɪ", "eɪ", "əʊ", "ɪə", "eə", "ʊə",
        // 辅音（单个）
        "p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ",
        "h", "m", "n", "ŋ", "l", "r", "w", "j",
        // 辅音组合
        "tʃ", "dʒ", "tr", "dr", "ts", "dz",
    )

    @Test
    fun `所有音素均来自 48 音标合法集合`() {
        val words = loadAllWords()
        val errors = mutableListOf<String>()

        for (word in words) {
            for ((i, ph) in word.phonemes.withIndex()) {
                if (ph !in validPhonemes) {
                    errors += "${word.text}[$i]=\"$ph\" 不在 48 音标集合中"
                }
            }
        }

        assertTrue(
            "非法音素 (${errors.size}):\n  ${errors.joinToString("\n  ")}",
            errors.isEmpty()
        )
    }

    @Test
    fun `phonemes reconstruct the IPA`() {
        val words = loadAllWords()
        val errors = mutableListOf<String>()

        for (word in words) {
            val cleaned = word.ipa
                .trim('/')
                .replace("ˈ", "")  // 主重音
                .replace("ˌ", "")  // 次重音
                .replace(".", "")  // 音节分隔
                .replace("(", "")
                .replace(")", "")
            val reconstructed = word.phonemes.joinToString("")

            // 归一化 AmE→BrE 后对比（IPA 可能用美式符号但音素用英式）
            val normIpa = normalizeForCompare(cleaned)
            val normPhonemes = normalizeForCompare(reconstructed)

            if (normIpa != normPhonemes) {
                errors += "${word.text}: IPA=\"${cleaned}\" ≠ 拼接=\"${reconstructed}\""
            }
        }

        assertTrue(
            "IPA 还原错误 (${errors.size}):\n  ${errors.joinToString("\n  ")}",
            errors.isEmpty()
        )
    }

    @Test
    fun `所有单词都有非空音素列表`() {
        val words = loadAllWords()
        val empty = words.filter { it.phonemes.isEmpty() }
        assertTrue(
            "以下单词音素列表为空: ${empty.joinToString { it.text }}",
            empty.isEmpty()
        )
    }

    @Test
    fun `无重复单词`() {
        val words = loadAllWords()
        val texts = words.map { it.text.lowercase() }
        val grouped = texts.groupingBy { it }.eachCount()
        val duplicates = grouped.filter { it.value > 1 }
        assertTrue(
            "发现重复单词: $duplicates",
            duplicates.isEmpty()
        )
    }

    @Test
    fun `letter 字段与单词首字母一致`() {
        val words = loadAllWords()
        val errors = mutableListOf<String>()

        for (word in words) {
            val expectedLetter = word.text.first().lowercase()
            if (word.letter != expectedLetter) {
                errors += "${word.text}: letter=\"${word.letter}\" ≠ 首字母=\"$expectedLetter\""
            }
        }

        assertTrue(
            "letter 不匹配 (${errors.size}):\n  ${errors.joinToString("\n  ")}",
            errors.isEmpty()
        )
    }

    /** 归一化 IPA 符号用于对比：AmE→BrE + 去除 r 差异 */
    private fun normalizeForCompare(s: String): String {
        return s
            .replace("oʊ", "əʊ")      // goat, nose, yellow
            .replace("ɝ", "ɜː")        // American r-colored vowel
            .replace("r", "")          // 容忍 (r) 差异
            .replace("i", "ɪ")         // 词尾 i (U+0069) → ɪ
    }

    // ---------- 辅助 ----------

    private fun loadAllWords(): List<Word> {
        // Try multiple paths to find wordbank.json
        val cwd = System.getProperty("user.dir")
        val candidates = listOf(
            File("app/src/main/assets/wordbank.json"),
            File(cwd, "app/src/main/assets/wordbank.json"),
            File(cwd, "../app/src/main/assets/wordbank.json"),
            File(cwd, "src/main/assets/wordbank.json"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("wordbank.json not found (cwd=$cwd, tried=${candidates.map { it.path }})")

        val data = file.readText(Charsets.UTF_8)
        return json.decodeFromString<WordbankData>(data).words
    }

    @Serializable
    private data class WordbankData(
        val words: List<Word> = emptyList(),
    )

    @Serializable
    private data class Word(
        val text: String,
        val ipa: String,
        val letter: String,
        val phonemes: List<String>,
    )
}
