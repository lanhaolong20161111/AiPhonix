package com.example.ai.ui.murmur

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.model.PronunciationResult
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.data.tts.TtsEngine
import com.example.ai.data.userimport.FreeLlmRepository
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 语法错误区间（用于红色波浪线标注）
 * @param start 错误起始字符索引（含）
 * @param end   错误结束字符索引（不含）
 * @param message 错误说明
 */
data class GrammarErrorSpan(
    val start: Int,
    val end: Int,
    val message: String,
)

/** 碎碎念 UI 状态 */
data class MurmurUiState(
    val inputText: String = "",
    val isReviewing: Boolean = false,
    val isOcrProcessing: Boolean = false,
    /** AI 返回的语法错误区间列表 */
    val errorSpans: List<GrammarErrorSpan> = emptyList(),
    /** AI 写出的正确句子 */
    val correctedSentence: String = "",
    /** AI 给出的纠错说明（逐条） */
    val correctionNotes: String = "",
    val isSpeaking: Boolean = false,
    val isRecording: Boolean = false,
    /** 发音测评结果 */
    val pronunciationResult: PronunciationResult? = null,
    val isScoring: Boolean = false,
    val error: String? = null,
)

class MurmurViewModel(
    private val freeLlmRepository: FreeLlmRepository = FreeLlmRepository(),
    private val ttsEngine: TtsEngine,
    private val speechRepository: SpeechRepository,
) : ViewModel() {

    private companion object {
        private const val TAG = "MurmurVM"
    }

    private val _uiState = MutableStateFlow(MurmurUiState())
    val uiState: StateFlow<MurmurUiState> = _uiState.asStateFlow()

    /** 更新输入文本 */
    fun updateInput(text: String) {
        _uiState.value = _uiState.value.copy(inputText = text)
    }

    /** 拍照/相册 → 上传图片 → OCR 提取文字，填入输入框 */
    fun importFromImage(uri: Uri, context: Context) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isOcrProcessing = true, error = null)
            try {
                // 1. 上传照片
                val uploadResult = freeLlmRepository.uploadPhoto(uri, context)
                val imageUrl = uploadResult.getOrElse {
                    _uiState.value = _uiState.value.copy(isOcrProcessing = false, error = "照片上传失败: ${it.message}")
                    return@launch
                }
                // 2. 用多模态 LLM 识别文字
                val ocrPrompt = "请识别这张图片中的所有文字内容，原样输出识别到的文字，不要添加任何解释或额外内容。如果图片中没有文字，回复\"未识别到文字\"。"
                val chatResult = freeLlmRepository.chat(ocrPrompt, listOf(imageUrl))
                val ocrText = chatResult.getOrElse {
                    _uiState.value = _uiState.value.copy(isOcrProcessing = false, error = "文字识别失败: ${it.message}")
                    return@launch
                }
                val cleaned = ocrText.trim().removePrefix("未识别到文字").trim()
                val current = _uiState.value.inputText
                val newText = if (current.isBlank()) cleaned else "$current\n$cleaned"
                _uiState.value = _uiState.value.copy(
                    inputText = newText,
                    isOcrProcessing = false,
                )
            } catch (e: Exception) {
                Log.e(TAG, "图片识别失败", e)
                _uiState.value = _uiState.value.copy(isOcrProcessing = false, error = "图片识别失败: ${e.message}")
            }
        }
    }

    /** 提交给 AI 审核：检查语法错误，返回正确句子 */
    fun submitForReview() {
        val text = _uiState.value.inputText.trim()
        if (text.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "请先输入内容")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isReviewing = true, error = null, errorSpans = emptyList(), correctedSentence = "", correctionNotes = "")
            try {
                val prompt = buildReviewPrompt(text)
                val result = freeLlmRepository.chat(prompt)
                val aiResponse = result.getOrElse {
                    _uiState.value = _uiState.value.copy(isReviewing = false, error = "AI 审核失败: ${it.message}")
                    return@launch
                }
                parseReviewResponse(aiResponse, text)
            } catch (e: Exception) {
                Log.e(TAG, "AI 审核异常", e)
                _uiState.value = _uiState.value.copy(isReviewing = false, error = "AI 审核异常: ${e.message}")
            }
        }
    }

    /** 构建 AI 审核提示词，要求 JSON 格式返回 */
    private fun buildReviewPrompt(rawText: String): String {
        return """你是一个专业的语言老师，请审核以下学生写的文字，找出语法错误并给出正确句子。

学生原文：
$rawText

请以 JSON 格式回复（不要加 markdown 代码块标记），格式如下：
{
  "errors": [
    {"start": 0, "end": 5, "message": "错误说明"},
    ...
  ],
  "corrected": "改正后的完整句子",
  "notes": "逐条说明每个错误的原因，用换行分隔"
}

要求：
1. errors 数组中每个元素的 start/end 是错误文字在原文中的字符索引（从0开始，含头不含尾）
2. 如果没有语法错误，errors 返回空数组，corrected 返回原文
3. corrected 是修改后的正确完整句子
4. notes 是对每个错误的简要解释

注意：只返回 JSON，不要有任何其他文字。"""
    }

    /** 解析 AI 审核响应 */
    private suspend fun parseReviewResponse(response: String, originalText: String) {
        withContext(Dispatchers.Default) {
            try {
                // 清理可能的 markdown 代码块标记
                val cleaned = response.trim()
                    .removePrefix("```json").removePrefix("```")
                    .removeSuffix("```")
                    .trim()
                val json = JsonParser.parseString(cleaned).asJsonObject

                val spans = mutableListOf<GrammarErrorSpan>()
                val errorsArray = json.getAsJsonArray("errors")
                if (errorsArray != null) {
                    for (i in 0 until errorsArray.size()) {
                        val err = errorsArray[i].asJsonObject
                        val start = err.get("start")?.asInt ?: continue
                        val end = err.get("end")?.asInt ?: continue
                        val message = err.get("message")?.asString ?: ""
                        // 安全裁剪：确保索引在合法范围内
                        val safeStart = start.coerceIn(0, originalText.length)
                        val safeEnd = end.coerceIn(safeStart, originalText.length)
                        spans.add(GrammarErrorSpan(safeStart, safeEnd, message))
                    }
                }

                val corrected = json.get("corrected")?.asString ?: originalText
                val notes = json.get("notes")?.asString ?: ""

                _uiState.value = _uiState.value.copy(
                    isReviewing = false,
                    errorSpans = spans,
                    correctedSentence = corrected,
                    correctionNotes = notes,
                )
            } catch (e: Exception) {
                Log.e(TAG, "解析 AI 响应失败: ${e.message}\nResponse: $response", e)
                // 降级：直接把 AI 原始回复当正确句子，不标错误
                _uiState.value = _uiState.value.copy(
                    isReviewing = false,
                    correctedSentence = response.trim(),
                    correctionNotes = "AI 返回格式异常，已直接展示 AI 回复",
                )
            }
        }
    }

    /** TTS 朗读正确句子 */
    fun speakCorrected() {
        val text = _uiState.value.correctedSentence.trim()
        if (text.isBlank()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSpeaking = true)
            try {
                ttsEngine.speak(text)
            } catch (e: Exception) {
                Log.e(TAG, "TTS 朗读失败", e)
            } finally {
                _uiState.value = _uiState.value.copy(isSpeaking = false)
            }
        }
    }

    /** 开始录音测评（朗读正确句子） */
    fun startScoring() {
        val text = _uiState.value.correctedSentence.trim()
        if (text.isBlank()) return
        if (_uiState.value.isRecording) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isRecording = true, isScoring = true, pronunciationResult = null, error = null)
            try {
                // 用正确句子作为参考文本进行发音评测
                val word = com.example.ai.data.model.Word(text = text, ipa = "", letter = "", phonemes = emptyList())
                val result = speechRepository.startStreamingEvaluation(word)
                _uiState.value = _uiState.value.copy(
                    pronunciationResult = result,
                    isScoring = false,
                    isRecording = false,
                )
            } catch (e: Exception) {
                Log.e(TAG, "发音测评失败", e)
                _uiState.value = _uiState.value.copy(
                    isScoring = false,
                    isRecording = false,
                    error = "测评失败: ${e.message}",
                )
            }
        }
    }

    /** 停止录音（用户手动停止按钮触发） */
    fun stopScoring() {
        try {
            speechRepository.stopStreamingEvaluation()
        } catch (e: Exception) {
            Log.e(TAG, "停止录音失败", e)
        }
    }

    /** 清空所有内容，重新开始 */
    fun reset() {
        _uiState.value = MurmurUiState()
    }

    /** 清除错误状态 */
    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        if (_uiState.value.isRecording) {
            try { speechRepository.stopStreamingEvaluation() } catch (_: Exception) {}
        }
    }
}
