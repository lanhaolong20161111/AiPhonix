package com.example.ai.data.courseware

import android.util.Log
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder

/** 课件科目 — 与 web `CoursewareModule` / 服务端白名单一致（服务端只认这三个值） */
enum class CoursewareModule(val key: String, val label: String, val icon: String) {
    MATH("math", "数学", "🧮"),
    CHINESE("chinese", "语文", "📖"),
    ENGLISH("english", "英语", "📚");

    companion object {
        /** 与 web 的默认 tab 一致（web `useState` 默认 "chinese"） */
        val DEFAULT = CHINESE
    }
}

/** 一条课件（对齐服务端 mapRow：字段是 snake_case，故这里自己做映射） */
data class CoursewareItem(
    val id: Long = 0,
    val module: String = "",
    val fileName: String = "",
    val title: String = "",
    val createdAt: String = "",
)

/**
 * 课件库仓库（对齐 web `services/courseware.ts` + `server_cf/src/routes/courseware.ts`）。
 *
 * 契约要点（**以服务端为准**）：
 * - `GET /courseware?module=&limit=&offset=` → `{ total, items }`；`module` 服务端做白名单校验，
 *   非法值会被**静默忽略**（退化成"返回全部科目"），故调用方必须传枚举 key。
 * - `POST /courseware` 是 **multipart**（`file` + `module` + `title`），字段名不能改；
 *   失败时返回 `{ detail }`（如「图片超过 20MB 限制」）——把这个 detail 透出给用户最有信息量。
 * - `DELETE /courseware/{id}` 会同时删记录与 R2 文件。
 * - `GET /courseware/file/{fileName} **不鉴权**`（`<img src>` 带不了 Authorization，鉴权会裂图），
 *   所以 [imageUrl] 直接给 Coil 用，不要加 auth 头。
 */
class CoursewareRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 某科目课件（最新在前，上限服务端 300）；失败返回 null */
    suspend fun list(module: CoursewareModule, limit: Int = 100, offset: Int = 0): List<CoursewareItem>? =
        withContext(Dispatchers.IO) {
            val url = "$serverBase/api/v1/courseware" +
                "?module=${module.key}&limit=${limit.coerceIn(1, 300)}&offset=${offset.coerceAtLeast(0)}"
            val request = Request.Builder().url(url).get().auth().build()
            val json = executeJson(request) ?: return@withContext null
            buildList {
                val arr = json.optJSONArray("items") ?: JSONArray()
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    add(parseItem(o))
                }
            }
        }

    /**
     * 上传一张课件图。失败返回 `Result.failure`，其 message 已尽量取服务端的 `detail`
     * （例：`图片超过 20MB 限制`），可直接展示给用户。
     *
     * [fileName] 只用来推导扩展名与 multipart 的 filename（服务端会另生成 UUID 文件名）；
     * [title] 与 web 一致取"去扩展名的原文件名"，由调用方传入。
     */
    suspend fun upload(
        bytes: ByteArray,
        fileName: String,
        mimeType: String,
        module: CoursewareModule,
        title: String,
    ): Result<CoursewareItem> = withContext(Dispatchers.IO) {
        if (bytes.isEmpty()) return@withContext Result.failure(IOException("图片内容为空"))
        // 与服务端同一门槛，先本地拦掉省一次上传
        if (bytes.size > MAX_FILE_MB * 1024 * 1024) {
            return@withContext Result.failure(IOException("图片超过 ${MAX_FILE_MB}MB 限制"))
        }
        try {
            val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("file", fileName, bytes.toRequestBody(mimeType.toMediaType()))
                .addFormDataPart("module", module.key)
                .addFormDataPart("title", title)
                .build()
            val request = Request.Builder()
                .url("$serverBase/api/v1/courseware")
                .post(body)
                .auth()
                .build()
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                val json = runCatching { JSONObject(text) }.getOrNull()
                if (!resp.isSuccessful) {
                    val detail = json?.optString("detail").orEmpty().ifBlank { "HTTP ${resp.code}" }
                    Log.w(TAG, "上传失败 HTTP ${resp.code}: ${text.take(200)}")
                    return@use Result.failure(IOException(detail))
                }
                if (json == null) return@use Result.failure(IOException("响应格式异常"))
                Result.success(parseItem(json))
            }
        } catch (e: Exception) {
            Log.w(TAG, "上传异常: ${e.message}")
            Result.failure(IOException(e.message ?: "网络异常"))
        }
    }

    /** 删除一条（记录 + 服务端文件）；成功返回 true */
    suspend fun remove(id: Long): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/courseware/$id")
            .delete()
            .auth()
            .build()
        executeJson(request) != null
    }

    /**
     * 课件图片直链（**不需要** auth 头，见类注释）。
     * 文件名可能含中文/空格（原文件名只在服务端换名前的形态里出现，实际存的是 UUID），仍照 web 一样编码。
     */
    fun imageUrl(fileName: String): String =
        "$serverBase/api/v1/courseware/file/${URLEncoder.encode(fileName, "UTF-8")}"

    private fun parseItem(o: JSONObject): CoursewareItem = CoursewareItem(
        id = o.optLong("id", 0),
        module = o.optString("module", ""),
        fileName = o.optString("file_name", ""),
        title = o.optString("title", "").let { if (it == "null") "" else it },
        createdAt = o.optString("created_at", "").let { if (it == "null") "" else it },
    )

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

    companion object {
        /** 与服务端 `MAX_FILE_MB` 一致 */
        const val MAX_FILE_MB = 20

        /** 与 web `handleFiles` 一致：标题 = 去掉最后一个扩展名的文件名 */
        fun titleFromFileName(name: String): String = name.replace(Regex("\\.[^.]+$"), "")

        private const val TAG = "CoursewareRepository"
    }
}
