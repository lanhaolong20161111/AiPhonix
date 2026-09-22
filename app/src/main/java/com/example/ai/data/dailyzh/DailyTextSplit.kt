package com.example.ai.data.dailyzh

/**
 * JS 的 `\s` **不等于** Java/Kotlin 的 `\s`。
 *
 * - JS `\s`：`[ \t\n\v\f\r\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]`
 * - Java `\s`：默认只认 `[ \t\n\x0B\f\r]`（`UNICODE_CHARACTER_CLASS` 未开时）
 *
 * 中文输入法极易打出**全角空格 U+3000**，粘贴的文本常带 **NBSP U+00A0 / BOM U+FEFF**。
 * 若直接照抄 web 的 `\s` 到 Kotlin，这些都会**少切一刀**（实测：web `splitText("日\u3000月")` → `["日","月"]`）。
 * 故这里显式把 JS 的空白集补齐。
 */
private const val JS_SPACE = "\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

/** JS `String.prototype.trim()` 的等价物（Kotlin `trim()` 不含 U+FEFF） */
private fun jsTrim(s: String): String = s.trim { it.isWhitespace() || it == '\uFEFF' }

/**
 * 每日一练的文本切分 —— 与 web **逐字同口径**。
 *
 * 期望值全部取自 web 真实实现（探针从 `DailyChinesePage.tsx` / `DailyEnglishPage.tsx` /
 * `SentencePracticePage.tsx` **抽出源码原文**后用 `npx tsx` 求值），见
 * `app/src/test/.../data/dailyzh/DailyTextSplitTest.kt`。
 *
 * 三套口径确实**不一样**，不要合并：
 * - [chars] / [words]：`[,，、;\s]+`（web 里两者实现完全相同，各留一个名字表达语义）
 * - [sentences]：`[;；\n]+` —— 「每日英语」用的口径（逗号不算分隔）
 * - [todaySentences]：换行一次或多次，或「句号/分号之后的一段空白」—— 「造句练习」的今日句型列表
 *   （分隔符是**零宽**的：句号/分号**留在上一段末尾**，实测 `"；"` 会附着在前一段结尾）
 */
object DailyTextSplit {

    private val PUNCT_OR_SPACE = Regex("[,，、;$JS_SPACE]+")
    private val SEMICOLON_OR_NEWLINE = Regex("[;；\n]+")
    private val NEWLINE_OR_SENTENCE_END = Regex("\n+|(?<=[。；;])[$JS_SPACE]*")

    /** 「每日语文」的 chars / words / sentences 统计口径（web `splitText`） */
    fun chars(s: String): List<String> = split(PUNCT_OR_SPACE, s)

    /** 「每日英语」的单词列表（web `splitWords`，与 [chars] 同实现） */
    fun words(s: String): List<String> = split(PUNCT_OR_SPACE, s)

    /** 「每日英语」的句子列表（web `splitSentences`） */
    fun sentences(s: String): List<String> = split(SEMICOLON_OR_NEWLINE, s)

    /** 「造句练习」的今日句型列表（web `SentencePracticePage.todaySentences`） */
    fun todaySentences(s: String): List<String> = split(NEWLINE_OR_SENTENCE_END, s)

    /** 与 web 相同的后处理：`split` → `map(trim)` → `filter(Boolean)` */
    private fun split(re: Regex, s: String): List<String> =
        re.split(s).map(::jsTrim).filter { it.isNotEmpty() }
}
