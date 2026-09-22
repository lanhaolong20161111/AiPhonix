package com.example.ai.ui.echo

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 跟读阶梯 UI —— 对齐 web `components/EchoLadder.tsx` 的渲染部分。
 *
 * **纯展示组件**：只吃 [view] 快照与若干标志位；TTS 领读 / 录音 / SOE 评测全由调用方
 * （ViewModel）驱动，通过回调回传。这样阶梯可被任意模块复用，也能单独预览。
 *
 * 跟读模式的典型用法：
 * ```
 * EchoLadder(
 *     view = state.ladder,
 *     reading = state.rolling,          // AI 正在领读
 *     recording = state.recording,
 *     evaluating = state.evaluating,
 *     score = state.echoScore,
 *     failCount = state.ladderFailCount,
 *     error = state.echoError,
 *     onReadAgain = viewModel::readLadderAgain,
 *     onToggleRecord = viewModel::toggleLadderRecord,
 *     onSkip = viewModel::skipLadder,
 * )
 * ```
 *
 * @param view 阶梯快照（等级 / 小步 / 单位表 / 整句）
 * @param reading AI 正在领读（领读期间禁止跟读录音）
 * @param recording 正在录音
 * @param evaluating 正在评测
 * @param score 上一次评测总分（null = 还没评过）
 * @param failCount 当前等级连续失败次数（用于「准备拆小步」提示）
 * @param error 评测/录音失败提示
 * @param onReadAgain 点「🔊 再听」
 * @param onToggleRecord 点主按钮（开始/停止录音）
 * @param onSkip 点「跳过」/「收起」
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EchoLadder(
    modifier: Modifier = Modifier,
    view: LadderView,
    reading: Boolean,
    recording: Boolean,
    evaluating: Boolean,
    score: Int?,
    failCount: Int,
    error: String? = null,
    onReadAgain: () -> Unit,
    onToggleRecord: () -> Unit,
    onSkip: () -> Unit,
) {
    val drill = view.drill
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        color = CardBg,
    ) {
        Column(Modifier.padding(10.dp)) {

            // ── 标题行 ──
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (drill != null) {
                        "🩹 小步练习（先把这个${view.unitLabel}读准）"
                    } else {
                        "🧗 跟读阶梯 · ${view.unitLabel} ${view.level}/${view.total}"
                    },
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Black,
                    modifier = Modifier.weight(1f),
                )
                // web：小步期间不显示「跳过」按钮
                if (drill == null) {
                    TextButton(onClick = onSkip) { Text("跳过", fontSize = 13.sp) }
                }
            }

            if (drill != null) {
                // ── 小步：只显示失败的那个单位 ──
                Row(
                    Modifier.padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("小步：", fontSize = 15.sp, color = Grey, fontWeight = FontWeight.Bold)
                    Text(drill, fontSize = 19.sp, color = ActiveColor, fontWeight = FontWeight.Bold)
                }
            } else {
                // ── 单位表：已过关打勾 / 本轮高亮 / 未轮到淡显 ──
                FlowRow(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    view.steps.forEachIndexed { idx, text ->
                        ChunkChip(idx = idx, text = text, view = view)
                    }
                }
                // 逐词扩长时最要紧的信息：这一轮到底读哪几个词，别让孩子自己数。
                // 单级（整句一把过）时不显示，否则与上面的词块行重复。
                if (view.total > 1) {
                    Text(
                        text = "本轮读：${view.target}",
                        fontSize = 15.sp,
                        color = Black,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }

            // ── 操作行 ──
            val opsBlocked = reading || recording || evaluating
            Row(
                Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = { if (!opsBlocked) onReadAgain() },
                    enabled = !opsBlocked,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = SecondaryBg,
                        contentColor = Black,
                        disabledContainerColor = DisabledBg,
                        disabledContentColor = Grey,
                    ),
                    modifier = Modifier.width(96.dp),
                ) { Text("🔊 再听", fontSize = 13.sp) }

                Button(
                    onClick = { if (!(reading || evaluating)) onToggleRecord() },
                    enabled = !(reading || evaluating),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (recording) ErrorColor else OkColor,
                        contentColor = Color.White,
                        disabledContainerColor = DisabledBg,
                        disabledContentColor = Grey,
                    ),
                    modifier = Modifier.weight(1f),
                ) {
                    Text(
                        text = when {
                            reading -> "🔊 先听 AI 读…"
                            recording -> "⏹ 停止"
                            evaluating -> "…评分中"
                            else -> "🎤 跟读"
                        },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            // ── 分数与错误 ──
            if (score != null) {
                val passed = score >= EchoLadderState.PASS
                val hint = if (!passed && failCount >= 2 && view.level > 1 && drill == null) {
                    "（准备拆小步）"
                } else {
                    ""
                }
                Text(
                    text = if (passed) "✅ ${score}分，过关！" else "⚠️ ${score}分，再试一次$hint",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (passed) OkColor else ErrorColor,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            if (!error.isNullOrBlank()) {
                Text(
                    text = error,
                    fontSize = 13.sp,
                    color = ErrorColor,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}

/**
 * 一个单位块。
 *
 * ⚠️ 高亮口径（web 2026-09-16 修过的 bug）：**不能把 [LadderView.level] 之后的全部标成 active**，
 * 否则第 1 级时整句都染黄、孩子分不清「这轮只要读第 1 个词」。
 * 正确口径：`level - 1` **之前**打勾，**恰好** `level - 1` 这一个高亮，其余淡显。
 */
@Composable
private fun ChunkChip(idx: Int, text: String, view: LadderView) {
    val isCurrent = view.drill == null && idx == view.level - 1
    val label: String
    val fg: Color
    val bg: Color
    when {
        // 小步期间不显示进度（web：全部 plain）
        view.drill != null -> { label = text; fg = Black; bg = ChipPlain }
        idx < view.level - 1 -> { label = "✔ $text"; fg = OkColor; bg = ChipDone }
        isCurrent -> { label = text; fg = ActiveColor; bg = ChipActive }
        else -> { label = text; fg = Black; bg = ChipPlain }
    }
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = bg,
        modifier = Modifier.border(1.dp, ChipBorder, RoundedCornerShape(6.dp)),
    ) {
        Text(
            text = label,
            fontSize = 14.sp,
            fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
            color = fg,
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
        )
    }
}

// ── 配色（语义色：绿=过关 / 红=重试 / 蓝=本轮目标；文字纯黑）──
private val Black = Color(0xFF000000)
private val Grey = Color(0xFF536471)
private val OkColor = Color(0xFF2E7D32)
private val ErrorColor = Color(0xFFB71C1C)
private val ActiveColor = Color(0xFF1565C0)
private val CardBg = Color(0xFFF8FAFC)
private val ChipPlain = Color(0xFFFFFFFF)
private val ChipDone = Color(0xFFE8F5E9)
private val ChipActive = Color(0xFFFFF8E1)
private val ChipBorder = Color(0xFFE2E8F0)
private val SecondaryBg = Color(0xFFEFF6FF)
private val DisabledBg = Color(0xFFEDF2F7)
