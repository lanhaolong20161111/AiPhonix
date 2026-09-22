package com.example.ai.ui.aihomework

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.example.ai.util.decodeByteArrayOriented
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.ui.common.SpeakableText
import kotlinx.coroutines.delay
import java.io.File

/** AI 作业主页：拍照/相册 → 识别并解析关键信息 → 保存并进入练习 */
@Composable
fun AiHomeworkScreen(
    viewModel: AiHomeworkViewModel,
    onBack: () -> Unit,
    onOpenCharStats: () -> Unit = {},
    onOpenHistory: () -> Unit = {},
) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        viewModel.initTts(context)
        viewModel.loadResumableSessions()
    }

    // 页面离开组合（返回键）时立即停止朗读与录音（比 onCleared 更早触发）
    DisposableEffect(Unit) {
        onDispose { viewModel.cancelSpeaking() }
    }

    // 拍照：直接读 cache 文件识题（不写相册，免存储权限）
    var pendingFile by remember { mutableStateOf<File?>(null) }
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        pendingFile?.let { file ->
            if (ok) {
                try {
                    viewModel.parseImage(file.readBytes())
                } catch (e: Exception) {
                    Toast.makeText(context, "读取照片失败: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
            file.delete()
            pendingFile = null
        }
    }

    // 麦克风权限（录音前先申请，授权后自动开始录音）
    var pendingRecordSentence by remember { mutableStateOf<String?>(null) }
    val recordPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingRecordSentence?.let { s ->
            if (granted) {
                viewModel.toggleRecord(s)
            } else {
                Toast.makeText(context, "需要麦克风权限才能录音", Toast.LENGTH_SHORT).show()
            }
        }
        pendingRecordSentence = null
    }

    // 点击麦克风：有权限直接录音；无权限先申请（申请成功自动开始）
    fun onMicClick(sentence: String) {
        if (state.isSpeaking) return // 朗读中不可录音（与现有互斥一致）
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            viewModel.toggleRecord(sentence)
        } else {
            pendingRecordSentence = sentence
            recordPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // 原题照片：点击放大全屏查看（本题图片，上图下文）
    var showFullPhoto by remember { mutableStateOf(false) }

    // 保存成功提示
    LaunchedEffect(state.saved) {
        if (state.saved) {
            Toast.makeText(context, "已保存到「我的学习」", Toast.LENGTH_SHORT).show()
            viewModel.clearSaved()
        }
    }

    // 相册选图（单张，免权限）
    val pickFromGallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let {
            try {
                context.contentResolver.openInputStream(it)?.use { s ->
                    viewModel.parseImage(s.readBytes())
                }
            } catch (e: Exception) {
                Toast.makeText(context, "读取图片失败: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "←",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clickable(onClick = onBack),
            )
            Text("🧮 数学", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = viewModel::save, enabled = !state.saving) {
                Text(if (state.saving) "保存中…" else "💾 保存", style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = onOpenCharStats) {
                Text("📖 认读画像", style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = onOpenHistory) {
                Text("🗂 历史", style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "拍照或相册选图，AI 自动识别并解析",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF212121),
        )

        Spacer(Modifier.height(16.dp))

        // 输入方式
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(
                onClick = {
                    // 文件必须建在 FileProvider 配置的 cache/import_photos 下，否则 getUriForFile 抛异常闪退
                    val dir = File(context.cacheDir, "import_photos").apply { mkdirs() }
                    val file = File(dir, "aihw_photo_${System.currentTimeMillis()}.jpg")
                    pendingFile = file
                    takePicture.launch(cameraUri(context, file))
                },
                modifier = Modifier.weight(1f),
            ) { Text("📷 拍照") }
            OutlinedButton(
                onClick = { pickFromGallery.launch("image/*") },
                modifier = Modifier.weight(1f),
            ) { Text("🖼️ 相册") }
        }

        // 重新识别：同一张图跳过缓存强制 LLM 重跑（识别结果错/漏题时手动重试）
        if (state.hasCachedImage && !state.parsingImage) {
            TextButton(
                onClick = { viewModel.reparseImage() },
                modifier = Modifier.padding(top = 4.dp),
                enabled = !state.parsingImage,
            ) {
                Text("🔄 识别结果不对？重新识别（不走缓存）", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(4.dp))
        }

        Spacer(Modifier.height(8.dp))

        // 识别中提示
        if (state.parsingImage) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("正在识别题目图片...", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
        }

        // 多题识别结果：展示全部题目，点选一道
        if (state.recognizedQuestions.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(
                "📋 识别到 ${state.recognizedQuestions.size} 道题，选一道练习：",
                style = MaterialTheme.typography.titleSmall,
            )
            Spacer(Modifier.height(6.dp))
            state.recognizedQuestions.forEachIndexed { index, q ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp)
                        .clickable { viewModel.selectQuestion(index) },
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "${index + 1}.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF1A1A1A),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            q.lineSequence().firstOrNull()?.take(40) ?: q,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }

        // 识别后自动解析提示
        if (state.analyzing) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("正在解析关键信息…", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
        }

        // 提问框：检索知识库 → AI 回答（核心问答）
        OutlinedTextField(
            value = state.kbQuestion,
            onValueChange = viewModel::updateKbQuestion,
            modifier = Modifier.fillMaxWidth(),
            minLines = 2,
            maxLines = 4,
            placeholder = { Text("问个问题，比如：什么是周长？这道题怎么做？") },
        )
        Spacer(Modifier.height(6.dp))
        Button(
            onClick = viewModel::askKb,
            enabled = !state.askingKb && state.kbQuestion.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.askingKb) "AI 正在检索回答…" else "❓ 提问（检索知识库）")
        }
        if (state.askingKb) {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text("正在检索题目/知识库…", style = MaterialTheme.typography.bodySmall, color = Color(0xFF000000))
            }
        }
        if (state.kbAnswer.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF))) {
                Column(modifier = Modifier.padding(10.dp)) {
                    Text(
                        state.kbAnswer,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFF000000),
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))

        // 解析结果预览：一句话一个方框；第 1 步读题——每个字可点击听发音（阅读障碍/ADHD 友好）
        state.analyzeResult?.let { result ->
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("已识别 ${result.sentences.size} 句话", style = MaterialTheme.typography.titleSmall)
            }
            Spacer(Modifier.height(6.dp))
            // 原题照片（图文对照）：识别文字对应的整张原图，点一下放大
            val photoBytes = state.imageBytes
            if (photoBytes != null) {
                PhotoCard(bytes = photoBytes, onClick = { showFullPhoto = true })
                Spacer(Modifier.height(6.dp))
            }
            // 读题引导卡：强调先读题，逐字点读
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD))) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                    Text(
                        "📖 第 1 步 · 读题",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF000000),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "用手指点每个字听发音，把每句话点一遍，再想想题目问什么。",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF212121),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            result.sentences.forEachIndexed { index, s ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                        // 操作行：句子序号 + 🎤（麦克风录音）+ ▶（播放学生录音）；朗读已改为逐字点读
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "${index + 1}.",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF212121),
                            )
                            Spacer(Modifier.weight(1f))
                            val isThisRecording = state.isMicRecording && state.micRecordingSentence == s.text
                            // 🎤 录音：点击开始/停止上传；朗读中禁用；其他句录音中禁用；未授权先弹权限请求
                            Text(
                                if (isThisRecording) "⏹" else "🎤",
                                style = MaterialTheme.typography.bodyMedium,
                                color = if (isThisRecording) Color(0xFFC62828) else if (state.isSpeaking || state.isMicRecording) Color(0xFFBDBDBD) else Color.Unspecified,
                                modifier = Modifier
                                    .padding(start = 6.dp, end = 2.dp)
                                    .clickable(enabled = !state.isSpeaking && (!state.isMicRecording || isThisRecording)) {
                                        onMicClick(s.text)
                                    },
                            )
                            // ▶ 播放学生录音（已录时显示）
                            if (s.text in state.recordedSentences) {
                                Text(
                                    "▶",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = if (state.isSpeaking || state.isMicRecording) Color(0xFFBDBDBD) else Color.Unspecified,
                                    modifier = Modifier
                                        .padding(horizontal = 2.dp)
                                        .clickable(enabled = !state.isSpeaking && !state.isMicRecording) {
                                            viewModel.playSentenceAudio(s.text)
                                        },
                                )
                            }
                        }
                        Spacer(Modifier.height(4.dp))
                        // 逐字点读区：每个字可点击听发音（音频已缓存，重复点不调 API）；正在读的字浅蓝底
                        @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                        androidx.compose.foundation.layout.FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            s.text.forEach { ch ->
                                if (ch.isWhitespace()) {
                                    Spacer(Modifier.width(8.dp))
                                } else {
                                    val chStr = ch.toString()
                                    val isPlaying = state.isSpeaking && state.speakingChar == chStr
                                    Text(
                                        chStr,
                                        style = MaterialTheme.typography.titleMedium,
                                        color = Color(0xFF000000),
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(if (isPlaying) Color(0xFF90CAF9) else Color.Transparent)
                                            .clickable {
                                                viewModel.speak(chStr)
                                            }
                                            .padding(horizontal = 3.dp, vertical = 2.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            // 续闯上次未完成的闯关
            if (state.questResumable.isNotEmpty() && !state.questStarted) {
                state.questResumable.take(2).forEach { s ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp)
                            .clickable(enabled = !state.questLoading) { viewModel.continueQuest(s.sessionId) },
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1)),
                        border = BorderStroke(1.dp, Color(0xFFFFB300)),
                    ) {
                        Text(
                            "↩ 继续上次闯关（${s.question.lineSequence().firstOrNull()?.take(20) ?: "未完成"}）",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF000000),
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
            }
            // 闯关学习：大模型按本题现场出题引导
            Button(
                onClick = viewModel::startQuest,
                enabled = !state.questLoading && !state.questStarted,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.questLoading) "🎮 正在生成闯关计划…" else "🎮 闯关学习（AI 带你一步步解题）")
            }
            if (state.questStarted) {
                Spacer(Modifier.height(8.dp))
                QuestPanel(
                    state = state,
                    currentStep = viewModel.currentQuestStep(),
                    onAnswer = viewModel::answerQuest,
                    onNext = viewModel::nextQuestStep,
                    onRetry = viewModel::retryQuestStep,
                    onHistory = viewModel::toggleQuestHistory,
                    onReplay = viewModel::replayQuest,
                    onRetryErrors = viewModel::retryErrorsQuest,
                    onReport = viewModel::loadQuestReport,
                    onSpeak = viewModel::speak,
                    speakingChar = state.speakingChar,
                    onClose = viewModel::closeQuest,
                )
            }
        }

        if (state.error.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(state.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }

    // 全屏查看原题照片（点击图片卡触发）
    val fullPhotoBytes = state.imageBytes
    if (showFullPhoto && fullPhotoBytes != null) {
        FullPhotoDialog(
            bytes = fullPhotoBytes,
            onDismiss = { showFullPhoto = false },
        )
    }
}

