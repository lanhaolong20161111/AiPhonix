package com.example.ai.data.quiz

import kotlinx.serialization.Serializable

/**
 * 考试题目 — 由 LLM 从字幕中提取的中英文对照对。
 * @param english 英文原文（单词/短语/短句）
 * @param chinese 中文翻译
 * @param difficulty 难度 1-5
 * @param display 带空格的显示文本（如 "nice to ___ you"），null=逐词填写模式
 * @param blankAnswer 填空答案（仅填空模式需要）
 */
@Serializable
data class QuizItem(
    val english: String,
    val chinese: String,
    val difficulty: Int = 1,
    val display: String? = null,
    val blankAnswer: String? = null,
)

/** 一个视频对应的完整题库 */
@Serializable
data class QuizBank(
    val videoName: String,
    val items: List<QuizItem>,
)
