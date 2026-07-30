package com.k2fsa.sherpa.onnx.dictation

import android.util.Log
import com.k2fsa.sherpa.onnx.agent.LlmProvider

/**
 * Context-aware hint engine.
 *
 * Generates hints based on the full context:
 * - full essay topic
 * - current paragraph/section
* - how long the student has been stuck in this section
 * - what the student has already spoken in this section
 * - the specific type of help the student asks for
 *
 * All hints are concise (≤25 chars) and coaching-focused rather than
 * writing-for-the-student.
 */
class HintEngine(
    private val llmProvider: LlmProvider,
) {
    companion object {
        private const val TAG = "HintEngine"
        private const val MAX_RECENT_CHARS = 300
        private const val MAX_HINT_CHARS = 25
    }

    private fun buildSystemPrompt(
        topicTitle: String,
        topicContent: String,
        sectionInfo: String,
        studentSpokenText: String,
        stuckDurationMs: Long,
        hintType: String,
    ): String = buildString {
        appendLine("你是面向ADHD/阅读障碍学生的写作思维教练。")
        appendLine("请根据作文题目、当前段落要求、学生已说内容、学生卡住的时长，")
        appendLine("以及学生选择的提示类型，生成一个紧凑的写作提示。")
        appendLine()
        appendLine("要求：")
        appendLine("1. 控制在${MAX_HINT_CHARS}字以内；")
        appendLine("2. 只给学生「脚手架」，不替他写句子；")
        appendLine("3. 不要重复学生已经说过的内容；")
        appendLine("4. 学生选的困难类型是「${hintType}」，请针对这个类型给提示；")
        appendLine("5. 如果类型是「有点累了」，只给鼓励，不要提写作建议。")
        appendLine()
        appendLine("作文题目：${topicTitle}")
        appendLine("题目要求：${topicContent}")
        appendLine("当前段落：${sectionInfo}")
        appendLine("学生在当前段已说：${studentSpokenText.ifBlank { "（还没开始）" }.takeLast(MAX_RECENT_CHARS)}")
        appendLine("学生在当前段已卡住：${formatDuration(stuckDurationMs)}")
    }

    private fun buildUserMessage(hintType: String): String = when (hintType) {
        "有点累了" -> "学生有点累了，请给一句鼓励的话，不要提写作建议。"
        "找不到词" -> "学生找不到合适的词语，请给2-3个相关的词语或短句提示。"
        "开不了头" -> "学生开不了头，请给一个非常简短的开头方向或第一句话的思路。"
        "没想法" -> "学生没想法，请给1-2个具体的内容方向提示。"
        "帮我提示一下" -> "请根据上下文给出一个紧凑的提示，帮助学生继续往下说。"
        else -> "学生遇到困难「${hintType}」，请给出一个紧凑的提示。"
    }

    fun requestHint(
        topicTitle: String,
        topicContent: String,
        sectionInfo: String,
        studentSpokenText: String,
        stuckDurationMs: Long,
        hintType: String,
        onDelta: (String) -> Unit,
        onDone: (String) -> Unit,
        onError: (Throwable) -> Unit,
    ) {
        val prompt = buildSystemPrompt(
            topicTitle = topicTitle,
            topicContent = topicContent,
            sectionInfo = sectionInfo,
            studentSpokenText = studentSpokenText,
            stuckDurationMs = stuckDurationMs,
            hintType = hintType,
        )
        val userMessage = buildUserMessage(hintType)

        Log.d(TAG, "Hint: type=$hintType stuckMs=$stuckDurationMs")

        llmProvider.streamChat(
            systemPrompt = prompt,
            messages = listOf(LlmProvider.Message(LlmProvider.ROLE_USER, userMessage)),
            temperature = 0.3,
            onDelta = onDelta,
            onDone = { fullText ->
                Log.d(TAG, "Hint received: ${fullText.take(50)}...")
                onDone(fullText)
            },
            onError = { e ->
                Log.e(TAG, "Hint request failed", e)
                onError(e)
            },
        )
    }

    private fun formatDuration(ms: Long): String = when {
        ms < 1000 -> "不到1秒"
        ms < 60000 -> "${ms / 1000}秒"
        else -> "${ms / 60000}分${(ms % 60000) / 1000}秒"
    }
}
