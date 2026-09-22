package com.example.ai.ui.mathcompound

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.math.CompoundProblem
import com.example.ai.data.math.ExprToken
import com.example.ai.data.math.KIND_LABEL
import com.example.ai.data.math.MISTAKE_CASES
import com.example.ai.data.math.MistakeCase
import com.example.ai.data.math.OpPrec
import com.example.ai.data.math.RULES
import com.example.ai.data.math.StepLine
import com.example.ai.data.math.TokenType
import com.example.ai.data.math.bareText
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/**
 * 三年级上 · 综合算式动画 —— 「把两个分步算式合并成一个综合算式」
 *
 * 教学法：找 → 换 → 查
 *   ① 找：两个算式里相同的那个数同时高亮，一条虚线真正连到两个数上
 *   ② 换：★ 转移动画 —— ① 的算式变成一块「幽灵」，从得数位置起飞、沿弧线飞到 ② 里
 *          那个数字的位置，原地把它顶掉（原位替换）。① 的得数随即变淡（已被取走）
 *   ③ 查：先暴露「不加括号会先算谁」（红）→ ★ 括号从算式两侧飞入、夹紧被抱的那一块
 *          → 按正确顺序逐项确认（绿）
 *
 * 动画与 web 的对应（时间常量全部取自 [MathCompoundExprViewModel] 的 companion，两边同源）：
 *   · 幽灵飞行 = 单一进度 0→1 + 分段插值（等价于 web 的 WAAPI 多 keyframe）
 *   · 括号飞入 = 克隆体思路的 Compose 版：真括号一直占位（alpha 0），替身飞到位后
 *     真身立刻显形（**绝不能有透明度过渡**，否则会出现「括号闪一下」的空档），位置逐像素重合
 *
 * ⚠️ 坐标测量都走 [CeGeom]：所有元素报 `boundsInRoot()`，取值时**只减基准容器**，
 *    绝不要把「stage 内的数」与「resultBox 内的数」混着减（两者不在同一容器里）。
 *
 * 配色（全站统一）：乘除蓝 · 加减橙 · 正确绿 · 错误红 · 括号紫 · 替换进来的部分灰蓝底
 */
private val Black = Color.Black
private val Grey = Color(0xFF6B7280)
private val Slate = Color(0xFF374151)
private val MdColor = Color(0xFF2563EB)
private val AsColor = Color(0xFFEA580C)
private val Amber = Color(0xFFFDE68A)
private val OkColor = Color(0xFF16A34A)
private val WarnColor = Color(0xFFDC2626)
private val ParenColor = Color(0xFF7C3AED)
private val FromFirstBg = Color(0xFFE2E8F0)
private val HugBg = Color(0xFFDDD6FE)
private val HugBorder = Color(0xFFA78BFA)
private val TakenColor = Color(0x4D000000)

private val N_FONT = 22.sp

/** 算式块里每个 token 的间距（幽灵 / 落位块 / 合并行共用，保证交接无感） */
private val TokenGap = 7.dp

/***************************************
 * 页面
 ***************************************/

