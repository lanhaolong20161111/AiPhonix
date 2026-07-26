package com.example.ai

import android.content.Context
import com.example.ai.data.chinesepractice.WordInfoRepository
import com.example.ai.data.repository.ContentRepository
import com.example.ai.data.quiz.QuizRepository
import com.example.ai.data.repository.ContentRepositoryImpl
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.data.repository.ProxySpeechRepository
import com.example.ai.data.tts.TtsEngine
import com.example.ai.data.wordbank.WordBankRepository
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule

/**
 * 手动依赖注入容器 — 组合 NetworkModule / ServiceModule，保持与各 Screen 的 API 契约。
 */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    // ── 网络层（模块复用） ──
    val httpClient = NetworkModule.httpClient

    // ── 内容/资源 ──
    val contentRepository: ContentRepository by lazy {
        ContentRepositoryImpl(appContext)
    }

    // ── 评测/语音 ──
    val speechRepository: SpeechRepository by lazy {
        ProxySpeechRepository(httpClient)
    }

    val ttsEngine: TtsEngine by lazy {
        TtsEngine(appContext)
    }

    // ── 测验 ──
    val quizRepository: QuizRepository by lazy {
        val videoDir = "${appContext.getExternalFilesDir(null)?.absolutePath ?: appContext.filesDir.absolutePath}/videos"
        QuizRepository(videoDir, ServiceModule.quizGenerator)
    }

    // ── 语文练习 ──
    val wordBankRepository: WordBankRepository by lazy {
        WordBankRepository(appContext)
    }

    val wordInfoRepository: WordInfoRepository by lazy {
        WordInfoRepository(appContext)
    }
}
