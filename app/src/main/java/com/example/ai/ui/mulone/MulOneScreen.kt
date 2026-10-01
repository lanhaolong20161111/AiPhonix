package com.example.ai.ui.mulone

import android.content.Context
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.math.MO_KIND_GROUPS
import com.example.ai.data.math.MO_MISTAKE_CASES
import com.example.ai.data.math.MO_RULES
import com.example.ai.data.math.MoBeat
import com.example.ai.data.math.MoKind
import com.example.ai.data.math.MoMistakeCase
import com.example.ai.data.math.MoPlan
import com.example.ai.data.math.MoProblem
import com.example.ai.data.math.MoSolveStep
import com.example.ai.data.math.MoTrap
import com.example.ai.data.math.MoView
import com.example.ai.data.math.moPlaceName
import com.example.ai.ui.icon.MathIcon

/**
 * 三年级上 · 多位数乘一位数 —— 「竖式逐位四拍」+「位值点阵」双机制演示页
 *
 * 对齐 web/src/pages/MathMulOnePage.tsx。所有数字（含高亮位置）都来自
 * `data/math/MulOne.kt` 的 `moPlanSteps` / `moViewOf`，
 * 页面自己不做任何加减，也不自己判断该亮哪一格。
 *
 * 这一页要解决的真问题：孩子算 `27 × 4` 写成 88，不是不会背「四七二十八」，
 * 而是**算完十位就忘了把个位进上来的 2 加进去**。所以把竖式拆成逐位四拍、
 * 每一拍配一个视觉动作，并用位值点阵回答**为什么一定要从个位乘起**。
 *
 * 配色沿用全站：正确绿 #16A34A · 错误红 #DC2626 · 强调蓝 #2563EB · 进位橙 #EA580C
 */
private val InkColor = Color(0xFF0F172A)
private val Grey = Color(0xFF6B7280)
private val Faint = Color(0xFF94A3B8)
private val MdColor = Color(0xFF2563EB)
private val AsColor = Color(0xFFEA580C)
private val OkColor = Color(0xFF16A34A)
private val BadColor = Color(0xFFDC2626)
private val BorderColor = Color(0xFFCBD5E1)
private val ChipBg = Color(0xFFF1F5F9)

/** 高亮涂装（只改颜色不改布局 —— 布局一旦重排，学生就跟不住位置了） */
private val HlBg = Color(0xFFFEF3C7)
private val HlBorder = Color(0xFFEA580C)
private val HlWriteBg = Color(0xFFDCFCE7)
private val HlWriteBorder = Color(0xFF16A34A)
private val HlTopBg = Color(0xFFDBEAFE)
private val HlTopBorder = Color(0xFF2563EB)
private val HlCarryBg = Color(0xFFDBEAFE)
private val LitAmber = Color(0xFFFDE68A)

private val CellW = 34.dp

/** 点阵：每行固定 10 个 —— 就是「十格框」，一眼能看出满十成捆 */
private const val DOTS_PER_ROW = 10

/***************************************
 * 页面
 ***************************************/

