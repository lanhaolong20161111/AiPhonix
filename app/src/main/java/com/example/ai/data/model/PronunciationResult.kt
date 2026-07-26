package com.example.ai.data.model

/** 单次发音评测结果 */
data class PronunciationResult(
    val word: Word,
    val totalScore: Int,            // 0-100
    val phonemeScores: List<PhonemeScore>,
    val wordScores: List<WordScore> = emptyList(),  // 逐词得分（句子模式）
    val feedback: String? = null,   // LLM 生成的改进建议
    val accuracyScore: Double = 0.0,
    val fluencyScore: Double = 0.0,     // 流利度
    val integrityScore: Double = 0.0,   // 完整度
    val standardScore: Double = 0.0,
    val isRejected: Boolean = false,
    val exceptInfo: Int = 0,
)

data class PhonemeScore(
    val phoneme: String,            // "/æ/"
    val score: Int,                 // 0-100
    val level: ScoreLevel,
    val dpMessage: Int = 0,         // 0=正常 16=漏读 32=增读
    val serrMsg: Int = 0,           // 0=正确 1=读错
    val syllAccent: Int = 0,        // 0=无需重读 1=需重读
    val gwpp: Double = 0.0,         // 音素后验概率（接近0=清晰）
    val gwppScore: Int = 0,         // gwpp → 0-100 归一化分
)

enum class ScoreLevel { GOOD, OKAY, NEEDS_WORK }

/** 句子模式下的逐词得分 */
data class WordScore(
    val word: String,               // 单词原文
    val pronAccuracy: Float = 0f,   // 发音准确度 0-100
    val matchTag: Int = 0,          // 0=正确 1=漏读 2=增读 3=错读
)
