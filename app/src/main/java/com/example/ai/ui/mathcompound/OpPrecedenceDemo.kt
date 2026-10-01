package com.example.ai.ui.mathcompound

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.math.PR_DEMO_CASES
import com.example.ai.data.math.PStep
import com.example.ai.data.math.PToken
import com.example.ai.data.math.PWhy
import com.example.ai.data.math.PrDemoCase
import com.example.ai.data.math.TokenType
import com.example.ai.data.math.isMd
import com.example.ai.data.math.planSteps
import kotlinx.coroutines.delay

/**
 * 「先算谁？」运算优先级小动画 —— 页内**可展开**的一小块（自包含，不参与主时间轴）
 *
 * 讲两条规矩：
 *   ① 不同级 —— 先乘除、后加减（跟在左边还是右边**无关**）
 *   ② 同级   —— 从左往右，先碰到谁先算
 *
 * 每一轮化简都走同一套四拍：判级 → 选中 → 趁手 → 并成一个数
 *   · 「不同级」：乘除**抬起一格**、加减**下沉一格**（各 9dp）—— 让「级别高低」看得见。
 *     加号明明在最左边却轮不到它，这一帧就是全篇的重点。
 *   · 「同级」：一条扫描条**从左往右**掠过，扫到谁谁先算 —— 位置才是唯一依据。
 *     ⚠️ 只剩一个运算符时不扫（没有可比对象，「从左往右数」无从谈起）。
 *
 * ⚠️ 版面用**定宽槽位**（数字 38dp · 运算符 30dp · 间隔 7dp）：
 *    宽度可预知 ⇒「三块并成一个数」只用宽度过渡，中途不跳版，也**不必量尺寸**；
 *    扫描条的目标位置能直接由槽位宽度累加算出（web 那边是量出来的）。
 */
private val Black = Color.Black
private val Slate = Color(0xFF475569)
private val MdColor = Color(0xFF2563EB)
private val AsColor = Color(0xFFEA580C)
private val OkColor = Color(0xFF16A34A)
private val WarnColor = Color(0xFFDC2626)
private val DoneBg = Color(0xFFDCFCE7)
private val PickBg = Color(0xFFFDE68A)

/** 每个化简轮的节拍（ms）—— 合并起来就是整段动画的时长 */
private const val T_INTRO = 420L
private const val T_JUDGE = 780L
private const val T_PICK = 460L
private const val T_JOIN = 540L
private const val T_COMMIT = 80L
private const val T_OUTRO = 860L

private val W_NUM = 38.dp
private val W_OP = 30.dp
private val W_GAP = 7.dp
private val SweeperW = 18.dp

private enum class PrPhase { IDLE, INTRO, JUDGE, PICK, JOIN, SETTLE, DONE }

/** 版面里的一个槽位 */
private class PrSlot(
    val key: String,
    val kind: TokenType,
    val text: String,
    /** 在 tokens 里的原始下标（结果块为 -1） */
    val src: Int,
    val computed: Boolean = false,
    /** 正在被「吃」掉（宽度收缩到 0） */
    val eaten: Boolean = false,
    /** 结果块 */
    val res: Boolean = false,
) {
    val width: Dp get() = if (kind == TokenType.NUM) W_NUM else W_OP
    /** 被吃掉时连同后面的间隔一起收掉，否则会留 3×7dp 的空档 */
    val gap: Dp get() = if (eaten) 0.dp else W_GAP
}

