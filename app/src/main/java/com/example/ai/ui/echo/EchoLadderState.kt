package com.example.ai.ui.echo

import com.example.ai.data.model.WordScore
import com.example.ai.util.normEnWord
import com.example.ai.util.soeScene
import com.example.ai.util.splitJsWhitespace

/**
 * 跟读阶梯的**纯状态机** —— 忠实移植 web `components/EchoLadder.tsx`
 * 的 `useState`（level / failCount / drill / done / retry）+ `handleScore`。
 *
 * 阶梯口径：第 1 级 = 第 1 个单位，第 2 级 = 前 2 个单位，… 最后一级 = 整句。
 * 每级 SOE ≥ [PASS]（70）过关进下一级；同一级连错 2 次且**已超过第 1 级**时，
 * 用逐词明细定位失败词 → 降级到该单位做「小步」局部练，小步过关后回原级继续。
 *
 * 本类**不碰 Compose / TTS / 网络**（录音与评测由 ViewModel 负责），
 * 因此可以直接单测（期望值取自真实 JS 语义，见 `EchoLadderStateTest`）。
 *
 * @param units 单词级步进单位（传了则 [wordMode] = true，按「第1词→前2词→…整句」）
 * @param chunks 意群（[units] 为空时使用）
 * @param sentence 整句原文（[steps] 为空时的退化目标）
 */
class EchoLadderState(
    units: List<String> = emptyList(),
    chunks: List<String> = emptyList(),
    val sentence: String = "",
) {

    /** 是否是单词级（web 判据是「传了 units 且非空」，与 [steps] 是否被过滤空无关） */
    val wordMode: Boolean = units.isNotEmpty()

    /** 步进单位：优先单词级，否则意群；逐项 trim 后丢掉空串（与 web 的 `.map(trim).filter(Boolean)` 同序） */
    val steps: List<String> = (if (units.isNotEmpty()) units else chunks)
        .map { it.trim() }
        .filter { it.isNotEmpty() }

    /** 当前等级 1..[total]，含前 [level] 个单位 */
    var level: Int = 1
        private set

    /** 同一级连续失败次数（过关或进小步即清零） */
    var failCount: Int = 0
        private set

    /** 局部小步：单个失败单位；非空期间 [target] 只读它 */
    var drill: String? = null
        private set

    /** 整句已过关 */
    var done: Boolean = false
        private set

    /** 失败后需要**重新领读**的触发计数（web 的 `retry` state，驱动领读副作用） */
    var retry: Int = 0
        private set

    val total: Int get() = steps.size

    /** 「词」/「片段」——只用于文案 */
    val unitLabel: String get() = if (wordMode) "词" else "片段"

    /**
     * 本轮要读的文本：小步优先，否则「前 [level] 个单位」。
     * ⚠️ 拼接用**单空格**（与 web 的 `steps.slice(0, level).join(" ")` 一致），
     * 即便单位自带标点也照原样拼。
     */
    val target: String
        get() = drill ?: (if (steps.isNotEmpty()) steps.take(level).joinToString(" ") else sentence)

    /** 被测文本对应的腾讯 SOE `scene`（决定 `eval_mode` 0/1/2，见 `soeScene`） */
    val scene: String get() = soeScene(target, ENGINE)

    enum class Event {
        /** 没有分数 / 已过关 → 状态未变 */
        NONE,
        LEVEL_UP,
        DRILL_CLEAR,
        FINISH_ALL,
        FAIL,
    }

    /**
     * 一次评测结果 → 状态迁移。
     *
     * @param score 整句总分；`null` = 没拿到分数（web 直接 return，不改状态）
     * @param words 逐词明细（句子模式才有）；`null` = 拿不到明细，[failingChunk] 返回 null
     */
    fun onScore(score: Int?, words: List<WordScore>? = null): Event {
        if (score == null || done) return Event.NONE
        if (score >= PASS) {
            if (drill != null) {
                // 小步过关 → 清 drill，回到原级继续（**不**升级）
                drill = null
                failCount = 0
                return Event.DRILL_CLEAR
            }
            failCount = 0
            val next = level + 1
            if (next > total) {
                done = true
                return Event.FINISH_ALL
            }
            level = next
            return Event.LEVEL_UP
        }
        val nf = failCount + 1
        failCount = nf
        retry += 1
        if (drill == null && level > 1 && nf >= 2) {
            drill = failingChunk(words) ?: steps.getOrNull(level - 1)
        }
        return Event.FAIL
    }

    /**
     * 跳过：直接判定整句完成（web 的 `onSkip` 也是把 `done` 置 true，不升级）。
     * 用于「跳过」按钮 —— 不走评测，故不改 [level] / [failCount]。
     */
    fun forceFinish() {
        done = true
    }

    /**
     * 从逐词明细定位「失败词所在单位」—— 返回**第一个**命中的单位（web 用 `steps.find`）。
     *
     * ⚠️ 因此返回的常常是**第 1 个单位**而不是当前等级的单位（`find` 从头扫），
     * 这是 web 的真实行为，已用单测钉死。
     * ⚠️ 失败判据是 **严格 `<` [PASS]**：恰好 70 分**不算**失败。
     * ⚠️ `accuracy` 缺失按 `0` 处理（[WordScore.pronAccuracy] 默认值即 0f），所以缺明细的词一律算失败。
     */
    fun failingChunk(words: List<WordScore>?): String? {
        if (words == null) return null
        val badWords = words
            .filter { it.pronAccuracy < PASS }
            .map { normEnWord(it.word) }
            .filter { it.isNotEmpty() }
        if (badWords.isEmpty()) return null
        val bad = badWords.toSet()
        return steps.firstOrNull { c ->
            splitJsWhitespace(c).map { normEnWord(it) }.filter { it.isNotEmpty() }.any { it in bad }
        }
    }

    /** 渲染快照（Compose 需要可比较的数据类才能正确触发重组） */
    fun view(): LadderView = LadderView(
        steps = steps,
        level = level,
        total = total,
        drill = drill,
        done = done,
        wordMode = wordMode,
        target = target,
    )

    companion object {
        /**
         * 过关线 —— web `EchoLadder.tsx` 的 `PASS`。
         * ⚠️ 与「文章背诵跟读」（`SpeechComposeViewModel.PASS_SCORE` = 70）同值，
         * 但**不是** `SentenceReadingViewModel` 的 80。
         */
        const val PASS = 70

        /** 阶梯固定用英文引擎（中文跟读另走 `ENGINE_ZH` 的调用点） */
        private const val ENGINE = "16k_en"
    }
}

/**
 * 跟读阶梯的渲染快照。
 * 「本轮读哪几个词」「已过关哪些单位」都由 [level] / [drill] 派生，见 [EchoLadder]。
 */
data class LadderView(
    val steps: List<String> = emptyList(),
    val level: Int = 1,
    val total: Int = 0,
    val drill: String? = null,
    val done: Boolean = false,
    val wordMode: Boolean = true,
    val target: String = "",
) {
    val unitLabel: String get() = if (wordMode) "词" else "片段"
}
