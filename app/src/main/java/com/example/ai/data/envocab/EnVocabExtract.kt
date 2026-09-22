package com.example.ai.data.envocab

/**
 * 英语识图取词的产物（对齐 web `lib/enVocabExtract.ts` 的 `EnVocab`）。
 *
 * @param words 去重后的内容词（**顺序 = 首次出现顺序**，词形见 [EnVocabExtract.extractWords]）
 * @param sentences 去重后的句子（已去中文注释 / 排版符）
 * @param wordsTruncated 单词数超上限被截断
 * @param sentencesTruncated 句子数超上限被截断
 */
data class EnVocab(
    val words: List<String> = emptyList(),
    val sentences: List<String> = emptyList(),
    val wordsTruncated: Boolean = false,
    val sentencesTruncated: Boolean = false,
)

/**
 * 从 OCR 文本里抽出「所有单词」和「所有句子」—— **纯函数**，可 JVM 单测。
 * 逐条对齐 web `web/src/lib/enVocabExtract.ts`（期望值取自 `_envocab_probe.mjs` 跑真实实现）。
 *
 * 用途：AI 英语对话页「📷 拍照识词」。拍课本 / 单词表 → 整页识别 → 这里抽词句 →
 * 回填「练习单词 / 练习句子」→ 交给 `/llm/en-dialogue-setup` 编多轮对话。
 *
 * ★ 为什么不把这步交给大模型（与 web 同一取舍）：
 * ① 识别结果本来就是文字，抽词是**确定性规则**，没必要再等一次 LLM；
 * ② 断网 / 额度耗尽也能用；③ 规则可单测。代价是虚词过滤靠词表，
 * 所以弹层里给了「包含虚词（a/the/is…）」开关兜底。
 *
 * ⚠️ 移植时逐条比对过的几个**反直觉行为**（单测已钉死，别"顺手修好"）：
 * - `cleanSentence("3.5 apples and 2 pears.")` ⇒ `"5 apples and 2 pears."`
 *   —— 行首序号剥离 `^[\s\d]+[.)、]` 会**吃掉小数点的整数部分**。
 * - `splitRawSentences("Mr. Smith is here. Nice.")` ⇒ `["Mr."," Smith is here."," Nice."]`
 *   —— 缩写保护只看「点号**紧跟**字母」（`U.S.` 中间那个点不切），
 *   `Mr. ` 后面是空格 ⇒ **照样切**。
 * - `extractWords("aa bb cc dd ee")` ⇒ `["aa","ee"]` —— `bb/cc/dd` 被"≤3 字母且无元音"的
 *   噪声规则剔除。所以「上限截断」的测试不能用这类词构造。
 * - `extractWords` 只认 `[A-Za-z]` 开头的词：`'banana'` / `-apple-` 会被去掉首尾的 `-`/`'`
 *   （`w.length < 2` 直接丢单字母）。
 * - 句子的"像不像句子"有**两档门槛**：带句末标点 `≥2 词 且 ≥4 字母`；不带句末标点 `≥4 词`。
 * - 句子 key 用 `[^a-z0-9']` 去掉全部符号后比较 ⇒ `"Hello there."` 与 `"hello THERE!"` 算重复。
 */
object EnVocabExtract {

    /** 默认上限：一页课本抽出的量。超了截断并在弹层里提示，避免把整本书塞进 dialogue 提示词 */
    const val MAX_WORDS: Int = 80
    const val MAX_SENTENCES: Int = 24

    // ⚠️ **正则常量必须声明在 STOP_WORDS 之前**：Kotlin `object` 的属性初始化按**声明顺序**执行，
    //    而下面 STOP_WORDS 的初始化就要用 WS ⇒ 若 WS 在后面，运行期拿到的是 null（NPE）。
    //    这个坑的表现是"所有测试一起失败"，看起来像逻辑全错，其实是初始化顺序。

    private val WS = Regex("[ \\t\\n\\u000B\\f\\r]")
    private val WS_RUN = Regex("[ \\t\\n\\u000B\\f\\r]+")

