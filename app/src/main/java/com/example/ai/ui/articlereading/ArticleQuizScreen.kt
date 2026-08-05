package com.example.ai.ui.articlereading

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.articlereading.ArticleQuestion

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleQuizScreen(
    articleKey: String,
    articleTitle: String,
    viewModel: ArticleQuizViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        viewModel.initAsrEngine(context.assets)
    }

    LaunchedEffect(articleKey, articleTitle) {
        viewModel.initQuiz(articleKey, articleTitle)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("❓ 读后问答", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
            )
        },
    ) { inner ->
        when {
            state.loading -> {
                Column(
                    Modifier.fillMaxSize().padding(inner),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(16.dp))
                    Text("正在为文章准备问题…", color = Color.Gray)
                }
            }
            state.questions.isEmpty() -> {
                Column(
                    Modifier.fillMaxSize().padding(inner).padding(32.dp),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(state.error.ifBlank { "没有可回答的问题。" }, fontSize = 16.sp)
                    Spacer(Modifier.height(16.dp))
                    OutlinedButton(onClick = onBack) { Text("返回文章") }
                }
            }
            else -> {
                Column(Modifier.fillMaxSize().padding(inner)) {
                    LazyColumn(
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        item {
                            val hint = if (state.matchedCount > 0) {
                                "已从你的题库匹配 ${state.matchedCount} 题，其余由 AI 生成。点 🎤 口述回答。"
                            } else {
                                "这些问题由 AI 根据文章生成。点 🎤 口述回答，点「参考答案」对照。"
                            }
                            Text(hint, fontSize = 13.sp, color = Color.Gray)
                        }
                        itemsIndexed(state.questions) { index, q ->
                            QuestionCard(
                                index = index,
                                question = q,
                                answer = state.answers.firstOrNull { it.questionIndex == index },
                                isRecording = state.recordingIndex == index,
                                partialText = if (state.recordingIndex == index) state.partialText else "",
                                expanded = state.expandedAnswer == index,
                                onRecord = { viewModel.toggleRecord(index) },
                                onToggleAnswer = { viewModel.toggleAnswer(index) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuestionCard(
    index: Int,
    question: ArticleQuestion,
    answer: com.example.ai.data.articlereading.ArticleAnswer?,
    isRecording: Boolean,
    partialText: String,
    expanded: Boolean,
    onRecord: () -> Unit,
    onToggleAnswer: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(26.dp)
                        .background(MaterialTheme.colorScheme.tertiary, RoundedCornerShape(13.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${index + 1}", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    if (question.source == "matched") "题库" else "AI 提问",
                    fontSize = 12.sp,
                    color = if (question.source == "matched") Color(0xFF2E7D32) else Color(0xFF6A1B9A),
                )
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onRecord) {
                    Text(if (isRecording) "⏹" else "🎤", fontSize = 20.sp)
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(question.text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium)

            // 选项（题库匹配题）
            question.options.forEachIndexed { i, opt ->
                Text(
                    "${('A' + i)}. $opt",
                    fontSize = 14.sp,
                    color = Color.Gray,
                    modifier = Modifier.padding(top = 4.dp, start = 4.dp),
                )
            }

            // 录音状态 / 口述回答
            when {
                isRecording -> {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(10.dp).background(Color.Red, RoundedCornerShape(5.dp)),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text("正在听你说…", fontSize = 13.sp, color = Color.Red)
                    }
                    if (partialText.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(partialText, fontSize = 14.sp, color = MaterialTheme.colorScheme.primary)
                    }
                }
                answer != null && answer.spokenText.isNotBlank() -> {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "我的回答：${answer.spokenText}",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                MaterialTheme.colorScheme.primaryContainer,
                                RoundedCornerShape(6.dp),
                            )
                            .padding(10.dp),
                    )
                }
            }

            // 参考答案（展开/收起）
            if (question.answer.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    if (expanded) "▲ 收起参考答案" else "▼ 参考答案",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .clickable { onToggleAnswer() }
                        .padding(vertical = 4.dp),
                )
                if (expanded) {
                    Text(
                        question.answer,
                        fontSize = 14.sp,
                        color = Color.DarkGray,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFFE8EAF6), RoundedCornerShape(6.dp))
                            .padding(10.dp),
                    )
                }
            }
        }
    }
}
