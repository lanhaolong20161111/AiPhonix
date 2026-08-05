package com.example.ai.ui.articlereading

import android.content.res.AssetManager
import android.media.MediaPlayer
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.articlereading.ArticleContentParser
import com.example.ai.data.articlereading.ArticleReadingStore
import com.example.ai.data.articlereading.ArticleSession
import com.example.ai.data.articlereading.ParagraphSummary
import com.example.ai.data.tts.TtsEngine
import com.example.ai.data.userimport.UserImportStore
import com.k2fsa.sherpa.onnx.OralAsrEngine
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
    val recordingIndex: Int = -1,        // -1=未录音；否则为正在录音的段落下标
    val partialText: String = "",
    val ttsSpeaking: Boolean = false,
    val playingAudio: Boolean = false,
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

    private var asrEngine: OralAsrEngine? = null
    private var mediaPlayer: MediaPlayer? = null

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

    fun initAsrEngine(assetManager: AssetManager) {
        if (asrEngine == null) {
            asrEngine = OralAsrEngine(assetManager)
            viewModelScope.launch(Dispatchers.IO) {
                val ok = asrEngine?.init() ?: false
                if (!ok) _uiState.value = _uiState.value.copy(error = "语音模型加载失败")
            }
        }
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

    /** 播放某段口述总结的录音（wav） */
    fun playSummaryAudio(index: Int) {
        val summary = _uiState.value.summaries.getOrNull(index) ?: return
        if (summary.audioPath.isBlank()) return
        val file = readingStore.resolveAudio(summary.audioPath)
        if (!file.exists()) return
        try {
            stopAudio()
            val mp = MediaPlayer()
            mp.setDataSource(file.absolutePath)
            mp.setOnCompletionListener { stopAudio() }
            mp.prepare()
            mp.start()
            mediaPlayer = mp
            _uiState.value = _uiState.value.copy(playingAudio = true)
        } catch (e: Exception) {
            Log.e(TAG, "播放失败", e)
            _uiState.value = _uiState.value.copy(error = "录音播放失败")
        }
    }

    fun stopAudio() {
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null
        _uiState.value = _uiState.value.copy(playingAudio = false)
    }

    /** 开始/停止某段的口述概括录音（ASR + 存 wav） */
    fun toggleRecord(index: Int) {
        val s = _uiState.value
        if (s.recordingIndex >= 0) {
            asrEngine?.stopRecording() // 让 startRecording 循环退出
            return
        }
        val engine = asrEngine ?: run { _uiState.value = _uiState.value.copy(error = "语音引擎未就绪"); return }
        val relPath = readingStore.paragraphAudioPath(s.articleKey, index)
        // 引擎写文件用绝对路径（OralAsrEngine 内部 File(wavPath) 不解析相对路径），存储用相对路径
        val wavPath = readingStore.resolveAudio(relPath).absolutePath
        _uiState.value = _uiState.value.copy(recordingIndex = index, partialText = "")
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                engine.startRecording(
                    onPartial = { partial ->
                        _uiState.value = _uiState.value.copy(partialText = partial)
                    },
                    wavPath = wavPath,
                )
            }
            val finalText = result.getOrNull() ?: ""
            _uiState.value = _uiState.value.copy(recordingIndex = -1, partialText = "")
            if (finalText.isNotBlank()) {
                updateSummary(index, finalText, relPath)
            } else {
                result.onFailure { e ->
                    Log.w(TAG, "未识别到内容", e)
                    _uiState.value = _uiState.value.copy(error = "没有识别到语音，请靠近麦克风再试")
                }
            }
        }
    }

    private fun updateSummary(index: Int, text: String, wavPath: String) {
        val s = _uiState.value
        val summaries = s.summaries.toMutableList()
        val existing = summaries.indexOfFirst { it.index == index }
        val newSummary = ParagraphSummary(
            index = index,
            text = text,
            audioPath = wavPath,
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

    override fun onCleared() {
        super.onCleared()
        stopAudio()
        asrEngine?.release()
        asrEngine = null
    }
}
