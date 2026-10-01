package com.example.ai.ui.icon

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 数学页共用的矢量简笔画图标（Android 端）。
 *
 * 图形数据来自 [MathIcons]（由 web 的 mathIcons.ts 生成），坐标系是 0..100 的正方形，
 * 渲染时按目标边长等比缩放 —— 与 web 端内联 SVG 用的是同一份数据，两边画出来一致。
 *
 * 颜色全部由调用方通过 [tint] 给，数据里不写死颜色：
 * 描边用 tint 全不透明，填充用 tint × [MathIconTone.fillAlpha]。
 */
enum class MathIconTone(val fillAlpha: Float, val strokeW: Float) {
    /** 淡填充 + 深描边：物品类（默认） */
    SOFT(0.13f, 3f),

    /** 实心：人 / 手这类主体剪影 */
    INK(0.85f, 3f),

    /** 强调：本页正在讲的那个东西 */
    ACCENT(0.24f, 3.6f),
}

/** 图标图元。坐标一律 0..100，见 [MathIcon]。`outline = true` 表示只描边不填充（用来「挖空」）。 */
sealed interface IconPrim {
    data class C(val cx: Float, val cy: Float, val r: Float, val outline: Boolean = false) : IconPrim

    data class R(val x: Float, val y: Float, val w: Float, val h: Float, val outline: Boolean = false) : IconPrim

    data class Rr(
        val x: Float,
        val y: Float,
        val w: Float,
        val h: Float,
        val rad: Float,
        val outline: Boolean = false,
    ) : IconPrim

    data class L(val x1: Float, val y1: Float, val x2: Float, val y2: Float, val w: Float = 3f) : IconPrim

    /** 注意：不用 data class —— FloatArray 的 equals/hashCode 是引用比较，会误导。 */
    class P(val pts: FloatArray, val closed: Boolean, val outline: Boolean = false) : IconPrim
}

/**
 * 画一个图标。
 *
 * @param name [MathIcons] 里的键；名字打错时**什么都不画**（不崩），方便数据先到位、页面后接入。
 * @param size 边长（正方形）
 * @param tint 描边色；填充会自动取它的低透明度版本
 * @param tone 见 [MathIconTone]
 */
@Composable
fun MathIcon(
    name: String,
    size: Dp,
    tint: Color,
    modifier: Modifier = Modifier,
    tone: MathIconTone = MathIconTone.SOFT,
) {
    val prims = MathIcons[name] ?: return
    Canvas(modifier = modifier.size(size)) {
        val k = this.size.minDimension / 100f
        val stroke = Stroke(
            width = tone.strokeW * k,
            cap = StrokeCap.Round,
            join = StrokeJoin.Round,
        )
        val fill = tint.copy(alpha = tint.alpha * tone.fillAlpha)
        prims.forEach { drawIconPrim(it, k, tint, fill, stroke) }
    }
}

private fun DrawScope.drawIconPrim(
    p: IconPrim,
    k: Float,
    tint: Color,
    fill: Color,
    stroke: Stroke,
) {
    when (p) {
        is IconPrim.C -> {
            val c = Offset(p.cx * k, p.cy * k)
            val r = p.r * k
            if (!p.outline) drawCircle(color = fill, radius = r, center = c)
            drawCircle(color = tint, radius = r, center = c, style = stroke)
        }

        is IconPrim.R -> drawBox(p.x, p.y, p.w, p.h, 0f, p.outline, k, tint, fill, stroke)

        is IconPrim.Rr -> drawBox(p.x, p.y, p.w, p.h, p.rad, p.outline, k, tint, fill, stroke)

        is IconPrim.L -> drawLine(
            color = tint,
            start = Offset(p.x1 * k, p.y1 * k),
            end = Offset(p.x2 * k, p.y2 * k),
            strokeWidth = p.w * k,
            cap = StrokeCap.Round,
        )

        is IconPrim.P -> {
            val path = Path()
            path.moveTo(p.pts[0] * k, p.pts[1] * k)
            var i = 2
            while (i + 1 < p.pts.size) {
                path.lineTo(p.pts[i] * k, p.pts[i + 1] * k)
                i += 2
            }
            if (p.closed) {
                path.close()
                if (!p.outline) drawPath(path = path, color = fill)
                drawPath(path = path, color = tint, style = stroke)
            } else {
                drawPath(path = path, color = tint, style = stroke)
            }
        }
    }
}

private fun DrawScope.drawBox(
    x: Float,
    y: Float,
    w: Float,
    h: Float,
    rad: Float,
    outline: Boolean,
    k: Float,
    tint: Color,
    fill: Color,
    stroke: Stroke,
) {
    val topLeft = Offset(x * k, y * k)
    val sz = Size(w * k, h * k)
    val cr = CornerRadius(rad * k, rad * k)
    if (!outline) drawRoundRect(color = fill, topLeft = topLeft, size = sz, cornerRadius = cr)
    drawRoundRect(color = tint, topLeft = topLeft, size = sz, cornerRadius = cr, style = stroke)
}
