package com.example.ai.ui.aihomework

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.widget.Toast
import com.example.ai.data.aihomework.BlockSuggestion
import com.example.ai.data.aihomework.BraceBlock
import com.example.ai.data.aihomework.BuildBlockItem
import com.example.ai.data.aihomework.BuildReviewResult
import com.example.ai.data.aihomework.BuilderBlock
import com.example.ai.data.aihomework.DynamicBlock
import com.example.ai.data.aihomework.NodeCircleBlock
import com.example.ai.data.aihomework.PersonBlock
import com.example.ai.data.aihomework.SegmentBlock
import com.example.ai.data.aihomework.TextBlock
import com.example.ai.data.aihomework.ValueLabelBlock
import kotlin.math.abs

/**
 * 搭积木学习画布：学生用积木（线段/虚线/大括号×4/节点圆/数值标签/自由文本 + LLM 动态积木）
 * 搭出题目数量关系图，提交 LLM 审核。
 *
 * 交互：点组件栏积木 → 加到画布 → 拖动画布移动 / 拖右端圆点手柄调长短 / 点块选中（底部编辑文字）
 * → 撤销 / 清空 / 提交审核。
 *
 * @param onSuggest 动态积木建议（ViewModel → Repository.fetchBlockSuggestions，失败返回空）
 * @param onSubmitReview 提交审核（ViewModel → Repository.submitBuildReview，返回 null 表示网络失败）
 */
