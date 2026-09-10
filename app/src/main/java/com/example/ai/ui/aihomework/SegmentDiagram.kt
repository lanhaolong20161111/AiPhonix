package com.example.ai.ui.aihomework

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import com.example.ai.data.aihomework.QuantityItem
import com.example.ai.data.aihomework.QuantityRelation
import kotlin.math.abs

// ── 颜色：全部用显眼色，避免浅灰看不清 ──
private val LineSolid = Color(0xFF1A1A1A)       // 实体主线：实线，颜色与左侧名称一致（近黑）
private val DiffMore = Color(0xFFC62828)        // 多出段：深红（标签更醒目）
private val DiffLess = Color(0xFF1B5E20)        // 还差段：深绿（标签更醒目）
private val LabelBlue = Color(0xFF0A2E7A)       // 数值标签：深蓝（加深）
private val LabelQuestion = Color(0xFFB71C1C)   // 未知量 "？"：深红
private val RelTimes = Color(0xFF4A148C)        // 倍数关系文字：紫（与圆圈图一致）
private val RelTotal = Color(0xFFE65100)        // 求和关系文字：橙
private val LegendColor = Color(0xFF263238)     // 图例：更深蓝灰

/**
 * 线段图：小学课本样式——一条细线，两端用短竖线标出起止；
 * 数值标在线段上方；多出/还差部分用红/绿细线分段标出（分段处也有短竖线）。
 *
 * 设计要点（对应「线段图教孩子看懂数量」的教学思路）：
 * - 每个数量实体一条水平细线，长度 = 数值 / 最大数值 × 可用宽度（两倍关系自然就是两段等长连在一起）
 * - 未知量（题目所求）画实线 + 红色 "？"；虚线只用于「与其他线段的关系」差值段（多出/还差）
 * - 关系标注：
 *   - more/less：差值段用红/绿细线画出并在上方标 "+N" / "-N"（双向：a 或 b 是未知量都能推算）
 *   - times：用短竖线把长线段按基准单位长度分成 N 段并标 "×N"（含倒转：a 已知、b 未知时 b = a ÷ N）
 *   - total：求和关系（一共），整段按分量分段，每段标分量值，整段上方标 "？"
 */
