package com.example.ai.ui.aihomework

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import com.example.ai.data.aihomework.QuantityItem
import com.example.ai.data.aihomework.QuantityRelation
import kotlin.math.hypot

// ── 颜色（与线段图一致） ──
private val NodeKnown = Color(0xFF1565C0)        // 已知量：深蓝
private val NodeUnknown = Color(0xFF546E7A)      // 未知量：蓝灰虚线
private val EdgeMore = Color(0xFFC62828)         // 多出：红
private val EdgeLess = Color(0xFF1B5E20)         // 还差：绿
private val EdgeTimes = Color(0xFF4A148C)        // 倍数：紫
private val EdgeTotal = Color(0xFFE65100)        // 一共：橙
private val LabelDark = Color(0xFF1A1A1A)
private val LegendColor = Color(0xFF263238)
private val ResetBlue = Color(0xFF1565C0)

/**
 * 圆圈关系图：每个数量一个圆圈（已知实线/未知虚线），有关系就画有向连线——
 * 箭头从"基准"指向"关系主体（结果方）"：牛奶是牛角包的2倍 → 箭头指向牛奶；
 * 一共 = 分量之和 → 分量箭头汇入"一共"。线上标运算规则（×2、+3、-5、+）。
 * 名称写在圆圈内（上方），数值/？写在圆内下方。不依赖数值比例（抗脏数据）。
 * **可交互**：手指按住圆圈可拖动，理顺纠缠的连线；画布高度随拖动扩展；"↺ 复原"回到自动布局。
 */

/** 自动网格布局：第 i 个节点在每行内均分居中（最后一行不满也居中），y 用固定行高（不随画布高度漂移） */
private fun gridPos(i: Int, n: Int, cols: Int, w: Float, rowHeightPx: Float): Offset {
    val row = i / cols
    val colInRow = i % cols
    val m = minOf(cols, n - row * cols)  // 该行实际节点数
    return Offset((colInRow + 0.5f) * w / m, row * rowHeightPx + rowHeightPx / 2)
}

