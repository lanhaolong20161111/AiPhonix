package com.k2fsa.sherpa.onnx.dictation

import android.util.Log

/**
 * Pure-local, rule-based thought-state analyser.
 *
 * Determines whether the student is speaking normally, thinking, or stuck
 * based solely on silence duration and (in later phases) text similarity.
 * Deliberately avoids real-time LLM intervention — this keeps latency low
 * and avoids the model "jumping in" too eagerly.
 *
 * MVP: NORMAL / THINKING / STUCK only (silence-based).
 */
class ThoughtStateAnalyzer(
    private val thinkingThresholdMs: Long = 3_000,   // 3 s → THINKING
    private val stuckThresholdMs: Long = 10_000,      // 10 s → STUCK
) {
    companion object {
        private const val TAG = "ThoughtStateAnalyzer"
    }

    private var lastTextTimestampMs: Long = -1
    private var currentState: ThoughtState = ThoughtState.NORMAL

    val state: ThoughtState get() = currentState

    /**
     * Call every cycle (100 ms) with the current time.
     * Also call [onTextReceived] whenever new recognised text arrives.
     */
    fun update(currentTimeMs: Long): ThoughtState {
        if (lastTextTimestampMs < 0) {
            // No text yet — still initialising
            currentState = ThoughtState.NORMAL
            return currentState
        }

        val silenceMs = currentTimeMs - lastTextTimestampMs

        currentState = when {
            silenceMs >= stuckThresholdMs -> ThoughtState.STUCK
            silenceMs >= thinkingThresholdMs -> ThoughtState.THINKING
            else -> ThoughtState.NORMAL
        }

        return currentState
    }

    /** Call whenever incremental text is received from ASR. */
    fun onTextReceived(timestampMs: Long) {
        lastTextTimestampMs = timestampMs
        // Any new text resets NORMAL immediately
        currentState = ThoughtState.NORMAL
    }

    /** Call when a segment ends (endpoint detected). */
    fun onSegmentEnd(timestampMs: Long) {
        lastTextTimestampMs = timestampMs
    }

    /** Reset for a new session. */
    fun reset() {
        lastTextTimestampMs = -1
        currentState = ThoughtState.NORMAL
    }
}
