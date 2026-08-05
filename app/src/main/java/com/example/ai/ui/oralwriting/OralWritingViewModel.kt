package com.example.ai.ui.oralwriting

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.k2fsa.sherpa.onnx.OralAsrEngine
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** 作文题目 */
data class EssayTopic(
    val id: Int,
    val title: String,
    val content: String,
    val gradeLevel: Int = 2,
)

/** 段落结构 */
data class EssaySection(
    val label: String,
    val guide: String,
)

/** 口述作文 UI 状态 */
data class OralWritingUiState(
    // 列表阶段
    val topics: List<EssayTopic> = emptyList(),
    val isLoadingTopics: Boolean = true,
    // 当前阶段
    val phase: Phase = Phase.TopicSelection,
    // 写作阶段
    val selectedTopic: EssayTopic? = null,
    val sections: List<EssaySection> = emptyList(),
    val currentSectionIndex: Int = 0,
    val sectionTexts: MutableList<String> = MutableList(4) { "" },
    val currentInput: String = "",
    val isGeneratingStructure: Boolean = false,
    // 提示
    val currentHint: String = "",
    val isGeneratingHint: Boolean = false,
    val stuckDurationMs: Long = 0,
    // 结果阶段
    val formattedText: String = "",
    val feedback: String = "",
    val isFormatting: Boolean = false,
    val isScoring: Boolean = false,
    // 通用
    val error: String? = null,
    // 语音输入
    val isRecording: Boolean = false,
    val asrTranscription: String = "",
    // 过渡状态
    val isTransitioning: Boolean = false,
) {
    enum class Phase {
        TopicSelection,
        Writing,
        Result,
    }
}

