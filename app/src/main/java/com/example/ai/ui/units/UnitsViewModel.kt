package com.example.ai.ui.units

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.units.ChainFact
import com.example.ai.data.units.CutRound
import com.example.ai.data.units.PROBLEM_GROUPS
import com.example.ai.data.units.ProblemGroup
import com.example.ai.data.units.ProblemGroupKey
import com.example.ai.data.units.UnitDef
import com.example.ai.data.units.UnitDirection
import com.example.ai.data.units.UnitId
import com.example.ai.data.units.UnitKind
import com.example.ai.data.units.UnitPair
import com.example.ai.data.units.UnitPlan
import com.example.ai.data.units.UnitProblem
import com.example.ai.data.units.convert
import com.example.ai.data.units.factsOf
import com.example.ai.data.units.genProblemSet
import com.example.ai.data.units.pairsOf
import com.example.ai.data.units.planSteps
import com.example.ai.data.units.qty
import com.example.ai.data.units.unitNumStr
import com.example.ai.data.units.unitOf
import com.example.ai.data.units.unitsOf
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * 「长度与质量单位」状态机 —— 把 web 的「切开 / 拼合」动画摊成一条**确定性时间轴**。
 *
 * 与 web/src/pages/MathUnitsPage.tsx 的 CutStage 逐拍对齐：
 *   IDLE → (CUT → SPLIT) × rounds → DONE
 *
 * ★ web 用 **「已完成的轮数」** 派生份数与每份标签，这里照抄，绝不用「当前轮下标」。
 *   踩过的坑（web 注释里记着）：1 轮的题切完之后当前轮下标仍是 0，和「还没开始」撞成同一个值
 *   ⇒ 报数区会把「每份 1分米」显示成「每份 1米」，而「切成 10 段每段 1 米」在教学上正好教反。
 */
enum class CutPhase { IDLE, CUT, SPLIT, COUNT, DONE }

/**
 * 主舞台默认选的单位对：长度链的第 3 对（分米↔米，与 web 的 `pairsOf("length")[2]` 一致）。
 * ⚠️ 用 getOrElse 而不是 `[2]` —— 直方下标一旦链子变短就是 IndexOutOfBounds，
 *    而 web 那边 `pairsOf(kind)[2] ?? ADJACENT_PAIRS[0]` 在 JS 里只是 undefined、不炸。
 */
private val DEFAULT_LENGTH_PAIR: UnitPair =
    pairsOf(UnitKind.LENGTH).getOrElse(2) { pairsOf(UnitKind.LENGTH).first() }

