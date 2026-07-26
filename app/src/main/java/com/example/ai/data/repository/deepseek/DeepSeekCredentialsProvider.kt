package com.example.ai.data.repository.deepseek

import java.io.File
import java.io.FileInputStream
import java.util.*

/**
 * 从本地配置文件读取 DeepSeek 凭证
 *
 * 查找顺序：
 * 1. 系统属性 deepseek.config.path
 * 2. 项目根目录 deepseek.local.properties
 * 3. 用户目录 deepseek.local.properties
 */
object DeepSeekCredentialsProvider {

    private const val DEFAULT_FILE_NAME = "deepseek.local.properties"

    fun load(configPath: String? = null): DeepSeekConfig? {
        val props = Properties()

        // 1. 指定路径
        if (configPath != null) {
            val file = File(configPath)
            if (file.exists()) {
                FileInputStream(file).use { props.load(it) }
                return buildConfig(props)
            }
        }

        // 2. 项目根目录
        var dir = File(".").absoluteFile
        for (i in 1..3) {
            val file = File(dir, DEFAULT_FILE_NAME)
            if (file.exists()) {
                FileInputStream(file).use { props.load(it) }
                return buildConfig(props)
            }
            val parent = dir.parentFile ?: break
            dir = parent
        }

        // 3. 用户目录
        val userHome = File(System.getProperty("user.home") ?: ".")
        if (userHome.exists()) {
            val file = File(userHome, DEFAULT_FILE_NAME)
            if (file.exists()) {
                FileInputStream(file).use { props.load(it) }
                return buildConfig(props)
            }
        }

        return null
    }

    private fun buildConfig(props: Properties): DeepSeekConfig? {
        val apiKey = props.getProperty("deepseek.apiKey") ?: return null
        if (apiKey.isBlank()) return null

        return DeepSeekConfig(
            apiKey = apiKey,
            baseUrl = props.getProperty("deepseek.baseUrl", "https://api.deepseek.com"),
            model = props.getProperty("deepseek.model", "deepseek-v4-flash"),
        )
    }
}
