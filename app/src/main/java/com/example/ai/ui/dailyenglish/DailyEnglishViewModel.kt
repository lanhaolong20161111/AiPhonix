package com.example.ai.ui.dailyenglish

import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.data.audio.AudioRecorder
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.dailyen.DailyEnConfig
import com.example.ai.data.dailyen.DailyEnRepository
import com.example.ai.data.dailyen.DailyEnStore
import com.example.ai.data.dailyen.EnSentencePair
import com.example.ai.data.dailyzh.DailyTextSplit
import com.example.ai.data.model.PhonemeScore
import com.example.ai.data.model.WordScore
import com.example.ai.data.ocr.OcrEngineStore
import com.example.ai.data.ocr.OcrModule
import com.example.ai.data.ocr.OcrPickState
import com.example.ai.data.ocr.OcrPlatform
import com.example.ai.data.speech.ScoreClient
import com.example.ai.data.tts.TtsEngine
import com.example.ai.di.NetworkModule
import com.example.ai.ui.ocr.OcrPickSession
import com.example.ai.util.SoeDisplay
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/** 设置面板的两个字段（web 是 2 个 textarea） */
enum class DailyEnField { WORDS, SENTENCES }

/** 单词卡的异步内容（web `DailyEnWordCard` 的 info + image + loading） */
data class WordCardState(
    val loading: Boolean = true,
    val translation: String = "",
    val meaning: String = "",
    val examples: List<EnSentencePair> = emptyList(),
    val imageUrl: String? = null,
)

/** 句子卡的异步内容（web `DailyEnSentenceCard` 的 info + image + loading） */
data class SentenceCardState(
    val loading: Boolean = true,
    val translation: String = "",
    val scene: String = "",
    val imageUrl: String? = null,
)

/** 一次评测的结果（对齐 web `SoeScoreState.score` + `result`） */
data class SoeOutcome(
    val text: String,
    val score: Int,
    /** 逐词得分，**已按参考文本还原大小写**（`SoeDisplay.restoreWordCase`） */
    val wordScores: List<WordScore> = emptyList(),
    /** 全局扁平音素表（单词模式直接用它渲染音素胶囊） */
    val phonemeScores: List<PhonemeScore> = emptyList(),
)

data class DailyEnglishUiState(
    val cfg: DailyEnConfig = DailyEnConfig(),
    val draft: DailyEnConfig = DailyEnConfig(),
    val settingsOpen: Boolean = false,
    val loading: Boolean = false,
    val saving: Boolean = false,
    /** 今日没设、带入了"最近一次"内容时的提示（web 里没有这个提示，但同步语义与语文一致） */
    val prefillHint: Boolean = false,
    val wordCards: Map<String, WordCardState> = emptyMap(),
    val sentenceCards: Map<String, SentenceCardState> = emptyMap(),
    /** 正在朗读的文本（英文走 TtsEngine，全局唯一，朗读期间按钮置灰） */
    val speakingText: String? = null,
    /** 正在录音的文本（null = 没在录音） */
    val soeRecordingText: String? = null,
    /** 正在评分的文本（null = 没在评分） */
    val soeEvaluatingText: String? = null,
    /** text → 评测结果（每个词/句各一条，与 web 每张卡各自持有一份 state 等价） */
    val soeOutcomes: Map<String, SoeOutcome> = emptyMap(),
    /** text → 错误信息（录音太短 / 评分失败） */
    val soeErrors: Map<String, String> = emptyMap(),
    /** 拍照框选面板状态（转发自 [DailyEnglishViewModel.ocr]） */
    val ocr: OcrPickState = OcrPickState(),
    /** OCR 导入结果提示（web `ocrMsg`；前缀 ❌ 为错误、✅ 为成功） */
    val ocrMsg: String = "",
) {
    val words: List<String> get() = DailyTextSplit.words(cfg.words)
    val sentences: List<String> get() = DailyTextSplit.sentences(cfg.sentences)

    /** 与 web `todaySummary` 逐字一致的摘要行 */
    val todaySummary: String
        get() {
            val parts = buildList {
                if (words.isNotEmpty()) add("单词 ${words.size} 个")
                if (sentences.isNotEmpty()) add("句子 ${sentences.size} 条")
            }
            return if (parts.isNotEmpty()) parts.joinToString(" · ")
            else "今日内容：家长还没有设置，点右上角 ⚙️ 设置"
        }
}

