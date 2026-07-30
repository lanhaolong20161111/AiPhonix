package com.example.ai.ui.letter

import android.media.MediaPlayer
import android.media.audiofx.LoudnessEnhancer
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.example.ai.AppContainer
import com.example.ai.Practice

@Composable
fun LetterScreen(
    char: String,
    onNavigate: (Any) -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: LetterViewModel = viewModel { LetterViewModel(container.contentRepository) },
) {
    LaunchedEffect(char) { viewModel.loadLetter(char) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    val context = LocalContext.current

    // ── ExoPlayer：每个字母独立视频 ──
    var exoPlayer by remember { mutableStateOf<ExoPlayer?>(null) }
    var isPlaying by remember { mutableStateOf(false) }
    var isEnded by remember { mutableStateOf(false) }

    val videoPath = remember(char) { "asset:///letter_clips/letter_${char.lowercase()}.mp4" }

    LaunchedEffect(videoPath) {
        exoPlayer?.release()
        val player = ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(android.net.Uri.parse(videoPath)))
            prepare()
            playWhenReady = false
            addListener(object : Player.Listener {
                override fun onIsPlayingChanged(playing: Boolean) {
                    isPlaying = playing
                    if (playing) isEnded = false
                }
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) {
                        isEnded = true
                        isPlaying = false
                    }
                }
            })
        }
        exoPlayer = player
    }

    // 页面离开时释放
    DisposableEffect(Unit) {
        onDispose { exoPlayer?.release() }
    }

    // 返回键→生命周期→立刻停掉视频画面（避免退出动画期间视频继续播放）
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                exoPlayer?.stop()
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    // 返回键→立即释放播放器，避免退出动画期间残留画面
    // 使用 OnBackPressedCallback 而非 BackHandler，释放后仍让导航正常执行
    val dispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    DisposableEffect(dispatcher) {
        if (dispatcher == null) return@DisposableEffect onDispose {}
        val callback = object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                exoPlayer?.apply {
                    stop()
                    clearVideoSurface()
                    release()
                }
                exoPlayer = null
                // 移除自己后重新调度，让 Navigation 处理返回导航
                remove()
                dispatcher.onBackPressed()
            }
        }
        dispatcher.addCallback(callback)
        onDispose { callback.remove() }
    }

    val scrollState = rememberScrollState()
    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.matchParentSize().padding(24.dp).verticalScroll(scrollState),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val letter = state.letter ?: return

        Text(
            text = "${letter.uppercase} ${letter.lowercase}",
            fontSize = 64.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(text = letter.ipaName, fontSize = 24.sp, color = MaterialTheme.colorScheme.primary)

        // ── 字母常用发音（可点击播放）──
        if (letter.pronunciations.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text("字母发音", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            var playingIpa by remember { mutableStateOf<String?>(null) }
            val ipaPlayer = remember {
                object {
                    private var mp: MediaPlayer? = null
                    fun play(ipa: String) {
                        stop()
                        val clean = ipa.removePrefix("/").removeSuffix("/").trim()
                        val assetPath = "ipa/$clean.aac"
                        try {
                            val afd = context.assets.openFd(assetPath)
                            mp = MediaPlayer().apply {
                                setDataSource(afd)
                                setOnCompletionListener { playingIpa = null; release(); mp = null }
                                setOnErrorListener { _, _, _ -> playingIpa = null; mp?.release(); mp = null; true }
                                prepare()
                                start()
                                // LoudnessEnhancer 放大增益
                                try {
                                    val le = LoudnessEnhancer(audioSessionId)
                                    le.setTargetGain(2000) // 2000 mB = +20 dB
                                    le.enabled = true
                                } catch (_: Exception) { }
                            }
                            afd.close()
                            playingIpa = ipa
                        } catch (e: Exception) { playingIpa = null }
                    }
                    fun stop() {
                        mp?.let { try { if (it.isPlaying) it.stop(); it.release() } catch (_: Exception) {} }
                        mp = null
                        playingIpa = null
                    }
                }
            }
            DisposableEffect(char) { onDispose { ipaPlayer.stop() } }

            @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                letter.pronunciations.forEach { ipa ->
                    val isPlaying = playingIpa == ipa
                    SuggestionChip(
                        onClick = { if (isPlaying) ipaPlayer.stop() else ipaPlayer.play(ipa) },
                        icon = {
                            Text(if (isPlaying) "🔊" else "🔈", fontSize = 14.sp)
                        },
                        label = {
                            Text(ipa, fontSize = 16.sp,
                                color = if (isPlaying) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.onSurface)
                        },
                        border = BorderStroke(
                            if (isPlaying) 2.dp else 1.dp,
                            if (isPlaying) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.outline,
                        ),
                    )
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        // ── 视频播放器（点击结束画面重播）──
        Card(
            modifier = Modifier
                .width(400.dp)
                .height(280.dp)
                .then(
                    if (!isPlaying) Modifier.clickable {
                        exoPlayer?.apply { seekTo(0); play() }
                        isEnded = false
                        isPlaying = true
                    } else Modifier
                ),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Box(Modifier.fillMaxSize()) {
                AndroidView(
                    factory = { ctx ->
                        PlayerView(ctx).apply { useController = false }
                    },
                    update = { view ->
                        view.player = exoPlayer
                    },
                    modifier = Modifier.fillMaxSize(),
                )
                if (exoPlayer == null) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("视频加载中…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (!isPlaying && !isEnded && exoPlayer != null) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("▶ 点击播放", fontSize = 20.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (isEnded) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("↺ 点击重播", fontSize = 20.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        // ── 字母发音按钮 ──
        var isPlayingAudio by remember { mutableStateOf(false) }
        val alphaPlayer = remember {
            object {
                private var mp: MediaPlayer? = null
                fun play(c: String) {
                    stop()
                    val upper = c.uppercase()
                    val idx = String.format("%02d", upper[0] - 'A' + 1)
                    val file = "alphabet/${upper}_${idx}.mp3"
                    try {
                        val afd = context.assets.openFd(file)
                        mp = MediaPlayer().apply {
                            setDataSource(afd)
                            setOnCompletionListener { isPlayingAudio = false; release(); mp = null }
                            setOnErrorListener { _, _, _ -> isPlayingAudio = false; mp?.release(); mp = null; true }
                            prepare()
                            start()
                            try {
                                val le = LoudnessEnhancer(audioSessionId)
                                le.setTargetGain(2000)
                                le.enabled = true
                            } catch (_: Exception) { }
                        }
                        afd.close()
                        isPlayingAudio = true
                    } catch (e: Exception) { isPlayingAudio = false }
                }
                fun stop() {
                    mp?.let { try { if (it.isPlaying) it.stop(); it.release() } catch (_: Exception) {} }
                    mp = null
                    isPlayingAudio = false
                }
            }
        }
        DisposableEffect(char) { onDispose { alphaPlayer.stop() } }

        FilledTonalButton(
            onClick = { alphaPlayer.play(char) },
            enabled = !isPlayingAudio,
        ) {
            Text(if (isPlayingAudio) "🎵 播放中…" else "🎵 听发音")
        }

        Spacer(Modifier.height(24.dp))

        Text("练习单词", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Spacer(Modifier.height(12.dp))

        state.words.take(3).forEach { word ->
            OutlinedCard(
                onClick = { onNavigate(Practice(word.text)) },
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            ) {
                Row(
                    modifier = Modifier.padding(16.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(text = word.emoji ?: "📝", fontSize = 28.sp)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(text = word.text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            Text(text = word.ipa, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Text("🎤", fontSize = 20.sp)
                }
            }
        }

        // ── 三年级上词汇 ──
        if (state.englishWords.isNotEmpty()) {
            Spacer(Modifier.height(20.dp))
            Text("三年级上词汇", fontWeight = FontWeight.Bold, fontSize = 16.sp,
                color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            // 用 FlowRow 展示，每个词一个助理芯片
            @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
            androidx.compose.foundation.layout.FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                state.englishWords.forEach { ew ->
                    SuggestionChip(
                        onClick = { onNavigate(Practice(ew.word)) },
                        label = {
                            Column {
                                Text("${ew.emoji} ${ew.word}", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text(ew.phonetic, fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        },
                    )
                }
            }
        }

    } // Column

    // ── 下滑提示（5秒自动消失 / 滑到底自动消失）──
    var showHint by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        // 5 秒超时自动消失
        kotlinx.coroutines.delay(5000)
        showHint = false
    }
    LaunchedEffect(Unit) {
        // 滑到底立即消失
        snapshotFlow { scrollState.value >= scrollState.maxValue }
            .collect { atBottom ->
                if (atBottom) showHint = false
            }
    }
    AnimatedVisibility(
        visible = showHint,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
    ) {
        Text(
            "↓ 下滑查看更多",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
    }
} // Box
} // fun
