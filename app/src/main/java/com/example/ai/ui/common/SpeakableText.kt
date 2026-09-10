package com.example.ai.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 逐字点读文本：每个字可点击发音；命中关键字区间高亮（加粗/变色），便于学生抓重点。
 *
 * @param onSpeak 点击某字时的发音回调（调用方接 TTS）
 * @param speakingChar 当前正在播放的字（高亮播放态）
 * @param keywords 需高亮的关键字列表（如"多音字""假"），≥2 字才生效
 * @param highlightColor 关键字高亮颜色
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SpeakableText(
    text: String,
    onSpeak: (String) -> Unit,
    speakingChar: String? = null,
    keywords: List<String> = emptyList(),
    highlightColor: Color = Color(0xFF2E7D32),
    fontSize: TextUnit = 17.sp,
    fontStyle: FontStyle = FontStyle.Normal,
    modifier: Modifier = Modifier,
) {
    // 关键字区间（按出现位置，≥2 字）
    val ranges = remember(text, keywords) {
        buildList {
            keywords.forEach { kw ->
                val k = kw.trim()
                if (k.length >= 2 && text.contains(k)) {
                    var from = 0
                    while (true) {
                        val idx = text.indexOf(k, from)
                        if (idx < 0) break
                        add(idx until idx + k.length)
                        from = idx + k.length
                    }
                }
            }
        }
    }
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(1.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        text.forEachIndexed { i, ch ->
            if (ch.isWhitespace()) {
                Spacer(Modifier.width(6.dp))
            } else {
                val chStr = ch.toString()
                val isKw = ranges.any { i in it }
                val isPlaying = speakingChar == chStr
                Text(
                    chStr,
                    fontSize = fontSize,
                    fontStyle = fontStyle,
                    fontWeight = if (isKw) FontWeight.Bold else FontWeight.Normal,
                    color = if (isKw) highlightColor else Color(0xFF000000),
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (isPlaying) Color(0xFF90CAF9) else Color.Transparent)
                        .clickable { onSpeak(chStr) }
                        .padding(horizontal = 1.dp, vertical = 1.dp),
                )
            }
        }
    }
}
