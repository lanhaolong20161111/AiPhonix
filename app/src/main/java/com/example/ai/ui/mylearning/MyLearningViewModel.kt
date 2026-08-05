package com.example.ai.ui.mylearning

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.speech.ScoreClient
import com.example.ai.data.userimport.UserImportStore
import com.example.ai.di.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject

/**
 * 「我的学习」聚合页：按 kind 统计导入量 + 练习成绩统计 + 练习入口。
 * 数据来自本地 UserImportStore + 服务端 /practice/stats。
 */
class MyLearningViewModel(private val store: UserImportStore) : ViewModel() {

    private val _uiState = MutableStateFlow(MyLearningUiState())
    val uiState: StateFlow<MyLearningUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    private fun load() {
        val items = store.load()
        val counts = items.groupingBy { it.kind }.eachCount()
        _uiState.value = _uiState.value.copy(loading = true, counts = counts)
        viewModelScope.launch {
            val stats = withContext(Dispatchers.IO) { fetchStats() }
            _uiState.value = MyLearningUiState(
                loading = false,
                counts = counts,
                totalSessions = stats.first,
                totalChars = stats.second,
                totalCorrect = stats.third,
                statsError = statsFetchFailed,
            )
        }
    }

    /** 拉取练习统计（全部模块） */
    private fun fetchStats(): Triple<Int, Int, Int> {
        return try {
            val req = Request.Builder()
                .url("${ScoreClient.serverBase()}/api/v1/practice/stats")
                .get()
                .build()
            val resp = NetworkModule.httpClient.newCall(req).execute()
            if (!resp.isSuccessful) {
                statsFetchFailed = true
                return Triple(0, 0, 0)
            }
            val body = resp.body?.string().orEmpty()
            val obj = JSONObject(body)
            statsFetchFailed = false
            Triple(
                obj.optInt("total_sessions", 0),
                obj.optInt("total_chars", 0),
                obj.optInt("total_correct", 0),
            )
        } catch (e: Exception) {
            Log.w(TAG, "拉取练习统计失败: ${e.message}")
            statsFetchFailed = true
            Triple(0, 0, 0)
        }
    }

    private var statsFetchFailed = false

    companion object {
        private const val TAG = "MyLearningViewModel"
    }
}

data class MyLearningUiState(
    val loading: Boolean = true,
    val counts: Map<String, Int> = emptyMap(),
    val totalSessions: Int = 0,
    val totalChars: Int = 0,
    val totalCorrect: Int = 0,
    /** 练习统计是否因断网拉取失败 */
    val statsError: Boolean = false,
)
