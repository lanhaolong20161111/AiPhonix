package com.example.ai.ui.eqmove

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.math.EQ_KIND_LABEL
import com.example.ai.data.math.EQ_KIND_TIP
import com.example.ai.data.math.EQ_MISTAKE_CASES
import com.example.ai.data.math.EQ_PRACTICE
import com.example.ai.data.math.EQ_RULES
import com.example.ai.data.math.EqMistakeCase
import com.example.ai.data.math.EqOp
import com.example.ai.data.math.EqPracticeItem
import com.example.ai.data.math.EqSide
import com.example.ai.data.math.EqSideList
import com.example.ai.data.math.MoveAction
import com.example.ai.data.math.MoveKind
import com.example.ai.data.math.MoveProblem
import com.example.ai.data.math.eqFlipOp
import com.example.ai.data.math.eqSideToText
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 三年级数学 · 等式变变变 —— 「移项变号」动画
 *
 * 教学核心：把一个数从等号**一侧**挪到**另一侧**，它的符号必须**变相反**（+ ↔ - 、× ↔ ÷）；
 * 而在等号**同一侧**交换左右位置，符号一点不用调。
 *
 * 动画分四拍（与 web 的 EquationMovePage 逐拍对齐，时间常量全部取自
 * [EqMoveViewModel.Companion]，两边同源）：
 *   ① 找 —— 要搬走的那一整块脉动高亮，点明「它跨过等号，符号要变」
 *   ② 飞 —— ★ 整块起飞越过等号线；**跨线那一瞬符号翻牌**（+ 转成 -），等号线同时闪一下
 *   ③ 落 —— 停在等号另一侧末尾；源侧原位**只变灰划掉、不删除** ⇒ 看得出它从哪儿走的
 *   ④ 算 —— 算出结果，并把答案代回原式验算（✓）
 *
 * ★ 布局零重排是落位精度的前提：目标侧**从动画一开始就预留落位槽**（alpha 0 占位），
 *   源侧搬走后只变灰不删 ⇒ 整个动画期间两侧宽度完全不变，幽灵落点像素级准确。
 *
 * ⚠️ 坐标测量一律走 [EqGeom]：所有元素报 `boundsInRoot()`（**绝对 root 坐标**），
 *    取值时只减基准容器（"stage"）。绝不要把不同容器的坐标混着减。
 *
 * 配色（全站统一）：乘除蓝 #2563EB · 加减橙 #EA580C · 正确绿 #16A34A · 错误红 #DC2626
 * 等号线：虚线 #CBD5E1，被跨越时闪 #F59E0B
 */
private val Black0 = Color(0xFF000000)
private val InkColor = Color(0xFF0F172A)
private val Grey = Color(0xFF6B7280)
private val Slate = Color(0xFF374151)
private val Faint = Color(0xFF94A3B8)
private val MdColor = Color(0xFF2563EB)
private val AsColor = Color(0xFFEA580C)
private val LitAmber = Color(0xFFFDE68A)
private val OkColor = Color(0xFF16A34A)
private val BadColor = Color(0xFFDC2626)
private val BorderColor = Color(0xFFCBD5E1)
private val BorderHitColor = Color(0xFFF59E0B)

/** 舞台字号（幽灵 / 落位槽 / 真身共用 ⇒ 交接无感） */
private val STAGE_FONT = 26.sp

/** 符号位固定宽度（翻牌时旧符号转走、新符号转出来，宽度不能跳） */
private val GlyphW = 17.dp

/***************************************
 * 页面
 ***************************************/

