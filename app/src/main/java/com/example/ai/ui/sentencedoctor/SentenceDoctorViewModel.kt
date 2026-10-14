package com.example.ai.ui.sentencedoctor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.sentencedoctor.SD_FIX_LEVELS
import com.example.ai.data.sentencedoctor.SD_PUNCT_LEVELS
import com.example.ai.data.sentencedoctor.SentenceDoctorStore
import com.example.ai.data.sentencedoctor.SdFixLevel
import com.example.ai.data.sentencedoctor.SdPunctLevel
import com.example.ai.data.sentencedoctor.SdTool
import com.example.ai.data.sentencedoctor.sdFixCaseSolved
import com.example.ai.data.sentencedoctor.sdPunctItemSolved
import com.example.ai.data.tts.BaiduTtsCache
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** 两册（标点的幻术 / 病句门诊） */
internal enum class SdMode { PUNCT, FIX }

/** 一句标点题的作答状态；`vals` 与 item.slots 等长，无标点的空位恒为 "" */
internal data class SdPunctItemState(
    val vals: List<String> = emptyList(),
    val hint: Boolean = false,
    val revealed: Boolean = false,
    /** 🔆 是否点亮提示语 */
    val tagOn: Boolean = false,
)

/** 一句病句题的作答状态；`tools` / `picks` 与 item.spots 等长 */
internal data class SdFixItemState(
    val tools: List<SdTool?> = emptyList(),
    /** 选项下标，-1 = 还没选 */
    val picks: List<Int> = emptyList(),
    val hint: Boolean = false,
    val revealed: Boolean = false,
)

/**
 * 一笔笔迹。坐标**按容器尺寸归一化（0~1）** 存 ——
 * 手机横竖屏切换、字号变化都不会让笔迹跑偏（对齐 web 的 `preserveAspectRatio="none"` + 归一化）。
 */
internal data class SdStroke(val points: List<Pair<Float, Float>>)

/**
 * 页面状态。
 *
 * 派生量（关卡进度、当前用到的那一关、有没有笔迹）一律放在这里算好，
 * 不在 composable 里现算 —— 对齐 `AGENTS.md` 的「计算逻辑上移」。
 */
internal data class SentenceDoctorUiState(
    val mode: SdMode = SdMode.PUNCT,
    val punctLevelIndex: Int = 0,
    val fixLevelIndex: Int = 0,
    val pItems: Map<String, SdPunctItemState> = emptyMap(),
    val fItems: Map<String, SdFixItemState> = emptyMap(),
    /** 当前打开「标点牌」的空位：(卡片 key, 空位下标) */
    val active: Pair<String, Int>? = null,
    val solved: Set<String> = emptySet(),
    /** 病句门诊顶部「五个修改符号」里点开的那一个（null = 没点开） */
    val signPick: SdTool? = null,
    /** ✏️ 画笔总开关（两册共用）；笔迹按卡片 key 分开存，换关回来还在 */
    val penOn: Boolean = false,
    val strokes: Map<String, List<SdStroke>> = emptyMap(),
    val speaking: Boolean = false,
) {
    val punctLevel: SdPunctLevel get() = SD_PUNCT_LEVELS[punctLevelIndex]
    val fixLevel: SdFixLevel get() = SD_FIX_LEVELS[fixLevelIndex]

    /** 关卡条的标签（两册结构不同，这里只取共有的两个字段） */
    val levels: List<Pair<String, String>> get() = if (mode == SdMode.PUNCT) {
        SD_PUNCT_LEVELS.map { it.key to it.name }
    } else {
        SD_FIX_LEVELS.map { it.key to it.name }
    }

    val levelIndex: Int get() = if (mode == SdMode.PUNCT) punctLevelIndex else fixLevelIndex
    val levelTotal: Int get() = if (mode == SdMode.PUNCT) punctLevel.items.size else fixLevel.items.size

    /** 「已掌握」记账后不再因为改动而撤销 */
    val levelDone: Int get() = (0 until levelTotal).count { solved.contains(cardKey(it)) }
    val allLevelDone: Boolean get() = levelTotal > 0 && levelDone == levelTotal

    fun cardKey(i: Int): String =
        if (mode == SdMode.PUNCT) "p:${punctLevel.key}:$i" else "f:${fixLevel.key}:$i"

    fun pState(key: String, n: Int): SdPunctItemState =
        pItems[key] ?: SdPunctItemState(vals = List(n) { "" })

    fun fState(key: String, n: Int): SdFixItemState =
        fItems[key] ?: SdFixItemState(tools = List(n) { null }, picks = List(n) { -1 })

    fun isSlotActive(key: String, slot: Int): Boolean = active?.first == key && active.second == slot

    fun strokesOf(key: String): List<SdStroke> = strokes[key].orEmpty()

    /** 这一关有没有笔迹 —— 决定「🧽 清空笔迹」要不要出现 */
    val levelHasStrokes: Boolean
        get() {
            val prefix = if (mode == SdMode.PUNCT) "p:${punctLevel.key}:" else "f:${fixLevel.key}:"
            return strokes.any { it.key.startsWith(prefix) && it.value.isNotEmpty() }
        }
}

