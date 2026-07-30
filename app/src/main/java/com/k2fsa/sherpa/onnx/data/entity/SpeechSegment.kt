package com.k2fsa.sherpa.onnx.data.entity

/** Minimum pause (ms) recorded as significant. */
const val MIN_SIGNIFICANT_PAUSE_MS = 2_000L

/**
 * One recognised speech segment within a [WritingSession].
 */
data class SpeechSegment(
    val id: Long = 0,
    val sessionId: Long,
    val seq: Int,
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val confidence: Float,
    val audioOffset: Long,
    val sectionIndex: Int = 0,
    val precedingPauseMs: Long? = null,
)
