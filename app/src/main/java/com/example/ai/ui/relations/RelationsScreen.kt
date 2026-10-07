package com.example.ai.ui.relations

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateIntOffsetAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.math.RL_EFFECT_LABEL
import com.example.ai.data.math.RL_KIND_GROUPS
import com.example.ai.data.math.RL_KIND_LABEL
import com.example.ai.data.math.RL_MISTAKE_CASES
import com.example.ai.data.math.RL_ROLE_META
import com.example.ai.data.math.RL_RULES
import com.example.ai.data.math.RL_SWAP_TABLE
import com.example.ai.data.math.RlKind
import com.example.ai.data.math.RlLine
import com.example.ai.data.math.RlMistakeCase
import com.example.ai.data.math.RlProblem
import com.example.ai.data.math.RlQuantity
import com.example.ai.data.math.RlRole
import com.example.ai.data.math.RlShape
import com.example.ai.data.math.RlSolveStep
import com.example.ai.ui.icon.MathIcon

/**
 * 数量关系与交换 —— 教学演示页（对齐 web 侧 `math_relations`）。
 *
 * ── 这一页只演一件事：**换个位置会怎样** ─────────────────────────
 *   一共    两边同色 ⇒ 换了什么都不变
 *   比多少  一青一橙 ⇒ 换了，词从「多」翻成「少」
 *   倍数    一青一橙 ⇒ 换了，从 n 倍掉到 1/n
 *   平均分  一青一橙 ⇒ 换了，问的已经不是同一个问题
 *
 * ── ★ 颜色标的是「角色」，不是「大小」 ──────────────────────────
 * 「按大小上色」（多的红、少的蓝）在这一页必然失效：交换前后 7 还是 7、
 * 4 还是 4，颜色一模一样，学生看不出发生过任何事。
 * 所以颜色**挂在槽位上**：交换时量在位移、槽位不动 ⇒ 两个色块对调。
 * 学生看到的是「还是那 4 个，但它变成橙色的了」——一句话就懂：
 * **它的角色变了，所以结论变了。**
 *
 * ★ 位移的唯一真源是 phase，不是动画值：`t = if (flying) fly.value else 0f`。
 *   于是「落位那一帧」与「内容对调」在**同一次组合**里发生，肉眼看不出接缝。
 *   若反过来（动画结束后再切 phase），会有一帧把已落位的块再推出去一个槽位。
 *
 * 所有数字、句子、点阵排布都来自 `data/math/Relations.kt`，
 * 页面自己不做任何运算，也不自己判断该说「多」还是「少」。
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
private val StageBg = Color(0xFFF8FAFC)
private val GridTrack = Color(0xFFF1F5F9)

/** 槽位间距 —— ★ 位移终点必须正好等于「一个槽位宽 ＋ 这个间距」，否则落位有缝 */
private val SLOT_GAP = 12.dp

/** 点阵格子间距上限（宽槽装不下时按槽宽等比缩，两块共用同一个值才可比长短） */
private val PITCH = 10.dp

/***************************************
 * 页面
 ***************************************/

