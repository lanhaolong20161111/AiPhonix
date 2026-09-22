package com.example.ai.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.phonics.PhonicType
import com.example.ai.data.phonics.segmentPhonics

/**
 * 英文单词拼读着色 —— 把一个词/一句话按发音规律切成色块（见 `data/phonics`）。
 *
 * 与 web `components/PhonicsWord.tsx` 的 `PhonicsText` 等价：整段按空白切词，逐词上色；
 * 关掉着色时退化为纯 `Text`。色块配色对齐 web `App.css` 的 `.ph-*`（浅色主题），正文纯黑。
 *
 * ⚠️ 用 `AnnotatedString` 背景色实现（对应 web 的 `display:inline`），不破坏中文行首禁则；
 * 不发音字母（silent）以虚线近似为下划线，提示「看着有、读时不发音」。
 */

/** 七类配色（浅色主题，对齐 App.css `.ph-*`）。bg 为 0xAARRGGBB。 */
private object PC {
    val vowelSingleBg = Color(0x26E24A42)
    val vowelSingleFg = Color(0xFFB3261E)
    val vowelLongBg = Color(0x261C74D9)
    val vowelLongFg = Color(0xFF0B4F9E)
    val vowelTeamBg = Color(0x2BE48C0C)
    val vowelTeamFg = Color(0xFF8A4B00)
    val digraphBg = Color(0x267E47D6)
    val digraphFg = Color(0xFF5B21B6)
    val silentBg = Color(0x2678828C)
    val silentFg = Color(0xFF8B939C)
    val consonantBg = Color(0x0B0F1419)
    val consonantBgLight = Color(0x0B0F1419)
}

/**
 * 整段英文的逐词着色。
 *
 * @param enabled 着色开关；关闭时退化为纯文本（纯黑）。
 * @param color 正文默认色（关闭着色或 other/consonant 类块沿用此色）。
 */
@Composable
fun PhonicsText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Black,
    fontSize: TextUnit = 16.sp,
    fontWeight: FontWeight? = null,
    enabled: Boolean = true,
) {
    if (!enabled || text.isBlank()) {
        Text(text = text, modifier = modifier, color = color, fontSize = fontSize, fontWeight = fontWeight)
        return
    }
    val builder = AnnotatedString.Builder()
    for (seg in Regex("\\s+|\\S+").findAll(text)) {
        val s = seg.value
        if (Regex("^\\s+$").matches(s)) {
            builder.append(s)
        } else {
            for (c in segmentPhonics(s)) {
                builder.pushStyle(spanStyle(c.type, color))
                builder.append(c.text)
                builder.pop()
            }
        }
    }
    Text(
        text = builder.toAnnotatedString(),
        modifier = modifier,
        color = color,
        fontSize = fontSize,
        fontWeight = fontWeight,
    )
}

private fun spanStyle(type: PhonicType, baseColor: Color): SpanStyle = when (type) {
    PhonicType.VOWEL_SINGLE -> SpanStyle(background = PC.vowelSingleBg, color = PC.vowelSingleFg)
    PhonicType.VOWEL_LONG -> SpanStyle(background = PC.vowelLongBg, color = PC.vowelLongFg)
    PhonicType.VOWEL_TEAM -> SpanStyle(background = PC.vowelTeamBg, color = PC.vowelTeamFg)
    PhonicType.DIGRAPH -> SpanStyle(background = PC.digraphBg, color = PC.digraphFg)
    PhonicType.SILENT -> SpanStyle(
        background = PC.silentBg,
        color = PC.silentFg,
        textDecoration = TextDecoration.Underline,
    )
    PhonicType.CONSONANT -> SpanStyle(background = PC.consonantBg, color = baseColor)
    PhonicType.OTHER -> SpanStyle(background = Color.Unspecified, color = baseColor)
}

/**
 * 拼读着色开关 —— 放在每日英语页 header 右侧（与 web `PhonicsToggle` 同款外观）。
 * 状态与全局偏好是同一份，任一处切换全页联动。
 */
@Composable
fun PhonicsToggle(on: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    Text(
        text = if (on) "🎨 彩色拼读" else "🎨 黑白显示",
        fontSize = 13.sp,
        color = if (on) PC.vowelLongFg else Color(0xFF6B7280),
        modifier = modifier
            .background(
                if (on) Color(0xFFE3F2FD) else Color(0xFFE2E8F0),
                RoundedCornerShape(8.dp),
            )
            .clickable(onClick = onToggle)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

/** 发音要领列表里音素符号的小标签色（对齐 web `.soe-tip-sym` 的 #b45309） */
val PhonicsTipSymColor = Color(0xFFB45309)
