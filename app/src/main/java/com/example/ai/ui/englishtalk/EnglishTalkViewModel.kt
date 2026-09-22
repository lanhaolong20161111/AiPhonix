package com.example.ai.ui.englishtalk

import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.data.audio.AudioRecorder
import com.example.ai.data.dailyen.DailyEnRepository
import com.example.ai.data.englishtalk.DialogueLine
import com.example.ai.data.englishtalk.DialogueScript
import com.example.ai.data.englishtalk.EnglishTalkRepository
import com.example.ai.data.ocr.OcrEngineStore
import com.example.ai.data.ocr.OcrPlatform
import com.example.ai.data.speech.ScoreClient
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.di.NetworkModule
import com.example.ai.ui.echo.EchoLadderState
import com.example.ai.ui.echo.LadderView
import com.example.ai.ui.ocr.EnVocabPhotoSession
import com.example.ai.ui.ocr.EnVocabPhotoState
import com.example.ai.util.ENGINE_EN
import com.example.ai.util.evalModeForScene
import com.example.ai.util.englishOnly
import com.example.ai.util.fallbackChunks
import com.example.ai.util.parsePracticeSentences
import com.example.ai.util.parsePracticeWords
import com.example.ai.util.splitEnWords
import com.example.ai.util.splitJsWhitespace
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

/** 阶段（自由模式的录音/朗读状态机；跟读模式的阶梯自带状态）。`HINTING` = 逐词提示中（ASR 已暂停） */
enum class TalkPhase { IDLE, RECORDING, HINTING, JUDGING, READING }

/** 一次整句判定结果 */
data class TalkFeedback(
    val ok: Boolean = false,
    val praise: String = "",
    /** 不通过时是期望句原文；通过为空 */
    val correct: String = "",
    val said: String = "",
)

/** 「💡 提示记录」面板的一行（web `hintRows`：逐行保留 + 懒加载中文翻译） */
data class TalkHintRow(
    val text: String = "",
    /** true = 整句提示（提示行前缀「（整句）」）；false = 逐词提示 */
    val full: Boolean = false,
    /** 中文翻译（异步补上；逐词提示走单词翻译、整句走整句翻译） */
    val zh: String = "",
)

/** 阶梯用途：跟读模式的本轮目标句 vs 自由模式错句修复 vs 6s 静默引导 */
private enum class LadderRole { ECHO_TARGET, CORRECT_FIX, GUIDED }

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
 * 2. [TalkAnswerMode.FREE]（可选旧流程）—— 孩子自己说，走 **WebSocket 流式 ASR**
 *    （[EnglishTurnAsr] ⇔ `/asr/stream`，对齐 web `useEnglishTurn`）：
 *    逐词实时上屏（MID_TEXT）/ 停顿 2s 自动提示下一个词 / 6s 完全没出声自动挂整句单词阶梯，
 *    点「⏹ 结束」取整句 → `/llm/en-answer-judge` 判定 → 通过给表扬、不通过给正确句 + 可展开意群阶梯。
 *
 * 朗读口径：**中英连读**（[speakPair]）——英文读完紧接着读这句的中文翻译，
 * 翻译与英文朗读**并发**取，故总等待 ≈ max(英文时长, 翻译时长) + 中文时长。
 *
 * ⚠️ 与 web 的**有意差异**：
 * - 「💡 提示记录」的单词翻译没有 web 的「本地课标词库同步查」快路径（Android 无这份词库），
 *   一律走 `/daily-en/word-info`（首行显示会晚一拍，面板行为一致）。
 * - 「📷 拍照识词」**已实现**（整页 OCR → 抽词句 → 勾选导入，见 `EnVocabPhotoSession` / `EnVocabPhotoSheet`），
 *   与 web 的 `EnVocabPhotoSheet` 对齐；抽词规则在 `data/envocab/EnVocabExtract.kt`（纯函数 + 单测）。
 */
