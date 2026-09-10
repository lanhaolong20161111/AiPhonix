package com.example.ai.ui.aihomework

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aihomework.AiHomeworkRepository
import com.example.ai.data.aihomework.CharClickStats
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class AiHomeworkCharStatsUiState(
    val stats: CharClickStats = CharClickStats(),
    val loading: Boolean = false,
    val error: String = "",
)

/** 认读画像：该学生点击发音次数降序（点击越多 → 越不会认读） */
class AiHomeworkCharStatsViewModel(
    private val repository: AiHomeworkRepository = AiHomeworkRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiHomeworkCharStatsUiState())
    val uiState: StateFlow<AiHomeworkCharStatsUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = "")
            val stats = try {
                withContext(Dispatchers.IO) { repository.fetchCharClickStats() }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(loading = false, error = "画像加载失败：${e.message}")
                return@launch
            }
            _uiState.value = _uiState.value.copy(loading = false, stats = stats)
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = "")
    }
}
