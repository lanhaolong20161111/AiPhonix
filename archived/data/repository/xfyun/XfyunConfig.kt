package com.example.ai.data.repository.xfyun

/**
 * 讯飞开放平台应用凭证
 * @param appId 应用 ID（从讯飞控制台获取）
 * @param apiKey API Key
 * @param apiSecret API Secret
 */
data class XfyunConfig(
    val appId: String,
    val apiKey: String,
    val apiSecret: String,
)
