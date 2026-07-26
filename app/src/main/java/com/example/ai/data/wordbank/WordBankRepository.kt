package com.example.ai.data.wordbank

import android.content.Context
import com.google.gson.Gson

/**
 * 字词库仓库 - 从 assets/wordbank.json 加载
 * 所有查询在内存中进行，无网络/数据库依赖
 */
class WordBankRepository(private val context: Context) {
    private var bank: WordBank? = null

    private fun getBank(): WordBank {
        if (bank == null) {
            val json = context.assets.open("chinese_wordbank.json")
                .bufferedReader(Charsets.UTF_8)
                .use { it.readText() }
            bank = Gson().fromJson(json, WordBank::class.java)
        }
        return bank ?: throw IllegalStateException("WordBank not initialized — call loadAsync() first")
    }

    /** 根据标签过滤汉字 */
    fun queryChars(vararg requiredTags: String): List<WordBankEntry> {
        return getBank().chars.filter { entry ->
            requiredTags.all { tag -> tag in entry.tags }
        }
    }

    /** 根据标签过滤词语 */
    fun queryWords(vararg requiredTags: String): List<WordBankEntry> {
        return getBank().words.filter { entry ->
            requiredTags.all { tag -> tag in entry.tags }
        }
    }

    /** 根据年级/学期/类型查询 */
    fun queryByGrade(
        grade: String? = null,
        semester: String? = null,
        type: String? = null,
        limit: Int = Int.MAX_VALUE
    ): List<WordBankEntry> {
        val tags = listOfNotNull(
            if (grade != null && semester != null) "$grade$semester" else null,
            type
        )
        val all = if (tags.isEmpty()) getBank().allEntries()
        else getBank().allEntries().filter { entry ->
            tags.all { tag -> tag in entry.tags }
        }
        return all.take(limit)
    }

    /** 获取标签列表及对应数量 */
    fun getTagStats(): Map<String, Int> {
        val counts = mutableMapOf<String, Int>()
        for (entry in getBank().allEntries()) {
            for (tag in entry.tags) {
                counts[tag] = counts.getOrDefault(tag, 0) + 1
            }
        }
        return counts
    }

    /** 搜索字/词 */
    fun search(query: String): List<WordBankEntry> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        return getBank().allEntries().filter { it.text.contains(q) }
    }
}
