package com.example.ai.ui.userimport

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.userimport.CandidateStatus
import com.example.ai.data.userimport.FreeLlmRepository
import com.example.ai.data.userimport.ImportCandidate
import com.example.ai.data.userimport.ImportProcessor
import com.example.ai.data.userimport.ImportTemplate
import com.example.ai.data.userimport.ImportTemplateRepository
import com.example.ai.data.userimport.UserImportItem
import com.example.ai.data.userimport.UserImportStore
import com.example.ai.data.userimport.UserImportSync
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 导入页阶段 */
enum class ImportPhase { SELECT, PROMPT, CONFIRM, DONE }

data class ImportUiState(
    val phase: ImportPhase = ImportPhase.SELECT,
    val loading: Boolean = false,
    val error: String? = null,
    val templates: List<ImportTemplate> = emptyList(),
    val selectedTemplate: ImportTemplate? = null,
    val paramValues: Map<String, String> = emptyMap(),
    val inputText: String = "",          // A 组：用户粘贴的原文
    val generatedPrompt: String? = null, // 生成好的提示词
    val llmResult: String = "",          // 用户粘贴回的 LLM 输出
    val candidates: List<ImportCandidate> = emptyList(),
    val parseError: String? = null,
    val savedMessage: String? = null,
    val photoUris: List<String> = emptyList(), // 图片类模板：已拍照片（MediaStore Uri 字符串）
    val freeGenerating: Boolean = false, // 免费 AI（火山引擎）一键生成中
)

/**
 * 导入中心 ViewModel — LLM 费用外移模式：
 * 选模板 → 填参数 → 生成提示词（复制给用户自己的 LLM）→ 粘贴回 → 本地加工 → 确认 → 存本地+同步服务端。
 */
