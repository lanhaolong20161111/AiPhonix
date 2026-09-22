package com.example.ai.ui.memoryjoy

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.joy.JoyEntry
import com.example.ai.data.joy.JoyRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 同一天的文段分组 */
data class JoyGroup(val date: String, val entries: List<JoyEntry>)

data class MemoryJoyUiState(
    val groups: List<JoyGroup> = emptyList(),
    val loading: Boolean = true,
    val error: String = "",
    /** 正在发音的单字（逐字点读的高亮） */
    val speakingChar: String = "",
) {
    val total: Int get() = groups.sumOf { it.entries.size }
}

/**
 * 记忆快乐本（对齐 web MemoryJoyPage）：当日字词 → LLM 趣味文段，按日期倒序分组。
 * 服务端已按 date 倒序返回，顺序分组即可。
 */
class MemoryJoyViewModel(
    private val repository: JoyRepository = JoyRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(MemoryJoyUiState())
    val uiState: StateFlow<MemoryJoyUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        _uiState.value = _uiState.value.copy(loading = true, error = "")
        viewModelScope.launch {
            val list = repository.list()
            _uiState.value = if (list == null) {
                _uiState.value.copy(loading = false, error = "加载失败：请检查网络或重新登录")
            } else {
                _uiState.value.copy(loading = false, groups = group(list), error = "")
            }
        }
    }

    /** 刷新（下拉/按钮）——不清空现有内容，失败时保留现状 */
    fun refresh() {
        viewModelScope.launch {
            val list = repository.list()
            if (list != null) _uiState.value = _uiState.value.copy(groups = group(list), error = "")
        }
    }

    fun delete(id: Long) {
        viewModelScope.launch {
            val ok = repository.delete(id)
            if (ok) {
                val next = _uiState.value.groups
                    .map { g -> g.copy(entries = g.entries.filter { it.id != id }) }
                    .filter { it.entries.isNotEmpty() }
                _uiState.value = _uiState.value.copy(groups = next, error = "")
            } else {
                _uiState.value = _uiState.value.copy(error = "删除失败，请重试")
            }
        }
    }

    fun setSpeakingChar(ch: String) {
        _uiState.value = _uiState.value.copy(speakingChar = ch)
    }

    /** 顺序分组（相邻同日期归一组） */
    private fun group(items: List<JoyEntry>): List<JoyGroup> {
        val out = mutableListOf<JoyGroup>()
        val buf = mutableListOf<JoyEntry>()
        var curDate = ""
        for (it in items) {
            if (buf.isNotEmpty() && it.date != curDate) {
                out.add(JoyGroup(curDate, buf.toList()))
                buf.clear()
            }
            curDate = it.date
            buf.add(it)
        }
        if (buf.isNotEmpty()) out.add(JoyGroup(curDate, buf.toList()))
        return out
    }
}
