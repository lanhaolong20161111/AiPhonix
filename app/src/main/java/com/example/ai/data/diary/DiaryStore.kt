package com.example.ai.data.diary

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * 一篇成长日记（每天一条，date 为唯一键）。
 * text=孩子的原话；polish=AI 润色后的日记；comment=AI 的温暖点评。
 */
data class DiaryEntry(
    val date: String = "",     // YYYY-MM-DD
    val text: String = "",
    val polish: String = "",
    val comment: String = "",
)

/**
 * 成长日记本地存储 — 对齐 web DiaryPage 的 localStorage `ai_diary_entries`
 * （一个 JSON 文件，按 date 倒序，每天最多一条）。
 * 同步文件读写；调用方应在 Dispatchers.IO 上调用。
 */
class DiaryStore(private val context: android.content.Context) {

    companion object {
        /** 今天的 key（YYYY-MM-DD） */
        fun todayKey(): String = LocalDate.now().toString()

        /**
         * 日期标签：今天 / 昨天 / M月D日（对齐 web DiaryPage.dateLabel）。
         * 解析失败时原样返回。
         */
        fun dateLabel(date: String): String {
            val parts = date.split("-")
            if (parts.size != 3) return date
            val y = parts[0].toIntOrNull() ?: return date
            val m = parts[1].toIntOrNull() ?: return date
            val d = parts[2].toIntOrNull() ?: return date
            val diffDays = try {
                ChronoUnit.DAYS.between(LocalDate.of(y, m, d), LocalDate.now())
            } catch (_: Exception) {
                return date
            }
            return when {
                diffDays <= 0 -> "今天"
                diffDays == 1L -> "昨天"
                else -> "${m}月${d}日"
            }
        }
    }

    private val file: File get() = File(context.filesDir, "diary_entries.json")
    private val lock = Any()

    /** 全部日记（date 倒序） */
    fun load(): List<DiaryEntry> = synchronized(lock) { loadUnlocked() }

    private fun loadUnlocked(): MutableList<DiaryEntry> {
        val out = mutableListOf<DiaryEntry>()
        try {
            if (!file.exists()) return out
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val date = o.optString("date", "")
                if (date.isBlank()) continue
                out.add(
                    DiaryEntry(
                        date = date,
                        text = o.optString("text", ""),
                        polish = o.optString("polish", ""),
                        comment = o.optString("comment", ""),
                    )
                )
            }
            out.sortByDescending { it.date }
        } catch (_: Exception) {
            // 损坏文件视为空（下次保存覆盖）
        }
        return out
    }

    private fun saveUnlocked(list: List<DiaryEntry>) {
        try {
            val arr = JSONArray().apply {
                list.forEach { e ->
                    put(JSONObject().apply {
                        put("date", e.date)
                        put("text", e.text)
                        put("polish", e.polish)
                        put("comment", e.comment)
                    })
                }
            }
            val tmp = File(file.parentFile, "diary_entries.json.tmp")
            tmp.writeText(arr.toString())
            tmp.renameTo(file) // 原子覆盖
        } catch (_: Exception) {
        }
    }

    /** 写入/覆盖某天的日记（同 date 只留一条），返回更新后的全量列表 */
    fun upsert(entry: DiaryEntry): List<DiaryEntry> = synchronized(lock) {
        val list = loadUnlocked().filter { it.date != entry.date }.toMutableList()
        list.add(entry)
        list.sortByDescending { it.date }
        saveUnlocked(list)
        list.toList()
    }

    /** 删除某天的日记，返回更新后的全量列表 */
    fun remove(date: String): List<DiaryEntry> = synchronized(lock) {
        val list = loadUnlocked().toMutableList()
        if (list.removeAll { it.date == date }) saveUnlocked(list)
        list.toList()
    }
}
