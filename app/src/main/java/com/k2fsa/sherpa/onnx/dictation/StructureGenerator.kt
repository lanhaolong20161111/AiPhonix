package com.k2fsa.sherpa.onnx.dictation

import com.google.gson.Gson
import com.k2fsa.sherpa.onnx.agent.LlmProvider

/**
 * Uses LLM to generate a personalised paragraph structure for a given topic.
 */
class StructureGenerator(private val llmProvider: LlmProvider) {

    companion object {
        private val SYSTEM_PROMPT = """
你是写作结构设计师。给定一个作文题目，请生成一个 3-5 段的写作框架。
每个段落需要：label（短标题，2-4字）和 guide（一句话引导，≤15字）。
输出纯 JSON 数组，格式：
[{"label":"开头","guide":"一句话介绍这个主题"},{"label":"细节","guide":"描述具体的样子或特点"},...]
要求：label 简洁好记，guide 是指引不是答案，不适合写过长的内容。
        """.trimIndent()

        /** Default fallback sections used when LLM is unavailable or unconfigured. */
        fun defaultSections(): List<Section> = listOf(
            Section("开头", "开始说说这个题目"),
            Section("内容", "多说一点细节"),
            Section("故事", "讲一件相关的事"),
            Section("感受", "你心里怎么想的"),
        )
    }

    private val gson = Gson()

    data class Section(
        val label: String,
        val guide: String,
    )

    fun generate(topicTitle: String, topicContent: String, onResult: (List<Section>) -> Unit) {
        val userMessage = "题目：${topicTitle}\n内容：${topicContent}"

        llmProvider.streamChat(
            systemPrompt = SYSTEM_PROMPT,
            messages = listOf(LlmProvider.Message(LlmProvider.ROLE_USER, userMessage)),
            temperature = 0.3,
            onDelta = { /* structural, ignore deltas */ },
            onDone = { fullText ->
                val sections = try {
                    val json = fullText.trim()
                        .removePrefix("```json").removePrefix("```")
                        .removeSuffix("```").trim()
                    gson.fromJson(json, Array<SectionRaw>::class.java)
                        .map { Section(it.label, it.guide) }
                } catch (e: Exception) {
                    android.util.Log.e("StructureGen", "Parse failed", e)
                    defaultSections()
                }
                onResult(sections.takeIf { it.isNotEmpty() } ?: defaultSections())
            },
            onError = { e ->
                android.util.Log.e("StructureGen", "LLM error", e)
                onResult(defaultSections())
            },
        )
    }

    private data class SectionRaw(val label: String, val guide: String)
}
