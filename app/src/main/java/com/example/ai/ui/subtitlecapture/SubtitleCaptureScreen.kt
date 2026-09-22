package com.example.ai.ui.subtitlecapture

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.subtitlecapture.BiliItem
import com.example.ai.data.subtitlecapture.CaptureItem
import com.example.ai.data.subtitlecapture.EvalCardModel
import com.example.ai.data.subtitlecapture.GrammarFix
import com.example.ai.data.subtitlecapture.MovieSource
import com.example.ai.data.subtitlecapture.SoeWordItem
import com.example.ai.data.subtitlecapture.SubtitleCaptureLogic
import com.example.ai.data.subtitlecapture.VideoFrameCropper
import com.example.ai.util.SoeDisplay
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * 字幕截图采集页（对齐 web `SubtitleCapturePage.tsx`）。
 *
 * 能力映射（web → Android）：
 * | web | Android |
 * |---|---|
 * | `<input type=file>`（限 video 类型） | SAF `OpenDocument(["video" 通配])` + `takePersistableUriPermission` |
 * | `<video src=blob:>` | ExoPlayer + `PlayerView`（`AndroidView`） |
 * | canvas `drawImage(video)` 两层裁剪 | `MediaMetadataRetriever.getFrameAtTime` + `createBitmap`（见 [VideoFrameCropper]） |
 * | IndexedDB 存影片文件 | 存 SAF URI（**必须持久化授权**，否则重启后播不出来） |
 * | hover 显隐视频控制条 | 常显（触摸端没有 hover） |
 *
 * ⚠️ 本文件的 KDoc 里**绝不能**出现通配路径写法（形如 `video/` 紧跟星号）——
 *    Kotlin 块注释可嵌套，那个 `/*` 会开启嵌套注释把外层 `*/` 吃掉，
 *    报错会落在**文件末尾**（`Syntax error: Unclosed comment.`），极具误导性。见 skill `aiphonix-android-parity` §5c。
 *
 * ★ 播放器与取帧器由本页持有（`AGENTS.md`：ViewModel 不持 `Context`/平台资源），只通过
 *   `onPosition` / `onPlayerMeta` / `submitFrame` 与 VM 换状态 —— 项目内 `VideoPracticeScreen` 的既有惯例。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SubtitleCaptureScreen(
    onBack: () -> Unit,
    viewModel: SubtitleCaptureViewModel,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val cropper = remember { VideoFrameCropper(context.applicationContext) }

    val player = remember { ExoPlayer.Builder(context).build() }
    DisposableEffect(Unit) {
        onDispose {
            runCatching { player.release() }
            com.example.ai.data.tts.BaiduTtsCache.stopAll()
        }
    }

    // 播放器 → VM 的状态回传
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) = viewModel.onPlayingChanged(isPlaying)

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    val vs = player.videoSize
                    viewModel.onPlayerMeta(
                        videoW = vs.width,
                        videoH = vs.height,
                        durationMs = player.duration.coerceAtLeast(0L),
                    )
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                viewModel.onPlaybackError(error.message ?: "播放失败")
            }

            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int,
            ) {
                // 拖动/跳转后重置「已触发书签」记忆（web 绑 seeked）
                viewModel.onSeeked()
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }

    // 换片：重设媒体项
    LaunchedEffect(state.videoUri) {
        if (state.videoUri.isBlank()) {
            player.stop()
            player.clearMediaItems()
        } else {
            player.setMediaItem(MediaItem.fromUri(state.videoUri))
            player.prepare()
        }
    }

    // 播放头轮询（web 的 timeupdate，~4-5Hz；暂停时降到 2.5Hz）
    LaunchedEffect(player, state.videoUri) {
        if (state.videoUri.isBlank()) return@LaunchedEffect
        while (true) {
            delay(if (player.isPlaying) 200 else 400)
            viewModel.onPosition(player.currentPosition)
        }
    }

    // 恢复上次进度（web 的 pendingTimeRef）
    LaunchedEffect(state.pendingResumeMs, state.videoUri) {
        val ms = state.pendingResumeMs
        if (ms > 0 && state.videoUri.isNotBlank()) {
            player.seekTo(ms)
            viewModel.consumeResume()
        }
    }

    // 自动复习命中：先暂停，再朗读（顺序不能反，否则朗读会被继续播放打断）
    LaunchedEffect(state.pendingAutoPauseTs) {
        if (state.pendingAutoPauseTs != null) {
            runCatching { player.pause() }
            viewModel.consumeAutoPause()
        }
    }

    // 首次进入尝试恢复上次影片
    LaunchedEffect(Unit) { viewModel.restoreLastMovieIfIdle() }

    val pickVideo = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            // ★ 不持久化授权的话，重启后 URI 会失效（web 没这个问题 —— 文件存在 IndexedDB 里）
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            viewModel.openLocal(uri.toString(), queryDisplayName(context, uri))
        }
    }

    val askRecordPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) viewModel.toggleSoeRecording() }

    fun captureFrame(asEvaluate: Boolean) {
        scope.launch {
            cropper.cropFramePng(state.videoUri, state.positionMs, state.videoCropRect)
                .onSuccess { viewModel.submitFrame(it, asEvaluate) }
                .onFailure { viewModel.showCaptureError(it.message) }
        }
    }

    LazyColumn(
        modifier = modifier.fillMaxSize().background(Color.White),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "header") {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = onBack, modifier = Modifier.width(46.dp)) { Text("←") }
                    Text("🎬 字幕截图采集", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                }
                Text(
                    "选择本地 / 云端直链 / B站视频 → 框选字幕区域 → 截屏存盘（含精确时间戳），后续可批量送豆包识别",
                    fontSize = 12.sp,
                    color = Slate500,
                )
            }
        }

        item(key = "stage") {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(modifier = Modifier.padding(10.dp)) {
                    ControlBar(
                        state = state,
                        onPickMovie = { viewModel.setPickerOpen(true) },
                        onToggleEditing = { viewModel.toggleEditing() },
                        onSave = { captureFrame(false) },
                        onEvaluate = { captureFrame(true) },
                        onSoe = {
                            val granted = ContextCompat.checkSelfPermission(
                                context, Manifest.permission.RECORD_AUDIO,
                            ) == PackageManager.PERMISSION_GRANTED
                            if (granted) viewModel.toggleSoeRecording()
                            else askRecordPermission.launch(Manifest.permission.RECORD_AUDIO)
                        },
                        onToggleAutoReview = { viewModel.toggleAutoReview() },
                        onSpeakMark = { viewModel.speakActiveMark() },
                    )

                    if (state.msg.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(state.msg, fontSize = 11.sp, color = Slate500)
                    }

                    Spacer(Modifier.height(10.dp))
                    VideoStage(state = state, player = player, viewModel = viewModel)
                    if (state.hasVideo) {
                        Spacer(Modifier.height(4.dp))
                        ProgressRow(state = state, onSeek = { player.seekTo(it) })
                    }
                }
            }
        }

        if (state.soePopup) {
            item(key = "soepopup") {
                SoePopupCard(state.soeScore, state.soeWords, state.soeError) { viewModel.dismissSoePopup() }
            }
        }

        item(key = "eval") {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        "🤖 字幕测评区（${state.evalCards.size}）",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Slate700,
                    )
                    Spacer(Modifier.height(6.dp))
                    if (!state.hasAnySource) {
                        Text(state.evalNoVideoText, fontSize = 13.sp, color = Slate400)
                    } else {
                        if (state.evaluating) {
                            Text("🤖 识别 + 翻译中…", fontSize = 13.sp, color = Slate500)
                        }
                        state.evalLocatedText?.let { Text(it, fontSize = 12.sp, color = Green600) }
                        if (state.visibleCards.isEmpty() && state.evalEmptyText.isNotBlank()) {
                            Text(state.evalEmptyText, fontSize = 13.sp, color = Slate400)
                        }
                        state.visibleCards.forEach { card ->
                            Spacer(Modifier.height(8.dp))
                            EvalCardView(
                                card = card,
                                onSpeak = { viewModel.speak(it) },
                                onReEvaluate = { viewModel.reEvaluate(it) },
                            )
                        }
                    }
                }
            }
        }

        item(key = "list-header") {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "🗂 采集列表 · 本片截图（${state.movieItems.size}）",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = Slate700,
                        )
                        Row {
                            if (state.delMode) {
                                TextButton(onClick = { viewModel.toggleDelMode() }) { Text("取消") }
                            }
                            TextButton(onClick = {
                                if (state.delMode) viewModel.deleteSelected() else viewModel.toggleDelMode()
                            }) {
                                Text(if (state.delMode) "确认删除（${state.selected.size}）" else "🗑 删除")
                            }
                        }
                    }
                    state.nearWarningText?.let { Text(it, fontSize = 12.sp, color = Red600) }
                    if (state.movieItems.isEmpty()) {
                        Text(state.listEmptyText, fontSize = 13.sp, color = Slate400)
                    }
                }
            }
        }

        items(state.movieItems.chunked(3), key = { row -> "row-${row.firstOrNull()?.seq ?: 0}" }) { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { item ->
                    CaptureThumb(
                        item = item,
                        delMode = state.delMode,
                        selected = state.selected.contains(item.seq),
                        hasMark = state.markSeqs.contains(item.seq),
                        isNear = state.nearSeqs.contains(item.seq),
                        onClick = {
                            if (state.delMode) {
                                viewModel.toggleSelect(item.seq)
                            } else {
                                player.seekTo(item.timestampMs)
                                player.pause()
                            }
                        },
                        modifier = Modifier.weight(1f),
                    )
                }
                // 补空格，保证最后一行左对齐
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }

        item(key = "footer") {
            Text("内网服务 · AiPhonix · 字幕采集", fontSize = 11.sp, color = Slate400)
        }
    }

    if (state.pickerOpen) {
        MoviePickerDialog(
            state = state,
            onDismiss = { viewModel.setPickerOpen(false) },
            onLocal = { pickVideo.launch(arrayOf("video/*")) },
            onUrlChange = { viewModel.setUrlInput(it) },
            onOpenUrl = { viewModel.openUrl(state.urlInput) },
            onBiliKeywordChange = { viewModel.setBiliKeyword(it) },
            onSearchBili = { viewModel.searchBili() },
            onPickBili = { viewModel.openBili(it.bvid) },
        )
    }
}

