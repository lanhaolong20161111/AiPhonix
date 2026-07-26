package com.example.ai.data.tts

import android.content.Context
import android.util.Log

/**
 * TTS 引擎 — 纯服务端 REST API
 *
 * 唯一路径：服务端百度 TTS 代理 → 客户端本地缓存
 * 无系统 TTS 回退，依赖局域网服务器可达
 */
class TtsEngine(context: Context) {

    private companion object {
        private const val TAG = "TtsEngine"
    }

    private val cache = BaiduTtsCache(context.applicationContext)

    val isAvailable: Boolean get() = true

    suspend fun speak(text: String) {
        Log.d(TAG, "speak(\"$text\")")
        if (!cache.play(text)) {
            Log.e(TAG, "TTS 播放失败（服务端不可达或缓存错误）")
        }
    }

    fun shutdown() {}
}
