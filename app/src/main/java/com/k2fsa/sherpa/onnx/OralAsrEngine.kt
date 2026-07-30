package com.k2fsa.sherpa.onnx

import android.content.res.AssetManager
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.min

/**
 * 简化版 ASR 引擎 — 录音→识别的单次调用封装。
 * 适合"按住说、松手识别"的场景，与 DictationSessionEngine 无关。
 */
class OralAsrEngine(private val assetManager: AssetManager) {

    companion object {
        private const val TAG = "OralAsrEngine"

        /** 识别所用最短音频长度（毫秒），避免空识别。 */
        private const val MIN_RECORD_MS = 300L

        /** 内部识别循环的休眠间隔。 */
        private const val LOOP_SLEEP_MS = 50L

        /** 无语音超时（毫秒）— 静音超过此时间自动结束。 */
        private const val SILENCE_TIMEOUT_MS = 2_500L
    }

    private var recognizer: OnlineRecognizer? = null
    private var recorder: PcmAudioRecorder? = null

    /** 是否正在录音中。 */
    @Volatile
    var isRecording: Boolean = false
        private set

    /**
     * 初始化 ASR 模型（在 IO 线程执行）。
     * 首次加载模型较慢（约 2-5 秒），之后缓存。
     */
    suspend fun init(): Boolean = withContext(Dispatchers.IO) {
        if (recognizer != null) return@withContext true
        Log.i(TAG, "init: loading ASR model…")
        try {
            val config = OnlineRecognizerConfig(
                featConfig = getFeatureConfig(sampleRate = 16000, featureDim = 80),
                modelConfig = getModelConfig(type = 0)!!,
                endpointConfig = getEndpointConfig(),
                enableEndpoint = true,
            )
            recognizer = OnlineRecognizer(assetManager = assetManager, config = config)
            Log.i(TAG, "init: ASR model loaded")
            true
        } catch (e: Exception) {
            Log.e(TAG, "init: failed", e)
            false
        }
    }

    /**
     * 开始录音 + ASR。通过 onPartial 回调实时返回识别中间结果。
     * 录音结束后 Result 为最终完整文本。
     */
    suspend fun startRecording(
        onPartial: (String) -> Unit = {},
    ): Result<String> = withContext(Dispatchers.IO) {
        val rec = recognizer ?: return@withContext Result.failure(Exception("ASR 未初始化"))
        val audioRecorder = PcmAudioRecorder()

        if (!audioRecorder.init()) {
            return@withContext Result.failure(Exception("麦克风初始化失败"))
        }

        val stream = rec.createStream()
        if (stream == null) {
            audioRecorder.release()
            return@withContext Result.failure(Exception("ASR 流创建失败"))
        }

        audioRecorder.start()
        isRecording = true
        Log.i(TAG, "startRecording: started")

        val buffer = ShortArray(PcmAudioRecorder.CHUNK_SAMPLES) // ~100ms of PCM
        val floatBuf = FloatArray(PcmAudioRecorder.CHUNK_SAMPLES)
        val sb = StringBuilder()
        var bestText = ""
        var lastSpeechMs = System.currentTimeMillis()
        val startMs = lastSpeechMs

        try {
            while (isRecording) {
                val n = audioRecorder.read(buffer)
                if (n > 0) {
                    // Short → Float conversion
                    for (i in 0 until n) {
                        floatBuf[i] = max(-1f, min(1f, buffer[i].toFloat() / Short.MAX_VALUE))
                    }
                    stream.acceptWaveform(floatBuf.copyOf(n), PcmAudioRecorder.SAMPLE_RATE)
                    lastSpeechMs = System.currentTimeMillis()
                }

                // Decode & get partial result
                if (rec.isReady(stream)) {
                    rec.decode(stream)
                    val result = rec.getResult(stream)
                    if (result.text.isNotBlank()) {
                        bestText = result.text
                        onPartial(bestText)
                    }
                }

                // 静音超时自动结束
                val now = System.currentTimeMillis()
                if (now - lastSpeechMs > SILENCE_TIMEOUT_MS && now - startMs > MIN_RECORD_MS) {
                    Log.i(TAG, "startRecording: silence timeout, stopping")
                    break
                }

                Thread.sleep(LOOP_SLEEP_MS)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startRecording: error", e)
        } finally {
            audioRecorder.stop()
            audioRecorder.release()
            stream.inputFinished()
            // 最后一次 decode
            if (rec.isReady(stream)) {
                rec.decode(stream)
                val finalResult = rec.getResult(stream)
                if (finalResult.text.isNotBlank()) {
                    bestText = finalResult.text
                }
            }
            stream.release()
            isRecording = false
            Log.i(TAG, "startRecording: done, text='$bestText'")
        }

        if (bestText.isBlank()) {
            Result.failure(Exception("没有识别到语音"))
        } else {
            Result.success(bestText)
        }
    }

    /** 停止录音。 */
    fun stopRecording() {
        isRecording = false
    }

    /** 释放 ASR 模型资源（通常不需要手动调用）。 */
    fun release() {
        recognizer?.release()
        recognizer = null
        isRecording = false
    }
}
