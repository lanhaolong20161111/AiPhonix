package com.example.ai.ui.subtitlecapture

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.Word
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.data.subtitlecapture.BiliItem
import com.example.ai.data.subtitlecapture.CaptureItem
import com.example.ai.data.subtitlecapture.CaptureOutcome
import com.example.ai.data.subtitlecapture.CaptureRect
import com.example.ai.data.subtitlecapture.CaptureRequest
import com.example.ai.data.subtitlecapture.EvalCardModel
import com.example.ai.data.subtitlecapture.LastMovie
import com.example.ai.data.subtitlecapture.MovieSource
import com.example.ai.data.subtitlecapture.SoeWordItem
import com.example.ai.data.subtitlecapture.SubtitleCaptureLogic
import com.example.ai.data.subtitlecapture.SubtitleCaptureRepository
import com.example.ai.data.subtitlecapture.SubtitleCaptureStore
import com.example.ai.data.subtitlecapture.SubtitleMark
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.data.tts.TtsEngine
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 字幕采集的 UI 状态（对齐 web `SubtitleCapturePage` 的一堆 `useState`）。
 *
 * 派生量（`canCapture` / `activeMark` / `visibleCards` / 各种空态文案）全部放这里 ——
 * `AGENTS.md` 要求计算逻辑上移 ViewModel，composable 里只做渲染。
 */