@Composable
fun OpPrecedenceDemo() {
    val caseKey = remember { mutableStateOf(PR_DEMO_CASES[0].key) }
    val phase = remember { mutableStateOf(PrPhase.IDLE) }
    val cursor = remember { mutableStateOf(0) }
    val viewTokens = remember { mutableStateOf(PR_DEMO_CASES[0].tokens) }
    val joined = remember { mutableStateOf(false) }
    val runToken = remember { mutableIntStateOf(0) }

    val demo = PR_DEMO_CASES.firstOrNull { it.key == caseKey.value } ?: PR_DEMO_CASES[0]
    val trace = remember(demo) { planSteps(demo.tokens) }
    val playing = phase.value != PrPhase.IDLE && phase.value != PrPhase.DONE

    fun reset(next: PrDemoCase) {
        caseKey.value = next.key
        viewTokens.value = next.tokens
        cursor.value = 0
        joined.value = false
        phase.value = PrPhase.IDLE
    }

    LaunchedEffect(runToken.value) {
        if (runToken.value == 0) return@LaunchedEffect
        val steps = trace
        if (steps.isEmpty()) return@LaunchedEffect
        viewTokens.value = demo.tokens
        cursor.value = 0
        joined.value = false
        phase.value = PrPhase.INTRO
        delay(T_INTRO)
        steps.forEachIndexed { i, _ ->
            cursor.value = i
            phase.value = PrPhase.JUDGE
            delay(T_JUDGE)
            phase.value = PrPhase.PICK
            delay(T_PICK)
            phase.value = PrPhase.JOIN
            joined.value = false
            withFrameNanos { } // 先渲染一帧「结果块宽 0 + 三块未收缩」，再打开过渡
            joined.value = true
            delay(T_JOIN)
            viewTokens.value = steps[i].after
            joined.value = false
            phase.value = PrPhase.SETTLE
            delay(T_COMMIT)
        }
        cursor.value = steps.size
        phase.value = PrPhase.DONE
    }

    val step: PStep? = if (phase.value == PrPhase.JUDGE || phase.value == PrPhase.PICK) {
        trace.getOrNull(cursor.value)
    } else {
        null
    }
    val joining: PStep? = if (phase.value == PrPhase.JOIN) trace.getOrNull(cursor.value) else null

    /** 「同级」这一支：扫描条从左往右掠过（目标 = 本轮要算的那个运算符） */
    val sweeping = phase.value == PrPhase.JUDGE &&
        step?.why == PWhy.SAME_LEVEL &&
        step.siblings.isNotEmpty()

    val pickedIdx = step?.index ?: joining?.index ?: -1
    val lvOn = phase.value == PrPhase.JUDGE && step?.why == PWhy.HIGHER

    val slots = buildSlots(viewTokens.value, joining, joined.value)

    // 扫描条：目标中心由定宽槽位直接累加得出（不必量尺寸）
    val sweepX = remember { Animatable(-10f) }
    LaunchedEffect(sweeping, cursor.value) {
        if (!sweeping) return@LaunchedEffect
        val target = slots.getOrNull(pickedIdx)
        val to = slotCenterX(slots, pickedIdx).value - SweeperW.value / 2f
        if (target == null) return@LaunchedEffect
        sweepX.snapTo(-10f)
        sweepX.animateTo(
            targetValue = to,
            animationSpec = tween(
                durationMillis = (T_JUDGE * 0.72).toInt(),
                easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f),
            ),
        )
    }

    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text("🔢 先算谁？—— 加减乘除的优先级", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Black)
            Spacer(Modifier.height(10.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PR_DEMO_CASES.forEach { c ->
                    val on = c.key == caseKey.value
                    Text(
                        c.chip,
                        fontSize = 12.sp,
                        color = if (on) Color.White else Black,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (on) Color(0xFF2563EB) else Color(0xFFF1F5F9))
                            .clickable(enabled = !playing) { reset(c) }
                            .padding(vertical = 7.dp),
                    )
                }
            }

            Text(
                demo.label,
                fontSize = 13.sp,
                color = Slate,
                modifier = Modifier.padding(top = 10.dp),
            )

            // ── 算式行：定宽槽位 + 扫描条 ──
            Box(Modifier.fillMaxWidth().height(104.dp).padding(top = 16.dp)) {
                Row(
                    modifier = Modifier.align(Alignment.TopStart),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    slots.forEachIndexed { i, s ->
                        key(s.key) {
                            PrSlotView(
                                slot = s,
                                picked = s.kind == TokenType.OP && s.src == pickedIdx &&
                                    (phase.value == PrPhase.PICK || phase.value == PrPhase.JOIN),
                                level = when {
                                    !lvOn || s.kind != TokenType.OP -> 0
                                    isMd(s.text) -> 2
                                    else -> 1
                                },
                                wait = s.kind == TokenType.OP && s.src != pickedIdx && phase.value == PrPhase.PICK,
                                grown = s.res && joined.value,
                            )
                        }
                    }
                }

                if (sweeping) {
                    // 扫描条放在算式**下方**（放上面会压到数字块顶部）
                    Box(
                        Modifier
                            .align(Alignment.TopStart)
                            .offset(x = sweepX.value.dp, y = 84.dp)
                            .width(SweeperW)
                            .height(3.dp)
                            .background(OkColor, RoundedCornerShape(2.dp)),
                    )
                }
            }

            Text(
                hintOf(phase.value, step, joining, cursor.value, viewTokens.value, trace),
                fontSize = 13.sp,
                color = Black,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFF8FAFC))
                    .padding(10.dp),
            )

            if (phase.value == PrPhase.DONE) {
                Row(
                    Modifier.padding(top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("= ", fontSize = 18.sp, color = Black)
                    Text(demo.answer.toString(), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Black)
                    Text("按这个顺序算才对", fontSize = 13.sp, color = OkColor)
                }
                Text(
                    "❌ 常见错法：${demo.wrong} —— ${demo.wrongWhy}",
                    fontSize = 13.sp,
                    color = WarnColor,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            Row(Modifier.fillMaxWidth().padding(top = 12.dp)) {
                Text(
                    text = when (phase.value) {
                        PrPhase.IDLE -> "▶ 演一遍"
                        PrPhase.DONE -> "↻ 再看一遍"
                        else -> "播放中…"
                    },
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (playing) Color(0xFF94A3B8) else Color.White,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (playing) Color(0xFFE2E8F0) else Color(0xFF2563EB))
                        .clickable(enabled = !playing) { runToken.value += 1 }
                        .padding(vertical = 11.dp),
                )
            }

            Text(
                "有小括号先算括号里 · 没有括号，先乘除后加减 · 同级从左往右。\n" +
                    "算式里绿底的数，是前面算出来的。",
                fontSize = 12.sp,
                color = Slate,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
    }
}

@Composable
private fun PrSlotView(
    slot: PrSlot,
    picked: Boolean,
    /** 0 = 不判级 · 1 = 加减（下沉）· 2 = 乘除（抬起） */
    level: Int,
    wait: Boolean,
    grown: Boolean,
) {
    val targetWidth = when {
        slot.eaten -> 0.dp
        slot.res -> if (grown) W_NUM else 0.dp
        else -> slot.width
    }
    val w by animateDpAsState(targetWidth, label = "slot-w")
    val dy by animateDpAsState(
        when (level) {
            2 -> (-9).dp
            1 -> 9.dp
            else -> 0.dp
        },
        label = "slot-y",
    )
    val scale by animateFloatAsState(if (picked) 1.12f else 1f, label = "slot-scale")
    val alpha by animateFloatAsState(if (wait) 0.55f else 1f, label = "slot-alpha")

    // 槽位：宽度可预知 ⇒ 布局变化完全交给过渡；⚠️ 上下各留出 12dp 位移余量，别把 ±9dp 裁掉
    Row(Modifier.width(w + slot.gap)) {
        Box(
            Modifier
                .width(w)
                .height(60.dp)
                .clipToBounds(),
            contentAlignment = Alignment.Center,
        ) {
            val bg = when {
                slot.res -> DoneBg
                picked -> PickBg
                slot.computed && slot.kind == TokenType.NUM -> DoneBg
                else -> Color.Transparent
            }
            val fg = when {
                slot.kind == TokenType.OP && isMd(slot.text) -> MdColor
                slot.kind == TokenType.OP -> AsColor
                else -> Black
            }
            Text(
                text = slot.text,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = fg,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .offset(y = dy)
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        this.alpha = alpha
                    }
                    .clip(RoundedCornerShape(8.dp))
                    .background(bg)
                    .fillMaxWidth(),
            )
        }
        if (slot.gap > 0.dp) {
            Box(Modifier.width(slot.gap).height(60.dp))
        }
    }
}

