package com.k2fsa.sherpa.onnx.dictation

import com.k2fsa.sherpa.onnx.agent.LlmProvider
import com.k2fsa.sherpa.onnx.formatSectionPrefix

/**
 * Post-processes raw dictation text through LLM:
 *   1. Assembles scattered sentences within each section into coherent text
 *   2. Adds punctuation
 *   3. Formats by paragraph section (① ② ③...) — preserves section boundaries
 *   4. Highlights non-standard grammar with 【...】
 *
 * Unlike the old behaviour, [format] now receives pre-segmented text so
 * the LLM cannot reorder content across section boundaries.
 */
class TextFormatter(private val llmProvider: LlmProvider) {

    /** A single section's text with its label and guide. */
    data class SectionText(
        val label: String,
        val guide: String,
        val text: String,
    )

    companion object {
        private const val TAG = "TextFormatter"

        private val SYSTEM_PROMPT = """
你是中文写作润饰助手。请对学生口述作文做以下处理，不要修改学生原意：

1. 学生说话已经被分成几个段落（用 [①标签] 标记）。请对每个段落内部做润饰：加入标点、合并零散句子，但**不要把 A 段的内容挪到 B 段**。
2. 每段用 ① ② ③ 开头，后面空两个中文字符再开始正文
3. 对不符合中文表达习惯的地方进行标记和修正。**特别注意：学生的原文来自语音识别，可能有识别错误（同音字、近音字）。请结合整句语义逻辑来判断：**
   - 先通读整句话理解想表达的意思
   - 如果某个词在语法上能说通但与上下文矛盾（如"自由地不能跑"出现在无拘束的场景），**考虑这是语音识别错误**，根据前后文的语义逻辑给出合理修正
   - 用【错误】标记问题词，紧接写（建议：正确说法）
   - 示例：原文"我们可以无拘无束地自由地不能跑，游泳" → ③　【不能跑】（建议：奔跑）
4. 保持学生用词风格，不添加新内容
5. 如果某段学生没有说话，直接写“①　（本段没有内容）”，不要编造

输出示例：
①　今天我和好朋友小明一起去了公园。
②　公园里有一个很大的湖，湖边开了许多花。
③　【我们玩了高兴】（建议：我们玩得很高兴）

输出纯文本，不要JSON，不要解释。
        """.trimIndent()
    }

    /**
     * Format student's speech with section boundaries preserved.
     *
     * @param sectionTexts  One entry per paragraph section (label + guide + raw text).
     * @param onResult      Called with the formatted text.
     */
    fun format(
        sectionTexts: List<SectionText>,
        onResult: (String) -> Unit,
    ) {
        val userMessage = buildString {
            appendLine("请按以下段落结构润饰，不要跨段移动内容：")
            appendLine()
            for ((i, st) in sectionTexts.withIndex()) {
                val prefix = formatSectionPrefix(i)
                appendLine("[$prefix${st.label}] ${st.guide}")
                if (st.text.isNotBlank()) {
                    appendLine(st.text)
                } else {
                    appendLine("（学生没有说话）")
                }
                appendLine()
            }
        }.trim()

        llmProvider.streamChat(
            systemPrompt = SYSTEM_PROMPT,
            messages = listOf(LlmProvider.Message(LlmProvider.ROLE_USER, userMessage)),
            temperature = 0.3,
            onDelta = { /* one-shot result */ },
            onDone = { fullText ->
                onResult(fullText.trim())
            },
            onError = { e ->
                android.util.Log.e(TAG, "Format failed", e)
                // fallback: return raw text as-is
                onResult(sectionTexts.joinToString("\n\n") {
                    "${formatSectionPrefix(sectionTexts.indexOf(it))}${it.label}：${it.text}"
                })
            },
        )
    }

}
