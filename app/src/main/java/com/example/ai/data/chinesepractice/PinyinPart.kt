package com.example.ai.data.chinesepractice

data class PinyinParts(
    val initial: String = "",
    val medial: String = "",
    val final: String = "",
    val tone: Int = 0,
    val isOverall: Boolean = false,
)

private val INITIALS = listOf("zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
    "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w")
private val WHOLE = setOf("zhi", "chi", "shi", "ri", "zi", "ci", "si",
    "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying")

/** 介母 i 可搭配的韵母开头 */
private val I_MEDIAL = setOf("iong", "iang", "iao", "ian", "ia")
/** 介母 u 可搭配的韵母开头 */
private val U_MEDIAL = setOf("uang", "uai", "uan", "uo", "ua")
/** 介母 ü 可搭配的韵母开头（书写为 v） */
private val V_MEDIAL = setOf("van", "vong")

fun parsePinyin(pinyin: String): PinyinParts {
    val s = pinyin.trim().lowercase()
    if (s.isEmpty()) return PinyinParts()

    val tone = s.lastOrNull()?.let { if (it in '1'..'5') it - '0' else 0 } ?: 0
    val body = if (tone in 1..5) s.dropLast(1) else s

    if (body in WHOLE) return PinyinParts(final = body, isOverall = true, tone = tone)

    for (init in INITIALS) {
        if (body.startsWith(init)) {
            val rest = body.removePrefix(init)
            if (rest.isEmpty()) return PinyinParts(initial = init, tone = tone)

            val (medial, fin) = splitMedial(rest)
            return PinyinParts(initial = init, medial = medial, final = fin, tone = tone)
        }
    }

    // 零声母
    val (medial, fin) = splitMedial(body)
    return PinyinParts(medial = medial, final = fin, tone = tone)
}

/** 按小学标准分离介母 */
private fun splitMedial(rest: String): Pair<String, String> {
    if (rest.isEmpty()) return "" to ""

    when (rest[0]) {
        'i' -> for (p in I_MEDIAL) if (rest.startsWith(p)) return "i" to rest.drop(1)
        'u' -> for (p in U_MEDIAL) if (rest.startsWith(p)) return "u" to rest.drop(1)
        'v' -> for (p in V_MEDIAL) if (rest.startsWith(p)) return "v" to rest.drop(1)
    }
    return "" to rest
}
