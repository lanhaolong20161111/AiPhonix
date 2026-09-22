package com.example.ai.data.tts

import com.example.ai.data.chinesepractice.normalizePinyin
import com.example.ai.di.ServiceModule

/** 百度可识别的音节：字母 + 数字调 1~5（与服务端 `SYLLABLE_RE` 一致：`/^[a-z]{1,6}[1-5]$/`） */
private val BAIDU_SYLLABLE_RE = Regex("^[a-z]{1,6}[1-5]$")

/**
 * 拼音 → 百度可识别的数字调音节；非法输入返回 ""。
 * `"zhòng"` → `"zhong4"`；`"zhong4"` → `"zhong4"`；`"zhong"`（无声调）→ `""`。
 *
 * ⚠️ **必须带数字调**：实测确认百度 TTS 对「字(无声调)」会把拼音字母当字面内容念出来
 *   （见 web `src/lib/ttsPinyin.ts` 的对照实验注释），所以拿不到声调时宁可不注音，
 *   也不要退化成 `字(zhong)` —— 那会把 "zhong" 念出来。
 *
 * 复用 `data.chinesepractice.normalizePinyin`（与 web `src/lib/pinyin.ts` 同逻辑），不另起一份。
 */
fun toBaiduSyllable(pinyin: String): String {
    val s = normalizePinyin(pinyin).trim().lowercase()
    return if (BAIDU_SYLLABLE_RE.matches(s)) s else ""
}

/**
 * 单字音频 URL —— 对齐 web `useTts.speakChar` 的容器端点 `GET /tts/char/:char`。
 *
 * 语义：先查人工录音库 → 再查 TTS 沉淀库，都未命中才实时调百度合成并沉淀，
 * 因此任何字/音节只消耗一次百度配额。
 *
 * @param pinyin 可选注音（带声调符号，如 `"jīng"`）。服务端只认数字调格式，
 *   故内部先经 [toBaiduSyllable] 转换；转换失败则不传 pinyin（宁可不锁读音）。
 */
fun charAudioUrl(
    char: String,
    pinyin: String = "",
    serverBase: String = ServiceModule.serverBase,
): String {
    val encoded = java.net.URLEncoder.encode(char, "UTF-8")
    val syl = toBaiduSyllable(pinyin)
    return if (syl.isEmpty()) {
        "$serverBase/api/v1/tts/char/$encoded"
    } else {
        "$serverBase/api/v1/tts/char/$encoded?pinyin=$syl"
    }
}

/** 单字音频请求所需的认证头（该端点服务端要求登录） */
fun ttsAuthHeaders(): Map<String, String> {
    val token = com.example.ai.data.auth.TokenManager.accessToken
    return if (token.isBlank()) emptyMap() else mapOf("Authorization" to "Bearer $token")
}