/**
 * 每日一练·英语 —— 对齐 web `DailyEnglishPage`（`web/src/pages/DailyEnglishPage.tsx`）。
 *
 * 配置同步策略与「每日语文」一致：
 * ① 进页面先读本地镜像（秒开）；已登录再拉服务端（今日 config → 无则最近一次 last 预填）；
 * ② 保存时**先存服务端再写镜像**（服务端失败也写镜像，保证本机可用）；
 * ③ 联网失败**不覆盖**镜像。
 *
 * 卡片异步内容（LLM 释义/例句/翻译/场景 + 图片）**按需逐张拉**，与 web 每张卡自己的
 * `useEffect` 一一对应；LLM 失败只是没内容，卡片仍可朗读与评测（web 的 `catch { 容错 }`）。
 *
 * ⚠️ 与 web 的有意差异：
 * - web 用 `PhonicsWord`/`PhonicsText` 给单词上色（音形对应）；Android 尚无 phonics 规则库，
 *   单词按纯文本渲染。
 * - web 的「发音要领」（本地 `lib/phonicsTips.ts` + LLM `/daily-en/phone-tips` 补充）未移植：
 *   本地要领表在 Android 不存在，只调 LLM 补不出「本地表打底」的效果。评测明细照常显示。
 *
 * 拍照 OCR 见 [ocr] / [startOcr] / [confirmOcr]（对齐 web `pickFor` / `onOcrFile` / `confirmOcr`）：
 * - ★ 与「每日语文」不同，这里是**单图**（web `e.target.files?.[0]`），没有多图队列；
 * - ★ 导入是**整字段替换**（`{...draft, [field]: text}`），不是追加；
 * - ★ **不去拼音**（web `stripPinyin={false}`）—— 目标内容本来就是英文；
 * - 导入后直接落盘 + 尝试同步，**设置面板保持打开**（web 里 `pickFile` 置空后面板还在）。
 *
 * ⚠️ [ocrPlatform] 是唯一持 `Context` 的依赖（容器持有、构造注入），ViewModel 自身不持
 * `Context`；单元测试传 null 时 OCR 静默降级为不可用。
 */
