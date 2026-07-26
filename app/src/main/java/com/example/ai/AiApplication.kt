package com.example.ai

import android.app.Application

class AiApplication : Application() {
    val container: AppContainer by lazy { AppContainer(this) }
}