@Composable
fun MathCompoundExprScreen(
    onBack: () -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: MathCompoundExprViewModel = viewModel(),
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
            TopBar(title = "🧮 三年级上 · 综合算式动画", onBack = onBack)
            Text(
                "把两个分步算式，合并成一个综合算式",
                fontSize = 13.sp,
                color = Grey,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp),
            )
        }

        item(key = "chips") {
            ChipRow(
                state = state,
                onToggleRules = viewModel::toggleRules,
                onTogglePrec = viewModel::togglePrec,
                onToggleMistakes = viewModel::toggleMistakes,
            )
        }

        // 「查」这一步假定孩子已经懂了优先级 —— 这里补一个小动画把假定演出来
        if (state.showPrec) {
            item(key = "prec") { OpPrecedenceDemo() }
        }

        if (state.showRules) {
            item(key = "rules") { RulesCard() }
        }

        // 易错卡放在题目区之前（与 web 顺序一致）；LazyColumn 让卡片「滚到才揭晓」
        if (state.showMistakes) {
            items(MISTAKE_CASES, key = { "${it.title}|${it.wrong}" }) { m -> MistakeCard(m) }
        }

        val problem = state.problem
        if (problem == null) {
            item(key = "empty") { StatusText("生成题目失败，点「换一题」再试一次。") }
        } else {
            item(key = "kind") { KindRow(problem = problem, needParen = state.needParen) }
            item(key = "stage") { CeStage(state = state, problem = problem, reduced = reduced) }
            item(key = "hint") { HintLine(state = state) }
            item(key = "result") { CeResultBox(state = state, problem = problem, reduced = reduced) }
            item(key = "actions") {
                ActionsRow(
                    label = state.playButtonText,
                    enabled = state.canPlay,
                    onPlay = { viewModel.play(reduced) },
                    onNew = viewModel::newProblem,
                )
            }
            item(key = "tip") {
                Text(
                    "提示：${problem.hint}",
                    fontSize = 13.sp,
                    color = Grey,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                )
            }
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
            Text("←", fontSize = 20.sp, color = Black)
        }
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Black)
    }
}

@Composable
private fun ChipRow(
    state: MathCompoundUiState,
    onToggleRules: () -> Unit,
    onTogglePrec: () -> Unit,
    onToggleMistakes: () -> Unit,
) {
    // ⚠️ web 的 .ce-rules-bar 原本没有 flex-wrap，加到第 3 个 chip 后 320 宽会顶出横向滚动
    //    （实测 scrollWidth 400 > clientWidth 320）。Android 侧直接排成两行，避免窄屏溢出。
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(
                text = if (state.showRules) "收起口诀" else "📌 找→换→查 口诀",
                modifier = Modifier.weight(1f),
                onClick = onToggleRules,
            )
            Chip(
                text = if (state.showPrec) "收起优先级" else "🔢 先算谁？优先级",
                modifier = Modifier.weight(1f),
                onClick = onTogglePrec,
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
        color = Black,
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
            RULES.forEach { block ->
                Text(block.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Black)
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

@Composable
private fun KindRow(problem: CompoundProblem, needParen: Boolean) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            KIND_LABEL[problem.kind].orEmpty(),
            fontSize = 12.sp,
            color = Black,
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(FromFirstBg)
                .padding(horizontal = 10.dp, vertical = 4.dp),
        )
        Text(
            if (needParen) "这题要加小括号" else "这题不用加括号",
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = if (needParen) WarnColor else OkColor,
        )
    }
}

@Composable
private fun HintLine(state: MathCompoundUiState) {
    val warn = state.showCheck && state.checkSub == 0 && state.needParen
    Text(
        state.hintText,
        fontSize = 14.sp,
        color = if (warn) WarnColor else Black,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (warn) Color(0xFFFEF2F2) else Color(0xFFF8FAFC))
            .padding(12.dp),
    )
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
                .background(if (enabled) Color(0xFF2563EB) else Color(0xFFE2E8F0))
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

/**
 * 可点击但 disabled 时不吃点击、且不撑满整行。
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

/***************************************
 * ① ② 分步算式区 + 连线 + 幽灵
 ***************************************/

/**
 * 相对某个基准容器的坐标簿。每处都报**绝对**（boundsInRoot）坐标，
 * 取值时只减基准容器 ⇒ 不会把不同容器的坐标混起来。
 */
private class CeGeom {
    private val map = mutableStateMapOf<String, Rect>()

    fun report(key: String, abs: Rect) {
        if (map[key] != abs) map[key] = abs
    }

    /** 取相对 [anchor] 左上角的矩形（anchor 宽度为 0 时视为还没量到） */
    fun relTo(anchor: String, key: String): Rect? {
        val b = map[anchor]?.takeIf { it.width > 0f } ?: return null
        val r = map[key] ?: return null
        if (r.width <= 0f) return null
        return r.translate(-b.left, -b.top)
    }
}

