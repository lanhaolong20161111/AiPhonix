package com.example.ai.data.repository

import com.example.ai.data.model.PronunciationResult

/** LLM 内容生成 Repository — 接口，provider 待定 */
interface LLMRepository {
    /** 根据评测结果生成儿童友好的改进建议 */
    suspend fun generateFeedback(result: PronunciationResult): String
    /** 生成字母教学讲解（发音/口型/常见错误） */
    suspend fun generateLetterLesson(letter: String): String
    /** 生成每日学习计划 */
    suspend fun generateLessonPlan(progress: Map<String, Any>): String
    /** 根据字幕内容生成考试题目（中英文对照），返回 JSON 字符串 */
    suspend fun generateQuizItems(subtitleText: String): String

    /** 根据文章内容生成阅读理解问答题（带参考答案），返回 JSON 数组字符串 [{question, answer}] */
    suspend fun generateArticleQuestions(articleTitle: String, articleText: String): String
}
