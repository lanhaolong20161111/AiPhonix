package com.example.ai.ui.radical

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.radical.RadicalFamilies
import com.example.ai.data.radical.RadicalFamily
import com.example.ai.data.radical.RadicalItem
import com.example.ai.data.radical.RadicalRepository
import com.example.ai.data.radical.RadicalRiddle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 题型：选字填空 / 选偏旁 / 猜字谜 */
enum class RadicalKind { PICK_CHAR, PICK_RADICAL, RIDDLE }

/** 四个阶段：选字族 → 看儿歌 → 答题 → 结算 */
enum class RadicalPhase { SELECT, SONG, QUIZ, DONE }

data class RadicalQuestion(
    val kind: RadicalKind,
    /** 题干：选字填空=挖空的词语；选偏旁=目标字；字谜=谜面 */
    val stem: String,
    /** 选字填空的完整词语（讲解用） */
    val word: String,
    val item: RadicalItem,
    val options: List<String>,
    val answer: String,
)

/** 小豆陪玩反应池（按对错与连击抽取，零实时 LLM 调用）—— 移植 web RadicalGamePage */
private val XIAODOU_STREAK = listOf(
    "小豆：老师你太厉害啦！教教我！",
    "小豆：哇，连都对！我要拜师！",
    "小豆：这也太简单了吧（崇拜脸）",
)
private val XIAODOU_CORRECT = listOf(
    "小豆：恭喜恭喜！我也要加油！",
    "小豆：学会啦学会啦！",
    "小豆：嘿嘿，我也记住了",
)
private val XIAODOU_WRONG = listOf(
    "小豆：没关系，我以前也老写错这个字！",
    "小豆：这个字确实容易混，再来一次！",
    "小豆：错错更健康，记住就对啦",
)

data class RadicalUiState(
    val phase: RadicalPhase = RadicalPhase.SELECT,
    val familyIdx: Int? = null,
    val questions: List<RadicalQuestion> = emptyList(),
    val qIdx: Int = 0,
    val picked: String? = null,
    val score: Int = 0,
    val streak: Int = 0,
    val songText: String? = null,
    val songLoading: Boolean = false,
    val riddleLoading: Boolean = false,
    val xiaodou: String? = null,
) {
    val current: RadicalQuestion? get() = questions.getOrNull(qIdx)
    val correct: Boolean get() = picked != null && picked == current?.answer
    val family: RadicalFamily? get() = familyIdx?.let { RadicalFamilies.ALL.getOrNull(it) }
}

/**
 * 偏旁魔法屋（对齐 web RadicalGamePage）：口诀「声旁猜读音，形旁猜意思」。
 * 三种题型：选字填空（同族字互为干扰项）/ 选偏旁 / AI 字谜；另有 AI 儿歌。
 * AI 内容（儿歌/字谜）服务端按字族缓存，失败不阻塞出题。
 */
