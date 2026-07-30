package com.k2fsa.sherpa.onnx.dictation

/**
 * The student's current thought state as determined by [ThoughtStateAnalyzer].
 */
enum class ThoughtState {
    /** Student is speaking normally; keep recording. */
    NORMAL,

    /** Short pause (3-10s), likely organising thoughts; wait silently. */
    THINKING,

    /** Prolonged silence (≥10s by default); the student is stuck. */
    STUCK,
}
