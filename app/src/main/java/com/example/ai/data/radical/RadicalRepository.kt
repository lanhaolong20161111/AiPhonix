package com.example.ai.data.radical

import android.util.Log
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

/** AI 儿歌结果：failed=true 表示服务端生成失败且处于冷却期（10 分钟内不会重试） */
data class RadicalSongResult(
    val song: String = "",
    val failed: Boolean = false,
)

/** 一条字谜：谜面 + 谜底（必须是该字族里的字） */
data class RadicalRiddle(
    val riddle: String = "",
    val answer: String = "",
)

/**
 * 偏旁魔法屋仓库 — 对应服务端 /api/v1/radical（AI 儿歌 / 字谜池）。
 * 服务端按字族缓存，每族只生成一次（控制 LLM 成本）。
 *
 * 超时：复用共享 client（readTimeout 180s）。服务端 arkOnly 单链路 ≤30s，
 * 但字谜可能触发多轮生成，故留足窗口（web 分别给 40s / 90s）。
 */
class RadicalRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    /** 取（或让服务端生成）某字族的儿歌；网络/HTTP 失败返回 null */
    suspend fun song(family: String, base: String, chars: List<String>): RadicalSongResult? =
        withContext(Dispatchers.IO) {
            val url = buildString {
                append("$serverBase/api/v1/radical/song")
                append("?family=").append(enc(family))
                append("&base=").append(enc(base))
                append("&chars=").append(enc(chars.joinToString(",")))
            }
            val json = executeJson(Request.Builder().url(url).get().build()) ?: return@withContext null
            RadicalSongResult(
                song = json.optString("song", ""),
                failed = json.optBoolean("failed", false),
            )
        }

    /** 取（或让服务端生成）某字族的字谜池；网络/HTTP 失败返回 null */
    suspend fun riddles(family: String, chars: List<String>, count: Int = 4): List<RadicalRiddle>? =
        withContext(Dispatchers.IO) {
            val url = buildString {
                append("$serverBase/api/v1/radical/riddles")
                append("?family=").append(enc(family))
                append("&chars=").append(enc(chars.joinToString(",")))
                append("&count=").append(count)
            }
            val json = executeJson(Request.Builder().url(url).get().build()) ?: return@withContext null
            buildList {
                val arr = json.optJSONArray("riddles") ?: JSONArray()
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val riddle = o.optString("riddle", "")
                    val answer = o.optString("answer", "")
                    if (riddle.isBlank() || answer.isBlank()) continue
                    add(RadicalRiddle(riddle = riddle, answer = answer))
                }
            }
        }

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

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
        private const val TAG = "RadicalRepository"
    }
}