@Composable
fun BlockBuilder(
    question: String,
    onSubmitReview: suspend (String, List<BuildBlockItem>) -> BuildReviewResult?,
    onAutoBuild: suspend (String) -> com.example.ai.data.aihomework.AutoBuildResult? = { null },
    modifier: Modifier = Modifier,
) {
    var blocks by remember { mutableStateOf<List<BuilderBlock>>(emptyList()) }
    var undo by remember { mutableStateOf(UndoStack()) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var reviewing by remember { mutableStateOf(false) }
    var reviewResult by remember { mutableStateOf<BuildReviewResult?>(null) }
    // 线段全局等比缩放系数：所有同类型线段长度 = k × 数值（-1 = 未初始化）
    var scaleK by remember { mutableStateOf(-1f) }
    // 添加端点模式：从线段左/右端拖出红点，实时显示距离
    var endpointMode by remember { mutableStateOf(false) }
    var draftPoint by remember { mutableStateOf<Float?>(null) } // 拖动中红点画布归一化 x
    var draftFromRight by remember { mutableStateOf(false) }
    // 自动搭建：LLM 提取线段图初始指令
    var autoBuilding by remember { mutableStateOf(false) }
    var autoBuildError by remember { mutableStateOf(false) }

    fun updateSelected(transform: (BuilderBlock) -> BuilderBlock) {
        val sel = selectedId
        if (sel != null) blocks = blocks.map { if (it.id == sel) transform(it) else it }
    }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFBF8F0)),
    ) {
        Column(Modifier.padding(10.dp)) {
            // 顶部操作行
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("🧱 搭积木", style = MaterialTheme.typography.titleSmall, color = Color(0xFF37474F))
                // 按钮多，用 FlowRow 自动换行（避免超出屏幕被截断）
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    // 自动搭建：LLM 提取线段图初始指令（已知/未知量、关系、差值、大括号）
                    SmallAction(
                        if (autoBuilding) "⏳ 搭建中…" else "🤖 自动搭",
                        enabled = !autoBuilding && blocks.isEmpty() && question.isNotBlank(),
                    ) {
                        autoBuilding = true
                        autoBuildError = false
                    }
                    if (autoBuilding) {
                        LaunchedEffect(Unit) {
                            val result = onAutoBuild(question)
                            if (result != null && result.segments.isNotEmpty()) {
                                undo = undo.push(blocks)
                                blocks = autoBlocksFrom(result)
                                selectedId = null
                            } else {
                                autoBuildError = true
                            }
                            autoBuilding = false
                        }
                    }
                    if (autoBuildError) {
                        Text("自动搭建失败", style = MaterialTheme.typography.labelSmall, color = Color(0xFFC62828))
                    }
                    val segCount = blocks.count { it is SegmentBlock }
                    SmallAction("⬅ 左对齐", enabled = segCount >= 2) {
                        undo = undo.push(blocks)
                        blocks = alignSegmentsLeft(blocks)
                        selectedId = null
                    }
                    SmallAction("右对齐 ➡", enabled = segCount >= 2) {
                        undo = undo.push(blocks)
                        blocks = alignSegmentsRight(blocks)
                        selectedId = null
                    }
                    SmallAction("↩️ 撤销", enabled = undo.history.isNotEmpty()) {
                        val (restored, s) = undo.undo(blocks)
                        blocks = restored
                        undo = s
                        scaleK = -1f // 快照恢复后比例系数重新初始化
                        selectedId = null
                    }
                    SmallAction("🗑 清空", enabled = blocks.isNotEmpty()) {
                        undo = undo.push(blocks)
                        blocks = emptyList()
                        scaleK = -1f
                        selectedId = null
                    }
                    SmallAction("➖ 删除", enabled = selectedId != null) {
                        val sel = selectedId
                        if (sel != null) {
                            undo = undo.push(blocks)
                            val (nb, nk) = rescaleSegmentLengths(blocks.filter { it.id != sel }, scaleK)
                            blocks = nb
                            scaleK = nk
                            selectedId = null
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            // 组件栏（内置 + 动态）
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(builtinPalette()) { item ->
                    PaletteChip(item.label) {
                        undo = undo.push(blocks)
                        val (nb, nk) = rescaleSegmentLengths(blocks + placeNewBlock(item.make(), blocks), scaleK)
                        blocks = nb
                        scaleK = nk
                        selectedId = null
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            // 画布
            CanvasArea(
                blocks = blocks,
                selectedId = selectedId,
                endpointMode = endpointMode,
                draftPoint = draftPoint,
                draftFromRight = draftFromRight,
                onSelect = { selectedId = it },
                onMoveTo = { id, x, y ->
                    blocks = blocks.map { if (it.id == id) it.withPos(x, y) else it }
                },
                onMoveEnd = { before -> undo = undo.push(before) },
                onResize = { id, newW ->
                    // 拖手柄调长度：更新该线长度并计算新比例系数 k → 其他同类型线段跟随缩放
                    val resized = blocks.map { if (it.id == id) resizeBlock(it, newW) else it }
                    val norm = segmentGroup(resized)?.second?.firstOrNull { it.first.id == id }?.second
                    val k = if (norm != null && norm > 0f) {
                        (newW.coerceIn(0.08f, 1f)) / norm
                    } else {
                        scaleK
                    }
                    val (nb, nk) = rescaleSegmentLengths(resized, k)
                    blocks = nb
                    scaleK = nk
                },
                onResizeEnd = { before -> undo = undo.push(before) },
                onDelete = { id ->
                    undo = undo.push(blocks)
                    val (nb, nk) = rescaleSegmentLengths(blocks.filter { it.id != id }, scaleK)
                    blocks = nb
                    scaleK = nk
                    selectedId = null
                },
                onZoom = { factor ->
                    // 两指缩放：比例系数 k ×= factor → 所有线段同步放大/缩小（超画布自动缩显示）
                    if (scaleK > 0f) {
                        val (nb, nk) = rescaleSegmentLengths(blocks, scaleK * factor)
                        blocks = nb
                        scaleK = nk
                    }
                },
                onDraftPoint = { x, fromRight ->
                    draftPoint = x
                    draftFromRight = fromRight
                },
            )

            // 选中块的编辑表单
            val selBlock = selectedId?.let { id -> blocks.firstOrNull { it.id == id } }
            if (selBlock != null) {
                Spacer(Modifier.height(8.dp))
                when (selBlock) {
                    is SegmentBlock -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        // 数值/单位本地输入 state：非法内容留在输入框标红，block 保持最后合法值
                        var valueText by remember(selBlock.id) { mutableStateOf(selBlock.value) }
                        var unitText by remember(selBlock.id) { mutableStateOf(selBlock.unit) }
                        val valueInvalid = valueText.isNotBlank() && !isValidNumber(valueText)
                        val unitInvalid = unitText.isNotBlank() && !isValidUnit(unitText)
                        var lastToastAt by remember { mutableStateOf(0L) }
                        val toastContext = LocalContext.current
                        fun toastOnce(msg: String) {
                            val now = System.currentTimeMillis()
                            if (now - lastToastAt > 2000) {
                                lastToastAt = now
                                Toast.makeText(toastContext, msg, Toast.LENGTH_SHORT).show()
                            }
                        }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            EditField("名称", selBlock.label, Modifier.weight(1f)) { newVal ->
                                updateSelected { b -> b.withText(newVal) }
                            }
                            EditField(
                                "数值(空=未知)", valueText, Modifier.weight(1f),
                                isError = valueInvalid,
                                supportingText = if (valueInvalid) "请输入数字，如 12 或 3.5" else null,
                            ) { newVal ->
                                valueText = newVal
                                if (isValidNumber(newVal)) {
                                    updateSelected { b -> (b as SegmentBlock).copy(value = newVal) }
                                    val (nb, nk) = rescaleSegmentLengths(blocks, scaleK)
                                    blocks = nb
                                    scaleK = nk
                                } else {
                                    toastOnce("数值格式不正确：请填写数字（如 12 或 3.5），留空表示未知量")
                                }
                            }
                            EditField(
                                "单位", unitText, Modifier.weight(0.7f),
                                isError = unitInvalid,
                                supportingText = if (unitInvalid) "请输入中文或字母单位" else null,
                            ) { newVal ->
                                unitText = newVal
                                if (isValidUnit(newVal)) {
                                    updateSelected { b -> (b as SegmentBlock).copy(unit = newVal) }
                                    val (nb, nk) = rescaleSegmentLengths(blocks, scaleK)
                                    blocks = nb
                                    scaleK = nk
                                } else {
                                    toastOnce("单位格式不正确：单位只能是中文或字母（如 米、厘米、kg）")
                                }
                            }
                        }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            EditField("左端点名(空=无)", selBlock.leftLabel, Modifier.weight(1f)) { newVal ->
                                updateSelected { b -> (b as SegmentBlock).copy(leftLabel = newVal) }
                            }
                            EditField("右端点名(空=无)", selBlock.rightLabel, Modifier.weight(1f)) { newVal ->
                                updateSelected { b -> (b as SegmentBlock).copy(rightLabel = newVal) }
                            }
                        }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            var midText by remember(selBlock.id) {
                                mutableStateOf(if (selBlock.midPoints.isNotEmpty()) formatMidPoints(selBlock.midPoints) else "")
                            }
                            SmallAction(
                                if (endpointMode) "🎯 拖动红点定位置" else "➕ 添加端点",
                                enabled = !endpointMode && selBlock.value.toFloatOrNull()?.let { it > 0f } == true,
                            ) {
                                endpointMode = true
                                draftPoint = null
                                draftFromRight = false
                            }
                            if (endpointMode) {
                                Spacer(Modifier.width(6.dp))
                                SmallAction("✅ 确定", enabled = draftPoint != null) {
                                    val s = blocks.firstOrNull { it.id == selBlock.id } as? SegmentBlock
                                    val dp = draftPoint
                                    if (s != null && dp != null) {
                                        val mainW = if (s.times > 1) s.w * s.times else s.w
                                        val mp = midPointFromDraft(s, dp, draftFromRight, mainW)
                                        if (mp != null) {
                                            updateSelected { b ->
                                                (b as SegmentBlock).copy(
                                                    midPoints = (b.midPoints + mp).sortedBy { it.pos.toFloatOrNull() ?: 0f },
                                                )
                                            }
                                        }
                                    }
                                    endpointMode = false
                                    draftPoint = null
                                }
                                Spacer(Modifier.width(6.dp))
                                SmallAction("✖ 取消", enabled = true) {
                                    endpointMode = false
                                    draftPoint = null
                                }
                            }
                            Spacer(Modifier.width(6.dp))
                            val midCount = selBlock.midPoints.size
                            if (midCount > 0) {
                                Text(
                                    "已添加 ${midCount} 个端点：${selBlock.midPoints.joinToString("、") { it.pos }}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Color(0xFF6D4C41),
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            var segText by remember(selBlock.id) {
                                mutableStateOf(if (selBlock.segments > 1) selBlock.segments.toString() else "")
                            }
                            EditField("平均分成几份(空=1)", segText, Modifier.weight(1f)) { newVal ->
                                segText = newVal
                                updateSelected { b ->
                                    (b as SegmentBlock).copy(segments = (newVal.toIntOrNull() ?: 1).coerceAtLeast(1))
                                }
                            }
                            var timesText by remember(selBlock.id) {
                                mutableStateOf(if (selBlock.times > 1) selBlock.times.toString() else "")
                            }
                            EditField("放大倍数(空=1)", timesText, Modifier.weight(1f)) { newVal ->
                                timesText = newVal
                                updateSelected { b ->
                                    (b as SegmentBlock).copy(times = (newVal.toIntOrNull() ?: 1).coerceAtLeast(1))
                                }
                            }
                        }
                        Text(
                            "✂ 均分：画切割线总量不变；×N：复制 N 段等长拼接表示倍数",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFF8D6E63),
                        )
                    }
                    is BraceBlock -> EditField("标注文字（如 一共？个）", selBlock.label, Modifier.fillMaxWidth()) { newVal ->
                        updateSelected { b -> b.withText(newVal) }
                    }
                    is TextBlock -> EditField("输入文字", selBlock.text, Modifier.fillMaxWidth()) { newVal ->
                        updateSelected { b -> b.withText(newVal) }
                    }
                    is ValueLabelBlock -> EditField("输入数值/文字（如 126本）", selBlock.text, Modifier.fillMaxWidth()) { newVal ->
                        updateSelected { b -> b.withText(newVal) }
                    }
                    is NodeCircleBlock -> EditField("量名称（如 一共）", selBlock.name, Modifier.fillMaxWidth()) { newVal ->
                        updateSelected { b -> b.withText(newVal) }
                    }
                    is PersonBlock -> EditField("小人名字（如 小明）", selBlock.name, Modifier.fillMaxWidth()) { newVal ->
                        updateSelected { b -> b.withText(newVal) }
                    }
                    is DynamicBlock -> Text(
                        "${selBlock.name}：${selBlock.note.ifBlank { "大模型生成的专用积木" }}",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF6D4C41),
                    )
                }
            }

            Spacer(Modifier.height(10.dp))

            // 提交审核
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedButton(
                    onClick = {
                        if (blocks.isNotEmpty() && !reviewing) {
                            reviewing = true
                            reviewResult = null
                        }
                    },
                    enabled = blocks.isNotEmpty() && !reviewing,
                ) { Text(if (reviewing) "老师审核中…" else "📮 提交给老师审核") }
            }

            if (reviewing) {
                LaunchedEffect(Unit) {
                    reviewResult = onSubmitReview(question, toBuildItems(blocks))
                    reviewing = false
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("老师正在对照题目看图…", style = MaterialTheme.typography.bodySmall, color = Color(0xFF6D4C41))
                }
            }

            reviewResult?.let { r ->
                Spacer(Modifier.height(8.dp))
                ReviewResultCard(r) { reviewResult = null }
            }
        }
    }
}

