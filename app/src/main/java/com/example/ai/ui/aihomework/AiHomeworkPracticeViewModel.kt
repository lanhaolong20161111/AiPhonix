package com.example.ai.ui.aihomework

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aihomework.AiHomeworkRepository
import com.example.ai.data.aihomework.AnalyzeResult
import com.example.ai.data.aihomework.AutoBuildResult
import com.example.ai.data.aihomework.BlockSuggestion
import com.example.ai.data.aihomework.BuildBlockItem
import com.example.ai.data.aihomework.BuildReviewResult
import com.example.ai.data.aihomework.EvaluateResult
import com.example.ai.data.aihomework.QuantityItem
import com.example.ai.data.aihomework.QuantityRelation
import com.example.ai.data.aihomework.QuestionItem
import com.example.ai.data.aihomework.SentenceInfo
import com.example.ai.data.aihomework.SolutionStep
import com.example.ai.data.tts.BaiduTtsCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

data class AiHomeworkPracticeUiState(
    val sentences: List<SentenceInfo> = emptyList(),
    val quantities: List<QuantityItem> = emptyList(),      // 线段图实体（来自 payload）
    val relations: List<QuantityRelation> = emptyList(),   // 线段图关系（来自 payload）
    val questions: List<QuestionItem> = emptyList(),       // 题目里的所有问题（来自 payload；可能为空）
    val solutionSteps: List<SolutionStep> = emptyList(),   // 分步解题链（倒推挑战幕后数据；进入引导时加载）
    val loadingSteps: Boolean = false,
    val topic: String = "数学",
    val showHints: Boolean = false,
    val isSpeaking: Boolean = false,
    val speakingChar: String? = null, // 正在朗读的单字（逐字点读高亮）
    val isMicRecording: Boolean = false, // 句子麦克风录音中
    val micRecordingSentence: String? = null,
    val recordedSentences: Set<String> = emptySet(), // 已有录音的句子
    val answer: String = "",
    val evaluating: Boolean = false,
    val result: EvaluateResult? = null,
    val loading: Boolean = false,
    val error: String = "",
)

/**
 * 数学应用题练习页：分句朗读 → 提示关键信息 → 输入思路（可输入法语音） → 提交评判。
 * 数学应用题练习页：分句朗读 → 提示关键信息 → 输入思路（可输入法语音） → 提交评判。
 */
