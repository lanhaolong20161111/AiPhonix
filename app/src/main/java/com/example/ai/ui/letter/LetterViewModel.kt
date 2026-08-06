package com.example.ai.ui.letter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.EnglishWord
import com.example.ai.data.model.Letter
import com.example.ai.data.model.Word
import com.example.ai.data.repository.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LetterUiState(
    /** 26 个字母，顺序即字母表顺序 */
    val letters: List<Letter> = emptyList(),
    /** char（如 "e"）→ 练习单词列表，全量加载保证左右滑动跟手 */
    val wordsMap: Map<String, List<Word>> = emptyMap(),
    /** char → 三年级英语词列表 */
    val englishWordsMap: Map<String, List<EnglishWord>> = emptyMap(),
    /** 音素 symbol（如 "/e/"）→ 发音口诀 */
    val mnemonics: Map<String, String> = emptyMap(),
    val isLoading: Boolean = true,
)

class LetterViewModel(
    private val contentRepository: ContentRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LetterUiState())
    val uiState: StateFlow<LetterUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val letters = contentRepository.getAllLetters()
            val wordsMap = letters.associate { it.char to contentRepository.getWordsForLetter(it.char) }
            val englishWordsMap = letters.associate {
                it.char to contentRepository.getEnglishWordsForLetter(it.char)
            }
            val mnemonics = contentRepository.getAllPhonemes()
                .associate { it.symbol to it.mnemonic }
                .filterValues { it.isNotBlank() }
            _uiState.value = LetterUiState(
                letters = letters,
                wordsMap = wordsMap,
                englishWordsMap = englishWordsMap,
                mnemonics = mnemonics,
                isLoading = false,
            )
        }
    }
}