// ── 内部小组件 ──

/** 内置积木清单（组件栏） */
private data class PaletteItem(val label: String, val make: () -> BuilderBlock)

private fun builtinPalette(): List<PaletteItem> = listOf(
    PaletteItem("━ 线段") { newSegmentBlock() },
    PaletteItem("╌ 虚线") { newSegmentBlock(dashed = true) },
)

@Composable
private fun PaletteChip(label: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        color = Color(0xFFE3F2FD),
        contentColor = Color(0xFF0D47A1),
        modifier = Modifier.padding(vertical = 2.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
    }
}

@Composable
private fun SmallAction(label: String, enabled: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(6.dp),
        color = if (enabled) Color(0xFFECEFF1) else Color(0xFFF5F5F5),
        contentColor = if (enabled) Color(0xFF37474F) else Color(0xFFBDBDBD),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
    }
}

@Composable
private fun EditField(
    label: String,
    value: String,
    modifier: Modifier,
    isError: Boolean = false,
    supportingText: String? = null,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
        textStyle = MaterialTheme.typography.bodySmall,
        singleLine = true,
        isError = isError,
        supportingText = supportingText?.let { { Text(it, style = MaterialTheme.typography.labelSmall) } },
        modifier = modifier.height(if (supportingText != null) 72.dp else 56.dp),
    )
}

