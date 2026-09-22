package com.example.ai.data.phonics

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `PhonicsSegmenter` 的对拍单测 —— 期望值全部来自 web 真实现（`web/_phonics_probe.ts`
 * 用 `tsx` 跑 `segmentPhonics` 产出的 JSON），反向锁死 Android 移植与 web 逐位一致。
 *
 * 覆盖：七类 PhonicType、magic-e 顺序 bug（house/plelase/choose）、软音标记（-tion）、
 * 屈折 e（wanted）、成音节 l（table/apple）、不发音字母（knight/lamb/walk/tongue）、
 * 例外词表（have/people/said）、大小写还原（English）、撇号（don't）。
 */
class PhonicsSegmenterTest {

    private fun seg(word: String): List<Pair<String, PhonicType>> =
        segmentPhonics(word).map { it.text to it.type }

    private fun c(word: String, vararg chunks: Pair<String, PhonicType>) {
        assertEquals("word=$word", chunks.toList(), seg(word))
        // 块拼起来必须恰好等于原词（着色不丢字符）
        assertEquals("roundtrip=$word", word, joinPhonics(segmentPhonics(word)))
    }

    @Test
    fun basic_short_vowel() {
        c("cat", "c" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_SINGLE, "t" to PhonicType.CONSONANT)
        c("dog", "d" to PhonicType.CONSONANT, "o" to PhonicType.VOWEL_SINGLE, "g" to PhonicType.CONSONANT)
    }

    @Test
    fun magic_e_and_order_bug() {
        // magic-e：尾 e 不发音，前面元音升长音
        c("cake", "c" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_LONG, "k" to PhonicType.CONSONANT, "e" to PhonicType.SILENT)
        // 顺序 bug：ou/ea/oo 已接管时，magic-e 不得把 u/a/o 升长音（曾误拆成两块）
        c("house", "h" to PhonicType.CONSONANT, "ou" to PhonicType.VOWEL_TEAM, "s" to PhonicType.CONSONANT, "e" to PhonicType.SILENT)
        c("please", "pl" to PhonicType.CONSONANT, "ea" to PhonicType.VOWEL_LONG, "s" to PhonicType.CONSONANT, "e" to PhonicType.SILENT)
        c("choose", "ch" to PhonicType.DIGRAPH, "oo" to PhonicType.VOWEL_TEAM, "s" to PhonicType.CONSONANT, "e" to PhonicType.SILENT)
    }

    @Test
    fun digraph_and_vowel_teams() {
        c("ship", "sh" to PhonicType.DIGRAPH, "i" to PhonicType.VOWEL_SINGLE, "p" to PhonicType.CONSONANT)
        c("book", "b" to PhonicType.CONSONANT, "oo" to PhonicType.VOWEL_TEAM, "k" to PhonicType.CONSONANT)
        c("car", "c" to PhonicType.CONSONANT, "ar" to PhonicType.VOWEL_TEAM)
        c("school", "s" to PhonicType.CONSONANT, "ch" to PhonicType.DIGRAPH, "oo" to PhonicType.VOWEL_TEAM, "l" to PhonicType.CONSONANT)
        c("tree", "tr" to PhonicType.CONSONANT, "ee" to PhonicType.VOWEL_LONG)
        c("blue", "bl" to PhonicType.CONSONANT, "ue" to PhonicType.VOWEL_LONG)
        c("thought", "th" to PhonicType.DIGRAPH, "ou" to PhonicType.VOWEL_TEAM, "gh" to PhonicType.DIGRAPH, "t" to PhonicType.CONSONANT)
        c("queen", "qu" to PhonicType.DIGRAPH, "ee" to PhonicType.VOWEL_LONG, "n" to PhonicType.CONSONANT)
        c("rain", "r" to PhonicType.CONSONANT, "ai" to PhonicType.VOWEL_LONG, "n" to PhonicType.CONSONANT)
    }

    @Test
    fun syllabic_l() {
        c("table", "t" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_SINGLE, "b" to PhonicType.CONSONANT, "le" to PhonicType.VOWEL_TEAM)
        c("apple", "a" to PhonicType.VOWEL_SINGLE, "pp" to PhonicType.DIGRAPH, "le" to PhonicType.VOWEL_TEAM)
    }

    @Test
    fun silent_letters() {
        c("knight", "k" to PhonicType.SILENT, "n" to PhonicType.CONSONANT, "igh" to PhonicType.VOWEL_LONG, "t" to PhonicType.CONSONANT)
        c("knife", "k" to PhonicType.SILENT, "n" to PhonicType.CONSONANT, "i" to PhonicType.VOWEL_LONG, "f" to PhonicType.CONSONANT, "e" to PhonicType.SILENT)
        c("lamb", "l" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_SINGLE, "m" to PhonicType.CONSONANT, "b" to PhonicType.SILENT)
        c("walk", "w" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_LONG, "l" to PhonicType.SILENT, "k" to PhonicType.CONSONANT)
        c("sign", "s" to PhonicType.CONSONANT, "i" to PhonicType.VOWEL_SINGLE, "g" to PhonicType.SILENT, "n" to PhonicType.CONSONANT)
        c("tongue", "t" to PhonicType.CONSONANT, "o" to PhonicType.VOWEL_SINGLE, "ng" to PhonicType.DIGRAPH, "u" to PhonicType.SILENT, "e" to PhonicType.SILENT)
        c("guard", "g" to PhonicType.CONSONANT, "u" to PhonicType.SILENT, "ar" to PhonicType.VOWEL_TEAM, "d" to PhonicType.CONSONANT)
        c("hour", "h" to PhonicType.SILENT, "ou" to PhonicType.VOWEL_TEAM, "r" to PhonicType.VOWEL_TEAM)
        c("who", "wh" to PhonicType.DIGRAPH, "o" to PhonicType.VOWEL_SINGLE)
    }