@Composable
fun RelationsScreen(
    onBack: () -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: RelationsViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val reduced = remember { animationsDisabled(context) }

    LazyColumn(
        modifier = modifier.fillMaxSize().navigationBarsPadding(),
        contentPadding = PaddingValues(bottom = 32.dp),
    ) {
        item(key = "top") {
            TopBar(title = "🔁 数量关系与交换", onBack = onBack)
            Text(
                "一共 · 比多少 · 倍数 · 平均分 —— 换个位置，谁变了、谁没变。",
                fontSize = 13.sp,
                color = Grey,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp),
            )
        }

        // ── 规律卡：颜色说明 ──
        item(key = "rules") { RulesCard() }

        // ── 主舞台 ──
        item(key = "main") {
            MainStage(
                state = state,
                reduced = reduced,
                onKind = viewModel::newProblem,
                onPlay = { viewModel.play(reduced) },
                onStep = viewModel::step,
                onReset = viewModel::reset,
                onNew = { viewModel.newProblem(state.kind) },
            )
        }

        // ── 四类对照（一条纲） ──
        item(key = "table") { SwapTableCard() }

        // ── 易错警示 ──
        item(key = "mistake-title") {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                Text("最容易错的 6 个地方", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
            }
        }
        items(RL_MISTAKE_CASES.size, key = { "mk|${RL_MISTAKE_CASES[it].wrong}" }) { i ->
            MistakeCard(RL_MISTAKE_CASES[i])
        }

        // ── 一步一填 ──
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

/** 胶囊按钮。on = 选中态；disabled 时文字变淡、不吃点击 */
@Composable
private fun ChatChip(
    text: String,
    modifier: Modifier = Modifier,
    on: Boolean = false,
    icon: String? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (on) Color(0xFFDBEAFE) else ChipBg)
            .border(if (on) 2.dp else 1.dp, if (on) MdColor else BorderColor, RoundedCornerShape(999.dp))
            .clickableNoRipple(enabled = enabled, onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            MathIcon(name = icon, size = 18.dp, tint = if (on) MdColor else Grey)
            Spacer(Modifier.width(6.dp))
        }
        Text(
            text,
            fontSize = 13.sp,
            color = if (enabled) InkColor else Faint,
            textAlign = TextAlign.Center,
        )
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
            RL_RULES.forEach { r ->
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
            // 图例：一眼分清「基准 / 比较 / 对等」三档色
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                LegendItem(RlRole.BASE, "基准量")
                LegendItem(RlRole.CMP, "比较量")
                LegendItem(RlRole.PART, "对等（两边一样）")
            }
        }
    }
}

@Composable
private fun LegendItem(role: RlRole, text: String) {
    val m = RL_ROLE_META.getValue(role)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(Color(m.dot)),
        )
        Spacer(Modifier.width(5.dp))
        Text(text, fontSize = 10.sp, color = Grey)
    }
}

/***************************************
 * 主舞台
 ***************************************/

@Composable
private fun MainStage(
    state: RlUiState,
    reduced: Boolean,
    onKind: (RlKind) -> Unit,
    onPlay: () -> Unit,
    onStep: () -> Unit,
    onReset: () -> Unit,
    onNew: () -> Unit,
) {
    val p = state.problem

    SectionCard {
        Text("🔁 换个位置试试", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Spacer(Modifier.height(10.dp))

        // ── 题型 chips ──
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RL_KIND_GROUPS.chunked(2).forEach { row ->
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

        // ── 状态条：这张卡是同色还是异色 · 现在演到第几阶段 ──
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (state.group.dir) "异色 · 换了就变" else "同色 · 换了不变",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (state.group.dir) AsColor else Grey)
                    .padding(horizontal = 9.dp, vertical = 3.dp),
            )
            Spacer(Modifier.weight(1f))
            Text(state.phaseLabel, fontSize = 11.sp, color = Grey)
        }
        Spacer(Modifier.height(8.dp))

        // ── 舞台 ──
        Stage(p = p, phase = state.phase, runToken = state.runToken, reduced = reduced)
        Spacer(Modifier.height(10.dp))

        // ── 台词区：一句「现在看什么」+ 关系句（要对照的那一小段高亮） ──
        val tone = when {
            !state.showAfter -> SentenceTone.PLAIN
            RL_EFFECT_LABEL.getValue(p.effect).changed -> SentenceTone.CHANGED
            else -> SentenceTone.SAME
        }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(StageBg)
                .border(1.dp, BorderColor, RoundedCornerShape(10.dp))
                .padding(10.dp),
        ) {
            Text(state.phaseSay, fontSize = 12.sp, color = Grey)
            Spacer(Modifier.height(6.dp))
            Sentence(line = if (state.showAfter) p.after else p.before, tone = tone)
            if (state.finished) {
                Spacer(Modifier.height(6.dp))
                Text(p.reveal, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = InkColor)
                Text(p.invariant, fontSize = 12.sp, color = Grey, modifier = Modifier.padding(top = 3.dp))
            }
            val fs = p.factorSwap
            if (state.finished && fs != null) {
                Text(
                    "★ 换个别的位置就不一样了：${fs.text}",
                    fontSize = 12.sp,
                    color = AsColor,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
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
                enabled = state.phase != RlPhase.IDLE,
                onClick = onReset,
            )
            ActionButton(text = "🎲 换一题", modifier = Modifier.weight(1f), onClick = onNew)
        }
    }
}

