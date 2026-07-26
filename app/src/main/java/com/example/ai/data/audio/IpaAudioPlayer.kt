package com.example.ai.data.audio

import android.content.Context
import android.media.MediaPlayer
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * 播放国际音标（IPA）读音的音频文件
 *
 * 音频文件存放在 assets/ipa/{音标符号}.aac
 * 例如 assets/ipa/æ.aac 对应音标 /æ/
 */
class IpaAudioPlayer(private val context: Context) {

    private var currentPlayer: MediaPlayer? = null

    companion object {
        private const val TAG = "IpaAudioPlayer"
        private const val IPA_DIR = "ipa"
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

        val assetPath = "$IPA_DIR/$clean.aac"

        try {
            val afd = context.assets.openFd(assetPath)
            currentPlayer = MediaPlayer().apply {
                setDataSource(afd)
                setOnCompletionListener {
                    release()
                    currentPlayer = null
                }
                setOnErrorListener { mp, what, extra ->
                    Log.e(TAG, "播放错误: what=$what extra=$extra")
                    mp.release()
                    currentPlayer = null
                    true
                }
                prepare()
                start()
            }
            afd.close()
            Log.d(TAG, "播放: $assetPath")
        } catch (e: Exception) {
            Log.w(TAG, "无法播放 $assetPath: ${e.message}")
        }
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
