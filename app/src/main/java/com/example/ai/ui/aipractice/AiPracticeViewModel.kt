package com.example.ai.ui.aipractice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aipractice.AiPracticeRepository
import com.example.ai.data.aipractice.AiPracticeSessionSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** ai陪我练 主页状态 */
data class AiPracticeUiState(
    val content: String = "",
    val contentType: String = "sentence",   // char | word | sentence | article
    val task: String = "",
    val creating: Boolean = false,
    val error: String = "",
    val loadingHistory: Boolean = false,
    val sessions: List<AiPracticeSessionSummary> = emptyList(),
    val createdSessionId: Int? = null,
)

/**
 * ai陪我练 主页 ViewModel：导入主题（文本）→ 创建会话；历史列表。
 */
class AiPracticeViewModel(
    private val repository: AiPracticeRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiPracticeUiState())
    val uiState: StateFlow<AiPracticeUiState> = _uiState.asStateFlow()

    fun updateContent(v: String) {
        _uiState.value = _uiState.value.copy(content = v)
    }

    fun updateContentType(v: String) {
        _uiState.value = _uiState.value.copy(contentType = v)
    }

    fun updateTask(v: String) {
        _uiState.value = _uiState.value.copy(task = v)
    }

    /** 创建会话（LangGraph 首问），成功后由 UI 跳转会话页 */
    fun createSession(onCreated: (Int) -> Unit) {
        val s = _uiState.value
        if (s.creating) return
        val content = s.content.trim()
        if (content.isEmpty()) {
            _uiState.value = s.copy(error = "请先输入学习内容（可粘贴或直接输入）")
            return
        }
        viewModelScope.launch {
            _uiState.value = s.copy(creating = true, error = "")
            try {
                val r = repository.createSession(content, s.contentType, s.task.trim())
                _uiState.value = _uiState.value.copy(creating = false, createdSessionId = r.sessionId)
                onCreated(r.sessionId)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(creating = false, error = "创建失败：${e.message}")
            }
        }
    }

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
