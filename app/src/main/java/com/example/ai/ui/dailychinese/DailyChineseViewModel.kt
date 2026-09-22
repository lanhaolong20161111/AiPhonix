package com.example.ai.ui.dailychinese

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.dailyzh.DailyTextSplit
import com.example.ai.data.dailyzh.DailyZhConfig
import com.example.ai.data.dailyzh.DailyZhRepository
import com.example.ai.data.dailyzh.DailyZhStore
import com.example.ai.data.ocr.OcrBoxLogic
import com.example.ai.data.ocr.OcrEngineStore
import com.example.ai.data.ocr.OcrJoinMode
import com.example.ai.data.ocr.OcrModule
import com.example.ai.data.ocr.OcrPickState
import com.example.ai.data.ocr.OcrPlatform
import com.example.ai.data.wordbank.WordBankRepository
import com.example.ai.ui.ocr.OcrPickSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/** 设置面板的四个字段（web 是 4 个 textarea） */
enum class DailyZhField { CHARS, WORDS, SENTENCES, ESSAY_TOPIC }

data class DailyChineseUiState(
    val cfg: DailyZhConfig = DailyZhConfig(),
    val draft: DailyZhConfig = DailyZhConfig(),
    val settingsOpen: Boolean = false,
    val loading: Boolean = false,
    val saving: Boolean = false,
    /** 今日没设、带入了"最近一次"内容时的提示（web `prefillHint`） */
    val prefillHint: Boolean = false,
    /** 词库命中数（chars, words）；null = 还没算完（web 的 hitInfo == null 时不显示） */
    val hitInfo: Pair<Int, Int>? = null,
    /** 拍照框选面板状态（转发自 [OcrPickSession]） */
    val ocr: OcrPickState = OcrPickState(),
    /** OCR 导入结果提示（web `ocrMsg`） */
    val ocrMsg: String = "",
    /** 上一次成功导入的字段（web `lastImportedField`） */
    val lastImportedField: DailyZhField? = null,
    /** 剩余待处理图片数（含当前这张；web `pickFiles.length`） */
    val ocrRemaining: Int = 0,
) {
    val charsTotal: Int get() = DailyTextSplit.chars(cfg.chars).size
    val wordsTotal: Int get() = DailyTextSplit.words(cfg.words).size
    val sentencesTotal: Int get() = DailyTextSplit.chars(cfg.sentences).size

    /** 正在处理一批图片 —— 期间字段上的 📷/🖼️ 置灰（web `disabled={pickFiles.length > 0}`） */
    val ocrQueueBusy: Boolean get() = ocrRemaining > 0

    /** 已导入完成、且当前没有待处理图片 ⇒ 显示「继续选一张 / 继续拍一张」（web 同条件） */
    val showOcrContinue: Boolean get() = lastImportedField != null && ocrRemaining == 0

    /** 与 web `todaySummary` 逐字一致的摘要行 */
    val todaySummary: String
        get() {
            val parts = buildList {
                if (charsTotal > 0) {
                    add("练字 $charsTotal 个" + (hitInfo?.let { "（词库命中 ${it.first}）" } ?: ""))
                }
                if (wordsTotal > 0) {
                    add("练词 $wordsTotal 个" + (hitInfo?.let { "（词库命中 ${it.second}）" } ?: ""))
                }
                if (sentencesTotal > 0) add("练句 $sentencesTotal 条")
                val topic = cfg.essayTopic.trim()
                if (topic.isNotEmpty()) add("作文「$topic」")
            }
            return if (parts.isNotEmpty()) parts.joinToString(" · ")
            else "今日内容：家长还没有设置，点右上角 ⚙️ 设置"
        }
}

/**
 * 每日语文（家长设置今日字/词/句/作文主题，孩子从 4 个入口练）
 * —— 对齐 web `DailyChinesePage`。
 *
 * 配置同步策略与 web 一致：
 * ① 进页面先读本地镜像（秒开）；已登录再拉服务端（今日 config → 无则最近一次 last 预填）；
 * ② 保存时**先存服务端再写镜像**（服务端失败也写镜像，保证本机可用）；
 * ③ 联网失败**不覆盖**镜像（只用镜像展示）。
 *
 * 拍照 OCR（web 的 📷/🖼️ + 多图队列 + 框选面板）见 [ocr] 与 [startOcr] / [confirmOcr]：
 * - **多张图片排队逐张框选**，全部确认后按图片顺序合并成一个字段值（web `joinOcrTexts`）；
 * - 「练字」按 JS 空白重切成单空格分隔，「练词/练句」按换行连接；
 * - 导入后**直接落盘 + 尝试同步**（与 web 的 `confirmOcr` 一致，不需要再点「保存」）。
 *
 * ⚠️ [ocrPlatform] 是唯一持 `Context` 的依赖（与 `ttsCache` 同套路：容器持有、构造注入），
 * ViewModel 自身不持 `Context`；单元测试传 null 时 OCR 功能静默降级为不可用。
 */