@Composable
private fun CeStage(
    state: MathCompoundUiState,
    problem: CompoundProblem,
    reduced: Boolean,
) {
    val geom = remember { CeGeom() }
    val fly = remember { Animatable(0f) }
    var playedToken by rememberSaveable { mutableIntStateOf(-1) }

    // 幽灵飞行：单一进度 0→1，之后由 ghostPose 分段插值成 WAAPI 那样的多段轨迹
    LaunchedEffect(state.runToken, state.phase, state.subSub) {
        if (reduced) return@LaunchedEffect
        if (state.phase == CePhase.SUBSTITUTE && state.subSub == 0 && playedToken != state.runToken) {
            playedToken = state.runToken
            fly.snapTo(0f)
            fly.animateTo(
                targetValue = 1f,
                animationSpec = tween(
                    durationMillis = MathCompoundExprViewModel.T_FLY.toInt(),
                    easing = CubicBezierEasing(0.45f, 0.05f, 0.35f, 1f),
                ),
            )
        }
    }

    val step0 = problem.steps[0]
    val step1 = problem.steps[1]
    val litRef = state.showFind || (state.showSub && !state.landed)

    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFFF8FAFC))
            .border(1.dp, Color(0xFFE2E8F0), RoundedCornerShape(14.dp))
            .padding(14.dp)
            .onGloballyPositioned { geom.report("stage", it.boundsInRoot()) },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            StepCard(
                index = 1,
                a = step0.a.text,
                op = step0.op,
                b = step0.b.text,
                result = step0.result,
                refPos = 0,
                litResult = litRef,
                litRef = false,
                taken = state.landed,
                hideTail = false,
                injectedTokens = null,
                onResultPos = { geom.report("res", it) },
                onTargetPos = null,
            )
            StepCard(
                index = 2,
                a = step1.a.text,
                op = step1.op,
                b = step1.b.text,
                result = step1.result,
                refPos = state.refPos,
                litResult = false,
                litRef = litRef,
                taken = false,
                hideTail = state.landed,
                injectedTokens = if (state.landed && state.refPos != 0) stepTokens(step0) else null,
                onResultPos = null,
                onTargetPos = { geom.report("tgt", it) },
            )
        }

        // 连线：得数 → 第二个算式里被引用的那个数（真正连到两个数上）
        if (state.showFind || (state.showSub && !state.landed)) {
            val a = geom.relTo("stage", "res")
            val b = geom.relTo("stage", "tgt")
            if (a != null && b != null) {
                Canvas(Modifier.matchParentSize()) {
                    val p1 = a.center
                    val p2 = b.center
                    drawLine(
                        color = Color(0xFF94A3B8),
                        start = p1,
                        end = p2,
                        strokeWidth = 2f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(7f, 7f)),
                    )
                    drawCircle(Color(0xFF94A3B8), radius = 4.5f, center = p1)
                    drawCircle(Color(0xFF94A3B8), radius = 4.5f, center = p2)
                }
            }
        }

        // ② 换：飞行中的算式幽灵（相对 stage 坐标，不参与布局）
        val res = geom.relTo("stage", "res")
        val tgt = geom.relTo("stage", "tgt")
        if (!reduced && state.showSub && !state.landed && res != null && tgt != null) {
            val pose = ghostPose(fly.value, tgt.left - res.left, tgt.top - res.top)
            Box(
                Modifier
                    .offset { IntOffset((res.left + pose.dx).roundToInt(), (res.top + pose.dy).roundToInt()) }
                    .graphicsLayer {
                        scaleX = pose.scale
                        scaleY = pose.scale
                        alpha = pose.alpha
                    },
            ) {
                ExprBlock(stepTokens(step0))
            }
        }
    }
}

/** 幽灵的分段轨迹（平移 / 缩放 / 透明度），等价于 web 的 4 段 WAAPI keyframes */
private class GhostPose(val dx: Float, val dy: Float, val scale: Float, val alpha: Float)

