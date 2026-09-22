package com.example.ai.data.asr

import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject

/**
 * 百度实时语音识别的 WebSocket 客户端 — `GET /api/v1/asr/stream?lang=zh|en`。
 *
 * 对齐 web `useEnglishTurn` / `useSpeechComposer` 的流式链路：服务端
 * （`server_cf/src/routes/asr.ts`）拦截 START 帧注入百度凭据后中转
 * `vop.baidu.com/realtime_asr`，音频二进制帧与结果帧双向透传。
 *
 * 消息契约（**以服务端为准**）：
 * - 上行文本帧：`{"type":"START","data":{"cuid":...}}`（**必须先发**，服务端据此建百度连接）、
 *   `{"type":"FINISH"}`（结束当前句，百度随后回 FIN_TEXT）。CANCEL/HEARTBEAT 服务端原样转发，本客户端不用。
 * - 上行二进制帧：16k/16bit/mono PCM，原样转百度。
 * - 下行文本帧（百度原样透传 + 服务端合成）：
 *   - `{"type":"MID_TEXT","result":"..."}` — 实时临时文本（句子未定稿）
 *   - `{"type":"FIN_TEXT","err_no":0,"result":"..."}` — 一句定稿；`err_no!=0` 失败
 *     （`-3004` 鉴权/百度连接失败 —— 服务端连不上百度时也合成 `err_no:-3004` 的 FIN_TEXT）
 *   - `{"type":"CLOSED"}` / `{"type":"ERROR","detail":"..."}` — 服务端在百度侧关闭/出错时合成
 *
 * ⚠️ 所有回调都在 **OkHttp 线程**触发；调用方自行切线程（本类不持 Context、不开协程）。
 */
class StreamingAsrClient(
    private val lang: String = "en",
    serverBase: String = ServiceModule.serverBase,
    client: OkHttpClient = NetworkModule.httpClient,
) : WebSocketListener() {

    /** 下行事件（OkHttp 线程触发） */
    interface Listener {
        fun onMidText(result: String)
        fun onFinText(errNo: Int, result: String)
        /** 百度侧关闭（服务端合成的 CLOSED 帧） */
        fun onUpstreamClosed()
        /** 传输层错误（连接失败/IO 异常） */
        fun onTransportError(message: String)
    }

    private val wsUrl: String = serverBase
        .replace("https://", "wss://")
        .replace("http://", "ws://")
        .let { base -> "$base/api/v1/asr/stream?lang=$lang" }

    private val okClient: OkHttpClient = client
    private var ws: WebSocket? = null
    private var listener: Listener? = null

    /** 连接握手门：onOpen → true，onFailure → false（幂等） */
    private var openGate = CompletableDeferred<Boolean>()

    /**
     * `sendFinish()` 后等「这句最终结果」的门：FIN_TEXT / CLOSED / ERROR 任一到达即放行。
     * web `waitFinalText` 的等价物（单词/短句的结果只在 FINISH 后才回，固定睡 300ms 常掐掉尾部）。
     */
    @Volatile
    private var finalGate: CompletableDeferred<Unit>? = null

    /** 建连（非挂起）：真正的成败用 [awaitOpen] 等 onOpen/onFailure 回调 */
    fun connect(listener: Listener) {
        this.listener = listener
        openGate = CompletableDeferred()
        finalGate = null
        ws = okClient.newWebSocket(Request.Builder().url(wsUrl).build(), this)
    }

    /** 等握手结果。`true` = 已连上；`false` = 失败或超时 */
    suspend fun awaitOpen(timeoutMs: Long = 10_000): Boolean =
        withTimeoutOrNull(timeoutMs) { openGate.await() } ?: false

    fun sendStart(cuid: String) {
        val payload = JSONObject().apply {
            put("type", "START")
            put("data", JSONObject().put("cuid", cuid))
        }
        trySend(payload.toString())
    }

    fun sendPcm(chunk: ByteArray) {
        trySend(chunk.toByteString(0, chunk.size))
    }

    /**
     * 发 FINISH 结束当前句，并重置 [awaitFinalText] 的等待门。
     * ⚠️ 必须先 [sendFinish] 再 [awaitFinalText]（门在此时才建立）。
     */
    fun sendFinish() {
        finalGate = CompletableDeferred()
        trySend("{\"type\":\"FINISH\"}")
    }

    /** 等这句的最终结果（FIN_TEXT/CLOSED/ERROR）。超时返回 false（web 是固定 1.5s 后放行） */
    suspend fun awaitFinalText(timeoutMs: Long = 1_500): Boolean {
        val gate = finalGate ?: return false
        return withTimeoutOrNull(timeoutMs) { gate.await() } != null
    }

    /** 优雅关闭（发 close 帧） */
    fun close() {
        try { ws?.close(1000, null) } catch (_: Exception) {}
        ws = null
    }

    /** 立即断开（不等 close 帧；onCleared / 换轮作废用） */
    fun cancel() {
        try { ws?.cancel() } catch (_: Exception) {}
        ws = null
    }

    private fun trySend(payload: String): Boolean = try {
        ws?.send(payload) ?: false
    } catch (_: Exception) {
        false
    }

    private fun trySend(data: ByteString): Boolean = try {
        ws?.send(data) ?: false
    } catch (_: Exception) {
        false
    }

    // ── WebSocketListener（OkHttp 线程） ──

    override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
        openGate.complete(true)
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
        openGate.complete(false)
        finalGate?.complete(Unit)
        listener?.onTransportError(t.message ?: "语音连接失败")
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        val j = try {
            JSONObject(text)
        } catch (_: Exception) {
            return
        }
        when (j.optString("type")) {
            "MID_TEXT" -> listener?.onMidText(j.optString("result"))
            "FIN_TEXT" -> {
                listener?.onFinText(j.optInt("err_no", 0), j.optString("result"))
                finalGate?.complete(Unit)
            }
            "CLOSED" -> {
                listener?.onUpstreamClosed()
                finalGate?.complete(Unit)
            }
            "ERROR" -> {
                // 服务端合成帧也当「这句已到头」放行，避免 awaitFinalText 干等超时
                finalGate?.complete(Unit)
            }
        }
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        finalGate?.complete(Unit)
        listener?.onTransportError("连接已关闭")
    }
}
