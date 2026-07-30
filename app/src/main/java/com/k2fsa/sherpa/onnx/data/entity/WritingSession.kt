package com.k2fsa.sherpa.onnx.data.entity

/**
 * One complete dictation session — the top-level record.
 */
data class WritingSession(
    val id: Long = 0,
    val topicId: Long,
    val startTime: Long,
    val endTime: Long? = null,
    val hintLevel: Int = 0,
    val finalText: String? = null,
    val audioPath: String? = null,
    val scoreJson: String? = null,
    val formattedText: String? = null,
)
