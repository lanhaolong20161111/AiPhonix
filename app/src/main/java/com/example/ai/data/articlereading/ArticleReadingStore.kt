package com.example.ai.data.articlereading

import android.content.Context
import android.util.Log
import kotlinx.serialization.json.Json
import java.io.File

/**
 * 文章跟读会话本地存储（files/article_reading/）：
 * - {articleKey}.json  — 会话（段落口述、问题、回答）
 *
 * 刻意不用 Room（项目 APK 大小敏感，同 [[UserImportStore]] 的 files JSON 先例）。
 */
class ArticleReadingStore(private val context: Context) {

    companion object {
        private const val TAG = "ArticleReadingStore"
        private val json = Json { ignoreUnknownKeys = true }
    }

    private val dir: File get() = File(context.filesDir, "article_reading")

    fun load(articleKey: String): ArticleSession? {
        return try {
            val file = sessionFile(articleKey)
            if (!file.exists()) null
            else json.decodeFromString<ArticleSession>(file.readText())
        } catch (e: Exception) {
            Log.e(TAG, "load failed: $articleKey", e)
            null
        }
    }

    fun save(session: ArticleSession) {
        try {
            val f = sessionFile(session.articleKey)
            f.parentFile?.mkdirs()
            f.writeText(json.encodeToString(ArticleSession.serializer(), session))
        } catch (e: Exception) {
            Log.e(TAG, "save failed", e)
        }
    }

    /** 生成段落口述录音路径（相对 filesDir 存储，AudioPath 存相对路径） */
    private fun sessionFile(articleKey: String): File =
        File(dir, "${sanitize(articleKey)}.json")

    private fun sanitize(name: String): String =
        name.replace(Regex("""[\\/:*?"<>|]"""), "_").take(80)
}