@Composable
fun EqMoveScreen(
    onBack: () -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: EqMoveViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val reduced = remember { animationsDisabled(context) }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .navigationBarsPadding(),
        contentPadding = PaddingValues(bottom = 28.dp),
    ) {
        item(key = "top") {
            TopBar(title = "⚖️ 等式变变变", onBack = onBack)
            Text(
                "把一个数从等号一边挪到另一边 —— 符号必须变相反",
                fontSize = 13.sp,
                color = Grey,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp),
            )
        }

        item(key = "chips") {
            ChipRow(
                state = state,
                onToggleRules = viewModel::toggleRules,
                onToggleWhy = viewModel::toggleWhy,
                onToggleMistakes = viewModel::toggleMistakes,
            )
        }

        if (state.showRules) {
            item(key = "rules") { RulesCard() }
        }

        // 「为什么能移项」—— 两边同时减去同一个数，天平还是平的
        if (state.showWhy) {
            item(key = "why") { WhyMoveDemo(reduced) }
        }

        // 易错卡放在题目区之前（与 web 顺序一致）；LazyColumn 让卡片「滚到才揭晓」
        if (state.showMistakes) {
            items(EQ_MISTAKE_CASES, key = { "${it.title}|${it.wrong}" }) { m -> MistakeCard(m) }
        }

        item(key = "kinds") {
            KindRows(current = state.kind, onPick = viewModel::newProblem)
        }

        val problem = state.problem
        if (problem == null) {
            item(key = "empty") { StatusText("生成题目失败，点「换一题」再试一次。") }
        } else {
            item(key = "kind-tip") {
                Text(
                    EQ_KIND_TIP[problem.kind].orEmpty(),
                    fontSize = 13.sp,
                    color = Black0,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                )
            }
            item(key = "stage") {
                EqStage(
                    state = state,
                    problem = problem,
                    reduced = reduced,
                    onCrossed = viewModel::onGhostCrossed,
                    onSwapped = viewModel::setSwapped,
                )
            }
            item(key = "hint") { HintLine(state) }
            if (state.showResult) {
                item(key = "result") { ResultBox(state, problem) }
            }
            item(key = "actions") {
                ActionsRow(
                    label = state.playButtonText,
                    enabled = state.canPlay,
                    onPlay = { viewModel.play(reduced) },
                    onNew = { viewModel.newProblem(state.kind) },
                )
            }
            item(key = "hint-sm") {
                Text(
                    "💡 ${problem.hint}",
                    fontSize = 12.sp,
                    color = Grey,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
        }

        // ── 教材给的固定对比练习（四种符号变化并排看）──
        item(key = "practice") {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                Text(
                    "✍️ 一组对比练习：跨过等号，符号该变成什么？",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = Black0,
                )
                Text(
                    "先自己想一想，再点选答案 —— 四个选项正好是四种符号。",
                    fontSize = 12.sp,
                    color = Grey,
                    modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
                )
                EQ_PRACTICE.forEach { it2 ->
                    key("practice|${it2.before}") { PracticeCard(item = it2) }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }

        // ── 随机 5 题：可换一组 ──
        item(key = "drill") {
            DrillSection(
                state = state,
                onReshuffle = viewModel::reshuffleDrill,
                onGraded = viewModel::gradeDrill,
            )
        }
    }
}

/** 系统「关闭动画」（开发者选项里把动画缩放设为「关闭」）时直接跳到完成态 */
private fun animationsDisabled(context: Context): Boolean = runCatching {
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
}.getOrDefault(false)

@Composable
private fun TopBar(title: String, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onBack, modifier = Modifier.width(48.dp)) {
            Text("←", fontSize = 20.sp, color = Black0)
        }
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Black0)
    }
}

/**
 * 可点击但 disabled 时不吃点击。
 * ⚠️ 必须写成 @Composable 扩展：内部要用 remember 造 MutableInteractionSource。
 *    另外**不要**自己定义 `Modifier.clickable(onClick)` —— 会与 foundation 的同名扩展歧义。
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
private fun ChipRow(
    state: EqMoveUiState,
    onToggleRules: () -> Unit,
    onToggleWhy: () -> Unit,
    onToggleMistakes: () -> Unit,
) {
    // ⚠️ web 的 .eq-rules-bar 没有 flex-wrap，窄屏会顶出横向滚动 ⇒ Android 直接排成两行
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(
                text = if (state.showRules) "收起口诀" else "📌 一句话规律",
                modifier = Modifier.weight(1f),
                onClick = onToggleRules,
            )
            Chip(
                text = if (state.showWhy) "收起原理" else "🔍 为什么能移项？",
                modifier = Modifier.weight(1f),
                onClick = onToggleWhy,
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(
                text = if (state.showMistakes) "收起易错" else "⚠️ 易错警示",
                modifier = Modifier.weight(1f),
                onClick = onToggleMistakes,
            )
        }
    }
}

@Composable
private fun Chip(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        text = text,
        fontSize = 13.sp,
        color = Black0,
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color(0xFFF1F5F9))
            .border(1.dp, Color(0xFFCBD5E1), RoundedCornerShape(999.dp))
            .clickableNoRipple(onClick = onClick)
            .padding(vertical = 8.dp),
    )
}

@Composable
private fun RulesCard() {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFBEB)),
    ) {
        Column(Modifier.padding(14.dp)) {
            EQ_RULES.forEach { block ->
                Text(block.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Black0)
                block.lines.forEach { line ->
                    Text(
                        "· $line",
                        fontSize = 13.sp,
                        color = Slate,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

/** 题型选择：7 种题型排成三行，避免窄屏溢出（web 是 flex-wrap） */
@Composable
private fun KindRows(current: MoveKind, onPick: (MoveKind) -> Unit) {
    val rows = listOf(
        listOf(MoveKind.PLUS, MoveKind.MINUS, MoveKind.TIMES),
        listOf(MoveKind.DIVIDE, MoveKind.MINUS_VAR, MoveKind.DIVIDE_VAR),
        listOf(MoveKind.SAME_SIDE),
    )
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { k ->
                    val on = k == current
                    Text(
                        EQ_KIND_LABEL[k].orEmpty(),
                        fontSize = 12.sp,
                        fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                        color = if (on) Color.White else Black0,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (on) MdColor else Color(0xFFF1F5F9))
                            .border(1.dp, if (on) MdColor else Color(0xFFCBD5E1), RoundedCornerShape(999.dp))
                            .clickableNoRipple { onPick(k) }
                            .padding(vertical = 7.dp),
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

@Composable
private fun HintLine(state: EqMoveUiState) {
    val warn = state.phase == EqPhase.SLIDE
    Text(
        state.hintText,
        fontSize = 14.sp,
        color = if (warn) AsColor else Black0,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (warn) Color(0xFFFFF7ED) else Color(0xFFF8FAFC))
            .padding(12.dp),
    )
}

@Composable
private fun ResultBox(state: EqMoveUiState, problem: MoveProblem) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F5F9)),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text("解出来", fontSize = 12.sp, color = Color(0xFF64748B))
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text("x = ", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Black0)
                Text(
                    problem.answer.toString(),
                    fontSize = 24.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = OkColor,
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "过程：${eqSideToText(problem.final.left)} = ${eqSideToText(problem.final.right)}",
                fontSize = 13.sp,
                color = Slate,
            )
            if (state.solved) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "代回原式：${eqSideToText(problem.initial.left, problem.answer)} = " +
                        eqSideToText(problem.initial.right, problem.answer),
                    fontSize = 13.sp,
                    color = Slate,
                )
                Text("✓ 两边一样", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = OkColor)
            }
        }
    }
}

