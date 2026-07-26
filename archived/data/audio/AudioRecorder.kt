package com.example.ai.data.audio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.Closeable
import kotlinx.coroutines.*

/**
 * 音频录制器 — 遵循项目音频引擎规范：
 * - 单线程访问（内部使用独立线程读取）
 * - 状态机：IDLE → RECORDING → PROCESSING → RELEASED
 * - 使用 try-finally 确保 release()
 * - 生命周期由 ViewModel 管理，禁止作为 global singleton
 *
 * 参数：16kHz, 16bit, Mono PCM（符合讯飞要求）
 */
class AudioRecorder : Closeable {

    enum class State { IDLE, RECORDING, PROCESSING, RELEASED }

    private var state: State = State.IDLE
    private var audioRecord: AudioRecord? = null
    private val buffer = ByteArrayOutputStream()

    private val sampleRate = 16000
    private val channelConfig = AudioFormat.CHANNEL_IN_MONO
    private val audioFormat = AudioFormat.ENCODING_PCM_16BIT

    private val minBufferSize: Int by lazy {
        AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
    }

    private var recordJob: Job? = null
    private var recordScope: CoroutineScope? = null

    /**
     * 开始录音。在独立协程中持续读取音频数据。
     */
    fun start(): State {
        check(state == State.IDLE) { "只能在 IDLE 状态启动录音，当前: $state" }
        state = State.RECORDING
        buffer.reset()

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            channelConfig,
            audioFormat,
            maxOf(minBufferSize, 3200)
        )

        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
            state = State.IDLE
            audioRecord?.release()
            audioRecord = null
            throw RuntimeException("AudioRecord 初始化失败")
        }

        audioRecord?.startRecording()

        // 在独立协程中持续读取音频数据
        recordScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        recordJob = recordScope?.launch {
            val readBuffer = ByteArray(minBufferSize)
            while (isActive && state == State.RECORDING) {
                val read = audioRecord?.read(readBuffer, 0, readBuffer.size) ?: -1
                when {
                    read > 0 -> synchronized(buffer) { buffer.write(readBuffer, 0, read) }
                    read == 0 -> {} // 无数据，继续
                    read < 0 -> {
                        Log.e("AudioRecorder", "read error: $read")
                        break
                    }
                }
            }
        }

        return state
    }

    /**
     * 停止录音并返回 PCM 数据。
     */
    fun stop(): ByteArray {
        check(state == State.RECORDING) { "只能在 RECORDING 状态停止录音，当前: $state" }
        state = State.PROCESSING

        // 停止读取协程
        recordJob?.cancel()
        recordJob = null
        recordScope?.cancel()
        recordScope = null

        audioRecord?.stop()
        releaseAudioRecord()

        val data = synchronized(buffer) { buffer.toByteArray() }
        Log.d("AudioRecorder", "录音完成: ${data.size} bytes")
        state = State.PROCESSING
        return data
    }

    override fun close() {
        recordJob?.cancel()
        recordScope?.cancel()
        releaseAudioRecord()
        state = State.RELEASED
        buffer.reset()
    }

    private fun releaseAudioRecord() {
        try {
            audioRecord?.release()
        } catch (_: Exception) { }
        audioRecord = null
    }
}