package com.example.ai.ui.aienglish

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aichat.AiChatRepository
import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.data.aichinese.TextBlock
import com.example.ai.data.aihistory.AiHistoryItem
import com.example.ai.data.aihistory.AiHistoryStore
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.data.tts.TtsEngine
import com.example.ai.data.wordbook.WordbookAutoCollector
import com.example.ai.data.wordbook.WordbookRepository
import com.example.ai.data.wordbook.WordbookSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 一条对话气泡 */
data class AiEnglishTurn(
    val role: String,            // user / assistant
    val content: String,
    val speakText: String = "",  // assistant：建议朗读文本
    val wordInfo: String = "",   // assistant：查词结果
    val correction: String = "", // user：AI 改错后的句子
)

data class AiEnglishUiState(
    val inputText: String = "",
    val imageBytes: ByteArray? = null,   // 原图字节（缩略图/重识别用）
    val blocks: List<TextBlock> = emptyList(), // 识别排版块
    val parsedText: String = "",          // 识别全文
    val parsingImage: Boolean = false,
    val hasCachedImage: Boolean = false,
    val chatInput: String = "",
    val turns: List<AiEnglishTurn> = emptyList(),
    val asking: Boolean = false,
    val sessionId: String = "",           // 服务端会话 id（断点续聊）
    val isSpeaking: Boolean = false,
    val speakingText: String? = null,     // 正在朗读的词/句
    val error: String = "",
)

/**
 * AI 英语（对齐 web AiEnglishPage）：
 * 拍照/相册 → /ai-chinese/parse-image?mode=english 识别（英语专用提示词，不删字母）；
 * 文本框提问 → /ai-chat/ask module=english 多轮会话（老师人设 + 断点续聊）。
 * 历史自动存入本地 AiHistoryStore（english 桶）。
 */