data class SubtitleCaptureUiState(
    val source: MovieSource = MovieSource.NONE,
    val movieName: String = "",
    /** 本地 `content://` 或云端 `http(s)://`；B站为 iframe 预览，此处为空 */
    val videoUri: String = "",
    val biliUrl: String = "",
    val videoW: Int = 0,
    val videoH: Int = 0,
    val durationMs: Long = 0L,
    val positionMs: Long = 0L,
    val playing: Boolean = false,
    val rect: CaptureRect? = null,
    val editing: Boolean = false,
    /** 播放器容器（显示区）尺寸，画框坐标的坐标系 */
    val stageW: Int = 0,
    val stageH: Int = 0,
    val busy: Boolean = false,
    val evaluating: Boolean = false,
    val msg: String = "",
    val items: List<CaptureItem> = emptyList(),
    val delMode: Boolean = false,
    val selected: Set<Int> = emptySet(),
    val evalCards: List<EvalCardModel> = emptyList(),
    /** 当前影片的书签（按 ts 升序） */
    val marks: List<SubtitleMark> = emptyList(),
    val autoReview: Boolean = false,
    val lang: String = "en",
    val soeRecording: Boolean = false,
    val soeEvaluating: Boolean = false,
    val soeScore: Int? = null,
    val soeWords: List<SoeWordItem> = emptyList(),
    val soePopup: Boolean = false,
    val soeError: String = "",
    val biliResults: List<BiliItem> = emptyList(),
    val biliSearching: Boolean = false,
    val biliSearchMsg: String = "",
    val pickerOpen: Boolean = false,
    val urlInput: String = "",
    val biliKeyword: String = "",
    /** 自动复习命中书签，等 Screen 把播放器暂停后再消费（状态驱动，不用事件通道） */
    val pendingAutoPauseTs: Long? = null,
    /** 从上次影片恢复时要定位到的进度（ms），Screen 定位后要调 `consumeResume()` */
    val pendingResumeMs: Long = 0L,
) {
    val canCapture: Boolean get() = source.canCapture
    val hasVideo: Boolean get() = videoUri.isNotBlank()
    val hasAnySource: Boolean get() = videoUri.isNotBlank() || biliUrl.isNotBlank()

    /** 当前播放头命中的书签（±800ms）——测评区只显示它 */
    val activeMark: SubtitleMark? get() = SubtitleCaptureLogic.findActiveMark(marks, positionMs)

    /** 画框换算到视频像素坐标（Screen 取帧与 VM 组 meta 共用，避免两处算法漂移） */
    val videoCropRect: CaptureRect?
        get() = rect?.let { SubtitleCaptureLogic.toVideoRect(it, stageW, stageH, videoW, videoH) }

    /** 本片截图（时间戳升序） */
    val movieItems: List<CaptureItem> get() = SubtitleCaptureLogic.marksOfMovie(items, movieName)

    /** 需要红框预警的「时间相近」截图 seq */
    val nearSeqs: Set<Int> get() = SubtitleCaptureLogic.nearDuplicateSeqs(movieItems)

    /** 已经有书签的 seq（列表里描橙色边） */
    val markSeqs: Set<Int> get() = marks.map { it.seq }.toSet()

    /**
     * 测评区当前该显示哪几张卡 —— 与 web `visibleEvals` 逐条对齐：
     * ① 有书签：只显示播放头命中的那一条（命不中就是空，历史缓存全隐藏）；
     *    完整 LLM 结果没拉到时先用书签里的字幕占位（`fromMark`）。
     * ② 无书签：显示"暂停自动识别"的最新一条 live，不显示历史缓存。
     */
    val visibleCards: List<EvalCardModel>
        get() {
            if (marks.isNotEmpty()) {
                val hit = activeMark ?: return emptyList()
                val full = evalCards.firstOrNull { it.seq == hit.seq }
                val base = full ?: EvalCardModel(
                    seq = hit.seq,
                    timestampText = hit.tsText,
                    movieName = movieName,
                    subtitleText = hit.subtitle,
                    translation = hit.translation,
                    fromMark = true,
                )
                return listOf(base.copy(soeScore = hit.soeScore, soeWords = hit.soeWords))
            }
            val live = evalCards.firstOrNull { it.live }
            return if (live != null) listOf(live) else emptyList()
        }

    /** 跟读评测的参考文本：优先当前激活书签的字幕，否则最近一次识别结果（web `soeRefText`） */
    val soeRefText: String
        get() = activeMark?.subtitle.orEmpty()
            .ifBlank { evalCards.firstOrNull()?.subtitleText.orEmpty() }

    val soeEnabled: Boolean get() = soeRefText.isNotBlank() && !soeEvaluating

    /** 测评区空态文案（与 web 逐字一致） */
    val evalEmptyText: String
        get() = when {
            marks.isNotEmpty() && activeMark == null ->
                "播放到标记的时间戳点才会显示测评（共 ${marks.size} 个标记）"
            marks.isEmpty() && !evaluating -> "暂停播放即可自动生成当前帧测评"
            else -> ""
        }

    val evalLocatedText: String?
        get() = activeMark?.let { "📍 已定位到字幕点 ${it.tsText}（共 ${marks.size} 个标记）" }

    /** 无影片时的测评区提示 */
    val evalNoVideoText: String
        get() = if (source == MovieSource.BILI) {
            "🎬 当前为 B站预览模式，不支持测评/采集。请用「📁 本地」或「🔗 云端直链」选片"
        } else {
            "请先选择本地 / 云端 / B站影片"
        }

    val listEmptyText: String get() = "当前影片还没有截图（先「💾 存图」或「🔍 识别当前帧」生成截图）"

    val nearWarningText: String?
        get() = if (nearSeqs.isEmpty()) null
        else "🔴 以下 ${nearSeqs.size} 张截图时间相近（<1.5s），方框为字幕采集区域"

    val playerPlaceholder: String get() = "点「🎞️ 影片」选择本地文件 / 云端直链 / B站"
}

/**
 * 字幕采集 ViewModel。
 *
 * ★ 刻意**不持有** `Context` / `ExoPlayer`（`AGENTS.md`）：播放器与取帧器由 Screen 持有，
 * Screen 只把「播放头 / 时长 / 尺寸 / 一帧的 PNG 字节」推进来 —— 这样单测不必造 Android 环境，
 * 也让「重放/旋转/重建」这类只会发生一次的坑集中在 Screen 一处。
 *
 * 时间轴相关的逻辑（书签命中、自动复习命中、近邻分组、画框 clamp）全在
 * [SubtitleCaptureLogic] 里（纯函数 + 单测），本类只做编排。
 */
