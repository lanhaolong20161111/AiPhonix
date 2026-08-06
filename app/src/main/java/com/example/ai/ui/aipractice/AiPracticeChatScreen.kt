package com.example.ai.ui.aipractice

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.tts.TtsEngine

/** 按句子切分（保留句末标点），用于句子级喇叭 */
private fun splitSentences(text: String): List<String> =
    text.split(Regex("(?<=[。！？!?.;；])"))
        .map { it.trim() }
        .filter { it.isNotBlank() }

/** 按段落切分 */
private fun splitParagraphs(text: String): List<String> =
    text.split(Regex("\\n+"))
        .map { it.trim() }
        .filter { it.isNotBlank() }

/**
 * ai陪我练 会话页：
 * - 多轮对话气泡；AI 回答按段落/句子分段，段落 🔊 与句子 🎵 不同图标可反复点播
 * - 学生回答下方展示 纠正（橙）/ 表扬（绿）对比行
 * - 语音回答：识别中暂停后继续 → 文字追加不清空；录音自动保存 wav
 */
@Composable
fun AiPracticeChatScreen(
    viewModel: AiPracticeChatViewModel,
    ttsEngine: TtsEngine,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val ttsSpeaking by ttsEngine.isSpeaking.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        // 顶部栏
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedButton(onClick = onBack) { Text("← 返回") }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    state.content.take(18) + if (state.content.length > 18) "…" else "",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    if (state.done) "✅ 练习已完成" else "⏳ 进行中",
                    fontSize = 12.sp,
                    color = if (state.done) Color(0xFF2E7D32) else MaterialTheme.colorScheme.primary,
                )
            }
        }

        if (state.error.isNotBlank()) {
            Text(
                state.error,
                color = MaterialTheme.colorScheme.error,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }

        // 对话区
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(state.turns, key = { "${it.role}_${it.hashCode()}" }) { turn ->
                if (turn.role == "ai") {
                    AiBubble(turn.text, ttsSpeaking, viewModel::speak)
                } else {
                    UserBubble(turn.text, turn.correction, turn.praise)
                }
            }
            if (state.done) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
                    ) {
                        Text(
                            "🎉 今天的练习完成啦！\n可以去「我的学习」查看记录。",
                            modifier = Modifier.padding(14.dp),
                            fontSize = 14.sp,
                            color = Color(0xFF2E7D32),
                        )
                    }
                }
            }
            if (state.sending) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.width(18.dp).height(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("AI 正在思考…", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item { Spacer(Modifier.height(4.dp)) }
        }

        // 输入区
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = state.answerDraft,
                onValueChange = viewModel::updateDraft,
                modifier = Modifier.weight(1f),
                placeholder = { Text("打字或按住🎤说话") },
                maxLines = 3,
                enabled = !state.done,
            )
            if (state.partialText.isNotBlank()) {
                Text(
                    state.partialText,
                    fontSize = 12.sp,
                    color = Color.Gray,
                    modifier = Modifier.padding(start = 8.dp, bottom = 14.dp).widthIn(max = 100.dp),
                )
            }
            Spacer(Modifier.width(6.dp))
            IconButton(
                onClick = {
                    if (state.recording) viewModel.stopVoice() else viewModel.startVoice()
                },
                enabled = !state.done,
            ) {
                Text(
                    if (state.recording) "⏹️" else "🎤",
                    fontSize = 24.sp,
                    textAlign = TextAlign.Center,
                )
            }
            IconButton(
                onClick = viewModel::sendCurrent,
                enabled = state.answerDraft.isNotBlank() && !state.sending && !state.done,
            ) {
                Text("➤", fontSize = 24.sp)
            }
        }
    }
}

/** AI 气泡：段落 🔊 + 句子 🎵 两级喇叭 */
@Composable
private fun AiBubble(
    text: String,
    ttsSpeaking: Boolean,
    onSpeak: (String) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🤖", fontSize = 16.sp)
                Spacer(Modifier.width(4.dp))
                Text("AI 老师", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.weight(1f))
                // 段落喇叭（整段朗读）
                IconButton(
                    onClick = { onSpeak(text) },
                    enabled = !ttsSpeaking,
                    modifier = Modifier.width(36.dp).height(36.dp),
                ) {
                    Text("🔊", fontSize = 18.sp, modifier = Modifier.alpha(if (ttsSpeaking) 0.38f else 1f))
                }
            }
            Spacer(Modifier.height(4.dp))
            splitParagraphs(text).forEach { para ->
                Column {
                    splitSentences(para).forEach { sentence ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                sentence,
                                fontSize = 15.sp,
                                lineHeight = 22.sp,
                                modifier = Modifier.weight(1f),
                            )
                            // 句子喇叭（单句朗读）
                            IconButton(
                                onClick = { onSpeak(sentence) },
                                enabled = !ttsSpeaking,
                                modifier = Modifier.width(34.dp).height(34.dp),
                            ) {
                                Text("🎵", fontSize = 15.sp, modifier = Modifier.alpha(if (ttsSpeaking) 0.38f else 1f))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 学生气泡：回答 + 纠正/表扬对比行 */
@Composable
private fun UserBubble(
    text: String,
    correction: String,
    praise: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.End,
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)),
        ) {
            Text(text, fontSize = 15.sp, modifier = Modifier.padding(12.dp))
        }
        if (correction.isNotBlank()) {
            Card(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0)),
            ) {
                Text(
                    "✏️ 纠正：$correction",
                    fontSize = 13.sp,
                    color = Color(0xFFE65100),
                    modifier = Modifier.padding(10.dp),
                )
            }
        }
        if (praise.isNotBlank() && correction.isBlank()) {
            Card(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
            ) {
                Text(
                    "🌟 $praise",
                    fontSize = 13.sp,
                    color = Color(0xFF2E7D32),
                    modifier = Modifier.padding(10.dp),
                )
            }
        }
    }
}
