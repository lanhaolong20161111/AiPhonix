package com.example.ai.data.subtitlecapture

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * 字幕采集的**本地持久化**（对齐 web 的三处 localStorage：画框记忆 / 书签 / 上次影片）。
 *
 * 与 web 的差异（有意为之，见 `ANDROID_PARITY_PLAN.md`）：
 * - web 把**影片文件本身**存进 IndexedDB，重启后能自动续播；Android 存的是 **SAF URI**（字符串），
 *   因此打开时要 `takePersistableUriPermission`，否则重启后 URI 失效（会静默播不出来）。
 * - 用 SharedPreferences（项目内 `DailyZhStore`/`TrainingPlanStore` 的既有惯例）；key 沿用 web 原名便于对照。
 */
class SubtitleCaptureStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("subtitle_capture_prefs", Context.MODE_PRIVATE)

    // ────────────────────────── 画框记忆 ──────────────────────────

    fun readRects(): MutableMap<String, RectMemory> {
        val raw = prefs.getString(KEY_RECTS, null) ?: return mutableMapOf()
        return try {
            val root = JSONObject(raw)
            val out = mutableMapOf<String, RectMemory>()
            for (name in root.keys()) {
                val o = root.optJSONObject(name) ?: continue
                out[name] = RectMemory(
                    x = o.optInt("x", 0),
                    y = o.optInt("y", 0),
                    w = o.optInt("w", 0),
                    h = o.optInt("h", 0),
                    wrapW = o.optInt("wrapW", 0),
                    wrapH = o.optInt("wrapH", 0),
                )
            }
            out
        } catch (e: Exception) {
            Log.w(TAG, "画框记忆解析失败，忽略: ${e.message}")
            mutableMapOf()
        }
    }

    /** 按影片名记忆画框（web `saveRectForMovie`：任一方尺寸为 0 就**不记**）。 */
    fun saveRect(name: String, rect: CaptureRect, wrapW: Int, wrapH: Int) {
        if (name.isBlank() || wrapW <= 0 || wrapH <= 0) return
        val map = readRects()
        map[name] = RectMemory(rect.x, rect.y, rect.w, rect.h, wrapW, wrapH)
        val root = JSONObject()
        for ((k, v) in map) {
            root.put(k, JSONObject().apply {
                put("x", v.x); put("y", v.y); put("w", v.w); put("h", v.h)
                put("wrapW", v.wrapW); put("wrapH", v.wrapH)
            })
        }
        runCatching { prefs.edit().putString(KEY_RECTS, root.toString()).apply() }
            .onFailure { Log.w(TAG, "画框记忆写入失败: ${it.message}") }
    }

    fun rectOf(name: String): RectMemory? = if (name.isBlank()) null else readRects()[name]

    // ────────────────────────── 书签 ──────────────────────────

    fun readMarks(): MutableMap<String, MutableList<SubtitleMark>> {
        val raw = prefs.getString(KEY_MARKS, null) ?: return mutableMapOf()
        return try {
            val root = JSONObject(raw)
            val out = mutableMapOf<String, MutableList<SubtitleMark>>()
            for (movie in root.keys()) {
                val arr = root.optJSONArray(movie) ?: continue
                out[movie] = marksFromArray(arr).toMutableList()
            }
            out
        } catch (e: Exception) {
            Log.w(TAG, "书签解析失败，忽略: ${e.message}")
            mutableMapOf()
        }
    }

    /** 读某影片的书签（按 ts 升序；web 存的时候已排序）。 */
    fun marksOf(movieName: String): List<SubtitleMark> =
        if (movieName.isBlank()) emptyList() else readMarks()[movieName].orEmpty()

    /**
     * 记一个书签（web `saveMark`）：
     * 先剔掉同片里与该时间戳相距 300ms 内的旧书签，再追加并按 ts 升序，最后整体落盘。
     */
    fun saveMark(movieName: String, mark: SubtitleMark) {
        if (movieName.isBlank()) return
        val all = readMarks()
        val kept = all[movieName].orEmpty().filter { kotlin.math.abs(it.ts - mark.ts) > 300 }.toMutableList()
        kept.add(mark)
        all[movieName] = kept.sortedBy { it.ts }.toMutableList()
        writeMarks(all)
    }

    /**
     * 把跟读得分写到书签上（web：命中 activeMark 就写它，否则写**最后一条**）。
     * [activeTs] 为 null 或未命中时落到最后一条 —— 与 web `arr[arr.length - 1]` 同义。
     */
    fun applySoeToMark(movieName: String, activeTs: Long?, score: Int, words: List<SoeWordItem>) {
        if (movieName.isBlank() || words.isEmpty()) return
        val all = readMarks()
        val arr = all[movieName]?.takeIf { it.isNotEmpty() } ?: return
        val targetTs = arr.firstOrNull { it.ts == activeTs }?.ts ?: arr.last().ts
        all[movieName] = arr.map {
            if (it.ts == targetTs) it.copy(soeScore = score, soeWords = words) else it
        }.toMutableList()
        writeMarks(all)
    }

    private fun writeMarks(all: Map<String, List<SubtitleMark>>) {
        val root = JSONObject()
        for ((movie, list) in all) {
            val arr = JSONArray()
            for (m in list) arr.put(markToJson(m))
            root.put(movie, arr)
        }
        runCatching { prefs.edit().putString(KEY_MARKS, root.toString()).apply() }
            .onFailure { Log.w(TAG, "书签写入失败: ${it.message}") }
    }

    private fun markToJson(m: SubtitleMark): JSONObject = JSONObject().apply {
        put("ts", m.ts); put("ts_text", m.tsText)
        put("subtitle", m.subtitle); put("translation", m.translation)
        put("seq", m.seq)
        if (m.soeScore != null) {
            put("soe", JSONObject().apply {
                put("score", m.soeScore)
                put("words", JSONArray().apply { m.soeWords.forEach { put(wordToJson(it)) } })
            })
        }
    }

    private fun wordToJson(w: SoeWordItem): JSONObject = JSONObject().apply {
        put("word", w.word); put("accuracy", w.accuracy.toDouble()); put("match_tag", w.matchTag)
    }

    private fun marksFromArray(arr: JSONArray): List<SubtitleMark> = buildList {
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val soe = o.optJSONObject("soe")
            add(
                SubtitleMark(
                    ts = o.optLong("ts", 0L),
                    tsText = o.optString("ts_text", ""),
                    subtitle = o.optString("subtitle", ""),
                    translation = o.optString("translation", ""),
                    seq = o.optInt("seq", 0),
                    soeScore = soe?.optInt("score", 0),
                    soeWords = soe?.optJSONArray("words")?.let { wa ->
                        buildList {
                            for (j in 0 until wa.length()) {
                                val w = wa.optJSONObject(j) ?: continue
                                add(
                                    SoeWordItem(
                                        word = w.optString("word", ""),
                                        accuracy = w.optDouble("accuracy", 0.0).toFloat(),
                                        matchTag = w.optInt("match_tag", 0),
                                    )
                                )
                            }
                        }
                    }.orEmpty(),
                )
            )
        }
    }

    // ────────────────────────── 上次影片 ──────────────────────────

    fun readLastMovie(): LastMovie? {
        val raw = prefs.getString(KEY_LAST, null) ?: return null
        return try {
            val o = JSONObject(raw)
            val name = o.optString("movieName", "")
            val uri = o.optString("uri", "")
            if (name.isBlank() || uri.isBlank()) null
            else LastMovie(name, uri, o.optLong("lastTime", 0L))
        } catch (e: Exception) {
            null
        }
    }

    /** 打开新影片时整条覆盖（web `idbPutLastMovie` 同时重置 `lastTime = 0`）。 */
    fun writeLastMovie(movieName: String, uri: String, lastTimeMs: Long = 0L) {
        if (movieName.isBlank() || uri.isBlank()) return
        val o = JSONObject().apply {
            put("movieName", movieName); put("uri", uri); put("lastTime", lastTimeMs)
        }
        runCatching { prefs.edit().putString(KEY_LAST, o.toString()).apply() }
    }

    /**
     * 只更新进度（web `saveLastTime`：**保留原有的 `movieName`**，即使当前片名不同）。
     * 这一条照抄很关键：web 用它避免「进度写到了别的影片名下」。
     */
    fun saveLastTime(movieName: String, tMs: Long) {
        val cur = readLastMovie()
        val keepName = cur?.movieName?.takeIf { it.isNotBlank() } ?: movieName
        val keepUri = cur?.uri.orEmpty()
        if (keepName.isBlank() || keepUri.isBlank()) return
        writeLastMovie(keepName, keepUri, tMs)
    }

    fun clearLastMovie() {
        prefs.edit().remove(KEY_LAST).apply()
    }

    private companion object {
        const val TAG = "SubtitleCaptureStore"

        /** 与 web localStorage key 同名，便于对照排查 */
        const val KEY_RECTS = "subtitle_capture_rects"
        const val KEY_MARKS = "subtitle_capture_marks"
        const val KEY_LAST = "last_movie_meta"
    }
}
