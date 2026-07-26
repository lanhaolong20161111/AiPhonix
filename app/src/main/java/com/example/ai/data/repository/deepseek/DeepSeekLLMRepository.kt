package com.example.ai.data.repository.deepseek

import android.util.Log
import com.example.ai.data.model.PronunciationResult
import com.example.ai.data.repository.LLMRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * LLM Repository — 通过服务端 /api/v1/llm/chat 代理调用，
 * 所有系统提示词在服务端 config.yaml 管理，客户端不持有 API Key
 */
class DeepSeekLLMRepository(
    private val serverBase: String,
) : LLMRepository {

    companion object {
        private const val TAG = "DeepSeekLLMRepo"
    }

    private val mediaType = "application/json".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /** 调用服务端 LLM 代理 */
    private suspend fun callChat(mode: String, message: String): String {
        return withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("message", message)
                put("mode", mode)
            }
            val req = Request.Builder()
                .url("$serverBase/api/v1/llm/chat")
                .post(body.toString().toRequestBody(mediaType))
                .build()
            val resp = client.newCall(req).execute()
            val respBody = resp.body?.string() ?: "{}"
            val json = JSONObject(respBody)
            val reply = json.optString("reply", "")
            if (reply.isEmpty()) {
                Log.w(TAG, "服务端返回空回复: $respBody")
            }
            reply
        }
    }

    override suspend fun generateFeedback(result: PronunciationResult): String {
        val phonemeDetails = result.phonemeScores.joinToString("\n") { score ->
            "  - ${score.phoneme}: ${score.score}分"
        }
        val prompt = buildString {
            append("用户读了单词 \"${result.word}\" ，得分 ${result.totalScore} 分。\n")
            if (phonemeDetails.isNotBlank()) {
                append("音素得分详情：\n$phonemeDetails\n")
            }
            append("请给出简短的发音改进建议（不超过3句话，用emoji）。")
        }
        return callChat("english", prompt)
    }

    override suspend fun generateLetterLesson(letter: String): String {
        val prompt = "请教字母 \"$letter\" 的发音和口型要点（不超过3句话，用emoji）。"
        return callChat("english", prompt)
    }

    override suspend fun generateLessonPlan(progress: Map<String, Any>): String {
        val progressStr = progress.entries.joinToString("\n") { "  ${it.key}: ${it.value}" }
        val prompt = "用户的学习进度如下：\n$progressStr\n请根据进度生成一个简短的学习计划（不超过5句话）。"
        return callChat("english", prompt)
    }

    override suspend fun generateQuizItems(subtitleText: String): String {
        return withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("subtitle_text", subtitleText)
                put("video_name", "auto")
                put("count", 30)
            }
            val req = Request.Builder()
                .url("$serverBase/api/v1/llm/quiz-generate")
                .post(body.toString().toRequestBody(mediaType))
                .build()
            val resp = client.newCall(req).execute()
            val respBody = resp.body?.string() ?: "[]"
            // 服务端返回 { "items": [...] } 或直接数组
            try {
                val json = JSONObject(respBody)
                val items = json.optJSONArray("items")
                if (items != null) return@withContext items.toString()
            } catch (_: Exception) {}
            respBody // 原样返回，由调用方解析
        }
    }
}