@Composable
private fun ReviewResultCard(result: BuildReviewResult, onDismiss: () -> Unit) {
    val okColor = Color(0xFF2E7D32)
    val warnColor = Color(0xFFC62828)
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (result.passed) Color(0xFFE8F5E9) else Color(0xFFFFF3E0),
        ),
    ) {
        Column(Modifier.padding(10.dp)) {
            Text(
                if (result.passed) "✅ 通过！图搭对了" else "📝 老师提了几点意见",
                style = MaterialTheme.typography.titleSmall,
                color = if (result.passed) okColor else warnColor,
            )
            if (result.feedback.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(result.feedback, style = MaterialTheme.typography.bodySmall, color = Color(0xFF1A1A1A))
            }
            result.issues.forEach { issue ->
                Spacer(Modifier.height(6.dp))
                Text("⚠️ ${issue.message}", style = MaterialTheme.typography.bodySmall, color = warnColor)
                if (issue.fix.isNotBlank()) {
                    Text("　→ ${issue.fix}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF6D4C41))
                }
            }
            result.suggestions.forEach { s ->
                Spacer(Modifier.height(4.dp))
                Text("💡 $s", style = MaterialTheme.typography.bodySmall, color = Color(0xFF1A1A1A))
            }
            Spacer(Modifier.height(6.dp))
            Surface(
                onClick = onDismiss,
                shape = RoundedCornerShape(6.dp),
                color = Color(0xFFECEFF1),
                contentColor = Color(0xFF37474F),
            ) {
                Text("继续修改", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
            }
        }
    }
}

// ── 画布 ──

private const val CANVAS_HEIGHT_DP = 280
private const val HANDLE_TOUCH_PX = 20f // 手柄触摸容差（dp）

@Composable
private fun CanvasArea(
    blocks: List<BuilderBlock>,
    selectedId: String?,
    endpointMode: Boolean,
    draftPoint: Float?,
    draftFromRight: Boolean,
    onSelect: (String) -> Unit,
    onMoveTo: (String, Float, Float) -> Unit,
    onMoveEnd: (List<BuilderBlock>) -> Unit,
    onResize: (String, Float) -> Unit,
    onResizeEnd: (List<BuilderBlock>) -> Unit,
    onDelete: (String) -> Unit,
    onZoom: (Float) -> Unit,
    onDraftPoint: (Float, Boolean) -> Unit,
) {
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val currentBlocks by rememberUpdatedState(blocks)
    val currentSelected by rememberUpdatedState(selectedId)
    val currentEndpointMode by rememberUpdatedState(endpointMode)
    val currentDraftPoint by rememberUpdatedState(draftPoint)
    val currentDraftFromRight by rememberUpdatedState(draftFromRight)
    val currentOnMoveTo by rememberUpdatedState(onMoveTo)
    val currentOnResize by rememberUpdatedState(onResize)
    val currentOnMoveEnd by rememberUpdatedState(onMoveEnd)
    val currentOnResizeEnd by rememberUpdatedState(onResizeEnd)
    val currentOnSelect by rememberUpdatedState(onSelect)
    val currentOnDelete by rememberUpdatedState(onDelete)
    val currentOnZoom by rememberUpdatedState(onZoom)
    val currentOnDraftPoint by rememberUpdatedState(onDraftPoint)

    val touchPad = with(density) { HANDLE_TOUCH_PX.dp.toPx() }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .height(CANVAS_HEIGHT_DP.dp)
            .background(Color(0xFFFFFFFF), RoundedCornerShape(10.dp)),
    ) {
        val canvasWpx = with(density) { maxWidth.toPx() }
        val canvasHpx = with(density) { maxHeight.toPx() }
        var moveBefore by remember { mutableStateOf<List<BuilderBlock>>(emptyList()) }
        // 端点模式红点拖动状态：null=未拖红点 / false=拖左端 / true=拖右端
        var draggingPoint by remember { mutableStateOf<Boolean?>(null) }

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(CANVAS_HEIGHT_DP.dp)
                .pointerInput(canvasWpx, canvasHpx) {
                    // 单击选中：点中哪个块就选中哪个（顶层优先），点空白取消选中。
                    // 重叠区域重复点击 → 循环切换选择下一层（便于选中被遮挡的块）。
                    detectTapGestures(
                        onTap = { offset ->
                            val hits = currentBlocks
                                .filter { b -> hitTest(b, offset, canvasWpx, canvasHpx, touchPad) }
                            if (hits.isEmpty()) {
                                currentOnSelect("")
                            } else {
                                val top = hits.last() // blocks 顺序最后绘制 = 最上层
                                val idx = hits.indexOfFirst { it.id == currentSelected }
                                if (idx >= 0 && hits.size > 1) {
                                    val next = hits[(idx + 1) % hits.size]
                                    currentOnSelect(next.id)
                                } else {
                                    currentOnSelect(top.id)
                                }
                            }
                        },
                    )
                }
                .pointerInput(Unit) {
                    // 两指缩放：双指距离变化 → 缩放所有线段长度（单指不干扰拖动）
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        var lastDist = 0f
                        while (true) {
                            val event = awaitPointerEvent()
                            val pressed = event.changes.filter { it.pressed }
                            if (pressed.size >= 2) {
                                val dist = (pressed[0].position - pressed[1].position).getDistance()
                                if (lastDist > 0f && dist > 0f) {
                                    val factor = dist / lastDist
                                    if (abs(factor - 1f) > 0.02f) {
                                        currentOnZoom(factor)
                                        event.changes.forEach { if (it.positionChanged()) it.consume() }
                                        lastDist = dist
                                    }
                                } else {
                                    lastDist = dist
                                }
                            } else {
                                lastDist = 0f
                            }
                            if (event.changes.all { !it.pressed }) break
                        }
                    }
                }
                .pointerInput(canvasWpx, canvasHpx) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            moveBefore = currentBlocks
                            draggingPoint = null
                            // 0) 添加端点模式：先检测左右端点红点（可拖出红点）
                            if (currentEndpointMode) {
                                val selSeg = currentSelected?.let { id ->
                                    currentBlocks.firstOrNull { it.id == id } as? SegmentBlock
                                }
                                if (selSeg != null) {
                                    val mainW = if (selSeg.times > 1) selSeg.w * selSeg.times else selSeg.w
                                    val leftX = (selSeg.x - mainW / 2f) * canvasWpx
                                    val rightX = (selSeg.x + mainW / 2f) * canvasWpx
                                    val cy = selSeg.y * canvasHpx
                                    val draftX = currentDraftPoint?.let { it * canvasWpx }
                                    val leftPointX = if (!currentDraftFromRight) draftX ?: leftX else leftX
                                    val rightPointX = if (currentDraftFromRight) draftX ?: rightX else rightX
                                    if (abs(offset.x - leftPointX) < touchPad * 1.5f && abs(offset.y - cy) < touchPad * 2) {
                                        draggingPoint = false // 从左拖
                                        return@detectDragGestures
                                    }
                                    if (abs(offset.x - rightPointX) < touchPad * 1.5f && abs(offset.y - cy) < touchPad * 2) {
                                        draggingPoint = true // 从右拖
                                        return@detectDragGestures
                                    }
                                }
                            }
                            // 1) 手柄调宽优先（选中块的右端圆点）
                            val selId = currentSelected
                            val sel = selId?.let { id -> currentBlocks.firstOrNull { it.id == id } }
                            if (sel != null) {
                                val selW = if (sel is SegmentBlock) sel.w * sel.times else sel.w
                                val rightX = (sel.x + selW / 2f) * canvasWpx
                                val cy = sel.y * canvasHpx
                                if (abs(offset.x - rightX) < touchPad && abs(offset.y - cy) < touchPad * 2) {
                                    return@detectDragGestures
                                }
                            }
                            // 2) 当前选中的块命中 → 保持选中并拖动它（重叠时拖动被遮挡的块）
                            val curSelId = currentSelected
                            val curSelBlock = curSelId?.let { id -> currentBlocks.firstOrNull { it.id == id } }
                            if (curSelBlock != null && hitTest(curSelBlock, offset, canvasWpx, canvasHpx, touchPad)) {
                                return@detectDragGestures
                            }
                            // 3) 未选中块时：命中检测（倒序=顶层优先）
                            for (b in currentBlocks.asReversed()) {
                                if (hitTest(b, offset, canvasWpx, canvasHpx, touchPad)) {
                                    currentOnSelect(b.id)
                                    return@detectDragGestures
                                }
                            }
                            currentOnSelect("")
                        },
                        onDrag = { change, amount ->
                            change.consume()
                            // 添加端点模式：拖动红点 → 实时更新位置与距离（左/右都支持）
                            if (currentEndpointMode && draggingPoint != null) {
                                currentOnDraftPoint(
                                    (change.position.x / canvasWpx).coerceIn(0f, 1f),
                                    draggingPoint!!,
                                )
                                return@detectDragGestures
                            }
                            val selId = currentSelected ?: return@detectDragGestures
                            val b = currentBlocks.firstOrNull { it.id == selId } ?: return@detectDragGestures
                            val selW = if (b is SegmentBlock) b.w * b.times else b.w
                            val rightX = (b.x + selW / 2f) * canvasWpx
                            val cy = b.y * canvasHpx
                            val draggingHandle = abs(change.position.x - rightX) < touchPad &&
                                abs(change.position.y - cy) < touchPad * 2
                            if (draggingHandle) {
                                val newW = if (b is SegmentBlock && b.times > 1) {
                                    // 拖总长右端 → 调整每段长度 w
                                    (change.position.x / canvasWpx - (b.x - b.w * b.times / 2f)) / b.times
                                } else {
                                    change.position.x / canvasWpx - b.x + b.w / 2f
                                }
                                currentOnResize(b.id, newW)
                            } else {
                                // 移动 + 磁吸：与同类型积木端点/圆心靠近时自动对齐
                                val moved = b.withPos(
                                    (b.x + amount.x / canvasWpx).coerceIn(0f, 1f),
                                    (b.y + amount.y / canvasHpx).coerceIn(0f, 1f),
                                )
                                val snapped = snapBlock(moved, currentBlocks, canvasWpx, canvasHpx, touchPad)
                                currentOnMoveTo(b.id, snapped.x, snapped.y)
                            }
                        },
                        onDragEnd = {
                            draggingPoint = null
                            if (moveBefore.isNotEmpty()) {
                                currentOnMoveEnd(moveBefore)
                                moveBefore = emptyList()
                            }
                        },
                    )
                },
        ) {
            // 空白提示
            if (currentBlocks.isEmpty()) {
                val hintLayout = textMeasurer.measure(
                    "点下方积木开始搭图，拖动手柄可调节长短",
                    TextStyle(fontSize = 12.sp, color = Color(0xFF9E9E9E)),
                )
                drawText(
                    textLayoutResult = hintLayout,
                    topLeft = Offset(
                        (size.width - hintLayout.size.width) / 2,
                        (size.height - hintLayout.size.height) / 2,
                    ),
                    color = Color(0xFF9E9E9E),
                )
            }

            // 绘制所有积木
            currentBlocks.forEach { b ->
                drawBlock(b, textMeasurer, canvasWpx, canvasHpx, selected = b.id == currentSelected)
            }

            // 添加端点模式：左右端红点 + 拖动中的红点与实时距离
            if (currentEndpointMode) {
                val seg = currentSelected?.let { id -> currentBlocks.firstOrNull { it.id == id } as? SegmentBlock }
                if (seg != null) {
                    val v = seg.value.toFloatOrNull()
                    val mainW = if (seg.times > 1) seg.w * seg.times else seg.w
                    val leftX = (seg.x - mainW / 2f) * canvasWpx
                    val rightX = (seg.x + mainW / 2f) * canvasWpx
                    val cy = seg.y * canvasHpx
                    val dotR = 7.dp.toPx()
                    val draftX = currentDraftPoint?.let { it * canvasWpx }
                    val leftPointX = if (!currentDraftFromRight) draftX ?: leftX else leftX
                    val rightPointX = if (currentDraftFromRight) draftX ?: rightX else rightX
                    drawCircle(Color(0xFFC62828), dotR, Offset(leftPointX, cy))
                    drawCircle(Color(0xFFC62828), dotR, Offset(rightPointX, cy))
                    if (currentDraftPoint != null && v != null && v > 0f && mainW > 0f) {
                        val relX = ((currentDraftPoint!! - (seg.x - mainW / 2f)) / mainW).coerceIn(0f, 1f)
                        val pos = if (currentDraftFromRight) v * (1f - relX) else v * relX
                        val num = if (pos == pos.toLong().toFloat()) pos.toLong().toString() else pos.toString()
                        val distText = "距${if (currentDraftFromRight) "右" else "左"}端 $num${seg.unit.trim()}"
                        val layout = textMeasurer.measure(
                            distText,
                            TextStyle(fontSize = 12.sp, color = Color(0xFFC62828)),
                        )
                        drawText(
                            layout,
                            topLeft = Offset(
                                (draftX!! - layout.size.width / 2).coerceIn(0f, (size.width - layout.size.width).coerceAtLeast(0f)),
                                (cy - 12.dp.toPx() - layout.size.height).coerceAtLeast(0f),
                            ),
                            color = Color(0xFFC62828),
                        )
                    } else {
                        val hintLayout = textMeasurer.measure(
                            "按住左/右端红点拖出，实时显示距离；点确定保存",
                            TextStyle(fontSize = 11.sp, color = Color(0xFF9E9E9E)),
                        )
                        drawText(
                            hintLayout,
                            topLeft = Offset(
                                (size.width - hintLayout.size.width) / 2,
                                (cy + 24.dp.toPx()).coerceAtMost((size.height - hintLayout.size.height).coerceAtLeast(0f)),
                            ),
                            color = Color(0xFF9E9E9E),
                        )
                    }
                }
            }

            // 选中框 + 手柄 + 删除按钮（端点模式下隐藏删除按钮，避免遮挡红点）
            val sel = currentSelected?.let { id -> currentBlocks.firstOrNull { it.id == id } }
            if (sel != null) {
                val rect = blockRect(sel, canvasWpx, canvasHpx, touchPad)
                val dash = PathEffect.dashPathEffect(floatArrayOf(12f, 8f))
                drawRect(
                    color = Color(0xFF1976D2),
                    topLeft = rect.topLeft,
                    size = rect.size,
                    style = Stroke(width = 1.5.dp.toPx(), pathEffect = dash),
                )
                // 右端手柄（调长短）
                val handleR = 9.dp.toPx()
                drawCircle(Color(0xFF1976D2), handleR, Offset(rect.right, rect.center.y))
                drawCircle(Color.White, handleR * 0.55f, Offset(rect.right, rect.center.y))
                // 删除按钮（右上角）——端点模式隐藏
                if (!currentEndpointMode) {
                    val delR = 8.dp.toPx()
                    val delCenter = Offset(rect.right, rect.top)
                    drawCircle(Color(0xFFC62828), delR, delCenter)
                    val cross = 5.dp.toPx()
                    drawLine(Color.White, delCenter - Offset(cross, cross), delCenter + Offset(cross, cross), 1.5.dp.toPx())
                    drawLine(Color.White, delCenter - Offset(-cross, cross), delCenter + Offset(-cross, cross), 1.5.dp.toPx())
                }
            }
        }

        // 删除按钮点击（独立热区，右上角；端点模式下隐藏避免遮挡红点）
        val selDel = currentSelected?.let { id -> currentBlocks.firstOrNull { it.id == id } }
        if (selDel != null && !currentEndpointMode) {
            val rect = blockRect(selDel, canvasWpx, canvasHpx, touchPad)
            Box(
                Modifier
                    .offset { IntOffset(rect.right.toInt() - 12.dp.roundToPx(), rect.top.toInt() - 12.dp.roundToPx()) }
                    .size(24.dp)
                    .pointerInput(selDel.id) {
                        detectTapGestures(onTap = { currentOnDelete(selDel.id) })
                    },
            )
        }
    }
}

