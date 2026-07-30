package com.k2fsa.sherpa.onnx.agent

/**
 * Abstraction over an LLM provider that supports streaming chat completions.
 *
 * @param Message  Role + content pair sent to the model.
 * @param Chunk    Unit of a streaming response (usually a delta string).
 */
interface LlmProvider {

    data class Message(val role: String, val content: String)

    /**
     * Stream a chat-completion response.
     *
     * @param systemPrompt  System-level instruction (optional).
     * @param messages      Chat history (user / assistant turns).
     * @param temperature   Sampling temperature, typically 0.3 for structured hints.
     * @param onDelta       Called for each text delta as it arrives (on caller's thread).
     * @param onDone        Called when the stream completes successfully with the full text.
     * @param onError       Called on any transport / API error.
     */
    fun streamChat(
        systemPrompt: String? = null,
        messages: List<Message>,
        temperature: Double = 0.3,
        onDelta: (String) -> Unit,
        onDone: (String) -> Unit,
        onError: (Throwable) -> Unit,
    )

    companion object {
        const val ROLE_SYSTEM = "system"
        const val ROLE_USER = "user"
        const val ROLE_ASSISTANT = "assistant"
    }
}
