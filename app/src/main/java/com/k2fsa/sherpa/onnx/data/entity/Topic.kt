package com.k2fsa.sherpa.onnx.data.entity

/**
 * A writing prompt / topic for dictation.
 */
data class Topic(
    val id: Long = 0,
    val type: String = "TEXT",
    val title: String,
    val content: String,
    val gradeLevel: Int,
    val keywordsJson: String = "[]",
    val structureJson: String? = null,
)
