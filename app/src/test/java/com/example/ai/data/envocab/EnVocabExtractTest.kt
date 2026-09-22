package com.example.ai.data.envocab

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [EnVocabExtract] 的单测。
 *
 * ★ 全部期望值**不是按语义推导的**，而是把 web 的 `web/src/lib/enVocabExtract.ts` 原样复制到
 * node 里跑出来的（探针 `web/_envocab_probe.mjs`，编号与下面一一对应）。
 * 目的就是钉住那些"看代码看不出来"的行为：小数点位序剥离吃整数、`Mr.` 照样切句、
 * 无元音短词被剔除……这些都是"顺手修好"就会与 web 分叉的地方。
 */
class EnVocabExtractTest {

    // ── normalizeOcrText ──

    @Test
    fun `normalize 全角转半角`() {
        assertEquals("ABC 123,x?", EnVocabExtract.normalizeOcrText("ＡＢＣ　１２３，ｘ？"))
    }

    @Test
    fun `normalize 换行统一`() {
        assertEquals("a\nb\nc", EnVocabExtract.normalizeOcrText("a\r\nb\rc"))
    }

    @Test
    fun `normalize 弯引号转直引号`() {
        assertEquals("don't \"ok\"", EnVocabExtract.normalizeOcrText("don\u2018t \u201cok\u201d"))
    }

    @Test
    fun `normalize 连字拆开`() {
        assertEquals("fish flower", EnVocabExtract.normalizeOcrText("\ufb01sh \ufb02ower"))
    }

    @Test
    fun `normalize 控制字符转空格`() {
        assertEquals("a b c", EnVocabExtract.normalizeOcrText("a\u0001b\u000bc"))
    }

    @Test
    fun `normalize 不换行空格与全角空格`() {
        assertEquals("a b c", EnVocabExtract.normalizeOcrText("a\u00a0b\u3000c"))
    }

    // ── cleanSentence ──

    @Test
    fun `cleanSentence 各种边界`() {
        assertEquals("It is.", EnVocabExtract.cleanSentence("It is."))                       // 1
        assertEquals("Go up!", EnVocabExtract.cleanSentence("Go up!"))                        // 2
        assertEquals("", EnVocabExtract.cleanSentence("apple banana orange"))                 // 3 无句末标点且 <4 词
        assertEquals("apple banana orange pear", EnVocabExtract.cleanSentence("apple banana orange pear")) // 4
        assertEquals("", EnVocabExtract.cleanSentence("Unit 3 My Family"))                    // 5 版面标题
        assertEquals("", EnVocabExtract.cleanSentence("Let's read."))                         // 6
        assertEquals("I like apples.", EnVocabExtract.cleanSentence("1. I like apples."))      // 7 行首序号
        assertEquals("She is happy.", EnVocabExtract.cleanSentence("2) She is happy."))        // 8
        assertEquals("", EnVocabExtract.cleanSentence("Hello ."))                             // 9 只剩 1 个词
        assertEquals("apple is red.", EnVocabExtract.cleanSentence("apple 苹果 is red."))       // 10 去中文
        assertEquals("a b c d", EnVocabExtract.cleanSentence("a * b # c | d"))                // 11 去排版符
        assertEquals("", EnVocabExtract.cleanSentence("Hello world -"))                       // 12
        assertEquals("Hello world.", EnVocabExtract.cleanSentence("-- Hello world."))          // 13 去行首杂符
        assertEquals("", EnVocabExtract.cleanSentence("apple"))                               // 14 单字
        assertEquals("", EnVocabExtract.cleanSentence("Read and write."))                     // 15 教材指令
        assertEquals("Read a book.", EnVocabExtract.cleanSentence("Read a book."))             // 16 ★ 单独 read 不算指令
        assertEquals("Hello there.", EnVocabExtract.cleanSentence("\"Hello there.\""))         // 17 去引号
        // ★★ 18：行首序号剥离 `^[\s\d]+[.)、]` 会吃掉小数点的整数部分（web 真行为）
        assertEquals("5 apples and 2 pears.", EnVocabExtract.cleanSentence("3.5 apples and 2 pears."))
        assertEquals("", EnVocabExtract.cleanSentence("Hi_there friend"))                     // 19 下划线断开后 3 词无句末标点
    }

