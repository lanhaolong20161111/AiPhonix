package com.example.ai.ui.soehistory

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.speech.ScoreClient
import com.example.ai.data.soerecord.SoeRecord

private val Black = Color(0xFF000000)
private val GoodText = Color(0xFF2E7D32)
private val OkText = Color(0xFFB26A00)
private val BadText = Color(0xFFB71C1C)
private val GoodBg = Color(0xFFE8F5E9)
private val OkBg = Color(0xFFFFF3D6)
private val BadBg = Color(0xFFFFEBEE)

/** 分数 → 前景/背景色（≥80 绿 / 60-79 黄 / <60 红） */
private fun scoreColors(score: Float): Pair<Color, Color> = when {
    score >= 80f -> GoodText to GoodBg
    score >= 60f -> OkText to OkBg
    else -> BadText to BadBg
}

/**
 * 评测历史（对齐 web SoeHistoryPage）：本账号全部发音评测记录，
 * 可展开音素/单词明细（含总分），支持单条删除与批量删除。
 */
@Composable
fun SoeHistoryScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenParentReport: () -> Unit = {},
    viewModel: SoeHistoryViewModel = viewModel { SoeHistoryViewModel() },
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
            Text("📊 评测历史", style = MaterialTheme.typography.titleLarge, color = Black)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "每次发音评测结果（含音素）都记录在本账号下，点「明细」展开。",
            fontSize = 13.sp,
            color = Black,
        )
        Spacer(Modifier.height(10.dp))

        // 家长周报入口（web SoeHistoryPage 也是把入口放在这一页，不在首页）
        Button(
            onClick = onOpenParentReport,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEFF6FF)),
        ) {
            Text("📈 家长周报", color = Black, fontSize = 14.sp)
        }
        Spacer(Modifier.height(10.dp))

        // 工具栏：全选 + 已选 + 批量删除
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(
                checked = state.allSelected,
                onCheckedChange = { viewModel.toggleSelectAll() },
                enabled = state.records.isNotEmpty(),
            )
            Text("全选", fontSize = 13.sp, color = Black)
            Spacer(Modifier.width(12.dp))
            Text("已选 ${state.selectedIds.size} 条", fontSize = 13.sp, color = Black)
            Spacer(Modifier.weight(1f))
            Button(
                onClick = { viewModel.batchDelete() },
                enabled = state.selectedIds.isNotEmpty() && !state.deleting,
                colors = ButtonDefaults.buttonColors(containerColor = BadText),
            ) {
                Text("批量删除", color = Color.White, fontSize = 13.sp)
            }
        }

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
            state.records.isEmpty() -> {
                Spacer(Modifier.height(24.dp))
                Text(
                    "🎤 还没有评测记录，先去「读一读」试试吧",
                    fontSize = 14.sp,
                    color = Black,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            else -> {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(state.records, key = { it.id }) { record ->
                        SoeRecordCard(
                            record = record,
                            selected = record.id in state.selectedIds,
                            expanded = state.expandedId == record.id,
                            onToggleSelect = { viewModel.toggleSelect(record.id) },
                            onToggleExpand = { viewModel.toggleExpand(record.id) },
                            onDelete = { viewModel.delete(record.id) },
                        )
                    }
                    item { Spacer(Modifier.height(24.dp)) }
                }
            }
        }
    }
}

@Composable
private fun SoeRecordCard(
    record: SoeRecord,
    selected: Boolean,
    expanded: Boolean,
    onToggleSelect: () -> Unit,
    onToggleExpand: () -> Unit,
    onDelete: () -> Unit,
) {
    val (scoreFg, scoreBg) = scoreColors(record.suggestedScore)
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = selected, onCheckedChange = { onToggleSelect() })
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(onClick = onToggleExpand),
                ) {
                    Text(
                        record.refText.ifBlank { "（无文本）" },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Black,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        listOfNotNull(
                            record.typeLabel,
                            record.createdAtLabel.takeIf { it.isNotBlank() },
                        ).joinToString(" · "),
                        fontSize = 12.sp,
                        color = Black,
                    )
                }
                Spacer(Modifier.width(8.dp))
                // 总分角标
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = scoreBg,
                    border = BorderStroke(1.dp, scoreFg.copy(alpha = 0.4f)),
                ) {
                    Text(
                        "%.0f".format(record.suggestedScore),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = scoreFg,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
                TextButton(onClick = onToggleExpand) {
                    Text(if (expanded) "▴ 明细" else "▾ 明细", fontSize = 12.sp, color = Black)
                }
                TextButton(onClick = onDelete) { Text("🗑", fontSize = 15.sp) }
            }
            if (expanded) {
                Spacer(Modifier.height(6.dp))
                SoeDetailSection(record = record)
            }
        }
    }
}

/**
 * 评测明细（对齐 web SoeDetail）：
 * 单词/单字评测（units.size == 1）→ 每个音素得分；句子 → 每个词得分。
 * 总分与明细一起显示；颜色 ≥80 绿 / 60-79 黄 / <60 红。
 */
@Composable
private fun SoeDetailSection(record: SoeRecord) {
    val isZh = record.language == "zh"
    val single = record.units.size == 1
    val (totalFg, totalBg) = scoreColors(record.suggestedScore)

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("总分", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Black)
            Spacer(Modifier.width(8.dp))
            Surface(shape = RoundedCornerShape(8.dp), color = totalBg) {
                Text(
                    "%.0f".format(record.suggestedScore),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = totalFg,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                "准确度 %.0f · 流利度 %.0f · 完整度 %.0f".format(
                    record.totalAccuracy, record.totalFluency, record.totalCompletion,
                ),
                fontSize = 12.sp,
                color = Black,
            )
        }
        Spacer(Modifier.height(8.dp))

        if (record.units.isEmpty()) {
            Text("（该记录无明细）", fontSize = 12.sp, color = Black)
            return@Column
        }

        // 标题随语言与评测粒度走
        val title = when {
            single && isZh -> "拼音得分"
            single -> "音素得分"
            isZh -> "汉字得分"
            else -> "单词得分"
        }
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Black)
        Spacer(Modifier.height(6.dp))

        if (single) {
            // 单字/单词：展示每个音素的得分
            val phones = record.units.first().phones
            if (phones.isEmpty()) {
                Text("（无音素明细）", fontSize = 12.sp, color = Black)
            } else {
                phones.chunked(4).forEach { rowPhones ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        rowPhones.forEach { ph ->
                            ScoreChip(
                                label = displayPhone(ph.phone, isZh),
                                score = ph.accuracy,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        repeat(4 - rowPhones.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
        } else {
            // 句子：展示每个字的得分
            record.units.chunked(4).forEach { rowUnits ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    rowUnits.forEach { unit ->
                        ScoreChip(
                            label = unit.word.ifBlank { "—" },
                            score = unit.accuracy,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(4 - rowUnits.size) { Spacer(Modifier.weight(1f)) }
                }
                Spacer(Modifier.height(6.dp))
            }
        }
    }
}

/** 音素显示：英文 ARPAbet → 国际音标；中文直接显示拼音（带声调数字） */
private fun displayPhone(phone: String, isZh: Boolean): String =
    if (isZh) phone else ScoreClient.arpabetToIpa(phone)

@Composable
private fun ScoreChip(label: String, score: Float, modifier: Modifier = Modifier) {
    val (fg, bg) = scoreColors(score)
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = bg,
        border = BorderStroke(1.dp, fg.copy(alpha = 0.35f)),
        modifier = modifier.height(52.dp),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(label, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Black, maxLines = 1)
            Text("%.0f".format(score), fontSize = 12.sp, color = fg)
        }
    }
}
