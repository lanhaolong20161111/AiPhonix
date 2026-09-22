package com.example.ai.ui.dailychinese

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.dailyzh.DailyTextSplit
import com.example.ai.data.dailyzh.DailyZhConfig
import com.example.ai.data.dailyzh.DailyZhRepository
import com.example.ai.data.dailyzh.DailyZhStore
import com.example.ai.data.wordbank.WordBankRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/** 设置面板的四个字段（web 是 4 个 textarea） */
enum class DailyZhField { CHARS, WORDS, SENTENCES, ESSAY_TOPIC }

data class DailyChineseUiState(
    val cfg: DailyZhConfig = DailyZhConfig(),
    val draft: DailyZhConfig = DailyZhConfig(),
    val settingsOpen: Boolean = false,
    val loading: Boolean = false,
    val saving: Boolean = false,
    /** 今日没设、带入了"最近一次"内容时的提示（web `prefillHint`） */
    val prefillHint: Boolean = false,
    /** 词库命中数（chars, words）；null = 还没算完（web 的 hitInfo == null 时不显示） */
    val hitInfo: Pair<Int, Int>? = null,
) {
    val charsTotal: Int get() = DailyTextSplit.chars(cfg.chars).size
    val wordsTotal: Int get() = DailyTextSplit.words(cfg.words).size
    val sentencesTotal: Int get() = DailyTextSplit.chars(cfg.sentences).size

    /** 与 web `todaySummary` 逐字一致的摘要行 */
    val todaySummary: String
        get() {
            val parts = buildList {
                if (charsTotal > 0) {
                    add("练字 $charsTotal 个" + (hitInfo?.let { "（词库命中 ${it.first}）" } ?: ""))
                }
                if (wordsTotal > 0) {
                    add("练词 $wordsTotal 个" + (hitInfo?.let { "（词库命中 ${it.second}）" } ?: ""))
                }
                if (sentencesTotal > 0) add("练句 $sentencesTotal 条")
                val topic = cfg.essayTopic.trim()
                if (topic.isNotEmpty()) add("作文「$topic」")
            }
            return if (parts.isNotEmpty()) parts.joinToString(" · ")
            else "今日内容：家长还没有设置，点右上角 ⚙️ 设置"
        }
}

/**
 * 每日语文（家长设置今日字/词/句/作文主题，孩子从 4 个入口练）
 * —— 对齐 web `DailyChinesePage`。
 *
 * 配置同步策略与 web 一致：
 * ① 进页面先读本地镜像（秒开）；已登录再拉服务端（今日 config → 无则最近一次 last 预填）；
 * ② 保存时**先存服务端再写镜像**（服务端失败也写镜像，保证本机可用）；
 * ③ 联网失败**不覆盖**镜像（只用镜像展示）。
 */
class DailyChineseViewModel(
    private val store: DailyZhStore,
    private val wordBankRepository: WordBankRepository,
    private val repository: DailyZhRepository = DailyZhRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(DailyChineseUiState())
    val uiState: StateFlow<DailyChineseUiState> = _uiState.asStateFlow()

    init {
        // ① 本地镜像先上屏（web：useState 初值就是 readLocalMirror()）
        val local = store.read()
        _uiState.value = _uiState.value.copy(cfg = local, draft = local)
        loadRemote()
        refreshHitInfo()
    }

    private fun loadRemote() {
        if (TokenManager.accessToken.isBlank()) return // 未登录：只用镜像（web 同）
        _uiState.value = _uiState.value.copy(loading = true)
        viewModelScope.launch {
            val res = repository.fetch()
            val st = _uiState.value
            _uiState.value = if (res == null) {
                // 联网失败 → 保留当前（镜像）内容，只关掉 loading
                st.copy(loading = false)
            } else {
                val next = res.config ?: res.last ?: store.read()
                store.write(next)
                st.copy(
                    cfg = next,
                    draft = next,
                    loading = false,
                    // 今日未设但带入了最近一次 → 提示"改了要保存才生效"
                    prefillHint = res.config == null && res.last != null,
                )
            }
        }
    }

    /** 统计今日字/词在词库里的命中数（web 的 useEffect([cfg.chars, cfg.words])） */
    private fun refreshHitInfo() {
        val chars = DailyTextSplit.chars(_uiState.value.cfg.chars)
        val words = DailyTextSplit.words(_uiState.value.cfg.words)
        _uiState.value = _uiState.value.copy(hitInfo = null)
        viewModelScope.launch {
            val pair = withContext(Dispatchers.IO) {
                wordBankRepository.countCharsByTexts(chars) to wordBankRepository.countWordsByTexts(words)
            }
            _uiState.value = _uiState.value.copy(hitInfo = pair)
        }
    }

    fun openSettings() {
        // web：打开时把草稿同步成当前生效配置
        _uiState.value = _uiState.value.copy(draft = _uiState.value.cfg, settingsOpen = true)
    }

    fun closeSettings() {
        _uiState.value = _uiState.value.copy(settingsOpen = false)
    }

    fun onDraftChange(field: DailyZhField, value: String) {
        val d = _uiState.value.draft
        val next = when (field) {
            DailyZhField.CHARS -> d.copy(chars = value)
            DailyZhField.WORDS -> d.copy(words = value)
            DailyZhField.SENTENCES -> d.copy(sentences = value)
            DailyZhField.ESSAY_TOPIC -> d.copy(essayTopic = value)
        }
        _uiState.value = _uiState.value.copy(draft = next)
    }

    fun save() {
        if (_uiState.value.saving) return
        val next = _uiState.value.draft.copy(updatedAt = Instant.now().toString())
        _uiState.value = _uiState.value.copy(saving = true)
        viewModelScope.launch {
            if (TokenManager.accessToken.isNotBlank()) {
                // 失败也不阻断：仍写本地镜像（web 的 catch { /* 服务端失败仍写本地镜像 */ }）
                withContext(Dispatchers.IO) { repository.save(next) }
            }
            store.write(next)
            _uiState.value = _uiState.value.copy(
                cfg = next,
                draft = next,
                saving = false,
                settingsOpen = false,
                prefillHint = false,
            )
            refreshHitInfo()
        }
    }
}
