package com.example.ai.data.wordbank

import com.example.ai.data.userimport.UserImportItem

/**
 * 用户导入数据 → 字词库条目的合并映射（纯函数，JVM 可测）。
 *
 * 架构背景（见项目记忆 user-import-pipeline-architecture）：
 * 内置 assets 词库保持只读基线，用户导入的 char/word 在这里合并进查询结果，
 * 使认字/默写/词语练习能消费到用户数据。
 *
 * 映射规则：
 *  - kind == char  → type="char"，补 ["识字","写字"] 标签（认字 + 默写练习均可见）
 *  - kind == word  → type="word"，补 ["词语"] 标签（词语练习可见）
 *  - 其他 kind（article/sentence/quiz/answer）不进入字词练习
 *  - 与内置同 type 同 text 重复的条目跳过（避免练习里出现重复题）
 *  - 非 active 状态的条目跳过
 */
fun mergeUserEntries(
    innerEntries: List<WordBankEntry>,
    userItems: List<UserImportItem>,
    targetType: String,
    extraTags: List<String>,
): List<WordBankEntry> {
    val innerTexts = innerEntries.asSequence()
        .filter { it.type == targetType }
        .map { it.text }
        .toHashSet()
    val result = ArrayList<WordBankEntry>(innerEntries.size + userItems.size)
    result.addAll(innerEntries)
    val seen = HashSet<String>()
    for (item in userItems) {
        if (item.kind != targetType) continue
        if (item.status.isNotBlank() && item.status != "active") continue
        val text = item.text.trim()
        if (text.isEmpty()) continue
        if (text in innerTexts || !seen.add(text)) continue
        result.add(
            WordBankEntry(
                text = text,
                tags = (item.tags + extraTags).distinct(),
                type = targetType,
                pinyin = item.pinyin,
            )
        )
    }
    return result
}
