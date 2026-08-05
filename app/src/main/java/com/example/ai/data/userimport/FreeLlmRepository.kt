package com.example.ai.data.userimport

import android.content.Context
import android.net.Uri
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * 免费 LLM（火山引擎送 token）仓库：
 * - chat(prompt, imageUrls) — 调服务端 /api/v1/free-llm/chat（文本或文本+图片）
 * - uploadPhoto(uri) — 拍照照片上传服务端拿相对 URL，供 chat 引用
 * 认证走 NetworkModule 全局拦截器（自动带 token + 401 刷新重放）。
 */
class FreeLlmRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: okhttp3.OkHttpClient = NetworkModule.httpClient,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json".toMediaType()

    @Serializable
    private data class ChatRequest(val prompt: String, val image_urls: List<String> = emptyList())

    @Serializable
    private data class ChatResponse(val text: String = "")

    @Serializable
    private data class UploadResponse(val url: String = "")

    @Serializable
    private data class ErrorBody(val detail: String = "")

    /** 上传一张照片 → 服务端相对 URL（如 /api/v1/uploads/file/xxx.jpg） */
    suspend fun uploadPhoto(uri: Uri, context: Context): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IOException("无法读取照片")
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", "ai_import.jpg", bytes.toRequestBody("image/jpeg".toMediaType()))
                .addFormDataPart("note", "导入中心免费AI")
                .addFormDataPart("origin", "import_center")
                .addFormDataPart("uploader", TokenManager.username.ifBlank { "unknown" })
                .build()
            val request = Request.Builder()
                .url("$serverBase/api/v1/uploads/photo")
                .post(body)
                .build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) throw IOException("上传失败 HTTP ${resp.code}")
                val out = json.decodeFromString<UploadResponse>(resp.body?.string().orEmpty())
                out.url.ifBlank { throw IOException("上传响应缺少 url") }
            }
        }
    }

    /** 免费 LLM 推理：文本或文本+图片 */
    suspend fun chat(prompt: String, imageUrls: List<String> = emptyList()): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val body = json.encodeToString(ChatRequest.serializer(), ChatRequest(prompt, imageUrls))
            val request = Request.Builder()
                .url("$serverBase/api/v1/free-llm/chat")
                .post(body.toRequestBody(mediaType))
                .build()
            client.newCall(request).execute().use { resp ->
                val raw = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    val detail = runCatching { json.decodeFromString<ErrorBody>(raw).detail }.getOrNull()
                        ?: "HTTP ${resp.code}"
                    throw IOException(detail)
                }
                json.decodeFromString<ChatResponse>(raw).text
            }
        }
    }
}