// ────────────────────────────── 控制条 ──────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ControlBar(
    state: SubtitleCaptureUiState,
    onPickMovie: () -> Unit,
    onToggleEditing: () -> Unit,
    onSave: () -> Unit,
    onEvaluate: () -> Unit,
    onSoe: () -> Unit,
    onToggleAutoReview: () -> Unit,
    onSpeakMark: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(SectionBg, RoundedCornerShape(14.dp))
            .border(1.dp, Slate200, RoundedCornerShape(14.dp))
            .padding(10.dp),
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CtrlButton("🎞️", "影片", container = Blue600, border = Blue600, tint = Color.White, onClick = onPickMovie)

            CtrlButton(
                icon = if (state.editing) "✅" else "📐",
                label = if (state.editing) "完成" else "截屏",
                enabled = state.canCapture,
                container = if (state.editing) Cyan50 else Color.White,
                border = if (state.editing) Cyan400 else Slate200,
                tint = if (state.editing) Cyan700 else Slate700,
                onClick = onToggleEditing,
            )

            CtrlButton(
                icon = "💾", label = "存图",
                enabled = state.rect != null && !state.busy && !state.evaluating && state.canCapture,
                container = Blue50, border = Blue300, tint = Blue600,
                onClick = onSave,
            )

            CtrlButton(
                icon = "🤖", label = "识别",
                enabled = state.rect != null && !state.busy && !state.evaluating && state.canCapture,
                container = Violet50, border = Violet300, tint = Violet600,
                onClick = onEvaluate,
            )

            CtrlButton(
                icon = when {
                    state.soeRecording -> "⏺"
                    state.soeEvaluating -> "⏳"
                    else -> "🎙"
                },
                label = when {
                    state.soeRecording -> "结束录音"
                    state.soeEvaluating -> "评测…"
                    else -> "语音"
                },
                enabled = state.soeEnabled || state.soeRecording,
                container = if (state.soeRecording) Red50 else Amber50,
                border = if (state.soeRecording) Red600 else Amber600,
                tint = if (state.soeRecording) Red600 else Amber700,
                onClick = onSoe,
            )

            CtrlButton(
                icon = if (state.autoReview) "🔁" else "⏸",
                label = if (state.autoReview) "复习中" else "已关闭",
                container = if (state.autoReview) Green50 else Slate100,
                border = if (state.autoReview) Green500 else Slate300,
                tint = if (state.autoReview) Green600 else Slate400,
                onClick = onToggleAutoReview,
            )

            CtrlButton(
                icon = "🔊", label = "朗读",
                container = Indigo50, border = Indigo300, tint = Indigo600,
                onClick = onSpeakMark,
            )
        }

        if (state.editing) {
            Spacer(Modifier.height(6.dp))
            Text("📐 框选字幕区", fontSize = 11.sp, color = Cyan700)
        }
        if (state.source == MovieSource.BILI) {
            Spacer(Modifier.height(6.dp))
            Text("🎬 B站预览模式：仅浏览，不支持画框/截图/采集", fontSize = 11.sp, color = Red600)
        }
    }
}

