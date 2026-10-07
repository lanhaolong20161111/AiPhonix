package com.example.ai.ui.relations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.math.RlKind
import com.example.ai.data.math.RlKindGroup
import com.example.ai.data.math.RlProblem
import com.example.ai.data.math.RL_KIND_GROUPS
import com.example.ai.data.math.rlGenerateProblem
import com.example.ai.data.math.rlGenerateProblems
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * 「数量关系与交换」的五个阶段 —— 离散时间轴。
 *
 * ① 摆量 → ② 看关系 → ③ 换位置 → ④ 落位 → ⑤ 再查一遍
 *
 * ★ 交换的**位移只发生在 ③**，④ 那一帧量与槽位同时归位（位置重合 ⇒ 看不出接缝）。
 *   这样一来学生看到的就只是「颜色换了」，而颜色换 = 角色换 = 结论变。
 */
enum class RlPhase { IDLE, RELATE, FLYING, LANDED, CHECK }

/** ⚠️ 顺序即索引，页面与 VM 都必须读这一份 */
val RL_PHASE_ORDER: List<RlPhase> = listOf(
    RlPhase.IDLE, RlPhase.RELATE, RlPhase.FLYING, RlPhase.LANDED, RlPhase.CHECK,
)

/** 每一阶段**停留多久**再自动进下一阶段（ms） */
val RL_PHASE_MS: Map<RlPhase, Long> = mapOf(
    RlPhase.IDLE to 700L,
    RlPhase.RELATE to 1500L,
    RlPhase.FLYING to 950L,
    RlPhase.LANDED to 1000L,
    RlPhase.CHECK to 0L,
)

/** ★ 交换动画本体的时长（要 < RL_PHASE_MS[FLYING]，否则动画会被下一阶段截断） */
const val RL_FLY_MS = 620

val RL_PHASE_LABEL: Map<RlPhase, String> = mapOf(
    RlPhase.IDLE to "① 摆量",
    RlPhase.RELATE to "② 看关系",
    RlPhase.FLYING to "③ 换位置",
    RlPhase.LANDED to "④ 落位",
    RlPhase.CHECK to "⑤ 再查一遍",
)

val RL_PHASE_SAY: Map<RlPhase, String> = mapOf(
    RlPhase.IDLE to "先看清两边各是几",
    RlPhase.RELATE to "看清这句话在说什么",
    RlPhase.FLYING to "换个位置 —— 看好了",
    RlPhase.LANDED to "颜色跟着槽位走，不跟着数走",
    RlPhase.CHECK to "同一个数，说法变了没有",
)

data class RlUiState(
    val kind: RlKind = RlKind.COMPARE,
    val problem: RlProblem = defaultProblem(),
    val phase: RlPhase = RlPhase.IDLE,
    val playing: Boolean = false,
    /** 每次换题/重播递增 —— Screen 用它做 key，把上一轮的动画状态清干净 */
    val runToken: Int = 0,

    // ── 一步一填练习 ──
    val drill: List<RlProblem> = rlGenerateProblems(3, RlKind.COMPARE),
    /** 换一组时 +1，Screen 用它做 key 让每张练习卡重新挂载 */
    val drillRound: Int = 0,
    val drillAnswered: Int = 0,
    val drillCorrect: Int = 0,
    val drillFinished: Int = 0,
) {
    val group: RlKindGroup get() = RL_KIND_GROUPS.firstOrNull { it.key == kind } ?: RL_KIND_GROUPS[0]

    /** ④ 落位与 ⑤ 再查一遍看到的都是**交换后**的关系句 */
    val showAfter: Boolean get() = phase == RlPhase.LANDED || phase == RlPhase.CHECK

    val finished: Boolean get() = phase == RlPhase.CHECK

    val phaseLabel: String get() = RL_PHASE_LABEL.getValue(phase)

    val phaseSay: String get() = RL_PHASE_SAY.getValue(phase)

    val playButtonText: String get() = if (finished) "↻ 再演一遍" else "▶ 播一遍"

    val drillDone: Boolean get() = drill.isNotEmpty() && drillFinished >= drill.size

    val drillScore: String
        get() = "答对 $drillCorrect / $drillAnswered" + if (drillDone) " · 本组完成 🎉" else ""
}

