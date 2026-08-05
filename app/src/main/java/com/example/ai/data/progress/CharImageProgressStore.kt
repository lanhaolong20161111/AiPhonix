package com.example.ai.data.progress

import android.content.Context
import android.content.SharedPreferences

/**
 * 看图识字浏览进度记忆：
 * - per (userId, grade, semester, type) 记住上次翻到的页码（列表独立记忆）
 * - 最近一次浏览记录（跨列表，供主页"继续上次学习"入口）
 * 翻页即写（apply 异步落盘），正常退出/意外退出都不丢。
 */
object CharImageProgressStore {

    private const val PREFS_NAME = "char_image_progress"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // ── 每列表位置 ──

    private fun posKey(userId: Int, grade: String, semester: String, type: String) =
        "pos_${userId}_$grade|$semester|$type"

    fun savePosition(userId: Int, grade: String, semester: String, type: String, index: Int) {
        if (!::prefs.isInitialized) return
        prefs.edit().putInt(posKey(userId, grade, semester, type), index).apply()
    }

    /** 返回上次页码；无记录返回 -1 */
    fun getPosition(userId: Int, grade: String, semester: String, type: String): Int =
        if (::prefs.isInitialized) prefs.getInt(posKey(userId, grade, semester, type), -1) else -1

    // ── 最近一次浏览（跨列表） ──

    data class LastVisit(
        val grade: String,
        val semester: String,
        val type: String,
        val index: Int,
    )

    fun saveLastVisit(userId: Int, visit: LastVisit) {
        if (!::prefs.isInitialized) return
        prefs.edit()
            .putString("last_visit_$userId", "${visit.grade}|${visit.semester}|${visit.type}|${visit.index}")
            .apply()
    }

    fun getLastVisit(userId: Int): LastVisit? {
        if (!::prefs.isInitialized) return null
        val raw = prefs.getString("last_visit_$userId", null) ?: return null
        val parts = raw.split("|")
        if (parts.size != 4) return null
        val index = parts[3].toIntOrNull() ?: return null
        return LastVisit(parts[0], parts[1], parts[2], index)
    }

    fun clearLastVisit(userId: Int) {
        if (!::prefs.isInitialized) return
        prefs.edit().remove("last_visit_$userId").apply()
    }
}
