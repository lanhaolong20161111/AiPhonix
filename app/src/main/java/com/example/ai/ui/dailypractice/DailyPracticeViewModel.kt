package com.example.ai.ui.dailypractice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.training.PlanResult
import com.example.ai.data.training.SessionResultStore
import com.example.ai.data.wordbank.WordBankEntry
import com.example.ai.data.wordbank.WordBankRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlin.random.Random

/** 单题模型 */
data class DailyQuestion(
    val prompt: String,          // 拼音提示（显示给用户）
    val options: List<String>,   // 4 个汉字选项（随机排列）
    val correctIndex: Int,       // 正确选项在 options 中的索引
)

/** UI 状态 */
data class DailyPracticeUiState(
    val questions: List<DailyQuestion> = emptyList(),
    val currentIndex: Int = 0,          // 当前题号（0-based）
    val correctCount: Int = 0,          // 已答对数
    val totalCount: Int = 10,           // 总题数
    val selectedIndex: Int = -1,        // 当前题用户选的索引；-1 未选
    val isCorrect: Boolean? = null,     // 当前题判断结果
    val isFinished: Boolean = false,    // 全部完成
    val isLoading: Boolean = true,
    val error: String? = null,
) {
    val currentQuestion: DailyQuestion? get() = questions.getOrNull(currentIndex)
    val progressText: String get() = "${currentIndex + (if (isFinished) 1 else 0)} / $totalCount"
}

class DailyPracticeViewModel(
    private val wordBankRepo: WordBankRepository,
    private val sessionResultStore: SessionResultStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DailyPracticeUiState())
    val uiState: StateFlow<DailyPracticeUiState> = _uiState

    // V2：当前任务项 ID（从 ActiveTrainingSession 注入）
    private var taskItemId: String? = null

    fun setTaskItemId(id: String?) {
        taskItemId = id
    }

    init {
        generateQuestions()
    }

    private fun generateQuestions() {
        viewModelScope.launch {
            try {
                val entries = wordBankRepo.queryWords() + wordBankRepo.queryChars()
                if (entries.size < 4) {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = "词库数据不足（至少需要 4 个条目）",
                    )
                    return@launch
                }

                val pool = entries.toMutableList()
                val questions = mutableListOf<DailyQuestion>()
                val n = 10.coerceAtMost(pool.size)

                repeat(n) {
                    val correctIdx = Random.nextInt(pool.size)
                    val correct = pool.removeAt(correctIdx)

                    // 干扰项：从 pool 中随机取 3 个，优先同类型
                    val sameType = pool.filter { it.type == correct.type }
                    val other = pool - sameType.toSet()
                    val distractors = (sameType.shuffled().take(3) + other.shuffled()).distinct().take(3)
                    // 如果不够 3 个（极端场景），用任意 pool
                    val finalDistractors = if (distractors.size < 3) {
                        (distractors + pool.shuffled().take(3)).distinct().take(3)
                    } else distractors

                    val options = (listOf(correct) + finalDistractors.map { it }
                        .filter { it.text != correct.text })
                        .take(4)
                        .shuffled()

                    val correctAfterShuffle = options.indexOfFirst { it.text == correct.text }

                    questions.add(
                        DailyQuestion(
                            prompt = correct.pinyin.ifBlank { correct.text },
                            options = options.map { it.text },
                            correctIndex = correctAfterShuffle,
                        )
                    )
                }

                _uiState.value = _uiState.value.copy(
                    questions = questions,
                    isLoading = false,
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = "加载题库失败：${e.message}",
                )
            }
        }
    }

    /** 用户点击选项 */
    fun selectOption(index: Int) {
        val state = _uiState.value
        val q = state.currentQuestion ?: return
        if (state.selectedIndex >= 0) return // 已选过，防止重复

        val isCorrect = index == q.correctIndex
        _uiState.value = state.copy(
            selectedIndex = index,
            isCorrect = isCorrect,
            correctCount = if (isCorrect) state.correctCount + 1 else state.correctCount,
        )
    }

    /** 下一题 */
    fun nextQuestion() {
        val state = _uiState.value
        val nextIdx = state.currentIndex + 1

        if (nextIdx >= state.totalCount) {
            // 全部完成，record 结果
            _uiState.value = state.copy(isFinished = true)
            taskItemId?.let {
                sessionResultStore.record(
                    it,
                    PlanResult(count = state.totalCount, correct = state.correctCount),
                )
            }
        } else {
            _uiState.value = state.copy(
                currentIndex = nextIdx,
                selectedIndex = -1,
                isCorrect = null,
            )
        }
    }
}
