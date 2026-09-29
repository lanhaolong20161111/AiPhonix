package com.example.ai.ui.eqmove

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.math.EqActionType
import com.example.ai.data.math.EqSolveItem
import com.example.ai.data.math.EqSide
import com.example.ai.data.math.EqState
import com.example.ai.data.math.MoveAction
import com.example.ai.data.math.MoveKind
import com.example.ai.data.math.MoveProblem
import com.example.ai.data.math.eqFlipOp
import com.example.ai.data.math.eqSideToText
import com.example.ai.data.math.eqSolutionText
import com.example.ai.data.math.eqGenerateSolveItems
import com.example.ai.data.math.generateEqProblem
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * 「等式变变变」状态机 —— 把「找 → 飞/滑 → 落 → 算」摊成一条**确定性时间轴**。
 *
 * 与 web/src/pages/EquationMovePage.tsx 逐项对齐：
 *   · phase：IDLE → FIND → FLY → LAND → SOLVE → DONE（同侧换位 / 合并 / 对调走 FIND → SLIDE → LAND）
 *   · stepIndex：当前在第几步（两步题 a - x / a ÷ x 会有 0、1、2 三轮）
 *   · stepDone：这一步是否已落位
 *   · symFlipped：★ 幽灵**跨过等号线的那一瞬** —— 符号翻牌，同时等号线闪一下
 *   · swapped：同侧换位 / 合并是否已完成（非 MOVE 动作靠它把视图从 before 切到 after）
 *
 * ⚠️ [symFlipped] 与 [borderHit] 不由这里的时间轴直接定时 —— 幽灵在**哪个进度**跨过等号线
 *    取决于实测几何（源项中心 ↔ 等号线 ↔ 落位槽），只有 Screen 量得出来。
 *    所以由 Screen 在飞行动画跑到 cross 时回调 [onGhostCrossed]（与综合算式页「Screen 播动画、
 *    VM 管状态」的分工一致）。
 *
 * ★ 四种动作的时间轴（对齐 web）：
 *    MOVE    find → fly → land（跨线翻牌，走「幽灵飞越」）
 *    SWAP    find → slide → land（只在一侧内部擦身，**符号一点不动**）
 *    COMBINE find → slide → land（合并同类项，项数变少但这一侧求值不变）
 *    FLIP    find → slide → land（两边对调）
 *    ⚠️ 后三种**绝不能**走 FLY —— 否则会把「同侧换位」画成「整块飞过等号」，教学上正好教反。
 */
enum class EqPhase { IDLE, FIND, FLY, LAND, SLIDE, SOLVE, DONE }

