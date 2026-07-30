package com.k2fsa.sherpa.onnx.dictation

/**
 * Events emitted by [DictationSessionEngine] for the UI to observe.
 *
 * Key design rule: **hint text only appears in [HintDelta]/[HintDone] events,
 * never in [TextDelta] or [SegmentEnd].** This enforces "hint in bubble,
 * not in essay" — the product's core safety constraint.
 */
sealed class DictationEvent {
    /** Incremental ASR text (student's speech only). */
    data class TextDelta(val text: String) : DictationEvent()

    /** An endpoint was reached; this segment is final. */
    data class SegmentEnd(val text: String, val seq: Int, val timestampMs: Long) : DictationEvent()

    /** Thought state changed. UI may show subtle visual feedback. */
    data class StateChange(val state: ThoughtState) : DictationEvent()

    /** A hint is about to arrive (show loading indicator). */
    data class HintIncoming(val label: String) : DictationEvent()

    /** Streaming delta of hint text (show word-by-word in bubble). */
    data class HintDelta(val text: String) : DictationEvent()

    /** Hint complete with full text. */
    data class HintDone(val text: String, val label: String) : DictationEvent()

    /** Structure template loaded (shows paragraph outline). */
    data class StructureLoaded(val sections: List<StructureGenerator.Section>) : DictationEvent()

    /** Engine is about to switch sections — ASR paused to flush state. */
    data object SectionAdvancing : DictationEvent()

    /** Student advanced to the next paragraph section. */
    data class SectionChanged(val index: Int, val label: String, val guide: String) : DictationEvent()

    /** Student paused or resumed. durationMs = current silence duration (0 = resumed). */
    data class PauseChanged(val durationMs: Long) : DictationEvent()

    /** Session finished; sessionId links to the persisted [WritingSession]. */
    data class Finished(val sessionId: Long) : DictationEvent()

    /** Non-fatal error; the session can continue. */
    data class Error(val throwable: Throwable) : DictationEvent()
}
