package com.example.ai.ui.chinesepractice

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.chinesepractice.WordInfoRepository
import com.example.ai.data.chinesepractice.parsePinyin
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.data.wordbank.WordBankEntry
import com.example.ai.data.wordbank.WordBankRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import com.example.ai.di.NetworkModule

data class QuestionResult(
    val char: String,
    val isCorrect: Boolean,
    val errorCount: Int,
    val usedHint: Boolean
)

data class HintContent(
    val words: List<String> = emptyList(),
    val sentence: String = ""
)

data class RecognitionUiState(
    val items: List<WordBankEntry> = emptyList(),
    val currentIndex: Int = 0,
    val userInitial: String = "",
    val userMedial: String = "",
    val userFinal: String = "",
    val userTone: Int = 0,
    val ttsHint: String = "",              // TTS 读音提示词（多音字用）
    val wordContext: String = "",           // 多音字的词语上下文（如"长城"中的"长"）
    val pinyinErrorCount: Int = 0,          // 拼音错误次数
    val pronunciationErrorCount: Int = 0,   // 读音错误次数
    val hintActivated: Boolean = false,
    val showHint: Boolean = false,
    val hintContent: HintContent? = null,
    val pinyinPassed: Boolean = false,
    val pronunciationPassed: Boolean = false,
    val finished: Boolean = false,
    val results: List<QuestionResult> = emptyList(),
    val loading: Boolean = false,
    val isRecording: Boolean = false,
    val message: String = "",
    /** 练习记录是否因断网未同步到服务端 */
    val recordSyncFailed: Boolean = false,
) {
    /** 两项都通过才算正确 */
    val isCorrect: Boolean? get() = when {
        !pinyinPassed && !pronunciationPassed -> null
        pinyinPassed && pronunciationPassed -> true
        else -> false
    }
}

