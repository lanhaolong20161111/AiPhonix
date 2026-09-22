package com.example.ai.data.phonics

/**
 * 英语拼读着色 —— 把英文单词切成「拼读单元」，按读音类别上色。
 *
 * 这是 web `lib/phonics.ts` 的逐位移植（确定性规则，纯函数）。教学意图与分类规则
 * 见 web 端注释；这里只保留实现。两条设计原则（2026-09-16 重写时确立）：
 *
 * 1. **块数优先于标签**。`块数 == 真实元音音素个数`是硬指标，某个块标"长"还是"短"是软指标。
 * 2. **例外交给词表**（[POLYPHONE_EXCEPTIONS]），不硬凑规则。
 *
 * 与 web 的差异：
 * - 缓存用 `LinkedHashMap`（4000 上限），web 用 `Map`；效果等价。
 * - 无 CSS 渲染，着色由 `ui/common/PhonicsText.kt` 用 `AnnotatedString` 背景色实现。
 */

/** 拼读单元类别（与 web `PhonicType` 逐位对应） */
enum class PhonicType {
    VOWEL_SINGLE, // 单字母元音（短元音）
    VOWEL_LONG,   // 长元音（magic-e / 长音组合）
    VOWEL_TEAM,   // 组合元音 / r 控制元音 / 成音节 l
    DIGRAPH,      // 辅音组合（含双写、含 -tion 的 ti）
    SILENT,       // 不发音字母
    CONSONANT,    // 普通辅音
    OTHER,        // 非字母（撇号 / 连字符 / 标点）
}

/** 一个拼读单元：连续同属一个块的字母 + 类别 */
data class PhonicChunk(val text: String, val type: PhonicType)

// ── 表（与 web 一致） ──

private const val VOWELS = "aeiou"

private val LONG_TEAMS = listOf("eigh", "igh", "ai", "ay", "ea", "ee", "ei", "ey", "ie", "oa", "oe", "ue", "ui", "ew")
private val R_TEAMS = listOf("air", "are", "ear", "eer", "oor", "our", "ure", "ore", "ire", "ar", "er", "ir", "or", "ur")
private val OTHER_VOWEL_TEAMS = listOf("oo", "oi", "oy", "ou", "ow", "au", "aw")
private val CONSONANT_TEAMS = listOf(
    "tch", "dge",
    "sh", "ch", "th", "ph", "wh", "ck", "ng", "nk", "qu", "gh",
    "ll", "ss", "ff", "tt", "pp", "mm", "nn", "bb", "dd", "gg", "rr", "zz", "cc",
)

/** 组合 → 类别。同长度下靠前的先匹配，故「长音组合」先于「其他元音组合」注册 */
private val TEAM_TYPE: Map<String, PhonicType> = buildMap {
    LONG_TEAMS.forEach { put(it, PhonicType.VOWEL_LONG) }
    (R_TEAMS + OTHER_VOWEL_TEAMS).forEach { put(it, PhonicType.VOWEL_TEAM) }
    CONSONANT_TEAMS.forEach { put(it, PhonicType.DIGRAPH) }
}

/** 按长度降序匹配（tch 优先于 ch、igh 优先于 gh 之类） */
private val TEAM_LIST: List<String> = TEAM_TYPE.keys.sortedByDescending { it.length }

/** 词尾「后面还跟着一个哑 e」也要读长音的族（无 magic-e 结构也读长音） */
private val TAIL_LONG_RE = Regex("(ild|ind|old|olt|ost|oll|all|alk|ange|aste|ation)$")

/** 软音标记后缀：ti/ci/si 在这些后缀里读 /ʃ/ 或 /ʒ/ */
private val SOFT_IO_RE = Regex("^(on|al|ous)")

/** word = 可选前导标点 + 词核（字母/撇号/连字符）+ 可选尾部标点 */
private val WORD_RE = Regex("^([^A-Za-z]*)([A-Za-z][A-Za-z'’\\-]*)?([^A-Za-z]*)$")

