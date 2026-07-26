package com.example.ai.di

import android.content.Context
import com.example.ai.data.repository.LLMRepository
import com.example.ai.data.quiz.QuizGenerator
import com.example.ai.data.repository.deepseek.DeepSeekLLMRepository
import com.example.ai.data.tts.TtsEngine

/**
 * 服务层模块 — 组装 LLM、TTS、QuizGenerator 等业务服务。
 * 依赖 NetworkModule 提供的共享 OkHttpClient。
 */
object ServiceModule {

    /** 服务端基础地址 */
    val serverBase: String by lazy {
        val host = BuildConfigHelper.serverHost
        if (host.isNotBlank()) host else "http://192.168.1.7:8080"
    }

    /** LLM 代理仓库 */
    val llmRepository: LLMRepository by lazy {
        DeepSeekLLMRepository(serverBase)
    }

    /** 测验题目生成器 */
    val quizGenerator: QuizGenerator by lazy {
        QuizGenerator(llmRepository)
    }

    /** TTS 引擎 */
    fun ttsEngine(context: Context): TtsEngine = TtsEngine(context)
}

/**
 * 辅助读取 BuildConfig，避免各组件直接依赖 BuildConfig 类。
 */
object BuildConfigHelper {
    val serverHost: String
        get() {
            try {
                val klass = Class.forName("com.example.ai.BuildConfig")
                val field = klass.getField("TTS_SERVER_HOST")
                return field.get(null) as? String ?: ""
            } catch (_: Exception) {
                return ""
            }
        }
}
