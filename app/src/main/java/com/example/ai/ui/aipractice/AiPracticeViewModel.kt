package com.example.ai.ui.aipractice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aipractice.AiPracticeRepository
import com.example.ai.data.aipractice.AiPracticeSessionSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** ai陪我练 主页状态（字/词/句/文章练习已移除，仅保留历史记录） */
data class AiPracticeUiState(
    val error: String = "",
    val loadingHistory: Boolean = false,
    val sessions: List<AiPracticeSessionSummary> = emptyList(),
)

/**
 * ai陪我练 主页 ViewModel：历史记录列表（内容练习入口已移除，见 AI 作业模块）。
 */
class AiPracticeViewModel(
    private val repository: AiPracticeRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiPracticeUiState())
    val uiState: StateFlow<AiPracticeUiState> = _uiState.asStateFlow()

    fun loadHistory() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loadingHistory = true)
            try {
                val list = repository.listSessions()
                _uiState.value = _uiState.value.copy(loadingHistory = false, sessions = list)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(loadingHistory = false, error = "历史加载失败：${e.message}")
            }
        }
    }
}