class RecognitionViewModel(
    private val wordBankRepo: WordBankRepository,
    private val wordInfoRepo: WordInfoRepository,
    private val speechRepository: SpeechRepository,
) : ViewModel() {

    companion object {
        private const val TAG = "RecognitionVM"
        private const val QUIZ_COUNT = 20
        const val MAX_ERRORS = 3
        private const val PRONUNCIATION_PASS_SCORE = 80
    }

    private val _state = MutableStateFlow(RecognitionUiState())
    val state: StateFlow<RecognitionUiState> = _state.asStateFlow()

    // 服务端 API 客户端
    // 多音字数据（字 -> {读音列表, 词语, 常用读音}）
    private var polyphoneMap: Map<String, PolyphoneInfo> = emptyMap()
    private var polyphoneLoadFailed = false

    data class PolyphoneInfo(
        val pronunciations: List<String>,
        val words: Map<String, List<String>>,
        val primary: String
    )

    private val apiClient = NetworkModule.httpClient
    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    private fun serverBase() = com.example.ai.BuildConfig.TTS_SERVER_HOST.let {
        if (it.isNotBlank()) it else "http://192.168.1.3:8080"
    }

    var onPlayTts: ((String) -> Unit) = {}
    private fun playTts(text: String) { onPlayTts(text) }

    val currentChar: WordBankEntry?
        get() = _state.value.items.getOrNull(_state.value.currentIndex)

    val currentPinyin: String?
        get() = currentChar?.pinyin

    init {
        loadQuiz()
    }

    private fun loadPolyphoneData() {
        try {
            val req = Request.Builder()
                .url("${serverBase()}/api/v1/chinese/polyphone")
                .build()
            val resp = apiClient.newCall(req).execute()
            val body = resp.body?.string() ?: "{}"
            val json = JSONObject(body)
            val chars = json.optJSONObject("chars") ?: return
            val map = mutableMapOf<String, PolyphoneInfo>()
            for (key in chars.keys()) {
                val obj = chars.optJSONObject(key) ?: continue
                val pronunciations = mutableListOf<String>()
                val pArr = obj.optJSONArray("pronunciations")
                if (pArr != null) {
                    for (i in 0 until pArr.length()) {
                        pArr.optString(i, "").takeIf { it.isNotEmpty() }?.let { pronunciations.add(it) }
                    }
                }
                val wordsJson = obj.optJSONObject("words") ?: continue
                val words = mutableMapOf<String, List<String>>()
                for (pyKey in wordsJson.keys()) {
                    val wArr = wordsJson.optJSONArray(pyKey) ?: continue
                    val wList = (0 until wArr.length()).map { wArr.optString(it, "") }.filter { it.isNotEmpty() }
                    if (wList.isNotEmpty()) words[pyKey] = wList
                }
                val primary = obj.optString("primary", pronunciations.firstOrNull() ?: "")
                map[key] = PolyphoneInfo(pronunciations, words, primary)
            }
            polyphoneMap = map
            Log.d(TAG, "已加载 ${map.size} 个多音字数据")
        } catch (e: Exception) {
            polyphoneLoadFailed = true
            Log.w(TAG, "加载多音字数据失败: ${e.message}")
        }
    }

    fun loadQuiz() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, message = "加载题目...")
            val all = wordBankRepo.queryChars("识字")
            if (all.isEmpty()) {
                _state.value = _state.value.copy(loading = false, message = "字库中没有识字类汉字")
                return@launch
            }

            // 从服务端获取权重（出错则使用均匀随机）
            var weightFetchFailed = false
            val weights = try {
                val chars = JSONArray().apply { all.forEach { put(it.text) } }
                val body = JSONObject().apply { put("chars", chars) }
                val req = Request.Builder()
                    .url("${serverBase()}/api/v1/practice/char-weights")
                    .post(body.toString().toRequestBody(JSON_MEDIA))
                    .build()
                val resp = withContext(Dispatchers.IO) { apiClient.newCall(req).execute() }
                val json = JSONObject(resp.body?.string() ?: "{}")
                val w = json.optJSONObject("weights")
                if (w != null) {
                    all.associate { it.text to w.optDouble(it.text, 1.0).toFloat().coerceAtLeast(0.1f) }
                } else null
            } catch (_: Exception) { weightFetchFailed = true; null }

            // 加权随机选 QUIZ_COUNT 个（权重越高概率越大）
            val selected = if (weights != null) {
                val pool = all.flatMap { entry ->
                    val count = (weights[entry.text] ?: 1.0f * 5).toInt().coerceIn(1, 20)
                    List(count) { entry }
                }
                pool.shuffled().distinctBy { it.text }.take(QUIZ_COUNT)
            } else {
                all.shuffled().take(QUIZ_COUNT)
            }

            // 预加载多音字数据（确保词语上下文就绪）
            withContext(Dispatchers.IO) { loadPolyphoneData() }
            Log.d(TAG, "polyphoneMap 大小: ${polyphoneMap.size}")

            // 为多音字分配词语上下文
            val wordContexts = mutableMapOf<String, String>()
            for (item in selected) {
                val ch = item.text
                val info = polyphoneMap[ch]
                if (info != null) {
                    // 取常用读音的第一个词
                    val primaryWords = info.words[info.primary]
                    if (!primaryWords.isNullOrEmpty()) {
                        wordContexts[ch] = primaryWords.first()
                    } else {
                        // 任何读音的第一个词
                        val firstWords = info.words.values.firstOrNull()
                        if (!firstWords.isNullOrEmpty()) {
                            wordContexts[ch] = firstWords.first()
                        }
                    }
                }
            }

            val firstChar = selected.firstOrNull()?.text ?: ""
            val msgs = buildList {
                if (weightFetchFailed) add("无法获取个性化选题，已使用默认顺序")
                if (polyphoneLoadFailed) add("多音字数据加载失败，已使用本地字库")
            }
            _state.value = RecognitionUiState(
                items = selected,
                wordContext = wordContexts[firstChar] ?: "",
                message = msgs.joinToString("；"),
            )
            Log.d(TAG, "加载 ${selected.size} 个识字字 (权重模式=${weights != null})")
            updateTtsHint()
            playTts("第一题")
        }
    }

    /** 从字库词表中找第一个包含当前字的词作为 TTS 提示（多音字读音消歧） */
    private fun updateTtsHint() {
        val char = currentChar?.text ?: return
        val words = wordBankRepo.queryWords()
        val hint = words.firstOrNull { it.text.contains(char) }?.text ?: char
        _state.value = _state.value.copy(ttsHint = hint)
        Log.d(TAG, "TTS hint for '$char': $hint")
    }

    fun updateInitial(input: String) { _state.value = _state.value.copy(userInitial = input, pinyinPassed = false) }
    fun updateMedial(input: String) { _state.value = _state.value.copy(userMedial = input, pinyinPassed = false) }
    fun updateFinal(input: String) { _state.value = _state.value.copy(userFinal = input, pinyinPassed = false) }
    fun updateTone(tone: Int) { _state.value = _state.value.copy(userTone = tone, pinyinPassed = false) }

    /** 提交拼音答案 */
    fun submitPinyin() {
        val s = _state.value
        val stored = currentPinyin ?: return
        val correct = parsePinyin(stored)
        val passed = if (correct.isOverall) {
            s.userFinal.trim().lowercase() == correct.final && s.userTone == correct.tone
        } else {
            val initOk = if (correct.initial.isEmpty()) true
                else s.userInitial.trim().lowercase() == correct.initial
            val medialOk = if (correct.medial.isEmpty()) true
                else s.userMedial.trim().lowercase() == correct.medial
            val finalOk = s.userFinal.trim().lowercase() == correct.final
            initOk && medialOk && finalOk && s.userTone != 0 && s.userTone == correct.tone
        }
        _state.value = _state.value.copy(pinyinPassed = passed)
        if (!passed) {
            val s = _state.value
            val newErr = s.pinyinErrorCount + 1
            _state.value = _state.value.copy(pinyinErrorCount = newErr,
                hintActivated = newErr >= MAX_ERRORS || s.pronunciationErrorCount >= MAX_ERRORS,
                message = "拼音填错了")
            sendPracticeRecord(currentChar?.text ?: "", false, "pinyin")
        } else checkBothPassed()
    }

    /** 语音评测结果 — 独立计数 */
    fun onPronunciationResult(score: Int) {
        val passed = score >= PRONUNCIATION_PASS_SCORE
        if (passed) {
            val s = _state.value
            val both = s.pinyinPassed
            _state.value = s.copy(
                pronunciationPassed = true,
                message = if (both) "✅ 回答正确！" else "发音得分: $score ✅"
            )
            if (both) checkBothPassed()
        } else {
            val s = _state.value
            val newErr = s.pronunciationErrorCount + 1
            _state.value = _state.value.copy(
                pronunciationPassed = false,
                pronunciationErrorCount = newErr,
                hintActivated = newErr >= MAX_ERRORS || s.pinyinErrorCount >= MAX_ERRORS,
                message = "发音得分: $score（需 ${PRONUNCIATION_PASS_SCORE} 分以上，再读一遍）"
            )
            sendPracticeRecord(currentChar?.text ?: "", false, "pronunciation")
        }
    }

    /** 拼音和读音都通过后才记录正确，并通知服务端 */
    private fun checkBothPassed() {
        val s = _state.value
        val char = currentChar?.text ?: ""
        if (s.pinyinPassed && s.pronunciationPassed) {
            val result = QuestionResult(char = char, isCorrect = true,
                errorCount = s.pinyinErrorCount, usedHint = s.showHint)
            _state.value = s.copy(results = s.results + result, message = "✅ 全部正确！")
            sendPracticeRecord(char, true, "pinyin")
            sendPracticeRecord(char, true, "pronunciation")
        } else if (s.pinyinPassed) {
            _state.value = s.copy(message = "拼音正确 ✓ 还需要读音达标")
        } else if (s.pronunciationPassed) {
            _state.value = s.copy(message = "读音达标 ✓ 还需要填对拼音")
        }
    }


    /** 向服务端发送练习记录（type: "pinyin" / "pronunciation"） */
    private fun sendPracticeRecord(char: String, correct: Boolean, type: String = "pinyin") {
        viewModelScope.launch {
            try {
                val body = JSONObject().apply {
                    put("char", char)
                    put("correct", correct)
                    put("type", type)
                }
                val req = Request.Builder()
                    .url("${serverBase()}/api/v1/practice/char-record")
                    .post(body.toString().toRequestBody(JSON_MEDIA))
                    .build()
                withContext(Dispatchers.IO) { apiClient.newCall(req).execute() }
            } catch (_: Exception) {
                _state.value = _state.value.copy(recordSyncFailed = true)
                Log.w(TAG, "练习记录同步失败（断网）")
            }
        }
    }

    fun showHint() {
        val char = currentChar ?: return
        if (!_state.value.hintActivated) return
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            try {
                val body = JSONObject().apply { put("char", char.text) }
                val req = Request.Builder()
                    .url("${serverBase()}/api/v1/llm/word-suggestions")
                    .post(body.toString().toRequestBody(JSON_MEDIA))
                    .build()
                val resp = withContext(Dispatchers.IO) { apiClient.newCall(req).execute() }
                val json = JSONObject(resp.body?.string() ?: "{}")
                val wordsArr = json.optJSONArray("words")
                val words = if (wordsArr != null) {
                    (0 until wordsArr.length()).map { wordsArr.optString(it, "") }.filter { it.isNotEmpty() }
                } else emptyList()
                _state.value = _state.value.copy(
                    showHint = true,
                    hintContent = HintContent(words = words),
                    loading = false
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, message = "获取提示失败: ${e.message ?: "未知错误"}")
            }
        }
    }

    /** 下一题 — 只有两项都通过才能进入 */
    fun nextQuestion() {
        val s = _state.value
        if (!s.pinyinPassed || !s.pronunciationPassed) {
            _state.value = s.copy(message = "需要拼音正确 + 读音达标才能进入下一题")
            return
        }
        val nextIndex = s.currentIndex + 1
        if (nextIndex >= s.items.size) {
            _state.value = s.copy(finished = true)
        } else {
            val nextChar = s.items.getOrNull(nextIndex)?.text ?: ""
            val ctx = if (polyphoneMap.containsKey(nextChar)) {
                val info = polyphoneMap[nextChar]
                val word = info?.words?.get(info.primary)?.firstOrNull()
                    ?: info?.words?.values?.firstOrNull()?.firstOrNull() ?: ""
                word
            } else ""
            _state.value = RecognitionUiState(items = s.items, currentIndex = nextIndex, wordContext = ctx,
                recordSyncFailed = _state.value.recordSyncFailed)
            updateTtsHint()
            val numChinese = listOf("一","二","三","四","五","六","七","八","九","十",
                "十一","十二","十三","十四","十五","十六","十七","十八","十九","二十")
            playTts("第${numChinese.getOrElse(nextIndex) { "${nextIndex+1}" }}题")
        }
    }

    /** 重试 — 清零拼音输入 */
    fun retry() {
        _state.value = _state.value.copy(
            userInitial = "", userMedial = "", userFinal = "", userTone = 0,
            pinyinPassed = false, pronunciationPassed = false
        )
    }

    /** 开始语音评测录音 */
    fun startVoiceEvaluation() {
        val char = currentChar ?: return
        _state.value = _state.value.copy(isRecording = true, message = "录音中...")
        viewModelScope.launch {
            try {
                val word = com.example.ai.data.model.Word(
                    text = char.text, ipa = "", letter = "", phonemes = emptyList())
                val result = speechRepository.startStreamingEvaluation(word)
                onPronunciationResult(result.totalScore)
                _state.value = _state.value.copy(isRecording = false)
            } catch (e: Exception) {
                Log.e(TAG, "语音评测失败: ${e.message}")
                _state.value = _state.value.copy(isRecording = false, message = "评测失败: ${e.message ?: "未知错误"}")
            }
        }
    }

    fun stopVoiceEvaluation() { speechRepository.stopStreamingEvaluation() }
}