class DailyChineseViewModel(
    private val store: DailyZhStore,
    private val wordBankRepository: WordBankRepository,
    private val repository: DailyZhRepository = DailyZhRepository(),
    ocrRepository: AiChineseRepository? = null,
    ocrPlatform: OcrPlatform? = null,
    ocrEngineStore: OcrEngineStore? = null,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DailyChineseUiState())
    val uiState: StateFlow<DailyChineseUiState> = _uiState.asStateFlow()

    /** 拍照框选会话（可复用状态机；三处设置面板共用同一套实现） */
    val ocr: OcrPickSession = OcrPickSession(
        repository = ocrRepository ?: AiChineseRepository(),
        platform = ocrPlatform,
        engineStore = ocrEngineStore,
        scope = viewModelScope,
        onImport = ::confirmOcr,
    )

    /** 本批图片队列 */
    private var ocrField: DailyZhField? = null
    private var ocrUris: List<Uri> = emptyList()
    private var ocrIndex: Int = 0
    private var ocrTexts: List<String> = emptyList()

    /** 「继续选一张」时保留的原文本（追加而不是替换） */
    private var ocrBase: String = ""

    init {
        // ① 本地镜像先上屏（web：useState 初值就是 readLocalMirror()）
        val local = store.read()
        _uiState.value = _uiState.value.copy(cfg = local, draft = local)
        loadRemote()
        refreshHitInfo()
        // 框选面板状态转发进本页 state（面板本身不持有业务状态）
        viewModelScope.launch {
            ocr.state.collect { s -> _uiState.value = _uiState.value.copy(ocr = s) }
        }
    }

    override fun onCleared() {
        ocr.release()
        super.onCleared()
    }

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
                    // 今日未设但带入了最近一次 → 提示"改了要保存才生效"
                    prefillHint = res.config == null && res.last != null,
                )
            }
        }
    }

    /** 统计今日字/词在词库里的命中数（web 的 useEffect([cfg.chars, cfg.words])） */
    private fun refreshHitInfo() {
        val chars = DailyTextSplit.chars(_uiState.value.cfg.chars)
        val words = DailyTextSplit.words(_uiState.value.cfg.words)
        _uiState.value = _uiState.value.copy(hitInfo = null)
        viewModelScope.launch {
            val pair = withContext(Dispatchers.IO) {
                wordBankRepository.countCharsByTexts(chars) to wordBankRepository.countWordsByTexts(words)
            }
            _uiState.value = _uiState.value.copy(hitInfo = pair)
        }
    }

    fun openSettings() {
        // web：打开时把草稿同步成当前生效配置
        _uiState.value = _uiState.value.copy(draft = _uiState.value.cfg, settingsOpen = true)
    }

    fun closeSettings() {
        _uiState.value = _uiState.value.copy(settingsOpen = false)
    }

    fun onDraftChange(field: DailyZhField, value: String) {
        _uiState.value = _uiState.value.copy(draft = _uiState.value.draft.withField(field, value))
    }

    fun save() {
        if (_uiState.value.saving) return
        val next = _uiState.value.draft.copy(updatedAt = Instant.now().toString())
        _uiState.value = _uiState.value.copy(saving = true)
        viewModelScope.launch {
            if (TokenManager.accessToken.isNotBlank()) {
                // 失败也不阻断：仍写本地镜像（web 的 catch { /* 服务端失败仍写本地镜像 */ }）
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
            refreshHitInfo()
        }
    }

    // ───────────────────────── 拍照 OCR 导入（web `pickFor` / `onOcrFile` 等） ─────────────────────────

    /** 清掉上一次的导入提示（web 的 `setOcrMsg("")`） */
    fun clearOcrMsg() {
        _uiState.value = _uiState.value.copy(ocrMsg = "")
    }

    /**
     * 开始一批 OCR 导入。
     * @param field 目标字段（web `ocrTargetRef`）
     * @param uris 本批图片（相册可多选；拍照是一张）
     * @param append true = 「继续选一张/继续拍一张」，结果**追加**到该字段原有内容后面
     */
    fun startOcr(field: DailyZhField, uris: List<Uri>, append: Boolean = false) {
        if (uris.isEmpty()) return
        ocrField = field
        ocrUris = uris
        ocrIndex = 0
        ocrTexts = emptyList()
        ocrBase = if (append) _uiState.value.draft.fieldText(field) else ""
        _uiState.value = _uiState.value.copy(
            ocrMsg = "",
            lastImportedField = null,
            ocrRemaining = uris.size,
        )
        openCurrentOcrImage()
    }

    /** 「继续选一张 / 继续拍一张」：字段沿用上一次导入的那个（web `continueOcr`） */
    fun continueOcr(uris: List<Uri>) {
        val field = _uiState.value.lastImportedField ?: return
        startOcr(field, uris, append = true)
    }

    /** 关闭框选面板并放弃本批队列（web `closeOcr`） */
    fun closeOcr() {
        resetOcrQueue()
        ocr.close()
    }

    private fun resetOcrQueue() {
        ocrField = null
        ocrUris = emptyList()
        ocrIndex = 0
        ocrTexts = emptyList()
        ocrBase = ""
        _uiState.value = _uiState.value.copy(ocrRemaining = 0)
    }

    /** 读出当前这张图并打开框选面板 */
    private fun openCurrentOcrImage() {
        val field = ocrField ?: return
        val uri = ocrUris.getOrNull(ocrIndex) ?: return
        val platform = ocrPlatformRef ?: return
        viewModelScope.launch {
            val bytes = withContext(Dispatchers.IO) { platform.readBytes(uri) }
            if (bytes == null) {
                _uiState.value = _uiState.value.copy(ocrMsg = "❌ 图片读取失败，请换一张更清晰的照片试试")
                resetOcrQueue()
                return@launch
            }
            ocr.start(
                bytes = bytes,
                title = "📷 识别第 ${ocrIndex + 1}/${ocrUris.size} 张图片（自动去除拼音）",
                module = OcrModule.CHINESE,
                // 练字：去拼音 + 字间加空格；练词/练句：去拼音但保留分隔符
                stripPinyin = true,
                spaceChars = field == DailyZhField.CHARS,
            )
        }
    }

    /** 框选面板点「✓ 导入」：还有下一张就换图，否则合并入字段并落盘（web `confirmOcr`） */
    private fun confirmOcr(text: String) {
        val field = ocrField ?: return
        val texts = ocrTexts + text
        val nextIndex = ocrIndex + 1
        if (nextIndex < ocrUris.size) {
            ocrTexts = texts
            ocrIndex = nextIndex
            openCurrentOcrImage()
            return
        }
        // 全部图片处理完 → 按图片顺序合并（web `joinOcrTexts(field, [base, ...texts])`）
        val combined = OcrBoxLogic.joinOcrTexts(joinModeOf(field), listOf(ocrBase) + texts)
        val imageCount = texts.size
        val next = _uiState.value.draft.withField(field, combined).copy(updatedAt = Instant.now().toString())
        val nextState = _uiState.value.copy(
            draft = next,
            cfg = next,
            prefillHint = false,
            lastImportedField = field,
            ocrMsg = "",
        )
        _uiState.value = nextState
        resetOcrQueue()
        ocr.close()
        store.write(next)
        persistAfterOcr(next, combined, imageCount)
    }

    /** 导入后自动落盘 + 尝试同步（web 失败也不阻断，只是文案不同） */
    private fun persistAfterOcr(next: DailyZhConfig, combined: String, imageCount: Int) {
        if (TokenManager.accessToken.isBlank()) {
            _uiState.value = _uiState.value.copy(
                ocrMsg = "✅ 已按图片顺序导入 $imageCount 张并保存到本机（登录后可跨设备同步）",
            )
            refreshHitInfo()
            return
        }
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) { runCatching { repository.save(next) }.getOrDefault(false) }
            val msg = if (ok) {
                "✅ 已按图片顺序导入 $imageCount 张并保存（${combined.length} 字，跨设备同步）"
            } else {
                "✅ 已按图片顺序导入 $imageCount 张并保存到本机（联网同步失败，可点「保存」重试）"
            }
            _uiState.value = _uiState.value.copy(ocrMsg = msg)
            refreshHitInfo()
        }
    }

    /** 「练字」按空白重切成单空格分隔；「练词/练句」按换行连接 */
    private fun joinModeOf(field: DailyZhField): OcrJoinMode =
        if (field == DailyZhField.CHARS) OcrJoinMode.SPACE_SEPARATED else OcrJoinMode.LINE_SEPARATED

    /**
     * 唯一持 Context 的依赖（容器构造注入）。**不能**直接放进 state，也不用 `lateinit`：
     * 单元测试不传时为 null，[openCurrentOcrImage] 静默返回。
     */
    private val ocrPlatformRef: OcrPlatform? = ocrPlatform
}

/** 读某字段的文本 */
private fun DailyZhConfig.fieldText(field: DailyZhField): String = when (field) {
    DailyZhField.CHARS -> chars
    DailyZhField.WORDS -> words
    DailyZhField.SENTENCES -> sentences
    DailyZhField.ESSAY_TOPIC -> essayTopic
}

/** 写某字段的文本 */
private fun DailyZhConfig.withField(field: DailyZhField, value: String): DailyZhConfig = when (field) {
    DailyZhField.CHARS -> copy(chars = value)
    DailyZhField.WORDS -> copy(words = value)
    DailyZhField.SENTENCES -> copy(sentences = value)
    DailyZhField.ESSAY_TOPIC -> copy(essayTopic = value)
}
