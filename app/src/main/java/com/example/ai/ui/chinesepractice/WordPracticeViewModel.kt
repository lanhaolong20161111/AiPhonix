package com.example.ai.ui.chinesepractice

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.chinesepractice.WordInfoRepository
import com.example.ai.data.wordbank.WordBankEntry
import com.example.ai.data.wordbank.WordBankRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import com.example.ai.di.NetworkModule
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

data class WordPracticeItem(
    val entry: WordBankEntry,
    var sentence: String = "",
    var isCorrect: Boolean? = null
)

data class WordPracticeUiState(
    val items: List<WordPracticeItem> = emptyList(),
    val currentIndex: Int = 0,
    val currentPhase: String = "init",  // "init" / "reading_word" / "reading_sentence" / "waiting"
    val repeatCount: Int = 1,           // 当前第几遍
    val totalRepeats: Int = 2,          // 共2遍
    val currentWord: String = "",       // 当前词语
    val currentSentence: String = "",   // 当前句子
    val reviewPhase: Boolean = false,
    val finished: Boolean = false,
    val loading: Boolean = false,
    val message: String = "",
    val submitted: Boolean = false
)

class WordPracticeViewModel(
    private val wordBankRepo: WordBankRepository,
    private val wordInfoRepo: WordInfoRepository
) : ViewModel() {

    companion object {
        private const val TAG = "WordPracticeVM"
        private const val QUIZ_COUNT = 20
        private const val REPEAT_TIMES = 2
        private const val WORD_SENTENCE_GAP = 1000L   // 词→句间隔1秒
        private const val NEXT_DELAY_MS = 10000L      // 读完到下一题10秒
    }

    private val _state = MutableStateFlow(WordPracticeUiState())
    val state: StateFlow<WordPracticeUiState> = _state.asStateFlow()

    private val client = NetworkModule.httpClient

    var onPlayTts: ((String) -> Unit) = {}

    init { loadQuiz() }

    private fun getServerBase() = WordInfoRepository.getServerBase()

    fun loadQuiz() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, message = "加载题目...")
            val all = wordBankRepo.queryWords("词语")
                .ifEmpty { wordBankRepo.queryChars("词语") }
            if (all.isEmpty()) {
                _state.value = _state.value.copy(loading = false, message = "词语库为空")
                return@launch
            }
            val selected = all.shuffled().take(QUIZ_COUNT)
            val items = selected.map { WordPracticeItem(entry = it) }
            _state.value = WordPracticeUiState(items = items)
            Log.d(TAG, "加载 ${items.size} 个词语")

            // 延迟200ms等界面渲染
            delay(200)
            nextWord(0)
        }
    }

    private fun nextWord(index: Int) {
        val s = _state.value
        if (index >= s.items.size) {
            _state.value = s.copy(reviewPhase = true, message = "请逐题确认 ✓/✗")
            return
        }

        _state.value = s.copy(
            currentIndex = index,
            currentPhase = "init",
            repeatCount = 1,
            currentWord = "",
            currentSentence = ""
        )

        val item = s.items[index]
        val word = item.entry.text

        viewModelScope.launch {
            // 生成句子
            val sentence = try {
                val result = wordInfoRepo.generateSentence(word, hideWord = false)
                if (result != null) {
                    val raw = result.optString("raw", "")
                    JSONObject(raw).optString("sentence", "")
                } else ""
            } catch (_: Exception) { "" }

            val displaySentence = if (sentence.isNotEmpty()) sentence else "请写出词语: $word"

            val updated = s.items.toMutableList()
            updated[index] = updated[index].copy(sentence = displaySentence)
            _state.value = _state.value.copy(
                items = updated,
                currentWord = word,
                currentSentence = displaySentence
            )

            // 开始朗读：词→句子，重复2遍
            startReading()
        }
    }

    private fun startReading() {
        viewModelScope.launch {
            val word = _state.value.currentWord
            val sentence = _state.value.currentSentence

            for (round in 1..REPEAT_TIMES) {
                _state.value = _state.value.copy(repeatCount = round)

                // a. 读词语
                _state.value = _state.value.copy(
                    currentPhase = "reading_word",
                    message = "🔊 ${word.map { '█' }.joinToString("")} （第${round}遍）"
                )
                onPlayTts(word)
                delay(1500) // 等词语读完

                // b. 读句子（连词一起）
                _state.value = _state.value.copy(
                    currentPhase = "reading_sentence",
                    message = "📖 $sentence"
                )
                onPlayTts(sentence)
                delay(3000) // 等句子读完
            }

            // 读完等10秒进入下一题
            _state.value = _state.value.copy(
                currentPhase = "waiting",
                message = "请写出词语，即将进入下一题..."
            )
            onPlayTts("请写出词语，10秒后进入下一题")
            delay(NEXT_DELAY_MS)
            nextWord(_state.value.currentIndex + 1)
        }
    }

    fun reRead() {
        val s = _state.value
        viewModelScope.launch {
            val word = s.currentWord
            val sentence = s.currentSentence
            onPlayTts(word)
            delay(1500)
            delay(WORD_SENTENCE_GAP)
            onPlayTts(sentence)
        }
    }

    fun markItem(index: Int, correct: Boolean) {
        val s = _state.value
        val updated = s.items.toMutableList()
        updated[index] = updated[index].copy(isCorrect = correct)
        _state.value = s.copy(items = updated)
    }

    fun submitResults() {
        val s = _state.value
        if (!s.reviewPhase || s.submitted) return

        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, message = "提交记录...")

            val records = JSONArray()
            var correctCount = 0
            for (item in s.items) {
                val isCorrect = item.isCorrect ?: false
                if (isCorrect) correctCount++
                records.put(JSONObject().apply {
                    put("char", item.entry.text)
                    put("module", "word")
                    put("attempt_count", 1)
                    put("first_try_correct", isCorrect)
                    put("hint_used", false)
                    put("correct", isCorrect)
                    put("timestamp", java.time.Instant.now().toString())
                    put("date", java.time.LocalDate.now().toString())
                })
            }

            val body = JSONObject().apply {
                put("module", "word")
                put("records", records)
                put("total_score", correctCount)
                put("max_score", s.items.size)
            }

            val ok = withContext(Dispatchers.IO) {
                try {
                    val req = Request.Builder()
                        .url("${getServerBase()}/api/v1/practice/submit")
                        .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                        .build()
                    val resp = client.newCall(req).execute()
                    resp.isSuccessful
                } catch (e: Exception) {
                    Log.w(TAG, "提交失败: ${e.message}")
                    false
                }
            }

            _state.value = _state.value.copy(
                loading = false,
                submitted = ok,
                message = if (ok) "记录已保存" else "提交失败"
            )
        }
    }
}
