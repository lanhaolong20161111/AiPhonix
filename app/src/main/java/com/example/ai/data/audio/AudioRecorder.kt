package com.example.ai.data.audio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 纯 PCM 录音引擎 — 只负责从麦克风采集原始音频数据。
 *
 * 职责范围:
 * - 创建/配置 AudioRecord（自动降级采样率）
 * - 循环读取 PCM 数据直到停止或超时
 * - 返回 PCM ByteArray
 *
 * 不涉及:
 * - 网络请求
 * - 数据处理/编码
 * - 协程管理（由调用方提供协程上下文）
 */
class AudioRecorder {

    companion object {
        private const val TAG = "AudioRecorder"
        /** 默认使用 16kHz，若设备不支持则自动降级 */
        const val SAMPLE_RATE = 16000
        const val MAX_RECORD_SECONDS = 30L
        /** 依次尝试的采样率列表 */
        private val SUPPORTED_SAMPLE_RATES = intArrayOf(16000, 44100, 8000)
    }

    private val stopped = AtomicBoolean(false)

    /**
     * 开始录音，挂起直到被 [stop] 调用或到达超时。
     * @return PCM 16bit mono 音频数据
     */
    suspend fun record(): ByteArray = withContext(Dispatchers.IO) {
        val (record, sampleRate, minBufSize) = createAudioRecord() ?: run {
            throw RuntimeException("麦克风初始化失败，请确保已授予录音权限且麦克风未被其他应用占用")
        }
        val buffer = ByteArrayOutputStream()
        val startTime = System.currentTimeMillis()

        try {
            record.startRecording()
            val buf = ByteArray(minBufSize)
            while (isActive && !stopped.get() &&
                (System.currentTimeMillis() - startTime) < MAX_RECORD_SECONDS * 1000
            ) {
                val read = record.read(buf, 0, buf.size)
                if (read > 0) buffer.write(buf, 0, read)
            }
        } finally {
            try { record.stop() } catch (_: Exception) {}
            record.release()
        }

        Log.d(TAG, "录音结束: ${buffer.size()} bytes @ ${sampleRate}Hz (${buffer.size() / (sampleRate / 500)}秒)")
        buffer.toByteArray()
    }

    /** 请求停止录音，线程安全 */
    fun stop() {
        stopped.set(true)
    }

    /** 重置停止标志（同一 AudioRecorder 实例可重复使用） */
    fun reset() {
        stopped.set(false)
    }

    /**
     * 尝试创建 AudioRecord，自动遍历支持的采样率。
     * @return Triple(record, 实际采样率, 缓冲区大小) 或 null（全部失败）
     */
    private fun createAudioRecord(): Triple<AudioRecord, Int, Int>? {
        for (rate in SUPPORTED_SAMPLE_RATES) {
            val minBufSize = AudioRecord.getMinBufferSize(
                rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBufSize <= 0) {
                Log.w(TAG, "采样率 ${rate}Hz 不支持 (getMinBufferSize=$minBufSize)")
                continue
            }
            val record = AudioRecord(
                MediaRecorder.AudioSource.MIC, rate,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                minBufSize * 4,
            )
            if (record.state == AudioRecord.STATE_INITIALIZED) {
                Log.d(TAG, "AudioRecord 初始化成功: ${rate}Hz, buffer=${minBufSize * 4}")
                return Triple(record, rate, minBufSize)
            }
            record.release()
            Log.w(TAG, "采样率 ${rate}Hz AudioRecord 初始化失败 (state=${record.state})")
        }
        return null
    }
}