@Composable
private fun ActionsRow(label: String, enabled: Boolean, onPlay: () -> Unit, onNew: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = label,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            color = if (enabled) Color.White else Color(0xFF94A3B8),
            textAlign = TextAlign.Center,
            modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(12.dp))
                .background(if (enabled) MdColor else Color(0xFFE2E8F0))
                .clickableNoRipple(enabled = enabled, onClick = onPlay)
                .padding(vertical = 12.dp),
        )
        Chip(text = "🎲 换一题", modifier = Modifier.weight(1f), onClick = onNew)
    }
}

@Composable
private fun StatusText(text: String) {
    Text(text, fontSize = 13.sp, color = Grey, modifier = Modifier.padding(16.dp))
}

/***************************************
 * 舞台：等号分界线 + 幽灵飞越翻牌 + 落位 + 同侧滑动
 ***************************************/

/**
 * 相对某个基准容器的坐标簿。每处都报**绝对**（boundsInRoot）坐标，
 * 取值时只减基准容器 ⇒ 不会把不同容器的坐标混起来。
 */
private class EqGeom {
    private val map = mutableStateMapOf<String, Rect>()

    fun report(key: String, abs: Rect) {
        if (map[key] != abs) map[key] = abs
    }

    /** 绝对矩形 */
    fun abs(key: String): Rect? = map[key]?.takeIf { it.width > 0f }

    /** 取相对 [anchor] 左上角的矩形（anchor 宽度为 0 时视为还没量到） */
    fun relTo(anchor: String, key: String): Rect? {
        val b = map[anchor]?.takeIf { it.width > 0f } ?: return null
        val r = map[key] ?: return null
        if (r.width <= 0f) return null
        return r.translate(-b.left, -b.top)
    }

    /** 所有以 [prefix] 开头的键（同侧交换做 FLIP 时要先量一批旧位置） */
    fun snapshot(prefix: String): Map<String, Rect> =
        map.filterKeys { it.startsWith(prefix) }.filterValues { it.width > 0f }
}

