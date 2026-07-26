package com.example.ai.data.quiz

import android.util.Log
import com.example.ai.data.repository.LLMRepository
import kotlinx.serialization.json.*

/**
 * 通过 LLM 从字幕文本生成考试题目。
 */
class QuizGenerator(
    private val llmRepository: LLMRepository,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * 根据字幕内容生成题库。失败时返回空列表。
     */
    suspend fun generate(videoName: String, subtitleText: String): QuizBank {
        val rawJson = llmRepository.generateQuizItems(subtitleText)
        Log.d("QuizGenerator", "LLM 返回: ${rawJson.take(200)}")
        val items = parseQuizItems(rawJson)
        Log.d("QuizGenerator", "解析到 ${items.size} 条题目")
        return QuizBank(videoName = videoName, items = items)
    }

    private fun parseQuizItems(jsonStr: String): List<QuizItem> {
        // 清理 markdown 代码块标记（LLM 有时会返回 ```json ... ```）
        val cleaned = jsonStr
            .replace(Regex("""```(?:json)?\s*"""), "")
            .trim()

        if (cleaned.isBlank() || !cleaned.startsWith("[")) {
            Log.w("QuizGenerator", "LLM 响应不是 JSON 数组: ${cleaned.take(200)}")
            return emptyList()
        }

        return try {
            // 用 JsonElement 解析，避免 Map<String, Any> 序列化问题
            val jsonArray = json.decodeFromString<JsonArray>(cleaned)
            jsonArray.mapNotNull { element ->
                val obj = element.jsonObject
                val english = obj["english"]?.jsonPrimitive?.contentOrNull?.trim()
                    ?: return@mapNotNull null
                val chinese = obj["chinese"]?.jsonPrimitive?.contentOrNull?.trim()
                    ?: return@mapNotNull null
                val difficulty = obj["difficulty"]?.jsonPrimitive?.intOrNull ?: 1
                val display = obj["display"]?.jsonPrimitive?.contentOrNull?.trim()
                val blankAnswer = obj["blankAnswer"]?.jsonPrimitive?.contentOrNull?.trim()
                if (english.isBlank() || chinese.isBlank()) null
                else QuizItem(english, chinese, difficulty, display, blankAnswer)
            }
        } catch (e: Exception) {
            Log.e("QuizGenerator", "LLM 响应解析失败，内容(前300字): ${cleaned.take(300)}", e)
            emptyList()
        }
    }
}
