package com.example.ai.data.tts

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.example.ai.data.audio.PronunciationStyle
import com.example.ai.data.audio.PronunciationStyleStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import kotlin.coroutines.resume

/**
 * TTS 引擎 — 系统 TTS 优先，服务端百度 TTS 回退
 *
 * 调用链：
 *   1. Android 系统 TextToSpeech（离线、零延迟、高音质）
 *   2. 不可用 / 失败 → 服务端百度 TTS 代理 + 本地缓存
 *
 * 发音风格：跟随全局美式/英式切换
 *   - 美式 US：系统 TTS 用 Locale.US，百度发音人 106（度小美-情感，美式卷舌）
 *   - 英式 UK：系统 TTS 用 Locale.UK，百度发音人 5118（度小雯）
 */
class TtsEngine(
    context: Context,
    private val styleStore: PronunciationStyleStore,
) {

    private companion object {
        private const val TAG = "TtsEngine"
    }

    private val appContext = context.applicationContext
    private val cache = BaiduTtsCache(appContext)

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    /** 是否正在朗读（全局唯一，朗读期间所有朗读按钮应禁用，防止重复播放） */
    private val _isSpeaking = MutableStateFlow(false)
    val isSpeaking: StateFlow<Boolean> = _isSpeaking.asStateFlow()

    /** 串行化朗读：连续调用自动排队（自动朗读流程依赖：听写/词语练习的字→词1→词2 连续调用需要依次播完）；UI 防重由按钮 enabled 承担 */
    private val speakMutex = Mutex()

    init {
        try {
            tts = TextToSpeech(appContext) { status ->
                ttsReady = (status == TextToSpeech.SUCCESS)
                if (ttsReady) {
                    applySystemLanguage()
                    Log.i(TAG, "系统 TTS 就绪")
                } else {
                    Log.w(TAG, "系统 TTS 初始化失败，将回退到服务端 TTS")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "系统 TTS 不可用: ${e.message}")
        }
    }

    /** 按当前发音风格设置系统 TTS 语言（美式 Locale.US / 英式 Locale.UK） */
    private fun applySystemLanguage() {
        val t = tts ?: return
        val us = styleStore.style.value == PronunciationStyle.US
        val lang = t.setLanguage(if (us) Locale.US else Locale.UK)
        if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
            val fallback = if (us) Locale.UK else Locale.US
            Log.w(TAG, if (us) "美式英语不可用，尝试英式" else "英式英语不可用，尝试美式")
            t.setLanguage(fallback)
        }
        Log.i(TAG, "系统 TTS 语言: " + (if (us) "US" else "UK"))
    }

    val isAvailable: Boolean get() = ttsReady || true // 即使系统 TTS 不可用，服务端仍可用

    /**
     * 朗读文本。
     * 优先使用系统 TTS（离线），不可用时回退到服务端百度 TTS。
     * 连续调用会排队依次播放（不打断）；UI 层通过 [isSpeaking] 禁用朗读按钮防重复点击。
     *
     * @return true 表示播放成功；false 表示系统 TTS 与服务端 TTS 均失败
     */
    suspend fun speak(text: String): Boolean = speakMutex.withLock {
        Log.d(TAG, "speak(\"$text\")")
        _isSpeaking.value = true
        try {
            val us = styleStore.style.value == PronunciationStyle.US

            // 1. 尝试系统 TTS（先按风格切语言）
            if (ttsReady && tts != null) {
                applySystemLanguage()
                if (speakWithSystemTts(text)) return@withLock true
                Log.w(TAG, "系统 TTS 播放失败，回退到服务端 TTS")
            }

            // 2. 回退到服务端百度 TTS（美式 106 / 英式 5118）
            val speaker = if (us) BaiduTtsCache.SPEAKER_US else BaiduTtsCache.SPEAKER_UK
            try {
                if (!cache.play(text, speaker)) {
                    Log.e(TAG, "TTS 播放失败（服务端不可达或缓存错误）")
                    return@withLock false
                }
                return@withLock true
            } catch (e: Exception) {
                Log.e(TAG, "TTS 回退异常: ${e.message}")
                return@withLock false
            }
        } finally {
            _isSpeaking.value = false
        }
    }

    /** 使用 Android 系统 TTS 播放，等待朗读完成（30s 超时保护，防止引擎不回调导致 isSpeaking 永久占用） */
    private suspend fun speakWithSystemTts(text: String): Boolean =
        withTimeoutOrNull(30_000) {
            suspendCancellableCoroutine { cont ->
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
        } ?: false

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
