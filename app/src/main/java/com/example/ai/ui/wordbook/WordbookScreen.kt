package com.example.ai.ui.wordbook

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.AppContainer
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.data.wordbook.WordbookItem
import kotlinx.coroutines.launch

private val Black = Color(0xFF000000)
private val GoodText = Color(0xFF2E7D32)
private val BadText = Color(0xFFB71C1C)
private val HintGray = Color(0xFF6B7280)

/**
 * 生词本（对齐 web WordbookPage）：SRS 间隔重复复习 + 词表管理。
 * 复习 Tab 一次一张卡（点读发音、认识/不认识打卡）；词表 Tab 展示全部并支持朗读/删除。
 */
@Composable
fun WordbookScreen(
    onBack: () -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: WordbookViewModel = viewModel { WordbookViewModel() },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ttsCache = remember { BaiduTtsCache(context.applicationContext) }

    DisposableEffect(Unit) {
        onDispose { BaiduTtsCache.stopAll() }
    }

    /** 朗读：英文单词走系统 TTS（英式/美式跟随全局），其余走中文百度 TTS */
    val speak: (WordbookItem) -> Unit = { item ->
        val text = item.text
        if (text.isNotBlank()) {
            scope.launch {
                if (item.isEnglish) container.ttsEngine.speak(text) else ttsCache.play(text, "0")
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
            Text("📓 生词本", style = MaterialTheme.typography.titleLarge, color = Black)
            Spacer(Modifier.weight(1f))
            Text("${state.items.size}", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Black)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "点读生字/生词就能自动收进来。到期的词每天复习一遍，认对的间隔会越来越长。",
            fontSize = 13.sp,
            color = Black,
        )
        Spacer(Modifier.height(10.dp))

        // 双 Tab
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WordbookTabButton(
                text = if (state.queue.isNotEmpty()) "🔁 复习 (${state.queue.size})" else "🔁 复习",
                active = state.tab == WordbookTab.REVIEW,
                modifier = Modifier.weight(1f),
                onClick = { viewModel.selectTab(WordbookTab.REVIEW) },
            )
            WordbookTabButton(
                text = "📋 词表 (${state.items.size})",
                active = state.tab == WordbookTab.LIST,
                modifier = Modifier.weight(1f),
                onClick = { viewModel.selectTab(WordbookTab.LIST) },
            )
        }

        if (state.error.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(state.error, fontSize = 13.sp, color = BadText)
        }

        Spacer(Modifier.height(12.dp))

        when (state.tab) {
            WordbookTab.REVIEW -> ReviewPane(
                state = state,
                onSpeak = speak,
                onRate = { item, ok -> viewModel.rate(item, ok) },
            )
            WordbookTab.LIST -> ListPane(
                state = state,
                onSpeak = speak,
                onDelete = { viewModel.delete(it) },
            )
        }
    }
}

@Composable
private fun WordbookTabButton(
    text: String,
    active: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors = if (active) {
            ButtonDefaults.buttonColors(containerColor = Color(0xFF1565C0))
        } else {
            ButtonDefaults.buttonColors(containerColor = Color(0xFFE5E7EB))
        },
    ) {
        Text(text, fontSize = 13.sp, color = if (active) Color.White else Black)
    }
}

@Composable
private fun ReviewPane(
    state: WordbookUiState,
    onSpeak: (WordbookItem) -> Unit,
    onRate: (WordbookItem, Boolean) -> Unit,
) {
    val current = state.current
    when {
        state.loading -> {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("加载中…", fontSize = 13.sp, color = Black)
            }
        }
        current == null -> {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(if (state.doneCount > 0) "🎉" else "🌤", fontSize = 40.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        if (state.doneCount > 0) "本轮复习完成，答对 ${state.doneCount} 个！" else "今天没有到期的生词",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Black,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text("点读生字/生词可以继续收集", fontSize = 13.sp, color = HintGray)
                }
            }
        }
        else -> {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // 大字卡：点击听发音
                    Text(
                        current.text,
                        fontSize = 48.sp,
                        fontWeight = FontWeight.Bold,
                        color = Black,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !state.busy) { onSpeak(current) }
                            .semantics { contentDescription = "朗读 ${current.text}" },
                    )
                    if (current.pinyin.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(current.pinyin, fontSize = 16.sp, color = HintGray)
                    }
                    Spacer(Modifier.height(16.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        OutlinedButton(
                            onClick = { onRate(current, false) },
                            enabled = !state.busy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("😕 不认识", fontSize = 15.sp, color = Black)
                        }
                        Button(
                            onClick = { onRate(current, true) },
                            enabled = !state.busy,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = GoodText),
                        ) {
                            Text("😄 认识", fontSize = 15.sp, color = Color.White)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "第 ${current.box} 阶 · 学过 ${current.times} 次",
                        fontSize = 12.sp,
                        color = HintGray,
                    )
                }
            }
        }
    }
}

@Composable
private fun ListPane(
    state: WordbookUiState,
    onSpeak: (WordbookItem) -> Unit,
    onDelete: (Long) -> Unit,
) {
    if (state.loading) {
        Text("加载中…", fontSize = 13.sp, color = Black)
        return
    }
    if (state.items.isEmpty()) {
        Spacer(Modifier.height(24.dp))
        Text(
            "还没有生词，去点读生字/生词收集吧",
            fontSize = 14.sp,
            color = Black,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(state.items, key = { it.id }) { item ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            ) {
                Row(
                    modifier = Modifier.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clickable { onSpeak(item) }
                            .semantics { contentDescription = "朗读 ${item.text}" },
                    ) {
                        Text(
                            if (item.pinyin.isBlank()) item.text else "${item.text}（${item.pinyin}）",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = Black,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "第 ${item.box} 阶 · ${item.correct}/${item.times} 次答对 · 下次复习 ${item.nextReview.ifBlank { "—" }}",
                            fontSize = 12.sp,
                            color = Black,
                        )
                    }
                    Spacer(Modifier.width(6.dp))
                    TextButton(
                        onClick = { onSpeak(item) },
                        modifier = Modifier.semantics { contentDescription = "听发音" },
                    ) {
                        Text("🔊", fontSize = 15.sp)
                    }
                    TextButton(
                        onClick = { onDelete(item.id) },
                        modifier = Modifier.semantics { contentDescription = "删除 ${item.text}" },
                    ) {
                        Text("🗑", fontSize = 15.sp)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}