class OralWritingViewModel(
    private val serverBase: String = ServiceModule.serverBase,
    private val sessionResultStore: com.example.ai.data.training.SessionResultStore = com.example.ai.data.training.SessionResultStore(),
) : ViewModel() {


    // V2：本次写作开始时间（finishWriting 时计算耗时）
    private var startTimeMs: Long = 0

    private val _uiState = MutableStateFlow(OralWritingUiState())

    val uiState: StateFlow<OralWritingUiState> = _uiState

    private val client = NetworkModule.httpClient
    private val gson = Gson()
    private val JSON = "application/json; charset=utf-8".toMediaType()

    // ASR 引擎
    private var asrEngine: OralAsrEngine? = null

    /** 初始化 ASR 引擎（从 Screen 调用，传入 AssetManager） */
    fun initAsrEngine(assetManager: android.content.res.AssetManager) {
        if (asrEngine == null) {
            asrEngine = OralAsrEngine(assetManager)
            viewModelScope.launch(Dispatchers.IO) {
                val ok = asrEngine?.init() ?: false
                if (!ok) {
                    _uiState.value = _uiState.value.copy(error = "语音模型加载失败")
                }
            }
        }
    }

    /** 开始语音输入 */
    fun startVoiceInput() {
        val engine = asrEngine ?: return
        if (engine.isRecording) return
        _uiState.value = _uiState.value.copy(isRecording = true, asrTranscription = "")
        viewModelScope.launch(Dispatchers.IO) {
            val result = engine.startRecording(onPartial = { partial ->
                _uiState.value = _uiState.value.copy(asrTranscription = partial)
            })
            val finalText = result.getOrNull() ?: ""
            _uiState.value = _uiState.value.copy(isRecording = false, asrTranscription = "")
            if (finalText.isNotBlank()) {
                updateCurrentInput(finalText)
            } else {
                result.onFailure { e ->
                    Log.e(TAG, "语音识别失败", e)
                    _uiState.value = _uiState.value.copy(error = "语音识别失败: ${e.message}")
                }
            }
        }
    }

    /** 停止语音输入 */
    fun stopVoiceInput() {
        asrEngine?.stopRecording()
        _uiState.value = _uiState.value.copy(isRecording = false)
    }

    init {
        loadTopics()
    }

    companion object {
        private const val TAG = "OralWritingVM"
    }

    /** 加载作文题目列表 */
    fun loadTopics() {
        viewModelScope.launch(Dispatchers.IO) {
            _uiState.value = _uiState.value.copy(isLoadingTopics = true, error = null)
            try {
                val url = "$serverBase/api/v1/essays"
                val request = Request.Builder().url(url).get().build()
                val response = client.newCall(request).execute()
                if (!response.isSuccessful) throw Exception("HTTP ${response.code}")
                val body = response.body?.string() ?: throw Exception("空响应")
                val json = gson.fromJson(body, Map::class.java)
                val rawList = json["essays"] as? List<Map<String, Any>> ?: emptyList()
                val topics = rawList.map { map ->
                    EssayTopic(
                        id = (map["id"] as? Number)?.toInt() ?: 0,
                        title = (map["title"] as? String) ?: "",
                        content = (map["content"] as? String) ?: "",
                        gradeLevel = (map["gradeLevel"] as? Number)?.toInt() ?: 2,
                    )
                }
                _uiState.value = _uiState.value.copy(topics = topics, isLoadingTopics = false)
            } catch (e: Exception) {
                Log.e(TAG, "加载题目失败", e)
                val errMsg = "加载题目失败: ${e.javaClass.simpleName}: ${e.message}"
                _uiState.value = _uiState.value.copy(isLoadingTopics = false, error = errMsg)
            }
        }
    }

    /** 选择题目，生成结构 */
    fun selectTopic(topic: EssayTopic) {
        startTimeMs = System.currentTimeMillis()
        _uiState.value = _uiState.value.copy(

            selectedTopic = topic,
            phase = OralWritingUiState.Phase.Writing,
            isGeneratingStructure = true,
            error = null,
        )
        generateStructure(topic)
    }

    private fun generateStructure(topic: EssayTopic) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val url = "$serverBase/api/v1/essays/structure"
                val bodyJson = gson.toJson(mapOf(
                    "title" to topic.title,
                    "content" to topic.content,
                    "gradeLevel" to topic.gradeLevel,
                ))
                val request = Request.Builder().url(url)
                    .post(bodyJson.toRequestBody(JSON))
                    .build()
                val response = client.newCall(request).execute()
                if (!response.isSuccessful) throw Exception("HTTP ${response.code}")
                val body = response.body?.string() ?: throw Exception("空响应")
                val json = gson.fromJson(body, Map::class.java)
                val rawSections = json["sections"] as? List<Map<String, String>> ?: emptyList()
                val sections = rawSections.map { EssaySection(it["label"] ?: "", it["guide"] ?: "") }
                _uiState.value = _uiState.value.copy(
                    sections = sections,
                    sectionTexts = MutableList(sections.size) { "" },
                    isGeneratingStructure = false,
                )
            } catch (e: Exception) {
                Log.e(TAG, "生成结构失败", e)
                // fallback sections
                val fallback = listOf(
                    EssaySection("开头", "介绍这个主题"),
                    EssaySection("内容", "说说具体内容"),
                    EssaySection("结尾", "总结你的想法"),
                )
                _uiState.value = _uiState.value.copy(
                    sections = fallback,
                    sectionTexts = MutableList(fallback.size) { "" },
                    isGeneratingStructure = false,
                    error = "无法连接服务器，已使用默认写作框架",
                )
            }
        }
    }

    /** 更新当前段落的输入文本（直接保存到 sectionTexts） */
    fun updateCurrentInput(text: String) {
        val idx = _uiState.value.currentSectionIndex
        val texts = _uiState.value.sectionTexts.toMutableList()
        if (idx < texts.size) {
            texts[idx] = text
            _uiState.value = _uiState.value.copy(sectionTexts = texts)
        }
    }

    /** 提交当前段落文本（确认保存，实际已通过 updateCurrentInput 写入） */
    fun submitCurrentSection() {
        // 文字已实时写入 sectionTexts，此方法仅清除提示/计时等状态
        _uiState.value = _uiState.value.copy(currentHint = "", stuckDurationMs = 0)
    }

    /** 前进到下一段（带 500ms 过渡，清空识别缓存） */
    fun advanceSection() {
        val state = _uiState.value
        val nextIdx = state.currentSectionIndex + 1
        if (nextIdx >= state.sections.size) return
        // 立即停止录音，防止识别结果写入错误段落
        asrEngine?.stopRecording()
        // 进入过渡：禁用按钮 + 清空识别缓存
        _uiState.value = state.copy(
            isTransitioning = true,
            isRecording = false,
            asrTranscription = "",
            currentHint = "",
        )
        viewModelScope.launch {
            delay(500L)
            _uiState.value = _uiState.value.copy(
                currentSectionIndex = nextIdx,
                isTransitioning = false,
                stuckDurationMs = 0,
            )
        }
    }

    /** 后退到上一段（带 500ms 过渡，清空识别缓存） */
    fun previousSection() {
        val state = _uiState.value
        val prevIdx = state.currentSectionIndex - 1
        if (prevIdx < 0) return
        // 立即停止录音，防止识别结果写入错误段落
        asrEngine?.stopRecording()
        // 进入过渡：禁用按钮 + 清空识别缓存
        _uiState.value = state.copy(
            isTransitioning = true,
            isRecording = false,
            asrTranscription = "",
            currentHint = "",
        )
        viewModelScope.launch {
            delay(500L)
            _uiState.value = _uiState.value.copy(
                currentSectionIndex = prevIdx,
                isTransitioning = false,
                stuckDurationMs = 0,
            )
        }
    }

    /** 请求 LLM 提示 */
    fun requestHint(hintType: String = "帮我提示一下") {
        val state = _uiState.value
        val topic = state.selectedTopic ?: return
        val section = state.sections.getOrNull(state.currentSectionIndex) ?: return

        _uiState.value = state.copy(isGeneratingHint = true, currentHint = "")
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val url = "$serverBase/api/v1/essays/hint"
                val bodyJson = gson.toJson(mapOf(
                    "title" to topic.title,
                    "content" to topic.content,
                    "sectionLabel" to section.label,
                    "sectionGuide" to section.guide,
                    "studentText" to state.sectionTexts[state.currentSectionIndex],
                    "hintType" to hintType,
                    "stuckDurationMs" to state.stuckDurationMs,
                ))
                val request = Request.Builder().url(url)
                    .post(bodyJson.toRequestBody(JSON))
                    .build()
                val response = client.newCall(request).execute()
                if (!response.isSuccessful) throw Exception("HTTP ${response.code}")
                val body = response.body?.string() ?: throw Exception("空响应")
                val json = gson.fromJson(body, Map::class.java)
                val hint = (json["hint"] as? String) ?: ""
                _uiState.value = _uiState.value.copy(isGeneratingHint = false, currentHint = hint)
            } catch (e: Exception) {
                Log.e(TAG, "请求提示失败", e)
                _uiState.value = _uiState.value.copy(isGeneratingHint = false, error = "请求提示失败，请检查网络")
            }
        }
    }

    /** 完成写作，提交评分和润饰 */
    fun finishWriting() {
        submitCurrentSection() // 先提交当前段
        val state = _uiState.value
        val topic = state.selectedTopic ?: return

        _uiState.value = state.copy(
            phase = OralWritingUiState.Phase.Result,
            isFormatting = true,
            isScoring = true,
        )

        // V2：写作完成进入结果页即达完成标准，回传真实结果（返回首页时打卡）
        val itemId = com.example.ai.data.training.ActiveTrainingSession.itemId
        if (itemId != null) {
            sessionResultStore.record(
                itemId,
                com.example.ai.data.training.PlanResult(
                    count = state.sectionTexts.count { it.isNotBlank() },
                    durationMs = (System.currentTimeMillis() - startTimeMs).coerceAtLeast(0),
                )
            )
        }


        // 并发请求格式化和评分
        viewModelScope.launch(Dispatchers.IO) {
            formatEssay()
        }
        viewModelScope.launch(Dispatchers.IO) {
            scoreEssay()
        }
    }

    private suspend fun formatEssay() {
        val state = _uiState.value
        val topic = state.selectedTopic ?: return
        try {
            val url = "$serverBase/api/v1/essays/format"
            val sectionList = state.sections.map { mapOf("label" to it.label, "guide" to it.guide) }
            val bodyJson = gson.toJson(mapOf(
                "sections" to sectionList,
                "sectionTexts" to state.sectionTexts,
            ))
            val request = Request.Builder().url(url)
                .post(bodyJson.toRequestBody(JSON))
                .build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) throw Exception("HTTP ${response.code}")
            val body = response.body?.string() ?: throw Exception("空响应")
            val json = gson.fromJson(body, Map::class.java)
            val formatted = (json["formatted"] as? String) ?: ""
            _uiState.value = _uiState.value.copy(formattedText = formatted, isFormatting = false)
        } catch (e: Exception) {
            Log.e(TAG, "润饰失败", e)
            _uiState.value = _uiState.value.copy(isFormatting = false, error = "润色失败，请检查网络")
        }
    }

    private suspend fun scoreEssay() {
        val state = _uiState.value
        val topic = state.selectedTopic ?: return
        try {
            val url = "$serverBase/api/v1/essays/score"
            val sectionList = state.sections.map { mapOf("label" to it.label, "guide" to it.guide) }
            val finalText = state.sectionTexts.joinToString("\n") { it }
            val bodyJson = gson.toJson(mapOf(
                "title" to topic.title,
                "content" to topic.content,
                "sections" to sectionList,
                "sectionTexts" to state.sectionTexts,
                "finalText" to finalText,
            ))
            val request = Request.Builder().url(url)
                .post(bodyJson.toRequestBody(JSON))
                .build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) throw Exception("HTTP ${response.code}")
            val body = response.body?.string() ?: throw Exception("空响应")
            val json = gson.fromJson(body, Map::class.java)
            val feedback = (json["feedback"] as? String) ?: ""
            _uiState.value = _uiState.value.copy(feedback = feedback, isScoring = false)
        } catch (e: Exception) {
            Log.e(TAG, "评分失败", e)
            _uiState.value = _uiState.value.copy(isScoring = false, error = "评分失败，请检查网络")
        }
    }

    /** 返回题目选择 */
    fun backToTopics() {
        _uiState.value = OralWritingUiState(topics = _uiState.value.topics, phase = OralWritingUiState.Phase.TopicSelection)
    }

    /** 重新开始 */
    fun retry() {
        _uiState.value = _uiState.value.copy(
            phase = OralWritingUiState.Phase.TopicSelection,
            sections = emptyList(),
            sectionTexts = mutableListOf(),
            currentInput = "",
            currentHint = "",
            formattedText = "",
            feedback = "",
            error = null,
        )
    }

    override fun onCleared() {
        super.onCleared()
        asrEngine?.release()
        asrEngine = null
    }
}
