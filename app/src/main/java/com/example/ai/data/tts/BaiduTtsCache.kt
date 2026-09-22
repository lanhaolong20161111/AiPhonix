package com.example.ai.data.tts

import android.content.Context
import android.media.MediaPlayer
import android.util.Log
import com.example.ai.di.NetworkModule
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
import kotlin.coroutines.resume

/**
 * 百度 TTS 缓存系统。
 *
 * 1. 通过 REST API 合成语音（text2audio）
 * 2. 将音频文件缓存到本地
 * 3. 后续播放直接读缓存，无需再调用 API
 */
class BaiduTtsCache(
    private val context: Context,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    companion object {
        private const val TAG = "BaiduTtsCache"
        private const val CACHE_DIR = "tts_cache"
        /** 百度在线发音人：5118=度小雯（英式无卷舌），106=度小美情感（美式卷舌） */
        const val SPEAKER_US = "106"
        const val SPEAKER_UK = "5118"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        /** 全局播放锁：整个 App 同一时刻只允许一个 TTS 播放（跨 ViewModel 也互斥，防重音） */
        val playLock = java.util.concurrent.atomic.AtomicBoolean(false)

        /** 当前活动的播放器（全局）：页面销毁时显式停止/释放 */
        @Volatile
        private var activePlayer: android.media.MediaPlayer? = null

        /** 停止并释放当前播放（ViewModel onCleared / 页面返回时调用） */
        fun stopAll() {
            activePlayer?.let { mp ->
                runCatching { if (mp.isPlaying) mp.stop() }
                runCatching { mp.release() }
            }
            activePlayer = null
        }

        /**
         * 长文本按段切分（每段不超过 [maxLen] 字，尽量在标点处断），
         * 规避百度 TTS 单次合成长度限制（长文本直接合成会失败）。
         */
        fun splitForTts(text: String, maxLen: Int = 120): List<String> {
            val t = text.trim()
            if (t.isEmpty()) return emptyList()
            if (t.length <= maxLen) return listOf(t)
            val out = mutableListOf<String>()
            var start = 0
            while (start < t.length) {
                var end = (start + maxLen).coerceAtMost(t.length)
                if (end < t.length) {
                    val cut = t.lastIndexOfAny(charArrayOf('。', '！', '？', '，', '；', ';', ',', '!', '?', '、'), end - 1)
                    if (cut > start) end = cut + 1
                }
                out.add(t.substring(start, end))
                start = end
            }
            return out
        }
    }

    // 缓存放 filesDir（而非 cacheDir）：系统在空间紧张时会清空 cacheDir，导致已合成的字音丢失、重新调 API 计费；
    // 常用字/句音频值得长期保留，filesDir 只在卸载/手动清除时消失
    private val cacheDir = File(context.filesDir, CACHE_DIR).also { it.mkdirs() }

    // ---------- 对外 API ----------

    /**
     * 播放文本的语音。如果本地已缓存则直接播放，否则先下载缓存。
     * @param speaker 百度发音人（美式 106 / 英式 5118）
     * 返回 true 表示播放成功，false 表示失败。
     * **全局播放锁**：已有播放进行中直接返回 false（调用方静默忽略，防止多点喇叭重音）。
     * **下载与播放都不设协程超时**：百度合成偶发 70s+，协程超时会取消播放但阻塞 IO 仍在下载。
     */
    suspend fun play(text: String, speaker: String = SPEAKER_UK, onStarted: (() -> Unit)? = null): Boolean {
        if (!playLock.compareAndSet(false, true)) return false // 播放中：直接拒绝
        return try {
            val file = getOrDownload(text, speaker)
            if (file != null) playFile(file, onStarted) else false
        } finally {
            playLock.set(false)
        }
    }

    /** 清除所有缓存文件 */
    fun clearCache() {
        cacheDir.listFiles()?.forEach { it.delete() }
        Log.d(TAG, "缓存已清除")
    }

    /**
     * 播放远程音频（学生录音等）：注册进全局播放器（stopAll 可立即停止），流式播放。
     * 带 headers（如 JWT 认证）。
     */
    fun playRemote(url: String, headers: Map<String, String> = emptyMap(), onError: ((String) -> Unit)? = null) {
        val mp = MediaPlayer()
        activePlayer = mp
        fun releaseIfCurrent() {
            if (activePlayer === mp) activePlayer = null
            runCatching { mp.release() }
        }
        mp.setOnPreparedListener { it.start() }
        mp.setOnCompletionListener { releaseIfCurrent() }
        mp.setOnErrorListener { _, what, extra ->
            onError?.invoke("播放失败: what=$what extra=$extra")
            releaseIfCurrent()
            true
        }
        try {
            mp.setDataSource(context, android.net.Uri.parse(url), headers)
            mp.prepareAsync()
        } catch (e: Exception) {
            Log.e(TAG, "playRemote 异常: ${e.message}")
            onError?.invoke("播放失败: ${e.message}")
            releaseIfCurrent()
        }
    }

    /**
     * 播放远程音频并**等待播放结束**（区别于 [playRemote] 的即发即忘）。
     *
     * 用途：需要串行的动作，例如古诗的「先读这个字（带拼音锁读）→ 再读这个字的意思」——
     * 若用 [playRemote] 只能靠固定时长硬猜，字还没读完就叠上释义音。
     *
     * 与 [playFile] 同构：注册进全局播放器（[stopAll] 可立即停止），
     * 正常播完/出错/协程取消三种情况都会释放 MediaPlayer。
     *
     * @return true = 正常播完；false = 出错或未开始
     */
    suspend fun playRemoteAndWait(url: String, headers: Map<String, String> = emptyMap()): Boolean =
        suspendCancellableCoroutine { cont ->
            var done = false
            // 只允许一次回调：completion/error/异常竞态时不重复 resume
            fun finish(result: Boolean) {
                if (done) return
                done = true
                if (cont.isActive) cont.resume(result)
            }
            val mp = MediaPlayer()
            activePlayer = mp
            fun releaseIfCurrent() {
                if (activePlayer === mp) activePlayer = null
                runCatching { mp.release() }
            }
            cont.invokeOnCancellation {
                runCatching { if (mp.isPlaying) mp.stop() }
                releaseIfCurrent()
            }
            mp.setOnPreparedListener { it.start() }
            mp.setOnCompletionListener {
                releaseIfCurrent()
                finish(true)
            }
            mp.setOnErrorListener { _, what, extra ->
                Log.w(TAG, "playRemoteAndWait 错误: what=$what extra=$extra")
                releaseIfCurrent()
                finish(false)
                true
            }
            try {
                mp.setDataSource(context, android.net.Uri.parse(url), headers)
                mp.prepareAsync()
            } catch (e: Exception) {
                Log.e(TAG, "playRemoteAndWait 异常: ${e.message}")
                releaseIfCurrent()
                finish(false)
            }
        }

    // ---------- 内部实现 ----------

    private suspend fun getOrDownload(text: String, speaker: String): File? {
        val file = cacheFile(text, speaker)
        if (file.exists()) {
            Log.d(TAG, "缓存命中: $text")
            return file
        }

        Log.d(TAG, "缓存未命中，下载: $text (speaker=$speaker)")
        return download(text, speaker, file)
    }

    private suspend fun download(text: String, speaker: String, file: File): File? {
        val serverUrl = getServerUrl()
        val jsonBody = JSONObject().apply {
            put("text", text)
            put("speaker", speaker)
            put("speed", 5)
        }

        return withContext(Dispatchers.IO) {
            try {
                val body = jsonBody.toString().toRequestBody(JSON_MEDIA_TYPE)
                val request = Request.Builder()
                    .url(serverUrl)
                    .post(body)
                    .build()
                // use{} 确保 Response 被关闭，避免连接泄漏
                client.newCall(request).execute().use { response ->
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
            } catch (e: Exception) {
                Log.w(TAG, "TTS 下载异常（断网或服务端不可达）: ${e.message}")
                null
            }
        }
    }

    private fun getServerUrl(): String {
        // 与全项目统一的服务端地址（ServiceModule.serverBase，随电脑 IP 变更一处修改）
        val base = com.example.ai.di.ServiceModule.serverBase.trimEnd('/')
        return "$base/api/v1/tts/synthesize"
    }

    private suspend fun playFile(file: File, onStarted: (() -> Unit)? = null): Boolean = suspendCancellableCoroutine { cont ->
        var done = false
        // 只允许一次成功回调：completion/error/异常三者竞态时不会重复 resume（协程已完成后 resume 会抛异常）
        fun finish(result: Boolean) {
            if (done) return
            done = true
            if (cont.isActive) cont.resume(result)
        }
        try {
            val mp = MediaPlayer()
            activePlayer = mp // 注册为当前播放器（页面销毁时可显式停止）
            fun releaseIfCurrent() {
                if (activePlayer === mp) activePlayer = null
                runCatching { mp.release() }
            }
            // 协程取消（页面销毁/返回）时停止并释放，保证声音立即停止
            cont.invokeOnCancellation {
                runCatching { if (mp.isPlaying) mp.stop() }
                releaseIfCurrent()
            }
            mp.setDataSource(file.absolutePath)
            mp.setOnPreparedListener {
                onStarted?.invoke() // 播放真正开始时回调（下载/准备完成 → 进入播放阶段）
                mp.start()
            }
            mp.setOnCompletionListener {
                releaseIfCurrent()
                finish(true)
            }
            mp.setOnErrorListener { _, what, extra ->
                Log.w(TAG, "MediaPlayer 错误: what=$what extra=$extra")
                releaseIfCurrent()
                finish(false)
                true
            }
            mp.prepareAsync()
        } catch (e: Exception) {
            Log.e(TAG, "播放文件异常: ${e.message}")
            finish(false)
        }
    }

    private fun cacheFile(text: String, speaker: String): File {
        val hash = MessageDigest.getInstance("MD5")
            .digest((text + "|" + speaker).toByteArray())
            .joinToString("") { "%02x".format(it) }
        return File(cacheDir, "$hash.mp3")
    }
}
