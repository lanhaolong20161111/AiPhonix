package com.example.ai.ui.quizpractice

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 本地题库练习页：逐题选择作答 → 反馈对错与解析 → 完成页提交成绩。
 */
@Composable
fun QuizPracticeScreen(
    viewModel: QuizPracticeViewModel,
    onBack: () -> Unit,
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
            Text("📝 本地题库", fontSize = 22.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))

        when {
            state.loading -> {
                Spacer(Modifier.height(120.dp))
                CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
            }
            state.empty -> {
                Spacer(Modifier.height(120.dp))
                Text(
                    "还没有题目。\n去「导入学习内容 → 文本 → 题目」导入题目后，这里就能练习了。",
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                    fontSize = 15.sp,
                )
            }
            state.finished -> {
                FinishedSection(
                    total = state.questions.size,
                    correct = state.correctCount,
                    submitting = state.submitting,
                    submitted = state.submitted,
                    message = state.message,
                    onSubmit = viewModel::submit,
                )
            }
            else -> {
                val q = state.questions.getOrNull(state.currentIndex) ?: return
                QuizQuestionCard(
                    index = state.currentIndex,
                    total = state.questions.size,
                    question = q,
                    selected = state.selectedOption,
                    answered = state.answered,
                    isCorrect = state.isCorrect,
                    onSelect = viewModel::selectOption,
                    onNext = viewModel::next,
                )
            }
        }
    }
}

@Composable
private fun QuizQuestionCard(
    index: Int,
    total: Int,
    question: QuizQuestion,
    selected: String?,
    answered: Boolean,
    isCorrect: Boolean,
    onSelect: (String) -> Unit,
    onNext: () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        LinearProgressIndicator(
            progress = { (index + 1).toFloat() / total },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        Text("第 ${index + 1} / $total 题", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        Text(question.stem, fontSize = 18.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)
        Spacer(Modifier.height(16.dp))

        question.options.forEach { option ->
            val optionColor = when {
                !answered -> MaterialTheme.colorScheme.surfaceVariant
                option.trim() == question.answer.trim() -> Color(0xFF2E7D32) // 正确答案绿
                option == selected -> Color(0xFFC62828) // 选错红
                else -> MaterialTheme.colorScheme.surfaceVariant
            }
            Card(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                colors = CardDefaults.cardColors(containerColor = optionColor),
            ) {
                Text(
                    option,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    fontSize = 16.sp,
                    color = if (answered) Color.White else MaterialTheme.colorScheme.onSurface,
                )
            }
        }

        if (answered) {
            Spacer(Modifier.height(12.dp))
            Text(
                if (isCorrect) "✅ 回答正确" else "❌ 正确答案：${question.answer}",
                fontSize = 16.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                color = if (isCorrect) Color(0xFF2E7D32) else Color(0xFFC62828),
            )
            if (question.explanation.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text("💡 ${question.explanation}", fontSize = 14.sp)
            }
            Spacer(Modifier.height(16.dp))
            Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
                Text(if (index + 1 >= total) "查看结果" else "下一题")
            }
        }
    }
}

@Composable
private fun FinishedSection(
    total: Int,
    correct: Int,
    submitting: Boolean,
    submitted: Boolean,
    message: String,
    onSubmit: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🎉 练习完成", fontSize = 24.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Text("答对 $correct / $total", fontSize = 20.sp)
        Spacer(Modifier.height(8.dp))
        Text(
            "正确率 ${if (total > 0) (correct * 100 / total) else 0}%",
            fontSize = 16.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        Button(onClick = onSubmit, enabled = !submitted && !submitting, modifier = Modifier.fillMaxWidth()) {
            Text(
                when {
                    submitted -> "✅ 已保存记录"
                    submitting -> "保存中…"
                    else -> "保存练习记录"
                },
            )
        }
        if (message.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(message, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
