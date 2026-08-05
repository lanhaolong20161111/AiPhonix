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

data class DictationItem(
    val entry: WordBankEntry,
    val word1: String = "",         // 第一个词语（用于朗读）
    val word2: String = "",         // 第二个词语（用于朗读）
    var isCorrect: Boolean? = null  // ✓/× 由用户手动标记
)

data class DictationUiState(
    val items: List<DictationItem> = emptyList(),
    val currentIndex: Int = 0,
    val currentPhase: String = "init",  // "init" / "reading_char" / "reading_word1" / "reading_word2" / "waiting"
    val repeatCount: Int = 1,           // 当前第几遍朗读
    val totalRepeats: Int = 2,          // 共读几遍
    val finished: Boolean = false,
    val loading: Boolean = false,
    val message: String = "",
    val submitted: Boolean = false,
    val reviewPhase: Boolean = false
)

class DictationViewModel(
    private val wordBankRepo: WordBankRepository,
    private val wordInfoRepo: WordInfoRepository,
    private val sessionResultStore: com.example.ai.data.training.SessionResultStore,
) : ViewModel() {

    companion object {
        private const val TAG = "DictationVM"
        private const val QUIZ_COUNT = 20
        private const val WORD_GAP_MS = 2000L   // 词语间间隔2秒
        private const val NEXT_DELAY_MS = 10000L // 读完到下一题间隔10秒
        private const val READ_TIMES = 2         // 每套读几遍
    }

    private val _state = MutableStateFlow(DictationUiState())
    val state: StateFlow<DictationUiState> = _state.asStateFlow()

    private val client = NetworkModule.httpClient

    // 多音字映射 {字 -> PolyphoneInfo}
    private data class PolyInfo(
        val pronunciations: List<String>,
        val words: Map<String, List<String>>,
        val primary: String
    )
    private var polyphoneMap: Map<String, PolyInfo> = emptyMap()

    init { loadQuiz() }

    private fun getServerBase() = WordInfoRepository.getServerBase()

    private fun loadPolyphoneData() {
        try {
            val req = Request.Builder()
                .url("${getServerBase()}/api/v1/chinese/polyphone")
                .build()
            val resp = NetworkModule.httpClient.newCall(req).execute()
            val body = resp.body?.string() ?: "{}"
            val json = JSONObject(body)
            val chars = json.optJSONObject("chars") ?: return
            val map = mutableMapOf<String, PolyInfo>()
            for (key in chars.keys()) {
                val obj = chars.optJSONObject(key) ?: continue
                val pArr = obj.optJSONArray("pronunciations")
                val prons = mutableListOf<String>()
                if (pArr != null) {
                    for (i in 0 until pArr.length()) {
                        pArr.optString(i, "").takeIf { it.isNotEmpty() }?.let { prons.add(it) }
                    }
                }
                val wordsObj = obj.optJSONObject("words") ?: continue
                val words = mutableMapOf<String, List<String>>()
                for (pyKey in wordsObj.keys()) {
                    val wArr = wordsObj.optJSONArray(pyKey) ?: continue
                    val wList = (0 until wArr.length()).map { wArr.optString(it, "") }.filter { it.isNotEmpty() }
                    if (wList.isNotEmpty()) words[pyKey] = wList
                }
                val primary = obj.optString("primary", prons.firstOrNull() ?: "")
                map[key] = PolyInfo(prons, words, primary)
            }
            polyphoneMap = map
            Log.d(TAG, "已加载 ${map.size} 个多音字数据")
        } catch (e: Exception) {
            Log.w(TAG, "加载多音字数据失败: ${e.message}")
        }
    }

    /** 查一个字对应的两个常用词（不够则调 LLM 生成） */
    /** 仅查本地数据（只取多音字主读音的词语） */
    private fun getTwoWordsFromLocal(char: String): Pair<String, String> {
        val allWords = mutableListOf<String>()
        val info = polyphoneMap[char]
        if (info != null) {
            // 只取 primary 读音的词语，不混合其他读音
            val primaryWords = info.words[info.primary] ?: emptyList()
            allWords.addAll(primaryWords.filter { it != char && it.length >= 2 })
        }
        // 非多音字或不足时，从词库补充
        if (allWords.size < 2) {
            allWords.addAll(
                wordBankRepo.queryWords().map { it.text }
                    .filter { it.contains(char) && it.length >= 2 && it !in allWords }
            )
        }
        val unique = allWords.distinct()
        val w1 = unique.getOrNull(0) ?: char
        val w2 = unique.getOrNull(1) ?: unique.getOrNull(0) ?: char
        return w1 to w2
    }

    /** 查字对应的两个常用词（本地不足则查 LLM 缓存） */
    private suspend fun getTwoWords(char: String): Pair<String, String> {
        val (w1, w2) = getTwoWordsFromLocal(char)
        if (w1 != w2 || (w1 != char && w2 != char)) return w1 to w2

        // 本地不足，查 LLM 缓存（之前 batchGenerateWords 已生成）
        val cached = llmWordCache[char]
        val c1 = cached?.getOrNull(0) ?: w1
        val c2 = cached?.getOrNull(1) ?: cached?.getOrNull(0) ?: w1
        return c1 to c2
    }

    // LLM 词语生成缓存 {字 -> [词1, 词2]} — 保留备用，新字加入时可调 LLM 补充
    private var llmWordCache: MutableMap<String, List<String>> = mutableMapOf()

    /** 批量调用 LLM 为多个字生成词语（备用，目前词库已足够） */
    private fun batchGenerateWords(chars: List<String>) {
        if (chars.isEmpty()) return
        try {
            val charList = chars.joinToString("、")
            val body = JSONObject().apply {
                put("message", "为以下每个汉字生成2个适合小学生的常用二字词语，排除不吉利或消极的词语。请只输出JSON格式，不要其他文字。格式：{\"字1\":[\"词1\",\"词2\"],\"字2\":[\"词3\",\"词4\"]}\n汉字列表：$charList")
                put("mode", "chinese")
            }
            val req = Request.Builder()
                .url("${getServerBase()}/api/v1/llm/chat")
                .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()
            val resp = NetworkModule.httpClient.newCall(req).execute()
            val json = JSONObject(resp.body?.string() ?: "{}")
            val reply = json.optString("reply", "")
            if (reply.isNotEmpty()) {
                val start = reply.indexOf('{')
                val end = reply.lastIndexOf('}')
                if (start >= 0 && end > start) {
                    val jsonStr = reply.substring(start, end + 1)
                    val result = JSONObject(jsonStr)
                    for (ch in chars) {
                        val arr = result.optJSONArray(ch)
                        if (arr != null && arr.length() > 0) {
                            val words = (0 until arr.length())
                                .map { arr.optString(it, "") }
                                .filter { it.contains(ch) && it.length >= 2 }
                            if (words.isNotEmpty()) {
                                llmWordCache[ch] = words
                                try {
                                    val saveBody = JSONObject().apply {
                                        put("char", ch)
                                        put("words", JSONArray(words))
                                    }
                                    val saveReq = Request.Builder()
                                        .url("${getServerBase()}/api/v1/wordbank/add-word")
                                        .post(saveBody.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                                        .build()
                                    client.newCall(saveReq).execute()
                                } catch (_: Exception) {}
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "批量 LLM 生成词语失败: ${e.message}")
        }
    }

    fun loadQuiz() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, message = "加载题目...")

            // 预加载多音字数据
            withContext(Dispatchers.IO) { loadPolyphoneData() }

            val all = wordBankRepo.queryChars("写字")
            if (all.isEmpty()) {
                _state.value = _state.value.copy(loading = false, message = "字库中没有写字类汉字")
                return@launch
            }
            val selected = all.shuffled().take(QUIZ_COUNT)

            // 先初步构建，找出需要 LLM 补词语的字
            val needLlm = mutableListOf<String>()
            val tempItems = selected.map { entry ->
                val (w1, w2) = getTwoWordsFromLocal(entry.text)
                if (w1 == w2 || w1 == entry.text || w2.isEmpty()) {
                    needLlm.add(entry.text)
                }
                entry
            }

            // 如果本地不足，批量调 LLM 补充（词库目前已有 1360 词，通常不会触发）
            if (needLlm.isNotEmpty()) {
                withContext(Dispatchers.IO) { batchGenerateWords(needLlm) }
            }

            val items = selected.map { entry ->
                val (w1, w2) = getTwoWords(entry.text)
                DictationItem(entry = entry, word1 = w1, word2 = w2)
            }
            _state.value = DictationUiState(items = items)
            Log.d(TAG, "加载 ${items.size} 个默写字")

            // 延迟200ms等界面渲染，然后开始朗读第一题
            delay(200)
            startReadingChar(0)
        }
    }

    /** 朗读当前字：读两遍 字→词1→(2秒)→词2，然后等10秒进入下一题 */
    private fun startReadingChar(index: Int) {
        val s = _state.value
        if (index >= s.items.size) {
            _state.value = s.copy(reviewPhase = true, message = "请逐字确认 ✓/✗")
            return
        }

        _state.value = s.copy(currentIndex = index, currentPhase = "init", repeatCount = 1)
        val item = s.items[index]
        val char = item.entry.text

        viewModelScope.launch {
            for (round in 1..READ_TIMES) {
                _state.value = _state.value.copy(repeatCount = round)
                // a. 读单字
                _state.value = _state.value.copy(currentPhase = "reading_char", message = "🔊 ${char.map { '█' }.joinToString("")} （第${round}遍）")
                onPlayTts(char)
                delay(1500)

                // b. 读第一个词
                if (item.word1.isNotEmpty()) {
                    _state.value = _state.value.copy(currentPhase = "reading_word1", message = "📝 听词语: ${item.word1.map { '█' }.joinToString("")}")
                    onPlayTts(item.word1)
                    delay(2000)
                }
                delay(WORD_GAP_MS)

                // c. 读第二个词
                if (item.word2.isNotEmpty()) {
                    _state.value = _state.value.copy(currentPhase = "reading_word2", message = "📝 听词语: ${item.word2.map { '█' }.joinToString("")}")
                    onPlayTts(item.word2)
                    delay(2000)
                }
                delay(1000) // 遍间短间隔
            }

            // 两遍读完，等10秒后自动进入下一题
            _state.value = _state.value.copy(currentPhase = "waiting", message = "请在纸上写下来，即将进入下一题...")
            onPlayTts("请在纸上写下来，10秒后进入下一题")
            delay(NEXT_DELAY_MS)
            startReadingChar(index + 1)
        }
    }

    var onPlayTts: ((String) -> Unit) = {}

    fun reRead() {
        val s = _state.value
        val item = s.items.getOrNull(s.currentIndex) ?: return
        viewModelScope.launch {
            // 重读字+词
            val char = item.entry.text
            onPlayTts(char)
            delay(500)
            if (item.word1.isNotEmpty()) onPlayTts(item.word1)
            delay(WORD_GAP_MS)
            if (item.word2.isNotEmpty()) onPlayTts(item.word2)
        }
    }

    fun nextChar() {
        val s = _state.value
        startReadingChar(s.currentIndex + 1)
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
                    put("module", "dictation")
                    put("attempt_count", 1)
                    put("first_try_correct", isCorrect)
                    put("hint_used", false)
                    put("correct", isCorrect)
                    put("timestamp", java.time.Instant.now().toString())
                    put("date", java.time.LocalDate.now().toString())
                })
            }

            val body = JSONObject().apply {
                put("module", "dictation")
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
                message = if (ok) "记录已保存" else "提交失败（可稍后重试）"
            )
            // V2：默写提交成功即达完成标准，回传真实结果（返回首页时打卡）
            if (ok) {
                val itemId = com.example.ai.data.training.ActiveTrainingSession.itemId
                if (itemId != null) {
                    sessionResultStore.record(
                        itemId,
                        com.example.ai.data.training.PlanResult(
                            count = s.items.size,
                            correct = correctCount,
                        )
                    )
                }
            }
        }
    }
}