@Composable
fun MulOneScreen(
    onBack: () -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: MulOneViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val reduced = remember { animationsDisabled(context) }

    LazyColumn(
        modifier = modifier.fillMaxSize().navigationBarsPadding(),
        contentPadding = PaddingValues(bottom = 32.dp),
    ) {
        item(key = "top") {
            TopBar(title = "✏️ 多位数乘一位数", onBack = onBack)
            Text(
                "逐位四拍：乘 → 加进位 → 写 → 进。点阵里满 10 扎 1 捆、往左送。",
                fontSize = 13.sp,
                color = Grey,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp),
            )
        }

        item(key = "chips") {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ChatChip(
                        text = if (state.showRules) "收起规律" else "📌 规律",
                        modifier = Modifier.weight(1f),
                        onClick = viewModel::toggleRules,
                    )
                    ChatChip(
                        text = if (state.showWhy) "收起原理" else "🔎 为什么从个位乘起",
                        modifier = Modifier.weight(1f),
                        onClick = viewModel::toggleWhy,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ChatChip(
                        text = if (state.showMistakes) "收起易错" else "⚠️ 易错 7 例",
                        modifier = Modifier.weight(1f),
                        onClick = viewModel::toggleMistakes,
                    )
                }
            }
        }

        if (state.showRules) {
            item(key = "rules") { RulesCard() }
        }
        if (state.showWhy) {
            item(key = "why") { WhyOnes() }
        }
        if (state.showMistakes) {
            item(key = "mistake-title") {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text("易错 7 例", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
                }
            }
            items(MO_MISTAKE_CASES.size, key = { "mk|${MO_MISTAKE_CASES[it].wrong}" }) { i ->
                MistakeCard(MO_MISTAKE_CASES[i])
            }
        }

        item(key = "main") {
            MainStage(
                state = state,
                onKind = viewModel::newProblem,
                onPlay = { viewModel.play(reduced) },
                onStep = viewModel::step,
                onReset = viewModel::reset,
                onNew = { viewModel.newProblem(state.kind) },
            )
        }

        item(key = "practice") {
            PracticeSection(
                state = state,
                onGroup = viewModel::newProblem,
                onReshuffle = viewModel::regenDrill,
                onGrade = viewModel::gradeStep,
                onFinished = viewModel::finishCard,
            )
        }
    }
}

/** 系统「关闭动画」（开发者选项里把动画缩放设为「关闭」）时直接跳完成态 */
private fun animationsDisabled(context: Context): Boolean = runCatching {
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
}.getOrDefault(false)

/***************************************
 * 通用小件
 ***************************************/

@Composable
private fun TopBar(title: String, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onBack, modifier = Modifier.width(48.dp)) {
            Text("←", fontSize = 20.sp, color = InkColor)
        }
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = InkColor)
    }
}

/**
 * 可点击但 disabled 时不吃点击。
 * ⚠️ 必须写成 @Composable 扩展：内部要用 remember 造 MutableInteractionSource。
 */
@Composable
private fun Modifier.clickableNoRipple(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    val interaction = remember { MutableInteractionSource() }
    return this.then(
        if (enabled) {
            Modifier.clickable(interactionSource = interaction, indication = null, onClick = onClick)
        } else {
            Modifier
        },
    )
}

@Composable
private fun SectionCard(content: @Composable () -> Unit) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(14.dp)) { content() }
    }
}

@Composable
private fun ChatChip(
    text: String,
    modifier: Modifier = Modifier,
    on: Boolean = false,
    /** ★ 题型卡的图（MathIcons 的键）。传了就画在文字左边 —— 一幅画顶一句描述 */
    icon: String? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (on) HlTopBg else ChipBg)
            .border(if (on) 2.dp else 1.dp, if (on) MdColor else BorderColor, RoundedCornerShape(999.dp))
            .clickableNoRipple(onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            MathIcon(name = icon, size = 18.dp, tint = if (on) MdColor else Grey)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, fontSize = 13.sp, color = InkColor, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ActionButton(
    text: String,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Text(
        text = text,
        fontSize = 13.sp,
        color = if (!enabled) Faint else if (primary) Color.White else InkColor,
        fontWeight = if (primary) FontWeight.Bold else FontWeight.Normal,
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (primary) MdColor else Color.White)
            .border(1.dp, if (primary) MdColor else BorderColor, RoundedCornerShape(10.dp))
            .clickableNoRipple(enabled = enabled, onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 10.dp),
    )
}

@Composable
private fun RulesCard() {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFBEB)),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            MO_RULES.forEach { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MathIcon(
                        name = r.icon,
                        size = 30.dp,
                        tint = Color(0xFFB45309),
                        modifier = Modifier.padding(end = 10.dp),
                    )
                    Column {
                        Text(r.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = InkColor)
                        Text(r.body, fontSize = 12.sp, color = Grey, modifier = Modifier.padding(top = 2.dp))
                    }
                }
            }
        }
    }
}

