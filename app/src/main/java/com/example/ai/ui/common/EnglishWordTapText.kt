package com.example.ai.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 英文逐词可点读文本 —— 对齐 web `components/EnglishWordTap.tsx` 的交互
 * （按空白切词，点单词内任意位置朗读**整个单词**，播放中的词高亮）。
 *
 * 与 [SpeakableText]（逐**字**点读，中文用）刻意区分：英文按**词**为单位，点词读整词。
 *
 * 单词切分用「空白段 / 非空白段」交替匹配（web 的 `text.match(/\s+|\S+/g)`），
 * 空白段照原样渲染（换行折叠为空格），非空白段可点。**标点跟着单词一起渲染**（如 `park.`），
 * 点它读的是「park.」这一整段 —— 与 web 行为一致（web 也没剥标点）。
 *
 * ⚠️ 已知差异：web 这里还会套一层 `PhonicsWord` 做音形着色（`PhonicsToggle` 控制），
 * Android 尚未移植拼读着色（与「每日英语」同一处缺口）。
 *
 * @param text 要渲染的英文
 * @param onWordTap 点某个非空白段时回调（由调用方负责打断当前播放 + TTS + 生词本收录）
 * @param speakingWord 正在朗读的段（高亮播放态）
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EnglishWordTapText(
    modifier: Modifier = Modifier,
    text: String,
    onWordTap: (String) -> Unit,
    speakingWord: String? = null,
    fontSize: TextUnit = 18.sp,
) {
    // 空白段 / 非空白段交替（保留空白段，才能自然换行）
    val segs = remember(text) { SEG_RE.findAll(text).map { it.value }.toList() }
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(1.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        segs.forEach { seg ->
            if (seg.isBlank()) {
                Text(" ", fontSize = fontSize, color = Black)
            } else {
                val speaking = speakingWord == seg
                Text(
                    text = seg,
                    fontSize = fontSize,
                    fontWeight = if (speaking) FontWeight.Bold else FontWeight.Normal,
                    color = Black,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (speaking) PlayingBlue else Color.Transparent)
                        .clickable { onWordTap(seg) }
                        .padding(horizontal = 1.dp, vertical = 1.dp),
                )
            }
        }
    }
}

/** 空白段（含全角空格）或非空白段，交替匹配 —— 对齐 web 的 `text.match(/\s+|\S+/g)` */
private val SEG_RE = Regex("[\\s\\u00A0\\u3000]+|[^\\s\\u00A0\\u3000]+")

private val Black = Color(0xFF000000)
private val PlayingBlue = Color(0xFF90CAF9)
