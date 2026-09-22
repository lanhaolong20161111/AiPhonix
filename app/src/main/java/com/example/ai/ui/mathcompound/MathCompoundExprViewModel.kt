package com.example.ai.ui.mathcompound

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.math.CompoundProblem
import com.example.ai.data.math.KIND_LABEL
import com.example.ai.data.math.OpPrec
import com.example.ai.data.math.TokenType
import com.example.ai.data.math.bareText
import com.example.ai.data.math.generateProblem
import com.example.ai.data.math.tokensToText
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * 「三年级上 · 综合算式动画」状态机 —— 把「找 → 换 → 查」三步摊成一条**确定性时间轴**。
 *
 * 与 web/src/pages/MathCompoundExprPage.tsx 的时间轴逐项对齐：
 *   · phase：IDLE → FIND → SUBSTITUTE → CHECK → DONE
 *   · subSub：「换」0 = 算式幽灵飞行中，1 = 已落位（在原位顶掉数字）
 *   · checkSub：「查」三小步 0 = 暴露「不加括号会先算谁」/ 1 = 括号飞入 / 2 = 逐项绿确认
 *   · parensLanded / hug：括号落位与「夹紧」（被抱住那块亮紫边）
 *
 * 为什么状态机在 ViewModel：Screen 只负责「按当前状态渲染 + 播与状态对应的动画」，
 * 时间属于业务（AGENTS.md：计算逻辑上移；Compose 侧保持无状态）。
 *
 * 时间轴常量与 Screen 里的动画时长**必须同源** —— 都从这里取，避免两边各写一份漂掉。
 */
enum class CePhase { IDLE, FIND, SUBSTITUTE, CHECK, DONE }

/** 「查」阶段高亮的语义：WARN = 不加括号会被先算的就是它（顺序错）· OK = 就该先算它 */
enum class CeLitKind { WARN, OK }

data class MathCompoundUiState(
    val problem: CompoundProblem? = null,
    val phase: CePhase = CePhase.IDLE,
    /** 「换」：0 = 飞行中，1 = 已落位 */
    val subSub: Int = 0,
    /** 「查」三小步：0 / 1 / 2 */
    val checkSub: Int = 0,
    /** 「查」②：括号是否已落位（真身显形） */
    val parensLanded: Boolean = false,
    /** 「查」②：括号已夹紧 —— 被抱住的那一段亮紫边 */
    val hug: Boolean = false,
    /** 「查」③：已确认到第几个运算符 */
    val checkStep: Int = 0,
    val showRules: Boolean = false,
    val showPrec: Boolean = false,
    val showMistakes: Boolean = false,
    /** 每次 play 递增 —— Screen 用它判断「本轮是否已播过飞行动画」（滚出屏幕再回来不重播） */
    val runToken: Int = 0,
    // ── 只依赖 problem 的预算值（避免在 composable 里重算，也避免每次重组产生新 List） ──
    /** ② 算式里被替换的操作数位置（1 = a 位，2 = b 位，0 = 都不是） */
    val refPos: Int = 0,
    /** 「查」③ 的正确确认顺序（token 下标） */
    val checkOrder: List<Int> = emptyList(),
    /** 「查」① **不加括号**时第一个会被算到的运算符下标 */
    val wrongFirstIdx: Int = -1,
    /** 综合算式里有几个运算符 */
    val opCount: Int = 0,
) {
    val kindLabel: String get() = problem?.let { KIND_LABEL[it.kind] }.orEmpty()
    val needParen: Boolean get() = problem?.how?.check?.needParen ?: false
    val landed: Boolean get() = subSub == 1
    val showFind: Boolean get() = phase == CePhase.FIND
    val showSub: Boolean get() = phase == CePhase.SUBSTITUTE
    val showCheck: Boolean get() = phase == CePhase.CHECK
    val done: Boolean get() = phase == CePhase.DONE
    val playing: Boolean get() = phase != CePhase.IDLE && phase != CePhase.DONE
    val canPlay: Boolean get() = problem != null && !playing

    /** 括号真身何时显形：「查」② 飞行**落位**之后（飞行期间由替身代替，真身保持隐身） */
    val parensIn: Boolean get() = done || (showCheck && parensLanded)

    /** 「查」③ 逐项确认到第几个 —— 高亮的 token 下标（-1 = 不高亮） */
    val litIndex: Int
        get() = when {
            showCheck && checkSub == 2 && checkStep > 0 -> checkOrder.getOrElse(checkStep - 1) { -1 }
            showCheck && checkSub == 0 -> wrongFirstIdx
            else -> -1
        }

    val litKind: CeLitKind?
        get() = if (!showCheck) {
            null
        } else if (needParen) {
            when {
                checkSub == 0 -> CeLitKind.WARN
                checkSub >= 1 -> CeLitKind.OK
                else -> null
            }
        } else {
            // 本题顺序本来就不变，一路绿色确认
            CeLitKind.OK
        }

    val step0Text: String get() = problem?.steps?.firstOrNull()?.let { bareText(it) }.orEmpty()
    val warnOpText: String get() = problem?.merged?.tokens?.getOrNull(wrongFirstIdx)?.text.orEmpty()

    /** 阶段提示（文案逐字对齐 web） */
    val hintText: String
        get() {
            val p = problem ?: return ""
            val r = p.steps[0].result
            val s0 = step0Text
            return when (phase) {
                CePhase.FIND -> "两个式子里都有 $r —— 它就是第一步算出来的得数。"
                CePhase.SUBSTITUTE -> if (landed) {
                    "看，② 里原来的 $r 已经被「$s0」顶掉了 —— 算式站到了数字原来的位置上。" +
                        "因为 $r 本来就是 $s0 算出来的，换进去得数不变；至于顺序会不会变，下一步再查。"
                } else {
                    "把 ① 的得数 $r 换成整段「$s0」—— 它正从 ① 的得数那儿飞过去，占住 ② 里 $r 的位置。"
                }
                CePhase.CHECK -> when (checkSub) {
                    0 -> if (needParen) {
                        "先别急着加括号 —— 按规矩「从左往右、先乘除后加减」，第一个轮到的会是这个「$warnOpText」。" +
                            "可原题要先算 ①「$s0」呀，顺序被换掉了！"
                    } else {
                        "按规矩「从左往右、先乘除后加减」，第一个轮到的正是这个「$warnOpText」—— 原题也是先算它，顺序没变。"
                    }
                    1 -> if (needParen) {
                        "看 —— 两个小括号正从算式两边飞进来，把 ①「$s0」整个抱住。"
                    } else {
                        "把括号加进去试试 —— 可这里顺序本来就没变，括号抱不住谁，被弹回去了。直接写下来就好。"
                    }
                    else -> if (needParen) {
                        "括号一加，第一个被算的换成了 ①「$s0」—— 顺序对上了，答案才一致。"
                    } else {
                        "顺序没变，答案也已经一致了。"
                    }
                }
                CePhase.DONE -> "合并成功：${tokensToText(p.merged.tokens)} = ${p.answer}"
                CePhase.IDLE -> "点「播放动画」，看两个算式怎样合成一个。"
            }
        }

    /** 播放按钮文案 */
    val playButtonText: String
        get() = when (phase) {
            CePhase.IDLE -> "▶ 播放动画"
            CePhase.DONE -> "↻ 再看一遍"
            else -> "播放中…"
        }
}

class MathCompoundExprViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(MathCompoundUiState())
    val uiState: StateFlow<MathCompoundUiState> = _uiState.asStateFlow()

    /** 当前正在跑的时间轴（换题/重播前先取消，避免两条时间轴交错改状态） */
    private var timelineJob: Job? = null

    init {
        newProblem()
    }

    // ── 用户动作 ──

    fun newProblem() {
        timelineJob?.cancel()
        val p = generateProblem()
        _uiState.update {
            it.copy(
                problem = p,
                phase = CePhase.IDLE,
                subSub = 0,
                checkSub = 0,
                parensLanded = false,
                hug = false,
                checkStep = 0,
                checkOrder = checkOrderOf(p),
                wrongFirstIdx = wrongFirstIdxOf(p),
                refPos = refPosOf(p),
                opCount = opCountOf(p),
            )
        }
    }

    fun toggleRules() = _uiState.update { it.copy(showRules = !it.showRules) }

    fun togglePrec() = _uiState.update { it.copy(showPrec = !it.showPrec) }

    fun toggleMistakes() = _uiState.update { it.copy(showMistakes = !it.showMistakes) }

    /**
     * 播放整条时间轴。
     * @param reduced 系统「关闭动画」时为 true —— 直接跳到完成态（对齐 web 的 prefers-reduced-motion）
     */
    fun play(reduced: Boolean = false) {
        val state = _uiState.value
        val problem = state.problem ?: return
        timelineJob?.cancel()

        val needParen = problem.how.check.needParen
        val order = state.checkOrder
        val n = maxOf(1, state.opCount)

        val events = mutableListOf<Pair<Long, () -> Unit>>()
        fun at(t: Long, action: () -> Unit) {
            events.add(t to action)
        }

        // 每次播放都先复位（进入「找」之前算式是干净的）
        at(0) {
            _uiState.update {
                it.copy(
                    subSub = 0,
                    checkSub = 0,
                    parensLanded = false,
                    hug = false,
                    checkStep = 0,
                    runToken = it.runToken + 1,
                )
            }
        }

        if (reduced) {
            at(0) {
                _uiState.update {
                    it.copy(
                        subSub = 1,
                        checkSub = 2,
                        parensLanded = true,
                        checkStep = order.size,
                        phase = CePhase.DONE,
                    )
                }
            }
            timelineJob = viewModelScope.launch { runTimeline(events) }
            return
        }

        at(0) { _uiState.update { it.copy(phase = CePhase.FIND) } }
        // ② 换：飞行结束后落位 —— 算式在 ② 原位顶掉数字
        at(T_FIND) { _uiState.update { it.copy(phase = CePhase.SUBSTITUTE) } }
        at(T_FIND + T_FLY) { _uiState.update { it.copy(subSub = 1) } }
        at(T_SUB) { _uiState.update { it.copy(phase = CePhase.CHECK) } }
        // 「查」① 先暴露「不加括号会先算谁」
        at(T_SUB + T_WARN) { _uiState.update { it.copy(checkSub = 1) } }
        val parenAt = T_SUB + T_WARN + T_PAREN_FLY
        val recheckAt = T_SUB + T_WARN + T_PAREN_FLY + T_PAREN_HOLD
        if (needParen) {
            // 落位：替身退场，真实括号就地显形，随即向内夹紧
            at(parenAt) { _uiState.update { it.copy(parensLanded = true, hug = true) } }
        }
        // 「查」③ 逐项确认（夹紧高亮同步结束，交给逐项高亮接管）
        at(recheckAt) { _uiState.update { it.copy(checkSub = 2, hug = false) } }
        for (i in order.indices) {
            at(recheckAt + 400 + T_OP * i) { _uiState.update { it.copy(checkStep = i + 1) } }
        }
        at(recheckAt + 400 + T_OP * (n - 1) + 1300) { _uiState.update { it.copy(phase = CePhase.DONE) } }

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

    // ── 派生计算（只在换题时算一次，塞进 state） ──

    private fun refPosOf(p: CompoundProblem?): Int {
        if (p == null || p.steps.size < 2) return 0
        if (p.steps[1].a.fromStep == 1) return 1
        if (p.steps[1].b.fromStep == 1) return 2
        return 0
    }

    /**
     * 「查」③：按**正确顺序**高亮 token（括号内先算，再乘除、再加减，各自从左往右）。
     * 顺序与 web 完全一致，别"顺手简化"。
     */
    private fun checkOrderOf(p: CompoundProblem?): List<Int> {
        val merged = p?.merged ?: return emptyList()
        val tokens = merged.tokens
        val md = mutableListOf<Int>()
        val asOps = mutableListOf<Int>()
        tokens.forEachIndexed { i, t ->
            if (t.type != TokenType.OP) return@forEachIndexed
            if (t.prec == OpPrec.MD) md.add(i) else asOps.add(i)
        }
        val span = merged.parens.firstOrNull() ?: return md + asOps
        fun inner(i: Int) = i > span.start && i < span.end
        return md.filter(::inner) + asOps.filter(::inner) + md.filter { !inner(it) } + asOps.filter { !inner(it) }
    }

    /**
     * 「查」①：**不加括号**时按「从左往右、先乘除后加减」第一个会被算到的运算符。
     * 与 checkOrder 的第一项对比，就能一眼看出「顺序到底变没变」。
     */
    private fun wrongFirstIdxOf(p: CompoundProblem?): Int {
        val tokens = p?.merged?.tokens ?: return -1
        val md = tokens.indexOfFirst { it.type == TokenType.OP && it.prec == OpPrec.MD }
        if (md >= 0) return md
        return tokens.indexOfFirst { it.type == TokenType.OP }
    }

    private fun opCountOf(p: CompoundProblem?): Int =
        p?.merged?.tokens?.count { it.type == TokenType.OP } ?: 0

    companion object {
        /** ① 找 */
        const val T_FIND = 2200L

        /** ② 换：算式幽灵起飞 → 落位（含蓄力） */
        const val T_FLY = 1150L

        /** ② 换：落位后停留，看清「谁顶掉了谁」 */
        const val T_LAND = 1250L

        /** ② 换 → ③ 查 */
        const val T_SUB = T_FIND + T_FLY + T_LAND

        /** 查①：暴露「不加括号会先算谁」 */
        const val T_WARN = 1700L

        /** 查②：括号从算式外侧飞入 → 落位 */
        const val T_PAREN_FLY = 950L

        /** 查②：不需要括号时，括号被「弹回去」消散 */
        const val T_PAREN_BOUNCE = 850L

        /** 查②：括号夹紧后停留，看清它抱住了哪一块 */
        const val T_PAREN_HOLD = 900L

        /** 查③：每个运算符高亮的间隔 */
        const val T_OP = 700L
    }
}
