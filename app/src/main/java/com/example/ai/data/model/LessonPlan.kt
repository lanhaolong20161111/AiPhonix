package com.example.ai.data.model

/** 每日学习计划 */
data class LessonPlan(
    val date: String,
    val items: List<LessonItem>,
)

data class LessonItem(
    val type: LessonType,
    val title: String,
    val description: String,
    val completed: Boolean = false,
)

enum class LessonType { LETTER, PHONICS, PRONUNCIATION }
