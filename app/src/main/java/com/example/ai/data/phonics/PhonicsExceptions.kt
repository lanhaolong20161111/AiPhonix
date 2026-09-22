package com.example.ai.data.phonics

/**
 * 拼读着色的**例外词表** —— 规则算不出来的词，人工逐个写死切分。
 *
 * 与 web `lib/phonicsExceptions.ts` 逐位移植。格式：`<字母>:<码>` 空格分，码
 * `c/v/V/t/d/s/o` 对应 consonant / vowel-single / vowel-long / vowel-team / digraph /
 * silent / other。各块拼起来必须恰好等于单词，否则自动退回规则引擎（见 [compute]）。
 */

private val CODES: Map<String, PhonicType> = mapOf(
    "c" to PhonicType.CONSONANT,
    "v" to PhonicType.VOWEL_SINGLE,
    "V" to PhonicType.VOWEL_LONG,
    "t" to PhonicType.VOWEL_TEAM,
    "d" to PhonicType.DIGRAPH,
    "s" to PhonicType.SILENT,
    "o" to PhonicType.OTHER,
)

/** word → 紧凑切分串 */
private val RAW: Map<String, String> = mapOf(
    // ── magic-e 例外：尾 e 结构在，但前面的元音读短音 ──
    "have" to "h:c a:v v:c e:s",
    "give" to "g:c i:v v:c e:s",
    "live" to "l:c i:v v:c e:s",
    "come" to "c:c o:v m:c e:s",
    "some" to "s:c o:v m:c e:s",
    "done" to "d:c o:v n:c e:s",
    "none" to "n:c o:v n:c e:s",
    "love" to "l:c o:v v:c e:s",
    "above" to "a:v b:c o:v v:c e:s",
    "one" to "o:v n:c e:s",
    "once" to "o:v n:c c:c e:s",
    "gone" to "g:c o:v n:c e:s",

    // ── 词尾 -ere / -are / -ure：尾 e 前的元音不读长音 ──
    "are" to "ar:t e:s",
    "were" to "w:c er:t e:s",
    "there" to "th:d er:t e:s",
    "where" to "wh:d er:t e:s",
    "here" to "h:c er:t e:s",
    "sure" to "s:d ur:t e:s",

    // ── ea 读短音 /e/（规则按长音组合处理）──
    "head" to "h:c ea:t d:c",
    "bread" to "b:c r:c ea:t d:c",
    "dead" to "d:c ea:t d:c",
    "ready" to "r:c ea:t d:c y:v",
    "heavy" to "h:c ea:t v:c y:v",
    "weather" to "w:c ea:t th:d er:t",
    "feather" to "f:c ea:t th:d er:t",
    "leather" to "l:c ea:t th:d er:t",
    "health" to "h:c ea:t l:c th:d",
    "death" to "d:c ea:t th:d",
    "breath" to "b:c r:c ea:t th:d",
    "sweat" to "s:c w:c ea:t t:c",
    "threat" to "th:d r:c ea:t t:c",
    "weapon" to "w:c ea:t p:c o:v n:c",
    "pleasure" to "p:c l:c ea:t s:c ur:t e:s",
    "treasure" to "t:c r:c ea:t s:c ur:t e:s",
    "measure" to "m:c ea:t s:c ur:t e:s",

    // ── ai / ie / ay 的例外读音 ──
    "said" to "s:c ai:t d:c",
    "says" to "s:c ay:t s:c",
    "friend" to "f:c r:c ie:t n:c d:c",
    "friends" to "f:c r:c ie:t n:c d:c s:c",

    // ── 其他高频不规则（块数会被规则算错）──
    "eye" to "eye:t",
    "people" to "p:c eo:t p:c le:t",
    "busy" to "b:c u:v s:c y:v",
    "business" to "b:c u:v s:c i:s n:c e:v ss:d",
    "build" to "b:c ui:v l:c d:c",
    "built" to "b:c ui:v l:c t:c",
    "two" to "t:c w:s o:v",
    "who" to "wh:d o:v",
    "whose" to "wh:d o:v s:c e:s",
    "hour" to "h:s ou:t r:t",
    "our" to "ou:t r:t",
    "flour" to "fl:d ou:t r:t",
    "science" to "s:c c:c i:v e:v n:c c:c e:s",
    "quiet" to "qu:d i:v e:v t:c",
    "diet" to "d:c i:v e:v t:c",
    "create" to "c:c r:c e:v a:v t:c e:s",
    "evening" to "e:v v:c e:s n:c i:v ng:d",
    "minute" to "m:c i:v n:c u:v t:c e:s",
    "animal" to "a:v n:c i:v m:c al:t",
    "beautiful" to "b:c eau:t t:c i:v f:c ul:t",
    "useful" to "u:v s:c e:s f:c ul:t",
    "onion" to "o:v n:c io:t n:c",
    "union" to "u:v n:c io:t n:c",
    "opinion" to "o:v p:c i:v n:c io:t n:c",
    "million" to "m:c i:v ll:d io:t n:c",

    // ── 自有音素词库（105 词，人工校对 IPA）里规则仍会错的 ──
    "eight" to "eigh:V t:c",
    "colour" to "c:c o:v l:c our:t",
)

/** 解析成 `Map<小写单词, 切分块[]>`；格式不合法的条目一律丢弃（宁可不生效也不渲染错文本） */
private fun parse(): Map<String, List<PhonicChunk>> {
    val map = mutableMapOf<String, List<PhonicChunk>>()
    for ((w, spec) in RAW) {
        val chunks = mutableListOf<PhonicChunk>()
        var ok = true
        for (tok in spec.trim().split(Regex("\\s+"))) {
            val idx = tok.lastIndexOf(":")
            val letters = tok.substring(0, idx)
            val code = tok.substring(idx + 1)
            if (letters.isEmpty() || !CODES.containsKey(code)) {
                ok = false
                break
            }
            chunks.add(PhonicChunk(letters, CODES[code]!!))
        }
        // 各块拼起来必须正好是单词本身，否则这条数据是坏的
        if (!ok || chunks.joinToString("") { it.text } != w) continue
        map[w] = chunks
    }
    return map
}

/** 例外词表：小写单词 → 人工校对切分 */
val POLYPHONE_EXCEPTIONS: Map<String, List<PhonicChunk>> = parse()
