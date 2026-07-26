package com.example.ai.data.repository

import android.util.Base64
import android.util.Log
import com.example.ai.data.audio.AudioRecorder
import com.example.ai.data.model.PronunciationResult
import com.example.ai.data.model.Word
import com.example.ai.data.speech.ScoreClient
import com.example.ai.di.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.io.InputStream

/**
 * 语音评测 Repository — 薄协调层，组合 AudioRecorder + ScoreClient。
 *
 * 职责:
 * - 协调录音 → 评测的完整流程
 * - 保持 SpeechRepository 接口契约不变
 *
 * 不涉及:
 * - AudioRecord 操作（委托给 AudioRecorder）
 * - HTTP 请求/JSON 解析（委托给 ScoreClient）
 */
class ProxySpeechRepository(
    private val client: OkHttpClient = NetworkModule.httpClient,
) : SpeechRepository {

    companion object {
        private const val TAG = "ProxySpeechRepo"
        /** 最短有效录音长度（约 6400 bytes = 0.4 秒 PCM 16kHz 16bit） */
        private const val MIN_AUDIO_BYTES = 6400
    }

    private val audioRecorder = AudioRecorder()
    private val scoreClient = ScoreClient(client)

    // ========== SpeechRepository ==========

    /** 预录音频评测（上传已有文件） */
    override suspend fun evaluatePronunciation(word: Word, audioStream: InputStream): PronunciationResult =
        withContext(Dispatchers.IO) {
            val bytes = audioStream.readBytes()
            val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            scoreClient.evaluate(word.text, base64)
        }

    /** 实时录音 + 服务端评测 */
    override suspend fun startStreamingEvaluation(word: Word): PronunciationResult {
        Log.d(TAG, "开始录音评测: ${word.text}")
        audioRecorder.reset() // 清除上次的 stop 状态
        val audioBytes = audioRecorder.record()

        if (audioBytes.size < MIN_AUDIO_BYTES) {
            throw RuntimeException("录音太短，请至少读一秒")
        }

        Log.d(TAG, "录音完成，发送评测: ${audioBytes.size} bytes")
        return withContext(Dispatchers.IO) {
            val audioBase64 = Base64.encodeToString(audioBytes, Base64.NO_WRAP)
            scoreClient.evaluate(word.text, audioBase64)
        }
    }

    /** 停止录音 */
    override fun stopStreamingEvaluation() {
        Log.d(TAG, "停止录音")
        audioRecorder.stop()
    }
}
