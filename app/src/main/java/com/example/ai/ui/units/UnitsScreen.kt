package com.example.ai.ui.units

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.units.ADJACENT_PAIRS
import com.example.ai.data.units.ChainFact
import com.example.ai.data.units.PROBLEM_GROUPS
import com.example.ai.data.units.UnitDef
import com.example.ai.data.units.UnitDirection
import com.example.ai.data.units.UnitId
import com.example.ai.data.units.UnitKind
import com.example.ai.data.units.UnitMistakeCase
import com.example.ai.data.units.UnitPair
import com.example.ai.data.units.UnitProblem
import com.example.ai.data.units.UNIT_MISTAKE_CASES
import com.example.ai.data.units.UNIT_RULES
import com.example.ai.data.units.qty
import com.example.ai.data.units.unitNumStr
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * 三年级上 · 长度与质量单位换算 —— 「切开 / 拼合」+「米尺刻度」双机制演示页
 *
 * 对齐 web/src/pages/MathUnitsPage.tsx。所有数字都来自 `data/units/Units.kt`，
 * 本页自己不做任何换算，也不自己判断该亮哪一格。
 *
 * ★ 与 web 的**有意差异**（三条）：
 *   ① **真实尺寸**：web 靠 CSS 的 `1in = 96px` 换算，再用 getBoundingClientRect 量一个 10mm 探针；
 *      Android 没有 DOM，改用 `DisplayMetrics.xdpi`（物理每英寸像素）⇒ 1 毫米 = xdpi / 25.4 像素。
 *      这个值**逐机型不同**、部分机型还报得不准，所以保留 web 那条「拿真尺子校准」的滑块。
 *   ② 米尺按真实尺寸画出来有 ~610dp 宽，比手机屏宽 ⇒ 外面套一层横向滚动，
 *      **绝不缩放**（缩放就不是真实大小了，整段量感教学的前提就没了）。
 *   ③ 份数超过 100 时改用 Canvas 画格子：1000 个 Compose 元素 + 逐格动画会明显掉帧，
 *      Canvas 一次画完，逐格「扫出来」的效果靠一个 0→1 的进度值模拟。
 *
 * 配色沿用全站：正确绿 #16A34A · 错误红 #DC2626 · 强调蓝 #2563EB · 提示橙 #EA580C
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
private val RuleBg = Color(0xFFFFFBEB)
private val CutColor = Color(0xFF38BDF8)
private val MergeColor = Color(0xFFF472B6)
private val PieceBg = Color(0xFFE0F2FE)

/** 图形舞台的**恒定高度** —— 份数越多格子越小，但舞台不跳（对齐 web 的「舞台高度恒定」） */
private val BoardH = 168.dp

/** 图形格子用 Canvas 画的阈值：超过它就别再造 Compose 元素了 */
private const val GRID_COMPOSE_MAX = 100

/***************************************
 * 页面
 ***************************************/

