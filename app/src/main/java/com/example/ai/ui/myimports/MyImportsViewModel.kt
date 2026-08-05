package com.example.ai.ui.myimports

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.userimport.UserImportItem
import com.example.ai.data.userimport.UserImportStore
import com.example.ai.data.userimport.UserImportSync
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * 我的导入 — 查看/删除本地已导入内容。
 * 数据来自 UserImportStore（files 目录 JSON），同步操作量级小，直接在 UI 线程执行。
 * 删除：先删本地，若有服务端 id（曾同步成功）且已登录，异步删除服务端记录，防止重登后"复活"。
 */
class MyImportsViewModel(
    private val store: UserImportStore,
    private val sync: UserImportSync = UserImportSync(),
) : ViewModel() {

    private val _items = MutableStateFlow<List<UserImportItem>>(emptyList())
    val items: StateFlow<List<UserImportItem>> = _items

    private val _deleteMessage = MutableStateFlow<String?>(null)
    val deleteMessage: StateFlow<String?> = _deleteMessage

    init {
        reload()
        autoSyncPending()
    }

    /**
     * 进入页面时自动补传：把本地没有 serverId（曾同步失败/未登录）的条目批量同步到服务端。
     * 成功回填 serverId 并刷新列表；失败静默（数据仍在本地，下次进入页面自动重试）。
     * 401 由 NetworkModule 拦截器自动刷新 token 后重放。
     */
    private fun autoSyncPending() {
        if (!TokenManager.isLoggedIn) return
        val pending = store.load().filter { it.serverId.isBlank() }
        if (pending.isEmpty()) return
        viewModelScope.launch {
            sync.sync(pending)
                .onSuccess { outcome ->
                    if (outcome.serverIds.isNotEmpty()) {
                        store.attachServerIds(outcome.serverIds)
                        reload()
                    }
                    if (outcome.added + outcome.updated > 0) {
                        _deleteMessage.value = "已自动同步 ${outcome.added + outcome.updated} 条到服务端"
                    }
                }
                .onFailure {
                    // 静默失败：数据在本地不丢，下次进入页面再试
                }
        }
    }

    fun reload() {
        _items.value = store.load()
    }

    fun remove(id: String) {
        val item = store.load().firstOrNull { it.id == id } ?: return
        // 1) 删本地（立即生效）
        _items.value = store.remove(id)
        // 2) 同步删服务端（有 serverId 且登录）
        val serverId = item.serverId
        if (serverId.isNotBlank() && TokenManager.isLoggedIn) {
            viewModelScope.launch {
                sync.delete(serverId)
                    .onFailure { e ->
                        _deleteMessage.value = "本地已删除；服务端同步失败：${e.message ?: "网络错误"}"
                    }
            }
        }
    }

    fun clearDeleteMessage() {
        _deleteMessage.value = null
    }

    /** 展示名（kind → 中文标签） */
    companion object {
        val KIND_LABELS: Map<String, String> = linkedMapOf(
            "char" to "生字",
            "word" to "词语",
            "pinyin" to "句子拼音",
            "sentence" to "句子",
            "article" to "文章",
            "quiz" to "题目",
            "answer" to "答案",
        )

        fun kindLabel(kind: String): String = KIND_LABELS[kind] ?: kind

        /** kind 显示顺序 */
        val KIND_ORDER: List<String> = listOf("char", "word", "pinyin", "sentence", "article", "quiz", "answer")

        /** 来源模板 id → 可读标签（来源追踪展示用） */
        val TEMPLATE_LABELS: Map<String, String> = linkedMapOf(
            "text_to_vocab" to "文本→词汇表",
            "text_to_article" to "文本→文章",
            "text_to_sentence" to "文本→句子",
            "text_to_pinyin" to "文本→句子拼音",
            "image_to_quiz" to "图片→题目",
            "image_to_article" to "图片→文章",
            "image_to_answer" to "图片→答案",
        )

        fun templateLabel(id: String): String = TEMPLATE_LABELS[id] ?: id
    }
}
