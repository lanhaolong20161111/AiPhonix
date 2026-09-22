package com.example.ai.ui.pinyintable

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.audio.PinyinAudioPlayer
import com.example.ai.data.pinyin.PinyinExample
import com.example.ai.data.pinyin.PinyinTableData
import com.example.ai.data.pinyin.PinyinTableItem
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.launch

private val Black = Color(0xFF000000)
private val PlayingBlue = Color(0xFF90CAF9)

/**
 * 拼音详情页 — 横向滑动切换全部拼音项（声母 → 韵母 → 整体认读）。
 * 大符号 + 听发音；例字点击用中文 TTS 朗读；口诀提示可开关。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PinyinDetailScreen(
    initialId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val player = remember { PinyinAudioPlayer(ServiceModule.serverBase) }
    val tts = remember { BaiduTtsCache(context.applicationContext) }
    DisposableEffect(Unit) {
        onDispose {
            player.stop()
            BaiduTtsCache.stopAll()
        }
    }

    val all = remember { PinyinTableData.all }
    val initialIndex = remember(initialId) {
        all.indexOfFirst { it.second.id == initialId }.coerceAtLeast(0)
    }
    val pagerState = rememberPagerState(initialPage = initialIndex, pageCount = { all.size })
    var playingSymbol by remember { mutableStateOf<String?>(null) }
    var playingExample by remember { mutableStateOf<String?>(null) }
    var showMnemonic by remember { mutableStateOf(true) }

    val cur = all.getOrNull(pagerState.currentPage)

    Column(modifier = modifier.fillMaxSize().padding(20.dp)) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clickable(onClick = onBack),
            )
            Text(
                cur?.first?.title ?: "",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
            )
            Spacer(Modifier.weight(1f))
            Text(
                "${pagerState.currentPage + 1}/${all.size}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = Black,
            )
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = { showMnemonic = !showMnemonic }) {
                Text(if (showMnemonic) "口诀 ✓" else "口诀", fontSize = 13.sp, color = Black)
            }
        }
        Spacer(Modifier.height(8.dp))

        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxWidth().weight(1f),
        ) { page ->
            val (category, item) = all.getOrNull(page) ?: return@HorizontalPager
            PinyinDetailContent(
                item = item,
                categoryTitle = category.title,
                showMnemonic = showMnemonic,
                playingSymbol = playingSymbol == item.id,
                playingExample = playingExample,
                onPlaySymbol = {
                    if (playingSymbol == item.id) {
                        player.stop()
                        playingSymbol = null
                    } else {
                        player.play(item.audio)
                        playingSymbol = item.id
                    }
                },
                onPlayExample = { key, char ->
                    if (playingExample == key) {
                        BaiduTtsCache.stopAll()
                        playingExample = null
                    } else {
                        playingExample = key
                        scope.launch {
                            try {
                                tts.play(char, "0")
                            } finally {
                                if (playingExample == key) playingExample = null
                            }
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun PinyinDetailContent(
    item: PinyinTableItem,
    categoryTitle: String,
    showMnemonic: Boolean,
    playingSymbol: Boolean,
    playingExample: String?,
    onPlaySymbol: () -> Unit,
    onPlayExample: (String, String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(12.dp))
        // 大符号 + 听发音
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                item.label,
                fontSize = 56.sp,
                fontWeight = FontWeight.Bold,
                color = Black,
            )
            Spacer(Modifier.width(16.dp))
            Button(
                onClick = onPlaySymbol,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (playingSymbol) PlayingBlue else Color(0xFF1565C0),
                    contentColor = Color(0xFFFFFFFF),
                ),
            ) {
                Text(if (playingSymbol) "⏹" else "▶", fontSize = 16.sp)
                Spacer(Modifier.width(4.dp))
                Text("听发音", fontSize = 15.sp)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text("类别：$categoryTitle", fontSize = 13.sp, color = Black)
        if (showMnemonic && item.tip.isNotBlank()) {
            Spacer(Modifier.height(4.dp))
            Text("提示：${item.tip}", fontSize = 13.sp, color = Black, textAlign = TextAlign.Center)
        }

        Spacer(Modifier.height(20.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("例字", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Black)
                Spacer(Modifier.height(12.dp))
                item.examples.chunked(2).forEach { rowExamples ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        rowExamples.forEach { ex ->
                            ExampleWordButton(
                                example = ex,
                                itemId = item.id,
                                isPlaying = playingExample == "${item.id}-${ex.char}",
                                onClick = { onPlayExample("${item.id}-${ex.char}", ex.char) },
                                modifier = Modifier.weight(1f),
                            )
                        }
                        if (rowExamples.size == 1) Spacer(Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(10.dp))
                }
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun ExampleWordButton(
    example: PinyinExample,
    itemId: String,
    isPlaying: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = if (isPlaying) PlayingBlue else Color(0xFFF5F5F5),
        border = BorderStroke(1.dp, if (isPlaying) Color(0xFF64B5F6) else Color(0xFFE0E0E0)),
        modifier = modifier
            .height(64.dp)
            .clickable(onClick = onClick),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(example.char, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Black)
            Text(example.pinyin, fontSize = 13.sp, color = Black)
        }
    }
}
