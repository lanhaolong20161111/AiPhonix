package com.example.ai.data.wordbook

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
import org.json.JSONArray
import org.json.JSONObject

/**
 * 生词本条目 — 对齐服务端 /api/v1/wordbook 的 mapRow（snake_case）。
 * box 是 SRS 的「阶」：答对升一阶、间隔变长；答错打回第 1 阶。
 */
data class WordbookItem(
    val id: Long = 0,
    val text: String = "",
    val pinyin: String = "",
    val source: String = "",
    val times: Int = 0,
    val correct: Int = 0,
    val box: Int = 1,
    val nextReview: String = "",   // YYYY-MM-DD
    val createdAt: String = "",
    val updatedAt: String = "",
) {
    /** 该条是否英文单词（决定朗读走英文 TTS 还是中文 TTS） */
    val isEnglish: Boolean
        get() = EN_WORD_RE.matches(text.trim())

    companion object {
        /** 与 web `phonics.ts` 的 isEnglishWord 同定义：首字符字母 + 字母/撇号/连字符 */
        private val EN_WORD_RE = Regex("^[A-Za-z][A-Za-z'\u2019-]*$")
    }
}

/**
 * 生词本仓库 — 对应服务端 /api/v1/wordbook（SRS 间隔重复）。
 * 全部接口需 JWT（服务端用 token 解析出的 user 过滤，不接受 body 里的 user_id）。
 * 查询类返回 null 表示"请求失败"（区分于"真的是空列表"）。
 */
class WordbookRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 全部生词（按 updatedAt 倒序）；失败返回 null */
    suspend fun list(): List<WordbookItem>? = fetchItems("list")

    /** 到期待复习队列（next_review <= 今天，按 next_review 升序）；失败返回 null */
    suspend fun reviewQueue(): List<WordbookItem>? = fetchItems("review")

    private suspend fun fetchItems(path: String): List<WordbookItem>? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/wordbook/$path")
            .get()
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext null
        buildList {
            val arr = json.optJSONArray("items") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(parseItem(o))
            }
        }
    }

    /** 复习打卡：correct=true 升阶、false 打回第 1 阶；成功返回 true */
    suspend fun rate(id: Long, correct: Boolean): Boolean = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("id", id)
            put("correct", correct)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/wordbook/rate")
            .post(body)
            .auth()
            .build()
        executeJson(request) != null
    }

    /** 删除一条；成功返回 true */
    suspend fun remove(id: Long): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/wordbook/$id")
            .delete()
            .auth()
            .build()
        executeJson(request) != null
    }

    /**
     * 单条加入生词本（幂等：同账号同 text 已存在则 times+1 并补 pinyin）。
     * ⚠️ Android 端「点读自动收录」尚未接线，此方法供后续接入使用。
     */
    suspend fun add(text: String, pinyin: String = "", source: String = "app"): Boolean =
        withContext(Dispatchers.IO) {
            val t = text.trim()
            if (t.isEmpty()) return@withContext false
            val body = JSONObject().apply {
                put("text", t)
                put("pinyin", pinyin)
                put("source", source)
            }.toString().toRequestBody(JSON)
            val request = Request.Builder()
                .url("$serverBase/api/v1/wordbook/add")
                .post(body)
                .auth()
                .build()
            executeJson(request) != null
        }

    /**
     * 批量加入（整块收词）——一次请求多个字，比逐字循环快得多。
     * ⚠️ 同 add()：Android 端尚未接线。
     */
    suspend fun addMany(texts: List<String>, source: String = "app_batch"): Boolean =
        withContext(Dispatchers.IO) {
            val clean = texts.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
            if (clean.isEmpty()) return@withContext true
            val body = JSONObject().apply {
                put("texts", JSONArray().apply { clean.forEach { put(it) } })
                put("source", source)
            }.toString().toRequestBody(JSON)
            val request = Request.Builder()
                .url("$serverBase/api/v1/wordbook/add-many")
                .post(body)
                .auth()
                .build()
            executeJson(request) != null
        }

    private fun parseItem(o: JSONObject): WordbookItem = WordbookItem(
        id = o.optLong("id", 0),
        text = o.optString("text", ""),
        pinyin = o.optString("pinyin", ""),
        source = o.optString("source", ""),
        times = o.optInt("times", 0),
        correct = o.optInt("correct", 0),
        box = o.optInt("box", 1),
        nextReview = o.optString("next_review", "").let { if (it == "null") "" else it },
        createdAt = o.optString("created_at", "").let { if (it == "null") "" else it },
        updatedAt = o.optString("updated_at", "").let { if (it == "null") "" else it },
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
        private const val TAG = "WordbookRepository"
    }
}
