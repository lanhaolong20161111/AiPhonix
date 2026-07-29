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
    /** 合并辅音连缀后的音素列表（如 t+r → tr），用于 UI 显示 */
    val displayPhonemes: List<String> = emptyList(),
    /** 每个展示音素对应的 Phonics 页面 index（-1 表示未找到） */
    val phonemeToPhonicsIndex: Map<String, Int> = emptyMap(),
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
            // 先从词库找
            var word = contentRepository.getAllWords().find { it.text == wordId }
            if (word == null) {
                // 再从三年级英语词汇降级查找
                val ew = contentRepository.getAllEnglishWords().find { it.word == wordId }
                if (ew != null) {
                    word = Word(
                        text = ew.word,
                        ipa = ew.phonetic,
                        letter = ew.firstLetter,
                        phonemes = emptyList(),
                        emoji = null,
                        difficulty = 1,
                    )
                }
            }
            // 构建音素→Phonics index 映射
            val allPhonemes = contentRepository.getAllPhonemes()
            val phonemeToIndex = mutableMapOf<String, Int>()
            allPhonemes.forEachIndexed { i, ph ->
                phonemeToIndex[ph.symbol.trim('/')] = i
            }
            // 合并辅音连缀（如 t+r→tr）
            val wordPhonemes = word?.phonemes ?: emptyList()
            val mergedPhonemes = mergeBlends(wordPhonemes)
            // 每个展示音素找 Phonics index：优先查合并后的音素，找不到再用首个原始音素
            val resultMap = mutableMapOf<String, Int>()
            var j = 0
            for (merged in mergedPhonemes) {
                val len = blendedLength(merged)  // 由几个原始音素合并而成
                val firstOrig = wordPhonemes.getOrNull(j) ?: ""
                val idx = if (len > 1) {
                    // 合并后的音素本身可能在音素表里（如 tr→/tr/），优先用这个
                    phonemeToIndex[merged] ?: -1
                } else {
                    phonemeToIndex[firstOrig] ?: -1
                }
                resultMap[merged] = idx
                j += len
            }
            _uiState.update {
                it.copy(
                    word = word,
                    displayPhonemes = mergedPhonemes,
                    phonemeToPhonicsIndex = resultMap,
                )
            }
        }
    }

    companion object {
        // 常见双字母辅音连缀
        private val BLENDS_2 = setOf(
            "tr", "dr", "pr", "br", "cr", "gr", "fr",
            "pl", "bl", "cl", "gl", "fl", "sl",
            "sc", "sk", "sm", "sn", "sp", "st", "sw", "tw",
            "dw", "gw", "kw", "wh",
        )
        // 三字母连缀
        private val BLENDS_3 = setOf(
            "str", "spr", "scr", "spl", "squ", "thr", "shr",
        )
    }

    /** 合并已知辅音连缀 */
    private fun mergeBlends(phonemes: List<String>): List<String> {
        val result = mutableListOf<String>()
        var i = 0
        while (i < phonemes.size) {
            when {
                i + 2 < phonemes.size &&
                    (phonemes[i] + phonemes[i + 1] + phonemes[i + 2]) in BLENDS_3 -> {
                    result.add(phonemes[i] + phonemes[i + 1] + phonemes[i + 2])
                    i += 3
                }
                i + 1 < phonemes.size &&
                    (phonemes[i] + phonemes[i + 1]) in BLENDS_2 -> {
                    result.add(phonemes[i] + phonemes[i + 1])
                    i += 2
                }
                else -> {
                    result.add(phonemes[i])
                    i += 1
                }
            }
        }
        return result
    }

    /** 返回合并后的音素由几个原始音素组成 */
    private fun blendedLength(blended: String): Int = when {
        blended in BLENDS_3 -> 3
        blended in BLENDS_2 -> 2
        else -> 1
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

    /** 播放单个音素的发音 */
    fun playPhonemeSound(phoneme: String) {
        viewModelScope.launch {
            try {
                ttsEngine.speak(phoneme)
            } catch (e: Exception) {
                Log.w("PronVm", "音素发音播放异常: ${e.message}")
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