@Composable
private fun EqStage(
    state: EqMoveUiState,
    problem: MoveProblem,
    reduced: Boolean,
    onCrossed: () -> Unit,
    onSwapped: (Boolean) -> Unit,
) {
    val view = state.view ?: return
    val act = state.curAction

    val geom = remember { EqGeom() }
    val fly = remember { Animatable(0f) }
    val flip = remember { Animatable(1f) }
    val slide = remember { Animatable(1f) }
    val borderHit = remember { Animatable(0f) }

    var playedKey by rememberSaveable { mutableIntStateOf(-1) }
    val flyKey = state.runToken * 10 + state.stepIndex

    // ── ② 飞：起飞（蓄力 → 抬起 → 加速越过等号线 → 落位）──
    LaunchedEffect(flyKey, state.phase) {
        if (reduced || state.phase != EqPhase.FLY || playedKey == flyKey) return@LaunchedEffect
        // 几何可能还没量到（第一帧）—— 最多等 4 帧
        var s: Rect? = null
        var t: Rect? = null
        var q: Rect? = null
        var tries = 0
        while (tries < 4 && (s == null || t == null || q == null)) {
            withFrameNanos { }
            s = geom.relTo("stage", "src")
            t = geom.relTo("stage", "slot")
            q = geom.relTo("stage", "eq")
            tries++
        }
        val ss = s ?: return@LaunchedEffect
        val tt = t ?: return@LaunchedEffect
        val qq = q ?: return@LaunchedEffect

        playedKey = flyKey
        // 幽灵中心到达等号线时的进度比例（dx 为 0 时按一半算）
        val span = tt.center.x - ss.center.x
        val cross = (if (abs(span) < 1f) 0.5f else (qq.center.x - ss.center.x) / span).coerceIn(0.3f, 0.8f)

        fly.snapTo(0f)
        // ★ 跨线那一刻：符号翻牌 + 等号线闪一下（由 VM 记账，翻牌动画在这里播）
        launch {
            snapshotFlow { fly.value }.first { it >= cross }
            onCrossed()
        }
        withFrameNanos { }
        fly.animateTo(
            targetValue = 1f,
            animationSpec = tween(
                durationMillis = EqMoveViewModel.T_FLY.toInt(),
                easing = CubicBezierEasing(0.45f, 0.05f, 0.35f, 1f),
            ),
        )
    }

    // 符号翻牌动画（0.56s：旧符号转半圈缩走、新符号从对面转出来）
    LaunchedEffect(flyKey, state.symFlipped) {
        if (!state.symFlipped) {
            flip.snapTo(1f)
            return@LaunchedEffect
        }
        if (reduced) {
            flip.snapTo(1f)
            return@LaunchedEffect
        }
        flip.snapTo(0f)
        flip.animateTo(1f, tween(560, easing = CubicBezierEasing(0.4f, 0f, 0.6f, 1f)))
    }

    // 等号线闪光
    LaunchedEffect(state.borderHit) {
        if (state.borderHit <= 0) return@LaunchedEffect
        if (reduced) return@LaunchedEffect
        borderHit.snapTo(1f)
        borderHit.animateTo(0f, tween(900, easing = CubicBezierEasing(0f, 0f, 0.58f, 1f)))
    }

    // ── 同侧交换：FLIP（先量旧位 → 换序 → 倒推回旧位 → 滑到新位）──
    var prevLeft by remember { mutableStateOf<Map<String, Rect>>(emptyMap()) }
    var slidePlan by remember { mutableStateOf<List<Pair<Int, Float>>>(emptyList()) }

    LaunchedEffect(state.phase, state.runToken) {
        if (reduced || state.phase != EqPhase.SLIDE || !problem.isSameSide) return@LaunchedEffect
        // ① 此刻渲染的还是「未换序」的形态 —— 先把旧位量下来
        prevLeft = geom.snapshot("lval-")
        onSwapped(true)
    }

    LaunchedEffect(state.swapped, state.runToken) {
        if (reduced || !state.swapped || !problem.isSameSide) return@LaunchedEffect
        repeat(2) { withFrameNanos { } } // 等换序后的布局落定
        val plan = mutableListOf<Pair<Int, Float>>()
        view.left.forEachIndexed { i, term ->
            val prev = prevLeft[term.value] ?: return@forEachIndexed
            val now = geom.abs("lval-${term.value}") ?: return@forEachIndexed
            val dx = prev.left - now.left
            if (abs(dx) < 0.5f) return@forEachIndexed // 位置没动（比如中间那个「+」）就别动它
            plan.add(i to dx)
        }
        slidePlan = plan
        slide.snapTo(0f)
        slide.animateTo(
            targetValue = 1f,
            animationSpec = tween(
                durationMillis = EqMoveViewModel.T_SLIDE.toInt(),
                easing = CubicBezierEasing(0.34f, 1.16f, 0.64f, 1f),
            ),
        )
        slidePlan = emptyList()
    }

    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFFF8FAFC))
            .border(1.dp, Color(0xFFE2E8F0), RoundedCornerShape(14.dp))
            .padding(start = 14.dp, end = 14.dp, top = 26.dp, bottom = 30.dp)
            .onGloballyPositioned { geom.report("stage", it.boundsInRoot()) },
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            EqSideContent(
                side = view.left,
                which = EqSide.LEFT,
                act = act,
                state = state,
                geom = geom,
                slidePlan = slidePlan,
                slideT = slide.value,
                valuePrefix = "lval-",
                modifier = Modifier.weight(1f),
            )
            Text(
                "=",
                fontSize = 28.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Faint,
                modifier = Modifier
                    .padding(horizontal = 2.dp)
                    .posReporter { geom.report("eq", it) },
            )
            EqSideContent(
                side = view.right,
                which = EqSide.RIGHT,
                act = act,
                state = state,
                geom = geom,
                slidePlan = emptyList(),
                slideT = 1f,
                valuePrefix = "rval-",
                modifier = Modifier.weight(1f),
            )
        }

        // 等号分界线（上、下两段，等号自己是门）—— 用 Canvas 画，跨线时闪一下
        Canvas(Modifier.matchParentSize()) {
            val stage = geom.abs("stage") ?: return@Canvas
            val eq = geom.relTo("stage", "eq") ?: return@Canvas
            val x = eq.center.x
            val lit = borderHit.value
            val color = lerpColor(BorderColor, BorderHitColor, lit)
            val dash = PathEffect.dashPathEffect(floatArrayOf(7f, 7f))
            val topH = (eq.top - 5f).coerceAtLeast(0f)
            val botTop = eq.bottom + 5f
            val botH = (stage.height - eq.bottom - 5f).coerceAtLeast(0f)
            if (topH > 2f) {
                drawLine(color, Offset(x, 0f), Offset(x, topH), strokeWidth = 2f + 2f * lit, pathEffect = dash)
            }
            if (botH > 2f) {
                drawLine(color, Offset(x, botTop), Offset(x, botTop + botH), strokeWidth = 2f + 2f * lit, pathEffect = dash)
            }
        }

        // 「等号 = 分界」标签（贴在竖线下端）
        val stageRect = geom.abs("stage")
        val eqRect = geom.relTo("stage", "eq")
        if (stageRect != null && eqRect != null) {
            val dx = eqRect.center.x - stageRect.width / 2f
            Text(
                "等号 = 分界",
                fontSize = 10.sp,
                color = Faint,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .offset { IntOffset(dx.roundToInt(), 0) }
                    .clip(RoundedCornerShape(4.dp))
                    .background(Color.White)
                    .padding(horizontal = 5.dp),
            )
        }

        // ② 飞：飞行中的幽灵（相对 stage 坐标，不参与布局）
        if (!reduced && state.phase == EqPhase.FLY && act != null) {
            val s = geom.relTo("stage", "src")
            val t = geom.relTo("stage", "slot")
            val q = geom.relTo("stage", "eq")
            if (s != null && t != null && q != null) {
                val gx = t.center.x - s.center.x
                val gy = t.center.y - s.center.y
                val span = gx
                val cross = (if (abs(span) < 1f) 0.5f else (q.center.x - s.center.x) / span).coerceIn(0.3f, 0.8f)
                val pose = eqGhostPose(fly.value, gx, gy, cross)
                Box(
                    Modifier
                        .offset { IntOffset((s.left + pose.dx).roundToInt(), (s.top + pose.dy).roundToInt()) }
                        .graphicsLayer {
                            scaleX = pose.scale
                            scaleY = pose.scale
                            alpha = pose.alpha
                        },
                ) {
                    GhostBlock(act = act, flipped = state.symFlipped, t = flip.value)
                }
            }
        }
    }
}

