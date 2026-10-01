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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.math.EQ_KIND_GROUPS
import com.example.ai.data.math.EQ_KIND_ICON
import com.example.ai.data.math.EQ_KIND_LABEL
import com.example.ai.data.math.EQ_KIND_TIP
import com.example.ai.data.math.EQ_MISTAKE_CASES
import com.example.ai.data.math.EQ_PRACTICE
import com.example.ai.data.math.EQ_RULES
import com.example.ai.data.math.EqActionType
import com.example.ai.data.math.EqMistakeCase
import com.example.ai.data.math.EqOp
import com.example.ai.data.math.EqPracticeAnswer
import com.example.ai.data.math.EqPracticeAsk
import com.example.ai.data.math.EqPracticeItem
import com.example.ai.data.math.EqSolveItem
import com.example.ai.data.math.EqSolveStep
import com.example.ai.data.math.EqStepType
import com.example.ai.data.math.EqSide
import com.example.ai.data.math.EqSideList
import com.example.ai.data.math.EqState
import com.example.ai.data.math.MoveAction
import com.example.ai.data.math.MoveKind
import com.example.ai.data.math.MoveProblem
import com.example.ai.data.math.eqFlipOp
import com.example.ai.data.math.eqSideToText
import com.example.ai.data.math.eqToText
import com.example.ai.ui.icon.MathIcon
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
/** 合并同类项的结果高亮（紫）—— 与移项的橙 / 蓝刻意区分开，学生一眼看出「这一步不是移项」 */
private val MergedBg = Color(0xFFEDE9FE)
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
                // ★ 左图右文：图标 20dp + 一行短提示（图元数据与 web 同源）
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    MathIcon(
                        name = EQ_KIND_ICON[problem.kind].orEmpty(),
                        size = 20.dp,
                        tint = Color(0xFF0F766E),
                    )
                    Spacer(Modifier.width(7.dp))
                    Text(
                        EQ_KIND_TIP[problem.kind].orEmpty(),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Grey,
                    )
                }
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
                    "先想一想再点选 —— 最后一个「不变」是专门用来迷惑你的。",
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
                // ★ 左图右文：图标一列（30dp）+ 文字一列 —— 一幅图顶一条口诀
                Row(Modifier.fillMaxWidth()) {
                    MathIcon(name = block.icon, size = 30.dp, tint = AsColor)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(block.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Black0)
                        block.lines.forEach { line ->
                            Text(
                                "· $line",
                                fontSize = 13.sp,
                                color = Slate,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

/** 题型选择：13 种按引擎的 [EQ_KIND_GROUPS] 分四组，每组三列 —— **别在这里手写清单**。
 *  ⚠️ 上一版就是因为页面里硬编码了 7 种，引擎加了新题型页面却一个都不显示。 */
@Composable
private fun KindRows(current: MoveKind, onPick: (MoveKind) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        EQ_KIND_GROUPS.forEach { group ->
            Text(
                group.title,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = Grey,
                modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
            )
            group.kinds.chunked(3).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    row.forEach { k ->
                        val on = k == current
                        Text(
                            EQ_KIND_LABEL[k].orEmpty(),
                            fontSize = 11.sp,
                            fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                            color = if (on) Color.White else Black0,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(999.dp))
                                .background(if (on) MdColor else Color(0xFFF1F5F9))
                                .border(1.dp, if (on) MdColor else Color(0xFFCBD5E1), RoundedCornerShape(999.dp))
                                .clickableNoRipple { onPick(k) }
                                .padding(vertical = 7.dp),
                        )
                    }
                    // 最后一行不满 3 个时补空位，免得按钮被拉宽（要跟别行等宽）
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                }
                Spacer(Modifier.height(6.dp))
            }
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

    // ── 同侧换位 / 合并 / 两边对调：FLIP（先量旧位 → 切 state → 倒推回旧位 → 滑到新位）──
    //   ★ 这三类动作**都不跨等号线**，所以绝不能让它们走「幽灵飞越」那条路 ——
    //     否则会把「同侧换位、符号不变」画成「整块飞过等号」，教学上正好教反。
    var prevSide by remember { mutableStateOf<Map<String, Rect>>(emptyMap()) }
    var slideSide by remember { mutableStateOf(EqSide.LEFT) }
    var slidePlan by remember { mutableStateOf<List<Pair<Int, Float>>>(emptyList()) }

    LaunchedEffect(state.phase, state.runToken) {
        if (reduced || state.phase != EqPhase.SLIDE) return@LaunchedEffect
        val a = state.curAction
        if (a == null || a.type == EqActionType.MOVE) return@LaunchedEffect
        // ① 此刻渲染的还是「换位前 / 合并前」的形态 —— 先把那一侧的旧位置量下来
        slideSide = a.from
        prevSide = geom.snapshot(if (a.from == EqSide.LEFT) "lval-" else "rval-")
        onSwapped(true)
    }

    LaunchedEffect(state.swapped, state.runToken) {
        if (reduced || !state.swapped) return@LaunchedEffect
        val a = state.curAction
        if (a == null || a.type == EqActionType.MOVE) return@LaunchedEffect
        val own = if (a.from == EqSide.LEFT) view.left else view.right
        val prefix = if (a.from == EqSide.LEFT) "lval-" else "rval-"
        repeat(2) { withFrameNanos { } } // 等换序后的布局落定
        val plan = mutableListOf<Pair<Int, Float>>()
        own.forEachIndexed { i, term ->
            // ⚠️ snapshot 的 key 是**带前缀的完整 key**（"lval-8"），不能拿 term.value 去查
            //    —— 旧代码就是漏了前缀，导致同侧滑动压根没动过。
            val prev = prevSide["$prefix${term.value}"] ?: return@forEachIndexed
            val now = geom.abs("$prefix${term.value}") ?: return@forEachIndexed
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
                slidePlan = if (slideSide == EqSide.LEFT) slidePlan else emptyList(),
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
                slidePlan = if (slideSide == EqSide.RIGHT) slidePlan else emptyList(),
                slideT = slide.value,
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
    /** 字号 —— 主舞台 26sp；分步练习卡里要小一号（一屏 6 张卡，26sp 会把卡片撑破） */
    size: TextUnit = STAGE_FONT,
    /** 项与项之间的间距 */
    spacing: Dp = 8.dp,
) {
    val isSrc = act != null && act.from == which
    val move = act?.type == EqActionType.MOVE
    val idx = act?.index ?: -1
    val idx2 = act?.index2 ?: -1
    Box(modifier, contentAlignment = Alignment.Center) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing),
        ) {
            side.forEachIndexed { i, term ->
                // move：只动 index 那 1 项 · swap / combine：index 与 index2 两项都参与
                val taking = move && isSrc && i == idx
                // 换位的**另一项**也要一起亮起来 —— 只亮一半会让学生以为只有它在动
                val involved = isSrc && (i == idx || i == idx2) && !taking &&
                    (state.phase == EqPhase.FIND || state.phase == EqPhase.SLIDE)
                // 合并完成后，活下来的那一项亮一下 —— 它就是「两块合起来的结果」
                val merged = act?.type == EqActionType.COMBINE && state.swapped && isSrc && i == idx
                val plan = slidePlan.firstOrNull { it.first == i }
                val slideOff = if (plan != null && slideT < 1f) slidePose(slideT, plan.second) else null
                EqToken(
                    op = term.op,
                    value = term.value,
                    isVar = term.isVar,
                    taking = taking,
                    lit = taking && state.phase == EqPhase.FIND && !state.stepDone,
                    taken = taking && state.stepDone,
                    involved = involved,
                    merged = merged,
                    size = size,
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
            // ★ 落位槽**只有 move 才该有**。swap / combine / flip 根本不跨线 ——
            //   给它们凭空加一个槽，动画就会把「同侧换位」画成「整块飞过等号」，教学上正好相反。
            if (move && act.from != which) {
                EqToken(
                    op = act.toOp,
                    value = act.value,
                    isVar = act.isVar,
                    slot = true,
                    slotOn = state.stepDone,
                    size = size,
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
    /** 字号 —— 卡片里要小一号（见 [EqSideContent] 的 size） */
    size: TextUnit = STAGE_FONT,
    /** 内边距 —— 同样随字号缩小，卡片里才不臃肿 */
    padH: Dp = 6.dp,
    padV: Dp = 2.dp,
    taking: Boolean = false,
    lit: Boolean = false,
    taken: Boolean = false,
    /** swap / combine 里「参与的另一项」也一起亮 —— 只亮一半会让学生以为只有它在动 */
    involved: Boolean = false,
    /** 合并完成后，活下来的那一项亮紫色（与移项的橙 / 蓝区分） */
    merged: Boolean = false,
    slot: Boolean = false,
    slotOn: Boolean = false,
) {
    // 「找」：要搬走（或要换位）的这一整块脉动高亮
    val pulse = if (lit || involved) {
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
            .background(
                when {
                    merged -> MergedBg
                    // 只有「正在找 / 正在滑」这几拍才亮 —— 未播放（IDLE）与落位后都不该亮
                    // （web 侧同理：只有 phase==="find" 才加 eq-lit）
                    lit || involved -> LitAmber
                    else -> Color.Transparent
                },
            )
            .then(
                if (merged) Modifier.border(2.dp, Color(0x478B5CF6), RoundedCornerShape(9.dp)) else Modifier,
            )
            .padding(horizontal = padH, vertical = padV),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (op != null) OpGlyphText(op, dim = taken, size = size)
        Text(
            text = value,
            fontSize = size,
            fontWeight = FontWeight.ExtraBold,
            color = if (taken) Faint else InkColor,
            fontStyle = if (isVar) FontStyle.Italic else FontStyle.Normal,
            textDecoration = if (taken) TextDecoration.LineThrough else TextDecoration.None,
            modifier = valueModifier,
        )
    }
}

@Composable
private fun OpGlyphText(op: EqOp, dim: Boolean = false, size: TextUnit = STAGE_FONT) {
    Text(
        op.sym,
        fontSize = size,
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
private fun GhostBlock(
    act: MoveAction,
    flipped: Boolean,
    t: Float,
    size: TextUnit = STAGE_FONT,
    glyphW: Dp = GlyphW,
    padH: Dp = 6.dp,
    padV: Dp = 2.dp,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(9.dp))
            .background(LitAmber)
            .padding(horizontal = padH, vertical = padV),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (flipped) {
            Box(Modifier.width(glyphW), contentAlignment = Alignment.Center) {
                if (t < 1f && act.srcOp != null) {
                    FlippingGlyph(op = act.srcOp, rot = -180f * t, scale = 1f - t, alpha = 1f - t, size = size)
                }
                FlippingGlyph(op = act.toOp, rot = 180f * (1f - t), scale = t, alpha = 1f, size = size)
            }
        } else if (act.srcOp != null) {
            OpGlyphText(act.srcOp, size = size)
        }
        Text(
            text = act.value,
            fontSize = size,
            fontWeight = FontWeight.ExtraBold,
            color = InkColor,
            fontStyle = if (act.isVar) FontStyle.Italic else FontStyle.Normal,
        )
    }
}

@Composable
private fun FlippingGlyph(op: EqOp, rot: Float, scale: Float, alpha: Float, size: TextUnit = STAGE_FONT) {
    Text(
        op.sym,
        fontSize = size,
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                MathIcon(name = "balance", size = 22.dp, tint = Color(0xFF0F766E))
                Spacer(Modifier.width(8.dp))
                Text(
                    "两边同时做同一件事，天平还是平的",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Black0,
                )
            }
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
                    step < 2 -> "左边 +$a 又 -$a，抵消了；右边实打实减掉 $a。"
                    step < 3 -> "一抵消，左边就只剩 x 了。"
                    else -> "所以 x = $b - $a = ${b - a} —— 跟「把 +$a 挪过去变 -$a」一样，移项变号就是这条捷径。"
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
                "🧩 分步解方程 · 6 题",
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
            "一步一填：这一步跨没跨过等号？选完答案，就看这一拍的动画。",
            fontSize = 12.sp,
            color = Grey,
            modifier = Modifier.padding(top = 4.dp, bottom = 6.dp),
        )
        // 计分：★ 单位是**步**（不是题）—— 每一步只在首次点选时记一次成绩
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("已填 ", fontSize = 13.sp, color = Slate)
            Text("${state.drillAnswered}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Black0)
            Text(" / ${state.drillStepCount} 步　·　一次答对 ", fontSize = 13.sp, color = Slate)
            Text("${state.drillCorrect}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Black0)
            Text(" 步", fontSize = 13.sp, color = Slate)
        }
        if (state.drillAnswered >= state.drillStepCount && state.drill.isNotEmpty()) {
            Text(
                if (state.drillCorrect == state.drillStepCount) {
                    "🎉 全对！每一步都填对了"
                } else {
                    "再点「换一组」接着练"
                },
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = if (state.drillCorrect == state.drillStepCount) OkColor else Slate,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Spacer(Modifier.height(8.dp))
        state.drill.forEachIndexed { i, item ->
            // 换一组 ⇒ drillRound 变化 ⇒ 整组重挂载（清掉上一组的作答状态）
            key(state.drillRound, i) {
                SolveCard(item = item, index = i + 1, onGraded = onGraded)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** 五个选项：四个「变号」+ 一个「不变」—— 后者是「同侧换位」反例题的正确答案（顺序与 web 的 OPS 一致） */
private val OPS: List<EqPracticeAnswer> = listOf(
    EqPracticeAnswer.Op(EqOp.ADD),
    EqPracticeAnswer.Op(EqOp.SUB),
    EqPracticeAnswer.Op(EqOp.MUL),
    EqPracticeAnswer.Op(EqOp.DIV),
    EqPracticeAnswer.Same,
)

/** 选项上显示的文字（[EqPracticeAnswer.Same] ⇒ 「不变」，且后面不跟 x / 8） */
private fun opText(a: EqPracticeAnswer): String = when (a) {
    is EqPracticeAnswer.Op -> a.op.sym
    EqPracticeAnswer.Same -> "不变"
}

/** 第 5 个「不变」选项的字色（灰）—— 它跟四个「变号」选项不是一类 */
private val SameFg = Color(0xFF64748B)

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
    var picked by remember { mutableStateOf<EqPracticeAnswer?>(null) }
    val ok = picked == item.answer
    /** 「同侧换位」反例题：问法、选项、反馈都跟「跨线题」不一样 —— 答案是「不变」 */
    val sameSide = item.ask == EqPracticeAsk.SAME_SIDE
    /** 被搬走（或换位）那一块的显示文本：普通题是「+8」，两步型是「-x」 */
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
            // 问法：跨线题问「变成什么」；同侧反例题问「符号该怎么变」
            if (sameSide) {
                Text(
                    "它没有跨过等号，只是在等号同一边换了个位置 —— 符号该怎么变？",
                    fontSize = 13.sp,
                    color = Slate,
                )
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("把 ", fontSize = 13.sp, color = Slate)
                    Text(moved, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = AsColor)
                    Text(" 挪到等号右边，它该变成什么？", fontSize = 13.sp, color = Slate)
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OPS.forEach { o ->
                    val chosen = picked == o
                    val isSame = o == EqPracticeAnswer.Same
                    val fg = when {
                        chosen -> Color.White
                        isSame -> SameFg
                        else -> when ((o as? EqPracticeAnswer.Op)?.op) {
                            EqOp.MUL, EqOp.DIV -> MdColor
                            else -> AsColor
                        }
                    }
                    val bg = when {
                        chosen && ok -> OkColor
                        chosen && !ok -> BadColor
                        isSame -> Color.Transparent // 「不变」不透底，靠虚线框跟四个「变号」区分
                        else -> Color(0xFFF8FAFC)
                    }
                    Text(
                        text = if (isSame) opText(o) else "${opText(o)}$valLabel",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = fg,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(bg)
                            .then(
                                // 「不变」在未作答时用**虚线**灰框 —— 一眼看出它跟那四个不是一类
                                if (isSame && picked == null) {
                                    Modifier.drawBehind {
                                        drawRoundRect(
                                            color = BorderColor,
                                            cornerRadius = CornerRadius(10.dp.toPx()),
                                            style = Stroke(
                                                width = 2f,
                                                pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f)),
                                            ),
                                        )
                                    }
                                } else {
                                    Modifier.border(
                                        1.dp,
                                        if (chosen) bg else BorderColor,
                                        RoundedCornerShape(10.dp),
                                    )
                                },
                            )
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
                        if (sameSide) {
                            "❌ 再想想 —— 没跨等号，只是同侧换位，该选「不变」。"
                        } else {
                            "❌ 再想想 —— 它跨过了等号：「${item.sym.sym}」要变成「${eqFlipOp(item.sym).sym}」。"
                        },
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = BadColor,
                    )
                }
            }
        }
    }
}

/***************************************
 * 分步解方程练习卡 —— 学生跟着动画一步一步填，直到把 x 解出来
 *
 * 与 web/src/pages/EquationMovePage.tsx 的 SolveCard / SolveDone 逐项对齐。
 *
 * ★ 为什么卡片里的幽灵必须**绝对定位**（相对卡片自己的舞台），不能照搬主舞台那套：
 *   主舞台一屏只有一道题，幽灵用整页坐标没问题；这里一屏 6 张卡，
 *   再用视口坐标，幽灵就会飞出卡片、盖到隔壁卡上（web 侧的 fixed 幽灵同理）。
 *   Compose 里靠「每张卡一个独立的 [EqGeom] 实例 + 偏移相对卡片舞台」自然做到这件事。
 *
 * ★ 数学与动作类型**全部来自引擎**（item.steps[].action）—— 卡片只负责演，自己一步都不算。
 *
 * 🔴 教学正确性铁律（与主舞台同一条）：**只有 MOVE 跨等号线**。
 *   SWAP / COMBINE / FLIP 一个字节都不跨 ⇒ 绝不能落进「幽灵飞越」那条路，
 *   否则会把「同侧换位不变号」画成「整块飞过等号」，教学上正好教反。
 ***************************************/

/** 卡片内的字号 —— 一屏 6 张卡，主舞台的 26sp 会把卡片撑破 */
private val SOLVE_FONT = 20.sp

/** 卡片内动画时间轴（都比主舞台短一截：卡片小、一次 6 张，节奏拖长了整页会闹） */
private const val S_FIND = 560L
private const val S_FLY = 780L
private const val S_SLIDE = 700L
private const val S_LAND = 820L

/** 卡片内的阶段（与 web 的 SolvePhase 一一对应） */
private enum class SolveCardPhase { ASK, FIND, FLY, SLIDE, LAND, SETTLED }

/** 映射到主舞台的阶段枚举 —— 这样 [EqSideContent] / [EqToken] 能原样复用（涂装规则一字不改） */
private fun solvePhaseToEq(p: SolveCardPhase): EqPhase = when (p) {
    SolveCardPhase.ASK -> EqPhase.IDLE
    SolveCardPhase.FIND -> EqPhase.FIND
    SolveCardPhase.FLY -> EqPhase.FLY
    SolveCardPhase.SLIDE -> EqPhase.SLIDE
    SolveCardPhase.LAND -> EqPhase.LAND
    SolveCardPhase.SETTLED -> EqPhase.DONE
}

/** 选项按钮的字色：乘除蓝 / 加减橙 / 「不变」灰 / 数字黑 */
private fun solveOptFg(o: String): Color = when {
    o == "不变" -> SameFg
    o.startsWith("×") || o.startsWith("÷") -> MdColor
    o.startsWith("+") || o.startsWith("-") -> AsColor
    else -> InkColor
}

/**
 * 分步练习卡：一步一填。
 *
 * @param index 题号（不传就不画小圆点）
 * @param onGraded 每一步**只在第一次点选**时上报对错 —— 答错可以再试，但成绩只认第一次
 */
@Composable
private fun SolveCard(
    item: EqSolveItem,
    index: Int? = null,
    onGraded: ((Boolean) -> Unit)? = null,
) {
    val reduced = animationsDisabled(LocalContext.current)

    // 每张卡一个独立的几何注册表 ⇒ 6 张卡的 "src"/"slot"/"eq" 互不干扰
    val geom = remember { EqGeom() }
    val fly = remember { Animatable(0f) }
    val slide = remember { Animatable(1f) }
    /** 符号翻牌进度：0 = 还是旧符号，1 = 已经翻成新符号 */
    val flipAnim = remember { Animatable(1f) }

    var stepIndex by remember { mutableIntStateOf(0) }
    var phase by remember { mutableStateOf(SolveCardPhase.ASK) }
    /** 这一步已经点错过的选项（留在红框里，别让它偷偷变回正常） */
    var tried by remember { mutableStateOf<List<String>>(emptyList()) }
    /** 同侧重排（swap / combine）：是否已换过序 —— 只有它俩 + flip 用得上 */
    var swapped by remember { mutableStateOf(false) }
    var symFlipped by remember { mutableStateOf(false) }
    /** 递增计数：每次点对 +1 ⇒ 驱动下面那条时间轴（等价于 web 的 later() 定时器组） */
    var playToken by remember { mutableIntStateOf(0) }

    // 符号翻牌（0.56s：旧符号转半圈缩走、新符号从对面转出来）—— 与主舞台同款
    // ⚠️ 必须放在 symFlipped / playToken 的声明**之后**（Kotlin 局部声明不能前向引用）
    LaunchedEffect(symFlipped, playToken) {
        if (!symFlipped || reduced) {
            flipAnim.snapTo(1f)
            return@LaunchedEffect
        }
        flipAnim.snapTo(0f)
        flipAnim.animateTo(1f, tween(560, easing = CubicBezierEasing(0.4f, 0f, 0.6f, 1f)))
    }

    var slideSide by remember { mutableStateOf(EqSide.LEFT) }
    var slidePlan by remember { mutableStateOf<List<Pair<Int, Float>>>(emptyList()) }
    var prevSide by remember { mutableStateOf<Map<String, Rect>>(emptyMap()) }

    val step: EqSolveStep? = item.steps.getOrNull(stepIndex)
    val act = step?.action
    /** ★ 只有搬运才跨等号线 —— 换位/合并/对调只在同一侧重排（与主舞台同一条铁律） */
    val isMove = act?.type == EqActionType.MOVE
    /** 这一步已经填完了（答对之后） */
    val filled = phase == SolveCardPhase.LAND || phase == SolveCardPhase.SETTLED
    /** 两边整体对调那一拍（纯视觉擦身而过，不做 FLIP 测量） */
    val flipping = step?.type == EqStepType.FLIP && phase == SolveCardPhase.SLIDE

    /**
     * 卡片上此刻渲染的两侧。
     *  · move —— 全程停在 before：源项变灰留着、目标侧由隐形落位槽占位 ⇒ 飞越期间布局零重排
     *  · swap / combine —— 到点切 after，再靠 FLIP 补差值动画
     *  · flip（含 flipSides 补出来的那次对调）/「算出来」—— 到点直接切 after
     */
    val view: EqState? = when {
        step == null -> null
        isMove -> step.before
        act?.type == EqActionType.SWAP || act?.type == EqActionType.COMBINE ->
            if (swapped) step.after else step.before
        else -> if (phase == SolveCardPhase.ASK || phase == SolveCardPhase.FIND) step.before else step.after
    }

    // ── 时间轴：点对之后把这一拍的动画演出来（FIND → 飞/滑 → 落 → 停）──
    //    ⚠️ SOLVE 那一步没有可演的动作 ⇒ 直接亮结果。
    //    ⚠️ 同侧三类**绝不**走 fly 分支 —— 见文件头那条铁律。
    LaunchedEffect(playToken) {
        if (playToken == 0 || reduced) return@LaunchedEffect
        val s = step ?: return@LaunchedEffect
        val a = s.action
        if (s.type == EqStepType.SOLVE) {
            phase = SolveCardPhase.SETTLED
            return@LaunchedEffect
        }
        delay(S_FIND)
        if (a != null && a.type == EqActionType.MOVE) {
            // ── 飞：只有跨等号的搬运才走这条 ──
            phase = SolveCardPhase.FLY
            var src: Rect? = null
            var slot: Rect? = null
            var eqR: Rect? = null
            var tries = 0
            // 几何可能还没量到（第一帧）—— 最多等 4 帧
            while (tries < 4 && (src == null || slot == null || eqR == null)) {
                withFrameNanos { }
                src = geom.relTo("stage", "src")
                slot = geom.relTo("stage", "slot")
                eqR = geom.relTo("stage", "eq")
                tries++
            }
            val ss = src
            val tt = slot
            val qq = eqR
            if (ss != null && tt != null && qq != null) {
                // 幽灵中心到达等号线时的进度比例（dx 为 0 时按一半算）
                val span = tt.center.x - ss.center.x
                val cross = (if (abs(span) < 1f) 0.5f else (qq.center.x - ss.center.x) / span)
                    .coerceIn(0.3f, 0.8f)
                fly.snapTo(0f)
                // ★ 跨线那一刻：符号翻牌
                launch {
                    snapshotFlow { fly.value }.first { it >= cross }
                    symFlipped = true
                }
                withFrameNanos { }
                fly.animateTo(
                    targetValue = 1f,
                    animationSpec = tween(S_FLY.toInt(), easing = CubicBezierEasing(0.45f, 0.05f, 0.35f, 1f)),
                )
            }
            symFlipped = false
            phase = SolveCardPhase.LAND
            delay(S_LAND)
            phase = SolveCardPhase.SETTLED
        } else {
            // ── 同侧重排：一个字节都不跨等号线 ──
            phase = SolveCardPhase.SLIDE
            if (a != null && (a.type == EqActionType.SWAP || a.type == EqActionType.COMBINE)) {
                // ① 此刻渲染的还是「换位前 / 合并前」的形态 —— 先把那一侧的旧位置量下来
                slideSide = a.from
                prevSide = geom.snapshot(if (a.from == EqSide.LEFT) "lval-" else "rval-")
                swapped = true
                repeat(2) { withFrameNanos { } } // 等换序后的布局落定
                val own = if (a.from == EqSide.LEFT) view?.left.orEmpty() else view?.right.orEmpty()
                val prefix = if (a.from == EqSide.LEFT) "lval-" else "rval-"
                val plan = mutableListOf<Pair<Int, Float>>()
                own.forEachIndexed { i, term ->
                    // ⚠️ snapshot 的 key 是**带前缀的完整 key**（"lval-8"），不能拿 term.value 直接查
                    val prev = prevSide["$prefix${term.value}"] ?: return@forEachIndexed
                    val now = geom.abs("$prefix${term.value}") ?: return@forEachIndexed
                    val dx = prev.left - now.left
                    if (abs(dx) < 0.5f) return@forEachIndexed // 位置没动（比如中间那个「+」）就别动它
                    plan.add(i to dx)
                }
                slidePlan = plan
                slide.snapTo(0f)
                slide.animateTo(
                    targetValue = 1f,
                    animationSpec = tween(S_SLIDE.toInt(), easing = CubicBezierEasing(0.34f, 1.16f, 0.64f, 1f)),
                )
                slidePlan = emptyList()
            } else {
                // flip（含 flipSides 补出来的那次对调）：不做 FLIP 测量，靠整体擦身而过
                swapped = true
                slide.snapTo(0f)
                slide.animateTo(
                    targetValue = 1f,
                    animationSpec = tween(S_SLIDE.toInt(), easing = CubicBezierEasing(0.4f, 0f, 0.6f, 1f)),
                )
            }
            phase = SolveCardPhase.LAND
            delay(S_LAND)
            phase = SolveCardPhase.SETTLED
        }
    }

    val nextStep: () -> Unit = {
        stepIndex += 1
        phase = SolveCardPhase.ASK
        tried = emptyList()
        swapped = false
        symFlipped = false
        slidePlan = emptyList()
    }

    /** 点选项：错了可以再试（每一步都得真填对），对了就把这一拍的动画演出来 */
    val pick: (String) -> Unit = { o ->
        val s = step
        if (s != null && phase == SolveCardPhase.ASK) {
            val right = o == s.answer
            if (tried.isEmpty()) onGraded?.invoke(right) // 成绩只记第一次点选
            if (!right) {
                tried = tried + o
            } else if (reduced || s.type == EqStepType.SOLVE) {
                // 关掉了动画 / 这步没有可演的动作 ⇒ 直接到位
                swapped = true
                phase = SolveCardPhase.SETTLED
            } else {
                phase = SolveCardPhase.FIND
                playToken += 1
            }
        }
    }

    // ── 整道题已经填完了 ──
    if (step == null || view == null) {
        SolveDone(item = item, index = index)
        return
    }

    val borderColor = when {
        filled -> OkColor
        tried.isNotEmpty() -> BadColor
        else -> Color(0xFFE2E8F0)
    }
    val cardState = EqMoveUiState(
        phase = solvePhaseToEq(phase),
        stepDone = filled,
        swapped = swapped,
        symFlipped = symFlipped,
    )

    Card(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .border(1.dp, borderColor, RoundedCornerShape(12.dp)),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(11.dp)) {
            // ── 头：题号 + 原式 + 进度 ──
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (index != null) {
                    Text(
                        index.toString(),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .size(17.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(Faint)
                            .padding(top = 1.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    eqToText(item.initial),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = InkColor,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                Text("${stepIndex + 1} / ${item.steps.size}", fontSize = 11.sp, color = Faint)
            }

            // ── 已经填过的步骤：一行一条，攒起来就是完整的解题过程 ──
            if (stepIndex > 0) {
                Spacer(Modifier.height(6.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    for (i in 0 until stepIndex) {
                        val s = item.steps[i]
                        SolveChip(no = i + 1, label = s.label, after = eqToText(s.after))
                    }
                }
            }

            // ── 当前这一步的小舞台 ──
            Spacer(Modifier.height(7.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFF8FAFC))
                    .border(1.dp, Color(0xFFE2E8F0), RoundedCornerShape(10.dp))
                    .padding(start = 10.dp, end = 10.dp, top = 12.dp, bottom = 16.dp)
                    .onGloballyPositioned { geom.report("stage", it.boundsInRoot()) },
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    EqSideContent(
                        side = view.left,
                        which = EqSide.LEFT,
                        act = act,
                        state = cardState,
                        geom = geom,
                        slidePlan = if (slideSide == EqSide.LEFT) slidePlan else emptyList(),
                        slideT = slide.value,
                        valuePrefix = "lval-",
                        modifier = Modifier.weight(1f).then(eqFlipLayer(flipping, EqSide.LEFT, slide.value)),
                        size = SOLVE_FONT,
                        spacing = 6.dp,
                    )
                    Text(
                        "=",
                        fontSize = 21.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Faint,
                        modifier = Modifier
                            .padding(horizontal = 1.dp)
                            .posReporter { geom.report("eq", it) },
                    )
                    EqSideContent(
                        side = view.right,
                        which = EqSide.RIGHT,
                        act = act,
                        state = cardState,
                        geom = geom,
                        slidePlan = if (slideSide == EqSide.RIGHT) slidePlan else emptyList(),
                        slideT = slide.value,
                        valuePrefix = "rval-",
                        modifier = Modifier.weight(1f).then(eqFlipLayer(flipping, EqSide.RIGHT, slide.value)),
                        size = SOLVE_FONT,
                        spacing = 6.dp,
                    )
                }

                // 飞行中的幽灵（相对卡片舞台坐标，不参与布局）
                if (!reduced && phase == SolveCardPhase.FLY && act != null) {
                    val s = geom.relTo("stage", "src")
                    val t = geom.relTo("stage", "slot")
                    val q = geom.relTo("stage", "eq")
                    if (s != null && t != null && q != null) {
                        val gx = t.center.x - s.center.x
                        val gy = t.center.y - s.center.y
                        val cross = (if (abs(gx) < 1f) 0.5f else (q.center.x - s.center.x) / gx)
                            .coerceIn(0.3f, 0.8f)
                        val pose = eqGhostPose(fly.value, gx, gy, cross)
                        Box(
                            Modifier
                                .offset {
                                    IntOffset((s.left + pose.dx).roundToInt(), (s.top + pose.dy).roundToInt())
                                }
                                .graphicsLayer {
                                    scaleX = pose.scale
                                    scaleY = pose.scale
                                    alpha = pose.alpha
                                },
                        ) {
                            GhostBlock(
                                act = act,
                                flipped = symFlipped,
                                t = flipAnim.value,
                                size = SOLVE_FONT,
                                glyphW = 13.dp,
                                padH = 5.dp,
                                padV = 1.dp,
                            )
                        }
                    }
                }
            }

            // ── 问 + 选项 ──
            Spacer(Modifier.height(7.dp))
            Text(
                "第 ${stepIndex + 1} 步 · ${step.label}",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = AsColor,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color(0xFFFFF7ED))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            )
            Text(
                step.ask,
                fontSize = 12.5.sp,
                color = Slate,
                modifier = Modifier.padding(top = 5.dp),
            )

            Spacer(Modifier.height(7.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                step.options.forEach { o ->
                    val isRight = o == step.answer
                    val isWrong = tried.contains(o)
                    val showRight = phase != SolveCardPhase.ASK && isRight
                    val bg = when {
                        showRight -> OkColor
                        isWrong -> BadColor
                        o == "不变" -> Color.Transparent // 「不变」不透底，靠虚线框跟四个「变号」区分
                        else -> Color(0xFFF8FAFC)
                    }
                    Text(
                        text = o,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (showRight || isWrong) Color.White else solveOptFg(o),
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        textDecoration = if (isWrong) TextDecoration.LineThrough else TextDecoration.None,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(9.dp))
                            .background(bg)
                            .then(
                                if (o == "不变" && phase == SolveCardPhase.ASK) {
                                    Modifier.drawBehind {
                                        drawRoundRect(
                                            color = BorderColor,
                                            cornerRadius = CornerRadius(9.dp.toPx()),
                                            style = Stroke(
                                                width = 2f,
                                                pathEffect = PathEffect.dashPathEffect(floatArrayOf(9f, 7f)),
                                            ),
                                        )
                                    }
                                } else {
                                    Modifier.border(
                                        1.dp,
                                        if (showRight || isWrong) bg else BorderColor,
                                        RoundedCornerShape(9.dp),
                                    )
                                },
                            )
                            .clickableNoRipple(enabled = phase == SolveCardPhase.ASK) { pick(o) }
                            .padding(vertical = 8.dp),
                    )
                }
            }

            // ── 反馈 ──
            if (phase == SolveCardPhase.ASK && tried.isNotEmpty()) {
                val last = tried.last()
                val tip = if (step.trapAnswer != null && last == step.trapAnswer) {
                    step.trapTip ?: step.wrongTip
                } else {
                    step.wrongTip
                }
                Text(
                    "❌ 再想想 —— $tip",
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = BadColor,
                    modifier = Modifier.padding(top = 7.dp),
                )
            }
            if (filled) {
                Text(
                    "✅ 对了！${step.why}",
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = OkColor,
                    modifier = Modifier.padding(top = 7.dp),
                )
                Text(
                    "这一步做完：${eqToText(step.after)}",
                    fontSize = 12.sp,
                    color = Slate,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (phase == SolveCardPhase.SETTLED) {
                Text(
                    if (stepIndex + 1 < item.steps.size) "下一步 ▶" else "看结果 🎉",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 9.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(InkColor)
                        .clickableNoRipple { nextStep() }
                        .padding(vertical = 10.dp),
                )
            }
        }
    }
}

/** 一道分步题全部填完之后的样子：把走过的每一步连起来，就是完整的解题过程 */
@Composable
private fun SolveDone(item: EqSolveItem, index: Int? = null) {
    Card(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .border(1.dp, if (item.solved) OkColor else Color(0xFFE2E8F0), RoundedCornerShape(12.dp)),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(11.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (index != null) {
                    Text(
                        index.toString(),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .size(17.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(Faint)
                            .padding(top = 1.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    eqToText(item.initial),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = InkColor,
                    maxLines = 1,
                )
            }
            Spacer(Modifier.height(7.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                item.steps.forEachIndexed { i, s ->
                    SolveChip(no = i + 1, label = s.label, after = eqToText(s.after))
                }
            }
            Text(
                if (item.solved) "🎉 解出来了：x = ${item.answer}" else "🧩 这一步填完了",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = if (item.solved) OkColor else Slate,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text(
                item.finalNote,
                fontSize = 11.5.sp,
                color = Faint,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/** 解题轨迹上的一小条：「1 跨线变号 → x = 13 + 5」 */
@Composable
private fun SolveChip(no: Int, label: String, after: String) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color(0xFFF1F5F9))
            .padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("$no", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Faint)
        Spacer(Modifier.width(4.dp))
        Text("$label → $after", fontSize = 10.sp, color = Slate, maxLines = 1)
    }
}

/**
 * 「两边对调」那一拍的视觉：左边从**右边**滑来、右边从**左边**滑来（擦身而过）。
 * ★ 刻意不做 FLIP 测量 —— 对调时两侧的项会换边，「按文本找旧位」本就不成立。
 */
private fun eqFlipLayer(on: Boolean, which: EqSide, t: Float): Modifier =
    if (!on) {
        Modifier
    } else {
        Modifier.graphicsLayer {
            val k = 1f - t
            translationX = (if (which == EqSide.LEFT) 1f else -1f) * k * 16f
            alpha = 0.25f + 0.75f * t
        }
    }
