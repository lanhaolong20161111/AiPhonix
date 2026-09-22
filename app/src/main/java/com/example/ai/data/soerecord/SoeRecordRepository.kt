package com.example.ai.data.soerecord

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
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** 一个字/词内某个音素的得分 */
data class SoeUnitPhone(
    val phone: String = "",       // 原始音素（英文 ARPAbet / 中文拼音）
    val accuracy: Float = 0f,     // 0-100
)

/** 评测单元：英文一个单词 / 中文一个字 */
data class SoeUnit(
    val word: String = "",
    val accuracy: Float = 0f,
    val matchTag: Int = 0,        // 0=正确 1=漏读 2=增读 3=错读
    val phones: List<SoeUnitPhone> = emptyList(),
)

/** 一条发音评测记录（对应服务端 /soe/records 的 records[]） */
data class SoeRecord(
    val id: Long = 0,
    val language: String = "",        // zh / en
    val evalType: String = "",        // word / sentence / paragraph / pinyin
    val refText: String = "",         // 被评测文本
    val source: String = "",          // 来源字卡/词（历史跳转定位用）
    val engine: String = "",
    val totalAccuracy: Float = 0f,
    val totalFluency: Float = 0f,
    val totalCompletion: Float = 0f,
    val suggestedScore: Float = 0f,
    val units: List<SoeUnit> = emptyList(),
    val createdAt: String = "",       // ISO8601
) {
    /** 评测类型中文标签（对齐 web describeEvalType） */
    val typeLabel: String
        get() {
            val lang = if (language == "zh") "中文" else "英文"
            when (evalType.lowercase()) {
                "pinyin" -> return "中文 · 拼音"
                "paragraph" -> return "$lang · 段落"
                "sentence" -> return "$lang · 句子"
            }
            val text = refText
            val hanziCount = text.count { it.code in 0x4E00..0x9FFF }
            if (language == "zh" || hanziCount > 0) {
                if (hanziCount == 0 && text.any { it in '1'..'5' }) return "中文 · 拼音"
                if (hanziCount <= 1) return "中文 · 字"
                return "中文 · 词"
            }
            if (evalType.equals("word", ignoreCase = true)) return "英文 · 单词"
            val wordCount = text.split(Regex("\\s+")).count { it.isNotBlank() }
            return if (wordCount <= 1) "英文 · 单词" else "英文 · 句子"
        }

    /** 本地时间显示（M月d日 HH:mm）；解析失败回退原串 */
    val createdAtLabel: String
        get() {
            if (createdAt.isBlank()) return ""
            return try {
                val local = Instant.parse(createdAt).atZone(ZoneId.systemDefault())
                local.format(DateTimeFormatter.ofPattern("M月d日 HH:mm"))
            } catch (_: Exception) {
                createdAt.take(16).replace("T", " ")
            }
        }
}

/**
 * 发音评测记录仓库 — 对应服务端 /soe/records（查询/删除/批量删除）。
 * 查询接口靠 body.user_id 过滤（不校验 token），故必须带上本地登录用户的 userId。
 */
class SoeRecordRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 查询本人评测历史（按时间倒序）；失败返回 null（区分"空列表"与"失败"） */
    suspend fun fetchRecords(limit: Int = 200): List<SoeRecord>? = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("user_id", TokenManager.userId)
            put("limit", limit.coerceAtMost(200))
            put("offset", 0)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/soe/records")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext null
        buildList {
            val arr = json.optJSONArray("records") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(parseRecord(o))
            }
        }
    }

    /** 删除单条记录；成功返回 true */
    suspend fun deleteRecord(id: Long): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/soe/records/$id")
            .delete()
            .auth()
            .build()
        executeJson(request)?.optBoolean("ok", false) ?: false
    }

    /** 批量删除；返回实际删除条数（失败返回 -1） */
    suspend fun batchDelete(ids: List<Long>): Int = withContext(Dispatchers.IO) {
        if (ids.isEmpty()) return@withContext 0
        val body = JSONObject().apply {
            put("ids", JSONArray().apply { ids.forEach { put(it) } })
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/soe/records/batch-delete")
            .post(body)
            .auth()
            .build()
        executeJson(request)?.optInt("deleted", 0) ?: -1
    }

    private fun parseRecord(o: JSONObject): SoeRecord {
        val units = buildList {
            val arr = o.optJSONArray("units") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val u = arr.optJSONObject(i) ?: continue
                val phones = buildList {
                    val pa = u.optJSONArray("phone_infos") ?: JSONArray()
                    for (j in 0 until pa.length()) {
                        val p = pa.optJSONObject(j) ?: continue
                        val name = p.optString("phone", "")
                        if (name.isBlank()) continue
                        add(SoeUnitPhone(phone = name, accuracy = p.optDouble("accuracy", 0.0).toFloat()))
                    }
                }
                add(
                    SoeUnit(
                        word = u.optString("word", ""),
                        accuracy = u.optDouble("accuracy", 0.0).toFloat(),
                        matchTag = u.optInt("match_tag", 0),
                        phones = phones,
                    )
                )
            }
        }
        return SoeRecord(
            id = o.optLong("id", 0),
            language = o.optString("language", ""),
            evalType = o.optString("eval_type", ""),
            refText = o.optString("ref_text", ""),
            source = o.optString("source", ""),
            engine = o.optString("engine", ""),
            totalAccuracy = o.optDouble("total_accuracy", 0.0).toFloat(),
            totalFluency = o.optDouble("total_fluency", 0.0).toFloat(),
            totalCompletion = o.optDouble("total_completion", 0.0).toFloat(),
            suggestedScore = o.optDouble("suggested_score", 0.0).toFloat(),
            units = units,
            createdAt = o.optString("created_at", "").let { if (it == "null") "" else it },
        )
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
        private const val TAG = "SoeRecordRepository"
    }
}
