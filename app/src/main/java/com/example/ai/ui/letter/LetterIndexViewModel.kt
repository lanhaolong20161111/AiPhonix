package com.example.ai.ui.letter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.Letter
import com.example.ai.data.repository.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LetterIndexUiState(
    val letters: List<Letter> = emptyList(),
    val isLoading: Boolean = true,
)

class LetterIndexViewModel(
    private val contentRepository: ContentRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LetterIndexUiState())
    val uiState: StateFlow<LetterIndexUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val letters = contentRepository.getAllLetters()
            _uiState.value = LetterIndexUiState(letters = letters, isLoading = false)
        }
    }
}