@Composable
fun SegmentDiagram(
    quantities: List<QuantityItem>,
    relations: List<QuantityRelation>,
    modifier: Modifier = Modifier,
) {
    if (quantities.isEmpty()) return

    // maxValue 必须包含「可推算的未知量」，否则已知量会占满宽、未知量比例失真。
    val known = quantities.mapNotNull { it.value }
    val inferred = quantities.filter { it.value == null }.mapNotNull { q -> inferValue(q, quantities, relations) }
    val maxValue = (known + inferred).maxOrNull()?.takeIf { it > 0f } ?: 1f
    val textMeasurer = rememberTextMeasurer()
    val labelStyle = MaterialTheme.typography.bodyMedium

    // 分步演示：0=只画线段，1=线段+刻度/分段，2=完整（线段+刻度+文字标注）
    var step by remember { mutableIntStateOf(2) }
    val stepNames = listOf("① 画线段", "② 分刻度", "③ 标数字")

    Column(modifier = modifier.fillMaxWidth()) {
        // 分步演示切换：教学用三步递进（点击切换，可循环）
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "分步演示：",
                style = MaterialTheme.typography.bodySmall,
                color = LegendColor,
            )
            Spacer(Modifier.width(6.dp))
            stepNames.forEachIndexed { i, name ->
                val selected = step == i
                Surface(
                    onClick = { step = i },
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 3.dp),
                ) {
                    Text(
                        name,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
        }

        quantities.forEach { q ->
            // 差值派生实体（如"贵的金额"）：单独一行，由"基准段（蓝）+ 红色差值段"两段组成
            val diffSeg = diffSegmentValues(q, quantities, relations)
            if (diffSeg != null) {
                DiffQuantityRow(
                    name = q.name,
                    baseValue = diffSeg.first,
                    diffValue = diffSeg.second,
                    maxValue = maxValue,
                    textMeasurer = textMeasurer,
                    labelStyle = labelStyle,
                    showTicks = step >= 1,
                    showLabels = step >= 2,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                )
                return@forEach
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // 左侧：名称（bodyMedium 14sp，比 bodySmall 更清晰）
                Text(
                    text = q.name,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFF1A1A1A),
                    modifier = Modifier.width(64.dp),
                    maxLines = 1,
                )
                // 中间：细线线段（课本样式）
                val value = q.value
                val isUnknown = value == null
                Canvas(
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp),
                ) {
                    val w = size.width
                    val h = size.height
                    val stroke = 2.dp.toPx()          // 细线
                    val tickHalf = 6.dp.toPx()        // 两端短竖线半高
                    val cy = h * 0.62f                 // 线偏下，上方留数值文字空间
                    val dash = PathEffect.dashPathEffect(floatArrayOf(10f, 7f))
                    val labelGap = 3.dp.toPx()
                    val showTicks = step >= 1          // ② 起画分段刻度
                    val showLabels = step >= 2         // ③ 起画文字标注

                    /** 画一段细线 + 两端短竖线（课本样式：一条细线，短竖线表示起止） */
                    fun drawSegment(from: Float, to: Float, color: Color, dashed: Boolean = false, leftTick: Boolean = true, rightTick: Boolean = true) {
                        drawLine(
                            color = color,
                            start = Offset(from, cy),
                            end = Offset(to, cy),
                            strokeWidth = stroke,
                            pathEffect = if (dashed) dash else null,
                        )
                        if (showTicks && leftTick) {
                            drawLine(color, Offset(from, cy - tickHalf), Offset(from, cy + tickHalf), stroke)
                        }
                        if (showTicks && rightTick) {
                            drawLine(color, Offset(to, cy - tickHalf), Offset(to, cy + tickHalf), stroke)
                        }
                    }

                    /** 在线段上方（默认）或下方居中画标签（bodyMedium 14sp，显式字号防止默认小字） */
                    fun drawLabel(text: String, color: Color, centerX: Float, below: Boolean = false) {
                        if (!showLabels) return
                        val layout = textMeasurer.measure(text, style = labelStyle)
                        val y = if (below) {
                            (cy + tickHalf + labelGap).coerceAtMost(h - layout.size.height)
                        } else {
                            (cy - tickHalf - labelGap - layout.size.height).coerceAtLeast(0f)
                        }
                        drawText(
                            textLayoutResult = layout,
                            topLeft = Offset(
                                (centerX - layout.size.width / 2).coerceIn(0f, (w - layout.size.width).coerceAtLeast(0f)),
                                y,
                            ),
                            color = color,
                        )
                    }

                    fun frac(v: Float): Float = (v / maxValue).coerceIn(0.01f, 1f) * w

                    if (isUnknown) {
                        // ── 未知量：按关系推算相对长度（不标答案数字，不剧透） ──
                        val rel = firstRelFor(q, quantities, relations)
                        if (rel == null) {
                            // 无关系可推算：满宽实线 + ？
                            drawSegment(0f, w, LineSolid)
                            drawLabel("？", LabelQuestion, w / 2)
                        } else {
                            val baseVal = rel.base?.let { effectiveValue(it, quantities, relations) }
                            when (rel.type) {
                                "total" -> {
                                    // 一共：整段 = 各分量之和，按分量比例分段
                                    val parts = rel.parts
                                    val partVals = parts.mapNotNull { effectiveValue(it, quantities, relations) }
                                    if (partVals.size == parts.size && partVals.isNotEmpty()) {
                                        val totalVal = partVals.sum()
                                        val end = frac(totalVal)
                                        drawSegment(0f, end, LineSolid)
                                        // 分量分界竖线 + 每段上方标分量值（竖线受②控制）
                                        var acc = 0f
                                        parts.forEachIndexed { idx, p ->
                                            val pv = partVals[idx]
                                            acc += frac(pv)
                                            if (showTicks && acc < end - 1f) {
                                                drawLine(LineSolid, Offset(acc, cy - tickHalf), Offset(acc, cy + tickHalf), stroke)
                                            }
                                            drawLabel(fmt(pv), LabelBlue, acc - frac(pv) / 2)
                                        }
                                        drawLabel("？", LabelQuestion, end / 2)
                                    } else {
                                        drawSegment(0f, w, LineSolid)
                                        drawLabel("？", LabelQuestion, w / 2)
                                    }
                                }
                                "more", "less" -> {
                                    if (baseVal == null) {
                                        drawSegment(0f, w, LineSolid)
                                        drawLabel("？", LabelQuestion, w / 2)
                                    } else if (rel.type == "more") {
                                        // q 比基准多 amount → 实线画到 base+amount，差值段红色虚线 +N
                                        // 红色多出段左端画短竖线，标识"从这里起是多出来的部分"
                                        val end = frac(baseVal + rel.amount)
                                        val baseX = frac(baseVal)
                                        drawSegment(0f, end, LineSolid)
                                        drawSegment(baseX.coerceAtMost(end), end, DiffMore, leftTick = showTicks, dashed = true)
                                        drawLabel("+${fmt(rel.amount)}", DiffMore, (baseX + end) / 2)
                                        drawLabel("？", LabelQuestion, end / 2)
                                    } else {
                                        // q 比基准少 amount → 实线画到 base-amount，差值段绿色虚线 -N
                                        val end = frac((baseVal - rel.amount).coerceAtLeast(0f))
                                        val baseX = frac(baseVal)
                                        drawSegment(0f, end, LineSolid)
                                        drawSegment(end, baseX, DiffLess, leftTick = showTicks, dashed = true)
                                        drawLabel("-${fmt(rel.amount)}", DiffLess, (end + baseX) / 2)
                                        drawLabel("？", LabelQuestion, end / 2)
                                    }
                                }
                                "times" -> {
                                    if (baseVal == null) {
                                        drawSegment(0f, w, LineSolid)
                                        drawLabel("？", LabelQuestion, w / 2)
                                    } else if (rel.inverted) {
                                        // 倒转：q 是基准，a 是 q 的 N 倍 → q = a ÷ N（q 自己就是 1 份）
                                        val end = frac(baseVal / rel.amount)
                                        drawSegment(0f, end, LineSolid)
                                        drawLabel("？", LabelQuestion, end / 2)
                                    } else {
                                        // 正向：q 是 a，q = base × N → 实线画到 base×N，按 base 单位分割成 N 段
                                        val end = frac(baseVal * rel.amount)
                                        drawSegment(0f, end, LineSolid)
                                        val unitLen = frac(baseVal)
                                        val segCount = rel.amount.toInt().coerceAtLeast(1)
                                        for (i in 1 until segCount) {
                                            val x = (unitLen * i).coerceIn(1f, end - 1f)
                                            if (showTicks) {
                                                drawLine(LineSolid, Offset(x, cy - tickHalf), Offset(x, cy + tickHalf), stroke)
                                            }
                                        }
                                        drawLabel("？", LabelQuestion, end / 2)
                                    }
                                }
                            }
                        }
                    } else {
                        // ── 已知量：主线段（深蓝细线 + 两端短竖线），长度 = 数值比例 ──
                        val segLen = frac(value)
                        drawSegment(0f, segLen.coerceAtLeast(2.dp.toPx()), LineSolid)
                        val rel = firstRelFor(q, quantities, relations)
                        if (rel != null) {
                            when (rel.type) {
                                "more", "less" -> {
                                    // 差值段画在"主体 a"上（more 红 / less 绿）。倒转时 q 是基准 b，差值画在 a 行，q 行不画。
                                    if (!rel.inverted && rel.amount != 0f && maxValue > 0f) {
                                        val diffLen = (abs(rel.amount) / maxValue).coerceAtMost(1f) * w
                                        val diffColor = if (rel.type == "more") DiffMore else DiffLess
                                        val startX = (segLen - diffLen).coerceAtLeast(0f)
                                        // 差值段左端短竖线：标识"从这里起是多/少出来的部分"
                                        drawSegment(startX, segLen, diffColor, leftTick = showTicks, dashed = true)
                                        val label = if (rel.type == "more") "+${fmt(rel.amount)}" else "-${fmt(rel.amount)}"
                                        drawLabel(label, diffColor, startX + diffLen / 2)
                                    }
                                }
                                "times" -> {
                                    // a 是 b 的 N 倍：a 线按基准单位长度分割成 N 段
                                    // 基准 b 已知时（inverted=true，q 是基准方）：q 是 1 份，不分割
                                    if (!rel.inverted) {
                                        val baseVal = rel.base?.value ?: (value / rel.amount).takeIf { rel.amount > 0f }
                                        if (baseVal != null && baseVal > 0f && maxValue > 0f) {
                                            val unitLen = frac(baseVal)
                                            val segCount = rel.amount.toInt().coerceAtLeast(1)
                                            for (i in 1 until segCount) {
                                                val x = (unitLen * i).coerceIn(1f, segLen - 1f)
                                                if (showTicks) {
                                                    drawLine(LineSolid, Offset(x, cy - tickHalf), Offset(x, cy + tickHalf), stroke)
                                                }
                                            }
                                        }
                                    }
                                }
                                "total" -> { /* 已知量不参与 total 的分段（分段画在未知的"一共"行） */ }
                            }
                        }
                        // 数值标在线段上方（课本样式）
                        drawLabel(fmt(value), LabelBlue, segLen / 2)
                    }
                }
                // 右侧：单位（加深）
                if (q.unit.isNotBlank()) {
                    Spacer(Modifier.width(4.dp))
                    Text(
                        text = q.unit,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LabelBlue,
                    )
                }
            }
            // 关系说明标在相关线段下方（q 作为关系主体 a 时，如"牛奶是牛角包的2倍"标在牛奶这条线下面）
            val relDescs = relations
                .filter { isRelA(it, q.name) }
                .mapNotNull { r -> describeRelation(r, quantities)?.let { r to it } }
            relDescs.forEach { (r, text) ->
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodySmall,
                    color = relationColor(r.type),
                    modifier = Modifier.padding(start = 68.dp, top = 1.dp),
                )
            }
        }
        // 图例（更大字号 + 更深色）
        Spacer(Modifier.height(2.dp))
        Text(
            "📐 线段越长数量越多：实线 = 数量本身（？= 未知），虚线 = 与其他数量的关系，红段 = 多出，绿段 = 还差，分段 = 倍数",
            style = MaterialTheme.typography.bodySmall,
            color = LegendColor,
        )
    }
}

