package com.example.ai.ui.mulone

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.math.MO_BEAT_MS
import com.example.ai.data.math.MO_KIND_GROUPS
import com.example.ai.data.math.MoBeat
import com.example.ai.data.math.MoKind
import com.example.ai.data.math.MoKindGroup
import com.example.ai.data.math.MoPlan
import com.example.ai.data.math.MoProblem
import com.example.ai.data.math.MoView
import com.example.ai.data.math.moGenPlan
import com.example.ai.data.math.moGenProblemSet
import com.example.ai.data.math.moPlaceName
import com.example.ai.data.math.moProductFromPlan
import com.example.ai.data.math.moTailZeroHint
import com.example.ai.data.math.moViewOf
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * 「多位数乘一位数」状态机 —— 竖式**逐位四拍**的离散时间轴。
 *
 * 对齐 web/src/pages/MathMulOnePage.tsx：
 *   index = -1（还没开始）→ 0 .. plan.timeline.size（播完）
 *   每一拍的停留时长由**这一拍自己的类型**决定（见 [MO_BEAT_MS]）——
 *   所以「无进位」的位会明显比连着进位的位快，节奏本身就在说话。
 *
 * ★ 本页**不做任何加减**，也不自己判断该亮哪一格：全部来自 `data/math/MulOne.kt`
 *   的 `moPlanSteps` / `moViewOf`。Screen 只负责把 [MoView] 画出来。
 */
data class MulOneUiState(
    val kind: MoKind = MoKind.NO_CARRY,
    val plan: MoPlan = moGenPlan(MoKind.NO_CARRY),
    /** 当前播到时间轴第几拍（-1 = 还没开始） */
    val index: Int = -1,
    val playing: Boolean = false,
    /** 每次换题/重播递增 —— Screen 用它判断「本轮是否已播过」 */
    val runToken: Int = 0,

    // ── 折叠区 ──
    val showRules: Boolean = true,
    val showWhy: Boolean = false,
    val showMistakes: Boolean = false,

    // ── 一步一填练习 ──
    val drill: List<MoProblem> = moGenProblemSet(MoKind.NO_CARRY, 3),
    /** 换一组时 +1，Screen 用它做 key 让每张练习卡重新挂载 */
    val drillRound: Int = 0,
    val drillAnswered: Int = 0,
    val drillCorrect: Int = 0,
    val drillFinished: Int = 0,
) {
    val total: Int get() = plan.timeline.size

    /** 当前这一拍的全部可视状态（纯函数推导，Screen 不许自己拼） */
    val view: MoView get() = moViewOf(plan, index)

    val finished: Boolean get() = index >= total

    val group: MoKindGroup get() = MO_KIND_GROUPS.firstOrNull { it.key == kind } ?: MO_KIND_GROUPS[0]

    val progressText: String get() = "${(index + 1).coerceIn(0, total)} / $total"

    val playButtonText: String get() = if (finished) "↻ 再演一遍" else "▶ 播一遍"

    /** 这一拍的算式条 */
    val beatEquation: String get() = mulOneBeatEquation(plan, index)

    /** 巧算提示：只有被乘数末尾有 0 时才给 */
    val tail: com.example.ai.data.math.MoTailHint? get() = moTailZeroHint(plan.value, plan.factor)

    /** 写下来的各位拼回去 —— 与 plan.product 互为独立校验 */
    val productFromPlan: Int get() = moProductFromPlan(plan)

    val carryCount: Int get() = plan.steps.count { it.carryOut > 0 }

    val drillDone: Boolean get() = drill.isNotEmpty() && drillFinished >= drill.size
}

/** 每一拍的名字（对齐 web 的 BEAT_LABEL） */
fun mulOneBeatLabel(beat: MoBeat): String = when (beat) {
    MoBeat.IDLE -> "准备"
    MoBeat.MUL -> "① 乘"
    MoBeat.ADD -> "② 加进位"
    MoBeat.WRITE -> "③ 写"
    MoBeat.CARRY -> "④ 进"
    MoBeat.DONE -> "完成"
}

/**
 * 这一拍的「算式条」—— 高亮关键区域时，把此刻在算的那一步单独写出来。
 *
 * ⚠️ [index] 为 -1（还没开始）时 `moViewOf` 给的是 IDLE 视图，
 *    `view.place` 可能越出 steps 的范围 ⇒ 必须 getOrNull 兜底，
 *    否则一进页面就 IndexOutOfBounds（引擎单测扫过这些 index，但 Screen 不该依赖它）。
 */
