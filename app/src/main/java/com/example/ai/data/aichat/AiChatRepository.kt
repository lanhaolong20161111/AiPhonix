package com.example.ai.data.aichat

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
import org.json.JSONObject

/** 一条会话消息（恢复历史会话用） */
data class AiChatMessage(
    val role: String = "",      // user / assistant
    val content: String = "",
)

/** /ai-chat/ask 响应 */
data class AiChatAskResult(
    val reply: String = "",
    val sessionId: String = "",
    val speakText: String = "",     // 建议朗读的文本（tts_url 字段，实为文本）
    val wordInfo: String = "",      // 查词结果
    val correction: String = "",    // 改错后的完整句子（无则空）
    val judge: Int? = null,         // 判卷 1/0（仅小豆模式）
)

/** /ai-chat/session 响应（恢复历史会话） */
data class AiChatSession(
    val sessionId: String = "",
    val module: String = "",
    val messages: List<AiChatMessage> = emptyList(),
)

/**
 * AI 对话仓库 — 对应服务端 /ai-chat/ask（带画像多模态会话）与 /ai-chat/session（恢复会话）。
 * module: chinese / math / english（服务端按模块选老师人设与画像）。
 * 会话由服务端按 session_id 续存：客户端只需带上次返回的 session_id 即可断点续聊。
 */
class AiChatRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 提问（非流式，90s 服务端超时）：返回回复 + 会话 id（下次带上可续聊） */
    suspend fun ask(
        module: String,
        message: String,
        sessionId: String = "",
    ): AiChatAskResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("module", module)
            put("message", message)
            if (sessionId.isNotBlank()) put("session_id", sessionId)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chat/ask")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request)
            ?: throw java.io.IOException("无法连接服务器，请检查网络后重试")
        if (json.has("detail") && json.optString("reply", "").isEmpty()) {
            throw java.io.IOException(json.optString("detail", "AI 调用失败"))
        }
        AiChatAskResult(
            reply = json.optString("reply", ""),
            sessionId = json.optString("session_id", sessionId),
            speakText = json.optString("tts_url", ""),
            wordInfo = json.optString("word_info", ""),
            correction = json.optJSONObject("correction")?.optString("corrected", "") ?: "",
            judge = if (json.has("judge")) json.optInt("judge") else null,
        )
    }

    /** 恢复历史会话消息（仅本人会话）；失败返回 null */
    suspend fun fetchSession(sessionId: String): AiChatSession? = withContext(Dispatchers.IO) {
        if (sessionId.isBlank()) return@withContext null
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chat/session?session_id=${java.net.URLEncoder.encode(sessionId, "UTF-8")}")
            .get()
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext null
        val msgs = buildList {
            val arr = json.optJSONArray("messages") ?: org.json.JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val content = o.optString("content", "")
                if (content.isBlank()) continue
                add(AiChatMessage(role = o.optString("role", ""), content = content))
            }
        }
        AiChatSession(
            sessionId = json.optString("session_id", sessionId),
            module = json.optString("module", ""),
            messages = msgs,
        )
    }

    private fun executeJson(request: Request): JSONObject? {
        return try {
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "HTTP ${resp.code}: ${resp.body?.string()?.take(200)}")
                    null
                } else {
                    val s = resp.body?.string() ?: return@use null
                    JSONObject(s)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "请求异常: ${e.message}")
            null
        }
    }

    private companion object {
        private const val TAG = "AiChatRepository"
    }
}