/** 幽灵的分段轨迹（蓄力 → 抬起 → 越过等号线 → 落位），等价于 web 的 4 段 WAAPI keyframes */
private class EqGhostPose(val dx: Float, val dy: Float, val scale: Float, val alpha: Float)

private fun eqGhostPose(t: Float, gx: Float, gy: Float, cross: Float): EqGhostPose {
    val s1 = 0.16f
    return when {
        // 蓄力：缩一下再起跳（easeOutBack 同款手感）
        t < s1 -> {
            val k = (t / s1).coerceIn(0f, 1f)
            val u = easeOutBack(k)
            EqGhostPose(-6f * u, -13f * u, 0.86f + 0.14f * u, k)
        }
        t < cross -> {
            val u = ((t - s1) / (cross - s1)).coerceIn(0f, 1f)
            EqGhostPose(
                lerp(-6f, gx * cross, u),
                lerp(-13f, gy * cross - 32f, u),
                lerp(1f, 1.16f, u),
                1f,
            )
        }
        else -> {
            val u = ((t - cross) / (1f - cross)).coerceIn(0f, 1f)
            EqGhostPose(
                lerp(gx * cross, gx, u),
                lerp(gy * cross - 32f, gy, u),
                lerp(1.16f, 1f, u),
                1f,
            )
        }
    }
}

private fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t

private fun lerpColor(a: Color, b: Color, t: Float): Color = Color(
    red = lerp(a.red, b.red, t),
    green = lerp(a.green, b.green, t),
    blue = lerp(a.blue, b.blue, t),
)

private fun easeOutBack(x: Float): Float {
    val c1 = 1.70158f
    val c3 = c1 + 1f
    val p = x - 1f
    return 1f + c3 * p * p * p + c1 * p * p
}

/** 同侧交换：一项「向右走抬上去、向左走沉下来」，否则两项会在半路正面叠成一个「x5」 */
private fun slidePose(t: Float, dx: Float): Offset {
    val lift = if (dx > 0f) -16f else 16f
    return if (t < 0.5f) {
        val k = (t / 0.5f).coerceIn(0f, 1f)
        Offset(lerp(dx, dx * 0.5f, k), lerp(0f, lift, k))
    } else {
        val k = ((t - 0.5f) / 0.5f).coerceIn(0f, 1f)
        Offset(lerp(dx * 0.5f, 0f, k), lerp(lift, 0f, k))
    }
}

/** 位置上报（boundsInRoot 的绝对值，由 [EqGeom] 负责换算） */
private fun Modifier.posReporter(onPos: (Rect) -> Unit): Modifier =
    this.then(Modifier.onGloballyPositioned { onPos(it.boundsInRoot()) })

