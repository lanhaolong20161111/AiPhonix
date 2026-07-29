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
    val exampleWords: List<String> = emptyList(),
    val englishWords: List<EnglishWord> = emptyList(),
    val isLoading: Boolean = true,
)

class PhonicsViewModel(
    private val contentRepository: ContentRepository,
    initialPhonemeIndex: Int = 0,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PhonicsUiState())
    val uiState: StateFlow<PhonicsUiState> = _uiState.asStateFlow()

    private suspend fun loadWordsForPhoneme(phoneme: Phoneme) {
        val exampleWords = phoneme.exampleWords
        val allEnglishWords = contentRepository.getAllEnglishWords()
        val wordLookup = allEnglishWords.associateBy { it.word.lowercase() }
        val englishWords = phoneme.englishWordIds
            .mapNotNull { wordLookup[it.lowercase()] }
        _uiState.value = _uiState.value.copy(exampleWords = exampleWords, englishWords = englishWords)
    }

    init {
        viewModelScope.launch {
            val phonemes = contentRepository.getAllPhonemes()
            if (phonemes.isNotEmpty()) {
                val index = initialPhonemeIndex.coerceIn(0, phonemes.lastIndex)
                _uiState.value = PhonicsUiState(phonemes = phonemes, currentIndex = index, isLoading = false)
                loadWordsForPhoneme(phonemes[index])
            } else {
                _uiState.value = PhonicsUiState(isLoading = false)
            }
        }
    }

    fun selectPhoneme(index: Int) {
        val phonemes = _uiState.value.phonemes
        if (index < 0 || index >= phonemes.size) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(currentIndex = index)
            loadWordsForPhoneme(phonemes[index])
        }
    }

    fun nextPhoneme() = selectPhoneme(_uiState.value.currentIndex + 1)
    fun previousPhoneme() = selectPhoneme(_uiState.value.currentIndex - 1)
}