/** 原题照片卡：等比缩略展示，点击放大全屏查看 */
@Composable
private fun PhotoCard(
    bytes: ByteArray,
    onClick: () -> Unit,
) {
    val bitmap = remember(bytes) { decodeByteArrayOriented(bytes) } ?: return
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F5F5)),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Text(
                "📷 原题照片（点一下放大看细节）",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF212121),
            )
            Spacer(Modifier.height(6.dp))
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "原题照片",
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(bitmap.width.toFloat() / bitmap.height.toFloat())
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClick = onClick),
            )
        }
    }
}

/** 全屏查看原题照片（点 ✕ 关闭） */
@Composable
private fun FullPhotoDialog(
    bytes: ByteArray,
    onDismiss: () -> Unit,
) {
    val bitmap = remember(bytes) { decodeByteArrayOriented(bytes) }
    Dialog(onDismissRequest = onDismiss) {
        Surface(color = Color.Black) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "📷 原题照片",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "✕",
                        style = MaterialTheme.typography.titleLarge,
                        color = Color.White,
                        modifier = Modifier
                            .padding(6.dp)
                            .clickable(onClick = onDismiss),
                    )
                }
                if (bitmap != null) {
                    // 双指捏合缩放 / 拖动平移 / 双击复位
                    var zoom by remember { mutableStateOf(1f) }
                    var pan by remember { mutableStateOf(Offset.Zero) }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .clipToBounds()
                            .pointerInput(Unit) {
                                detectTransformGestures { _, panChange, zoomChange, _ ->
                                    zoom = (zoom * zoomChange).coerceIn(1f, 6f)
                                    pan += panChange
                                }
                            }
                            .pointerInput(Unit) {
                                detectTapGestures(onDoubleTap = {
                                    zoom = 1f
                                    pan = Offset.Zero
                                })
                            },
                    ) {
                        Image(
                            bitmap = bitmap.asImageBitmap(),
                            contentDescription = "原题照片（双指缩放）",
                            modifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    scaleX = zoom
                                    scaleY = zoom
                                    translationX = pan.x
                                    translationY = pan.y
                                },
                            contentScale = ContentScale.Fit,
                        )
                    }
                }
            }
        }
    }
}

