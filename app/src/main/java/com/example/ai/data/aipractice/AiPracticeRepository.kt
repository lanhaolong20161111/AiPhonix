package com.example.ai.data.aipractice

import android.util.Log
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/** 会话摘要（历史列表项） */
data class AiPracticeSessionSummary(
    val sessionId: Int,
    val content: String,
    val contentType: String,
    val task: String,
    val status: String,
    val turnCount: Int,
    val createdAt: String,
)

/** 单条对话轮次 */
data class AiPracticeTurn(
    val role: String,        // "ai" | "user"
    val text: String,
    val correction: String = "",
    val praise: String = "",
    val audioPath: String = "",
)

/** 会话详情 */
data class AiPracticeSessionDetail(
    val sessionId: Int,
    val content: String,
    val contentType: String,
    val task: String,
    val status: String,
    val turns: List<AiPracticeTurn>,
)

/** 创建会话结果 */
data class AiPracticeCreateResult(
    val sessionId: Int,
    val question: String,
)

/** 一轮聊天结果 */
data class AiPracticeChatResult(
    val correction: String,
    val praise: String,
    val question: String,
    val done: Boolean,
)

/**
 * ai陪我练 Repository — 服务端 /api/v1/ai-practice 代理。
 * 会话按用户隔离（JWT Bearer）。
 */
class AiPracticeRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {
    companion object {
        private const val TAG = "AiPracticeRepo"
    }

    private val mediaType = "application/json".toMediaType()

    private fun Request.Builder.auth(): Request.Builder {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
        return this
    }

    suspend fun createSession(content: String, contentType: String, task: String): AiPracticeCreateResult =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("content", content)
                put("content_type", contentType)
                put("task", task)
            }
            val req = Request.Builder()
                .url("$serverBase/api/v1/ai-practice/sessions")
                .post(body.toString().toRequestBody(mediaType))
                .auth()
                .build()
            val json = executeJson(req)
            AiPracticeCreateResult(
                sessionId = json.getInt("session_id"),
                question = json.optString("question", ""),
            )
        }

    suspend fun chat(sessionId: Int, text: String): AiPracticeChatResult =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply { put("text", text) }
            val req = Request.Builder()
                .url("$serverBase/api/v1/ai-practice/sessions/$sessionId/chat")
                .post(body.toString().toRequestBody(mediaType))
                .auth()
                .build()
            val json = executeJson(req)
            AiPracticeChatResult(
                correction = json.optString("correction", ""),
                praise = json.optString("praise", ""),
                question = json.optString("question", ""),
                done = json.optBoolean("done", false),
            )
        }

    suspend fun listSessions(): List<AiPracticeSessionSummary> =
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("$serverBase/api/v1/ai-practice/sessions")
                .get()
                .auth()
                .build()
            val json = executeJson(req)
            val arr = json.optJSONArray("sessions") ?: JSONArray()
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    add(
                        AiPracticeSessionSummary(
                            sessionId = o.getInt("session_id"),
                            content = o.optString("content", ""),
                            contentType = o.optString("content_type", ""),
                            task = o.optString("task", ""),
                            status = o.optString("status", ""),
                            turnCount = o.optInt("turn_count", 0),
                            createdAt = o.optString("created_at", ""),
                        )
                    )
                }
            }
        }

    suspend fun getSessionDetail(sessionId: Int): AiPracticeSessionDetail =
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("$serverBase/api/v1/ai-practice/sessions/$sessionId")
                .get()
                .auth()
                .build()
            val json = executeJson(req)
            val turns = buildList {
                val arr = json.optJSONArray("turns") ?: JSONArray()
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    add(
                        AiPracticeTurn(
                            role = o.optString("role", "ai"),
                            text = o.optString("text", ""),
                            correction = o.optString("correction", ""),
                            praise = o.optString("praise", ""),
                            audioPath = o.optString("audio_path", ""),
                        )
                    )
                }
            }
            AiPracticeSessionDetail(
                sessionId = json.getInt("session_id"),
                content = json.optString("content", ""),
                contentType = json.optString("content_type", ""),
                task = json.optString("task", ""),
                status = json.optString("status", ""),
                turns = turns,
            )
        }

    private fun executeJson(req: Request): JSONObject {
        val resp = client.newCall(req).execute()
        val respBody = resp.body?.string() ?: "{}"
        if (!resp.isSuccessful) {
            Log.w(TAG, "HTTP ${resp.code}: $respBody")
            throw Exception("服务端错误（${resp.code}）")
        }
        return JSONObject(respBody)
    }
}
