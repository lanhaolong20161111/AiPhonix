package com.example.ai.data.userimport

import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.Request

/**
 * 提示词模板仓库 — 从服务端按需拉取（L2 防护：不打包进 APK，每次只拉需要的模板）。
 * 使用短超时客户端：局域网服务连不上应快速失败提示，而非干等全局 30s 超时。
 */
class ImportTemplateRepository(
    private val serverBase: String = ServiceModule.serverBase,
    baseClient: okhttp3.OkHttpClient = NetworkModule.httpClient,
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val client: okhttp3.OkHttpClient = baseClient.newBuilder()
        .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    /** 拉取全部模板（首次进入导入页时用） */
    suspend fun fetchAll(): Result<List<ImportTemplate>> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$serverBase/api/v1/import-templates")
                .get()
                .build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext Result.failure(
                    RuntimeException("服务器错误: ${resp.code}")
                )
                val body = resp.body?.string() ?: return@withContext Result.failure(RuntimeException("响应为空"))
                val parsed = json.decodeFromString<ImportTemplateListResponse>(body)
                Result.success(parsed.templates)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** 按 id 拉取单个模板 */
    suspend fun fetchOne(id: String): Result<ImportTemplate?> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$serverBase/api/v1/import-templates?id=$id")
                .get()
                .build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext Result.failure(
                    RuntimeException("服务器错误: ${resp.code}")
                )
                val body = resp.body?.string() ?: return@withContext Result.failure(RuntimeException("响应为空"))
                val parsed = json.decodeFromString<ImportTemplateSingleResponse>(body)
                Result.success(parsed.template)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