/***************************************
 * 舞台
 ***************************************/

/**
 * ★ 三段关键帧（0% / 45% / 100%）线性插值。
 * 45% 是两块**正面相交**的时刻：此处必须上下错开，否则它们正面穿过彼此，
 * 实测会叠成一个数谁也看不清（移项页踩过同一个坑）。
 */
private fun keyframe3(t: Float, from: Float, mid: Float, to: Float): Float =
    if (t <= 0.45f) {
        from + (mid - from) * (t / 0.45f)
    } else {
        mid + (to - mid) * ((t - 0.45f) / 0.55f)
    }

@Composable
private fun Stage(p: RlProblem, phase: RlPhase, runToken: Int, reduced: Boolean) {
    val flying = phase == RlPhase.FLYING && !reduced
    val landed = phase == RlPhase.LANDED || phase == RlPhase.CHECK
    // 交换后：两个量对调槽位（**槽位角色不动** ⇒ 颜色跟着槽位走）
    val leftQ = if (landed) p.right else p.left
    val rightQ = if (landed) p.left else p.right
    val roleL = p.slotRole.first
    val roleR = p.slotRole.second

    val fly = remember { Animatable(0f) }
    LaunchedEffect(runToken) { fly.snapTo(0f) }
    LaunchedEffect(flying) {
        if (flying) {
            fly.snapTo(0f)
            fly.animateTo(1f, tween(durationMillis = RL_FLY_MS, easing = CubicBezierEasing(0.45f, 0.05f, 0.35f, 1f)))
        }
    }
    // ★ 位移的唯一真源是 phase —— 一离开 flying 立刻归零，与内容对调同一帧完成
    val t = if (flying) fly.value else 0f

    if (p.kind == RlKind.SHARE && p.shareGrid != null) {
        val sg = p.shareGrid
        val g = if (landed) sg.after else sg.before
        // ★ 容器尺寸写死成「两种分法的最大框」⇒ 排布变化时容器不重排，只有点自己在走位
        val maxShape = RlShape(maxOf(sg.before.rows, sg.after.rows), maxOf(sg.before.cols, sg.after.cols))

        BoxWithConstraints(
            Modifier
                .fillMaxWidth()
                .background(StageBg, RoundedCornerShape(12.dp))
                .padding(12.dp),
        ) {
            val pitch = minOf(PITCH, (maxWidth - 40.dp) / maxShape.cols.coerceAtLeast(1))
                .coerceAtLeast(5.dp)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "总数",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(RL_ROLE_META.getValue(RlRole.WHOLE).fg),
                    )
                    Spacer(Modifier.height(4.dp))
                    DotGrid(
                        shape = g,
                        value = sg.total,
                        maxShape = maxShape,
                        pitch = pitch,
                        dot = Color(RL_ROLE_META.getValue(RlRole.WHOLE).dot),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "${sg.total} 个",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(RL_ROLE_META.getValue(RlRole.WHOLE).fg),
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(SLOT_GAP),
                ) {
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        FlyingWrap(t, toRight = true) { MiniBlock(leftQ, roleL) }
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        FlyingWrap(t, toRight = false) { MiniBlock(rightQ, roleR) }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    if (landed) {
                        "${p.nums.after.first} 份 × 每份 ${p.nums.after.second} 个 —— ${g.rows} 行 ${g.cols} 列"
                    } else {
                        "分成 ${p.nums.before.first} 份，每份 ${p.nums.before.second} 个 —— ${g.rows} 行 ${g.cols} 列"
                    },
                    fontSize = 11.sp,
                    color = Grey,
                )
            }
        }
        return
    }

    // 一共 / 比多少 / 倍数：两个量块并排
    // ★ maxShape 从 p.left / p.right 取（不从交换后的 leftQ/rightQ 取）——
    //   虽然 max 对称，但写成稳定来源能保证「动画中底轨尺寸绝不改变」。
    val maxShape = RlShape(
        maxOf(p.left.shape.rows, p.right.shape.rows),
        maxOf(p.left.shape.cols, p.right.shape.cols),
    )
    val common = if (p.kind == RlKind.TIMES) maxShape else RlShape(1, maxShape.cols)

    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            // ⚠️ 只 background(color, shape)，**不要 clip** —— 一 clip 就把飞行中的块裁掉了
            .background(StageBg, RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 12.dp),
    ) {
        val slotW = (maxWidth - SLOT_GAP) / 2
        val pitch = minOf(PITCH, (slotW - 18.dp) / common.cols.coerceAtLeast(1)).coerceAtLeast(4.dp)
        val slotWPx = with(LocalDensity.current) { slotW.toPx() }

        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(SLOT_GAP)) {
                Box(Modifier.weight(1f)) {
                    FlyingWrap(t, toRight = true, slotWPx = slotWPx) {
                        QBlock(leftQ, common, pitch, roleL)
                    }
                }
                Box(Modifier.weight(1f)) {
                    FlyingWrap(t, toRight = false, slotWPx = slotWPx) {
                        QBlock(rightQ, common, pitch, roleR)
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            // 结果条（总量 / 差 / 倍数 / 总数）
            val wm = RL_ROLE_META.getValue(RlRole.WHOLE)
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(wm.bg))
                    .border(1.dp, Color(wm.fg), RoundedCornerShape(10.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(p.result.label, fontSize = 12.sp, color = Color(wm.fg))
                Spacer(Modifier.weight(1f))
                Text(
                    "${p.result.value} ${p.result.unit}",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(wm.fg),
                )
            }
        }
    }
}

