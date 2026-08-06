package com.example.ai.data.repository

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder

/**
 * 单词图片仓库 — 从服务端图片数据库（char_image_index.json，type=英词）查询单词图片。
 *
 * 服务端 API：
 *  - 查询条目：GET /api/v1/char-images/{word}  → {"char":"apple","image":"apple.jpg","type":"英词",...}
 *  - 图片文件：GET /api/v1/char-images/file/{image}
 *
 * 查询不到（或复数形式，如 bags → bag）时返回 null，由 UI 回退到 emoji 展示。
 */
class WordImageRepository(
    private val client: OkHttpClient,
    private val serverBase: String,
) {

    /** 返回单词图片的完整 URL；无图或网络异常时返回 null（不抛异常）。 */
    suspend fun getImageUrl(word: String): String? = withContext(Dispatchers.IO) {
        val candidates = buildList {
            add(word)
            // 复数回退：bags → bag
            if (word.length > 1 && word.endsWith("s")) add(word.dropLast(1))
        }
        for (c in candidates) {
            queryEntry(c)?.let { return@withContext it }
        }
        null
    }

    private fun queryEntry(word: String): String? {
        return try {
            val encoded = URLEncoder.encode(word, "UTF-8").replace("+", "%20")
            val request = Request.Builder()
                .url("$serverBase/api/v1/char-images/$encoded")
                .build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val json = JSONObject(resp.body?.string() ?: return null)
                // 只认英语单词类型，避免命中同名字符/句子条目
                if (json.optString("type") != "英词") return null
                val image = json.optString("image")
                if (image.isBlank()) return null
                val encodedFile = URLEncoder.encode(image, "UTF-8").replace("+", "%20")
                "$serverBase/api/v1/char-images/file/$encodedFile"
            }
        } catch (e: Exception) {
            null
        }
    }
}