// ── 命中检测 / 矩形 ──

private fun hitTest(b: BuilderBlock, p: Offset, w: Float, h: Float, touchPad: Float): Boolean {
    val rect = blockRect(b, w, h, touchPad)
    if (b is NodeCircleBlock) {
        val center = Offset(b.x * w, b.y * h)
        return (p - center).getDistance() <= rect.width / 2 + touchPad
    }
    return rect.inflate(touchPad).contains(p)
}

private fun blockRect(b: BuilderBlock, w: Float, h: Float, touchPad: Float): Rect {
    val cx = b.x * w
    val cy = b.y * h
    val totalW = if (b is SegmentBlock) {
        var tw = if (b.times > 1) b.w * b.times else b.w
        // 增加段计入总宽（主段 × extra/value，同单位）
        val v = b.value.toFloatOrNull()
        if (b.extra > 0f && v != null && v > 0f) tw = tw + tw * (b.extra / v)
        tw
    } else {
        b.w
    }
    val bw = (totalW * w).coerceAtLeast(40f)
    val bh = if (b is NodeCircleBlock) bw else 40f
    return Rect(Offset(cx - bw / 2, cy - bh / 2), Size(bw, bh))
}

// ── 绘制 ──

private fun blockColor(name: String): Color = when (name.trim().lowercase()) {
    "red" -> Color(0xFFC62828)
    "green" -> Color(0xFF2E7D32)
    "black" -> Color(0xFF1A1A1A)
    else -> Color(0xFF1976D2) // blue 默认
}

/** 增加段（延长）固定色：绿色 */
private val EXTRA_COLOR = Color(0xFF2E7D32)

/** 平均分余数段固定色：橙色 */
private val REMAINDER_COLOR = Color(0xFFE65100)

private fun fmtSegmentValue(v: Float, unit: String): String {
    val num = if (v == v.toLong().toFloat()) v.toLong().toString() else v.toString()
    return "$num${unit.trim()}"
}

private val smallLabelStyle = TextStyle(fontSize = 11.sp, textAlign = TextAlign.Center)

private fun DrawScope.drawBlock(
    b: BuilderBlock,
    textMeasurer: TextMeasurer,
    w: Float,
    h: Float,
    selected: Boolean,
) {
    when (b) {
        is SegmentBlock -> drawSegmentBlock(b, textMeasurer)
        is ValueLabelBlock -> drawCenteredText(b.text, b.x * w, b.y * h, blockColor(b.color), textMeasurer)
        is NodeCircleBlock -> drawNodeCircle(b, w, h, textMeasurer)
        is TextBlock -> drawCenteredText(b.text, b.x * w, b.y * h, blockColor(b.color), textMeasurer)
        is PersonBlock -> drawPersonBlock(b, w, h, textMeasurer)
        is BraceBlock -> drawBraceBlock(b, w, h, textMeasurer)
        is DynamicBlock -> drawDynamicBlock(b, textMeasurer)
    }
}

/** 小人绘制：圆头 + 身体 + 胳膊腿，名字在下方 */
private fun DrawScope.drawPersonBlock(b: PersonBlock, w: Float, h: Float, tm: TextMeasurer) {
    val cx = b.x * w
    val cy = b.y * h
    val color = blockColor(b.color)
    val stroke = 2.dp.toPx()
    val unit = ((b.w * w) / 6f).coerceIn(6.dp.toPx(), 14.dp.toPx()) // 身体单元
    val headR = unit * 0.9f
    val headCy = cy - unit * 1.6f
    // 头
    drawCircle(color, headR, Offset(cx, headCy), style = Stroke(width = stroke))
    // 身体
    drawLine(color, Offset(cx, headCy + headR), Offset(cx, cy - unit * 0.4f), stroke)
    // 胳膊
    drawLine(color, Offset(cx, cy - unit), Offset(cx - unit * 1.2f, cy - unit * 1.6f), stroke)
    drawLine(color, Offset(cx, cy - unit), Offset(cx + unit * 1.2f, cy - unit * 1.6f), stroke)
    // 腿
    drawLine(color, Offset(cx, cy - unit * 0.4f), Offset(cx - unit * 0.9f, cy + unit * 1.2f), stroke)
    drawLine(color, Offset(cx, cy - unit * 0.4f), Offset(cx + unit * 0.9f, cy + unit * 1.2f), stroke)
    // 名字
    if (b.name.isNotBlank()) {
        val layout = tm.measure(b.name, style = smallLabelStyle)
        drawText(
            layout,
            topLeft = Offset(
                (cx - layout.size.width / 2).coerceIn(0f, (size.width - layout.size.width).coerceAtLeast(0f)),
                (cy + unit * 1.4f).coerceAtMost((size.height - layout.size.height).coerceAtLeast(0f)),
            ),
            color = Color(0xFF1A1A1A),
        )
    }
}

