package com.example.ai.util

import com.example.ai.data.model.WordScore

/**
 * SOE 评测结果的展示层纯函数 —— 对齐 web `web/src/lib/soeDisplay.ts`。
 *
 * 背景（与 web 同一份结论，2026-09-20 由生产 `/soe/records` 真实英文记录确认）：
 * - 腾讯智聆 SOE 对「没被检测到的单位」（漏读、没读出这个词/音素）返回
 *   `PronAccuracy = -1` + `MatchTag = 2`，**不是 0**。
 *   直接渲染就会出现「-1 分」这种既难看又不准确的结果（-1 不是 0 分，是没读到）。
 * - 英文引擎返回的 `word` **一律小写**（"I" → "i"、"Lily" → "lily"），
 *   逐词展示时需要按参考文本还原原始大小写。
 *
 * 与 web 的**唯一**差异：这里用 `Float.isFinite()` 判 NaN/Infinity，
 * 对应 JS 的 `!Number.isFinite(accuracy)`（`Float.NaN < 0f` 是 false，所以必须先判有限性）。
 */
object SoeDisplay {

    /** 单个单位（词 / 音素）是否「未被检测到」（漏读）。MatchTag=2 是腾讯的缺读标记。 */
    fun isMissing(accuracy: Float, matchTag: Int = 0): Boolean {
        if (matchTag == 2) return true
        if (!accuracy.isFinite()) return true
        return accuracy < 0f
    }

    /** 分数文本：正常四舍五入取整；缺读显示「未读」（绝不显示 -1）。 */
    fun formatScore(accuracy: Float, matchTag: Int = 0): String =
        if (isMissing(accuracy, matchTag)) "未读" else Math.round(accuracy).toString()

    /** 分数色阶：good(≥80) / ok(≥60) / bad(<60) / miss(未读到) */
    enum class ScoreClass { GOOD, OK, BAD, MISS }

    fun scoreClass(accuracy: Float, matchTag: Int = 0): ScoreClass {
        if (isMissing(accuracy, matchTag)) return ScoreClass.MISS
        return when {
            accuracy >= 80f -> ScoreClass.GOOD
            accuracy >= 60f -> ScoreClass.OK
            else -> ScoreClass.BAD
        }
    }

    /** 参考文本里的单词字符（含连字符、撇号，撇号含中英文两种写法） */
    private val WORD_RE = Regex("[A-Za-z0-9'\\u2019\\u02BC-]+")
    private val APOSTROPHE_RE = Regex("[\\u2019\\u02BC]")
    private val NON_WORD_RE = Regex("[^a-z0-9']")

    /** 归一化：小写 + 统一撇号 + 丢非字母数字撇号字符，用于宽松比对 */
    private fun normWord(s: String): String =
        NON_WORD_RE.replace(APOSTROPHE_RE.replace(s.lowercase(), "'"), "")

    /**
     * 用参考文本按顺序还原 SOE 返回词的大小写。
     *
     * 腾讯英文 SOE 的 `word` 全小写，逐词分数练的是「原句里的词」，
     * 展示成 `i` / `lily` 对小学生是错的（"I" 永远大写、专名首字母大写）。
     *
     * 采用**顺序双指针**匹配（不是按下标一一对应）：
     * SOE 允许漏词/少返回，指针只会单向前进，因此 "I play games" 只返回
     * ["i","games"] 时仍能正确还原成 ["I","games"]，重复词（the cat and the dog）
     * 也不会串位。匹配不上的词保持原样（不猜）。
     */
    fun restoreWordCase(words: List<WordScore>, refText: String): List<WordScore> {
        val tokens = WORD_RE.findAll(refText).map { it.value }.toList()
        if (tokens.isEmpty() || words.isEmpty()) return words

        val out = words.toMutableList()
        var ti = 0
        for (i in out.indices) {
            val target = normWord(out[i].word)
            if (target.isEmpty()) continue
            var hit = -1
            for (j in ti until tokens.size) {
                if (normWord(tokens[j]) == target) {
                    hit = j
                    break
                }
            }
            if (hit < 0) continue // 参考文本里找不到同形词 → 保持原样
            val token = tokens[hit]
            if (token != out[i].word) out[i] = out[i].copy(word = token)
            ti = hit + 1
        }
        return out
    }
}
