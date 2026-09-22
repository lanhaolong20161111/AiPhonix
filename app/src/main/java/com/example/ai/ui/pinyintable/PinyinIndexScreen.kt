package com.example.ai.ui.pinyintable

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.audio.PinyinAudioPlayer
import com.example.ai.data.pinyin.PinyinCategory
import com.example.ai.data.pinyin.PinyinTableData
import com.example.ai.data.pinyin.PinyinTableItem
import com.example.ai.di.ServiceModule

private val Black = Color(0xFF000000)
private val PlayingBlue = Color(0xFF90CAF9)

/**
 * 拼音表索引页 — 声母/韵母/整体认读音节分组展示。
 * 点格子进详情页；点符号直接听发音；助记字可开关。
 */
@Composable
fun PinyinIndexScreen(
    onOpenDetail: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val player = remember { PinyinAudioPlayer(ServiceModule.serverBase) }
    DisposableEffect(Unit) { onDispose { player.stop() } }
    var playingId by remember { mutableStateOf<String?>(null) }
    var showMnemonic by remember { mutableStateOf(true) }

    fun playSymbol(id: String, audio: String) {
        if (playingId == id) {
            player.stop()
            playingId = null
        } else {
            player.play(audio)
            playingId = id
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
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
            Text("拼音表", style = MaterialTheme.typography.titleLarge, color = Black)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { showMnemonic = !showMnemonic }) {
                Text(
                    if (showMnemonic) "助记字 ✓" else "助记字",
                    fontSize = 13.sp,
                    color = Black,
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Text("点拼音进详情，点符号直接听发音", fontSize = 13.sp, color = Black)
        Spacer(Modifier.height(8.dp))

        PinyinSection(
            category = PinyinCategory.SHENGMU,
            items = PinyinTableData.shengmu,
            showMnemonic = showMnemonic,
            playingId = playingId,
            onPlay = { id, audio -> playSymbol(id, audio) },
            onOpenDetail = onOpenDetail,
        )
        PinyinSection(
            category = PinyinCategory.YUNMU,
            items = PinyinTableData.yunmu,
            showMnemonic = showMnemonic,
            playingId = playingId,
            onPlay = { id, audio -> playSymbol(id, audio) },
            onOpenDetail = onOpenDetail,
        )
        PinyinSection(
            category = PinyinCategory.ZHENGTI,
            items = PinyinTableData.zhengti,
            showMnemonic = showMnemonic,
            playingId = playingId,
            onPlay = { id, audio -> playSymbol(id, audio) },
            onOpenDetail = onOpenDetail,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun PinyinSection(
    category: PinyinCategory,
    items: List<PinyinTableItem>,
    showMnemonic: Boolean,
    playingId: String?,
    onPlay: (String, String) -> Unit,
    onOpenDetail: (String) -> Unit,
) {
    Text(
        "${category.title}（${items.size}）",
        fontSize = 16.sp,
        fontWeight = FontWeight.Bold,
        color = Black,
        modifier = Modifier.padding(top = 12.dp, bottom = 6.dp),
    )
    val chunked = items.chunked(6)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        chunked.forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.forEach { item ->
                    PinyinCell(
                        item = item,
                        category = category,
                        showMnemonic = showMnemonic,
                        isPlaying = playingId == item.id,
                        onPlay = { onPlay(item.id, item.audio) },
                        onClick = { onOpenDetail(item.id) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(6 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun PinyinCell(
    item: PinyinTableItem,
    category: PinyinCategory,
    showMnemonic: Boolean,
    isPlaying: Boolean,
    onPlay: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val mnemonic = if (showMnemonic) PinyinTableData.mnemonic(category, item.id) else ""
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = if (isPlaying) PlayingBlue else Color(0xFFFFFFFF),
        tonalElevation = 1.dp,
        shadowElevation = 1.dp,
        modifier = modifier.height(if (mnemonic.isNotEmpty()) 64.dp else 48.dp),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier
                .fillMaxSize()
                .clickable(onClick = onClick)
                .padding(horizontal = 2.dp),
        ) {
            if (mnemonic.isNotEmpty()) {
                Text(
                    mnemonic,
                    fontSize = 11.sp,
                    color = Black,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                )
            }
            Text(
                item.label,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Black,
                textAlign = TextAlign.Center,
                modifier = Modifier.clickable(onClick = onPlay),
            )
        }
    }
}
