package com.example.ai.data.tts

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.Locale
import kotlin.coroutines.resume

/**
 * TTS 引擎 — 系统 TTS 优先，服务端百度 TTS 回退
 *
 * 调用链：
 *   1. Android 系统 TextToSpeech（离线、零延迟、高音质）
 *   2. 不可用 / 失败 → 服务端百度 TTS 代理 + 本地缓存
 */
class TtsEngine(context: Context) {

    private companion object {
        private const val TAG = "TtsEngine"
    }

    private val appContext = context.applicationContext
    private val cache = BaiduTtsCache(appContext)

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    init {
        try {
            tts = TextToSpeech(appContext) { status ->
                ttsReady = (status == TextToSpeech.SUCCESS)
                if (ttsReady) {
                    val lang = tts?.setLanguage(Locale.UK)
                    if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                        Log.w(TAG, "英式英语不可用，尝试美式英语")
                        tts?.setLanguage(Locale.US)
                    }
                    Log.i(TAG, "系统 TTS 就绪")
                } else {
                    Log.w(TAG, "系统 TTS 初始化失败，将回退到服务端 TTS")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "系统 TTS 不可用: ${e.message}")
        }
    }

    val isAvailable: Boolean get() = ttsReady || true // 即使系统 TTS 不可用，服务端仍可用

    /**
     * 朗读文本。
     * 优先使用系统 TTS（离线），不可用时回退到服务端百度 TTS。
     */
    suspend fun speak(text: String) {
        Log.d(TAG, "speak(\"$text\")")

        // 1. 尝试系统 TTS
        if (ttsReady && tts != null) {
            if (speakWithSystemTts(text)) return
            Log.w(TAG, "系统 TTS 播放失败，回退到服务端 TTS")
        }

        // 2. 回退到服务端百度 TTS
        if (!cache.play(text)) {
            Log.e(TAG, "TTS 播放失败（服务端不可达或缓存错误）")
        }
    }

    /** 使用 Android 系统 TTS 播放，等待朗读完成 */
    private suspend fun speakWithSystemTts(text: String): Boolean = suspendCancellableCoroutine { cont ->
        val engine = tts ?: run { cont.resume(false); return@suspendCancellableCoroutine }

        val utteranceId = "tts_${text.hashCode()}"
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(uid: String?) {}
            override fun onDone(uid: String?) {
                if (uid == utteranceId) cont.resume(true)
            }
            override fun onError(uid: String?) {
                if (uid == utteranceId) cont.resume(false)
            }
        })

        val result = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        if (result != TextToSpeech.SUCCESS) {
            cont.resume(false)
        }

        cont.invokeOnCancellation {
            try { engine.stop() } catch (_: Exception) {}
        }
    }

    /** 释放资源 */
    fun shutdown() {
        tts?.let {
            try {
                it.stop()
                it.shutdown()
            } catch (_: Exception) {}
        }
        tts = null
        ttsReady = false
    }
}