class SubtitleCaptureViewModel(
    private val repository: SubtitleCaptureRepository,
    private val store: SubtitleCaptureStore,
    private val speechRepository: SpeechRepository,
    private val ttsCache: BaiduTtsCache? = null,
    private val ttsEngine: TtsEngine? = null,
) : ViewModel() {

    private val _state = kotlinx.coroutines.flow.MutableStateFlow(SubtitleCaptureUiState())
    val state: kotlinx.coroutines.flow.StateFlow<SubtitleCaptureUiState> = _state

    private var popupJob: Job? = null
    private var autoPauseJob: Job? = null

    /** 拖拽/缩放的起手快照（web `dragRef`）——只在手势期间有效，不进 UI 状态 */
    private var dragStart: CaptureRect? = null

    private var lastSavedSecond: Long = -1L

    init {
        loadList()
    }

    private fun update(block: (SubtitleCaptureUiState) -> SubtitleCaptureUiState) {
        _state.value = block(_state.value)
    }

    private fun msg(text: String) = update { it.copy(msg = text) }

    // ────────────────────────── 选片 ──────────────────────────

    /** 本地文件（Screen 走 SAF 拿到 URI 与显示名；调用方负责 takePersistableUriPermission）。 */
    fun openLocal(uri: String, displayName: String, resumeMs: Long = 0L) {
        if (uri.isBlank()) return
        val name = SubtitleCaptureLogic.stripExtension(displayName).ifBlank { "movie" }
        store.writeLastMovie(name, uri, resumeMs)
        update {
            it.copy(
                source = MovieSource.LOCAL,
                videoUri = uri,
                biliUrl = "",
                movieName = name,
                rect = null,
                editing = false,
                videoW = 0,
                videoH = 0,
                durationMs = 0L,
                positionMs = 0L,
                pickerOpen = false,
                pendingResumeMs = resumeMs,
                marks = store.marksOf(name),
                msg = "",
            )
        }
    }

    /** 云端直链（web `openUrl`）。 */
    fun openUrl(url: String) {
        val u = url.trim()
        if (u.isEmpty()) return
        openHttpSource(u, SubtitleCaptureLogic.movieNameFromUrl(u), 0L)
    }

    /**
     * 打开 http(s) 源。[resumeMs] 只在从上次影片恢复时非 0（web 的 `<video>` 恢复进度）。
     * ★ 与 [openLocal] 分开是为了**保住来源身份** —— 恢复一个云端直链却标成「本地文件」，
     *   会让「B站/云端不能采集」这类提示与判定错位。
     */
    private fun openHttpSource(u: String, name: String, resumeMs: Long) {
        store.writeLastMovie(name, u, resumeMs)
        update {
            it.copy(
                source = MovieSource.URL,
                videoUri = u,
                biliUrl = "",
                movieName = name,
                rect = null,
                editing = false,
                videoW = 0,
                videoH = 0,
                durationMs = 0L,
                positionMs = 0L,
                pickerOpen = false,
                urlInput = "",
                pendingResumeMs = resumeMs,
                marks = store.marksOf(name),
                msg = "🔗 云端视频：若截图失败，说明该源未开放 CORS，只能播放不能采集",
            )
        }
    }

    /** B站预览（web `applyBili`）——只浏览，不画框/不截图/不采集。 */
    fun openBili(bvid: String) {
        if (bvid.isBlank()) return
        update {
            it.copy(
                source = MovieSource.BILI,
                biliUrl = SubtitleCaptureLogic.biliPlayerUrl(bvid),
                videoUri = "",
                movieName = bvid,
                rect = null,
                editing = false,
                videoW = 0,
                videoH = 0,
                durationMs = 0L,
                positionMs = 0L,
                pickerOpen = false,
                marks = store.marksOf(bvid),
                msg = "🎬 B站预览模式：仅浏览，不支持画框/截图/采集",
            )
        }
    }

    /** 启动时恢复上次影片（web 从 IndexedDB 取回文件 + localStorage 取进度）。 */
    fun restoreLastMovieIfIdle() {
        if (_state.value.hasAnySource) return
        val last: LastMovie = store.readLastMovie() ?: return
        if (last.uri.isBlank() || last.movieName.isBlank()) return
        if (last.uri.startsWith("http")) {
            openHttpSource(last.uri, last.movieName, last.lastTimeMs)
        } else {
            // 本地 SAF URI：能恢复的前提是当初 takePersistableUriPermission 过（Screen 负责）
            openLocal(last.uri, last.movieName, last.lastTimeMs)
        }
    }

    fun consumeResume() = update { it.copy(pendingResumeMs = 0L) }

    fun setPickerOpen(open: Boolean) = update { it.copy(pickerOpen = open) }
    fun setUrlInput(v: String) = update { it.copy(urlInput = v) }
    fun setBiliKeyword(v: String) = update { it.copy(biliKeyword = v) }

    fun searchBili() {
        val kw = _state.value.biliKeyword.trim()
        if (kw.isEmpty()) return
        update { it.copy(biliSearching = true, biliSearchMsg = "") }
        viewModelScope.launch {
            repository.searchBili(kw)
                .onSuccess { items ->
                    update {
                        it.copy(
                            biliResults = items,
                            biliSearching = false,
                            biliSearchMsg = if (items.isEmpty()) "😕 没有搜到结果，换关键词试试" else "",
                        )
                    }
                }
                .onFailure { e ->
                    update { it.copy(biliSearching = false, biliSearchMsg = "❌ 搜索失败: ${e.message}") }
                }
        }
    }

    // ────────────────────────── 播放器回传 ──────────────────────────

    fun onPlayerMeta(videoW: Int, videoH: Int, durationMs: Long) = update { s ->
        val restored = if (s.rect == null && s.movieName.isNotBlank() && s.stageW > 0 && s.stageH > 0) {
            SubtitleCaptureLogic.restoreRect(store.rectOf(s.movieName), s.stageW, s.stageH)
        } else {
            s.rect
        }
        s.copy(videoW = videoW, videoH = videoH, durationMs = durationMs, rect = restored)
    }

    fun onStageSize(w: Int, h: Int) = update { it.copy(stageW = w, stageH = h) }

    fun onPlayingChanged(playing: Boolean) = update { it.copy(playing = playing) }

    /**
     * 播放头前进（Screen 的轮询回调）。
     *
     * 这里顺带做两件 web 在同名事件里做的事：
     * ① 记住进度（web 每次 `timeupdate` 都写 localStorage；Android 按**秒变化**写一次，
     *    行为等价、写入次数少一个量级）；
     * ② 自动复习命中检测（web 在 `timeupdate` 里比 ±400ms 更严的容差，命中就暂停 + 朗读）。
     */
    fun onPosition(positionMs: Long) {
        val s = _state.value
        if (positionMs == s.positionMs) return
        val sec = positionMs / 1000
        if (sec != lastSavedSecond) {
            lastSavedSecond = sec
            if (s.movieName.isNotBlank()) store.saveLastTime(s.movieName, positionMs)
        }
        update { it.copy(positionMs = positionMs) }

        val cur = _state.value
        if (!cur.autoReview || !cur.playing) return
        val hit = SubtitleCaptureLogic.findAutoReviewHit(cur.marks, positionMs, autoHitTs)
            ?: return
        autoHitTs = hit.ts
        // 只挂状态，不动播放器 —— Screen 观察到 pendingAutoPauseTs 后暂停，再回来消费
        update { it.copy(pendingAutoPauseTs = hit.ts) }
    }

    private var autoHitTs: Long = -1L

    /** 拖动进度条后重置「已触发书签」记忆（web 绑 `seeked`）。 */
    fun onSeeked() {
        autoHitTs = -1L
    }

    /**
     * Screen 暂停完播放器后调用：朗读该点字幕（web `onPauseAuto` 的自动复习分支）。
     * 非自动复习触发的暂停不会有 pendingAutoPauseTs，因此这里天然是空操作。
     */
    fun consumeAutoPause() {
        val ts = _state.value.pendingAutoPauseTs ?: return
        val mark = _state.value.marks.firstOrNull { it.ts == ts }
        update { it.copy(pendingAutoPauseTs = null) }
        if (mark == null) return
        msg("🔖 到达书签 @${mark.tsText} · 朗读中…")
        speak(mark.subtitle)
    }

    fun toggleAutoReview() = update { it.copy(autoReview = !it.autoReview) }

    /** 取帧失败（Screen 的 `VideoFrameCropper` 抛出的原因）——直接展示，最有信息量。 */
    fun showCaptureError(message: String?) {
        msg("❌ 截图失败: ${message ?: "视频未就绪或画框无效"}")
    }

    /** 播放器错误（web 的 `<video> onError`；只在云端直链时给出可操作提示）。 */
    fun onPlaybackError(message: String) {
        val hint = if (_state.value.source == MovieSource.URL) {
            "❌ 视频加载失败：请确认该链接是可直接播放的媒体文件（.mp4/.webm/.ogg 等），且网络可达"
        } else {
            "❌ 播放失败: $message"
        }
        msg(hint)
    }

    // ────────────────────────── 画框 ──────────────────────────

    /** web 点「截屏」按钮：进入/退出框选模式；进入且当前无框时给一个默认框。 */
    fun toggleEditing() {
        val s = _state.value
        if (!s.canCapture) return
        if (s.editing) {
            val rect = s.rect
            if (SubtitleCaptureLogic.isUsable(rect) && rect != null) {
                store.saveRect(s.movieName, rect, s.stageW, s.stageH)
            }
            update { it.copy(editing = false) }
        } else {
            val rect = if (s.rect == null && s.stageW > 0 && s.stageH > 0) {
                SubtitleCaptureLogic.defaultRect(s.stageW, s.stageH)
            } else {
                s.rect
            }
            update { it.copy(editing = true, rect = rect) }
        }
    }

    /** 手势开始（web `onWrapMouseDown` / `onCanvasMouseDown`）。 */
    fun beginDrag(handle: String) {
        val s = _state.value
        if (!s.editing) return
        dragStart = s.rect ?: if (s.stageW > 0 && s.stageH > 0) {
            SubtitleCaptureLogic.draftRect(s.stageW, s.stageH)
        } else {
            null
        }
        if (s.rect == null && dragStart != null) update { it.copy(rect = dragStart) }
    }

    /**
     * 在画面空白处按下 → 从**按下点**起一个 0 尺寸框（web `onCanvasMouseDown`，
     * 起手 `{x, y, w: 0, h: 0}` + 句柄 `se`），随拖拽向右下长大。
     */
    fun beginDragNew(x: Int, y: Int) {
        if (!_state.value.editing) return
        val s = _state.value
        if (s.stageW <= 0 || s.stageH <= 0) return
        val start = CaptureRect(x.coerceIn(0, s.stageW), y.coerceIn(0, s.stageH), 0, 0)
        dragStart = start
        update { it.copy(rect = start) }
    }

    /** 手势过程中的**累计**位移（不是增量）。 */
    fun dragBy(handle: String, totalDx: Int, totalDy: Int) {
        val start = dragStart ?: return
        val s = _state.value
        val next = SubtitleCaptureLogic.dragRect(start, handle, totalDx, totalDy, s.stageW, s.stageH)
        update { it.copy(rect = next) }
    }

    /** 手势结束（web `onUp`）：太小的框丢弃，可用的框按影片名记忆。 */
    fun endDrag() {
        val s = _state.value
        val rect = s.rect
        if (rect != null && rect.w < 8 && rect.h < 8) {
            update { it.copy(rect = null) }
        } else if (SubtitleCaptureLogic.isUsable(rect) && rect != null) {
            store.saveRect(s.movieName, rect, s.stageW, s.stageH)
        }
        dragStart = null
    }

    fun clearRect() = update { it.copy(rect = null) }

    // ────────────────────────── 截图 / 评测 ──────────────────────────

    /**
     * Screen 取到帧后调用。[asEvaluate] = true 走「识别」（识图 + 翻译 + 纠错 + 讲解）。
     * 走的是 web `doCapture("save"|"evaluate")` 的同两条路径。
     */
    fun submitFrame(bytes: ByteArray, asEvaluate: Boolean) {
        val s = _state.value
        val rect = s.rect ?: run { msg("❌ 请先选影片并框选字幕区域"); return }
        val videoCrop = s.videoCropRect ?: run {
            msg("❌ 截图失败（视频未就绪或画框无效）")
            return
        }
        if (s.busy || s.evaluating) return

        val request = CaptureRequest(
            movieName = s.movieName,
            timestampMs = s.positionMs,
            videoWidth = s.videoW,
            videoHeight = s.videoH,
            crop = videoCrop,
            cropWidth = videoCrop.w,
            cropHeight = videoCrop.h,
            note = "",
            lang = s.lang,
        )
        val tsNow = s.positionMs
        update {
            it.copy(
                busy = !asEvaluate,
                evaluating = asEvaluate,
                msg = if (asEvaluate) "🤖 识别+翻译中…" else "上传中…",
            )
        }

        viewModelScope.launch {
            val result = if (asEvaluate) repository.autoEvaluate(bytes, request) else repository.capture(bytes, request)
            result
                .onSuccess { outcome ->
                    if (asEvaluate) {
                        pushEvalCard(outcome, live = true)
                        store.saveMark(
                            s.movieName,
                            SubtitleMark(
                                ts = tsNow,
                                tsText = outcome.timestampText,
                                subtitle = outcome.eval.subtitleText,
                                translation = outcome.eval.translation,
                                seq = outcome.seq,
                            ),
                        )
                        reloadMarks()
                        msg("✅ 已测评 #${outcome.seq} @${outcome.timestampText}")
                    } else {
                        store.saveMark(
                            s.movieName,
                            SubtitleMark(ts = tsNow, tsText = outcome.timestampText, seq = outcome.seq),
                        )
                        reloadMarks()
                        msg("✅ 已保存 #${outcome.seq} 时间戳 ${outcome.timestampText}")
                    }
                    loadList()
                }
                .onFailure { e -> msg("❌ 失败: ${e.message}") }
            update { it.copy(busy = false, evaluating = false) }
        }
    }

    /** 卡片上的「🔄 重新测评」（web `reEvaluate`）。 */
    fun reEvaluate(seq: Int) {
        if (seq <= 0) return
        msg("🔄 重新测评 #$seq…")
        viewModelScope.launch {
            repository.reEvaluate(seq, _state.value.lang)
                .onSuccess { outcome ->
                    update { s ->
                        s.copy(
                            evalCards = s.evalCards.map { card ->
                                if (card.seq == seq) card.copy(
                                    subtitleText = outcome.eval.subtitleText,
                                    translation = outcome.eval.translation,
                                    grammar = outcome.eval.grammar,
                                    explanation = outcome.eval.explanation,
                                    cached = false,
                                ) else card
                            },
                            msg = "✅ 已更新 #$seq",
                        )
                    }
                    loadList()
                }
                .onFailure { e -> msg("❌ 重新测评失败: ${e.message}") }
        }
    }

    /** 拉历史列表，并把带 `eval` 缓存、本地还没有的条目回灌进测评区（web `loadList`）。 */
    fun loadList() {
        viewModelScope.launch {
            val items = repository.list() ?: return@launch
            val restored = items.filter { it.eval != null }.map { item ->
                val e = item.eval!!
                EvalCardModel(
                    seq = item.seq,
                    timestampText = item.timestampText,
                    movieName = item.movieName,
                    url = item.url,
                    subtitleText = e.subtitleText,
                    translation = e.translation,
                    grammar = e.grammar,
                    explanation = e.explanation,
                    cached = true,
                )
            }
            update { it.copy(items = items, evalCards = SubtitleCaptureLogic.mergeEvalCards(it.evalCards, restored)) }
        }
    }

    private fun pushEvalCard(outcome: CaptureOutcome, live: Boolean) {
        val card = EvalCardModel(
            seq = outcome.seq,
            timestampText = outcome.timestampText,
            movieName = outcome.movieName.ifBlank { _state.value.movieName },
            url = outcome.url,
            subtitleText = outcome.eval.subtitleText,
            translation = outcome.eval.translation,
            grammar = outcome.eval.grammar,
            explanation = outcome.eval.explanation,
            cached = outcome.cached,
            live = live,
        )
        update { s ->
            s.copy(evalCards = SubtitleCaptureLogic.mergeEvalCards(s.evalCards, listOf(card)))
        }
    }

    // ────────────────────────── 删除 ──────────────────────────

    fun toggleDelMode() {
        val s = _state.value
        if (s.delMode) {
            update { it.copy(delMode = false, selected = emptySet()) }
            return
        }
        update { it.copy(delMode = true, selected = emptySet()) }
    }

    fun toggleSelect(seq: Int) = update { s ->
        val next = s.selected.toMutableSet()
        if (!next.add(seq)) next.remove(seq)
        s.copy(selected = next)
    }

    fun deleteSelected() {
        val seqs = _state.value.selected.toList()
        if (seqs.isEmpty()) return
        update { it.copy(delMode = false, selected = emptySet()) }
        viewModelScope.launch {
            var ok = 0
            for (seq in seqs) if (repository.remove(seq)) ok++
            if (ok > 0) msg("🗑 已删除 $ok 张截图")
            val items = repository.list() ?: return@launch
            update { it.copy(items = items) }
        }
    }

    // ────────────────────────── 朗读 / 跟读 ──────────────────────────

    /**
     * 朗读。中文（含译文）走百度 TTS，纯英文（字幕原文）走系统英语 TTS —— 与全 App 一致。
     * 两个引擎都可能为 null（单测/降级场景）⇒ 静默不读，不影响其它功能。
     */
    fun speak(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        viewModelScope.launch {
            try {
                if (CJK.containsMatchIn(t)) ttsCache?.play(t, "0") else ttsEngine?.speak(t)
            } catch (e: Exception) {
                msg("❌ TTS 失败: ${e.message}")
            }
        }
    }

    /** 「🔊 朗读」按钮：朗读当前激活书签的字幕（web 无标记时提示去「识别」）。 */
    fun speakActiveMark() {
        val text = _state.value.activeMark?.subtitle.orEmpty().trim()
        if (text.isEmpty()) {
            msg("📍 请先标记识别当前画面")
            return
        }
        msg("🔊 朗读：${if (text.length > 20) text.take(20) + "…" else text}")
        speak(text)
    }

    /** 跟读评测（web `useSoeScore` 的单发版本；复用 App 既有的流式评测管线）。 */
    fun toggleSoeRecording() {
        val s = _state.value
        if (s.soeRecording) {
            speechRepository.stopStreamingEvaluation()
            return
        }
        val refText = s.soeRefText
        if (refText.isBlank()) {
            msg("📍 请先标记识别当前画面")
            return
        }
        update { it.copy(soeRecording = true, soeEvaluating = true, soeScore = null, soeWords = emptyList()) }
        viewModelScope.launch {
            try {
                val result = speechRepository.startStreamingEvaluation(
                    Word(text = refText, ipa = "", letter = refText.firstOrNull()?.toString() ?: "", phonemes = emptyList())
                )
                val words = result.wordScores
                    .filter { it.word.isNotBlank() }
                    .map { SoeWordItem(it.word, it.pronAccuracy, it.matchTag) }
                update {
                    it.copy(
                        soeRecording = false,
                        soeEvaluating = false,
                        soeScore = result.totalScore,
                        soeWords = words,
                        soePopup = true,
                        soeError = "",
                    )
                }
                showSoePopupBriefly()
                // 写回书签（web：命中 activeMark 就写它，否则写最后一条）
                val st = _state.value
                if (words.isNotEmpty() && st.movieName.isNotBlank()) {
                    store.applySoeToMark(st.movieName, st.activeMark?.ts, result.totalScore, words)
                    reloadMarks()
                }
            } catch (e: Exception) {
                update {
                    it.copy(
                        soeRecording = false,
                        soeEvaluating = false,
                        soePopup = true,
                        soeError = e.message ?: "评测失败",
                        soeScore = null,
                        soeWords = emptyList(),
                    )
                }
                showSoePopupBriefly()
            }
        }
    }

    fun dismissSoePopup() {
        popupJob?.cancel()
        update { it.copy(soePopup = false) }
    }

    private fun showSoePopupBriefly() {
        popupJob?.cancel()
        popupJob = viewModelScope.launch {
            delay(2500)
            update { it.copy(soePopup = false) }
        }
    }

    private fun reloadMarks() {
        val name = _state.value.movieName
        update { it.copy(marks = if (name.isBlank()) emptyList() else store.marksOf(name)) }
    }

    /** 当前影片是否有需要跳转定位的时间戳（Screen 点列表卡片时用）。 */
    fun consumePendingAutoPauseCancel() {
        autoPauseJob?.cancel()
        update { it.copy(pendingAutoPauseTs = null) }
    }

    private companion object {
        /** 汉字（含扩展 A）—— 有汉字就走中文 TTS，否则走英语 TTS */
        val CJK = Regex("[\\u4e00-\\u9fff]")
    }
}
