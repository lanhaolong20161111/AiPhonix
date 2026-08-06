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
fun WordPracticeScreen(
    viewModel: WordPracticeViewModel,
    speaking: Boolean,
    onPlayTts: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    LaunchedEffect(Unit) {
        viewModel.onPlayTts = onPlayTts
    }

    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("词语练习") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        when {
            state.loading && state.items.isEmpty() -> {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator()
                        Spacer(Modifier.height(8.dp))
                        Text(state.message)
                    }
                }
            }
            state.items.isEmpty() -> {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Text(state.message.ifEmpty { "题库为空" })
                }
            }
            state.reviewPhase -> {
                ReviewPhase(
                    items = state.items,
                    onMark = { idx, correct -> viewModel.markItem(idx, correct) },
                    onSubmit = { viewModel.submitResults() },
                    submitted = state.submitted,
                    message = state.message,
                    onBack = onBack,
                    modifier = Modifier.padding(padding)
                )
            }
            else -> {
                ReadingPhase(
                    viewModel = viewModel,
                    state = state,
                    speaking = speaking,
                    modifier = Modifier.padding(padding)
                )
            }
        }
    }
}

@Composable
private fun ReadingPhase(
    viewModel: WordPracticeViewModel,
    state: WordPracticeUiState,
    speaking: Boolean,
    modifier: Modifier = Modifier
) {
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

        Spacer(Modifier.height(24.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.secondaryContainer
            )
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // 当前词语（方块遮挡）
                Text(
                    text = state.currentWord.map { '█' }.joinToString(""),
                    fontSize = 56.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSecondaryContainer
                )
                // 年级标签
                val gradeTag = state.items.getOrNull(state.currentIndex)?.entry?.tags
                    ?.firstOrNull { it.contains("年级") } ?: ""
                if (gradeTag.isNotEmpty()) {
                    Text(
                        text = gradeTag,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
                    )
                }
                Spacer(Modifier.height(12.dp))

                // 阶段提示（只挡词语，不挡句子）
                val phaseText = when (state.currentPhase) {
                    "reading_word" -> "🔊 ${state.message}"
                    "reading_sentence" -> "📖 ${maskWord(state.currentSentence, state.currentWord)}"
                    "waiting" -> "✍️ 请写出词语，即将进入下一题..."
                    else -> "🔊 准备中..."
                }
                Text(
                    text = phaseText,
                    fontSize = 16.sp,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSecondaryContainer
                )
                // 例句生成失败 → 本地默认句提示
                if (state.sentenceFallback) {
                    Text(
                        text = "⚠️ 例句生成失败，正在使用本地默认句（联网后可自动获取）",
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center,
                        color = Color(0xFFE65100),
                        modifier = Modifier.padding(top = 6.dp)
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
    items: List<WordPracticeItem>,
    onMark: (Int, Boolean) -> Unit,
    onSubmit: () -> Unit,
    submitted: Boolean,
    message: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val correctCount = items.count { it.isCorrect == true }
    val allMarked = items.all { it.isCorrect != null }

    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("默写完成！请对照检查", fontSize = 22.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 16.dp))
        Text("已确认: $correctCount / ${items.size}", fontSize = 16.sp,
            color = if (correctCount == items.size) Color(0xFF4CAF50) else MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(12.dp))

        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(items) { index, item ->
                val correct = item.isCorrect
                val bgColor = when (correct) {
                    true -> Color(0xFFE8F5E9)
                    false -> Color(0xFFFFEBEE)
                    null -> MaterialTheme.colorScheme.surfaceVariant
                }
                Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = bgColor)) {
                    Row(modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(modifier = Modifier.weight(1f)) {
                            // 显示正确答案（不再遮挡）
                            Text(item.entry.text, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                            val gTag = item.entry.tags.firstOrNull { it.contains("年级") } ?: ""
                            if (gTag.isNotEmpty()) {
                                Text(gTag, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(item.sentence, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (correct == null) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilledTonalButton(onClick = { onMark(index, true) },
                                    colors = ButtonDefaults.filledTonalButtonColors(containerColor = Color(0xFF4CAF50))
                                ) { Text("\u2713", fontSize = 20.sp) }
                                FilledTonalButton(onClick = { onMark(index, false) },
                                    colors = ButtonDefaults.filledTonalButtonColors(containerColor = Color(0xFFE53935))
                                ) { Text("\u2717", fontSize = 20.sp) }
                            }
                        } else {
                            Text(if (correct) "\u2713" else "\u2717", fontSize = 24.sp, fontWeight = FontWeight.Bold,
                                color = if (correct) Color(0xFF4CAF50) else Color(0xFFE53935))
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        if (message.isNotEmpty()) { Text(message, fontSize = 14.sp); Spacer(Modifier.height(8.dp)) }

        if (submitted) {
            Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("返回") }
        } else {
            Button(onClick = onSubmit, modifier = Modifier.fillMaxWidth(), enabled = allMarked) {
                Text(if (allMarked) "提交记录" else "请确认所有词语")
            }
        }
    }
}
