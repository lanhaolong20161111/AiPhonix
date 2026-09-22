package com.example.ai.data.dailyzh

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

/** `GET /daily-zh` 的响应：今日配置 / 最近一次（供预填）/ 服务端认定的日期 */
data class DailyZhFetch(
    val config: DailyZhConfig? = null,
    val last: DailyZhConfig? = null,
    val date: String = "",
)

/**
 * 每日一练·语文配置仓库（对齐 web `services/dailyZh.ts` + `server_cf/src/routes/daily_zh.ts`）。
 *
 * 契约要点（**以服务端为准**）：
 * - `GET /daily-zh?date=` 是**可选鉴权**（服务端 `resolveCurrentUser(auth, true)`）：
 *   未登录不报错，直接返回 `{config:null, last:null, date}`。所以"未登录"与"请求失败"要分开——
 *   未登录走本地镜像（[DailyZhStore]），请求失败也回退镜像，但**不要**拿空结果覆盖镜像。
 * - `PUT /daily-zh` 需要鉴权；body 的 `date` 可省（服务端按**东八区**今天），
 *   字段名是 `chars / words / sentences / essayTopic`（**驼峰**，与 GET 返回一致）。
 * - 服务端语义：当天没设时 `config=null` 且回传 `last` 供前端预填草稿，**不会**自动落今日库。
 */
class DailyZhRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 拉取今日配置（未登录也会成功，返回全 null）；失败返回 null */
    suspend fun fetch(date: String? = null): DailyZhFetch? = withContext(Dispatchers.IO) {
        val url = if (date.isNullOrBlank()) {
            "$serverBase/api/v1/daily-zh"
        } else {
            "$serverBase/api/v1/daily-zh?date=${java.net.URLEncoder.encode(date, "UTF-8")}"
        }
        val request = Request.Builder().url(url).get().auth().build()
        val json = executeJson(request) ?: return@withContext null
        DailyZhFetch(
            config = json.optJSONObject("config")?.let(::parseConfig),
            last = json.optJSONObject("last")?.let(::parseConfig),
            date = json.optString("date", ""),
        )
    }

    /** 保存今日配置（upsert 当前账号 + 日期）；成功返回 true */
    suspend fun save(cfg: DailyZhConfig, date: String? = null): Boolean = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("chars", cfg.chars)
            put("words", cfg.words)
            put("sentences", cfg.sentences)
            put("essayTopic", cfg.essayTopic)
            if (!date.isNullOrBlank()) put("date", date)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/daily-zh")
            .put(body)
            .auth()
            .build()
        executeJson(request) != null
    }

    private fun parseConfig(o: JSONObject): DailyZhConfig = DailyZhConfig(
        chars = o.optString("chars", ""),
        words = o.optString("words", ""),
        sentences = o.optString("sentences", ""),
        essayTopic = o.optString("essayTopic", ""),
        updatedAt = o.optString("updatedAt", "").let { if (it == "null") "" else it },
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

    private companion object {
        private const val TAG = "DailyZhRepository"
    }
}
