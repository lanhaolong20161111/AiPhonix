package com.example.ai.ui.sentencepractice

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 句子跟读练习页：显示句子 → 录音 → SOE 评分 → 下一句。
 * 支持 sentence（英文句子）与 pinyin（中文句子+拼音）两类导入数据。
 */
@Composable
fun SentenceReadingScreen(
    viewModel: SentenceReadingViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedButton(onClick = onBack) { Text("← 返回") }
            Spacer(Modifier.width(12.dp))
            Text("🗣️ 句子跟读", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))

        when {
            state.loading -> {
                Spacer(Modifier.height(120.dp))
                CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
            }
            state.empty -> {
                Spacer(Modifier.height(120.dp))
                Text(
                    "还没有句子。\n去「导入学习内容 → 文本 → 句子/句型 或 句子拼音」导入后，这里就能跟读了。",
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                    fontSize = 15.sp,
                )
            }
            state.finished -> {
                FinishedSection(
                    total = state.items.size,
                    passed = state.scores.values.count { it >= 80 },
                    submitting = state.submitting,
                    submitted = state.submitted,
                    message = state.message,
                    onSubmit = viewModel::submit,
                )
            }
            else -> {
                val item = state.items.getOrNull(state.currentIndex) ?: return
                SentenceCard(
                    index = state.currentIndex,
                    total = state.items.size,
                    item = item,
                    state = state,
                    onStart = viewModel::startRecording,
                    onStop = viewModel::stopRecording,
                    onNext = viewModel::next,
                    onSkip = viewModel::skip,
                )
            }
        }
    }
}

@Composable
private fun SentenceCard(
    index: Int,
    total: Int,
    item: SentenceItem,
    state: SentencePracticeUiState,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onNext: () -> Unit,
    onSkip: () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        LinearProgressIndicator(
            progress = { (index + 1).toFloat() / total },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        Text("第 ${index + 1} / $total 句", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = if (item.kind == "pinyin")
                    MaterialTheme.colorScheme.secondaryContainer
                else
                    MaterialTheme.colorScheme.primaryContainer,
            ),
        ) {
            Column(Modifier.padding(20.dp)) {
                Text(
                    item.text,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    lineHeight = 32.sp,
                )
                if (item.pinyin.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        item.pinyin,
                        fontSize = 17.sp,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                if (item.translation.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        item.translation,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        // 录音 / 评测状态区
        when {
            state.recording -> {
                Text("🔴 正在录音… 读完后点「停止」", fontSize = 15.sp, color = Color(0xFFC62828))
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = onStop,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC62828)),
                ) { Text("⏹ 停止并评分") }
            }
            state.evaluating -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.width(24.dp).height(24.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("正在评测…", fontSize = 15.sp)
                }
            }
            state.error != null -> {
                Text(state.error, fontSize = 14.sp, color = Color(0xFFC62828))
                Spacer(Modifier.height(12.dp))
                Button(onClick = onStart, modifier = Modifier.fillMaxWidth()) { Text("🎙️ 重新录音") }
            }
            state.score != null -> {
                val color = if (state.passed) Color(0xFF2E7D32) else Color(0xFFC62828)
                Text(
                    "得分 ${state.score} 分",
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    color = color,
                )
                if (state.feedback != null) {
                    Spacer(Modifier.height(4.dp))
                    Text(state.feedback, fontSize = 15.sp)
                }
                Spacer(Modifier.height(16.dp))
                Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
                    Text(if (index + 1 >= total) "查看结果" else "下一句 →")
                }
            }
            else -> {
                Button(onClick = onStart, modifier = Modifier.fillMaxWidth()) { Text("🎙️ 跟读录音") }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = onSkip, modifier = Modifier.fillMaxWidth()) { Text("跳过这句") }
            }
        }
    }
}

@Composable
private fun FinishedSection(
    total: Int,
    passed: Int,
    submitting: Boolean,
    submitted: Boolean,
    message: String,
    onSubmit: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🎉 跟读完成", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Text("达标 $passed / $total 句", fontSize = 20.sp)
        Spacer(Modifier.height(8.dp))
        Text(
            "达标率 ${if (total > 0) (passed * 100 / total) else 0}%（80 分以上算达标）",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        Button(onClick = onSubmit, enabled = !submitted && !submitting, modifier = Modifier.fillMaxWidth()) {
            Text(
                when {
                    submitted -> "✅ 已保存记录"
                    submitting -> "保存中…"
                    else -> "保存练习记录"
                },
            )
        }
        if (message.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(message, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