data class UnitsUiState(
    // ── 主舞台 ──
    val kind: UnitKind = UnitKind.LENGTH,
    val pair: UnitPair = DEFAULT_LENGTH_PAIR,
    /** 演示方向：true = 大单位 → 小单位（切开 · 乘） */
    val toSmaller: Boolean = true,
    val plan: UnitPlan = planSteps(
        DEFAULT_LENGTH_PAIR.big,
        DEFAULT_LENGTH_PAIR.small,
        1.0,
    ),

    /** 当前这一拍的阶段 */
    val phase: CutPhase = CutPhase.IDLE,
    /** 已经切/拼完的轮数（0 = 还没开始）—— ★ 份数与每份标签都由它派生 */
    val doneRounds: Int = 0,
    /** 正在进行的轮（0 基，**只用于解说文案**） */
    val activeRound: Int = 0,
    /** 当前显示的份数；起始总是 plan.value */
    val count: Double = 1.0,
    /** 每次换题/重播递增 —— Screen 用它重置逐格动画 */
    val runToken: Int = 0,

    /** ★ 屏幕校准倍率（对齐 web 的 uc_calib，存 SharedPreferences） */
    val calib: Float = 1f,

    // ── 换算工作台 ──
    val benchKind: UnitKind = UnitKind.LENGTH,
    val benchFromId: UnitId = UnitId.M,
    val benchToId: UnitId = UnitId.DM,
    val benchRaw: String = "3",

    // ── 一步一填练习 ──
    val group: ProblemGroupKey = ProblemGroupKey.LENGTH_ADJACENT,
    val problems: List<UnitProblem> = genProblemSet(ProblemGroupKey.LENGTH_ADJACENT, 6),
    val drillAnswered: Int = 0,
    val drillCorrect: Int = 0,
    /** 换一组时 +1，Screen 用它做 key 让每道练习卡重新挂载（清掉上一组的作答状态） */
    val drillRound: Int = 0,

    // ── 折叠区 ──
    val showRules: Boolean = true,
    val showMistakes: Boolean = false,
    val showBench: Boolean = false,
) {
    // ── 主舞台派生 ──

    /** 每份是多少：还没切过 ⇒ 整块就是 1 个 from 单位；切过 k 轮 ⇒ 取第 k 轮的标签 */
    val pieceLabel: String
        get() = if (doneRounds == 0) "1${plan.from.name}"
        else plan.cuts.getOrNull(doneRounds - 1)?.pieceLabel ?: "1${plan.from.name}"

    val dirWord: String get() = if (plan.direction == UnitDirection.SPLIT) "切开" else "拼合"

    /** 动画播完了 ⇒ 答案揭晓 */
    val answered: Boolean get() = phase == CutPhase.DONE

    val playing: Boolean get() = phase == CutPhase.CUT || phase == CutPhase.SPLIT

    val playButtonText: String get() = if (phase == CutPhase.DONE) "▶ 再看一遍" else "▶ 播放动画"

    /** 当前这一轮的 CutRound（还没开始时没有） */
    val activeCut: CutRound? get() = plan.cuts.getOrNull(activeRound)

    /** 刚完成的那一轮 */
    val finishedCut: CutRound? get() = if (doneRounds > 0) plan.cuts.getOrNull(doneRounds - 1) else null

    /**
     * 这一拍在讲什么。
     * ⚠️ 「正在开始的那一轮」和「刚完成的那一轮」是两个不同的下标，别混用：
     *    CUT 阶段还没切完，要讲 activeRound；SPLIT 阶段已经切完，要讲 doneRounds - 1。
     * ⚠️ 所有数字一律过 [unitNumStr] —— Kotlin `Double.toString()` 会把 30.0 打成 "30.0"，
     *    web 的 JS 里 30/10 就是 "3"。这是跨端最典型的**静默错数**。
     */
    val sayText: String
        get() {
            val s = activeCut
            val f = finishedCut
            return when (phase) {
                CutPhase.IDLE ->
                    "现在有 ${qty(plan.value, plan.from)}。点「播放动画」，我们要把它一步步${dirWord}成${plan.to.name}。"
                CutPhase.CUT ->
                    if (plan.direction == UnitDirection.SPLIT) {
                        val each = unitNumStr((s?.count ?: plan.value) / 10)
                        "看 —— 第 ${activeRound + 1} 轮：把这 $each 份里的每一份，都切成 10 小份。"
                    } else {
                        "看 —— 第 ${activeRound + 1} 轮：每 10 份拼成 1 份。"
                    }
                CutPhase.SPLIT ->
                    if (plan.direction == UnitDirection.SPLIT) {
                        "份数变成了 ${unitNumStr(f?.count ?: plan.value)} 份，而每一份变小了 —— " +
                            "现在每一份是 ${f?.pieceLabel}。"
                    } else {
                        "份数减少到 ${unitNumStr(f?.count ?: plan.value)} 份，每一份变大了 —— " +
                            "现在每一份是 ${f?.pieceLabel}。"
                    }
                CutPhase.COUNT -> "数一数：${unitNumStr(f?.count ?: plan.value)} 份。"
                CutPhase.DONE ->
                    "$dirWord ${plan.rounds} 轮之后，每一份正好是 1${plan.to.name}，一共 " +
                        "${unitNumStr(plan.result)} 份。"
            }
        }

    /** 结论区的算式（对齐 web 的 uc-conclusion-why） */
    val conclusionWhy: String
        get() = if (plan.direction == UnitDirection.SPLIT) {
            "「${plan.from.name}」大、「${plan.to.name}」小 —— 把 1${plan.from.name} 连切 ${plan.rounds} 轮" +
                "（每轮切 10 份），就是 ${unitNumStr(plan.ratio)}${plan.to.name}，份数变多 ⇒ 用乘："
        } else {
            "「${plan.from.name}」小、「${plan.to.name}」大 —— ${unitNumStr(plan.ratio)} 个${plan.from.name}" +
                "拼起来才够 1${plan.to.name}，份数变少 ⇒ 用除："
        }

    // ── 工作台派生 ──

    val benchChain: List<UnitDef> get() = unitsOf(benchKind)
    val benchFrom: UnitDef get() = unitOf(benchFromId)
    val benchTo: UnitDef get() = unitOf(benchToId)
    val benchValue: Double? get() = benchRaw.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }
    val benchValid: Boolean get() = benchValue != null
    val benchSame: Boolean get() = benchFromId == benchToId

    /** 只有合法、且两个单位不同时才算 */
    val benchPlan: UnitPlan?
        get() {
            val v = benchValue ?: return null
            if (benchSame) return null
            return planSteps(benchFrom, benchTo, v)
        }

    val benchResultPretty: String
        get() {
            val v = benchValue ?: return ""
            return prettyNumber(convert(v, benchFrom, benchTo))
        }

    // ── 练习派生 ──

    val drillPct: Int
        get() = if (drillAnswered == 0) 0 else Math.round(drillCorrect * 100f / drillAnswered)

    val facts: List<ChainFact> get() = factsOf(kind)

    val groups: List<ProblemGroup> get() = PROBLEM_GROUPS
}

