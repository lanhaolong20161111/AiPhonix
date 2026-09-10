package com.example.ai.ui.aipractice

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aipractice.AiPracticeRepository
import com.example.ai.data.aipractice.AiPracticeTurn
import com.example.ai.data.tts.TtsEngine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

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
    val answerDraft: String = "",       // 文本输入草稿
    val done: Boolean = false,
    val loading: Boolean = true,
)

/**
 * ai陪我练 会话页 ViewModel：
 * - 多轮对话（文本回答）
 * - TTS：AI 回答分段朗读
 */
class AiPracticeChatViewModel(
    private val repository: AiPracticeRepository,
    private val ttsEngine: TtsEngine,
) : ViewModel() {

    companion object {
        private const val TAG = "AiPracticeChatVM"
    }

    private val _uiState = MutableStateFlow(AiPracticeChatState())
    val uiState: StateFlow<AiPracticeChatState> = _uiState.asStateFlow()

    /** 初始化会话（历史点入：active 续聊 / done 只读；新建：加载已保存的首问） */
    fun initSession(sessionId: Int, content: String) {
        _uiState.update { it.copy(sessionId = sessionId, content = content) }
        viewModelScope.launch {
            try {
                val d = repository.getSessionDetail(sessionId)
                _uiState.update {
                    it.copy(
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
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        loading = false,
                        error = "会话加载失败：${e.message}",
                    )
                }
            }
        }
    }

    fun updateDraft(v: String) {
        _uiState.update { it.copy(answerDraft = v) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = "") }
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
                _uiState.update {
                    it.copy(
                        turns = withFeedback,
                        sending = false,
                        done = r.done,
                        status = if (r.done) "done" else "active",
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        sending = false,
                        error = "发送失败：${e.message}",
                    )
                }
            }
        }
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
}