/***************************************
 * 主舞台
 ***************************************/

@Composable
private fun MainStage(
    state: MulOneUiState,
    onKind: (MoKind) -> Unit,
    onPlay: () -> Unit,
    onStep: () -> Unit,
    onReset: () -> Unit,
    onNew: () -> Unit,
) {
    val plan = state.plan
    val view = state.view

    SectionCard {
        Text("🧮 竖式逐位演一遍：${plan.value} × ${plan.factor}", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Spacer(Modifier.height(10.dp))

        // ── 题型 chips ──
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MO_KIND_GROUPS.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { g ->
                        ChatChip(
                            text = "${g.title}\n${g.desc}",
                            modifier = Modifier.weight(1f),
                            on = state.kind == g.key,
                            icon = g.icon,
                            onClick = { onKind(g.key) },
                        )
                    }
                    repeat(2 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        Spacer(Modifier.height(10.dp))

        // ── 题面 ──
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${plan.value} × ${plan.factor} = ?",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = InkColor,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "${state.group.title} · 积 ${plan.resultDigits.size} 位",
                fontSize = 11.sp,
                color = Grey,
            )
        }
        Spacer(Modifier.height(10.dp))

        // ── 竖式 ──
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            VerticalStage(plan = plan, view = view)
        }
        Spacer(Modifier.height(10.dp))

        // ── 关键区域说明条：告诉学生「现在看这里」 ──
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFFF8FAFC))
                .border(1.dp, BorderColor, RoundedCornerShape(10.dp))
                .padding(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    mulOneBeatLabel(view.beat),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(
                            when (view.beat) {
                                MoBeat.ADD -> AsColor
                                MoBeat.CARRY -> MdColor
                                MoBeat.WRITE -> OkColor
                                MoBeat.DONE -> OkColor
                                else -> Grey
                            },
                        )
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(state.beatEquation, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MdColor, modifier = Modifier.weight(1f))
                Text(state.progressText, fontSize = 11.sp, color = Grey)
            }
            // ⚠️ 口诀取自当前位 —— 但「还没开始」时 view.place 可能越界，
            //    所以先 getOrNull 取出来再判空，别直接下标。
            val chant = plan.steps.getOrNull(view.place)?.chant.orEmpty()
            if (view.hl.chant && chant.isNotEmpty()) {
                Text(
                    "口诀：$chant",
                    fontSize = 12.sp,
                    color = AsColor,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Text(view.say, fontSize = 13.sp, color = InkColor, modifier = Modifier.padding(top = 6.dp))
            if (view.warn.isNotEmpty()) {
                Text("⚠️ ${view.warn}", fontSize = 12.sp, color = BadColor, modifier = Modifier.padding(top = 4.dp))
            }
        }
        Spacer(Modifier.height(8.dp))

        // ── 图例 ──
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            LegendSwatch(LitAmber, "正在乘的这一位")
            LegendSwatch(HlCarryBg, "进上来的数")
            LegendSwatch(HlWriteBg, "刚写下的数")
        }
        Spacer(Modifier.height(10.dp))

        // ── 控制 ──
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton(
                text = state.playButtonText,
                modifier = Modifier.weight(1f),
                primary = true,
                enabled = !state.playing,
                onClick = onPlay,
            )
            ActionButton(
                text = "⏭ 下一步",
                modifier = Modifier.weight(1f),
                enabled = !state.finished,
                onClick = onStep,
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton(
                text = "⟲ 重来",
                modifier = Modifier.weight(1f),
                enabled = state.index >= 0,
                onClick = onReset,
            )
            ActionButton(text = "🎲 换一题", modifier = Modifier.weight(1f), onClick = onNew)
        }

        // ── 位值点阵（与竖式同一拍，不另起一段动画）──
        Spacer(Modifier.height(14.dp))
        PlaceStage(plan = plan, view = view)

        // ── 巧算对照：只有末尾有 0 时才出现 ──
        state.tail?.let { t ->
            Spacer(Modifier.height(14.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFFFFBEB))
                    .border(1.dp, LitAmber, RoundedCornerShape(10.dp))
                    .padding(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MathIcon(
                        name = "zeroTail",
                        size = 22.dp,
                        tint = Color(0xFFB45309),
                        modifier = Modifier.padding(end = 8.dp),
                    )
                    Text("末尾有 0：这样算更快", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = InkColor)
                }
                Spacer(Modifier.height(8.dp))
                TailStep("①", "先算 ${t.core} × ${plan.factor} = ${t.coreProduct}")
                TailStep("②", "末尾有 ${t.zeros} 个 0")
                TailStep("③", "补 ${t.zeros} 个 0 ⇒ ${plan.value} × ${plan.factor} = ${plan.product}")
                Text(
                    "⚠️ 最容易漏第 ③ 步 —— 写完回头数一数有几个 0。",
                    fontSize = 12.sp,
                    color = BadColor,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }

        // ── 完成态 ──
        if (state.finished) {
            Spacer(Modifier.height(14.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFF0FDF4))
                    .border(1.dp, Color(0xFFBBF7D0), RoundedCornerShape(10.dp))
                    .padding(12.dp),
            ) {
                Text(
                    "${plan.value} × ${plan.factor} = ${plan.product}",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = OkColor,
                )
                Text(
                    "${plan.steps.size} 位 · ${state.carryCount} 次进位" +
                        if (plan.grewTop) " · 最前面还长出一位" else "",
                    fontSize = 12.sp,
                    color = InkColor,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Text(
                    "校验：各位拼回去 = ${state.productFromPlan} ✓",
                    fontSize = 12.sp,
                    color = Grey,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun TailStep(n: String, text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.Top) {
        Text(n, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = AsColor, modifier = Modifier.padding(end = 6.dp))
        Text(text, fontSize = 13.sp, color = InkColor)
    }
}

@Composable
private fun LegendSwatch(color: Color, text: String) {
    Column(Modifier.width(88.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(10.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(color)
                .border(1.dp, BorderColor, RoundedCornerShape(3.dp)),
        )
        Text(text, fontSize = 9.sp, color = Grey, modifier = Modifier.padding(top = 3.dp))
    }
}

/***************************************
 * 竖式（高亮关键区域）
 ***************************************/

@Composable
private fun VerticalStage(plan: MoPlan, view: MoView) {
    val cols = plan.cols
    // 左起第 c 列 → 位下标（最右列 = 个位）
    fun placeOfCol(c: Int) = cols - 1 - c

    Column {
        // ── 进位行：小数字写在**它要被加进去的那一位**头上 ──
        Row {
            for (c in 0 until cols) {
                val place = placeOfCol(c)
                val v = view.carryCells.getOrNull(place)
                Box(Modifier.width(CellW).height(20.dp), contentAlignment = Alignment.Center) {
                    if (v != null) {
                        val on = view.hl.carryIn == place
                        Text(
                            v.toString(),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (on) MdColor else Grey,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(if (on) HlCarryBg else Color.Transparent)
                                .padding(horizontal = 4.dp),
                        )
                    }
                }
            }
        }

        // ── 被乘数行 ──
        Row {
            for (c in 0 until cols) {
                val place = placeOfCol(c)
                val d = plan.digits.getOrNull(place)
                NumberCell(
                    text = d?.toString() ?: "",
                    on = view.hl.digit == place,
                    bg = HlBg,
                    lineColor = HlBorder,
                )
            }
        }

        // ── 一位数行：× 落在十位那一列，个位数落在个位列（教材写法）──
        Row {
            for (c in 0 until cols) {
                val place = placeOfCol(c)
                when (place) {
                    0 -> NumberCell(
                        text = plan.factor.toString(),
                        on = view.hl.factor,
                        bg = HlBg,
                        lineColor = HlBorder,
                    )
                    1 -> NumberCell(
                        text = "×",
                        on = view.hl.op,
                        bg = HlBg,
                        lineColor = HlBorder,
                    )
                    else -> Box(Modifier.width(CellW).height(30.dp))
                }
            }
        }

        // ── 横线 ──
        Box(
            Modifier
                .width(CellW * cols)
                .height(2.dp)
                .background(InkColor),
        )

        // ── 积 ──
        Row {
            for (c in 0 until cols) {
                val place = placeOfCol(c)
                val v = view.resultCells.getOrNull(place)
                val isTop = plan.grewTop && place == plan.resultDigits.size - 1
                val topCarry = view.hl.topCarry && isTop
                NumberCell(
                    text = v?.toString() ?: "",
                    on = topCarry,
                    bg = HlTopBg,
                    lineColor = HlTopBorder,
                    // 刚落笔的那一格用绿色（与「正在乘的这一位」的琥珀色区分开）
                    altOn = view.hl.write == place,
                    altBg = HlWriteBg,
                    altLine = HlWriteBorder,
                )
            }
        }
    }
}

/**
 * 竖式里的一格数字。
 *
 * ⚠️ 高亮**只改涂装、不改尺寸** —— 一旦高亮让格子变大，整行就会重排，
 *    学生刚跟上的位置会跳走。所以两个分支的 width/height 完全一致。
 */
@Composable
private fun NumberCell(
    text: String,
    on: Boolean,
    bg: Color,
    lineColor: Color,
    altOn: Boolean = false,
    altBg: Color = Color.Transparent,
    altLine: Color = Color.Transparent,
) {
    val active = on || altOn
    Box(
        Modifier
            .width(CellW)
            .height(30.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (active) (if (altOn && !on) altBg else bg) else Color.Transparent)
            .border(
                if (active) 2.dp else 0.dp,
                if (active) (if (altOn && !on) altLine else lineColor) else Color.Transparent,
                RoundedCornerShape(6.dp),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = InkColor)
    }
}

/***************************************
 * 位值点阵（进位到底是什么）
 ***************************************/

/** 每个点该穿什么颜色：这一拍里，它是「刚乘出来的 / 送来的 / 要被捆走的 / 留下的」 */
private fun dotColor(i: Int, step: com.example.ai.data.math.MoStep, beat: MoBeat): Color = when (beat) {
    MoBeat.MUL -> if (i < step.base) MdColor else BorderColor
    MoBeat.ADD -> if (i < step.base) MdColor else AsColor
    // 一旦算完，就按「满十成捆」分：前 `sum - write` 个点要被扎成捆送到左边，其余留下
    else -> if (i < step.sum - step.write) AsColor else OkColor
}

@Composable
private fun PlaceStage(plan: MoPlan, view: MoView) {
    val place = view.place.coerceIn(0, plan.steps.size - 1)
    val s = plan.steps[place]
    val idle = view.beat == MoBeat.IDLE

    // 点阵里一共露几个点：乘的那一拍只露出 base（进位还没来）
    val shown = when (view.beat) {
        MoBeat.IDLE -> 0
        MoBeat.MUL -> s.base
        else -> s.sum
    }
    val bundling = s.sum - s.write

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFFF8FAFC))
            .border(1.dp, BorderColor, RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MathIcon(name = "bundle", size = 20.dp, tint = MdColor)
            Spacer(Modifier.width(8.dp))
            Text("位值点阵", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = InkColor)
            Spacer(Modifier.width(8.dp))
            Text("满 10 扎 1 捆，往左送", fontSize = 11.sp, color = Grey)
        }
        Spacer(Modifier.height(8.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                moPlaceName(place),
                fontSize = 11.sp,
                color = Color.White,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(MdColor)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
            Spacer(Modifier.width(8.dp))
            // ⚠️ 没有进位时别再写一次「= 35」：`5 × 7 = 35 = 35` 读起来像两个数
            Text(
                if (s.carryIn > 0) "${s.digit} × ${plan.factor} = ${s.base} ＋ ${s.carryIn} = ${s.sum}"
                else "${s.digit} × ${plan.factor} = ${s.base}",
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = InkColor,
            )
        }
        Spacer(Modifier.height(8.dp))

        if (shown == 0) {
            Text("这一位是 0 个点", fontSize = 12.sp, color = Grey)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                (0 until shown).chunked(DOTS_PER_ROW).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        row.forEach { i ->
                            Box(
                                Modifier
                                    .size(12.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(if (idle) BorderColor else dotColor(i, s, view.beat)),
                            )
                        }
                        // 补齐，让每行的点都从同一列起（十格框的意义就在这里）
                        repeat(DOTS_PER_ROW - row.size) { Spacer(Modifier.size(12.dp)) }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))

        Text(placeCaption(plan, view, place, s, idle), fontSize = 12.sp, color = InkColor)

        if (!idle && s.carryOut > 0 && (view.beat == MoBeat.CARRY || view.beat == MoBeat.WRITE)) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "×${s.carryOut} 捆",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(AsColor)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                )
                Text(
                    "← 送 ${s.carryOut} 到${moPlaceName(place + 1)}",
                    fontSize = 12.sp,
                    color = AsColor,
                    modifier = Modifier.weight(1f),
                )
                Text("留 ${s.write} 个", fontSize = 12.sp, color = OkColor)
            }
        }
        if (!idle && (view.beat == MoBeat.CARRY || view.beat == MoBeat.WRITE) && s.carryOut == 0) {
            Spacer(Modifier.height(8.dp))
            Text(
                "共 ${s.sum} 个 · 不满 10，扎不成捆",
                fontSize = 12.sp,
                color = Grey,
            )
        }

        Spacer(Modifier.height(8.dp))
        Text(
            "${s.sum} 个点里有 $bundling 个扎捆送左边。" +
                if (place == 0 && s.carryOut > 0) "个位不先算完，十位不知道加几。" else "",
            fontSize = 11.sp,
            color = Grey,
        )
    }
}

