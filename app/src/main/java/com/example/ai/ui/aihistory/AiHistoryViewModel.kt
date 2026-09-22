package com.example.ai.ui.aihistory

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aihistory.AiHistoryItem
import com.example.ai.data.aihistory.AiHistoryStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class AiHistoryUiState(
    val module: String = "chinese",
    val items: List<AiHistoryItem> = emptyList(),
    val loading: Boolean = false,
)

/** AI 历史会话列表（对齐 web AiHistoryPage：按模块分桶，本地存储） */
class AiHistoryViewModel(
    private val store: AiHistoryStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiHistoryUiState())
    val uiState: StateFlow<AiHistoryUiState> = _uiState.asStateFlow()

    fun selectModule(module: String) {
        _uiState.value = _uiState.value.copy(module = module, loading = true)
        load()
    }

    fun refresh() = load()

    private fun load() {
        val module = _uiState.value.module
        viewModelScope.launch {
            val items = withContext(Dispatchers.IO) { store.list(module) }
            if (_uiState.value.module == module) {
                _uiState.value = _uiState.value.copy(items = items, loading = false)
            }
        }
    }

    fun remove(id: String) {
        val module = _uiState.value.module
        viewModelScope.launch {
            withContext(Dispatchers.IO) { store.remove(module, id) }
            if (_uiState.value.module == module) load()
        }
    }
}

/** 历史详情（识别快照只读回看）状态由 Screen 直接从 store 读取（单条、静态） */
class AiHistoryDetailViewModel(
    private val store: AiHistoryStore,
) : ViewModel() {

    /** 按 id 取单条（IO） */
    suspend fun find(module: String, id: String): AiHistoryItem? =
        withContext(Dispatchers.IO) { store.list(module).firstOrNull { it.id == id } }
}
