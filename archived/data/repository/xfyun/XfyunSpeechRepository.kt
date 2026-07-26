package com.example.ai.data.repository.xfyun

import com.example.ai.data.model.*
import com.example.ai.data.repository.SpeechRepository
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.*
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.StringReader
import java.util.concurrent.atomic.AtomicReference
import android.util.Log
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import kotlin.math.roundToInt

/**
 * 讯飞流式语音评测 API 实现（v2/open-ise）
 *
 * 协议（遵循官方文档 https://www.xfyun.cn/doc/Ise/IseAPI.html）：
 * 1. WebSocket 连接 wss://ise-api.xfyun.cn/v2/open-ise?authorization=...&date=...&host=...
 * 2. 数据帧格式：{ "common": {...}, "business": {...}, "data": {...} }
 * 3. 流程：
 *    a. ssb 帧（参数上传）：business.cmd="ssb", data.status=0
 *    b. auw 帧（音频上传）：business.cmd="auw", business.aus=1/2/4, data.status=1/2
 *    c. 接收评测结果 JSON
 */
class XfyunSpeechRepository(
    private val config: XfyunConfig,
    private val apiUrl: String = "wss://ise-api.xfyun.cn/v2/open-ise",
) : SpeechRepository {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
    private val httpClient = OkHttpClient.Builder()
        .pingInterval(15, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    override suspend fun evaluatePronunciation(word: Word, audioStream: InputStream): PronunciationResult {
        Log.d("XfyunSpeech", "========== 开始评测: ${word.text} ==========")
        Log.d("XfyunSpeech", "AppId=${config.appId}, PCM大小=${audioStream.available()} bytes")

        // 1. 读取全部 PCM 音频到 ByteArray
        val pcmData = audioStream.readBytes()
        Log.d("XfyunSpeech", "PCM数据已读取: ${pcmData.size} bytes")

        // PCM 信号诊断：检查音频是否含实际内容
        var pcmMax = 0
        var pcmMin = 0
        var pcmSum = 0L
        for (i in 0 until pcmData.size - 1 step 2) {
            val sample = ((pcmData[i + 1].toInt() and 0xFF) shl 8) or (pcmData[i].toInt() and 0xFF)
            val signed = if (sample >= 0x8000) sample - 0x10000 else sample
            if (signed > pcmMax) pcmMax = signed
            if (signed < pcmMin) pcmMin = signed
            pcmSum += Math.abs(signed.toLong())
        }
        val pcmAvg = if (pcmData.size > 0) pcmSum / (pcmData.size / 2) else 0
        Log.d("XfyunSpeech", "PCM诊断: peak=+$pcmMax/-${-pcmMin}, avg=$pcmAvg (满幅=32767)")
        if (pcmAvg < 100) {
            Log.w("XfyunSpeech", "警告：音频信号极弱($pcmAvg)，可能录音未捕获到语音！")
        }

        return suspendCancellableCoroutine { continuation ->
            try {
                val date = XfyunAuth.currentGmtDate()
                val authUrl = XfyunAuth.generateAuthUrl(config, apiUrl, date)

                // 结果暂存
                val sessionResult = AtomicReference<XfyunIseResult?>(null)
                var audioSent = false  // 防止重复发送音频帧

                val request = Request.Builder().url(authUrl).build()
                val ws = httpClient.newWebSocket(request, object : WebSocketListener() {

                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        Log.d("XfyunSpeech", "WebSocket 已连接 (HTTP ${response.code}), 发送 ssb 帧")
                        // 握手成功：发送 ssb 参数帧
                        val ssbFrame = buildSsbFrame(word.text)
                        webSocket.send(ssbFrame)
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        Log.d("XfyunSpeech", "收到消息: ${text.take(300)}")
                        val resp = try {
                            json.decodeFromString<IseResponse>(text)
                        } catch (e: Exception) {
                            Log.e("XfyunSpeech", "JSON 解析失败: ${e.message}")
                            return
                        }

                        if (resp.code != 0) {
                            val errMsg = "讯飞错误 code=${resp.code}: ${resp.message}"
                            Log.e("XfyunSpeech", errMsg)
                            continuation.resumeWithException(
                                RuntimeException(errMsg)
                            )
                            return
                        }

                        // ssb 响应确认：code=0 且 data.data 为空（status 可能是 0 或 1）
                        if (!audioSent && resp.code == 0 && resp.data?.data.isNullOrEmpty()) {
                            audioSent = true
                            Log.d("XfyunSpeech", "ssb 响应确认, 开始发音频")
                            // AudioRecord PCM 输出为 little-endian，讯飞 L16 raw 要求小端，直接发送
                            CoroutineScope(Dispatchers.IO).launch {
                                sendAudioFrames(webSocket, pcmData)
                            }
                        }

                        // 收到评测结果
                        val responseData = resp.data ?: return@onMessage
                        if (responseData.status == 2 && responseData.data != null) {
                            Log.d("XfyunSpeech", "收到评测结果，data(截断): ${responseData.data.take(100)}")
                            val resultXml = String(
                                java.util.Base64.getDecoder().decode(responseData.data),
                                Charsets.UTF_8
                            )
                            Log.d("XfyunSpeech", "完整XML:\n${resultXml.take(2000)}")
                            try {
                                val iseResult = parseXmlToIseResult(resultXml)
                                sessionResult.set(iseResult)
                                webSocket.close(1000, "done")
                            } catch (e: Exception) {
                                Log.e("XfyunSpeech", "XML解析失败: ${e.message}", e)
                                continuation.resumeWithException(
                                    RuntimeException("XML解析失败: ${e.message}", e)
                                )
                            }
                        }
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        Log.e("XfyunSpeech", "WebSocket 失败: ${t.message}", t)
                        if (response != null) {
                            Log.e("XfyunSpeech", "HTTP 响应: ${response.code} ${response.message}")
                        }
                        if (!continuation.isCancelled) {
                            continuation.resumeWithException(
                                RuntimeException("WebSocket 失败: ${t.message}", t)
                            )
                        }
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        val sr = sessionResult.get()
                        if (sr != null) {
                            continuation.resume(parseResult(word, sr))
                        } else if (!continuation.isCancelled) {
                            continuation.resumeWithException(
                                RuntimeException("讯飞连接关闭但未收到评测结果 (code=$code)")
                            )
                        }
                    }
                })

                continuation.invokeOnCancellation {
                    ws.close(1000, "cancel")
                }
            } catch (e: Exception) {
                if (!continuation.isCancelled) {
                    continuation.resumeWithException(e)
                }
            }
        }
    }

    /**
     * 构建 ssb 帧（参数上传阶段）
     * UTF8-BOM: \uFEFF 开头
     * 英文 read_word 格式（详见讯飞 ISE 文档）：
     *   [word]
     *   单词
     */
    private fun buildSsbFrame(refText: String): String {
        // read_word 格式: 必须用 [word] 节点包装
        val textWithBom = "\uFEFF[word]\n$refText"
        Log.d("XfyunSpeech", "ssb text: ${textWithBom.replace("\r\n", "\\r\\n")}")

        val frame = buildJsonObject {
            put("common", buildJsonObject {
                put("app_id", config.appId)
            })
            put("business", buildJsonObject {
                put("sub", "ise")
                put("ent", "en_vip")
                put("category", "read_word")
                put("cmd", "ssb")
                put("text", textWithBom)
                put("tte", "utf-8")
                put("auf", "audio/L16;rate=16000")
                put("aue", "raw")
                put("extra_ability", "syll_phone_err_msg;multi_dimension;pitch")
            })
            put("data", buildJsonObject {
                put("status", 0)
                put("data", "")
            })
        }
        return json.encodeToString(JsonElement.serializer(), frame)
    }


    /**
     * 发送所有音频帧（auw 阶段）— 每帧间隔 ~40ms 模拟实时流
     * 每 1280 字节一帧（40ms @ 16kHz 16bit），base64 编码
     * aus: 1=首帧, 2=中间帧, 4=末帧
     */
    private suspend fun sendAudioFrames(webSocket: WebSocket, pcm: ByteArray) {
        val frameSize = 1280
        val chunks = pcm.toList().chunked(frameSize)

        if (chunks.isEmpty()) {
            // 空音频：发送空首+末帧
            webSocket.send(buildAuwFrame(1, 1, ""))
            webSocket.send(buildAuwFrame(2, 4, ""))
            return
        }

        chunks.forEachIndexed { index, chunk ->
            val chunkBytes = chunk.toByteArray()
            val base64 = java.util.Base64.getEncoder().encodeToString(chunkBytes)
            val isFirst = index == 0
            val isLast = index == chunks.lastIndex

            val aus = when {
                isFirst && isLast -> 1  // 单帧
                isFirst -> 1
                isLast -> 4
                else -> 2
            }
            val status = if (isLast) 2 else 1

            webSocket.send(buildAuwFrame(status, aus, base64))
            // 模拟实时音频流：每帧间隔 ~40ms
            if (index < chunks.lastIndex) delay(40)
        }
        Log.d("XfyunSpeech", "音频全部发送完毕, chunks=${chunks.size}")
    }

    /** 构建 auw 帧（音频上传阶段） */
    private fun buildAuwFrame(status: Int, aus: Int, dataBase64: String): String {
        val frame = buildJsonObject {
            put("business", buildJsonObject {
                put("cmd", "auw")
                put("aus", aus)
                put("aue", "raw")
            })
            put("data", buildJsonObject {
                put("status", status)
                put("data", dataBase64)  // 讯飞 v2 字段名为 data
                put("data_type", 1)
                put("encoding", "raw")
            })
        }
        return json.encodeToString(JsonElement.serializer(), frame)
    }

    /** 将 gwpp（后验概率 log 域，≤0）归一化为 0-100 分 */
    private fun gwppToScore(gwpp: Double): Int {
        // gwpp 范围：0（最优）→ 负数（越差），ex: -0.034 → exp=0.967 → 97分
        val raw = 100.0 * kotlin.math.exp(gwpp)
        return raw.roundToInt().coerceIn(0, 100)
    }

    /** 解析评测结果 */
    private fun parseResult(word: Word, ise: XfyunIseResult): PronunciationResult {
        val phonemeScores = ise.phoneList.map { ph ->
            val gwppScore = if (ph.gwpp < 0.0) gwppToScore(ph.gwpp) else ph.phoneScore.roundToInt()
            PhonemeScore(
                phoneme = "/${ph.phone}/",
                score = gwppScore,
                level = when {
                    gwppScore >= 80 -> ScoreLevel.GOOD
                    gwppScore >= 60 -> ScoreLevel.OKAY
                    else -> ScoreLevel.NEEDS_WORK
                },
                dpMessage = ph.dpMessage,
                serrMsg = ph.serrMsg,
                syllAccent = ph.syllAccent,
                gwpp = ph.gwpp,
                gwppScore = gwppScore,
            )
        }

        // 总分用所有音素 gwpp 的均分（比 raw total_score 更合理）
        // total_score 实际 scale 偏低，gwpp 是 log 后验概率，exp 映射到 0-100 更直观
        val gwppAverage = if (phonemeScores.isNotEmpty()) {
            phonemeScores.map { it.gwppScore }.average().roundToInt()
        } else {
            ise.totalScore.roundToInt()
        }
        val rejectedNote = if (ise.isRejected) "（警告：检测到乱读，分数不可参考）" else ""

        return PronunciationResult(
            word = word,
            totalScore = gwppAverage,
            phonemeScores = phonemeScores,
            accuracyScore = ise.accuracyScore,
            standardScore = ise.standardScore,
            isRejected = ise.isRejected,
            exceptInfo = ise.exceptInfo,
            feedback = "得分 ${gwppAverage} 分！继续加油！$rejectedNote",
        )
    }
}

