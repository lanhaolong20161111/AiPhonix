package com.example.ai.data.tts

import android.content.Context
import android.media.MediaPlayer
import android.util.Log
import com.example.ai.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * 百度 TTS 缓存系统。
 *
 * 1. 通过 REST API 合成语音（text2audio）
 * 2. 将音频文件缓存到本地
 * 3. 后续播放直接读缓存，无需再调用 API
 */
class BaiduTtsCache(private val context: Context) {

    companion object {
        private const val TAG = "BaiduTtsCache"
        private const val CACHE_DIR = "tts_cache"
        /** 百度在线发音人：5118=度小雯（女声童音） */
        private const val SPEAKER = "5118"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    private val cacheDir = File(context.cacheDir, CACHE_DIR).also { it.mkdirs() }

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    // ---------- 对外 API ----------

    /**
     * 播放文本的语音。如果本地已缓存则直接播放，否则先下载缓存。
     * 返回 true 表示播放成功，false 表示失败。
     */
    suspend fun play(text: String): Boolean {
        val file = getOrDownload(text) ?: return false
        return playFile(file)
    }

    /** 清除所有缓存文件 */
    fun clearCache() {
        cacheDir.listFiles()?.forEach { it.delete() }
        Log.d(TAG, "缓存已清除")
    }

    // ---------- 内部实现 ----------

    private suspend fun getOrDownload(text: String): File? {
        val file = cacheFile(text)
        if (file.exists()) {
            Log.d(TAG, "缓存命中: $text")
            return file
        }

        Log.d(TAG, "缓存未命中，下载: $text")
        return download(text, file)
    }

    private suspend fun download(text: String, file: File): File? {
        val serverUrl = getServerUrl()
        val jsonBody = JSONObject().apply {
            put("text", text)
            put("speaker", SPEAKER)
            put("speed", 5)
        }

        return withContext(Dispatchers.IO) {
            val body = jsonBody.toString().toRequestBody(JSON_MEDIA_TYPE)
            val request = Request.Builder()
                .url(serverUrl)
                .post(body)
                .build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                val errBody = response.body?.string() ?: "unknown"
                Log.w(TAG, "服务器 TTS 代理返回 ${response.code}: $errBody")
                return@withContext null
            }

            val bytes = response.body?.bytes() ?: return@withContext null
            file.writeBytes(bytes)
            Log.d(TAG, "下载成功: ${file.name} (${bytes.size} bytes)")
            file
        }
    }

    private fun getServerUrl(): String {
        val host = BuildConfig.TTS_SERVER_HOST
        if (host.isNotBlank()) return "$host/api/v1/tts/synthesize"
        return "http://192.168.1.7:8080/api/v1/tts/synthesize"
    }

    private suspend fun playFile(file: File): Boolean = suspendCancellableCoroutine { cont ->
        try {
            val mp = MediaPlayer()
            mp.setDataSource(file.absolutePath)
            mp.setOnPreparedListener { mp.start() }
            mp.setOnCompletionListener {
                mp.release()
                cont.resume(true)
            }
            mp.setOnErrorListener { _, what, extra ->
                Log.w(TAG, "MediaPlayer 错误: what=$what extra=$extra")
                mp.release()
                cont.resume(false)
                true
            }
            mp.prepareAsync()

            cont.invokeOnCancellation {
                if (mp.isPlaying) mp.stop()
                mp.release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "播放文件异常: ${e.message}")
            cont.resume(false)
        }
    }

    private fun cacheFile(text: String): File {
        val hash = MessageDigest.getInstance("MD5")
            .digest(text.toByteArray())
            .joinToString("") { "%02x".format(it) }
        return File(cacheDir, "$hash.mp3")
    }
}
