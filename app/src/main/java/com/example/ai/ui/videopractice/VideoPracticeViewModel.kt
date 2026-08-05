package com.example.ai.ui.videopractice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.repository.SpeechRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import android.util.Log

data class VideoPracticeState(
    val isRecording: Boolean = false,
    val score: Int? = null,
    val wordScores: List<com.example.ai.data.model.WordScore> = emptyList(),
    val resultText: String = "",
    val error: String? = null,
)

class VideoPracticeViewModel(
    private val speechRepository: SpeechRepository,
    private val sessionResultStore: com.example.ai.data.training.SessionResultStore,
) : ViewModel() {

    private val _state = MutableStateFlow(VideoPracticeState())
    val state: StateFlow<VideoPracticeState> = _state.asStateFlow()

    fun startRecording(targetText: String) {
        if (targetText.isBlank()) return
        _state.value = VideoPracticeState(isRecording = true)

        viewModelScope.launch {
            try {
                // 用 Word 对象包装文本传给现有评测管线
                val word = com.example.ai.data.model.Word(
                    text = targetText,
                    ipa = "",
                    letter = targetText.firstOrNull()?.toString() ?: "",
                    phonemes = emptyList()
                )
                val result = speechRepository.startStreamingEvaluation(word)
                _state.value = VideoPracticeState(
                    isRecording = false,
                    score = result.totalScore,
                    wordScores = result.wordScores,
                    resultText = "发音得分: ${result.totalScore}"
                )
                // V2：至少完成一次成功评测即达完成标准，回传真实结果（返回首页时打卡）
                val itemId = com.example.ai.data.training.ActiveTrainingSession.itemId
                if (itemId != null) {
                    val prev = sessionResultStore.snapshot()[itemId]
                    sessionResultStore.record(
                        itemId,
                        com.example.ai.data.training.PlanResult(
                            count = (prev?.count ?: 0) + 1, // 累计成功评测句数
                            score = result.totalScore.toDouble(),
                            durationMs = (prev?.durationMs ?: 0),
                        )
                    )
                }
            } catch (e: Exception) {
                Log.e("VideoPractice", "评测失败", e)
                _state.value = VideoPracticeState(
                    error = "评测失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 切换视频或重置 UI 时调用，清空旧评分/错误以免残留到新视频。
     */
    fun resetState() {
        _state.value = VideoPracticeState()
    }

    fun stopRecording() {
        speechRepository.stopStreamingEvaluation()
        // 等协程返回结果后会自动更新 _state，这里不提前清空
    }
}