class DailyEnglishViewModel(
    private val store: DailyEnStore,
    private val repository: DailyEnRepository = DailyEnRepository(),
    private val ttsEngine: TtsEngine? = null,
    private val audioRecorder: AudioRecorder = AudioRecorder(),
    private val scoreClient: ScoreClient = ScoreClient(NetworkModule.httpClient),
    ocrRepository: AiChineseRepository? = null,
    ocrPlatform: OcrPlatform? = null,
    ocrEngineStore: OcrEngineStore? = null,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DailyEnglishUiState())
    val uiState: StateFlow<DailyEnglishUiState> = _uiState.asStateFlow()

    private var evalJob: Job? = null

    /** 拍照框选会话（与「每日语文」共用同一套可复用状态机） */
    val ocr: OcrPickSession = OcrPickSession(
        repository = ocrRepository ?: AiChineseRepository(),
        platform = ocrPlatform,
        engineStore = ocrEngineStore,
        scope = viewModelScope,
        onImport = ::confirmOcr,
    )

    /** 唯一持 Context 的依赖；单测不传时为 null ⇒ [startOcr] 静默返回 */
    private val ocrPlatformRef: OcrPlatform? = ocrPlatform

    /** 当前这张图要导入到哪个字段（web `ocrTargetRef`） */
    private var ocrField: DailyEnField? = null

    init {
        // ① 本地镜像先上屏（web：useState 初值就是 readLocalMirror()）
        val local = store.read()
        _uiState.value = _uiState.value.copy(cfg = local, draft = local)
        ensureCards()
        loadRemote()
        // 框选面板状态转发进本页 state（面板本身不持有业务状态）
        viewModelScope.launch {
            ocr.state.collect { s -> _uiState.value = _uiState.value.copy(ocr = s) }
        }
    }

    override fun onCleared() {
        ocr.release()
        // 页面被销毁时若仍在录音，必须显式停止，否则麦克风被占（对齐 web 卸载时 destroy recorder）
        audioRecorder.stop()
        super.onCleared()
    }

    // ── 配置同步 ──

    private fun loadRemote() {
        if (TokenManager.accessToken.isBlank()) return // 未登录：只用镜像（web 同）
        _uiState.value = _uiState.value.copy(loading = true)
        viewModelScope.launch {
            val res = repository.fetch()
            val st = _uiState.value
            _uiState.value = if (res == null) {
                // 联网失败 → 保留当前（镜像）内容，只关掉 loading
                st.copy(loading = false)
            } else {
                val next = res.config ?: res.last ?: store.read()
                store.write(next)
                st.copy(
                    cfg = next,
                    draft = next,
                    loading = false,
                    prefillHint = res.config == null && res.last != null,
                )
            }
            ensureCards()
        }
    }

    fun openSettings() {
        // web：打开时把草稿同步成当前生效配置
        _uiState.value = _uiState.value.copy(draft = _uiState.value.cfg, settingsOpen = true)
    }

    fun closeSettings() {
        _uiState.value = _uiState.value.copy(settingsOpen = false)
    }

    fun onDraftChange(field: DailyEnField, value: String) {
        val d = _uiState.value.draft
        val next = when (field) {
            DailyEnField.WORDS -> d.copy(words = value)
            DailyEnField.SENTENCES -> d.copy(sentences = value)
        }
        _uiState.value = _uiState.value.copy(draft = next)
    }

    fun save() {
        if (_uiState.value.saving) return
        val next = _uiState.value.draft.copy(updatedAt = Instant.now().toString())
        _uiState.value = _uiState.value.copy(saving = true)
        viewModelScope.launch {
            if (TokenManager.accessToken.isNotBlank()) {
                // 失败也不阻断：仍写本地镜像（web 的 catch { /* 失败仍写本地镜像 */ }）
                withContext(Dispatchers.IO) { repository.save(next) }
            }
            store.write(next)
            _uiState.value = _uiState.value.copy(
                cfg = next,
                draft = next,
                saving = false,
                settingsOpen = false,
                prefillHint = false,
            )
            ensureCards()
        }
    }

    // ── 卡片异步内容 ──

    /** 为当前配置里每个新出现的词/句建卡并拉内容（幂等：已有卡不重复拉） */
    private fun ensureCards() {
        val st = _uiState.value
        for (w in st.words) {
            if (_uiState.value.wordCards.containsKey(w)) continue
            _uiState.value = _uiState.value.copy(wordCards = _uiState.value.wordCards + (w to WordCardState()))
            loadWordCard(w)
        }
        for (s in st.sentences) {
            if (_uiState.value.sentenceCards.containsKey(s)) continue
            _uiState.value = _uiState.value.copy(sentenceCards = _uiState.value.sentenceCards + (s to SentenceCardState()))
            loadSentenceCard(s)
        }
    }

    private fun loadWordCard(word: String) {
        viewModelScope.launch {
            // web 是 Promise.all([fetchWordInfo, fetchDailyImage]) —— 并发，别串行
            val infoDeferred = async { repository.fetchWordInfo(word) }
            val imageDeferred = async { repository.fetchImage(word, "word") }
            val info = infoDeferred.await()
            val image = imageDeferred.await()
            val cur = _uiState.value.wordCards[word] ?: return@launch
            _uiState.value = _uiState.value.copy(
                wordCards = _uiState.value.wordCards + (word to cur.copy(
                    loading = false,
                    translation = info?.translation ?: "",
                    meaning = info?.meaning ?: "",
                    examples = info?.sentences ?: emptyList(),
                    imageUrl = image?.let { repository.imageUrl(it) },
                )),
            )
        }
    }

    private fun loadSentenceCard(sentence: String) {
        viewModelScope.launch {
            val infoDeferred = async { repository.fetchSentenceInfo(sentence) }
            val imageDeferred = async { repository.fetchImage(sentence, "sentence") }
            val info = infoDeferred.await()
            val image = imageDeferred.await()
            val cur = _uiState.value.sentenceCards[sentence] ?: return@launch
            _uiState.value = _uiState.value.copy(
                sentenceCards = _uiState.value.sentenceCards + (sentence to cur.copy(
                    loading = false,
                    translation = info?.translation ?: "",
                    scene = info?.scene ?: "",
                    imageUrl = image?.let { repository.imageUrl(it) },
                )),
            )
        }
    }

    // ── 朗读（英文一律走 TtsEngine；本页内容按构造就是英文） ──

    fun speak(text: String) {
        if (text.isBlank()) return
        val engine = ttsEngine ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(speakingText = text)
            try {
                engine.speak(text)
            } finally {
                _uiState.value = _uiState.value.copy(speakingText = null)
            }
        }
    }

    // ── 发音评测（录音 → 停止 → 上传 SOE → 显示分数与明细） ──

    /**
     * 开始录音（挂起到 [stopSoe]）。
     *
     * [sentenceMode] 决定腾讯的 `eval_mode`：
     * - 单词 → `"0"`；句子/例句 → `"1"`
     *
     * 这两个值与 web 传的 `scene="word"/"sentence"` **完全等价** ——
     * 服务端 `server_cf/src/lib/soe.ts` 的 `resolveEvalMode()` 里
     * `scene → {word:["0",30], sentence:["1",120]}`，与 `eval_mode` 直传的映射逐位相同。
     * ⚠️ 千万别省成 `""`（自动判定）：英文自动判定下句子上限只有 30 字符，长句会被截断。
     */
    fun startSoe(text: String, sentenceMode: Boolean) {
        val s = _uiState.value
        if (text.isBlank() || s.soeRecordingText != null || s.soeEvaluatingText != null) return
        _uiState.value = s.copy(
            soeRecordingText = text,
            soeErrors = s.soeErrors - text,
            soeOutcomes = s.soeOutcomes - text,
        )
        evalJob?.cancel()
        evalJob = viewModelScope.launch {
            try {
                audioRecorder.reset()
                val pcm = audioRecorder.record()
                if (pcm.size < MIN_AUDIO_BYTES) throw RuntimeException("录音太短，请再读一次")
                _uiState.value = _uiState.value.copy(soeRecordingText = null, soeEvaluatingText = text)
                val result = withContext(Dispatchers.IO) {
                    scoreClient.evaluate(
                        refText = text,
                        audioBase64 = Base64.encodeToString(pcm, Base64.NO_WRAP),
                        engine = ENGINE_EN,
                        evalMode = if (sentenceMode) "1" else "0",
                    )
                }
                _uiState.value = _uiState.value.copy(
                    soeEvaluatingText = null,
                    soeOutcomes = _uiState.value.soeOutcomes + (text to SoeOutcome(
                        text = text,
                        score = result.totalScore,
                        // 腾讯英文引擎返回的 word 一律小写（"I"→"i"），按参考文本还原大小写（web withRefCase）
                        wordScores = SoeDisplay.restoreWordCase(result.wordScores, text),
                        phonemeScores = result.phonemeScores,
                    )),
                )
            } catch (e: CancellationException) {
                throw e // 协程取消不是错误，必须原样抛出（AGENTS.md）
            } catch (e: Exception) {
                Log.w(TAG, "评测失败: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    soeRecordingText = null,
                    soeEvaluatingText = null,
                    soeErrors = _uiState.value.soeErrors + (text to (e.message ?: "评测失败")),
                )
            }
        }
    }

    /** 停止录音（触发评测） */
    fun stopSoe() {
        if (_uiState.value.soeRecordingText != null) audioRecorder.stop()
    }

    // ───────────────────────── 拍照 OCR 导入（web `pickFor` / `onOcrFile` / `confirmOcr`） ─────────────────────────

    /** 清掉上一次的导入提示（web `setOcrMsg("")`） */
    fun clearOcrMsg() {
        _uiState.value = _uiState.value.copy(ocrMsg = "")
    }

    /**
     * 开始一次 OCR（**单图**，与 web 的 `e.target.files?.[0]` 一致）。
     *
     * 注意：web 的相册入口**没有** `multiple`，所以每次只处理一张；界面上的 📷/🖼️
     * 都只传一个 uri。
     */
    fun startOcr(field: DailyEnField, uris: List<Uri>) {
        val uri = uris.firstOrNull() ?: return
        val platform = ocrPlatformRef ?: return
        ocrField = field
        _uiState.value = _uiState.value.copy(ocrMsg = "")
        viewModelScope.launch {
            val bytes = withContext(Dispatchers.IO) { platform.readBytes(uri) }
            if (bytes == null) {
                _uiState.value = _uiState.value.copy(ocrMsg = "❌ 图片读取失败，请换一张更清晰的照片试试")
                ocrField = null
                return@launch
            }
            ocr.start(
                bytes = bytes,
                // web 标题逐字一致（不带"第 n/m 张"后缀：这里是单图）
                title = "📷 识别要导入的内容",
                module = OcrModule.CHINESE,
                // ★ 不去拼音：目标内容本来就是英文（web `stripPinyin={false}`）
                stripPinyin = false,
                spaceChars = false,
            )
        }
    }

    /** 关闭框选面板（放弃本次导入） */
    fun closeOcr() {
        ocrField = null
        ocr.close()
    }

    /** 框选面板点「✓ 导入」：**整字段替换**（web `{...draft, [field]: text}`），然后落盘 + 同步 */
    private fun confirmOcr(text: String) {
        val field = ocrField
        ocrField = null
        ocr.close()
        if (field == null) return
        val next = _uiState.value.draft.withField(field, text).copy(updatedAt = Instant.now().toString())
        _uiState.value = _uiState.value.copy(draft = next, cfg = next, prefillHint = false)
        store.write(next)
        ensureCards()
        persistAfterOcr(next, text.length)
    }

    /** 导入后自动落盘 + 尝试同步（web 失败也不阻断，只是文案不同） */
    private fun persistAfterOcr(next: DailyEnConfig, charCount: Int) {
        if (TokenManager.accessToken.isBlank()) {
            _uiState.value = _uiState.value.copy(
                ocrMsg = "✅ 已导入并保存到本机（登录后可跨设备同步）",
            )
            return
        }
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) { runCatching { repository.save(next) }.getOrDefault(false) }
            val msg = if (ok) {
                // ★ web 用的是「字符」不是「字」（英文内容按字符数更贴切）
                "✅ 已导入并保存（$charCount 字符，跨设备同步）"
            } else {
                "✅ 已导入并保存到本机（联网同步失败，可在设置里点「保存」重试）"
            }
            _uiState.value = _uiState.value.copy(ocrMsg = msg)
        }
    }

    companion object {
        private const val TAG = "DailyEnglishViewModel"

        /** 腾讯英文评测引擎（与 web `SoeButton` 的默认 `engine="16k_en"` 一致） */
        const val ENGINE_EN = "16k_en"

        /** 最短有效录音（0.4 秒 PCM 16kHz 16bit ≈ 12800 字节；web `PcmRecorder` 同阈值） */
        private const val MIN_AUDIO_BYTES = 12800
    }
}

/** 写某字段的文本（照片 OCR 导入用：整字段替换） */
private fun DailyEnConfig.withField(field: DailyEnField, value: String): DailyEnConfig = when (field) {
    DailyEnField.WORDS -> copy(words = value)
    DailyEnField.SENTENCES -> copy(sentences = value)
}