// ── 缓存 ──

private val cache = LinkedHashMap<String, List<PhonicChunk>>(64, 0.75f, true)
private const val CACHE_MAX = 4000

/** 把单词切成带类别的拼读单元（结果缓存）。空串返回空表。 */
fun segmentPhonics(word: String): List<PhonicChunk> {
    if (word.isEmpty()) return emptyList()
    synchronized(cache) {
        cache[word]?.let { return it }
        val res = compute(word)
        if (cache.size >= CACHE_MAX) cache.clear()
        cache[word] = res
        return res
    }
}

/** 去掉着色标记、还原成纯文本（导出/朗读场景用） */
fun joinPhonics(chunks: List<PhonicChunk>): String = chunks.joinToString("") { it.text }

/** 是否是一个英文单词（纯字母 + 可选撇号/连字符）。生词本这类「中英文混排」靠它决定是否着色。 */
fun isEnglishWord(text: String): Boolean = Regex("^[A-Za-z][A-Za-z'’\\-]*$").matches((text.ifBlank { null })?.trim() ?: "")

private fun compute(word: String): List<PhonicChunk> {
    val m = WORD_RE.find(word)
    if (m == null || m.groupValues[2].isEmpty()) return listOf(PhonicChunk(word, PhonicType.OTHER))
    val lead = m.groupValues[1]
    val core = m.groupValues[2]
    val tail = m.groupValues[3]
    // 例外词表优先：这是人工逐个校对的切分，比任何规则都准
    val fixed = POLYPHONE_EXCEPTIONS[core.lowercase()]
    val out = mutableListOf<PhonicChunk>()
    if (lead.isNotEmpty()) out.add(PhonicChunk(lead, PhonicType.OTHER))
    if (fixed != null && fixed.sumOf { it.text.length } == core.length) {
        // 例外表按小写存；按长度切片还原原词大小写（English → English）
        var off = 0
        for (c in fixed) {
            out.add(PhonicChunk(core.substring(off, off + c.text.length), c.type))
            off += c.text.length
        }
    } else {
        out.addAll(segmentCore(core))
    }
    if (tail.isNotEmpty()) out.add(PhonicChunk(tail, PhonicType.OTHER))
    return mergeSame(out)
}

/** 相邻同类型合并（**只合并普通辅音与标点**）。元音/组合/不发音块绝不能合并（块边界正是要教的）。 */
private fun mergeSame(chunks: List<PhonicChunk>): List<PhonicChunk> {
    val mergeable = setOf(PhonicType.CONSONANT, PhonicType.OTHER)
    val out = mutableListOf<PhonicChunk>()
    for (c in chunks) {
        if (c.text.isEmpty()) continue
        val last = out.lastOrNull()
        if (last != null && last.type == c.type && mergeable.contains(c.type)) {
            out[out.lastIndex] = PhonicChunk(last.text + c.text, last.type)
        } else {
            out.add(c)
        }
    }
    return out
}

private fun isVowel(c: Char): Boolean = VOWELS.indexOf(c) >= 0
private fun isLetter(c: Char): Boolean = c in 'a'..'z'

