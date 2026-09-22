package com.example.ai.ui.englishtalk

import com.example.ai.data.asr.StreamingAsrClient
import com.example.ai.data.audio.StreamingPcmRecorder
import com.example.ai.util.collapseJsWhitespace
import com.example.ai.util.jsTrim
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers

/**
 * 英语对话单轮录音 hook — web `hooks/useEnglishTurn.ts` 的逐位移植。
 *
 * 长按 ASR（百度实时，经 Worker 中转 WS），停顿上报给页面做逐词提示。
 * 与 web 一样支持 pause()/resume()：评词前 pause 释放麦克风（保留已说文本），
 * 过关后 resume 继续收话；stop() = 本轮结束取整句（返回并清空已说文本）。
 *
 * 状态机口径（全部对齐 web，见 [PauseWatch]）：
 * - 「在说话」= 麦克风能量 ≥ [ENERGY_TH] **或** ASR 出字（MID/FIN_TEXT）；
 * - 停顿 pauseMs 无任何活动 → [onPause](saidSoFar)（不重复触发）；
 * - 开始后完全没出过声超 initialSilenceMs → [onInitialSilence]（每轮一次；resume 续说不复位）。
 *
 * ⚠️ 线程模型：WS 回调在 OkHttp 线程、PCM 回调在音频线程 —— 只写 @Volatile 的时间戳/标志，
 * 状态经 [MutableStateFlow]（线程安全）发布；onPause/onInitialSilence 在 [scope] 上触发。
 * 本类**不持 Context**。
 */