/**
 * 飞行动画的载体。
 *
 * ★ 抬升量必须按**自身高度的百分比**给（这里 −28%），不能写固定 px：
 *   写死后，高个子题型（倍数页 4 行点阵）下面那块只剩 44% 露在外面，
 *   矮个子又会飘出槽位。百分比与块高无关 —— 可见比例恒为 ~72%。
 * ★ 向上飞的那块给更大的 zIndex，两块交错时才看得出谁在上、谁在下。
 */
@Composable
private fun FlyingWrap(
    t: Float,
    toRight: Boolean,
    slotWPx: Float = 0f,
    content: @Composable () -> Unit,
) {
    var h by remember { mutableIntStateOf(0) }
    val sign = if (toRight) 1f else -1f
    val tx = if (t > 0f) keyframe3(t, 0f, slotWPx * 0.5f + 6f, slotWPx + 12f) * sign else 0f
    val ty = if (t > 0f) keyframe3(t, 0f, -0.28f * h, 0f) * sign else 0f
    val sc = if (t > 0f) keyframe3(t, 1f, 0.78f, 1f) else 1f

    Box(
        Modifier
            .fillMaxWidth()
            .zIndex(if (toRight) 2f else 1f)
            .onSizeChanged { h = it.height }
            .graphicsLayer {
                translationX = tx
                translationY = ty
                scaleX = sc
                scaleY = sc
                if (t > 0f) {
                    shadowElevation = 14f
                    shape = RoundedCornerShape(12.dp)
                }
            },
    ) { content() }
}

/** 一个量块：角色标签 + 名字 + 点阵 + 数值。颜色由**槽位角色**给（不是由数值给） */
@Composable
private fun QBlock(q: RlQuantity, maxShape: RlShape, pitch: Dp, role: RlRole) {
    val m = RL_ROLE_META.getValue(role)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(m.bg))
            .border(2.dp, Color(m.fg), RoundedCornerShape(12.dp))
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(m.label, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(m.fg))
        Text(q.who, fontSize = 11.sp, color = Grey)
        Spacer(Modifier.height(5.dp))
        DotGrid(shape = q.shape, value = q.value, maxShape = maxShape, pitch = pitch, dot = Color(m.dot))
        Spacer(Modifier.height(5.dp))
        Text("${q.value} ${q.unit}", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color(m.fg))
    }
}

