package com.example.ai.ui.sentencepractice

import android.util.Base64
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.audio.AudioRecorder
import com.example.ai.data.speech.ScoreClient
import com.example.ai.data.userimport.UserImportStore
import com.example.ai.di.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * 句子跟读练习：用户导入的 kind=sentence（英文句子/句型）与 kind=pinyin（中文句子拼音）
 * 合并成卡片流 → 逐句录音 → SOE 评测评分 → 达标（>=80）记为正确 → 提交成绩。
 * 复用现有 AudioRecorder + ScoreClient 链路，零新增 LLM 调用。
 */
class SentenceReadingViewModel(
    private val store: UserImportStore,
    private val audioRecorder: AudioRecorder = AudioRecorder(),
) : ViewModel() {

    private val scoreClient = ScoreClient(NetworkModule.httpClient)

    private val _uiState = MutableStateFlow(SentencePracticeUiState())
    val uiState: StateFlow<SentencePracticeUiState> = _uiState.asStateFlow()

    private var evalJob: Job? = null

    init {
        loadItems()
    }

    private fun loadItems() {
        val items = store.load().filter { it.kind == "sentence" || it.kind == "pinyin" }
        val sentences = items.map {
            SentenceItem(
                id = it.id,
                text = it.text.trim(),
                pinyin = it.pinyin,
                translation = it.meaning,
                kind = it.kind,
            )
        }.filter { it.text.isNotEmpty() }
        _uiState.value = SentencePracticeUiState(
            loading = false,
            empty = sentences.isEmpty(),
            items = sentences,
        )
        Log.d(TAG, "句子跟读: ${items.size} 条, ${sentences.size} 条有效")
    }

    private fun current(): SentenceItem? =
        _uiState.value.items.getOrNull(_uiState.value.currentIndex)

    /** 开始录音（挂起到 [stopRecording]） */
    fun startRecording() {
        val s = _uiState.value
        if (s.recording || s.evaluating || s.finished) return
        _uiState.value = s.copy(recording = true, error = null, score = null, feedback = null)
        evalJob?.cancel()
        evalJob = viewModelScope.launch {
            try {
                audioRecorder.reset()
                val pcm = audioRecorder.record()
                if (pcm.size < MIN_AUDIO_BYTES) throw RuntimeException("录音太短，请至少读一秒")
                _uiState.value = _uiState.value.copy(recording = false, evaluating = true)
                val result = withContext(Dispatchers.IO) {
                    val b64 = Base64.encodeToString(pcm, Base64.NO_WRAP)
                    scoreClient.evaluate(current()?.text.orEmpty(), b64)
                }
                _uiState.value = _uiState.value.copy(
                    evaluating = false,
                    score = result.totalScore,
                    feedback = result.feedback,
                    passed = result.totalScore >= PASS_SCORE,
                    scores = _uiState.value.scores + (_uiState.value.currentIndex to result.totalScore),
                )
            } catch (e: Exception) {
                Log.w(TAG, "评测失败: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    recording = false,
                    evaluating = false,
                    error = e.message ?: "评测失败",
                )
            }
        }
    }

    /** 停止录音（触发评测） */
    fun stopRecording() {
        if (_uiState.value.recording) {
            audioRecorder.stop()
        }
    }

    /** 下一句或完成 */
    fun next() {
        val s = _uiState.value
        if (s.score == null) return
        if (s.currentIndex + 1 >= s.items.size) {
            _uiState.value = s.copy(finished = true)
        } else {
            _uiState.value = s.copy(
                currentIndex = s.currentIndex + 1,
                score = null,
                feedback = null,
                error = null,
                passed = false,
            )
        }
    }

    /** 跳过当前句（不评分） */
    fun skip() {
        val s = _uiState.value
        if (s.recording || s.evaluating) return
        if (s.currentIndex + 1 >= s.items.size) {
            _uiState.value = s.copy(finished = true)
        } else {
            _uiState.value = s.copy(
                currentIndex = s.currentIndex + 1,
                score = null,
                feedback = null,
                error = null,
                passed = false,
            )
        }
    }

    /** 提交成绩到 /api/v1/practice/submit（module=sentence） */
    fun submit() {
        val s = _uiState.value
        if (!s.finished || s.submitted || s.submitting) return
        viewModelScope.launch {
            _uiState.value = s.copy(submitting = true, message = "提交记录...")
            val records = JSONArray()
            for ((index, item) in s.items.withIndex()) {
                val score = s.scores[index] ?: 0
                val passed = score >= PASS_SCORE
                records.put(JSONObject().apply {
                    put("char", item.text)
                    put("module", "sentence")
                    put("attempt_count", 1)
                    put("first_try_correct", passed)
                    put("hint_used", false)
                    put("correct", passed)
                    put("score", score)
                    put("timestamp", java.time.Instant.now().toString())
                    put("date", java.time.LocalDate.now().toString())
                })
            }
            val body = JSONObject().apply {
                put("module", "sentence")
                put("records", records)
                put("total_score", s.scores.values.count { it >= PASS_SCORE })
                put("max_score", s.items.size)
            }
            val ok = withContext(Dispatchers.IO) {
                try {
                    val req = Request.Builder()
                        .url("${ScoreClient.serverBase()}/api/v1/practice/submit")
                        .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                        .build()
                    NetworkModule.httpClient.newCall(req).execute().isSuccessful
                } catch (e: Exception) {
                    Log.w(TAG, "提交失败: ${e.message}")
                    false
                }
            }
            _uiState.value = _uiState.value.copy(
                submitting = false,
                submitted = ok,
                message = if (ok) "记录已保存" else "提交失败",
            )
        }
    }

    companion object {
        private const val TAG = "SentenceReadingViewModel"
        /** 最短有效录音（约 0.4 秒 PCM 16kHz 16bit） */
        private const val MIN_AUDIO_BYTES = 6400
        /** SOE 达标分数线 */
        private const val PASS_SCORE = 80
    }
}

data class SentenceItem(
    val id: String,
    val text: String,
    val pinyin: String,
    val translation: String,
    val kind: String,
)

data class SentencePracticeUiState(
    val loading: Boolean = true,
    val empty: Boolean = false,
    val items: List<SentenceItem> = emptyList(),
    val currentIndex: Int = 0,
    val recording: Boolean = false,
    val evaluating: Boolean = false,
    val score: Int? = null,
    val feedback: String? = null,
    val passed: Boolean = false,
    val error: String? = null,
    val scores: Map<Int, Int> = emptyMap(),
    val finished: Boolean = false,
    val submitting: Boolean = false,
    val submitted: Boolean = false,
    val message: String = "",
)
