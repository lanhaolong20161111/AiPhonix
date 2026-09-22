package com.example.ai.ui.ocr

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.ocr.OcrEngine

/**
 * 无涟漪点击（web 里那种「整块卡片 / 整行可点」的轻交互，不需要水波纹反馈）。
 *
 * ⚠️ 定义为**包级 `internal`** 而非各处各写 `private`：否则 `OcrPickSheet` 与 `EnVocabPhotoSheet`
 * 各有一份 `private` 副本，引用方跨文件取不到。
 */
@Composable
internal fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier {
    val interaction = remember { MutableInteractionSource() }
    return this.then(
        clickable(
            interactionSource = interaction,
            indication = null,
            onClick = onClick,
        ),
    )
}

/**
 * 「拍照 OCR 自动填入」在**三处设置面板**（每日语文 / 每日英语 / AI 英语对话）共用的
 * 极小 UI 零件与配色。
 *
 * 抽出来的原因：web 里这三处的 📷/🖼️ 按钮与提示横幅是**逐字一致**的内联样式，
 * 在 Android 端若各抄一份，改一处配色就要改三处（且很容易只改一处）。
 *
 * 配色对齐 web `DailyChinesePage` / `DailyEnglishPage` 的内联色值。
 */

internal val OcrOkGreen = Color(0xFF16A34A)
internal val OcrErrRed = Color(0xFFDC2626)
internal val OcrOkBg = Color(0xFFF0FDF4)
internal val OcrErrBg = Color(0xFFFEF2F2)
internal val OcrInfoBlue = Color(0xFF1E40AF)
internal val OcrInfoBg = Color(0xFFEFF6FF)
internal val OcrCameraBg = Color(0xFFEEF2FF)
internal val OcrCameraFg = Color(0xFF4F46E5)
internal val OcrAlbumBg = Color(0xFFF0FDF4)
internal val OcrAlbumFg = Color(0xFF16A34A)
internal val OcrDisabledBg = Color(0xFFF1F5F9)
internal val OcrChipBorder = Color(0xFFE2E8F0)
internal val OcrChipActiveBorder = Color(0xFF2563EB)
internal val OcrChipActiveBg = Color(0xFFEFF6FF)
internal val OcrChipActiveText = Color(0xFF1D4ED8)
internal val OcrChipIdleText = Color(0xFF64748B)
internal val OcrLightHint = Color(0xFF94A3B8)

/**
 * 识别模型选择（web `OcrEnginePicker`）。
 *
 * 抽到共用文件的原因：`OcrPickSheet`（框选）与 `EnVocabPhotoSheet`（整页识词）都要放它，
 * 而 web 里的样式是逐字一致的。
 *
 * @param showLabel 是否显示「识别模型：」前缀（web 的 `showLabel`，识词弹层传 false）
 */
@Composable
internal fun OcrEnginePicker(
    engine: OcrEngine,
    onSelect: (OcrEngine) -> Unit,
    showLabel: Boolean = true,
) {
    Column {
        if (showLabel) {
            Text("识别模型", fontSize = 12.sp, color = OcrChipIdleText, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (e in OcrEngine.ORDER) {
                OcrEngineChip(engine = e, active = e == engine, onClick = { onSelect(e) })
            }
        }
    }
}

@Composable
private fun OcrEngineChip(engine: OcrEngine, active: Boolean, onClick: () -> Unit) {
    Text(
        engine.label,
        fontSize = 12.sp,
        color = if (active) OcrChipActiveText else OcrChipIdleText,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (active) OcrChipActiveBg else Color.White)
            .border(1.5.dp, if (active) OcrChipActiveBorder else OcrChipBorder, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

/**
 * 字段标签右侧的小图标按钮（web 的 📷 / 🖼️ 内联按钮）。
 *
 * ⚠️ 全局 CSS 有 `button { width: 100% }`（本项目 web 的坑），Android 侧没有这个问题，
 * 但这里刻意**不**用 `Button`：要的是"贴着标签的小方块"而不是拉伸的按钮。
 */
@Composable
internal fun OcrIconChip(
    text: String,
    bg: Color,
    fg: Color,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Text(
        text,
        fontSize = 12.sp,
        color = fg,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .border(1.dp, OcrChipBorder, RoundedCornerShape(6.dp))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** 设置面板里的小号次要按钮（web 的「继续选一张 / 继续拍一张」） */
@Composable
internal fun OcrSmallButton(text: String, onClick: () -> Unit, enabled: Boolean) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = Color.White,
            contentColor = OcrInfoBlue,
        ),
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
    ) { Text(text, fontSize = 12.sp) }
}