private fun ghostPose(t: Float, dx: Float, dy: Float): GhostPose {
    val s1 = 0.18f
    val s2 = 0.62f
    return when {
        // 蓄力：缩一下再起跳（easeOutBack 同款手感）
        t < s1 -> {
            val k = (t / s1).coerceIn(0f, 1f)
            val u = easeOutBack(k)
            GhostPose(-7f * u, -13f * u, 0.82f + 0.18f * u, k)
        }
        t < s2 -> {
            val u = ((t - s1) / (s2 - s1)).coerceIn(0f, 1f)
            GhostPose(lerp(-7f, dx * 0.44f, u), lerp(-13f, dy * 0.44f - 22f, u), lerp(1f, 1.14f, u), 1f)
        }
        else -> {
            val u = ((t - s2) / (1f - s2)).coerceIn(0f, 1f)
            GhostPose(lerp(dx * 0.44f, dx, u), lerp(dy * 0.44f - 22f, dy, u), lerp(1.14f, 1f, u), 1f)
        }
    }
}

private fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t

private fun easeOutBack(x: Float): Float {
    val c1 = 1.70158f
    val c3 = c1 + 1f
    val p = x - 1f
    return 1f + c3 * p * p * p + c1 * p * p
}

/**
 * 一步算式 → token 序列（幽灵块 / 落位块共用 ⇒ 交接无感）。
 * 刻意不带 fromFirst 标记：这里是**原地展示**，不需要再区分来源。
 */
private fun stepTokens(s: StepLine): List<ExprToken> = listOf(
    ExprToken(s.a.text, TokenType.NUM),
    ExprToken(s.op, TokenType.OP, prec = if (s.op == "×" || s.op == "÷") OpPrec.MD else OpPrec.AS),
    ExprToken(s.b.text, TokenType.NUM),
)

