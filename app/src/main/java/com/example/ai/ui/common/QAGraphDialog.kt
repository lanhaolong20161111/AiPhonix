package com.example.ai.ui.common

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

/** 图谱节点：问题/回答圆圈 */
data class QAGraphNode(
    val id: Int,            // 消息下标（跳转用）
    val label: String,      // 圆圈内短标签
    val isQuestion: Boolean, // true=问题(蓝) false=回答(绿)
    val pos: Offset,        // 画布内位置（可拖动）
)

/** 图谱边：父 → 子 */
data class QAGraphEdge(val from: Int, val to: Int)

private const val NODE_R = 34f

/**
 * 问答图谱浮窗：每个问题/回答一个圆圈（问题蓝 / 回答绿），父子用线连接；
 * 圆圈可拖动（连线跟随）；点击圆圈跳转到对应问答位置。
 */
@Composable
fun QAGraphDialog(
    nodes: List<QAGraphNode>,
    edges: List<QAGraphEdge>,
    onClose: () -> Unit,
    onJump: (Int) -> Unit,
) {
    Dialog(onDismissRequest = onClose) {
        Surface(color = Color(0xFFECEFF1), shape = RoundedCornerShape(12.dp)) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "🕸 问答图谱（拖圆圈 · 点圆圈跳转）",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color(0xFF000000),
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "✕",
                        style = MaterialTheme.typography.titleLarge,
                        color = Color(0xFF000000),
                        modifier = Modifier.padding(6.dp).clickable(onClick = onClose),
                    )
                }
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("● 问题", color = Color(0xFF1565C0), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    Text("● 回答", color = Color(0xFF2E7D32), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    Text("— 问答链", color = Color(0xFF546E7A), fontSize = 13.sp)
                }
                Spacer(Modifier.padding(4.dp))

                BoxWithConstraints(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(8.dp),
                ) {
                    val w = maxWidth.value
                    val h = maxHeight.value
                    // 初始布局：问题左列、回答右列，按消息序号向下排
                    var positions by remember(nodes) {
                        mutableStateOf(
                            nodes.map { n ->
                                val idx = nodes.indexOfFirst { it.id == n.id }
                                n.copy(pos = Offset(
                                    x = if (n.isQuestion) w * 0.28f else w * 0.72f,
                                    y = 45f + idx * ((h - 90f) / (nodes.size.coerceAtLeast(1))),
                                ))
                            }
                        )
                    }
                    Canvas(
                        Modifier
                            .fillMaxSize()
                            .pointerInput(positions) {
                                detectDragGestures { change, dragAmount ->
                                    val hit = positions.firstOrNull { n ->
                                        (n.pos - change.position).getDistance() < NODE_R
                                    }
                                    if (hit != null) {
                                        positions = positions.map { n ->
                                            if (n.id == hit.id) {
                                                n.copy(pos = Offset(
                                                    (n.pos.x + dragAmount.x).coerceIn(NODE_R, w - NODE_R),
                                                    (n.pos.y + dragAmount.y).coerceIn(NODE_R, h - NODE_R),
                                                ))
                                            } else n
                                        }
                                    }
                                    change.consume()
                                }
                            }
                            .pointerInput(positions) {
                                detectTapGestures { tap ->
                                    val hit = positions.firstOrNull { n -> (n.pos - tap).getDistance() < NODE_R }
                                    if (hit != null) onJump(hit.id)
                                }
                            }
                            .drawWithCache {
                                onDrawWithContent {
                                    // 连线（父子）
                                    edges.forEach { e ->
                                        val a = positions.firstOrNull { it.id == e.from } ?: return@forEach
                                        val b = positions.firstOrNull { it.id == e.to } ?: return@forEach
                                        drawLine(
                                            color = Color(0xFF78909C),
                                            start = a.pos,
                                            end = b.pos,
                                            strokeWidth = 2.dp.toPx(),
                                        )
                                    }
                                    // 节点
                                    positions.forEach { n ->
                                        val color = if (n.isQuestion) Color(0xFF1565C0) else Color(0xFF2E7D32)
                                        drawCircle(color.copy(alpha = 0.15f), NODE_R.dp.toPx(), n.pos)
                                        drawCircle(color, NODE_R.dp.toPx(), n.pos, style = Stroke(2.5.dp.toPx()))
                                    }
                                    drawContent()
                                }
                            },
                    ) {
                        // 圆圈内文字（nativeCanvas）
                        positions.forEach { n ->
                            drawContext.canvas.nativeCanvas.drawText(
                                n.label.take(4),
                                n.pos.x,
                                n.pos.y + 5f,
                                Paint(Paint.ANTI_ALIAS_FLAG).apply {
                                    color = android.graphics.Color.WHITE
                                    textSize = 13f * density
                                    textAlign = Paint.Align.CENTER
                                    isFakeBoldText = true
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}
