package com.example.ai.data.articlereading

import com.example.ai.data.userimport.UserImportItem
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** 一段文章的录音口述总结 */
@Serializable
data class ParagraphSummary(
    val index: Int,
    val text: String = "",          // 孩子口述的概括（ASR 转文字）
    val audioPath: String = "",     // 口述录音 wav 文件（相对 filesDir 的路径）
    val updatedAt: Long = 0L,
)

/** 读后问题（来源：本地题库匹配 matched / LLM 生成 llm） */
@Serializable
data class ArticleQuestion(
    val text: String,
    val options: List<String> = emptyList(),
    val answer: String = "",
    val source: String = "matched", // matched | llm
)

/** 用户对某题的口述回答 */
@Serializable
data class ArticleAnswer(
    val questionIndex: Int,
    val spokenText: String = "",
    val audioPath: String = "",
    val updatedAt: Long = 0L,
)

/** 一次文章跟读会话（段落口述 + 问题 + 回答） */
@Serializable
data class ArticleSession(
    val articleKey: String,              // 唯一键：title（稳定去重）
    val title: String,
    val summaries: List<ParagraphSummary> = emptyList(),
    val questions: List<ArticleQuestion> = emptyList(),
    val answers: List<ArticleAnswer> = emptyList(),
    val finishedAt: Long = 0L,           // 完成阅读时间（>0 表示已进入答题）
)

/** 解析后的文章：标题 + 段落列表 */
data class ArticleContent(
    val title: String,
    val paragraphs: List<String>,
)

/**
 * 从导入的 article 条目中提取标题与正文段落。
 * 正文来源优先级：payload.content（字符串/数组）→ payload.paragraphs（数组）→ payload.text。
 */
object ArticleContentParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(item: UserImportItem): ArticleContent {
        val title = item.text.trim()
        val body = extractBody(item.payload)
        val paragraphs = body
            .split(Regex("""\n\s*\n|\n"""))
            .map { it.trim() }
            .filter { it.isNotBlank() }
        return ArticleContent(title = title, paragraphs = paragraphs)
    }

    private fun extractBody(payloadJson: String): String {
        if (payloadJson.isBlank()) return ""
        val obj = try {
            json.parseToJsonElement(payloadJson).jsonObject
        } catch (_: Exception) {
            return ""
        }
        // 1. content（字符串或数组）
        obj["content"]?.let { el -> toStringValue(el)?.let { if (it.isNotBlank()) return it } }
        // 2. paragraphs（数组）
        obj["paragraphs"]?.let { el ->
            if (el is JsonArray) {
                val joined = el.mapNotNull { toStringValue(it) }
                    .filter { it.isNotBlank() }
                    .joinToString("\n")
                if (joined.isNotBlank()) return joined
            } else {
                toStringValue(el)?.let { if (it.isNotBlank()) return it }
            }
        }
        // 3. text（若与标题不同）
        obj["text"]?.let { el -> toStringValue(el)?.let { if (it.isNotBlank()) return it } }
        return ""
    }

    /** JsonElement → String：字符串直接取，数组 join，对象忽略 */
    private fun toStringValue(el: JsonElement): String? = when (el) {
        is JsonObject -> null
        is JsonArray -> el.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull }
            .joinToString("，")
        else -> el.jsonPrimitive.contentOrNull
    }
}

/** 导入的 quiz 题目（供匹配） */
data class ImportedQuizQuestion(
    val text: String,
    val options: List<String> = emptyList(),
    val answer: String = "",
    val explanation: String = "",
)

/** 从 UserImportItem(kind=quiz) 的 payload 解析题目 */
object ImportedQuizParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(item: UserImportItem): ImportedQuizQuestion {
        val text = item.text.trim()
        var options: List<String> = emptyList()
        var answer = ""
        var explanation = ""
        if (item.payload.isNotBlank()) {
            try {
                val obj = json.parseToJsonElement(item.payload).jsonObject
                options = obj["options"]?.let { el ->
                    (el as? JsonArray)?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull }
                        ?: emptyList()
                } ?: emptyList()
                answer = obj["answer"]?.jsonPrimitive?.contentOrNull?.trim() ?: ""
                explanation = obj["explanation"]?.jsonPrimitive?.contentOrNull?.trim() ?: ""
            } catch (_: Exception) { }
        }
        return ImportedQuizQuestion(text, options, answer, explanation)
    }
}
