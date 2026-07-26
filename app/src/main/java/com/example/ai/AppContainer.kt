package com.example.ai

import android.content.Context
import android.util.Log
import com.example.ai.data.quiz.QuizGenerator
import com.example.ai.data.quiz.QuizRepository
import com.example.ai.data.repository.*
import com.example.ai.data.repository.deepseek.DeepSeekLLMRepository
import com.example.ai.data.tts.TtsEngine
import com.example.ai.data.wordbank.WordBankRepository
import com.example.ai.data.chinesepractice.WordInfoRepository

/** 手动依赖注入容器 — Phase 1 简单实现，后续可迁移到 Hilt */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val contentRepository: ContentRepository by lazy {
        ContentRepositoryImpl(appContext)
    }

    val speechRepository: SpeechRepository by lazy {
        Log.d("AppContainer", "使用 ProxySpeechRepository（服务端 SOE 代理）")
        ProxySpeechRepository()
    }

    /** 服务端地址（优先从 BuildConfig 读取，否则默认局域网地址） */
    private val serverBase: String by lazy {
        val host = BuildConfig.TTS_SERVER_HOST
        if (host.isNotBlank()) host else "http://192.168.1.7:8080"
    }

    val llmRepository: LLMRepository by lazy {
        Log.d("AppContainer", "使用 DeepSeekLLMRepository（服务端代理）")
        DeepSeekLLMRepository(serverBase)
    }

    val ttsEngine: TtsEngine by lazy { TtsEngine(appContext) }

    val quizGenerator: QuizGenerator by lazy { QuizGenerator(llmRepository) }

    val quizRepository: QuizRepository by lazy {
        val videoDir = "${appContext.getExternalFilesDir(null)?.absolutePath ?: appContext.filesDir.absolutePath}/videos"
        QuizRepository(videoDir, quizGenerator)
    }

    val wordBankRepository: WordBankRepository by lazy {
        WordBankRepository(appContext)
    }

    val wordInfoRepository: WordInfoRepository by lazy {
        WordInfoRepository(appContext)
    }
}
