package com.example.ai.ui.quiz

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuizScreen(
    videoName: String,
    srtPath: String,
    onBack: () -> Unit,
    viewModel: QuizViewModel = viewModel { QuizViewModel(container.quizRepository, container.ttsEngine) },
    container: com.example.ai.AppContainer,
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(videoName) {
        viewModel.loadQuiz(videoName, srtPath)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("考试模式", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, "返回")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when {
                state.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator()
                            Spacer(Modifier.height(12.dp))
                            Text("正在生成考题...", color = Color.Gray, fontSize = 14.sp)
                            Text("（AI 正在分析字幕内容）", color = Color.Gray, fontSize = 12.sp)
                        }
                    }
                }

                state.error != null -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(state.error!!, color = Color.Red)
                    }
                }

                state.isFinished -> {
                    FinishedContent(
                        score = state.score,
                        total = state.totalCount,
                        onRetry = { viewModel.reset(videoName, srtPath) },
                        onBack = onBack,
                    )
                }

                else -> {
                    QuizContent(
                        state = state,
                        onInputChange = { index, value -> viewModel.updateInput(index, value) },
                        onSubmit = { viewModel.submit() },
                        onHint = { viewModel.hint() },
                        onNext = { viewModel.nextQuestion() },
                        onRetry = { viewModel.retry() },
                        onSpeakHint = { viewModel.speakHint() },
                    )
                }
            }

            if (state.showConfetti) {
                ConfettiAnimation(
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun QuizContent(
    state: QuizState,
    onInputChange: (Int, String) -> Unit,
    onSubmit: () -> Unit,
    onHint: () -> Unit,
    onSpeakHint: () -> Unit,
    onNext: () -> Unit,
    onRetry: () -> Unit,
) {
    val item = state.currentItem ?: return
    val cleanWords = state.punctInfo.cleanWords
    val trailingPunct = state.punctInfo.trailingPunct
    val wordResults = state.wordResults

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // 题号 + 得分 + 尝试次数
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "📌 第 ${state.currentIndex + 1}/${state.totalCount} 题",
                fontSize = 14.sp,
                color = Color(0xFF616161),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (state.attempts > 0 && !state.isCorrect) {
                    Text(
                        text = "❌${state.attempts}/3 ",
                        fontSize = 12.sp,
                        color = Color(0xFFE53935),
                    )
                }
                Text("⭐ ", fontSize = 14.sp)
                Text(
                    text = "${state.score}/${state.totalCount}",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFF57C00),
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        // 中文提示区
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD)),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = "📖 请翻译成英文",
                    fontSize = 12.sp,
                    color = Color(0xFF757575),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = item.chinese,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF1565C0),
                    textAlign = TextAlign.Center,
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        // 英文填空区
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFFAFAFA)),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (state.isCloze) {
                    // 填空模式：显示带空句子 + 单输入框
                    Text(
                        text = item.display ?: item.english,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF333333),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(16.dp))

                    val result = wordResults?.firstOrNull()
                    val borderColor = when {
                        result == null -> Color(0xFFBDBDBD)
                        result.isCorrect -> Color(0xFF4CAF50)
                        else -> Color(0xFFE53935)
                    }
                    val bgColor = when {
                        result == null -> Color.White
                        result.isCorrect -> Color(0xFFE8F5E9)
                        else -> Color(0xFFFFEBEE)
                    }
                    OutlinedTextField(
                        value = state.userInputs.getOrElse(0) { "" },
                        onValueChange = { onInputChange(0, it) },
                        modifier = Modifier.widthIn(min = 120.dp, max = 300.dp),
                        placeholder = { Text("填写答案", fontSize = 16.sp) },
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(
                            fontSize = 20.sp,
                            textAlign = TextAlign.Center,
                            fontWeight = FontWeight.Bold,
                        ),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = borderColor,
                            unfocusedBorderColor = borderColor,
                            cursorColor = Color(0xFF1565C0),
                            focusedContainerColor = bgColor,
                            unfocusedContainerColor = bgColor,
                        ),
                        enabled = wordResults == null,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    )
                } else {
                    // 逐词模式：单词输入行 + 标点
                    @OptIn(ExperimentalLayoutApi::class)
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        cleanWords.forEachIndexed { i, correctWord ->
                            val result = wordResults?.getOrNull(i)
                            val borderColor = when {
                                result == null -> Color(0xFFBDBDBD)
                                result.isCorrect -> Color(0xFF4CAF50)
                                else -> Color(0xFFE53935)
                            }
                            val bgColor = when {
                                result == null -> Color.White
                                result.isCorrect -> Color(0xFFE8F5E9)
                                else -> Color(0xFFFFEBEE)
                            }

                            OutlinedTextField(
                                value = state.userInputs.getOrElse(i) { "" },
                                onValueChange = { onInputChange(i, it) },
                                modifier = Modifier.widthIn(min = 60.dp, max = 140.dp),
                                placeholder = { Text("___", fontSize = 14.sp, color = Color(0xFFBDBDBD)) },
                                singleLine = true,
                                textStyle = LocalTextStyle.current.copy(
                                    fontSize = 16.sp,
                                    textAlign = TextAlign.Center,
                                    fontWeight = FontWeight.Medium,
                                ),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = borderColor,
                                    unfocusedBorderColor = borderColor,
                                    cursorColor = Color(0xFF1565C0),
                                    focusedContainerColor = bgColor,
                                    unfocusedContainerColor = bgColor,
                                ),
                                enabled = wordResults == null,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                            )

                            // 框外标点
                            if (trailingPunct.getOrElse(i) { "" }.isNotEmpty()) {
                                Text(
                                    text = trailingPunct[i],
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFF333333),
                                    modifier = Modifier.padding(start = 2.dp),
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))

                // 提示：显示正确答案供参考
                if (state.hintAnswer != null) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1)),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                text = "💡 参考答案",
                                fontSize = 12.sp,
                                color = Color(0xFFFF8F00),
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = state.hintAnswer,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF333333),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                }

                // 操作按钮区
                if (wordResults == null) {
                    // 提交 + 提示按钮
                    if (state.canHint) {
                        Text(
                            text = "💡 已经错了 ${state.attempts} 次，需要提示吗？",
                            fontSize = 13.sp,
                            color = Color(0xFFFF8F00),
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        // 听发音按钮（常驻，左）
                        OutlinedButton(
                            onClick = onSpeakHint,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("🎤 听发音", fontSize = 14.sp)
                        }

                        // 提示按钮（3次错误后显示）
                        if (state.canHint) {
                            OutlinedButton(
                                onClick = onHint,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Text("💡 提示", fontSize = 14.sp)
                            }
                        }

                        Button(
                            onClick = onSubmit,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1565C0)),
                            shape = RoundedCornerShape(8.dp),
                            enabled = state.userInputs.any { it.isNotBlank() },
                        ) {
                            Text("✅ 提交", fontSize = 16.sp)
                        }
                    }
                } else {
                    // 结果显示
                    if (state.isCorrect) {
                        Text(
                            text = "🎉 全部正确！太棒了！",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF4CAF50),
                        )
                        Spacer(Modifier.height(12.dp))
                        Button(
                            onClick = onNext,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4CAF50)),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("下一题 →", fontSize = 16.sp)
                        }
                    } else if (state.isCloze) {
                        // 填空模式结果：单行
                        val result = wordResults?.firstOrNull()
                        if (result != null) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center,
                            ) {
                                Text("❌ ", fontSize = 14.sp)
                                Text(
                                    text = "\"${result.input}\"",
                                    fontSize = 14.sp,
                                    color = Color(0xFFE53935),
                                )
                                if (state.hintUsed) {
                                    Text(
                                        text = " → 正确: ${result.correct}",
                                        fontSize = 14.sp,
                                        color = Color(0xFF757575),
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Button(
                            onClick = onRetry,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF8F00)),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("🔄 重新填写", fontSize = 16.sp)
                        }
                    } else {
                        // 整句模式答错：显示每个词的对错 + 重新填写按钮
                        val wrongWords = wordResults?.filter { !it.isCorrect }
                        if (!wrongWords.isNullOrEmpty()) {
                            Column(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Text(
                                    text = "❌ 有 ${wrongWords.size} 个词填错了",
                                    fontSize = 14.sp,
                                    color = Color(0xFFE53935),
                                    fontWeight = FontWeight.Medium,
                                )
                                if (state.hintUsed) {
                                    wrongWords.forEach { r ->
                                        Text(
                                            text = "\"${r.input}\" → 正确: ${r.correct}",
                                            fontSize = 13.sp,
                                            color = Color(0xFF757575),
                                            modifier = Modifier.padding(top = 4.dp),
                                        )
                                    }
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Button(
                            onClick = onRetry,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF8F00)),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("🔄 重新填写", fontSize = 16.sp)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        // 难度标签
        Text(
            text = "难度: ${"⭐".repeat(item.difficulty.coerceIn(1, 3))}",
            fontSize = 12.sp,
            color = Color(0xFFBDBDBD),
        )
    }
}

@Composable
private fun FinishedContent(
    score: Int,
    total: Int,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "🎊",
                fontSize = 64.sp,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                text = "考试完成！",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "得分: $score / $total",
                fontSize = 20.sp,
                color = if (score >= total * 0.7) Color(0xFF4CAF50) else Color(0xFFFF8F00),
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            val encouragement = when {
                score == total -> "完美！全部答对了！🌟"
                score >= total * 0.7 -> "很不错！继续加油！💪"
                else -> "多练习几次会更好！📚"
            }
            Text(
                text = encouragement,
                fontSize = 14.sp,
                color = Color(0xFF757575),
            )
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = onRetry,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1565C0)),
                shape = RoundedCornerShape(8.dp),
            ) {
                Text("🔄 再来一次", fontSize = 16.sp)
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onBack) {
                Text("返回视频跟读", color = Color(0xFF757575))
            }
        }
    }
}
