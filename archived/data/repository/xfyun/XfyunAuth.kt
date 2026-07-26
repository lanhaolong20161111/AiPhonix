package com.example.ai.data.repository.xfyun

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.io.encoding.Base64

/**
 * 讯飞 WebSocket 鉴权签名生成
 *
 * 遵循官方文档 https://www.xfyun.cn/doc/Ise/IseAPI.html#接口鉴权
 *
 * 1. signature_origin = "host: $host\ndate: $date\nGET $path HTTP/1.1"
 * 2. signature_sha = HMAC-SHA256(signature_origin, apiSecret)
 * 3. signature = Base64(signature_sha)
 * 4. authorization_origin = api_key="...", algorithm="hmac-sha256", headers="host date request-line", signature="..."
 * 5. authorization = Base64(authorization_origin)  ← 关键：整体再做一次 Base64
 * 6. 最终 URL = wss://host/path?authorization=...&date=...&host=...
 */
object XfyunAuth {
    private const val ALGORITHM = "hmac-sha256"
    private const val HEADER_SIGNATURE = "host date request-line"

    /**
     * 生成带鉴权参数的完整 WebSocket URL
     *
     * @param config 应用凭证
     * @param apiUrl 完整 API URL，如 "wss://ise-api.xfyun.cn/v2/open-ise"
     * @param date RFC 1123 格式的当前日期
     * @return 带签名参数的完整 wss URL
     */
    fun generateAuthUrl(
        config: XfyunConfig,
        apiUrl: String,
        date: String,
    ): String {
        // 手动解析 host + path（不用 java.net.URL，Android 不识别 wss 协议）
        val hostStart = apiUrl.indexOf("://") + 3
        val pathStart = apiUrl.indexOf('/', hostStart)
        val host = if (pathStart > 0) apiUrl.substring(hostStart, pathStart) else apiUrl.substring(hostStart)
        val path = if (pathStart > 0) apiUrl.substring(pathStart) else "/"

        // 1. 构建 signature_origin
        val signatureOrigin = buildString {
            append("host: $host\n")
            append("date: $date\n")
            append("GET $path HTTP/1.1")
        }

        // 2. HMAC-SHA256 签名
        val mac = Mac.getInstance("HmacSHA256")
        val secretKey = SecretKeySpec(config.apiSecret.toByteArray(Charsets.UTF_8), "HmacSHA256")
        mac.init(secretKey)
        val signatureSha = mac.doFinal(signatureOrigin.toByteArray(Charsets.UTF_8))

        // 3. Base64 编码签名
        val signature = Base64.encode(signatureSha)

        // 4. 构建 authorization_origin
        val authorizationOrigin = buildString {
            append("api_key=\"${config.apiKey}\", ")
            append("algorithm=\"$ALGORITHM\", ")
            append("headers=\"$HEADER_SIGNATURE\", ")
            append("signature=\"$signature\"")
        }

        // 5. Base64 编码 authorization ← 关键步骤！
        val authorization = Base64.encode(authorizationOrigin.toByteArray(Charsets.UTF_8))

        // 6. URL 编码各个参数，拼接最终 URL
        val encodedAuth = java.net.URLEncoder.encode(authorization, "UTF-8")
        val encodedDate = java.net.URLEncoder.encode(date, "UTF-8")
        val encodedHost = java.net.URLEncoder.encode(host, "UTF-8")

        return "$apiUrl?authorization=$encodedAuth&date=$encodedDate&host=$encodedHost"
    }

    /**
     * 生成当前 GMT 时间（RFC 1123 格式）
     */
    fun currentGmtDate(): String {
        val rfc1123Format = java.text.SimpleDateFormat(
            "EEE, dd MMM yyyy HH:mm:ss z", java.util.Locale.US
        ).apply {
            timeZone = java.util.TimeZone.getTimeZone("GMT")
        }
        return rfc1123Format.format(java.util.Date())
    }
}