/**
 * 等式的一侧：逐项渲染 + 目标侧的隐性落位槽。
 *
 * ★ 落位槽**从动画一开始就渲染**（alpha 0 占位）⇒ 整个动画期间两侧宽度完全不变，
 *   幽灵落点才能像素级准确（这是本页好看的前提）。
 */
@Composable
private fun EqSideContent(
    side: EqSideList,
    which: EqSide,
    act: MoveAction?,
    state: EqMoveUiState,
    geom: EqGeom,
    slidePlan: List<Pair<Int, Float>>,
    slideT: Float,
    valuePrefix: String,
    modifier: Modifier = Modifier,
) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            side.forEachIndexed { i, term ->
                val taking = act != null && act.from == which && i == act.index
                val plan = slidePlan.firstOrNull { it.first == i }
                val slideOff = if (plan != null && slideT < 1f) slidePose(slideT, plan.second) else null
                EqToken(
                    op = term.op,
                    value = term.value,
                    isVar = term.isVar,
                    taking = taking,
                    lit = taking && state.phase == EqPhase.FIND && !state.stepDone,
                    taken = taking && state.stepDone,
                    modifier = Modifier
                        .then(
                            if (taking && !state.stepDone) Modifier.posReporter { geom.report("src", it) }
                            else Modifier,
                        )
                        .then(
                            if (slideOff != null) {
                                Modifier.offset { IntOffset(slideOff.x.roundToInt(), slideOff.y.roundToInt()) }
                            } else {
                                Modifier
                            },
                        ),
                    valueModifier = Modifier.posReporter { geom.report("$valuePrefix${term.value}", it) },
                )
            }
            // 落位槽：隐形占位（落位后才显形，落点与幽灵终点重合 ⇒ 交接无接缝）
            if (act != null && act.from != which) {
                EqToken(
                    op = act.toOp,
                    value = act.value,
                    isVar = act.isVar,
                    slot = true,
                    slotOn = state.stepDone,
                    modifier = Modifier.posReporter { geom.report("slot", it) },
                )
            }
        }
    }
}

/** 舞台上的一个 token（真身 / 落位槽共用同一套样式 ⇒ 与幽灵交接无感） */
@Composable
private fun EqToken(
    op: EqOp?,
    value: String,
    isVar: Boolean,
    modifier: Modifier = Modifier,
    valueModifier: Modifier = Modifier,
    taking: Boolean = false,
    lit: Boolean = false,
    taken: Boolean = false,
    slot: Boolean = false,
    slotOn: Boolean = false,
) {
    // 「找」：要搬走的这一整块脉动高亮
    val pulse = if (lit) {
        val tr = rememberInfiniteTransition(label = "eq-lit")
        tr.animateFloat(
            initialValue = 1f,
            targetValue = 1.055f,
            animationSpec = infiniteRepeatable(tween(760, easing = LinearEasing), RepeatMode.Reverse),
            label = "eq-lit-pulse",
        ).value
    } else {
        1f
    }
    val alpha = when {
        slot -> if (slotOn) 1f else 0f
        taken -> 0.3f
        else -> 1f
    }
    Row(
        modifier = modifier
            .graphicsLayer {
                scaleX = pulse
                scaleY = pulse
                this.alpha = alpha
            }
            .clip(RoundedCornerShape(9.dp))
            .background(if (taking && !taken) LitAmber else Color.Transparent)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (op != null) OpGlyphText(op, dim = taken)
        Text(
            text = value,
            fontSize = STAGE_FONT,
            fontWeight = FontWeight.ExtraBold,
            color = if (taken) Faint else InkColor,
            fontStyle = if (isVar) FontStyle.Italic else FontStyle.Normal,
            textDecoration = if (taken) TextDecoration.LineThrough else TextDecoration.None,
            modifier = valueModifier,
        )
    }
}

@Composable
private fun OpGlyphText(op: EqOp, dim: Boolean = false) {
    Text(
        op.sym,
        fontSize = STAGE_FONT,
        fontWeight = FontWeight.ExtraBold,
        color = (if (op == EqOp.MUL || op == EqOp.DIV) MdColor else AsColor)
            .let { if (dim) it.copy(alpha = 0.45f) else it },
    )
}

/**
 * 飞行中的幽灵。
 * ★ 跨线瞬间：旧符号转半圈缩走、新符号从对面转出来 —— 这就是「变号」那一帧。
 *   首项本来就没写符号 ⇒ 旧符号位不能凭空冒出来（web 用 visibility:hidden，这里直接不画）。
 */
