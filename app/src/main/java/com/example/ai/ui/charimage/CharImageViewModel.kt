package com.example.ai.ui.charimage

import android.media.MediaPlayer
import android.media.MediaRecorder
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.audio.AudioRecorder
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.charimage.PendingFeedback
import com.example.ai.data.charimage.PendingFeedbackStore
import com.example.ai.data.progress.CharImageProgressStore
import com.example.ai.data.progress.CharImageProgressStore.LastVisit
import com.example.ai.data.model.PhonemeScore
import com.example.ai.data.model.PronunciationResult
import com.example.ai.data.model.Word
import com.example.ai.data.model.WordScore
import com.example.ai.data.repository.ContentRepository
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.di.NetworkModule
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class CharImageItem(
    val char: String,
    val imageUrl: String,
    val grade: String = "",
    val semester: String = "",
    val type: String = "",
    val pinyin: String = "",
)

data class CharImageUiState(
    val items: List<CharImageItem> = emptyList(),
    val currentIndex: Int = 0,
    val isLoading: Boolean = true,
    val error: String? = null,
    val title: String = "看图识字",
)

/** 单词音标信息（来自本地词库 wordbank/english_vocabulary 的预置拆分） */
data class WordPronInfo(
    val ipa: String,
    val phonemes: List<String>,
    val ipaUk: String = "",
    val phonemesUk: List<String> = emptyList(),
)

/** 服务器 API 返回的 JSON 结构 */
private data class ListResponse(
    val total: Int,
    val items: List<ItemEntry>,
)

private data class ItemEntry(
    val char: String = "",
    val image: String = "",
    val grade: String = "",
    val semester: String = "",
    val type: String = "",
    val pinyin: String = "",
)