// ========== 讯飞协议数据模型 ==========

/** WebSocket 响应帧 */
@Serializable
data class IseResponse(
    val code: Int = 0,
    val message: String = "",
    val sid: String = "",
    val data: IseResponseData? = null,
)

@Serializable
data class IseResponseData(
    val status: Int = 0,
    val data: String? = null,
)

/** 评测结果（从 XML 解析） */
data class XfyunIseResult(
    val totalScore: Double,
    val phoneCount: Int = 0,
    val phoneList: List<XfyunPhoneScore> = emptyList(),
    val accuracyScore: Double = 0.0,
    val standardScore: Double = 0.0,
    val isRejected: Boolean = false,
    val exceptInfo: Int = 0,
)

data class XfyunPhoneScore(
    val phone: String,
    val phoneScore: Double,
    val phoneType: Int = 0,
    val dpMessage: Int = 0,
    val serrMsg: Int = 0,
    val syllAccent: Int = 0,
    val gwpp: Double = 0.0,
)

/**
 * 解析讯飞 ISE 返回的 XML 评测结果
 *
 * 实际 XML 结构（read_word 题型）:
 * <xml_result>
 *   <read_word lan="en" type="study" version="...">          // 外层
 *     <rec_paper>
 *       <read_word accuracy_score="0.37" beg_pos="0"          // 内层：评分属性
 *                  content="apple" end_pos="148"
 *                  except_info="28676" is_rejected="true"
 *                  standard_score="0.00" total_score="0.37">
 *         <sentence beg_pos="0" content="apple" index="0">
 *           <word beg_pos="19" content="apple" dp_message="0" total_score="0.37">
 *             <syll content="ae" serr_msg="1" syll_accent="1"
 *                   syll_score="1.80">
 *               <phone content="ae" dp_message="0"/>
 *             </syll>
 *             <syll content="p ax l" serr_msg="1" syll_accent="0"
 *                   syll_score="0.00">
 *               <phone content="p" dp_message="0"/>
 *               <phone content="ax" dp_message="0"/>
 *               <phone content="l" dp_message="0"/>
 *             </syll>
 *           </word>
 *         </sentence>
 *       </read_word>
 *     </rec_paper>
 *   </read_word>
 * </xml_result>
 *
 * 注意事项（详见讯飞文档）：
 * - is_rejected=true 表示被拒（乱读），分值不可参考
 * - except_info=28673(0x7001) 无语音/音量小
 * - except_info=28676(0x7004) 乱说
 * - except_info=28680(0x7008) 信噪比低
 * - dp_message=0 正常 / 16 漏读 / 32 增读
 * - serr_msg=0 正确 / 1 读错
 * - syll_accent=0 无需重读 / 1 需重读
 */
