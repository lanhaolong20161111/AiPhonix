package com.example.ai

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

@Serializable data object Home : NavKey          // 首页
@Serializable data object EnglishLearning : NavKey // 英语学习主页
@Serializable data class Letter(val char: String = "a") : NavKey  // 字母学习
@Serializable data object Phonics : NavKey        // 自然拼读
@Serializable data object PhonemeIndex : NavKey    // 音标总表
@Serializable data class Practice(val wordId: String) : NavKey    // 跟读录音
@Serializable data class Result(val wordId: String) : NavKey     // 纠音结果
@Serializable data object Report : NavKey          // 学习报告
@Serializable data object VideoPractice : NavKey // 视频跟读
@Serializable data class Quiz(val videoName: String, val srtPath: String) : NavKey // 视频考试

// 语文练习模块
@Serializable data object ChinesePractice : NavKey                // 语文练习主页
@Serializable data object Recognition : NavKey                    // 认字
@Serializable data object Dictation : NavKey                      // 默写
@Serializable data object WordPractice : NavKey                   // 词语