// ────────────────────────────────────────────────────────────
// 槽位表 / 定位 / 文案
// ────────────────────────────────────────────────────────────

private fun slotOf(t: PToken, src: Int, key: String): PrSlot =
    PrSlot(key = key, kind = t.type, text = t.text, src = src, computed = t.computed)

private fun buildSlots(tokens: List<PToken>, joining: PStep?, joined: Boolean): List<PrSlot> {
    if (joining == null) {
        return tokens.mapIndexed { i, t -> slotOf(t, i, "t$i") }
    }
    val i = joining.index
    val out = mutableListOf<PrSlot>()
    for (k in 0 until i - 1) {
        out.add(slotOf(tokens[k], k, "a$k"))
    }
    // 被「吃」掉的三块（数字 / 运算符 / 数字）
    for (k in (i - 1)..(i + 1)) {
        out.add(slotOf(tokens[k], k, "e$k").copyEaten(joined))
    }
    out.add(
        PrSlot(
            key = "res",
            kind = TokenType.NUM,
            text = joining.value.toString(),
            src = -1,
            computed = true,
            res = true,
        ),
    )
    for (k in (i + 2) until tokens.size) {
        out.add(slotOf(tokens[k], k, "b$k"))
    }
    return out
}

private fun PrSlot.copyEaten(e: Boolean): PrSlot =
    PrSlot(key, kind, text, src, computed, eaten = e, res = res)