    // ── splitRawSentences（经 extractEnglishVocab 的 sentences 观察） ──

    @Test
    fun `切句 小数点不切`() {
        // 若在 3.5 处切，会得到 ["Price is 3."]（5 dollars. 只有 1 个词会被丢掉）
        assertEquals(
            listOf("Price is 3.5 dollars."),
            EnVocabExtract.extractEnglishVocab("Price is 3.5 dollars. OK?").sentences,
        )
    }

    @Test
    fun `切句 缩写只挡点号紧跟字母`() {
        // ★ Mr. 后面是空格 ⇒ 照样切；切出来的 "Mr." 只有 1 个词，又被 cleanSentence 丢掉 ⇒ 净效果是没了
        assertEquals(
            listOf("Smith is here."),
            EnVocabExtract.extractEnglishVocab("Mr. Smith is here. Nice.").sentences,
        )
        // U.S. 中间那个点后面紧跟 S ⇒ 不切；拼成的 "U.S." 只有 2 个字母 <4 ⇒ 被丢
        assertEquals(
            listOf("map is big."),
            EnVocabExtract.extractEnglishVocab("U.S. map is big. Yes.").sentences,
        )
    }

    @Test
    fun `切句 中文句末标点也切`() {
        assertEquals(
            listOf("Hello there."),
            EnVocabExtract.extractEnglishVocab("你好。Hello there. 再见！").sentences,
        )
    }

    @Test
    fun `切句 换行断句与省略号`() {
        // "apple banana" / "orange pear" 都只有 2 词且无句末标点 ⇒ 不进句子（但会进单词）
        val v = EnVocabExtract.extractEnglishVocab("apple banana\norange pear")
        assertEquals(emptyList<String>(), v.sentences)
        assertEquals(listOf("apple", "banana", "orange", "pear"), v.words)
        // 省略号也当句末标点，两侧都被切出来且都只有 1 个词 ⇒ 空
        assertEquals(emptyList<String>(), EnVocabExtract.extractEnglishVocab("Wait\u2026 really?").sentences)
    }

    // ── extractWords ──

    @Test
    fun `抽词 大小写归一`() {
        assertEquals(listOf("apple"), EnVocabExtract.extractWords("Apple apple APPLE"))          // 20
    }

    @Test
    fun `抽词 默认剔虚词且可开关`() {
        assertEquals(listOf("apple", "pear"), EnVocabExtract.extractWords("the apple and a pear"))       // 21
        assertEquals(listOf("the", "apple", "and", "pear"), EnVocabExtract.extractWords("the apple and a pear", true)) // 22
    }

    @Test
    fun `抽词 句首大写回落小写`() {
        assertEquals(listOf("look", "new", "day"), EnVocabExtract.extractWords("Look at this. New day.")) // 23
    }

    @Test
    fun `抽词 专有名词只在句中大写才算`() {
        // Tom 只出现在句首 ⇒ 回落小写
        assertEquals(listOf("tom", "runs"), EnVocabExtract.extractWords("Tom is here. Tom runs."))       // 24
        assertEquals(listOf("tom", "runs", "fast"), EnVocabExtract.extractWords("Tom runs fast"))        // 25
    }

    @Test
    fun `抽词 剔除无元音短词`() {
        assertEquals(listOf("cat"), EnVocabExtract.extractWords("TV mm qq cat"))                 // 26
    }

    @Test
    fun `抽词 保留连字符内部`() {
        assertEquals(listOf("well-known", "ice-cream"), EnVocabExtract.extractWords("well-known ice-cream")) // 27
        assertEquals(listOf("apple", "banana"), EnVocabExtract.extractWords("-apple- 'banana'"))  // 28 两端剥 - 与 '
    }

    @Test
    fun `抽词 单字母词不进表`() {
        assertEquals(emptyList<String>(), EnVocabExtract.extractWords("a I b x"))                 // 29
    }