class EnglishTalkViewModel(
    private val talkRepository: EnglishTalkRepository = EnglishTalkRepository(),
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
    /** 拍照识词用的仓储（网页侧是同一个 `ai-chinese/parse-image` + `mode=english`） */
    ocrRepository: AiChineseRepository? = null,
    /** 唯一持 `Context` 的依赖（读 URI 字节 / EXIF 转正 / 压缩），为 null 时拍照识词静默降级 */
    ocrPlatform: OcrPlatform? = null,
    ocrEngineStore: OcrEngineStore? = null,
) : ViewModel() {

    private val scoreClient = ScoreClient(NetworkModule.httpClient)

    private val _uiState = MutableStateFlow(EnglishTalkUiState())
    val uiState: StateFlow<EnglishTalkUiState> = _uiState.asStateFlow()

    /**
     * 「📷 拍照识词」会话（对齐 web `EnVocabPhotoSheet`）。
     *
     * ★ 与每日语文/英语的「框选」不同：这里是**整页识别**（不拖框），打开就跑，
     * 抽词句后用勾选的方式导入。抽词规则在 `data/envocab/EnVocabExtract.kt`。
     */
    val photo: EnVocabPhotoSession = EnVocabPhotoSession(
        repository = ocrRepository ?: AiChineseRepository(),
        platform = ocrPlatform,
        engineStore = ocrEngineStore,
        scope = viewModelScope,
        onDone = ::onVocabDone,
    )

    /** 唯一持 Context 的依赖（`OcrPlatform` 只包了 applicationContext，无状态） */
    private val ocrPlatformRef: OcrPlatform? = ocrPlatform

    /**
     * 自由模式的流式 ASR 单轮控制器（web `useEnglishTurn` 的等价物）。
     * pauseMs=2000（停顿 → 逐词提示）、initialSilenceMs=6000（完全没出声 → 挂引导阶梯），
     * 与 web `AiEnglishTalkPage` 传参逐位一致。
     */
    private val turnAsr = EnglishTurnAsr(
        scope = viewModelScope,
        pauseMs = 2_000,
        initialSilenceMs = 6_000,
        onPause = { said -> viewModelScope.launch { pauseHandler(said) } },
        onInitialSilence = { viewModelScope.launch { startGuided() } },
    )

    init {
        // 弹层状态转发进本页 state（与每日语文/英语同一套做法）
        viewModelScope.launch {
            photo.state.collect { s -> setState { it.copy(photo = s) } }
        }
        // 流式 ASR 状态 → UiState（saidText 实时上屏 / interimText 临时文本 / level 电平 / error）
        viewModelScope.launch {
            turnAsr.state.collect { ts ->
                setState {
                    it.copy(
                        saidText = ts.saidText,
                        interimText = ts.interimText,
                        asrLevel = ts.level,
                        asrError = ts.error,
                    )
                }
            }
        }
    }

    private var speakJob: Job? = null
    /** 每轮「领读 → 挂阶梯」的串行链（换轮/切模式时取消） */
    private var flowJob: Job? = null
    /** 录音 + 识别 / 录音 + 评测 */
    private var evalJob: Job? = null
    /** 生成剧情 / 换轮 */
    private var turnJob: Job? = null
    /** 主动朗读（提示行/再读/点读；录音中会先暂停 ASR，读完自动恢复） */
    private var playTtsJob: Job? = null

    /** 剧情真源（UI 只取需要的字段，不整份塞进 UiState） */
    private var script: DialogueScript = DialogueScript()

    /** 轮次序号：换轮 / 重开 / 切模式时 +1，作废上一轮还在飞的朗读与翻译 */
    private var turnSeq = 0

    private var ladderState: EchoLadderState? = null
    private var ladderRole = LadderRole.ECHO_TARGET

    // ── 逐词提示状态（web hintWordsRef/hintIdxRef/lastHintTextRef/fullHintGivenRef/hintBusyRef） ──
    private var hintWords: List<String> = emptyList()
    private var hintIdx = 0
    private var lastHintText = ""
    private var fullHintGiven = false
    @Volatile
    private var hintBusy = false

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

    // ══════════════════════════════════════════════════════════════
    // 📷 拍照识词（对齐 web `onPickPhoto` / `onVocabDone`）
    // ══════════════════════════════════════════════════════════════

    /**
     * 选图/拍照 → 读字节 → 打开识词弹层（弹层里做转正 + 压缩 + 整页识别）。
     *
     * ⚠️ 与 web 的时序差异（有意）：web 在**打开弹层前**就把图转正压缩了（`prepareImageFile`），
     * 所以 `preparingPhoto` 期间设置页还在、弹层还没出现；Android 把这步放进弹层
     * （弹层显示「🖼️ 正在处理图片…」）。这里 `preparingPhoto` 只覆盖「读 URI 字节」这一小段，
     * 作用仍是**防连点**。
     */
    fun startPhotoVocab(uri: Uri) {
        val platform = ocrPlatformRef ?: return
        if (_uiState.value.preparingPhoto) return
        setState { it.copy(preparingPhoto = true, vocabMsg = "") }
        viewModelScope.launch {
            val bytes = withContext(Dispatchers.IO) { platform.readBytes(uri) }
            setState { it.copy(preparingPhoto = false) }
            if (bytes == null) {
                setState { it.copy(vocabWarn = true, vocabMsg = "读取图片失败：请换一张更清晰的照片试试") }
                return@launch
            }
            photo.start(bytes)
        }
    }

    fun closePhotoVocab() = photo.close()

    /**
     * 识词弹层点「✓ 用这些词句出题」：回填输入框（用户可再改），**不自动开始**
     * （对齐 web `onVocabDone`）。
     *
     * ⚠️ 只有非空的一侧才覆盖输入框（`if (words.length)`）—— 否则「只勾了句子」会把用户
     * 手写的单词全清掉。
     */
    private fun onVocabDone(words: List<String>, sentences: List<String>) {
        photo.close()
        val empty = words.isEmpty() && sentences.isEmpty()
        setState {
            it.copy(
                wordsText = if (words.isNotEmpty()) words.joinToString(", ") else it.wordsText,
                sentencesText = if (sentences.isNotEmpty()) sentences.joinToString("\n") else it.sentencesText,
                vocabWarn = empty,
                vocabMsg = if (empty) {
                    "没抽到单词或句子，请换一张更清晰的照片。"
                } else {
                    "✅ 已填入 ${words.size} 个单词、${sentences.size} 个句子（可修改），" +
                        "点下方「✨ 开始对话」让 AI 出题"
                },
            )
        }
    }

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
        // 提示状态复位（web beginScript 同款：hintWords/hintIdx/lastHintText/fullHintGiven/hintCount/hintRows）
        hintWords = sc.lines.firstOrNull()?.hintWords.orEmpty()
        hintIdx = 0
        lastHintText = ""
        fullHintGiven = false
        hintBusy = false
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
        when (ladderRole) {
            LadderRole.CORRECT_FIX -> {
                ladderState = null
                setState { it.copy(fixLadderOpen = false, ladder = null, ladderScore = null, ladderError = "") }
            }
            // 自由模式 6s 引导阶梯的「跳过」= 收起（web setGuided(null)）
            LadderRole.GUIDED -> {
                ladderState = null
                setState { it.copy(guidedLadderOpen = false, ladder = null, ladderScore = null, ladderError = "") }
            }
            LadderRole.ECHO_TARGET -> {
                st.forceFinish()
                publishLadder(st)
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 自由模式：「自己说」→ 短语音识别 → 整句判定
    // ══════════════════════════════════════════════════════════════

    /** 切到「🎤 我自己说」（本轮）：收起跟读阶梯，露出录音按钮 */
    fun switchToFree() {
        turnSeq += 1
        cancelAllJobs()
        ladderState = null
        resetHintState()
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
                interimText = "",
                fixLadderOpen = false,
                guidedLadderOpen = false,
                phase = TalkPhase.IDLE,
                recording = false,
                evaluating = false,
                rolling = false,
                speakingWord = null,
            )
        }
        // web switchToFree 会 await turnHook.stop()：停掉可能残留的流式录音
        viewModelScope.launch { turnAsr.stop() }
    }

    /** 切回「🧗 跟读模式」（本轮）：重新领读目标句并挂阶梯 */
    fun switchToEcho() {
        turnSeq += 1
        val seq = turnSeq
        cancelAllJobs()
        ladderState = null
        resetHintState()
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
                interimText = "",
                fixLadderOpen = false,
                guidedLadderOpen = false,
                phase = TalkPhase.IDLE,
                recording = false,
                evaluating = false,
                rolling = false,
                speakingWord = null,
            )
        }
        // web switchToEcho 会 await turnHook.stop()：停掉可能残留的流式录音
        viewModelScope.launch { turnAsr.stop() }
        val line = script.lines.getOrNull(_uiState.value.turn) ?: return
        flowJob = viewModelScope.launch { armEcho(englishOnly(line.target), seq) }
    }

    /** 绿色「开始录音」（自由模式）：起流式 ASR（逐词实时上屏 + 静音检测随之工作） */
    fun startRecording() {
        val s = _uiState.value
        if (s.answerMode != TalkAnswerMode.FREE) return
        if (s.phase != TalkPhase.IDLE || s.judging) return
        speakJob?.cancel()
        viewModelScope.launch {
            val ok = turnAsr.start()
            if (ok) {
                setState { it.copy(phase = TalkPhase.RECORDING, errText = "") }
            } else {
                val msg = _uiState.value.asrError.ifBlank { "开始录音失败，请检查麦克风权限" }
                setState { it.copy(phase = TalkPhase.IDLE, errText = msg) }
            }
        }
    }

    /** 红色「⏹ 结束」→ 取整句（流式已说文本）→ AI 判定（web `finishRecording`） */
    fun stopRecording() {
        val s = _uiState.value
        if (s.answerMode != TalkAnswerMode.FREE) {
            if (s.recording) audioRecorder.stop()
            return
        }
        if (s.phase != TalkPhase.RECORDING || s.judging) return
        evalJob?.cancel()
        evalJob = viewModelScope.launch {
            setState { it.copy(phase = TalkPhase.JUDGING, judging = true) }
            try {
                val said = turnAsr.stop()
                if (said.isBlank()) {
                    setState {
                        it.copy(phase = TalkPhase.IDLE, judging = false, errText = "没有听到内容，请再试一次")
                    }
                    return@launch
                }
                if (script.lines.getOrNull(_uiState.value.turn) == null) {
                    setState { it.copy(phase = TalkPhase.IDLE, judging = false) }
                    return@launch
                }
                submitAnswer(said)
            } catch (e: CancellationException) {
                setState { it.copy(phase = TalkPhase.IDLE, judging = false) }
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "结束录音失败: ${e.message}")
                setState {
                    it.copy(phase = TalkPhase.IDLE, judging = false, errText = e.message ?: "识别失败，请再试一次")
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 流式 ASR 的页面消费（对齐 web AiEnglishTalkPage 的 pauseHandler / startGuided / hintRows）
    // ══════════════════════════════════════════════════════════════

    /** 提示状态复位（web beginScript / nextTurn / 切模式的公共部分；hintRows 由调用方按需清） */
    private fun resetHintState() {
        hintIdx = 0
        lastHintText = ""
        fullHintGiven = false
        hintBusy = false
    }

    /**
     * 停顿处理（说过话后静音 ≥2s）：暂停 ASR → 提示下一个词并朗读 → 停 1.5s → 自动恢复录音。
     * 词提示完后给一次整句；整句给过就不再提示（不周期性打断 ASR）。
     */
    private suspend fun pauseHandler(saidSoFar: String) {
        // saidSoFar 是停顿瞬间的已说文本快照；页面侧用 state.saidText 的同一份数据，web 也未消费此参数
        @Suppress("UNUSED_PARAMETER") val unused = saidSoFar
        val s = _uiState.value
        if (s.phase != TalkPhase.RECORDING || hintBusy) return
        val line = script.lines.getOrNull(s.turn) ?: return
        val target = englishOnly(line.target)
        if (target.isEmpty()) return
        // 词已提示完 → 整句提示只给一次；之后停顿一律静默，让 ASR 连续工作到孩子点结束
        val isFull = hintIdx >= hintWords.size
        if (isFull && fullHintGiven) return
        if (isFull) fullHintGiven = true
        hintBusy = true
        setState { it.copy(phase = TalkPhase.HINTING) }
        turnAsr.pause()

        val text = if (hintIdx < hintWords.size) hintWords[hintIdx] else target
        if (hintIdx < hintWords.size) hintIdx += 1
        if (text.isNotEmpty() && text != lastHintText) {
            lastHintText = text
            val rowIdx = pushHintRow(text, isFull)
            readHintAloud(text, isFull, rowIdx) // 整句：英文读完接着读中文
        } else if (text.isNotEmpty()) {
            // 与上一条提示相同 → 只重读，不再追加记录行（web 同款）
            speak(englishOnly(text), READ_TIMEOUT_MS)
        }

        // 播完提示词停一下让 TA 消化，再自动切回 ASR 继续录
        delay(1_500)
        hintBusy = false
        if (_uiState.value.phase == TalkPhase.HINTING) {
            val resumed = turnAsr.resume()
            if (resumed) setState { it.copy(phase = TalkPhase.RECORDING) }
            else setState { it.copy(phase = TalkPhase.IDLE, errText = "麦克风恢复失败，请点「开始录音」重试") }
        }
    }

    /** 6s 完全没出过声 → 不干等：先把整句显示并朗读，再进入「第1词→前2词→…整句」阶梯测评 */
    private suspend fun startGuided() {
        val s = _uiState.value
        if (s.phase != TalkPhase.RECORDING || hintBusy || s.guidedLadderOpen) return
        val line = script.lines.getOrNull(s.turn) ?: return
        hintBusy = true
        turnAsr.stop()
        hintBusy = false
        val en = englishOnly(line.target)
        val words = splitEnWords(en)
        // 显示整句提示行（可重听，中文翻译异步补上），再「英文→中文」朗读，最后挂载单词阶梯
        val rowIdx = pushHintRow(en, true)
        setState { it.copy(phase = TalkPhase.IDLE, feedback = null) }
        readHintAloud(en, true, rowIdx)
        if (en.isEmpty()) return
        val st = EchoLadderState(
            units = words.ifEmpty { listOf(en) },
            chunks = emptyList(),
            sentence = en,
        )
        ladderState = st
        ladderRole = LadderRole.GUIDED
        setState {
            it.copy(guidedLadderOpen = true, ladder = st.view(), ladderScore = null, ladderFailCount = 0, ladderError = "")
        }
        readLadder()
    }

    /**
     * 朗读提示行：**先读英文，紧接着读中文**（只有整句提示行读中文——逐词提示读单个词的中文没教学意义还占时长）。
     * 中文等不到（超时/失败）就只读英文，不阻塞录音恢复。
     * @param rowIndex 该行在 hintRows 中的下标；换轮后下标可能被复用，故配合 turnSeq 校验
     */
    private suspend fun readHintAloud(text: String, full: Boolean, rowIndex: Int) {
        val en = englishOnly(text)
        if (en.isEmpty()) return
        val seq = turnSeq
        val zhDeferred = if (full) {
            viewModelScope.async { fetchZhTimed(en, true) }
        } else {
            null // 逐词提示不读中文
        }
        speak(en, READ_TIMEOUT_MS)
        val zh = try {
            zhDeferred?.await().orEmpty()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ""
        }
        if (!full || seq != turnSeq) return
        if (zh.isNotEmpty()) speak(zh, READ_TIMEOUT_MS)
        // 翻译是后到的 → 补写回该行，保证「提示句子的中文翻译」一定显示
        updateHintRowZh(rowIndex, zh)
    }

    /** 追加提示词记录行（逐行保留）+ 自动懒加载中文翻译（整句/单词都补）。返回该行下标 */
    private fun pushHintRow(text: String, full: Boolean): Int {
        val idx = _uiState.value.hintRows.size
        setState { it.copy(hintRows = it.hintRows + TalkHintRow(text = text, full = full)) }
        val seq = turnSeq
        viewModelScope.launch {
            val zh = fetchZh(text, full)
            if (zh.isNotEmpty() && seq == turnSeq) updateHintRowZh(idx, zh)
        }
        return idx
    }

    /** 只补空行（web：`!r.zh ? { ...r, zh } : r`），避免先到的旧翻译覆盖新翻译 */
    private fun updateHintRowZh(idx: Int, zh: String) {
        if (zh.isEmpty()) return
        setState { st ->
            st.copy(
                hintRows = st.hintRows.mapIndexed { i, r ->
                    if (i == idx && r.zh.isEmpty()) r.copy(zh = zh) else r
                },
            )
        }
    }

    /** 录音中主动朗读（提示行 🔊 / 再读 / 点读）：暂停 ASR（防录到扬声器），读完后停 1.2s 自动恢复 */
    fun playTts(t: String) {
        val en = englishOnly(t)
        if (en.isBlank()) return
        val full = splitJsWhitespace(en).size > 1 // web：/\s/.test(en) ⇒ 整句走中英连读
        playTtsJob?.cancel()
        playTtsJob = viewModelScope.launch {
            val wasRecording = _uiState.value.phase == TalkPhase.RECORDING
            if (wasRecording) {
                hintBusy = true
                setState { it.copy(phase = TalkPhase.READING) }
                turnAsr.pause()
            }
            if (full) speakPair(en) else speak(en, READ_TIMEOUT_MS)
            if (wasRecording) resumeAfterRead()
        }
    }

    /** 读完后停 1.2s 恢复录音继续计时（web playTts 尾部同款） */
    private suspend fun resumeAfterRead() {
        delay(1_200)
        hintBusy = false
        if (_uiState.value.phase == TalkPhase.READING) {
            val resumed = turnAsr.resume()
            if (resumed) setState { it.copy(phase = TalkPhase.RECORDING) }
            else setState { it.copy(phase = TalkPhase.IDLE, errText = "麦克风恢复失败，请点「开始录音」重试") }
        }
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
            // web nextTurn 开头 await turnHook.stop()：停掉可能残留的流式录音
            turnAsr.stop()
            if (next < script.lines.size) {
                turnSeq += 1
                val seq = turnSeq
                val ln = script.lines[next]
                ladderState = null
                resetHintState()
                hintWords = ln.hintWords
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
                        interimText = "",
                        hintRows = emptyList(),
                        ladder = null,
                        ladderScore = null,
                        ladderFailCount = 0,
                        ladderError = "",
                        fixLadderOpen = false,
                        guidedLadderOpen = false,
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

    /** 「🔊 再读」AI 台词（多词 ⇒ 中英连读；录音中先暂停 ASR，读完自动恢复 —— web `playTts`） */
    fun reReadAi() {
        val t = _uiState.value.aiText
        if (t.isBlank()) return
        playTts(t)
    }

    /** 「🔊 再读」正确句（多词 ⇒ 中英连读；录音中先暂停 ASR） */
    fun reReadCorrect() {
        val t = _uiState.value.feedback?.correct.orEmpty()
        if (t.isBlank()) return
        playTts(t)
    }

    /**
     * 点读单个英文单词（[com.example.ai.ui.common.EnglishWordTapText]）。
     *
     * 单词只读英文、不连读中文（追求点读手感，与 web 一致）。
     * ★ 流式 ASR 之后录音中点读不再忽略：走 [playTts] 同款「暂停 ASR → 读完 → 停 1.2s 恢复」，
     *   不会把点读声录进识别（web `speakOverride=(w)=>playTts(w)` 同口径）。
     */
    fun speakWord(word: String) {
        val w = word.trim()
        if (w.isEmpty()) return
        playTtsJob?.cancel()
        playTtsJob = viewModelScope.launch {
            val wasRecording = _uiState.value.phase == TalkPhase.RECORDING
            if (wasRecording) {
                hintBusy = true
                setState { it.copy(phase = TalkPhase.READING) }
                turnAsr.pause()
            }
            setState { it.copy(speakingWord = w) }
            try {
                speak(w, READ_TIMEOUT_MS)
            } finally {
                setState { it.copy(speakingWord = null) }
            }
            if (wasRecording) resumeAfterRead()
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
        playTtsJob?.cancel()
    }

    private fun setState(block: (EnglishTalkUiState) -> EnglishTalkUiState) {
        _uiState.value = block(_uiState.value)
    }

    override fun onCleared() {
        turnJob?.cancel()
        cancelAllJobs()
        photo.release()
        turnAsr.destroy()
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
    // ── 📷 拍照识词 ──
    /** 识词弹层状态（转发自 [EnglishTalkViewModel.photo]；`open=true` 时整屏替代设置页） */
    val photo: EnVocabPhotoState = EnVocabPhotoState(),
    /** 正在读图（防连点；web `preparingPhoto`） */
    val preparingPhoto: Boolean = false,
    /** 识图结果提示（web `vocabMsg`：成功绿 / 失败黄） */
    val vocabMsg: String = "",
    /** 上面的提示用黄底（web `vocabWarn`） */
    val vocabWarn: Boolean = false,
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
    /** 实时临时文本（流式 ASR MID_TEXT，未定稿；灰色显示在已说文本后面） */
    val interimText: String = "",
    /** 流式 ASR 音量等级 0-1（电平条） */
    val asrLevel: Float = 0f,
    /** 流式 ASR 自身的错误（鉴权失败/连接失败；与 [errText] 分开渲染，web 同款两个错误区） */
    val asrError: String = "",
    /** 「💡 提示记录」面板（逐词提示 + 整句提示逐行保留） */
    val hintRows: List<TalkHintRow> = emptyList(),
    /** 自由模式 6s 静默引导的单词阶梯是否展开（阶梯本体复用 [ladder]） */
    val guidedLadderOpen: Boolean = false,
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