/** 点阵下方那句「当下正在发生什么」（对齐 web 的 caption 链） */
private fun placeCaption(
    plan: MoPlan,
    view: MoView,
    place: Int,
    s: com.example.ai.data.math.MoStep,
    idle: Boolean,
): String = when (view.beat) {
    MoBeat.IDLE -> "等一下算${moPlaceName(place)}"
    MoBeat.MUL ->
        "${s.digit} × ${plan.factor} ⇒ 先画 ${s.base} 个点"
    MoBeat.ADD ->
        if (s.carryIn > 0) "加上右边送来的 ${s.carryIn} 个（橙色）⇒ ${s.sum} 个"
        else "右边没送来，一共 ${s.base} 个"
    MoBeat.WRITE ->
        if (s.carryOut > 0) "每 10 个扎 1 捆 ⇒ ${s.carryOut} 捆，留 ${s.write} 个"
        else "${s.sum} 个不够扎一捆 ⇒ 全部留下"
    MoBeat.CARRY ->
        if (s.carryOut > 0) "${s.carryOut} 捆往左送到${moPlaceName(place + 1)} ⇒ 就是「进 ${s.carryOut}」"
        else "不满 10，不用往左送"
    MoBeat.DONE -> "${plan.value} × ${plan.factor} = ${plan.product}"
}

