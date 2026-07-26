package com.example.ai.data.repository

import com.example.ai.data.model.PronunciationResult
import com.example.ai.data.model.Word
import java.io.InputStream

/**
 * 语音评测 Repository
 * 支持两种模式：
 * 1. 流式评测（推荐）：startStreamingEvaluation / stopStreamingEvaluation — 实时录音+打分
 * 2. 文件评测（旧）：evaluatePronunciation — 传入预录音频
 */
interface SpeechRepository {
    /** 使用预录音频进行评测（旧模式，传给 Xfyun 用） */
    suspend fun evaluatePronunciation(word: Word, audioStream: InputStream): PronunciationResult

    /**
     * 实时录音 + 流式评测
     * 开启麦克风录音并实时发送到云端打分，协程挂起直到调用了 [stopStreamingEvaluation] 并收到结果
     */
    suspend fun startStreamingEvaluation(word: Word): PronunciationResult

    /** 停止流式评测——用户按停止按钮时调用 */
    fun stopStreamingEvaluation()
}
