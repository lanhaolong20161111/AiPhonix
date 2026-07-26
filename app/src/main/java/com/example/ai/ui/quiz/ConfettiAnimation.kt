package com.example.ai.ui.quiz

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * 撒花庆祝动画 — 彩色粒子从底部喷射上升。
 */
@Composable
fun ConfettiAnimation(
    modifier: Modifier = Modifier,
    particleCount: Int = 50,
    durationMs: Int = 2500,
) {
    val particles = remember {
        List(particleCount) { ConfettiParticle.random() }
    }

    val animatable = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        animatable.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = durationMs, easing = LinearEasing)
        )
    }

    val progress = animatable.value

    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height

        for (p in particles) {
            val pProgress = ((progress * 1.2f + p.phase) % 1.2f).coerceIn(0f, 1f)
            if (pProgress >= 1f) continue

            val x = w * p.startX + sin(pProgress * p.wobbleFreq + p.wobblePhase) * w * 0.1f
            val y = h - pProgress * h * 1.3f + pProgress * pProgress * h * 0.15f // 先上升后轻微下落
            val alpha = (1f - pProgress).coerceIn(0f, 1f)
            val size = (p.size * (1f - pProgress * 0.3f)).coerceAtLeast(2f)

            drawCircle(
                color = p.color.copy(alpha = alpha),
                radius = size,
                center = Offset(x, y),
            )
        }
    }
}

private data class ConfettiParticle(
    val startX: Float,
    val phase: Float,
    val wobbleFreq: Float,
    val wobblePhase: Float,
    val size: Float,
    val color: Color,
) {
    companion object {
        private val COLORS = listOf(
            Color(0xFFFF6B6B), // 红
            Color(0xFFFFD93D), // 黄
            Color(0xFF6BCB77), // 绿
            Color(0xFF4D96FF), // 蓝
            Color(0xFFFF8C00), // 橙
            Color(0xFF9B59B6), // 紫
            Color(0xFFFF69B4), // 粉
        )

        fun random() = ConfettiParticle(
            startX = Random.nextFloat(),
            phase = Random.nextFloat(),
            wobbleFreq = Random.nextFloat() * 8f + 3f,
            wobblePhase = Random.nextFloat() * 6f,
            size = Random.nextFloat() * 8f + 4f,
            color = COLORS[Random.nextInt(COLORS.size)],
        )
    }
}