/** q 是否为关系主体 a（用于把关系文字标在对应线段下方） */
private fun isRelA(r: QuantityRelation, name: String): Boolean =
    name == r.a || name.contains(r.a) || r.a.contains(name)

/** 关系文字颜色（与圆圈图一致：×紫 / +红 / -绿 / 一共橙） */
private fun relationColor(type: String): Color = when (type) {
    "more" -> DiffMore
    "less" -> DiffLess
    "times" -> RelTimes
    "total" -> RelTotal
    else -> LegendColor
}

/** 差值实体行（如"贵的金额"）：由两段组成——基准段（深蓝细线，长度=基准值）+ 红色差值段
 * （长度=差值，左端短竖线分隔）。表示"多出来的部分"，不标答案数字（不剧透）。 */
@Composable
private fun DiffQuantityRow(
    name: String,
    baseValue: Float,
    diffValue: Float,
    maxValue: Float,
    textMeasurer: androidx.compose.ui.text.TextMeasurer,
    labelStyle: androidx.compose.ui.text.TextStyle,
    showTicks: Boolean,
    showLabels: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = name,
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFF1A1A1A),
            modifier = Modifier.width(64.dp),
            maxLines = 1,
        )
        Canvas(
            modifier = Modifier
                .weight(1f)
                .height(40.dp),
        ) {
            val w = size.width
            val h = size.height
            val stroke = 2.dp.toPx()
            val tickHalf = 6.dp.toPx()
            val cy = h * 0.62f
            val labelGap = 3.dp.toPx()
            val fracBase = (baseValue / maxValue).coerceIn(0.01f, 1f) * w
            val fracDiff = (diffValue / maxValue).coerceIn(0.01f, 1f) * w
            val end = (fracBase + fracDiff).coerceAtMost(w)

            fun seg(from: Float, to: Float, color: Color, leftTick: Boolean = true, dashed: Boolean = false) {
                drawLine(
                    color = color,
                    start = Offset(from, cy),
                    end = Offset(to, cy),
                    strokeWidth = stroke,
                    pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(10f, 7f)) else null,
                )
                if (showTicks && leftTick) {
                    drawLine(color, Offset(from, cy - tickHalf), Offset(from, cy + tickHalf), stroke)
                }
                if (showTicks) {
                    drawLine(color, Offset(to, cy - tickHalf), Offset(to, cy + tickHalf), stroke)
                }
            }
            // 基准段（深蓝，实线）——与"第二条线段"的基准部分对齐
            seg(0f, fracBase, LineSolid)
            // 红色差值段（左端短竖线分隔）
            seg(fracBase, end, DiffMore, dashed = true)
            if (showLabels) {
                // 差值段上方标"？"（不剧透答案数字）
                val layout = textMeasurer.measure("？", style = labelStyle)
                drawText(
                    textLayoutResult = layout,
                    topLeft = Offset(
                        (fracBase + end) / 2 - layout.size.width / 2,
                        (cy - tickHalf - labelGap - layout.size.height).coerceAtLeast(0f),
                    ),
                    color = LabelQuestion,
                )
            }
        }
    }
}