@Composable
private fun CtrlButton(
    icon: String,
    label: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    container: Color = Color.White,
    border: Color = Slate200,
    tint: Color = Slate700,
) {
    Box(
        modifier = Modifier
            .width(76.dp)
            .height(56.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) container else Slate100)
            .border(1.dp, if (enabled) border else Slate200, RoundedCornerShape(10.dp))
            .then(if (enabled) Modifier.pointerInput(label) { tapGesture(onClick) } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(icon, fontSize = 17.sp)
            Text(
                label,
                fontSize = 10.sp,
                color = if (enabled) tint else Slate400,
                textAlign = TextAlign.Center,
            )
        }
    }
}

// ────────────────────────────── 播放器 ──────────────────────────────

@Composable
private fun VideoStage(
    state: SubtitleCaptureUiState,
    player: ExoPlayer,
    viewModel: SubtitleCaptureViewModel,
) {
    var dragTotal by remember { mutableStateOf(Offset.Zero) }
    val ratio = if (state.videoW > 0 && state.videoH > 0) {
        state.videoW.toFloat() / state.videoH.toFloat()
    } else {
        16f / 9f
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .clip(RoundedCornerShape(8.dp))
            .background(Color.Black)
            .clipToBounds()
            .onSizeChanged { viewModel.onStageSize(it.width, it.height) }
            // ★ pointerInput 的 key 绝不能带 rect —— 拖拽时 rect 每帧都变，
            //   那会**在手势进行中重启手势检测器**，表现为「拖一下就断」。
            .then(
                if (state.editing && state.rect == null) {
                    Modifier.pointerInput("new-box") {
                        dragGesture(
                            onStart = { pos ->
                                dragTotal = Offset.Zero
                                viewModel.beginDragNew(pos.x.roundToInt(), pos.y.roundToInt())
                            },
                            onMove = { amount ->
                                dragTotal += amount
                                viewModel.dragBy("se", dragTotal.x.roundToInt(), dragTotal.y.roundToInt())
                            },
                            onFinish = { viewModel.endDrag() },
                        )
                    }
                } else {
                    Modifier
                }
            ),
    ) {
        when {
            state.videoUri.isNotBlank() -> AndroidView(
                factory = { ctx -> PlayerView(ctx).apply { useController = false; this.player = player } },
                update = { it.player = player },
                modifier = Modifier.fillMaxSize(),
            )

            state.biliUrl.isNotBlank() -> AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        webViewClient = WebViewClient()
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.mediaPlaybackRequiresUserGesture = false
                        loadUrl(state.biliUrl)
                    }
                },
                update = { wv -> if (wv.url != state.biliUrl) wv.loadUrl(state.biliUrl) },
                modifier = Modifier.fillMaxSize(),
            )

            else -> Text(
                state.playerPlaceholder,
                color = Slate400,
                fontSize = 13.sp,
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                textAlign = TextAlign.Center,
            )
        }

        // 画框叠加层
        state.rect?.let { rect ->
            val density = LocalDensity.current
            val w = with(density) { rect.w.toDp() }
            val h = with(density) { rect.h.toDp() }
            Box(
                modifier = Modifier
                    .offset { IntOffset(rect.x, rect.y) }
                    .size(w, h)
                    .border(2.dp, if (state.editing) Cyan400 else Slate500)
                    .background(if (state.editing) Cyan12 else Slate10)
                    .then(
                        if (state.editing) {
                            Modifier.pointerInput("move-box") {
                                dragGesture(
                                    onStart = {
                                        dragTotal = Offset.Zero
                                        viewModel.beginDrag("move")
                                    },
                                    onMove = { amount ->
                                        dragTotal += amount
                                        viewModel.dragBy("move", dragTotal.x.roundToInt(), dragTotal.y.roundToInt())
                                    },
                                    onFinish = { viewModel.endDrag() },
                                )
                            }
                        } else {
                            Modifier
                        }
                    ),
            ) {
                if (state.editing) {
                    // 八个手柄：贴在框内四角/四边中点（Compose 里**超出父边界的子元素收不到手势**，
                    // 所以不做 web 那种负偏移，改成就地放 —— 视觉上略靠内，但一定可拖）
                    HandleDots(
                        onBegin = { handle ->
                            dragTotal = Offset.Zero
                            viewModel.beginDrag(handle)
                        },
                        onMove = { handle, amount ->
                            dragTotal += amount
                            viewModel.dragBy(handle, dragTotal.x.roundToInt(), dragTotal.y.roundToInt())
                        },
                        onFinish = { viewModel.endDrag() },
                    )
                }
            }
        }

        // 播放控制（触摸端常显、低透明度）
        if (state.videoUri.isNotBlank()) {
            Box(
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(60.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.35f))
                    .pointerInput("playbtn") {
                        tapGesture { if (player.isPlaying) player.pause() else player.play() }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(if (state.playing) "⏸" else "▶", fontSize = 26.sp, color = Color.White.copy(alpha = 0.8f))
            }
            Text(
                "⏪",
                fontSize = 20.sp,
                color = Color.White.copy(alpha = 0.7f),
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .padding(start = 10.dp)
                    .size(32.dp)
                    .pointerInput("back5") {
                        tapGesture { player.seekTo((player.currentPosition - 5000).coerceAtLeast(0L)) }
                    },
            )
            Text(
                "⏩",
                fontSize = 20.sp,
                color = Color.White.copy(alpha = 0.7f),
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 10.dp)
                    .size(32.dp)
                    .pointerInput("fwd5") {
                        tapGesture { player.seekTo(player.currentPosition + 5000) }
                    },
            )
        }
    }
}