@Composable
fun RelationGraph(
    quantities: List<QuantityItem>,
    relations: List<QuantityRelation>,
    modifier: Modifier = Modifier,
    highlightNames: Set<String>? = null,  // 高亮子图：非空时只突出这些实体及其连线（如选中的问题 target+needs），其余变淡
) {
    if (quantities.isEmpty()) return
    // 名称匹配（与 findItem 一致：双向包含，容忍「足球」vs「足球个数」）
    fun matched(name: String): Boolean =
        highlightNames == null || highlightNames.any { it == name || it.contains(name) || name.contains(it) }
    val textMeasurer = rememberTextMeasurer()
    val nameStyle = MaterialTheme.typography.bodySmall
    val relStyle = MaterialTheme.typography.bodySmall
    val density = LocalDensity.current

    // 布局参数：节点 ≤4 单行，否则分多行网格（每行最多 4 个）
    val n = quantities.size
    val cols = when {
        n <= 4 -> n
        n <= 8 -> 4
        else -> 5
    }
    val rows = (n + cols - 1) / cols
    val radiusDp = if (n > 4) 28.dp else 40.dp
    val rowHeightDp = radiusDp * 2 + 12.dp
    val radiusPx = with(density) { radiusDp.toPx() }
    val rowHeightPx = with(density) { rowHeightDp.toPx() }
    val gridHeightPx = rowHeightPx * rows
    val touchSlopPx = with(density) { 12.dp.toPx() }

    // 拖拽状态：被拖过的节点存用户位置；未拖过的用自动网格布局
    val nodePositions = remember { mutableStateMapOf<String, Offset>() }
    var draggedName by remember { mutableStateOf<String?>(null) }

    // 画布高度 = max(自动布局高度, 被拖节点最低点 + 余量)，随拖动扩展保证不裁剪
    val maxDragY = nodePositions.values.maxOfOrNull { it.y } ?: 0f
    val canvasHeightPx = maxOf(
        gridHeightPx,
        maxDragY + radiusPx + with(density) { 48.dp.toPx() },
    )
    val canvasHeightDp = with(density) { canvasHeightPx.toDp() }

    Column(modifier = modifier.fillMaxWidth()) {
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(canvasHeightDp)
                .pointerInput(quantities, relations) {
                    // PointerInputScope 的 size 只能在块内访问，回调闭包需先捕获
                    val pointerW = size.width.toFloat()
                    detectDragGestures(
                        onDragStart = { offset ->
                            // 命中检测：手指落在哪个节点圆内（含容差）
                            draggedName = quantities.firstOrNull { q ->
                                val i = quantities.indexOf(q)
                                val base = nodePositions[q.name]
                                    ?: gridPos(i, n, cols, pointerW, rowHeightPx)
                                hypot(base.x - offset.x, base.y - offset.y) < radiusPx + touchSlopPx
                            }?.name
                        },
                        onDrag = { change, dragAmount ->
                            change.consume()
                            val name = draggedName ?: return@detectDragGestures
                            val cur = nodePositions[name] ?: run {
                                val i = quantities.indexOfFirst { it.name == name }
                                gridPos(i, n, cols, pointerW, rowHeightPx)
                            }
                            nodePositions[name] = Offset(
                                (cur.x + dragAmount.x).coerceIn(radiusPx, (pointerW - radiusPx).coerceAtLeast(radiusPx)),
                                (cur.y + dragAmount.y).coerceAtLeast(radiusPx),
                            )
                        },
                    )
                },
        ) {
            val w = size.width
            val radius = radiusPx
            // 节点位置：被拖过的用用户位置，其余用自动网格布局
            val centered = quantities.mapIndexed { i, q ->
                val p = nodePositions[q.name] ?: gridPos(i, n, cols, w, rowHeightPx)
                NodeInfo(name = q.name, known = q.value != null, x = p.x, y = p.y)
            }

            /** 从 from 圆边到 to 圆边画线，to 端画箭头（箭头指向关系主体 a） */
            fun drawRelationLine(
                from: NodeInfo,
                to: NodeInfo,
                color: Color,
                label: String,
                alpha: Float = 1f,
            ) {
                val dx = to.x - from.x
                val dy = to.y - from.y
                val len = hypot(dx, dy)
                if (len < 1f) return
                val ux = dx / len
                val uy = dy / len
                val start = Offset(from.x + ux * radius, from.y + uy * radius)  // b 圆边
                val end = Offset(to.x - ux * radius, to.y - uy * radius)        // a 圆边
                drawLine(
                    color = color,
                    start = start,
                    end = end,
                    strokeWidth = 2.dp.toPx(),
                )
                // 箭头（a 端，尖端指向 a 圆心）
                val arrowLen = 10.dp.toPx()
                val arrowHalf = 6.dp.toPx()
                val base = Offset(end.x - ux * arrowLen, end.y - uy * arrowLen)
                val left = Offset(base.x - uy * arrowHalf, base.y + ux * arrowHalf)
                val right = Offset(base.x + uy * arrowHalf, base.y - ux * arrowHalf)
                drawPath(
                    path = Path().apply {
                        moveTo(end.x, end.y)
                        lineTo(left.x, left.y)
                        lineTo(right.x, right.y)
                        close()
                    },
                    color = color,
                )
                // 线上标签（中点上方，白底圆角垫底）
                if (label.isNotEmpty()) {
                    val layout = textMeasurer.measure(label, style = relStyle)
                    val pad = 3.dp.toPx()
                    val labelTopLeft = Offset(
                        (start.x + end.x) / 2 - layout.size.width / 2,
                        (start.y + end.y) / 2 - layout.size.height - 8.dp.toPx(),
                    )
                    drawRoundRect(
                        color = Color.White.copy(alpha = 0.92f * alpha),
                        topLeft = Offset(labelTopLeft.x - pad, labelTopLeft.y - pad),
                        size = androidx.compose.ui.geometry.Size(
                            layout.size.width + pad * 2,
                            layout.size.height + pad * 2,
                        ),
                        cornerRadius = CornerRadius(4.dp.toPx(), 4.dp.toPx()),
                    )
                    drawText(
                        textLayoutResult = layout,
                        topLeft = labelTopLeft,
                        color = color,
                    )
                }
            }

            // 先画关系连线（在节点下方，节点圆会盖住线头）——普通关系：b → a（箭头指向 a）
            relations.forEach { r ->
                if (r.type == "total") return@forEach
                val aNode = centered.firstOrNull { it.name == r.a || it.name.contains(r.a) || r.a.contains(it.name) }
                val bNode = centered.firstOrNull { it.name == r.b || it.name.contains(r.b) || r.b.contains(it.name) }
                if (aNode != null && bNode != null) {
                    val color = when (r.type) {
                        "more" -> EdgeMore
                        "less" -> EdgeLess
                        "times" -> EdgeTimes
                        else -> EdgeTotal
                    }
                    val label = when (r.type) {
                        "more" -> "+${fmt(r.amount)}"
                        "less" -> "-${fmt(r.amount)}"
                        "times" -> "×${fmt(r.amount)}"
                        else -> ""
                    }
                    val alpha = if (highlightNames == null || (matched(r.a) && matched(r.b))) 1f else 0.18f
                    drawRelationLine(from = bNode, to = aNode, color = color.copy(alpha = alpha), label = label, alpha = alpha)
                }
            }
            // total 关系：各分量 → "一共" 箭头（表示合起来），线上标 "+"
            relations.forEach { r ->
                if (r.type != "total") return@forEach
                val totalNode = centered.firstOrNull { it.name == r.a || r.a.contains(it.name) || it.name.contains(r.a) }
                if (totalNode == null) return@forEach
                r.parts.forEach { pName ->
                    val pNode = centered.firstOrNull { it.name == pName || it.name.contains(pName) || pName.contains(it.name) }
                    if (pNode != null) {
                        val alpha = if (highlightNames == null || (matched(r.a) && matched(pName))) 1f else 0.18f
                        drawRelationLine(from = pNode, to = totalNode, color = EdgeTotal.copy(alpha = alpha), label = "+", alpha = alpha)
                    }
                }
            }

            // 画节点圆圈 + 名称（未知量虚线圆：分段 drawArc）；名称圆内上方、数值圆内下方
            centered.forEach { node ->
                val alpha = if (matched(node.name)) 1f else 0.22f
                if (node.known) {
                    drawCircle(
                        color = NodeKnown.copy(alpha = alpha),
                        radius = radius,
                        center = Offset(node.x, node.y),
                        style = Stroke(2.dp.toPx()),
                    )
                } else {
                    // 虚线圆：分 8 段弧，段间留空隙
                    val dashLen = 0.7f
                    val sweepStep = (360f / 8f)
                    repeat(8) { i ->
                        val start = i * sweepStep
                        drawArc(
                            color = NodeUnknown.copy(alpha = alpha),
                            startAngle = start,
                            sweepAngle = sweepStep * dashLen,
                            useCenter = false,
                            topLeft = Offset(node.x - radius, node.y - radius),
                            size = androidx.compose.ui.geometry.Size(radius * 2, radius * 2),
                            style = Stroke(2.dp.toPx()),
                        )
                    }
                }
                // 名称（圆内上方，小字）
                val nameLayout = textMeasurer.measure(node.name, style = nameStyle)
                drawText(
                    textLayoutResult = nameLayout,
                    topLeft = Offset(
                        (node.x - nameLayout.size.width / 2).coerceIn(0f, (w - nameLayout.size.width).coerceAtLeast(0f)),
                        (node.y - radius * 0.85f).coerceAtLeast(0f),
                    ),
                    color = LabelDark.copy(alpha = alpha),
                )
                // 数值/？写在名称下方（圆内下半）
                val valText = if (node.known) fmt(quantities.first { it.name == node.name }.value ?: 0f) else "？"
                val valLayout = textMeasurer.measure(valText, style = nameStyle)
                drawText(
                    textLayoutResult = valLayout,
                    topLeft = Offset(
                        (node.x - valLayout.size.width / 2).coerceIn(0f, (w - valLayout.size.width).coerceAtLeast(0f)),
                        (node.y + radius * 0.25f).coerceAtLeast(0f),
                    ),
                    color = LabelDark.copy(alpha = alpha),
                )
            }
        }
        // 拖动提示 + 复原
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "💡 按住圆圈可拖动，理顺连线",
                style = MaterialTheme.typography.bodySmall,
                color = LegendColor,
                modifier = Modifier.weight(1f),
            )
            Text(
                "↺ 复原",
                style = MaterialTheme.typography.bodySmall,
                color = ResetBlue,
                modifier = Modifier
                    .clickable { nodePositions.clear() }
                    .padding(4.dp),
            )
        }
        Spacer(Modifier.height(2.dp))
        Text(
            "🔗 圆圈 = 一个数量（实线已知 / 虚线未知），箭头指向由谁算出的结果：×倍 / +多 / -少，分量箭头汇入「一共」",
            style = MaterialTheme.typography.bodySmall,
            color = LegendColor,
        )
    }
}

private data class NodeInfo(
    val name: String,
    val known: Boolean,
    val x: Float,
    val y: Float,
)