class AiHomeworkPracticeViewModel(
    private val question: String,
    private val payloadJson: String,
    private val repository: AiHomeworkRepository = AiHomeworkRepository(),
) : ViewModel() {

    /** 题目原文（搭积木提交审核用） */
    val questionText: String get() = question

    private val _uiState = MutableStateFlow(AiHomeworkPracticeUiState(loading = payloadJson.isBlank()))
    val uiState: StateFlow<AiHomeworkPracticeUiState> = _uiState.asStateFlow()

    private var ttsCache: BaiduTtsCache? = null

    /** 朗读同步硬锁：同一时刻只允许一个朗读协程（防重音/防并发） */
    private val speakLock = java.util.concurrent.atomic.AtomicBoolean(false)

    /** 当前朗读协程：页面离开时取消它（阻止分段循环继续播放下一段） */
    private var speakJob: kotlinx.coroutines.Job? = null

    /** 朗读代数：取消旧朗读时自增，旧协程 finally 检查代数不匹配则不复位状态（防替换播放竞态） */
    private var speakEpoch = 0L

    init {
        val data = parsePayload(payloadJson)
        if (data.sentences.isNotEmpty()) {
            _uiState.value = _uiState.value.copy(
                sentences = data.sentences,
                quantities = data.quantities,
                relations = data.relations,
                questions = data.questions,
                loading = false,
            )
        } else {
            loadAnalyze()
        }
        // 进入页面即加载完整解题步骤（显示解题线段图；倒推挑战复用同一份）
        loadSteps(question, "")
    }

    /** 由 Screen 注入 TTS（中文 speaker=0） */
    fun initTts(context: Context) {
        if (ttsCache == null) {
            ttsCache = BaiduTtsCache(context.applicationContext)
        }
        appContext = context.applicationContext
    }

    private var appContext: Context? = null
    private var recorder: android.media.MediaRecorder? = null
    private var recorderFile: java.io.File? = null

    // ── 学生朗读录音（麦克风 → 服务端存储） ──

    /** 点击麦克风：开始录音（再次点击停止并上传）；喇叭播放中不可用 */
    fun toggleRecord(sentence: String) {
        val st = _uiState.value
        if (st.isSpeaking) return // 播放中不可用
        if (st.isMicRecording) {
            if (st.micRecordingSentence == sentence) stopRecordAndUpload(sentence)
            return
        }
        val ctx = appContext ?: return
        val file = java.io.File(ctx.cacheDir, "sentence_rec_${System.currentTimeMillis()}.m4a")
        try {
            val r = android.media.MediaRecorder()
            r.setAudioSource(android.media.MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC)
            r.setOutputFile(file.absolutePath)
            r.prepare()
            r.start()
            recorder = r
            recorderFile = file
            _uiState.value = st.copy(isMicRecording = true, micRecordingSentence = sentence)
        } catch (e: Exception) {
            _uiState.value = st.copy(error = "录音启动失败: ${e.message}")
        }
    }

    private fun stopRecordAndUpload(sentence: String) {
        val st = _uiState.value
        try {
            recorder?.stop()
        } catch (_: Exception) {
        }
        try {
            recorder?.release()
        } catch (_: Exception) {
        }
        recorder = null
        val file = recorderFile
        recorderFile = null
        _uiState.value = st.copy(isMicRecording = false, micRecordingSentence = null)
        val f = file ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val ok = repository.uploadSentenceAudio(sentence, f)
            f.delete()
            _uiState.value = if (ok) {
                _uiState.value.copy(recordedSentences = _uiState.value.recordedSentences + sentence)
            } else {
                _uiState.value.copy(error = "录音上传失败，请检查网络后重试")
            }
        }
    }

    /** 播放学生自己的录音（流式，带认证头；与喇叭/麦克风互斥） */
    fun playSentenceAudio(sentence: String) {
        if (_uiState.value.isMicRecording || !speakLock.compareAndSet(false, true)) return
        _uiState.value = _uiState.value.copy(isSpeaking = true)
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val token = com.example.ai.data.auth.TokenManager.accessToken.orEmpty()
                ttsCache?.playRemote(
                    repository.sentenceAudioUrl(sentence),
                    headers = if (token.isNotBlank()) mapOf("Authorization" to "Bearer $token") else emptyMap(),
                    onError = { msg ->
                        _uiState.value = _uiState.value.copy(error = "播放录音失败：$msg")
                    },
                )
            } finally {
                _uiState.value = _uiState.value.copy(isSpeaking = false)
                speakLock.set(false)
            }
        }
    }

    /** 朗读单个字/文本（逐字点读，替换式播放：连点立即切到新字；播放中不设超时） */
    fun speak(text: String) {
        if (text.isBlank()) return
        val epoch = ++speakEpoch
        if (!speakLock.compareAndSet(false, true)) {
            cancelSpeaking()
            if (!speakLock.compareAndSet(false, true)) return
        }
        _uiState.value = _uiState.value.copy(isSpeaking = true, speakingChar = text)
        speakJob = viewModelScope.launch(Dispatchers.IO) {
            var failed = false
            try {
                val segments = BaiduTtsCache.splitForTts(text)
                for (seg in segments) {
                    if (ttsCache?.play(seg, "0") != true) {
                        failed = true
                        break
                    }
                }
                if (failed) {
                    _uiState.value = _uiState.value.copy(error = "朗读失败：网络或服务器异常，请检查后重试")
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = "朗读失败: ${e.message}")
            } finally {
                if (epoch == speakEpoch) {
                    _uiState.value = _uiState.value.copy(isSpeaking = false, speakingChar = null)
                    speakLock.set(false)
                }
            }
        }
    }

    /** 立即停止朗读（页面离开/返回时调用）：取消协程 + 释放播放器，分段循环不再继续 */
    fun cancelSpeaking() {
        android.util.Log.w("InfoHunterTts", "cancelSpeaking called")
        speakEpoch++
        speakJob?.cancel()
        speakJob = null
        BaiduTtsCache.stopAll()
        _uiState.value = _uiState.value.copy(isSpeaking = false, speakingChar = null)
        speakLock.set(false)
    }

    /** 显示/隐藏关键信息提示 */
    fun toggleHints() {
        _uiState.value = _uiState.value.copy(showHints = !_uiState.value.showHints)
    }

    fun updateAnswer(text: String) {
        _uiState.value = _uiState.value.copy(answer = text)
    }

    /** 提交思路给大模型评判 */
    fun submitAnswer() {
        val answer = _uiState.value.answer.trim()
        if (answer.isEmpty()) {
            _uiState.value = _uiState.value.copy(error = "请先说出或输入你的思路")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(evaluating = true, error = "")
            try {
                val result = withContext(Dispatchers.IO) { repository.evaluate(question, answer) }
                _uiState.value = _uiState.value.copy(result = result)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = "提交失败，请检查网络后重试: ${e.message}")
            } finally {
                _uiState.value = _uiState.value.copy(evaluating = false)
            }
        }
    }

    /** 重新做一遍（清空结果与思路） */
    fun reset() {
        _uiState.value = _uiState.value.copy(answer = "", result = null, showHints = false, error = "")
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = "")
    }

    /** 搭积木：动态积木建议（按题目生成 LLM 专用积木；失败返回空，只用内置积木） */
    suspend fun blockSuggestions(question: String): List<BlockSuggestion> =
        withContext(Dispatchers.IO) { repository.fetchBlockSuggestions(question) }

    /** 搭积木：提交画布积木图给 LLM 审核（返回 null 表示网络失败） */
    suspend fun submitBuildReview(question: String, blocks: List<BuildBlockItem>): BuildReviewResult? =
        withContext(Dispatchers.IO) { repository.submitBuildReview(question, blocks) }

    /** 搭积木：LLM 提取线段图初始搭建指令（已知/未知量 + 关系 + 差值 + 大括号） */
    suspend fun autoBuild(question: String): AutoBuildResult? =
        withContext(Dispatchers.IO) { repository.fetchAutoBuild(question) }

    /** 显示错误提示（如权限被拒） */
    fun showError(message: String) {
        _uiState.value = _uiState.value.copy(error = message)
    }

    /** 加载分步解题链（进入倒推挑战时调用；幂等：已加载/加载中跳过） */
    fun loadSteps(question: String, target: String) {
        if (_uiState.value.solutionSteps.isNotEmpty() || _uiState.value.loadingSteps) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loadingSteps = true)
            val steps = try {
                withContext(Dispatchers.IO) { repository.fetchSteps(question, target) }
            } catch (e: Exception) {
                emptyList()  // 失败回退 hint 模式
            }
            _uiState.value = _uiState.value.copy(solutionSteps = steps, loadingSteps = false)
        }
    }

    /** 按问题下标加载分步解题链（Screen 在进入引导时调用） */
    fun loadStepsForQuestion(index: Int) {
        val qs = _uiState.value.questions
        if (index !in qs.indices) return
        loadSteps(question, qs[index].target)
    }

    private fun loadAnalyze() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true)
            try {
                val result = withContext(Dispatchers.IO) { repository.analyze(question) }
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    sentences = result.sentences,
                    quantities = result.quantities,
                    relations = result.relations,
                    questions = result.questions,
                    topic = result.topic.ifBlank { "数学" },
                    error = if (result.sentences.isEmpty()) "题目解析失败，请稍后重试" else "",
                )
                // 问题列表异步补充（analyze 只做核心，questions 轻量调用 3-5s 后补）
                if (result.questions.isEmpty()) {
                    val qs = withContext(Dispatchers.IO) { repository.fetchQuestions(question) }
                    if (qs.isNotEmpty()) {
                        _uiState.value = _uiState.value.copy(questions = qs)
                    }
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    error = "题目解析失败，请检查网络后重试",
                )
            }
        }
    }

    override fun onCleared() {
        BaiduTtsCache.stopAll() // 停止正在播放的 TTS 声音
        try {
            recorder?.stop()
        } catch (_: Exception) {
        }
        try {
            recorder?.release()
        } catch (_: Exception) {
        }
        recorder = null
        super.onCleared()
    }

    companion object {
        /** payload 解析结果：句子 + 线段图数据 + 问题列表 */
        data class PayloadData(
            val sentences: List<SentenceInfo>,
            val quantities: List<QuantityItem>,
            val relations: List<QuantityRelation>,
            val questions: List<QuestionItem>,
        )

        /** payload JSON → PayloadData；结构不符时返回空，触发懒加载 analyze */
        fun parsePayload(payloadJson: String): PayloadData {
            if (payloadJson.isBlank()) return PayloadData(emptyList(), emptyList(), emptyList(), emptyList())
            return try {
                val obj = JSONObject(payloadJson)
                val arr = obj.optJSONArray("sentences") ?: return PayloadData(emptyList(), emptyList(), emptyList(), emptyList())
                val sentences = (0 until arr.length()).mapNotNull { i ->
                    val o = arr.optJSONObject(i) ?: return@mapNotNull null
                    val text = o.optString("text", "").trim()
                    if (text.isEmpty()) null
                    else SentenceInfo(
                        text = text,
                        isKey = o.optBoolean("is_key", false),
                        highlight = o.optString("highlight", ""),
                    )
                }
                val quantities = buildList {
                    val qarr = obj.optJSONArray("quantities") ?: JSONArray()
                    for (i in 0 until qarr.length()) {
                        val o = qarr.optJSONObject(i) ?: continue
                        val name = o.optString("name", "").trim()
                        if (name.isEmpty()) continue
                        val value = if (o.isNull("value")) null else o.optDouble("value", Double.NaN)
                        if (value != null && value.isNaN()) continue
                        add(QuantityItem(name = name, value = value?.toFloat(), unit = o.optString("unit", "")))
                    }
                }
                val relations = buildList {
                    val rarr = obj.optJSONArray("relations") ?: JSONArray()
                    for (i in 0 until rarr.length()) {
                        val o = rarr.optJSONObject(i) ?: continue
                        val a = o.optString("a", "").trim()
                        val b = o.optString("b", "").trim()
                        val type = o.optString("type", "")
                        if (a.isEmpty() || b.isEmpty() || type !in setOf("more", "less", "times")) continue
                        add(QuantityRelation(a = a, b = b, type = type, amount = o.optDouble("amount", 0.0).toFloat()))
                    }
                }
                val questions = buildList {
                    val qarr = obj.optJSONArray("questions") ?: JSONArray()
                    for (i in 0 until qarr.length()) {
                        val o = qarr.optJSONObject(i) ?: continue
                        val text = o.optString("text", "").trim()
                        if (text.isEmpty()) continue
                        val needs = buildList {
                            val narr = o.optJSONArray("needs") ?: JSONArray()
                            for (j in 0 until narr.length()) {
                                val n = narr.optString(j, "").trim()
                                if (n.isNotEmpty()) add(n)
                            }
                        }
                        add(QuestionItem(
                            text = text,
                            target = o.optString("target", "").trim(),
                            needs = needs,
                            hint = o.optString("hint", "").trim(),
                        ))
                    }
                }
                PayloadData(sentences, quantities, relations, questions)
            } catch (e: Exception) {
                PayloadData(emptyList(), emptyList(), emptyList(), emptyList())
            }
        }
    }
}
