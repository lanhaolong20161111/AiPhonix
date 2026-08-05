package com.example.ai.ui.charimage

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.IconButton
import androidx.compose.material3.Icon
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import coil.compose.AsyncImagePainter
import coil.compose.SubcomposeAsyncImage
import coil.compose.SubcomposeAsyncImageContent
import com.example.ai.ui.components.PhonemeHeatmap
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun CharImageScreen(
    viewModel: CharImageViewModel,
    onBack: () -> Unit,
    onPlayTts: ((String) -> Unit)? = null,
) {
    val state by viewModel.uiState.collectAsState()
    val showHint = remember { kotlinx.coroutines.flow.MutableStateFlow(true) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showPageDialog by remember { mutableStateOf(false) }
    var targetPage by remember { mutableStateOf("") }
    val context = LocalContext.current
    val pendingCount by viewModel.pendingCount.collectAsState()

    // 进入页面：刷新待同步数并尝试把离线暂存的反馈补发
    LaunchedEffect(Unit) {
        viewModel.refreshPendingCount()
        viewModel.flushPendingFeedback()
    }

    // 监听网络恢复：连上网络后自动同步暂存反馈
    DisposableEffect(context) {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                viewModel.flushPendingFeedback()
            }
        }
        // 不限定 NET_CAPABILITY_INTERNET：局域网可达（如自建服务端）但无外网时也能触发同步
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
            .build()
        cm.registerNetworkCallback(request, callback)
        onDispose { cm.unregisterNetworkCallback(callback) }
    }

    // 页面每次恢复前台时也尝试同步（网络恢复的兜底）
    LifecycleResumeEffect(Unit) {
        viewModel.flushPendingFeedback()
        onPauseOrDispose { }
    }

    // 收集反馈提交结果
    LaunchedEffect(Unit) {
        viewModel.feedbackResult.collect { msg ->
            scope.launch {
                snackbarHostState.showSnackbar(
                    message = if (msg == "ok") "已记录" else msg,
                    duration = SnackbarDuration.Short,
                )
            }
        }
    }

    // 录音结果提示
    LaunchedEffect(Unit) {
        viewModel.audioResult.collect { msg ->
            scope.launch {
                snackbarHostState.showSnackbar(
                    message = msg,
                    duration = SnackbarDuration.Short,
                )
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            when {
                state.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator()
                            Spacer(Modifier.height(12.dp))
                            Text("加载汉字图片…", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                state.error != null -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("加载失败", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
                            Spacer(Modifier.height(8.dp))
                            Text(state.error!!, style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.height(16.dp))
                            Text("下拉刷新重试", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }

                state.items.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("暂无图片", style = MaterialTheme.typography.titleMedium)
                    }
                }

                else -> {
                    val pagerState = rememberPagerState(
                        initialPage = state.currentIndex,
                        pageCount = { state.items.size },
                    )

                    LaunchedEffect(pagerState.currentPage) {
                        viewModel.setCurrentIndex(pagerState.currentPage)
                    }

                    // 滑动提示
                    LaunchedEffect(Unit) {
                        delay(3000)
                        showHint.value = false
                    }

                    HorizontalPager(
                        state = pagerState,
                        modifier = Modifier.fillMaxSize(),
                    ) { page ->
                        val item = state.items[page]
                        CharImagePage(item = item, viewModel = viewModel, onPlayTts = onPlayTts)
                    }

                    // 页码指示器 + 滑动提示
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.BottomCenter,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            // 滑动提示
                            AnimatedVisibility(
                                visible = showHint.value,
                                enter = fadeIn(),
                                exit = fadeOut(),
                            ) {
                                Text(
                                    "← 左右滑动切换 →",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                                    modifier = Modifier.padding(bottom = 4.dp),
                                )
                            }

                            // 页码（点击可跳转）
                            TextButton(
                                onClick = {
                                    targetPage = "${pagerState.currentPage + 1}"
                                    showPageDialog = true
                                },
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    "${pagerState.currentPage + 1} / ${state.items.size}",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    // 页码跳转对话框
                    if (showPageDialog) {
                        AlertDialog(
                            onDismissRequest = { showPageDialog = false },
                            title = { Text("跳转到") },
                            text = {
                                OutlinedTextField(
                                    value = targetPage,
                                    onValueChange = { targetPage = it.filter { c -> c.isDigit() } },
                                    label = { Text("页码 (1-${state.items.size})") },
                                    singleLine = true,
                                )
                            },
                            confirmButton = {
                                TextButton(onClick = {
                                    val page = targetPage.toIntOrNull()
                                    if (page != null && page in 1..state.items.size) {
                                        scope.launch { pagerState.animateScrollToPage(page - 1) }
                                    }
                                    showPageDialog = false
                                }) {
                                    Text("跳转")
                                }
                            },
                            dismissButton = {
                                TextButton(onClick = { showPageDialog = false }) {
                                    Text("取消")
                                }
                            },
                        )
                    }
                }
            }

            // 有待同步反馈时顶部提示条（置于内容之上，不遮挡交互）
            AnimatedVisibility(
                visible = pendingCount > 0,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .zIndex(10f),
            ) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                ) {
                    Text(
                        text = "📤 待同步 $pendingCount 条反馈，联网后自动同步",
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CharImagePage(item: CharImageItem, viewModel: CharImageViewModel, onPlayTts: ((String) -> Unit)? = null) {
    var learningStatus by remember { mutableStateOf<String?>(null) }
    val soeState by viewModel.soeState.collectAsState()
    val isEnglish = item.type == "英词" || item.type == "英句"
    val isRecording = soeState is CharImageViewModel.SoeState.Recording &&
            (soeState as CharImageViewModel.SoeState.Recording).text == item.char

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        // 拼音 + 汉字（沿中线逐字对齐）
        if (item.pinyin.isNotBlank() && item.char.length > 1) {
            val pinyinParts = item.pinyin.split(" ")
            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.Bottom,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp),
            ) {
                item.char.forEachIndexed { index, c ->
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    ) {
                        // 拼音
                        Text(
                            text = pinyinParts.getOrElse(index) { "" },
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontSize = 14.sp,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        // 汉字
                        Text(
                            text = c.toString(),
                            style = MaterialTheme.typography.headlineLarge.copy(
                                fontWeight = FontWeight.Bold,
                            ),
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        } else {
            // 单字：拼音在上，汉字在下
            if (item.pinyin.isNotBlank()) {
                Text(
                    text = item.pinyin,
                    style = MaterialTheme.typography.titleMedium.copy(
                        letterSpacing = 2.sp,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 2.dp),
                )
            }
            // 汉字/词语
            Text(
                text = item.char,
                style = MaterialTheme.typography.headlineLarge.copy(
                    fontWeight = FontWeight.Bold,
                    letterSpacing = if (item.char.length > 1) 8.sp else 0.sp,
                ),
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }

        // 图片（延迟 5 秒揭示：先回忆思考，再揭晓图片）
        var revealImage by remember(item.char) { mutableStateOf(false) }
        var countdown by remember(item.char) { mutableStateOf(5) }
        LaunchedEffect(item.char) {
            revealImage = false
            countdown = 5
            while (countdown > 0) {
                delay(1000)
                countdown -= 1
            }
            revealImage = true
        }
        Card(
            shape = RoundedCornerShape(12.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
            modifier = Modifier
                .fillMaxWidth(0.75f)
                .aspectRatio(1f),
        ) {
            Crossfade(
                targetState = revealImage,
                modifier = Modifier.fillMaxSize(),
                label = "charImageReveal",
            ) { showImage ->
                if (showImage) {
                    SubcomposeAsyncImage(
                        model = item.imageUrl,
                        contentDescription = item.char,
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(12.dp)),
                        contentScale = ContentScale.Fit,
                    ) {
                        when (painter.state) {
                            is AsyncImagePainter.State.Loading -> {
                                Box(
                                    Modifier.fillMaxSize(),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    CircularProgressIndicator()
                                }
                            }
                            is AsyncImagePainter.State.Error -> {
                                Box(
                                    Modifier.fillMaxSize(),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text("🖼️", fontSize = 36.sp)
                                        Spacer(Modifier.height(8.dp))
                                        Text(
                                            "图片加载失败，请检查网络",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.error,
                                            textAlign = TextAlign.Center,
                                        )
                                    }
                                }
                            }
                            else -> SubcomposeAsyncImageContent()
                        }
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(12.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("🤔", fontSize = 40.sp)
                            Spacer(Modifier.height(10.dp))
                            Text(
                                "小朋友，请先回忆和思考哦！",
                                style = MaterialTheme.typography.titleMedium.copy(
                                    fontWeight = FontWeight.Bold,
                                ),
                                color = MaterialTheme.colorScheme.primary,
                                textAlign = TextAlign.Center,
                            )
                            Spacer(Modifier.height(6.dp))
                            Text(
                                "图片 $countdown 秒后揭晓",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(6.dp))

        // 来源
        val typeLabel = when (item.type) {
            "认" -> "识字表"
            "写" -> "写字表"
            "词" -> "词语表"
            "英词" -> "英语词汇表"
            "英句" -> "英语句子表"
            else -> item.type
        }
        val gradeLabel = when (item.grade to item.semester) {
            "二年级" to "上" -> "二年级上册"
            "二年级" to "下" -> "二年级下册"
            "三年级" to "上" -> "三年级上册"
            "三年级" to "下" -> "三年级下册"
            else -> "${item.grade}${item.semester}"
        }
        Text(
            text = "来自$gradeLabel · $typeLabel",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // 功能按钮：中文=录音/播放，英语=TTS/SOE
        Spacer(Modifier.height(8.dp))
        if (isEnglish) {
            // 英语：TTS 朗读 + SOE 跟读
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                TextButton(onClick = { onPlayTts?.invoke(item.char) },
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                    Text("\uD83D\uDD0A", fontSize = 18.sp)
                    Spacer(Modifier.width(4.dp)); Text("朗读", fontSize = 12.sp)
                }
                Spacer(Modifier.width(16.dp))
                TextButton(onClick = {
                    if (isRecording) viewModel.stopSoe() else viewModel.startSoe(item.char)
                }, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                    Text(if (isRecording) "\uD83D\uDD34" else "\uD83C\uDF99\uFE0F", fontSize = 18.sp)
                    Spacer(Modifier.width(4.dp))
                    Text(if (isRecording) "录音中…" else "跟读", fontSize = 12.sp,
                        color = if (isRecording) MaterialTheme.colorScheme.error
                                else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            // 我的发音：回放最近一次跟读的录音（跟读即录音，自动保存）
            val isPla = viewModel.playingChar.collectAsState().value == item.char
            val hasAudioSet by viewModel.hasAudioSet.collectAsState()
            val hasAudio = hasAudioSet.contains(item.char)
            LaunchedEffect(item.char) { viewModel.checkAudioExists(item.char) }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                // 喇叭（播放自己的发音）
                TextButton(onClick = { viewModel.togglePlayback(item.char) },
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                    enabled = hasAudio) {
                    Text(if (isPla) "\u23F8\uFE0F" else "\uD83D\uDD0A", fontSize = 18.sp,
                        modifier = Modifier.alpha(if (hasAudio || isPla) 1f else 0.4f))
                    Spacer(Modifier.width(4.dp))
                    Text(if (isPla) "暂停" else "播放我的发音", fontSize = 12.sp,
                        color = if (hasAudio || isPla) MaterialTheme.colorScheme.onSurfaceVariant
                                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
                }
            }
            // SOE 结果：总分 + 详细（词语=音素级，句子=词级）
            if (soeState is CharImageViewModel.SoeState.Done &&
                (soeState as CharImageViewModel.SoeState.Done).text == item.char) {
                val done = soeState as CharImageViewModel.SoeState.Done
                Text("测评得分: ${done.score}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (done.score >= 80) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.error)
                if (item.type == "英句" && done.wordScores.isNotEmpty()) {
                    // 句子 → 每个单词的评测结果
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 150.dp)
                            .verticalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        done.wordScores.forEachIndexed { i, ws ->
                            if (i > 0) Spacer(Modifier.width(10.dp))
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(ws.word, fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                val wc = when {
                                    ws.pronAccuracy >= 80 -> Color(0xFF4CAF50)
                                    ws.pronAccuracy >= 60 -> Color(0xFFFF9800)
                                    else -> Color(0xFFF44336)
                                }
                                Text("%.0f".format(ws.pronAccuracy), fontSize = 17.sp,
                                    fontWeight = FontWeight.Bold, color = wc)
                                Text(
                                    text = when (ws.matchTag) {
                                        1 -> "漏读"
                                        2 -> "增读"
                                        3 -> "错读"
                                        else -> ""
                                    },
                                    fontSize = 10.sp,
                                    color = wc,
                                )
                            }
                        }
                    }
                } else if (done.phonemeScores.isNotEmpty()) {
                    // 词语 → 每个音素的评测结果
                    Spacer(Modifier.height(8.dp))
                    PhonemeHeatmap(
                        phonemeScores = done.phonemeScores,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 180.dp)
                            .verticalScroll(rememberScrollState()),
                    )
                }
            }
            if (soeState is CharImageViewModel.SoeState.Error &&
                (soeState as CharImageViewModel.SoeState.Error).text == item.char)
                Text("测评失败", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error)
        } else {
            // 中文：录音 + 播放
            val isPla = viewModel.playingChar.collectAsState().value == item.char
            val recordingChar by viewModel.recordingChar.collectAsState()
            val isRec = recordingChar == item.char
            val hasAudioSet by viewModel.hasAudioSet.collectAsState()
            val hasAudio = hasAudioSet.contains(item.char)

            // 当前页进入时检测是否有录音
            LaunchedEffect(item.char) { viewModel.checkAudioExists(item.char) }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                // 麦克风（录音）
                TextButton(onClick = { viewModel.toggleRecord(item.char) },
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                    enabled = !isPla) {
                    Text(if (isRec) "\uD83D\uDD34" else "\uD83C\uDFA4", fontSize = 18.sp)
                    Spacer(Modifier.width(4.dp))
                    Text(if (isRec) "停止" else "录音", fontSize = 12.sp,
                        color = if (isRec) MaterialTheme.colorScheme.error
                                else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.width(16.dp))
                // 喇叭（播放）
                TextButton(onClick = { viewModel.togglePlayback(item.char) },
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                    enabled = hasAudio && !isRec) {
                    Text(if (isPla) "\u23F8\uFE0F" else "\uD83D\uDD0A", fontSize = 18.sp,
                        modifier = Modifier.alpha(if (hasAudio || isPla) 1f else 0.4f))
                    Spacer(Modifier.width(4.dp))
                    Text(if (isPla) "暂停" else "播放", fontSize = 12.sp,
                        color = if (hasAudio || isPla) MaterialTheme.colorScheme.onSurfaceVariant
                                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        // 第一行：学习状态 ✓ × ?
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 学习状态按钮
            TextButton(
                onClick = { learningStatus = if (learningStatus == "correct") null else "correct" },
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    if (learningStatus == "correct") "✓" else "✓",
                    fontSize = 13.sp,
                    color = if (learningStatus == "correct")
                        MaterialTheme.colorScheme.primary
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                )
            }
            TextButton(
                onClick = { learningStatus = if (learningStatus == "wrong") null else "wrong" },
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    "×",
                    fontSize = 13.sp,
                    color = if (learningStatus == "wrong")
                        MaterialTheme.colorScheme.error
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                )
            }
            TextButton(
                onClick = { learningStatus = if (learningStatus == "unsure") null else "unsure" },
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    "?",
                    fontSize = 13.sp,
                    color = if (learningStatus == "unsure")
                        MaterialTheme.colorScheme.tertiary
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                )
            }

        }

        Spacer(Modifier.height(4.dp))

        // 第二行：提交按钮
        val hasFeedback = learningStatus != null
        if (hasFeedback) {
            androidx.compose.material3.FilledTonalButton(
                onClick = {
                    viewModel.submitFeedback(
                        char = item.char, grade = item.grade,
                        semester = item.semester, type_ = item.type,
                        learningStatus = learningStatus,
                    )
                    learningStatus = null
                },
                contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
            ) {
                Text("提交", fontSize = 13.sp)
            }
        }
    }
}
