package com.example.ai.ui.phonics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.EnglishWord
import com.example.ai.data.model.Phoneme
import com.example.ai.data.repository.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PhonicsUiState(
    val phonemes: List<Phoneme> = emptyList(),
    val currentIndex: Int = 0,
    /** symbol（如 "/e/"）→ 该音素对应的三年级英语词列表，全量加载保证滑动跟手 */
    val englishWordsMap: Map<String, List<EnglishWord>> = emptyMap(),
    val isLoading: Boolean = true,
)

class PhonicsViewModel(
    private val contentRepository: ContentRepository,
    initialPhonemeIndex: Int = 0,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PhonicsUiState())
    val uiState: StateFlow<PhonicsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val phonemes = contentRepository.getAllPhonemes()
            if (phonemes.isEmpty()) {
                _uiState.value = PhonicsUiState(isLoading = false)
                return@launch
            }
            val wordLookup = contentRepository.getAllEnglishWords().associateBy { it.word.lowercase() }
            val englishWordsMap = phonemes.associate { ph ->
                ph.symbol to ph.englishWordIds.mapNotNull { wordLookup[it.lowercase()] }
            }
            val index = initialPhonemeIndex.coerceIn(0, phonemes.lastIndex)
            _uiState.value = PhonicsUiState(
                phonemes = phonemes,
                currentIndex = index,
                englishWordsMap = englishWordsMap,
                isLoading = false,
            )
        }
    }

    fun selectPhoneme(index: Int) {
        val phonemes = _uiState.value.phonemes
        if (index < 0 || index >= phonemes.size) return
        _uiState.value = _uiState.value.copy(currentIndex = index)
    }
}
