package com.example.ai.ui.ocr

import android.graphics.Bitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.data.envocab.EnVocab
import com.example.ai.data.envocab.EnVocabExtract
import com.example.ai.data.ocr.OcrEngine
import com.example.ai.data.ocr.OcrEngineStore
import com.example.ai.data.ocr.OcrPlatform
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 识词弹层的识别阶段（web `ParseStage` 的三个值） */
object EnVocabStage {
    const val PREPARING = "preparing"
    const val UPLOADING = "uploading"
    const val RECOGNIZING = "recognizing"

    /** 阶段文案（web `stageText` 逐字一致） */
    fun text(stage: String): String = when (stage) {
        PREPARING -> "🖼️ 正在处理图片…"
        UPLOADING -> "⬆️ 正在上传…"
        else -> "🔍 AI 正在识别整页文字（约 10~30 秒，请稍候）…"
    }
}

/**
 * 「拍照识词」弹层的全部状态。
 *
 * 词句与勾选状态**不在这里推导**（推导规则在 [EnVocabExtract]，已有单测）；
 * 这里只保存 [vocab] 快照 + 两组「被取消勾选的条目」，派生选择结果。
 *
 * ★ 勾选用**词/句本身**而不是下标（与 web 同一考虑）：重新识别或改原文后下标会变，
 * 用下标记会把勾选状态错位到别的词上。
 */
data class EnVocabPhotoState(
    val open: Boolean = false,
    /** 识别中（web `busy = stage !== null`）—— 期间禁止关闭弹层 */
    val busy: Boolean = false,
    val stage: String = EnVocabStage.PREPARING,
    /** 识别原文（可编辑，也是抽词的唯一数据源） */
    val text: String = "",
    val error: String = "",
    /** 展开「识别原文」编辑器 */
    val editOpen: Boolean = false,
    /** 抽词开关：是否保留 a/the/is 等虚词 */
    val keepStop: Boolean = false,
    val offWords: Set<String> = emptySet(),
    val offSentences: Set<String> = emptySet(),
    val engine: OcrEngine = OcrEngine.AUTO,
    /** text 非空白时的抽词结果；否则为 null（等价 web 的 `vocab`） */
    val vocab: EnVocab? = null,
) {
    val selWords: List<String> get() = vocab?.words.orEmpty().filterNot { it in offWords }
    val selSentences: List<String> get() = vocab?.sentences.orEmpty().filterNot { it in offSentences }

    /** 至少要留一个单词或句子才能出题 */
    val canImport: Boolean get() = selWords.isNotEmpty() || selSentences.isNotEmpty()

    /** 底部左侧提示（web `envocab-foot-hint`） */
    val footHint: String
        get() = if (canImport) {
            "将导入：${selWords.size} 个单词、${selSentences.size} 个句子"
        } else {
            "至少要留一个单词或句子"
        }

    /** 阶段文案 */
    val stageText: String get() = EnVocabStage.text(stage)
}

/**
 * 「拍照 / 相册 → **整页**识别 → 抽词句 → 勾选导入」的可复用会话状态机，
 * 逐条对齐 web `web/src/components/EnVocabPhotoSheet.tsx`。
 *
 * ★ 与 [OcrPickSession]（手动拖框）的区别：这里**不框选** —— 目标是「把这一页的词句都捞出来」，
 * 而不是精修某几行。识别**一打开就跑**，不需要用户再点一次。
 *
 * ★ 与 web 的唯一有意差异：[EnVocabStage.UPLOADING] 这一档在 Android 侧**不可达**
 * —— web 的 `parseImage` 会回调 `setStage("uploading")`（XHR 上传阶段），
 * 而 Android 的 `AiChineseRepository.parseImage` 是「一次 await 到底」，
 * 中间没有阶段回调 ⇒ 只用「处理图片 / 识别中」两档。文案本身保持一致。
 */
