package com.example.ai.ui.memoryjoy

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.AppContainer
import com.example.ai.data.joy.JoyEntry
import com.example.ai.data.joy.highlightJoyText
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.data.tts.charAudioUrl
import com.example.ai.data.tts.ttsAuthHeaders
import com.example.ai.util.isSpeakableChar
import kotlinx.coroutines.launch

private val Black = Color(0xFF000000)
private val GoodText = Color(0xFF2E7D32)
private val BadText = Color(0xFFB71C1C)
private val HitBg = Color(0xFFFFF3D6)
private val HintGray = Color(0xFF94A3B8)
private val PlayingBlue = Color(0xFF90CAF9)

/**
 * 记忆快乐本（对齐 web MemoryJoyPage）：当日字词编成的小文段，按日期倒序分组。
 * 文段逐字可点读（走服务端单字音频库），当日字词 chip 可点读，支持整段朗读与删除。
 */
@Composable
fun MemoryJoyScreen(
    onBack: () -> Unit,
    onOpenDaily: () -> Unit,
    onOpenRecognition: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: MemoryJoyViewModel = viewModel { MemoryJoyViewModel() },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ttsCache = remember { BaiduTtsCache(context.applicationContext) }

    DisposableEffect(Unit) {
        onDispose { BaiduTtsCache.stopAll() }
    }

    /** 点读单个汉字：服务端音频库（人工录音 → TTS 沉淀），播完清除高亮 */
    val speakChar: (String) -> Unit = { ch ->
        if (isSpeakableChar(ch)) {
            viewModel.setSpeakingChar(ch)
            BaiduTtsCache.stopAll()   // 新读音打断旧读音（对齐 web audioManager 单实例语义）
            ttsCache.playRemote(
                charAudioUrl(ch),
                ttsAuthHeaders(),
                onError = { viewModel.setSpeakingChar("") },
            )
            // playRemote 无完成回调，用固定时长兜底清除高亮
            scope.launch {
                kotlinx.coroutines.delay(1800)
                if (viewModel.uiState.value.speakingChar == ch) viewModel.setSpeakingChar("")
            }
        }
    }

    /** 点读当日字词 chip：单字走单字库，多字词走整词合成 */
    val speakChip: (String) -> Unit = { w ->
        if (w.length == 1) {
            speakChar(w)
        } else {
            BaiduTtsCache.stopAll()
            scope.launch { ttsCache.play(w, "0") }
        }
    }

    /** 朗读整段 */
    val speakText: (JoyEntry) -> Unit = { e ->
        BaiduTtsCache.stopAll()
        scope.launch { ttsCache.play(e.text, "0") }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
    ) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("🌟 记忆快乐本", style = MaterialTheme.typography.titleLarge, color = Black)
            Spacer(Modifier.weight(1f))
            TextButton(
                onClick = { viewModel.refresh() },
                modifier = Modifier.semantics { contentDescription = "刷新" },
            ) {
                Text("🔄", fontSize = 16.sp)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "认字/练词时，今日字词会自动编成小故事收在这里，按日期排好（随账号保存）。",
            fontSize = 13.sp,
            color = Black,
        )

        if (state.error.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(state.error, fontSize = 13.sp, color = BadText)
        }

        Spacer(Modifier.height(10.dp))

        when {
            state.loading -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("加载中…", fontSize = 13.sp, color = Black)
                }
            }
            state.groups.isEmpty() -> {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("🌤", fontSize = 40.sp)
                        Spacer(Modifier.height(8.dp))
                        Text("还没有快乐文段", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Black)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "去「每日一练 · 语文」设置今日字词，认字页会自动生成小故事收进来",
                            fontSize = 13.sp,
                            color = HintGray,
                            textAlign = TextAlign.Center,
                        )
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = onOpenDaily) {
                                Text("⚙️ 去设置", fontSize = 14.sp, color = Black)
                            }
                            Button(
                                onClick = onOpenRecognition,
                                colors = ButtonDefaults.buttonColors(containerColor = GoodText),
                            ) {
                                Text("🔤 去认字", fontSize = 14.sp, color = Color.White)
                            }
                        }
                    }
                }
            }
            else -> {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.groups.forEach { g ->
                        item(key = "date-${g.date}") {
                            Text(
                                "📅 ${g.date}",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = HintGray,
                                modifier = Modifier.padding(start = 2.dp, top = 6.dp, bottom = 2.dp),
                            )
                        }
                        items(g.entries.size, key = { g.entries[it].id }) { idx ->
                            JoyEntryCard(
                                entry = g.entries[idx],
                                speakingChar = state.speakingChar,
                                onSpeakChar = speakChar,
                                onSpeakChip = speakChip,
                                onSpeakText = speakText,
                                onDelete = { viewModel.delete(g.entries[idx].id) },
                            )
                        }
                    }
                    item { Spacer(Modifier.height(24.dp)) }
                }
            }
        }
    }
}