private fun DrawScope.drawSegmentBlock(b: SegmentBlock, tm: TextMeasurer) {
    val cy = b.y * size.height
    val x0 = (b.x - b.w / 2) * size.width
    val x1 = (b.x + b.w / 2) * size.width
    val color = blockColor(b.color)
    val stroke = 2.5.dp.toPx()
    val unknown = b.value.isBlank()
    // 未知量：红色虚线 + 中间"？"
    val effectiveColor = if (unknown) Color(0xFFC62828) else color
    val effect = if (unknown || b.dashed) PathEffect.dashPathEffect(floatArrayOf(10f, 7f)) else null
    val tick = 6.dp.toPx()
    // 增加段（绿色虚线延长段）：宽度 = 主段 × extra/value（同单位）；方向向左/向右
    val extraW = if (b.extra > 0f) {
        val v = b.value.toFloatOrNull()
        if (v != null && v > 0f) (x1 - x0) * (b.extra / v) else 0f
    } else 0f
    val extraEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 5f))
    fun drawExtraSegment(segStart: Float, segEnd: Float) {
        if (extraW <= 0f) return
        drawLine(EXTRA_COLOR, Offset(segStart, cy), Offset(segEnd, cy), stroke, pathEffect = extraEffect)
        drawLine(EXTRA_COLOR, Offset(segStart, cy - tick), Offset(segStart, cy + tick), stroke)
        drawLine(EXTRA_COLOR, Offset(segEnd, cy - tick), Offset(segEnd, cy + tick), stroke)
    }
    if (b.times > 1) {
        // 放大倍数：复制 N 段等长拼接成更长的线段（总长 = 原长 × N，段间微缝）
        val n = b.times.coerceAtLeast(2)
        val gap = 1.dp.toPx()
        val segW = b.w * size.width
        val startX = b.x * size.width - (n * segW + (n - 1) * gap) / 2 // 整体以 x 为中心
        for (i in 0 until n) {
            val sx = startX + i * (segW + gap)
            drawLine(effectiveColor, Offset(sx, cy), Offset(sx + segW, cy), stroke, pathEffect = effect)
            drawLine(effectiveColor, Offset(sx, cy - tick), Offset(sx, cy + tick), stroke)
            drawLine(effectiveColor, Offset(sx + segW, cy - tick), Offset(sx + segW, cy + tick), stroke)
        }
        // 绿色增加段接在拼接段两端（按方向）
        if (extraW > 0f) {
            val rightEnd = startX + n * segW + (n - 1) * gap
            if (b.extraDir == "left") {
                drawExtraSegment(startX - extraW, startX)
            } else {
                drawExtraSegment(rightEnd, rightEnd + extraW)
            }
        }
    } else {
        // 单条线段
        drawLine(effectiveColor, Offset(x0, cy), Offset(x1, cy), stroke, pathEffect = effect)
        // 两端短竖线（课本样式）
        drawLine(effectiveColor, Offset(x0, cy - tick), Offset(x0, cy + tick), stroke)
        drawLine(effectiveColor, Offset(x1, cy - tick), Offset(x1, cy + tick), stroke)
        // 平均切割：总量不变。有余数时（如 25 分 3 段 = 8/8/8 + 余 1）：
        // 商段等长，余数段用橙色表示
        if (b.segments > 1) {
            val v = b.value.toFloatOrNull()
            if (v != null && v > 0f) {
                // 整数用整数除法算商/余（避免浮点误差）；小数按比例
                val vInt = v.toLong()
                val isInt = v == vInt.toFloat()
                val segLen = if (isInt) (vInt / b.segments).toFloat() else v / b.segments
                val rem = if (isInt) (vInt % b.segments).toFloat() else v - segLen * b.segments
                if (rem > 0.001f) {
                    // 商段 ×N（等长按比例）
                    for (i in 0 until b.segments) {
                        val sx = x0 + (x1 - x0) * (segLen * i) / v
                        val ex = x0 + (x1 - x0) * (segLen * (i + 1)) / v
                        drawLine(effectiveColor, Offset(sx, cy), Offset(ex, cy), stroke, pathEffect = effect)
                        drawLine(effectiveColor, Offset(sx, cy - tick), Offset(sx, cy + tick), stroke)
                        drawLine(effectiveColor, Offset(ex, cy - tick), Offset(ex, cy + tick), stroke)
                    }
                    // 余数段（橙色）
                    val rx = x0 + (x1 - x0) * (segLen * b.segments) / v
                    drawLine(REMAINDER_COLOR, Offset(rx, cy), Offset(x1, cy), stroke)
                    drawLine(REMAINDER_COLOR, Offset(rx, cy - tick), Offset(rx, cy + tick), stroke)
                    drawLine(REMAINDER_COLOR, Offset(x1, cy - tick), Offset(x1, cy + tick), stroke)

                    // 每段下方显示数量（商段各显示每份值，余数段显示余数）
                    val segText = fmtSegmentValue(segLen, b.unit)
                    val remText = fmtSegmentValue(rem, b.unit)
                    val segLayoutH = tm.measure(segText, smallLabelStyle).size.height
                    for (i in 0 until b.segments) {
                        val segMidX = x0 + (x1 - x0) * (segLen * (i + 0.5f)) / v
                        drawCenteredText(segText, segMidX, cy + tick + 4.dp.toPx(), effectiveColor, tm)
                    }
                    val remMidX = x0 + (x1 - x0) * (segLen * b.segments + rem / 2f) / v
                    drawCenteredText(remText, remMidX, cy + tick + 4.dp.toPx(), REMAINDER_COLOR, tm)

                    // 两端向下大括号 + 尖下总数量（避免与子段数量重叠）
                    val totalText = if (unknown) "？" else "${b.value}${b.unit}"
                    val span = (x1 - x0).coerceAtLeast(40.dp.toPx())
                    val cxMid = (x0 + x1) / 2
                    val braceTop = cy + tick + 4.dp.toPx() + segLayoutH + 3.dp.toPx()
                    val depth = 14.dp.toPx()
                    val braceColor = Color(0xFF1A1A1A)
                    val path = Path()
                    path.moveTo(x0, braceTop)
                    path.quadraticBezierTo(x0, braceTop + depth * 0.4f, cxMid - span * 0.18f, braceTop + depth * 0.75f)
                    path.lineTo(cxMid, braceTop + depth) // 尖
                    path.lineTo(cxMid + span * 0.18f, braceTop + depth * 0.75f)
                    path.quadraticBezierTo(x1, braceTop + depth * 0.4f, x1, braceTop)
                    drawPath(path, braceColor, style = Stroke(width = 2.dp.toPx()))
                    val totalLayout = tm.measure(totalText, style = smallLabelStyle.copy(color = braceColor, fontSize = 12.sp))
                    drawText(
                        totalLayout,
                        topLeft = Offset(
                            (cxMid - totalLayout.size.width / 2).coerceIn(0f, (size.width - totalLayout.size.width).coerceAtLeast(0f)),
                            (braceTop + depth + 2.dp.toPx()).coerceAtMost((size.height - totalLayout.size.height).coerceAtLeast(0f)),
                        ),
                        color = braceColor,
                    )
                } else {
                    // 无余数：等分切割竖线
                    val cut = 4.dp.toPx()
                    for (i in 1 until b.segments) {
                        val sx = x0 + (x1 - x0) * i / b.segments
                        drawLine(effectiveColor, Offset(sx, cy - cut), Offset(sx, cy + cut), stroke)
                    }
                }
            } else {
                // 无数值：等分切割竖线
                val cut = 4.dp.toPx()
                for (i in 1 until b.segments) {
                    val sx = x0 + (x1 - x0) * i / b.segments
                    drawLine(effectiveColor, Offset(sx, cy - cut), Offset(sx, cy + cut), stroke)
                }
            }
        }
        // 绿色增加段按方向接在左端或右端
        if (b.extraDir == "left") {
            drawExtraSegment(x0 - extraW, x0)
        } else {
            drawExtraSegment(x1, x1 + extraW)
        }
    }
    // 中间端点（多红点 + 名称）+ 每小段数量标注
    val midValue = b.value.toFloatOrNull()
    if (b.midPoints.isNotEmpty() && midValue != null && midValue > 0f) {
        val mainWidth = if (b.times > 1) b.w * b.times * size.width else (x1 - x0)
        val pts = b.midPoints.mapNotNull { p ->
            p.pos.toFloatOrNull()?.let { it to p }
        }.filter { it.first > 0f }.sortedBy { it.first }
        val dotR = 4.dp.toPx()
        val midColor = Color(0xFFC62828)
        for ((pos, p) in pts) {
            val mx = x0 + (pos / midValue).coerceIn(0f, 1f) * mainWidth
            drawCircle(midColor, dotR, Offset(mx, cy))
            if (p.label.isNotBlank()) {
                val ml = tm.measure(p.label, style = smallLabelStyle.copy(color = midColor, fontSize = 10.sp))
                drawText(
                    ml,
                    topLeft = Offset(
                        (mx - ml.size.width / 2).coerceIn(0f, (size.width - ml.size.width).coerceAtLeast(0f)),
                        (cy - tick - 4.dp.toPx() - ml.size.height - 4.dp.toPx()).coerceAtLeast(0f),
                    ),
                    color = midColor,
                )
            }
        }
        // 每小段数量：段边界 [0, p1, p2, …, value]，差值标在段中点下方
        val bounds = listOf(0f) + pts.map { it.first } + listOf(midValue)
        for (i in 0 until bounds.size - 1) {
            val segVal = bounds[i + 1] - bounds[i]
            if (segVal <= 0f) continue
            val segMidX = x0 + ((bounds[i] + segVal / 2f) / midValue).coerceIn(0f, 1f) * mainWidth
            val segText = fmtSegmentValue(segVal, b.unit)
            val sl = tm.measure(segText, style = smallLabelStyle.copy(color = Color(0xFF546E7A)))
            drawText(
                sl,
                topLeft = Offset(
                    (segMidX - sl.size.width / 2).coerceIn(0f, (size.width - sl.size.width).coerceAtLeast(0f)),
                    (cy + tick + 4.dp.toPx()).coerceAtMost((size.height - sl.size.height).coerceAtLeast(0f)),
                ),
                color = Color(0xFF546E7A),
            )
        }
    }
    // 标签：名称上方、数值下方
    val nameLayout = tm.measure(b.label, style = smallLabelStyle.copy(color = Color(0xFF1A1A1A)))
    drawText(
        nameLayout,
        topLeft = Offset(
            (b.x * size.width - nameLayout.size.width / 2).coerceIn(0f, (size.width - nameLayout.size.width).coerceAtLeast(0f)),
            (cy - tick - 4.dp.toPx() - nameLayout.size.height).coerceAtLeast(0f),
        ),
        color = Color(0xFF1A1A1A),
    )
    val valueText = if (unknown) "？" else "${b.value}${b.unit}"
    // 无中间端点：总数量直接显示在线段中间下方
    if (valueText.isNotBlank() && b.midPoints.isEmpty()) {
        val valLayout = tm.measure(valueText, style = smallLabelStyle.copy(color = effectiveColor))
        drawText(
            valLayout,
            topLeft = Offset(
                (b.x * size.width - valLayout.size.width / 2).coerceIn(0f, (size.width - valLayout.size.width).coerceAtLeast(0f)),
                (cy + tick + 4.dp.toPx()).coerceAtMost((size.height - valLayout.size.height).coerceAtLeast(0f)),
            ),
            color = effectiveColor,
        )
    }
    // 左/右端点名称（实际两端 = 拼接/延长后的端点）
    val actualLeft: Float
    val actualRight: Float
    if (b.times > 1) {
        val n = b.times.coerceAtLeast(2)
        val gap = 1.dp.toPx()
        val segW = b.w * size.width
        val startX = b.x * size.width - (n * segW + (n - 1) * gap) / 2
        val rightEnd = startX + n * segW + (n - 1) * gap
        actualLeft = startX - if (b.extraDir == "left") extraW else 0f
        actualRight = rightEnd + if (b.extraDir == "right") extraW else 0f
    } else {
        actualLeft = x0 - if (b.extraDir == "left") extraW else 0f
        actualRight = x1 + if (b.extraDir == "right") extraW else 0f
    }
    val endLabelY = (cy - tick - 4.dp.toPx() - nameLayout.size.height).coerceAtLeast(0f)

    // 有中间端点（子线段）时：总数量用向下开口的大括号表示（两端 → 尖朝下，尖上写总数量），
    // 与子线段下方的分段数量错开不重叠
    if (valueText.isNotBlank() && b.midPoints.isNotEmpty() && !unknown) {
        val span = (actualRight - actualLeft).coerceAtLeast(40.dp.toPx())
        val cxMid = (actualLeft + actualRight) / 2
        val subSample = tm.measure("88${b.unit}", smallLabelStyle)
        val braceTop = cy + tick + 4.dp.toPx() + subSample.size.height + 3.dp.toPx()
        val depth = 14.dp.toPx()
        val braceColor = Color(0xFF1A1A1A)
        val path = Path()
        path.moveTo(actualLeft, braceTop)
        path.quadraticBezierTo(actualLeft, braceTop + depth * 0.4f, cxMid - span * 0.18f, braceTop + depth * 0.75f)
        path.lineTo(cxMid, braceTop + depth) // 尖
        path.lineTo(cxMid + span * 0.18f, braceTop + depth * 0.75f)
        path.quadraticBezierTo(actualRight, braceTop + depth * 0.4f, actualRight, braceTop)
        drawPath(path, braceColor, style = Stroke(width = 2.dp.toPx()))
        val totalLayout = tm.measure(valueText, style = smallLabelStyle.copy(color = braceColor, fontSize = 12.sp))
        drawText(
            totalLayout,
            topLeft = Offset(
                (cxMid - totalLayout.size.width / 2).coerceIn(0f, (size.width - totalLayout.size.width).coerceAtLeast(0f)),
                (braceTop + depth + 2.dp.toPx()).coerceAtMost((size.height - totalLayout.size.height).coerceAtLeast(0f)),
            ),
            color = braceColor,
        )
    }
    if (b.leftLabel.isNotBlank()) {
        val ll = tm.measure(b.leftLabel, style = smallLabelStyle.copy(color = Color(0xFF1A1A1A)))
        drawText(
            ll,
            topLeft = Offset(
                (actualLeft - ll.size.width / 2).coerceIn(0f, (size.width - ll.size.width).coerceAtLeast(0f)),
                endLabelY,
            ),
            color = Color(0xFF1A1A1A),
        )
    }
    if (b.rightLabel.isNotBlank()) {
        val rl = tm.measure(b.rightLabel, style = smallLabelStyle.copy(color = Color(0xFF1A1A1A)))
        drawText(
            rl,
            topLeft = Offset(
                (actualRight - rl.size.width / 2).coerceIn(0f, (size.width - rl.size.width).coerceAtLeast(0f)),
                endLabelY,
            ),
            color = Color(0xFF1A1A1A),
        )
    }
}

