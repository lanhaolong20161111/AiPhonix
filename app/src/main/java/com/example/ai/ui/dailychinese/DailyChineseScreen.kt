package com.example.ai.ui.dailychinese

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private val Black = Color(0xFF000000)
private val HintGray = Color(0xFF6B7280)
private val PrefillGold = Color(0xFFB8860B)

/**
 * 每日语文 —— 对齐 web `DailyChinesePage`：
 * 4 个固定练习入口（练字/练词/练句/主题作文）+ ⚙️ 设置今日字词句作文主题（跨设备同步）。
 *
 * ⚠️ 与 web 的差异（有意为之）：
 * - web 的设置面板支持**拍照/相册 OCR 自动填入**；Android 暂未移植区域 OCR 组件，
 *   目前只有手动输入（区域 OCR 随「字幕采集」一起做）。
 * - web 的 4 个入口指向 `/module/recognition`、`/module/word_practice`、`/module/sentence_practice`、
 *   `/module/oral_writing`；Android 对应 `Recognition`、`WordPractice`、`SentenceCompose`（本次新增）、`OralWriting`。
 */
@Composable
fun DailyChineseScreen(
    viewModel: DailyChineseViewModel,
    onBack: () -> Unit,
    onOpenRecognition: () -> Unit = {},
    onOpenWordPractice: () -> Unit = {},
    onOpenSentenceCompose: () -> Unit = {},
    onOpenOralWriting: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(modifier = modifier.fillMaxSize().padding(20.dp)) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("🏆 每日语文", style = MaterialTheme.typography.titleLarge, color = Black)
            Spacer(Modifier.weight(1f))
            Text(
                "⚙️",
                fontSize = 22.sp,
                color = Black,
                modifier = Modifier
                    .clickable { viewModel.openSettings() }
                    .padding(4.dp),
            )
        }
        Spacer(Modifier.height(4.dp))

        if (state.settingsOpen) {
            SettingsPanel(state = state, viewModel = viewModel)
            return@Column
        }

        // 今日摘要（与 web todaySummary 同文案）
        Text(state.todaySummary, fontSize = 13.sp, color = Black)
        if (state.prefillHint) {
            Spacer(Modifier.height(4.dp))
            Text(
                "已带入最近一次内容，修改后点「保存」即生效为今日配置（跨设备同步）",
                fontSize = 13.sp,
                color = PrefillGold,
            )
        }
        if (state.loading) {
            Spacer(Modifier.height(4.dp))
            Text("正在同步今日配置…", fontSize = 13.sp, color = HintGray)
        }
        Spacer(Modifier.height(12.dp))

        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.verticalScroll(rememberScrollState()),
        ) {
            EntryCard(
                emoji = "🔤",
                title = "练字",
                subtitle = "看图认汉字，跟读发音",
                badge = if (state.charsTotal > 0) "今日 ${state.charsTotal} 字" else "",
                onClick = onOpenRecognition,
            )
            EntryCard(
                emoji = "📚",
                title = "练词",
                subtitle = "词语跟读与辨析",
                badge = if (state.wordsTotal > 0) "今日 ${state.wordsTotal} 词" else "",
                onClick = onOpenWordPractice,
            )
            EntryCard(
                emoji = "✏️",
                title = "练句",
                subtitle = "给词造句，AI 老师批改",
                badge = if (state.sentencesTotal > 0) "今日 ${state.sentencesTotal} 条" else "",
                onClick = onOpenSentenceCompose,
            )
            EntryCard(
                emoji = "🖊️",
                title = "主题作文",
                subtitle = "按主题口述/写作，AI 评分润色",
                badge = state.cfg.essayTopic.trim().take(8),
                onClick = onOpenOralWriting,
            )
        }
    }
}

/** 一个练习入口卡（web `.english-mode-card` 的等价物） */
@Composable
private fun EntryCard(
    emoji: String,
    title: String,
    subtitle: String,
    badge: String,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(emoji, fontSize = 24.sp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (badge.isBlank()) title else "$title · $badge",
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = Black,
                )
                Text(subtitle, fontSize = 12.sp, color = HintGray)
            }
            Text("›", fontSize = 22.sp, color = Black)
        }
    }
}

/** ⚙️ 今日语文内容设置面板（web settings-sheet 的等价物：整屏替代，避免弹层层级问题） */
@Composable
private fun SettingsPanel(
    state: DailyChineseUiState,
    viewModel: DailyChineseViewModel,
) {
    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("⚙️ 今日语文内容", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Black)
            Spacer(Modifier.weight(1f))
            Text(
                "✕",
                fontSize = 18.sp,
                color = Black,
                modifier = Modifier
                    .clickable { viewModel.closeSettings() }
                    .padding(4.dp),
            )
        }
        Spacer(Modifier.height(8.dp))

        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
        ) {
            DraftField(
                label = "🔤 今天练的字",
                hint = "用逗号/空格分隔，如：日 月 水 火",
                value = state.draft.chars,
                onChange = { viewModel.onDraftChange(DailyZhField.CHARS, it) },
            )
            DraftField(
                label = "📚 今天练的词",
                hint = "如：春天，朋友，认真",
                value = state.draft.words,
                onChange = { viewModel.onDraftChange(DailyZhField.WORDS, it) },
            )
            DraftField(
                label = "✏️ 今天练的句子/句型",
                hint = "如：用「因为…所以…」造句；用「有的…有的…」写一段话",
                value = state.draft.sentences,
                onChange = { viewModel.onDraftChange(DailyZhField.SENTENCES, it) },
            )
            DraftField(
                label = "🖊️ 作文主题",
                hint = "如：我的好朋友 / 难忘的一天",
                value = state.draft.essayTopic,
                onChange = { viewModel.onDraftChange(DailyZhField.ESSAY_TOPIC, it) },
            )
            Text(
                "💡 拍照识别填入暂未移植，请手动输入；孩子只能练到词库里有的字词（摘要里的「词库命中」是提示）。",
                fontSize = 12.sp,
                color = HintGray,
            )
            Spacer(Modifier.height(4.dp))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = { viewModel.closeSettings() },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFECEFF1), contentColor = Black),
                modifier = Modifier.weight(1f),
            ) { Text("取消", fontSize = 15.sp) }
            Button(
                onClick = { viewModel.save() },
                enabled = !state.saving,
                modifier = Modifier.weight(1f),
            ) { Text(if (state.saving) "保存中…" else "保存", fontSize = 15.sp) }
        }
    }
}

@Composable
private fun DraftField(
    label: String,
    hint: String,
    value: String,
    onChange: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Text(label, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Black)
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(hint, fontSize = 13.sp, color = HintGray) },
            minLines = 2,
            maxLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
