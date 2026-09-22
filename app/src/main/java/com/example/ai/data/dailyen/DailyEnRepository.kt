package com.example.ai.data.dailyen

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
import java.net.URLEncoder

/** `GET /daily-en` 的响应：今日配置 / 最近一次（供预填）/ 服务端认定的日期 */
data class DailyEnFetch(
    val config: DailyEnConfig? = null,
    val last: DailyEnConfig? = null,
    val date: String = "",
)

/** 单词内容（服务端 LLM 生成 + 缓存）：中文释义 + 恰好 2 个例句 */
data class EnWordInfo(
    val word: String = "",
    val translation: String = "",
    val meaning: String = "",
    val sentences: List<EnSentencePair> = emptyList(),
)

/** 一个例句（英文 + 中文翻译） */
data class EnSentencePair(val en: String = "", val zh: String = "")

/** 句子内容：整句中文翻译 + 常用中文场景说明 */
data class EnSentenceInfo(
    val sentence: String = "",
    val translation: String = "",
    val scene: String = "",
)

/**
 * 每日一练·英语仓库（对齐 web `services/dailyEn.ts` + `server_cf/src/routes/daily_en.ts`）。
 *
 * 契约要点（**以服务端为准**）：
 * - `GET /daily-en?date=` 是**可选鉴权**（服务端 `resolveCurrentUser(auth, true)`）：
 *   未登录不报错，直接返回 `{config:null,last:null,date}`。所以"未登录"与"请求失败"要分开。
 * - `PUT /daily-en` 需要鉴权；body 字段 `words / sentences`（**驼峰**，与 GET 返回一致），`date` 可省。
 * - 服务端语义：当天没设时 `config=null` 且回传 `last` 供前端预填草稿，**不会**自动落今日库。
 * - `/daily-en/word-info`、`/sentence-info`、`/image`、`/file/:filename` 都**不鉴权**
 *   （web 侧 `fetchPhoneTips` 的注释写明「不是敏感数据，未登录也能看」，与 `/soe/records` 一致），
 *   但 Android 统一带上 token（无害，且与既有 Repository 习惯一致）。
 * - 图片：`/image` 命中不了专表时会**回退看图识字图库**（type=英词/英句），
 *   返回的是**文件名**；文件本身走 `/file/:filename`（R2 直读，带 7 天 immutable 缓存）。
 */
class DailyEnRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 拉取今日配置（未登录也会成功，返回全 null）；失败返回 null */
    suspend fun fetch(date: String? = null): DailyEnFetch? = withContext(Dispatchers.IO) {
        val url = if (date.isNullOrBlank()) {
            "$serverBase/api/v1/daily-en"
        } else {
            "$serverBase/api/v1/daily-en?date=${URLEncoder.encode(date, "UTF-8")}"
        }
        val json = executeJson(Request.Builder().url(url).get().auth().build()) ?: return@withContext null
        DailyEnFetch(
            config = json.optJSONObject("config")?.let(::parseConfig),
            last = json.optJSONObject("last")?.let(::parseConfig),
            date = json.optString("date", ""),
        )
    }

    /** 保存今日配置（upsert 当前账号 + 日期）；成功返回 true */
    suspend fun save(cfg: DailyEnConfig, date: String? = null): Boolean = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("words", cfg.words)
            put("sentences", cfg.sentences)
            if (!date.isNullOrBlank()) put("date", date)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/daily-en")
            .put(body)
            .auth()
            .build()
        executeJson(request) != null
    }

    /** 单词内容（LLM 造 2 例句 + 中文释义；服务端有缓存）。失败返回 null，卡片仍可朗读/评测 */
    suspend fun fetchWordInfo(word: String): EnWordInfo? = withContext(Dispatchers.IO) {
        val url = "$serverBase/api/v1/daily-en/word-info?word=${URLEncoder.encode(word, "UTF-8")}"
        val json = executeJson(Request.Builder().url(url).get().auth().build()) ?: return@withContext null
        EnWordInfo(
            word = json.optString("word", word),
            translation = json.optString("translation", ""),
            meaning = json.optString("meaning", ""),
            sentences = json.optJSONArray("sentences")?.let { arr ->
                (0 until arr.length()).mapNotNull { i ->
                    arr.optJSONObject(i)?.let {
                        EnSentencePair(en = it.optString("en", ""), zh = it.optString("zh", ""))
                    }
                }
            } ?: emptyList(),
        )
    }

    /** 句子内容（翻译 + 常用中文场景）。失败返回 null */
    suspend fun fetchSentenceInfo(sentence: String): EnSentenceInfo? = withContext(Dispatchers.IO) {
        val url = "$serverBase/api/v1/daily-en/sentence-info?sentence=${URLEncoder.encode(sentence, "UTF-8")}"
        val json = executeJson(Request.Builder().url(url).get().auth().build()) ?: return@withContext null
        EnSentenceInfo(
            sentence = json.optString("sentence", sentence),
            translation = json.optString("translation", ""),
            scene = json.optString("scene", ""),
        )
    }

    /**
     * 图片查找：命中返回 R2 **文件名**，没有则 null（前端不显示图片）。
     * `kind = "sentence"` 才查英句图；其余一律按英词查（服务端如此判定）。
     */
    suspend fun fetchImage(text: String, kind: String = "word"): String? = withContext(Dispatchers.IO) {
        val k = if (kind == "sentence") "sentence" else "word"
        val url = "$serverBase/api/v1/daily-en/image?text=${URLEncoder.encode(text, "UTF-8")}&kind=$k"
        executeJson(Request.Builder().url(url).get().auth().build())?.optString("image", "")?.ifBlank { null }
    }

    /** 图片直链（对齐 web `dailyEnImageUrl`）；服务端声明 7 天 immutable，可直接交给 Coil */
    fun imageUrl(fileName: String): String =
        "$serverBase/api/v1/daily-en/file/${URLEncoder.encode(fileName, "UTF-8")}"

    private fun parseConfig(o: JSONObject): DailyEnConfig = DailyEnConfig(
        words = o.optString("words", ""),
        sentences = o.optString("sentences", ""),
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
        private const val TAG = "DailyEnRepository"
    }
}