private fun DrawScope.drawCenteredText(text: String, cx: Float, cy: Float, color: Color, tm: TextMeasurer) {
    if (text.isBlank()) return
    val layout = tm.measure(text, style = smallLabelStyle.copy(color = color, fontSize = 13.sp))
    drawText(
        layout,
        topLeft = Offset(
            (cx - layout.size.width / 2).coerceIn(0f, (size.width - layout.size.width).coerceAtLeast(0f)),
            (cy - layout.size.height / 2).coerceIn(0f, (size.height - layout.size.height).coerceAtLeast(0f)),
        ),
        color = color,
    )
}

private fun DrawScope.drawNodeCircle(b: NodeCircleBlock, w: Float, h: Float, tm: TextMeasurer) {
    val cx = b.x * w
    val cy = b.y * h
    val radius = ((b.w * w) / 2).coerceIn(14.dp.toPx(), 40.dp.toPx())
    val color = blockColor(b.color)
    val stroke = 2.dp.toPx()
    if (b.unknown) {
        // 未知量：虚线圆（drawArc 分 8 段）
        val seg = 45f
        for (i in 0 until 8) {
            drawArc(
                color = color,
                startAngle = i * seg,
                sweepAngle = seg - 10f,
                useCenter = false,
                topLeft = Offset(cx - radius, cy - radius),
                size = Size(radius * 2, radius * 2),
                style = Stroke(width = stroke),
            )
        }
    } else {
        drawCircle(color, radius, Offset(cx, cy), style = Stroke(width = stroke))
    }
    if (b.name.isNotBlank()) {
        val layout = tm.measure(b.name, style = smallLabelStyle)
        drawText(
            layout,
            topLeft = Offset(
                (cx - layout.size.width / 2).coerceIn(0f, (size.width - layout.size.width).coerceAtLeast(0f)),
                (cy - radius - 4.dp.toPx() - layout.size.height).coerceAtLeast(0f),
            ),
            color = Color(0xFF1A1A1A),
        )
    }
}

