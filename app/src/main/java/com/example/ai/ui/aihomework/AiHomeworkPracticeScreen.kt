package com.example.ai.ui.aihomework

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.ui.common.SpeakableText
import kotlinx.coroutines.delay

/** 数学应用题练习页：分句朗读 → 提示关键信息 → ASR 说思路 → 提交评判 */
@Composable
fun AiHomeworkPracticeScreen(
    viewModel: AiHomeworkPracticeViewModel,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    // 选中的问题（面向问题倒推：点击问题 → 加载该问的分步解题链）
    var selectedQuestion by remember { mutableStateOf(-1) }
    var guideActive by remember { mutableStateOf(false) }

    // 进入倒推引导时按需加载分步解题链（幂等；失败回退 hint 模式）
    LaunchedEffect(guideActive, selectedQuestion) {
        if (guideActive && selectedQuestion in state.questions.indices) {
            viewModel.loadStepsForQuestion(selectedQuestion)
        }
    }

    LaunchedEffect(Unit) {
        viewModel.initTts(context)
    }

    // 页面离开组合（返回键）时立即停止朗读与录音（比 onCleared 更早触发）
    DisposableEffect(Unit) {
        onDispose { viewModel.cancelSpeaking() }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "←",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clickable(onClick = onBack),
            )
            Text("🧮 题目练习", style = MaterialTheme.typography.titleLarge)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "读一读题目，卡住了点提示，想好了用语音说出你的思路",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF212121),
        )

        Spacer(Modifier.height(14.dp))

        // 加载中
        if (state.loading) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("正在解析题目（大模型深度思考中，可能要 10-20 秒）...", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(10.dp))
        }

        // 一句话一个方框（按 。？！ 切分），每句一个喇叭；含关键条件的句内高亮
        state.sentences.forEach { s ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 3.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (s.isKey) Color(0xFFFFF3D6) else MaterialTheme.colorScheme.surface,
                ),
                border = if (s.isKey) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val isThisRecording = state.isMicRecording && state.micRecordingSentence == s.text
                    val micBusy = state.isSpeaking || state.isMicRecording
                    Text(
                        "🔊",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (micBusy) Color(0xFFBDBDBD) else Color.Unspecified,
                        modifier = Modifier
                            .padding(end = 6.dp)
                            .clickable(enabled = !micBusy) { viewModel.speak(s.text) },
                    )
                    Text(
                        if (isThisRecording) "⏹" else "🎤",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (isThisRecording) Color(0xFFC62828) else if (micBusy) Color(0xFFBDBDBD) else Color.Unspecified,
                        modifier = Modifier
                            .padding(end = 6.dp)
                            .clickable(enabled = !state.isSpeaking && (!state.isMicRecording || isThisRecording)) {
                                viewModel.toggleRecord(s.text)
                            },
                    )
                    if (s.text in state.recordedSentences) {
                        Text(
                            "▶",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (micBusy) Color(0xFFBDBDBD) else Color.Unspecified,
                            modifier = Modifier
                                .padding(end = 6.dp)
                                .clickable(enabled = !micBusy) { viewModel.playSentenceAudio(s.text) },
                        )
                    }
                    // 句内高亮关键条件（highlight 片段深红加粗）
                    val annotated = buildAnnotatedString {
                        val hl = s.highlight.trim()
                        if (s.isKey && hl.isNotEmpty() && s.text.contains(hl)) {
                            val idx = s.text.indexOf(hl)
                            append(s.text.substring(0, idx))
                            withStyle(SpanStyle(color = Color(0xFFB71C1C), fontWeight = FontWeight.Bold)) { append(hl) }
                            append(s.text.substring(idx + hl.length))
                        } else {
                            append(s.text)
                        }
                    }
                    Text(
                        annotated,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (s.isKey) FontWeight.Bold else FontWeight.Normal,
                        color = if (s.isKey) Color(0xFF000000) else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
        Spacer(Modifier.height(10.dp))

        // 问题列表（面向问题倒推：先看题目问什么，点选后圆圈图高亮该问的依赖子图）
        if (state.questions.isNotEmpty()) {
            QuestionListCard(
                questions = state.questions,
                selectedIndex = selectedQuestion,
                onSelect = { selectedQuestion = it; guideActive = false },
            )
            // 选中某问 → 倒推引导入口（完整教学：需要什么 → 从哪来 → 怎么算 → 填答案）
            if (selectedQuestion in state.questions.indices) {
                Spacer(Modifier.height(6.dp))
                if (guideActive) {
                    ReverseGuideCard(
                        question = state.questions[selectedQuestion],
                        index = selectedQuestion,
                        allQuestions = state.questions,
                        quantities = state.quantities,
                        relations = state.relations,
                        sentences = state.sentences,
                        steps = state.solutionSteps,
                        loadingSteps = state.loadingSteps,
                        onExit = { guideActive = false },
                    )
                } else {
                    Button(
                        onClick = { guideActive = true },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("🎯 倒推挑战：像老师一样想清楚这一问")
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            // 圆圈关系图已隐藏（问题多）：解题思路在"倒推挑战"里逐步画线段图
        }

        // 搭积木学习：学生自己搭数量关系图 → 提交大模型审核
        Spacer(Modifier.height(4.dp))
        BlockBuilder(
            question = viewModel.questionText,
            onSubmitReview = { q, blocks -> viewModel.submitBuildReview(q, blocks) },
            onAutoBuild = { q -> viewModel.autoBuild(q) },
        )
        Spacer(Modifier.height(12.dp))

        // 提示按钮 + 关键信息
        OutlinedButton(
            onClick = viewModel::toggleHints,
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.isSpeaking,
        ) {
            Text(if (state.showHints) "🙈 收起提示" else "💡 没有思路？点我看关键信息（不剧透解法）")
        }
        if (state.showHints) {
            Spacer(Modifier.height(8.dp))
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3D6)),
            ) {
                Column(Modifier.padding(12.dp)) {
                    // 黄色提示卡片是硬编码浅色底，深色模式下文字需显式深色
                    Text("🔑 关键条件", style = MaterialTheme.typography.titleSmall, color = Color(0xFF1A1A1A))
                    Spacer(Modifier.height(6.dp))
                    val keys = state.sentences.filter { it.isKey }
                    if (keys.isEmpty()) {
                        Text(
                            "这道题暂时没有标出关键条件，试着读一读哪些句子里有数字～",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF1A1A1A),
                        )
                    } else {
                        keys.forEach { k ->
                            Text(
                                "· ${k.highlight.ifBlank { k.text }}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = Color(0xFF6D3B00),
                            )
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "提示只给条件，不替你算——答案要自己算出来哦！",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF37474F),
                    )
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        Text("🗣️ 说说你的思路（点击下方输入框，可用输入法语音输入）", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(6.dp))

        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = state.answer,
            onValueChange = viewModel::updateAnswer,
            modifier = Modifier.fillMaxWidth(),
            minLines = 3,
            placeholder = { Text("识别结果会自动填进来，也可以手动修改或直接输入…") },
        )

        Spacer(Modifier.height(10.dp))

        Button(
            onClick = viewModel::submitAnswer,
            enabled = !state.evaluating && state.answer.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.evaluating) "老师正在批改…" else "🚀 提交思路")
        }

        // 评判结果
        state.result?.let { r ->
            Spacer(Modifier.height(14.dp))
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = when (r.verdict) {
                        "correct" -> Color(0xFFE4F5E4)
                        "wrong" -> Color(0xFFFFEBEE)
                        else -> Color(0xFFFFF8E1)
                    },
                ),
            ) {
                Column(Modifier.padding(14.dp)) {
                    // 结果卡片是硬编码浅色底（绿/红/黄），深色模式下文字需显式深色
                    Text(
                        when (r.verdict) {
                            "correct" -> "✅ 思路正确！"
                            "wrong" -> "❌ 再想想"
                            else -> "🟡 方向对了一半"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = Color(0xFF1A1A1A),
                    )
                    if (r.feedback.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        SpeakableText(
                            text = r.feedback,
                            onSpeak = viewModel::speak,
                            speakingChar = state.speakingChar,
                        )
                    }
                    if (r.suggestion.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        SpeakableText(
                            text = "💡 ${r.suggestion}",
                            onSpeak = viewModel::speak,
                            speakingChar = state.speakingChar,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(onClick = viewModel::reset, modifier = Modifier.fillMaxWidth()) {
                        Text("🔄 再试一次")
                    }
                }
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}