private fun cameraUri(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

private fun questTypeIcon(type: String): String = when (type) {
    "concept" -> "💡"
    "understand" -> "📖"
    "extract" -> "🔍"
    "relation" -> "🧩"
    "formula" -> "✏️"
    "summary" -> "🎉"
    else -> "❓"
}

/** 闯关面板：进度 + 问题卡 + 选项 + 反馈 + 记录/回溯 + 错题回练 + 掌握报告 */
@Composable
private fun QuestPanel(
    state: AiHomeworkUiState,
    currentStep: com.example.ai.data.aihomework.QuestStepData?,
    onAnswer: (Int) -> Unit,
    onNext: () -> Unit,
    onRetry: () -> Unit,
    onHistory: () -> Unit,
    onReplay: (String) -> Unit,
    onRetryErrors: () -> Unit,
    onReport: () -> Unit,
    onSpeak: (String) -> Unit,
    speakingChar: String?,
    onClose: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F8E9)),
        border = BorderStroke(1.dp, Color(0xFFA5D6A7)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // 进度 + 记录 + 关闭
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "🎮 闯关（${state.questCurrentIndex + 1}/${state.questTotal}）",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "📜",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.clickable(onClick = onHistory).padding(4.dp),
                )
                Text(
                    "✕",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.clickable(onClick = onClose).padding(4.dp),
                )
            }
            Spacer(Modifier.height(4.dp))

            if (state.questDone) {
                // 完成
                Text("🎉 闯关成功！", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(4.dp))
                Text(
                    "你已经能一步步自己解出这类题了。",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(8.dp))
                Row {
                    Button(onClick = onRetryErrors, enabled = !state.questRetrying, modifier = Modifier.weight(1f)) {
                        Text(if (state.questRetrying) "生成中…" else "🔁 错题回练")
                    }
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = onReport, modifier = Modifier.weight(1f)) { Text("📊 掌握报告") }
                }
                Spacer(Modifier.height(8.dp))
                Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("完成，关闭闯关") }
                return@Card
            }

            // ── 记录面板：每步作答 + 回溯 + 报告 + 错题回练 ──
            if (state.questShowHistory) {
                Text("📜 闯关记录", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                if (state.questHistoryLoading) {
                    Text("加载中…", style = MaterialTheme.typography.bodySmall)
                } else if (state.questHistory.isEmpty()) {
                    Text("还没有作答记录。", style = MaterialTheme.typography.bodySmall, color = Color(0xFF37474F))
                } else {
                    state.questHistory.forEach { h ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "第${h.stepIndex + 1}步",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.width(44.dp),
                            )
                            Text(
                                if (h.lastCorrect) "✓" else "✗",
                                style = MaterialTheme.typography.labelLarge,
                                color = if (h.lastCorrect) Color(0xFF2E7D32) else Color(0xFFB71C1C),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                h.lastAnswer.take(16) + if (h.answerCount > 1) "（${h.answerCount}次）" else "",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color(0xFF000000),
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (!h.lastCorrect) {
                                TextButton(onClick = { onReplay(h.checkpointId) }) { Text("↩ 重做") }
                            }
                        }
                    }
                    // 掌握报告
                    Spacer(Modifier.height(6.dp))
                    Button(onClick = onReport, modifier = Modifier.fillMaxWidth()) { Text("📊 掌握报告") }
                    // 错题回练
                    Spacer(Modifier.height(6.dp))
                    OutlinedButton(onClick = onRetryErrors, enabled = !state.questRetrying, modifier = Modifier.fillMaxWidth()) {
                        Text(if (state.questRetrying) "生成中…" else "🔁 错题回练（答错步骤重做）")
                    }
                }
                // 报告内容
                state.questReport?.let { rep ->
                    Spacer(Modifier.height(10.dp))
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD))) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(
                                "📊 掌握报告（通过 ${rep.passedSteps}/${rep.totalSteps} 步 · 共答 ${rep.attempts} 次）",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF000000),
                            )
                            Spacer(Modifier.height(4.dp))
                            SpeakableText(
                                text = rep.summary,
                                onSpeak = onSpeak,
                                speakingChar = speakingChar,
                            )
                            if (rep.wrongSteps.isNotEmpty()) {
                                Spacer(Modifier.height(4.dp))
                                rep.wrongSteps.forEach { w ->
                                    Text(
                                        "✗ 第${w.index + 1}步：${w.question.take(28)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color(0xFF000000),
                                    )
                                }
                            }
                        }
                    }
                }
                return@Card
            }

            // 回溯提示
            if (state.questReplayHint.isNotEmpty()) {
                Text(
                    state.questReplayHint,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF2E7D32),
                )
                Spacer(Modifier.height(4.dp))
            }

            val step = currentStep
            if (step == null) {
                Text("闯关已结束", style = MaterialTheme.typography.bodyMedium)
                return@Card
            }

            // ── 子问题模式：答错后降解出的更简单问题 ──
            val sub = state.questSubQuestion
            if (sub != null) {
                if (state.questFeedback.isNotEmpty()) {
                    SpeakableText(
                        text = state.questFeedback,
                        onSpeak = onSpeak,
                        speakingChar = speakingChar,
                        highlightColor = Color(0xFFB71C1C),
                    )
                    Spacer(Modifier.height(6.dp))
                }
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1))) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        Text(
                            "💡 更简单的问法：${sub.question}",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF000000),
                        )
                        Spacer(Modifier.height(8.dp))
                        @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                        androidx.compose.foundation.layout.FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            sub.options.forEachIndexed { i, opt ->
                                Card(
                                    modifier = Modifier.clickable(enabled = !state.questAnswering) { onAnswer(i) },
                                    colors = CardDefaults.cardColors(containerColor = if (state.questAnswering) Color(0xFFE0E0E0) else Color(0xFFFFFFFF)),
                                    border = BorderStroke(1.dp, Color(0xFFFFB300)),
                                ) {
                                    Text(
                                        opt,
                                        style = MaterialTheme.typography.bodyMedium,
                                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                                    )
                                }
                            }
                        }
                    }
                }
                return@Card
            }

            // ── 子问题答对 → 回到原题 ──
            if (state.questSubBackToOriginal) {
                SpeakableText(
                    text = state.questFeedback.ifBlank { "很好！现在回到原来的问题再试一次。" },
                    onSpeak = onSpeak,
                    speakingChar = speakingChar,
                    highlightColor = Color(0xFF2E7D32),
                )
                Spacer(Modifier.height(8.dp))
                Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) { Text("回到原题再试 →") }
                return@Card
            }

            // 问题
            Text(
                "${questTypeIcon(step.type)} ${step.question}",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF000000),
            )
            Spacer(Modifier.height(8.dp))

            if (!state.questAnswered) {
                // 选项
                @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                androidx.compose.foundation.layout.FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    step.options.forEachIndexed { i, opt ->
                        Card(
                            modifier = Modifier.clickable(enabled = !state.questAnswering) { onAnswer(i) },
                            colors = CardDefaults.cardColors(containerColor = if (state.questAnswering) Color(0xFFE0E0E0) else Color(0xFFFFFFFF)),
                            border = BorderStroke(1.dp, Color(0xFF66BB6A)),
                        ) {
                            Text(
                                opt,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            } else {
                // 反馈区
                val feedbackColor = when {
                    state.questCorrect -> Color(0xFF2E7D32)
                    state.questConceptExplain.isNotEmpty() -> Color(0xFF0D47A1)
                    else -> Color(0xFFB71C1C)
                }
                if (state.questConceptExplain.isNotEmpty()) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD))) {
                        SpeakableText(
                            text = "💡 概念讲解：${state.questConceptExplain}",
                            onSpeak = onSpeak,
                            speakingChar = speakingChar,
                            modifier = Modifier.padding(10.dp),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                }
                if (state.questFeedback.isNotEmpty()) {
                    SpeakableText(
                        text = state.questFeedback,
                        onSpeak = onSpeak,
                        speakingChar = speakingChar,
                        highlightColor = feedbackColor,
                    )
                    Spacer(Modifier.height(8.dp))
                }
                if (state.questCorrect || state.questConceptExplain.isNotEmpty()) {
                    Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) { Text("下一步 →") }
                } else {
                    Row {
                        Button(onClick = onRetry, modifier = Modifier.weight(1f)) { Text("再试一次") }
                    }
                }
            }
        }
    }
}