/**
 * 工作台结果的漂亮写法（对齐 web 的 `Number.isInteger(x) ? String(x) : x.toFixed(6).replace(/0+$/, "")`）。
 * 用 BigDecimal 而不是 `String.format("%.6f")`：后者受默认 Locale 影响，
 * 某些地区会用逗号做小数点，拼进算式里就变成 `3,5厘米`。
 */
internal fun prettyNumber(v: Double): String {
    if (!v.isFinite()) return unitNumStr(v)
    if (v == v.toLong().toDouble()) return v.toLong().toString()
    return BigDecimal.valueOf(v).setScale(6, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
}

class UnitsViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(UnitsUiState())
    val uiState: StateFlow<UnitsUiState> = _uiState.asStateFlow()

    /** 当前正在跑的时间轴（换题/重播前先取消，避免两条时间轴交错改状态） */
    private var timelineJob: Job? = null

    // ── 主舞台：选单位族 / 选单位对 / 换方向 ──

    fun pickKind(kind: UnitKind) {
        val list = pairsOf(kind)
        // 对齐 web：换族时把选题条切到该族的**最后一个**（= 米↔分米 / 千克↔吨 那种最有代表性的）
        val next = list.lastOrNull() ?: return
        applyPlan(kind, next, _uiState.value.toSmaller)
    }

    fun pickPair(pair: UnitPair) {
        applyPlan(pair.kind, pair, _uiState.value.toSmaller)
    }

    fun setDirection(toSmaller: Boolean) {
        val s = _uiState.value
        val same = s.toSmaller == toSmaller
        if (same) return
        applyPlan(s.kind, s.pair, toSmaller)
    }

    /**
     * 换 plan（换族 / 换单位对 / 换方向都走这里）。
     * ★ 必须同时把 count 拉回新 plan 的 value，并把 done/active 清零 ——
     *   否则切完 1000 份之后换到「米→分米」，舞台上会残留 1000 个格子。
     */
    private fun applyPlan(kind: UnitKind, pair: UnitPair, toSmaller: Boolean) {
        timelineJob?.cancel()
        val from = if (toSmaller) pair.big else pair.small
        val to = if (toSmaller) pair.small else pair.big
        val value = if (toSmaller) 1.0 else pair.ratio
        val plan = planSteps(from, to, value)
        _uiState.update {
            it.copy(
                kind = kind,
                pair = pair,
                toSmaller = toSmaller,
                plan = plan,
                phase = CutPhase.IDLE,
                doneRounds = 0,
                activeRound = 0,
                count = plan.value,
                runToken = it.runToken + 1,
            )
        }
    }

    fun reset() {
        timelineJob?.cancel()
        val plan = _uiState.value.plan
        _uiState.update {
            it.copy(
                phase = CutPhase.IDLE,
                doneRounds = 0,
                activeRound = 0,
                count = plan.value,
                runToken = it.runToken + 1,
            )
        }
    }

    /**
     * 播放整条时间轴：每轮「切开（CUT）→ 报数（SPLIT）」。
     * @param reduced 系统「关闭动画」时为 true —— 直接跳完成态（对齐 web 的 prefers-reduced-motion）
     */
    fun play(reduced: Boolean = false) {
        timelineJob?.cancel()
        val plan = _uiState.value.plan
        if (reduced) {
            _uiState.update {
                it.copy(
                    phase = CutPhase.DONE,
                    doneRounds = plan.rounds,
                    activeRound = (plan.rounds - 1).coerceAtLeast(0),
                    count = plan.result,
                    runToken = it.runToken + 1,
                )
            }
            return
        }
        timelineJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    phase = CutPhase.CUT,
                    doneRounds = 0,
                    activeRound = 0,
                    count = plan.value,
                    runToken = it.runToken + 1,
                )
            }
            plan.cuts.forEachIndexed { i, c ->
                _uiState.update { it.copy(phase = CutPhase.CUT, activeRound = i) }
                delay(T_CUT)
                // ★ 这两件事必须**同一刻**提交：份数、doneRounds、phase 一起换
                _uiState.update { it.copy(count = c.count, doneRounds = i + 1, phase = CutPhase.SPLIT) }
                delay(T_SPLIT)
            }
            _uiState.update { it.copy(phase = CutPhase.DONE) }
        }
    }

    // ── 折叠区 ──

    fun toggleRules() = _uiState.update { it.copy(showRules = !it.showRules) }
    fun toggleMistakes() = _uiState.update { it.copy(showMistakes = !it.showMistakes) }
    fun toggleBench() = _uiState.update { it.copy(showBench = !it.showBench) }

    /** ★ 校准倍率由 Screen 从 SharedPreferences 读出来、再推回来（VM 不持 Context） */
    fun setCalib(v: Float) = _uiState.update { it.copy(calib = v.coerceIn(MIN_CALIB, MAX_CALIB)) }

    // ── 换算工作台 ──

    fun setBenchKind(kind: UnitKind) {
        val chain = unitsOf(kind)
        // 换族时把两个单位重置回该族的头两个，避免出现「米 → 克」这种非法组合
        _uiState.update {
            it.copy(
                benchKind = kind,
                benchFromId = chain[0].id,
                benchToId = chain[1].id,
            )
        }
    }

    fun setBenchRaw(raw: String) = _uiState.update { it.copy(benchRaw = raw.filter { c -> c.isDigit() || c == '.' }) }

    fun setBenchFrom(id: UnitId) = _uiState.update { it.copy(benchFromId = id) }
    fun setBenchTo(id: UnitId) = _uiState.update { it.copy(benchToId = id) }

    // ── 随机练习 ──

    fun reshuffleDrill(group: ProblemGroupKey) = _uiState.update {
        it.copy(
            group = group,
            problems = genProblemSet(group, 6),
            drillAnswered = 0,
            drillCorrect = 0,
            drillRound = it.drillRound + 1,
        )
    }

    fun regenDrill() = reshuffleDrill(_uiState.value.group)

    /** 分步练习的**每一步**首次点选时上报对错（答错可以再试，成绩只认第一次） */
    fun gradeStep(ok: Boolean) = _uiState.update {
        it.copy(drillAnswered = it.drillAnswered + 1, drillCorrect = it.drillCorrect + if (ok) 1 else 0)
    }

    companion object {
        /** 一轮「切开」用掉的时间（与 web 的 T_CUT 同值） */
        const val T_CUT = 560L

        /** 一轮「报数」用掉的时间（与 web 的 T_SPLIT 同值） */
        const val T_SPLIT = 620L

        const val MIN_CALIB = 0.5f
        const val MAX_CALIB = 1.8f
    }
}
