package com.example.ai.data.joy

import android.util.Log
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

/**
 * 一条记忆快乐本文段 — 对齐服务端 /api/v1/joy 的 toDto。
 * chars/words 是当日字词的原文（顿号或逗号分隔），title 可为空（前端回退显示日期）。
 */
data class JoyEntry(
    val id: Long = 0,
    val date: String = "",      // YYYY-MM-DD
    val scope: String = "all",  // all / char / word
    val chars: String = "",
    val words: String = "",
    val title: String = "",
    val text: String = "",
    val createdAt: String = "",
)

/** 高亮切段结果：hit=true 表示这一段是当日字/词 */
data class JoySegment(val text: String, val hit: Boolean)

/**
 * 记忆快乐本仓库 — 对应服务端 /api/v1/joy。
 * list / delete 均需 JWT（服务端用 token 解析出的 user 过滤）。
 */
class JoyRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 该账号全部文段（按日期倒序，日期内按 id 倒序）；失败返回 null */
    suspend fun list(): List<JoyEntry>? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/joy/list")
            .get()
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext null
        buildList {
            val arr = json.optJSONArray("entries") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(
                    JoyEntry(
                        id = o.optLong("id", 0),
                        date = o.optString("date", ""),
                        scope = o.optString("scope", "all"),
                        chars = o.optString("chars", ""),
                        words = o.optString("words", ""),
                        title = o.optString("title", ""),
                        text = o.optString("text", ""),
                        createdAt = o.optString("createdAt", "").let { if (it == "null") "" else it },
                    )
                )
            }
        }
    }

    /** 删除一条文段；成功返回 true */
    suspend fun delete(id: Long): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/joy/$id")
            .delete()
            .auth()
            .build()
        executeJson(request) != null
    }

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
        private const val TAG = "JoyRepository"
    }
}

/**
 * 按目标词（词优先、再单字）对文段做高亮切段 —— 逐行移植 web `services/joy.ts` 的
 * `highlightJoyText`：在剩余文本里找**最早出现**的任一目标词，切出 `hit` 段。
 * 返回 [JoySegment] 列表；无目标词时返回整段（hit=false）。
 */
fun highlightJoyText(text: String, chars: String, words: String): List<JoySegment> {
    val t = text
    if (t.isEmpty()) return emptyList()

    val splitter = Regex("[,，、;；\\s]+")
    val targets = buildList {
        words.split(splitter).map { it.trim() }.filter { it.isNotEmpty() }.forEach { add(it) }
        chars.split(splitter).map { it.trim() }.filter { it.length == 1 }.forEach { add(it) }
    }
    if (targets.isEmpty()) return listOf(JoySegment(t, false))

    val segs = mutableListOf<JoySegment>()
    var rest = t
    while (rest.isNotEmpty()) {
        // 在剩余文本中找最早出现的任一目标词
        var bestIdx = -1
        var bestTarget = ""
        for (target in targets) {
            val idx = rest.indexOf(target)
            if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
                bestIdx = idx
                bestTarget = target
            }
        }
        if (bestIdx < 0 || bestTarget.isEmpty()) {
            segs.add(JoySegment(rest, false))
            break
        }
        if (bestIdx > 0) segs.add(JoySegment(rest.substring(0, bestIdx), false))
        segs.add(JoySegment(bestTarget, true))
        rest = rest.substring(bestIdx + bestTarget.length)
    }
    return segs
}
