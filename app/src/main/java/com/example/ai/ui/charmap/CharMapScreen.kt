package com.example.ai.ui.charmap

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.charmap.CharMapGroup
import com.example.ai.data.charmap.LearnStatus

private val Black = Color(0xFF000000)
private val BadText = Color(0xFFB71C1C)
private val GradeLabel = Color(0xFF334155)

// 与 web `.charmap-cell.*` 完全同色
private val LitBg = Color(0xFFDCFCE7)
private val LitFg = Color(0xFF15803D)
private val UnsureBg = Color(0xFFFEF3C7)
private val UnsureFg = Color(0xFFB45309)
private val WrongBg = Color(0xFFFEE2E2)
private val WrongFg = Color(0xFFB91C1C)
private val NoneBg = Color(0xFFF8FAFC)
private val NoneFg = Color(0xFFCBD5E1)

private val BarTrack = Color(0xFFF1F5F9)
private val BarFill = Color(0xFF22C55E)

/**
 * 类型中文标签。
 * ⚠️ 实测生产数据（2026-09-22 拉全量 3028 条）的 type 取值是 **认/写/词/英词/英句**，
 *    与 Android `CharImageList.type_` 完全同词表 ⇒ 点击可**直接透传**，无需映射。
 *    （web `CharMapPage` 的 TYPE_LABEL 写的是 字/词/句，是过期词表，认/写 会原样显示。）
 */
private val TYPE_LABEL = mapOf(
    "认" to "识字表", "写" to "写字表", "词" to "词语表",
    "英词" to "英语词汇表", "英句" to "英语句子表",
)

/**
 * 汉字地图（对齐 web CharMapPage）：全部字卡按年级铺成地图，评价过「认识 ✓」的格子点亮。
 * 点格子进入该字对应的字卡练习。
 */
@Composable
fun CharMapScreen(
    onBack: () -> Unit,
    onOpenCell: (grade: String, semester: String, type: String, char: String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: CharMapViewModel = viewModel { CharMapViewModel() },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(modifier = modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 16.dp)) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("🗺️ 汉字地图", style = MaterialTheme.typography.titleLarge, color = Black)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            if (state.loading) {
                "正在铺开地图…"
            } else {
                "共 ${state.total} 个字词，已点亮 ${state.litTotal} 个。点亮 = 评价过「认识 ✓」"
            },
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
                Spacer(Modifier.height(24.dp))
                Text(
                    "还没有字卡数据",
                    fontSize = 14.sp,
                    color = Black,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            else -> {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 44.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    state.groups.forEach { g ->
                        item(key = "h-${g.key}", span = { GridItemSpan(maxLineSpan) }) {
                            GradeHeader(g)
                        }
                        items(
                            count = g.cells.size,
                            key = { idx -> "${g.key}#$idx#${g.cells[idx].char}" },
                        ) { idx ->
                            val cell = g.cells[idx]
                            val status = state.statusMap[cell.char] ?: LearnStatus.NONE
                            val (bg, fg) = cellColors(status)
                            val typeLabel = TYPE_LABEL[cell.type] ?: cell.type
                            Box(
                                modifier = Modifier
                                    .aspectRatio(1f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(bg)
                                    .clickable { onOpenCell(cell.grade, cell.semester, cell.type, cell.char) }
                                    .semantics { contentDescription = "${cell.char}（$typeLabel）去学习" },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    cell.char,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = fg,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) { Spacer(Modifier.height(24.dp)) }
                }
            }
        }
    }
}

@Composable
private fun GradeHeader(g: CharMapGroup) {
    val pct = if (g.cells.isEmpty()) 0f else g.litCount.toFloat() / g.cells.size
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(g.key, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = GradeLabel)
        Spacer(Modifier.width(8.dp))
        Box(
            modifier = Modifier
                .weight(1f)
                .height(8.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(BarTrack),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(pct.coerceIn(0f, 1f))
                    .height(8.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(BarFill),
            )
        }
        Spacer(Modifier.width(8.dp))
        Text("${g.litCount}/${g.cells.size}", fontSize = 12.sp, color = GradeLabel)
    }
}

/** 状态 → (背景, 前景) */
private fun cellColors(status: LearnStatus): Pair<Color, Color> = when (status) {
    LearnStatus.CORRECT -> LitBg to LitFg
    LearnStatus.UNSURE -> UnsureBg to UnsureFg
    LearnStatus.WRONG -> WrongBg to WrongFg
    LearnStatus.NONE -> NoneBg to NoneFg
}