fun mulOneBeatEquation(plan: MoPlan, index: Int): String {
    val view = moViewOf(plan, index)
    val s = plan.steps.getOrNull(view.place) ?: plan.steps.first()
    return when (view.beat) {
        MoBeat.MUL ->
            if (s.digit == 0) "0 × ${plan.factor} = 0" else "${s.digit} × ${plan.factor} = ${s.base}"
        MoBeat.ADD -> "${s.base} + ${s.carryIn} = ${s.sum}"
        MoBeat.WRITE ->
            if (s.carryOut > 0) "${s.sum} → 写 ${s.write}，留 ${s.carryOut}"
            else "${s.sum} → 直接写 ${s.write}"
        MoBeat.CARRY ->
            if (view.place == plan.steps.size - 1) "最前面写 ${s.carryOut} —— 积多一位"
            else "送 ${s.carryOut} 给${moPlaceName(view.place + 1)}"
        MoBeat.DONE -> "${plan.value} × ${plan.factor} = ${plan.product}"
        MoBeat.IDLE -> "从个位开始"
    }
}

class MulOneViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(MulOneUiState())
    val uiState: StateFlow<MulOneUiState> = _uiState.asStateFlow()

    /** 当前正在跑的时间轴（换题/重播前先取消，避免两条时间轴交错改状态） */
    private var timelineJob: Job? = null

    // ── 换题 ──

    /** 换一题并切到 [key] 这类题型。传 null 表示沿用当前题型 */
    fun newProblem(key: MoKind?) {
        timelineJob?.cancel()
        val k = key ?: _uiState.value.kind
        _uiState.update {
            it.copy(
                kind = k,
                plan = moGenPlan(k),
                index = -1,
                playing = false,
                runToken = it.runToken + 1,
            )
        }
    }

    /** 回到本题的起始态（不清题） */
    fun reset() {
        timelineJob?.cancel()
        _uiState.update { it.copy(index = -1, playing = false, runToken = it.runToken + 1) }
    }

    /**
     * 下一步：只往前推一拍。
     * ★ 推进前先 `playing = false` —— 否则正在自动播的时候点「下一步」，
     *   自动播放的协程会接着把后面的拍也推完，和用户的点按抢时间轴。
     */
    fun step() {
        timelineJob?.cancel()
        _uiState.update {
            it.copy(playing = false, index = (it.index + 1).coerceAtMost(it.total))
        }
    }

    /**
     * 播一遍。
     * @param reduced 系统「关闭动画」时为 true —— 直接跳到完成态（对齐 web 的 prefers-reduced-motion）
     */
    fun play(reduced: Boolean = false) {
        timelineJob?.cancel()
        val plan = _uiState.value.plan
        if (reduced) {
            _uiState.update {
                it.copy(index = plan.timeline.size, playing = false, runToken = it.runToken + 1)
            }
            return
        }
        timelineJob = viewModelScope.launch {
            _uiState.update { it.copy(index = -1, playing = true, runToken = it.runToken + 1) }
            var i = -1
            while (i < plan.timeline.size) {
                // 还没开始那一拍按「乘」的时长走（对齐 web 的 `index < 0 ? "mul" : ...`）
                val beat = if (i < 0) MoBeat.MUL else plan.timeline[i].beat
                delay(MO_BEAT_MS[beat] ?: 500L)
                i += 1
                _uiState.update { it.copy(index = i) }
            }
            _uiState.update { it.copy(playing = false) }
        }
    }

    // ── 折叠区 ──

    fun toggleRules() = _uiState.update { it.copy(showRules = !it.showRules) }
    fun toggleWhy() = _uiState.update { it.copy(showWhy = !it.showWhy) }
    fun toggleMistakes() = _uiState.update { it.copy(showMistakes = !it.showMistakes) }

    // ── 练习 ──

    /** 换一组：重新随机 3 道（同一组内不重复） */
    fun reshuffleDrill(key: MoKind) = _uiState.update {
        it.copy(
            kind = key,
            drill = moGenProblemSet(key, 3),
            drillRound = it.drillRound + 1,
            drillAnswered = 0,
            drillCorrect = 0,
            drillFinished = 0,
        )
    }

    fun regenDrill() = reshuffleDrill(_uiState.value.kind)

    /** 练习的**每一步**首次点选时上报对错（答错可以再试，成绩只认第一次） */
    fun gradeStep(ok: Boolean) = _uiState.update {
        it.copy(drillAnswered = it.drillAnswered + 1, drillCorrect = it.drillCorrect + if (ok) 1 else 0)
    }

    fun finishCard() = _uiState.update { it.copy(drillFinished = it.drillFinished + 1) }
}
