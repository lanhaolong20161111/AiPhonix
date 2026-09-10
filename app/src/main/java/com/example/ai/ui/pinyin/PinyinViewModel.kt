package com.example.ai.ui.pinyin

import android.content.Context
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.audio.AudioRecorder
import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.data.aichinese.PinyinLevel
import com.example.ai.data.aichinese.PinyinWord
import com.example.ai.data.speech.ScoreClient
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.di.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class PinyinUiState(
    val level: PinyinLevel = PinyinLevel(),
    val loadingLevel: Boolean = false,
    val levelIndex: Int = 1,       // 当前第几关
    val recordingWord: String? = null, // 正在录音的拼音
    val evaluatingWord: String? = null, // 正在评测的拼音
    val scores: Map<String, Int> = emptyMap(), // 拼音 → 总分
    val totalScore: Int = 0,       // 本关总分（各词平均）
    val passed: Boolean = false,   // 本关是否通过（≥70）
    val isPlayingPart: Boolean = false, // 是否正在播放单个拼音部件
    val error: String = "",
)

class PinyinViewModel(
    private val repository: AiChineseRepository = AiChineseRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(PinyinUiState())
    val uiState: StateFlow<PinyinUiState> = _uiState.asStateFlow()

    private val audioRecorder = AudioRecorder()
    private val scoreClient = ScoreClient(NetworkModule.httpClient)
    private var ttsCache: BaiduTtsCache? = null
    private val MIN_AUDIO_BYTES = 12_800 // 0.4s @ 16kHz

    /** 初始化 TTS（Screen 进入时调用） */
    fun initTts(context: Context) {
        if (ttsCache == null) {
            ttsCache = BaiduTtsCache(context.applicationContext)
        }
    }

    /** 进入时加载第一关 */
    fun loadFirstLevel() {
        _uiState.value = _uiState.value.copy(levelIndex = 1, scores = emptyMap(), totalScore = 0, passed = false)
        loadLevel(1)
    }

    private fun loadLevel(index: Int) {
        if (_uiState.value.loadingLevel) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loadingLevel = true, error = "")
            val level = withContext(Dispatchers.IO) { repository.fetchPinyinLevel(count = 5) }
            _uiState.value = _uiState.value.copy(
                loadingLevel = false,
                level = level,
                levelIndex = index,
                scores = emptyMap(),
                totalScore = 0,
                passed = false,
                error = if (level.words.isEmpty()) "本关没有可练的词，请重试" else "",
            )
        }
    }

    /** 点击某词的评测按钮：开始录音（再次点击停止 → 评测） */
    fun toggleRecord(word: PinyinWord) {
        val st = _uiState.value
        if (st.recordingWord == word.pinyin) {
            audioRecorder.stop() // 停止 → record() 返回 PCM → 后续评测
            return
        }
        if (st.recordingWord != null || st.evaluatingWord != null) return
        audioRecorder.reset()
        _uiState.value = st.copy(recordingWord = word.pinyin, error = "")
        viewModelScope.launch {
            val pcm = try {
                withContext(Dispatchers.IO) { audioRecorder.record() }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(recordingWord = null, error = "录音失败：${e.message}")
                return@launch
            }
            if (pcm.size < MIN_AUDIO_BYTES) {
                _uiState.value = _uiState.value.copy(recordingWord = null, error = "录音太短，请再读一次")
                return@launch
            }
            _uiState.value = _uiState.value.copy(recordingWord = null, evaluatingWord = word.pinyin)
            val result = try {
                withContext(Dispatchers.IO) {
                    // 拼音评测：传中文词（SOE 中文词语模式 eval_mode=1 评测声调，避免 RefTextOOV）
                    scoreClient.evaluate(word.hanzi, Base64.encodeToString(pcm, Base64.NO_WRAP), evalMode = "1")
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(evaluatingWord = null, error = "评测失败：${e.message}")
                return@launch
            }
            val score = result.totalScore.coerceIn(0, 100)
            val newScores = st.scores + (word.pinyin to score)
            val total = if (newScores.isNotEmpty()) newScores.values.sum() / newScores.size else 0
            _uiState.value = _uiState.value.copy(
                evaluatingWord = null,
                scores = newScores,
                totalScore = total,
                passed = total >= 70 && newScores.size == st.level.words.size,
            )
        }
    }

    /** 通过后进入下一关 */
    fun nextLevel() {
        loadLevel(_uiState.value.levelIndex + 1)
    }

    /** 重测本关 */
    fun retryLevel() {
        loadLevel(_uiState.value.levelIndex)
    }

    /** 点击单个拼音部件（声母/韵母/整体认读音节）：播放音频库里的对应 mp3（非 TTS） */
    fun speakPart(audioPath: String) {
        if (audioPath.isBlank() || _uiState.value.isPlayingPart) return
        _uiState.value = _uiState.value.copy(isPlayingPart = true)
        viewModelScope.launch(Dispatchers.IO) {
            try {
                ttsCache?.playRemote(repository.pinyinAudioUrl(audioPath))
            } finally {
                _uiState.value = _uiState.value.copy(isPlayingPart = false)
            }
        }
    }

    override fun onCleared() {
        try {
            audioRecorder.stop()
        } catch (_: Exception) {
        }
        super.onCleared()
    }
}
