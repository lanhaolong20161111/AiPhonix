package com.example.ai.data.charimage

import android.content.Context
import com.google.gson.Gson
import java.io.File

/** 一条待同步的图片反馈（断网时暂存，联网后重发） */
data class PendingFeedback(
    val char: String,
    val grade: String,
    val semester: String,
    val type: String,
    val learningStatus: String?,
    val createdAt: Long = System.currentTimeMillis(),
)

private data class PendingFeedbackFile(
    val items: List<PendingFeedback> = emptyList(),
)

/**
 * 看图识字反馈的离线暂存队列：提交失败时写入 files/pending_feedback.json，
 * 联网后由 ViewModel 逐条重发（POST /api/v1/char-images/feedback 幂等）。
 * 同 UserImportStore 先例：零 Room，纯 JSON 文件。
 */
class PendingFeedbackStore(private val context: Context) {

    private val gson = Gson()
    private val file: File
        get() = File(context.filesDir, "pending_feedback.json")

    @Synchronized
    fun load(): List<PendingFeedback> = try {
        if (!file.exists()) emptyList()
        else gson.fromJson(file.readText(), PendingFeedbackFile::class.java)?.items ?: emptyList()
    } catch (e: Exception) {
        emptyList()
    }

    @Synchronized
    fun add(item: PendingFeedback) {
        val items = load().toMutableList().apply { add(item) }
        save(items)
    }

    /** 同步成功后移除（按全部字段 + createdAt 全匹配，避免误删并发新增条目） */
    @Synchronized
    fun removeAll(toRemove: List<PendingFeedback>) {
        if (toRemove.isEmpty()) return
        val remaining = load().filter { pending ->
            toRemove.none { same(it, pending) }
        }
        save(remaining)
    }

    @Synchronized
    fun clear() {
        if (file.exists()) file.delete()
    }

    private fun same(a: PendingFeedback, b: PendingFeedback) =
        a.char == b.char && a.grade == b.grade && a.semester == b.semester &&
            a.type == b.type && a.learningStatus == b.learningStatus && a.createdAt == b.createdAt

    private fun save(items: List<PendingFeedback>) {
        file.parentFile?.mkdirs()
        file.writeText(gson.toJson(PendingFeedbackFile(items)))
    }
}