@Composable
fun UnitsScreen(
    onBack: () -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: UnitsViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val reduced = remember { animationsDisabled(context) }
    val prefs = remember { context.getSharedPreferences("aiphonix_units", Context.MODE_PRIVATE) }

    // 校准倍率存在本地：上次拖过的位置这次还在（对齐 web 的 localStorage["uc_calib"]）
    LaunchedEffect(Unit) {
        val saved = prefs.getFloat("uc_calib", 1f)
        if (saved > 0f) viewModel.setCalib(saved)
    }

    /** 1 毫米 = 多少 dp（含用户校准倍率） */
    val dpPerMm = rememberDpPerMm() * state.calib

    LazyColumn(
        modifier = modifier.fillMaxSize().navigationBarsPadding(),
        contentPadding = PaddingValues(bottom = 32.dp),
    ) {
        item(key = "top") {
            TopBar(title = "📏 长度与质量单位", onBack = onBack)
            Text(
                "毫米 · 厘米 · 分米 · 米 · 千米 ｜ 克 · 千克 · 吨 —— " +
                    "切开 / 拼合看懂方向，数一数数出进率，参照物建立量感。",
                fontSize = 13.sp,
                color = Grey,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp),
            )
        }

        item(key = "chips") {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip(
                        text = if (state.showRules) "收起口诀" else "📌 三句口诀",
                        modifier = Modifier.weight(1f),
                        onClick = viewModel::toggleRules,
                    )
                    Chip(
                        text = if (state.showBench) "收起工作台" else "🔢 换算工作台",
                        modifier = Modifier.weight(1f),
                        onClick = viewModel::toggleBench,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip(
                        text = if (state.showMistakes) "收起易错" else "⚠️ 易错警示",
                        modifier = Modifier.weight(1f),
                        onClick = viewModel::toggleMistakes,
                    )
                }
            }
        }

        if (state.showRules) {
            item(key = "rules") { RulesCard() }
        }

        // ── 主舞台 ──
        item(key = "main") {
            SectionCard {
                SectionTitle("✂️ 切开与拼合：为什么该乘、该除？")
                SectionSub(
                    "不要背「大化小乘、小化大除」。看动画：把一个大的切开成很多小的，份数就变多，所以是乘；" +
                        "把很多小的拼起来成一个大的，份数就变少，所以是除。" +
                        "进率里有几个 10，就切几轮 —— 10 切 1 轮、100 切 2 轮、1000 切 3 轮。",
                )
                Spacer(Modifier.height(10.dp))

                KindChips(current = state.kind, onPick = viewModel::pickKind)
                Spacer(Modifier.height(8.dp))

                PairChips(pairs = pairsOfKind(state.kind), active = state.pair, onPick = viewModel::pickPair)
                Spacer(Modifier.height(8.dp))

                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    DirButton(
                        text = "${state.pair.big.name} → ${state.pair.small.name}（切开 · 乘）",
                        on = state.toSmaller,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.setDirection(true) },
                    )
                    DirButton(
                        text = "${state.pair.small.name} → ${state.pair.big.name}（拼合 · 除）",
                        on = !state.toSmaller,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.setDirection(false) },
                    )
                }
                Spacer(Modifier.height(12.dp))

                CutStage(
                    state = state,
                    reduced = reduced,
                    dpPerMm = dpPerMm,
                    onPlay = { viewModel.play(reduced) },
                    onReset = viewModel::reset,
                )
            }
        }

        // ── 数一数（米尺 + 关系式）──
        item(key = "count") {
            CountSection(
                kind = state.kind,
                facts = state.facts,
                dpPerMm = dpPerMm,
                calib = state.calib,
                onCalib = {
                    viewModel.setCalib(it)
                    prefs.edit().putFloat("uc_calib", it).apply()
                },
            )
        }

        // ── 参照物墙 ──
        item(key = "sense") { SenseSection(kind = state.kind, dpPerMm = dpPerMm) }

        // ── 换算工作台 ──
        if (state.showBench) {
            item(key = "bench") {
                BenchSection(
                    state = state,
                    onKind = viewModel::setBenchKind,
                    onFrom = viewModel::setBenchFrom,
                    onTo = viewModel::setBenchTo,
                    onRaw = viewModel::setBenchRaw,
                )
            }
        }

        // ── 易错警示 ──
        if (state.showMistakes) {
            item(key = "mistake-title") {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text("⚠️ 最容易错的 7 个地方", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
                    SectionSub("先看红色的错例，想一想哪里不对，再看绿色的正确写法。")
                }
            }
            items(UNIT_MISTAKE_CASES.size, key = { "mk|${UNIT_MISTAKE_CASES[it].wrong}" }) { i ->
                MistakeCard(UNIT_MISTAKE_CASES[i])
            }
        }

        // ── 一步一填练习 ──
        item(key = "practice") {
            PracticeSection(state = state, onGroup = viewModel::reshuffleDrill, onRegen = viewModel::regenDrill, onGrade = viewModel::gradeStep)
        }
    }
}

/** 系统「关闭动画」（开发者选项里把动画缩放设为「关闭」）时直接跳完成态 */
private fun animationsDisabled(context: Context): Boolean = runCatching {
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
}.getOrDefault(false)

/**
 * ★ 1 毫米 = 多少 dp。这是本页「真实尺寸」的**唯一**来源。
 *
 * `xdpi` 是系统上报的物理每英寸像素数；1 英寸 = 25.4 毫米 ⇒ 1 毫米 = xdpi / 25.4 像素。
 * ⚠️ 再除以 `density.density`（每 dp 几个像素）才换算成 dp。
 * ⚠️ 少数机型 `xdpi` 会是 0 或明显不准 ⇒ 退回 densityDpi（逻辑 DPI），
 *    并靠页面上那条滑块让学生拿真尺子校准 —— 这正是 web 那条滑块的用意。
 */