    /** 汉字 + 中日韩标点（web 的 `[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]`） */
    private val CJK = Regex("[\\u2e80-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]")

    /** 非可打印 ASCII（`° · © £` 等） */
    private val NON_ASCII_PRINTABLE = Regex("[^\\u0020-\\u007e]")

    /** 排版符号（**保留** `, . ' - ! ? ; : ( )`） */
    private val LAYOUT_SYMBOLS = Regex("[*_#>|~^`{}=+\\\\/\\[\\]]")

    private val WORD_RE = Regex("[A-Za-z][A-Za-z'-]*")
    private val SENT_KEY_RE = Regex("[^a-z0-9']")
    private val VOWEL_RE = Regex("[aeiouy]")

    /** 高频虚词（冠词/代词/系动词/助动词/介词/连词/疑问词）—— 不是值得练的目标词，默认剔除。
     *
     *  ⚠️ 刻意保守：`do/have/look/go/play` 等小学课标词汇**不要**放进来（它们常常就是本课要练的词）。
     *  宁可漏删也不要错删；用户勾「包含虚词」即可全部保留。
     *
     *  ★ 注意 `i` 在表里，但 `extractWords` 本来就会丢掉单字母词 ⇒ 它永远不会出现在结果里
     *  （web 亦然：`keepStop` 打开时 `a` / `I` 也不冒出）。保留它是为了与 web 逐字一致。 */
    private val STOP_WORDS: Set<String> = buildSet {
        // 冠词 / 限定词
        addAll("a an the this that these those some any all both each every".words())
        // 代词
        addAll(
            (
                "i me my mine you your yours he him his she her hers " +
                    "it its we us our ours they them their theirs"
                ).words(),
        )
        // 系动词 / 助动词
        addAll("am is are was were be been being do does did".words())
        // 情态动词
        addAll("can could will would shall should may might must".words())
        // 介词
        addAll(
            (
                "of to in on at by for with from into about over " +
                    "under up down out off as than during between near"
                ).words(),
        )
        // 连词 / 副词
        addAll(
            (
                "and or but if so because then not there here " +
                    "very too also just only again still well"
                ).words(),
        )
        // 疑问词
        addAll("what which who whom whose when where why how".words())
    }

    /** 句末标点（中英混排一起认）：英语教材照片常出现「英文 + 中文注释」同行 */
    private val SENT_END: Set<Char> = setOf('.', '!', '?', '。', '！', '？', '…')

    /** 明显是版面结构 / 指令而非句子的行首（`Unit 3` / `Lesson 2` / `Page 5` / `Read and write.`）。
     *
     *  ⚠️ 只匹配「词组」不匹配单词：`read` 单独出现不算（`"Read a book."` 可能就是要练的句子），
     *  但 `read and` 这种教材指令必是噪声。 */
    private val STRUCT_START = Regex(
        "^(unit|module|lesson|chapter|part|section|page|exercise|grade|book|test|activity|review)\\b" +
            "|^(read|listen|say|look|write|circle|tick|match|fill)\\s+(and|the following)\\b" +
            "|^let'?s\\b",
        RegexOption.IGNORE_CASE,
    )

    /**
     * OCR 原文归一化：换行统一、全角→半角、弯引号→直引号、连字→普通字母、去控制字符。
     *
     * 识别结果里 `（ ）` `，` `？` 这类全角标点会破坏英文断句，必须先转掉。
     */
    fun normalizeOcrText(raw: String): String {
        var t = raw
        t = t.replace(Regex("\\r\\n?"), "\n")
        t = t.replace(Regex("[ \\t\\u00a0\\u2000-\\u200b\\u3000]"), " ")
        t = t.replace(Regex("[\\u2018\\u2019\\u201b\\u2032]"), "'")
        t = t.replace(Regex("[\\u201c\\u201d\\u2033]"), "\"")
        t = t.replace("\ufb01", "fi").replace("\ufb02", "fl")
        // 全角字母/数字/标点（！-～ 段）→ 半角；中文标点「。、」不在该段，留给 cleanSentence 处理
        t = t.replace(Regex("[\\uff01-\\uff5e]")) { ch -> (ch.value[0].code - 0xfee0).toChar().toString() }
        t = t.replace(Regex("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]"), " ")
        return t
    }