/** 八个缩放手柄（web 是 8 个 10px 圆点 + 负偏移压住框线）。 */
@Composable
private fun BoxScope.HandleDots(
    onBegin: (String) -> Unit,
    onMove: (String, Offset) -> Unit,
    onFinish: () -> Unit,
) {
    val handles = listOf(
        "nw" to Alignment.TopStart,
        "n" to Alignment.TopCenter,
        "ne" to Alignment.TopEnd,
        "w" to Alignment.CenterStart,
        "e" to Alignment.CenterEnd,
        "sw" to Alignment.BottomStart,
        "s" to Alignment.BottomCenter,
        "se" to Alignment.BottomEnd,
    )
    handles.forEach { (handle, align) ->
        Box(
            modifier = Modifier
                .align(align)
                .size(28.dp)
                .pointerInput(handle) {
                    dragGesture(
                        onStart = { onBegin(handle) },
                        onMove = { amount -> onMove(handle, amount) },
                        onFinish = onFinish,
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(Cyan400)
                    .border(1.dp, Cyan700, CircleShape),
            )
        }
    }
}

// ────────────────────────────── 进度条 ──────────────────────────────

@Composable
private fun ProgressRow(state: SubtitleCaptureUiState, onSeek: (Long) -> Unit) {
    val density = LocalDensity.current
    var trackW by remember { mutableStateOf(0) }
    val durationSec = state.durationMs / 1000.0
    val curSec = (state.positionMs / 1000.0).coerceIn(0.0, if (durationSec > 0) durationSec else 1.0)

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.weight(1f).onSizeChanged { trackW = it.width }) {
            Slider(
                value = curSec.toFloat(),
                onValueChange = { onSeek((it * 1000).toLong()) },
                valueRange = 0f..(if (durationSec > 0) durationSec.toFloat() else 1f),
                modifier = Modifier.fillMaxWidth(),
            )
            // 书签标记点（点击跳到该时间戳）。⚠️ Slider 内部有横向内边距，
            // 点位按整条宽度等比算，视觉上会与滑块轨道差几个 dp —— 与 web 的 `left: calc(...)` 同性质。
            if (state.durationMs > 0 && trackW > 0) {
                state.marks.forEach { mark ->
                    val frac = (mark.ts / state.durationMs.toDouble()).coerceIn(0.0, 1.0)
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .offset {
                                IntOffset(
                                    (trackW * frac - with(density) { 5.dp.toPx() }).roundToInt(),
                                    with(density) { 10.dp.toPx() }.roundToInt(),
                                )
                            }
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(Amber500)
                            .border(2.dp, Color.White, CircleShape)
                            .pointerInput(mark.ts) { tapGesture { onSeek(mark.ts) } },
                    )
                }
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(
            "${SubtitleCaptureLogic.fmtTimestamp(state.positionMs)} / " +
                SubtitleCaptureLogic.fmtTimestamp(state.durationMs),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = Slate600,
        )
    }
}