@Composable
private fun rememberDpPerMm(): Float {
    val density = LocalDensity.current
    val context = LocalContext.current
    return remember(density.density) {
        val dm = context.resources.displayMetrics
        val xdpi = if (dm.xdpi > 1f) dm.xdpi else dm.densityDpi.toFloat()
        (xdpi / 25.4f) / density.density
    }
}

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
private fun SectionTitle(text: String) {
    Text(text, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
}

@Composable
private fun SectionSub(text: String) {
    Text(text, fontSize = 12.sp, color = Grey, modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun Chip(text: String, modifier: Modifier = Modifier, on: Boolean = false, onClick: () -> Unit) {
    Text(
        text = text,
        fontSize = 13.sp,
        color = InkColor,
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (on) PieceBg else ChipBg)
            .border(if (on) 2.dp else 1.dp, if (on) MdColor else BorderColor, RoundedCornerShape(999.dp))
            .clickableNoRipple(onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 6.dp),
    )
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
private fun DirButton(text: String, on: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        text = text,
        fontSize = 12.sp,
        color = if (on) Color.White else InkColor,
        fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (on) AsColor else Color.White)
            .border(1.dp, if (on) AsColor else BorderColor, RoundedCornerShape(10.dp))
            .clickableNoRipple(onClick = onClick)
            .padding(vertical = 9.dp, horizontal = 8.dp),
    )
}

/** 单位对的小工具：`pairsOf` 在 data 层，这里包一层避免 Screen 直接摸 ADJACENT_PAIRS */
private fun pairsOfKind(kind: UnitKind): List<UnitPair> =
    ADJACENT_PAIRS.filter { it.kind == kind }

@Composable
private fun RulesCard() {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = RuleBg),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            UNIT_RULES.forEach { r ->
                Column {
                    Text(r.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = InkColor)
                    Text(r.body, fontSize = 12.sp, color = Grey, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}

/***************************************
 * 主舞台：选族 / 选对 / 方向
 ***************************************/

@Composable
private fun KindChips(current: UnitKind, onPick: (UnitKind) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip(
            text = "📏 长度\n毫米 / 厘米 / 分米 / 米 / 千米",
            modifier = Modifier.weight(1f),
            on = current == UnitKind.LENGTH,
            onClick = { onPick(UnitKind.LENGTH) },
        )
        Chip(
            text = "⚖️ 质量\n克 / 千克 / 吨",
            modifier = Modifier.weight(1f),
            on = current == UnitKind.MASS,
            onClick = { onPick(UnitKind.MASS) },
        )
    }
}

@Composable
private fun PairChips(pairs: List<UnitPair>, active: UnitPair, onPick: (UnitPair) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        pairs.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { p ->
                    Chip(
                        text = "${p.small.name} ⟷ ${p.big.name}\n进率 ${unitNumStr(p.ratio)}",
                        modifier = Modifier.weight(1f),
                        on = active.key == p.key,
                        onClick = { onPick(p) },
                    )
                }
                // 补齐最后一行的空位，避免最后一行的按钮被拉伸
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/***************************************
 * 主舞台：切开 / 拼合
 ***************************************/

@Composable
private fun CutStage(
    state: UnitsUiState,
    reduced: Boolean,
    dpPerMm: Float,
    onPlay: () -> Unit,
    onReset: () -> Unit,
) {
    val plan = state.plan
    val countInt = state.count.roundToInt().coerceAtLeast(1)
    val grid = gridPlan(countInt)
    val cut = state.phase == CutPhase.CUT

    // ★ 逐格「扫出来」的进度：换题/重播时从头再来（runToken 变了就重跑）
    var reveal by remember(state.runToken) { mutableFloatStateOf(0f) }
    LaunchedEffect(state.runToken) {
        reveal = 0f
        animate(
            0f,
            1f,
            animationSpec = tween(durationMillis = if (reduced) 1 else 420, easing = LinearEasing),
        ) { v, _ -> reveal = v }
    }

    Column {
        // ── 题面 ──
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(unitNumStr(plan.value), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = InkColor)
            Text(" ${plan.from.name} = ", fontSize = 18.sp, color = InkColor)
            Text(
                if (state.answered) unitNumStr(plan.result) else "?",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = if (state.answered) OkColor else Faint,
            )
            Text(" ${plan.to.name}", fontSize = 18.sp, color = InkColor)
        }
        Spacer(Modifier.height(10.dp))

        // ── 图形舞台（高度恒定）──
        Box(
            Modifier
                .fillMaxWidth()
                .height(BoardH)
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0xFFF8FAFC))
                .border(1.dp, BorderColor, RoundedCornerShape(12.dp))
                .padding(6.dp),
        ) {
            if (countInt <= GRID_COMPOSE_MAX) {
                CellGrid(
                    count = countInt,
                    cols = grid.first,
                    rows = grid.second,
                    reveal = reveal,
                    cut = cut,
                    direction = plan.direction,
                    pieceLabel = state.pieceLabel,
                )
            } else {
                CellGridCanvas(
                    count = countInt,
                    cols = grid.first,
                    rows = grid.second,
                    reveal = reveal,
                    direction = plan.direction,
                )
            }
            if (cut) {
                Text(
                    if (plan.direction == UnitDirection.SPLIT) "🔪" else "🧲",
                    fontSize = 26.sp,
                    modifier = Modifier.align(Alignment.TopEnd).padding(4.dp),
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        // ── 报数区：份数 × 每份 = 原值 ──
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFFF1F5F9))
                .padding(vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TallyItem(big = unitNumStr(state.count), cap = "份")
            Text("×", fontSize = 16.sp, color = Grey)
            TallyItem(big = state.pieceLabel, cap = "每份")
            Text("=", fontSize = 16.sp, color = Grey)
            TallyItem(big = unitNumStr(plan.value), cap = plan.from.name)
        }
        Spacer(Modifier.height(10.dp))

        Text(
            state.sayText,
            fontSize = 13.sp,
            color = if (state.phase == CutPhase.IDLE) Grey else InkColor,
        )
        Spacer(Modifier.height(10.dp))

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton(
                text = state.playButtonText,
                modifier = Modifier.weight(1f),
                primary = true,
                enabled = !state.playing,
                onClick = onPlay,
            )
            ActionButton(
                text = "⟲ 重来",
                modifier = Modifier.weight(1f),
                enabled = state.phase != CutPhase.IDLE,
                onClick = onReset,
            )
        }

        // ── 结论 ──
        if (state.answered) {
            Spacer(Modifier.height(12.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFF0FDF4))
                    .border(1.dp, Color(0xFFBBF7D0), RoundedCornerShape(10.dp))
                    .padding(12.dp),
            ) {
                Text(
                    "${qty(plan.value, plan.from)} = ${qty(plan.result, plan.to)}",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = OkColor,
                )
                Text(
                    state.conclusionWhy,
                    fontSize = 12.sp,
                    color = InkColor,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Text(
                    "${unitNumStr(plan.value)} ${plan.op} ${unitNumStr(plan.ratio)} = ${unitNumStr(plan.result)}",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = MdColor,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    "单位变小数变大，单位变大树变小 —— 这句话能替你记一辈子。",
                    fontSize = 12.sp,
                    color = Grey,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }

        // ── 量感提示 ──
        Spacer(Modifier.height(8.dp))
        if (plan.from.kind == UnitKind.LENGTH) {
            val px = (plan.from.base * dpPerMm * LocalDensity.current.density).roundToInt()
            Text(
                "💡 1${plan.from.name} 按屏幕比例约 $px 像素宽" +
                    if (px > 600) " —— 屏幕放不下，所以上面画的是示意图。" else "。",
                fontSize = 12.sp,
                color = Grey,
            )
        } else {
            Text(
                "💡 质量没法画成尺寸：1${plan.from.name}有多重，看下面的参照物。",
                fontSize = 12.sp,
                color = Grey,
            )
        }
    }
}

@Composable
private fun TallyItem(big: String, cap: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(big, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Text(cap, fontSize = 11.sp, color = Grey)
    }
}

/** 份数 → 网格布局。份数越多格子越小，但**舞台高度恒定**，避免布局跳动（对齐 web） */
private fun gridPlan(count: Int): Pair<Int, Int> = when {
    count <= 1 -> 1 to 1
    count <= 10 -> count to 1
    count <= 100 -> 10 to ceil(count / 10.0).toInt()
    else -> 50 to ceil(count / 50.0).toInt()
}

/** ≤100 格：逐格 Compose 元素（可以有逐格延迟）。份数 ≤10 时把「每份是多少」直接写在格子上 */
@Composable
private fun CellGrid(
    count: Int,
    cols: Int,
    rows: Int,
    reveal: Float,
    cut: Boolean,
    direction: UnitDirection,
    pieceLabel: String,
) {
    val tint = if (direction == UnitDirection.SPLIT) CutColor else MergeColor
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        var idx = 0
        repeat(rows) {
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                repeat(cols) {
                    val i = idx++
                    if (i >= count) {
                        Spacer(Modifier.weight(1f).fillMaxHeight())
                    } else {
                        // 扫出来的进度：第 i 格在 reveal 越过它时才显形
                        val t = ((reveal * (count + 6) - i) / 4f).coerceIn(0f, 1f)
                        Box(
                            Modifier
                                .weight(1f)
                                .fillMaxHeight()
                                .clip(RoundedCornerShape(3.dp))
                                .background(tint.copy(alpha = 0.20f + 0.35f * t))
                                .border(
                                    if (cut) 2.dp else 1.dp,
                                    if (cut) AsColor.copy(alpha = 0.5f + 0.5f * t) else tint.copy(alpha = 0.6f),
                                    RoundedCornerShape(3.dp),
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (count <= 10) {
                                Text(pieceLabel, fontSize = 9.sp, color = InkColor, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * >100 格：Canvas 一次画完。
 * ⚠️ 1000 个 Compose 元素（1米 → 毫米）叠上逐格动画会明显掉帧，
 *    这里用同一个 reveal 进度做整片「扫过去」的效果 —— 视觉上等价，代价几乎为零。
 */
@Composable
private fun CellGridCanvas(count: Int, cols: Int, rows: Int, reveal: Float, direction: UnitDirection) {
    val tint = if (direction == UnitDirection.SPLIT) CutColor else MergeColor
    Canvas(Modifier.fillMaxSize()) {
        val gap = 1.dp.toPx()
        val cw = (size.width - gap * (cols - 1)) / cols
        val chh = (size.height - gap * (rows - 1)) / rows
        for (i in 0 until count) {
            val r = i / cols
            val c = i % cols
            val t = ((reveal * (count + 6) - i) / 6f).coerceIn(0f, 1f)
            val x = c * (cw + gap)
            val y = r * (chh + gap)
            drawRect(
                color = tint.copy(alpha = 0.18f + 0.42f * t),
                topLeft = Offset(x, y),
                size = Size(cw.coerceAtLeast(0.6f), chh.coerceAtLeast(0.6f)),
            )
        }
    }
}

/***************************************
 * 数一数：米尺 + 关系式
 ***************************************/

@Composable
private fun CountSection(
    kind: UnitKind,
    facts: List<ChainFact>,
    dpPerMm: Float,
    calib: Float,
    onCalib: (Float) -> Unit,
) {
    SectionCard {
        SectionTitle("📐 数一数，不靠背")
        SectionSub(
            "进率不用背 —— 在同一把尺子上数一数就出来了。下面这把尺子是按**真实物理尺寸**画的，" +
                "可以拿你手边的尺子对着屏幕比一比；如果不一样，拖一下校准条。" +
                "（真实尺寸依赖机型上报的屏幕 DPI，所以一定要允许校准。）",
        )

        if (kind == UnitKind.LENGTH) {
            Spacer(Modifier.height(10.dp))
            // ★ 真实尺寸的 10 厘米尺子约 610dp 宽 ⇒ 横向滚动，绝不缩放
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                RulerBar(dpPerMm = dpPerMm)
            }
            Spacer(Modifier.height(10.dp))
            Text(
                "屏幕校准：把真尺子的 0 对准上面尺子的 0，拖动滑块，直到两把尺子在 5 厘米处一样长",
                fontSize = 11.sp,
                color = Grey,
            )
            Slider(
                value = calib,
                onValueChange = onCalib,
                valueRange = UnitsViewModel.MIN_CALIB..UnitsViewModel.MAX_CALIB,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "当前 1 毫米 ≈ " + "%.2f".format(dpPerMm) + " dp（" +
                    if (calib == 1f) "设备默认" else "手动 ×" + "%.2f".format(calib) + "）",
                fontSize = 11.sp,
                color = Grey,
            )
            if (calib != 1f) {
                Spacer(Modifier.height(6.dp))
                ActionButton(
                    text = "恢复默认",
                    modifier = Modifier.width(120.dp),
                    onClick = { onCalib(1f) },
                )
            }
            Spacer(Modifier.height(14.dp))
            HundredGrid()
        }

        Spacer(Modifier.height(12.dp))
        facts.forEach { f ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
                Text("•", fontSize = 13.sp, color = MdColor, modifier = Modifier.padding(end = 6.dp))
                Column {
                    Text(f.text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = InkColor)
                    Text(f.note, fontSize = 11.sp, color = Grey)
                }
            }
        }
    }
}

/**
 * 真实尺寸的 10 厘米米尺。
 * ★ 刻度与数字**全部**按同一个 `i/100` 网格定位（对齐 web 踩过的那个坑：
 *   刻度用 space-between、数字用 translateX(-50%)、黑刻度用 flex 均分 —— 三套网格各算各的，
 *   实测红刻度与大刻度会错开 1~3px，而且 100 个小格只有 100 条左边框 ⇒ 10cm 处根本没有刻度）。
 */
@Composable
private fun RulerBar(dpPerMm: Float) {
    val widthDp = 100f * dpPerMm
    val density = LocalDensity.current
    // ⚠️ drawLine 要的是 Color，不是 ARGB Int —— 只有 android.graphics.Paint 才吃 Int。
    //    混用会报「actual type is 'Int', but 'Color' was expected」，位置指着 when 分支，很误导。
    val ink = InkColor
    val mid = Faint
    val grey = Grey
    val textSizePx = with(density) { 10.sp.toPx() }
    // 数字用 nativeCanvas 画 —— 不走 TextMeasurer，免得受 Compose 版本差异影响
    val paint = remember {
        android.graphics.Paint().apply {
            isAntiAlias = true
            textAlign = android.graphics.Paint.Align.CENTER
        }
    }

    Canvas(
        Modifier
            .width(widthDp.dp)
            .height(50.dp),
    ) {
        val w = size.width
        val h = size.height
        val baseline = h - 12.dp.toPx()
        // 101 条刻度逐条按 left: i% 落位，对齐由构造保证
        for (i in 0..100) {
            val x = w * i / 100f
            val tall = i % 10 == 0
            val middle = i % 5 == 0
            val len = if (tall) 16.dp.toPx() else if (middle) 10.dp.toPx() else 5.dp.toPx()
            val stroke = if (tall) 2.dp.toPx() else 1.dp.toPx()
            drawLine(
                color = when {
                    tall -> ink
                    middle -> mid
                    else -> grey
                },
                start = Offset(x, baseline - len),
                end = Offset(x, baseline),
                strokeWidth = stroke,
            )
        }
        drawLine(ink, Offset(0f, baseline), Offset(w, baseline), strokeWidth = 2.dp.toPx())
        drawLine(ink, Offset(0f, baseline - 16.dp.toPx()), Offset(0f, baseline), strokeWidth = 2.dp.toPx())

        // 数字 0..10，每 10 毫米一个（这一层就是「厘米」读数）
        paint.color = InkColor.toArgb()
        paint.textSize = textSizePx
        drawIntoCanvas { canvas ->
            for (i in 0..10) {
                canvas.nativeCanvas.drawText(i.toString(), w * i / 10f, 14.dp.toPx(), paint)
            }
        }
    }
}

/** 1 分米 = 100 毫米 的方格：10×10 让学生真的能数（抽象清点用，不按真实尺寸） */
@Composable
private fun HundredGrid() {
    Column {
        Text("1 分米 = 100 个 1 毫米", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Spacer(Modifier.height(6.dp))
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            repeat(10) {
                Row(horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                    repeat(10) {
                        Box(
                            Modifier
                                .size(13.dp)
                                .background(PieceBg)
                                .border(1.dp, CutColor.copy(alpha = 0.5f)),
                        )
                    }
                }
            }
        }
        Text(
            "10 行 × 10 列 = 100 格。而 1 米 = 10 个这样的方块 ⇒ 10 × 100 = 1000 毫米。",
            fontSize = 11.sp,
            color = Grey,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

/***************************************
 * 参照物墙
 ***************************************/

@Composable
private fun SenseSection(kind: UnitKind, dpPerMm: Float) {
    val list = listOf(UnitId.MM, UnitId.CM, UnitId.DM, UnitId.M, UnitId.KM)
    val massList = listOf(UnitId.G, UnitId.KG, UnitId.T)
    val ids = if (kind == UnitKind.LENGTH) list else massList
    val units = ids.map { com.example.ai.data.units.unitOf(it) }

    SectionCard {
        SectionTitle("👀 1${units[0].name}到底有多大？")
        SectionSub(
            "单位不是两个长得不一样的字，它是有大小的。先把「1 个单位」的样子装进脑子里，" +
                "填空和换算就不会离谱。",
        )
        Spacer(Modifier.height(10.dp))

        BoxWithConstraints(Modifier.fillMaxWidth()) {
            // ★ 卡里放不下就**不画**，而不是画一条被裁掉的：
            //   裁掉右端之后学生拿尺子量到的是「约 9 厘米」—— 比不画更误导。
            //   也不能「按容器宽度缩小了画」：缩小就不是真实大小了。
            val availDp = maxWidth
            units.forEach { u ->
                UnitSenseCard(u, dpPerMm, availDp)
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable
private fun UnitSenseCard(u: UnitDef, dpPerMm: Float, availDp: androidx.compose.ui.unit.Dp) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0xFFF8FAFC))
            .border(1.dp, BorderColor, RoundedCornerShape(10.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(u.name, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = InkColor)
            Text("  ${u.symbol}", fontSize = 12.sp, color = Grey, modifier = Modifier.padding(start = 6.dp))
        }
        Spacer(Modifier.height(8.dp))

        val draw = u.refs.firstNotNullOfOrNull { it.draw }
        if (draw != null) {
            if (!u.onScreenReal) {
                // 1米 ≈ 3779 dp、1千米更不用说 —— 屏幕上放不下
                Text(
                    "${u.name}太大了，屏幕上放不下。用下面的参照物去想象它。",
                    fontSize = 12.sp,
                    color = AsColor,
                )
            } else {
                val barDp = (draw.baseAmount * dpPerMm).toFloat()
                if (barDp > availDp.value * 0.92f) {
                    Text(
                        "1${u.name} 的真实长度约 ${barDp.roundToInt()} dp，这张卡片装不下。" +
                            "这里不缩小着画 —— 缩小就不是真实大小了。" +
                            "想感受它：把真尺子贴到上面那把米尺上，看 0 到 ${draw.baseAmount.roundToInt() / 10} 厘米这一段。",
                        fontSize = 12.sp,
                        color = AsColor,
                    )
                } else {
                    val h = draw.baseAmount * dpPerMm
                    Box(
                        Modifier
                            .height(if (draw.form == "slab") h.toFloat().coerceAtLeast(3f).dp else 14.dp)
                            .width(if (draw.form == "slab") 120.dp else barDp.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(MdColor.copy(alpha = 0.35f))
                            .border(1.dp, MdColor),
                    )
                    Text(
                        "屏幕上这段 = 真实的 1${u.name}（约 ${barDp.roundToInt()} dp）",
                        fontSize = 11.sp,
                        color = Grey,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        u.refs.forEach { r ->
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.Top) {
                Text(r.emoji, fontSize = 13.sp, modifier = Modifier.padding(end = 6.dp))
                Column {
                    Text(r.name, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = InkColor)
                    Text(r.detail, fontSize = 11.sp, color = Grey)
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("🖐️ ${u.sense}", fontSize = 12.sp, color = InkColor)
    }
}

/***************************************
 * 换算工作台
 ***************************************/

@Composable
private fun BenchSection(
    state: UnitsUiState,
    onKind: (UnitKind) -> Unit,
    onFrom: (UnitId) -> Unit,
    onTo: (UnitId) -> Unit,
    onRaw: (String) -> Unit,
) {
    SectionCard {
        SectionTitle("🔢 换算工作台")
        SectionSub("填一个数、挑两个单位，马上看到怎么算、为什么这么算。")
        Spacer(Modifier.height(10.dp))

        OutlinedTextField(
            value = state.benchRaw,
            onValueChange = onRaw,
            label = { Text("要换算的数", fontSize = 12.sp) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(
                text = "长度",
                modifier = Modifier.weight(1f),
                on = state.benchKind == UnitKind.LENGTH,
                onClick = { onKind(UnitKind.LENGTH) },
            )
            Chip(
                text = "质量",
                modifier = Modifier.weight(1f),
                on = state.benchKind == UnitKind.MASS,
                onClick = { onKind(UnitKind.MASS) },
            )
        }
        Spacer(Modifier.height(8.dp))

        Text("从哪个单位", fontSize = 11.sp, color = Grey)
        UnitPickRow(chain = state.benchChain, active = state.benchFromId, onPick = onFrom)
        Spacer(Modifier.height(8.dp))
        Text("换成哪个单位", fontSize = 11.sp, color = Grey)
        UnitPickRow(chain = state.benchChain, active = state.benchToId, onPick = onTo)
        Spacer(Modifier.height(10.dp))

        val plan = state.benchPlan
        when {
            !state.benchValid -> Text(
                "请填一个大于 0 的数（三年级只做整数换算）。",
                fontSize = 12.sp,
                color = BadColor,
            )
            state.benchSame -> Text(
                "两个单位一样，数不用变。",
                fontSize = 12.sp,
                color = BadColor,
            )
            plan != null -> {
                Text(
                    "${qty(state.benchValue!!, state.benchFrom)} = ${state.benchResultPretty}${state.benchTo.name}",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = OkColor,
                )
                Text(
                    "${unitNumStr(state.benchValue!!)} ${plan.op} ${unitNumStr(plan.ratio)} = ${state.benchResultPretty}",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = MdColor,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    if (plan.direction == UnitDirection.SPLIT) {
                        "单位变小 ⇒ 切开 ⇒ 份数变多 ⇒ 用乘（切 ${plan.rounds} 轮，进率 ${unitNumStr(plan.ratio)}）"
                    } else {
                        "单位变大 ⇒ 拼合 ⇒ 份数变少 ⇒ 用除（拼 ${plan.rounds} 轮，进率 ${unitNumStr(plan.ratio)}）"
                    },
                    fontSize = 12.sp,
                    color = Grey,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Spacer(Modifier.height(6.dp))
                plan.cuts.forEach { c ->
                    Text(
                        "第 ${c.round} 轮 ⇒ ${unitNumStr(c.count)} 份，每份 ${c.pieceLabel}",
                        fontSize = 12.sp,
                        color = InkColor,
                        modifier = Modifier.padding(vertical = 1.dp),
                    )
                }
                Text(
                    "这一对是${state.benchFrom.name}↔${state.benchTo.name}，进率 ${unitNumStr(plan.ratio)}，" +
                        "要 ${plan.rounds} 轮 —— " +
                        if (plan.rounds == 1) "切一轮就到了。" else "10 要乘 ${plan.rounds} 次。",
                    fontSize = 11.sp,
                    color = Grey,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun UnitPickRow(
    chain: List<UnitDef>,
    active: UnitId,
    onPick: (UnitId) -> Unit,
) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        chain.forEach { u ->
            Chip(
                text = u.name,
                on = active == u.id,
                onClick = { onPick(u.id) },
            )
        }
    }
}

/***************************************
 * 易错警示
 ***************************************/

@Composable
private fun MistakeCard(c: UnitMistakeCase) {
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
                    text = "想好了，看正确答案",
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

private val STEP_LABEL = mapOf(
    "op" to "① 判方向",
    "rate" to "② 找进率",
    "calc" to "③ 算结果",
)

@Composable
private fun PracticeSection(
    state: UnitsUiState,
    onGroup: (com.example.ai.data.units.ProblemGroupKey) -> Unit,
    onRegen: () -> Unit,
    onGrade: (Boolean) -> Unit,
) {
    SectionCard {
        SectionTitle("✍️ 练一练：一步一步来")
        SectionSub(
            "每道题都拆成三步 —— 先判方向、再找进率、最后算结果。" +
                "学生最容易混的就是前两步，所以千万不要一步算完。",
        )
        Spacer(Modifier.height(10.dp))

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PROBLEM_GROUPS.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { g ->
                        Chip(
                            text = "${g.title}\n${g.desc}",
                            modifier = Modifier.weight(1f),
                            on = state.group == g.key,
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
                "已经填了 ${state.drillAnswered} 步，对了 ${state.drillCorrect} 步" +
                    if (state.drillAnswered > 0) "（${state.drillPct}%）" else "",
                fontSize = 12.sp,
                color = InkColor,
                modifier = Modifier.weight(1f),
            )
            ActionButton(text = "🎲 换一组题", onClick = onRegen)
        }
        Spacer(Modifier.height(10.dp))

        // ★ key 里带 drillRound：换一组时整批卡片重新挂载，清掉上一组的作答状态
        state.problems.forEachIndexed { i, p ->
            key(state.drillRound, i) {
                SolveCard(p = p, index = i, onStep = onGrade)
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
private fun SolveCard(p: UnitProblem, index: Int, onStep: (Boolean) -> Unit) {
    // ⚠️ 三个状态都用 `remember(p)`：换一组题时整张卡必须回到起始态，
    //    否则新题会顶着上一题的选择（web 那边是靠 `useEffect(() => setSt(fresh()), [p])` 做的同一件事）。
    var stepIndex by remember(p) { mutableStateOf(0) }
    var picked by remember(p) { mutableStateOf<String?>(null) }
    var rightCount by remember(p) { mutableStateOf(0) }

    val done = stepIndex >= p.steps.size
    val step = p.steps.getOrNull(stepIndex)
    val answered = picked != null
    val isRight = answered && picked == step?.answer
    val isLast = step != null && stepIndex == p.steps.size - 1

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (done) Color(0xFFF0FDF4) else Color(0xFFF8FAFC))
            .border(1.dp, if (done) Color(0xFFBBF7D0) else BorderColor, RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("第 ${index + 1} 题", fontSize = 11.sp, color = Grey)
            Text(
                p.fullText,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = InkColor,
                modifier = Modifier.padding(start = 8.dp),
            )
        }

        // 进度点：一个点 = 一步
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            p.steps.forEachIndexed { i, s ->
                Box(
                    Modifier
                        .size(10.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(
                            when {
                                i < stepIndex -> OkColor
                                i == stepIndex && !done -> MdColor
                                else -> BorderColor
                            },
                        ),
                )
                Text(STEP_LABEL[s.key].orEmpty(), fontSize = 9.sp, color = Grey, modifier = Modifier.padding(start = 4.dp, end = 8.dp))
            }
        }

        if (!done && step != null) {
            Spacer(Modifier.height(10.dp))
            Text(STEP_LABEL[step.key].orEmpty(), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MdColor)
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
                Text(
                    (if (isRight) "✅ " else "❌ ") + step.tip,
                    fontSize = 12.sp,
                    color = if (isRight) OkColor else BadColor,
                )
                Spacer(Modifier.height(8.dp))
                ActionButton(
                    text = if (isLast) "看看完整算式" else "下一步 ›",
                    modifier = Modifier.width(180.dp),
                    primary = true,
                    onClick = {
                        stepIndex += 1
                        picked = null
                    },
                )
            }
        }

        if (done) {
            Spacer(Modifier.height(4.dp))
            Text(
                "${qty(p.value, p.from)} = ${qty(p.result, p.to)}",
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                color = OkColor,
            )
            Text(p.finalNote, fontSize = 12.sp, color = InkColor, modifier = Modifier.padding(top = 4.dp))
            if (p.trap != null) {
                Text(
                    "⚠️ 如果方向判反了，会算成 ${unitNumStr(p.trap)}${p.to.name}。记住：" +
                        "${p.from.name}${if (p.from.base > p.to.base) "大、要切开" else "小、要拼合"}，" +
                        "所以是${if (p.op == "×") "乘" else "除"}。",
                    fontSize = 12.sp,
                    color = AsColor,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Text(
                "这一步一填答对 $rightCount / ${p.steps.size}",
                fontSize = 11.sp,
                color = Grey,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}