    /** 按句末标点 + 换行切候选句（**只切不洗**，清洗交给 [cleanSentence]） */
    private fun splitRawSentences(text: String): List<String> {
        val out = ArrayList<String>()
        val buf = StringBuilder()
        fun flush() {
            val t = buf.toString()
            buf.setLength(0)
            if (t.isNotBlank()) out.add(t)
        }
        for (i in text.indices) {
            val ch = text[i]
            if (ch == '\n') {
                flush()
                continue
            }
            buf.append(ch)
            if (ch !in SENT_END) continue
            val prev = if (i > 0) text[i - 1] else null
            val next = if (i + 1 < text.length) text[i + 1] else null
            // 小数点（3.5）不切
            if (ch == '.' && prev != null && prev.isDigit() && next != null && next.isDigit()) continue
            // 缩写（Mr. / U.S. / e.g.）：点号**紧跟**字母 → 不切（注意 `Mr. ` 后面是空格，照样切）
            if (ch == '.' && next != null && isAsciiLetter(next)) continue
            flush()
        }
        flush()
        return out
    }

    /**
     * 洗一个候选句：去中文注释 / 排版符号 / 行首序号；不像句子就返回 `""`。
     *
     * 判定「像不像句子」的门槛刻意分开两档：
     * - **有句末标点**：≥2 个词、≥4 个字母即可（`"It is."` 也算）；
     * - **没有句末标点**：≥4 个词（否则 `"apple banana orange"` 这种单词表会被当成句子）。
     */
    fun cleanSentence(raw: String): String {
        var s = raw
        s = CJK.replace(s, " ")
        s = NON_ASCII_PRINTABLE.replace(s, " ")
        s = LAYOUT_SYMBOLS.replace(s, " ")
        s = s.replace(Regex("^[\\s\\d]+[.)、]\\s*"), "") // 行首序号 1. / 2)
        s = WS_RUN.replace(s, " ").trim()
        s = s.replace(Regex("[ \\t\\n\\u000B\\f\\r]+([.!?,;:])"), "$1") // "Hello ." → "Hello."
        s = s.replace(Regex("^[\\s'\",;:.!?-]+"), "")
        s = s.replace(Regex("[\\s'\",;:-]+$"), "") // 末尾只去杂符（保留 . ! ?）
        if (s.isEmpty()) return ""
        if (STRUCT_START.containsMatchIn(s)) return "" // Unit 3 / Lesson 2 之类版面标题
        val tokens = WORD_RE.findAll(s).count()
        if (tokens < 2) return ""
        val letters = s.count { isAsciiLetter(it) }
        if (letters < 4) return ""
        val hasEnd = s.last() == '.' || s.last() == '!' || s.last() == '?'
        if (!hasEnd && tokens < 4) return ""
        return s
    }

    /**
     * 该位置是否为「句首 / 行首」：前一非空格字符是换行或句末标点。
     *
     * 用途：句首的 `This/Look/Read` 不算专有名词（见 [extractWords] 词形归一）。
     */
    private fun isInitialPos(text: String, idx: Int): Boolean {
        var i = idx - 1
        while (i >= 0 && (text[i] == ' ' || text[i] == '\t')) i--
        if (i < 0) return true
        val p = text[i]
        return p == '\n' || p == '.' || p == '!' || p == '?' || p == '。' || p == '！' || p == '？'
    }

    /** 抽词前先整行剔除「版面 / 指令行」：否则 `"Unit 3 My Family"` 会贡献 `unit`、
     *  `"Read and write."` 会贡献 `write`。
     *
     *  与句子过滤的区别：这里是**按行**判（行首命中即整行丢掉），因为同一行里可能还夹着正常句子；
     *  句子过滤走 [cleanSentence]（在切好的候选句上判）。 */
    private fun stripStructLines(text: String): String =
        text.split("\n")
            .filter { line ->
                val t = WS_RUN.replace(CJK.replace(normalizeOcrText(line), " "), " ").trim()
                t.isEmpty() || !STRUCT_START.containsMatchIn(t)
            }
            .joinToString("\n")

