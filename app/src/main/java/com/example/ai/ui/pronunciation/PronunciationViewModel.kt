package com.example.ai.ui.pronunciation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.*
import com.example.ai.data.repository.ContentRepository
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.data.tts.TtsEngine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import android.util.Log

data class PronunciationUiState(
    val word: Word? = null,
    val step: PronunciationStep = PronunciationStep.IDLE,
    val result: PronunciationResult? = null,
    val error: String? = null,
)

enum class PronunciationStep {
    IDLE,           // 初始
    PLAYING,        // TTS 播放中
    ASSESSING,      // 腾讯录音 + 流式评测中
    RESULT,         // 结果展示
}

class PronunciationViewModel(
    private val contentRepository: ContentRepository,
    private val speechRepository: SpeechRepository,
    private val ttsEngine: TtsEngine,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PronunciationUiState())
    val uiState: StateFlow<PronunciationUiState> = _uiState.asStateFlow()

    fun loadWord(wordId: String) {
        viewModelScope.launch {
            _uiState.update { PronunciationUiState() }
            val word = contentRepository.getAllWords().find { it.text == wordId }
            _uiState.update { it.copy(word = word) }
            if (word != null) {
                // 不再自动播放 TTS，由用户点击按钮触发
            }
        }
    }

    fun playTts() {
        val word = _uiState.value.word ?: return
        _uiState.update { it.copy(step = PronunciationStep.PLAYING) }
        viewModelScope.launch {
            try {
                ttsEngine.speak(word.text)
            } catch (e: Exception) {
                Log.w("PronVm", "TTS 播放异常: ${e.message}")
            } finally {
                _uiState.update { it.copy(step = PronunciationStep.IDLE) }
            }
        }
    }

    /** 开始流式评测（录音 + 打分同时进行） */
    fun startEvaluation() {
        val word = _uiState.value.word ?: run {
            _uiState.update { it.copy(error = "未加载单词") }
            return
        }

        _uiState.update { it.copy(step = PronunciationStep.ASSESSING, error = null, result = null) }

        viewModelScope.launch {
            try {
                val result = speechRepository.startStreamingEvaluation(word)
                _uiState.update { it.copy(step = PronunciationStep.RESULT, result = result) }
            } catch (e: Exception) {
                Log.e("PronVm", "流式评测失败", e)
                val msg = e.message ?: "${e::class.simpleName ?: "未知异常"}"
                _uiState.update { it.copy(step = PronunciationStep.IDLE, error = "评测失败: $msg") }
            }
        }
    }

    /** 用户按停止按钮 */
    fun stopEvaluation() {
        speechRepository.stopStreamingEvaluation()
    }

    fun reset() {
        val currentWord = _uiState.value.word
        _uiState.update { PronunciationUiState(word = currentWord) }
    }
}
