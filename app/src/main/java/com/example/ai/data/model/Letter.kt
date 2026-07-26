package com.example.ai.data.model

import kotlinx.serialization.Serializable

/** 26 个英文字母的基础数据 */
@Serializable
data class Letter(
    val char: String,           // "a"
    val ipaName: String,        // "/eɪ/"
    val uppercase: String,      // "A"
    val lowercase: String,      // "a"
    val order: Int,             // 1-26
)