class EnglishTurnAsr(
    private val scope: CoroutineScope,
    /** ASR 语言：zh=dev_pid 15372、en=17372；决定 /asr/stream?lang= 参数 */
    private val lang: String = "en",
    /** ASR 停顿 N ms 无新句 → onPause（页面据此提示下一个词） */
    private val pauseMs: Long = 2_000,
    /** 开始后完全没出过声的首静默超时；到点提示一次第一个词（每轮一次）。0 = 关闭 */
    private val initialSilenceMs: Long = 0,
    /** 停顿回调（说过话后静音达标；saidSoFar = 已说文本快照） */
    private val onPause: (saidSoFar: String) -> Unit,
    /** 首静默回调（开始后一直没出过声） */
    private val onInitialSilence: (saidSoFar: String) -> Unit,
    private val client: StreamingAsrClient = StreamingAsrClient(lang = lang),
    private val recorder: StreamingPcmRecorder = StreamingPcmRecorder(),
    /** 时钟（可注入以便单测静音判定） */
    private val now: () -> Long = System::currentTimeMillis,
) {

    data class TurnState(
        val recording: Boolean = false,
        /** 已说文本（FIN_TEXT 累积） */
        val saidText: String = "",
        /** 实时临时文本（MID_TEXT） */
        val interimText: String = "",
        /** 音量等级 0-1（电平条） */
        val level: Float = 0f,
        /** 可直接展示的错误（语音服务鉴权失败 / 连接失败 / 麦克风启动失败） */
        val error: String = "",
    )

    private val _state = MutableStateFlow(TurnState())
    val state: StateFlow<TurnState> = _state.asStateFlow()

    // ── 可变字段（多线程可见性靠 @Volatile；语义与 web 的 ref 一致） ──

    @Volatile
    private var saidText: String = ""

    /** 本轮从开始到现在的全部 PCM（跨暂停/恢复拼接；web pcmAccum。页面暂未消费，保留字段口径） */
    @Volatile
    private var pcmAccum: ByteArray = ByteArray(0)

    private val watch = PauseWatch(pauseMs, initialSilenceMs, now)

    /** 300ms 轮询 job（录音期间在跑；pause 时清掉） */
    private var checkJob: Job? = null

    // ══════════════════════════════════════════════════════════════
    // 对外生命周期：start / pause / resume / stop
    // ══════════════════════════════════════════════════════════════

    /** 开始新一轮（清空已说）。`true` = 录音已起 */
    suspend fun start(): Boolean = open(keepText = false)

    /**
     * 暂停 ASR（评词/提示/点读前），释放麦克风但**保留已说文本**。
     * 发 FINISH 后等百度回完该句 FIN_TEXT 再关连接（最长 1.5s）——
     * 单词/短句的结果只在 FINISH 后才回，固定等 300ms 常掐掉尾部结果（web `waitFinalText` 同坑）。
     */
    suspend fun pause() {
        checkJob?.cancel()
        checkJob = null
        withContext(Dispatchers.IO) {
            client.sendFinish()
            client.awaitFinalText(timeoutMs = 1_500)
            client.close()
            try {
                if (recorder.isRecording) pcmAccum += recorder.stop()
            } catch (_: Exception) {
            }
        }
        _state.value = _state.value.copy(recording = false, level = 0f)
    }

    /** 恢复 ASR（保留已说文本续说）。`true` = 已恢复 */
    suspend fun resume(): Boolean = open(keepText = true)

    /** 本轮结束：取整句并清空（内部先 pause） */
    suspend fun stop(): String {
        pause()
        val said = saidText.trim()
        saidText = ""
        _state.value = _state.value.copy(saidText = "")
        return said
    }

    /** 卸载释放（ViewModel.onCleared 调） */
    fun destroy() {
        checkJob?.cancel()
        checkJob = null
        client.cancel()
        recorder.destroy()
    }

    // ══════════════════════════════════════════════════════════════
    // 内部
    // ══════════════════════════════════════════════════════════════

    /** 真正开录音+WS 的内部实现。keepText=true 时不清 saidText（resume 续说）。 */
    private suspend fun open(keepText: Boolean): Boolean {
        // 先清掉上一段可能残留的连接/录音（web open 开头同款清扫）
        checkJob?.cancel()
        checkJob = null
        client.cancel()
        try { recorder.stop() } catch (_: Exception) {}
        if (!keepText) {
            saidText = ""
            pcmAccum = ByteArray(0)
            watch.resetRound()
            _state.value = TurnState()
        }
        watch.onOpened()

        client.connect(listener)
        val ok = client.awaitOpen()
        if (!ok) {
            _state.value = _state.value.copy(error = "语音连接失败，请检查网络")
            return false
        }

        try {
            recorder.start(recorderCallbacks)
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = "麦克风启动失败：${e.message ?: e}")
            return false
        }
        client.sendStart(cuid = "talk-${now()}")
        _state.value = _state.value.copy(recording = true, error = "")
        armPauseCheck()
        return true
    }

    private val listener = object : StreamingAsrClient.Listener {
        override fun onMidText(result: String) {
            // ASR 正在出字 = 孩子在说话：重置静音计时，绝不中途弹提示
            watch.onAsrText()
            _state.value = _state.value.copy(interimText = cleanAsrText(result))
        }

        override fun onFinText(errNo: Int, result: String) {
            if (errNo != 0) {
                if (errNo == -3004) {
                    _state.value = _state.value.copy(error = "语音服务鉴权失败，请稍后重试")
                }
                return
            }
            val t = cleanAsrText(result)
            if (t.isEmpty()) return
            watch.onAsrText()
            saidText = appendSaid(saidText, t, lang)
            _state.value = _state.value.copy(saidText = saidText, interimText = "")
        }

        override fun onUpstreamClosed() {
            // 百度侧关了：本轮就此打住（web 只在 waitFinalText 里消费 CLOSED，这里同样不弹错）
        }

        override fun onTransportError(message: String) {
            // 录音中连接挂了才需要报错；暂停/关闭过程中的失败静默（web 同口径）
            if (_state.value.recording) {
                _state.value = _state.value.copy(recording = false, error = message.ifBlank { "语音连接失败，请检查网络" })
            }
        }
    }

    private val recorderCallbacks = object : StreamingPcmRecorder.Callbacks {
        override fun onPcmChunk(chunk: ByteArray) {
            client.sendPcm(chunk)
        }

        override fun onLevel(level: Float) {
            _state.value = _state.value.copy(level = level)
            if (level >= ENERGY_TH) watch.onVoice()
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 能量/ASR 静音轮询（300ms）— web armPauseCheck 的移植
    // ══════════════════════════════════════════════════════════════

    private fun armPauseCheck() {
        if (checkJob?.isActive == true) return
        checkJob = scope.launch {
            while (isActive) {
                delay(300)
                when (watch.tick()) {
                    PauseWatch.Tick.INITIAL -> onInitialSilence(saidText)
                    PauseWatch.Tick.PAUSE -> onPause(saidText)
                    PauseWatch.Tick.NONE -> Unit
                }
                if (_state.value.recording.not()) break
            }
        }
    }

    companion object {
        /** 能量「在说话」阈值（web ENERGY_TH = 0.02，基于 energyLevel 的 0-1 刻度） */
        const val ENERGY_TH = 0.02f
    }
}

// ══════════════════════════════════════════════════════════════════
// 纯函数（可单测，期望值取自 web 真实现探针）
// ══════════════════════════════════════════════════════════════════

/**
 * 清洗 ASR 片段 — web `cleanAsrText` 的逐位移植：
 * 去掉「后跟空白/句尾」的句子标点（.?!。？！；话没说完不显示句号），多余空白折叠。
 * ⚠️ 词中标点（`a,b.c!d?e`）**原样保留**——正则要求标点后必须是空白或句尾。
 * 整句结束时由调用方统一补一个句点。
 */
fun cleanAsrText(t: String): String {
    val noPunct = PUNCT_TAIL_RE.replace(t, " ")
    return jsTrim(collapseJsWhitespace(noPunct))
}

private val PUNCT_TAIL_RE = Regex("[.,!?。？！]+(?:[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+|$)")

/**
 * FIN_TEXT 追加进已说文本 — web `useEnglishTurn` onmessage FIN 分支的拼接口径：
 * 中文不插空格；英文在 prev 非空且不以空格结尾时插一个空格；
 * **百度重复回同一段时直接跳过**（`prev.endsWith(t)`），避免整句被翻倍。
 */
fun appendSaid(prev: String, t: String, lang: String): String {
    if (prev.isEmpty()) return t
    if (prev.endsWith(t)) return prev
    val sep = if (lang == "zh") "" else if (prev.endsWith(" ")) "" else " "
    return prev + sep + t
}

/**
 * 静音判定器 — web `useEnglishTurn` 里那组 ref（lastVoiceTs/lastAsrTs/hadVoice/
 * hintFired/initialHintFired/startedAt）+ 300ms tick 的独立化（时钟可注入，可单测）。
 *
 * 口径（逐位对齐 web）：
 * - [onOpened]：三个时间戳全重置为当前，hadVoice=false、hintFired=false；
 *   **resetRound=false 时 initialHintFired 保留**（resume 续说不再触发首静默提示）。
 * - [onVoice] / [onAsrText]：刷新对应时间戳、hadVoice=true、**hintFired=false**
 *   （一说话就重新允许停顿提示）。
 * - [tick]：①首静默（没出过声 + 未触发过 + 超时）→ INITIAL；
 *   ②停顿（出过声 + 未触发 + 距最近活动 ≥ pauseMs）→ PAUSE。
 */
internal class PauseWatch(
    private val pauseMs: Long,
    private val initialSilenceMs: Long,
    private val now: () -> Long,
) {
    enum class Tick { NONE, INITIAL, PAUSE }

    @Volatile private var lastVoiceTs: Long = 0
    @Volatile private var lastAsrTs: Long = 0
    @Volatile private var startedAt: Long = 0
    @Volatile private var hadVoice: Boolean = false
    @Volatile private var hintFired: Boolean = false
    @Volatile private var initialHintFired: Boolean = false

    /** 新一轮 start()（允许再次触发首静默提示） */
    fun resetRound() {
        initialHintFired = false
    }

    /** open()：时间戳与「出过声」复位；initialHintFired 只在新一轮清 */
    fun onOpened() {
        val t = now()
        lastVoiceTs = t
        lastAsrTs = t
        startedAt = t
        hadVoice = false
        hintFired = false
    }

    fun onVoice() {
        lastVoiceTs = now()
        hadVoice = true
        hintFired = false
    }

    fun onAsrText() {
        lastAsrTs = now()
        hadVoice = true
        hintFired = false
    }

    fun tick(): Tick {
        val t = now()
        if (initialSilenceMs > 0 && !hadVoice && !initialHintFired && t - startedAt >= initialSilenceMs) {
            initialHintFired = true
            hintFired = true
            return Tick.INITIAL
        }
        // 只要还有任何说话活动（能量出声 或 ASR 出字）就重置计时；
        // 连续静音真正达到 pauseMs 才提示下一个词
        val lastAct = maxOf(lastVoiceTs, lastAsrTs)
        return if (hadVoice && !hintFired && t - lastAct >= pauseMs) {
            hintFired = true
            Tick.PAUSE
        } else {
            Tick.NONE
        }
    }
}
