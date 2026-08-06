package com.example.ai.ui.pronunciation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.*
import com.example.ai.data.audio.PronunciationStyle
import com.example.ai.data.audio.PronunciationStyleStore
import com.example.ai.data.repository.ContentRepository
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.data.repository.WordImageRepository
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
    /** 单词图片 URL（服务端图片库，无图时为 null → UI 回退 emoji） */
    val wordImageUrl: String? = null,
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
    private val wordImageRepository: WordImageRepository,
    private val styleStore: PronunciationStyleStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PronunciationUiState())
    val uiState: StateFlow<PronunciationUiState> = _uiState.asStateFlow()

    fun loadWord(wordId: String) {
        viewModelScope.launch {
            _uiState.update { PronunciationUiState() }
            // 先从词库找（按当前发音风格选英式/美式标注）
            var word = contentRepository.getAllWords().find { it.text == wordId }
            val useUk = styleStore.style.value == PronunciationStyle.UK
            if (word != null && useUk && word.ipaUk.isNotEmpty()) {
                word = word.copy(ipa = word.ipaUk, phonemes = word.phonemesUk.ifEmpty { word.phonemes })
            }
            if (word == null) {
                // 再从三年级英语词汇降级查找
                val ew = contentRepository.getAllEnglishWords().find { it.word == wordId }
                if (ew != null) {
                    word = Word(
                        text = ew.word,
                        ipa = if (useUk && ew.ipaUk.isNotEmpty()) ew.ipaUk else ew.phonetic,
                        letter = ew.firstLetter,
                        phonemes = if (useUk && ew.phonemesUk.isNotEmpty()) ew.phonemesUk else ew.phonemes,
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
            // 合并辅音连缀（如 t+r→tr），但合并结果必须能在音素表找到音频，
            // 否则回退为原始音素逐个显示（如 grape 的 gr 不在 48 音素表 → 拆回 g、r 各自发音）
            val wordPhonemes = word?.phonemes ?: emptyList()
            val mergedPhonemes = mergeBlends(wordPhonemes)
            val displayPhonemes = mutableListOf<String>()
            var j = 0
            for (merged in mergedPhonemes) {
                val len = blendedLength(merged)
                val origs = wordPhonemes.subList(j, j + len)
                if (len > 1 && !phonemeToIndex.containsKey(merged)) {
                    displayPhonemes.addAll(origs)
                } else {
                    displayPhonemes.add(merged)
                }
                j += len
            }
            // 每个展示音素找 Phonics index
            val resultMap = displayPhonemes.associateWith { phonemeToIndex[it] ?: -1 }
            // 查询单词图片（失败静默回退 emoji）
            val imageUrl = try {
                word?.let { wordImageRepository.getImageUrl(it.text) }
            } catch (e: Exception) {
                null
            }
            _uiState.update {
                it.copy(
                    word = word,
                    displayPhonemes = displayPhonemes,
                    phonemeToPhonicsIndex = resultMap,
                    wordImageUrl = imageUrl,
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
                val ok = ttsEngine.speak(word.text)
                if (!ok) {
                    _uiState.update { it.copy(error = "朗读失败，请检查网络") }
                }
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
                val ok = ttsEngine.speak(phoneme)
                if (!ok) {
                    _uiState.update { it.copy(error = "朗读失败，请检查网络") }
                }
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
        val imageUrl = _uiState.value.wordImageUrl
        _uiState.update { PronunciationUiState(word = currentWord, wordImageUrl = imageUrl) }
    }
}
