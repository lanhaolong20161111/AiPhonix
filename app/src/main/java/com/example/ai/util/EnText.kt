package com.example.ai.util

/**
 * 英语文本纯函数 —— 移植 web `pages/AiEnglishTalkPage.tsx` 与 `components/EchoLadder.tsx` 里的
 * 文本判定逻辑。这些函数**不依赖 UI**，期望值全部取自真实 JS 语义
 * （探针 `web/_echoladder_probe.mjs`，用例见 `EnTextTest`）。
 */

/** 评测引擎（腾讯 SOE）：英文句/词 */
const val ENGINE_EN = "16k_en"

/** 评测引擎（腾讯 SOE）：中文句/字 */
const val ENGINE_ZH = "16k_zh"

/**
 * JS `\s` 的等价字符类。
 *
 * ⚠️ Kotlin/Java 的 `\s` 只认 `[ \t\n\x0B\f\r]`，而 JS 还包含全角空格 U+3000、NBSP U+00A0、
 * 各类 U+2000–U+200A 空格、U+2028/2029 行分隔符、U+FEFF BOM 等。照抄 JS 的 `\s` 会**少切一刀**
 * （中文输入法极易打出全角空格，粘贴文本常带 NBSP/BOM）。
 */
private val JS_WS = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")

/**
 * 按 JS `\s` 语义切分并丢掉空白项 —— 等价于 JS 的 `s.split(/\s+/).filter(Boolean)`。
 * `soeScene` / `fallbackChunks` / 跟读阶梯的失败词定位共用这一份口径（别各自写 `split`）。
 */
fun splitJsWhitespace(s: String): List<String> = JS_WS.split(s).filter { it.isNotEmpty() }

/**
 * 删掉所有 JS `\s` 语义的空白字符 —— 等价于 JS 的 `s.replace(/\s+/g, "")`。
 * 与 [splitJsWhitespace] 共用同一字符集（同样的 U+3000 / U+00A0 / U+FEFF 陷阱）。
 */
fun removeJsWhitespace(s: String): String = JS_WS.replace(s, "")

/**
 * 连续 JS `\s` 语义空白折叠成单个半角空格 —— 等价于 JS 的 `s.replace(/\s+/g, " ")`。
 * 与 [splitJsWhitespace] / [removeJsWhitespace] 共用同一字符集。
 * （`EnglishTurnAsr.cleanAsrText` 的第二段清洗用它。）
 */
fun collapseJsWhitespace(s: String): String = JS_WS.replace(s, " ")

/**
 * 复刻 JS 的 `String(number)` —— 整数不带小数点，小数保留原样。
 *
 * ⚠️ Kotlin `Float.toString()` 会把整数值打成 `"85.0"`，而 JS 是 `"85"`；
 * 分数来自数据库 `real` 列（可能带小数），直接 `toString()` 会与 web 显示不一致。
 */
fun jsNumber(v: Float): String {
    if (v.isNaN()) return "NaN"
    val truncated = v.toInt()
    if (v == truncated.toFloat()) return truncated.toString()
    return v.toString().trimEnd('0').trimEnd('.')
}

/**
 * 英语单词切分（丢标点）—— 对齐 web 的全局正则「一个或多个字母，后接零或多组（撇号 + 字母）」。
 * （⚠️ 此处刻意**不写出字面量**：那种正则的结尾是星号加斜杠，写在 KDoc 里会被当成注释结束符。）
 *
 * ⚠️ 三处反直觉行为（**已用单测钉死，别"顺手修正"**）：
 * 1. **连字符不在类内** ⇒ `well-known` 切成 `["well","known"]`。
 *    （注意与 `WordbookAutoCollector.EN_WORD_RE` 不同：那里允许连字符、且整串匹配。别互换。）
 * 2. **数字被切开**：`world4u` → `["world","u"]`（`4` 不是字母，`u` 重新起一个词）。
 * 3. **非 ASCII 字母被切开**：`café` → `["caf"]`、`résumé` → `["r","sum"]`。
 */
private val EN_WORD_RE = Regex("[A-Za-z]+(?:['\u2019][A-Za-z]+)*")

/** 按 web 口径把英文句子切成单词表（用于跟读阶梯的逐词扩长） */
fun splitEnWords(s: String): List<String> = EN_WORD_RE.findAll(s).map { it.value }.toList()

/**
 * 只保留英文部分 —— 移植 web `englishOnly()`。
 *
 * 若文本里混入了中文翻译后缀，裁掉（防 AI 台词「英文+中文翻译」被 TTS 一起朗读）。
 *
 * ⚠️ 判据是 `首个汉字下标 > 0`（不是 `>= 0`）：
 * - 纯中文（汉字在 0 位，或前导空白后紧跟汉字）**原样返回**，不裁 → `"你好"`、`"  你好"` 会返回 `"你好"` / `""`。
 *   实测 `englishOnly("  你好") == ""`（`slice(0,2).trim()`）。
 * - 末尾空白总会被 `trim()` 掉。
 */
fun englishOnly(t: String): String {
    val i = t.indexOfFirst { it in '\u4e00'..'\u9fff' }
    return if (i > 0) t.substring(0, i).trim() else t.trim()
}

