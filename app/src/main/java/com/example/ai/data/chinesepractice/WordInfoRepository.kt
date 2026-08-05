package com.example.ai.data.chinesepractice

import android.content.Context
import com.example.ai.BuildConfig
import com.example.ai.di.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * 语文练习数据仓库 — 本地 char_info.json + 服务端 LLM 代理
 *
 * getWordInfo 优先查本地静态数据（偏旁/笔画/结构/组词），
 * 仅造例句需要调服务端 LLM（可离线 fallback）
 */
class WordInfoRepository(
    private val appContext: Context,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    /** 本地汉字信息缓存：char -> JSONObject */
    private val localMap: MutableMap<String, JSONObject> = mutableMapOf()

    init {
        loadLocalData()
    }

    companion object {
        private const val TAG = "WordInfoRepo"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        fun getServerBase(): String {
            val host = BuildConfig.TTS_SERVER_HOST
            return if (host.isNotBlank()) host else "http://192.168.1.3:8080"
        }
    }

    /** 从 assets 加载 char_info.json */
    private fun loadLocalData() {
        try {
            val jsonStr = appContext.assets.open("char_info.json")
                .bufferedReader().use { it.readText() }
            val arr = JSONArray(jsonStr)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val char = obj.optString("char", "")
                if (char.isNotEmpty()) {
                    localMap[char] = obj
                }
            }
            android.util.Log.i(TAG, "✅ 已加载 ${localMap.size} 个本地汉字信息")
        } catch (e: Exception) {
            android.util.Log.w(TAG, "⚠️ 加载本地 char_info.json 失败: ${e.message}")
        }
    }

    /**
     * 获取汉字信息
     *
     * 本地包含：偏旁(radical)、拆字(decomposition)、笔画(stroke_count)、结构(structure)、组词(words)
     * 服务端补充：例句(sentence)
     *
     * @return JSONObject with fields: char, radical, stroke_count, structure, words, sentence
     */
    suspend fun getWordInfo(char: String): JSONObject = withContext(Dispatchers.IO) {
        val local = localMap[char]?.let { obj ->
            JSONObject().apply {
                put("char", char)
                put("radical", obj.optString("radical", ""))
                put("decomposition", obj.optJSONArray("decomposition") ?: JSONArray())
                put("stroke_count", obj.optInt("stroke_count", 0))
                put("structure", obj.optString("structure", ""))
                put("words", obj.optJSONArray("words") ?: JSONArray())
                put("source", "local")
            }
        }

        if (local != null) {
            // 尝试获取例句（从服务端），失败用本地默认句
            try {
                val body = JSONObject().apply { put("char", char) }
                val request = Request.Builder()
                    .url("${getServerBase()}/api/v1/llm/word-info")
                    .post(body.toString().toRequestBody(JSON_MEDIA))
                    .build()
                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    val json = JSONObject(response.body?.string() ?: "")
                    local.put("sentence", json.optString("sentence", ""))
                    local.put("source", "server")
                    return@withContext local
                }
            } catch (_: Exception) {
                // 服务端不可用，用本地默认句
            }
            // 本地 fallback 例句
            val words = local.optJSONArray("words")
            local.put("sentence", if (words != null && words.length() > 0)
                "我们学习「$char」这个字。"
            else
                "这是汉字「$char」。"
            )
            return@withContext local
        }

        // 本地没有 → 调服务端
        try {
            val body = JSONObject().apply { put("char", char) }
            val request = Request.Builder()
                .url("${getServerBase()}/api/v1/llm/word-info")
                .post(body.toString().toRequestBody(JSON_MEDIA))
                .build()
            val response = client.newCall(request).execute()
            if (response.isSuccessful) {
                return@withContext JSONObject(response.body?.string() ?: "")
            }
        } catch (_: Exception) {}

        // 完全 fallback
        JSONObject().apply {
            put("char", char)
            put("radical", "")
            put("stroke_count", 0)
            put("structure", "")
            put("words", JSONArray())
            put("sentence", "")
            put("source", "fallback")
        }
    }

    /**
     * 用指定词/字造句（经服务端 LLM）
     * @param hideWord true=句中隐藏目标词（用于默写）
     */
    suspend fun generateSentence(word: String, grade: String = "", hideWord: Boolean = false): JSONObject? = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().apply {
                put("word", word)
                put("grade", grade)
                put("hide_word", hideWord)
            }
            val request = Request.Builder()
                .url("${getServerBase()}/api/v1/llm/sentence-generate")
                .post(body.toString().toRequestBody(JSON_MEDIA))
                .build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null
            JSONObject(response.body?.string() ?: return@withContext null)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "造句失败: ${e.message}")
            null
        }
    }
}
