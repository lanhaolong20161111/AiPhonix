package com.example.ai.ui.quiz

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.quiz.QuizItem
import com.example.ai.data.quiz.QuizRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.util.Log
import com.example.ai.data.tts.TtsEngine

/** 单词级别的答题结果 */
data class WordResult(
    val input: String,
    val correct: String,
    val isCorrect: Boolean,
)

/** 句子解析结果：去标点的单词 + 每个单词后的标点 */
data class WordPunctuationInfo(
    val cleanWords: List<String>,
    val trailingPunct: List<String>,
)

data class QuizState(
    val isLoading: Boolean = true,
    val items: List<QuizItem> = emptyList(),
    val currentIndex: Int = 0,
    /** 当前题目的用户输入（每个单词一个字段） */
    val userInputs: List<String> = emptyList(),
    /** 当前题目的逐词结果（null=尚未提交） */
    val wordResults: List<WordResult>? = null,
    /** 当前题目是否已答对 */
    val isCorrect: Boolean = false,
    /** 当前题目已尝试次数 */
    val attempts: Int = 0,
    /** 是否使用了提示（显示正确答案供参考） */
    val hintUsed: Boolean = false,
    /** 提示显示的正确答案（非空时在界面展示） */
    val hintAnswer: String? = null,
    /** 标点信息（仅在加载后可用） */
    val punctInfo: WordPunctuationInfo = WordPunctuationInfo(emptyList(), emptyList()),
    /** 总得分 */
    val score: Int = 0,
    /** 总题数（已答+未答） */
    val totalCount: Int = 0,
    /** 是否完成所有题目 */
    val isFinished: Boolean = false,
    /** 是否展示撒花庆祝 */
    val showConfetti: Boolean = false,
    val error: String? = null,
    /** 非错误提示（如：使用本地缓存题库） */
    val notice: String? = null,
) {
    val currentItem: QuizItem? get() = items.getOrNull(currentIndex)
    val isSubmitted: Boolean get() = wordResults != null
    val canHint: Boolean get() = attempts >= 3 && !hintUsed && !isSubmitted
    val isCloze: Boolean get() = currentItem?.blankAnswer != null
}