/** 槽位中心相对行左沿的位置（定宽 ⇒ 可直接累加） */
private fun slotCenterX(slots: List<PrSlot>, index: Int): Dp {
    var x = 0.dp
    slots.forEachIndexed { i, s ->
        val w = if (s.eaten) 0.dp else s.width
        if (i == index) return x + w / 2
        x += w + s.gap
    }
    return x
}

private fun hintOf(
    phase: PrPhase,
    step: PStep?,
    joining: PStep?,
    cursor: Int,
    tokens: List<PToken>,
    trace: List<PStep>,
): String = when (phase) {
    PrPhase.IDLE -> "点「演一遍」，看谁先算。"
    PrPhase.INTRO -> "摆好了 —— 别急着从左往右，先比一比谁先算。"
    PrPhase.JUDGE, PrPhase.PICK -> {
        val s = step
        when {
            s == null -> ""
            s.why == PWhy.HIGHER ->
                "乘除「${s.op}」高一级，先算；加减「${s.siblings.joinToString("、")}」再靠左也得等。"
            s.why == PWhy.SAME_LEVEL ->
                if (s.siblings.isEmpty()) {
                    "只剩「${s.op}」一个运算符了，算它。"
                } else {
                    "「${s.op}」和「${s.siblings.joinToString("、")}」同级，谁也不能插队 ⇒ " +
                        "从左往右，先碰到谁先算。"
                }
            s.siblings.isEmpty() -> "括号里先算，规矩一样：先乘除、后加减。"
            else ->
                "括号里先算，规矩不变：先乘除「${s.op}」、后加减「${s.siblings.joinToString("、")}」。"
        }
    }
    PrPhase.JOIN -> joining?.let {
        "第 ${cursor + 1} 步：${it.left} ${it.op} ${it.right} = ${it.value} —— 三个块并成一个数。"
    }.orEmpty()
    PrPhase.SETTLE -> "化简一步之后：${tokens.joinToString(" ") { it.text }}"
    PrPhase.DONE -> "一路算下来：${trace.joinToString("，然后 ") { "${it.left} ${it.op} ${it.right} = ${it.value}" }}。"
}
