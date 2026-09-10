package com.example.ai.ui.articlereading

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.articlereading.ArticleAnswer
import com.example.ai.data.articlereading.ArticleContent
import com.example.ai.data.articlereading.ArticleContentParser
import com.example.ai.data.articlereading.ArticleQuestion
import com.example.ai.data.articlereading.ArticleQuestionMatcher
import com.example.ai.data.articlereading.ArticleReadingStore
import com.example.ai.data.articlereading.ArticleSession
import com.example.ai.data.articlereading.ImportedQuizParser
import com.example.ai.data.repository.LLMRepository
import com.example.ai.data.userimport.UserImportStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** 读后问答页状态 */
data class ArticleQuizUiState(
    val articleKey: String = "",
    val title: String = "",
    val article: ArticleContent? = null,
    val questions: List<ArticleQuestion> = emptyList(),
    val answers: List<ArticleAnswer> = emptyList(),
    val loading: Boolean = true,       // 正在生成/匹配问题
    val matchedCount: Int = 0,         // 本地题库匹配到的数量
    val error: String = "",
    val expandedAnswer: Int = -1,      // 展开参考答案的题号
)

class ArticleQuizViewModel(
    private val store: UserImportStore,
    private val readingStore: ArticleReadingStore,
    private val llmRepository: LLMRepository,
) : ViewModel() {

    companion object {
        private const val TAG = "ArticleQuizViewModel"
        private const val TARGET_QUESTION_COUNT = 3
        private val json = Json { ignoreUnknownKeys = true }
    }

    private val _uiState = MutableStateFlow(ArticleQuizUiState())
    val uiState: StateFlow<ArticleQuizUiState> = _uiState

    fun initQuiz(articleKey: String, title: String) {
        if (_uiState.value.articleKey == articleKey && !_uiState.value.loading) return
        viewModelScope.launch {
            val item = store.load().firstOrNull { it.id == articleKey && it.kind == "article" }
            if (item == null) {
                _uiState.value = _uiState.value.copy(loading = false, error = "文章不存在或已删除")
                return@launch
            }
            val content = ArticleContentParser.parse(item)
            val session = readingStore.load(articleKey)
            val existingQuestions = session?.questions ?: emptyList()
            if (existingQuestions.isNotEmpty()) {
                _uiState.value = _uiState.value.copy(
                    articleKey = articleKey,
                    title = title.ifBlank { content.title },
                    article = content,
                    questions = existingQuestions,
                    answers = session?.answers ?: emptyList(),
                    loading = false,
                    matchedCount = existingQuestions.count { it.source == "matched" },
                )
                return@launch
            }

            _uiState.value = _uiState.value.copy(
                articleKey = articleKey,
                title = title.ifBlank { content.title },
                article = content,
                loading = true,
            )

            // 1) 本地题库匹配（零成本）
            val matched = matchLocalQuestions(content)

            // 2) 不足目标数 → LLM 补足（走服务端预算守卫）
            val questions = matched.toMutableList()
            var llmGenerated = 0
            if (questions.size < TARGET_QUESTION_COUNT) {
                val need = TARGET_QUESTION_COUNT - questions.size
                llmGenerated = generateLlmQuestions(content, need, questions.size)
            }
            _uiState.value = _uiState.value.copy(
                questions = questions,
                matchedCount = matched.size,
                loading = false,
                error = if (questions.isEmpty()) "没有找到相关题目，LLM 生成也失败了，请稍后重试" else "",
            )
            if (questions.isNotEmpty()) saveSession(questions, _uiState.value.answers)
        }
    }

    private fun matchLocalQuestions(content: ArticleContent): List<ArticleQuestion> {
        val candidates = store.load()
            .filter { it.kind == "quiz" }
            .map { ImportedQuizParser.parse(it) }
        val matched = ArticleQuestionMatcher.match(content, candidates, limit = TARGET_QUESTION_COUNT)
        return matched.map {
            ArticleQuestion(
                text = it.text,
                options = it.options,
                answer = it.answer,
                source = "matched",
            )
        }
    }

    private suspend fun generateLlmQuestions(
        content: ArticleContent,
        need: Int,
        offset: Int,
    ): Int {
        return try {
            val body = content.paragraphs.joinToString("\n")
            val raw = llmRepository.generateArticleQuestions(content.title, body)
            val parsed = parseLlmQuestions(raw)
            val take = parsed.take(need)
            val questions = _uiState.value.questions.toMutableList()
            questions.addAll(take)
            _uiState.value = _uiState.value.copy(questions = questions)
            take.size
        } catch (e: Exception) {
            Log.e(TAG, "LLM 生成问题失败", e)
            _uiState.value = _uiState.value.copy(error = "LLM 生成问题失败（可能超出每日预算）")
            0
        }
    }

    /** 解析 LLM 返回的 JSON 数组（容忍 markdown 代码块与前后说明文字） */
    private fun parseLlmQuestions(raw: String): List<ArticleQuestion> {
        val cleaned = raw.replace(Regex("""```(?:json)?\s*"""), "").trim()
        val start = cleaned.indexOf('[')
        val end = cleaned.lastIndexOf(']')
        if (start < 0 || end <= start) return emptyList()
        return try {
            val arr = json.parseToJsonElement(cleaned.substring(start, end + 1)).jsonArray
            arr.mapNotNull { el ->
                val obj = el.jsonObject
                val q = obj["question"]?.jsonPrimitive?.contentOrNull?.trim() ?: return@mapNotNull null
                val a = obj["answer"]?.jsonPrimitive?.contentOrNull?.trim() ?: ""
                if (q.isBlank()) null
                else ArticleQuestion(text = q, answer = a, source = "llm")
            }
        } catch (e: Exception) {
            Log.e(TAG, "问题解析失败: ${cleaned.take(200)}", e)
            emptyList()
        }
    }

    /** 保存某题的口述回答（文本框输入/输入法语音输入） */
    fun setAnswerText(index: Int, text: String) {
        val s = _uiState.value
        val answers = s.answers.toMutableList()
        val existing = answers.indexOfFirst { it.questionIndex == index }
        val newAnswer = ArticleAnswer(
            questionIndex = index,
            spokenText = text,
            audioPath = "",
            updatedAt = System.currentTimeMillis(),
        )
        if (existing >= 0) answers[existing] = newAnswer else answers.add(newAnswer)
        val sorted = answers.sortedBy { it.questionIndex }
        _uiState.value = s.copy(answers = sorted)
        saveSession(s.questions, sorted)
    }

    fun toggleAnswer(index: Int) {
        _uiState.value = _uiState.value.copy(
            expandedAnswer = if (_uiState.value.expandedAnswer == index) -1 else index
        )
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = "")
    }

    private fun saveSession(questions: List<ArticleQuestion>, answers: List<ArticleAnswer>) {
        val s = _uiState.value
        if (s.articleKey.isBlank()) return
        val existing = readingStore.load(s.articleKey)
        readingStore.save(
            ArticleSession(
                articleKey = s.articleKey,
                title = s.title,
                summaries = existing?.summaries ?: emptyList(),
                questions = questions,
                answers = answers,
                finishedAt = existing?.finishedAt ?: System.currentTimeMillis(),
            )
        )
    }
}
