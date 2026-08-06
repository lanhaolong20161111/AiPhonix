package com.example.ai.ui.aipractice

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 内容类型选项：字 / 词 / 句 / 文章 */
private val CONTENT_TYPES = listOf(
    "char" to "字",
    "word" to "词",
    "sentence" to "句",
    "article" to "文章",
)

private fun contentTypeName(t: String) = CONTENT_TYPES.firstOrNull { it.first == t }?.second ?: t

/**
 * ai陪我练 主页：导入主题（粘贴/输入）→ 选内容粒度 → 开始多轮练习；下方历史记录。
 */
@Composable
fun AiPracticeScreen(
    viewModel: AiPracticeViewModel,
    onBack: () -> Unit,
    onOpenChat: (sessionId: Int, content: String) -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.loadHistory() }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onBack) { Text("← 返回") }
            Spacer(Modifier.width(12.dp))
            Text("🤖 AI 陪我练", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }

        Column(Modifier.verticalScroll(rememberScrollState())) {
            Spacer(Modifier.height(8.dp))
            Text(
                "导入一段学习主题，AI 会一步步引导你练习（认读 → 理解 → 运用），回答正确有表扬，错误会纠正。",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))

            // 内容粒度
            Text("内容类型", fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CONTENT_TYPES.forEach { (id, label) ->
                    FilterChip(
                        selected = state.contentType == id,
                        onClick = { viewModel.updateContentType(id) },
                        label = { Text(label) },
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // 学习内容
            Text("学习内容（可粘贴 / 输入 / 拍照识字后粘贴）", fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = state.content,
                onValueChange = viewModel::updateContent,
                modifier = Modifier.fillMaxWidth().height(120.dp),
                placeholder = { Text("例如：The cat is on the mat.") },
                textStyle = MaterialTheme.typography.bodyLarge,
            )

            Spacer(Modifier.height(12.dp))

            // 任务类型（可选）
            OutlinedTextField(
                value = state.task,
                onValueChange = viewModel::updateTask,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("任务类型（可选：认读 / 造句 / 问答 / 翻译 / 考题）") },
                singleLine = true,
            )

            Spacer(Modifier.height(16.dp))

            if (state.error.isNotBlank()) {
                Text(state.error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                Spacer(Modifier.height(8.dp))
            }

            Button(
                onClick = { viewModel.createSession { id -> onOpenChat(id, state.content.trim()) } },
                modifier = Modifier.fillMaxWidth().height(52.dp),
                enabled = !state.creating,
            ) {
                if (state.creating) {
                    CircularProgressIndicator(Modifier.width(22.dp).height(22.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("AI 正在制定学习计划…")
                } else {
                    Text("🚀 开始练习", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                }
            }

            Spacer(Modifier.height(24.dp))

            // 历史记录
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("📜 练习记录", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                if (state.loadingHistory) {
                    CircularProgressIndicator(Modifier.width(16.dp).height(16.dp), strokeWidth = 2.dp)
                }
            }
            Spacer(Modifier.height(8.dp))

            if (state.sessions.isEmpty() && !state.loadingHistory) {
                Text(
                    "还没有练习记录，创建第一个练习吧",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            state.sessions.forEach { s ->
                Card(
                    onClick = { onOpenChat(s.sessionId, s.content) },
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (s.status == "done") {
                            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                        } else {
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)
                        }
                    ),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            s.content.take(30) + if (s.content.length > 30) "…" else "",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "【${contentTypeName(s.contentType)}】${s.task.ifBlank { "综合练习" }} · ${s.turnCount} 条对话 · " +
                                if (s.status == "done") "✅ 已完成" else "⏳ 进行中" +
                                " · ${s.createdAt.take(16).replace("T", " ")}",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