/**
 * 词汇比对用的归一化 —— 对齐 web EchoLadder 的 `normWord()`
 * （`w.toLowerCase().replace(/[^a-z0-9']/g, "").trim()`）。
 *
 * ⚠️ 只保留 **ASCII** 小写字母/数字/撇号：
 * - 弯撇号 U+2019 **不在** 类内 ⇒ `It’s` → `"its"`（直撇号 `don't` 才保留：`"don't"`）。
 * - 连字符被删 ⇒ `well-known` → `"wellknown"`。
 */
fun normEnWord(w: String): String = w.lowercase().replace(Regex("[^a-z0-9']"), "").trim()

/** 弱读功能词：**不**作为意群起始词（web `fallbackChunks` 的 weak 集合，取值逐字对齐） */
private val WEAK_WORDS = setOf(
    "to", "the", "a", "an", "and", "of", "for", "with", "in", "on", "at", "is", "are",
)

/**
 * 意群兜底切分 —— 移植 web `fallbackChunks()`（后端没给 `chunks` 时用）。
 *
 * 规则（按 2~3 词一组，弱词不领句）：
 * 1. 先把句子按空白切成词（去空白项）；
 * 2. 从左往右累积：`cur.size >= 3` **或**（下一个词与当前词都**不是**弱读词）时断组；
 * 3. 收尾把残留的 `cur` 收进结果；
 * 4. 结果为空时**返回 `[sentence]`** ⇒ 空串会得到 `[""]`（web 的真实行为，已钉死）。
 */
fun fallbackChunks(sentence: String): List<String> {
    val words = splitJsWhitespace(sentence)
    val out = ArrayList<String>()
    var cur = ArrayList<String>()
    for (i in words.indices) {
        cur.add(words[i])
        val next = words.getOrNull(i + 1)
        val boundary = cur.size >= 3 ||
            (next != null && next.lowercase() !in WEAK_WORDS && words[i].lowercase() !in WEAK_WORDS)
        if (boundary && cur.isNotEmpty()) {
            out.add(cur.joinToString(" "))
            cur = ArrayList()
        }
    }
    if (cur.isNotEmpty()) out.add(cur.joinToString(" "))
    return if (out.isNotEmpty()) out else listOf(sentence)
}

/**
 * 按被测文本判定腾讯 SOE 的 `scene` —— 移植 web EchoLadder 的 `soeScene`。
 *
 * `scene` 与服务端的 `eval_mode` **逐位等价**（`server_cf/src/lib/soe.ts` 的 `resolveEvalMode()`：
 * `word→"0"(≤30)` / `sentence→"1"(≤120)` / `paragraph→"2"(≤120)`），Android 侧发 `eval_mode`。
 *
 * ⚠️ 必须传对：省成自动判定时，英文句子的 `maxRefLen` 只有 **30 字符**，长句会被静默截断。
 *
 * 判定口径：
 * - `16k_zh`：数**汉字**个数 —— ≤1 → `word`；≤30 → `sentence`；否则 `paragraph`。
 * - 其它（英文）：按空白分词，**>1 词** → `sentence`，否则 `word`（空串也算 `word`）。
 */
fun soeScene(target: String, engine: String): String {
    if (engine == ENGINE_ZH) {
        val n = target.count { it in '\u4e00'..'\u9fff' }
        return if (n <= 1) "word" else if (n <= 30) "sentence" else "paragraph"
    }
    return if (splitJsWhitespace(target).size > 1) "sentence" else "word"
}

/**
 * `scene` → 服务端 `eval_mode` 的三值映射（与 `resolveEvalMode()` 的 mapping 表逐位一致）。
 * 未知 scene 返回 `""`（交给服务端按语言自动判定）。
 */
fun evalModeForScene(scene: String): String = when (scene) {
    "word" -> "0"
    "sentence" -> "1"
    "paragraph" -> "2"
    "pinyin" -> "8"
    else -> ""
}

/** JS `\s` 的字符集合（用于 `trim` 与自定义分词） */
private val JS_WS_CHARS: String = "\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

/** 练习单词分隔符：web 的 `/[,，、\s]+/`（`\s` 是 JS 语义，故复用同一字符集合） */
private val PRACTICE_WORD_SEP = Regex("[,，、$JS_WS_CHARS]+")

/**
 * JS `String.prototype.trim()` 的等价实现。
 *
 * ⚠️ Java/Kotlin 的两套都不等于 JS：
 * - `String.trim()` 只去 `<= ' '` 的字符；
 * - `Char.isWhitespace()` 不认 **NBSP（U+00A0）**，也不认 **U+FEFF（BOM）**。
 * 中文输入法与粘贴文本极易带上这两个字符，故显式补上。
 */
fun jsTrim(s: String): String = s.trim { ch ->
    ch.isWhitespace() || ch == '\u00A0' || ch == '\uFEFF'
}

/**
 * 解析「练习单词」输入框 —— web `wordsText.split(/[,，、\s]+/).map(trim).filter(Boolean)`。
 * 逗号（半角/全角）、顿号、任意空白都算分隔符。
 */
fun parsePracticeWords(text: String): List<String> =
    PRACTICE_WORD_SEP.split(text).map { jsTrim(it) }.filter { it.isNotEmpty() }

/**
 * 解析「练习句子」输入框 —— web `sentencesText.split(/\n+/).map(trim).filter(Boolean)`。
 * **只按换行切**（句内的空格/标点都保留原样）。
 */
fun parsePracticeSentences(text: String): List<String> =
    text.split(Regex("\\n+")).map { jsTrim(it) }.filter { it.isNotEmpty() }
