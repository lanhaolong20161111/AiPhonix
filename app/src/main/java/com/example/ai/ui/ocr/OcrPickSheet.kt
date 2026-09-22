package com.example.ai.ui.ocr

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import com.example.ai.data.ocr.CropStatus
import com.example.ai.data.ocr.OcrBoxLogic
import com.example.ai.data.ocr.OcrCrop
import com.example.ai.data.ocr.OcrEngine
import com.example.ai.data.ocr.OcrPickState
import com.example.ai.data.ocr.PickRect
import kotlin.math.min
import kotlin.math.roundToInt

// ── 配色（对齐 web OcrPickSheet 的内联色；正文一律纯黑，语义色沿用项目约定） ──
private val Black = Color(0xFF000000)
private val HintGray = Color(0xFF64748B)
private val LightHint = Color(0xFF94A3B8)
private val StageBg = Color(0xFF0F172A)
private val MaskColor = Color(0x730F172A)      // rgba(15,23,42,.45)
private val CropBlue = Color(0xFF3B82F6)
private val CropBlueBg = Color(0x1A3B82F6)     // rgba(59,130,246,.10)
private val SnapGreen = Color(0xFF22C55E)
private val SnapGreenBg = Color(0x1F22C55E)    // rgba(34,197,94,.12)
private val BlockBorder = Color(0x6694A3B8)    // rgba(148,163,184,.4)
private val DeleteRed = Color(0xFFDC2626)
private val ErrorRed = Color(0xFFDC2626)
private val WarnAmber = Color(0xFFD97706)
private val BusyBlue = Color(0xFF2563EB)
private val ChipBorder = Color(0xFFE2E8F0)
private val ChipActiveBorder = Color(0xFF2563EB)
private val ChipActiveBg = Color(0xFFEFF6FF)
private val ChipActiveText = Color(0xFF1D4ED8)
private val DoneGreen = Color(0xFF16A34A)
private val PendingBg = Color(0xFFF1F5F9)
private val BusyBg = Color(0xFFF8FAFC)
private val ErrorBg = Color(0xFFFEF2F2)
private val DoneBg = Color(0xFFEEF2FF)

/** 图片预览区的最大高度（web 的 `maxHeight: 320`） */
private val IMAGE_MAX_HEIGHT = 320.dp

/** 把手圆点直径（web 是 10px，触屏上放大到 12dp 更好看也更好理解） */
private val HANDLE_DOT = 12.dp

/**
 * 拍照识别 · 自由框选面板 —— 对齐 web `web/src/components/OcrPickSheet.tsx`。
 *
 * 用法（整屏替代 web 的 settings-sheet，避免弹层层级问题，与项目既有设置面板一致）：
 * ```
 * if (state.ocr.open) OcrPickSheet(state = state.ocr, session = viewModel.ocr, ...) else 正常内容
 * ```
 *
 * ★ 与 web 的**有意差异**（两点）：
 * 1. **图片预览区就是「已绘制出来的图」本身**（按可用宽高算出精确的绘制尺寸，居中），
 *    而不是 web 那种 `width:100% + maxHeight + objectFit:contain` 的 letterbox 容器。
 *    web 的换算分母取的是**容器宽高**，竖图被 letterbox 时会算出**整体偏移**的裁剪区；
 *    Android 这里容器 = 图片，坐标天然正确。
 * 2. **删除 ✕ 就地放在框内右上角**（web 放在框外 `right:-10, top:-12`）。Compose 里超出父边界的
 *    子元素**收不到手势**，照抄会变成点不到。
 *
 * ★ 手势：整块图片区只挂**一个** `pointerInput`，key 是 [session]（稳定引用，绝不能用每帧
 * 变化的 `rect`，否则拖拽中会重启手势检测器 ⇒ "拖一下就断"）。命中/缩放/平移/吸附的几何
 * 计算全在 [OcrPickSession] 里，这里只把指针坐标夹到图片范围内后原样转过去。
 */
