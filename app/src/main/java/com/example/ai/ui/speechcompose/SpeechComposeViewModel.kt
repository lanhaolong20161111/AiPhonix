package com.example.ai.ui.speechcompose

import android.util.Base64
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.audio.AudioRecorder
import com.example.ai.data.speech.ScoreClient
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.data.tts.annotateTts
import com.example.ai.data.tts.charAudioUrl
import com.example.ai.data.tts.ttsAuthHeaders
import com.example.ai.data.zhteach.ArticleLine
import com.example.ai.data.zhteach.ArticleSplit
import com.example.ai.data.zhteach.PoemLine
import com.example.ai.data.zhteach.PoemScript
import com.example.ai.data.zhteach.PoemSearchHit
import com.example.ai.data.zhteach.PoemSplit
import com.example.ai.data.zhteach.TeachItem
import com.example.ai.data.zhteach.TeachJudgeResult
import com.example.ai.data.zhteach.TeachScript
import com.example.ai.data.zhteach.ZhPoemRepository
import com.example.ai.data.zhteach.ZhReciteRepository
import com.example.ai.data.zhteach.ZhTeachRepository
import com.example.ai.di.NetworkModule
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** 词语教学模式的阶段 */
enum class TeachStage { SETUP, QUESTION, JUDGING, FINISHED }

/**
 * 页面当前模式。
 * 判定顺序与 web `SpeechComposePage.tsx` 的分支顺序一致（poem → article → teach）。
 */
enum class ComposeMode { SETUP, POEM, ARTICLE, TEACH }

/** 跟读测评过关后的去向（三处入口共用同一套录音/评分逻辑） */
private enum class EchoNext { TEACH, POEM, ARTICLE }

/**
 * AI 对话学语文（对齐 web `pages/SpeechComposePage.tsx`）。
 *
 * 一个页面装了三套练习，按提交时的填写内容分流：
 *  1. **古诗**：填了「要练的古诗」 ⇒ 本地立刻切句开始（见 [PoemSplit]），
 *     后台补逐句白话/逐字释义；开场先朗读整篇 + 概括，再逐句跟读测评。
 *  2. **文章**：填了「要练的文章」 ⇒ 本地立刻切句开始（见 [ArticleSplit]），
 *     后台补每句背诵缩写；逐句领读 + 跟读测评。
 *  3. **词语/句子教学**：以上都没填 ⇒ 后端 `zh-teach-setup` 生成逐题剧本，
 *     一问一答；6 秒没作答自动逐级给提示（意思 → 例句 → 句型骨架，最多 3 级）；
 *     答错先朗读参考回答，再让孩子跟读测评。
 *
 * 中文朗读音色：默认 [ZH_SPEAKER]（"0"，老师），古诗用 [POEM_SPEAKER]（"3"，度逍遥）——
 * 与 web 的 `6221` 数字不同，因为 Android 侧既有中文模块一律用 "0"/"3"（见 `BaiduTtsCache`）。
 */
