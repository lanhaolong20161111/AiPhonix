package com.example.ai.ui.aihomework

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.aihomework.CharClickStatItem

/** 认读画像：字被点击发音次数降序——点得越多的字越不会认读（薄弱字靠前） */
@Composable
fun AiHomeworkCharStatsScreen(
    viewModel: AiHomeworkCharStatsViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

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
            Text("📖 认读画像", style = MaterialTheme.typography.titleLarge)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "逐字点读时自动记录：点得越多的字 = 越不会认读，靠前的字需要重点练习",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF212121),
        )

        Spacer(Modifier.height(14.dp))

        if (state.loading && state.stats.totalClicks == 0) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 12.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("正在加载画像…", style = MaterialTheme.typography.bodySmall)
            }
        } else if (state.stats.totalClicks == 0) {
            Text(
                "还没有记录。在解析页逐字点读（点击单个字听发音）后，这里会展示你最容易忘记的字。",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF37474F),
                modifier = Modifier.padding(vertical = 12.dp),
            )
        } else {
            // 汇总卡
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SummaryCard("已点读", "${state.stats.totalChars} 字", Color(0xFF1976D2))
                SummaryCard("累计点击", "${state.stats.totalClicks} 次", Color(0xFFB71C1C))
            }
            Spacer(Modifier.height(12.dp))

            // 薄弱字榜（降序；次数越多越薄弱）
            Text("🧠 薄弱字榜（点得越多越不会认读）", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(6.dp))
            val maxCount = (state.stats.items.firstOrNull()?.count ?: 1).coerceAtLeast(1)
            state.stats.items.forEachIndexed { index, item ->
                CharStatRow(index = index + 1, item = item, maxCount = maxCount)
            }
        }

        if (state.error.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(state.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** 汇总小卡（需在 Row 内使用） */
@Composable
private fun androidx.compose.foundation.layout.RowScope.SummaryCard(label: String, value: String, color: Color) {
    Card(
        modifier = Modifier.weight(1f),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F5F5)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = color)
            Text(label, style = MaterialTheme.typography.bodySmall, color = Color(0xFF37474F))
        }
    }
}

/** 单字行：排名 + 字 + 次数 + 强度条（次数越多颜色越红） */
@Composable
private fun CharStatRow(index: Int, item: CharClickStatItem, maxCount: Int) {
    val ratio = (item.count.toFloat() / maxCount).coerceIn(0f, 1f)
    val barColor = when {
        item.count >= 5 -> Color(0xFFD32F2F) // 高频点击：很不会
        item.count >= 2 -> Color(0xFFF57C00) // 中频
        else -> Color(0xFF388E3C) // 低频：基本会
    }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "$index.",
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF37474F),
                modifier = Modifier.width(34.dp),
            )
            Text(
                item.char,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.width(48.dp),
            )
            // 强度条
            Box(
                Modifier
                    .weight(1f)
                    .height(10.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(Color(0xFFE0E0E0)),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(ratio)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(5.dp))
                        .background(barColor),
                )
            }
            Spacer(Modifier.width(10.dp))
            Text(
                "${item.count} 次",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = if (item.count >= 5) Color(0xFFB71C1C) else Color(0xFF37474F),
            )
        }
    }
}
