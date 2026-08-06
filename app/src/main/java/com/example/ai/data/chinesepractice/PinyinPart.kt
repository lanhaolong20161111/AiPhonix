package com.example.ai.data.chinesepractice

data class PinyinParts(
    val initial: String = "",
    val medial: String = "",
    val final: String = "",
    val tone: Int = 0,
    val isOverall: Boolean = false,
)

/** 带声调符号的字符 → (字母, 声调号)。ü 系列写作 v。 */
private val TONE_CHAR_MAP: Map<Char, Pair<Char, Int>> = mapOf(
    'ā' to ('a' to 1), 'á' to ('a' to 2), 'ǎ' to ('a' to 3), 'à' to ('a' to 4),
    'ō' to ('o' to 1), 'ó' to ('o' to 2), 'ǒ' to ('o' to 3), 'ò' to ('o' to 4),
    'ē' to ('e' to 1), 'é' to ('e' to 2), 'ě' to ('e' to 3), 'è' to ('e' to 4),
    'ī' to ('i' to 1), 'í' to ('i' to 2), 'ǐ' to ('i' to 3), 'ì' to ('i' to 4),
    'ū' to ('u' to 1), 'ú' to ('u' to 2), 'ǔ' to ('u' to 3), 'ù' to ('u' to 4),
    'ǖ' to ('v' to 1), 'ǘ' to ('v' to 2), 'ǚ' to ('v' to 3), 'ǜ' to ('v' to 4),
    'ü' to ('v' to 0), // 无调 ü（如 nüè 中的 ü），不设声调
)

/**
 * 把带声调符号的拼音归一化为数字声调格式（幂等）：
 * "xī guā" -> "xi1 gua1"；"xi1" 原样返回；"ü" 写作 "v"。
 * 声调数字加在音节末尾（空格或结尾处 flush），如 biāo -> biao1。
 */
fun normalizePinyin(input: String): String {
    val sb = StringBuilder()
    var tone = 0
    for (c in input.trim().lowercase()) {
        val mapped = TONE_CHAR_MAP[c]
        if (mapped != null) {
            sb.append(mapped.first)
            tone = mapped.second
        } else if (c == ' ') {
            // 音节结束：flush 声调数字
            if (tone != 0) {
                sb.append(tone)
                tone = 0
            }
            sb.append(c)
        } else {
            sb.append(c)
        }
    }
    if (tone != 0) sb.append(tone)
    return sb.toString()
}

private val INITIALS = listOf("zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
    "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w")
private val WHOLE = setOf("zhi", "chi", "shi", "ri", "zi", "ci", "si",
    "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying")

/** 介母 i 可搭配的韵母开头（真声母后的 ian 是整体韵母，读"烟"，不拆介母） */
private val I_MEDIAL = setOf("iong", "iang", "iao", "ia")
/** 介母 u 可搭配的韵母开头（真声母后的 uan 是整体韵母，读"弯"，不拆介母） */
private val U_MEDIAL = setOf("uang", "uai", "uo", "ua")
/** 介母 ü 可搭配的韵母开头（书写为 v） */
private val V_MEDIAL = setOf("van", "vong")
/** 特殊整体韵母：不拆介母（ian 读"烟"，uan 读"弯"） */
private val SPECIAL_FINALS = setOf("ian", "uan")

fun parsePinyin(pinyin: String): PinyinParts {
    val s = normalizePinyin(pinyin).trim().lowercase()
    if (s.isEmpty()) return PinyinParts()

    val tone = s.lastOrNull()?.let { if (it in '1'..'5') it - '0' else 0 } ?: 0
    val body = if (tone in 1..5) s.dropLast(1) else s

    if (body in WHOLE) return PinyinParts(final = body, isOverall = true, tone = tone)

    for (init in INITIALS) {
        if (body.startsWith(init)) {
            val rest = body.removePrefix(init)
            if (rest.isEmpty()) return PinyinParts(initial = init, tone = tone)

            // 特殊拼写规则：
            // 1. y/w 是课本声母：yan = y + an（烟/严/演/燕），wan = w + an（弯/玩/晚/万）——an 是复韵母，不归一化
            // 2. j/q/x + uan = üan 省略写法，读 yuan（juan/quan/xuan）
            // 3. j/q/x 后的 u 是 ü 的省略写法（qu→qv, qun→qvn, jue→jve）
            val normalized = when {
                init in "jqx" && rest == "uan" -> "uan"
                init in "jqx" && rest.startsWith("u") -> "v" + rest.drop(1)
                else -> rest
            }
            val (medial, fin) = splitMedial(normalized)
            return PinyinParts(initial = init, medial = medial, final = fin, tone = tone)
        }
    }

    // 零声母
    val (medial, fin) = splitMedial(body)
    return PinyinParts(medial = medial, final = fin, tone = tone)
}

/** 按小学标准分离介母；真声母后的 ian/uan 是整体韵母（读"烟"/"弯"）不拆 */
private fun splitMedial(rest: String): Pair<String, String> {
    if (rest.isEmpty()) return "" to ""

    // 特殊整体韵母优先（真声母后）：ian/uan 直接作为韵母（也避免被短前缀 ia/ua 误匹配）
    if (rest in SPECIAL_FINALS) return "" to rest

    when (rest[0]) {
        // 长前缀优先（避免 "ia" 误匹配 "iang/iao"）
        'i' -> for (p in I_MEDIAL.sortedByDescending { it.length }) if (rest.startsWith(p)) return "i" to rest.drop(1)
        'u' -> for (p in U_MEDIAL.sortedByDescending { it.length }) if (rest.startsWith(p)) return "u" to rest.drop(1)
        'v' -> for (p in V_MEDIAL.sortedByDescending { it.length }) if (rest.startsWith(p)) return "v" to rest.drop(1)
    }
    return "" to rest
}
