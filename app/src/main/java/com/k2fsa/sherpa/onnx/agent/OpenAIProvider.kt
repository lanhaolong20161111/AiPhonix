package com.k2fsa.sherpa.onnx.agent

import android.util.Log
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * OpenAI-compatible SSE streaming provider.
 *
 * Works with any provider exposing the `/v1/chat/completions` endpoint
 * (OpenAI, DeepSeek, Zhipu, etc.) as long as the request/response format
 * matches the OpenAI Chat Completions API.
 */
class OpenAIProvider(
    private val configStore: LlmConfigStore,
) : LlmProvider {

    companion object {
        private const val TAG = "OpenAIProvider"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        private const val SSE_DONE = "[DONE]"

        /** Shared OkHttpClient — connection pooling across all instances. */
        val httpClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .build()
        }
    }

    private val gson = Gson()

    override fun streamChat(
        systemPrompt: String?,
        messages: List<LlmProvider.Message>,
        temperature: Double,
        onDelta: (String) -> Unit,
        onDone: (String) -> Unit,
        onError: (Throwable) -> Unit,
    ) {
        val apiKey = configStore.apiKey
        if (apiKey.isBlank()) {
            onError(IllegalStateException("API key not configured"))
            return
        }

        val msgs = mutableListOf<ChatMessage>()
        if (!systemPrompt.isNullOrBlank()) {
            msgs.add(ChatMessage("system", systemPrompt))
        }
        msgs.addAll(messages.map { ChatMessage(it.role, it.content) })

        val body = ChatCompletionRequest(
            model = configStore.model,
            messages = msgs,
            temperature = temperature,
            stream = true,
            // Disable thinking mode for fast non-reasoning responses.
            // DeepSeek V4 defaults to thinking mode; we need explicit disable.
            thinking = ChatCompletionRequest.ThinkingConfig(type = "disabled"),
        )

        val url = "${configStore.baseUrl.trimEnd('/')}/v1/chat/completions"
        val requestBody = gson.toJson(body).toRequestBody(JSON_MEDIA)

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $apiKey")
            .header("Content-Type", "application/json")
            .post(requestBody)
            .build()

        Log.d(TAG, "Streaming to $url model=${configStore.model} temp=$temperature")

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e(TAG, "Stream request failed", e)
                onError(e)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    if (!response.isSuccessful) {
                        val body = response.body?.string() ?: ""
                        Log.e(TAG, "API error ${response.code}: $body")
                        onError(IOException("HTTP ${response.code}: $body"))
                        return
                    }

                    val source = response.body?.source() ?: run {
                        onError(IOException("Empty response body"))
                        return
                    }

                    val fullText = StringBuilder()

                    try {
                        while (!source.exhausted()) {
                            val line = source.readUtf8Line() ?: break
                            if (line.isEmpty() || !line.startsWith("data:")) continue

                            val data = line.removePrefix("data:").trim()
                            if (data == SSE_DONE) break

                            try {
                                val chunk = gson.fromJson(data, ChatCompletionChunk::class.java)
                                val delta = chunk.choices
                                    ?.firstOrNull()
                                    ?.delta
                                    ?.content
                                    ?: ""
                                if (delta.isNotEmpty()) {
                                    fullText.append(delta)
                                    onDelta(delta)
                                }
                            } catch (e: Exception) {
                                Log.w(TAG, "Skip unparseable chunk: $data", e)
                            }
                        }
                    } catch (e: IOException) {
                        Log.e(TAG, "Stream read error", e)
                        if (fullText.isEmpty()) {
                            onError(e)
                            return
                        }
                        Log.w(TAG, "Stream interrupted; returning partial text")
                    }

                    val result = fullText.toString().trim()
                    Log.d(TAG, "Stream done, ${result.length} chars")
                    onDone(result)
                } finally {
                    response.close()
                }
            }
        })
    }

    // ---- JSON models ----

    private data class ChatMessage(val role: String, val content: String)

    private data class ChatCompletionRequest(
        val model: String,
        val messages: List<ChatMessage>,
        val temperature: Double,
        val stream: Boolean,
        val thinking: ThinkingConfig? = null,
    ) {
        data class ThinkingConfig(val type: String)
    }

    private data class ChatCompletionChunk(
        val choices: List<Choice>?,
    ) {
        data class Choice(val delta: Delta?)
        data class Delta(
            val content: String?,
            val reasoning_content: String? = null,
        )
    }
}
