package com.k2fsa.sherpa.onnx.dictation

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.k2fsa.sherpa.onnx.*
import com.k2fsa.sherpa.onnx.agent.LlmProvider
import com.k2fsa.sherpa.onnx.data.AppDatabase
import com.k2fsa.sherpa.onnx.data.entity.HintRecord
import com.k2fsa.sherpa.onnx.data.entity.MIN_SIGNIFICANT_PAUSE_MS
import com.k2fsa.sherpa.onnx.data.entity.SpeechSegment
import com.k2fsa.sherpa.onnx.data.entity.StudentProfile
import com.k2fsa.sherpa.onnx.data.entity.Topic
import com.k2fsa.sherpa.onnx.data.entity.WritingSession
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

class DictationSessionEngine(
    private val context: Context,
    private val recognizer: OnlineRecognizer,
    private val llmProvider: LlmProvider,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Default + SupervisorJob()),
) {
    companion object {
        private const val TAG = "DictationEngine"
        private const val SAMPLE_RATE = 16000
        private const val CHUNK_MS = 100
        private val CHUNK_SAMPLES: Int = (CHUNK_MS * SAMPLE_RATE / 1000).toInt()
    }

    // ---- Scopes ----
    private val mainScope = scope
    private val finalizeScope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // ---- Sub-systems ----
    private val db = AppDatabase.getInstance(context)
    private val recorder = PcmAudioRecorder()
    private val recorderMutex = Mutex()
    private val audioStorage = AudioStorage(context)
    private val stateAnalyzer = ThoughtStateAnalyzer()
    private val hintEngine = HintEngine(llmProvider)
    private val scoringService = ScoringService(llmProvider)

    // ---- Event bus ----
    private val _events = MutableSharedFlow<DictationEvent>(extraBufferCapacity = 64)
    val events: Flow<DictationEvent> = _events.asSharedFlow()

    // ---- Session state ----
    private var sessionJob: Job? = null
    private var sessionId: Long = -1

    @Volatile
    private var isRunning: Boolean = false

    private var lastText: String = ""
    private var segmentSeq: Int = 0
    @Volatile private var forceSectionAdvance: Boolean = false
    @Volatile var asrPaused: Boolean = false
    private var structure: List<StructureGenerator.Section> = emptyList()
    private var currentSectionIndex: Int = 0
    private var asrStream: OnlineStream? = null
    private var sectionText: String = ""
    private var lastSpeechEndMs: Long = -1
    private var sectionStartedAtMs: Long = -1
    private var stuckStartedAtMs: Long? = null
    private var lastEmittedPauseMs: Long = 0
    private var hintSeqInCurrentSection: Int = 0
    private var isProcessingHint: Boolean = false
    private var pendingPauseMs: Long? = null
    private val usedHintTypes = mutableSetOf<String>()

    private val segments = java.util.Collections.synchronizedList(mutableListOf<SpeechSegment>())
    private val hintRecords = java.util.Collections.synchronizedList(mutableListOf<HintRecord>())

    // ---- Public API ----

    fun setStructure(sections: List<StructureGenerator.Section>) {
        structure = sections; currentSectionIndex = 0
    }

    /** Update section labels/guides without resetting current section index. Safe mid-session. */
    fun updateSectionLabels(sections: List<StructureGenerator.Section>) {
        structure = sections
        val s = structure.getOrNull(currentSectionIndex)
        if (s != null) {
            mainScope.launch { _events.emit(DictationEvent.SectionChanged(currentSectionIndex, s.label, s.guide)) }
        }
    }

    fun advanceSection() {
        if (currentSectionIndex >= structure.size - 1) return
        forceSectionAdvance = true
    }

    fun pauseAsr() { asrPaused = true; scope.launch { recorderMutex.withLock { recorder.stop() } } }
    fun resumeAsr() { scope.launch { recorderMutex.withLock { recorder.start() }; asrPaused = false } }

    fun start(topic: Topic, hintLevel: HintLevel) {
        if (isRunning || sessionJob != null) { Log.w(TAG, "already running"); return }
        val session = WritingSession(topicId = topic.id, startTime = System.currentTimeMillis(), hintLevel = hintLevel.value)
        sessionJob = mainScope.launch {
            sessionId = db.writingSessionDao().insert(session)
            Log.i(TAG, "start: sessionId=$sessionId, recorder.init()…")
            if (!recorder.init()) { Log.e(TAG, "start: recorder.init() FAILED"); _events.emit(DictationEvent.Error(RuntimeException("麦克风初始化失败"))); sessionJob = null; return@launch }
            Log.i(TAG, "start: recorder.init() OK, audioStorage.start()…")
            audioStorage.start(sessionId)
            val createdStream = recognizer.createStream()
            if (createdStream == null) { Log.e(TAG, "createStream() returned null"); _events.emit(DictationEvent.Error(RuntimeException("ASR 流创建失败"))); recorder.release(); sessionJob = null; isRunning = false; return@launch }
            asrStream = createdStream
            val stream = createdStream
            try {
                recorder.start(); isRunning = true; stateAnalyzer.reset()
                Log.i(TAG, "start: recorder started, entering main loop")
                lastText = ""; segmentSeq = 0; segments.clear(); hintRecords.clear()
                if (structure.isNotEmpty()) {
                    _events.emit(DictationEvent.StructureLoaded(structure))
                    _events.emit(DictationEvent.SectionChanged(0, structure[0].label, structure[0].guide))
                    sectionStartedAtMs = SystemClock.elapsedRealtime()
                    stuckStartedAtMs = null
                }
                val buffer = ShortArray(CHUNK_SAMPLES)
                var byteCount0 = 0L
                while (isActive && isRunning) {
                    // section advance handler — check BEFORE asrPaused so pause doesn't block switching
                    if (forceSectionAdvance && currentSectionIndex < structure.size - 1) {
                        forceSectionAdvance = false
                        // 1. Pause ASR so no new audio comes in during the switch
                        asrPaused = true
                        recorderMutex.withLock { recorder.stop() }
                        // 2. Notify UI to show "记录上一段内容" overlay
                        _events.emit(DictationEvent.SectionAdvancing)
                        // 3. Wait 500ms for any in-flight audio and ASR pipeline to drain
                        delay(500)
                        // 4. Capture any pending text from the recognizer
                        val t = SystemClock.elapsedRealtime()
                        val pendingText = recognizer.getResult(stream).text
                        if (pendingText.isNotBlank()) {
                            val sigPause = pendingPauseMs ?: run {
                                val d = if (lastSpeechEndMs >= 0) t - lastSpeechEndMs else null
                                if (d != null && d >= MIN_SIGNIFICANT_PAUSE_MS) d else null
                            }
                            pendingPauseMs = null
                            val seg = SpeechSegment(sessionId = sessionId, seq = segmentSeq, text = pendingText,
                                startMs = t, endMs = t, confidence = 1.0f,
                                audioOffset = audioStorage.currentOffset(), sectionIndex = currentSectionIndex, precedingPauseMs = sigPause)
                            segments.add(seg); db.speechSegmentDao().insert(seg)
                            _events.emit(DictationEvent.SegmentEnd(pendingText, segmentSeq, t)); segmentSeq++
                            lastText = if (lastText.isBlank()) pendingText else "$lastText\n$pendingText"
                            sectionText = if (sectionText.isBlank()) pendingText else "$sectionText\n$pendingText"
                            lastSpeechEndMs = t
                        }
                        // 5. Fully reset ASR state for the new section
                        recognizer.reset(stream)
                        lastText = ""; currentSectionIndex++; sectionText = ""; hintSeqInCurrentSection = 0
                        sectionStartedAtMs = SystemClock.elapsedRealtime(); stuckStartedAtMs = null
                        val s = structure[currentSectionIndex]
                        // 6. Notify UI to hide overlay and show new section
                        _events.emit(DictationEvent.SectionChanged(currentSectionIndex, s.label, s.guide))
                        // 7. Resume ASR for the new section
                        recorderMutex.withLock { recorder.start() }
                        asrPaused = false
                        continue
                    }
                    if (asrPaused) { delay(CHUNK_MS.toLong()); continue }
                    val readCount = recorder.read(buffer)
                    if (readCount <= 0) { delay(CHUNK_MS.toLong()); continue }
                    if (byteCount0 == 0L) { byteCount0 = audioStorage.currentOffset(); Log.i(TAG, "first PCM write at offset=$byteCount0, readCount=$readCount") }
                    val nowMs = SystemClock.elapsedRealtime()
                    audioStorage.writePcm(buffer, readCount)
                    val samples = FloatArray(readCount) { buffer[it] / 32768.0f }
                    stream.acceptWaveform(samples, SAMPLE_RATE)
                    while (recognizer.isReady(stream)) recognizer.decode(stream)
                    val isEndpoint = recognizer.isEndpoint(stream)
                    var text = recognizer.getResult(stream).text
                    if (isEndpoint) {
                        recognizer.reset(stream)
                        if (text.isNotBlank()) {
                            val sigPause = pendingPauseMs ?: run {
                                val d = if (lastSpeechEndMs >= 0) nowMs - lastSpeechEndMs else null
                                if (d != null && d >= MIN_SIGNIFICANT_PAUSE_MS) d else null
                            }
                            pendingPauseMs = null
                            val seg = SpeechSegment(sessionId = sessionId, seq = segmentSeq, text = text,
                                startMs = nowMs, endMs = nowMs, confidence = 1.0f,
                                audioOffset = audioStorage.currentOffset(), sectionIndex = currentSectionIndex, precedingPauseMs = sigPause)
                            segments.add(seg); db.speechSegmentDao().insert(seg); lastSpeechEndMs = nowMs
                            _events.emit(DictationEvent.SegmentEnd(text, segmentSeq, nowMs)); segmentSeq++
                            lastText = if (lastText.isBlank()) text else "$lastText\n$text"
                            sectionText = if (sectionText.isBlank()) text else "$sectionText\n$text"
                            stateAnalyzer.onSegmentEnd(nowMs); resetHintState()
                        }
                    } else if (text != lastText && text.isNotBlank()) {
                        if (lastSpeechEndMs >= 0) {
                            val pauseSinceLast = nowMs - lastSpeechEndMs
                            if (pauseSinceLast >= MIN_SIGNIFICANT_PAUSE_MS && pendingPauseMs == null) pendingPauseMs = pauseSinceLast
                            lastSpeechEndMs = nowMs
                        }
                        if (lastEmittedPauseMs > 0) { _events.emit(DictationEvent.PauseChanged(0)); lastEmittedPauseMs = 0 }
                        _events.emit(DictationEvent.TextDelta(text))
                        stateAnalyzer.onTextReceived(nowMs); resetHintState()
                    }
                    val state = stateAnalyzer.update(nowMs)
                    if (state == ThoughtState.STUCK && stuckStartedAtMs == null) {
                        stuckStartedAtMs = nowMs
                    } else if (state != ThoughtState.STUCK && stuckStartedAtMs != null) {
                        stuckStartedAtMs = null
                    }
                    _events.emit(DictationEvent.StateChange(state))
                    if (state != ThoughtState.NORMAL && lastSpeechEndMs >= 0) {
                        val silenceMs = nowMs - lastSpeechEndMs
                        if (silenceMs >= MIN_SIGNIFICANT_PAUSE_MS && silenceMs != lastEmittedPauseMs) {
                            _events.emit(DictationEvent.PauseChanged(silenceMs)); lastEmittedPauseMs = silenceMs
                        }
                    }
                }
            } catch (e: CancellationException) { Log.i(TAG, "cancelled")
            } catch (e: Exception) { Log.e(TAG, "loop error", e); _events.emit(DictationEvent.Error(e))
            } finally { recorderMutex.withLock { recorder.stop(); recorder.release() } }
        }
    }

    fun stop() {
        if (!isRunning && sessionJob == null) return
        isRunning = false
        // Must wait for sessionJob to finish releasing stream/recorder before finalize touches them
        val jobToJoin = sessionJob
        sessionJob = null
        finalizeJob = finalizeScope.launch {
            // Wait for the main loop to finish (recorder stopped in finally)
            // Stream is NOT released in finally so we can still read final results here
            try { if (jobToJoin != null) jobToJoin.cancelAndJoin() } catch (e: Exception) { Log.w(TAG, "join sessionJob", e) }
            // Now the main loop has stopped — safe to read final results from the stream
            val stream = asrStream
            if (stream != null) {
                try {
                    val pendingText = recognizer.getResult(stream).text
                    if (pendingText.isNotBlank() && pendingText != lastText) {
                        val nowMs = SystemClock.elapsedRealtime()
                        val sigPause = pendingPauseMs ?: run {
                            val d = if (lastSpeechEndMs >= 0) nowMs - lastSpeechEndMs else null
                            if (d != null && d >= MIN_SIGNIFICANT_PAUSE_MS) d else null
                        }
                        pendingPauseMs = null
                        val seg = SpeechSegment(sessionId = sessionId, seq = segmentSeq, text = pendingText,
                            startMs = nowMs, endMs = nowMs, confidence = 1.0f,
                            audioOffset = audioStorage.currentOffset(), sectionIndex = currentSectionIndex, precedingPauseMs = sigPause)
                        segments.add(seg); segmentSeq++; lastSpeechEndMs = nowMs
                        db.speechSegmentDao().insert(seg)
                        _events.emit(DictationEvent.SegmentEnd(pendingText, segmentSeq - 1, nowMs))
                    }
                } catch (e: Exception) { Log.w(TAG, "pending capture fail", e) }
            }
            // Release the ASR stream now that we've captured final results
            try { asrStream?.release() } catch (e: Exception) { Log.w(TAG, "stream release", e) }
            asrStream = null
            // Finalize
            try {
                val audioPath = audioStorage.finalise(sessionId)
                if (audioPath == null) Log.e(TAG, "stop: finalise returned null — WAV not created")
                val capturedSegments = segments.toList(); val capturedHints = hintRecords.toList()
                val sectionTexts = structure.mapIndexed { i, sec ->
                    TextFormatter.SectionText(sec.label, sec.guide, capturedSegments.filter { it.sectionIndex == i }.joinToString("\n") { it.text })
                }
                val finalText = capturedSegments.joinToString("\n") { it.text }
                val session = db.writingSessionDao().getById(sessionId)
                if (session != null) db.writingSessionDao().update(session.copy(endTime = System.currentTimeMillis(), finalText = finalText, audioPath = audioPath))
                val topic = db.topicDao().getById(session?.topicId ?: 0)
                if (topic != null && finalText.isNotBlank()) {
                    scoringService.score(topic, finalText, capturedSegments, capturedHints, structure, sectionTexts,
                        onFeedback = { feedback -> finalizeScope.launch { val s = db.writingSessionDao().getById(sessionId); if (s != null) db.writingSessionDao().update(s.copy(scoreJson = feedback)) } })
                    val formatter = TextFormatter(llmProvider)
                    formatter.format(sectionTexts) { formatted -> finalizeScope.launch { val s = db.writingSessionDao().getById(sessionId); if (s != null) db.writingSessionDao().update(s.copy(formattedText = formatted)); updateProfile(capturedHints); _events.emit(DictationEvent.Finished(sessionId)) } }
                } else { updateProfile(capturedHints); _events.emit(DictationEvent.Finished(sessionId)) }
            } catch (e: Exception) { Log.e(TAG, "finalise error", e); _events.emit(DictationEvent.Error(e)) }
        }
    }

    private var finalizeJob: Job? = null

    fun isActive(): Boolean = isRunning
    fun destroy() {
        stop()
        // Wait for finalize to complete before cancelling scopes — prevents use-after-free
        // of native recognizer handle during finalize.
        finalizeJob?.let { runBlocking { try { it.join() } catch (e: Exception) { Log.w(TAG, "finalize join", e) } } }
        finalizeScope.cancel()
        mainScope.cancel()
    }

    // ---- Hint ----

    private fun resetHintState() { hintSeqInCurrentSection = 0 }

    fun requestHint(reason: String, topic: Topic) {
        if (!isRunning || isProcessingHint) return
        if (reason in usedHintTypes) {
            mainScope.launch { _events.emit(DictationEvent.HintDone("请你按照提示先说一说好吗？", reason)) }
            return
        }
        if (hintSeqInCurrentSection >= 5) { mainScope.launch { _events.emit(DictationEvent.HintDone("你已经很努力了！要不要先跳到下一段，或者休息一下再继续？", "建议休息")) }; return }
        isProcessingHint = true
        val nowMs = SystemClock.elapsedRealtime()
        mainScope.launch { _events.emit(DictationEvent.HintIncoming(reason)) }
        val stuckMs = stuckStartedAtMs?.let { nowMs - it } ?: 0L
        hintEngine.requestHint(
            topicTitle = topic.title,
            topicContent = topic.content,
            sectionInfo = buildSectionInfo(),
            studentSpokenText = buildHintContext(),
            stuckDurationMs = stuckMs,
            hintType = reason,
            onDelta = { delta -> mainScope.launch { _events.emit(DictationEvent.HintDelta(delta)) } },
            onDone = { fullText ->
                isProcessingHint = false
                usedHintTypes.add(reason)
                mainScope.launch {
                    val record = HintRecord(sessionId = sessionId, seq = hintRecords.size, level = 0, trigger = reason,
                        text = fullText, atMs = nowMs, followedBy = null, hintSeqInSection = hintSeqInCurrentSection)
                    hintRecords.add(record); hintSeqInCurrentSection++; db.hintRecordDao().insert(record)
                    _events.emit(DictationEvent.HintDone(fullText, reason))
                }
            },
            onError = { e -> isProcessingHint = false; mainScope.launch { _events.emit(DictationEvent.Error(e)) } })
    }

    private fun buildSectionInfo(): String {
        val s = structure.getOrNull(currentSectionIndex)
        val prefix = when (currentSectionIndex) { 0 -> "①"; 1 -> "②"; 2 -> "③"; 3 -> "④"; 4 -> "⑤"; else -> "${currentSectionIndex + 1}" }
        return if (s != null) "${prefix}${s.label} — ${s.guide}" else "(未初始化)"
    }

    private suspend fun updateProfile(hints: List<HintRecord>) {
        val existing = db.studentProfileDao().get()
        db.studentProfileDao().upsert(StudentProfile(totalSessions = (existing?.totalSessions ?: 0) + 1, totalHints = (existing?.totalHints ?: 0) + hints.size,
            strategySuccesses = existing?.strategySuccesses ?: "{}", strategyAttempts = existing?.strategyAttempts ?: "{}", updatedAt = System.currentTimeMillis()))
    }

    private fun buildHintContext(): String {
        val speech = sectionText.ifBlank { "（还没开始）" }
        return "学生已说：$speech"
    }
}
