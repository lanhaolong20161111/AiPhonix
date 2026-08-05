package com.example.ai.data.articlereading

/**
 * 文章读后问题匹配器：从已有题库（用户导入的 quiz）中按关键词匹配与文章相关的题目。
 * 纯本地规则，零 LLM 成本。
 *
 * 算法：
 * 1. 从文章标题 + 正文提取关键词（2-4 字 n-gram，过滤停用词，标题词加权 ×2）
 * 2. 每题分数 = 题干（+选项）文本包含的关键词数
 * 3. 返回分数 >= 1 的题目，按分数降序取前 [limit] 题
 */
object ArticleQuestionMatcher {

    internal val STOP_WORDS = setOf(
        "的", "了", "是", "我", "你", "他", "她", "它", "们", "在", "有", "和", "也", "都",
        "就", "很", "不", "一", "个", "这", "那", "着", "过", "地", "得", "上", "下", "中",
        "把", "被", "又", "还", "只", "可", "以", "去", "来", "到", "说", "看", "听", "想",
        "会", "能", "要", "让", "给", "对", "从", "于", "而", "并", "且", "但", "因", "为",
        "之", "其", "所", "与", "或", "及", "等", "什么", "怎么", "为什么", "多少", "哪里",
        "谁", "何时", "如何", "吗", "呢", "啊", "吧", "的", "了", "着",
    )

    /** 提取文章关键词（含权重：标题词×2） */
    fun extractKeywords(article: ArticleContent, max: Int = 30): Map<String, Int> {
        val freq = HashMap<String, Int>()
        fun addNgrams(text: String, weight: Int) {
            val clean = text.replace(Regex("""[\s\d\p{P}]"""), "")
            if (clean.length < 2) return
            // 2-4 字滑窗
            for (len in 2..minOf(4, clean.length)) {
                for (i in 0..clean.length - len) {
                    val gram = clean.substring(i, i + len)
                    if (gram in STOP_WORDS) continue
                    // 过滤全标点/全数字残留
                    if (gram.any { it.isLetter() or it.isDigit() }) {
                        freq[gram] = (freq[gram] ?: 0) + weight
                    }
                }
            }
        }
        addNgrams(article.title, 2)
        article.paragraphs.forEach { addNgrams(it, 1) }
        return freq.entries.sortedByDescending { it.value }.take(max).associate { it.key to it.value }
    }

    /**
     * 匹配与文章相关的题目。
     * @return 匹配到的题目（按相关度降序），最多 [limit] 题
     */
    fun match(
        article: ArticleContent,
        candidates: List<ImportedQuizQuestion>,
        limit: Int = 3,
    ): List<ImportedQuizQuestion> {
        if (candidates.isEmpty()) return emptyList()
        val keywords = extractKeywords(article)
        if (keywords.isEmpty()) return emptyList()

        val scored = candidates.mapNotNull { q ->
            val haystack = buildString {
                append(q.text)
                q.options.forEach { append(it) }
            }
            val score = keywords.entries.sumOf { (kw, w) ->
                if (haystack.contains(kw)) w else 0
            }
            if (score <= 0) null else q to score
        }
        return scored.sortedByDescending { it.second }.take(limit).map { it.first }
    }
}
