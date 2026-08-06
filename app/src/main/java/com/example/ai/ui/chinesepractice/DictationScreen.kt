package com.example.ai.ui.chinesepractice

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DictationScreen(
    viewModel: DictationViewModel,
    speaking: Boolean,
    onPlayTts: (String) -> Unit,
    onBack: () -> Unit
) {
    // 注入 TTS 回调
    LaunchedEffect(Unit) {
        viewModel.onPlayTts = onPlayTts
    }

    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("默写练习") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        if (state.loading && state.items.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(8.dp))
                    Text(state.message)
                }
            }
            return@Scaffold
        }

        if (state.items.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(state.message.ifEmpty { "题库为空" })
            }
            return@Scaffold
        }

        // 朗读阶段
        if (!state.reviewPhase && !state.finished) {
            ReadingPhase(
                viewModel = viewModel,
                state = state,
                speaking = speaking,
                modifier = Modifier.padding(padding)
            )
            return@Scaffold
        }

        // 回顾确认阶段
        if (state.reviewPhase) {
            ReviewPhase(
                items = state.items,
                onMark = { idx, correct -> viewModel.markItem(idx, correct) },
                onSubmit = { viewModel.submitResults() },
                submitted = state.submitted,
                message = state.message,
                onBack = onBack,
                modifier = Modifier.padding(padding)
            )
            return@Scaffold
        }
    }
}

@Composable
private fun ReadingPhase(
    viewModel: DictationViewModel,
    state: DictationUiState,
    speaking: Boolean,
    modifier: Modifier = Modifier
) {
    val current = state.items.getOrNull(state.currentIndex)

    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "第 ${state.currentIndex + 1}/${state.items.size} 题  ·  第${state.repeatCount}/${state.totalRepeats}遍",
            fontSize = 18.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(Modifier.height(32.dp))

        // 朗读状态指示
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.tertiaryContainer
            )
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // 当前字（方块遮挡，不给偷看）
                val char = state.items.getOrNull(state.currentIndex)?.entry?.text ?: ""
                val charEntry = state.items.getOrNull(state.currentIndex)?.entry
                val gradeTag = charEntry?.tags?.firstOrNull { it.contains("年级") } ?: ""
                val maskedChar = char.map { '█' }.joinToString("")
                Text(
                    text = maskedChar,
                    fontSize = 64.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onTertiaryContainer
                )
                if (gradeTag.isNotEmpty()) {
                    Text(
                        text = gradeTag,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f)
                    )
                }
                Spacer(Modifier.height(12.dp))

                // 朗读阶段提示（词语不遮挡，只挡字）
                val phaseText = when (state.currentPhase) {
                    "reading_char" -> "🔊 ${state.message}"
                    "reading_word1" -> "📝 听词语: ${maskChar(state.items.getOrNull(state.currentIndex)?.word1 ?: "", char)}"
                    "reading_word2" -> "📝 听词语: ${maskChar(state.items.getOrNull(state.currentIndex)?.word2 ?: "", char)}"
                    "waiting" -> "✍️ 请在纸上写下来，即将进入下一题..."
                    else -> "🔊 请认真听"
                }
                Text(
                    text = phaseText,
                    fontSize = 18.sp,
                    color = MaterialTheme.colorScheme.onTertiaryContainer
                )

                if (state.currentPhase == "waiting") {
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = state.message,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onTertiaryContainer
                    )
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        // 重播按钮
        OutlinedButton(onClick = { viewModel.reRead() }, enabled = !speaking) {
            Text("🔊 再听一遍")
        }
    }
}

@Composable
private fun ReviewPhase(
    items: List<DictationItem>,
    onMark: (Int, Boolean) -> Unit,
    onSubmit: () -> Unit,
    submitted: Boolean,
    message: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val allMarked = items.all { it.isCorrect != null }
    val correctCount = items.count { it.isCorrect == true }

    Column(
        modifier = modifier.fillMaxSize().padding(16.dp)
    ) {
        Text(
            text = "默写完成！请对照检查",
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        Text(
            text = "已确认: $correctCount / ${items.size}",
            fontSize = 16.sp,
            color = if (correctCount == items.size) Color(0xFF4CAF50)
            else MaterialTheme.colorScheme.primary
        )

        Spacer(Modifier.height(12.dp))

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            itemsIndexed(items) { index, item ->
                val correct = item.isCorrect
                val bgColor = when (correct) {
                    true -> Color(0xFFE8F5E9)
                    false -> Color(0xFFFFEBEE)
                    null -> MaterialTheme.colorScheme.surfaceVariant
                }

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = bgColor)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            // 显示正确答案 + 拼音（不再遮挡 █）
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = item.entry.text,
                                    fontSize = 28.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = item.entry.pinyin,
                                    fontSize = 16.sp,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            val gTag = item.entry.tags.firstOrNull { it.contains("年级") } ?: ""
                            if (gTag.isNotEmpty()) {
                                Text(text = gTag, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(
                                text = maskChar(item.word1.ifEmpty { item.entry.text }, item.entry.text),
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        if (correct == null) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilledTonalButton(
                                    onClick = { onMark(index, true) },
                                    colors = ButtonDefaults.filledTonalButtonColors(
                                        containerColor = Color(0xFF4CAF50)
                                    )
                                ) { Text("\u2713", fontSize = 20.sp) }

                                FilledTonalButton(
                                    onClick = { onMark(index, false) },
                                    colors = ButtonDefaults.filledTonalButtonColors(
                                        containerColor = Color(0xFFE53935)
                                    )
                                ) { Text("\u2717", fontSize = 20.sp) }
                            }
                        } else {
                            Text(
                                text = if (correct) "\u2713" else "\u2717",
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (correct) Color(0xFF4CAF50) else Color(0xFFE53935)
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        if (message.isNotEmpty()) {
            Text(text = message, fontSize = 14.sp, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
        }

        if (submitted) {
            Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
                Text("返回", fontSize = 18.sp)
            }
        } else {
            Button(
                onClick = onSubmit,
                modifier = Modifier.fillMaxWidth(),
                enabled = allMarked
            ) {
                Text(
                    if (allMarked) "提交记录" else "请确认所有字后提交",
                    fontSize = 18.sp
                )
            }
        }
    }
}