@Composable
fun OcrPickSheet(
    state: OcrPickState,
    session: OcrPickSession,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val bitmap = session.image

    Column(modifier.fillMaxSize().padding(14.dp)) {
        // ── 顶栏 ──
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                state.title.ifBlank { "📷 拍照识别" },
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                color = Black,
                modifier = Modifier.weight(1f),
            )
            Text(
                "✕",
                fontSize = 18.sp,
                color = Black,
                modifier = Modifier
                    .clickableNoRipple { session.close() }
                    .padding(4.dp),
            )
        }
        Spacer(Modifier.height(8.dp))

        // ── 识别模型选择（web OcrEnginePicker） ──
        Row(verticalAlignment = Alignment.CenterVertically) {
            for (e in OcrEngine.ORDER) {
                EngineChip(engine = e, active = state.engine == e, onClick = { session.setEngine(e) })
                Spacer(Modifier.width(6.dp))
            }
        }
        Spacer(Modifier.height(6.dp))

        Text(state.hintText, fontSize = 11.sp, color = LightHint)
        Spacer(Modifier.height(8.dp))

        if (state.error.isNotBlank()) {
            Text(
                state.error,
                fontSize = 12.sp,
                color = ErrorRed,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp),
            )
        }

        // ── 图片 + 叠加层（不放进滚动区：滚动会与拖拽框选手势打架） ──
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val maxW = constraints.maxWidth.toFloat()
            val maxH = with(density) { IMAGE_MAX_HEIGHT.toPx() }
            when {
                bitmap == null || bitmap.isRecycled -> {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(120.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(StageBg),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (state.starting) "正在读取图片…" else "图片未就绪",
                            fontSize = 12.sp,
                            color = Color(0xFFE2E8F0),
                        )
                    }
                }
                else -> {
                    val fit = fitIn(bitmap.width.toFloat(), bitmap.height.toFloat(), maxW, maxH)
                    val stageW = with(density) { fit.first.toDp() }
                    val stageH = with(density) { fit.second.toDp() }
                    Box(
                        Modifier
                            .size(stageW, stageH)
                            .align(Alignment.Center)
                            .clip(RoundedCornerShape(8.dp))
                            .background(StageBg)
                            .onSizeChanged { session.onStageSize(it.width.toFloat(), it.height.toFloat()) }
                            .pointerInput(session) {
                                awaitPointerEventScope {
                                    while (true) {
                                        val down = awaitFirstDown(requireUnconsumed = false)
                                        down.consume()
                                        session.onPointerDown(
                                            down.position.x.coerceIn(0f, size.width.toFloat()),
                                            down.position.y.coerceIn(0f, size.height.toFloat()),
                                        )
                                        val id = down.id
                                        while (true) {
                                            val ev = awaitPointerEvent()
                                            val ch = ev.changes.firstOrNull { it.id == id }
                                            if (ch == null || !ch.pressed) break
                                            ch.consume()
                                            session.onPointerMove(
                                                ch.position.x.coerceIn(0f, size.width.toFloat()),
                                                ch.position.y.coerceIn(0f, size.height.toFloat()),
                                            )
                                        }
                                        session.onPointerUp()
                                    }
                                }
                            },
                    ) {
                        Image(
                            bitmap = bitmap.asImageBitmap(),
                            contentDescription = "待识别图片",
                            contentScale = ContentScale.FillBounds,
                            modifier = Modifier.fillMaxSize(),
                        )
                        BoxOverlay(state = state, pxToDp = { with(density) { it.toDp() } })
                    }
                }
            }
        }
        Spacer(Modifier.height(10.dp))

        // ── 以下都可滚动 ──
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (state.crops.isEmpty() && !state.anyBusy) {
                Text(
                    "还没有框选任何区域，在图片上拖拽即可开始。",
                    fontSize = 12.sp,
                    color = HintGray,
                    modifier = Modifier.padding(bottom = 10.dp),
                )
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("已框选 ${state.crops.size} 个区域（按顺序拼接）", fontSize = 11.sp, color = LightHint, modifier = Modifier.weight(1f))
                    Text(
                        "清空全部",
                        fontSize = 11.sp,
                        color = DeleteRed,
                        modifier = Modifier.clickableNoRipple { session.clearCrops() }.padding(4.dp),
                    )
                }
                for ((i, c) in state.crops.withIndex()) {
                    CropRow(index = i, crop = c, onRemove = { session.removeCrop(c.key) })
                    Spacer(Modifier.height(6.dp))
                }
                Spacer(Modifier.height(4.dp))
            }

            Text("将导入的内容（可再编辑）：${state.draft.length} 字", fontSize = 11.sp, color = LightHint)
            Spacer(Modifier.height(4.dp))
            OutlinedTextField(
                value = state.draft,
                onValueChange = session::onDraftChange,
                placeholder = {
                    Text("框选识别后，识别文字会按顺序出现在这里，可手动修改后导入", fontSize = 12.sp, color = LightHint)
                },
                minLines = 3,
                maxLines = 8,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    state.footerText,
                    fontSize = 11.sp,
                    color = footerColor(state),
                    modifier = Modifier.weight(1f).padding(end = 8.dp),
                )
                if (state.anyPending) {
                    Button(
                        onClick = { session.recognizePending() },
                        enabled = !state.anyBusy,
                        modifier = Modifier.width(118.dp),
                    ) { Text("⚡ 开始识别", fontSize = 13.sp) }
                    Spacer(Modifier.width(8.dp))
                }
                Button(
                    onClick = { session.close() },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFECEFF1), contentColor = Black),
                ) { Text("取消", fontSize = 13.sp) }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = { session.confirm() },
                    enabled = state.canConfirm,
                ) { Text("✓ 导入", fontSize = 13.sp) }
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

