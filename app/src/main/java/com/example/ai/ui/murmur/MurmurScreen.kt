package com.example.ai.ui.murmur

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.model.PronunciationResult
import java.io.File

/**
 * 碎碎念页面 — 自由表达 → AI 语法纠错 → 正确句子朗读+测评
 *
 * 流程：
 * 1. 文本框输入 / 拍照 / 相册识别 → 导入文字内容
 * 2. 点击「给AI审核」→ AI 检查语法错误，红色波浪线标注错误处
 * 3. 展示 AI 写的正确句子
 * 4. 正确句子可 TTS 朗读、可录音测评
 */
@Composable
fun MurmurScreen(
    viewModel: MurmurViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // 页面离开时停止朗读和录音
    DisposableEffect(Unit) {
        onDispose {
            if (state.isRecording) viewModel.stopScoring()
        }
    }

    // 拍照
    var pendingPhotoFile by remember { mutableStateOf<File?>(null) }
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        pendingPhotoFile?.let { file ->
            if (ok) {
                val uri = Uri.fromFile(file)
                viewModel.importFromImage(uri, context)
            }
            file.delete()
            pendingPhotoFile = null
        }
    }

    // 相册选图
    val pickFromGallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.importFromImage(it, context) }
    }

    // 麦克风权限
    var pendingMic by remember { mutableStateOf(false) }
    val micPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            viewModel.startScoring()
        } else {
            Toast.makeText(context, "需要麦克风权限才能录音测评", Toast.LENGTH_SHORT).show()
        }
        pendingMic = false
    }

    fun onMicClick() {
        if (state.isSpeaking || state.isScoring) return
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            viewModel.startScoring()
        } else {
            pendingMic = true
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
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
                modifier = Modifier.padding(end = 8.dp),
            )
            Text("💬 碎碎念", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { viewModel.reset() }) {
                Text("清空", style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "随便说点什么 → AI 帮你纠错 → 学正确说法",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF666666),
        )

        Spacer(Modifier.height(16.dp))

        // ── 输入区 ──
        OutlinedTextField(
            value = state.inputText,
            onValueChange = viewModel::updateInput,
            modifier = Modifier.fillMaxWidth(),
            minLines = 4,
            maxLines = 8,
            placeholder = { Text("随便说说今天发生了什么、你的想法、你的感受...") },
        )

        Spacer(Modifier.height(8.dp))

        // 图片导入按钮
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(
                onClick = {
                    val dir = File(context.cacheDir, "murmur_photos").apply { mkdirs() }
                    val file = File(dir, "murmur_${System.currentTimeMillis()}.jpg")
                    pendingPhotoFile = file
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                    takePicture.launch(uri)
                },
                modifier = Modifier.weight(1f),
                enabled = !state.isOcrProcessing,
            ) { Text("📷 拍照") }
            OutlinedButton(
                onClick = { pickFromGallery.launch("image/*") },
                modifier = Modifier.weight(1f),
                enabled = !state.isOcrProcessing,
            ) { Text("🖼️ 相册") }
        }

        // OCR 处理中
        if (state.isOcrProcessing) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("正在识别图片文字...", style = MaterialTheme.typography.bodySmall)
            }
        }

        Spacer(Modifier.height(12.dp))

        // ── 给 AI 审核 按钮 ──
        Button(
            onClick = viewModel::submitForReview,
            enabled = !state.isReviewing && state.inputText.trim().isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.isReviewing) "AI 正在审核..." else "✅ 给 AI 审核")
        }

        // 审核中
        if (state.isReviewing) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("正在分析语法...", style = MaterialTheme.typography.bodySmall)
            }
        }

        // ── 审核结果：原文 + 红色波浪线标注错误 ──
        if (state.errorSpans.isNotEmpty() || state.correctedSentence.isNotBlank()) {
            Spacer(Modifier.height(20.dp))

            // 原文标注区
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0)),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "📝 你的原文（红色波浪线 = 语法错误）",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFE65100),
                    )
                    Spacer(Modifier.height(8.dp))
                    // 用 AnnotatedString 渲染红色波浪线
                    val annotatedText = buildAnnotatedOriginalText(
                        text = state.inputText,
                        errorSpans = state.errorSpans,
                    )
                    Text(
                        text = annotatedText,
                        style = MaterialTheme.typography.bodyLarge,
                        fontSize = 18.sp,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // 纠错说明
            if (state.correctionNotes.isNotBlank()) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD)),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "💡 错误说明",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF1565C0),
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            state.correctionNotes,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF0D47A1),
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
            }

            // 正确句子
            if (state.correctedSentence.isNotBlank()) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "✅ 正确的句子",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF2E7D32),
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            state.correctedSentence,
                            style = MaterialTheme.typography.bodyLarge,
                            fontSize = 19.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color(0xFF1B5E20),
                        )
                        Spacer(Modifier.height(12.dp))

                        // 操作按钮行：朗读 + 测评
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            // TTS 朗读
                            OutlinedButton(
                                onClick = viewModel::speakCorrected,
                                enabled = !state.isSpeaking && !state.isRecording,
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(if (state.isSpeaking) "🔊 朗读中..." else "🔊 朗读")
                            }
                            // 发音测评
                            OutlinedButton(
                                onClick = {
                                    if (state.isRecording) {
                                        viewModel.stopScoring()
                                    } else {
                                        onMicClick()
                                    }
                                },
                                enabled = !state.isSpeaking,
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(
                                    if (state.isRecording) "⏹ 停止录音" else "🎤 测评",
                                    color = if (state.isRecording) Color(0xFFC62828) else Color.Unspecified,
                                )
                            }
                        }

                        // 测评结果
                        state.pronunciationResult?.let { result ->
                            Spacer(Modifier.height(12.dp))
                            ScoreCard(result)
                        }

                        // 测评中
                        if (state.isScoring && !state.isRecording) {
                            Spacer(Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text("正在评分...", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        // 录音中提示
                        if (state.isRecording) {
                            Spacer(Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("🔴 录音中，读完点「停止录音」", style = MaterialTheme.typography.bodySmall, color = Color(0xFFC62828))
                            }
                        }
                    }
                }
            }
        }

        // 错误提示
        state.error?.let { errMsg ->
            Spacer(Modifier.height(12.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
            ) {
                Text(
                    "⚠️ $errMsg",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFFC62828),
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        Spacer(Modifier.height(80.dp))
    }
}

/**
 * 构建带红色波浪线标注的原文 AnnotatedString
 */
private fun buildAnnotatedOriginalText(
    text: String,
    errorSpans: List<GrammarErrorSpan>,
): AnnotatedString {
    return buildAnnotatedString {
        if (errorSpans.isEmpty()) {
            append(text)
            return@buildAnnotatedString
        }
        // 按起始位置排序
        val sorted = errorSpans.sortedBy { it.start }
        var cursor = 0
        for (span in sorted) {
            // 安全裁剪
            val s = span.start.coerceIn(0, text.length)
            val e = span.end.coerceIn(s, text.length)
            if (s > cursor) {
                append(text.substring(cursor, s))
            }
            // 标注错误区间：红色 + 波浪线
            withStyle(SpanStyle(
                color = Color(0xFFD32F2F),
                textDecoration = TextDecoration.Underline,
            )) {
                append(text.substring(s, e))
            }
            cursor = e
        }
        // 剩余部分
        if (cursor < text.length) {
            append(text.substring(cursor))
        }
    }
}

/**
 * 发音测评结果卡片
 */
@Composable
private fun ScoreCard(result: PronunciationResult) {
    val score = result.totalScore
    val scoreColor = when {
        score >= 80 -> Color(0xFF2E7D32)
        score >= 60 -> Color(0xFFF57F17)
        else -> Color(0xFFC62828)
    }
    val scoreEmoji = when {
        score >= 80 -> "🎉"
        score >= 60 -> "👍"
        else -> "💪"
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF3E5F5)),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "$scoreEmoji 发音得分",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "$score 分",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = scoreColor,
                )
            }
            Spacer(Modifier.height(6.dp))
            // 流利度 / 完整度
            Row {
                InfoChip("流利度", "${(result.fluencyScore * 100).toInt()}%")
                Spacer(Modifier.width(8.dp))
                InfoChip("完整度", "${(result.integrityScore * 100).toInt()}%")
            }
            Spacer(Modifier.height(6.dp))
            Text(
                result.feedback ?: "",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF424242),
            )
        }
    }
}

@Composable
private fun InfoChip(label: String, value: String) {
    Surface(
        color = Color(0xFFE1BEE7),
        shape = RoundedCornerShape(8.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = Color(0xFF6A1B9A))
            Spacer(Modifier.width(4.dp))
            Text(value, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Color(0xFF4A148C))
        }
    }
}