/***************************************
 * 为什么一定要从个位乘起
 ***************************************/

@Composable
private fun WhyOnes() {
    SectionCard {
        Text("为什么从个位乘起", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Spacer(Modifier.height(10.dp))
        // ★ 方框按竖式的顺序摆（百位在左、个位在右），箭头朝左 —— 与「进位往左走」一致
        Row(verticalAlignment = Alignment.CenterVertically) {
            MathIcon(name = "arrowLeft", size = 28.dp, tint = MdColor)
            Spacer(Modifier.width(4.dp))
            WhyBox("百位", OkColor)
            Text("  ←  ", fontSize = 14.sp, color = Grey)
            WhyBox("十位", AsColor)
            Text("  ←  ", fontSize = 14.sp, color = Grey)
            WhyBox("个位", MdColor)
        }
        Spacer(Modifier.height(10.dp))
        Text(
            "进位只能往左走：个位攒够 10 才送得出一捆，十位在个位算完前不知道该加几。",
            fontSize = 12.sp,
            color = InkColor,
        )
    }
}

@Composable
private fun WhyBox(text: String, color: Color) {
    Text(
        text,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        color = Color.White,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/***************************************
 * 易错警示
 ***************************************/

@Composable
private fun MistakeCard(c: MoMistakeCase) {
    var revealed by remember(c.wrong) { mutableStateOf(false) }
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (revealed) Color(0xFFF0FDF4) else Color(0xFFFEF2F2),
        ),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text("❌ ${c.wrong}", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = BadColor)
            if (revealed) {
                Spacer(Modifier.height(8.dp))
                Text("✅ ${c.right}", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = OkColor)
                Text(c.why, fontSize = 12.sp, color = InkColor, modifier = Modifier.padding(top = 6.dp))
                Text("💡 ${c.tip}", fontSize = 12.sp, color = Grey, modifier = Modifier.padding(top = 4.dp))
            } else {
                Spacer(Modifier.height(8.dp))
                ActionButton(
                    text = "看正确答案",
                    modifier = Modifier.width(190.dp),
                    onClick = { revealed = true },
                )
            }
        }
    }
}