/** 平均分舞台用的窄条（只有角色 + 数 + 单位） */
@Composable
private fun MiniBlock(q: RlQuantity, role: RlRole) {
    val m = RL_ROLE_META.getValue(role)
    Row(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(Color(m.bg))
            .border(2.dp, Color(m.fg), RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(m.label, fontSize = 10.sp, color = Color(m.fg))
        Spacer(Modifier.width(6.dp))
        Text("${q.value}", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color(m.fg))
        Spacer(Modifier.width(3.dp))
        Text(q.unit, fontSize = 10.sp, color = Color(m.fg))
    }
}

/**
 * 点阵 —— 绝对定位 + 逐点位移动画。
 *
 * ★ 容器尺寸写死成「两种分法的最大框」，于是**排布变化时容器不重排**，
 *   每个点自己从旧位走到新位 ⇒ 平均分那十几个点会真的「重排一遍」。
 * ★ 点一律**从左上角起算，不居中**。居中是错的：
 *   · 「3 行 × b」与「1 行 × b」居中了就一样高 ⇒ 倍数看不见；
 *   · 「13 个」与「8 个」居中了就两头各缩一点 ⇒ 差几个数不出来。
 *   两块共用同一个 maxShape 与 pitch ⇒ 比的是**「填进去多长」**，
 *   而不是「画在哪儿」——这也是浅色底轨存在的意义。
 */
@Composable
private fun DotGrid(shape: RlShape, value: Int, maxShape: RlShape, pitch: Dp, dot: Color) {
    val pitchPx = with(LocalDensity.current) { pitch.roundToPx() }
    val cell = pitch * 0.7f
    Box(
        Modifier
            .size(width = pitch * maxShape.cols, height = pitch * maxShape.rows)
            .clip(RoundedCornerShape(4.dp))
            .background(GridTrack)
            .border(1.dp, BorderColor, RoundedCornerShape(4.dp)),
    ) {
        for (i in 0 until value) {
            val r = i / shape.cols
            val c = i % shape.cols
            val off by animateIntOffsetAsState(
                targetValue = IntOffset(c * pitchPx, r * pitchPx),
                animationSpec = tween(durationMillis = 550),
                label = "rl-dot-$i",
            )
            Box(
                Modifier
                    .offset { off }
                    .size(cell)
                    .clip(RoundedCornerShape(cell / 3f))
                    .background(dot),
            )
        }
    }
}

/***************************************
 * 关系句（要对照的那一小段高亮）
 ***************************************/

private enum class SentenceTone { PLAIN, SAME, CHANGED }

@Composable
private fun Sentence(line: RlLine, tone: SentenceTone) {
    val keyColor = when (tone) {
        SentenceTone.PLAIN -> MdColor
        SentenceTone.SAME -> OkColor
        SentenceTone.CHANGED -> AsColor
    }
    val i = line.text.indexOf(line.key)
    val text = buildAnnotatedString {
        if (i < 0) {
            append(line.text)
        } else {
            append(line.text.substring(0, i))
            withStyle(SpanStyle(color = keyColor, fontWeight = FontWeight.Bold)) { append(line.key) }
            append(line.text.substring(i + line.key.length))
        }
    }
    Text(text, fontSize = 15.sp, color = InkColor)
}

/***************************************
 * 四类对照（一条纲）
 ***************************************/

@Composable
private fun SwapTableCard() {
    SectionCard {
        Text("一条纲：哪种能换、哪种不能", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Spacer(Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RL_SWAP_TABLE.forEach { row ->
                val changed = RL_EFFECT_LABEL.getValue(row.effect).changed
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (changed) Color(0xFFFEF2F2) else Color(0xFFF0FDF4))
                        .border(1.dp, if (changed) Color(0xFFFECACA) else Color(0xFFBBF7D0), RoundedCornerShape(10.dp))
                        .padding(10.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        MathIcon(name = row.icon, size = 18.dp, tint = Grey)
                        Spacer(Modifier.width(6.dp))
                        Text(row.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = InkColor)
                        Spacer(Modifier.weight(1f))
                        Text(
                            RL_EFFECT_LABEL.getValue(row.effect).label,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(if (changed) BadColor else OkColor)
                                .padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(row.before, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = InkColor)
                        Spacer(Modifier.width(6.dp))
                        Text("⇄", fontSize = 13.sp, color = Grey)
                        Spacer(Modifier.width(6.dp))
                        Text(row.after, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = InkColor)
                    }
                    Text(row.note, fontSize = 11.sp, color = Grey, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
        Text(
            "看到两边同色就知道能换；看到橙 / 绿就知道换了会变。",
            fontSize = 11.sp,
            color = Grey,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}

/***************************************
 * 易错警示
 ***************************************/

@Composable
private fun MistakeCard(c: RlMistakeCase) {
    var revealed by remember(c.wrong) { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (revealed) Color(0xFFF0FDF4) else Color(0xFFFEF2F2))
            .border(1.dp, if (revealed) Color(0xFFBBF7D0) else Color(0xFFFECACA), RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MathIcon(name = c.icon, size = 18.dp, tint = Grey)
            Spacer(Modifier.width(6.dp))
            Text(c.title, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = InkColor)
        }
        Spacer(Modifier.height(8.dp))
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
                modifier = Modifier.width(170.dp),
                onClick = { revealed = true },
            )
        }
    }
}

/***************************************
 * 一步一填练习
 ***************************************/

@Composable
private fun PracticeSection(
    state: RlUiState,
    onGroup: (RlKind) -> Unit,
    onReshuffle: () -> Unit,
    onGrade: (Boolean) -> Unit,
    onFinished: () -> Unit,
) {
    SectionCard {
        Text("✍️ 一步一填", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Spacer(Modifier.height(10.dp))

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RL_KIND_GROUPS.chunked(2).forEach { row ->
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
            Text(state.drillScore, fontSize = 12.sp, color = InkColor, modifier = Modifier.weight(1f))
            ActionButton(text = "⟳ 换一组", onClick = onReshuffle)
        }
        Spacer(Modifier.height(10.dp))

        // ★ key 里带 drillRound 与题目 id：换一组时整批卡片重新挂载，清掉上一组的作答状态
        state.drill.forEachIndexed { i, p ->
            key(state.drillRound, i, p.id) {
                SolveCard(p = p, onStep = onGrade, onFinished = onFinished)
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
private fun SolveCard(p: RlProblem, onStep: (Boolean) -> Unit, onFinished: () -> Unit) {
    var stepIndex by remember(p) { mutableIntStateOf(0) }
    var picked by remember(p) { mutableStateOf<String?>(null) }
    var rightCount by remember(p) { mutableIntStateOf(0) }
    var trail by remember(p) { mutableStateOf(listOf<Pair<String, Boolean>>()) }

    val done = stepIndex >= p.solveSteps.size
    val step: RlSolveStep? = p.solveSteps.getOrNull(stepIndex)
    val answered = picked != null
    val isRight = answered && picked == step?.answer
    val isLast = step != null && stepIndex == p.solveSteps.size - 1

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (done) Color(0xFFF0FDF4) else StageBg)
            .border(1.dp, if (done) Color(0xFFBBF7D0) else BorderColor, RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        if (done) {
            Text(
                "${RL_KIND_LABEL.getValue(p.kind)}：${p.after.text}",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = OkColor,
            )
            Text(p.reveal, fontSize = 12.sp, color = InkColor, modifier = Modifier.padding(top = 6.dp))
            Text(p.invariant, fontSize = 12.sp, color = Grey, modifier = Modifier.padding(top = 4.dp))
            Text(
                "答对 $rightCount / ${p.solveSteps.size}",
                fontSize = 11.sp,
                color = Grey,
                modifier = Modifier.padding(top = 8.dp),
            )
            return@Column
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(p.before.text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = InkColor, modifier = Modifier.weight(1f))
            Text("第 ${stepIndex + 1} / ${p.solveSteps.size} 步", fontSize = 11.sp, color = Grey)
        }

        if (trail.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
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
                step.options.chunked(2).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { o ->
                            val bg = when {
                                !answered -> Color.White
                                o == step.answer -> Color(0xFFDCFCE7)
                                o == picked -> Color(0xFFFEE2E2)
                                else -> ChipBg
                            }
                            val fg = when {
                                !answered -> InkColor
                                o == step.answer -> OkColor
                                o == picked -> BadColor
                                else -> Faint
                            }
                            Text(
                                text = o,
                                fontSize = 13.sp,
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
                                    .padding(vertical = 10.dp, horizontal = 4.dp),
                            )
                        }
                        repeat(2 - row.size) { Spacer(Modifier.weight(1f)) }
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