    @Test
    fun `抽词 混合大小写`() {
        // my 是虚词；Father 在第二句以 father 出现 ⇒ 用 bucket 里的小写形态
        assertEquals(listOf("father", "teacher", "works"), EnVocabExtract.extractWords("My Father is a teacher. my father works.")) // 30
    }

    // ── extractEnglishVocab ──

    private val page1 = "Unit 3 My Family\nRead and write.\n" +
        "My father is a teacher. He is kind.\n" +
        "apple banana orange pear\n" +
        "I like apples. Can I run in the park?"

    @Test
    fun `整页抽词 默认`() {
        val v = EnVocabExtract.extractEnglishVocab(page1)                                        // 31
        assertEquals(
            listOf("father", "teacher", "kind", "apple", "banana", "orange", "pear", "like", "apples", "run", "park"),
            v.words,
        )
        assertEquals(
            listOf("My father is a teacher.", "He is kind.", "apple banana orange pear", "I like apples.", "Can I run in the park?"),
            v.sentences,
        )
        assertEquals(false, v.wordsTruncated)
        assertEquals(false, v.sentencesTruncated)
    }

    @Test
    fun `整页抽词 保留虚词`() {
        val v = EnVocabExtract.extractEnglishVocab(page1, keepStop = true)                        // 32
        assertEquals(
            listOf("my", "father", "is", "teacher", "he", "kind", "apple", "banana", "orange", "pear", "like", "apples", "can", "run", "in", "the", "park"),
            v.words,
        )
        // 句子不受 keepStop 影响
        assertEquals(EnVocabExtract.extractEnglishVocab(page1).sentences, v.sentences)
    }

    @Test
    fun `整页抽词 空文本`() {
        assertEquals(EnVocab(), EnVocabExtract.extractEnglishVocab("   "))                        // 33
    }

    @Test
    fun `整页抽词 全是虚词时兜底不过滤`() {
        val v = EnVocabExtract.extractEnglishVocab("the a an is are of to in")                     // 34
        assertEquals(listOf("the", "an", "is", "are", "of", "to", "in"), v.words)                  // a 是单字母 ⇒ 永不出现
        assertEquals(listOf("the a an is are of to in"), v.sentences)
    }

    @Test
    fun `整页抽词 单词上限截断`() {
        // ★ 注意 "aa bb cc dd ee" 里 bb/cc/dd 是无元音短词 ⇒ 只剩 aa、ee ⇒ 这里其实没触发截断
        val v = EnVocabExtract.extractEnglishVocab("aa bb cc dd ee", maxWords = 3)                  // 35
        assertEquals(listOf("aa", "ee"), v.words)
        assertEquals(false, v.wordsTruncated)

        val v2 = EnVocabExtract.extractEnglishVocab("apple bear crane duck", maxWords = 2)
        assertEquals(listOf("apple", "bear"), v2.words)
        assertEquals(true, v2.wordsTruncated)
    }

    @Test
    fun `整页抽词 句子上限截断`() {
        val v = EnVocabExtract.extractEnglishVocab("One is here. Two is here. Three is here.", maxSentences = 2) // 36
        assertEquals(listOf("one", "two", "three"), v.words)
        assertEquals(listOf("One is here.", "Two is here."), v.sentences)
        assertEquals(true, v.sentencesTruncated)
    }

    @Test
    fun `整页抽词 句子去重忽略标点与大小写`() {
        val v = EnVocabExtract.extractEnglishVocab("Hello there. hello THERE!")                     // 37
        assertEquals(listOf("Hello there."), v.sentences)
        assertEquals(listOf("hello"), v.words)
    }

    @Test
    fun `整页抽词 全角识别结果`() {
        val v = EnVocabExtract.extractEnglishVocab("Ｉ ｌｉｋｅ ａｐｐｌｅｓ．")                    // 38
        assertEquals(listOf("like", "apples"), v.words)   // I 是单字母
        assertEquals(listOf("I like apples."), v.sentences)
    }
}
