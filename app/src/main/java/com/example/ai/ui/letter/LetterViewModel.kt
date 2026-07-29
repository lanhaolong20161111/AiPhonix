package com.example.ai.ui.letter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.EnglishWord
import com.example.ai.data.model.Word
import com.example.ai.data.repository.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LetterUiState(
    val letter: com.example.ai.data.model.Letter? = null,
    val words: List<Word> = emptyList(),
    val englishWords: List<EnglishWord> = emptyList(),
    val isLoading: Boolean = true,
)

class LetterViewModel(
    private val contentRepository: ContentRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LetterUiState())
    val uiState: StateFlow<LetterUiState> = _uiState.asStateFlow()

    fun loadLetter(char: String) {
        viewModelScope.launch {
            val letter = contentRepository.getLetter(char)
            val words = contentRepository.getWordsForLetter(char)
            val englishWords = contentRepository.getEnglishWordsForLetter(char)
            _uiState.value = LetterUiState(letter = letter, words = words, englishWords = englishWords, isLoading = false)
        }
    }
}
