package com.example.ai.ui.common

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.audio.PronunciationStyle

/**
 * 音素发音风格切换（美式 / 英式）。
 * 全局生效：切换后所有音素播放（总表、详情页、练习页、看图识字）跟随所选风格。
 */
@Composable
fun PronunciationStyleToggle(
    style: PronunciationStyle,
    onSelect: (PronunciationStyle) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier) {
        FilterChip(
            selected = style == PronunciationStyle.US,
            onClick = { onSelect(PronunciationStyle.US) },
            label = { Text("美式 US", fontSize = 13.sp) },
        )
        Spacer(Modifier.width(8.dp))
        FilterChip(
            selected = style == PronunciationStyle.UK,
            onClick = { onSelect(PronunciationStyle.UK) },
            label = { Text("英式 UK", fontSize = 13.sp) },
        )
    }
}
