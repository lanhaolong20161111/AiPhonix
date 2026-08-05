package com.example.ai.data.repository

import com.example.ai.data.model.PronunciationResult

/** Mock LLM — 返回固定模板内容，Phase 2 接入真实 LLM */
class MockLLMRepository() : LLMRepository {

    override suspend fun generateFeedback(result: PronunciationResult): String {
        return "你的 ${result.word.text} 读得很好！得分 ${result.totalScore} 分。${result.word.emoji ?: ""}"
    }

    override suspend fun generateLetterLesson(letter: String): String {
        return "我们来学字母 $letter 啦！它的发音是... 嘴巴这样放..."
    }

    override suspend fun generateLessonPlan(progress: Map<String, Any>): String {
        return "{\"items\":[{\"type\":\"LETTER\",\"title\":\"学字母 a\",\"completed\":false}]}"
    }

    override suspend fun generateQuizItems(subtitleText: String): String {
        return """
[
  {"english": "How do you do?", "chinese": "你好吗？", "difficulty": 1},
  {"english": "I am the King", "chinese": "我是国王", "difficulty": 1},
  {"english": "Good morning", "chinese": "早上好", "difficulty": 1},
  {"english": "Thank you very much", "chinese": "非常感谢", "difficulty": 2},
  {"english": "What is your name?", "chinese": "你叫什么名字？", "difficulty": 2},
  {"english": "Nice to meet you", "chinese": "很高兴认识你", "difficulty": 2},
  {"english": "I would like some water", "chinese": "我想要一些水", "difficulty": 3},
  {"english": "Can you help me please?", "chinese": "你能帮我吗？", "difficulty": 3},
  {"english": "beautiful", "chinese": "美丽的", "difficulty": 2},
  {"english": "wonderful", "chinese": "精彩的", "difficulty": 3}
]
""".trimIndent()
    }

    override suspend fun generateArticleQuestions(articleTitle: String, articleText: String): String {
        return """
[
  {"question": "《$articleTitle》主要讲了什么？", "answer": "围绕文章的标题和主要内容进行概括。"},
  {"question": "你最喜欢文章中的哪个部分？为什么？", "answer": "说出自己的感受并说明理由。"},
  {"question": "读完这篇文章，你学到了什么道理？", "answer": "结合文章主旨谈收获。"}
]
""".trimIndent()
    }
}
