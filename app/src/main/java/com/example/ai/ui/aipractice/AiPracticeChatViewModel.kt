package com.example.ai.ui.aipractice

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aipractice.AiPracticeRepository
import com.example.ai.data.aipractice.AiPracticeTurn
import com.example.ai.data.tts.TtsEngine
import com.k2fsa.sherpa.onnx.OralAsrEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 单条展示用对话项 */
data class AiPracticeChatItem(
    val role: String,            // "ai" | "user"
    val text: String,
    val correction: String = "",
    val praise: String = "",
)

/** 会话页状态 */
data class AiPracticeChatState(
    val sessionId: Int = 0,
    val content: String = "",
    val contentType: String = "sentence",
    val status: String = "active",      // active | done
    val turns: List<AiPracticeChatItem> = emptyList(),
    val sending: Boolean = false,
    val error: String = "",
    val answerDraft: String = "",       // 文本输入 + ASR 追加的草稿（追加不清空）
    val partialText: String = "",       // ASR 实时中间结果（灰色尾部）
    val recording: Boolean = false,     // 语音识别中
    val done: Boolean = false,
    val loading: Boolean = true,
)

/**
 * ai陪我练 会话页 ViewModel：
 * - 多轮对话（文本/语音回答）
 * - ASR：暂停后继续识别 → 文字追加到 answerDraft（不清空），并保存录音 wav
 * - TTS：AI 回答分段朗读
 */
class AiPracticeChatViewModel(
    private val repository: AiPracticeRepository,
    private val ttsEngine: TtsEngine,
    appContext: Context,
) : ViewModel() {

    companion object {
        private const val TAG = "AiPracticeChatVM"
    }

    private val asrEngine = OralAsrEngine(appContext.assets)
    private var asrInitialized = false
    private var wavSaveDir: File = File(appContext.filesDir, "aipractice_audio")

    private val _uiState = MutableStateFlow(AiPracticeChatState())
    val uiState: StateFlow<AiPracticeChatState> = _uiState.asStateFlow()

    /** 初始化会话（历史点入：active 续聊 / done 只读；新建：加载已保存的首问） */
    fun initSession(sessionId: Int, content: String) {
        _uiState.value = _uiState.value.copy(sessionId = sessionId, content = content)
        viewModelScope.launch {
            try {
                val d = repository.getSessionDetail(sessionId)
                _uiState.value = _uiState.value.copy(
                    sessionId = d.sessionId,
                    content = d.content,
                    contentType = d.contentType,
                    status = d.status,
                    turns = d.turns.map {
                        AiPracticeChatItem(it.role, it.text, it.correction, it.praise)
                    },
                    done = d.status == "done",
                    loading = false,
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    error = "会话加载失败：${e.message}",
                )
            }
        }
    }

    fun updateDraft(v: String) {
        _uiState.value = _uiState.value.copy(answerDraft = v)
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = "")
    }

    // ── 发送 ──

    fun sendCurrent() {
        val s = _uiState.value
        val text = s.answerDraft.trim()
        if (text.isEmpty() || s.sending || s.done) return
        sendText(text)
    }

    fun sendText(text: String) {
        val s = _uiState.value
        if (s.sending || s.done) return
        viewModelScope.launch {
            val optimistic = s.copy(
                turns = s.turns + AiPracticeChatItem("user", text),
                answerDraft = "",
                partialText = "",
                sending = true,
                error = "",
            )
            _uiState.value = optimistic
            try {
                val r = repository.chat(s.sessionId, text)
                val newTurns = _uiState.value.turns + AiPracticeChatItem(
                    role = "ai",
                    text = r.question,
                    correction = r.correction,
                    praise = r.praise,
                )
                // 学生回答的纠正/表扬挂在 user 气泡上（结果页对比展示）
                val userIdx = newTurns.size - 2
                val withFeedback = newTurns.toMutableList()
                withFeedback[userIdx] = withFeedback[userIdx].copy(
                    correction = r.correction,
                    praise = r.praise,
                )
                _uiState.value = _uiState.value.copy(
                    turns = withFeedback,
                    sending = false,
                    done = r.done,
                    status = if (r.done) "done" else "active",
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    sending = false,
                    error = "发送失败：${e.message}",
                )
            }
        }
    }

    // ── ASR 语音回答（追加不清空）──

    fun startVoice() {
        val s = _uiState.value
        if (s.recording || s.done) return
        viewModelScope.launch {
            if (!asrInitialized) {
                asrInitialized = withContext(Dispatchers.IO) { asrEngine.init() }
                if (!asrInitialized) {
                    _uiState.value = _uiState.value.copy(error = "语音识别初始化失败")
                    return@launch
                }
            }
            _uiState.value = _uiState.value.copy(recording = true, partialText = "", error = "")
            val wavPath = File(wavSaveDir, "s${s.sessionId}_${System.currentTimeMillis()}.wav").absolutePath
            val result = withContext(Dispatchers.IO) {
                asrEngine.startRecording(
                    onPartial = { partial ->
                        _uiState.value = _uiState.value.copy(partialText = partial)
                    },
                    wavPath = wavPath,
                )
            }
            _uiState.value = _uiState.value.copy(recording = false, partialText = "")
            result.onSuccess { text ->
                // 追加到草稿，不清空已有内容
                val draft = _uiState.value.answerDraft
                val sep = if (draft.isBlank()) "" else " "
                _uiState.value = _uiState.value.copy(answerDraft = draft + sep + text)
                Log.i(TAG, "ASR append: '$text' (draft=${_uiState.value.answerDraft})")
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message ?: "识别失败")
            }
        }
    }

    fun stopVoice() {
        asrEngine.stopRecording()
    }

    // ── TTS 分段朗读（AI 回答：段落/句子喇叭共用此入口）──

    fun speak(text: String) {
        viewModelScope.launch {
            try {
                ttsEngine.speak(text)
            } catch (e: Exception) {
                Log.w(TAG, "TTS 失败: ${e.message}")
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        try {
            asrEngine.release()
        } catch (_: Exception) {}
    }
}
