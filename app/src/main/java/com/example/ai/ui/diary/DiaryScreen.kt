package com.example.ai.ui.diary

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.diary.DiaryStore
import com.example.ai.data.tts.BaiduTtsCache
import kotlinx.coroutines.launch

private val Black = Color(0xFF000000)
private val GoodText = Color(0xFF2E7D32)
private val BadText = Color(0xFFB71C1C)
private val LabelGray = Color(0xFF334155)
private val HintGray = Color(0xFF6B7280)

/**
 * 成长日记（对齐 web DiaryPage）：每天写一两句，AI 老师润色 + 点评，时间线回顾。
 * 记录存本地（随设备），只有润色走服务端 LLM。
 */
@Composable
fun DiaryScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember { DiaryStore(context.applicationContext) }
    val viewModel: DiaryViewModel = viewModel { DiaryViewModel(store) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val ttsCache = remember { BaiduTtsCache(context.applicationContext) }
    var pendingDelete by remember { mutableStateOf<String?>(null) }

    DisposableEffect(Unit) {
        onDispose { BaiduTtsCache.stopAll() }
    }

    val speak: (String) -> Unit = { text ->
        if (text.isNotBlank()) {
            BaiduTtsCache.stopAll()
            scope.launch { ttsCache.play(text, "0") }
        }
    }

    Column(modifier = modifier.fillMaxSize().padding(20.dp)) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("📖 成长日记", style = MaterialTheme.typography.titleLarge, color = Black)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "每天写一两句今天发生的事（用输入法的语音说话也可以），AI 老师帮你润色和点评。",
            fontSize = 13.sp,
            color = Black,
        )
        Spacer(Modifier.height(10.dp))

        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // ── 今日输入卡 ──
            item(key = "today") {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text(
                            "📅 ${DiaryStore.dateLabel(state.today)}",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = LabelGray,
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = state.text,
                            onValueChange = { viewModel.onTextChange(it) },
                            placeholder = { Text("今天发生了什么开心的事？学到了什么？", fontSize = 14.sp) },
                            enabled = !state.busy,
                            minLines = 3,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = { viewModel.submit() },
                            enabled = !state.busy && state.text.isNotBlank(),
                            colors = ButtonDefaults.buttonColors(containerColor = GoodText),
                        ) {
                            Text(
                                when {
                                    state.busy -> "AI 老师写评语中…"
                                    state.todayEntry != null -> "重新润色"
                                    else -> "交给 AI 老师"
                                },
                                color = Color.White,
                                fontSize = 14.sp,
                            )
                        }

                        if (state.error.isNotBlank()) {
                            Spacer(Modifier.height(8.dp))
                            Text(state.error, fontSize = 13.sp, color = BadText)
                        }

                        val todayEntry = state.todayEntry
                        if (todayEntry != null && todayEntry.polish.isNotBlank()) {
                            Spacer(Modifier.height(10.dp))
                            Text(
                                todayEntry.polish,
                                fontSize = 15.sp,
                                color = Color(0xFF1F2937),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFFF0FDF4), RoundedCornerShape(10.dp))
                                    .padding(10.dp),
                            )
                            Spacer(Modifier.height(6.dp))
                            TextButton(
                                onClick = { speak(todayEntry.polish) },
                                modifier = Modifier.semantics { contentDescription = "朗读润色后的日记" },
                            ) {
                                Text("🔊 朗读", fontSize = 13.sp, color = Black)
                            }
                        }
                        if (todayEntry != null && todayEntry.comment.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "💬 ${todayEntry.comment}",
                                fontSize = 13.sp,
                                color = Color(0xFF334155),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFFFFF7ED), RoundedCornerShape(10.dp))
                                    .padding(10.dp),
                            )
                        }
                    }
                }
            }

            // ── 时间线 ──
            item(key = "tl-head") {
                Text(
                    "🕰️ 时间线",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = LabelGray,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            if (state.entries.isEmpty()) {
                item(key = "tl-empty") {
                    Text("还没有日记，从今天开始吧", fontSize = 13.sp, color = HintGray)
                }
            } else {
                items(state.entries.size, key = { "d-${state.entries[it].date}" }) { idx ->
                    val e = state.entries[idx]
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                DiaryStore.dateLabel(e.date),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = HintGray,
                            )
                            if (e.polish.isNotBlank()) {
                                Spacer(Modifier.height(4.dp))
                                Text(e.polish, fontSize = 15.sp, color = Color(0xFF1F2937))
                            }
                            if (e.text.isNotBlank() && e.text != e.polish) {
                                Spacer(Modifier.height(4.dp))
                                Text("我的原话：${e.text}", fontSize = 12.sp, color = HintGray)
                            }
                            if (e.comment.isNotBlank()) {
                                Spacer(Modifier.height(4.dp))
                                Text("💬 ${e.comment}", fontSize = 13.sp, color = Color(0xFF334155))
                            }
                            Spacer(Modifier.height(4.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(
                                    onClick = { speak(e.polish.ifBlank { e.text }) },
                                    modifier = Modifier.semantics { contentDescription = "朗读 ${DiaryStore.dateLabel(e.date)} 的日记" },
                                ) {
                                    Text("🔊 朗读", fontSize = 13.sp, color = Black)
                                }
                                TextButton(
                                    onClick = { pendingDelete = e.date },
                                    modifier = Modifier.semantics { contentDescription = "删除 ${DiaryStore.dateLabel(e.date)} 的日记" },
                                ) {
                                    Text("🗑 删除", fontSize = 13.sp, color = Black)
                                }
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    // 删除确认（对齐 web 的 confirm）
    pendingDelete?.let { date ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除日记", fontSize = 16.sp) },
            text = { Text("删除 ${DiaryStore.dateLabel(date)} 的日记？", fontSize = 14.sp) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.delete(date)
                    pendingDelete = null
                }) {
                    Text("删除", color = BadText)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("取消", color = Black) }
            },
        )
    }
}