// ────────────────────────────── 跟读得分浮窗 ──────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SoePopupCard(score: Int?, words: List<SoeWordItem>, error: String, onDismiss: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Slate900)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (error.isNotBlank()) {
                Text("⚠️ $error", fontSize = 13.sp, color = Red400, modifier = Modifier.weight(1f))
            } else {
                Text("🎙 跟读得分 $score", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color.White)
                FlowRow(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    words.forEach { w -> ScoreChip(w) }
                }
            }
            TextButton(onClick = onDismiss) { Text("✕", color = Color.White) }
        }
    }
}

@Composable
private fun ScoreChip(w: SoeWordItem) {
    Text(
        SoeDisplay.formatScore(w.accuracy, w.matchTag),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = scoreColor(w.accuracy, w.matchTag),
        modifier = Modifier
            .background(scoreBg(w.accuracy, w.matchTag), RoundedCornerShape(6.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

// ────────────────────────────── 测评卡 ──────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EvalCardView(
    card: EvalCardModel,
    onSpeak: (String) -> Unit,
    onReEvaluate: (Int) -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Slate50),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "#${card.seq} · ${card.timestampText} · ${card.movieName}" +
                        (if (card.cached) "（已缓存）" else ""),
                    fontSize = 11.sp,
                    color = Slate500,
                )
                TextButton(onClick = { onReEvaluate(card.seq) }) { Text("🔄 重新测评", fontSize = 11.sp) }
            }

            EvalSection("📝 字幕原文", card.subtitleText.ifBlank { "（未识别到文字）" }, Slate900) {
                onSpeak(card.subtitleText)
            }
            EvalSection("🌐 翻译", card.translation.ifBlank { "—" }, Color(0xFF075985)) {
                onSpeak(card.translation)
            }

            if (card.grammar.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text("✅ 语法/表达纠错", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                card.grammar.forEach { g: GrammarFix ->
                    Row(modifier = Modifier.padding(top = 2.dp)) {
                        Text(g.original, fontSize = 13.sp, color = Red500)
                        Text(" → ", fontSize = 13.sp, color = Slate500)
                        Text(g.corrected, fontSize = 13.sp, color = Green600)
                    }
                    if (g.reason.isNotBlank()) {
                        Text("（${g.reason}）", fontSize = 11.sp, color = Slate500)
                    }
                }
            }

            if (card.explanation.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text("💡 讲解", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(card.explanation, fontSize = 13.sp, color = Slate700)
            }

            if (card.soeWords.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("🎙 跟读得分", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(
                    card.soeScore?.toString().orEmpty(),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = scoreColor((card.soeScore ?: 0).toFloat()),
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    card.soeWords.forEach { w -> ScoreChip(w) }
                }
            }
        }
    }
}

@Composable
private fun EvalSection(title: String, body: String, bodyColor: Color, onSpeak: () -> Unit) {
    Spacer(Modifier.height(6.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.width(6.dp))
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .border(1.dp, Slate300, RoundedCornerShape(4.dp))
                .pointerInput(title) { tapGesture(onSpeak) }
                .padding(horizontal = 5.dp, vertical = 1.dp),
        ) {
            Text("🔊", fontSize = 13.sp)
        }
    }
    Text(body, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = bodyColor)
}