class SpeechComposeViewModel(
    private val zhTeachRepository: ZhTeachRepository = ZhTeachRepository(),
    private val zhPoemRepository: ZhPoemRepository = ZhPoemRepository(),
    private val zhReciteRepository: ZhReciteRepository = ZhReciteRepository(),
    private val audioRecorder: AudioRecorder = AudioRecorder(),
    /**
     * 中文 TTS（百度）。为 null 时**静默降级为不朗读**，其余功能（讲评、评测、记录）不受影响。
     * 生产环境由 `AppContainer.ttsCache` 注入；单测不传。
     */
    private val ttsCache: BaiduTtsCache? = null,
) : ViewModel() {

    private val scoreClient = ScoreClient(NetworkModule.httpClient)

    private val _uiState = MutableStateFlow(SpeechComposeUiState())
    val uiState: StateFlow<SpeechComposeUiState> = _uiState.asStateFlow()

    /** 当前朗读任务（新朗读会先取消它，避免叠音） */
    private var speakJob: Job? = null

    /** 6 秒未作答 → 逐级提示的计时器 */
    private var hintJob: Job? = null

    /** 古诗库搜索防抖 */
    private var searchJob: Job? = null

    /** 录音评测任务 */
    private var evalJob: Job? = null

    /** 最后一次"有效动作"的时间戳（输入/切题/提交都会刷新），用于 6 秒提示计时 */
    private var lastActAt = 0L

    /** 本轮古诗的祝贺词是否已朗读过（每首只自动读一次） */
    private var poemCongratsSpoken = false

    /** 本轮文章的祝贺词是否已朗读过 */
    private var artCongratsSpoken = false

    private fun setState(block: (SpeechComposeUiState) -> SpeechComposeUiState) {
        _uiState.value = block(_uiState.value)
    }

    // ══════════════════════════════════════════════════════════════
    // 设置页
    // ══════════════════════════════════════════════════════════════

    fun onTopicChange(v: String) = setState { it.copy(topic = v, setupError = "") }
    fun onWordsChange(v: String) = setState { it.copy(wordsText = v, setupError = "") }
    fun onSentencesChange(v: String) = setState { it.copy(sentencesText = v, setupError = "") }
    fun onArticleTextChange(v: String) = setState { it.copy(articleText = v, setupError = "") }

    /** 手改古诗原文后，不再认定是库里那首（作者/题目提示同步撤掉） */
    fun onPoemTextChange(v: String) = setState {
        it.copy(
            poemText = v,
            poemPicked = "",
            poemTitle = "",
            poemDynasty = "",
            poemAuthor = "",
            setupError = "",
        )
    }

    /** 搜小学古诗库（300ms 防抖，纯数据不走 LLM） */
    fun onPoemQueryChange(v: String) {
        setState { it.copy(poemQuery = v) }
        searchJob?.cancel()
        val q = v.trim()
        if (q.isEmpty()) {
            setState { it.copy(poemHits = emptyList(), poemSearching = false) }
            return
        }
        setState { it.copy(poemSearching = true) }
        searchJob = viewModelScope.launch {
            delay(300)
            val hits = zhPoemRepository.search(q).getOrDefault(emptyList())
            setState { it.copy(poemHits = hits, poemSearching = false) }
        }
    }

    /** 选中库中古诗 → 自动填入原文（清搜索结果，保留提示） */
    fun pickPoem(hit: PoemSearchHit) = setState {
        it.copy(
            poemText = hit.text,
            poemQuery = "",
            poemHits = emptyList(),
            poemPicked = "已选《${hit.title}》 ${hit.dynasty}·${hit.author}",
            poemTitle = hit.title,
            poemDynasty = hit.dynasty,
            poemAuthor = hit.author,
            setupError = "",
        )
    }

    /**
     * 「开始学」——按填写内容分流（顺序与 web 一致：文章 → 古诗 → 词语/句子）。
     * 文章与古诗都是**本地立刻开始**，不等 LLM。
     */
    fun start() {
        val s = _uiState.value
        if (s.settingUp) return
        when {
            s.articleText.isNotBlank() -> startArticle()
            s.poemText.isNotBlank() -> startPoem()
            else -> startTeach()
        }
    }

    /** 回到设置页并清空全部练习状态 */
    fun backToSetup() {
        speakJob?.cancel()
        hintJob?.cancel()
        evalJob?.cancel()
        BaiduTtsCache.stopAll()
        searchJob?.cancel()
        _uiState.value = SpeechComposeUiState()
    }

    // ══════════════════════════════════════════════════════════════
    // 模式一：词语 / 句子教学
    // ══════════════════════════════════════════════════════════════

    private fun startTeach() {
        val s = _uiState.value
        val words = s.wordsText.split(Regex("[,，、\\s]+")).map { it.trim() }.filter { it.isNotEmpty() }
        val sentences = s.sentencesText.split(Regex("\n+")).map { it.trim() }.filter { it.isNotEmpty() }
        if (words.isEmpty() && sentences.isEmpty() && s.topic.isBlank()) {
            setState { it.copy(setupError = "请输入至少一个要练的词 / 句子，或主题（也可以填一首古诗）") }
            return
        }
        setState { it.copy(settingUp = true, setupError = "") }
        startWaitTicker()
        viewModelScope.launch {
            val result = zhTeachRepository.setup(s.topic.trim(), words, sentences)
            setState { it.copy(settingUp = false) }
            result.onSuccess { script ->
                if (script.items.isEmpty()) {
                    setState { it.copy(setupError = "AI 没有生成题目，请稍后重试") }
                    return@onSuccess
                }
                _uiState.value = _uiState.value.copy(
                    script = script,
                    units = words + sentences,
                    teachIdx = 0,
                    teachStage = TeachStage.QUESTION,
                    answer = "",
                    judge = null,
                    echoOpen = false,
                    echoDone = false,
                    hintLvl = 0,
                    hintTip = "",
                    covered = emptySet(),
                )
                restartHintTimer()
                script.items.firstOrNull()?.q?.let { speakQuestion(it) }
            }.onFailure { e ->
                setState { it.copy(setupError = "生成失败：${e.message ?: "未知错误"}") }
            }
        }
    }

    /** "AI 出题中… Ns" 的秒表（让等待看得见进度，不像卡死） */
    private fun startWaitTicker() {
        viewModelScope.launch {
            var sec = 0
            while (isActive && _uiState.value.settingUp) {
                delay(1000)
                sec++
                setState { it.copy(waitSec = sec) }
            }
            setState { it.copy(waitSec = 0) }
        }
    }

    fun onAnswerChange(v: String) {
        setState { it.copy(answer = v) }
        lastActAt = System.currentTimeMillis() // 有输入就重置 6 秒计时
    }

    /** 提交作答：对 → 表扬后进下一题；错 → 朗读参考回答并进入跟读测评 */
    fun submitTeachAnswer() {
        val s = _uiState.value
        val item = s.currentTeachItem ?: return
        if (s.answer.isBlank() || s.teachStage != TeachStage.QUESTION || s.judge != null) return
        setState { it.copy(teachStage = TeachStage.JUDGING) }
        lastActAt = System.currentTimeMillis()
        hintJob?.cancel()
        viewModelScope.launch {
            val result = zhTeachRepository.judge(item.q, item.ref, s.answer.trim())
            result.onSuccess { res ->
                setState { it.copy(judge = res, teachStage = TeachStage.QUESTION) }
                if (res.ok) {
                    markCovered(item.focus)
                    speakSimple(res.praise.ifBlank { "真棒！" })
                } else {
                    // 先显示并朗读参考回答；跟读测评由用户点按钮再开始（对齐 web 的两步交互：
                    // 直接弹测评会打断"先听一遍参考句"的节奏）
                    if (res.correct.isNotBlank()) speakSimple(res.correct)
                }
            }.onFailure { e ->
                Log.w(TAG, "判定失败: ${e.message}")
                setState {
                    it.copy(
                        judge = TeachJudgeResult(ok = false, praise = "评分出错了，再试一次。", correct = ""),
                        teachStage = TeachStage.QUESTION,
                    )
                }
            }
        }
    }

    /** 跟读过关或跳过后，进入下一题 / 完成 */
    fun gotoNextTeach() {
        val s = _uiState.value
        val next = s.teachIdx + 1
        if (next < s.teachTotal) {
            _uiState.value = s.copy(
                teachIdx = next,
                teachStage = TeachStage.QUESTION,
                answer = "",
                judge = null,
                echoOpen = false,
                echoDone = false,
                hintLvl = 0,
                hintTip = "",
                echoText = "",
                echoScore = null,
                echoFeedback = "",
                echoError = "",
            )
            restartHintTimer()
            s.script?.items?.getOrNull(next)?.q?.let { speakQuestion(it) }
        } else {
            setState { it.copy(teachStage = TeachStage.FINISHED) }
        }
    }

    /** 跟读过关（≥70）：记覆盖，标记可下一题 */
    private fun onEchoPassed() {
        when (echoNext) {
            EchoNext.TEACH -> {
                _uiState.value.currentTeachItem?.focus?.let(::markCovered)
                setState { it.copy(echoOpen = false, echoDone = true) }
            }
            EchoNext.POEM -> {
                val i = _uiState.value.poemIdx
                setState { it.copy(poemEvaluated = it.poemEvaluated + i) }
                enterPoemVerse(i + 1)
            }
            EchoNext.ARTICLE -> {
                val i = _uiState.value.artIdx
                setState { it.copy(artEvaluated = it.artEvaluated + i) }
                enterArticleSentence(i + 1)
            }
        }
    }

    /** 跳过当前跟读测评 */
    fun skipEcho() {
        BaiduTtsCache.stopAll()
        when (echoNext) {
            EchoNext.TEACH -> {
                setState { it.copy(echoOpen = false, echoDone = false, echoText = "") }
            }
            EchoNext.POEM -> {
                setState { it.copy(echoText = "") }
                enterPoemVerse(_uiState.value.poemIdx + 1)
            }
            EchoNext.ARTICLE -> {
                setState { it.copy(echoText = "") }
                enterArticleSentence(_uiState.value.artIdx + 1)
            }
        }
    }

    private fun markCovered(focus: String) {
        if (focus.isBlank()) return
        setState { it.copy(covered = it.covered + focus) }
    }

    /** 重读当前提问 */
    fun replayQuestion() {
        val q = _uiState.value.currentTeachItem?.q.orEmpty()
        if (q.isNotBlank()) speakSimple(q)
    }

    /** 重读参考回答 */
    fun replayCorrect() {
        val c = _uiState.value.judge?.correct.orEmpty()
        if (c.isNotBlank()) speakSimple(c)
    }

    /**
     * 开始跟读测评（用户点「🎤 跟读测评这句」）。
     * 待评句子优先用服务端给的参考回答，为空才退回剧本里的 ref。
     */
    fun openTeachEcho() {
        val s = _uiState.value
        val item = s.currentTeachItem ?: return
        val text = s.judge?.correct?.takeIf { it.isNotBlank() } ?: item.ref
        if (text.isBlank()) return
        if (s.echoText.isBlank()) beginEcho(text, EchoNext.TEACH, "读得真好！")
        setState { it.copy(echoOpen = true) }
    }

    /**
     * 6 秒未作答 → 逐级提示并朗读（意思 → 例句 → 句型骨架，最多 3 级）。
     * web 用一个每秒 tick 的 interval + `lastActRef` 实现，这里等价地用一个协程循环。
     */
    private fun restartHintTimer() {
        hintJob?.cancel()
        lastActAt = System.currentTimeMillis()
        hintJob = viewModelScope.launch {
            while (isActive) {
                delay(1000)
                val s = _uiState.value
                if (s.teachStage != TeachStage.QUESTION) return@launch
                if (s.judge != null || s.echoOpen) return@launch
                val hints = s.currentTeachItem?.hints ?: emptyList()
                if (s.hintLvl >= hints.size) return@launch
                if (System.currentTimeMillis() - lastActAt < SIX_SECONDS) continue
                val h = hints[s.hintLvl]
                setState { it.copy(hintLvl = it.hintLvl + 1, hintTip = h) }
                lastActAt = System.currentTimeMillis()
                speakSimple(h)
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 模式二：古诗
    // ══════════════════════════════════════════════════════════════

    /**
     * 古诗模式入口：先用原文切句**立即开始**（不等 LLM），讲解/白话在后台生成好后原地补上。
     *
     * 与 web 一致的时序：开场先朗读「整篇古诗」（若快速概括已回，用它的全诗拼音锁多音字读音），
     * 再读「全诗概括」，然后才进入逐句。
     */
    private fun startPoem() {
        val s = _uiState.value
        val raw = s.poemText.trim()
        val segs = PoemSplit.split(raw)
        if (segs.isEmpty()) {
            setState { it.copy(setupError = "请先粘贴要练的古诗原文") }
            return
        }
        val local = PoemScript(
            // 库内选中时已有确定的题目/朝代/作者，先显示，不等 LLM
            title = s.poemTitle.ifBlank { "古诗练习" },
            summary = "",
            lines = segs.map { PoemLine(verse = it) },
            fallback = true,
        )
        _uiState.value = s.copy(
            poem = local,
            poemIdx = 0,
            poemEvaluated = emptySet(),
            poemIntroDone = false,
            charTip = null,
            echoText = "",
            echoScore = null,
            echoFeedback = "",
            echoError = "",
            setupError = "",
        )
        poemCongratsSpoken = false

        // 快速概括（1~3s）：整篇朗读前先拿它的拼音，锁住多音字读音
        val summaryDeferred = viewModelScope.async { zhPoemRepository.summary(raw).getOrNull() }
        // 后台生成完整讲解（逐句白话/逐字释义/逐字拼音）；成功后原地合并，失败保持原文练习可用
        viewModelScope.launch {
            val p = zhPoemRepository.setup(raw).getOrNull() ?: return@launch
            setState { st ->
                val prev = st.poem ?: return@setState st
                // 匹配键去掉标点/空白：LLM 与本地切句的标点常不一致（如「，」丢/换），否则整篇对不上
                val byText = p.lines
                    .filter { normVerse(it.verse).isNotEmpty() }
                    .associateBy { normVerse(it.verse) }
                val sameLen = p.lines.size == prev.lines.size
                st.copy(
                    poem = prev.copy(
                        title = if (prev.title.isNotBlank()) prev.title else p.title.ifBlank { prev.title },
                        summary = p.summary.ifBlank { prev.summary },
                        fallback = false,
                        lines = prev.lines.mapIndexed { li, l ->
                            // ① 去标点后按原文匹配；② 对不上但句数一致时按下标兜底
                            val hit = byText[normVerse(l.verse)] ?: if (sameLen) p.lines.getOrNull(li) else null
                            if (hit == null) l else l.copy(
                                pinyin = l.pinyin.ifBlank { hit.pinyin },
                                meaning = hit.meaning.ifBlank { l.meaning },
                                chars = if (hit.chars.isNotEmpty()) hit.chars else l.chars,
                            )
                        },
                    ),
                )
            }
        }

        // 开场：先朗读整篇古诗（有全诗拼音则锁读多音字），再读全诗概括，然后才逐句
        speakJob = viewModelScope.launch {
            if (_uiState.value.ttsBusy) return@launch
            setState { it.copy(ttsBusy = true) }
            try {
                // 概括端点很快，最多等 3s 拿它的全诗拼音，让"整篇朗读"的读音也正确
                val sum = withTimeoutOrNull(3_000) { summaryDeferred.await() }
                if (sum != null && sum.summary.isNotBlank()) {
                    setState { it.copy(poem = it.poem?.copy(summary = it.poem.summary.ifBlank { sum.summary })) }
                }
                speak(annotateTts(raw, sum?.pinyin.orEmpty()), POEM_SPEAKER, 40_000)
                val summary = sum?.summary.orEmpty()
                if (summary.isNotBlank()) speak(summary, POEM_SPEAKER, 20_000)
            } finally {
                setState { it.copy(ttsBusy = false) }
            }
            setState { it.copy(poemIntroDone = true) }
            enterPoemVerse(0)
        }
    }

    /** 进入某一句古诗：先读原文（锁多音字），再读白话意思；读完才出现测评 */
    fun enterPoemVerse(i: Int) {
        val s = _uiState.value
        val poem = s.poem ?: return
        if (i >= poem.lines.size) {
            setState { it.copy(poemIdx = i, echoText = "") }
            maybeSpeakPoemCongrats()
            return
        }
        setState { it.copy(poemIdx = i, charTip = null, echoText = "", echoScore = null, echoFeedback = "", echoError = "") }
        speakJob = viewModelScope.launch {
            if (_uiState.value.ttsBusy) return@launch
            setState { it.copy(ttsBusy = true) }
            try {
                val l = _uiState.value.poem?.lines?.getOrNull(i)
                if (l != null) {
                    speak(annotateTts(l.verse, l.pinyin), POEM_SPEAKER, 30_000)
                    if (l.meaning.isNotBlank()) speak(l.meaning, POEM_SPEAKER, 20_000)
                }
            } finally {
                setState { it.copy(ttsBusy = false) }
            }
            // 领读完成 → 出现跟读测评（先听后评）
            val l = _uiState.value.poem?.lines?.getOrNull(i)
            if (l != null) beginEcho(l.verse, EchoNext.POEM, "读得真好！")
        }
    }

    /** 单字点读：先读这个字（带本句读音，避免孤立字读成古音/异读），紧接着读这个字的意思 */
    fun tapPoemChar(c: String, meaning: String, pinyin: String) {
        if (_uiState.value.ttsBusy) return
        setState { it.copy(charTip = c to meaning, ttsBusy = true) }
        speakJob = viewModelScope.launch {
            try {
                withTimeoutOrNull(12_000) {
                    // 单字走容器端点（先查人工录音库/TTS 沉淀库），带本句读音锁多音字
                    ttsCache?.playRemoteAndWait(charAudioUrl(c, pinyin), ttsAuthHeaders())
                }
                if (meaning.isNotBlank()) speak(meaning, POEM_SPEAKER, 20_000)
            } finally {
                setState { it.copy(ttsBusy = false) }
            }
        }
    }

    /** 朗读当前句原文 / 白话 / 全诗概括（按钮） */
    fun speakCurrentPoemVerse() {
        val l = _uiState.value.poemLine ?: return
        launchSpeech { speak(annotateTts(l.verse, l.pinyin), POEM_SPEAKER, 30_000) }
    }

    fun speakCurrentPoemMeaning() {
        val l = _uiState.value.poemLine ?: return
        if (l.meaning.isBlank()) return
        launchSpeech { speak(l.meaning, POEM_SPEAKER, 20_000) }
    }

    fun speakPoemSummary() {
        val summary = _uiState.value.poem?.summary.orEmpty()
        if (summary.isBlank()) return
        launchSpeech { speak(summary, POEM_SPEAKER, 20_000) }
    }

    /** 读完一首诗：朗读祝贺词 + 白话概括（每首只自动读一次） */
    private fun maybeSpeakPoemCongrats() {
        if (poemCongratsSpoken) return
        poemCongratsSpoken = true
        speakPoemCompletion()
    }

    fun speakPoemCompletion() {
        val poem = _uiState.value.poem ?: return
        if (_uiState.value.poemTotal <= 0) return
        launchSpeech {
            speak("《${poem.title}》全部 ${poem.lines.size} 句都读完啦！真棒！", POEM_SPEAKER, 20_000)
            if (poem.summary.isNotBlank()) speak(poem.summary, POEM_SPEAKER, 20_000)
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 模式三：文章背诵
    // ══════════════════════════════════════════════════════════════

    /** 开始文章练习：本地切句**立即**进入；每句的「背诵缩写」后台生成后原地合并 */
    private fun startArticle() {
        val s = _uiState.value
        val raw = s.articleText.trim()
        val segs = ArticleSplit.splitSentences(raw)
        if (segs.isEmpty()) {
            setState { it.copy(setupError = "没有识别到句子，请检查文章内容") }
            return
        }
        val lines = segs.map { ArticleLine(text = it, short = "") }
        _uiState.value = s.copy(
            article = lines,
            artIdx = 0,
            artReady = false,
            artEvaluated = emptySet(),
            shortsLoading = true,
            echoText = "",
            echoScore = null,
            echoFeedback = "",
            echoError = "",
            setupError = "",
        )
        artCongratsSpoken = false

        viewModelScope.launch {
            val items = zhReciteRepository.setup(segs).getOrNull()
            setState {
                it.copy(
                    // 缩写生成失败/为空：保持无缩写可练，不打断
                    article = if (items.isNullOrEmpty()) it.article else ArticleSplit.mergeShorts(segs, items),
                    shortsLoading = false,
                )
            }
        }
        enterArticleSentence(0)
    }

    /** 进入某一句文章：先 TTS 领读该句，读完再出现跟读测评（一句一轮） */
    fun enterArticleSentence(i: Int) {
        val s = _uiState.value
        val items = s.article ?: return
        if (i >= items.size) {
            setState { it.copy(artIdx = i, artReady = false, echoText = "") }
            maybeSpeakArticleCongrats()
            return
        }
        setState { it.copy(artIdx = i, artReady = false, echoText = "", echoScore = null, echoFeedback = "", echoError = "") }
        speakJob = viewModelScope.launch {
            if (_uiState.value.ttsBusy) return@launch
            setState { it.copy(ttsBusy = true) }
            try {
                val text = _uiState.value.article?.getOrNull(i)?.text.orEmpty()
                if (text.isNotBlank()) speak(text, ZH_SPEAKER, 30_000)
            } finally {
                setState { it.copy(ttsBusy = false) }
            }
            setState { it.copy(artReady = true) }
            val text = _uiState.value.article?.getOrNull(i)?.text.orEmpty()
            if (text.isNotBlank()) beginEcho(text, EchoNext.ARTICLE, "这句读得真好！")
        }
    }

    /** 单独朗读某一句（列表里的小喇叭） */
    fun speakArticleLine(text: String) {
        if (text.isBlank()) return
        launchSpeech { speak(text, ZH_SPEAKER, 30_000) }
    }

    private fun maybeSpeakArticleCongrats() {
        if (artCongratsSpoken) return
        artCongratsSpoken = true
        speakArticleCompletion()
    }

    fun speakArticleCompletion() {
        val total = _uiState.value.artTotal
        if (total <= 0) return
        launchSpeech { speak("全部 $total 句都读完啦！真棒！", ZH_SPEAKER, 20_000) }
    }

    // ══════════════════════════════════════════════════════════════
    // 跟读测评（web `EchoLadder` 的 Android 等价物，单级整句）
    // ══════════════════════════════════════════════════════════════

    private var echoNext = EchoNext.TEACH

    /** 准备一轮跟读测评：设置待评测句并**自动领读一次**（对齐 web `autoReadFirst`） */
    private fun beginEcho(text: String, next: EchoNext, praise: String) {
        if (text.isBlank()) return
        echoNext = next
        setState {
            it.copy(
                echoText = text,
                echoPraise = praise,
                echoScore = null,
                echoFeedback = "",
                echoError = "",
            )
        }
        launchSpeech { speak(text, if (next == EchoNext.POEM) POEM_SPEAKER else ZH_SPEAKER, 30_000) }
    }

    /** 开始录音（挂起到 [stopRecording]） */
    fun startRecording() {
        val s = _uiState.value
        if (s.recording || s.evaluating || s.echoText.isBlank()) return
        BaiduTtsCache.stopAll() // 先停掉领读，避免录进播放声
        setState { it.copy(recording = true, echoScore = null, echoFeedback = "", echoError = "") }
        evalJob?.cancel()
        evalJob = viewModelScope.launch {
            try {
                audioRecorder.reset()
                val pcm = audioRecorder.record()
                if (pcm.size < MIN_AUDIO_BYTES) throw RuntimeException("录音太短，请至少读一秒")
                setState { it.copy(recording = false, evaluating = true) }
                val refText = _uiState.value.echoText
                val result = withContext(Dispatchers.IO) {
                    val b64 = Base64.encodeToString(pcm, Base64.NO_WRAP)
                    scoreClient.evaluate(refText, b64, ENGINE_ZH)
                }
                setState {
                    it.copy(
                        evaluating = false,
                        echoScore = result.totalScore,
                        echoFeedback = result.feedback.orEmpty(),
                        echoError = "",
                    )
                }
                if (result.totalScore >= PASS_SCORE) {
                    // ⚠️ 表扬语与"进入下一步"必须**串行**：web 的 EchoLadder 是播完 praise 才回调 onFinished。
                    // 若这里用 speakSimple（异步）后立刻 onEchoPassed，下一步的领读会被 ttsBusy 挡掉，
                    // 表现为「过关后下一句不读了」。
                    val praise = _uiState.value.echoPraise.ifBlank { "读得真好！" }
                    speakJob = viewModelScope.launch {
                        setState { it.copy(ttsBusy = true) }
                        try {
                            speak(praise, ZH_SPEAKER, 15_000)
                        } finally {
                            setState { it.copy(ttsBusy = false) }
                        }
                        onEchoPassed()
                    }
                } else {
                    // 未过关：重新领读一遍（对齐 web 的 `setRetry(r => r + 1)`）
                    speakSimple(refText)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "评测失败: ${e.message}")
                setState {
                    it.copy(recording = false, evaluating = false, echoError = e.message ?: "评测失败")
                }
            }
        }
    }

    /** 停止录音（触发评测） */
    fun stopRecording() {
        if (_uiState.value.recording) audioRecorder.stop()
    }

    /** 清掉测评分（重试） */
    fun clearEchoScore() = setState { it.copy(echoScore = null, echoFeedback = "", echoError = "") }

    // ══════════════════════════════════════════════════════════════
    // 朗读基础设施
    // ══════════════════════════════════════════════════════════════

    /**
     * 执行一段朗读流程。**忙碌时直接忽略新请求**（对齐 web 的 `poemBusyRef`/`artBusyRef`），
     * 避免两个 TTS 叠在一起。
     */
    private fun launchSpeech(body: suspend () -> Unit) {
        if (_uiState.value.ttsBusy) return
        speakJob = viewModelScope.launch {
            setState { it.copy(ttsBusy = true) }
            try {
                body()
            } finally {
                setState { it.copy(ttsBusy = false) }
            }
        }
    }

    /** 只要朗读、不需要配合其它状态的简写（问题、表扬、提示、参考回答） */
    private fun speakSimple(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        launchSpeech { speak(t, ZH_SPEAKER, 30_000) }
    }

    private fun speakQuestion(q: String) = speakSimple(q)

    /**
     * 单次朗读，带硬超时（web 用 `withTimeout` 兜住"底层 promise 永不返回"的情况）。
     * ⚠️ 超时会取消播放（声音停止），而不是仅仅放弃等待 —— 更安全，代价是超长句会被截断，
     * 故各处传入的超时值都比 web 更宽松（20~40s）。
     */
    private suspend fun speak(text: String, speaker: String, timeoutMs: Long): Boolean {
        val t = text.trim()
        if (t.isEmpty()) return false
        val cache = ttsCache ?: return false // 没注入 TTS：静默不朗读
        return withTimeoutOrNull(timeoutMs) { cache.play(t, speaker) } ?: false
    }

    /** 古诗用：去掉标点/空白后的匹配键 */
    private fun normVerse(s: String): String = s.replace(Regex("[^\\u4e00-\\u9fff0-9a-zA-Z]"), "")

    override fun onCleared() {
        speakJob?.cancel()
        hintJob?.cancel()
        searchJob?.cancel()
        evalJob?.cancel()
        BaiduTtsCache.stopAll()
        super.onCleared()
    }

    companion object {
        private const val TAG = "SpeechComposeVM"

        /** 中文默认音色（老师）—— Android 侧既有中文模块的统一取值 */
        const val ZH_SPEAKER = "0"

        /** 古诗朗读音色（度逍遥），对齐 web 的 `POEM_VOICE = "3"` */
        const val POEM_SPEAKER = "3"

        /** 跟读过关线，对齐 web `EchoLadder` 的 `PASS = 70`（**不是**句子练习页的 80） */
        const val PASS_SCORE = 70

        /** 录音太短判定（与 `SentenceReadingViewModel` 保持一致） */
        private const val MIN_AUDIO_BYTES = 6400

        /** 中文评测引擎 */
        private const val ENGINE_ZH = "16k_zh"

        /** 6 秒未作答 → 给下一级提示 */
        private const val SIX_SECONDS = 6_000L
    }
}

/**
 * 页面 UI 状态。
 *
 * [mode] 与各派生属性都放在这里而不是 Screen 里，避免 composable 里重复计算（`AGENTS.md`：
 * 计算逻辑尽量上移到 ViewModel）。
 */
data class SpeechComposeUiState(
    // ── 设置页 ──
    val topic: String = "",
    val wordsText: String = "",
    val sentencesText: String = "",
    /** 要练的文章原文（填了就练文章：按句朗读 + 跟读测评 + 背诵提示） */
    val articleText: String = "",
    val poemText: String = "",
    val poemQuery: String = "",
    val poemHits: List<PoemSearchHit> = emptyList(),
    val poemSearching: Boolean = false,
    /** 已从库里选中古诗的提示文案（"已选《静夜思》 唐·李白"） */
    val poemPicked: String = "",
    /** 库内选中古诗的题目（未选时为空，用来给练习页当标题） */
    val poemTitle: String = "",
    val poemDynasty: String = "",
    val poemAuthor: String = "",
    val settingUp: Boolean = false,
    /** "AI 出题中… Ns" 的秒数 */
    val waitSec: Int = 0,
    val setupError: String = "",

    // ── 模式数据 ──
    val script: TeachScript? = null,
    val poem: PoemScript? = null,
    val article: List<ArticleLine>? = null,

    // ── 词语教学 ──
    val units: List<String> = emptyList(),
    val teachIdx: Int = 0,
    val teachStage: TeachStage = TeachStage.SETUP,
    val answer: String = "",
    val judge: TeachJudgeResult? = null,
    val echoOpen: Boolean = false,
    val echoDone: Boolean = false,
    val hintLvl: Int = 0,
    val hintTip: String = "",
    val covered: Set<String> = emptySet(),

    // ── 古诗 ──
    val poemIdx: Int = 0,
    val poemEvaluated: Set<Int> = emptySet(),
    /** 开场"整篇 + 概括"读完，才出现逐句测评 */
    val poemIntroDone: Boolean = false,
    /** 点到的字：显示「『c』：m」 */
    val charTip: Pair<String, String>? = null,

    // ── 文章 ──
    val artIdx: Int = 0,
    val artEvaluated: Set<Int> = emptySet(),
    /** 当前句领读完成，可以开始跟读测评 */
    val artReady: Boolean = false,
    val shortsLoading: Boolean = false,

    // ── 跟读测评 ──
    /** 待评测的句子；空 = 没有进行中的测评 */
    val echoText: String = "",
    val echoPraise: String = "",
    val recording: Boolean = false,
    val evaluating: Boolean = false,
    val echoScore: Int? = null,
    val echoFeedback: String = "",
    val echoError: String = "",

    // ── 忙碌锁 ──
    /** 有朗读在进行：禁点其它 TTS */
    val ttsBusy: Boolean = false,
) {
    /** 页面模式（判定顺序与 web 分支一致：poem → article → teach → setup） */
    val mode: ComposeMode
        get() = when {
            poem != null -> ComposeMode.POEM
            article != null -> ComposeMode.ARTICLE
            script != null -> ComposeMode.TEACH
            else -> ComposeMode.SETUP
        }

    /** 朗读/评测进行中：禁点 TTS 与跳句 */
    val ttsBlocked: Boolean get() = ttsBusy || recording || evaluating

    val poemTotal: Int get() = poem?.lines?.size ?: 0
    val poemAllDone: Boolean get() = poem != null && poemTotal > 0 && poemIdx >= poemTotal
    val poemLine: PoemLine? get() = poem?.lines?.getOrNull(poemIdx)

    val artTotal: Int get() = article?.size ?: 0
    val artAllDone: Boolean get() = article != null && artTotal > 0 && artIdx >= artTotal
    val currentArticle: ArticleLine? get() = article?.getOrNull(artIdx)

    val teachTotal: Int get() = script?.items?.size ?: 0
    val currentTeachItem: TeachItem? get() = script?.items?.getOrNull(teachIdx)
    val coveredCount: Int get() = units.count { it in covered }
    val missingUnits: List<String> get() = units.filter { it !in covered }

    /** 出现过关后「下一题」按钮的条件（与 web `showNext` 逐字一致） */
    val showNext: Boolean
        get() = judge?.ok == true || echoDone || (judge != null && judge.ok == false && !echoOpen && judge.correct.isEmpty())
}
