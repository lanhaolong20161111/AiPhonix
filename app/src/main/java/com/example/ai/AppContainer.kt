package com.example.ai

import android.content.Context
import android.content.SharedPreferences
import com.example.ai.data.audio.IpaAudioPlayer
import com.example.ai.data.audio.PronunciationStyleStore
import com.example.ai.data.articlereading.ArticleReadingStore
import com.example.ai.data.chinesepractice.WordInfoRepository
import com.example.ai.data.repository.ContentRepository
import com.example.ai.data.quiz.QuizRepository
import com.example.ai.data.repository.ContentRepositoryImpl
import com.example.ai.data.repository.SpeechRepository
import com.example.ai.data.repository.ProxySpeechRepository
import com.example.ai.data.repository.WordImageRepository
import com.example.ai.data.tts.TtsEngine
import com.example.ai.data.training.ActiveTrainingSession
import com.example.ai.data.training.SessionResultStore
import com.example.ai.data.training.TrainingPlanStore
import com.example.ai.data.training.TrainingPlanSync
import com.example.ai.data.userimport.UserImportStore
import com.example.ai.data.wordbank.WordBankRepository
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule

/**
 * 手动依赖注入容器 — 组合 NetworkModule / ServiceModule，保持与各 Screen 的 API 契约。
 */
class AppContainer(context: Context) {
    val appContext = context.applicationContext

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

    // ── 单词图片（服务端 char_image_index type=英词） ──
    val wordImageRepository: WordImageRepository by lazy {
        WordImageRepository(httpClient, ServiceModule.serverBase)
    }

    val ttsEngine: TtsEngine by lazy {
        TtsEngine(appContext, pronunciationStyleStore)
    }

    // ── 测验 ──
    val quizRepository: QuizRepository by lazy {
        val videoDir = "${appContext.getExternalFilesDir(null)?.absolutePath ?: appContext.filesDir.absolutePath}/videos"
        QuizRepository(videoDir, ServiceModule.quizGenerator)
    }

    // ── 语文练习 ──
    val wordBankRepository: WordBankRepository by lazy {
        WordBankRepository(appContext, userImportStore)
    }

    val wordInfoRepository: WordInfoRepository by lazy {
        WordInfoRepository(appContext)
    }

    // ── 导入中心（用户自定义导入数据） ──
    val userImportStore: UserImportStore by lazy {
        UserImportStore(appContext)
    }

    // 导入中心参数记忆（记住上次选的年级/语言/模式，跨模板按 key 存）
    val userImportPrefs: SharedPreferences by lazy {
        appContext.getSharedPreferences("user_import_prefs", Context.MODE_PRIVATE)
    }

    // ── 文章跟读（TTS 朗读 + 段落口述 + 读后问答会话） ──
    val articleReadingStore: ArticleReadingStore by lazy {
        ArticleReadingStore(appContext)
    }

    // ── 音素发音风格（美式/英式，持久化） ──
    val pronunciationStyleStore: PronunciationStyleStore by lazy {
        PronunciationStyleStore(appContext)
    }

    // ── 音素发音播放器（跟随发音风格） ──
    fun ipaAudioPlayer(): IpaAudioPlayer = IpaAudioPlayer(appContext, pronunciationStyleStore)

    /** 音素播放器（+20dB 增益，字母详情页自然拼读 chip 用） */
    fun ipaAudioPlayerBoosted(): IpaAudioPlayer =
        IpaAudioPlayer(appContext, pronunciationStyleStore, boostDb = 2000)

    // ── 家长训练任务（家长动态决定的学生页面集合 + 家长 PIN） ──
    val trainingPlanStore: TrainingPlanStore by lazy {
        TrainingPlanStore(appContext)
    }

    // ── V2：页面真实练习结果暂存（页面 record → 返回首页 consume） ──
    val sessionResultStore: SessionResultStore by lazy {
        SessionResultStore()
    }

    // ── V2：任务配置服务端同步（家长保存→推送；登录/启动→拉取；打卡→上报完成度） ──
    val trainingPlanSync: TrainingPlanSync by lazy {
        TrainingPlanSync(httpClient, trainingPlanStore)
    }
}