private fun DrawScope.drawBraceBlock(b: BraceBlock, w: Float, h: Float, tm: TextMeasurer) {
    val cx = b.x * w
    val cy = b.y * h
    val span = (b.w * w).coerceAtLeast(30.dp.toPx()) // 跨度（可调节长短）
    val depth = 18.dp.toPx() // 开口深度
    val color = blockColor(b.color)
    val stroke = 2.dp.toPx()
    val path = Path()
    when (b.direction) {
        "up" -> { // 开口向上：尖角在下方
            val x0 = cx - span / 2; val x1 = cx + span / 2
            path.moveTo(x0, cy - depth * 0.4f)
            path.quadraticBezierTo(x0, cy, cx - span * 0.15f, cy)
            path.lineTo(cx, cy + depth) // 尖角
            path.lineTo(cx + span * 0.15f, cy)
            path.quadraticBezierTo(x1, cy, x1, cy - depth * 0.4f)
        }
        "left" -> { // 开口向左：尖角在右侧
            val y0 = cy - span / 2; val y1 = cy + span / 2
            path.moveTo(cx - depth * 0.4f, y0)
            path.quadraticBezierTo(cx, y0, cx, cy - span * 0.15f)
            path.lineTo(cx + depth, cy) // 尖角
            path.lineTo(cx, cy + span * 0.15f)
            path.quadraticBezierTo(cx, y1, cx - depth * 0.4f, y1)
        }
        "right" -> { // 开口向右：尖角在左侧
            val y0 = cy - span / 2; val y1 = cy + span / 2
            path.moveTo(cx + depth * 0.4f, y0)
            path.quadraticBezierTo(cx, y0, cx, cy - span * 0.15f)
            path.lineTo(cx - depth, cy) // 尖角
            path.lineTo(cx, cy + span * 0.15f)
            path.quadraticBezierTo(cx, y1, cx + depth * 0.4f, y1)
        }
        else -> { // down：开口向下，尖角在上方
            val x0 = cx - span / 2; val x1 = cx + span / 2
            path.moveTo(x0, cy + depth * 0.4f)
            path.quadraticBezierTo(x0, cy, cx - span * 0.15f, cy)
            path.lineTo(cx, cy - depth) // 尖角
            path.lineTo(cx + span * 0.15f, cy)
            path.quadraticBezierTo(x1, cy, x1, cy + depth * 0.4f)
        }
    }
    drawPath(path, color, style = Stroke(width = stroke))
    // 标注文字在尖角方向一侧
    if (b.label.isNotBlank()) {
        val layout = tm.measure(b.label, style = smallLabelStyle)
        val labelY = when (b.direction) {
            "up" -> (cy + depth + 4.dp.toPx()).coerceAtMost((size.height - layout.size.height).coerceAtLeast(0f))
            "left" -> cy - layout.size.height / 2
            "right" -> cy - layout.size.height / 2
            else -> (cy - depth - 4.dp.toPx() - layout.size.height).coerceAtLeast(0f)
        }
        drawText(
            layout,
            topLeft = Offset(
                (cx - layout.size.width / 2).coerceIn(0f, (size.width - layout.size.width).coerceAtLeast(0f)),
                labelY,
            ),
            color = Color(0xFF1A1A1A),
        )
    }
}

private fun DrawScope.drawDynamicBlock(b: DynamicBlock, tm: TextMeasurer) {
    val color = blockColor(b.defaultColor)
    val cy = b.y * size.height
    val x0 = (b.x - b.w / 2) * size.width
    val x1 = (b.x + b.w / 2) * size.width
    val stroke = 2.5.dp.toPx()
    when (b.type) {
        "multi-segment" -> {
            // 倍数条/均分条：分 N 段等长，段间小空隙
            val segCount = b.segments
            val gap = 2.dp.toPx()
            val segW = ((x1 - x0) - gap * (segCount - 1)) / segCount
            for (i in 0 until segCount) {
                val sx = x0 + i * (segW + gap)
                drawLine(color, Offset(sx, cy), Offset(sx + segW, cy), stroke)
                val tick = 5.dp.toPx()
                drawLine(color, Offset(sx, cy - tick), Offset(sx, cy + tick), stroke)
                drawLine(color, Offset(sx + segW, cy - tick), Offset(sx + segW, cy + tick), stroke)
            }
            if (b.name.isNotBlank()) {
                val layout = tm.measure(b.name, style = smallLabelStyle)
                drawText(
                    layout,
                    topLeft = Offset(
                        (b.x * size.width - layout.size.width / 2).coerceIn(0f, (size.width - layout.size.width).coerceAtLeast(0f)),
                        (cy - 6.dp.toPx() - layout.size.height).coerceAtLeast(0f),
                    ),
                    color = Color(0xFF1A1A1A),
                )
            }
        }
        "rect" -> {
            val h = 36.dp.toPx()
            drawRect(color, Offset(x0, cy - h / 2), Size(x1 - x0, h), style = Stroke(width = stroke))
            drawCenteredText(b.name, b.x * size.width, cy, Color(0xFF1A1A1A), tm)
        }
        "circle" -> {
            val r = ((b.w * size.width) / 2).coerceIn(16.dp.toPx(), 40.dp.toPx())
            drawCircle(color, r, Offset(b.x * size.width, cy), style = Stroke(width = stroke))
            drawCenteredText(b.name, b.x * size.width, cy, Color(0xFF1A1A1A), tm)
        }
        "text" -> drawCenteredText(b.name, b.x * size.width, cy, color, tm)
        "brace" -> {
            val brace = BraceBlock(id = b.id, x = b.x, y = b.y, w = b.w, direction = "down", label = b.name, color = b.defaultColor)
            drawBraceBlock(brace, size.width, size.height, tm)
        }
        else -> { // line 及未知：一条线 + 名字
            drawLine(color, Offset(x0, cy), Offset(x1, cy), stroke)
            if (b.name.isNotBlank()) {
                drawCenteredText(b.name, b.x * size.width, (cy - 8.dp.toPx()).coerceAtLeast(0f), Color(0xFF1A1A1A), tm)
            }
        }
    }
}
