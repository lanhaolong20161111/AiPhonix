package com.example.ai.ui.phonics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.Phoneme
import com.example.ai.data.model.Word
import com.example.ai.data.repository.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PhonicsUiState(
    val phonemes: List<Phoneme> = emptyList(),
    val currentIndex: Int = 0,
    val words: List<Word> = emptyList(),
    val isLoading: Boolean = true,
)

class PhonicsViewModel(
    private val contentRepository: ContentRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PhonicsUiState())
    val uiState: StateFlow<PhonicsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val phonemes = contentRepository.getAllPhonemes()
            if (phonemes.isNotEmpty()) {
                val words = contentRepository.getWordsForPhoneme(phonemes[0].symbol.trim('/'))
                _uiState.value = PhonicsUiState(
                    phonemes = phonemes,
                    currentIndex = 0,
                    words = words,
                    isLoading = false,
                )
            } else {
                _uiState.value = PhonicsUiState(isLoading = false)
            }
        }
    }

    fun selectPhoneme(index: Int) {
        val phonemes = _uiState.value.phonemes
        if (index < 0 || index >= phonemes.size) return
        viewModelScope.launch {
            val words = contentRepository.getWordsForPhoneme(phonemes[index].symbol.trim('/'))
            _uiState.value = _uiState.value.copy(
                currentIndex = index,
                words = words,
            )
        }
    }

    fun nextPhoneme() = selectPhoneme(_uiState.value.currentIndex + 1)
    fun previousPhoneme() = selectPhoneme(_uiState.value.currentIndex - 1)
}