class ImportViewModel(
    private val templateRepository: ImportTemplateRepository = ImportTemplateRepository(),
    private val processor: ImportProcessor = ImportProcessor(),
    private val store: UserImportStore,
    private val sync: UserImportSync = UserImportSync(),
    private val prefs: SharedPreferences? = null,
    private val freeLlm: FreeLlmRepository = FreeLlmRepository(),
    private val contextProvider: () -> Context = { throw IllegalStateException("contextProvider 未注入") },
) : ViewModel() {

    private fun paramKey(templateId: String, paramKey: String) = "import_param_${templateId}_$paramKey"

    private val _uiState = MutableStateFlow(ImportUiState())
    val uiState: StateFlow<ImportUiState> = _uiState.asStateFlow()

    init {
        loadTemplates()
    }

    fun loadTemplates() {
        _uiState.value = _uiState.value.copy(loading = true, error = null)
        viewModelScope.launch {
            templateRepository.fetchAll()
                .onSuccess { templates ->
                    _uiState.value = _uiState.value.copy(
                        loading = false,
                        templates = templates,
                        phase = ImportPhase.SELECT,
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        loading = false,
                        error = "模板加载失败：${e.message ?: "网络错误"}",
                    )
                }
        }
    }

    fun selectTemplate(template: ImportTemplate) {
        // 默认值优先用上次记忆的选择，其次模板 default
        val defaults = template.params.associate { p ->
            val remembered = prefs?.getString(paramKey(template.id, p.key), null)
            p.key to (remembered ?: p.default)
        }
        _uiState.value = _uiState.value.copy(
            phase = ImportPhase.PROMPT,
            selectedTemplate = template,
            paramValues = defaults,
            inputText = "",
            generatedPrompt = null,
            llmResult = "",
            candidates = emptyList(),
            parseError = null,
            error = null,
        )
    }

    fun backToSelect() {
        _uiState.value = _uiState.value.copy(phase = ImportPhase.SELECT, selectedTemplate = null)
    }

    fun setParam(key: String, value: String) {
        val templateId = _uiState.value.selectedTemplate?.id ?: return
        _uiState.value = _uiState.value.copy(
            paramValues = _uiState.value.paramValues + (key to value),
            generatedPrompt = null,
        )
        // 记住本次选择，下次进同一模板自动填充
        prefs?.edit()?.putString(paramKey(templateId, key), value)?.apply()
    }

    fun setInputText(text: String) {
        _uiState.value = _uiState.value.copy(inputText = text, generatedPrompt = null)
    }

    /** 拍照成功：加入已拍列表（照片存系统相册，Uri 为 MediaStore content uri） */
    fun addPhoto(uri: String) {
        _uiState.value = _uiState.value.copy(
            photoUris = _uiState.value.photoUris + uri,
            generatedPrompt = null,
        )
    }

    /** 删除某张已拍照片（同时调用方负责从相册删除文件） */
    fun removePhoto(uri: String) {
        _uiState.value = _uiState.value.copy(
            photoUris = _uiState.value.photoUris.filterNot { it == uri },
        )
    }

    fun setLlmResult(text: String) {
        _uiState.value = _uiState.value.copy(llmResult = text, parseError = null)
    }

    /** 生成提示词（A 组内嵌原文；image 组无需原文，提示词会提示贴图） */
    fun generatePrompt() {
        val state = _uiState.value
        val template = state.selectedTemplate ?: return
        if (template.inputType == "text" && state.inputText.isBlank()) {
            _uiState.value = state.copy(error = "请先粘贴需要提取的原文内容")
            return
        }
        val prompt = processor.generatePrompt(template, state.paramValues, state.inputText.trim())
        _uiState.value = state.copy(generatedPrompt = prompt, error = null)
    }

    /**
     * 一键免费 AI 生成（火山引擎送 token，服务端转发）：
     * 文本类：直接调 /free-llm/chat；图片类：先上传已拍照片再带图调用。
     * 成功 → 自动解析进入确认阶段；失败 → 提示可复制提示词手动使用自己的 LLM。
     */
    fun generateWithFreeLLM() {
        val state = _uiState.value
        val template = state.selectedTemplate ?: return
        val prompt = state.generatedPrompt ?: return
        if (state.freeGenerating) return
        if (template.inputType == "image" && state.photoUris.isEmpty()) {
            _uiState.value = state.copy(error = "请先至少拍一张照片，再使用 AI 生成")
            return
        }
        _uiState.value = state.copy(freeGenerating = true, error = null)
        viewModelScope.launch {
            val result = runCatching {
                val urls = if (template.inputType == "image") {
                    val context = contextProvider()
                    state.photoUris.map { uriStr ->
                        freeLlm.uploadPhoto(Uri.parse(uriStr), context).getOrThrow()
                    }
                } else {
                    emptyList()
                }
                freeLlm.chat(prompt, urls).getOrThrow()
            }
            _uiState.value = _uiState.value.copy(freeGenerating = false)
            result
                .onSuccess { text ->
                    if (text.isBlank()) {
                        _uiState.value = _uiState.value.copy(error = "AI 返回为空，可复制提示词用你自己的 LLM")
                    } else {
                        _uiState.value = _uiState.value.copy(llmResult = text)
                        parseLlmResult()
                    }
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        error = "AI 生成失败：${e.message ?: "未知错误"}（可复制提示词用你自己的 LLM）",
                    )
                }
        }
    }

    /** 解析 LLM 结果 → 加工为候选（校验/规范化/去重） */
    fun parseLlmResult() {
        val state = _uiState.value
        val template = state.selectedTemplate ?: return
        if (state.llmResult.isBlank()) {
            _uiState.value = state.copy(parseError = "请先粘贴 LLM 返回的结果")
            return
        }
        val existingTexts = store.load()
            .filter { it.status == "active" }
            .map { it.text }
            .toSet()
        val candidates = processor.buildCandidates(template, state.llmResult, existingTexts)
        if (candidates == null) {
            _uiState.value = state.copy(parseError = "解析失败：没识别到有效的 JSON，请重新粘贴或让 LLM 重试")
            return
        }
        if (candidates.isEmpty()) {
            _uiState.value = state.copy(parseError = "没有解析出任何条目")
            return
        }
        _uiState.value = state.copy(
            phase = ImportPhase.CONFIRM,
            candidates = candidates,
            parseError = null,
        )
    }

    /** 保存选中的候选（默认 NEW 全选，DUPLICATE 可强制勾选，INVALID 不可选） */
    fun saveSelected(selected: Set<String>) {
        val state = _uiState.value
        val toSave = state.candidates
            .filter { it.status != CandidateStatus.INVALID && it.text in selected }
            .map { c ->
                UserImportStore.newItem(
                    kind = c.kind,
                    text = c.text,
                    pinyin = c.pinyin,
                    meaning = c.meaning,
                    tags = c.tags,
                    payload = c.payload,
                    sourceTemplate = state.selectedTemplate?.id ?: "",
                )
            }
        if (toSave.isEmpty()) {
            _uiState.value = state.copy(savedMessage = "没有选中可导入的条目")
            return
        }
        store.upsertAll(toSave)
        val count = toSave.size
        _uiState.value = state.copy(
            phase = ImportPhase.DONE,
            savedMessage = "已保存 $count 条到本地",
        )
        // 登录后同步到服务端账户
        if (TokenManager.isLoggedIn) {
            viewModelScope.launch {
                sync.sync(toSave)
                    .onSuccess { outcome ->
                        // 回填服务端 id，后续删除可同步到服务端
                        store.attachServerIds(outcome.serverIds)
                        _uiState.value = _uiState.value.copy(
                            savedMessage = "已保存 $count 条（本地）+ 服务端新增 ${outcome.added} 条/更新 ${outcome.updated} 条",
                        )
                    }
                    .onFailure { e ->
                        _uiState.value = _uiState.value.copy(
                            savedMessage = "已保存 $count 条到本地；服务端同步失败：${e.message ?: "网络错误"}（数据已在本地，可稍后重试）",
                        )
                    }
            }
        }
    }

    fun finish() {
        _uiState.value = _uiState.value.copy(
            phase = ImportPhase.SELECT,
            selectedTemplate = null,
            generatedPrompt = null,
            llmResult = "",
            candidates = emptyList(),
            parseError = null,
            savedMessage = null,
            error = null,
        )
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = null, parseError = null)
    }
}
