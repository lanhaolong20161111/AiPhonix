package com.example.ai.ui.chinesepractice

/** 在文本中只遮挡指定字符，其他保持原样 */
fun maskChar(text: String, charToHide: String): String {
    return text.map { if (it.toString() == charToHide) '█' else it }.joinToString("")
}

/** 在文本中只遮挡指定词语，其他保持原样 */
fun maskWord(text: String, wordToHide: String): String {
    return text.replace(wordToHide, wordToHide.map { '█' }.joinToString(""))
}
