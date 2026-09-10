package com.example.ai.ui.oralwriting

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OralWritingScreen(
    viewModel: OralWritingViewModel,
    onBack: () -> Unit,
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("口述作文") },
                navigationIcon = {
                    IconButton(onClick = {
                        if (uiState.phase == OralWritingUiState.Phase.TopicSelection) onBack()
                        else viewModel.backToTopics()
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                ),
            )
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (uiState.phase) {
                OralWritingUiState.Phase.TopicSelection -> TopicSelectionScreen(uiState, viewModel)
                OralWritingUiState.Phase.Writing -> WritingScreen(uiState, viewModel)
                OralWritingUiState.Phase.Result -> ResultScreen(uiState, viewModel)
            }
        }
    }
}

// ===== 题目选择 =====

@Composable
private fun TopicSelectionScreen(state: OralWritingUiState, viewModel: OralWritingViewModel) {
    if (state.isLoadingTopics) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Spacer(modifier = Modifier.height(16.dp))
                Text("加载作文题目...")
            }
        }
        return
    }

    if (state.error != null) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(state.error, color = MaterialTheme.colorScheme.error)
                Spacer(modifier = Modifier.height(16.dp))
                Button(onClick = { viewModel.loadTopics() }) { Text("重试") }
            }
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(vertical = 16.dp),
    ) {
        item {
            Text(
                "选择一个题目开始写作",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        items(state.topics) { topic ->
            TopicCard(topic, onClick = { viewModel.selectTopic(topic) })
        }
    }
}

@Composable
private fun TopicCard(topic: EssayTopic, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(topic.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "${topic.gradeLevel}年级",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(topic.content, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// ===== 写作阶段 =====

@Composable
private fun WritingScreen(state: OralWritingUiState, viewModel: OralWritingViewModel) {
    val topic = state.selectedTopic ?: return
    val sections = state.sections
    if (sections.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Spacer(modifier = Modifier.height(16.dp))
                Text("正在生成写作框架...")
            }
        }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 题目标题
        Text(topic.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

        // 网络错误提示
        state.error?.let { err ->
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    err,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        // 段落进度指示器
        SectionProgressIndicator(sections, state.currentSectionIndex)

        // === 每个段落独立卡片 ===
        sections.forEachIndexed { index, section ->
            val isCurrent = index == state.currentSectionIndex
            val isDone = index < state.currentSectionIndex
            val sectionText = state.sectionTexts.getOrElse(index) { "" }

            Card(
                colors = CardDefaults.cardColors(
                    containerColor = when {
                        isCurrent -> MaterialTheme.colorScheme.primaryContainer
                        isDone -> Color(0xFFE8F5E9)
                        else -> MaterialTheme.colorScheme.surfaceVariant
                    }
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    // 段落标题
                    val prefix = listOf("①", "②", "③", "④", "⑤", "⑥").getOrElse(index) { "${index + 1}." }
                    Text(
                        "$prefix ${section.label}",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (section.guide.isNotBlank()) {
                        Text(
                            section.guide,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    // — 当前段落：文本输入（可点输入框用输入法语音） —
                    if (isCurrent) {
                        OutlinedTextField(
                            value = sectionText,
                            onValueChange = { viewModel.updateCurrentInput(it) },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
                            label = { Text("把你想说的写下来（可点输入框用语音输入）") },
                            placeholder = { Text("在这里写下你的内容…") },
                            maxLines = 5,
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        // 当前段操作行：保存 + 提示
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // 提交按钮
                            Button(
                                onClick = { viewModel.submitCurrentSection() },
                                enabled = sectionText.isNotBlank() && !state.isTransitioning,
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("保存这段")
                            }
                            // 提示按钮
                            OutlinedButton(
                                onClick = { viewModel.requestHint() },
                                modifier = Modifier.weight(1f),
                                enabled = !state.isTransitioning,
                            ) {
                                Spacer(Modifier.width(4.dp))
                                Text("💡 给我提示")
                            }
                        }

                        // 提示气泡
                        if (state.currentHint.isNotBlank()) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Card(
                                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0)),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Row(modifier = Modifier.padding(8.dp), verticalAlignment = Alignment.Top) {
                                    Text("💡 ", fontSize = 16.sp)
                                    Spacer(Modifier.width(4.dp))
                                    Text(state.currentHint, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }

                    // — 已完成段落：显示保存的文字 —
                    if (isDone) {
                        if (sectionText.isNotBlank()) {
                            Text(
                                sectionText,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        } else {
                            Text(
                                "（已跳过）",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            Text(
                                "✅ 已保存",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color(0xFF4CAF50),
                            )
                        }
                    }

                    // — 未写段落：提示 — (future sections)
                    if (!isCurrent && !isDone) {
                        Text(
                            "📝 待写",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        // 过渡提示
        if (state.isTransitioning) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                Text(
                    "⏳ 切换段落中...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // 段落导航（上一段 / 下一段）
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            if (state.currentSectionIndex > 0) {
                OutlinedButton(
                    onClick = { viewModel.previousSection() },
                    enabled = !state.isTransitioning,
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("上一段")
                }
            } else {
                Spacer(Modifier.width(1.dp))
            }
            if (state.currentSectionIndex < sections.size - 1) {
                Button(
                    onClick = { viewModel.advanceSection() },
                    enabled = !state.isTransitioning,
                ) {
                    Text("下一段")
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(18.dp))
                }
            } else {
                Button(
                    onClick = { viewModel.finishWriting() },
                    enabled = !state.isTransitioning,
                ) {
                    Icon(Icons.Filled.Send, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("完成写作")
                }
            }
        }
    }
}

// ===== 段落进度指示器 =====

@Composable
private fun SectionProgressIndicator(sections: List<EssaySection>, currentIndex: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        sections.forEachIndexed { index, section ->
            val isActive = index == currentIndex
            val isDone = index < currentIndex
            val color = when {
                isDone -> MaterialTheme.colorScheme.primary
                isActive -> MaterialTheme.colorScheme.tertiary
                else -> MaterialTheme.colorScheme.surfaceVariant
            }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(color),
            )
        }
    }
}

// ===== 段落卡片 =====

@Composable
private fun SectionCard(index: Int, section: EssaySection, sectionText: String, isDone: Boolean = false, isCurrent: Boolean = false) {
    val prefix = listOf("①", "②", "③", "④", "⑤", "⑥").getOrElse(index) { "${index + 1}." }
    val containerColor = when {
        isCurrent -> MaterialTheme.colorScheme.primaryContainer
        isDone -> Color(0xFFE8F5E9)
        else -> MaterialTheme.colorScheme.secondaryContainer
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = containerColor),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(prefix, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text(section.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text(
                    section.guide,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f),
                )
            }
            if (sectionText.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    sectionText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
        }
    }
}


// ===== 结果页面 =====

@Composable
private fun ResultScreen(state: OralWritingUiState, viewModel: OralWritingViewModel) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("🎉 写作完成！", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

        // 网络错误提示
        state.error?.let { err ->
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    err,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        // === 显示各段原文 ===
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("你的作文", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                state.sections.forEachIndexed { idx, section ->
                    val prefix = listOf("①", "②", "③", "④", "⑤", "⑥").getOrElse(idx) { "${idx + 1}." }
                    val text = state.sectionTexts.getOrElse(idx) { "" }
                    if (text.isNotBlank()) {
                        Text(
                            "$prefix ${section.label}",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (idx < state.sections.size - 1) Spacer(Modifier.height(8.dp))
                    }
                }
            }
        }

        // 润饰后的作文
        if (state.isFormatting) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("正在润色作文...")
                }
            }
        } else if (state.formattedText.isNotBlank()) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("润饰后的作文", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    Text(state.formattedText, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        // 反馈
        if (state.isScoring) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("正在生成反馈...")
                }
            }
        } else if (state.feedback.isNotBlank()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("老师的反馈", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    Text(state.feedback, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        // 操作按钮
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedButton(onClick = { viewModel.retry() }, modifier = Modifier.weight(1f)) {
                Text("再来一篇")
            }
            Button(onClick = { viewModel.backToTopics() }, modifier = Modifier.weight(1f)) {
                Text("换一个题目")
            }
        }
    }
}
