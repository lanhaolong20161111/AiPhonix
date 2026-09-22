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
import com.example.ai.data.aihomework.QuestionItem
import com.example.ai.data.aihomework.QuestHistoryItem
import com.example.ai.data.aihomework.QuestReport
import com.example.ai.data.aihomework.QuestSessionSummary
import com.example.ai.data.aihomework.QuestStepData
import com.example.ai.data.aihomework.SolutionStep
import com.example.ai.data.aihistory.AiHistoryItem
import com.example.ai.data.aihistory.AiHistoryStore
import com.example.ai.data.tts.BaiduTtsCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

data class AiHomeworkUiState(
    val inputText: String = "",
    val recognizedQuestions: List<String> = emptyList(), // 拍照识别出的全部题目（多题时供选择）
    val hasCachedImage: Boolean = false, // 是否已有可重新识别的图片（用于强制重识按钮）
    val imageBytes: ByteArray? = null, // 原题照片字节（解析页顶部展示整张原图，点击放大）
    val parsingImage: Boolean = false,
    val analyzing: Boolean = false,
    val analyzeResult: AnalyzeResult? = null,
    val solutionSteps: List<SolutionStep> = emptyList(),   // 完整解题步骤（大模型分步生成，显示解题线段图）
    val loadingSteps: Boolean = false,
    val saving: Boolean = false,
    val saved: Boolean = false,
    val isSpeaking: Boolean = false,
    val speakingChar: String? = null, // 正在朗读的单字（逐字点读高亮）
    val isMicRecording: Boolean = false, // 是否正在麦克风录音（任意一句）
    val micRecordingSentence: String? = null, // 正在录音的句子
    val recordedSentences: Set<String> = emptySet(), // 已有录音的句子（本会话已上传）
    val error: String = "",

    // 知识库问答（提问框）
    val kbQuestion: String = "",
    val askingKb: Boolean = false,
    val kbAnswer: String = "",

    // 闯关：大模型现场生成分步引导
    val questStarted: Boolean = false,
    val questLoading: Boolean = false, // 开始生成计划中
    val questAnswering: Boolean = false, // 作答判断中
    val questSessionId: Int = 0,
    val questSteps: List<QuestStepData> = emptyList(),
    val questCurrentIndex: Int = 0,
    val questTotal: Int = 0,
    val questAnswered: Boolean = false, // 当前步已作答（显示反馈）
    val questCorrect: Boolean = false, // 上次作答对错
    val questFeedback: String = "", // 答对表扬 / 答错引导
    val questConceptExplain: String = "", // concept 讲解
    val questSubQuestion: QuestStepData? = null, // 答错降解出的简化子问题
    val questSubBackToOriginal: Boolean = false, // 子问题答对 → 提示回到原题
    val questDone: Boolean = false,
    val questHistory: List<QuestHistoryItem> = emptyList(), // 会话记录（回溯用）
    val questShowHistory: Boolean = false, // 是否显示记录面板
    val questHistoryLoading: Boolean = false,
    val questReplayHint: String = "", // 回溯后的提示（"回到这里重做"）
    val questResumable: List<QuestSessionSummary> = emptyList(), // 可续闯会话
    val questLoadingResumable: Boolean = false,
    val questReport: QuestReport? = null, // 掌握报告
    val questReportLoading: Boolean = false,
    val questCurrentStep: QuestStepData? = null, // 当前步（continue/replay 时优先于 steps）
    val questRetrying: Boolean = false, // 错题回练中
)

