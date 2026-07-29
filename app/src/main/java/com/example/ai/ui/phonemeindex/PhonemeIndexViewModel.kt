package com.example.ai.ui.phonemeindex

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.Phoneme
import com.example.ai.data.model.PhonemeCategory
import com.example.ai.data.repository.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PhonemeIndexUiState(
    val allPhonemes: List<Phoneme> = emptyList(),
    val phonemeIndexMap: Map<String, Int> = emptyMap(),
    val grouped: Map<PhonemeCategory, List<Phoneme>> = emptyMap(),
    val isLoading: Boolean = true,
)

class PhonemeIndexViewModel(
    private val contentRepository: ContentRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PhonemeIndexUiState())
    val uiState: StateFlow<PhonemeIndexUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val phonemes = contentRepository.getAllPhonemes()
            val grouped = phonemes.groupBy { it.category }
            val indexMap = phonemes.withIndex().associate { (i, ph) -> ph.symbol to i }
            _uiState.value = PhonemeIndexUiState(
                allPhonemes = phonemes,
                phonemeIndexMap = indexMap,
                grouped = grouped,
                isLoading = false,
            )
        }
    }
}
