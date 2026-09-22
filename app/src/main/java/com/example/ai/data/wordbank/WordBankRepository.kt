package com.example.ai.data.wordbank

import android.content.Context
import com.example.ai.data.userimport.UserImportItem
import com.example.ai.data.userimport.UserImportStore
import com.google.gson.Gson

/**
 * 字词库仓库 - 从 assets/wordbank.json 加载内置基线词库，
 * 并将用户导入数据（UserImportStore）合并进查询结果。
 * 所有查询在内存中进行，无网络/数据库依赖。
 */
class WordBankRepository(
    private val context: Context,
    private val userImportStore: UserImportStore? = null,
) {
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

    private fun userItems(): List<UserImportItem> =
        userImportStore?.load().orEmpty()

    /** 根据标签过滤汉字（内置 + 用户导入 char，补"识字/写字"标签） */
    fun queryChars(vararg requiredTags: String): List<WordBankEntry> {
        return mergeUserEntries(getBank().chars, userItems(), "char", listOf("识字", "写字"))
            .filter { entry -> requiredTags.all { tag -> tag in entry.tags } }
    }

    /** 根据标签过滤词语（内置 + 用户导入 word，补"词语"标签） */
    fun queryWords(vararg requiredTags: String): List<WordBankEntry> {
        return mergeUserEntries(getBank().words, userItems(), "word", listOf("词语"))
            .filter { entry -> requiredTags.all { tag -> tag in entry.tags } }
    }

    /**
     * 手打列表在词库中的**命中数量**（对齐 web `getCharCountByTexts` / `getWordCountByTexts`）——
     * 「每日语文」用它提示家长"今日这些字词有多少真能练到"。
     *
     * ⚠️ 两点与 web 对齐的细节：
     * - 「能不能认」= 标签含 **「识字」或「识写」**（web `isRecogChar`）。**不含「写字」**：
     *   资产里 `写字` 721 个里有一部分不是 `识字/识写`，按 web 口径这些不算可认字。
     * - web 传空列表时返回**全部**（用于别的调用方）；本方法只服务计数，空列表直接返回 0
     *   （调用方 `DailyChinesePage` 在列表为空时本来就不显示"命中数"）。
     */
    fun countCharsByTexts(texts: List<String>): Int {
        val set = texts.toSet()
        if (set.isEmpty()) return 0
        return queryChars().count { it.text in set && isRecogChar(it) }
    }

    /** 词语命中数；口径同 [countCharsByTexts]（词语要求带「词语」标签） */
    fun countWordsByTexts(texts: List<String>): Int {
        val set = texts.toSet()
        if (set.isEmpty()) return 0
        return queryWords("词语").count { it.text in set }
    }

    private fun isRecogChar(e: WordBankEntry): Boolean =
        "识字" in e.tags || "识写" in e.tags

    /** 根据年级/学期/类型查询（内置 + 用户导入） */
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
        val mergedChars = mergeUserEntries(getBank().chars, userItems(), "char", listOf("识字", "写字"))
        val mergedWords = mergeUserEntries(getBank().words, userItems(), "word", listOf("词语"))
        val all = if (tags.isEmpty()) mergedChars + mergedWords
        else (mergedChars + mergedWords).filter { entry ->
            tags.all { tag -> tag in entry.tags }
        }
        return all.take(limit)
    }

    /** 获取标签列表及对应数量（含用户导入条目的标签） */
    fun getTagStats(): Map<String, Int> {
        val counts = mutableMapOf<String, Int>()
        val mergedChars = mergeUserEntries(getBank().chars, userItems(), "char", listOf("识字", "写字"))
        val mergedWords = mergeUserEntries(getBank().words, userItems(), "word", listOf("词语"))
        for (entry in mergedChars + mergedWords) {
            for (tag in entry.tags) {
                counts[tag] = counts.getOrDefault(tag, 0) + 1
            }
        }
        return counts
    }

    /** 搜索字/词（内置 + 用户导入） */
    fun search(query: String): List<WordBankEntry> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        val mergedChars = mergeUserEntries(getBank().chars, userItems(), "char", listOf("识字", "写字"))
        val mergedWords = mergeUserEntries(getBank().words, userItems(), "word", listOf("词语"))
        return (mergedChars + mergedWords).filter { it.text.contains(q) }
    }
}
