plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

import java.util.Properties

// 百度语音合成（TTS）凭据
val bdProps = Properties()
val bdFile = rootProject.file("baidu.local.properties")
if (bdFile.exists()) bdProps.load(bdFile.inputStream())
fun bd(key: String) = "\"${bdProps.getProperty("baidu.$key", "")}\""

// DeepSeek API 凭据
val dsProps = Properties()
val dsFile = rootProject.file("deepseek.local.properties")
if (dsFile.exists()) dsProps.load(dsFile.inputStream())
fun ds(key: String) = "\"${dsProps.getProperty("deepseek.$key", "")}\""

android {
    namespace = "com.example.ai"
    compileSdk = 36

    // 从开发机本地文件读取凭证（gitignored），注入 BuildConfig
    val xfProps = Properties()
    val xfFile = rootProject.file("xfyun.local.properties")
    if (xfFile.exists()) xfProps.load(xfFile.inputStream())
    fun xf(key: String) = "\"${xfProps.getProperty("xfyun.$key", "")}\""

    // 腾讯云凭证（可选，仅用于 SOE Demo）
    val tcProps = Properties()
    val tcFile = rootProject.file("tencent.local.properties")
    if (tcFile.exists()) tcProps.load(tcFile.inputStream())
    fun tc(key: String) = "\"${tcProps.getProperty("tencent.$key", "")}\""

    defaultConfig {
        applicationId = "com.example.ai"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String","XF_APP_ID",xf("appId"))
        buildConfigField("String","XF_API_KEY",xf("apiKey"))
        buildConfigField("String","XF_API_SECRET",xf("apiSecret"))

        // 腾讯云 SOE Demo 凭证
        buildConfigField("String","TC_APP_ID",tc("appId"))
        buildConfigField("String","TC_SECRET_ID",tc("secretId"))
        buildConfigField("String","TC_SECRET_KEY",tc("secretKey"))

        // 百度 TTS 凭证
        buildConfigField("String","BD_APP_ID",bd("appId"))
        buildConfigField("String","BD_API_KEY",bd("apiKey"))
        buildConfigField("String","BD_SECRET_KEY",bd("secretKey"))

        // DeepSeek API 凭证
        buildConfigField("String","DEEPSEEK_API_KEY",ds("apiKey"))
        buildConfigField("String","DEEPSEEK_BASE_URL",ds("baseUrl"))
        buildConfigField("String","DEEPSEEK_MODEL",ds("model"))

        // 服务器代理地址（TTS/LLM/SOE）
        buildConfigField("String","TTS_SERVER_HOST","\"\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = true
      aidl = false
      buildConfig = true
      shaders = false
    }

    testOptions {
      unitTests.isReturnDefaultValues = true
    }

    packaging {
      resources {
        excludes += "/META-INF/{AL2.0,LGPL2.1}"
      }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  // Core Android dependencies
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  // Arch Components
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Compose
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation("androidx.compose.material:material-icons-core")
  // Tooling
  debugImplementation(libs.androidx.compose.ui.tooling)
  // Instrumented tests
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  // Local tests: jUnit, coroutines, Android runner
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.kotlinx.serialization.json)

  // Instrumented tests: jUnit rules and runners
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)

  // Navigation
  implementation(libs.androidx.navigation3.ui)
  implementation(libs.androidx.navigation3.runtime)
  implementation(libs.androidx.lifecycle.viewmodel.navigation3)

  // OkHttp
  implementation(libs.okhttp)

  // Media3 (ExoPlayer) — 视频播放 + A/B循环
  implementation(libs.androidx.media3.exoplayer)
  implementation(libs.androidx.media3.ui)

  // Tencent Cloud SOE Android SDK (AAR)
  implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar"))))
  implementation("com.google.code.gson:gson:2.10.1")

  // kotlinx-serialization
  implementation(libs.kotlinx.serialization.json)
}