@Composable
private fun GhostBlock(act: MoveAction, flipped: Boolean, t: Float) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(9.dp))
            .background(LitAmber)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (flipped) {
            Box(Modifier.width(GlyphW), contentAlignment = Alignment.Center) {
                if (t < 1f && act.srcOp != null) {
                    FlippingGlyph(op = act.srcOp, rot = -180f * t, scale = 1f - t, alpha = 1f - t)
                }
                FlippingGlyph(op = act.toOp, rot = 180f * (1f - t), scale = t, alpha = 1f)
            }
        } else if (act.srcOp != null) {
            OpGlyphText(act.srcOp)
        }
        Text(
            text = act.value,
            fontSize = STAGE_FONT,
            fontWeight = FontWeight.ExtraBold,
            color = InkColor,
            fontStyle = if (act.isVar) FontStyle.Italic else FontStyle.Normal,
        )
    }
}

@Composable
private fun FlippingGlyph(op: EqOp, rot: Float, scale: Float, alpha: Float) {
    Text(
        op.sym,
        fontSize = STAGE_FONT,
        fontWeight = FontWeight.ExtraBold,
        color = if (op == EqOp.MUL || op == EqOp.DIV) MdColor else AsColor,
        modifier = Modifier.graphicsLayer {
            rotationZ = rot
            scaleX = scale
            scaleY = scale
            this.alpha = alpha
        },
    )
}

/***************************************
 * 「为什么能移项」—— 两边同时减去同一个数
 ***************************************/

@Composable
private fun WhyMoveDemo(reduced: Boolean) {
    val a = 5
    val b = 12
    var step by remember { mutableIntStateOf(3) }
    LaunchedEffect(reduced) {
        if (reduced) {
            step = 3
            return@LaunchedEffect
        }
        step = 0
        for (s in 1..3) {
            delay(1100)
            step = s
        }
    }

    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFC)),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                "🔍 为什么能「挪过去」？因为等号两边像天平 —— 两边做同样的事，天平还是平的。",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Black0,
            )
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // 左边：x +5 (-5)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("x", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, fontStyle = FontStyle.Italic, color = InkColor)
                    WhyTerm(text = "+", num = a.toString(), struck = step >= 2)
                    if (step >= 1) WhyTerm(text = "-", num = a.toString(), struck = step >= 2)
                }
                Text("=", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = Faint)
                // 右边：12 (-5)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("$b", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = InkColor)
                    if (step >= 1) WhyTerm(text = "-", num = a.toString(), struck = false)
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(
                when {
                    step < 1 -> "看 —— 两边同时「减去 $a」……"
                    step < 2 -> "左边加了 +$a 又减去 $a，正好抵消；右边老老实实减掉 $a。"
                    step < 3 -> "一抵消，左边就只剩 x 了。"
                    else -> "所以 x = $b - $a = ${b - a}，这和「把 +$a 挪过去变 -$a」结果完全一样 —— 移项变号就是这条捷径。"
                },
                fontSize = 13.sp,
                color = Slate,
            )
        }
    }
}

@Composable
private fun WhyTerm(text: String, num: String, struck: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = if (struck) Modifier.graphicsLayer { alpha = 0.35f } else Modifier,
    ) {
        Text(text, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = AsColor)
        Text(
            num,
            fontSize = 22.sp,
            fontWeight = FontWeight.ExtraBold,
            color = InkColor,
            textDecoration = if (struck) TextDecoration.LineThrough else TextDecoration.None,
        )
    }
}

/***************************************
 * 易错示例卡（错误红闪抖动 vs 正确绿闪落定）
 ***************************************/

