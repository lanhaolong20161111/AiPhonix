package com.example.ai.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** 练习用单词 */
@Serializable
data class Word(
    val text: String,           // "apple"
    val ipa: String,            // "/ˈæp.əl/"
    val letter: String,         // 首字母 "a"
    val phonemes: List<String>, // ["æ", "p", "əl"]
    val emoji: String? = null,  // "🍎"
    val translation: String? = null, // "苹果"
    val difficulty: Int = 1,    // 1-5
    @SerialName("ipa_uk")
    val ipaUk: String = "",     // UK IPA, e.g. "/gəʊt/"
    @SerialName("phonemes_uk")
    val phonemesUk: List<String> = emptyList(), // UK phoneme split
)
