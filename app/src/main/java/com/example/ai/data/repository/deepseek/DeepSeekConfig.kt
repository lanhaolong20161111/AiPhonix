package com.example.ai.data.repository.deepseek

/**
 * DeepSeek API 配置
 * @param apiKey DeepSeek API Key（从 platform.deepseek.com 获取）
 * @param baseUrl API 基础地址（默认 https://api.deepseek.com）
 * @param model 模型名称（默认 deepseek-chat）
 */
data class DeepSeekConfig(
    val apiKey: String,
    val baseUrl: String = "https://api.deepseek.com",
    val model: String = "deepseek-v4-flash",
)
