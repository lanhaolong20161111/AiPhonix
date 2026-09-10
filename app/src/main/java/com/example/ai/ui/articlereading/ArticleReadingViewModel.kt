package com.example.ai.ui.articlereading

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.articlereading.ArticleContentParser
import com.example.ai.data.articlereading.ArticleReadingStore
import com.example.ai.data.articlereading.ArticleSession
import com.example.ai.data.articlereading.ParagraphSummary
import com.example.ai.data.tts.TtsEngine
import com.example.ai.data.userimport.UserImportStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 文章阅读页状态 */
data class ArticleReadingUiState(
    val articleKey: String = "",
    val title: String = "",
    val paragraphs: List<String> = emptyList(),
    val summaries: List<ParagraphSummary> = emptyList(),
    val ttsSpeaking: Boolean = false,
    val error: String = "",
    val finishedAt: Long = 0L,
)

class ArticleReadingViewModel(
    private val store: UserImportStore,
    private val readingStore: ArticleReadingStore,
    private val ttsEngine: TtsEngine,
) : ViewModel() {

    companion object {
        private const val TAG = "ArticleReadingViewModel"
    }

    private val _uiState = MutableStateFlow(ArticleReadingUiState())
    val uiState: StateFlow<ArticleReadingUiState> = _uiState

    fun initArticle(articleKey: String, title: String) {
        if (_uiState.value.articleKey == articleKey && _uiState.value.paragraphs.isNotEmpty()) return
        val item = store.load().firstOrNull { it.id == articleKey && it.kind == "article" }
            ?: run { _uiState.value = _uiState.value.copy(error = "文章不存在或已删除"); return }
        val content = ArticleContentParser.parse(item)
        val session = readingStore.load(articleKey)
        _uiState.value = _uiState.value.copy(
            articleKey = articleKey,
            title = if (title.isNotBlank()) title else content.title,
            paragraphs = content.paragraphs,
            summaries = session?.summaries ?: emptyList(),
            error = "",
        )
    }

    /** 播放整篇文章（TTS） */
    fun playFull() {
        val s = _uiState.value
        if (s.paragraphs.isEmpty()) return
        val text = s.paragraphs.joinToString("\n")
        playTts(text)
    }

    /** 播放某一段落（TTS） */
    fun playParagraph(index: Int) {
        _uiState.value.paragraphs.getOrNull(index)?.let { playTts(it) }
    }

    private fun playTts(text: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(ttsSpeaking = true)
            try {
                val ok = ttsEngine.speak(text)
                if (!ok) {
                    _uiState.value = _uiState.value.copy(error = "朗读失败，请检查网络")
                }
            } catch (e: Exception) {
                Log.e(TAG, "TTS 失败", e)
                _uiState.value = _uiState.value.copy(error = "朗读失败，请检查网络")
            } finally {
                _uiState.value = _uiState.value.copy(ttsSpeaking = false)
            }
        }
    }

    /** 保存某段的口述概括（文本框输入/输入法语音输入） */
    fun setSummaryText(index: Int, text: String) {
        val s = _uiState.value
        val summaries = s.summaries.toMutableList()
        val existing = summaries.indexOfFirst { it.index == index }
        val newSummary = ParagraphSummary(
            index = index,
            text = text,
            audioPath = "",
            updatedAt = System.currentTimeMillis(),
        )
        if (existing >= 0) summaries[existing] = newSummary else summaries.add(newSummary)
        val sorted = summaries.sortedBy { it.index }
        _uiState.value = s.copy(summaries = sorted)
        saveSession(s.copy(summaries = sorted))
    }

    /** 完成阅读 → 标记 finishedAt → 保存 → 通知跳转问答 */
    fun finishReading(onFinished: () -> Unit) {
        val s = _uiState.value
        _uiState.value = s.copy(finishedAt = System.currentTimeMillis())
        saveSession(_uiState.value)
        onFinished()
    }

    private fun saveSession(s: ArticleReadingUiState) {
        if (s.articleKey.isBlank()) return
        readingStore.save(
            ArticleSession(
                articleKey = s.articleKey,
                title = s.title,
                summaries = s.summaries,
                finishedAt = s.finishedAt,
            )
        )
    }
}
