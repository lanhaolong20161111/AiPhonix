package com.example.ai

import android.app.Application
import com.example.ai.data.auth.TokenManager

class AiApplication : Application() {
    val container: AppContainer by lazy { AppContainer(this) }

    override fun onCreate() {
        super.onCreate()
        TokenManager.init(this)
    }
}
