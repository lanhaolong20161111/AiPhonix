package com.example.ai.data.zhteach

import android.util.Log
import com.example.ai.data.auth.TokenManager
import kotlinx.coroutines.CancellationException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * 「AI 对话学语文」三个仓储（[ZhTeachRepository] / [ZhPoemRepository] / [ZhReciteRepository]）共用的 HTTP 工具。
 *
 * 项目里其它仓储（`DailyZhRepository` / `CoursewareRepository`）各自内联了一份 `executeJson`，
 * 此处三个仓储要共用同一套语义，故抽出来。
 *
 * 语义要点：
 * - `/llm/` 前缀的端点服务端**都要求鉴权**（`resolveCurrentUser(Authorization)`，无第二个参数 = 必需）。
 * - 失败时服务端返回 `{detail: "..."}`（400/422/500），web 的 `api()` 会把 detail 抛成 Error
 *   并由页面显示 `String(e.message)`。所以这里的失败消息也**优先取 detail**。
 */
internal object ZhTeachHttp {

    private const val TAG = "ZhTeachHttp"

    val JSON: okhttp3.MediaType = "application/json; charset=utf-8".toMediaType()

    /** 附加 Authorization 头（无 token 时不加，让服务端返回 401 而不是本地提前失败） */
    fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 把 `{detail}` 从错误响应里取出；取不到则给一句带状态码的兜底 */
    private fun detailOf(code: Int, bodyStr: String?): String {
        val d = try {
            JSONObject(bodyStr ?: "").optString("detail", "")
        } catch (_: Exception) {
            ""
        }
        return d.ifBlank { "请求失败（HTTP $code）" }
    }

    /**
     * 执行请求并解析 JSON 对象；**失败抛异常**（消息为服务端 detail）。
     * 调用方用 [guard] 转成 `Result`。
     */
    fun executeObject(request: Request, client: OkHttpClient): JSONObject {
        client.newCall(request).execute().use { resp ->
            val bodyStr = resp.body?.string()
            if (!resp.isSuccessful) {
                val msg = detailOf(resp.code, bodyStr)
                Log.w(TAG, "HTTP ${resp.code}: $bodyStr")
                throw IllegalStateException(msg)
            }
            return JSONObject(bodyStr ?: "")
        }
    }

    /** POST JSON（[body] 为 null 时不带请求体） */
    fun postJson(client: OkHttpClient, url: String, body: JSONObject?): JSONObject {
        val rb = (body?.toString() ?: "").toRequestBody(JSON)
        val request = Request.Builder().url(url).post(rb).auth().build()
        return executeObject(request, client)
    }

    fun getJson(client: OkHttpClient, url: String): JSONObject {
        val request = Request.Builder().url(url).get().auth().build()
        return executeObject(request, client)
    }

    /**
     * 把可能抛异常的块转成 `Result`。
     * ⚠️ 必须**先重抛 [CancellationException]**：协程取消不是"业务失败"，
     * 被 `catch (e: Exception)` 吞掉会破坏结构化并发（页面退出后请求不会真正取消）。
     */
    inline fun <T> guard(block: () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }

    /** 安全取字符串数组 */
    fun stringList(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        val out = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) out.add(arr.optString(i, ""))
        return out
    }

    /** 安全取对象数组 */
    fun <T> objectList(arr: JSONArray?, map: (JSONObject) -> T): List<T> {
        if (arr == null) return emptyList()
        val out = ArrayList<T>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.add(map(o))
        }
        return out
    }
}