@Composable
private fun StepCard(
    index: Int,
    a: String,
    op: String,
    b: String,
    result: Int,
    refPos: Int,
    litResult: Boolean,
    litRef: Boolean,
    taken: Boolean,
    hideTail: Boolean,
    injectedTokens: List<ExprToken>?,
    onResultPos: ((Rect) -> Unit)?,
    onTargetPos: ((Rect) -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            if (index == 1) "①" else "②",
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF64748B),
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Operand(
                isFirstCard = index == 1,
                text = a,
                injected = injectedTokens != null && refPos == 1,
                injectedTokens = injectedTokens,
                lit = litRef && refPos == 1,
                taken = taken,
                isTarget = refPos == 1,
                onPos = onTargetPos,
            )
            OpText(op)
            Operand(
                isFirstCard = index == 1,
                text = b,
                injected = injectedTokens != null && refPos == 2,
                injectedTokens = injectedTokens,
                lit = litRef && refPos == 2,
                taken = taken,
                isTarget = refPos == 2,
                onPos = onTargetPos,
            )
            if (!hideTail) {
                Text("=", fontSize = N_FONT, fontWeight = FontWeight.Bold, color = Color(0xFF94A3B8))
                Text(
                    result.toString(),
                    fontSize = N_FONT,
                    fontWeight = FontWeight.Bold,
                    color = if (taken) TakenColor else Black,
                    modifier = Modifier
                        .then(if (litResult) Modifier.background(Amber, RoundedCornerShape(6.dp)) else Modifier)
                        .then(if (onResultPos != null) Modifier.posReporter(onResultPos) else Modifier)
                        .padding(horizontal = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun Operand(
    isFirstCard: Boolean,
    text: String,
    injected: Boolean,
    injectedTokens: List<ExprToken>?,
    lit: Boolean,
    taken: Boolean,
    isTarget: Boolean,
    onPos: ((Rect) -> Unit)?,
) {
    val posMod = if (isTarget && onPos != null) Modifier.posReporter(onPos) else Modifier
    if (injected && injectedTokens != null) {
        // ② 卡：目标位置已被「换进来的算式」原位顶掉（与幽灵块样式完全一致 ⇒ 交接无感）
        Box(posMod) { ExprBlock(injectedTokens) }
        return
    }
    Text(
        text = text,
        fontSize = N_FONT,
        fontWeight = FontWeight.Bold,
        color = if (taken && isFirstCard) TakenColor else Black,
        modifier = posMod
            .then(if (lit) Modifier.background(Amber, RoundedCornerShape(6.dp)) else Modifier)
            .padding(horizontal = 2.dp),
    )
}

@Composable
private fun OpText(op: String) {
    Text(
        op,
        fontSize = N_FONT,
        fontWeight = FontWeight.Bold,
        color = if (op == "×" || op == "÷") MdColor else AsColor,
    )
}

/** 位置上报（boundsInRoot 的绝对值，由 CeGeom 负责换算） */
private fun Modifier.posReporter(onPos: (Rect) -> Unit): Modifier =
    this.then(Modifier.onGloballyPositioned { onPos(it.boundsInRoot()) })

/***************************************
 * ③ 综合算式（逐 token 渲染 / 括号飞入 / 逐项高亮）
 ***************************************/

@Composable
private fun CeResultBox(
    state: MathCompoundUiState,
    problem: CompoundProblem,
    reduced: Boolean,
) {
    // 「查」与「完成」阶段才出现（与 web 一致：合并结果先藏着，等讲完顺序再亮）
    if (!state.showCheck && !state.done) return

    val geom = remember { CeGeom() }
    val parenT = remember { Animatable(0f) }
    var ghostAlive by remember { mutableStateOf(false) }
    var ghostSize by remember { mutableStateOf(Size.Zero) }

    val needParen = state.needParen

    // 括号飞入：时长与 VM 的落位时刻同源（T_PAREN_FLY）；不落位时再跑一段「弹回」
    LaunchedEffect(state.checkSub, state.runToken) {
        if (reduced) return@LaunchedEffect
        if (state.showCheck && state.checkSub == 1) {
            ghostAlive = true
            parenT.snapTo(0f)
            val dur = if (needParen) {
                MathCompoundExprViewModel.T_PAREN_FLY
            } else {
                MathCompoundExprViewModel.T_PAREN_FLY + MathCompoundExprViewModel.T_PAREN_BOUNCE
            }
            parenT.animateTo(
                targetValue = 1f,
                animationSpec = tween(dur.toInt(), easing = CubicBezierEasing(0.34f, 0.06f, 0.28f, 1f)),
            )
            ghostAlive = false
        }
    }

    // needParen：真身落位的那一刻替身就退场（位置重合 ⇒ 看不出接缝）
    val showGhost = ghostAlive && !(needParen && state.parensLanded)
    val hugShift by animateDpAsState(if (state.hug) 7.dp else 0.dp, label = "hug-shift")

    Card(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .onGloballyPositioned { geom.report("box", it.boundsInRoot()) },
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F5F9)),
    ) {
        Box(Modifier.fillMaxWidth().padding(14.dp)) {
            Column {
                Text("综合算式", fontSize = 12.sp, color = Color(0xFF64748B))
                Spacer(Modifier.height(6.dp))
                MergedRow(
                    tokens = problem.merged.tokens,
                    litIndex = state.litIndex,
                    litKind = state.litKind,
                    parensIn = state.parensIn,
                    hug = state.hug,
                    hugShift = hugShift,
                    onReport = { key, rect -> geom.report(key, rect) },
                )
                if (state.done) {
                    Row(
                        Modifier.padding(top = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("= ", fontSize = N_FONT, color = Black)
                        Text(
                            problem.answer.toString(),
                            fontSize = N_FONT,
                            fontWeight = FontWeight.Bold,
                            color = Black,
                        )
                        Text("✓ 与分步算式的得数一致", fontSize = 13.sp, color = OkColor)
                    }
                }
                if (state.done && needParen) {
                    Text(
                        "🧷 括号里先算：${bareText(problem.steps[0])} = ${problem.steps[0].result}",
                        fontSize = 13.sp,
                        color = Black,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }

            // 括号飞行替身层（needParen 落位后立刻退场；!needParen 等弹回播完）
            if (!reduced && showGhost) {
                ParenGhosts(
                    needParen = needParen,
                    t = parenT.value,
                    geom = geom,
                    ghostSize = ghostSize,
                    onMeasure = { ghostSize = it },
                )
            }
        }
    }
}

@Composable
private fun ParenGhosts(
    needParen: Boolean,
    t: Float,
    geom: CeGeom,
    ghostSize: Size,
    onMeasure: (Size) -> Unit,
) {
    listOf(-1, 1).forEach { dir ->
        val key = if (dir < 0) "par-open" else "par-close"
        val target = parenGhostTarget(
            needParen = needParen,
            real = geom.relTo("box", key),
            wrap = geom.relTo("box", "wrap"),
            ghostSize = ghostSize,
            dir = dir,
        ) ?: return@forEach
        val pose = parenPose(t, dir, needParen)
        Text(
            text = if (dir < 0) "(" else ")",
            fontSize = N_FONT,
            fontWeight = FontWeight.ExtraBold,
            color = ParenColor,
            modifier = Modifier
                .offset { IntOffset((target.first + pose.dx).roundToInt(), (target.second + pose.dy).roundToInt()) }
                .graphicsLayer {
                    scaleX = pose.scale
                    scaleY = pose.scale
                    rotationZ = pose.rot
                    alpha = pose.alpha
                }
                .onGloballyPositioned { onMeasure(it.size.toSizeOf()) },
        )
    }
}

/**
 * 括号替身的落点（相对 resultBox 左上角）：
 *  · 要加括号 → 真括号自己的位置（像素级一致 ⇒ 落位瞬间交接无感）
 *  · 不用加括号 → 贴住被替换那块的左右两侧（贴边那一侧准确即可）
 */
private fun parenGhostTarget(
    needParen: Boolean,
    real: Rect?,
    wrap: Rect?,
    ghostSize: Size,
    dir: Int,
): Pair<Float, Float>? {
    if (needParen) {
        val r = real ?: return null
        return r.left to r.top
    }
    val w = wrap ?: return null
    val gw = if (ghostSize.width > 0f) ghostSize.width else 12f
    val gh = if (ghostSize.height > 0f) ghostSize.height else 24f
    val left = if (dir < 0) w.left - gw - 2f else w.right + 2f
    val top = w.top + (w.height - gh) / 2f
    return left to top
}

private class ParenPose(val dx: Float, val dy: Float, val scale: Float, val rot: Float, val alpha: Float)

/**
 * 括号替身轨迹：
 *  · 要加括号：从算式两侧**外侧**飞入（起始 scale 2.05 / 旋转 18°）→ 落位 → 停住等真身显形
 *  · 不用加括号：飞进来想夹 → 停一下 → 夹不住，被**弹回去**消散
 *
 * ⚠️ 所有分段的边界必须严格递增（web 那边踩过 WAAPI 的
 *    "Offsets must be monotonically non-decreasing"，会直接把整页带走）。
 */
private fun parenPose(t: Float, dir: Int, needParen: Boolean): ParenPose {
    val out = dir * 96f
    fun enter(u: Float, landAt: Float): ParenPose = when {
        u < 0.2f -> {
            val k = (u / 0.2f).coerceIn(0f, 1f)
            ParenPose(out, -14f, 2.05f, dir * 18f, k)
        }
        u < 0.48f -> {
            val k = ((u - 0.2f) / 0.28f).coerceIn(0f, 1f)
            ParenPose(
                lerp(out, out * 0.6f, k),
                lerp(-14f, -10f, k),
                lerp(2.05f, 1.72f, k),
                lerp(dir * 18f, dir * 11f, k),
                1f,
            )
        }
        else -> {
            val k = ((u - 0.48f) / (landAt - 0.48f).coerceAtLeast(0.01f)).coerceIn(0f, 1f)
            ParenPose(
                lerp(out * 0.6f, 0f, k),
                lerp(-10f, -4f, k),
                lerp(1.72f, 1.3f, k),
                lerp(dir * 11f, dir * 4f, k),
                1f,
            )
        }
    }

    if (needParen) {
        return when {
            t < 0.86f -> enter(t, 0.86f)
            else -> {
                val k = ((t - 0.86f) / 0.14f).coerceIn(0f, 1f)
                ParenPose(0f, lerp(-4f, -2f, k), lerp(1.3f, 1.08f, k), lerp(dir * 4f, 0f, k), 1f)
            }
        }
    }

    return when {
        t < 0.48f -> enter(t, 0.48f)
        // 到位 —— 想夹住
        t < 0.56f -> {
            val k = ((t - 0.48f) / 0.08f).coerceIn(0f, 1f)
            ParenPose(lerp(out * 0.6f, 0f, k), lerp(-10f, 0f, k), lerp(1.72f, 1.02f, k), lerp(dir * 11f, 0f, k), 1f)
        }
        // 停一下：夹不住
        t < 0.68f -> ParenPose(0f, 0f, 1f, 0f, 1f)
        // 被推开
        t < 0.82f -> {
            val k = ((t - 0.68f) / 0.14f).coerceIn(0f, 1f)
            ParenPose(dir * 30f * k, -7f * k, lerp(1f, 1.18f, k), dir * 11f * k, lerp(1f, 0.9f, k))
        }
        // 被弹回去、消散
        else -> {
            val k = ((t - 0.82f) / 0.18f).coerceIn(0f, 1f)
            ParenPose(
                lerp(dir * 30f, dir * 120f, k),
                lerp(-7f, 26f, k),
                lerp(1.18f, 1.62f, k),
                lerp(dir * 11f, dir * 28f, k),
                lerp(0.9f, 0f, k),
            )
        }
    }
}

/**
 * 综合算式行：逐 token 渲染；「换进来的那一整块」用一个内层 Row 包住（便于亮紫边读成一整块）；
 * 括号 token 始终**占位**（alpha 0），落位后直接显形 —— 位置逐像素重合，交接无接缝。
 */
@Composable
private fun MergedRow(
    tokens: List<ExprToken>,
    litIndex: Int,
    litKind: CeLitKind?,
    parensIn: Boolean,
    hug: Boolean,
    hugShift: Dp,
    onReport: (String, Rect) -> Unit,
) {
    val firstFrom = tokens.indexOfFirst { it.fromFirst }
    val lastFrom = tokens.indexOfLast { it.fromFirst }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TokenGap),
    ) {
        if (firstFrom < 0) {
            for (i in tokens.indices) {
                MergedToken(tokens[i], i, litIndex, litKind, parensIn, hug, hugShift, onReport)
            }
        } else {
            for (i in 0 until firstFrom) {
                MergedToken(tokens[i], i, litIndex, litKind, parensIn, hug, hugShift, onReport)
            }
            // 「换进来的那一整块」
            Row(
                modifier = Modifier
                    .onGloballyPositioned { onReport("wrap", it.boundsInRoot()) }
                    .drawBehind {
                        if (hug) {
                            val inflate = 7f
                            val topLeft = Offset(-inflate, -inflate / 2f)
                            val sz = Size(size.width + inflate * 2, size.height + inflate)
                            val cr = CornerRadius(10f, 10f)
                            drawRoundRect(color = HugBg, topLeft = topLeft, size = sz, cornerRadius = cr)
                            drawRoundRect(
                                color = HugBorder,
                                topLeft = topLeft,
                                size = sz,
                                cornerRadius = cr,
                                style = Stroke(width = 3f),
                            )
                        }
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(TokenGap),
            ) {
                for (i in firstFrom..lastFrom) {
                    MergedToken(tokens[i], i, litIndex, litKind, parensIn, hug, hugShift, onReport)
                }
            }
            for (i in lastFrom + 1 until tokens.size) {
                MergedToken(tokens[i], i, litIndex, litKind, parensIn, hug, hugShift, onReport)
            }
        }
    }
}

@Composable
private fun MergedToken(
    t: ExprToken,
    index: Int,
    litIndex: Int,
    litKind: CeLitKind?,
    parensIn: Boolean,
    hug: Boolean,
    hugShift: Dp,
    onReport: (String, Rect) -> Unit,
) {
    val isParen = t.type == TokenType.PAREN
    // 括号「夹紧」：'(' 向右压、')' 向左压
    val shift = if (isParen && hug) hugShift * (if (t.text == "(") 1 else -1) else 0.dp
    val mod = Modifier
        .then(
            if (isParen) {
                Modifier
                    .offset(x = shift)
                    .onGloballyPositioned {
                        onReport(if (t.text == "(") "par-open" else "par-close", it.boundsInRoot())
                    }
            } else {
                Modifier
            },
        )
    CeToken(t = t, lit = index == litIndex, litKind = litKind, parensIn = parensIn, modifier = mod)
}

@Composable
private fun CeToken(
    t: ExprToken,
    lit: Boolean,
    litKind: CeLitKind?,
    parensIn: Boolean,
    modifier: Modifier = Modifier,
) {
    val base = when (t.type) {
        TokenType.NUM -> Black
        TokenType.OP -> if (t.prec == OpPrec.MD) MdColor else AsColor
        TokenType.PAREN -> ParenColor
    }
    // ⚠️ 括号的「显形」绝不能有透明度过渡：真身若淡入，落位那一刻会出现「括号闪一下」的空档
    val alpha = if (t.type == TokenType.PAREN) (if (parensIn) 1f else 0f) else 1f
    val bg = when {
        lit && litKind == CeLitKind.WARN -> Color(0xFFFECACA)
        lit && litKind == CeLitKind.OK -> Color(0xFFBBF7D0)
        t.fromFirst -> FromFirstBg
        else -> Color.Transparent
    }
    val fg = when {
        lit && litKind == CeLitKind.WARN -> WarnColor
        lit && litKind == CeLitKind.OK -> OkColor
        else -> base
    }
    Text(
        text = t.text,
        fontSize = N_FONT,
        fontWeight = if (t.type == TokenType.PAREN) FontWeight.ExtraBold else FontWeight.Bold,
        color = fg.copy(alpha = alpha),
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg.copy(alpha = bg.alpha * alpha))
            .padding(horizontal = 4.dp, vertical = 1.dp),
    )
}

/** 算式块（幽灵 / 落位块共用同一套样式 ⇒ 交接无感） */
@Composable
private fun ExprBlock(tokens: List<ExprToken>) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(FromFirstBg)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TokenGap),
    ) {
        tokens.forEach { t ->
            Text(
                text = t.text,
                fontSize = N_FONT,
                fontWeight = FontWeight.Bold,
                color = when {
                    t.type == TokenType.PAREN -> ParenColor
                    t.type == TokenType.OP && t.prec == OpPrec.MD -> MdColor
                    t.type == TokenType.OP -> AsColor
                    else -> Black
                },
            )
        }
    }
}

/***************************************
 * 易错示例卡（错误红闪抖动 vs 正确绿闪落定）
 ***************************************/

@Composable
private fun MistakeCard(m: MistakeCase) {
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
            Text("⚠️ ${m.title}", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Black)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Tag("❌ 错", Color(0xFFFEE2E2), WarnColor)
                Text(
                    m.wrong,
                    fontSize = 14.sp,
                    color = WarnColor,
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

/** IntSize → Size（onGloballyPositioned 给的是整数尺寸） */
private fun androidx.compose.ui.unit.IntSize.toSizeOf(): Size =
    Size(width.toFloat(), height.toFloat())