@Composable
private fun JoyEntryCard(
    entry: JoyEntry,
    speakingChar: String,
    onSpeakChar: (String) -> Unit,
    onSpeakChip: (String) -> Unit,
    onSpeakText: (JoyEntry) -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    entry.title.ifBlank { entry.date },
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = Black,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = { onSpeakText(entry) },
                    modifier = Modifier.semantics { contentDescription = "朗读文段" },
                ) {
                    Text("🔊", fontSize = 15.sp)
                }
                TextButton(
                    onClick = onDelete,
                    modifier = Modifier.semantics { contentDescription = "删除这条" },
                ) {
                    Text("🗑", fontSize = 15.sp)
                }
            }

            Spacer(Modifier.height(4.dp))
            JoyEssay(
                text = entry.text,
                chars = entry.chars,
                words = entry.words,
                speakingChar = speakingChar,
                onSpeakChar = onSpeakChar,
            )

            val chips = remember(entry) {
                val sp = Regex("[,，、;；\\s]+")
                (entry.words.split(sp).map { it.trim() }.filter { it.isNotEmpty() } + entry.chars.toList().map { it.toString() })
                    .distinct()
            }
            if (chips.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                JoyChips(chips = chips, onSpeakChip = onSpeakChip)
            }
        }
    }
}

/**
 * 文段正文：按当日字词高亮切段，段内逐字可点读（标点等不可发音字符不可点）。
 * 用 FlowRow 逐字排布 —— 中文按字换行天然正确。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun JoyEssay(
    text: String,
    chars: String,
    words: String,
    speakingChar: String,
    onSpeakChar: (String) -> Unit,
) {
    val segments = remember(text, chars, words) { highlightJoyText(text, chars, words) }
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(1.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        segments.forEach { seg ->
            seg.text.forEach { ch ->
                if (ch == '\n') {
                    // 全宽零高 Spacer：逼 FlowRow 换行（等价于原文的换行）
                    Spacer(Modifier.fillMaxWidth())
                } else {
                    val chStr = ch.toString()
                    val speakable = isSpeakableChar(chStr)
                    Text(
                        chStr,
                        fontSize = 16.sp,
                        fontWeight = if (seg.hit) FontWeight.Bold else FontWeight.Normal,
                        color = if (seg.hit) GoodText else Color(0xFF1F2937),
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(
                                when {
                                    speakingChar == chStr -> PlayingBlue
                                    seg.hit -> HitBg
                                    else -> Color.Transparent
                                }
                            )
                            .then(
                                if (speakable) {
                                    Modifier
                                        .clickable { onSpeakChar(chStr) }
                                        .semantics { contentDescription = "朗读 $chStr" }
                                } else {
                                    Modifier
                                }
                            )
                            .padding(horizontal = 1.dp, vertical = 1.dp),
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun JoyChips(chips: List<String>, onSpeakChip: (String) -> Unit) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("当日字词：", fontSize = 12.sp, color = HintGray)
        chips.forEach { w ->
            Text(
                w,
                fontSize = 13.sp,
                color = Black,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFFE8F5E9))
                    .clickable { onSpeakChip(w) }
                    .semantics { contentDescription = if (w.length == 1) "朗读 $w" else "朗读词语 $w" }
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }
}
