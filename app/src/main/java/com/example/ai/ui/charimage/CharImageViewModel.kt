package com.example.ai.ui.charimage

import android.media.MediaPlayer
import android.media.MediaRecorder
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.PronunciationResult
import com.example.ai.data.model.Word
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.di.NetworkModule
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

data class CharImageItem(
    val char: String,
    val imageUrl: String,
    val grade: String = "",
    val semester: String = "",
    val type: String = "",
)

data class CharImageUiState(
    val items: List<CharImageItem> = emptyList(),
    val currentIndex: Int = 0,
    val isLoading: Boolean = true,
    val error: String? = null,
    val title: String = "看图识字",
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
)

class CharImageViewModel(
    private val serverBase: String,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CharImageUiState())
    val uiState: StateFlow<CharImageUiState> = _uiState

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
        data class Done(val text: String, val score: Int) : SoeState()
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
                _soeState.value = SoeState.Done(text, score)
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

    // ── 录音/播放 ──

    private var _recordingChar: String? = null
    private var mediaRecorder: MediaRecorder? = null
    private var mediaPlayer: MediaPlayer? = null
    private var tempAudioFile: File? = null

    private val _audioResult = MutableSharedFlow<String>()  // "ok" | error message
    val audioResult: SharedFlow<String> = _audioResult

    val isRecording get() = _recordingChar != null
    val recordingChar get() = _recordingChar

    private val _playingChar = MutableStateFlow<String?>(null)
    val playingChar: StateFlow<String?> = _playingChar

    private val _hasAudioSet = MutableStateFlow<Set<String>>(emptySet())
    val hasAudioSet: StateFlow<Set<String>> = _hasAudioSet

    fun hasAudio(char: String): Boolean = _hasAudioSet.value.contains(char)

    /** 检查某个字是否有录音文件 */
    fun checkAudioExists(char: String) {
        if (_hasAudioSet.value.contains(char)) return // 已查过
        val safeName = char.replace("/", "_").replace("\\", "_").replace(":", "_")
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
        if (_recordingChar != null) {
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
            _recordingChar = char
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
            _recordingChar = null
            Log.d(TAG, "录音结束: $char")
            // 上传到服务器
            uploadAudio(char)
        } catch (e: Exception) {
            Log.e(TAG, "停止录音失败", e)
            mediaRecorder = null
            _recordingChar = null
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
        val safeName = char.replace("/", "_").replace("\\", "_").replace(":", "_")
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

    /** 按年级/学期/类型加载图片，每次导航到新参数都会触发 */
    fun load(grade: String, semester: String, type_: String) {
        filterGrade = grade
        filterSemester = semester
        filterType = type_
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
                    if (filterType.isNotEmpty()) urlBuilder.append("&type_=$filterType")

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
                _uiState.value = CharImageUiState(items = result, isLoading = false, title = title)
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
        return "$gradeStr · $typeStr"
    }

    fun setCurrentIndex(index: Int) {
        _uiState.value = _uiState.value.copy(currentIndex = index)
    }

    /** 提交图片反馈 */
    fun submitFeedback(
        char: String, grade: String, semester: String, type_: String,
        learningStatus: String?, needsRegen: Boolean,
    ) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val url = "$serverBase/api/v1/char-images/feedback"
                    val body = gson.toJson(mapOf(
                        "char" to char,
                        "grade" to grade,
                        "semester" to semester,
                        "type" to type_,
                        "learning_status" to learningStatus,
                        "needs_regen" to needsRegen,
                    )).toRequestBody("application/json".toMediaType())
                    val request = Request.Builder()
                        .url(url)
                        .post(body)
                        .build()
                    val resp = client.newCall(request).execute()
                    if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
                }
                _feedbackResult.emit("ok")
            } catch (e: Exception) {
                Log.e(TAG, "反馈提交失败", e)
                _feedbackResult.emit(networkErrorMsg(e))
            }
        }
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
            )
        }
    }
}
