package com.example.ai.data.wordbook

/**
 * 生词本收录来源 — 与 web 逐字一致的取值（服务端 `source` 字段，仅作统计/溯源）。
 * 见 `web/src/pages/AiParseResultPage.tsx`（recog_*）与 `web/src/components/AiChatPanel.tsx`（chat_*）。
 */
object WordbookSource {
    const val RECOG_CHINESE = "recog_chinese"
    const val RECOG_MATH = "recog_math"
    const val RECOG_ENGLISH = "recog_english"
    const val RECOG_BATCH = "recog_batch"

    /** AI 对话里点字：`chat_{module}`（module = chinese / math / english） */
    fun chat(module: String): String = "chat_$module"
}

/**
 * 生词本「点读自动收录」——移植 web 的两处自动收录点：
 * - `AiParseResultPage.addTappedWordbook`（点单字 → `recog_chinese`/`recog_math`；点英文单词 → `recog_english`）
 * - `AiChatPanel.onCharClick`（对话里点字 → `chat_{module}`）
 *
 * 与 web 一致的两条语义：
 * 1. **收录口径**由 [isWordbookWorthy] 决定（汉字整串 / 单个英文单词，标点与数字一律不收）。
 * 2. **页面会话内去重**：同一 `(source, text)` 只上报一次（web 用 `useRef<Set>`，这里是等价物）。
 *    去重是**必须的**——服务端是 upsert（重复上报会让 `times` 一直 +1，把 SRS 的"遇到次数"污染掉）。
 *
 * 上报是 fire-and-forget：不阻塞点读/朗读，失败只记日志（`WordbookRepository.add` 返回 false）。
 */
class WordbookAutoCollector(
    private val repository: WordbookRepository = WordbookRepository(),
    private val launch: (suspend () -> Unit) -> Unit,
) {
    private val sent = mutableSetOf<String>()

    /**
     * 纯判定：该不该收录（含会话内去重）。**不改状态之外的东西**，便于单测。
     * @return true = 首次且符合口径（调用方据此决定是否发请求）
     */
    @Synchronized
    fun shouldCollect(text: String, source: String): Boolean {
        val t = text.trim()
        if (!isWordbookWorthy(t)) return false
        return sent.add("$source:$t")
    }

    /** 点读命中时调用：符合口径且本页未发过 → 后台加入生词本。 */
    fun collect(text: String, source: String): Boolean {
        if (!shouldCollect(text, source)) return false
        launch { repository.add(text.trim(), "", source) }
        return true
    }

    companion object {
        /** CJK 统一表意文字（与 web 的 `/^[\u4e00-\u9fff]+$/` 同范围） */
        private val CJK_RE = Regex("^[\\u4e00-\\u9fff]+$")

        /** 单个英文单词：允许内部撇号（' 或 ’）与连字符。与 web `/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/` 同定义 */
        private val EN_WORD_RE = Regex("^[A-Za-z]+(?:['\u2019-][A-Za-z]+)*$")

        /**
         * 移植 web `AiParseResultPage.tsx` 的 `isWordbookWorthy`（含"整段中文块也收"的口径——
         * 但点读入参永远是单字/单词，整串分支只是与 web 保持同构）。
         * 期望值见 `app/src/test/.../data/wordbook/WordbookAutoCollectTest.kt`（由 web 真实实现打印）。
         */
        fun isWordbookWorthy(text: String): Boolean {
            val t = text.trim()
            if (t.isEmpty()) return false
            if (CJK_RE.matches(t)) return true
            return EN_WORD_RE.matches(t)
        }
    }
}
