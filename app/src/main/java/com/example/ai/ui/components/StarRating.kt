package com.example.ai.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.sp

@Composable
fun StarRating(score: Int, modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier) {
    val stars = (score / 20).coerceIn(0, 5)
    Row(modifier = modifier, horizontalArrangement = Arrangement.Center) {
        repeat(5) { idx ->
            Text(
                text = if (idx < stars) "⭐" else "☆",
                fontSize = 36.sp,
            )
        }
    }
    Text(
        text = "$score 分",
        fontSize = 20.sp,
    )
}
