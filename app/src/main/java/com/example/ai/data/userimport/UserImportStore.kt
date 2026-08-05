package com.example.ai.data.userimport

import android.content.Context
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

/**
 * 用户导入数据本地存储 — files 目录 JSON（项目刻意避免 Room 依赖，
 * 同 QuizRepository 缓存到 files 的先例；家庭使用量级几百条足够）。
 *
 * 内置 assets 词库保持只读基线，这里只存用户自定义导入的数据。
 */
class UserImportStore(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true }
    private val file: File
        get() = File(context.filesDir, "user_imports.json")

    @Volatile
    private var cache: List<UserImportItem>? = null

    fun load(): List<UserImportItem> {
        cache?.let { return it }
        val items = if (file.exists()) {
            try {
                val data = file.readText()
                json.decodeFromString<UserImportStoreFile>(data).items
            } catch (e: Exception) {
                emptyList()
            }
        } else {
            emptyList()
        }
        cache = items
        return items
    }

    /** 批量 upsert（同 kind + text 视为同一条，更新之；否则新增）。返回保存后的完整列表 */
    fun upsertAll(newItems: List<UserImportItem>): List<UserImportItem> {
        val current = load().toMutableList()
        for (item in newItems) {
            val idx = current.indexOfFirst { it.kind == item.kind && it.text == item.text }
            if (idx >= 0) {
                current[idx] = current[idx].copy(
                    pinyin = item.pinyin.ifBlank { current[idx].pinyin },
                    meaning = item.meaning.ifBlank { current[idx].meaning },
                    tags = item.tags.ifEmpty { current[idx].tags },
                    payload = item.payload.ifBlank { current[idx].payload },
                    sourceTemplate = item.sourceTemplate.ifBlank { current[idx].sourceTemplate },
                )
            } else {
                current.add(item)
            }
        }
        save(current)
        return current
    }

    /** 同步成功后回填服务端 id（key = "kind\u0000text"）。无本地 id 匹配的忽略 */
    fun attachServerIds(idsByKey: Map<String, String>) {
        if (idsByKey.isEmpty()) return
        val current = load().toMutableList()
        var changed = false
        for (i in current.indices) {
            val key = "${current[i].kind}\u0000${current[i].text}"
            val sid = idsByKey[key]
            if (sid != null && current[i].serverId != sid) {
                current[i] = current[i].copy(serverId = sid)
                changed = true
            }
        }
        if (changed) save(current)
    }

    fun remove(id: String): List<UserImportItem> {
        val current = load().filterNot { it.id == id }
        save(current)
        return current
    }

    fun clear() {
        cache = emptyList()
        if (file.exists()) file.delete()
    }

    private fun save(items: List<UserImportItem>) {
        cache = items
        file.parentFile?.mkdirs()
        file.writeText(json.encodeToString(UserImportStoreFile.serializer(), UserImportStoreFile(items = items)))
    }

    companion object {
        fun newItem(
            kind: String,
            text: String,
            pinyin: String = "",
            meaning: String = "",
            tags: List<String> = emptyList(),
            payload: String = "",
            sourceTemplate: String = "",
        ): UserImportItem = UserImportItem(
            id = UUID.randomUUID().toString(),
            kind = kind,
            text = text,
            pinyin = pinyin,
            meaning = meaning,
            tags = tags,
            payload = payload,
            sourceTemplate = sourceTemplate,
        )
    }
}