class RadicalViewModel(
    private val repository: RadicalRepository = RadicalRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(RadicalUiState())
    val uiState: StateFlow<RadicalUiState> = _uiState.asStateFlow()

    /** 开始答题：familyIdx == null 表示「混合挑战」（全部字族随机 8 题） */
    fun startFamily(familyIdx: Int?) {
        _uiState.value = RadicalUiState(
            phase = RadicalPhase.QUIZ,
            familyIdx = familyIdx,
            questions = buildQuiz(),
        )
    }

    /** AI 儿歌：进入儿歌视图（服务端按字族缓存，首次生成稍慢） */
    fun openSong(familyIdx: Int) {
        val fam = RadicalFamilies.ALL.getOrNull(familyIdx) ?: return
        _uiState.value = _uiState.value.copy(
            phase = RadicalPhase.SONG,
            familyIdx = familyIdx,
            songText = null,
            songLoading = true,
        )
        viewModelScope.launch {
            val result = repository.song(fam.base, fam.base, fam.items.map { it.char })
            val text = when {
                result == null -> "网络不太好，再点一次试试"
                result.song.isNotBlank() -> result.song
                result.failed -> "儿歌还在赶工，等一会儿再来看看"
                else -> "AI 老师走神了，再点一次试试"
            }
            _uiState.value = _uiState.value.copy(songText = text, songLoading = false)
        }
    }

    /** AI 字谜挑战：谜面为题干、选项为全族字；拿不到谜面时退回普通题 */
    fun startRiddles(familyIdx: Int) {
        val fam = RadicalFamilies.ALL.getOrNull(familyIdx) ?: return
        _uiState.value = _uiState.value.copy(
            phase = RadicalPhase.QUIZ,
            familyIdx = familyIdx,
            questions = emptyList(),
            qIdx = 0,
            picked = null,
            score = 0,
            streak = 0,
            xiaodou = null,
            riddleLoading = true,
        )
        viewModelScope.launch {
            val riddles = repository.riddles(fam.base, fam.items.map { it.char }, 4)
            val questions = if (riddles.isNullOrEmpty()) buildQuiz() else buildRiddleQuiz(fam, riddles)
            _uiState.value = _uiState.value.copy(questions = questions, riddleLoading = false)
        }
    }

    fun pick(opt: String) {
        val st = _uiState.value
        val q = st.current ?: return
        if (st.picked != null) return
        if (opt == q.answer) {
            val nextStreak = st.streak + 1
            val pool = if (nextStreak >= 3) XIAODOU_STREAK else XIAODOU_CORRECT
            _uiState.value = st.copy(
                picked = opt,
                score = st.score + 1,
                streak = nextStreak,
                xiaodou = pool.random(),
            )
        } else {
            _uiState.value = st.copy(picked = opt, streak = 0, xiaodou = XIAODOU_WRONG.random())
        }
    }

    fun next() {
        val st = _uiState.value
        if (st.qIdx + 1 >= st.questions.size) {
            _uiState.value = st.copy(phase = RadicalPhase.DONE)
        } else {
            _uiState.value = st.copy(qIdx = st.qIdx + 1, picked = null, xiaodou = null)
        }
    }

    /** 回到选字族 */
    fun backToSelect() {
        _uiState.value = _uiState.value.copy(phase = RadicalPhase.SELECT)
    }

    // ── 出题（移植 web buildQuiz）──

    private fun buildQuiz(): List<RadicalQuestion> {
        val out = mutableListOf<RadicalQuestion>()
        val allItems = RadicalFamilies.ALL.flatMap { it.items }

        // 题型 A ×5：选字填空（同族字做干扰项，正是易混点）
        for (fam in RadicalFamilies.ALL.shuffled().take(5)) {
            val target = fam.items.random()
            val distractors = fam.items.filter { it.char != target.char }.map { it.char }.take(3)
            if (distractors.size < 3) continue
            val blanked =
                if (target.word.contains(target.char)) {
                    target.word.replaceFirst(target.char, "（　）")
                } else {
                    "（　）${target.word}"
                }
            out.add(
                RadicalQuestion(
                    kind = RadicalKind.PICK_CHAR,
                    stem = blanked,
                    word = target.word,
                    item = target,
                    options = (listOf(target.char) + distractors).shuffled(),
                    answer = target.char,
                )
            )
        }

        // 题型 B ×3：选偏旁
        val radicalPool = allItems.map { it.radical }.distinct()
        for (target in allItems.shuffled().take(3)) {
            val distractors = radicalPool.filter { it != target.radical }
            out.add(
                RadicalQuestion(
                    kind = RadicalKind.PICK_RADICAL,
                    stem = target.char,
                    word = target.word,
                    item = target,
                    options = (listOf(target.radical) + distractors.shuffled().take(3)).shuffled(),
                    answer = target.radical,
                )
            )
        }
        return out
    }

    /** 字谜模式：谜面为题干，选项为全族字（移植 web buildRiddleQuiz） */
    private fun buildRiddleQuiz(fam: RadicalFamily, riddles: List<RadicalRiddle>): List<RadicalQuestion> =
        riddles.map { r ->
            val item = fam.items.firstOrNull { it.char == r.answer }
                ?: fam.items.first().copy(char = r.answer)
            RadicalQuestion(
                kind = RadicalKind.RIDDLE,
                stem = r.riddle,
                word = r.answer,
                item = item,
                options = fam.items.map { it.char }.shuffled(),
                answer = r.answer,
            )
        }
}