// ───────────────────────── 叠加层 ─────────────────────────

/** 图片上方的一切：文字行轮廓、吸附绿框、已画框、当前拖拽框 + 外围遮罩 */
@Composable
private fun BoxOverlay(state: OcrPickState, pxToDp: (Float) -> Dp) {
    val density = LocalDensity.current
    // 把手圆点要以「把手坐标」为中心 ⇒ 偏移量要减去**半像素**（不是 dp）
    val halfPx = with(density) { (HANDLE_DOT / 2).toPx() }
    // 1) 检测到的文字行轮廓（吸附参照，浅色，不吃手势）
    if (!state.blocksLoading) {
        for (b in state.blocks) {
            OverlayBox(rect = b.rect, pxToDp = pxToDp, borderColor = BlockBorder, borderWidth = 1.dp)
        }
    }
    // 2) 当前吸附目标（绿）
    state.snapTo?.let { s ->
        OverlayBox(
            rect = s,
            pxToDp = pxToDp,
            borderColor = SnapGreen,
            borderWidth = 2.dp,
            background = SnapGreenBg,
        )
    }
    // 3) 已画好的框（蓝 + 编号徽标 + 删除 + 8 个把手）
    for ((i, c) in state.crops.withIndex()) {
        val del = OcrBoxLogic.deleteButtonRect(c.rect)
        OverlayBox(
            rect = c.rect,
            pxToDp = pxToDp,
            borderColor = CropBlue,
            borderWidth = 2.dp,
            background = CropBlueBg,
        )
        // 编号徽标（左上角内侧）
        Text(
            "${i + 1}${c.badgeSuffix}",
            fontSize = 9.sp,
            color = Color.White,
            modifier = Modifier
                .offset { IntOffset(c.rect.x.roundToInt(), c.rect.y.roundToInt()) }
                .background(CropBlue, RoundedCornerShape(3.dp))
                .padding(horizontal = 4.dp, vertical = 1.dp),
        )
        // 删除按钮（红色圆，位置与 OcrBoxLogic.deleteButtonRect 一致）
        Box(
            Modifier
                .offset { IntOffset(del.x.roundToInt(), del.y.roundToInt()) }
                .size(pxToDp(OcrBoxLogic.DELETE_SIZE))
                .background(DeleteRed, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text("✕", fontSize = 11.sp, color = Color.White)
        }
        // 8 个把手圆点（不吃手势：命中判定是几何的）
        for (h in OcrBoxLogic.handlePoints(c.rect)) {
            Box(
                Modifier
                    .offset { IntOffset((h.x - halfPx).roundToInt(), (h.y - halfPx).roundToInt()) }
                    .size(HANDLE_DOT)
                    .background(Color.White, CircleShape)
                    .border(1.5.dp, CropBlue, CircleShape),
            )
        }
    }
    // 4) 当前拖拽框（虚线）+ 框外四向遮罩
    val cur = state.currentRect
    if (cur != null && cur.w > 0f) {
        val dash = PathEffect.dashPathEffect(floatArrayOf(8f, 8f), 0f)
        Box(
            Modifier
                .offset { IntOffset(cur.x.roundToInt(), cur.y.roundToInt()) }
                .size(pxToDp(cur.w), pxToDp(cur.h))
                .drawBehind {
                    drawRect(
                        color = CropBlue,
                        style = Stroke(width = 3f, pathEffect = dash),
                    )
                },
        )
        MaskBox(0f, 0f, state.stageW, cur.y, pxToDp)                       // 上
        MaskBox(0f, cur.bottom, state.stageW, state.stageH - cur.bottom, pxToDp) // 下
        MaskBox(0f, cur.y, cur.x, cur.h, pxToDp)                          // 左
        MaskBox(cur.right, cur.y, state.stageW - cur.right, cur.h, pxToDp) // 右
    }
}

/**
 * 一个叠加矩形。`w`/`h` ≤ 0 时不渲染。
 *
 * ⚠️ **`Modifier.offset` 必须用 lambda 版本**（`offset { IntOffset }`）：避免了每帧的
 * composition 阶段，只走 layout；同时它是**显式 import** 的
 * `androidx.compose.foundation.layout.offset` —— 少了这个 import 会报 `Unresolved reference`。
 */
@Composable
private fun OverlayBox(
    rect: PickRect,
    pxToDp: (Float) -> Dp,
    borderColor: Color,
    borderWidth: Dp,
    background: Color = Color.Transparent,
) {
    if (rect.w <= 0f || rect.h <= 0f) return
    Box(
        Modifier
            .offset { IntOffset(rect.x.roundToInt(), rect.y.roundToInt()) }
            .size(pxToDp(rect.w), pxToDp(rect.h))
            .background(background, RoundedCornerShape(3.dp))
            .border(borderWidth, borderColor, RoundedCornerShape(3.dp)),
    )
}

/** 框外遮罩的一块（`w`/`h` ≤ 0 自动跳过；越界部分交给父容器的 `clip` 裁掉） */
@Composable
private fun MaskBox(x: Float, y: Float, w: Float, h: Float, pxToDp: (Float) -> Dp) {
    if (w <= 0f || h <= 0f) return
    Box(
        Modifier
            .offset { IntOffset(x.roundToInt(), y.roundToInt()) }
            .size(pxToDp(w), pxToDp(h))
            .background(MaskColor),
    )
}

// ───────────────────────── 小部件 ─────────────────────────

@Composable
private fun EngineChip(engine: OcrEngine, active: Boolean, onClick: () -> Unit) {
    Text(
        engine.label,
        fontSize = 12.sp,
        color = if (active) ChipActiveText else HintGray,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (active) ChipActiveBg else Color.White)
            .border(1.5.dp, if (active) ChipActiveBorder else ChipBorder, RoundedCornerShape(8.dp))
            .clickableNoRipple(onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

/** 框选结果列表的一行（左编号 / 中间状态或文本 / 右删除） */
@Composable
private fun CropRow(index: Int, crop: OcrCrop, onRemove: () -> Unit) {
    val bg = when (crop.status) {
        CropStatus.ERROR -> ErrorBg
        CropStatus.BUSY -> BusyBg
        CropStatus.PENDING -> PendingBg
        CropStatus.DONE -> DoneBg
    }
    val border = when (crop.status) {
        CropStatus.ERROR -> Color(0xFFFCA5A5)
        CropStatus.BUSY -> Color(0xFFE2E8F0)
        CropStatus.PENDING -> Color(0xFFCBD5E1)
        CropStatus.DONE -> CropBlue
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .border(1.5.dp, border, RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            "${index + 1}",
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = CropBlue,
            modifier = Modifier.width(18.dp).padding(top = 1.dp),
        )
        Text(
            crop.displayText,
            fontSize = 13.sp,
            color = Black,
            modifier = Modifier.weight(1f),
        )
        Text(
            "🗑️",
            fontSize = 13.sp,
            color = LightHint,
            modifier = Modifier.clickableNoRipple(onRemove).padding(4.dp),
        )
    }
}

// ───────────────────────── 工具 ─────────────────────────

/** 底部左提示的配色（web：红 → 橙 → 蓝 → 灰 四档） */
private fun footerColor(state: OcrPickState): Color = when (state.footerLevel) {
    0 -> ErrorRed
    1 -> WarnAmber
    2 -> BusyBlue
    else -> LightHint
}

/**
 * 保持宽高比塞进 `maxW × maxH`（允许放大，对齐 web 的 `width:100%`）。
 * 结果同时就是**实际绘制尺寸** —— 容器与图一致，坐标换算因此不需要任何 letterbox 修正。
 */
private fun fitIn(w: Float, h: Float, maxW: Float, maxH: Float): Pair<Float, Float> {
    if (w <= 0f || h <= 0f || maxW <= 0f || maxH <= 0f) return 0f to 0f
    val scale = min(maxW / w, maxH / h)
    return (w * scale) to (h * scale)
}