@Composable
private fun MistakeCard(m: EqMistakeCase) {
    var showRight by remember { mutableStateOf(false) }
    var shake by remember { mutableFloatStateOf(0f) }

    // LazyColumn 里「滚到才 composition」⇒ 天然复刻 web 的 IntersectionObserver：
    // 先让错的红卡抖一下，1.1s 后再揭晓正确的
    LaunchedEffect(Unit) {
        repeat(3) {
            shake = -5f
            delay(70)
            shake = 5f
            delay(70)
        }
        shake = 0f
        delay(1100)
        showRight = true
    }

    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text("⚠️ ${m.title}", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Black0)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Tag("❌ 错", Color(0xFFFEE2E2), BadColor)
                Text(
                    m.wrong,
                    fontSize = 14.sp,
                    color = BadColor,
                    modifier = Modifier.weight(1f).graphicsLayer { translationX = shake },
                )
            }
            Spacer(Modifier.height(6.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.graphicsLayer { alpha = if (showRight) 1f else 0f },
            ) {
                Tag("✅ 对", Color(0xFFDCFCE7), OkColor)
                Text(m.right, fontSize = 14.sp, color = OkColor, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(8.dp))
            Text(m.why, fontSize = 13.sp, color = Slate)
            Text("💡 ${m.tip}", fontSize = 13.sp, color = Slate, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun Tag(text: String, bg: Color, fg: Color) {
    Text(
        text,
        fontSize = 12.sp,
        color = fg,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/***************************************
 * 练习区：对比练习卡 + 随机 5 题
 ***************************************/

@Composable
private fun DrillSection(
    state: EqMoveUiState,
    onReshuffle: () -> Unit,
    onGraded: (Boolean) -> Unit,
) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "🎯 随机 5 题 · 专练移项变号",
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = Black0,
                modifier = Modifier.weight(1f),
            )
            // ⚠️ 这里是页内小按钮，必须把宽度收回到自身（web 靠 width:auto + flex:0 0 auto）
            Text(
                "🔄 换一组",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Black0,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFF1F5F9))
                    .border(1.dp, Color(0xFFCBD5E1), RoundedCornerShape(10.dp))
                    .clickableNoRipple(onClick = onReshuffle)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
        Text(
            "每轮都把四条规律练到（+ ↔ -、× ↔ ÷）—— 先看清它有没有跨过等号，再点答案。",
            fontSize = 12.sp,
            color = Grey,
            modifier = Modifier.padding(top = 4.dp, bottom = 6.dp),
        )
        // 计分
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("已答 ", fontSize = 13.sp, color = Slate)
            Text("${state.drillAnswered}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Black0)
            Text(" / ${state.drill.size}　·　答对 ", fontSize = 13.sp, color = Slate)
            Text("${state.drillCorrect}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Black0)
            Text(" 道", fontSize = 13.sp, color = Slate)
        }
        if (state.drillAnswered >= state.drill.size && state.drill.isNotEmpty()) {
            Text(
                if (state.drillCorrect == state.drill.size) {
                    "🎉 全对！这条规律你已经拿下了"
                } else {
                    "再点「换一组」接着练"
                },
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = if (state.drillCorrect == state.drill.size) OkColor else Slate,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Spacer(Modifier.height(8.dp))
        state.drill.forEachIndexed { i, item ->
            // 换一组 ⇒ drillRound 变化 ⇒ 整组重挂载（清掉上一组的作答状态）
            key(state.drillRound, i) {
                PracticeCard(item = item, index = i + 1, onGraded = onGraded)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** 四个选项正好是四种符号（顺序与 web 的 OPS 一致） */
private val OPS: List<EqOp> = listOf(EqOp.ADD, EqOp.SUB, EqOp.MUL, EqOp.DIV)

/**
 * 练习卡：先猜符号，再揭晓。
 * @param index 题号（随机练习区用；教材对比练习不传）
 * @param onGraded 首次点选时上报对错（随机练习区据此计分，每题只报一次）
 */
@Composable
private fun PracticeCard(
    item: EqPracticeItem,
    index: Int? = null,
    onGraded: ((Boolean) -> Unit)? = null,
) {
    var picked by remember { mutableStateOf<EqOp?>(null) }
    val ok = picked == item.answer
    /** 被搬走那一块的显示文本：普通题是「+8」，两步型是「-x」 */
    val moved = item.movedLabel ?: "${item.sym.sym}${item.num}"
    /** 选项里跟的数：两步型搬的是 x 本身，选项就该显示「+x」而不是「+8」 */
    val valLabel = if (item.movedLabel != null) "x" else item.num.toString()

    val borderColor = when {
        picked == null -> Color(0xFFE2E8F0)
        ok -> OkColor
        else -> BadColor
    }

    Card(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .border(1.dp, borderColor, RoundedCornerShape(12.dp)),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (index != null) {
                    Text(
                        index.toString(),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .size(18.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(Faint)
                            .padding(top = 1.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    item.before,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = InkColor,
                )
            }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("把 ", fontSize = 13.sp, color = Slate)
                Text(moved, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = AsColor)
                Text(" 挪到等号右边，它该变成什么？", fontSize = 13.sp, color = Slate)
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OPS.forEach { o ->
                    val chosen = picked == o
                    val fg = when {
                        chosen && ok -> Color.White
                        chosen && !ok -> Color.White
                        else -> if (o == EqOp.MUL || o == EqOp.DIV) MdColor else AsColor
                    }
                    val bg = when {
                        chosen && ok -> OkColor
                        chosen && !ok -> BadColor
                        else -> Color(0xFFF8FAFC)
                    }
                    Text(
                        text = "${o.sym}$valLabel",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = fg,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(bg)
                            .border(1.dp, if (chosen) bg else Color(0xFFCBD5E1), RoundedCornerShape(10.dp))
                            .clickableNoRipple {
                                // 每题只在**首次**点选时计分
                                if (picked == null) onGraded?.invoke(o == item.answer)
                                picked = o
                            }
                            .padding(vertical = 9.dp),
                    )
                }
            }
            if (picked != null) {
                Spacer(Modifier.height(8.dp))
                if (ok) {
                    Text(
                        "✅ 对了！${item.why}（x = ${item.x}）",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = OkColor,
                    )
                    Text(item.result, fontSize = 13.sp, color = Slate, modifier = Modifier.padding(top = 2.dp))
                } else {
                    Text(
                        "❌ 再想想 —— 它跨过了等号，符号必须变相反：「${item.sym.sym}」要变成「${eqFlipOp(item.sym).sym}」。",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = BadColor,
                    )
                }
            }
        }
    }
}
