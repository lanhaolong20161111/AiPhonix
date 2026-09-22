package com.example.ai.ui.englishtalk

import android.util.Base64
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.asr.AsrRepository
import com.example.ai.data.audio.AudioRecorder
import com.example.ai.data.dailyen.DailyEnRepository
import com.example.ai.data.englishtalk.DialogueLine
import com.example.ai.data.englishtalk.DialogueScript
import com.example.ai.data.englishtalk.EnglishTalkRepository
import com.example.ai.data.speech.ScoreClient
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.di.NetworkModule
import com.example.ai.ui.echo.EchoLadderState
import com.example.ai.ui.echo.LadderView
import com.example.ai.util.ENGINE_EN
import com.example.ai.util.evalModeForScene
import com.example.ai.util.englishOnly
import com.example.ai.util.fallbackChunks
import com.example.ai.util.parsePracticeSentences
import com.example.ai.util.parsePracticeWords
import com.example.ai.util.splitEnWords
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap

/** 回答模式：`ECHO` = AI 直接给回答并逐词跟读（**默认主线**）；`FREE` = 孩子自己说 */
enum class TalkAnswerMode { ECHO, FREE }

/** 阶段（自由模式的录音/朗读状态机；跟读模式的阶梯自带状态） */
enum class TalkPhase { IDLE, RECORDING, JUDGING, READING }

/** 一次整句判定结果 */
data class TalkFeedback(
    val ok: Boolean = false,
    val praise: String = "",
    /** 不通过时是期望句原文；通过为空 */
    val correct: String = "",
    val said: String = "",
)

/** 阶梯用途：跟读模式的本轮目标句 vs 自由模式错句修复 */
private enum class LadderRole { ECHO_TARGET, CORRECT_FIX }

/**
 * AI 英语对话陪练（对齐 web `pages/AiEnglishTalkPage.tsx`）。
 *
 * 链路：设置词/句 → `/llm/en-dialogue-setup` 生成 3~5 轮剧情（每轮：AI 台词 + 孩子目标句 + 提示词）
 * → 逐轮练习。每轮先**中英连读** AI 台词，再练孩子该说的那句。
 *
 * **两种回答模式**（与 web 一致，默认跟读）：
 * 1. [TalkAnswerMode.ECHO]（默认主线）—— AI 直接给出这一轮该说的回答（显示 + 中文翻译 + 领读），
 *    孩子**照着跟读**，用 [EchoLadderState] 逐词扩长（第 1 遍读第 1 个词 → … → 整句），
 *    每级 ≥70 分过关。全程不碰麦克风以外的识别（只有 SOE 评测）。
 * 2. [TalkAnswerMode.FREE]（可选旧流程）—— 孩子自己说，录完一次上传**短语音识别**
 *    （`/asr/short`）→ `/llm/en-answer-judge` 判定 → 通过给表扬、不通过给正确句 + 可展开意群阶梯。
 *
 * 朗读口径：**中英连读**（[speakPair]）——英文读完紧接着读这句的中文翻译，
 * 翻译与英文朗读**并发**取，故总等待 ≈ max(英文时长, 翻译时长) + 中文时长。
 *
 * ⚠️ 与 web 的三处**有意差异**（详见 `docs/ANDROID_PARITY_PLAN.md`）：
 * - 自由模式**没有 WebSocket 流式 ASR**（Android 侧没有流式通道）⇒ 无实时中间文本、
 *   无「停顿 2s 逐词提示」、无「6 秒静音自动挂阶梯」；改为「录完一次 → 识别 → 判定」。
 * - 因此「提示记录」面板不存在（它只由逐词提示产生）。
 * - 「📷 拍照识词」需要整页 OCR，属「字幕采集」范畴，暂缺（与每日语文/英语同一处缺口）。
 */
