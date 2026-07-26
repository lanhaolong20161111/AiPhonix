package com.example.ai.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.Letter
import com.example.ai.data.repository.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeUiState(
    val streakDays: Int = 0,
    val todayProgress: Float = 0f,
    val letters: List<Letter> = emptyList(),
    val isLoading: Boolean = true,
)

class HomeViewModel(
    private val contentRepository: ContentRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val letters = contentRepository.getAllLetters()
            _uiState.value = HomeUiState(streakDays = 3, todayProgress = 0.33f, letters = letters, isLoading = false)
        }
    }
}
