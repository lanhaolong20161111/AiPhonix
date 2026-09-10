package com.example.ai.data.audio

import android.media.MediaPlayer
import android.util.Log
import com.example.ai.data.chinesepractice.PinyinParts
import java.net.URLEncoder

/**
 * 播放拼音声母/介母/韵母/整体认读音节发音（服务端 pinyin_audio 目录的 mp3）
 *
 * 音频 URL: {serverBase}/api/v1/pinyin-audio?file={目录}/{文件}.mp3
 *
 * 特殊规则：
 * - 韵母按声调选文件：单韵母 a o e i u v→单韵母声调/、复韵母→复韵母声调/、鼻韵母→鼻韵母声调/（tone 1~4），tone 0/5 用无调 韵母/xx.mp3
 * - 真声母后的 ian/uan 是整体韵母（特殊韵母声调/ian{tone}.mp3 等，百度 TTS 生成）；y/w 开头的 yan/wan 按课本拆 y/w + an（鼻韵母声调）
 * - j/q/x + uan = üan（省略写法）→ 整体认读声调/yuan{tone}.mp3（同音）
 * - yi 整体认读的声调发音 = i 的声调 → 单韵母声调/i{tone}.mp3（站点无 yi1~4）
 * - 介母 i/u/v → 韵母/单元音.mp3
 */
class PinyinAudioPlayer(private val serverBase: String) {

    private var currentPlayer: MediaPlayer? = null
    /** 停止标志：stop() 置位后，多段连播的递归链不再创建新播放器 */
    @Volatile
    private var isStopped = false

    companion object {
        private const val TAG = "PinyinAudioPlayer"

        private val SINGLE_FINALS = setOf("a", "o", "e", "i", "u", "v")
        private val COMPOUND_FINALS = setOf("ai", "ei", "ui", "ao", "ou", "iu", "ie", "ve", "er")
        private val NASAL_FINALS = setOf("an", "en", "in", "un", "vn", "ang", "eng", "ing", "ong")
        private val SPECIAL_FINALS = setOf("ian", "uan")

        /**
         * 由拼音解析结果构建音频相对路径；无法映射返回 null。
         */
        fun audioPathFor(parts: PinyinParts): String? {
            if (parts.isOverall) {
                val fin = parts.final
                if (fin.isEmpty()) return null
                // yi 的声调发音 = i 的声调（站点无 yi1~4 音频）
                if (fin == "yi") {
                    return if (parts.tone in 1..4) "单韵母声调/i${parts.tone}.mp3" else "韵母/i.mp3"
                }
                return if (parts.tone in 1..4) "整体认读声调/$fin${parts.tone}.mp3"
                else "整体认读音节/$fin.mp3"
            }
            val init = parts.initial
            val med = parts.medial
            val fin = parts.final
            if (fin.isEmpty()) return null
            val tone = parts.tone
            val finalPath = when {
                fin == "ian" -> "特殊韵母声调/ian${if (tone in 1..4) tone else 1}.mp3"
                fin == "uan" && init in "jqx" ->
                    "整体认读声调/yuan${if (tone in 1..4) tone else 1}.mp3" // üan 省略写法，读 yuan
                fin == "uan" -> "特殊韵母声调/uan${if (tone in 1..4) tone else 1}.mp3"
                fin in SINGLE_FINALS -> if (tone in 1..4) "单韵母声调/$fin$tone.mp3" else "韵母/$fin.mp3"
                fin in COMPOUND_FINALS -> if (tone in 1..4) "复韵母声调/$fin$tone.mp3" else "韵母/$fin.mp3"
                fin in NASAL_FINALS -> if (tone in 1..4) "鼻韵母声调/$fin$tone.mp3" else "韵母/$fin.mp3"
                else -> null
            } ?: return null
            // 声母块：声母 + 介母 + 韵母依次拼
            val blocks = mutableListOf<String>()
            if (init.isNotEmpty()) blocks += "声母/$init.mp3"
            if (med.isNotEmpty()) blocks += "韵母/$med.mp3"
            blocks += finalPath
            return blocks.joinToString(",")
        }
    }

    /** 由拼音解析结果构建音频路径并播放 */
    fun playPinyin(parts: PinyinParts) {
        val path = audioPathFor(parts) ?: return
        play(path)
    }

    /** 播放一段或多段（逗号分隔连续播放） */
    fun play(paths: String) {
        isStopped = false
        val list = paths.split(",").filter { it.isNotBlank() }
        if (list.isEmpty()) return
        playSequence(list, 0)
    }

    private fun playSequence(paths: List<String>, index: Int) {
        // stop() 后递归链不再续播，避免“停止”按钮失效（多段连续播放场景）
        if (isStopped || index >= paths.size) return
        stop()
        val url = serverBase.trimEnd('/') + "/api/v1/pinyin-audio?file=" + URLEncoder.encode(paths[index], "UTF-8")
        try {
            currentPlayer = MediaPlayer().apply {
                setDataSource(url)
                setOnPreparedListener {
                    start()
                    // 播放完当前段后播下一段
                    setOnCompletionListener {
                        release()
                        currentPlayer = null
                        playSequence(paths, index + 1)
                    }
                }
                setOnErrorListener { mp, what, extra ->
                    Log.e(TAG, "播放错误: what=$what extra=$extra url=$url")
                    mp.release()
                    currentPlayer = null
                    playSequence(paths, index + 1)
                    true
                }
                prepareAsync()
            }
            Log.d(TAG, "播放: $url")
        } catch (e: Exception) {
            Log.w(TAG, "无法播放 $url: ${e.message}")
        }
    }

    /** 停止当前播放并释放资源 */
    fun stop() {
        isStopped = true
        try {
            currentPlayer?.apply {
                if (isPlaying) stop()
                release()
            }
        } catch (_: Exception) {}
        currentPlayer = null
    }
}
