package com.example.ai.ui.videopractice

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.example.ai.AppContainer
import androidx.navigation3.runtime.NavKey
import com.example.ai.util.SrtParser
import com.example.ai.util.SubtitleEntry
import kotlinx.coroutines.delay
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideoPracticeScreen(
    onBack: () -> Unit,
    onNavigate: (NavKey) -> Unit = {},
    container: AppContainer,
    viewModel: VideoPracticeViewModel = viewModel { VideoPracticeViewModel(container.speechRepository) },
) {
    val context = LocalContext.current
    val vmState by viewModel.state.collectAsState()

    // --- 视频目录 ---
    val appVideoDir = "${context.getExternalFilesDir(null)?.absolutePath ?: context.filesDir.absolutePath}/videos"

    // --- 状态 ---
    var videoList by remember { mutableStateOf<List<VideoFileItem>>(emptyList()) }
    var showVideoList by remember { mutableStateOf(false) }
    var selectedVideo by remember { mutableStateOf<VideoFileItem?>(null) }

    var exoPlayer by remember { mutableStateOf<ExoPlayer?>(null) }
    var isPlaying by remember { mutableStateOf(false) }
    var subtitles by remember { mutableStateOf<List<SubtitleEntry>>(emptyList()) }
    var currentSubtitle by remember { mutableStateOf<SubtitleEntry?>(null) }
    var practiceText by remember { mutableStateOf("") }

    // --- 扫描本地视频 ---
    fun scanVideos() {
        val dir = File(appVideoDir)
        videoList = if (dir.exists()) {
            dir.listFiles()
                ?.filter { it.extension.equals("mp4", ignoreCase = true) }
                ?.map { file ->
                    val srtFile = File(file.parent, file.nameWithoutExtension + ".en.srt")
                    VideoFileItem(
                        name = file.nameWithoutExtension,
                        videoPath = file.absolutePath,
                        srtPath = srtFile.takeIf { it.exists() }?.absolutePath ?: ""
                    )
                }
                ?.sortedBy { it.name }
                ?: emptyList()
        } else {
            emptyList()
        }
        showVideoList = true
        Log.d("VIDEO_PRACTICE", "扫描到 ${videoList.size} 个视频")
    }

    // --- 删除视频 ---
    var deleteConfirm by remember { mutableStateOf<VideoFileItem?>(null) }
    fun deleteVideo(item: VideoFileItem) {
        try {
            File(item.videoPath).delete()
            if (item.srtPath.isNotBlank()) File(item.srtPath).delete()
            Toast.makeText(context, "已删除: ${item.name}", Toast.LENGTH_SHORT).show()
            // 如果正在播放被删除的视频，清理
            if (selectedVideo?.videoPath == item.videoPath) {
                exoPlayer?.release()
                exoPlayer = null
                isPlaying = false
                subtitles = emptyList()
                currentSubtitle = null
                practiceText = ""
                selectedVideo = null
            }
            // 刷新列表
            val dir = File(appVideoDir)
            videoList = if (dir.exists()) {
                dir.listFiles()
                    ?.filter { it.extension.equals("mp4", ignoreCase = true) }
                    ?.map { file ->
                        val srtFile = File(file.parent, file.nameWithoutExtension + ".en.srt")
                        VideoFileItem(
                            name = file.nameWithoutExtension,
                            videoPath = file.absolutePath,
                            srtPath = srtFile.takeIf { it.exists() }?.absolutePath ?: ""
                        )
                    }
                    ?.sortedBy { it.name }
                    ?: emptyList()
            } else {
                emptyList()
            }
            Log.d("VIDEO_PRACTICE", "删除后剩余 ${videoList.size} 个视频")
        } catch (e: Exception) {
            Log.e("VIDEO_PRACTICE", "删除失败", e)
            Toast.makeText(context, "删除失败", Toast.LENGTH_SHORT).show()
        }
    }

    // --- 加载视频 ---
    fun loadVideo(item: VideoFileItem) {
        Log.d("VIDEO_PRACTICE", "加载视频: ${item.name}, video=${item.videoPath}, srt=${item.srtPath}")

        // 切换视频时清空旧评测结果，避免分数/错误残留
        viewModel.resetState()

        exoPlayer?.release()
        exoPlayer = null
        isPlaying = false
        subtitles = emptyList()
        currentSubtitle = null
        practiceText = ""
        selectedVideo = item

        // 解析字幕
        if (item.srtPath.isNotBlank()) {
            try {
                val content = File(item.srtPath).readText()
                subtitles = SrtParser.parse(content)
                Log.d("VIDEO_PRACTICE", "字幕解析: ${subtitles.size} 条，等待播放到对应时间戳自动显示")
            } catch (e: Exception) {
                Log.e("VIDEO_PRACTICE", "字幕加载失败", e)
            }
        }

        // 初始化 ExoPlayer
        try {
            val videoFile = File(item.videoPath)
            if (!videoFile.exists()) {
                Toast.makeText(context, "视频文件不存在", Toast.LENGTH_SHORT).show()
                return
            }
            val uri = android.net.Uri.fromFile(videoFile)
            val player = ExoPlayer.Builder(context).build().apply {
                setMediaItem(MediaItem.fromUri(uri))
                prepare()
                playWhenReady = true
                Log.d("VIDEO_PRACTICE", "视频准备完成，自动播放")
                addListener(object : Player.Listener {
                    override fun onIsPlayingChanged(playing: Boolean) {
                        isPlaying = playing
                    }
                    override fun onPlaybackStateChanged(state: Int) {
                        Log.d("VIDEO_PRACTICE", "播放状态: $state")
                        if (state == Player.STATE_ENDED) isPlaying = false
                    }
                    override fun onPlayerError(error: PlaybackException) {
                        Log.e("VIDEO_PRACTICE", "播放错误", error)
                        Toast.makeText(context, "播放错误: ${error.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            exoPlayer = player
            showVideoList = false
        } catch (e: Exception) {
            Log.e("VIDEO_PRACTICE", "播放器初始化失败", e)
            Toast.makeText(context, "播放器初始化失败", Toast.LENGTH_SHORT).show()
        }
    }

    // --- 清理 ---
    DisposableEffect(Unit) {
        onDispose { exoPlayer?.release() }
    }

    // --- 字幕同步 ---
    LaunchedEffect(exoPlayer, subtitles) {
        val player = exoPlayer ?: return@LaunchedEffect
        if (subtitles.isEmpty()) return@LaunchedEffect
        while (true) {
            delay(150)
            val pos = player.currentPosition
            val sub = SrtParser.findCurrentSubtitle(subtitles, pos)
            if (sub != null && sub != currentSubtitle) {
                currentSubtitle = sub
                sub.let {
                    if (practiceText != it.text) {
                        practiceText = it.text
                    }
                }
            }
        }
    }

    // 进度条拖拽
    var seekPosition by remember { mutableFloatStateOf(0f) }
    var sliderDragging by remember { mutableStateOf(false) }
    val videoDuration = exoPlayer?.duration?.takeIf { it > 0 } ?: 1L

    // 评测中禁用控制（播放/暂停不可用，麦克风始终可用）
    val controlsEnabled = !vmState.isRecording && exoPlayer != null

    // 同步进度条（非拖拽时）
    if (!sliderDragging) {
        seekPosition = ((exoPlayer?.currentPosition ?: 0L).toFloat() / videoDuration).coerceIn(0f, 1f)
    }

    // ========== UI ==========
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("视频跟读", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { scanVideos() }) {
                        Icon(Icons.Filled.Search, "扫描本地视频")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.White
                )
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(Color.White)
        ) {
            // ====== 视频列表（扫描结果） ======
            if (showVideoList) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F5F5))
                ) {
                    Column(modifier = Modifier.padding(8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "已找到 ${videoList.size} 个视频",
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp
                            )
                            TextButton(onClick = { showVideoList = false }) {
                                Text("关闭")
                            }
                        }
                        if (videoList.isEmpty()) {
                            Text(
                                "📂 $appVideoDir 中没有找到视频文件\n请先用 adb push 把 .mp4 文件推送到此目录",
                                fontSize = 12.sp,
                                color = Color.Gray,
                                modifier = Modifier.padding(8.dp)
                            )
                        } else {
                            LazyColumn(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 280.dp)
                            ) {
                                items(videoList, key = { it.videoPath }) { item ->
                                    val isSelected = selectedVideo?.videoPath == item.videoPath
                                    VideoListItem(
                                        item = item,
                                        isSelected = isSelected,
                                        onClick = { loadVideo(item) },
                                        onDelete = { deleteConfirm = item }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // ====== 删除确认弹窗 ======
            deleteConfirm?.let { item ->
                AlertDialog(
                    onDismissRequest = { deleteConfirm = null },
                    title = { Text("确认删除") },
                    text = { Text("确定要删除「${item.name}」吗？\n视频和字幕都会一起删除。") },
                    confirmButton = {
                        TextButton(onClick = {
                            deleteVideo(item)
                            deleteConfirm = null
                        }) {
                            Text("删除", color = Color.Red)
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { deleteConfirm = null }) {
                            Text("取消")
                        }
                    }
                )
            }

            // ====== 视频播放器 ======
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .padding(horizontal = 12.dp, vertical = 4.dp)
                    .background(Color.Black, RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center
            ) {
                if (selectedVideo == null || exoPlayer == null) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "📺",
                            fontSize = 48.sp
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "点击右上角 🔍 扫描本地视频",
                            color = Color.Gray,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center
                        )
                    }
                } else {
                    AndroidView(
                        factory = { ctx ->
                            PlayerView(ctx).apply {
                                player = exoPlayer
                                useController = false // 隐藏自带控制器
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                        update = { view -> view.player = exoPlayer }
                    )
                }
            }

            // 录音权限请求
            val permLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission()
            ) { granted ->
                if (granted && practiceText.isNotBlank()) {
                    viewModel.startRecording(practiceText)
                }
            }

            // ====== 进度条 ======
            if (selectedVideo != null && exoPlayer != null) {
                fun formatDuration(ms: Long): String {
                    val totalSec = (ms / 1000).coerceAtLeast(0)
                    return "%02d:%02d".format(totalSec / 60, totalSec % 60)
                }

                val totalTimeMs = videoDuration
                val currentTimeMs = exoPlayer?.currentPosition ?: 0L
                val displayTimeMs = if (sliderDragging) {
                    (seekPosition * totalTimeMs).toLong()
                } else {
                    currentTimeMs
                }

                Column(modifier = Modifier.padding(horizontal = 12.dp)) {
                    // 时间标签
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = formatDuration(displayTimeMs),
                            fontSize = 11.sp,
                            fontWeight = if (sliderDragging) FontWeight.Bold else FontWeight.Normal,
                            color = if (sliderDragging) Color(0xFF1565C0) else Color(0xFF757575)
                        )
                        Text(
                            text = formatDuration(totalTimeMs),
                            fontSize = 11.sp,
                            color = Color(0xFF757575)
                        )
                    }

                    Slider(
                        value = seekPosition,
                        onValueChange = {
                            sliderDragging = true
                            seekPosition = it
                        },
                        onValueChangeFinished = {
                            sliderDragging = false
                            exoPlayer?.seekTo((seekPosition * videoDuration).toLong())
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = controlsEnabled,
                        colors = SliderDefaults.colors(
                            thumbColor = Color(0xFF1565C0),
                            activeTrackColor = Color(0xFF1565C0),
                            inactiveTrackColor = Color(0xFFE0E0E0)
                        )
                    )
                }
            }

            // ====== 控制栏：播放/暂停 + 评测 ======
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 播放/暂停
                IconButton(
                    onClick = {
                        exoPlayer?.let {
                            if (it.isPlaying) it.pause() else it.play()
                        }
                    },
                    enabled = controlsEnabled
                ) {
                    // 使用 emoji 避免引入 material-icons-extended 的 Pause 图标
                    if (isPlaying) {
                        Text("⏸", fontSize = 22.sp, color = if (controlsEnabled) Color.Black else Color.Gray)
                    } else {
                        Icon(
                            imageVector = Icons.Filled.PlayArrow,
                            contentDescription = "播放",
                            tint = if (controlsEnabled) Color.Black else Color.Gray,
                            modifier = Modifier.size(32.dp)
                        )
                    }
                }

                // 评测录音按钮
                IconButton(
                    onClick = {
                        if (vmState.isRecording) {
                            // 正在评测中 → 再次点击 = 停止评测
                            viewModel.stopRecording()
                        } else {
                            // 开始评测
                            exoPlayer?.pause()
                            if (practiceText.isBlank()) {
                                Toast.makeText(context, "请先确认评测文本", Toast.LENGTH_SHORT).show()
                                return@IconButton
                            }
                            if (ContextCompat.checkSelfPermission(
                                    context,
                                    Manifest.permission.RECORD_AUDIO
                                ) == PackageManager.PERMISSION_GRANTED
                            ) {
                                viewModel.startRecording(practiceText)
                            } else {
                                permLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        }
                    },
                    enabled = selectedVideo != null && exoPlayer != null
                ) {
                    Text("🎤", fontSize = 24.sp, modifier = Modifier.alpha(if (vmState.isRecording) 0.5f else 1f))
                }

                // 考试按钮
                IconButton(
                    onClick = {
                        val video = selectedVideo ?: return@IconButton
                        onNavigate(com.example.ai.Quiz(video.name, video.srtPath))
                    },
                    enabled = selectedVideo?.srtPath?.isNotBlank() == true
                ) {
                    Text("📝", fontSize = 22.sp)
                }
            }

            // 录音状态指示
            if (vmState.isRecording) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 2.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = Color.Red
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "评测中...",
                        color = Color.Red,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            // ====== 字幕显示 ======
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 2.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1))
            ) {
                Column(modifier = Modifier.padding(10.dp)) {
                    Text(
                        text = "📝 字幕 | 解析: ${subtitles.size}条 | 文件: ${selectedVideo?.srtPath?.takeLast(30) ?: "无"}",
                        fontSize = 10.sp, color = Color.Gray
                    )
                    Text(
                        text = currentSubtitle?.text ?: "（等待字幕...）",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF333333),
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center
                    )
                }
            }

            // ====== 评测文本 ======
            OutlinedTextField(
                value = practiceText,
                onValueChange = { practiceText = it },
                label = { Text("评测文本（自动填入字幕）") },
                placeholder = { Text("例如: I like apples.") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 2.dp),
                singleLine = true,
                textStyle = LocalTextStyle.current.copy(fontSize = 16.sp),
                enabled = !vmState.isRecording
            )

            // ====== 结果展示区 ======
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (vmState.score != null) Color(0xFFE8F5E9) else Color(0xFFFAFAFA)
                )
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        "📊 评测结果",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = Color(0xFF666666)
                    )

                    if (vmState.score != null) {
                        Spacer(Modifier.height(12.dp))
                        // 总分
                        Text(
                            text = "${vmState.score} 分",
                            fontSize = 36.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF2E7D32),
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center
                        )
                        // 逐词得分
                        if (vmState.wordScores.isNotEmpty()) {
                            Spacer(Modifier.height(12.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center
                            ) {
                                vmState.wordScores.forEachIndexed { i, ws ->
                                    if (i > 0) Spacer(Modifier.width(12.dp))
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text(
                                            text = ws.word,
                                            fontSize = 13.sp,
                                            color = Color(0xFF666666)
                                        )
                                        val wc = when {
                                            ws.pronAccuracy >= 80 -> Color(0xFF4CAF50)
                                            ws.pronAccuracy >= 60 -> Color(0xFFFF9800)
                                            else -> Color(0xFFF44336)
                                        }
                                        Text(
                                            text = "%.0f".format(ws.pronAccuracy),
                                            fontSize = 18.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = wc
                                        )
                                    }
                                }
                            }
                        }
                        if (vmState.resultText.isNotBlank()) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = vmState.resultText,
                                fontSize = 14.sp,
                                color = Color(0xFF333333),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    } else if (!vmState.isRecording && selectedVideo != null) {
                        Spacer(Modifier.height(40.dp))
                        Text(
                            text = "点击 🎤 录音评测",
                            fontSize = 16.sp,
                            color = Color.Gray,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center
                        )
                    }

                    if (vmState.error != null) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "❌ ${vmState.error}",
                            color = Color.Red,
                            fontSize = 13.sp
                        )
                    }
                }
            }
        }
    }
}

// --- 数据类 ---
data class VideoFileItem(
    val name: String,
    val videoPath: String,
    val srtPath: String
)

// --- 视频列表项 ---
@Composable
private fun VideoListItem(
    item: VideoFileItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(6.dp),
        color = if (isSelected) Color(0xFFE3F2FD) else Color.White
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.name,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp
                )
                if (item.srtPath.isNotBlank()) {
                    Text(
                        text = "✓ 含字幕",
                        fontSize = 11.sp,
                        color = Color(0xFF4CAF50)
                    )
                }
            }
            if (isSelected) {
                Text("✓", color = Color(0xFF1976D2), fontSize = 18.sp)
            }
            IconButton(
                onClick = onDelete,
                modifier = Modifier.size(36.dp)
            ) {
                Text("🗑", fontSize = 16.sp)
            }
        }
    }
}

// --- 格式化毫秒 ---
private fun formatMs(ms: Long): String {
    val seconds = ms / 1000
    val minutes = seconds / 60
    val secs = seconds % 60
    return "%02d:%02d".format(minutes, secs)
}
