package com.example.ai.ui.sentencecompose

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.tts.BaiduTtsCache
import kotlinx.coroutines.launch

private val Black = Color(0xFF000000)
private val HintGray = Color(0xFF6B7280)
private val CorrectGreen = Color(0xFF2E7D32)
private val WrongRed = Color(0xFFB71C1C)
private val ChipBorder = Color(0xFF93C5FD)
private val ChipBg = Color(0xFFEFF6FF)

/**
 * 造句练习 —— 对齐 web `SentencePracticePage`：
 * 给一个词/句型，孩子写一句话，AI 老师判断对错并给更正；点评里被判错的字标红。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SentenceComposeScreen(
    viewModel: SentenceComposeViewModel,
    onBack: () -> Unit,
    onOpenDailyChinese: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val ttsCache = remember { BaiduTtsCache(context.applicationContext) }
    var speaking by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        onDispose { BaiduTtsCache.stopAll() }
    }

    val speak: (String) -> Unit = { text ->
        if (text.isNotBlank() && !speaking) {
            speaking = true
            BaiduTtsCache.stopAll()
            scope.launch {
                try {
                    // 中文朗读一律走百度（TtsEngine 只适合英语）
                    ttsCache.play(text, "0")
                } finally {
                    speaking = false
                }
            }
        }
    }

    Column(modifier = modifier.fillMaxSize().padding(20.dp)) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("✏️ 造句练习", style = MaterialTheme.typography.titleLarge, color = Black)
            Spacer(Modifier.weight(1f))
            Text(
                "🔀 换词",
                fontSize = 14.sp,
                color = Black,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable { viewModel.next() }.padding(4.dp),
            )
        }
        Spacer(Modifier.height(10.dp))

        if (state.pickOpen && state.todaySentences.isNotEmpty()) {
            // ── 选句页 ──
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("点选要练的句型/句子👇", fontSize = 13.sp, color = Black)
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "家长增改句型请到「每日一练 · 语文」⚙️ 设置",
                        fontSize = 12.sp,
                        color = HintGray,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "去设置",
                        fontSize = 12.sp,
                        color = Black,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFFECEFF1))
                            .clickable(onClick = onOpenDailyChinese)
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    state.todaySentences.forEachIndexed { i, t ->
                        Text(
                            t,
                            fontSize = 14.sp,
                            color = Color(0xFF1E3A8A),
                            lineHeight = 18.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(14.dp))
                                .background(ChipBg)
                                .clickable { viewModel.pick(t) }
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                        )
                        if (i < 0) Unit // 占位保持 FlowRow 结构可读（无实际作用）
                    }
                }
            }
            return@Column
        }

        // ── 练习页 ──
        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.verticalScroll(rememberScrollState()),
        ) {
            Text("用下面的词造一个句子，AI 老师来判断对不对，还会帮你改。", fontSize = 13.sp, color = Black)

            if (state.todaySentences.isNotEmpty()) {
                Text("今日练句（点选直接练）：", fontSize = 11.sp, color = HintGray)
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    state.todaySentences.forEach { t ->
                        val active = t == state.word
                        Text(
                            t,
                            fontSize = 12.sp,
                            color = if (active) Color(0xFF1D4ED8) else Color(0xFF334155),
                            fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (active) Color(0xFFDBEAFE) else Color(0xFFFFFFFF))
                                .clickable { viewModel.pick(t) }
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            ) {
                Column(Modifier.padding(14.dp)) {
                    Text(
                        state.word.ifBlank { "…" },
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (speaking) Color(0xFF90CAF9) else Black,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !speaking && state.word.isNotBlank()) { speak(state.word) }
                            .padding(vertical = 6.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = state.sentence,
                        onValueChange = { viewModel.onSentenceChange(it) },
                        enabled = !state.busy,
                        placeholder = {
                            Text(
                                "用「${state.word}」写一句话…（输入法语音转文字也可以）",
                                fontSize = 13.sp,
                                color = HintGray,
                            )
                        },
                        minLines = 3,
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(
                        onClick = { viewModel.submit() },
                        enabled = !state.busy && state.sentence.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (state.busy) "老师看句子中…" else "提交给 AI 老师", fontSize = 15.sp)
                    }
                }
            }

            state.result?.let { r ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        if (r.corrected.isNotBlank()) {
                            Text(
                                "✏️ ${r.corrected}",
                                fontSize = 14.sp,
                                color = CorrectGreen,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFFF0FDF4))
                                    .padding(8.dp),
                            )
                            Spacer(Modifier.height(8.dp))
                        }
                        // 点评逐字渲染：命中 wrongs 的字标红（与 web 同判定）
                        Text(
                            buildReplyAnnotated(r.reply, state.wrongChars),
                            style = TextStyle(fontSize = 14.sp),
                        )
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (r.corrected.isNotBlank()) {
                                SpeakButton("🔊 读更正句", enabled = !speaking) { speak(r.corrected) }
                            }
                            SpeakButton("🔊 读点评", enabled = !speaking) { speak(r.reply) }
                        }
                    }
                }
            }
        }
    }
}

/** 把点评文本按「命中错片段」逐字上色 */
private fun buildReplyAnnotated(reply: String, wrongChars: Set<Char>): androidx.compose.ui.text.AnnotatedString =
    androidx.compose.ui.text.buildAnnotatedString {
        reply.forEach { ch ->
            if (ch in wrongChars) {
                withStyle(androidx.compose.ui.text.SpanStyle(color = WrongRed, fontWeight = FontWeight.Bold)) {
                    append(ch)
                }
            } else {
                append(ch)
            }
        }
    }

@Composable
private fun SpeakButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 13.sp,
        color = if (enabled) Black else HintGray,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFECEFF1))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}