class EnVocabPhotoSession(
    private val repository: AiChineseRepository,
    private val platform: OcrPlatform?,
    private val engineStore: OcrEngineStore?,
    private val scope: CoroutineScope,
    /** 点「✓ 用这些词句出题」时回调。**空列表也会回调**（web 的 `onDone(selWords, selSentences)` 同） */
    private val onDone: (words: List<String>, sentences: List<String>) -> Unit,
) {

    private val _state = MutableStateFlow(EnVocabPhotoState())
    val state: StateFlow<EnVocabPhotoState> = _state.asStateFlow()

    /** 给 UI 预览的图（EXIF 转正 + ≤1600px）。`EnVocabPhotoState` 刻意不含 Bitmap，保持纯数据 */
    var image: Bitmap? by mutableStateOf(null)
        private set

    private var raw: ByteArray? = null
    private var canonical: OcrPlatform.Canonical? = null
    private var job: Job? = null

    /** 打开弹层（web 挂载时 `useEffect` 直接 `run(false)`） */
    fun start(bytes: ByteArray) {
        canonical?.bitmap?.let { if (!it.isRecycled) it.recycle() }
        canonical = null
        image = null
        raw = bytes
        _state.value = EnVocabPhotoState(
            open = true,
            busy = true,
            stage = EnVocabStage.PREPARING,
            engine = engineStore?.read() ?: OcrEngine.AUTO,
        )
        run(noCache = false)
    }

    fun close() {
        job?.cancel()
        _state.value = EnVocabPhotoState()
    }

    /** 页面销毁时调用（VM `onCleared`）—— 真正回收预览位图 */
    fun release() {
        close()
        image = null
        canonical?.bitmap?.let { if (!it.isRecycled) it.recycle() }
        canonical = null
        raw = null
    }

    /** 换识别模型：立即落盘，**不自动重跑**（web 明确提示「换模型后点「🔄 重新识别」生效」） */
    fun setEngine(engine: OcrEngine) {
        engineStore?.write(engine)
        _state.value = _state.value.copy(engine = engine)
    }

    /** 「🔄 重新识别」/「🔄 重试」：跳过缓存重跑 */
    fun retry() = run(noCache = true)

    fun toggleEdit() {
        _state.value = _state.value.copy(editOpen = !_state.value.editOpen)
    }

    /** 编辑识别原文 → 实时重算词句（web 的 `useMemo([text, keepStop])`）。
     *  注意：**不清空**勾选状态（web 同 —— 只有重跑与切虚词开关才清）。 */
    fun onTextChange(text: String) {
        _state.value = _state.value.copy(text = text, vocab = recompute(text, _state.value.keepStop))
    }

    /** 切换「包含虚词」：词表整体变了 ⇒ 清空勾选重来（web `toggleKeepStop`） */
    fun toggleKeepStop() {
        val next = !_state.value.keepStop
        _state.value = _state.value.copy(
            keepStop = next,
            offWords = emptySet(),
            offSentences = emptySet(),
            vocab = recompute(_state.value.text, next),
        )
    }

    fun toggleWord(word: String) {
        val s = _state.value
        _state.value = s.copy(offWords = if (word in s.offWords) s.offWords - word else s.offWords + word)
    }

    fun toggleSentence(sentence: String) {
        val s = _state.value
        _state.value = s.copy(
            offSentences = if (sentence in s.offSentences) s.offSentences - sentence else s.offSentences + sentence,
        )
    }

    fun selectAll() {
        _state.value = _state.value.copy(offWords = emptySet(), offSentences = emptySet())
    }

    fun selectNone() {
        val v = _state.value.vocab
        _state.value = _state.value.copy(
            offWords = v?.words.orEmpty().toSet(),
            offSentences = v?.sentences.orEmpty().toSet(),
        )
    }

    /** 点「✓ 用这些词句出题」 */
    fun confirm() {
        onDone(_state.value.selWords, _state.value.selSentences)
    }

    // ───────────────────────── 内部 ─────────────────────────

    private fun recompute(text: String, keepStop: Boolean): EnVocab? =
        if (text.isBlank()) null else EnVocabExtract.extractEnglishVocab(text, keepStop = keepStop)

    /** 整页识别（web `run`）：清空错误/原文/勾选 → 处理图片 → 识别 → 抽词 */
    private fun run(noCache: Boolean) {
        job?.cancel()
        _state.value = _state.value.copy(
            busy = true,
            stage = EnVocabStage.PREPARING,
            error = "",
            text = "",
            vocab = null,
            offWords = emptySet(),
            offSentences = emptySet(),
        )
        val p = platform
        val b = raw
        if (p == null || b == null) {
            _state.value = _state.value.copy(busy = false, error = "当前环境不支持图片处理")
            return
        }
        job = scope.launch {
            // ① 处理图片（EXIF 转正 + 缩到 ≤1600px + JPEG 85）：预览与上传用同一份
            var c = canonical
            if (c == null) {
                c = p.canonicalize(b)
                if (c == null) {
                    if (!_state.value.open) return@launch
                    _state.value = _state.value.copy(
                        busy = false,
                        error = "图片读取失败，请换一张更清晰的照片试试",
                    )
                    return@launch
                }
                if (!_state.value.open) {
                    c.bitmap.recycle()
                    return@launch
                }
                canonical = c
                image = c.bitmap
            }
            // ② 识别（web 传 mode="english"：服务端跳过多音字与中文去噪）
            _state.value = _state.value.copy(stage = EnVocabStage.RECOGNIZING)
            val text = try {
                val res = repository.parseImage(
                    bytes = c.jpeg,
                    mode = "english",
                    engine = engineQuery(_state.value.engine),
                    forceRefresh = noCache,
                )
                // web: ((res.text ?? "") || blocks.map(text).join("\n")).trim()
                (res.text.ifBlank { res.blocks.joinToString("\n") { it.text } }).trim()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (!_state.value.open) return@launch
                _state.value = _state.value.copy(busy = false, error = e.message ?: "识别失败，请重试")
                return@launch
            }
            if (!_state.value.open) return@launch
            if (text.isEmpty()) {
                _state.value = _state.value.copy(
                    busy = false,
                    error = "没识别到文字，换一张更清晰、更正的照片试试（别反光、别拍歪）",
                )
                return@launch
            }
            _state.value = _state.value.copy(
                busy = false,
                text = text,
                error = "",
                vocab = recompute(text, _state.value.keepStop),
            )
        }
    }

    /** 服务端 `engine` 参数：`auto` 不传（与 web `if (engine !== "auto")` 同口径） */
    private fun engineQuery(engine: OcrEngine): String =
        if (engine == OcrEngine.AUTO) "" else engine.wire
}
