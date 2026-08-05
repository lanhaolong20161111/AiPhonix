package com.example.ai.ui.dailypractice

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DailyPracticeScreen(
    viewModel: DailyPracticeViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("每日一练") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when {
                state.isLoading -> {
                    CircularProgressIndicator(modifier = Modifier.padding(48.dp))
                    Text("加载题库中...", modifier = Modifier.padding(top = 16.dp))
                }

                state.error != null -> {
                    val errMsg = state.error ?: ""
                    Spacer(Modifier.height(48.dp))
                    Text(
                        errMsg,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Spacer(Modifier.height(24.dp))
                    Button(onClick = onBack) { Text("返回") }
                }

                state.isFinished -> {
                    FinishedView(correct = state.correctCount, total = state.totalCount, onBack = onBack)
                }

                else -> {
                    QuestionView(
                        state = state,
                        onSelect = { viewModel.selectOption(it) },
                        onNext = { viewModel.nextQuestion() },
                    )
                }
            }
        }
    }
}

@Composable
private fun QuestionView(
    state: DailyPracticeUiState,
    onSelect: (Int) -> Unit,
    onNext: () -> Unit,
) {
    val q = state.currentQuestion ?: return

    // 进度条
    LinearProgressIndicator(
        progress = { (state.currentIndex.toFloat() + (if (state.selectedIndex >= 0) 1f else 0f)) / state.totalCount },
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp),
    )
    Text(
        "${state.currentIndex + 1} / ${state.totalCount}",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = 32.dp),
    )

    // 拼音提示
    Text(
        q.prompt,
        fontSize = 48.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(bottom = 8.dp),
    )

    Text(
        "选出对应的字/词",
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = 32.dp),
    )

    // 选项按钮
    q.options.forEachIndexed { index, option ->
        OptionButton(
            text = option,
            isSelected = state.selectedIndex == index,
            isCorrect = if (state.selectedIndex >= 0) index == q.correctIndex else null,
            enabled = state.selectedIndex < 0,
            onClick = { onSelect(index) },
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }

    // 结果反馈
    if (state.selectedIndex >= 0) {
        Spacer(Modifier.height(24.dp))
        val correct = state.isCorrect ?: false
        Text(
            if (correct) "✓ 正确！" else {
                "✗ 正确答案：${q.options[q.correctIndex]}"
            },
            color = if (correct) Color(0xFF4CAF50) else MaterialTheme.colorScheme.error,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(16.dp))
        Button(onClick = onNext) {
            Text(if (state.currentIndex + 1 >= state.totalCount) "查看结果" else "下一题")
        }
    }
}

@Composable
private fun OptionButton(
    text: String,
    isSelected: Boolean,
    isCorrect: Boolean?,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val borderColor by animateColorAsState(
        targetValue = when {
            isCorrect == true -> Color(0xFF4CAF50)
            isSelected && isCorrect == false -> MaterialTheme.colorScheme.error
            else -> MaterialTheme.colorScheme.outline
        },
        label = "borderColor",
    )

    val bgColor by animateColorAsState(
        targetValue = when {
            isCorrect == true -> Color(0xFFE8F5E9)
            isSelected && isCorrect == false -> Color(0xFFFFEBEE)
            else -> Color.Transparent
        },
        label = "bgColor",
    )

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .border(2.dp, borderColor, RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp))
            .background(bgColor)
            .clickable(enabled = enabled) { onClick() },
        shape = RoundedCornerShape(12.dp),
        color = bgColor,
    ) {
        Text(
            text,
            fontSize = 22.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp),
        )
    }
}

@Composable
private fun FinishedView(
    correct: Int,
    total: Int,
    onBack: () -> Unit,
) {
    Spacer(Modifier.height(64.dp))
    Text("🎉", fontSize = 64.sp)
    Spacer(Modifier.height(16.dp))
    Text(
        "练习完成！",
        fontSize = 28.sp,
        fontWeight = FontWeight.Bold,
    )
    Spacer(Modifier.height(32.dp))
    Text(
        "答对 $correct / $total",
        fontSize = 24.sp,
        color = MaterialTheme.colorScheme.primary,
        fontWeight = FontWeight.SemiBold,
    )
    Spacer(Modifier.height(8.dp))
    val percentage = if (total > 0) (correct * 100) / total else 0
    Text(
        "正确率 $percentage%",
        fontSize = 18.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(48.dp))
    Button(onClick = onBack, modifier = Modifier.fillMaxWidth(0.5f)) {
        Text("返回首页", fontSize = 18.sp)
    }
}