class CharImageViewModel(
    private val serverBase: String,
    private val pendingStore: PendingFeedbackStore,
    private val sessionResultStore: com.example.ai.data.training.SessionResultStore,
    private val contentRepository: ContentRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CharImageUiState())
    val uiState: StateFlow<CharImageUiState> = _uiState

    /** 服务端基础地址（拼音音频 URL 拼接用） */
    val serverBaseUrl: String get() = serverBase

    /** 本地词库音标映射（word → IPA + 音素拆分），英词卡片展示音标用 */
    private val _wordPronInfo = MutableStateFlow<Map<String, WordPronInfo>>(emptyMap())
    val wordPronInfo: StateFlow<Map<String, WordPronInfo>> = _wordPronInfo.asStateFlow()
    private var pronMapLoaded = false

    private val _pendingCount = MutableStateFlow(0)
    val pendingCount: StateFlow<Int> = _pendingCount.asStateFlow()

    private val client = NetworkModule.httpClient
    private val gson = Gson()
    private var filterGrade = ""
    private var filterSemester = ""
    private var filterType = ""

    private val _feedbackResult = MutableSharedFlow<String>()
    val feedbackResult: SharedFlow<String> = _feedbackResult

    // SOE 状态
    sealed class SoeState {
        data object Idle : SoeState()
        data class Recording(val text: String) : SoeState()
        data class Done(
            val text: String,
            val score: Int,
            val phonemeScores: List<PhonemeScore> = emptyList(),
            val wordScores: List<WordScore> = emptyList(),
        ) : SoeState()
        data class Error(val text: String, val message: String) : SoeState()
    }

    private val _soeState = MutableStateFlow<SoeState>(SoeState.Idle)
    val soeState: StateFlow<SoeState> = _soeState

    private var speechRepository: SpeechRepository? = null

    fun setSpeechRepository(repo: SpeechRepository) {
        speechRepository = repo
    }

    /** 开始 SOE 测评 */
    fun startSoe(text: String) {
        val repo = speechRepository ?: return
        _soeState.value = SoeState.Recording(text)
        viewModelScope.launch {
            try {
                val result: PronunciationResult = withContext(Dispatchers.IO) {
                    repo.startStreamingEvaluation(
                            Word(
                                text = text, ipa = "",
                                letter = text.firstOrNull()?.toString() ?: "",
                                phonemes = emptyList(),
                            )
                        )
                }
                val score = result.totalScore
                _soeState.value = SoeState.Done(
                    text = text,
                    score = score,
                    phonemeScores = result.phonemeScores,
                    wordScores = result.wordScores,
                )
                // 跟读即录音：把本次录音保存到服务器（覆盖旧录音），供"播放"回放
                saveLastRecording(text)
            } catch (e: Exception) {
                Log.e(TAG, "SOE失败", e)
                _soeState.value = SoeState.Error(text, e.message ?: "未知错误")
            }
        }
    }

    /** 停止 SOE 测评（结束录音） */
    fun stopSoe() {
        speechRepository?.stopStreamingEvaluation()
    }

    /**
     * 跟读评测完成后，把最近一次录音保存到服务器（覆盖旧录音），供"播放"回放。
     * 上传失败不影响评分显示，仅提示。
     */
    private fun saveLastRecording(char: String) {
        val pcm = speechRepository?.takeLastRecordingPcm() ?: return
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val wav = pcmToWav(pcm)
                    val url = "$serverBase/api/v1/char-images/audio?char=$char"
                    val requestBody = MultipartBody.Builder()
                        .setType(MultipartBody.FORM)
                        .addFormDataPart("char", char)
                        .addFormDataPart("file", "${char}.mp3",
                            wav.toRequestBody("audio/wav".toMediaType()))
                        .build()
                    val request = Request.Builder().url(url).post(requestBody).build()
                    val resp = client.newCall(request).execute()
                    if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
                    _hasAudioSet.value = _hasAudioSet.value + char
                }
                _audioResult.emit("录音已保存，可点播放回听")
            } catch (e: Exception) {
                Log.e(TAG, "保存跟读录音失败", e)
                _audioResult.emit(networkErrorMsg(e))
            }
        }
    }

    /** PCM(16kHz/mono/16bit) 加 WAV 头，生成可播放的 WAV 字节流 */
    private fun pcmToWav(pcm: ByteArray, sampleRate: Int = AudioRecorder.SAMPLE_RATE): ByteArray {
        val dataSize = pcm.size
        val byteRate = sampleRate * 2 // 16bit mono
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray(Charsets.US_ASCII))
            putInt(36 + dataSize)
            put("WAVE".toByteArray(Charsets.US_ASCII))
            put("fmt ".toByteArray(Charsets.US_ASCII))
            putInt(16)          // fmt chunk size
            putShort(1)         // PCM
            putShort(1)         // mono
            putInt(sampleRate)
            putInt(byteRate)
            putShort(2)         // block align
            putShort(16)        // bits per sample
            put("data".toByteArray(Charsets.US_ASCII))
            putInt(dataSize)
        }
        return header.array() + pcm
    }

    // ── 录音/播放 ──

    private val _recordingChar = MutableStateFlow<String?>(null)
    private var mediaRecorder: MediaRecorder? = null
    private var mediaPlayer: MediaPlayer? = null
    private var tempAudioFile: File? = null

    private val _audioResult = MutableSharedFlow<String>()  // "ok" | error message
    val audioResult: SharedFlow<String> = _audioResult

    val isRecording get() = _recordingChar.value != null
    val recordingChar: StateFlow<String?> = _recordingChar.asStateFlow()

    private val _playingChar = MutableStateFlow<String?>(null)
    val playingChar: StateFlow<String?> = _playingChar

    private val _hasAudioSet = MutableStateFlow<Set<String>>(emptySet())
    val hasAudioSet: StateFlow<Set<String>> = _hasAudioSet

    fun hasAudio(char: String): Boolean = _hasAudioSet.value.contains(char)

    /** 检查某个字是否有录音文件 */
    fun checkAudioExists(char: String) {
        if (_hasAudioSet.value.contains(char)) return // 已查过
        val safeName = encodeAudioName(char)
        viewModelScope.launch {
            try {
                val url = "$serverBase/api/v1/char-images/audio/$safeName/exists"
                val resp = withContext(Dispatchers.IO) {
                    val req = Request.Builder().url(url).get().build()
                    client.newCall(req).execute()
                }
                if (resp.isSuccessful) {
                    val body = resp.body?.string()
                    if (body != null) {
                        val result = gson.fromJson(body, Map::class.java)
                        if (result?.get("exists") == true) {
                            _hasAudioSet.value = _hasAudioSet.value + char
                        }
                    }
                }
            } catch (_: Exception) {
                // 静默失败，播放时再提示
            }
        }
    }

    /** 切换录音状态 */
    fun toggleRecord(char: String) {
        if (_recordingChar.value != null) {
            // 停止录音
            stopRecording(char)
        } else {
            // 开始录音
            startRecording(char)
        }
    }

    private fun startRecording(char: String) {
        try {
            val tempDir = java.io.File(
                System.getProperty("java.io.tmpdir") ?: "/tmp"
            )
            tempAudioFile = java.io.File(tempDir, "char_audio_${char.hashCode()}.mp3")
            mediaRecorder = MediaRecorder().apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setOutputFile(tempAudioFile!!.absolutePath)
                prepare()
                start()
            }
            _recordingChar.value = char
            Log.d(TAG, "开始录音: $char")
        } catch (e: Exception) {
            Log.e(TAG, "启动录音失败", e)
            viewModelScope.launch { _audioResult.emit("启动录音失败") }
        }
    }

    private fun stopRecording(char: String) {
        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
            mediaRecorder = null
            _recordingChar.value = null
            Log.d(TAG, "录音结束: $char")
            // 上传到服务器
            uploadAudio(char)
        } catch (e: Exception) {
            Log.e(TAG, "停止录音失败", e)
            mediaRecorder = null
            _recordingChar.value = null
            viewModelScope.launch { _audioResult.emit("停止录音失败") }
        }
    }

    private fun uploadAudio(char: String) {
        val file = tempAudioFile ?: return
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val url = "$serverBase/api/v1/char-images/audio?char=$char"
                    val requestBody = MultipartBody.Builder()
                        .setType(MultipartBody.FORM)
                        .addFormDataPart("char", char)
                        .addFormDataPart("file", "${char}.mp3",
                            file.readBytes().toRequestBody("audio/mpeg".toMediaType()))
                        .build()
                    val request = Request.Builder()
                        .url(url)
                        .post(requestBody)
                        .build()
                    val resp = client.newCall(request).execute()
                    if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
                    _hasAudioSet.value = _hasAudioSet.value + char
                }
                file.delete()
                tempAudioFile = null
                _audioResult.emit("ok")
            } catch (e: Exception) {
                Log.e(TAG, "上传录音失败", e)
                _audioResult.emit(networkErrorMsg(e))
            }
        }
    }

    /** 切换播放状态 */
    fun togglePlayback(char: String) {
        if (_playingChar.value == char) {
            // 正在播放当前字 → 暂停
            mediaPlayer?.pause()
            _playingChar.value = null
        } else {
            // 停止之前的播放
            mediaPlayer?.let {
                it.stop()
                it.release()
            }
            mediaPlayer = null
            // 开始播放新字
            playAudio(char)
        }
    }

    private fun playAudio(char: String) {
        val safeName = encodeAudioName(char)
        val url = "$serverBase/api/v1/char-images/audio/$safeName.mp3"
        viewModelScope.launch {
            try {
                mediaPlayer = MediaPlayer().apply {
                    setDataSource(url)
                    setOnPreparedListener {
                        start()
                        _playingChar.value = char
                    }
                    setOnCompletionListener {
                        _playingChar.value = null
                    }
                    setOnErrorListener { _, _, _ ->
                        _playingChar.value = null
                        viewModelScope.launch {
                            _audioResult.emit("发音播放失败，请检查网络")
                        }
                        false
                    }
                    prepareAsync()
                }
            } catch (e: Exception) {
                Log.e(TAG, "播放失败", e)
                _playingChar.value = null
                viewModelScope.launch { _audioResult.emit(networkErrorMsg(e)) }
            }
        }
    }

    companion object {
        private const val TAG = "CharImageVM"

        /** 将 char 转成 URL 安全的音频文件名（中文卡无空格；英文词/句含空格需编码） */
        private fun encodeAudioName(char: String): String {
            return char.replace("/", "_")
                .replace("\\", "_")
                .replace(":", "_")
                .replace(" ", "%20")
                .replace("'", "%27")
        }

        /** 将异常转为用户可读的错误消息 */
        private fun networkErrorMsg(e: Exception): String {
            return when (e) {
                is java.net.UnknownHostException -> "DNS解析失败，请检查网络连接"
                is java.net.ConnectException -> "无法连接服务器，请检查服务器是否启动"
                is java.net.SocketTimeoutException -> "连接超时，请检查网络"
                is java.net.SocketException -> "网络连接断开"
                is java.net.HttpRetryException -> "服务器繁忙，请稍后重试"
                else -> {
                    val msg = e.message ?: ""
                    if (msg.startsWith("HTTP ")) "服务器错误(${msg})"
                    else "网络有问题: ${msg.take(50)}"
                }
            }
        }
    }

    /** 懒加载 ipa/phonemes 映射：服务端英词条目优先（533 全量），本地词库回退 */
    fun ensureWordPronInfo() {
        if (pronMapLoaded) return
        pronMapLoaded = true
        viewModelScope.launch {
            try {
                val map = withContext(Dispatchers.IO) {
                    buildMap {
                        contentRepository.getAllWords().forEach { put(it.text, WordPronInfo(it.ipa, it.phonemes, it.ipaUk, it.phonemesUk)) }
                        contentRepository.getAllEnglishWords().forEach { put(it.word, WordPronInfo(it.phonetic, it.phonemes, it.ipaUk, it.phonemesUk)) }
                        fetchServerPronInfo()?.forEach { (w, info) -> put(w, info) }
                    }
                }
                _wordPronInfo.value = map
            } catch (e: Exception) {
                // 读取失败：不显示音标即可，不影响主流程
            }
        }
    }

    /**
     * 从服务端拉取英词条目的 ipa/phonemes（char_image_index.json 已含生成结果）。
     * ⚠️ 查询参数名是 **`type`**，不是 `type_` —— 服务端 `char_images.ts` 只读 `c.req.query("type")`。
     *    传 `type_` 会被静默忽略（实测：`type=认` → 816 条，`type_=认` → 3028 条全量）。
     */
    private fun fetchServerPronInfo(): Map<String, WordPronInfo>? = try {
        val url = "$serverBase/api/v1/char-images?type=${java.net.URLEncoder.encode("英词", "UTF-8")}&limit=1000"
        val text = client.newCall(
            okhttp3.Request.Builder().url(url).build()
        ).execute().use { resp ->
            if (!resp.isSuccessful) return null
            resp.body?.string() ?: return null
        }
        val json = org.json.JSONObject(text)
        val items = json.optJSONArray("items") ?: return null
        buildMap {
            for (i in 0 until items.length()) {
                val it = items.optJSONObject(i) ?: continue
                val w = it.optString("char").lowercase()
                val ipa = it.optString("ipa")
                val ipaUk = it.optString("ipa_uk")
                val phArr = it.optJSONArray("phonemes")
                val phUkArr = it.optJSONArray("phonemes_uk")
                if (w.isNotEmpty() && ipa.isNotEmpty() && phArr != null && phArr.length() > 0) {
                    val ph = buildList { for (j in 0 until phArr.length()) add(phArr.optString(j)) }
                    val phUk = if (phUkArr != null && phUkArr.length() > 0) buildList { for (j in 0 until phUkArr.length()) add(phUkArr.optString(j)) } else emptyList()
                    put(w, WordPronInfo(ipa, ph, ipaUk, phUk))
                }
            }
        }
    } catch (e: Exception) {
        null
    }

    /** 按年级/学期/类型加载图片，每次导航到新参数都会触发 */
    fun load(grade: String, semester: String, type_: String) {
        filterGrade = grade
        filterSemester = semester
        filterType = type_
        ensureWordPronInfo()
        loadCharImages()
    }

    private fun loadCharImages() {
        viewModelScope.launch {
            _uiState.value = CharImageUiState(isLoading = true)
            try {
                val result = withContext(Dispatchers.IO) {
                    val urlBuilder = StringBuilder("$serverBase/api/v1/char-images?limit=1000")
                    if (filterGrade.isNotEmpty()) urlBuilder.append("&grade=$filterGrade")
                    if (filterSemester.isNotEmpty()) urlBuilder.append("&semester=$filterSemester")
                    // ⚠️ 必须是 `type=`（服务端只认这个名）；写成 `type_=` 会被忽略 → 识字/写字/词语表全都显示同一份混合内容
                    if (filterType.isNotEmpty()) urlBuilder.append("&type=$filterType")

                    val url = urlBuilder.toString()
                    Log.d(TAG, "Fetching URL: $url")
                    val request = Request.Builder()
                        .url(url)
                        .get()
                        .build()
                    val response = client.newCall(request).execute()
                    if (!response.isSuccessful) {
                        throw RuntimeException("服务器错误: ${response.code}")
                    }
                    val body = response.body?.string() ?: throw RuntimeException("响应为空")
                    Log.d(TAG, "API returned: ${body.take(200)}...")
                    parseList(body)
                }
                val title = buildTitle()
                // 恢复上次浏览位置（per 列表记忆，越界则回 0）
                val saved = CharImageProgressStore.getPosition(
                    TokenManager.userId, filterGrade, filterSemester, filterType
                )
                val startIndex = if (saved in 0 until result.size) saved else 0
                _uiState.value = CharImageUiState(
                    items = result, isLoading = false, title = title, currentIndex = startIndex,
                )
            } catch (e: Exception) {
                Log.e(TAG, "加载失败", e)
                _uiState.value = CharImageUiState(
                    isLoading = false,
                    error = e.message ?: "未知错误",
                )
            }
        }
    }

    private fun buildTitle(): String {
        val gradeStr = when (filterGrade to filterSemester) {
            "二年级" to "上" -> "二年级上册"
            "二年级" to "下" -> "二年级下册"
            "三年级" to "上" -> "三年级上册"
            else -> "${filterGrade}${filterSemester}"
        }
        val typeStr = when (filterType) {
            "认" -> "识字表"
            "写" -> "写字表"
            "词" -> "词语表"
            "英词" -> "英语词汇表"
            "英句" -> "英语句子表"
            else -> "全部"
        }
        return if (gradeStr.isBlank()) typeStr else "$gradeStr · $typeStr"
    }

    // V2：本轮会话浏览过的字（去重）与提交过的“认识”数；返回首页时若浏览≥3 字即算完成
    private val viewedChars = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val knownChars = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    private fun recordProgress() {
        val itemId = com.example.ai.data.training.ActiveTrainingSession.itemId ?: return
        if (viewedChars.size < 3) return // 低于完成标准不 record → 返回首页不打卡
        sessionResultStore.record(
            itemId,
            com.example.ai.data.training.PlanResult(
                count = viewedChars.size,
                correct = knownChars.size,
            )
        )
    }

    fun setCurrentIndex(index: Int) {
        val s = _uiState.value
        if (index in s.items.indices) {
            viewedChars.add(s.items[index].char)
            recordProgress()
        }
        _uiState.value = s.copy(currentIndex = index)
        // 翻页即持久化：正常退出/意外退出后都能恢复到上次位置
        if (filterType.isNotEmpty()) {
            CharImageProgressStore.savePosition(
                TokenManager.userId, filterGrade, filterSemester, filterType, index,
            )
            CharImageProgressStore.saveLastVisit(
                TokenManager.userId,
                LastVisit(filterGrade, filterSemester, filterType, index),
            )
        }
    }

    /** 提交图片反馈：服务器不可达时暂存本地，联网后自动同步 */
    fun submitFeedback(
        char: String, grade: String, semester: String, type_: String,
        learningStatus: String?,
    ) {
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) {
                try {
                    sendFeedback(char, grade, semester, type_, learningStatus)
                    true
                } catch (e: Exception) {
                    Log.e(TAG, "反馈提交失败，暂存本地待同步", e)
                    pendingStore.add(PendingFeedback(char, grade, semester, type_, learningStatus))
                    false
                }
            }
            refreshPendingCount()
            // V2：反馈提交（无论成败，本地视角也算“看过”）→ 更新完成度
            knownChars.add(if (learningStatus == "correct") char else "") // 占位防重复添加；下面统一按状态处理
            knownChars.remove("")
            if (learningStatus == "correct") knownChars.add(char)
            viewedChars.add(char)
            recordProgress()
            if (ok) {
                _feedbackResult.emit("ok")
                // 提交成功说明网络可用，顺带把历史暂存记录一起同步
                flushPendingFeedback()
            } else {
                _feedbackResult.emit("⚠️ 无法连接服务器，已暂存本地，联网后自动同步")
            }
        }
    }

    /** 重发所有暂存反馈，成功后移除（网络恢复时调用） */
    private val flushing = java.util.concurrent.atomic.AtomicBoolean(false)

    fun flushPendingFeedback() {
        // 防重入：多个触发点（进页面/网络恢复/resume）并发时只执行一次
        if (!flushing.compareAndSet(false, true)) return
        viewModelScope.launch {
            try {
                // 网络恢复早期（Wi-Fi 刚关联、TCP 未就绪）可能失败，重试几次覆盖就绪窗口
                repeat(3) {
                    val pending = withContext(Dispatchers.IO) { pendingStore.load() }
                    if (pending.isEmpty()) return@launch
                    val synced = withContext(Dispatchers.IO) {
                        pending.filter { item ->
                            try {
                                sendFeedback(item.char, item.grade, item.semester, item.type, item.learningStatus)
                                true
                            } catch (e: Exception) {
                                false
                            }
                        }
                    }
                    if (synced.isNotEmpty()) {
                        withContext(Dispatchers.IO) { pendingStore.removeAll(synced) }
                        refreshPendingCount()
                        _feedbackResult.emit("✅ 已自动同步 ${synced.size} 条暂存记录")
                        return@launch
                    }
                    delay(3000)
                }
            } finally {
                flushing.set(false)
            }
        }
    }

    /** 从本地暂存队列刷新待同步数量（进入页面时展示提示条） */
    fun refreshPendingCount() {
        viewModelScope.launch {
            _pendingCount.value = withContext(Dispatchers.IO) { pendingStore.load().size }
        }
    }

    private fun sendFeedback(
        char: String, grade: String, semester: String, type_: String,
        learningStatus: String?,
    ) {
        val url = "$serverBase/api/v1/char-images/feedback"
        val body = gson.toJson(mapOf(
            "user_id" to TokenManager.userId,
            "char" to char,
            "grade" to grade,
            "semester" to semester,
            "type" to type_,
            "learning_status" to learningStatus,
        )).toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(url)
            .post(body)
            .build()
        val resp = client.newCall(request).execute()
        if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
    }

    private fun parseList(json: String): List<CharImageItem> {
        val resp = gson.fromJson(json, ListResponse::class.java)
        return resp.items.map { entry ->
            CharImageItem(
                char = entry.char,
                imageUrl = "$serverBase/api/v1/char-images/file/${entry.image}",
                grade = entry.grade,
                semester = entry.semester,
                type = entry.type,
                pinyin = entry.pinyin,
            )
        }
    }
}
