package com.example.ai.ui.diary

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.diary.DiaryEntry
import com.example.ai.data.diary.DiaryRepository
import com.example.ai.data.diary.DiaryStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class DiaryUiState(
    val entries: List<DiaryEntry> = emptyList(),
    val text: String = "",
    val today: String = "",
    val busy: Boolean = false,
    val loading: Boolean = true,
    val error: String = "",
) {
    val todayEntry: DiaryEntry? get() = entries.firstOrNull { it.date == today }
}

/**
 * 成长日记（对齐 web DiaryPage）：每天一句话，AI 润色 + 温暖点评，时间线回顾。
 * 数据存本地（DiaryStore），只有润色走服务端 LLM。
 */
class DiaryViewModel(
    private val store: DiaryStore,
    private val repository: DiaryRepository = DiaryRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(DiaryUiState())
    val uiState: StateFlow<DiaryUiState> = _uiState.asStateFlow()

    init {
        val today = DiaryStore.todayKey()
        viewModelScope.launch {
            val list = withContext(Dispatchers.IO) { store.load() }
            _uiState.value = _uiState.value.copy(
                entries = list,
                today = today,
                // 今天已写过 → 回填原话，方便「重新润色」
                text = list.firstOrNull { it.date == today }?.text.orEmpty(),
                loading = false,
            )
        }
    }

    fun onTextChange(text: String) {
        _uiState.value = _uiState.value.copy(text = text)
    }

    fun submit() {
        val st = _uiState.value
        val t = st.text.trim()
        if (t.isEmpty() || st.busy || st.today.isEmpty()) return
        _uiState.value = st.copy(busy = true, error = "")
        viewModelScope.launch {
            val result = repository.polish(t)
            if (result == null) {
                _uiState.value = _uiState.value.copy(busy = false, error = "AI 老师没回应，稍后再试试")
                return@launch
            }
            val list = withContext(Dispatchers.IO) {
                store.upsert(DiaryEntry(date = st.today, text = t, polish = result.polish, comment = result.comment))
            }
            _uiState.value = _uiState.value.copy(busy = false, entries = list, error = "")
        }
    }

    fun delete(date: String) {
        if (date.isBlank()) return
        viewModelScope.launch {
            val list = withContext(Dispatchers.IO) { store.remove(date) }
            _uiState.value = _uiState.value.copy(
                entries = list,
                // 删了今天那条 → 输入框也清空
                text = if (date == _uiState.value.today) "" else _uiState.value.text,
            )
        }
    }
}
