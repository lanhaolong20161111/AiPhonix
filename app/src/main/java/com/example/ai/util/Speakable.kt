package com.example.ai.util

/**
 * 字符工具 — 判断字符是否可发音（移植 web `src/lib/chars.ts` 的 isSpeakableChar）。
 *
 * 汉字 / 字母 / 数字 / 拼音带声调 可发音；标点、空白、下划线填空位等不可发音，
 * 逐字点读时跳过（百度 TTS 对单标点会返回 500）。
 */
fun isSpeakableChar(ch: String): Boolean {
    if (ch.isEmpty()) return false
    if (Regex("[\\u4e00-\\u9fff]").containsMatchIn(ch)) return true   // 汉字
    if (Regex("[A-Za-z0-9]").containsMatchIn(ch)) return true          // 字母 / 数字
    if (Regex("[\\u00c0-\\u02af]").containsMatchIn(ch)) return true    // 拼音带声调（á、ǒ、ǚ…）
    return false
}

/** 该字符串是否只含可发音字符（整串可点读） */
fun isSpeakableText(text: String): Boolean =
    text.isNotEmpty() && text.all { isSpeakableChar(it.toString()) }
