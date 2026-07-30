package com.k2fsa.sherpa.onnx.data.entity

/**
 * Single-row profile tracking the student's long-term hint effectiveness.
 */
data class StudentProfile(
    val id: Int = 1,
    val totalSessions: Int = 0,
    val totalHints: Int = 0,
    val strategySuccesses: String = "{}",
    val strategyAttempts: String = "{}",
    val updatedAt: Long = 0,
)
