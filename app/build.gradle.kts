plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

// ── 这里原本从根目录的 *.local.properties 读凭证并注入 BuildConfig ──
// 2026-10-13 移除，两个理由叠加起来是硬伤：
//   1. 那 12 个字段（XF_* / TC_* / BD_* / DEEPSEEK_*）在**参与编译的源码里引用数为 0**。
//      全仓唯一引用在 `archived/data/repository/xfyun/` 下，那个目录不是 Gradle source set。
//   2. debug 包不做裁剪 ⇒ 即使没人用，常量也会原样留在 classes.dex 里，
//      `unzip app.apk 'classes*.dex' && grep -a 'sk-'` 就能拿到明文。
// 而这个 APK 是挂在**公开**的 /dl 下载页上的 ⇒ 等于把 DeepSeek / 腾讯云 / 百度 / 讯飞的
// 凭据一起公开发布。实测旧包里能直接抓到 sk-*（35 字符）与 AKID*（36 字符）。
// 现在 App 的 TTS / LLM / SOE 全部走服务端代理，客户端不需要任何供应商凭据。
// 若将来确有功能必须在客户端直连某家服务，别把 key 放回这里 —— 走服务端转发。

android {
    namespace = "com.example.ai"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.ai"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.1"

        // 客户端只需要知道服务端在哪；供应商凭据一律留在服务端。
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

  // ExifInterface — 读取照片方向（EXIF），原图显示时自动纠正横拍
  implementation("androidx.exifinterface:exifinterface:1.3.7")

  // Coil — 图片加载
  implementation("io.coil-kt:coil-compose:2.7.0")

  // Compose Foundation — HorizontalPager
  implementation("androidx.compose.foundation:foundation")

  // Media3 (ExoPlayer) — 视频播放 + A/B循环
  implementation(libs.androidx.media3.exoplayer)
  implementation(libs.androidx.media3.ui)

  // Tencent Cloud SOE Android SDK (AAR)
  implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar"))))
  implementation("com.google.code.gson:gson:2.10.1")

  // kotlinx-serialization
  implementation(libs.kotlinx.serialization.json)
}
