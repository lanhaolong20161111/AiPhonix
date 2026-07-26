package com.example.ai.data.quiz

import android.util.Log
import kotlinx.serialization.json.Json
import java.io.File

/**
 * 管理各视频对应的题库：从缓存加载，必要时通过 QuizGenerator 生成。
 */
class QuizRepository(
    private val videoDir: String,
    private val generator: QuizGenerator,
) {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }

    /**
     * 获取指定视频的题库。
     * 优先从缓存文件加载，不存在时调用 LLM 生成并缓存。
     */
    suspend fun getQuizBank(videoName: String, subtitleText: String): QuizBank {
        val cacheFile = getCacheFile(videoName)

        // 缓存存在 → 直接加载
        if (cacheFile.exists()) {
            Log.d("QuizRepository", "从缓存加载题库: $videoName")
            return try {
                val cached = cacheFile.readText()
                json.decodeFromString<QuizBank>(cached)
            } catch (e: Exception) {
                Log.e("QuizRepository", "缓存解析失败，重新生成", e)
                generateAndCache(videoName, subtitleText)
            }
        }

        // 不存在 → 生成并缓存
        return generateAndCache(videoName, subtitleText)
    }

    private suspend fun generateAndCache(videoName: String, subtitleText: String): QuizBank {
        Log.d("QuizRepository", "生成题库: $videoName")
        val bank = generator.generate(videoName, subtitleText)
        try {
            val cacheFile = getCacheFile(videoName)
            cacheFile.parentFile?.mkdirs()
            cacheFile.writeText(json.encodeToString(QuizBank.serializer(), bank))
            Log.d("QuizRepository", "题库已缓存: ${cacheFile.absolutePath}")
        } catch (e: Exception) {
            Log.e("QuizRepository", "缓存写入失败", e)
        }
        return bank
    }

    /** 删除某个视频的题库缓存，用于重新生成 */
    fun clearCache(videoName: String) {
        getCacheFile(videoName).delete()
    }

    private fun getCacheFile(videoName: String): File {
        return File(videoDir, "quiz_${sanitizeFileName(videoName)}.json")
    }

    private fun sanitizeFileName(name: String): String {
        return name.replace(Regex("""[<>:"/\\|?*]"""), "_")
    }
}
