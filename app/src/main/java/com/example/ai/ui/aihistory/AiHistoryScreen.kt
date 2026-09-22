package com.example.ai.ui.aihistory

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.aihistory.AiHistoryItem
import com.example.ai.data.aihistory.AiHistoryStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Black = Color(0xFF000000)

/**
 * AI 历史会话列表（对齐 web AiHistoryPage）：按 语文/数学/英语 分桶，本地存储。
 * 点条目回看：会话型 → 续聊；识别快照 → 只读详情。
 */
@Composable
fun AiHistoryScreen(
    store: AiHistoryStore,
    onBack: () -> Unit,
    onOpenItem: (AiHistoryItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: AiHistoryViewModel = viewModel { AiHistoryViewModel(store) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(modifier = modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("🗂 AI 历史", style = MaterialTheme.typography.titleLarge, color = Black)
        }
        Spacer(Modifier.height(10.dp))

        // 模块切换
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("chinese" to "语文", "math" to "数学", "english" to "英语").forEach { (id, label) ->
                FilterChip(
                    selected = state.module == id,
                    onClick = { viewModel.selectModule(id) },
                    label = { Text(label, color = Black) },
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        if (state.loading) {
            Text("加载中…", fontSize = 13.sp, color = Black)
        } else if (state.items.isEmpty()) {
            Spacer(Modifier.height(24.dp))
            Text(
                "还没有历史记录\n去「AI 陪我练」拍照识别或提问吧",
                fontSize = 14.sp,
                color = Black,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.items, key = { it.id }) { item ->
                    HistoryItemCard(
                        item = item,
                        onClick = { onOpenItem(item) },
                        onDelete = { viewModel.remove(item.id) },
                    )
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

private val dateFmt = SimpleDateFormat("M月d日 HH:mm", Locale.CHINA)

@Composable
private fun HistoryItemCard(item: AiHistoryItem, onClick: () -> Unit, onDelete: () -> Unit) {
    val isChat = item.turns.isNotEmpty()
    val summary = if (isChat) {
        item.turns.firstOrNull { it.role == "user" }?.content?.take(60) ?: item.text.take(60)
    } else {
        item.text.take(60)
    }
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (item.thumb.isNotBlank()) {
                ThumbImage(dataUrl = item.thumb, modifier = Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)))
                Spacer(Modifier.width(10.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (isChat) "💬 对话 ${item.turns.size / 2} 轮" else "📷 识别",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF1565C0),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(dateFmt.format(Date(item.createdAt)), fontSize = 12.sp, color = Black)
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    summary.ifBlank { "（无内容）" },
                    fontSize = 13.sp,
                    color = Black,
                    maxLines = 2,
                )
            }
            TextButton(onClick = onDelete) { Text("🗑", fontSize = 16.sp) }
        }
    }
}

@Composable
private fun ThumbImage(dataUrl: String, modifier: Modifier = Modifier) {
    val bmp = remember(dataUrl) {
        try {
            val b64 = dataUrl.substringAfter("base64,", "")
            if (b64.isEmpty()) null
            else {
                val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }
        } catch (_: Exception) { null }
    }
    if (bmp != null) {
        Image(
            bitmap = bmp.asImageBitmap(),
            contentDescription = "历史缩略图",
            modifier = modifier,
            contentScale = ContentScale.Crop,
        )
    } else {
        Spacer(modifier)
    }
}
