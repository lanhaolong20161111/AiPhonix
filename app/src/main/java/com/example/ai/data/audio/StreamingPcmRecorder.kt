package com.example.ai.data.audio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 流式 PCM 录音引擎 — 边录边把 PCM 块回调出去（对齐 web `lib/pcmRecorder.ts` 的
 * `onPcmChunk` / `onLevel` 契约），供 WebSocket ASR 边录边发。
 *
 * 与 [AudioRecorder]（一次性录完整段）的区别：数据**实时回调**，停止时仍返回整段
 * 累积 PCM（语义同 web `PcmRecorder.stop()`）。
 *
 * 口径（与 web 逐位对齐）：
 * - 16kHz / 16bit / mono（与 `AudioRecorder`、SOE 与 ASR 全链路一致）。
 * - **~200ms 一块**（web AudioWorklet 的 `intervalInFrames`）。
 * - 能量等级用 [energyLevel]（web `energyLevel` 的逐位移植），阈值 0.02 起
 *   `useEnglishTurn` 的「在说话」判定依赖这套刻度，**别改成 RMS 原值**。
 *
 * ⚠️ 与 web 的**有意差异**：web 写 PCM 时把采样 ×2 放大（浏览器麦克风普遍偏轻）；
 * Android `AudioRecord` 无此问题（现有 `AudioRecorder` / SOE 链路实测识别率已足够），不做放大。
 */
class StreamingPcmRecorder(
    /** 块时长（ms）；200 对齐 web AudioWorklet */
    private val chunkMs: Int = 200,
) {

    interface Callbacks {
        /** 一块新 PCM（16k/16bit/mono；音频线程触发） */
        fun onPcmChunk(chunk: ByteArray)
        /** 音量等级 0-1（音频线程触发；同块回调，节奏同 onPcmChunk） */
        fun onLevel(level: Float)
    }

    private var record: AudioRecord? = null
    private var thread: Thread? = null
    private val stopped = AtomicBoolean(true)
    private val buffer = ByteArrayOutputStream()

    val isRecording: Boolean get() = !stopped.get()

    /**
     * 开始录音。失败抛 [RuntimeException]（麦克风被占/无权限），调用方给出可展示的中文信息
     * （与 `AudioRecorder.record` 同口径）。
     */
    fun start(callbacks: Callbacks) {
        if (isRecording) return
        val (rec, rate) = pickSampleRate() ?: throw RuntimeException(
            "麦克风初始化失败，请确保已授予录音权限且麦克风未被其他应用占用",
        )
        val chunkBytes = chunkMs * rate * 2 / 1000 // 16bit ⇒ ×2
        buffer.reset()
        stopped.set(false)

        rec.startRecording()
        thread = Thread {
            val buf = ByteArray(chunkBytes)
            try {
                while (!stopped.get()) {
                    val read = rec.read(buf, 0, buf.size)
                    if (read > 0) {
                        val chunk = buf.copyOf(read)
                        synchronized(buffer) { buffer.write(buf, 0, read) }
                        callbacks.onPcmChunk(chunk)
                        callbacks.onLevel(energyLevel(chunk))
                    } else {
                        // 短暂无数据/读错误：让出 CPU 避免忙等（与 AudioRecorder 同策略）
                        Thread.sleep(20)
                    }
                }
            } catch (_: InterruptedException) {
                // 被 stop()/destroy() 打断：正常退出路径
            } finally {
                try { rec.stop() } catch (_: Exception) {}
                rec.release()
            }
        }.also { it.start() }
    }

    /**
     * 停止并返回**本次 start 以来的全部 PCM**（语义同 web `PcmRecorder.stop()`）。
     * 未在录音时返回空数组。
     */
    fun stop(): ByteArray {
        if (stopped.get()) return ByteArray(0)
        stopped.set(true)
        val t = thread
        thread = null
        try {
            t?.join(2_000)
        } catch (_: InterruptedException) {
        }
        record = null
        synchronized(buffer) {
            val out = buffer.toByteArray()
            buffer.reset()
            return out
        }
    }

    /** 强制释放（onCleared 兜底；内部就是 stop） */
    fun destroy() {
        try { stop() } catch (_: Exception) {}
    }

    /** 遍历可用采样率（与 `AudioRecorder` 同策略；流式链路只用 16k，其余仅兜底） */
    private fun pickSampleRate(): Pair<AudioRecord, Int>? {
        for (rate in intArrayOf(16000, 44100, 8000)) {
            val minBuf = AudioRecord.getMinBufferSize(
                rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBuf <= 0) continue
            val rec = AudioRecord(
                MediaRecorder.AudioSource.MIC, rate,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                minBuf * 4,
            )
            if (rec.state == AudioRecord.STATE_INITIALIZED) {
                record = rec
                return rec to rate
            }
            rec.release()
        }
        Log.w(TAG, "所有采样率均初始化失败")
        return null
    }

    private companion object {
        private const val TAG = "StreamingPcmRecorder"
    }
}

/**
 * 计算 PCM 块的能量等级（0-1）— web `pcmRecorder.ts#energyLevel` 的逐位移植。
 * RMS 归一化：`min(1, rms / 4000)`。`useEnglishTurn` 的 ENERGY_TH = 0.02 建立在这套刻度上。
 */
fun energyLevel(pcm: ByteArray): Float {
    if (pcm.size < 2) return 0f
    val samples = pcm.size / 2
    var sum = 0.0
    var peak = 0.0
    for (i in 0 until samples) {
        // little-endian 16bit
        val v = ((pcm[i * 2 + 1].toInt() and 0xFF) shl 8) or (pcm[i * 2].toInt() and 0xFF)
        val s16 = if (v >= 0x8000) v - 0x10000 else v
        val abs = Math.abs(s16)
        sum += abs
        if (abs > peak) peak = abs.toDouble()
    }
    val rms = kotlin.math.sqrt(sum / samples)
    return (rms / 4000.0).toFloat().coerceAtMost(1f)
}
