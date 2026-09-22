package com.example.ai.data.subtitlecapture

import android.util.Log
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder

/**
 * 一次「存图 / 识别 / 重新测评」的结果（服务端 `capture` 与 `auto-evaluate` 的响应都归一到它）。
 *
 * `capture` 不带 eval 字段（`eval` 为空对象），`auto-evaluate` / `re-evaluate` 会把 LLM 结果**平铺在顶层**
 * （`subtitle_text` / `translation` / `grammar_corrections` / `explanation`），解析时注意不要在 `eval` 子对象里找。
 */
data class CaptureOutcome(
    val seq: Int = 0,
    val fileName: String = "",
    val timestampText: String = "",
    val url: String = "",
    val movieName: String = "",
    val cached: Boolean = false,
    val eval: SubtitleEval = SubtitleEval(),
)

/**
 * 字幕采集仓库（对齐 web `SubtitleCapturePage` 里直接调 `api()` 的那几处 + `services` 无独立文件）。
 *
 * 契约要点（**以服务端 `server_cf/src/routes/subtitleCapture.ts` 为准**）：
 * - 整段路由挂了 `requireAuth()` —— **包括 `GET /file/:fileName`**，所以截图直链必须带 Authorization 头。
 * - `capture` / `auto-evaluate` 是 **multipart**：`file`（PNG 字节）+ `meta`（**JSON 字符串**）。
 *   meta 字段名 snake_case：`movie_name` / `timestamp_ms` / `video_width` / `video_height` /
 *   `crop{x,y,w,h}` / `crop_width` / `crop_height` / `note` / `lang`。
 * - `auto-evaluate` 有「**同片 + 同时间戳（<500ms）且已评测过**」的缓存，命中时返回 `cached: true` 且**不调 LLM**。
 * - `list` 的元素是 `CaptureMeta` + `url`；`eval` 字段可能不存在。
 * - `DELETE /subtitle-capture/{seq}` 同时删记录与 R2 文件，失败返回 `{detail}`。
 */
class SubtitleCaptureRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 供 Coil 用的鉴权头（`file/:fileName` 也要 token，`<img src>` 裸链会 401）。 */
    fun authHeaders(): Map<String, String> {
        val token = TokenManager.accessToken
        return if (token.isBlank()) emptyMap() else mapOf("Authorization" to "Bearer $token")
    }

    /** 截图直链（仍需鉴权头，见类注释）。文件名可能含中文，照 web 一样编码。 */
    fun fileUrl(fileName: String): String =
        "$serverBase/api/v1/subtitle-capture/file/${URLEncoder.encode(fileName, "UTF-8")}"

    /** 仅存盘，不做识别（web `doCapture("save")`）。 */
    suspend fun capture(bytes: ByteArray, meta: CaptureRequest): Result<CaptureOutcome> =
        upload("$serverBase/api/v1/subtitle-capture/capture", bytes, meta)

    /** 暂存盘 + 识图 + 翻译 + 纠错 + 讲解（web `doCapture("evaluate")`，暂停自动走这条路）。 */
    suspend fun autoEvaluate(bytes: ByteArray, meta: CaptureRequest): Result<CaptureOutcome> =
        upload("$serverBase/api/v1/subtitle-capture/auto-evaluate", bytes, meta)

    /**
     * 用已存截图按 seq 重跑 LLM（web 卡片上的「🔄 重新测评」）。
     * ★ 注意是 **JSON body**（不是 multipart），字段 `seq` / `lang`。
     */
    suspend fun reEvaluate(seq: Int, lang: String): Result<CaptureOutcome> = withContext(Dispatchers.IO) {
        if (seq <= 0) return@withContext Result.failure(IOException("缺少 seq"))
        try {
            val body = JSONObject().apply {
                put("seq", seq)
                put("lang", if (lang == "zh") "zh" else "en")
            }.toString().toRequestBody(JSON_MEDIA)
            val request = Request.Builder()
                .url("$serverBase/api/v1/subtitle-capture/re-evaluate")
                .post(body)
                .auth()
                .build()
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                val json = runCatching { JSONObject(text) }.getOrNull()
                if (!resp.isSuccessful) {
                    val detail = json?.optString("detail").orEmpty().ifBlank { "HTTP ${resp.code}" }
                    Log.w(TAG, "重新测评失败 HTTP ${resp.code}: ${text.take(200)}")
                    return@use Result.failure(IOException(detail))
                }
                if (json == null) return@use Result.failure(IOException("响应格式异常"))
                Result.success(parseOutcome(json))
            }
        } catch (e: Exception) {
            Log.w(TAG, "重新测评异常: ${e.message}")
            Result.failure(IOException(e.message ?: "网络异常"))
        }
    }

    /** 全部采集记录（最新在前由调用方处理）；失败返回 **null**（与「空列表」区分）。 */
    suspend fun list(): List<CaptureItem>? = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$serverBase/api/v1/subtitle-capture/list").get().auth().build()
        try {
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "list HTTP ${resp.code}: ${resp.body?.string()?.take(200)}")
                    return@use null
                }
                val text = resp.body?.string() ?: return@use null
                val json = JSONObject(text)
                val arr = json.optJSONArray("items") ?: JSONArray()
                buildList {
                    for (i in 0 until arr.length()) {
                        add(parseItem(arr.optJSONObject(i) ?: continue))
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "list 异常: ${e.message}")
            null
        }
    }

    /** 删一条（记录 + 服务端文件）；失败返回 false（调用方继续删其它条，与 web 一致）。 */
    suspend fun remove(seq: Int): Boolean = withContext(Dispatchers.IO) {
        if (seq <= 0) return@withContext false
        val request = Request.Builder()
            .url("$serverBase/api/v1/subtitle-capture/$seq")
            .delete()
            .auth()
            .build()
        try {
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) Log.w(TAG, "删除 $seq HTTP ${resp.code}")
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "删除 $seq 异常: ${e.message}")
            false
        }
    }

    /**
     * B站搜索（服务端代理，规避 CORS 与风控 -412）。
     * ⚠️ 服务端该路由**不鉴权**（web 也传了 `auth: false`）——别自作主张加 token。
     */
    suspend fun searchBili(keyword: String): Result<List<BiliItem>> = withContext(Dispatchers.IO) {
        val kw = keyword.trim()
        if (kw.isEmpty()) return@withContext Result.success(emptyList())
        try {
            val url = "$serverBase/api/v1/bili/search?keyword=${URLEncoder.encode(kw, "UTF-8")}"
            val request = Request.Builder().url(url).get().build()
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    return@use Result.failure(IOException("HTTP ${resp.code}"))
                }
                val json = JSONObject(text)
                val arr = json.optJSONArray("items") ?: JSONArray()
                Result.success(
                    buildList {
                        for (i in 0 until arr.length()) {
                            val o = arr.optJSONObject(i) ?: continue
                            val bvid = o.optString("bvid", "")
                            if (bvid.isBlank()) continue
                            add(
                                BiliItem(
                                    bvid = bvid,
                                    title = o.optString("title", ""),
                                    author = o.optString("author", ""),
                                    duration = o.optString("duration", ""),
                                )
                            )
                        }
                    }
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "B站搜索异常: ${e.message}")
            Result.failure(IOException(e.message ?: "网络异常"))
        }
    }

    // ────────────────────────────── 内部 ──────────────────────────────

    private suspend fun upload(
        url: String,
        bytes: ByteArray,
        meta: CaptureRequest,
    ): Result<CaptureOutcome> = withContext(Dispatchers.IO) {
        if (bytes.isEmpty()) return@withContext Result.failure(IOException("图片为空"))
        try {
            val metaJson = buildMetaJson(meta).toString()
            val safeName = meta.movieName.ifBlank { "shot" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")
            val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("file", "${safeName}_${meta.timestampMs}.png", bytes.toRequestBody("image/png".toMediaType()))
                .addFormDataPart("meta", metaJson)
                .build()
            val request = Request.Builder().url(url).post(body).auth().build()
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                val json = runCatching { JSONObject(text) }.getOrNull()
                if (!resp.isSuccessful) {
                    val detail = json?.optString("detail").orEmpty().ifBlank { "HTTP ${resp.code}" }
                    Log.w(TAG, "上传失败 HTTP ${resp.code}: ${text.take(200)}")
                    return@use Result.failure(IOException(detail))
                }
                if (json == null) return@use Result.failure(IOException("响应格式异常"))
                Result.success(parseOutcome(json))
            }
        } catch (e: Exception) {
            Log.w(TAG, "上传异常: ${e.message}")
            Result.failure(IOException(e.message ?: "网络异常"))
        }
    }

    /** meta 的字段名与嵌套结构与 web `doCapture` 的 `meta` 逐字对齐（服务端 `parseMeta` 直接 JSON.parse）。 */
    private fun buildMetaJson(meta: CaptureRequest): JSONObject = JSONObject().apply {
        put("movie_name", meta.movieName)
        put("timestamp_ms", meta.timestampMs)
        put("video_width", meta.videoWidth)
        put("video_height", meta.videoHeight)
        put("crop", JSONObject().apply {
            put("x", meta.crop.x); put("y", meta.crop.y)
            put("w", meta.crop.w); put("h", meta.crop.h)
        })
        put("crop_width", meta.cropWidth)
        put("crop_height", meta.cropHeight)
        put("note", meta.note)
        put("lang", meta.lang)
        if (meta.force) put("force", "true")
    }

    /**
     * `capture`（只有 seq/时间戳/url）与 `auto-evaluate`（多四项 LLM 结果）共用一套解析：
     * 缺字段就是空串/空表，不抛错。
     */
    private fun parseOutcome(json: JSONObject): CaptureOutcome = CaptureOutcome(
        seq = json.optInt("seq", 0),
        fileName = json.optString("file_name", ""),
        timestampText = json.optString("timestamp_text", ""),
        url = json.optString("url", ""),
        movieName = json.optString("movie_name", ""),
        cached = json.optBoolean("cached", false),
        eval = parseEval(json),
    )

    private fun parseEval(o: JSONObject): SubtitleEval = SubtitleEval(
        subtitleText = o.optString("subtitle_text", ""),
        translation = o.optString("translation", ""),
        grammar = parseGrammar(o.optJSONArray("grammar_corrections")),
        explanation = o.optString("explanation", ""),
    )

    private fun parseGrammar(arr: JSONArray?): List<GrammarFix> {
        if (arr == null) return emptyList()
        return buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val original = o.optString("original", "")
                val corrected = o.optString("corrected", "")
                // 服务端已过滤掉 original/corrected 缺失的项，这里再兜一层（防御历史数据）
                if (original.isBlank() || corrected.isBlank()) continue
                add(GrammarFix(original, corrected, o.optString("reason", "")))
            }
        }
    }

    private fun parseItem(o: JSONObject): CaptureItem {
        val cropObj = o.optJSONObject("crop")
        val crop = if (cropObj == null) CaptureRect(0, 0, 0, 0) else CaptureRect(
            cropObj.optInt("x", 0), cropObj.optInt("y", 0),
            cropObj.optInt("w", 0), cropObj.optInt("h", 0),
        )
        val fileName = o.optString("file_name", "")
        val evalObj = o.optJSONObject("eval")
        return CaptureItem(
            seq = o.optInt("seq", 0),
            fileName = fileName,
            movieName = o.optString("movie_name", "").let { if (it == "null") "" else it },
            timestampMs = o.optLong("timestamp_ms", 0L),
            timestampText = o.optString("timestamp_text", ""),
            videoWidth = o.optInt("video_width", 0),
            videoHeight = o.optInt("video_height", 0),
            crop = crop,
            cropWidth = o.optInt("crop_width", 0),
            cropHeight = o.optInt("crop_height", 0),
            note = o.optString("note", "").let { if (it == "null") "" else it },
            // 服务端 list 会给 url；万一没有就用文件名拼（两者等价）
            url = o.optString("url", "").ifBlank { if (fileName.isBlank()) "" else fileUrl(fileName) },
            eval = if (evalObj == null) null else parseEval(evalObj),
        )
    }

    private companion object {
        const val TAG = "SubtitleCaptureRepo"
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
