package com.example.ai.data.model

import kotlinx.serialization.Serializable

/** 音素（IPA 中的一个音） */
@Serializable
data class Phoneme(
    val symbol: String,         // "/æ/"
    val category: PhonemeCategory,
    val description: String,    // "嘴巴张大，下巴下沉"
    val tonguePosition: String, // "舌尖抵下齿"
    val lipShape: String,       // "嘴唇向两边拉开"
    val commonMistakes: List<String> = emptyList(),
    val exampleWords: List<String> = emptyList(),
    val englishWordIds: List<String> = emptyList(),
)

enum class PhonemeCategory {
    SHORT_VOWEL,    // 短元音
    LONG_VOWEL,     // 长元音
    DIPHTHONG,      // 双元音
    CONSONANT,      // 辅音
    FRICATIVE,      // 摩擦音
    NASAL,          // 鼻音
    PLOSIVE,        // 爆破音
}
