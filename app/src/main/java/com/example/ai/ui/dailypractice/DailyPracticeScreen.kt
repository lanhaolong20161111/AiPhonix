package com.example.ai.ui.dailypractice

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class SubjectEntry(
    val title: String,
    val emoji: String,
    val subtitle: String,
    val containerColor: androidx.compose.ui.graphics.Color,
)

/** 每日一练 — 占位页：语文/数学/英语三个板块（功能开发中） */
@Composable
fun DailyPracticeScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val subjects = listOf(
        SubjectEntry("语文", "📖", "识字 · 默写 · 词语（开发中）", MaterialTheme.colorScheme.tertiaryContainer),
        SubjectEntry("数学", "🔢", "口算 · 图形（开发中）", MaterialTheme.colorScheme.primaryContainer),
        SubjectEntry("英语", "🔤", "单词 · 拼读 · 跟读（开发中）", MaterialTheme.colorScheme.secondaryContainer),
    )
    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← 返回") }
        }
        Text("📚 每日一练", fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("选择今天要练习的科目", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(24.dp))
        subjects.forEach { subject ->
            OutlinedCard(
                modifier = Modifier.fillMaxWidth().height(120.dp),
                colors = CardDefaults.outlinedCardColors(containerColor = subject.containerColor.copy(alpha = 0.3f)),
            ) {
                Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.CenterStart) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(subject.emoji, fontSize = 40.sp)
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(subject.title, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                            Text(subject.subtitle, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