// ────────────────────────────── 采集列表缩略图 ──────────────────────────────

@Composable
private fun CaptureThumb(
    item: CaptureItem,
    delMode: Boolean,
    selected: Boolean,
    hasMark: Boolean,
    isNear: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val token = TokenManager.accessToken
    val borderColor = when {
        selected -> Green600
        isNear -> Red600
        hasMark -> Amber600
        else -> Slate300
    }
    val vw = item.videoWidth
    val vh = item.videoHeight
    val ratio = if (vw > 0 && vh > 0) vw.toFloat() / vh.toFloat() else 16f / 9f
    val showBox = isNear && item.crop.w > 0 && item.crop.h > 0 && vw > 0 && vh > 0

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .border(2.dp, borderColor, RoundedCornerShape(8.dp))
            .background(Color.White)
            .pointerInput(item.seq, delMode) { tapGesture(onClick) },
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth().aspectRatio(ratio)) {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(item.url)
                    // ★ file/:fileName 也挂了 requireAuth ⇒ 必须带 token，否则整片灰图
                    .apply { if (token.isNotBlank()) addHeader("Authorization", "Bearer $token") }
                    .crossfade(true)
                    .build(),
                contentDescription = "#${item.seq}",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().background(Color.Black),
            )
            if (showBox) {
                // 时间相近的那几张：把「采集到的字幕区域」在原图坐标里框出来（web 的百分比定位）
                Box(
                    modifier = Modifier
                        .offset(
                            x = maxWidth * (item.crop.x.toFloat() / vw),
                            y = maxHeight * (item.crop.y.toFloat() / vh),
                        )
                        .size(
                            width = maxWidth * (item.crop.w.toFloat() / vw),
                            height = maxHeight * (item.crop.h.toFloat() / vh),
                        )
                        .border(2.dp, Red500),
                )
            }
            if (delMode) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(6.dp)
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(if (selected) Green600 else Slate900.copy(alpha = 0.7f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(if (selected) "✓" else "", fontSize = 12.sp, color = Color.White)
                }
            }
        }
        Column(modifier = Modifier.padding(6.dp)) {
            Text(
                "#${item.seq} · ${item.timestampText}",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = if (isNear) Red600 else Slate700,
            )
            if (item.note.isNotBlank()) {
                Text("📝 ${item.note}", fontSize = 11.sp, color = Slate500)
            }
        }
    }
}

