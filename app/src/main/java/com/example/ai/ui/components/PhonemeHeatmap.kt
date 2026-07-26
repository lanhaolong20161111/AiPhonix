package com.example.ai.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.audio.IpaAudioPlayer
import com.example.ai.data.model.PhonemeScore
import com.example.ai.data.model.ScoreLevel

@Composable
fun PhonemeHeatmap(
    phonemeScores: List<PhonemeScore>,
    onPlayPhoneme: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        phonemeScores.forEach { ps ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (onPlayPhoneme != null) {
                    androidx.compose.material3.IconButton(
                        onClick = { onPlayPhoneme(ps.phoneme) },
                        modifier = Modifier.size(28.dp),
                    ) {
                        Text("▶", fontSize = 12.sp)
                    }
                }
                Text(
                    text = ps.phoneme,
                    fontSize = 18.sp,
                    modifier = Modifier.width(if (onPlayPhoneme != null) 48.dp else 60.dp),
                )
                val color = when (ps.level) {
                    ScoreLevel.GOOD -> Color(0xFF4CAF50)
                    ScoreLevel.OKAY -> Color(0xFFFFC107)
                    ScoreLevel.NEEDS_WORK -> Color(0xFFF44336)
                }
                val label = when (ps.level) {
                    ScoreLevel.GOOD -> "🟢 优秀"
                    ScoreLevel.OKAY -> "🟡 加油"
                    ScoreLevel.NEEDS_WORK -> "🔴 多练"
                }
                Surface(
                    color = color.copy(alpha = 0.2f),
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.weight(1f).heightIn(min = 32.dp),
                ) {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Text(
                            text = label,
                            fontSize = 14.sp,
                            color = Color.Black,
                        )
                    }
                }
                Text(
                    text = "${ps.score}",
                    fontSize = 16.sp,
                    modifier = Modifier.width(40.dp),
                )
            }
        }
    }
}