    /**
     * 抽单词（去重、归一大小写、剔虚词 / 噪声）。
     *
     * 词形归一规则（顺序执行）：
     * 1. 同一个小写键只要在原文里出现过小写形态 → 用小写（句首的 `"My/Father"` 落成 `my/father`）；
     * 2. 否则若该大写形态**从未出现在非句首位置**（只做过句首 `"Look/Read/New"`）→ 也用小写；
     * 3. 否则保留出现最多的原形（`"Tom/China"` 这类真专有名词 —— 它们至少有一次出现在句中）。
     *
     * 单字母词（`a` / `I`）不进词表：作练习词没有意义，且 `keepStop` 打开时也不该冒出来。
     */
    fun extractWords(text: String, keepStop: Boolean = false): List<String> {
        /** lower → (surface → count)。用 LinkedHashMap 保持**首次出现顺序**（web 的 Map 同语义） */
        val forms = LinkedHashMap<String, LinkedHashMap<String, Int>>()
        /** 曾以大写形态出现在「非句首」位置的词（小写键）—— 只有这类才可能是专有名词 */
        val capNonInitial = HashSet<String>()
        for (m in WORD_RE.findAll(text)) {
            // JS 的正则已保证首尾是字母，中间的 - ' 需要在两端再剥一次
            val w = m.value.trimStart('-', '\'').trimEnd('-', '\'')
            if (w.length < 2) continue
            val lower = w.lowercase()
            if (!keepStop && lower in STOP_WORDS) continue
            // TV/mm/qq 之类噪声：≤3 字母且无元音
            if (w.length <= 3 && !VOWEL_RE.containsMatchIn(lower)) continue
            if (w != lower && !isInitialPos(text, m.range.first)) capNonInitial.add(lower)
            val bucket = forms.getOrPut(lower) { LinkedHashMap() }
            bucket[w] = (bucket[w] ?: 0) + 1
        }
        val out = ArrayList<String>(forms.size)
        for ((lower, bucket) in forms) {
            if (bucket.containsKey(lower) || lower !in capNonInitial) {
                out.add(lower)
                continue
            }
            var pick = lower
            var best = -1
            for ((form, n) in bucket) {
                if (n > best) {
                    pick = form
                    best = n
                }
            }
            out.add(pick)
        }
        return out
    }

    /** 主入口：OCR 文本 → [EnVocab] */
    fun extractEnglishVocab(
        raw: String,
        keepStop: Boolean = false,
        maxWords: Int = MAX_WORDS,
        maxSentences: Int = MAX_SENTENCES,
    ): EnVocab {
        val text = normalizeOcrText(raw)

        val seen = HashSet<String>()
        val sentences = ArrayList<String>()
        for (cand in splitRawSentences(text)) {
            val s = cleanSentence(cand)
            if (s.isEmpty()) continue
            val key = SENT_KEY_RE.replace(s.lowercase(), "")
            if (key.isEmpty() || !seen.add(key)) continue
            sentences.add(s)
        }

        // 单词从**去掉版面前缀行后的全文**抽（含没被当成句子的行，如 "apple banana orange" 这类单词表）
        val wordSource = stripStructLines(text)
        var words = extractWords(wordSource, keepStop)
        // 兜底：整页全是虚词（理论上不会）→ 退回不过滤，至少给 AI 一点练习内容
        if (words.isEmpty() && !keepStop) words = extractWords(wordSource, true)

        return EnVocab(
            words = words.take(maxWords),
            sentences = sentences.take(maxSentences),
            wordsTruncated = words.size > maxWords,
            sentencesTruncated = sentences.size > maxSentences,
        )
    }

    // ── 私有小工具 ──

    private fun String.words(): List<String> = WS.split(this).filter { it.isNotEmpty() }

    private fun isAsciiLetter(c: Char): Boolean = (c in 'a'..'z') || (c in 'A'..'Z')
}