private fun parseXmlToIseResult(xml: String): XfyunIseResult {
    val factory = XmlPullParserFactory.newInstance()
    val parser = factory.newPullParser()
    parser.setInput(StringReader(xml))

    var totalScore = 0.0
    var accuracyScore = 0.0
    var standardScore = 0.0
    var isRejected = false
    var exceptInfo = 0
    val phoneList = mutableListOf<XfyunPhoneScore>()

    var currentSyllScore = 0.0
    var currentSerrMsg = 0
    var currentSyllAccent = 0

    while (parser.eventType != XmlPullParser.END_DOCUMENT) {
        when (parser.eventType) {
            XmlPullParser.START_TAG -> {
                when (parser.name) {
                    "read_word" -> {
                        // 从内层 read_word 读取评分（外层没有 score 属性）
                        val ts = parser.getAttributeValue(null, "total_score")
                        if (ts != null) {
                            totalScore = ts.toDoubleOrNull() ?: totalScore
                            accuracyScore = readAttrDouble(parser, "accuracy_score")
                            standardScore = readAttrDouble(parser, "standard_score")
                            isRejected = readAttrStr(parser, "is_rejected") == "true"
                            exceptInfo = readAttrInt(parser, "except_info")
                        }
                    }
                    "syll" -> {
                        // 每个 syll 开始前重置 phone 上下文
                        currentSyllScore = readAttrDouble(parser, "syll_score")
                        currentSerrMsg = readAttrInt(parser, "serr_msg")
                        currentSyllAccent = readAttrInt(parser, "syll_accent")
                    }
                    "phone" -> {
                        val phoneName = readAttrStr(parser, "content")
                        if (phoneName.isNotEmpty()) {
                            val gwpp = readAttrDouble(parser, "gwpp")
                            phoneList.add(XfyunPhoneScore(
                                phone = phoneName,
                                phoneScore = currentSyllScore,
                                phoneType = 0,
                                dpMessage = readAttrInt(parser, "dp_message"),
                                serrMsg = currentSerrMsg,
                                syllAccent = currentSyllAccent,
                                gwpp = gwpp,
                            ))
                        }
                    }
                }
            }
            XmlPullParser.END_TAG -> {
                // no-op: syll/word/sentence closing doesn't need cleanup
            }
        }
        parser.next()
    }

    return XfyunIseResult(
        totalScore = totalScore,
        phoneCount = phoneList.size,
        phoneList = phoneList,
        accuracyScore = accuracyScore,
        standardScore = standardScore,
        isRejected = isRejected,
        exceptInfo = exceptInfo,
    )
}

/** 从 XmlPullParser 读取属性（int 类型，不存在返回 0） */
private fun readAttrInt(parser: XmlPullParser, name: String): Int {
    val value = parser.getAttributeValue(null, name)?.trim() ?: return 0
    return value.toIntOrNull() ?: 0
}

/** 从 XmlPullParser 读取属性（double 类型，不存在返回 0.0） */
private fun readAttrDouble(parser: XmlPullParser, name: String): Double {
    val value = parser.getAttributeValue(null, name)?.trim() ?: return 0.0
    return value.toDoubleOrNull() ?: 0.0
}

/** 从 XmlPullParser 读取属性（String 类型，不存在返回 ""） */
private fun readAttrStr(parser: XmlPullParser, name: String): String {
    return parser.getAttributeValue(null, name)?.trim() ?: ""
}
