package com.example.ai.data.repository.xfyun

import com.example.ai.BuildConfig

/**
 * 从 BuildConfig 读取讯飞凭证（编译时注入）
 *
 * 凭证来源：根目录 xfyun.local.properties（gitignored）
 * Gradle 构建时自动读取并注入 BuildConfig
 */
object XfyunCredentialsProvider {

    fun load(): XfyunConfig? {
        val appId = BuildConfig.XF_APP_ID
        val apiKey = BuildConfig.XF_API_KEY
        val apiSecret = BuildConfig.XF_API_SECRET

        if (appId.isEmpty() || apiKey.isEmpty() || apiSecret.isEmpty()) return null
        return XfyunConfig(appId = appId, apiKey = apiKey, apiSecret = apiSecret)
    }
}
