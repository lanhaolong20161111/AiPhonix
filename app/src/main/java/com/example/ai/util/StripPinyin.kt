package com.example.ai.util

/**
 * 去拼音 —— 对齐 web `web/src/lib/pinyin.ts` 的 `stripPinyin` / `stripPinyinKeepDelimiters`。
 *
 * 拍照识别带拼音的课本照片时，识别结果里会混进拼音（带声调字母或纯 ASCII 字母），
 * 需要先把拼音剔掉再导入字词句。
 *
 * 三条**反直觉行为已用单测钉死**（照抄 web，别顺手"修正"）：
 * 1. 带声调的拉丁字母是**小写专属**字符类 —— 大写的 `RÌ YUÈ` 里 `Ì`/`È` **不会被剔掉**，
 *    于是 [stripPinyinKeepDelimiters] 会留下 `"Ì È\n"` 这种残渣；[stripPinyin] 因为找不到汉字而返回 `""`。
 * 2. [stripPinyin] 只认汉字，**数字/英文/标点/空白全部丢弃**，所以纯拼音输入一律返回 `""`。
 * 3. [stripPinyinKeepDelimiters] 只删拼音与 ASCII 字母段，其余（空格/换行/顿号/逗号…）**原样保留**
 *    —— 练词/练句要靠这些分隔符切分，否则会被打平成一个长串。
 */
private val TONED_LATIN_RUN = Regex("[A-Za-z]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü][A-Za-z]*")

private val ASCII_LETTER_RUN = Regex("[A-Za-z]+")

private val HAN_CHAR = Regex("[\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff]")

/**
 * 剔除拼音，只留汉字。纯拼音/纯英文输入返回空串。
 * @param separate true = 字与字之间加一个半角空格（「练字」逐字拆分用）；false = 连写（「练词」用）。
 */
fun stripPinyin(input: String, separate: Boolean = false): String {
    if (input.isEmpty()) return ""
    val t = ASCII_LETTER_RUN.replace(TONED_LATIN_RUN.replace(input, ""), "")
    val han = HAN_CHAR.findAll(t).map { it.value }.toList()
    if (han.isEmpty()) return ""
    return if (separate) han.joinToString(" ") else han.joinToString("")
}

/**
 * 剔除拼音与残留 ASCII 字母段，但**保留其它分隔符**（空格、换行、顿号、逗号、分号…）。
 * 「练词 / 练句」场景专用：让下游仍能按词/句拆开。
 */
fun stripPinyinKeepDelimiters(input: String): String {
    if (input.isEmpty()) return ""
    return ASCII_LETTER_RUN.replace(TONED_LATIN_RUN.replace(input, ""), "")
}
