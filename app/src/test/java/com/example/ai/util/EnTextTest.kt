package com.example.ai.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `EnText` 的单测 —— **期望值全部取自真实 JS 语义**（探针 `web/_echoladder_probe.mjs`
 * 照抄 `AiEnglishTalkPage.tsx` 的 `EN_WORD_RE` / `englishOnly` / `fallbackChunks`
 * 与 `EchoLadder.tsx` 的 `normWord` / `soeScene` 后 `node` 跑出来的），而非手推。
 *
 * 钉住的反直觉点（这样以后没人会"顺手修正"）：
 * - `well-known` 被切成两个词（连字符**不在**字符类里）
 * - `It’s` 的弯撇号被 `normEnWord` **删掉** → `its`；直撇号 `don't` 才保留
 * - `café` → `["caf"]`、`world4u` → `["world","u"]`（非 ASCII 字母与数字都会切断单词）
 * - `englishOnly("  你好")` = `""`（判据是首个汉字下标 `> 0`，不是 `>= 0`）
 * - `fallbackChunks("")` = `[""]`（结果为空时返回 `[sentence]`，哪怕 sentence 是空串）
 */
class EnTextTest {

    @Test
    fun `splitEnWords 按字母切词并丢掉标点数字`() {
        assertEquals(
            listOf("I", "want", "to", "go", "to", "the", "park"),
            splitEnWords("I want to go to the park."),
        )
        assertEquals(listOf("Don't", "worry", "it's", "fine"), splitEnWords("Don't worry, it's fine!"))
        assertEquals(listOf("Yes", "I", "like", "the", "park"), splitEnWords("Yes, I like the park."))
        assertEquals(listOf("Mr", "Li", "agrees"), splitEnWords("Mr. Li agrees."))
        assertEquals(listOf("ABC"), splitEnWords("ABC"))
        assertEquals(listOf("spaced", "out"), splitEnWords("  spaced   out  "))
        assertEquals(emptyList<String>(), splitEnWords("..."))
    }

    @Test
    fun `splitEnWords 支持弯撇号但不支持连字符`() {
        // 探针：splitWords("It’s a nice day") = ["It’s","a","nice","day"]
        assertEquals(listOf("It\u2019s", "a", "nice", "day"), splitEnWords("It\u2019s a nice day"))
        // 探针：splitWords("well-known place") = ["well","known","place"] —— 连字符切开
        assertEquals(listOf("well", "known", "place"), splitEnWords("well-known place"))
    }

    @Test
    fun `splitEnWords 会切碎数字与非 ASCII 字母`() {
        // 探针：hello123 world4u -> ["hello","world","u"]
        assertEquals(listOf("hello", "world", "u"), splitEnWords("hello123 world4u"))
        // 探针：café résumé -> ["caf","r","sum"]
        assertEquals(listOf("caf", "r", "sum"), splitEnWords("caf\u00e9 r\u00e9sum\u00e9"))
    }

    @Test
    fun `englishOnly 裁掉中文后缀`() {
        assertEquals("I like apples", englishOnly("I like apples \u6211\u559c\u6b22\u82f9\u679c"))
        assertEquals("Hi there", englishOnly("  Hi there  "))
        assertEquals("Hello", englishOnly("Hello \u4f60\u597d"))
        assertEquals("Hi", englishOnly("\tHi\t\u4f60\u597d"))
    }

    @Test
    fun `englishOnly 对中文开头的串不裁`() {
        // 首个汉字下标为 0 ⇒ 原样返回（只 trim）
        assertEquals("\u6211\u559c\u6b22\u82f9\u679c", englishOnly("\u6211\u559c\u6b22\u82f9\u679c"))
        // 前导空白 + 汉字：i=2>0 ⇒ slice(0,2).trim() = ""（探针实测）
        assertEquals("", englishOnly("  \u4f60\u597d"))
        assertEquals("", englishOnly(""))
    }

    @Test
    fun `normEnWord 只留 ASCII 小写字母数字与直撇号`() {
        assertEquals("park", normEnWord("Park,"))
        assertEquals("don't", normEnWord("don't"))
        // 弯撇号 U+2019 不在字符类里 ⇒ 被删掉
        assertEquals("its", normEnWord("It\u2019s"))
        assertEquals("wellknown", normEnWord("well-known"))
        assertEquals("abc", normEnWord("ABC"))
        assertEquals("apple", normEnWord("  apple "))
        assertEquals("ab", normEnWord("a-b"))
    }

    @Test
    fun `soeScene 英文按词数判句子`() {
        assertEquals("word", soeScene("apple", ENGINE_EN))
        assertEquals("sentence", soeScene("I like apples.", ENGINE_EN))
        assertEquals("sentence", soeScene("Yes, I like the park.", ENGINE_EN))
        // 空串没有词 ⇒ word（探针实测）
        assertEquals("word", soeScene("", ENGINE_EN))
        assertEquals(
            "sentence",
            soeScene("I want to go to the park and play with my friends every day after school", ENGINE_EN),
        )
    }

