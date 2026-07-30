package com.example.ai.ui.chinesepractice

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 语文练习主页面 - 三个模块入口
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChinesePracticeScreen(
    onNavigateToRecognition: () -> Unit,
    onNavigateToDictation: () -> Unit,
    onNavigateToWordPractice: () -> Unit,
    onNavigateToOralWriting: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("语文练习") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "选择练习模式",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 16.dp)
            )

            // 认字
            PracticeButton(
                title = "认字",
                subtitle = "看字读音 · 填写拼音",
                emoji = "📖",
                colors = listOf(
                    MaterialTheme.colorScheme.primary,
                    MaterialTheme.colorScheme.primaryContainer
                ),
                onClick = onNavigateToRecognition
            )

            // 默写
            PracticeButton(
                title = "默写",
                subtitle = "听音写字 · 笔顺提示",
                emoji = "✍️",
                colors = listOf(
                    MaterialTheme.colorScheme.tertiary,
                    MaterialTheme.colorScheme.tertiaryContainer
                ),
                onClick = onNavigateToDictation
            )

            // 词语
            PracticeButton(
                title = "词语",
                subtitle = "听句填词 · 语境理解",
                emoji = "📝",
                colors = listOf(
                    MaterialTheme.colorScheme.secondary,
                    MaterialTheme.colorScheme.secondaryContainer
                ),
                onClick = onNavigateToWordPractice
            )

            // 口述作文
            PracticeButton(
                title = "口述作文",
                subtitle = "选主题 · 语音写作 · AI辅导",
                emoji = "🎙️",
                colors = listOf(
                    MaterialTheme.colorScheme.primary,
                    MaterialTheme.colorScheme.primaryContainer
                ),
                onClick = onNavigateToOralWriting
            )
        }
    }
}

@Composable
private fun PracticeButton(
    title: String,
    subtitle: String,
    emoji: String,
    colors: List<androidx.compose.ui.graphics.Color>,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(110.dp),
        colors = CardDefaults.cardColors(containerColor = colors[1]),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(text = emoji, fontSize = 36.sp)
            Column {
                Text(
                    text = title,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors[0]
                )
                Text(
                    text = subtitle,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
