package com.k2fsa.sherpa.onnx.dictation

import android.util.Log
import com.k2fsa.sherpa.onnx.agent.LlmProvider
import com.k2fsa.sherpa.onnx.data.entity.HintRecord
import com.k2fsa.sherpa.onnx.data.entity.SpeechSegment
import com.k2fsa.sherpa.onnx.data.entity.Topic
import com.k2fsa.sherpa.onnx.formatSectionPrefix

/**
 * Post-session LLM scoring + growth-oriented feedback.
 *
 * Now receives paragraph structure and per-section pause statistics so the
 * LLM can give precise feedback like "你在②细节段卡了 3 次，停顿总长 18 秒".
 */
class ScoringService(
    private val llmProvider: LlmProvider,
) {
    companion object {
        private const val TAG = "ScoringService"

        private val SYSTEM_PROMPT = """
你是 ADHD 学生写作教练。基于以下信息给反馈：
1. 不要只给分数，要给「成长型反馈」
2. 表扬连续表达时长、提示次数减少等进步点
3. 指出段落结构可改进处——如果某段学生说了很多、某段几乎没说，要指出
4. 分析停顿数据：如果某段卡顿次数多或停顿时间长，温和地指出并给建议
5. 比较各段的表达流畅度，指出做得最好的那段
6. 语气温暖鼓励，像教练而不是老师
7. 总字数控制在 180 字以内
        """.trimIndent()
    }

    /**
     * Score a completed dictation session.
     *
     * @param topic          The original essay topic
     * @param finalText      Concatenated full essay (student speech only)
     * @param segments       All speech segments for analysis
     * @param hintRecords    All hints given during the session
     * @param structure      Paragraph section labels for per-section analysis
     * @param sectionTexts   Per-section raw text (used to show what was said in each section)
     * @param onFeedback     Called with the full feedback text (or empty on error)
     */
    fun score(
        topic: Topic,
        finalText: String,
        segments: List<SpeechSegment>,
        hintRecords: List<HintRecord>,
        structure: List<StructureGenerator.Section>,
        sectionTexts: List<TextFormatter.SectionText>,
        onFeedback: (String) -> Unit,
    ) {
        val hintCount = hintRecords.size
        val levelDist = hintRecords.groupingBy { it.level }.eachCount()

        // Per-section statistics
        val sectionStats = StringBuilder()
        for ((i, st) in sectionTexts.withIndex()) {
            val prefix = formatSectionPrefix(i)
            val secSegs = segments.filter { it.sectionIndex == i }
            val segCount = secSegs.size
            val charCount = secSegs.sumOf { it.text.length }

            // Pause stats for this section (only ≥ 2s pauses)
            val pauses = secSegs.mapNotNull { it.precedingPauseMs }
            val pauseCount = pauses.size
            val longestPauseSec = pauses.maxOrNull()?.div(1000f) ?: 0f
            val totalPauseSec = pauses.sumOf { it } / 1000f

            sectionStats.appendLine(
                "$prefix${st.label}（${st.guide}）：${segCount}次说话，" +
                "共${charCount}字"
            )
            if (pauseCount > 0) {
                sectionStats.appendLine(
                    "  ↳ 停顿${pauseCount}次，最长${"%.0f".format(longestPauseSec)}秒，" +
                    "合计${"%.0f".format(totalPauseSec)}秒"
                )
            } else {
                sectionStats.appendLine("  ↳ 无显著停顿")
            }
        }

        // Overall pause stats
        val allPauses = segments.mapNotNull { it.precedingPauseMs }
        val overallLongestPauseSec = allPauses.maxOrNull()?.div(1000f) ?: 0f
        val overallPauseCount = allPauses.size

        // Longest fluent segment (consecutive segments without ≥2s gap)
        val maxFluentSec = segments
            .filter { it.text.isNotBlank() }
            .maxOfOrNull { it.endMs - it.startMs }
            ?.div(1000f) ?: 0f

        val userMessage = """
题目：${topic.title}

段落结构与发言量：
${sectionStats}

会话数据：
- 提示次数：${hintCount}，等级分布：${levelDist}
- 最长连续表达：${"%.0f".format(maxFluentSec)}秒
- 总停顿次数（≥2s）：${overallPauseCount}，最长单次：${"%.0f".format(overallLongestPauseSec)}秒

请给出成长型反馈。
        """.trimIndent()

        Log.d(TAG, "Scoring: hints=$hintCount pauses=$overallPauseCount " +
            "maxPause=${"%.0f".format(overallLongestPauseSec)}s")

        llmProvider.streamChat(
            systemPrompt = SYSTEM_PROMPT,
            messages = listOf(LlmProvider.Message(LlmProvider.ROLE_USER, userMessage)),
            temperature = 0.5,
            onDelta = { /* scoring is a one-shot result; ignore deltas */ },
            onDone = { fullText ->
                Log.d(TAG, "Scoring done: ${fullText.length} chars")
                onFeedback(fullText)
            },
            onError = { e ->
                Log.e(TAG, "Scoring failed", e)
                onFeedback("评分服务暂时不可用，请稍后重试。")
            },
        )
    }

}