private fun segmentCore(core: String): List<PhonicChunk> {
    val low = core.lowercase()
    val n = low.length
    val type = Array(n) { PhonicType.CONSONANT }
    val used = BooleanArray(n)
    val owner = IntArray(n) { it }

    fun mark(from: Int, len: Int, t: PhonicType) {
        for (k in from until from + len) {
            type[k] = t
            used[k] = true
            owner[k] = from
        }
    }

    // ── 0. 软音标记：-tion / -sion / -cial / -tial / -tious / -cious ──
    for (k in 1 until n - 2) {
        val c = low[k - 1]
        if (c != 't' && c != 'c' && c != 's') continue
        if (low[k] != 'i') continue
        if (!SOFT_IO_RE.containsMatchIn(low.substring(k + 1))) continue
        mark(k - 1, 2, PhonicType.DIGRAPH)
    }

    // ── 1. 词尾 e（先回退一格轻后缀 s/d，否则 [元音][辅音]e 失效） ──
    var end = n
    var lightSuffix = ""
    if (end > 3 && (low[end - 1] == 's' || low[end - 1] == 'd')) {
        lightSuffix = low[end - 1].toString()
        end--
    }

    /** magic-e 待定的长元音位置 —— **先不定色**，等组合匹配跑完再收尾（防 house/plelase/choose 顺序 bug） */
    var magicE = -1
    /** [辅音]le 里那个成音节的 l */
    var syllabicL = -1

    if (end >= 3 && low.substring(end - 3, end) == "dge") {
        mark(end - 3, 3, PhonicType.DIGRAPH)
    } else if (end >= 3 && low[end - 1] == 'e') {
        val e = end - 1
        val p1 = low[end - 2]
        val p2 = low[end - 3]
        if (isInflectionE(low, end, lightSuffix)) {
            // -ed / -es 里那个自成音节的 e（wanted / addresses）是真元音，不能当哑 e
            type[e] = PhonicType.VOWEL_SINGLE
            used[e] = true
        } else if (isLetter(p1) && isVowel(p2) && !isVowel(p1)) {
            // [元音][辅音]e → magic-e：尾 e 不发音，前面的元音读长音（具体定色推迟）
            type[end - 1] = PhonicType.SILENT
            used[end - 1] = true
            magicE = end - 3
        } else if (isLetter(p1) && !isVowel(p1) && isLetter(p2) && !isVowel(p2)) {
            if (p1 == 'l') {
                // [辅音]le → 成音节的 l
                type[end - 1] = PhonicType.SILENT
                used[end - 1] = true
                syllabicL = end - 2
            } else {
                type[end - 1] = PhonicType.SILENT
                used[end - 1] = true
            }
        }
    }

    // ── 1a. 词尾 -ying：y 是元音（trying / flying / carrying） ──
    if (n >= 5 && low.endsWith("ying") && !used[n - 4]) {
        type[n - 4] = PhonicType.VOWEL_SINGLE
        used[n - 4] = true
    }

    // ── 1b. 词尾 -que / -gue：u 与 e 都不发音（unique / tongue / league） ──
    if (n >= 4 && !used[n - 1] && (low.endsWith("que") || low.endsWith("gue"))) {
        val u = n - 2
        if (low[u] == 'u' && !used[u]) {
            type[u] = PhonicType.SILENT
            used[u] = true
            type[n - 1] = PhonicType.SILENT
            used[n - 1] = true
            if (magicE == u) magicE = -1
        }
    }

    // ── 1c. gu + 元音：u 不发音（guard / guess / guide） ──
    for (k in 1 until n - 1) {
        if (used[k] || low[k] != 'u' || low[k - 1] != 'g') continue
        if (!isVowel(low[k + 1])) continue
        type[k] = PhonicType.SILENT
        used[k] = true
        if (magicE == k) magicE = -1
    }

    // ── 2. 从左到右贪婪匹配 ──
    var i = 0
    while (i < n) {
        if (used[i]) { i++; continue }
        val rest = low.substring(i)

        // 2a. 不发音的首字母：knife / write
        if (i == 0 && (rest.startsWith("kn") || rest.startsWith("wr"))) {
            type[0] = PhonicType.SILENT
            type[1] = PhonicType.CONSONANT
            used[0] = true
            used[1] = true
            i += 2
            continue
        }
        // 2b. 不发音的尾字母 g：sign / design
        if (i + 2 == n && rest.startsWith("gn")) {
            type[i] = PhonicType.SILENT
            type[i + 1] = PhonicType.CONSONANT
            used[i] = true
            used[i + 1] = true
            i += 2
            continue
        }
        // 2c. 不发音的尾字母 b：lamb / thumb / climb
        if (i == n - 1 && low[i] == 'b' && i >= 2 && low[i - 1] == 'm') {
            type[i] = PhonicType.SILENT
            used[i] = true
            i++
            continue
        }
        // 2d. -alk 里不发音的 l：walk / talk
        if (low[i] == 'l' && i >= 1 && low[i - 1] == 'a' && low[i + 1] == 'k') {
            type[i] = PhonicType.SILENT
            used[i] = true
            i++
            continue
        }

        // 2e. 多字母组合（长组合优先）
        val team = matchTeam(rest, i, n, used)
        if (team != null) {
            mark(i, team.length, TEAM_TYPE[team] ?: PhonicType.DIGRAPH)
            i += team.length
            continue
        }

        // 2f. 单字母
        val ch = low[i]
        when {
            isVowel(ch) -> type[i] = PhonicType.VOWEL_SINGLE
            ch == 'y' && i == n - 1 && n > 2 -> type[i] = PhonicType.VOWEL_SINGLE
            ch == 'y' && i > 0 && i < n - 1 && !isVowel(low[i - 1]) && !isVowel(low[i + 1]) -> type[i] = PhonicType.VOWEL_SINGLE
            ch == '\'' || ch == '’' || ch == '-' -> type[i] = PhonicType.OTHER
            else -> type[i] = PhonicType.CONSONANT
        }
        used[i] = true
        i++
    }

    // ── 3. magic-e 收尾（若该位置已被 ou/ea/oo 接管则作废：house/plelase/choose） ──
    if (magicE >= 0 && type[magicE] == PhonicType.VOWEL_SINGLE) type[magicE] = PhonicType.VOWEL_LONG

    // ── 4. 词尾长元音族（无 magic-e 结构也读长音） ──
    val tm = TAIL_LONG_RE.find(low.substring(0, end))
    if (tm != null) {
        val vi = end - tm.value.length
        if (vi >= 0 && type[vi] == PhonicType.VOWEL_SINGLE && owner[vi] == vi) type[vi] = PhonicType.VOWEL_LONG
    }

    // ── 5. 成音节的 l：le 两字母合成一块 ──
    if (syllabicL >= 0 && used[syllabicL + 1]) {
        type[syllabicL] = PhonicType.VOWEL_TEAM
        type[syllabicL + 1] = PhonicType.VOWEL_TEAM
        used[syllabicL] = true
        owner[syllabicL] = syllabicL
        owner[syllabicL + 1] = syllabicL
    }

    // ── 6. 按「块」输出（连续同 owner 的字符才是同一个拼读单元） ──
    val chunks = mutableListOf<PhonicChunk>()
    var k = 0
    while (k < n) {
        var j = k
        while (j + 1 < n && owner[j + 1] == owner[k]) j++
        chunks.add(PhonicChunk(core.substring(k, j + 1), type[k]))
        k = j + 1
    }
    return chunks
}

/** 屈折后缀里那个「自成音节」的 e —— 是真元音，不能当哑 e。 */
private fun isInflectionE(low: String, end: Int, lightSuffix: String): Boolean {
    val e = end - 1
    return when (lightSuffix) {
        "d" -> low[e - 1] == 't' || low[e - 1] == 'd'
        "s" -> {
            val a = low[e - 1]
            val b = low[e - 2]
            if (a == 's' || a == 'z' || a == 'x' || a == 'g' || a == 'c') true
            else a == 'h' && (b == 'c' || b == 's')
        }
        else -> false
    }
}

/** 取当前可用的最长组合；跨越已判定（magic-e / 哑 e / 软音标记）的位不算命中 */
private fun matchTeam(rest: String, i: Int, n: Int, used: BooleanArray): String? {
    for (t in TEAM_LIST) {
        if (t.length > n - i) continue
        if (!rest.startsWith(t)) continue
        var ok = true
        for (k in i until i + t.length) {
            if (used[k]) { ok = false; break }
        }
        if (ok) return t
    }
    return null
}
