package com.example.ai.data.parentreport

import com.example.ai.data.auth.TokenManager
import com.example.ai.data.charmap.CharMapRepository
import com.example.ai.data.charmap.FeedbackStats
import com.example.ai.data.soerecord.SoeRecord
import com.example.ai.data.soerecord.SoeRecordRepository
import com.example.ai.data.wordbook.WordbookRepository
import kotlinx.coroutines.async
import kotlinx.coroutines.supervisorScope

/** 家长周报一次性拉回的三份数据 */
data class ParentReportData(
    /** 评测记录（按时间倒序） */
    val records: List<SoeRecord> = emptyList(),
    /** 识字状态统计 */
    val stats: FeedbackStats = FeedbackStats(),
    /** 生词本收藏数 */
    val wordCount: Int = 0,
    /** 三个数据源**全部**失败（通常是断网） */
    val failed: Boolean = false,
)

/**
 * 家长周报仓库 —— 对齐 web `ParentReportPage` 的 `Promise.all` 三路并发。
 *
 * ★ 三个来源各有归属，本仓库只做**聚合**（不重复实现 HTTP）：
 * 1. `POST /soe/records` —— web 传 `limit: 500`，但服务端 `Math.min(limit, 200)` 会夹到 200
 *    ⇒ 这里直接要 200，**取到的数据与 web 完全一致**（不是能力缩水）。
 * 2. `GET /char-images/feedback` —— 需要响应体里的 `stats`（`CharMapRepository.feedbackWithStats`）。
 * 3. `GET /wordbook/list` —— 只取条数。
 *
 * 与 web 一样**部分失败可降级**（web 是每个都 `.catch(() => 空)`）：某路失败就以空值顶上，
 * 三路全失败才置 `failed`。`supervisorScope` 保证一路异常不会连坐取消另两路。
 */
class ParentReportRepository(
    private val soe: SoeRecordRepository = SoeRecordRepository(),
    private val charMap: CharMapRepository = CharMapRepository(),
    private val wordbook: WordbookRepository = WordbookRepository(),
) {

    suspend fun load(): ParentReportData = supervisorScope {
        val recordsDeferred = async { soe.fetchRecords(SOE_LIMIT) }
        val feedbackDeferred = async { charMap.feedbackWithStats(TokenManager.userId) }
        val wordsDeferred = async { wordbook.list() }

        val records = recordsDeferred.await()
        val feedback = feedbackDeferred.await()
        val words = wordsDeferred.await()

        ParentReportData(
            records = records.orEmpty(),
            stats = feedback?.second ?: FeedbackStats(),
            wordCount = words?.size ?: 0,
            failed = records == null && feedback == null && words == null,
        )
    }

    private companion object {
        /** 服务端上限就是 200（web 传 500 会被夹到 200） */
        const val SOE_LIMIT = 200
    }
}
