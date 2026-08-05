package com.example.ai.data.userimport

import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * 用户导入数据 → 服务端账户同步（POST /api/v1/user-imports/batch）。
 * 登录后才可同步；未登录时仅存本地（下次登录后由调用方触发）。
 */
class UserImportSync(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: okhttp3.OkHttpClient = NetworkModule.httpClient,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json".toMediaType()

    @Serializable
    private data class SyncItem(
        val kind: String,
        val text: String,
        val pinyin: String,
        val meaning: String,
        val tags: List<String>,
        val payload: String,
        val status: String,
    )

    @Serializable
    private data class SyncRequest(val items: List<SyncItem>)

    @Serializable
    private data class SyncResponse(
        val status: String = "",
        val added: Int = 0,
        val updated: Int = 0,
        val total: Int = 0,
        val items: List<SyncServerItem> = emptyList(),
    )

    @Serializable
    private data class SyncServerItem(
        val id: String = "",
        val kind: String = "",
        val text: String = "",
    )

    /** 同步结果：added/updated + 服务端 id 回填（key = "kind\u0000text"） */
    data class SyncOutcome(
        val added: Int,
        val updated: Int,
        val serverIds: Map<String, String>,
    )

    /** 同步一批条目到服务端账户；返回 SyncOutcome（含服务端 id 映射） */
    suspend fun sync(items: List<UserImportItem>): Result<SyncOutcome> = withContext(Dispatchers.IO) {
        if (items.isEmpty()) return@withContext Result.success(SyncOutcome(0, 0, emptyMap()))
        try {
            val body = json.encodeToString(
                SyncRequest.serializer(),
                SyncRequest(items.map { SyncItem(it.kind, it.text, it.pinyin, it.meaning, it.tags, it.payload, it.status) }),
            )
            val request = Request.Builder()
                .url("$serverBase/api/v1/user-imports/batch")
                .post(body.toRequestBody(mediaType))
                .build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    val detail = resp.body?.string()?.let {
                        runCatching { json.decodeFromString<SyncErrorBody>(it).detail }.getOrNull()
                    } ?: "HTTP ${resp.code}"
                    return@withContext Result.failure(RuntimeException(detail))
                }
                val parsed = json.decodeFromString<SyncResponse>(resp.body?.string().orEmpty())
                val serverIds = parsed.items
                    .filter { it.id.isNotBlank() && it.kind.isNotBlank() }
                    .associate { "${it.kind}\u0000${it.text}" to it.id }
                Result.success(SyncOutcome(parsed.added, parsed.updated, serverIds))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** 删除服务端某条记录（DELETE /api/v1/user-imports/{id}） */
    suspend fun delete(serverId: String): Result<Unit> = withContext(Dispatchers.IO) {
        if (serverId.isBlank()) return@withContext Result.success(Unit)
        try {
            val request = Request.Builder()
                .url("$serverBase/api/v1/user-imports/$serverId")
                .delete()
                .build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    val detail = resp.body?.string()?.let {
                        runCatching { json.decodeFromString<SyncErrorBody>(it).detail }.getOrNull()
                    } ?: "HTTP ${resp.code}"
                    Result.failure(RuntimeException(detail))
                } else {
                    Result.success(Unit)
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    @Serializable
    private data class SyncErrorBody(val detail: String = "")
}
