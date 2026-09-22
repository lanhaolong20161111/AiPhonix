package com.example.ai.data.speech

import android.util.Log
import com.example.ai.data.model.*
import com.example.ai.di.ServiceModule
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * 服务端语音评测 API 客户端 — 只负责 HTTP 请求和 JSON 解析。
 *
 * 职责范围:
 * - 将 PCM 音频 base64 编码后发送到服务端 /soe/evaluate
 * - 解析 JSON 响应 → PronunciationResult
 *
 * 不涉及:
 * - 音频采集
 * - 协程管理（调用方提供协程上下文/决定同步或异步）
 */
class ScoreClient(
    private val client: OkHttpClient,
) {
    /**
     * 发送 PCM 音频到服务端进行发音评测。
     * @param refText 参考文本
     * @param audioBase64 PCM 16bit 16kHz mono 的 base64 编码
     * @param engine 评测引擎（留空使用默认）
     * @param evalMode 评测模式（"8"=拼音评测；空=段落）
     */
    fun evaluate(refText: String, audioBase64: String, engine: String = "", evalMode: String = ""): PronunciationResult {
        val jsonBody = JSONObject().apply {
            put("ref_text", refText)
            put("audio_base64", audioBase64)
            if (engine.isNotEmpty()) put("engine", engine)
            if (evalMode.isNotEmpty()) put("eval_mode", evalMode)
        }

        val request = Request.Builder()
            .url("${serverBase()}/api/v1/soe/evaluate")
            .post(jsonBody.toString().toRequestBody(JSON_MEDIA))
            .build()

        Log.d(TAG, "发送 SOE 请求: ref_text=$refText, audio_len=${audioBase64.length}")
        val response = client.newCall(request).execute()

        if (!response.isSuccessful) {
            val err = response.body?.string() ?: "unknown"
            throw RuntimeException("服务端 SOE 代理 ${response.code}: $err")
        }

        val bodyStr = response.body?.string() ?: throw RuntimeException("服务端响应为空")
        return parseJsonResponse(bodyStr, refText)
    }

    companion object {
        private const val TAG = "ScoreClient"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        // ── ARPAbet → 国际音标（IPA）映射 ──
        // 腾讯 SOE 英文引擎返回 ARPAbet 音标，此映射表将其转为 IPA。

        private val ARPABET_TO_IPA = mapOf(
            // 元音
            "AA" to "ɑ",
            "AE" to "æ",
            "AH" to "ʌ",
            "AH0" to "ə",  // unstressed schwa
            "AO" to "ɔ",
            "AW" to "aʊ",
            "AY" to "aɪ",
            "EH" to "ɛ",
            "ER" to "ɜr",
            "ER0" to "ɚ",  // unstressed r-colored schwa
            "EY" to "eɪ",
            "IH" to "ɪ",
            "IY" to "i",
            "OW" to "oʊ",
            "OY" to "ɔɪ",
            "UH" to "ʊ",
            "UW" to "u",
            // 辅音
            "B" to "b",
            "CH" to "tʃ",
            "D" to "d",
            "DH" to "ð",
            "F" to "f",
            "G" to "ɡ",
            "HH" to "h",
            "JH" to "dʒ",
            "K" to "k",
            "L" to "l",
            "M" to "m",
            "N" to "n",
            "NG" to "ŋ",
            "P" to "p",
            "R" to "r",
            "S" to "s",
            "SH" to "ʃ",
            "T" to "t",
            "TH" to "θ",
            "V" to "v",
            "W" to "w",
            "Y" to "j",
            "Z" to "z",
            "ZH" to "ʒ",
        )

        /** 服务端基础地址：与全局 ServiceModule 一致（支持 BuildConfig 覆盖，避免硬编码旧 IP） */
        fun serverBase(): String = ServiceModule.serverBase

        /** 腾讯 ARPAbet → 国际音标（IPA）。已含斜杠则跳过，未知符号保留原文。 */
        fun arpabetToIpa(phone: String): String {
            if (phone.startsWith("/")) return phone  // 已经是 IPA
            // 去掉尾随重音数字（如 AH0→AH, EH1→EH）
            val ipa = ARPABET_TO_IPA[phone] ?: ARPABET_TO_IPA[phone.trimEnd('0', '1', '2')]
            return if (ipa != null) "/$ipa/" else "/$phone/"
        }

        /**
         * 解析服务端评测 JSON 响应为 [PronunciationResult]。
         * 纯函数（使用 kotlinx.serialization.json），不涉及网络，可在 JUnit 中测试。
         *
         * 期望 JSON 格式（腾讯云 SOE 返回，字段为 PascalCase）：
         * ```json
         * {
         *   "pron_accuracy": 85,
         *   "pron_fluency": 0.75,
         *   "pron_completion": 0.9,
         *   "suggested_score": 0.8,
         *   "words": [{
         *     "word": "hello",
         *     "accuracy": 85.0,
         *     "match_tag": 0,
         *     "phone_infos": [{ "phone": "/h/", "accuracy": 90.0 }]
         *   }]
         * }
         * ```
         *
         * 注意：腾讯 SOE 英文引擎返回 ARPAbet 音标（如 HH、AH0、W），
         * 此方法会自动将其映射为国际音标（IPA）。若 phone 已含斜杠则保留原值。
         */
        @JvmStatic
        fun parseJsonResponse(jsonBodyStr: String, refText: String): PronunciationResult {
            val root = Json.parseToJsonElement(jsonBodyStr).jsonObject

            val score = (root["pron_accuracy"]?.jsonPrimitive?.doubleOrNull?.toInt() ?: 0).coerceIn(0, 100)
            val fluency = root["pron_fluency"]?.jsonPrimitive?.doubleOrNull ?: 0.0
            val completion = root["pron_completion"]?.jsonPrimitive?.doubleOrNull ?: 0.0
            val suggested = root["suggested_score"]?.jsonPrimitive?.doubleOrNull ?: 0.0

            val phonemeScores = mutableListOf<PhonemeScore>()
            val wordScores = mutableListOf<WordScore>()

            val wordsArr = root["words"]?.jsonArray
            if (wordsArr != null) {
                for (wElem in wordsArr) {
                    val w = wElem.jsonObject
                    val wordText = w["word"]?.jsonPrimitive?.content ?: ""
                    val wordAcc = (w["accuracy"]?.jsonPrimitive?.doubleOrNull ?: 0.0).toFloat()
                    val matchTag = w["match_tag"]?.jsonPrimitive?.intOrNull ?: 0

                    // 逐词音素：句子模式下腾讯**也**返回 phone_infos（对齐 web SoeWord.phone_infos），
                    // 既入全局扁平表（既有调用方读它），也挂到该词上（「每日英语」点词展开用）。
                    val wordPhones = mutableListOf<PhonemeScore>()
                    val phones = w["phone_infos"]?.jsonArray
                    if (phones != null) {
                        for (pElem in phones) {
                            val p = pElem.jsonObject
                            val phoneName = p["phone"]?.jsonPrimitive?.content ?: ""
                            val phoneIpa = arpabetToIpa(phoneName)
                            val rawAcc = p["accuracy"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                            val phoneScore = rawAcc.toInt().coerceIn(0, 100)
                            wordPhones.add(PhonemeScore(
                                phoneme = phoneIpa,
                                score = phoneScore,
                                level = when {
                                    phoneScore >= 80 -> ScoreLevel.GOOD
                                    phoneScore >= 60 -> ScoreLevel.OKAY
                                    else -> ScoreLevel.NEEDS_WORK
                                },
                                rawAccuracy = rawAcc.toFloat(),
                                matchTag = p["match_tag"]?.jsonPrimitive?.intOrNull ?: 0,
                            ))
                        }
                    }
                    phonemeScores.addAll(wordPhones)
                    wordScores.add(WordScore(
                        word = wordText,
                        pronAccuracy = wordAcc.coerceIn(0f, 100f),
                        matchTag = matchTag,
                        phoneInfos = wordPhones,
                    ))
                }
            }

            return PronunciationResult(
                word = Word(text = refText, ipa = "", letter = "", phonemes = emptyList()),
                totalScore = score,
                phonemeScores = phonemeScores,
                wordScores = wordScores,
                accuracyScore = score.toDouble(),
                fluencyScore = fluency,
                integrityScore = completion,
                standardScore = suggested,
                feedback = when {
                    score >= 80 -> "读得很好！🎉"
                    score >= 60 -> "不错，再练练！"
                    else -> "多跟读几遍"
                },
            )
        }
    }
}