    @Test
    fun `soeScene 中文按汉字个数分三档`() {
        assertEquals("word", soeScene("\u597d", ENGINE_ZH))
        assertEquals("sentence", soeScene("\u597d\u7684", ENGINE_ZH))
        assertEquals(
            "sentence",
            soeScene("\u8fdc\u4e0a\u5bd2\u5c71\u77f3\u5f84\u659c\uff0c\u767d\u4e91\u751f\u5904\u6709\u4eba\u5bb6\u3002", ENGINE_ZH),
        )
        // 46 个汉字（> 30）⇒ paragraph
        assertEquals(
            "paragraph",
            soeScene(
                "\u8fdc\u4e0a\u5bd2\u5c71\u77f3\u5f84\u659c\u767d\u4e91\u751f\u5904\u6709\u4eba\u5bb6\u505c\u8f66\u5750\u7231\u67ab\u6797\u665a\u971c\u53f6\u7ea2\u4e8e\u4e8c\u6708\u82b1" +
                    "\u505c\u8f66\u5750\u7231\u67ab\u6797\u665a\u971c\u53f6\u7ea2\u4e8e\u4e8c\u6708\u82b1\u8fdc\u4e0a\u5bd2\u5c71\u77f3\u5f84\u659c",
                ENGINE_ZH,
            ),
        )
    }

    @Test
    fun `evalModeForScene 与服务端映射表逐位一致`() {
        assertEquals("0", evalModeForScene("word"))
        assertEquals("1", evalModeForScene("sentence"))
        assertEquals("2", evalModeForScene("paragraph"))
        assertEquals("8", evalModeForScene("pinyin"))
        assertEquals("", evalModeForScene(""))
        assertEquals("", evalModeForScene("unknown"))
    }

    @Test
    fun `fallbackChunks 按两三词一组且弱词不领句`() {
        assertEquals(
            listOf("I", "want to go", "to the park."),
            fallbackChunks("I want to go to the park."),
        )
        assertEquals(listOf("Yes", "I", "like the park"), fallbackChunks("Yes I like the park"))
        assertEquals(listOf("I", "like", "apples"), fallbackChunks("I like apples"))
        assertEquals(listOf("one", "two"), fallbackChunks("one two"))
        assertEquals(
            listOf("My", "name is Tom", "and I", "am", "nine", "years", "old"),
            fallbackChunks("My name is Tom and I am nine years old"),
        )
    }

    @Test
    fun `fallbackChunks 单词句与空串的退化行为`() {
        assertEquals(listOf("Hello"), fallbackChunks("Hello"))
        // 探针：fallbackChunks("") = [""] —— 结果为空时原样返回 [sentence]
        assertEquals(listOf(""), fallbackChunks(""))
    }

    @Test
    fun `splitJsWhitespace 认全角空格与 NBSP`() {
        // Kotlin 的 \s 不认这些，所以这一层替换是必要的（否则会"少切一刀"）
        assertEquals(listOf("a", "b"), splitJsWhitespace("a\u3000b"))
        assertEquals(listOf("a", "b"), splitJsWhitespace("a\u00a0b"))
        assertEquals(listOf("a", "b"), splitJsWhitespace("a\tb"))
        assertEquals(listOf("a", "b"), splitJsWhitespace("  a   b  "))
        assertEquals(emptyList<String>(), splitJsWhitespace(""))
        assertEquals(emptyList<String>(), splitJsWhitespace("   "))
    }

    @Test
    fun `soeScene 英文也认全角空格分词`() {
        // 只有一层空白替换正确，两个词才会被判成 sentence
        assertEquals("sentence", soeScene("go\u3000home", ENGINE_EN))
        assertEquals("word", soeScene("home", ENGINE_EN))
    }

    @Test
    fun `parsePracticeWords 认逗号顿号与任意空白`() {
        assertEquals(listOf("apple", "park", "happy", "run"), parsePracticeWords("apple, park, happy, run"))
        assertEquals(listOf("apple", "park"), parsePracticeWords("apple\u3001park"))
        assertEquals(listOf("apple", "park"), parsePracticeWords("apple\u3000park"))
        assertEquals(listOf("apple", "park"), parsePracticeWords("  apple ,  park  "))
        assertEquals(emptyList<String>(), parsePracticeWords("   "))
        assertEquals(emptyList<String>(), parsePracticeWords(",,,、"))
    }

    @Test
    fun `parsePracticeSentences 只按换行切`() {
        assertEquals(
            listOf("I like apples.", "Can I run in the park?"),
            parsePracticeSentences("I like apples.\nCan I run in the park?"),
        )
        // 连续换行 / 首尾空行都被丢掉；句内空格原样保留
        assertEquals(
            listOf("Hello there.", "Bye."),
            parsePracticeSentences("\n\nHello there.\n\n\n Bye. \n"),
        )
        assertEquals(emptyList<String>(), parsePracticeSentences("\n\n"))
    }

    @Test
    fun `jsTrim 覆盖 NBSP 与 BOM`() {
        // Java 的 trim/isWhitespace 都不处理这两个字符；JS 的 trim() 会去掉
        assertEquals("a", jsTrim("\u00a0a\u00a0"))
        assertEquals("a", jsTrim("\ufeffa\ufeff"))
        assertEquals("a", jsTrim("\u3000a\u3000"))
        assertEquals("", jsTrim("\u00a0\ufeff\u3000"))
        assertEquals("a b", jsTrim(" a b "))
    }
}
