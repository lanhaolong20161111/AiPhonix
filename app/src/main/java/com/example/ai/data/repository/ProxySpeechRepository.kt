package com.example.ai.data.repository

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import com.example.ai.BuildConfig
import com.example.ai.data.model.*
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class ProxySpeechRepository : SpeechRepository {

    companion object {
        private const val TAG = "ProxySpeechRepo"
        private const val SAMPLE_RATE = 16000
        private const val MAX_RECORD_SECONDS = 30L
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        fun getServerBase(): String {
            val host = BuildConfig.TTS_SERVER_HOST
            return if (host.isNotBlank()) host else "http://192.168.1.7:8080"
        }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private var recordJob: Job? = null
    private var recordBuffer: ByteArrayOutputStream? = null
    private var deferredResult: CompletableDeferred<PronunciationResult>? = null
    private var currentWord: Word? = null
    private val stopped = AtomicBoolean(false)

    // ========== SpeechRepository ==========

    override suspend fun evaluatePronunciation(word: Word, audioStream: InputStream): PronunciationResult =
        withContext(Dispatchers.IO) {
            val bytes = audioStream.readBytes()
            val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            requestServerEval(word.text, base64)
        }

    /** 录音评测 */
    override suspend fun startStreamingEvaluation(word: Word): PronunciationResult {
        val deferred = CompletableDeferred<PronunciationResult>()
        val buffer = ByteArrayOutputStream()

        stopped.set(false)
        currentWord = word
        deferredResult = deferred
        recordBuffer = buffer

        recordJob = CoroutineScope(Dispatchers.IO).launch {
            try {
                recordPcm(buffer)
            } catch (e: CancellationException) {
                Log.d(TAG, "录音被主动停止")
            } catch (e: Exception) {
                Log.e(TAG, "录音异常: ${e.message}")
                if (!deferred.isCompleted) deferred.completeExceptionally(e)
                return@launch
            }
            // 录音结束（超时或停止）→ 自动发评测
            Log.d(TAG, "录音结束，自动发送评测")
            sendBufferForEval(deferred)
        }

        return deferred.await()
    }

    /** 停止录音 */
    override fun stopStreamingEvaluation() {
        stopped.set(true)
        recordJob?.cancel()
        recordJob = null
        // 评测已在录音协程末尾自动发送
    }

    /** 读取 buffer 并发起服务端评测 */
    private fun sendBufferForEval(deferred: CompletableDeferred<PronunciationResult>) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val buffer = recordBuffer ?: run {
                    completeDeferred(deferred, null, Exception("buffer is null"))
                    return@launch
                }
                val word = currentWord ?: run {
                    completeDeferred(deferred, null, Exception("word is null"))
                    return@launch
                }
                val bytes = buffer.toByteArray()
                Log.d(TAG, "录音完成: ${bytes.size} bytes (${bytes.size / 320}秒)")

                if (bytes.size < 6400) {
                    completeDeferred(deferred, null, Exception("录音太短，请至少读一秒"))
                    return@launch
                }

                val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                val result = requestServerEval(word.text, base64)
                completeDeferred(deferred, result, null)
            } catch (e: Exception) {
                Log.e(TAG, "评测失败: ${e.message}")
                completeDeferred(deferred, null, e)
            }
        }
    }

    private fun completeDeferred(
        deferred: CompletableDeferred<PronunciationResult>,
        result: PronunciationResult?,
        error: Exception?
    ) {
        if (deferred.isCompleted) return
        if (error != null) {
            deferred.completeExceptionally(error)
        } else if (result != null) {
            deferred.complete(result)
        }
    }

    // ========== 录音 ==========

    private suspend fun recordPcm(buffer: ByteArrayOutputStream) = withContext(Dispatchers.IO) {
        val minBufSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
        )
        val record = AudioRecord(
            MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            minBufSize * 4,
        )
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
    }

    // ========== 服务端请求 ==========

    private fun requestServerEval(refText: String, audioBase64: String): PronunciationResult {
        return requestServerEval(refText, audioBase64, "")
    }

    private fun requestServerEval(refText: String, audioBase64: String, engine: String): PronunciationResult {
        val jsonBody = JSONObject().apply {
            put("ref_text", refText)
            put("audio_base64", audioBase64)
            if (engine.isNotEmpty()) put("engine", engine)
        }

        val request = Request.Builder()
            .url("${getServerBase()}/api/v1/soe/evaluate")
            .post(jsonBody.toString().toRequestBody(JSON_MEDIA))
            .build()

        Log.d(TAG, "发送 SOE 请求: ref_text=$refText, audio_len=${audioBase64.length}")
        val response = client.newCall(request).execute()

        if (!response.isSuccessful) {
            val err = response.body?.string() ?: "unknown"
            throw RuntimeException("服务端 SOE 代理 ${response.code}: $err")
        }

        val bodyStr = response.body?.string() ?: throw RuntimeException("服务端响应为空")
        val json = JSONObject(bodyStr)

        val score = json.optInt("pron_accuracy", 0).coerceIn(0, 100)
        val fluency = json.optDouble("pron_fluency", 0.0)
        val completion = json.optDouble("pron_completion", 0.0)
        val suggested = json.optDouble("suggested_score", 0.0)

        val phonemeScores = mutableListOf<PhonemeScore>()
        val wordScores = mutableListOf<WordScore>()

        val wordsArr = json.optJSONArray("words")
        if (wordsArr != null) {
            for (i in 0 until wordsArr.length()) {
                val w = wordsArr.getJSONObject(i)
                val wordText = w.optString("word", "")
                val wordAcc = w.optDouble("accuracy", 0.0).toFloat()
                val matchTag = w.optInt("match_tag", 0)
                wordScores.add(WordScore(word = wordText, pronAccuracy = wordAcc.coerceIn(0f, 100f), matchTag = matchTag))

                val phones = w.optJSONArray("phone_infos")
                if (phones != null) {
                    for (j in 0 until phones.length()) {
                        val p = phones.getJSONObject(j)
                        val phoneName = p.optString("phone", "")
                        val phoneScore = p.optDouble("accuracy", 0.0).toInt().coerceIn(0, 100)
                        phonemeScores.add(PhonemeScore(
                            phoneme = phoneName, score = phoneScore,
                            level = when { phoneScore >= 80 -> ScoreLevel.GOOD; phoneScore >= 60 -> ScoreLevel.OKAY; else -> ScoreLevel.NEEDS_WORK },
                        ))
                    }
                }
            }
        }

        return PronunciationResult(
            word = Word(text = refText, ipa = "", letter = "", phonemes = emptyList()),
            totalScore = score, phonemeScores = phonemeScores, wordScores = wordScores,
            accuracyScore = score.toDouble(), fluencyScore = fluency,
            integrityScore = completion, standardScore = suggested,
            feedback = when { score >= 80 -> "读得很好！🎉"; score >= 60 -> "不错，再练练！"; else -> "多跟读几遍" },
        )
    }
}