private fun defaultProblem(): RlProblem =
    rlGenerateProblem(RlKind.COMPARE) ?: rlGenerateProblem(null)!!

class RelationsViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(RlUiState())
    val uiState: StateFlow<RlUiState> = _uiState.asStateFlow()

    /** 正在跑的时间轴（换题/重播前先取消，避免两条时间轴交错改状态） */
    private var timelineJob: Job? = null

    // ── 换题 ──

    /** 换一题并切到 [key] 题型。传 null 表示沿用当前题型 */
    fun newProblem(key: RlKind?) {
        timelineJob?.cancel()
        val k = key ?: _uiState.value.kind
        val p = rlGenerateProblem(k) ?: return
        _uiState.update {
            it.copy(
                kind = k,
                problem = p,
                phase = RlPhase.IDLE,
                playing = false,
                runToken = it.runToken + 1,
            )
        }
    }

    /** 回到本题的起始态（不清题） */
    fun reset() {
        timelineJob?.cancel()
        _uiState.update { it.copy(phase = RlPhase.IDLE, playing = false, runToken = it.runToken + 1) }
    }

    /**
     * 下一步：只往前推一阶段。
     * ★ 推进前先 `playing = false` —— 否则正在自动播的时候点「下一步」，
     *   自动播放的协程会接着把后面的阶段也推完，和用户的点按抢时间轴。
     */
    fun step() {
        timelineJob?.cancel()
        _uiState.update {
            val i = RL_PHASE_ORDER.indexOf(it.phase)
            val next = if (i < 0 || i >= RL_PHASE_ORDER.size - 1) it.phase else RL_PHASE_ORDER[i + 1]
            it.copy(playing = false, phase = next)
        }
    }

    /**
     * 播一遍。
     * @param reduced 系统「关闭动画」时为 true —— 直接跳到完成态（对齐 web 的 prefers-reduced-motion）
     */
    fun play(reduced: Boolean = false) {
        timelineJob?.cancel()
        if (reduced) {
            _uiState.update {
                it.copy(phase = RlPhase.CHECK, playing = false, runToken = it.runToken + 1)
            }
            return
        }
        timelineJob = viewModelScope.launch {
            _uiState.update { it.copy(phase = RlPhase.IDLE, playing = true, runToken = it.runToken + 1) }
            var i = 0
            while (i < RL_PHASE_ORDER.size - 1) {
                delay(RL_PHASE_MS.getValue(RL_PHASE_ORDER[i]))
                i += 1
                val next = RL_PHASE_ORDER[i]
                _uiState.update { it.copy(phase = next) }
            }
            _uiState.update { it.copy(playing = false) }
        }
    }

    // ── 练习 ──

    /** 换一组：重新随机 3 道（同一组内按关系句去重） */
    fun reshuffleDrill(key: RlKind) = _uiState.update {
        it.copy(
            kind = key,
            drill = rlGenerateProblems(3, key),
            drillRound = it.drillRound + 1,
            drillAnswered = 0,
            drillCorrect = 0,
            drillFinished = 0,
        )
    }

    fun regenDrill() = reshuffleDrill(_uiState.value.kind)

    /** 练习的每一步：答错可以再试，成绩只认第一次点击 */
    fun gradeStep(ok: Boolean) = _uiState.update {
        it.copy(drillAnswered = it.drillAnswered + 1, drillCorrect = it.drillCorrect + if (ok) 1 else 0)
    }

    fun finishCard() = _uiState.update { it.copy(drillFinished = it.drillFinished + 1) }
}
