package com.example.ai.ui.aichinese

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.data.aichinese.CharClickStats
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class AiChineseCharStatsUiState(
    val stats: CharClickStats = CharClickStats(),
    val loading: Boolean = false,
    val error: String = "",
)

/** 认读画像：该学生点击发音次数降序（点击越多 → 越不会认读） */
class AiChineseCharStatsViewModel(
    private val repository: AiChineseRepository = AiChineseRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiChineseCharStatsUiState())
    val uiState: StateFlow<AiChineseCharStatsUiState> = _uiState.asStateFlow()

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
