package com.example.ai.ui.quizpractice

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.userimport.UserImportItem
import com.example.ai.data.userimport.UserImportStore
import com.example.ai.di.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * 本地题库练习：把用户导入的 kind=quiz 条目（payload 含 options/answer/explanation）
 * 逐题展示 → 选择作答 → 本地判题 → 成绩提交到 /practice/submit。
 * 纯本地规则判题，零 LLM 调用。
 */
class QuizPracticeViewModel(private val store: UserImportStore) : ViewModel() {

    private val _uiState = MutableStateFlow(QuizPracticeUiState())
    val uiState: StateFlow<QuizPracticeUiState> = _uiState.asStateFlow()

    init {
        loadQuestions()
    }

    private fun loadQuestions() {
        val items = store.load().filter { it.kind == "quiz" }
        val questions = items.mapNotNull { parseQuiz(it) }
        _uiState.value = QuizPracticeUiState(
            loading = false,
            empty = questions.isEmpty(),
            questions = questions,
        )
        Log.d(TAG, "本地题库: ${items.size} 条目, ${questions.size} 道有效题")
    }

    /** 解析 quiz 条目的 payload：{"type","options","answer","explanation"} */
    private fun parseQuiz(item: UserImportItem): QuizQuestion? {
        val stem = item.text.trim()
        if (stem.isEmpty()) return null
        val payload = try {
            Json.parseToJsonElement(item.payload).jsonObject
        } catch (e: Exception) {
            null
        }
        val options = try {
            payload?.get("options")?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
        if (options.size < 2) return null
        return QuizQuestion(
            id = item.id,
            stem = stem,
            options = options,
            answer = payload?.get("answer")?.jsonPrimitive?.content.orEmpty(),
            explanation = payload?.get("explanation")?.jsonPrimitive?.content.orEmpty(),
            type = payload?.get("type")?.jsonPrimitive?.content.orEmpty(),
        )
    }

    /** 当前题 */
    private fun current(): QuizQuestion? =
        _uiState.value.questions.getOrNull(_uiState.value.currentIndex)

    /** 选择一个选项作答 */
    fun selectOption(option: String) {
        val s = _uiState.value
        if (s.answered || s.finished) return
        val q = current() ?: return
        val isCorrect = option.trim() == q.answer.trim()
        _uiState.value = s.copy(
            selectedOption = option,
            answered = true,
            isCorrect = isCorrect,
            correctCount = s.correctCount + if (isCorrect) 1 else 0,
            results = s.results + (s.currentIndex to isCorrect),
        )
    }

    /** 下一题或进入完成页 */
    fun next() {
        val s = _uiState.value
        if (!s.answered) return
        if (s.currentIndex + 1 >= s.questions.size) {
            _uiState.value = s.copy(finished = true)
        } else {
            _uiState.value = s.copy(
                currentIndex = s.currentIndex + 1,
                selectedOption = null,
                answered = false,
                isCorrect = false,
            )
        }
    }

    /** 提交成绩到 /api/v1/practice/submit（module=quiz） */
    fun submit() {
        val s = _uiState.value
        if (!s.finished || s.submitted || s.submitting) return
        viewModelScope.launch {
            _uiState.value = s.copy(submitting = true, message = "提交记录...")
            val records = JSONArray()
            for ((index, q) in s.questions.withIndex()) {
                val isCorrect = s.results[index] ?: false
                records.put(JSONObject().apply {
                    put("char", q.stem)
                    put("module", "quiz")
                    put("attempt_count", 1)
                    put("first_try_correct", isCorrect)
                    put("hint_used", false)
                    put("correct", isCorrect)
                    put("timestamp", java.time.Instant.now().toString())
                    put("date", java.time.LocalDate.now().toString())
                })
            }
            val body = JSONObject().apply {
                put("module", "quiz")
                put("records", records)
                put("total_score", s.correctCount)
                put("max_score", s.questions.size)
            }
            val ok = withContext(Dispatchers.IO) {
                try {
                    val req = Request.Builder()
                        .url("${com.example.ai.data.speech.ScoreClient.serverBase()}/api/v1/practice/submit")
                        .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                        .build()
                    val resp = NetworkModule.httpClient.newCall(req).execute()
                    resp.isSuccessful
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
        private const val TAG = "QuizPracticeViewModel"
    }
}

data class QuizQuestion(
    val id: String,
    val stem: String,
    val options: List<String>,
    val answer: String,
    val explanation: String,
    val type: String,
)

data class QuizPracticeUiState(
    val loading: Boolean = true,
    val empty: Boolean = false,
    val questions: List<QuizQuestion> = emptyList(),
    val currentIndex: Int = 0,
    val selectedOption: String? = null,
    val answered: Boolean = false,
    val isCorrect: Boolean = false,
    val correctCount: Int = 0,
    val results: Map<Int, Boolean> = emptyMap(),
    val finished: Boolean = false,
    val submitting: Boolean = false,
    val submitted: Boolean = false,
    val message: String = "",
)
