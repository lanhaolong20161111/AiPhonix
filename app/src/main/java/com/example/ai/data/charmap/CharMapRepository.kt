package com.example.ai.data.charmap

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

/** 地图上的一个字卡格（只取铺图所需字段） */
data class CharMapCell(
    val char: String = "",
    val grade: String = "",
    val semester: String = "",
    val type: String = "",     // 字 / 词 / 句 / 英词 / 英句
)

/** 学习状态（对应服务端 learning_status） */
enum class LearnStatus {
    CORRECT, WRONG, UNSURE, NONE;

    companion object {
        fun from(raw: String?): LearnStatus = when (raw) {
            "correct" -> CORRECT
            "wrong" -> WRONG
            "unsure" -> UNSURE
            else -> NONE
        }
    }
}

/** 一个年级分组（grade + semester 已拼成 "一年级上"） */
data class CharMapGroup(
    val key: String,
    val cells: List<CharMapCell>,
    val litCount: Int,
)

/**
 * 汉字地图仓库（对齐 web CharMapPage）：
 * ① `GET /char-images?limit=100000` 拉全部字卡铺图；
 * ② `GET /char-images/feedback?user_id=...` 拉本人评价状态，用于点亮格子。
 */
class CharMapRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 全部字卡（按服务端默认顺序）；失败返回 null */
    suspend fun listAll(limit: Int = 100000): List<CharMapCell>? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/char-images?limit=$limit")
            .get()
            .build()
        val json = executeJson(request) ?: return@withContext null
        buildList {
            val arr = json.optJSONArray("items") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val char = o.optString("char", "")
                if (char.isBlank()) continue
                add(
                    CharMapCell(
                        char = char,
                        grade = o.optString("grade", ""),
                        semester = o.optString("semester", ""),
                        type = o.optString("type", ""),
                    )
                )
            }
        }
    }

    /**
     * 本人评价状态：char → LearnStatus。
     * ⚠️ 服务端同一字在不同 (grade, semester, type) 下会各存一行，此处**取最新一条**
     *    （服务端已按 timestamp 倒序返回，首次见到即为最新即保留）。
     *    web `CharMapPage` 是「后写覆盖」= 取最旧一条，属笔误；Android 按意图取最新。
     * 失败返回 null。
     */
    suspend fun feedbackStatus(userId: Int): Map<String, LearnStatus>? = withContext(Dispatchers.IO) {
        if (userId <= 0) return@withContext emptyMap()
        val request = Request.Builder()
            .url("$serverBase/api/v1/char-images/feedback?user_id=$userId&limit=100000")
            .get()
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext null
        val out = LinkedHashMap<String, LearnStatus>()
        val arr = json.optJSONArray("items") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val char = o.optString("char", "")
            val statusRaw = o.optString("learning_status", "")
            if (char.isBlank() || statusRaw.isBlank() || statusRaw == "null") continue
            // 首次见到（=最新）即定，不再被更旧的记录覆盖
            if (!out.containsKey(char)) out[char] = LearnStatus.from(statusRaw)
        }
        out
    }

    /** 字卡图片 URL（地图不展示图片，保留给后续「点开看字卡」用） */
    fun imageUrl(filename: String, width: Int = 640): String =
        "$serverBase/api/v1/char-images/file/${java.net.URLEncoder.encode(filename, "UTF-8")}?w=$width"

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
        private const val TAG = "CharMapRepository"
    }
}
