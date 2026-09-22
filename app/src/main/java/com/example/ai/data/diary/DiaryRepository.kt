package com.example.ai.data.diary

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

/**
 * 作文润色结果：polish=润色后的日记，comment=AI 的温暖点评。
 * 解析策略对齐 web DiaryPage：按第一个空行切分（reply 拆不开时 comment 取整段）。
 */
data class DiaryPolish(val polish: String, val comment: String)

/**
 * 成长日记仓库 — 调服务端 /api/v1/llm/chat（mode=chinese）做润色 + 点评。
 * 提示词与 web DiaryPage 完全一致；System Prompt 在服务端管理，客户端不持有 Key。
 */
class DiaryRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    /** 润色 + 点评；失败返回 null */
    suspend fun polish(text: String): DiaryPolish? = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put(
                "message",
                "我是一个小学生，这是我今天的日记，请你：1）帮我把句子改得更通顺优美（保留我的原意和用词难度）；" +
                    "2）用温暖鼓励的语气给我 2-3 句点评，可以提一个小建议或问一个小问题。" +
                    "格式：第一行输出润色后的日记，空一行后输出点评。【我的日记】$text",
            )
            put("mode", "chinese")
        }.toString().toRequestBody(JSON)

        val builder = Request.Builder()
            .url("$serverBase/api/v1/llm/chat")
            .post(body)
        val token = TokenManager.accessToken
        if (token.isNotBlank()) builder.header("Authorization", "Bearer $token")

        val reply = try {
            client.newCall(builder.build()).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "HTTP ${resp.code}: ${resp.body?.string()?.take(200)}")
                    return@withContext null
                }
                JSONObject(resp.body?.string() ?: "{}").optString("reply", "")
            }
        } catch (e: Exception) {
            Log.w(TAG, "请求异常: ${e.message}")
            return@withContext null
        }

        if (reply.isBlank()) return@withContext null
        // 拆润色与点评：第一个空行分界
        val parts = reply.split(Regex("\n{2,}"))
        val polish = parts.firstOrNull()?.trim().orEmpty()
        val comment = parts.drop(1).joinToString("\n").trim().ifBlank { reply.trim() }
        DiaryPolish(polish = polish, comment = comment)
    }

    private companion object {
        private const val TAG = "DiaryRepository"
    }
}
