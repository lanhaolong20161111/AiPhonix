package com.example.ai.ui.soehistory

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.soerecord.SoeRecord
import com.example.ai.data.soerecord.SoeRecordRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SoeHistoryUiState(
    val records: List<SoeRecord> = emptyList(),
    val loading: Boolean = true,
    val error: String = "",
    val expandedId: Long? = null,
    val selectedIds: Set<Long> = emptySet(),
    val deleting: Boolean = false,
) {
    val allSelected: Boolean get() = records.isNotEmpty() && selectedIds.size == records.size
}

/** 评测历史（对齐 web SoeHistoryPage：本账号全部发音评测记录 + 音素明细 + 删除） */
class SoeHistoryViewModel(
    private val repository: SoeRecordRepository = SoeRecordRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(SoeHistoryUiState())
    val uiState: StateFlow<SoeHistoryUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        _uiState.value = _uiState.value.copy(loading = true, error = "")
        viewModelScope.launch {
            val records = repository.fetchRecords()
            if (records == null) {
                _uiState.value = _uiState.value.copy(loading = false, error = "加载失败：请检查网络或重新登录")
            } else {
                _uiState.value = _uiState.value.copy(loading = false, records = records, error = "")
            }
        }
    }

    fun toggleExpand(id: Long) {
        _uiState.value = _uiState.value.copy(expandedId = if (_uiState.value.expandedId == id) null else id)
    }

    fun toggleSelect(id: Long) {
        val cur = _uiState.value.selectedIds
        _uiState.value = _uiState.value.copy(selectedIds = if (id in cur) cur - id else cur + id)
    }

    fun toggleSelectAll() {
        val st = _uiState.value
        _uiState.value = _uiState.value.copy(
            selectedIds = if (st.allSelected) emptySet() else st.records.map { it.id }.toSet(),
        )
    }

    fun delete(id: Long) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(deleting = true)
            val ok = repository.deleteRecord(id)
            _uiState.value = _uiState.value.copy(
                deleting = false,
                records = if (ok) _uiState.value.records.filter { it.id != id } else _uiState.value.records,
                expandedId = if (ok && _uiState.value.expandedId == id) null else _uiState.value.expandedId,
                selectedIds = _uiState.value.selectedIds - id,
                error = if (ok) _uiState.value.error else "删除失败，请重试",
            )
        }
    }

    fun batchDelete() {
        val ids = _uiState.value.selectedIds.toList()
        if (ids.isEmpty()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(deleting = true)
            val deleted = repository.batchDelete(ids)
            val st = _uiState.value
            _uiState.value = if (deleted < 0) {
                st.copy(deleting = false, error = "批量删除失败，请重试")
            } else {
                st.copy(
                    deleting = false,
                    records = st.records.filter { it.id !in ids },
                    selectedIds = emptySet(),
                    expandedId = if (st.expandedId in ids) null else st.expandedId,
                    error = if (deleted < ids.size) "已删除 $deleted/${ids.size} 条（部分可能不存在）" else "",
                )
            }
        }
    }
}