class AiEnglishViewModel(
    private val parseRepository: AiChineseRepository = AiChineseRepository(),
    private val chatRepository: AiChatRepository = AiChatRepository(),
    private val historyStore: AiHistoryStore? = null, // Navigation 注入（可空便于预览）
    private val ttsEngine: TtsEngine? = null,
    private val wordbookRepository: WordbookRepository = WordbookRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiEnglishUiState())
    val uiState: StateFlow<AiEnglishUiState> = _uiState.asStateFlow()

    /** 点读自动收录（对齐 web：点整词即加入生词本，本页会话内去重）。 */
    private val wordbookCollector: WordbookAutoCollector by lazy {
        WordbookAutoCollector(wordbookRepository) { block -> viewModelScope.launch { block() } }
    }

    private var ttsCache: BaiduTtsCache? = null
    private var lastImageBytes: ByteArray? = null
    private var historyItemId: String = "" // 当前会话对应的历史条目 id

    /** 由 Screen 注入中文 TTS（含中文内容的块点读用） */
    fun initTts(context: Context) {
        if (ttsCache == null) {
            ttsCache = BaiduTtsCache(context.applicationContext)
        }
    }

    // ── 识图（mode=english） ──

    fun parseImage(bytes: ByteArray) {
        lastImageBytes = bytes
        _uiState.value = _uiState.value.copy(hasCachedImage = true)
        doParse(bytes, forceRefresh = false)
    }

    fun reparseImage() {
        val bytes = lastImageBytes ?: run {
            _uiState.value = _uiState.value.copy(error = "没有可重新识别的图片，请先拍照")
            return
        }
        doParse(bytes, forceRefresh = true)
    }

    private fun doParse(bytes: ByteArray, forceRefresh: Boolean) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(parsingImage = true, error = "")
            val result = try {
                withContext(Dispatchers.IO) {
                    parseRepository.parseImage(bytes, forceRefresh = forceRefresh, mode = "english")
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    parsingImage = false,
                    error = "识别失败：${e.message ?: "网络异常，请检查网络后重试"}",
                )
                return@launch
            }
            val text = result.text.trim()
            if (text.isEmpty() && result.blocks.isEmpty()) {
                _uiState.value = _uiState.value.copy(parsingImage = false, error = "未能识别出内容，请换一张更清晰的图片")
                return@launch
            }
            _uiState.value = _uiState.value.copy(
                parsingImage = false,
                parsedText = text,
                blocks = result.blocks,
                imageBytes = bytes,
                inputText = text,
            )
            // 自动存历史（识别快照）
            historyStore?.let { store ->
                viewModelScope.launch(Dispatchers.IO) {
                    try {
                        store.add(
                            AiHistoryItem(
                                module = "english",
                                text = text,
                                questions = result.questions,
                                blocks = result.blocks,
                                thumb = store.makeThumb(bytes),
                            )
                        )
                    } catch (_: Exception) { }
                }
            }
        }
    }

    // ── 文本对话（module=english） ──

    fun updateChatInput(text: String) {
        _uiState.value = _uiState.value.copy(chatInput = text)
    }

    fun updateInputText(text: String) {
        _uiState.value = _uiState.value.copy(inputText = text)
    }

    /** 提交提问：优先用输入框文本（识别结果作为上下文一并发送） */
    fun ask() {
        val st = _uiState.value
        val q = st.chatInput.trim().ifBlank { st.inputText.trim() }
        if (q.isEmpty() || st.asking) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(asking = true, error = "")
            val userTurn = AiEnglishTurn(role = "user", content = q)
            val base = _uiState.value
            _uiState.value = base.copy(
                turns = base.turns + userTurn,
                chatInput = "",
            )
            val result = try {
                withContext(Dispatchers.IO) { chatRepository.ask(module = "english", message = q, sessionId = _uiState.value.sessionId) }
            } catch (e: Exception) {
                // 回滚 user 气泡并报错
                _uiState.value = _uiState.value.copy(
                    asking = false,
                    turns = _uiState.value.turns - userTurn,
                    error = "提问失败：${e.message ?: "网络异常"}",
                )
                return@launch
            }
            val assistantTurn = AiEnglishTurn(
                role = "assistant",
                content = result.reply,
                speakText = result.speakText,
                wordInfo = result.wordInfo,
            )
            val cur = _uiState.value
            _uiState.value = cur.copy(
                asking = false,
                sessionId = result.sessionId.ifBlank { cur.sessionId },
                turns = cur.turns + assistantTurn,
            )
            saveChatHistory(userTurn, assistantTurn, result.sessionId)
        }
    }

    /** 会话历史持久化：首条 → 新增历史条目；后续 → 追加到同一条 */
    private fun saveChatHistory(userTurn: AiEnglishTurn, assistantTurn: AiEnglishTurn, sessionId: String) {
        val store = historyStore ?: return
        val userH = com.example.ai.data.aihistory.AiHistoryTurn(role = userTurn.role, content = userTurn.content)
        val assistantH = com.example.ai.data.aihistory.AiHistoryTurn(role = assistantTurn.role, content = assistantTurn.content)
        viewModelScope.launch(Dispatchers.IO) {
            try {
                if (historyItemId.isBlank()) {
                    // 复用已有同会话的历史条目（断点续聊场景）
                    val existing = store.list("english").firstOrNull { it.sessionId == sessionId && sessionId.isNotBlank() }
                    if (existing != null) {
                        historyItemId = existing.id
                        store.update("english", existing.id) { it.copy(turns = it.turns + userH + assistantH) }
                        return@launch
                    }
                    historyItemId = store.add(
                        AiHistoryItem(
                            module = "english",
                            text = userTurn.content.take(60),
                            turns = listOf(userH, assistantH),
                            sessionId = sessionId,
                        )
                    )
                } else {
                    store.update("english", historyItemId) { it.copy(turns = it.turns + userH + assistantH) }
                }
            } catch (_: Exception) { }
        }
    }

    /** 恢复历史会话（历史页回看入口） */
    fun resumeSession(sessionId: String) {
        if (sessionId.isBlank() || _uiState.value.asking) return
        viewModelScope.launch {
            val session = try {
                withContext(Dispatchers.IO) { chatRepository.fetchSession(sessionId) }
            } catch (_: Exception) { null }
            if (session == null || session.messages.isEmpty()) {
                _uiState.value = _uiState.value.copy(error = "会话已过期，开个新对话吧")
                return@launch
            }
            historyItemId = ""
            _uiState.value = _uiState.value.copy(
                sessionId = session.sessionId,
                turns = session.messages.map { AiEnglishTurn(role = it.role, content = it.content) },
                error = "",
            )
        }
    }

    /** 开新对话：清空会话（历史保留） */
    fun newChat() {
        historyItemId = ""
        _uiState.value = _uiState.value.copy(turns = emptyList(), sessionId = "", chatInput = "", error = "")
    }

    fun clearError() {
        if (_uiState.value.error.isNotEmpty()) _uiState.value = _uiState.value.copy(error = "")
    }

    // ── 朗读：英文走 TtsEngine（英/美风格），含汉字走服务端百度中文 TTS ──

    fun speak(text: String) {
        if (text.isBlank()) return
        val hasChinese = text.any { it.code in 0x4E00..0x9FFF }
        if (hasChinese) {
            val cache = ttsCache ?: return
            viewModelScope.launch {
                _uiState.value = _uiState.value.copy(isSpeaking = true, speakingText = text)
                try {
                    cache.play(text, "0")
                } finally {
                    _uiState.value = _uiState.value.copy(isSpeaking = false, speakingText = null)
                }
            }
        } else {
            val engine = ttsEngine ?: return
            viewModelScope.launch {
                _uiState.value = _uiState.value.copy(isSpeaking = true, speakingText = text)
                try {
                    engine.speak(text)
                } finally {
                    _uiState.value = _uiState.value.copy(isSpeaking = false, speakingText = null)
                }
            }
        }
    }

    /** 朗读 AI 建议的朗读文本（speak 字段） */
    /** 逐词点读（`EnglishBlockCard` 点击单词）：自动加入生词本 + 朗读。
     *  与 [speak] 分开是必要的——[speakTurn] 会复用 [speak]，若把收录塞进 [speak] 会把整段气泡也收进去。 */
    fun speakTappedWord(word: String) {
        val w = word.trim()
        if (w.isEmpty()) return
        wordbookCollector.collect(w, WordbookSource.RECOG_ENGLISH)
        speak(w)
    }

    fun speakTurn(turn: AiEnglishTurn) {
        val target = turn.speakText.ifBlank { turn.content }
        speak(target)
    }

    override fun onCleared() {
        BaiduTtsCache.stopAll()
        super.onCleared()
    }
}
