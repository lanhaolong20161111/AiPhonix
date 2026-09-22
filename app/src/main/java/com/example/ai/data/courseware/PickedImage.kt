package com.example.ai.data.courseware

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log

/**
 * 从系统选图返回的 `content://` Uri 读出上传所需的三个信息。
 *
 * 放在 data 层（而非 composable 里内联）：① 只做**本地** IO，不涉及网络；
 * ② ViewModel 不持有 Context/ContentResolver（`AGENTS.md`：不要在 ViewModel 中持有 Context），
 * 所以由 Screen 调这里读出字节，再把纯数据交给 ViewModel 上传。
 */
data class PickedImage(
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
) {
    // ByteArray 是引用类型：data class 自动生成的 equals/hashCode 会退化成引用比较，显式实现更诚实
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PickedImage) return false
        return fileName == other.fileName && mimeType == other.mimeType && bytes.contentEquals(other.bytes)
    }

    override fun hashCode(): Int =
        fileName.hashCode() * 31 + mimeType.hashCode() * 31 + bytes.contentHashCode()
}

/** 读不出来（权限被收回 / 已删除 / 非图片）返回 null */
fun readPickedImage(resolver: ContentResolver, uri: Uri): PickedImage? {
    return try {
        val mime = resolver.getType(uri).orEmpty().ifBlank { "image/jpeg" }
        if (!mime.startsWith("image/")) return null
        val name = queryDisplayName(resolver, uri) ?: "upload_${System.currentTimeMillis()}.jpg"
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        PickedImage(fileName = name, mimeType = mime, bytes = bytes)
    } catch (e: Exception) {
        Log.w(TAG, "读取选图失败: ${e.message}")
        null
    }
}

private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? {
    return try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
        }
    } catch (e: Exception) {
        Log.w(TAG, "查询文件名失败: ${e.message}")
        null
    }
}

private const val TAG = "PickedImage"
