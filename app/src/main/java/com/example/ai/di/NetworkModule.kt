package com.example.ai.di

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * 网络层单例 — 所有 OkHttp 请求共享同一个连接池和超时配置。
 * 取各调用方的最大值：connect=30s, read=120s, write=30s。
 */
object NetworkModule {

    private var _httpClient: OkHttpClient? = null

    /** 单例 OkHttpClient，所有 Repository / ViewModel 共用 */
    val httpClient: OkHttpClient
        get() {
            if (_httpClient == null) {
                _httpClient = createHttpClient()
            }
            return _httpClient!!
        }

    /** 如需独立超时的场景，可由此创建单独的 client */
    fun createHttpClient(
        connectTimeout: Long = 30,
        readTimeout: Long = 120,
        writeTimeout: Long = 30,
    ): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(connectTimeout, TimeUnit.SECONDS)
        .readTimeout(readTimeout, TimeUnit.SECONDS)
        .writeTimeout(writeTimeout, TimeUnit.SECONDS)
        .build()

    /** 重置单例（仅测试用） */
    fun resetForTest() {
        _httpClient = null
    }
}
