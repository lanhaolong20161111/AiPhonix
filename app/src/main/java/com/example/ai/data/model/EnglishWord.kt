package com.example.ai.data.model

/** 人教版三年级上英语词汇 — 来自 english_vocabulary.json */
data class EnglishWord(
    val word: String,
    val phonetic: String,
    val meanings: List<String>,
    val emoji: String = "",
) {
    /** 首字母（小写），用于关联到字母页 */
    val firstLetter: String get() = word.first().lowercase()
}
