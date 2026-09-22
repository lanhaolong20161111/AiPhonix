package com.example.ai.ui.sentencecompose

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aichat.AiChatRepository
import com.example.ai.data.dailyzh.DailyTextSplit
import com.example.ai.data.dailyzh.DailyZhSync
import com.example.ai.data.wordbook.WordbookRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** AI 判卷结果（对齐 web `SentencePracticePage` 的 result 结构） */
data class SentenceComposeResult(
    val reply: String = "",
    val corrected: String = "",
    val wrongs: List<String> = emptyList(),
)

data class SentenceComposeUiState(
    /** 今日句型（家长在「每日语文」设置，只读展示） */
    val todaySentences: List<String> = emptyList(),
    /** 有今日句型时先停在「选句页」等用户点选（web `pickOpen`） */
    val pickOpen: Boolean = true,
    val word: String = "",
    val sentence: String = "",
    val busy: Boolean = false,
    val result: SentenceComposeResult? = null,
) {
    /**
     * 「点评里哪些字要被标红」——**逐字**判定：某字被任一错误片段包含就标红。
     *
     * ⚠️ 这是**照抄 web 的行为**：web 用 `wrongs`（来自学生原句的判错片段）去 `includes` 检查
     * **AI 点评文本**里的每个字。这看着有点怪（在两个不同文本之间做匹配），但它是既有行为，
     * 改动会让孩子看到的红字位置变化，故一并保留。这里预先算成 Set，避免在 composable 里 O(n·m)。
     */
    val wrongChars: Set<Char>
        get() {
            val r = result ?: return emptySet()
            if (r.wrongs.isEmpty() || r.reply.isEmpty()) return emptySet()
            return r.reply.toSet().filter { ch -> r.wrongs.any { it.isNotEmpty() && it.contains(ch) } }.toSet()
        }
}

/**
 * 造句练习 —— 对齐 web `SentencePracticePage`：给一个词/句型，孩子造句，AI 判对错并给更正。
 *
 * 练习目标选取顺序（与 web 完全一致）：
 * ① 今日句型（家长在「每日语文」配的 `sentences`）随机 → ② 生词本**到期待复习**的词随机 →
 * ③ 内置兜底词池。
 */
class SentenceComposeViewModel(
    private val dailyZhSync: DailyZhSync,
    private val wordbookRepository: WordbookRepository = WordbookRepository(),
    private val chatRepository: AiChatRepository = AiChatRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(SentenceComposeUiState())
    val uiState: StateFlow<SentenceComposeUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val cfg = dailyZhSync.load()
            val today = DailyTextSplit.todaySentences(cfg.sentences)
            _uiState.value = _uiState.value.copy(todaySentences = today)
            // 今日有句型 → 停在选句页；否则直接随机取词开练（web 的 useEffect 分支）
            if (today.isEmpty()) next()
        }
    }

    /** 换一个词：清空输入与结果，重新取练习目标 */
    fun next() {
        _uiState.value = _uiState.value.copy(result = null, sentence = "", busy = false)
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(word = pickWord())
        }
    }

    /** 点选某个句型直接开练（web 的两处 chip onClick 都是这套动作） */
    fun pick(sentence: String) {
        _uiState.value = _uiState.value.copy(
            result = null,
            sentence = "",
            word = sentence,
            pickOpen = false,
        )
    }

    fun onSentenceChange(value: String) {
        _uiState.value = _uiState.value.copy(sentence = value)
    }

    private suspend fun pickWord(): String {
        val today = _uiState.value.todaySentences
        if (today.isNotEmpty()) return today.random()
        val due = runCatching { wordbookRepository.reviewQueue() }.getOrNull()
        if (!due.isNullOrEmpty()) return due.random().text
        return FALLBACK_WORDS.random()
    }

    fun submit() {
        val st = _uiState.value
        val s = st.sentence.trim()
        if (s.isEmpty() || st.busy || st.word.isBlank()) return
        _uiState.value = st.copy(busy = true, result = null)

        // 提示词与 web 逐字一致（今日句型 vs 自由词两种问法）
        val isTodayTask = st.word in st.todaySentences
        val prompt = if (isTodayTask) {
            "今天的造句练习要求是：${st.word}。我写的句子是：$s。请检查是否正确完成了要求（用词、语法、语义），并简单讲解。"
        } else {
            "请检查我用「${st.word}」造的句子是否正确（用词、语法、语义），并简单讲解：$s"
        }

        viewModelScope.launch {
            val result = try {
                val r = chatRepository.ask(module = "chinese", message = prompt)
                SentenceComposeResult(reply = r.reply, corrected = r.correction, wrongs = r.wrongs)
            } catch (e: Exception) {
                // web：catch 后把异常信息当成 reply 显示
                SentenceComposeResult(reply = e.message ?: "提交失败，请重试")
            }
            _uiState.value = _uiState.value.copy(busy = false, result = result)
        }
    }

    companion object {
        /** 词库不可用时的兜底词池（与 web `FALLBACK_WORDS` 逐字一致） */
        val FALLBACK_WORDS = listOf("春天", "朋友", "认真", "一起", "漂亮", "帮助", "发现", "快乐")
    }
}