/**
 * 句子小医生 ViewModel。不持 Context（`AGENTS.md`）：中文朗读走注入进来的 [ttsCache]，
 * 「已掌握」记录走注入进来的 [store]。
 */
internal class SentenceDoctorViewModel(
    private val store: SentenceDoctorStore,
    private val ttsCache: BaiduTtsCache? = null,
) : ViewModel() {

    private val _state = MutableStateFlow(SentenceDoctorUiState(solved = store.loadSolved()))
    val state: StateFlow<SentenceDoctorUiState> = _state.asStateFlow()

    private fun update(block: (SentenceDoctorUiState) -> SentenceDoctorUiState) {
        _state.update(block)
        syncSolved()
    }

    /**
     * 自动记账：每次状态变化扫一遍，全对即记「已掌握」。
     *
     * 与 web 的 `useEffect` 同口径：**只有存在作答状态的题才参与判定**（没碰过的题不会被记上），
     * 而且记上就不再撤销（除非「重来」）。
     */
    private fun syncSolved() {
        val s = _state.value
        val next = s.solved.toMutableSet()
        var changed = false
        for (lv in SD_PUNCT_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                val key = "p:${lv.key}:$i"
                val st = s.pItems[key] ?: return@forEachIndexed
                if (next.contains(key)) return@forEachIndexed
                if (sdPunctItemSolved(item, st.vals)) {
                    next.add(key)
                    changed = true
                }
            }
        }
        for (lv in SD_FIX_LEVELS) {
            lv.items.forEachIndexed { i, item ->
                val key = "f:${lv.key}:$i"
                val st = s.fItems[key] ?: return@forEachIndexed
                if (next.contains(key)) return@forEachIndexed
                if (sdFixCaseSolved(item, st.tools, st.picks)) {
                    next.add(key)
                    changed = true
                }
            }
        }
        if (!changed) return
        _state.update { it.copy(solved = next) }
        store.saveSolved(next)
    }

    // ── 切换 ──────────────────────────────────────────────

    fun selectMode(mode: SdMode) {
        update { it.copy(mode = mode, active = null) }
    }

    fun selectLevel(index: Int) {
        update {
            if (it.mode == SdMode.PUNCT) it.copy(punctLevelIndex = index, active = null)
            else it.copy(fixLevelIndex = index, active = null)
        }
    }

    fun toggleSignPick(tool: SdTool) {
        update { it.copy(signPick = if (it.signPick == tool) null else tool) }
    }

    fun togglePen() {
        update { it.copy(penOn = !it.penOn) }
    }

    // ── 标点册 ────────────────────────────────────────────

    fun toggleSlot(key: String, slot: Int) {
        update {
            it.copy(active = if (it.isSlotActive(key, slot)) null else key to slot)
        }
    }

    fun closePalette() {
        update { it.copy(active = null) }
    }

    /** 在打开的空位里追加一个标点（可叠两个，如「：」+ 前引号） */
    fun appendPunct(key: String, slotCount: Int, ch: String) {
        update { s ->
            val st = s.pState(key, slotCount)
            val slot = s.active?.takeIf { it.first == key }?.second ?: return@update s
            val vals = st.vals.mapIndexed { vi, v -> if (vi == slot) v + ch else v }
            s.copy(pItems = s.pItems + (key to st.copy(vals = vals)))
        }
    }

    /** 退一格 */
    fun backspacePunct(key: String, slotCount: Int) {
        update { s ->
            val st = s.pState(key, slotCount)
            val slot = s.active?.takeIf { it.first == key }?.second ?: return@update s
            val vals = st.vals.mapIndexed { vi, v -> if (vi == slot) v.dropLast(1) else v }
            s.copy(pItems = s.pItems + (key to st.copy(vals = vals)))
        }
    }

    /** 清空这一空 */
    fun clearSlotPunct(key: String, slotCount: Int) {
        update { s ->
            val st = s.pState(key, slotCount)
            val slot = s.active?.takeIf { it.first == key }?.second ?: return@update s
            val vals = st.vals.mapIndexed { vi, v -> if (vi == slot) "" else v }
            s.copy(pItems = s.pItems + (key to st.copy(vals = vals)))
        }
    }

    fun toggleHintPunct(key: String, slotCount: Int) {
        update { s ->
            val st = s.pState(key, slotCount)
            s.copy(pItems = s.pItems + (key to st.copy(hint = !st.hint)))
        }
    }

    fun revealPunct(key: String, slotCount: Int) {
        update { s ->
            val st = s.pState(key, slotCount)
            s.copy(pItems = s.pItems + (key to st.copy(revealed = true)))
        }
    }

    fun toggleTagOn(key: String, slotCount: Int) {
        update { s ->
            val st = s.pState(key, slotCount)
            s.copy(pItems = s.pItems + (key to st.copy(tagOn = !st.tagOn)))
        }
    }

    /** ↺ 重来（单张卡）：作答回到初始态 + 撤销「已掌握」+ 清掉这张卡的笔迹 */
    fun resetPunct(key: String, slotCount: Int) {
        store.saveSolved(_state.value.solved - key)
        _state.update { s ->
            s.copy(
                pItems = s.pItems + (key to SdPunctItemState(vals = List(slotCount) { "" })),
                solved = s.solved - key,
                strokes = s.strokes - key,
            )
        }
    }

    // ── 病句册 ────────────────────────────────────────────

    fun setTool(key: String, spotCount: Int, spotIndex: Int, tool: SdTool) {
        update { s ->
            val st = s.fState(key, spotCount)
            val tools = st.tools.mapIndexed { vi, v -> if (vi == spotIndex) tool else v }
            s.copy(fItems = s.fItems + (key to st.copy(tools = tools)))
        }
    }

    fun setPick(key: String, spotCount: Int, spotIndex: Int, option: Int) {
        update { s ->
            val st = s.fState(key, spotCount)
            val picks = st.picks.mapIndexed { vi, v -> if (vi == spotIndex) option else v }
            s.copy(fItems = s.fItems + (key to st.copy(picks = picks)))
        }
    }

    fun toggleHintFix(key: String, spotCount: Int) {
        update { s ->
            val st = s.fState(key, spotCount)
            s.copy(fItems = s.fItems + (key to st.copy(hint = !st.hint)))
        }
    }

    fun revealFix(key: String, spotCount: Int) {
        update { s ->
            val st = s.fState(key, spotCount)
            s.copy(fItems = s.fItems + (key to st.copy(revealed = true)))
        }
    }

    /** ↺ 重来（单张卡）：见 [resetPunct] */
    fun resetFix(key: String, spotCount: Int) {
        store.saveSolved(_state.value.solved - key)
        _state.update { s ->
            s.copy(
                fItems = s.fItems + (
                    key to SdFixItemState(tools = List(spotCount) { null }, picks = List(spotCount) { -1 })
                    ),
                solved = s.solved - key,
                strokes = s.strokes - key,
            )
        }
    }

    // ── 笔迹 ──────────────────────────────────────────────

    fun setStrokes(key: String, strokes: List<SdStroke>) {
        _state.update { it.copy(strokes = it.strokes + (key to strokes)) }
    }

    /** 🧽 清空本关笔迹 */
    fun clearLevelStrokes() {
        _state.update { s ->
            val prefix = if (s.mode == SdMode.PUNCT) "p:${s.punctLevel.key}:" else "f:${s.fixLevel.key}:"
            s.copy(strokes = s.strokes.filterKeys { !it.startsWith(prefix) })
        }
    }

    /** ↺ 这一关重做：清掉本关全部作答 + 记账 + 笔迹 */
    fun resetLevel() {
        val s = _state.value
        val keys = (0 until s.levelTotal).map { s.cardKey(it) }
        val nextSolved = s.solved - keys.toSet()
        store.saveSolved(nextSolved)
        _state.update { cur ->
            cur.copy(
                pItems = cur.pItems - keys.toSet(),
                fItems = cur.fItems - keys.toSet(),
                strokes = cur.strokes - keys.toSet(),
                solved = nextSolved,
                active = null,
            )
        }
    }

    // ── 朗读 ──────────────────────────────────────────────

    /**
     * 🔊 读一读 —— 用**孩子当前填的样子**读（标点没填全就会读成一口气憋到底，
     * 「听着别扭」本身就是最直接的反馈）。中文一律走百度云端音色（`"0"` = 老师）。
     */
    fun speak(text: String) {
        if (_state.value.speaking) return
        val cache = ttsCache ?: return
        if (text.isBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(speaking = true) }
            try {
                cache.play(text, "0")
            } finally {
                _state.update { it.copy(speaking = false) }
            }
        }
    }

    override fun onCleared() {
        BaiduTtsCache.stopAll()
        super.onCleared()
    }
}
