package com.example.ai.ui.parentreport

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.charmap.FeedbackStats
import com.example.ai.data.parentreport.DayStat
import com.example.ai.data.parentreport.ParentReportData
import com.example.ai.data.parentreport.ParentReportLogic
import com.example.ai.data.parentreport.ParentReportRepository
import com.example.ai.data.parentreport.WeakWord
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 家长周报的 UI 状态（所有派生量都在这里算好，Screen 不做计算 —— 见 AGENTS.md） */
data class ParentReportUiState(
    val loading: Boolean = true,
    /** 三路数据全部失败（断网） */
    val failed: Boolean = false,
    val days: List<DayStat> = emptyList(),
    val weekCount: Int = 0,
    val weekAvg: Int? = null,
    val stats: FeedbackStats = FeedbackStats(),
    val wordCount: Int = 0,
    val weakWords: List<WeakWord> = emptyList(),
    val generatedAt: String = "",
) {
    /** 柱状图归一化分母（web 是 `Math.max(1, ...counts)`） */
    val maxCount: Int get() = maxOf(1, days.maxOfOrNull { it.count } ?: 1)

    /** 本周平均分显示文本（无分显示 `—`，对齐 web） */
    val weekAvgText: String get() = weekAvg?.toString() ?: "—"
}

/**
 * 家长周报（对齐 web `ParentReportPage`）—— 近 7 天评测趋势 + 识字状态 + 需多练的词。
 * 全部计算下沉到 [ParentReportLogic] 纯函数，本类只负责拉数据与拼状态。
 */
class ParentReportViewModel(
    private val repository: ParentReportRepository = ParentReportRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(ParentReportUiState())
    val uiState: StateFlow<ParentReportUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        _uiState.value = _uiState.value.copy(loading = true, failed = false)
        viewModelScope.launch {
            val data = repository.load()
            apply(data)
        }
    }

    private fun apply(data: ParentReportData) {
        val nowMs = System.currentTimeMillis()
        val days = ParentReportLogic.days7(data.records, nowMs)
        _uiState.value = ParentReportUiState(
            loading = false,
            failed = data.failed,
            days = days,
            weekCount = ParentReportLogic.weekCount(days),
            weekAvg = ParentReportLogic.weekAvg(data.records, days),
            stats = data.stats,
            wordCount = data.wordCount,
            weakWords = ParentReportLogic.weakWords(data.records, nowMs),
            generatedAt = nowText(nowMs),
        )
    }

    /** JS `new Date().toLocaleString("zh-CN")` 的等价输出（如 `2026/9/22 16:46:44`） */
    private fun nowText(ms: Long): String =
        SimpleDateFormat("yyyy/M/d HH:mm:ss", Locale.CHINA).format(Date(ms))
}
