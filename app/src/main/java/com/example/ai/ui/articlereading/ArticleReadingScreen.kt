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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.articlereading.ParagraphSummary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleReadingScreen(
    articleKey: String,
    articleTitle: String,
    viewModel: ArticleReadingViewModel,
    onBack: () -> Unit,
    onFinish: (articleKey: String, title: String) -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(articleKey, articleTitle) {
        viewModel.initArticle(articleKey, articleTitle)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        state.title.ifBlank { "文章跟读" },
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
            )
        },
    ) { inner ->
        Column(Modifier.fillMaxSize().padding(inner)) {
            // 顶部：整篇朗读
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "🔊 整篇朗读",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clickable(enabled = state.paragraphs.isNotEmpty() && !state.ttsSpeaking) { viewModel.playFull() }
                        .background(
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = if (state.ttsSpeaking) 0.38f else 1f),
                            RoundedCornerShape(8.dp),
                        )
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
                if (state.ttsSpeaking) {
                    Spacer(Modifier.width(10.dp))
                    Text("朗读中…", fontSize = 13.sp, color = MaterialTheme.colorScheme.primary)
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

            // 段落流
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                itemsIndexed(state.paragraphs) { index, paragraph ->
                    ParagraphCard(
                        index = index,
                        text = paragraph,
                        summary = state.summaries.firstOrNull { it.index == index },
                        speaking = state.ttsSpeaking,
                        onPlay = { viewModel.playParagraph(index) },
                        onSummaryChange = { text -> viewModel.setSummaryText(index, text) },
                    )
                }
                item { Spacer(Modifier.height(8.dp)) }
            }

            // 底部：完成阅读
            Button(
                onClick = { viewModel.finishReading { onFinish(state.articleKey, state.title) } },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .height(48.dp),
            ) {
                Text("✅ 完成阅读，去答题", fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun ParagraphCard(
    index: Int,
    text: String,
    summary: ParagraphSummary?,
    speaking: Boolean,
    onPlay: () -> Unit,
    onSummaryChange: (String) -> Unit,
) {
    var draft by remember(index) { mutableStateOf(summary?.text ?: "") }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(26.dp)
                        .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(13.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${index + 1}", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(8.dp))
                Text("第 ${index + 1} 段", fontSize = 13.sp, color = Color(0xFF000000))
            }
            Spacer(Modifier.height(8.dp))
            Text(text, fontSize = 16.sp, lineHeight = 26.sp, color = Color(0xFF000000))
            Spacer(Modifier.height(8.dp))

            // 段落操作：喇叭（朗读）
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onPlay, enabled = !speaking) {
                    Text("🔊", fontSize = 20.sp, modifier = Modifier.alpha(if (speaking) 0.38f else 1f))
                }
                Text("读完后在下面写下这段讲了什么", fontSize = 13.sp, color = Color(0xFF000000))
            }

            Spacer(Modifier.height(8.dp))
            // 概括文字输入（可点输入框用输入法语音）
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it; onSummaryChange(it) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                maxLines = 5,
                placeholder = { Text("写下这段的主要内容（可点输入框用语音输入）…") },
            )
        }
    }
}