/** AI 作业主页：识题（拍照/相册/手动输入）→ 解析关键信息 → 保存并进入练习 */
class AiHomeworkViewModel(
    private val repository: AiHomeworkRepository = AiHomeworkRepository(),
    private val historyStore: AiHistoryStore? = null,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiHomeworkUiState())
    val uiState: StateFlow<AiHomeworkUiState> = _uiState.asStateFlow()

    private var ttsCache: BaiduTtsCache? = null

    /** 朗读同步硬锁：同一时刻只允许一个朗读协程（防重音/防并发） */
    private val speakLock = java.util.concurrent.atomic.AtomicBoolean(false)

    /** 当前朗读协程：页面离开时取消它（阻止分段循环继续播放下一段） */
    private var speakJob: kotlinx.coroutines.Job? = null

    /** 朗读代数：取消旧朗读时自增，旧协程 finally 检查代数不匹配则不复位状态（防替换播放竞态） */
    private var speakEpoch = 0L

    /** 认读画像上报缓冲：逐字点读时批量上报点击次数（满 10 个或页面销毁时 flush） */
    private val pendingCharClicks = mutableListOf<String>()

    private fun queueCharClick(ch: String) {
        synchronized(pendingCharClicks) {
            pendingCharClicks.add(ch)
            if (pendingCharClicks.size >= 10) {
                val batch = pendingCharClicks.toList()
                pendingCharClicks.clear()
                viewModelScope.launch { runCatching { repository.recordCharClicks(batch) } }
            }
        }
    }

    private fun flushCharClicks() {
        val batch = synchronized(pendingCharClicks) {
            if (pendingCharClicks.isEmpty()) return
            val b = pendingCharClicks.toList()
            pendingCharClicks.clear()
            b
        }
        viewModelScope.launch { runCatching { repository.recordCharClicks(batch) } }
    }

    /** 最近一次识别的图片字节（用于"重新识别"：跳过缓存强制重提交） */
    private var lastImageBytes: ByteArray? = null

    private var appContext: Context? = null
    private var recorder: android.media.MediaRecorder? = null
    private var recorderFile: java.io.File? = null

    /** 由 Screen 注入 TTS（识别结果每句朗读） */
    fun initTts(context: Context) {
        if (ttsCache == null) {
            ttsCache = BaiduTtsCache(context.applicationContext)
        }
        appContext = context.applicationContext
    }

    // ── 学生朗读录音（麦克风 → 服务端存储） ──

    /** 点击麦克风：开始录音（再次点击停止并上传）；录音中不可点其他句/喇叭 */
    fun toggleRecord(sentence: String) {
        val st = _uiState.value
        if (st.isSpeaking) return // 喇叭播放中不可录音
        if (st.isMicRecording) {
            if (st.micRecordingSentence == sentence) stopRecordAndUpload(sentence)
            return // 正在录其他句：忽略
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

    /** 朗读单个字/文本（阅读障碍/ADHD 学生逐字点读）。
     *  **替换式播放**：正在播别的字时立即停止并播新的（逐字快速连点不卡顿）；
     *  播放中麦克风/录音按钮仍被 isSpeaking 互斥禁用。
     *  单字点击会上报服务端（认读画像：点击越多 → 越不会认读）。 */
    fun speak(text: String) {
        if (text.isBlank()) return
        if (text.length == 1) {
            queueCharClick(text) // 仅单字（逐字点读）计入学认读画像
        }
        val epoch = ++speakEpoch
        if (!speakLock.compareAndSet(false, true)) {
            // 正在播放：先停旧再播新（逐字连点场景）；旧协程 finally 因代数不匹配不复位
            cancelSpeaking()
            if (!speakLock.compareAndSet(false, true)) return
        }
        _uiState.value = _uiState.value.copy(isSpeaking = true, speakingChar = text) // 同步置位，UI 立即禁用麦克风
        speakJob = viewModelScope.launch(Dispatchers.IO) {
            var failed = false
            try {
                val segments = BaiduTtsCache.splitForTts(text)
                for (seg in segments) {
                    if (ttsCache?.play(seg, "0") != true) { // 下载超时/网络失败
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
                if (epoch == speakEpoch) { // 未被替换/取消：才复位朗读状态
                    _uiState.value = _uiState.value.copy(isSpeaking = false, speakingChar = null)
                    speakLock.set(false)
                }
            }
        }
    }

    /** 立即停止朗读（页面离开/返回/替换播放时调用）：取消协程 + 释放播放器，分段循环不再继续 */
    fun cancelSpeaking() {
        android.util.Log.w("InfoHunterTts", "cancelSpeaking called")
        speakEpoch++ // 使在途协程 finally 不复位（本方法已显式复位）
        speakJob?.cancel()
        speakJob = null
        BaiduTtsCache.stopAll()
        _uiState.value = _uiState.value.copy(isSpeaking = false, speakingChar = null)
        speakLock.set(false)
    }

    // ── 知识库问答（提问框） ──

    fun updateKbQuestion(text: String) {
        _uiState.value = _uiState.value.copy(kbQuestion = text)
    }

    /** 提问：检索知识库 → LLM 综合回答 */
    fun askKb() {
        val q = _uiState.value.kbQuestion.trim()
        if (q.isEmpty() || _uiState.value.askingKb) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(askingKb = true, error = "", kbAnswer = "")
            val r = withContext(Dispatchers.IO) { repository.kbAsk(q) }
            _uiState.value = _uiState.value.copy(
                askingKb = false,
                kbAnswer = if (r.isBlank()) "回答失败，请重试" else r,
            )
        }
    }

    /** 图片字节 → 题目列表（服务端 Ark 多模态优先，自动回退 OCR） */
    fun parseImage(bytes: ByteArray) {        lastImageBytes = bytes
        _uiState.value = _uiState.value.copy(hasCachedImage = true)
        doParseImage(bytes, forceRefresh = false)
    }

    /** 对同一张图强制重新识别（跳过内存缓存与服务端缓存，LLM 重跑并覆盖缓存）。
     *  用于 LLM 偶发识别错/漏题时手动重试。 */
    fun reparseImage() {
        val bytes = lastImageBytes ?: run {
            _uiState.value = _uiState.value.copy(error = "没有可重新识别的图片，请先拍照")
            return
        }
        doParseImage(bytes, forceRefresh = true)
    }

    private fun doParseImage(bytes: ByteArray, forceRefresh: Boolean) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(parsingImage = true, error = "")
            val result = try {
                withContext(Dispatchers.IO) { repository.parseImage(bytes, forceRefresh = forceRefresh) }
            } catch (e: java.io.IOException) {
                _uiState.value = _uiState.value.copy(
                    parsingImage = false,
                    error = "无法连接服务器，请检查网络后重试（${e.message}）",
                )
                return@launch
            }
            _uiState.value = _uiState.value.copy(parsingImage = false)
            val questions = result.questions.filter { it.isNotBlank() }
            if (questions.isEmpty()) {
                _uiState.value = _uiState.value.copy(error = "未能从图片中识别出题目，请换一张更清晰的图")
            } else if (questions.size == 1) {
                // 单题：直接填入并清空旧结果
                _uiState.value = _uiState.value.copy(
                    inputText = questions[0],
                    recognizedQuestions = emptyList(),
                    analyzeResult = null,
                    imageBytes = bytes,
                )
                analyze() // 识别后自动解析，无需再点"解析题目"
            } else {
                // 多题：展示列表，等用户点选一题
                _uiState.value = _uiState.value.copy(
                    recognizedQuestions = questions,
                    inputText = "",
                    analyzeResult = null,
                    imageBytes = bytes,
                )
            }
            // 自动存历史（识别快照，math 桶；对齐 web 结果页自动保存）
            historyStore?.let { store ->
                val snapshotText = result.text.takeIf { it.isNotBlank() }
                    ?: questions.firstOrNull()
                    ?: ""
                if (snapshotText.isNotBlank()) {
                    viewModelScope.launch(Dispatchers.IO) {
                        try {
                            store.add(
                                AiHistoryItem(
                                    module = "math",
                                    text = snapshotText,
                                    questions = questions,
                                    thumb = store.makeThumb(bytes),
                                )
                            )
                        } catch (_: Exception) { }
                    }
                }
            }
        }
    }

    /** 从识别列表中选一道题：填入输入框并自动解析。
     *  保留 recognizedQuestions：从练习页返回时仍能回到"选择一道题"列表，换题练习。 */
    fun selectQuestion(index: Int) {
        val q = _uiState.value.recognizedQuestions.getOrNull(index) ?: return
        _uiState.value = _uiState.value.copy(
            inputText = q,
            analyzeResult = null,
            error = "",
        )
        analyze()
    }

    /** 解析题目：切分句子 + 关键信息标注；问题列表由轻量端点异步补充（不阻塞核心展示）。
     *  @param forceRefresh true = 跳过缓存强制 LLM 重跑（人工模板提交后立即验证） */
    fun analyze(forceRefresh: Boolean = false) {
        val q = _uiState.value.inputText.trim()
        if (q.isEmpty()) {
            _uiState.value = _uiState.value.copy(error = "请先输入或识别题目")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(analyzing = true, error = "")
            val result = withContext(Dispatchers.IO) { repository.analyze(q, forceRefresh = forceRefresh) }
            // 服务端失败/超时会返回空结果（topic/sentences 全空）——显式报错，不显示"0 句话"误导
            if (result.sentences.isEmpty() && result.topic.isEmpty()) {
                _uiState.value = _uiState.value.copy(
                    analyzing = false,
                    error = "解析失败：服务器超时或网络异常，请稍后重试",
                )
                return@launch
            }
            _uiState.value = _uiState.value.copy(analyzing = false, analyzeResult = result)
            // 问题列表异步补充：核心分析先展示，questions 3-5s 后到达
            if (result.questions.isEmpty()) {
                val qs = withContext(Dispatchers.IO) { repository.fetchQuestions(q) }
                val cur = _uiState.value.analyzeResult
                if (cur != null && cur.topic == result.topic && cur.sentences == result.sentences) {
                    _uiState.value = _uiState.value.copy(analyzeResult = cur.copy(questions = qs))
                }
            }
        }
    }

    // ── 保存：原图 + 识别文字 + 解析内容 存到「我的学习」 ──

    /** 保存当前题目：原图 + 识别文字 + 解析内容（不导航）；成功/失败用 saved + 提示 */
    fun save() {
        val q = _uiState.value.inputText.trim()
        if (q.isEmpty()) {
            _uiState.value = _uiState.value.copy(error = "请先输入或识别题目")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(saving = true, error = "")
            val result = withContext(Dispatchers.IO) {
                var r = _uiState.value.analyzeResult
                if (r != null && r.questions.isEmpty()) {
                    val qs = repository.fetchQuestions(q)
                    r = r.copy(questions = qs)
                    _uiState.value = _uiState.value.copy(analyzeResult = r)
                }
                r
            }
            val payload = payloadJsonOf(result, q)
            val ok = withContext(Dispatchers.IO) {
                repository.saveProblemWithImage(q, payload, _uiState.value.imageBytes)
            }
            _uiState.value = _uiState.value.copy(saving = false, saved = ok)
            if (!ok) {
                _uiState.value = _uiState.value.copy(error = "保存失败，请检查网络后重试")
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = "")
    }

    /** 保存成功提示已消费 */
    fun clearSaved() {
        if (_uiState.value.saved) {
            _uiState.value = _uiState.value.copy(saved = false)
        }
    }

    // ── 闯关：LLM 现场生成分步引导 ──

    /** 开始闯关：生成计划并展示第 1 步 */
    fun startQuest() {
        val q = _uiState.value.inputText.trim()
        if (q.isEmpty()) {
            _uiState.value = _uiState.value.copy(error = "请先输入或识别题目")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(questLoading = true, error = "")
            val result = withContext(Dispatchers.IO) { repository.startQuest(q) }
            if (result.sessionId == 0 || result.steps.isEmpty()) {
                _uiState.value = _uiState.value.copy(questLoading = false, error = "闯关计划生成失败，请重试")
                return@launch
            }
            _uiState.value = _uiState.value.copy(
                questLoading = false,
                questStarted = true,
                questSessionId = result.sessionId,
                questSteps = result.steps,
                questCurrentIndex = 0,
                questTotal = result.totalSteps,
                questAnswered = false,
                questCorrect = false,
                questFeedback = "",
                questConceptExplain = "",
                questSubQuestion = null,
                questSubBackToOriginal = false,
                questDone = false,
            )
        }
    }

    /** 当前闯关步骤（continue/replay 的当前步优先，否则用计划列表） */
    fun currentQuestStep(): QuestStepData? =
        _uiState.value.questCurrentStep ?: _uiState.value.questSteps.getOrNull(_uiState.value.questCurrentIndex)

    /** 提交当前步作答 */
    fun answerQuest(answerIndex: Int) {
        val st = _uiState.value
        val sessionId = st.questSessionId
        if (sessionId == 0 || st.questAnswering) return
        viewModelScope.launch {
            _uiState.value = st.copy(questAnswering = true)
            val r = withContext(Dispatchers.IO) { repository.answerQuest(sessionId, answerIndex) }
            val base = _uiState.value
            _uiState.value = base.copy(
                questAnswering = false,
                questAnswered = true,
                questCorrect = r.correct,
                questFeedback = r.feedback,
                questConceptExplain = r.conceptExplain,
                questSubQuestion = r.subQuestion,
                questSubBackToOriginal = r.subBackToOriginal,
                questDone = r.done,
                questTotal = r.totalSteps,
                // 服务端已推进（答对）：跳到下一步下标
                questCurrentIndex = if (r.done) base.questCurrentIndex else r.currentStep,
            )
        }
    }

    /** 进入下一步（答对后）：清反馈显示新步骤；已完成则保持不变 */
    fun nextQuestStep() {
        val st = _uiState.value
        if (st.questDone) return
        _uiState.value = st.copy(
            questAnswered = false,
            questCorrect = false,
            questFeedback = "",
            questConceptExplain = "",
            questSubQuestion = null,
            questSubBackToOriginal = false,
        )
    }

    /** 回到原题重新作答（子问题答对 / 答错重试）：清反馈回到选择状态 */
    fun retryQuestStep() {
        val st = _uiState.value
        _uiState.value = st.copy(
            questAnswered = false,
            questCorrect = false,
            questFeedback = "",
            questConceptExplain = "",
            questSubQuestion = null,
            questSubBackToOriginal = false,
        )
    }

    /** 关闭闯关面板（保留会话，可下次继续？简化：直接重置） */
    fun closeQuest() {
        _uiState.value = _uiState.value.copy(
            questStarted = false,
            questSessionId = 0,
            questSteps = emptyList(),
            questCurrentIndex = 0,
            questAnswered = false,
            questDone = false,
            questFeedback = "",
            questConceptExplain = "",
            questSubQuestion = null,
            questSubBackToOriginal = false,
            questHistory = emptyList(),
            questShowHistory = false,
            questReplayHint = "",
        )
    }

    // ── 会话记录 + 回溯 ──

    /** 加载闯关记录（含对错与回溯点） */
    fun loadQuestHistory() {
        val sid = _uiState.value.questSessionId
        if (sid == 0) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(questHistoryLoading = true, questShowHistory = true)
            val items = withContext(Dispatchers.IO) { repository.fetchQuestHistory(sid) }
            _uiState.value = _uiState.value.copy(questHistoryLoading = false, questHistory = items)
        }
    }

    fun toggleQuestHistory() {
        if (_uiState.value.questShowHistory) {
            _uiState.value = _uiState.value.copy(questShowHistory = false)
        } else {
            loadQuestHistory()
        }
    }

    /** 回溯到选错时刻重做：恢复到该步并展示问题让学生重新选择 */
    fun replayQuest(checkpointId: String) {
        val sid = _uiState.value.questSessionId
        if (sid == 0) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(questAnswering = true)
            val r = withContext(Dispatchers.IO) { repository.replayQuest(sid, checkpointId) }
            _uiState.value = _uiState.value.copy(
                questAnswering = false,
                questCurrentIndex = r.currentStep,
                questAnswered = false, // 回到选择状态
                questCorrect = false,
                questFeedback = "",
                questConceptExplain = "",
                questSubQuestion = null,
                questSubBackToOriginal = false,
                questDone = false,
                questReplayHint = r.feedback,
                questShowHistory = false,
            )
        }
    }

    /** 回溯提示已展示 */
    fun clearQuestReplayHint() {
        if (_uiState.value.questReplayHint.isNotEmpty()) {
            _uiState.value = _uiState.value.copy(questReplayHint = "")
        }
    }

    // ── 续闯 / 错题回练 / 掌握报告 ──

    /** 加载可续闯的会话列表 */
    fun loadResumableSessions() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(questLoadingResumable = true)
            val items = withContext(Dispatchers.IO) { repository.fetchResumableSessions() }
            _uiState.value = _uiState.value.copy(questLoadingResumable = false, questResumable = items)
        }
    }

    /** 继续上次闯关：恢复到该会话当前步 */
    fun continueQuest(sessionId: Int) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(questLoading = true, error = "")
            val r = withContext(Dispatchers.IO) { repository.continueQuest(sessionId) }
            if (r.done) {
                _uiState.value = _uiState.value.copy(questLoading = false, error = "这个闯关已经完成")
                loadResumableSessions()
                return@launch
            }
            _uiState.value = _uiState.value.copy(
                questLoading = false,
                questStarted = true,
                questSessionId = sessionId,
                questSteps = listOfNotNull(r.nextStep),
                questCurrentIndex = r.currentStep,
                questCurrentStep = r.nextStep,
                questTotal = r.totalSteps,
                questAnswered = false,
                questFeedback = r.feedback,
                questSubQuestion = null,
                questSubBackToOriginal = false,
                questDone = false,
            )
        }
    }

    /** 错题回练：答错步骤生成新线程 */
    fun retryErrorsQuest() {
        val sid = _uiState.value.questSessionId
        if (sid == 0 || _uiState.value.questRetrying) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(questRetrying = true, error = "")
            val r = withContext(Dispatchers.IO) { repository.retryErrorsQuest(sid) }
            _uiState.value = _uiState.value.copy(questRetrying = false)
            if (r.sessionId == 0 || r.steps.isEmpty()) {
                _uiState.value = _uiState.value.copy(error = "没有需要回练的错题")
                return@launch
            }
            _uiState.value = _uiState.value.copy(
                questSessionId = r.sessionId,
                questSteps = r.steps,
                questCurrentIndex = 0,
                questCurrentStep = null,
                questTotal = r.totalSteps,
                questAnswered = false,
                questFeedback = "🔁 错题回练：重新做一次之前答错的步骤",
                questSubQuestion = null,
                questSubBackToOriginal = false,
                questDone = false,
                questHistory = emptyList(),
                questShowHistory = false,
                questReport = null,
            )
        }
    }

    /** 加载掌握报告 */
    fun loadQuestReport() {
        val sid = _uiState.value.questSessionId
        if (sid == 0) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(questReportLoading = true)
            val rep = withContext(Dispatchers.IO) { repository.fetchQuestReport(sid) }
            _uiState.value = _uiState.value.copy(questReportLoading = false, questReport = rep)
        }
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

    companion object {
        /** AnalyzeResult → 服务端 payload JSON（无标注时也输出结构，练习页可本地切分） */
        fun payloadJsonOf(result: AnalyzeResult?, question: String): String {
            val sentences = JSONArray()
            if (result != null && result.sentences.isNotEmpty()) {
                result.sentences.forEach { s ->
                    sentences.put(JSONObject().apply {
                        put("text", s.text)
                        put("is_key", s.isKey)
                        put("highlight", s.highlight)
                    })
                }
            } else {
                // 无标注：本地按标点切分，练习页提示时再调 analyze
                question.split(Regex("(?<=[。！？；;，])")).filter { it.isNotBlank() }.forEach {
                    sentences.put(JSONObject().apply {
                        put("text", it.trim())
                        put("is_key", false)
                        put("highlight", "")
                    })
                }
            }
            // 线段图数据（LLM 提取的数量关系，可能为空）
            val quantities = JSONArray()
            result?.quantities?.forEach { q ->
                quantities.put(JSONObject().apply {
                    put("name", q.name)
                    if (q.value != null) put("value", q.value) else put("value", JSONObject.NULL)
                    put("unit", q.unit)
                })
            }
            val relations = JSONArray()
            result?.relations?.forEach { r ->
                relations.put(JSONObject().apply {
                    put("a", r.a)
                    put("b", r.b)
                    put("type", r.type)
                    put("amount", r.amount)
                })
            }
            // 题目里的所有问题（面向问题倒推：原文/目标量/依赖量/求解方向）
            val questions = JSONArray()
            result?.questions?.forEach { q ->
                questions.put(JSONObject().apply {
                    put("text", q.text)
                    put("target", q.target)
                    val needs = JSONArray()
                    q.needs.forEach { needs.put(it) }
                    put("needs", needs)
                    put("hint", q.hint)
                })
            }
            return JSONObject().apply {
                put("topic", result?.topic ?: "数学")
                put("sentences", sentences)
                put("total_key_points", result?.totalKeyPoints ?: 0)
                put("quantities", quantities)
                put("relations", relations)
                put("questions", questions)
            }.toString()
        }
    }

    /** 页面销毁（返回键退出）时立即停止正在播放的 TTS 声音 + flush 未上报的字点击 */
    override fun onCleared() {
        cancelSpeaking()
        flushCharClicks()
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
}
