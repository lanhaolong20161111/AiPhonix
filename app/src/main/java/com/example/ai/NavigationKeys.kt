package com.example.ai

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

@Serializable data object Home : NavKey          // 首页
@Serializable data object EnglishLearning : NavKey // 英语学习主页
@Serializable data object LetterIndex : NavKey    // 字母网格索引
@Serializable data class Letter(val char: String = "a") : NavKey  // 字母学习
@Serializable data class Phonics(val phonemeIndex: Int) : NavKey        // 自然拼读
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

// 看图识字
@Serializable data object CharImageRecognition : NavKey              // 看图识字主页（年级选择）
@Serializable data class CharImageGradeSelection(
    val grade: String,
    val semester: String,
) : NavKey                                                           // 年级内类型选择（识字表/写字表/词语表）
@Serializable data class CharImageList(
    val grade: String,
    val semester: String,
    val type_: String = "",                                           // "认" / "写" / "词"
) : NavKey                                                           // 图片列表（过滤后）
