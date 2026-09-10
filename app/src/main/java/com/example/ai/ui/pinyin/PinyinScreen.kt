package com.example.ai.ui.pinyin

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.draw.clip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** 拼音练习：只显示拼音和音调，点击评测；总分 ≥70 进入下一关 */
@Composable
fun PinyinScreen(
    viewModel: PinyinViewModel,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        viewModel.initTts(context)
        viewModel.loadFirstLevel()
    }

    var pendingPinyin by remember { mutableStateOf<String?>(null) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingPinyin?.let { py ->
            if (granted) {
                val word = state.level.words.firstOrNull { it.pinyin == py }
                if (word != null) viewModel.toggleRecord(word)
            } else {
                Toast.makeText(context, "需要麦克风权限才能评测", Toast.LENGTH_SHORT).show()
            }
        }
        pendingPinyin = null
    }

    fun onRecord(word: com.example.ai.data.aichinese.PinyinWord) {
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            viewModel.toggleRecord(word)
        } else {
            pendingPinyin = word.pinyin
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
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
                "←",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clickable(onClick = onBack),
            )
            Text("🔤 拼音练习", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.weight(1f))
            Text(
                "第 ${state.levelIndex} 关",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "看着拼音读出来，读完后点 🎤 评测。总分 ≥70 才能进入下一关。",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF212121),
        )
        Spacer(Modifier.height(16.dp))

        if (state.loadingLevel) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("正在生成拼音关卡…", style = MaterialTheme.typography.bodySmall)
            }
        } else if (state.level.words.isEmpty()) {
            Text(state.error.ifBlank { "本关暂无词语" }, style = MaterialTheme.typography.bodyMedium, color = Color(0xFFB71C1C))
        } else {
            // 词语卡片：拼音（大）+ 汉字（小，评测通过后显示）
            state.level.words.forEach { word ->
                val score = state.scores[word.pinyin]
                val isRecording = state.recordingWord == word.pinyin
                val isEvaluating = state.evaluatingWord == word.pinyin
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = when {
                            score != null && score >= 70 -> Color(0xFFE8F5E9)
                            score != null -> Color(0xFFFFF3D6)
                            else -> Color(0xFFFFFFFF)
                        },
                    ),
                    border = BorderStroke(
                        1.dp,
                        when {
                            score != null && score >= 70 -> Color(0xFF66BB6A)
                            score != null -> Color(0xFFFFB300)
                            else -> MaterialTheme.colorScheme.outlineVariant
                        },
                    ),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            // 拼音按 声母/介母/韵母/整体认读音节 拆分显示，可点击单发音
                            if (word.parts.isNotEmpty()) {
                                @OptIn(ExperimentalLayoutApi::class)
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    word.parts.forEach { part ->
                                        val partColor = when (part.label) {
                                            "shengmu" -> Color(0xFF1565C0) // 声母蓝
                                            "jiemu" -> Color(0xFF6A1B9A)   // 介母紫
                                            "yunmu" -> Color(0xFF2E7D32)   // 韵母绿
                                            else -> Color(0xFFE65100)      // 整体认读音节橙
                                        }
                                        Text(
                                            part.text,
                                            fontSize = 24.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = partColor,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(if (state.isPlayingPart) Color(0xFFB3E5FC) else Color.Transparent)
                                                .clickable(enabled = !state.isPlayingPart) { viewModel.speakPart(part.audio) }
                                                .padding(horizontal = 4.dp, vertical = 1.dp),
                                        )
                                    }
                                }
                            } else {
                                Text(
                                    word.pinyin,
                                    fontSize = 24.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFF000000),
                                )
                            }
                            if (score != null) {
                                Text(
                                    word.hanzi,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = Color(0xFF37474F),
                                )
                            }
                        }
                        // 评分
                        if (score != null) {
                            Text(
                                "$score 分",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = if (score >= 70) Color(0xFF2E7D32) else Color(0xFFB71C1C),
                            )
                            Spacer(Modifier.width(10.dp))
                        }
                        // 评测按钮
                        if (isEvaluating) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Text(
                                if (isRecording) "⏹" else "🎤",
                                style = MaterialTheme.typography.titleMedium,
                                color = if (isRecording) Color(0xFFC62828) else Color.Unspecified,
                                modifier = Modifier
                                    .padding(start = 8.dp)
                                    .clickable(enabled = state.recordingWord == null || isRecording) { onRecord(word) },
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // 总分 + 过关
            if (state.scores.isNotEmpty()) {
                Text(
                    "本关总分：${state.totalScore} 分",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = when {
                        state.totalScore >= 70 -> Color(0xFF2E7D32)
                        else -> Color(0xFFB71C1C)
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
            }
            val allDone = state.scores.size == state.level.words.size
            if (allDone) {
                if (state.passed) {
                    Text(
                        "🎉 过关！总分 ${state.totalScore} ≥ 70，进入下一关！",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF2E7D32),
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(onClick = viewModel::nextLevel, modifier = Modifier.fillMaxWidth()) {
                        Text("下一关 →")
                    }
                } else {
                    Text(
                        "总分 ${state.totalScore} < 70，未过关。再练一练，点下面的按钮重试。",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFB71C1C),
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(onClick = viewModel::retryLevel, modifier = Modifier.fillMaxWidth()) {
                        Text("🔁 重练本关")
                    }
                }
            } else {
                Text(
                    "还有 ${state.level.words.size - state.scores.size} 个没练",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF37474F),
                )
            }
        }

        if (state.error.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(state.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(80.dp))
    }
}
