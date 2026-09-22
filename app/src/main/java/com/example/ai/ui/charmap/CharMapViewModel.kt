package com.example.ai.ui.charmap

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.charmap.CharMapCell
import com.example.ai.data.charmap.CharMapGroup
import com.example.ai.data.charmap.CharMapRepository
import com.example.ai.data.charmap.LearnStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 年级顺序（对齐 web CharMapPage 的 GRADE_ORDER，未匹配的年级排到最后） */
private val GRADE_ORDER = listOf(
    "一年级上", "一年级下", "二年级上", "二年级下", "三年级上", "三年级下",
    "四年级上", "四年级下", "五年级上", "五年级下", "六年级上", "六年级下",
)

data class CharMapUiState(
    val groups: List<CharMapGroup> = emptyList(),
    /** char → 学习状态（点亮判据：CORRECT） */
    val statusMap: Map<String, LearnStatus> = emptyMap(),
    val total: Int = 0,
    val litTotal: Int = 0,
    val loading: Boolean = true,
    val error: String = "",
)

/**
 * 汉字地图（对齐 web CharMapPage）：全部字卡按年级铺成地图，评价过「认识 ✓」的格子点亮。
 * 反馈拉取失败不影响地图展示（只是没有点亮信息）。
 */
class CharMapViewModel(
    private val repository: CharMapRepository = CharMapRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(CharMapUiState())
    val uiState: StateFlow<CharMapUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        _uiState.value = _uiState.value.copy(loading = true, error = "")
        viewModelScope.launch {
            val cells = repository.listAll()
            if (cells == null) {
                _uiState.value = _uiState.value.copy(loading = false, error = "加载失败：请检查网络或重新登录")
                return@launch
            }
            // 反馈失败 → 空 map（web 同样 catch 住、不影响铺图）
            val status = repository.feedbackStatus(TokenManager.userId) ?: emptyMap()

            val byGrade = LinkedHashMap<String, MutableList<CharMapCell>>()
            for (c in cells) {
                val key = "${c.grade}${c.semester}"
                byGrade.getOrPut(key) { mutableListOf() }.add(c)
            }
            val groups = byGrade.entries
                .sortedBy { (GRADE_ORDER.indexOf(it.key) + 99) % 99 }
                .map { (key, list) ->
                    CharMapGroup(
                        key = key,
                        cells = list,
                        litCount = list.count { status[it.char] == LearnStatus.CORRECT },
                    )
                }
            _uiState.value = CharMapUiState(
                groups = groups,
                statusMap = status,
                total = cells.size,
                litTotal = groups.sumOf { it.litCount },
                loading = false,
                error = "",
            )
        }
    }
}