    @Test
    fun soft_io_and_inflection_e() {
        // -tion 的 ti 读 /ʃ/
        c("nation", "n" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_LONG, "ti" to PhonicType.DIGRAPH, "o" to PhonicType.VOWEL_SINGLE, "n" to PhonicType.CONSONANT)
        // -ed 在 t/d 后，e 是真元音（wanted/ɪd/）
        c("wanted", "w" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_SINGLE, "nt" to PhonicType.CONSONANT, "e" to PhonicType.VOWEL_SINGLE, "d" to PhonicType.CONSONANT)
        c("boxes", "b" to PhonicType.CONSONANT, "o" to PhonicType.VOWEL_SINGLE, "x" to PhonicType.CONSONANT, "e" to PhonicType.VOWEL_SINGLE, "s" to PhonicType.CONSONANT)
    }

    @Test
    fun exceptions_and_y_and_case() {
        // 例外词表（规则会判错）
        c("have", "h" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_SINGLE, "v" to PhonicType.CONSONANT, "e" to PhonicType.SILENT)
        c("people", "p" to PhonicType.CONSONANT, "eo" to PhonicType.VOWEL_TEAM, "p" to PhonicType.CONSONANT, "le" to PhonicType.VOWEL_TEAM)
        c("said", "s" to PhonicType.CONSONANT, "ai" to PhonicType.VOWEL_TEAM, "d" to PhonicType.CONSONANT)
        c("one", "o" to PhonicType.VOWEL_SINGLE, "n" to PhonicType.CONSONANT, "e" to PhonicType.SILENT)
        c("busy", "b" to PhonicType.CONSONANT, "u" to PhonicType.VOWEL_SINGLE, "s" to PhonicType.CONSONANT, "y" to PhonicType.VOWEL_SINGLE)
        c("beautiful", "b" to PhonicType.CONSONANT, "eau" to PhonicType.VOWEL_TEAM, "t" to PhonicType.CONSONANT, "i" to PhonicType.VOWEL_SINGLE, "f" to PhonicType.CONSONANT, "ul" to PhonicType.VOWEL_TEAM)
        // 尾 y 当元音
        c("happy", "h" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_SINGLE, "pp" to PhonicType.DIGRAPH, "y" to PhonicType.VOWEL_SINGLE)
        c("myth", "m" to PhonicType.CONSONANT, "y" to PhonicType.VOWEL_SINGLE, "th" to PhonicType.DIGRAPH)
        c("trying", "tr" to PhonicType.CONSONANT, "y" to PhonicType.VOWEL_SINGLE, "i" to PhonicType.VOWEL_SINGLE, "ng" to PhonicType.DIGRAPH)
        c("playing", "pl" to PhonicType.CONSONANT, "a" to PhonicType.VOWEL_SINGLE, "y" to PhonicType.VOWEL_SINGLE, "i" to PhonicType.VOWEL_SINGLE, "ng" to PhonicType.DIGRAPH)
        // 大小写还原（E 应保留大写）
        c("English", "E" to PhonicType.VOWEL_SINGLE, "ng" to PhonicType.DIGRAPH, "l" to PhonicType.CONSONANT, "i" to PhonicType.VOWEL_SINGLE, "sh" to PhonicType.DIGRAPH)
        // 撇号 → other
        c("don't", "d" to PhonicType.CONSONANT, "o" to PhonicType.VOWEL_SINGLE, "n" to PhonicType.CONSONANT, "'" to PhonicType.OTHER, "t" to PhonicType.CONSONANT)
        // 双写辅音并入 digraph
        c("running", "r" to PhonicType.CONSONANT, "u" to PhonicType.VOWEL_SINGLE, "nn" to PhonicType.DIGRAPH, "i" to PhonicType.VOWEL_SINGLE, "ng" to PhonicType.DIGRAPH)
        c("addresses", "a" to PhonicType.VOWEL_SINGLE, "dd" to PhonicType.DIGRAPH, "r" to PhonicType.CONSONANT, "e" to PhonicType.VOWEL_SINGLE, "ss" to PhonicType.DIGRAPH, "e" to PhonicType.VOWEL_SINGLE, "s" to PhonicType.CONSONANT)
        c("yelling", "y" to PhonicType.CONSONANT, "e" to PhonicType.VOWEL_SINGLE, "ll" to PhonicType.DIGRAPH, "i" to PhonicType.VOWEL_SINGLE, "ng" to PhonicType.DIGRAPH)
    }

    @Test
    fun exception_table_count_and_isEnglishWord() {
        assertEquals(66, POLYPHONE_EXCEPTIONS.size)
        assertEquals(true, isEnglishWord("cat"))
        assertEquals(true, isEnglishWord("don't"))
        assertEquals(true, isEnglishWord("blue-gray"))
        assertEquals(true, isEnglishWord("English"))
        assertEquals(false, isEnglishWord("苹果"))
        assertEquals(false, isEnglishWord("a1"))
        assertEquals(false, isEnglishWord(""))
    }
}