/***************************************
 * 一步一填练习
 ***************************************/

@Composable
private fun PracticeSection(
    state: MulOneUiState,
    onGroup: (MoKind) -> Unit,
    onReshuffle: () -> Unit,
    onGrade: (Boolean) -> Unit,
    onFinished: () -> Unit,
) {
    SectionCard {
        Text("✍️ 一步一填", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Spacer(Modifier.height(10.dp))

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MO_KIND_GROUPS.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { g ->
                        ChatChip(
                            text = g.title,
                            modifier = Modifier.weight(1f),
                            on = state.kind == g.key,
                            icon = g.icon,
                            onClick = { onGroup(g.key) },
                        )
                    }
                    repeat(2 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        Spacer(Modifier.height(10.dp))

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "答对 ${state.drillCorrect} / ${state.drillAnswered}" +
                    if (state.drillDone) " · 本组完成 🎉" else "",
                fontSize = 12.sp,
                color = InkColor,
                modifier = Modifier.weight(1f),
            )
            ActionButton(text = "⟳ 换一组", onClick = onReshuffle)
        }
        Spacer(Modifier.height(10.dp))

        // ★ key 里带 drillRound：换一组时整批卡片重新挂载，清掉上一组的作答状态
        state.drill.forEachIndexed { i, p ->
            key(state.drillRound, i) {
                SolveCard(p = p, onStep = onGrade, onFinished = onFinished)
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
private fun SolveCard(p: MoProblem, onStep: (Boolean) -> Unit, onFinished: () -> Unit) {
    var stepIndex by remember(p) { mutableStateOf(0) }
    var picked by remember(p) { mutableStateOf<String?>(null) }
    var rightCount by remember(p) { mutableStateOf(0) }
    var trail by remember(p) { mutableStateOf(listOf<Pair<String, Boolean>>()) }

    val done = stepIndex >= p.solveSteps.size
    val step: MoSolveStep? = p.solveSteps.getOrNull(stepIndex)
    val answered = picked != null
    val isRight = answered && picked == step?.answer
    val isLast = step != null && stepIndex == p.solveSteps.size - 1

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (done) Color(0xFFF0FDF4) else Color(0xFFF8FAFC))
            .border(1.dp, if (done) Color(0xFFBBF7D0) else BorderColor, RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        if (done) {
            Text(
                "${p.value} × ${p.factor} = ${p.product} ✓",
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                color = OkColor,
            )
            Text(p.finalNote, fontSize = 12.sp, color = InkColor, modifier = Modifier.padding(top = 4.dp))
            if (p.traps.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("这几个答案也常有人写：", fontSize = 12.sp, color = Grey)
                Spacer(Modifier.height(4.dp))
                p.traps.forEach { TrapRow(it) }
            }
            Text(
                "答对 $rightCount / ${p.solveSteps.size}",
                fontSize = 11.sp,
                color = Grey,
                modifier = Modifier.padding(top = 8.dp),
            )
            return@Column
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${p.value} × ${p.factor} = ?", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = InkColor)
            Spacer(Modifier.weight(1f))
            Text("第 ${stepIndex + 1} / ${p.solveSteps.size} 步", fontSize = 11.sp, color = Grey)
        }

        if (trail.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                trail.forEach { (label, ok) ->
                    Text(
                        (if (ok) "✓ " else "✗ ") + label,
                        fontSize = 10.sp,
                        color = if (ok) OkColor else BadColor,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(Color.White)
                            .border(1.dp, if (ok) OkColor else BadColor, RoundedCornerShape(999.dp))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
        }

        if (step != null) {
            Spacer(Modifier.height(10.dp))
            Text(step.label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MdColor)
            Text(step.ask, fontSize = 14.sp, color = InkColor, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(8.dp))

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                step.options.chunked(3).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { o ->
                            val bg = when {
                                !answered -> Color.White
                                o == step.answer -> Color(0xFFDCFCE7)
                                o == picked -> Color(0xFFFEE2E2)
                                else -> Color(0xFFF1F5F9)
                            }
                            val fg = when {
                                !answered -> InkColor
                                o == step.answer -> OkColor
                                o == picked -> BadColor
                                else -> Faint
                            }
                            Text(
                                text = o,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                color = fg,
                                textAlign = TextAlign.Center,
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(bg)
                                    .border(1.dp, BorderColor, RoundedCornerShape(8.dp))
                                    .clickableNoRipple(enabled = !answered) {
                                        picked = o
                                        val ok = o == step.answer
                                        if (ok) rightCount += 1
                                        onStep(ok)
                                    }
                                    .padding(vertical = 10.dp),
                            )
                        }
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }

            if (answered) {
                Spacer(Modifier.height(10.dp))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (isRight) Color(0xFFF0FDF4) else Color(0xFFFEF2F2))
                        .padding(10.dp),
                ) {
                    Text(
                        if (isRight) "✓ 答对了" else "✗ 正确答案是「${step.answer}」",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isRight) OkColor else BadColor,
                    )
                    Text(step.tip, fontSize = 12.sp, color = InkColor, modifier = Modifier.padding(top = 4.dp))
                    Spacer(Modifier.height(8.dp))
                    ActionButton(
                        text = if (isLast) "完成这道题" else "下一步 →",
                        modifier = Modifier.width(170.dp),
                        primary = true,
                        onClick = {
                            trail = trail + (step.label to (picked == step.answer))
                            stepIndex += 1
                            picked = null
                            if (isLast) onFinished()
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun TrapRow(t: MoTrap) {
    var open by remember(t.label) { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color.White)
            .border(1.dp, BorderColor, RoundedCornerShape(8.dp)),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickableNoRipple { open = !open }
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(t.label, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = BadColor, modifier = Modifier.weight(1f))
            Text(if (open) "收起" else "错在哪？", fontSize = 11.sp, color = MdColor)
        }
        if (open) {
            Text(
                t.why,
                fontSize = 12.sp,
                color = InkColor,
                modifier = Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp),
            )
        }
    }
}
