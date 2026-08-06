package com.example.ai.ui.mylearning

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 「我的学习」聚合页：导入内容统计 + 练习成绩 + 训练入口。
 */
@Composable
fun MyLearningScreen(
    viewModel: MyLearningViewModel,
    onBack: () -> Unit,
    onOpenQuizPractice: () -> Unit,
    onOpenSentencePractice: () -> Unit,
    onOpenArticleList: () -> Unit,
    onOpenAiPractice: () -> Unit,
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
            Text("📚 我的学习", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(12.dp))

        if (state.loading) {
            Spacer(Modifier.height(120.dp))
            CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
            return
        }

        Column(Modifier.verticalScroll(rememberScrollState())) {
            // 导入内容统计
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("📥 已导入内容", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    val counts = state.counts
                    if (counts.isEmpty()) {
                        Text("还没有导入内容，去「导入学习内容」添加吧", fontSize = 14.sp)
                    } else {
                        StatRow(
                            listOf(
                                counts["char"] to "生字",
                                counts["word"] to "词语",
                                counts["pinyin"] to "拼音句",
                                counts["sentence"] to "句子",
                                counts["article"] to "文章",
                                counts["quiz"] to "题目",
                                counts["answer"] to "答案",
                            ),
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // 练习成绩统计
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("📈 练习成绩", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    if (state.statsError) {
                        Text(
                            "⚠️ 统计加载失败（断网），显示的是本地数据",
                            fontSize = 12.sp,
                            color = Color(0xFFE65100),
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.fillMaxWidth()) {
                        StatCell("练习次数", state.totalSessions.toString())
                        StatCell("累计题量", state.totalChars.toString())
                        StatCell(
                            "总正确率",
                            if (state.totalChars > 0) "${state.totalCorrect * 100 / state.totalChars}%" else "—",
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // 训练入口
            Text("🎯 开始训练", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            TrainingEntry(
                emoji = "📝",
                title = "本地题库",
                subtitle = "用导入的题目练习，${state.counts["quiz"] ?: 0} 题可用",
                onClick = onOpenQuizPractice,
            )
            Spacer(Modifier.height(8.dp))
            TrainingEntry(
                emoji = "🗣️",
                title = "句子跟读",
                subtitle = "录音评测发音，${(state.counts["sentence"] ?: 0) + (state.counts["pinyin"] ?: 0)} 句可用",
                onClick = onOpenSentencePractice,
            )
            Spacer(Modifier.height(8.dp))
            TrainingEntry(
                emoji = "📖",
                title = "文章跟读",
                subtitle = "朗读课文 · 段落口述 · 读后问答，${state.counts["article"] ?: 0} 篇可读",
                onClick = onOpenArticleList,
            )
            Spacer(Modifier.height(8.dp))
            TrainingEntry(
                emoji = "🤖",
                title = "AI 陪我练记录",
                subtitle = "导入主题多轮对话，查看回答与纠正对比",
                onClick = onOpenAiPractice,
            )
        }
    }
}

@Composable
private fun StatRow(items: List<Pair<Int?, String>>) {
    Column {
        items.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                row.forEach { (count, label) ->
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text((count ?: 0).toString(), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun RowScope.StatCell(label: String, value: String) {
    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(2.dp))
        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrainingEntry(
    emoji: String,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        onClick = onClick,
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(emoji, fontSize = 28.sp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Text(subtitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