// ────────────────────────────── 来源浮层 ──────────────────────────────

@Composable
private fun MoviePickerDialog(
    state: SubtitleCaptureUiState,
    onDismiss: () -> Unit,
    onLocal: () -> Unit,
    onUrlChange: (String) -> Unit,
    onOpenUrl: () -> Unit,
    onBiliKeywordChange: (String) -> Unit,
    onSearchBili: () -> Unit,
    onPickBili: (BiliItem) -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item(key = "title") {
                    Column {
                        Text("🎞️ 打开影片", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Text(
                            "选择视频来源 —— 本地最稳定，云端可采集（需源开 CORS），B站仅预览",
                            fontSize = 11.sp,
                            color = Slate500,
                        )
                    }
                }

                item(key = "local") {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .border(1.dp, Slate200, RoundedCornerShape(12.dp))
                            .pointerInput("local") { tapGesture(onLocal) }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("📁", fontSize = 20.sp)
                        Spacer(Modifier.width(10.dp))
                        Text("本地文件", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.weight(1f))
                        Text("完整采集", fontSize = 11.sp, color = Slate400)
                    }
                }

                item(key = "url") {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .border(1.dp, Slate200, RoundedCornerShape(12.dp))
                            .padding(12.dp),
                    ) {
                        Text("🔗 云端直链 URL", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = state.urlInput,
                                onValueChange = onUrlChange,
                                placeholder = { Text("https://…/video.mp4", fontSize = 12.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            Spacer(Modifier.width(8.dp))
                            TextButton(onClick = onOpenUrl) { Text("打开") }
                        }
                        Text(
                            "⚠️ 截图需视频源开放 CORS，否则只能播放不能采集（浏览器安全限制）",
                            fontSize = 11.sp,
                            color = Slate400,
                        )
                    }
                }

                item(key = "bili") {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .border(1.dp, Slate200, RoundedCornerShape(12.dp))
                            .padding(12.dp),
                    ) {
                        Text("🎬 B站视频（预览）", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = state.biliKeyword,
                                onValueChange = onBiliKeywordChange,
                                placeholder = { Text("🔍 搜索 B站视频，如：小猪佩奇", fontSize = 12.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            Spacer(Modifier.width(8.dp))
                            TextButton(onClick = onSearchBili) {
                                Text(if (state.biliSearching) "搜索…" else "搜索")
                            }
                        }
                        if (state.biliSearchMsg.isNotBlank()) {
                            Text(state.biliSearchMsg, fontSize = 11.sp, color = Red600)
                        }
                        state.biliResults.forEach { item ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .pointerInput(item.bvid) { tapGesture { onPickBili(item) } }
                                    .padding(vertical = 8.dp),
                            ) {
                                Text(item.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                Text("${item.author} · ${item.duration}", fontSize = 11.sp, color = Slate500)
                            }
                        }
                        Text(
                            "⚠️ B站内嵌预览：仅浏览，不能画框/截图/采集；清晰度受 B站登录限制",
                            fontSize = 11.sp,
                            color = Slate400,
                        )
                    }
                }

                item(key = "cancel") {
                    TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("取消") }
                }
            }
        }
    }
}

