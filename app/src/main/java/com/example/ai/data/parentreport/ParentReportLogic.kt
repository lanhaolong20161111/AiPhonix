package com.example.ai.data.parentreport

import com.example.ai.data.soerecord.SoeRecord
import com.example.ai.util.removeJsWhitespace
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** 近 7 天里的一天（`avgScore` 为 null 表示当天没有正分记录） */
data class DayStat(val date: String, val count: Int, val avgScore: Int?)

/** 「需要多练的词」一条：`key` 是去空白后截前 8 字，`score` 是窗口内最低分 */
data class WeakWord(val key: String, val score: Float)

/**
 * 家长周报的**纯函数引擎** —— 逐行移植 web `ParentReportPage.tsx` 的 `days` / `weekCount` /
 * `weekAvg` / `weakWords`。全部不碰 Android API，可直接 JVM 单测
 * （期望值来自把 web 原逻辑复制到 node 跑出的探针，**不是**按语义推导）。
 *
 * ★ 两条必须保留的 web 行为（看着像 bug，实为口径，别「顺手修正」）：
 * 1. **日期 key 用设备本地时区，但记录侧是拿 `created_at` 的前 10 字符比**。`created_at` 是
 *    ISO8601 UTC 串 ⇒ 它的前 10 位是 **UTC 日期**。于是在 UTC+8 上，本地 00:00–08:00 之间产生的
 *    记录会被归到**前一天**那一列（实测：本地 22 日 00:10 的记录，`created_at` 前 10 位是 21 日）。
 * 2. **「需多练」的 30 天 cutoff 是 UTC 日期**（`toISOString()` 恒为 UTC），与 ① 的本地 key 不同源。
 *
 * 另：`created_at` 为空串时，字符串比较 `"" >= "2026-09-16"` 为 **false** ⇒ 该记录不进本周均分，
 * 也不进任何一天（但 `0 分`/`>0 分` 的判定仍按 `suggested_score` 走）。
 */
object ParentReportLogic {

    /** 周报窗口天数（web 硬编码 6…0 共 7 天） */
    const val WEEK_DAYS = 7

    /** 「需多练」回溯窗口（天） */
    const val WEAK_WINDOW_DAYS = 30

    /** 「需多练」的入选门槛：**严格小于** 80 分才进（恰好 80 不进） */
    const val WEAK_THRESHOLD = 80f

    /** 「需多练」最多展示条数 */
    const val WEAK_LIMIT = 8

    /** 分组 key 截断长度（`ref_text` 去空白后取前 8 个字符） */
    const val WEAK_KEY_LEN = 8

    const val DAY_MS = 86_400_000L

    /** 记录侧日期：`created_at` 的前 10 个字符（对齐 JS 的 `slice(0, 10)`，不足 10 位就原样返回） */
    fun dayKeyOf(createdAt: String): String = createdAt.take(10)

    /** 一天的本地日期 key；年份**不补零**，对齐 JS 的 `String(getFullYear())` */
    private fun localKeyAt(epochMs: Long, zone: ZoneId): String {
        val d = Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate()
        return "${d.year}-${pad2(d.monthValue)}-${pad2(d.dayOfMonth)}"
    }

    /** cutoff 用 `YYYY-MM-DD`（年份补零），对齐 JS 的 `toISOString().slice(0, 10)` */
    private fun utcDateAt(epochMs: Long): String =
        Instant.ofEpochMilli(epochMs).atZone(ZoneOffset.UTC).toLocalDate()
            .format(DateTimeFormatter.ISO_LOCAL_DATE)

    private fun pad2(v: Int): String = if (v < 10) "0$v" else "$v"

    /**
     * 近 7 天逐日统计（**今天在最右**）。
     * `nowMs` / `zone` 显式传入以便单测固定时间；生产上传系统时钟与默认时区。
     */
    fun days7(
        records: List<SoeRecord>,
        nowMs: Long,
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<DayStat> {
        val out = ArrayList<DayStat>(WEEK_DAYS)
        for (i in WEEK_DAYS - 1 downTo 0) {
            val key = localKeyAt(nowMs - i * DAY_MS, zone)
            val dayRecs = records.filter { dayKeyOf(it.createdAt) == key }
            val scores = dayRecs.map { it.suggestedScore.toDouble() }.filter { it > 0.0 }
            out += DayStat(
                date = key,
                count = dayRecs.size,
                avgScore = if (scores.isNotEmpty()) Math.round(scores.sum() / scores.size).toInt() else null,
            )
        }
        return out
    }

    /** 本周评测次数 = 7 天计数之和 */
    fun weekCount(days: List<DayStat>): Int = days.sumOf { it.count }

    /**
     * 本周平均分 = `suggested_score > 0` 且日期不早于 7 天窗口最早那天的记录求平均，四舍五入。
     * 无合格记录返回 **null**（页面显示 `—`）。
     */
    fun weekAvg(records: List<SoeRecord>, days: List<DayStat>): Int? {
        val oldest = days.firstOrNull()?.date ?: return null
        val scored = records.filter {
            it.suggestedScore > 0f && dayKeyOf(it.createdAt) >= oldest
        }
        if (scored.isEmpty()) return null
        val sum = scored.sumOf { it.suggestedScore.toDouble() }
        return Math.round(sum / scored.size).toInt()
    }

    /**
     * 需要多练的词：近 [WEAK_WINDOW_DAYS] 天内、按去空白后前 [WEAK_KEY_LEN] 字分组，
     * 每组保留**最低分**，再筛 `< `[WEAK_THRESHOLD]、按分数**升序**取前 [WEAK_LIMIT] 个。
     *
     * 同分时按首次出现顺序（JS 的 `Map` 插入序 + 稳定排序），故用 `LinkedHashMap` + `sortedBy`。
     */
    fun weakWords(records: List<SoeRecord>, nowMs: Long): List<WeakWord> {
        val cutoff = utcDateAt(nowMs - WEAK_WINDOW_DAYS * DAY_MS)
        val min = LinkedHashMap<String, Float>()
        for (r in records) {
            if (r.suggestedScore <= 0f || dayKeyOf(r.createdAt) < cutoff) continue
            // web 用的是 JS 的正则空白集（含全角空格 / NBSP / BOM），不能直接换成 Kotlin 的 `\s`
            val key = removeJsWhitespace(r.refText).take(WEAK_KEY_LEN)
            if (key.isEmpty()) continue
            val prev = min[key]
            if (prev == null || r.suggestedScore < prev) min[key] = r.suggestedScore
        }
        return min.entries
            .filter { it.value < WEAK_THRESHOLD }
            .sortedBy { it.value }
            .take(WEAK_LIMIT)
            .map { WeakWord(it.key, it.value) }
    }
}
