package com.example.ai.di

import android.util.Log
import com.example.ai.data.auth.TokenManager
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 网络层单例 — 所有 OkHttp 请求共享同一个连接池和超时配置。
 *
 * 快速失败策略（2026-08 全局应用）：
 *  - connect=5s：局域网/服务端连不上时快速报错（原 30s 会干等）
 *  - read=120s：保留长读取，LLM 生成（题库/作文等）需要大响应窗口
 *  - write=15s：上传录音/图片的合理上限
 * 个别轻量接口（如模板拉取）可用 createHttpClient 或 newBuilder 派生更短超时。
 *
 * 认证策略：所有请求自动附加 JWT；收到 401 时用 refresh token 自动换取新
 * access token 并重放一次（access token 2h 过期，refresh 30 天）。刷新只重放
 * 一次，避免死循环；并发 401 由 @Synchronized 单飞，其余请求复用新 token。
 */
object NetworkModule {

    private var _httpClient: OkHttpClient? = null

    /** 无认证拦截器的纯净 client — 仅用于内部刷新 token，避免递归进入 AuthInterceptor */
    private val plainClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    /** 单例 OkHttpClient，所有 Repository / ViewModel 共用（双检锁，避免并发首访创建多个 client） */
    val httpClient: OkHttpClient
        get() {
            _httpClient?.let { return it }
            synchronized(this) {
                _httpClient?.let { return it }
                return createHttpClient().also { _httpClient = it }
            }
        }

    /** 如需独立超时的场景，可由此创建单独的 client */
    fun createHttpClient(
        connectTimeout: Long = 5,
        readTimeout: Long = 180, // 识图链路最长约 134s（Ark 90s 超时 + OCR 44s），120s 会误报超时
        writeTimeout: Long = 15,
    ): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(connectTimeout, TimeUnit.SECONDS)
        .readTimeout(readTimeout, TimeUnit.SECONDS)
        .writeTimeout(writeTimeout, TimeUnit.SECONDS)
        .addInterceptor(AuthInterceptor())
        .build()

    /** 重置单例（仅测试用） */
    fun resetForTest() {
        synchronized(this) { _httpClient = null }
    }

    // ── 认证拦截器：附加 JWT + 401 自动刷新重放 ──

    private class AuthInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val request = chain.request()
            val token = TokenManager.accessToken
            val authedRequest = if (token.isNotBlank()) {
                // 必须用 header() 替换而非 addHeader() 追加：
                // Repository 层可能已加过 Authorization，追加会产生两个同名头，
                // 服务端只取第一个 → 刷新重放时旧 token 排前面导致重放仍 401
                request.newBuilder().header("Authorization", "Bearer $token").build()
            } else {
                request
            }
            val response = chain.proceed(authedRequest)
            if (response.code != 401 || token.isBlank() || isAuthPath(request.url.encodedPath)) {
                return response
            }
            // 401：尝试用 refresh token 换新 access token 并重放一次（失败则透传 401）
            response.close()
            val newToken = refreshAccessToken(token) ?: return buildUnauthorizedResponse(response)
            val retry = request.newBuilder().header("Authorization", "Bearer $newToken").build()
            return chain.proceed(retry)
        }

        /** 登录/注册/刷新端点自身的 401 不触发刷新，避免死循环 */
        private fun isAuthPath(path: String): Boolean = path.startsWith("/api/v1/auth/")

        /**
         * 刷新失败时构造新的 401 响应返回。
         * 原 response 已 close()，直接返回会导致调用方读 body 抛 IllegalStateException("closed")。
         */
        private fun buildUnauthorizedResponse(original: Response): Response =
            original.newBuilder()
                .code(401)
                .message("Unauthorized")
                .body("""{"error":"refresh_failed"}""".toResponseBody("application/json".toMediaType()))
                .build()
    }

    /**
     * 刷新 access token（并发单飞：同一时刻只发一个刷新请求）。
     * @param oldToken 触发 401 的旧 token；若期间已被其他请求刷新成功则直接复用新 token。
     */
    @Synchronized
    private fun refreshAccessToken(oldToken: String): String? {
        // 并发 401 中已有请求刷新成功 → 直接用新 token
        val current = TokenManager.accessToken
        if (current != oldToken) return current.takeIf { it.isNotBlank() }

        val refreshToken = TokenManager.refreshToken
        if (refreshToken.isBlank()) return null
        return try {
            val body = JSONObject().put("refresh_token", refreshToken).toString()
                .toRequestBody("application/json".toMediaType())
            val req = okhttp3.Request.Builder()
                .url("${ServiceModule.serverBase}/api/v1/auth/refresh")
                .post(body)
                .build()
            plainClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "token 刷新失败: HTTP ${resp.code}")
                    return null
                }
                val json = JSONObject(resp.body?.string().orEmpty())
                val newAccess = json.optString("access_token")
                if (newAccess.isBlank()) return null
                TokenManager.accessToken = newAccess
                json.optString("refresh_token").takeIf { it.isNotBlank() }?.let {
                    TokenManager.refreshToken = it
                }
                Log.i(TAG, "token 刷新成功")
                newAccess
            }
        } catch (e: Exception) {
            Log.w(TAG, "token 刷新异常: ${e.message}")
            null
        }
    }

    private const val TAG = "NetworkModule"
}