class EnglishTalkViewModel(
    private val talkRepository: EnglishTalkRepository = EnglishTalkRepository(),
    private val asrRepository: AsrRepository = AsrRepository(),
    private val dailyEnRepository: DailyEnRepository = DailyEnRepository(),
    private val audioRecorder: AudioRecorder = AudioRecorder(),
    /**
     * 百度 TTS。为 null 时**静默降级为不朗读**，其余功能（识别、判定、评测）不受影响。
     * 生产环境由 `AppContainer.ttsCache` 注入；单测不传。
     *
     * ★ 英文与中文**都走它**：英文文本由**服务端**自动改走英文大模型音色
     * （`baiduTts.ts`：`isEnglish ? "4193" : speaker`），所以前端不必区分；
     * 而全局播放锁是**静态共享**的，用同一个实例才能保证「英文→中文」严格串行不叠音。
     */
    private val ttsCache: BaiduTtsCache? = null,
) : ViewModel() {

    private val scoreClient = ScoreClient(NetworkModule.httpClient)

    private val _uiState = MutableStateFlow(EnglishTalkUiState())
    val uiState: StateFlow<EnglishTalkUiState> = _uiState.asStateFlow()

    private var speakJob: Job? = null
    /** 每轮「领读 → 挂阶梯」的串行链（换轮/切模式时取消） */
    private var flowJob: Job? = null
    /** 录音 + 识别 / 录音 + 评测 */
    private var evalJob: Job? = null
    /** 生成剧情 / 换轮 */
    private var turnJob: Job? = null

    /** 剧情真源（UI 只取需要的字段，不整份塞进 UiState） */
    private var script: DialogueScript = DialogueScript()

    /** 轮次序号：换轮 / 重开 / 切模式时 +1，作废上一轮还在飞的朗读与翻译 */
    private var turnSeq = 0

    private var ladderState: EchoLadderState? = null
    private var ladderRole = LadderRole.ECHO_TARGET

    /** 本页会话内 英→中 翻译缓存（跨轮复用，避免同句反复调 LLM） */
    private val zhCache = ConcurrentHashMap<String, String>()

    /** 进行中的翻译请求（同一句并发只发一次） */
    private val zhInflight = ConcurrentHashMap<String, Deferred<String>>()

    // ══════════════════════════════════════════════════════════════
    // 设置页
    // ══════════════════════════════════════════════════════════════

    fun setTopic(v: String) = setState { it.copy(topic = v) }

    fun setWordsText(v: String) = setState { it.copy(wordsText = v) }

    fun setSentencesText(v: String) = setState { it.copy(sentencesText = v) }

    /** 绿色「✨ 开始对话」：解析输入 → 生成剧情 → 开第一轮 */
    fun startScript() {
        val s = _uiState.value
        if (s.settingUp) return
        val words = parsePracticeWords(s.wordsText)
        val sentences = parsePracticeSentences(s.sentencesText)
        val topic = s.topic.trim()
        // 三者至少给一个（与 web 的判据一致；服务端也会再校验一次并回 400）
        if (words.isEmpty() && sentences.isEmpty() && topic.isEmpty()) {
            setState { it.copy(setupError = "请输入至少一个练习词 / 句子，或主题") }
            return
        }
        turnJob?.cancel()
        turnJob = viewModelScope.launch {
            setState { it.copy(settingUp = true, setupError = "") }
            val sc = talkRepository.setup(topic, words, sentences).getOrElse { e ->
                setState { it.copy(settingUp = false, setupError = "生成失败：${e.message}") }
                return@launch
            }
            if (sc.lines.isEmpty()) {
                setState { it.copy(settingUp = false, setupError = "剧情生成失败：没有有效轮次") }
                return@launch
            }
            setState { it.copy(settingUp = false) }
            beginScript(sc)
        }
    }

    private fun beginScript(sc: DialogueScript) {
        script = sc
        turnSeq += 1
        val seq = turnSeq
        zhCache.clear()
        zhInflight.clear()
        ladderState = null
        ladderRole = LadderRole.ECHO_TARGET
        val first = sc.lines.firstOrNull()
        setState {
            EnglishTalkUiState(
                // 设置页输入保留（web 也没清），失败后可改再试
                topic = it.topic,
                wordsText = it.wordsText,
                sentencesText = it.sentencesText,
                title = sc.title.ifBlank { "英语对话" },
                turn = 0,
                lineCount = sc.lines.size,
                aiText = first?.ai.orEmpty(),
                targetText = first?.target.orEmpty(),
                started = true,
                answerMode = TalkAnswerMode.ECHO,
                phase = TalkPhase.IDLE,
            )
        }
        // ★ 后台预热后面几轮的翻译：剧情里每句都是新句子，中文要靠 LLM 实时翻译（3~8s）。
        //   不预热的话「英文读完 → 接着读中文」中间会有好几秒静默。
        //   每轮两句并发、轮与轮串行，避免一次性打出去太多翻译请求。
        //   （第 1 轮由 [startTurnFlow] 立刻取，与英文朗读并发，所以从下标 1 开始）
        viewModelScope.launch {
            for (ln in sc.lines.drop(1)) {
                try {
                    coroutineScope {
                        launch { fetchZh(englishOnly(ln.ai), true) }
                        launch { fetchZh(englishOnly(ln.target), true) }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // 预热失败无所谓：真正要用时会再取一次
                }
            }
        }
        startTurnFlow(first, seq)
    }

    // ══════════════════════════════════════════════════════════════
    // 每一轮的串行链：领读 AI 台词（中英连读）→（跟读模式）领读目标句 + 挂逐词阶梯
    // ══════════════════════════════════════════════════════════════

    private fun startTurnFlow(ln: DialogueLine?, seq: Int) {
        if (ln == null) return
        flowJob?.cancel()
        flowJob = viewModelScope.launch {
            val aiEn = englishOnly(ln.ai)
            // 预取本轮两句翻译（与问句朗读并发，避免「英文读完还在等翻译」的静默空档）
            launch { fetchZh(aiEn, true) }
            launch { fetchZh(englishOnly(ln.target), true) }
            // 当前 AI 台词的中文翻译（懒加载，拿不到给占位文案 —— 与 web 一致）
            launch {
                val zh = fetchZh(aiEn, true)
                if (seq == turnSeq) {
                    setState { it.copy(lineZh = zh.ifBlank { "（暂无翻译）" }) }
                }
            }
            if (_uiState.value.answerMode == TalkAnswerMode.FREE) {
                // 自由模式：只读 AI 问句，孩子的回答自己组织
                speakPair(ln.ai, seq)
                return@launch
            }
            speakPair(ln.ai, seq) // AI 问句：英文读完接着读中文
            if (seq != turnSeq) return@launch
            armEcho(englishOnly(ln.target), seq)
        }
    }

    /**
     * 挂载逐词跟读阶梯。
     *
     * ⚠️ 顺序不能颠倒：**先 await 完整句领读，再挂阶梯**。阶梯一挂上就会立刻领读第 1 级，
     * 若此时全局还在朗读（`play` 是全局互斥的）会被直接拒掉 ⇒ 孩子听不到第 1 个词。
     * 这与 web `armEcho` 的注释是同一个坑。
     */
    private suspend fun armEcho(en: String, seq: Int) {
        if (en.isEmpty()) return
        viewModelScope.launch {
            val zh = fetchZh(en, true)
            if (seq == turnSeq) setState { it.copy(answerZh = zh) }
        }
        speakPair(en, seq)
        if (seq != turnSeq) return
        val units = splitEnWords(en)
        val st = EchoLadderState(
            units = units.ifEmpty { listOf(en) },
            chunks = emptyList(),
            sentence = en,
        )
        ladderState = st
        ladderRole = LadderRole.ECHO_TARGET
        setState {
            it.copy(ladder = st.view(), ladderScore = null, ladderFailCount = 0, ladderError = "")
        }
        readLadder()
    }

    // ══════════════════════════════════════════════════════════════
    // 跟读阶梯（录音 + SOE 评测 + 状态迁移都委托给 EchoLadderState）
    // ══════════════════════════════════════════════════════════════

    /** 领读当前级（或小步）的目标文本 */
    private fun readLadder() {
        val st = ladderState ?: return
        if (st.done) return
        val t = st.target
        if (t.isBlank()) return
        speakJob?.cancel()
        speakJob = viewModelScope.launch {
            setState { it.copy(rolling = true) }
            try {
                speak(t, READ_TIMEOUT_MS)
            } finally {
                setState { it.copy(rolling = false) }
            }
        }
    }

    /** 「🔊 再听」 */
    fun readLadderAgain() = readLadder()

    /** 主按钮：开始录音 / 停止录音（停止后自动评测并推进阶梯） */
    fun toggleLadderRecord() {
        val s = _uiState.value
        if (s.rolling || s.evaluating) return
        if (s.recording) {
            audioRecorder.stop()
            return
        }
        val st = ladderState ?: return
        if (st.done) return
        // 用**取消**（而不是 stopAll）中断领读：取消会走 playFile 的 invokeOnCancellation，
        // 既能立刻停声、又能释放全局播放锁。避免把领读声录进去。
        speakJob?.cancel()
        evalJob?.cancel()
        evalJob = viewModelScope.launch {
            try {
                audioRecorder.reset()
                setState { it.copy(recording = true, ladderScore = null, ladderError = "") }
                val pcm = audioRecorder.record()
                if (pcm.size < MIN_AUDIO_BYTES) throw IllegalStateException("录音太短，请至少读一秒")
                setState { it.copy(recording = false, evaluating = true) }
                // ⚠️ 用**发起录音时**的 target 与 scene：录音期间状态不会变，但显式取更清楚
                val refText = st.target
                val evalMode = evalModeForScene(st.scene)
                val result = withContext(Dispatchers.IO) {
                    scoreClient.evaluate(refText, Base64.encodeToString(pcm, Base64.NO_WRAP), ENGINE_EN, evalMode)
                }
                setState { it.copy(evaluating = false, ladderScore = result.totalScore) }
                when (st.onScore(result.totalScore, result.wordScores)) {
                    EchoLadderState.Event.FAIL,
                    EchoLadderState.Event.LEVEL_UP,
                    EchoLadderState.Event.DRILL_CLEAR -> {
                        // 进下一级 / 小步过关回原级 / 失败重读 —— 三种都要重新领读
                        publishLadder(st)
                        readLadder()
                    }
                    EchoLadderState.Event.FINISH_ALL -> {
                        publishLadder(st)
                        // ⚠️ 表扬语与「放行」必须问**串行**（web 是播完 praise 才回调 onFinished）：
                        //   异步播表扬会让紧随其后的领读被全局播放锁挡掉（静默少读一次）。
                        speakJob?.cancel()
                        speakJob = viewModelScope.launch {
                            setState { it.copy(rolling = true) }
                            try {
                                speak(LADDER_PRAISE, READ_TIMEOUT_MS)
                            } finally {
                                setState { it.copy(rolling = false) }
                            }
                        }
                    }
                    EchoLadderState.Event.NONE -> publishLadder(st)
                }
            } catch (e: CancellationException) {
                setState { it.copy(recording = false, evaluating = false) }
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "跟读评测失败: ${e.message}")
                setState {
                    it.copy(
                        recording = false,
                        evaluating = false,
                        ladderError = e.message ?: "评测失败，请再试一次",
                    )
                }
            }
        }
    }

    /**
     * 「跳过」——跟读阶梯直接判整句完成；错句修复阶梯则收起。
     * （web：跟读的 `onSkip` 把 done 置 true；修复阶梯的 `onSkip` 是 `setLadderOpen(false)`。）
     */
    fun skipLadder() {
        val st = ladderState ?: return
        speakJob?.cancel()
        if (ladderRole == LadderRole.CORRECT_FIX) {
            ladderState = null
            setState { it.copy(fixLadderOpen = false, ladder = null, ladderScore = null, ladderError = "") }
            return
        }
        st.forceFinish()
        publishLadder(st)
    }

    // ══════════════════════════════════════════════════════════════
    // 自由模式：「自己说」→ 短语音识别 → 整句判定
    // ══════════════════════════════════════════════════════════════

    /** 切到「🎤 我自己说」（本轮）：收起跟读阶梯，露出录音按钮 */
    fun switchToFree() {
        turnSeq += 1
        cancelAllJobs()
        ladderState = null
        setState {
            it.copy(
                answerMode = TalkAnswerMode.FREE,
                ladder = null,
                ladderScore = null,
                ladderFailCount = 0,
                ladderError = "",
                answerZh = "",
                feedback = null,
                correctZh = "",
                errText = "",
                saidText = "",
                fixLadderOpen = false,
                phase = TalkPhase.IDLE,
                recording = false,
                evaluating = false,
                rolling = false,
                speakingWord = null,
            )
        }
    }

    /** 切回「🧗 跟读模式」（本轮）：重新领读目标句并挂阶梯 */
    fun switchToEcho() {
        turnSeq += 1
        val seq = turnSeq
        cancelAllJobs()
        ladderState = null
        setState {
            it.copy(
                answerMode = TalkAnswerMode.ECHO,
                ladder = null,
                ladderScore = null,
                ladderFailCount = 0,
                ladderError = "",
                feedback = null,
                correctZh = "",
                errText = "",
                saidText = "",
                fixLadderOpen = false,
                phase = TalkPhase.IDLE,
                recording = false,
                evaluating = false,
                rolling = false,
                speakingWord = null,
            )
        }
        val line = script.lines.getOrNull(_uiState.value.turn) ?: return
        flowJob = viewModelScope.launch { armEcho(englishOnly(line.target), seq) }
    }

    fun startRecording() {
        val s = _uiState.value
        if (s.answerMode != TalkAnswerMode.FREE) return
        if (s.phase != TalkPhase.IDLE || s.judging) return
        speakJob?.cancel()
        evalJob?.cancel()
        evalJob = viewModelScope.launch {
            try {
                audioRecorder.reset()
                setState {
                    it.copy(phase = TalkPhase.RECORDING, recording = true, errText = "", saidText = "")
                }
                val pcm = audioRecorder.record()
                setState { it.copy(phase = TalkPhase.IDLE, recording = false) }
                if (pcm.size < MIN_AUDIO_BYTES) {
                    setState { it.copy(errText = "没有听到内容，请再试一次") }
                    return@launch
                }
                setState { it.copy(phase = TalkPhase.JUDGING, judging = true) }
                val said = asrRepository.recognize(pcm, "en").getOrElse { e ->
                    setState {
                        it.copy(
                            phase = TalkPhase.IDLE,
                            judging = false,
                            errText = e.message ?: "语音识别失败，请再试一次",
                        )
                    }
                    return@launch
                }
                if (said.isBlank()) {
                    setState {
                        it.copy(phase = TalkPhase.IDLE, judging = false, errText = "没有听到内容，请再试一次")
                    }
                    return@launch
                }
                setState { it.copy(saidText = said) }
                submitAnswer(said)
            } catch (e: CancellationException) {
                setState { it.copy(phase = TalkPhase.IDLE, recording = false, judging = false) }
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "录音失败: ${e.message}")
                setState {
                    it.copy(
                        phase = TalkPhase.IDLE,
                        recording = false,
                        judging = false,
                        errText = e.message ?: "录音失败，请检查麦克风权限",
                    )
                }
            }
        }
    }

    /** 红色「⏹ 结束」 */
    fun stopRecording() {
        if (_uiState.value.recording) audioRecorder.stop()
    }

    private suspend fun submitAnswer(said: String) {
        val line = script.lines.getOrNull(_uiState.value.turn) ?: return
        val res = talkRepository.judge(line.target, said).getOrNull()
        if (res == null) {
            // 判定失败（网络/服务端 500）：给一个兜底反馈并朗读正确句（对齐 web 的 catch 分支）
            setState {
                it.copy(
                    phase = TalkPhase.IDLE,
                    judging = false,
                    feedback = TalkFeedback(ok = false, praise = "Try again!", correct = line.target, said = said),
                    fixLadderOpen = false,
                )
            }
            viewModelScope.launch {
                val zh = fetchZh(line.target, true)
                setState { it.copy(correctZh = zh) }
            }
            speakJob?.cancel()
            speakJob = viewModelScope.launch {
                setState { it.copy(phase = TalkPhase.READING) }
                try {
                    speak("Try again!", READ_TIMEOUT_MS)
                } finally {
                    setState { it.copy(phase = TalkPhase.IDLE) }
                }
            }
            return
        }
        setState {
            it.copy(
                phase = TalkPhase.IDLE,
                judging = false,
                feedback = TalkFeedback(res.ok, res.praise, res.correct, said),
                correctZh = "",
                fixLadderOpen = false,
            )
        }
        if (!res.ok && res.correct.isNotBlank()) {
            viewModelScope.launch {
                val zh = fetchZh(res.correct, true)
                setState { it.copy(correctZh = zh) }
            }
        }
        speakJob?.cancel()
        speakJob = viewModelScope.launch {
            setState { it.copy(phase = TalkPhase.READING) }
            try {
                val praise = res.praise.ifBlank { if (res.ok) "Great job!" else "Try again!" }
                speak(praise, READ_TIMEOUT_MS)
                // 错句：接着朗读正确句（英文读完连着读中文翻译），与自动领读同口径
                if (!res.ok && res.correct.isNotBlank()) speakPair(res.correct, turnSeq)
            } finally {
                setState { it.copy(phase = TalkPhase.IDLE) }
            }
        }
    }

    /**
     * 「🧗 跟读练习（从片段到整句）」—— 错句修复用的意群阶梯。
     * 意群优先用剧情给的 `chunks`，缺省时按 [fallbackChunks] 本地兜底（与 web 一致）。
     */
    fun openFixLadder() {
        val fb = _uiState.value.feedback ?: return
        val correct = fb.correct.trim()
        if (correct.isEmpty()) return
        val en = englishOnly(correct)
        val line = script.lines.getOrNull(_uiState.value.turn)
        val chunks = line?.chunks?.takeIf { it.isNotEmpty() } ?: fallbackChunks(en)
        val st = EchoLadderState(units = emptyList(), chunks = chunks, sentence = en)
        ladderState = st
        ladderRole = LadderRole.CORRECT_FIX
        setState {
            it.copy(fixLadderOpen = true, ladder = st.view(), ladderScore = null, ladderFailCount = 0, ladderError = "")
        }
        readLadder()
    }

    // ══════════════════════════════════════════════════════════════
    // 下一轮 / 完成
    // ══════════════════════════════════════════════════════════════

    fun nextTurn() {
        val next = _uiState.value.turn + 1
        turnJob?.cancel()
        turnJob = viewModelScope.launch {
            cancelAllJobs()
            if (next < script.lines.size) {
                turnSeq += 1
                val seq = turnSeq
                val ln = script.lines[next]
                ladderState = null
                setState {
                    it.copy(
                        turn = next,
                        aiText = ln.ai,
                        targetText = ln.target,
                        lineZh = "",
                        answerZh = "",
                        correctZh = "",
                        feedback = null,
                        errText = "",
                        saidText = "",
                        ladder = null,
                        ladderScore = null,
                        ladderFailCount = 0,
                        ladderError = "",
                        fixLadderOpen = false,
                        phase = TalkPhase.IDLE,
                        recording = false,
                        evaluating = false,
                        rolling = false,
                        speakingWord = null,
                    )
                }
                startTurnFlow(ln, seq)
            } else {
                // 全部完成：回到设置页并清空输入（与 web 一致）
                script = DialogueScript()
                ladderState = null
                setState { EnglishTalkUiState() }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 点读 / 重读
    // ══════════════════════════════════════════════════════════════

    /** 「🔊 再读」AI 台词（多词 ⇒ 中英连读，与自动领读同口径） */
    fun reReadAi() {
        val t = _uiState.value.aiText
        if (t.isBlank()) return
        speakJob?.cancel()
        speakJob = viewModelScope.launch { speakPair(t, turnSeq) }
    }

    /** 「🔊 再读」正确句（多词 ⇒ 中英连读） */
    fun reReadCorrect() {
        val t = _uiState.value.feedback?.correct.orEmpty()
        if (t.isBlank()) return
        speakJob?.cancel()
        speakJob = viewModelScope.launch { speakPair(t, turnSeq) }
    }

    /**
     * 点读单个英文单词（[com.example.ai.ui.common.EnglishWordTapText]）。
     *
     * 单词只读英文、不连读中文（追求点读手感，与 web 一致）。
     * ⚠️ 录音中直接忽略：Android 侧的录音是「一次录一段」，没有 web 的 ASR pause/resume，
     * 点读声会被录进麦克风。
     */
    fun speakWord(word: String) {
        val w = word.trim()
        if (w.isEmpty()) return
        if (_uiState.value.recording) return
        speakJob?.cancel()
        speakJob = viewModelScope.launch {
            setState { it.copy(speakingWord = w) }
            try {
                speak(w, READ_TIMEOUT_MS)
            } finally {
                setState { it.copy(speakingWord = null) }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 朗读基础设施
    // ══════════════════════════════════════════════════════════════

    /**
     * 中英连读：英文读完紧接着读这句的中文翻译。
     * 页面上每一处**整句英文领读**都走它（AI 问句、该说的回答、正确句）。
     *
     * 两个要点（与 web `speakPair` 一致）：
     * 1. 翻译与英文朗读**并发**发起，总等待 ≈ max(英文时长, 翻译时长) + 中文时长，而不是两者相加。
     * 2. 中文等不到（超时/失败）或已换轮 ⇒ **只读英文**，绝不卡住后面的「领读 → 挂阶梯」链路。
     *
     * @param seq 轮次序号；换轮/重开/切模式后作废在飞的中文朗读
     */
    private suspend fun speakPair(text: String, seq: Int? = null) {
        val en = englishOnly(text)
        if (en.isEmpty()) return
        val zhDeferred = viewModelScope.async(start = CoroutineStart.DEFAULT) { fetchZhTimed(en, true) }
        speak(en, READ_TIMEOUT_MS)
        if (seq != null && seq != turnSeq) {
            zhDeferred.cancel()
            return
        }
        val zh = try {
            zhDeferred.await()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ""
        }
        if (seq != null && seq != turnSeq) return
        // 跳过中文时留痕：这条链路以前是静默失败的，只表现为「没接着读中文」，查不出原因
        if (zh.isEmpty()) {
            Log.w(TAG, "没拿到这句的中文翻译，跳过中文朗读：$en")
            return
        }
        speak(zh, READ_TIMEOUT_MS)
    }

    /**
     * 单次朗读。
     *
     * ★ [BaiduTtsCache.play] 有**全局播放锁**，播放中会**直接返回 false**（不是排队）。
     * 所以这里照 web `speakRetry` 的做法重试若干次；每次的超时用 `withTimeoutOrNull` 兜住
     * 「底层播放永不返回」（超时会取消这次播放 → 走 `invokeOnCancellation` 停声并释放锁）。
     * 全部失败后调一次 `stopAll()` 兜底释放锁 —— 宁可截断这一段，也不能让后面全哑。
     */
    private suspend fun speak(text: String, timeoutMs: Long): Boolean {
        val t = text.trim()
        if (t.isEmpty()) return false
        val cache = ttsCache ?: return false // 没注入 TTS：静默不朗读
        repeat(RETRY_TIMES) { i ->
            if (withTimeoutOrNull(timeoutMs) { cache.play(t, TTS_SPEAKER) } == true) return true
            if (i < RETRY_TIMES - 1) delay(RETRY_WAIT_MS)
        }
        Log.w(TAG, "朗读被全局播放锁连续拒绝，这段跳过：$t")
        BaiduTtsCache.stopAll()
        return false
    }

    /**
     * 取英文（词/句）的中文翻译：本页会话缓存 → 在飞去重 → 服务端。
     * 翻译走「每日一练·英语」的 `/daily-en/sentence-info`（整句）与 `/daily-en/word-info`（单词）。
     *
     * ⚠️ web 还有一条「本地课标词库同步查」的快路径（`lookupWordZhSync`），Android 侧没有这份
     * 词库，故单词翻译也要走一次网络（只影响自由模式的逐词提示，跟读模式只用整句翻译）。
     */
    private suspend fun fetchZh(text: String, full: Boolean): String {
        val t = text.trim()
        if (t.isEmpty()) return ""
        val key = (if (full) "s:" else "w:") + t.lowercase()
        zhCache[key]?.let { return it }
        zhInflight[key]?.let { return awaitZh(it) }
        val d = viewModelScope.async(Dispatchers.IO, start = CoroutineStart.LAZY) {
            try {
                val zh = if (full) {
                    dailyEnRepository.fetchSentenceInfo(t)?.translation.orEmpty()
                } else {
                    val info = dailyEnRepository.fetchWordInfo(t)
                    info?.translation.orEmpty().ifBlank { info?.meaning.orEmpty() }
                }
                if (zh.isNotEmpty()) zhCache[key] = zh // 同句/同词在后续轮次不再重复请求
                zh
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                ""
            } finally {
                zhInflight.remove(key)
            }
        }
        // 先登记再启动：否则并发的第二个调用者会看不到在飞请求（web 靠单线程同步登记规避）
        zhInflight[key] = d
        d.start()
        return awaitZh(d)
    }

    private suspend fun awaitZh(d: Deferred<String>): String = try {
        d.await()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        ""
    }

    /** 带超时的翻译查询：中文朗读不能因为翻译迟迟不来卡住整轮对话 */
    private suspend fun fetchZhTimed(text: String, full: Boolean): String =
        withTimeoutOrNull(ZH_WAIT_MS) { fetchZh(text, full) } ?: ""

    // ══════════════════════════════════════════════════════════════
    // 内部工具
    // ══════════════════════════════════════════════════════════════

    private fun publishLadder(st: EchoLadderState) = setState {
        it.copy(ladder = st.view(), ladderFailCount = st.failCount)
    }

    private fun cancelAllJobs() {
        flowJob?.cancel()
        speakJob?.cancel()
        evalJob?.cancel()
    }

    private fun setState(block: (EnglishTalkUiState) -> EnglishTalkUiState) {
        _uiState.value = block(_uiState.value)
    }

    override fun onCleared() {
        turnJob?.cancel()
        cancelAllJobs()
        audioRecorder.stop()
        BaiduTtsCache.stopAll()
        super.onCleared()
    }

    companion object {
        private const val TAG = "EnglishTalkVM"

        /**
         * TTS 音色：统一传 `"0"`（老师）。
         * 英文文本由**服务端**自动改走 4193（度泽言·自然英文），前端不必区分语言。
         */
        private const val TTS_SPEAKER = "0"

        /** 领读硬超时（web `READ_TIMEOUT_MS` = 15s） */
        private const val READ_TIMEOUT_MS = 15_000L

        /** 整句中文翻译的等待上限（web `ZH_READ_TIMEOUT_MS` = 20s） */
        private const val ZH_WAIT_MS = 20_000L

        /** 录音太短判定（与 `SentenceReadingViewModel` / `SpeechComposeViewModel` 一致） */
        private const val MIN_AUDIO_BYTES = 6400

        /** 抢全局播放锁的重试次数与间隔（web 是 6 次 × 500ms ≈ 3s） */
        private const val RETRY_TIMES = 6
        private const val RETRY_WAIT_MS = 500L

        /** 阶梯整句过关的表扬语（web EchoLadder 的默认值，**英文**，故走英文音色） */
        private const val LADDER_PRAISE = "Great! Whole sentence done."
    }
}

/**
 * 页面 UI 状态。
 *
 * 派生属性都放在这里而不是 Screen 里，避免 composable 里重复计算（`AGENTS.md`：计算逻辑上移）。
 */
data class EnglishTalkUiState(
    // ── 设置页 ──
    val topic: String = "",
    val wordsText: String = "",
    val sentencesText: String = "",
    val settingUp: Boolean = false,
    val setupError: String = "",
    // ── 剧情 ──
    val title: String = "",
    val turn: Int = 0,
    val lineCount: Int = 0,
    val aiText: String = "",
    val targetText: String = "",
    /** 当前 AI 台词的中文翻译（懒加载；拿不到时是「（暂无翻译）」） */
    val lineZh: String = "",
    /** 「该这样回答」的中文翻译 */
    val answerZh: String = "",
    /** 判错时正确句的中文翻译 */
    val correctZh: String = "",
    /** 剧情已就绪（false = 显示设置页） */
    val started: Boolean = false,
    // ── 模式 / 阶段 ──
    val answerMode: TalkAnswerMode = TalkAnswerMode.ECHO,
    val phase: TalkPhase = TalkPhase.IDLE,
    // ── 自由模式 ──
    val saidText: String = "",
    val feedback: TalkFeedback? = null,
    val judging: Boolean = false,
    val errText: String = "",
    // ── 跟读阶梯 ──
    val ladder: LadderView? = null,
    val ladderScore: Int? = null,
    val ladderFailCount: Int = 0,
    val ladderError: String = "",
    /** AI 正在领读（阶梯） */
    val rolling: Boolean = false,
    val recording: Boolean = false,
    val evaluating: Boolean = false,
    /** 自由模式：错句修复的意群阶梯是否展开 */
    val fixLadderOpen: Boolean = false,
    /** 正在点读的单词（高亮） */
    val speakingWord: String? = null,
) {
    /** 练习单词个数（对应按钮文案「用这 N 个词 / M 句开始对话」） */
    val wordsCount: Int get() = parsePracticeWords(wordsText).size

    /** 练习句子个数 */
    val sentencesCount: Int get() = parsePracticeSentences(sentencesText).size

    /** 「1/4」 */
    val turnLabel: String get() = "${turn + 1}/$lineCount"

    /** 本轮是不是最后一轮（决定按钮文案「下一轮 →」/「🎉 完成，再来一次」） */
    val isLastTurn: Boolean get() = turn + 1 >= lineCount

    /** 是否已通关本轮（判定出结果 或 阶梯整句完成）⇒ 显示「下一轮」按钮 */
    val canAdvance: Boolean get() = feedback != null || ladder?.done == true

    /** 是否可以点「🎤 开始录音」（自由模式） */
    val canStartRecording: Boolean
        get() = answerMode == TalkAnswerMode.FREE &&
            phase == TalkPhase.IDLE && !judging && feedback == null && ladder?.done != true
}