// ────────────────────────────── 手势 / 小工具 ──────────────────────────────

/** 点击（无长按/拖动语义），自绘按钮统一用它 —— 注意**不能**给 foundation 的 `clickable` 另起同名扩展。 */
private suspend fun PointerInputScope.tapGesture(onTap: () -> Unit) {
    detectTapGestures(onTap = { onTap() })
}

/**
 * 拖拽（累计位移由调用方维护）。
 *
 * `PointerInputScope` 上的普通 `suspend fun` 扩展 —— **不是** `Modifier` 扩展，
 * 所以不存在「`Modifier` 扩展里用 `remember`」那类问题（见 skill `aiphonix-android-parity` §5l）。
 */
private suspend fun PointerInputScope.dragGesture(
    onStart: (Offset) -> Unit,
    onMove: (Offset) -> Unit,
    onFinish: () -> Unit,
) {
    detectDragGestures(
        onDragStart = { offset -> onStart(offset) },
        onDrag = { change, amount ->
            change.consume()
            onMove(amount)
        },
        onDragEnd = { onFinish() },
        onDragCancel = { onFinish() },
    )
}

private fun queryDisplayName(context: Context, uri: Uri): String {
    val fallback = uri.lastPathSegment.orEmpty()
    return runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else fallback
        } ?: fallback
    }.getOrDefault(fallback)
}

private fun scoreColor(accuracy: Float, matchTag: Int = 0): Color = when {
    SoeDisplay.isMissing(accuracy, matchTag) -> Slate400
    accuracy >= 80f -> Green600
    accuracy >= 60f -> Amber700
    else -> Red600
}

private fun scoreBg(accuracy: Float, matchTag: Int = 0): Color = when {
    SoeDisplay.isMissing(accuracy, matchTag) -> Slate100
    accuracy >= 80f -> Green50
    accuracy >= 60f -> Amber50
    else -> Red50
}

// ────────────────────────────── 配色（浅色主题：深字 + 浅底） ──────────────────────────────

private val Slate900 = Color(0xFF0F172A)
private val Slate700 = Color(0xFF334155)
private val Slate600 = Color(0xFF475569)
private val Slate500 = Color(0xFF64748B)
private val Slate400 = Color(0xFF94A3B8)
private val Slate300 = Color(0xFFCBD5E1)
private val Slate200 = Color(0xFFE2E8F0)
private val Slate100 = Color(0xFFF1F5F9)
private val Slate50 = Color(0xFFF8FAFC)
private val SectionBg = Color(0xFFF8FAFC)

private val Blue600 = Color(0xFF2563EB)
private val Blue300 = Color(0xFF93C5FD)
private val Blue50 = Color(0xFFEFF6FF)
private val Violet600 = Color(0xFF7C3AED)
private val Violet300 = Color(0xFFC4B5FD)
private val Violet50 = Color(0xFFF5F3FF)
private val Indigo600 = Color(0xFF4F46E5)
private val Indigo300 = Color(0xFFA5B4FC)
private val Indigo50 = Color(0xFFEEF2FF)
private val Cyan400 = Color(0xFF22D3EE)
private val Cyan700 = Color(0xFF0891B2)
private val Cyan50 = Color(0xFFF0FDFA)
private val Cyan12 = Color(0x1F22D3EE)
private val Slate10 = Color(0x1464748B)
private val Amber600 = Color(0xFFF59E0B)
private val Amber700 = Color(0xFFB45309)
private val Amber500 = Color(0xFFF59E0B)
private val Amber50 = Color(0xFFFFFBEB)
private val Green600 = Color(0xFF16A34A)
private val Green500 = Color(0xFF22C55E)
private val Green50 = Color(0xFFF0FDF4)
private val Red600 = Color(0xFFDC2626)
private val Red500 = Color(0xFFEF4444)
private val Red400 = Color(0xFFF87171)
private val Red50 = Color(0xFFFEF2F2)
