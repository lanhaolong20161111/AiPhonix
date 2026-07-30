package com.k2fsa.sherpa.onnx.data.entity

/**
 * A hint the system gave during a [WritingSession].
 * Records what was triggered, when, and whether the student responded.
 */
data class HintRecord(
    val id: Long = 0,
    val sessionId: Long,
    val seq: Int,
    val level: Int = 0,
    val trigger: String,
    val text: String,
    val atMs: Long,
    val followedBy: Long? = null,
    val hintSeqInSection: Int = 0,
    val charsAdded: Int? = null,
    val effective: Boolean = false,
)
