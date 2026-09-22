package com.example.ai.data.zhteach

/**
 * 文章练习：本地按句切分 + LLM 缩写合并（对齐 web `web/src/lib/articleSplit.ts`）。
 *
 * 为什么本地切句：文章粘贴后要**立刻**开始逐句练习，不能干等 LLM。
 * 缩写（背诵框架）由 `/llm/article-recite` 后台生成，回来后再原地合并。
 *
 * ⚠️ 本文件与 `data/dailyzh/DailyTextSplit` **不是同一套口径**，不可互换：
 *    - 本文件按**句末标点**（。！？；!?;…）切句，并吸收紧跟的收尾引号/省略号（最多 4 个）；
 *    - `DailyTextSplit.sentences` 只按 `；;\n` 切。两者对同一段文字的结果不同。
 *
 * 与 web 的已知差异（有意，不影响中文文章）：
 *    - web 用 `[...raw]`（按 Unicode 码点迭代），此处按 Kotlin `Char`（UTF-16 码元）迭代。
 *      仅对 BMP 之外的字符（emoji 等代理对）有差异，中文/英文标点场景完全一致。
 *    - 末端的 `trim()`：Kotlin 会去掉 U+FEFF，web 的 JS `trim()` 不会。中文文章不出现该字符。
 */
data class ArticleLine(
    /** 一句原文 */
    val text: String = "",
    /** 该句极简背诵提示（≤12 字，空串 = 未生成） */
    val short: String = "",
)

object ArticleSplit {

    /**
     * 句末标点（中文全角 + 英文半角 + 省略号）。
     * 取舍：单个「…」也当句末（中文里单个省略号基本是「话没说完」＝句末）；
     * 若出现在句子中间（如「我…不知道」）会被误切 —— 小学文章里极罕见，可接受。
     */
    private val SENTENCE_END = Regex("[。！？!?；;…]")

    /** 句末标点后可吸收的收尾符号（右引号/右书名号/省略号），避免把 」” 切到下一句 */
    private val TRAILING = Regex("[」』”’\"'…]")

    /** 归一化：去标点/空白，用于按文本对齐 LLM 回显的句子 */
    private fun norm(s: String): String = s.replace(Regex("[^\\u4e00-\\u9fff0-9a-zA-Z]"), "")

    /**
     * 把一段文章文本切分成句子：
     * - 句末标点（。！？；!?;…）后断句，并吸收紧跟的收尾引号/省略号；
     * - 换行强制断句；
     * - 去首尾空白、丢弃空段。
     *
     * 注意：连续句末标点会**各自成句**（每个标点都触发一次断句），
     * 例如 `"只有标点。。。"` → `["只有标点。", "。", "。"]`。这是 web 的真实行为。
     */
    fun splitSentences(raw: String): List<String> {
        val chars = raw.replace("\r", "")
        val out = mutableListOf<String>()
        val buf = StringBuilder()

        fun flush() {
            val t = buf.toString().trim()
            if (t.isNotEmpty()) out.add(t)
            buf.clear()
        }

        var i = 0
        while (i < chars.length) {
            val ch = chars[i]
            if (ch == '\n') {
                flush()
                i++
                continue
            }
            buf.append(ch)
            if (!SENTENCE_END.matches(ch.toString())) {
                i++
                continue
            }
            // 吸收收尾符号（如 。」 ，……），最多 4 个，避免吞掉下一句首字
            var k = 0
            while (i + 1 < chars.length && k < 4 && TRAILING.matches(chars[i + 1].toString())) {
                buf.append(chars[i + 1])
                i++
                k++
            }
            flush()
            i++
        }
        flush()
        return out
    }

    /**
     * 把后端返回的 `{ text, short }` 合并到本地切句结果上。
     * 优先按归一化后的句子文本匹配（LLM 可能漏句/换序），命不中再**按下标兜底**。
     *
     * ⚠️ 下标兜底会带来一个古怪但必须复刻的行为：若 LLM 返回的第 i 项 `text` 与本地第 i 句
     * 不匹配（但 `short` 非空），本地第 i 句**仍会拿到那一项的 short**。
     * 例：`mergeShorts(["甲句。","乙句。"], [{text:"乙句。",short:"只有乙"}])` → 两句都是「只有乙」。
     */
    fun mergeShorts(sentences: List<String>, items: List<ArticleLine>?): List<ArticleLine> {
        val byText = mutableMapOf<String, String>()
        for (it in items ?: emptyList()) {
            val k = norm(it.text)
            val v = it.short.trim()
            if (k.isNotEmpty() && v.isNotEmpty() && !byText.containsKey(k)) byText[k] = v
        }
        return sentences.mapIndexed { i, s ->
            val byIdx = (items?.getOrNull(i)?.short ?: "").trim()
            ArticleLine(text = s, short = byText[norm(s)] ?: byIdx)
        }
    }
}
