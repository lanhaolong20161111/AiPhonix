package com.example.ai.ui.wordbook

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.wordbook.WordbookItem
import com.example.ai.data.wordbook.WordbookRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 生词本两个视图：复习（到期队列）/ 词表（全部） */
enum class WordbookTab { REVIEW, LIST }

data class WordbookUiState(
    val tab: WordbookTab = WordbookTab.REVIEW,
    val items: List<WordbookItem> = emptyList(),
    val queue: List<WordbookItem> = emptyList(),
    val loading: Boolean = true,
    val error: String = "",
    /** 本轮复习答对的个数（用于结束语） */
    val doneCount: Int = 0,
    /** 复习打卡/删除进行中（防连点） */
    val busy: Boolean = false,
) {
    /** 当前要复习的卡片（队首） */
    val current: WordbookItem? get() = queue.firstOrNull()
}

/**
 * 生词本（对齐 web WordbookPage）：SRS 间隔重复复习 + 词表管理。
 * 复习队列与词表同时加载；打卡后本地先移除队首（不等刷新），再静默重拉保持一致。
 */
class WordbookViewModel(
    private val repository: WordbookRepository = WordbookRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(WordbookUiState())
    val uiState: StateFlow<WordbookUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        _uiState.value = _uiState.value.copy(loading = true, error = "")
        viewModelScope.launch {
            val all = repository.list()
            val due = repository.reviewQueue()
            _uiState.value = if (all == null || due == null) {
                _uiState.value.copy(loading = false, error = "加载失败：请检查网络或重新登录")
            } else {
                _uiState.value.copy(loading = false, items = all, queue = due, error = "")
            }
        }
    }

    fun selectTab(tab: WordbookTab) {
        _uiState.value = _uiState.value.copy(tab = tab)
    }

    /** 复习打卡：本地先出队，再静默重拉词表与队列 */
    fun rate(item: WordbookItem, correct: Boolean) {
        if (_uiState.value.busy) return
        _uiState.value = _uiState.value.copy(busy = true)
        viewModelScope.launch {
            val ok = repository.rate(item.id, correct)
            if (!ok) {
                _uiState.value = _uiState.value.copy(busy = false, error = "打卡失败，请重试")
                return@launch
            }
            _uiState.value = _uiState.value.copy(
                busy = false,
                queue = _uiState.value.queue.filter { it.id != item.id },
                doneCount = if (correct) _uiState.value.doneCount + 1 else _uiState.value.doneCount,
                error = "",
            )
            refreshSilently()
        }
    }

    fun delete(id: Long) {
        viewModelScope.launch {
            val ok = repository.remove(id)
            _uiState.value = if (ok) {
                _uiState.value.copy(
                    items = _uiState.value.items.filter { it.id != id },
                    queue = _uiState.value.queue.filter { it.id != id },
                    error = "",
                )
            } else {
                _uiState.value.copy(error = "删除失败，请重试")
            }
        }
    }

    /** 重拉数据但不动 loading（避免列表闪一下） */
    private suspend fun refreshSilently() {
        val all = repository.list() ?: return
        val due = repository.reviewQueue() ?: return
        _uiState.value = _uiState.value.copy(items = all, queue = due)
    }
}
