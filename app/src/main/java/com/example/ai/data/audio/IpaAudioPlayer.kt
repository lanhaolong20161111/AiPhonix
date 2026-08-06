package com.example.ai.data.audio

import android.content.Context
import android.media.MediaPlayer
import android.util.Log

/**
 * 播放国际音标（IPA）读音的音频文件
 *
 * 美式音频: assets/ipa/{音标符号}.aac（如 assets/ipa/æ.aac）
 * 英式音频: assets/ipa_uk/{音标符号}.mp3（新东方英式国际音标卡，48 个）
 *
 * 播放时按当前发音风格（PronunciationStyleStore）选择：
 * - 美式：只试 ipa/xxx.aac
 * - 英式：先试 ipa_uk/xxx.mp3，缺失（如 kw/ks/ju 等组合音）回退 ipa/xxx.aac
 */
class IpaAudioPlayer(
    private val context: Context,
    private val styleStore: PronunciationStyleStore,
    private val boostDb: Int = 0,
) {

    private var currentPlayer: MediaPlayer? = null

    /** 播放完成回调（用于 UI 复位播放状态图标） */
    var onCompletion: (() -> Unit)? = null

    companion object {
        private const val TAG = "IpaAudioPlayer"
        private const val IPA_DIR = "ipa"
        private const val IPA_UK_DIR = "ipa_uk"
    }

    /**
     * 播放指定音标的读音
     * @param ipaSymbol 音标符号，如 "æ" 或 "/æ/"
     */
    fun play(ipaSymbol: String) {
        // 清理上一个播放
        stop()

        // 去掉可能带有的斜杠
        val clean = ipaSymbol
            .removePrefix("/")
            .removeSuffix("/")
            .trim()

        val style = styleStore.style.value
        val candidates = if (style == PronunciationStyle.UK) {
            listOf("$IPA_UK_DIR/$clean.mp3", "$IPA_DIR/$clean.aac")
        } else {
            listOf("$IPA_DIR/$clean.aac")
        }

        for (assetPath in candidates) {
            try {
                val afd = context.assets.openFd(assetPath)
                currentPlayer = MediaPlayer().apply {
                    setDataSource(afd)
                    setOnCompletionListener {
                        release()
                        currentPlayer = null
                        onCompletion?.invoke()
                    }
                    setOnErrorListener { mp, what, extra ->
                        Log.e(TAG, "播放错误: what=$what extra=$extra")
                        mp.release()
                        currentPlayer = null
                        onCompletion?.invoke()
                        true
                    }
                    prepare()
                    // 可选增益增强（如字母页 +20dB）
                    if (boostDb > 0) {
                        try {
                            val enhancer = android.media.audiofx.LoudnessEnhancer(audioSessionId)
                            enhancer.setTargetGain(boostDb)
                            enhancer.enabled = true
                        } catch (_: Exception) {}
                    }
                    start()
                }
                afd.close()
                Log.d(TAG, "播放($style): $assetPath")
                return
            } catch (e: Exception) {
                // 尝试下一个候选路径
                Log.d(TAG, "跳过不可用 $assetPath: ${e.message}")
            }
        }
        Log.w(TAG, "无法播放 $clean（候选: $candidates）")
    }

    /**
     * 停止当前播放并释放资源
     */
    fun stop() {
        try {
            currentPlayer?.apply {
                if (isPlaying) stop()
                release()
            }
        } catch (_: Exception) {}
        currentPlayer = null
    }
}