data class EqMoveUiState(
    val kind: MoveKind = MoveKind.PLUS,
    val problem: MoveProblem? = null,
    val phase: EqPhase = EqPhase.IDLE,
    /** 当前是第几步动作（0-based） */
    val stepIndex: Int = 0,
    /** 当前这一步是否已经落位 */
    val stepDone: Boolean = false,
    /** 幽灵的符号是否已经翻牌（跨线那一下） */
    val symFlipped: Boolean = false,
    /** 递增计数：每次跨线 +1，Screen 用它强制重播等号线的闪光 */
    val borderHit: Int = 0,
    /** 同侧换位 / 合并：是否已完成换序（由 Screen 量完旧位置后回调 setSwapped） */
    val swapped: Boolean = false,
    val solved: Boolean = false,
    val showRules: Boolean = false,
    val showWhy: Boolean = false,
    val showMistakes: Boolean = false,
    /** 每次换题/重播递增 —— Screen 用它判断「本轮是否已播过」（滚出屏幕再回来不重播） */
    val runToken: Int = 0,
    // ── 分步解方程练习（6 道，可换一组）──
    val drill: List<EqSolveItem> = emptyList(),
    /** 换一组时 +1，Screen 用它做 key 让每道练习卡重新挂载（清掉上一组的作答状态） */
    val drillRound: Int = 0,
    val drillAnswered: Int = 0,
    val drillCorrect: Int = 0,
) {
    /** 分步练习的总步数 —— 计分单位是**步**（不是题），完成判定必须用它 */
    val drillStepCount: Int get() = drill.sumOf { it.steps.size }

    /** ★ 当前这一步的动作（move / swap / combine / flip 都在里面）。
     *  上一版这里把同侧交换题整个排除掉了 —— 于是 swap 根本进不了统一路径，只能靠 isSameSide 特判；
     *  现在四种动作都从这里取，Screen 再按 [EqActionType] 分流渲染。 */
    val curAction: MoveAction?
        get() = problem?.actions?.getOrNull(stepIndex)

    val playing: Boolean get() = phase != EqPhase.IDLE && phase != EqPhase.DONE
    val canPlay: Boolean get() = problem != null && !playing

    /** 舞台上此刻渲染的两侧（用 before + 涂装，不改 state ⇒ 布局不重排）。
     *  MOVE 一直用 before（落位靠涂装 + 隐形的落位槽）；
     *  SWAP / COMBINE / FLIP 在滑完那一刻切到 after —— 这就是「换好了 / 合完了」的那一帧。 */
    val view: EqState?
        get() {
            val p = problem ?: return null
            val act = p.actions.getOrNull(stepIndex) ?: return p.final
            if (act.type == EqActionType.MOVE) return act.before
            return if (swapped) act.after else act.before
        }

    /** 结果区何时出现 */
    val showResult: Boolean get() = phase == EqPhase.SOLVE || solved

    /** 播放按钮文案 */
    val playButtonText: String
        get() = when (phase) {
            EqPhase.IDLE -> "▶ 播放动画"
            EqPhase.DONE -> "↻ 再看一遍"
            else -> "播放中…"
        }

    /** 阶段提示（描述**当下这一拍**在干什么；文案逐字对齐 web） */
    val hintText: String
        get() {
            val p = problem ?: return ""
            if (p.isSameSide) {
                val a = p.initial.left[0].value
                val b = eqSideToText(p.initial.right)
                return when (phase) {
                    EqPhase.FIND -> "要挪走的是 $a —— 它现在待在 x 的前面。"
                    // ⚠️ 这里是纯文本渲染，别写 markdown 的 ** —— 星号会原样显示出来
                    EqPhase.SLIDE ->
                        "看：$a 从 x 的前面挪到了后面。它可没跨过那条竖线 —— 所以「+」还是「+」，一点没变。" +
                            "这就是「同一边随便换，符号不用调」。"
                    EqPhase.DONE -> "换好了：${eqSideToText(p.final.left)} = $b　符号一个都没动 ✓"
                    else -> "点「播放动画」，看把数挪到 x 后面时，符号会不会变。"
                }
            }
            val act = p.actions.getOrNull(stepIndex)
            if (act == null) {
                return if (phase == EqPhase.DONE) "解出来啦：${eqSolutionText(p)}" else "点「播放动画」。"
            }
            val sideName = if (act.from == EqSide.LEFT) "左边" else "右边"

            // ★ 非 move 动作的兜底文案：只有 **IDLE**（还没开始）才该说「去点播放」；
            //   SOLVE 阶段是「算 + 验算」，正在播放中却提示「点播放动画」会自相矛盾 —— 按 phase 分开写。
            val tailText = when (phase) {
                EqPhase.DONE -> "解出来啦：${eqSolutionText(p)}"
                EqPhase.IDLE -> "点「播放动画」。"
                else -> "这一拍完成了，看看等号两边多了什么、少了什么。"
            }

            // ★ swap / combine / flip 的提示语跟 move 完全不是一回事 —— 它们都不跨等号线，
            //   绝不能复用「飞过去、符号翻转」那套话术，否则等于在教反的。
            if (act.type == EqActionType.SWAP) {
                return when (phase) {
                    EqPhase.FIND ->
                        "第 ${stepIndex + 1} 步：${sideName}最前面那一项，前面什么都没写 —— " +
                            "它其实带着一个看不见的「${act.fromOp.sym}」。先把它和后面那项换个位置。"
                    EqPhase.SLIDE ->
                        "看：两项在${sideName}内部擦身而过，谁都没碰那条竖线 ⇒ " +
                            "符号「${act.fromOp.sym}」一点没动。现在它写在后面，符号露出来了！"
                    EqPhase.LAND ->
                        "换好了。接着再让它跨过等号 —— 到那时「${act.fromOp.sym}」才要变成「${eqFlipOp(act.fromOp).sym}」。"
                    else ->
                        if (phase == EqPhase.DONE) {
                            "解出来啦：${eqSolutionText(p)}"
                        } else {
                            "同一边换位置，符号不用调 —— 记住这一拍，再看它跨线时才变号。"
                        }
                }
            }

            if (act.type == EqActionType.COMBINE) {
                return when (phase) {
                    EqPhase.FIND ->
                        "第 ${stepIndex + 1} 步：这一侧有两个同类项，「${act.value}」要和紧挨着的那一项合起来。"
                    EqPhase.SLIDE ->
                        "看：同类项合起来，数量相加减，写法变短了。通通在等号同一侧完成 ⇒ 跟「变号」一点关系都没有。"
                    EqPhase.LAND -> "合完了。这一侧的值一分没变，只是从两小块写成了一小块。"
                    else -> tailText
                }
            }

            if (act.type == EqActionType.FLIP) {
                return when (phase) {
                    EqPhase.FIND -> "第 ${stepIndex + 1} 步：x 落在等号右边了 —— 先把等号两边整体对调一下。"
                    EqPhase.SLIDE -> "看：左右一换，等式照样成立 —— 等号两边本来就一样多，谁在左边谁在右边都行。"
                    EqPhase.LAND -> "对调完成，x 回到了左边。接着照常搬 —— 还是那条规矩：跨过等号才变号。"
                    else -> tailText
                }
            }

            val from = if (act.srcOp == null) act.value else "${act.srcOp.sym}${act.value}"
            return when (phase) {
                EqPhase.FIND ->
                    "第 ${stepIndex + 1} 步：要搬走的是「$from」这一整块。" +
                        if (act.srcOp == null) {
                            "它写在最前面、没带符号，其实等效于「${act.fromOp.sym}${act.value}」" +
                                "—— 跨过等号就要变成「${act.toOp.sym}」。"
                        } else {
                            "它跨过等号，符号必须变相反。"
                        }
                EqPhase.FLY -> if (symFlipped) {
                    "正好跨过等号线 ——「${act.fromOp.sym}」翻成了「${act.toOp.sym}」！这条竖线就是变号的分界。"
                } else {
                    "「$from」正整块飞向等号另一侧……"
                }
                EqPhase.LAND ->
                    if (act.from == EqSide.LEFT) {
                        "落位了：右边多出「${act.toOp.sym} ${act.value}」。左边刚才那个位置已经变灰 —— 它是从这儿搬走的。"
                    } else {
                        "落位了：左边多出「${act.toOp.sym} ${act.value}」。右边刚才那个位置已经变灰 —— 它是从这儿搬走的。"
                    }
                EqPhase.SOLVE -> if (p.flipSides) {
                    "现在 x 单独在等号右边了。等号两边可以互换位置 ⇒ x = ${eqSideToText(p.final.right)}。"
                } else {
                    "x 已经单独留在等号左边了 —— 右边就是答案。"
                }
                EqPhase.DONE -> "解出来啦：${eqSolutionText(p)}　（把答案代回原式，两边一样 ✓）"
                else -> "点「播放动画」，看这个数怎样从等号一边跑到另一边。"
            }
        }
}

class EqMoveViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(EqMoveUiState(drill = eqGenerateSolveItems(6)))
    val uiState: StateFlow<EqMoveUiState> = _uiState.asStateFlow()

    /** 当前正在跑的时间轴（换题/重播前先取消，避免两条时间轴交错改状态） */
    private var timelineJob: Job? = null

    init {
        newProblem(MoveKind.PLUS)
    }

    // ── 用户动作 ──

    /**
     * 换一道题并切到 [k] 这类题型。
     *
     * 🔴 与 web 同一处坑：**别让 [k] 缺省成「当前 kind 之外的随机值」** ——
     *    web 那边把 `kind` 放进 useCallback 依赖数组，导致 setKind 重建回调、
     *    初始化 effect 又跑一遍 `newProblem("plus")`，把刚点出来的题型覆盖掉。
     *    这里改成显式传参（`k == null` 才沿用当前 kind），没有那层耦合。
     */
    fun newProblem(k: MoveKind?) {
        timelineJob?.cancel()
        val kk = k ?: _uiState.value.kind
        _uiState.update {
            it.copy(
                kind = kk,
                problem = generateEqProblem(kk),
                phase = EqPhase.IDLE,
                stepIndex = 0,
                stepDone = false,
                symFlipped = false,
                swapped = false,
                solved = false,
                runToken = it.runToken + 1,
            )
        }
    }

    fun toggleRules() = _uiState.update { it.copy(showRules = !it.showRules) }

    fun toggleWhy() = _uiState.update { it.copy(showWhy = !it.showWhy) }

    fun toggleMistakes() = _uiState.update { it.copy(showMistakes = !it.showMistakes) }

    /** 同侧换位 / 合并：Screen 量完旧位置后把顺序（或合并结果）真正换掉 */
    fun setSwapped(v: Boolean) = _uiState.update { it.copy(swapped = v) }

    /**
     * ★ 幽灵跨过等号线的那一瞬（由 Screen 的飞行动画回调）：
     * 符号翻牌 + 等号线闪一下。只在 FLY 阶段生效，每个阶段最多记一次。
     */
    fun onGhostCrossed() {
        _uiState.update {
            if (it.phase != EqPhase.FLY || it.symFlipped) it
            else it.copy(symFlipped = true, borderHit = it.borderHit + 1)
        }
    }

    /**
     * 播放整条时间轴。
     * @param reduced 系统「关闭动画」时为 true —— 直接跳到完成态（对齐 web 的 prefers-reduced-motion）
     */
    fun play(reduced: Boolean = false) {
        val state = _uiState.value
        val problem = state.problem ?: return
        timelineJob?.cancel()

        val events = mutableListOf<Pair<Long, () -> Unit>>()
        fun at(t: Long, action: () -> Unit) {
            events.add(t to action)
        }

        // 每次播放都先复位（进入「找」之前舞台是干净的）
        at(0) {
            _uiState.update {
                it.copy(
                    stepIndex = 0,
                    stepDone = false,
                    symFlipped = false,
                    swapped = false,
                    solved = false,
                    runToken = it.runToken + 1,
                )
            }
        }

        if (reduced) {
            at(0) {
                _uiState.update {
                    it.copy(
                        stepIndex = problem.actions.size,
                        stepDone = true,
                        swapped = true,
                        solved = true,
                        phase = EqPhase.DONE,
                    )
                }
            }
            timelineJob = viewModelScope.launch { runTimeline(events) }
            return
        }

        // 同侧交换：只有「找」和「滑」两拍
        if (problem.isSameSide) {
            at(0) { _uiState.update { it.copy(phase = EqPhase.FIND) } }
            at(T_FIND) { _uiState.update { it.copy(phase = EqPhase.SLIDE) } }
            at(T_FIND + T_SLIDE) {
                _uiState.update { it.copy(phase = EqPhase.DONE, solved = true) }
            }
            timelineJob = viewModelScope.launch { runTimeline(events) }
            return
        }

        // 每一步：找（脉动高亮）→ ★ 按动作类型分流 → 落
        var t = 0L
        problem.actions.forEachIndexed { k, a ->
            at(t) {
                _uiState.update {
                    it.copy(stepIndex = k, stepDone = false, symFlipped = false, swapped = false, phase = EqPhase.FIND)
                }
            }
            t += T_FIND
            if (a.type == EqActionType.MOVE) {
                // 跨线搬运：飞（含翻牌）
                at(t) { _uiState.update { it.copy(phase = EqPhase.FLY) } }
                t += T_FLY
                at(t) {
                    // 落位：幽灵退场，目标侧槽位显形（同一刻，位置重合）
                    _uiState.update {
                        it.copy(stepDone = true, symFlipped = false, phase = EqPhase.LAND)
                    }
                }
                t += T_LAND
            } else {
                // ★ SWAP / COMBINE / FLIP：**不飞、不跨等号线**，只在同一侧滑动重排。
                //   phase 一到 SLIDE，Screen 的 FLIP effect 就接管位移（先量旧位再切 state）。
                at(t) { _uiState.update { it.copy(phase = EqPhase.SLIDE) } }
                t += T_SLIDE
                at(t) {
                    _uiState.update {
                        it.copy(stepDone = true, phase = EqPhase.LAND)
                    }
                }
                t += T_MERGE
            }
        }
        at(t) { _uiState.update { it.copy(phase = EqPhase.SOLVE) } }
        at(t + T_SOLVE) { _uiState.update { it.copy(phase = EqPhase.DONE, solved = true) } }

        timelineJob = viewModelScope.launch { runTimeline(events) }
    }

    /** 按绝对时刻依次执行（同一时刻的多个动作按登记顺序执行） */
    private suspend fun runTimeline(events: List<Pair<Long, () -> Unit>>) {
        var cursor = 0L
        for ((at, action) in events.sortedBy { it.first }) {
            val wait = at - cursor
            if (wait > 0) delay(wait)
            cursor = at
            action()
        }
    }

    // ── 随机练习 ──

    /** 换一组：重新随机 6 道分步题（四条基本变号规律仍保证各有一道，另有必出的多步题与同侧反例） */
    fun reshuffleDrill() = _uiState.update {
        it.copy(
            drill = eqGenerateSolveItems(6),
            drillRound = it.drillRound + 1,
            drillAnswered = 0,
            drillCorrect = 0,
        )
    }

    /** 分步练习的**每一步**首次点选时上报对错（答错可以再试，成绩只认第一次） */
    fun gradeDrill(ok: Boolean) = _uiState.update {
        it.copy(drillAnswered = it.drillAnswered + 1, drillCorrect = it.drillCorrect + if (ok) 1 else 0)
    }

    companion object {
        /** ① 找：脉动高亮「要搬走的是这一整块」 */
        const val T_FIND = 2000L

        /** ② 飞（含跨线翻牌） */
        const val T_FLY = 1250L

        /** ③ 落：停住，看清源位置变灰、对面显形 */
        const val T_LAND = 1500L

        /** ④ 算 + 验算 */
        const val T_SOLVE = 1500L

        /** 同侧换位：滑动 */
        const val T_SLIDE = 1400L

        /** 同侧合并 / 两边对调：看清「组成变了，值没变」（与 web 的 T_MERGE 同值） */
        const val T_MERGE = 1300L
    }
}
