package com.example.ai.data.asr

import android.util.Base64
import android.util.Log
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

/**
 * 短语音识别（一次性上传 PCM）—— `POST /api/v1/asr/short`
 * （对齐 `server_cf/src/routes/asr.ts`，服务端转百度短语音接口）。
 *
 * 与 SOE 评测（`/soe/evaluate`）的区别：这里只做**识别**（音频 → 文本），不打分。
 * 与 `/asr/stream`（WebSocket 双向流式）的区别：所有语音一次上传，**没有实时中间文本**。
 *
 * 契约要点（**以服务端为准**）：
 * - 请求体 `{lang: "zh"|"en", audio: base64(PCM 16k/16bit/mono)}`；**不需要鉴权**
 *   （服务端无 `requireAuth()`；Android 仍习惯性带 token，无害）。
 * - 服务端对 `raw.length < 1600` 直接 **422**；百度没识别出内容也是 **422**
 *   （"未识别到内容（音频过短或太吵）"）。
 * - 因此 **422 语义上等于「没听到话」**，本类把它归一化成 `Result.success("")`，
 *   让调用方与「请求失败」分开处理（对齐 web 里 `said` 为空串的分支）。
 * - 其余非 2xx 带 `{detail}`（400 音频非法 / 500 取 token 失败 / 502 百度侧失败）。
 */
class AsrRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    /**
     * 识别一段 PCM。
     * @param pcm 16k/16bit/mono 原始 PCM
     * @param lang `"en"`（默认）或 `"zh"`；服务端只认 `"en"` 是英文，其余一律中文
     * @return `Result.success(text)`（识别成功；`text` 为空串 = 没听到话）或 `Result.failure`
     *         （`exception.message` 是可直接展示给用户的中文 detail）
     */
    suspend fun recognize(pcm: ByteArray, lang: String = "en"): Result<String> =
        withContext(Dispatchers.IO) {
            try {
                val body = JSONObject().apply {
                    put("lang", lang)
                    put("audio", Base64.encodeToString(pcm, Base64.NO_WRAP))
                }.toString().toRequestBody(JSON)
                val request = Request.Builder()
                    .url("$serverBase/api/v1/asr/short")
                    .post(body)
                    .apply {
                        val token = TokenManager.accessToken
                        if (token.isNotBlank()) header("Authorization", "Bearer $token")
                    }
                    .build()
                client.newCall(request).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    if (resp.isSuccessful) {
                        Result.success(JSONObject(text).optString("text", "").trim())
                    } else if (resp.code == 422) {
                        // 音频太短 / 百度没识别出内容 —— 与"请求失败"分开
                        Log.d(TAG, "无有效语音: $text")
                        Result.success("")
                    } else {
                        Result.failure(IOException(detailOf(resp.code, text)))
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    private fun detailOf(code: Int, bodyStr: String): String {
        val d = try {
            JSONObject(bodyStr).optString("detail", "")
        } catch (_: Exception) {
            ""
        }
        return d.ifBlank { "语音识别失败（HTTP $code）" }
    }

    private companion object {
        private const val TAG = "AsrRepository"
    }
}