class QuizViewModel(
    private val quizRepository: QuizRepository,
    private val ttsEngine: TtsEngine,
) : ViewModel() {

    private val _state = MutableStateFlow(QuizState())
    val state: StateFlow<QuizState> = _state.asStateFlow()

    /** 加载指定视频的题库 */
    fun loadQuiz(videoName: String, srtPath: String) {
        _state.value = QuizState(isLoading = true)
        viewModelScope.launch {
            try {
                val subtitleText = withContext(Dispatchers.IO) {
                    java.io.File(srtPath).readText()
                }
                if (subtitleText.isBlank()) {
                    _state.value = QuizState(
                        isLoading = false,
                        error = "字幕文件为空：$srtPath",
                    )
                    return@launch
                }

                val result = quizRepository.getQuizBank(videoName, subtitleText)
                val bank = result.bank
                if (bank.items.isEmpty()) {
                    _state.value = QuizState(
                        isLoading = false,
                        error = "题库为空，AI 未能从字幕中提取到合适的题目。\n请检查字幕内容或稍后重试。",
                    )
                    return@launch
                }
                // 使用本地缓存题库时提示
                val notice = if (result.fromCache) "已使用本地缓存题库（断网也可用）" else null
                // 将部分条目自动转为填空模式（如果 LLM 未提供 cloze）
                val enriched = enrichItems(bank.items)
                val items = enriched.shuffled().take(30)
                val first = items.first()
                if (first.blankAnswer != null) {
                    // 填空模式：单输入框
                    _state.value = QuizState(
                        isLoading = false,
                        items = items,
                        userInputs = listOf(""),
                        totalCount = items.size,
                        notice = notice,
                    )
                } else {
                    val firstInfo = parseSentence(first.english)
                    _state.value = QuizState(
                        isLoading = false,
                        items = items,
                        userInputs = firstInfo.cleanWords.map { "" },
                        punctInfo = firstInfo,
                        totalCount = items.size,
                        notice = notice,
                    )
                }
            } catch (e: Exception) {
                Log.e("QuizViewModel", "加载题库失败", e)
                _state.value = QuizState(
                    isLoading = false,
                    error = "加载题库失败: ${e.message ?: "未知错误"}",
                )
            }
        }
    }

    /** 更新某个单词的输入 */
    fun updateInput(index: Int, value: String) {
        val s = _state.value
        if (s.isSubmitted) return
        val inputs = s.userInputs.toMutableList()
        if (index in inputs.indices) {
            inputs[index] = value
            _state.value = s.copy(userInputs = inputs)
        }
    }

    /** 提交当前题目的答案 */
    fun submit() {
        val s = _state.value
        val item = s.currentItem ?: return
        val results = if (item.blankAnswer != null) {
            // 填空模式：只检查一个空
            val input = s.userInputs.getOrElse(0) { "" }.trim()
            listOf(WordResult(
                input = input,
                correct = item.blankAnswer,
                isCorrect = input.equals(item.blankAnswer, ignoreCase = true),
            ))
        } else {
            val info = parseSentence(item.english)
            info.cleanWords.mapIndexed { i, correct ->
                val input = s.userInputs.getOrElse(i) { "" }.trim()
                WordResult(
                    input = input,
                    correct = correct,
                    isCorrect = input.equals(correct, ignoreCase = true),
                )
            }
        }
        val allCorrect = results.all { it.isCorrect }
        _state.value = s.copy(
            wordResults = results,
            isCorrect = allCorrect,
            attempts = s.attempts + if (allCorrect) 0 else 1,
            score = if (allCorrect && !s.isSubmitted) s.score + 1 else s.score,
            showConfetti = allCorrect,
        )
    }

    /** 使用提示：在单独区域显示正确答案供参考 */
    fun hint() {
        val s = _state.value
        val item = s.currentItem ?: return
        _state.value = s.copy(
            hintAnswer = item.english,
            hintUsed = true,
        )
    }

    /** 朗读当前题目（TTS），常驻可用，无需先使用文字提示 */
    fun speakHint() {
        val text = _state.value.currentItem?.english ?: return
        viewModelScope.launch {
            val ok = ttsEngine.speak(text)
            if (!ok) {
                _state.value = _state.value.copy(error = "朗读失败，请检查网络")
            }
        }
    }

    /**
     * 将部分整句条目自动转换为填空模式（当 LLM 未提供时）。
     * 随机选择 50% 的条目，将其中某个关键词替换为 ___。
     */
    private fun enrichItems(items: List<QuizItem>): List<QuizItem> {
        return items.map { item ->
            if (item.blankAnswer != null) return@map item // LLM 已提供填空
            if (kotlin.random.Random.nextFloat() >= 0.5f) return@map item // 50% 保持整句
            makeCloze(item) ?: item
        }
    }

    private fun makeCloze(item: QuizItem): QuizItem? {
        val rawWords = item.english.split(" ").filter { it.isNotBlank() }
        if (rawWords.isEmpty()) return null

        // 清理标点，只留字母
        data class WordInfo(val raw: String, val clean: String, val punct: String)
        val wordInfos = rawWords.map { w ->
            WordInfo(w, w.filter { it.isLetter() }, w.filter { !it.isLetter() })
        }

        if (wordInfos.size == 1) {
            // 单个词：显示首字母 + 下划线，如 "beautiful" → "b________"
            val info = wordInfos.first()
            if (info.clean.length <= 1) return null
            val display = info.clean[0] + "_".repeat(info.clean.length - 1) + info.punct
            return item.copy(display = display, blankAnswer = info.clean)
        }

        // 句子：选一个 >= 3 字符的词（优先实义词），替换为 ___
        val candidates = wordInfos.filter { it.clean.length >= 3 }
        if (candidates.isEmpty()) return null
        val chosen = candidates.random()
        // 标点跟着原词
        val display = wordInfos.joinToString(" ") { wi ->
            if (wi == chosen) "___" else wi.raw
        }
        return item.copy(display = display, blankAnswer = chosen.clean)
    }

    /** 进入下一题 */
    fun nextQuestion() {
        val s = _state.value
        val nextIndex = s.currentIndex + 1
        if (nextIndex >= s.items.size) {
            _state.value = s.copy(isFinished = true, showConfetti = false)
            return
        }
        val nextItem = s.items[nextIndex]
        if (nextItem.blankAnswer != null) {
            _state.value = s.copy(
                currentIndex = nextIndex,
                userInputs = listOf(""),
                wordResults = null,
                isCorrect = false,
                attempts = 0,
                hintUsed = false,
                hintAnswer = null,
                showConfetti = false,
            )
        } else {
            val info = parseSentence(nextItem.english)
            _state.value = s.copy(
                currentIndex = nextIndex,
                userInputs = info.cleanWords.map { "" },
                punctInfo = info,
                wordResults = null,
                isCorrect = false,
                attempts = 0,
                hintUsed = false,
                hintAnswer = null,
                showConfetti = false,
            )
        }
    }

    /** 重新填写当前题目 */
    fun retry() {
        val s = _state.value
        val item = s.currentItem ?: return
        if (item.blankAnswer != null) {
            _state.value = s.copy(
                userInputs = listOf(""),
                wordResults = null,
                isCorrect = false,
                hintAnswer = null,
            )
        } else {
            val info = parseSentence(item.english)
            _state.value = s.copy(
                userInputs = info.cleanWords.map { "" },
                wordResults = null,
                isCorrect = false,
                hintAnswer = null,
            )
        }
    }

    /** 重置整套考试 */
    fun reset(videoName: String, srtPath: String) {
        loadQuiz(videoName, srtPath)
    }

    companion object {
        /** 将英文句子拆分为单词列表（去除标点，保留标点位置） */
        fun parseSentence(english: String): WordPunctuationInfo {
            val tokens = english.trim().split(Regex("""\s+""")).filter { it.isNotBlank() }
            val cleanWords = tokens.map { it.replace(Regex("""[,\\.!?;:'"()]+"""), "") }
            val trailingPunct = tokens.map { token ->
                Regex("""[,\\.!?;:'"()]+$""").find(token)?.value ?: ""
            }
            return WordPunctuationInfo(cleanWords, trailingPunct)
        }

        /** 旧版拆分方法，保留兼容 */
        fun splitWords(english: String): List<String> {
            return english.trim().split(Regex("""\s+""")).filter { it.isNotBlank() }
        }
    }
}
