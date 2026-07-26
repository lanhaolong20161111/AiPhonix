package com.example.ai.data.wordbank

import com.google.gson.annotations.SerializedName

/**
 * 字/词条，支持重叠标签（如 ["二年级上","写字"]）
 */
data class WordBankEntry(
    @SerializedName("text") val text: String,
    @SerializedName("tags") val tags: List<String>,
    @SerializedName("type") val type: String,  // "char" | "word"
    @SerializedName("pinyin") val pinyin: String = ""  // 拼音（带声调数字）
)

/**
 * 整个词库的顶层结构
 */
data class WordBank(
    @SerializedName("version") val version: Int,
    @SerializedName("chars") val chars: List<WordBankEntry>,
    @SerializedName("words") val words: List<WordBankEntry>
) {
    fun allEntries(): List<WordBankEntry> = chars + words
}
