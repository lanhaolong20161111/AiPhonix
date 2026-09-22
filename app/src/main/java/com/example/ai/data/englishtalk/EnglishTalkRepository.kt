package com.example.ai.data.englishtalk

import com.example.ai.data.llm.LlmHttp
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject

/**
 * 一轮对话：
 * - [ai] AI 台词（孩子听/点读的那句）
 * - [target] 孩子该说的回答（跟读模式的跟读对象、自由模式的判定基准）
 * - [hintWords] [target] 的逐词序列（后端给；自由模式逐词提示 + 跟读阶梯都用它）
 * - [chunks] 发音意群（2~4 词一组，用于「错句修复」的意群阶梯；可缺省 ⇒ 前端用 `fallbackChunks` 兜底）
 */
data class DialogueLine(
    val ai: String = "",
    val target: String = "",
    val hintWords: List<String> = emptyList(),
    val chunks: List<String> = emptyList(),
)

/** 对话剧情（3~5 轮） */
data class DialogueScript(
    val title: String = "",
    val lines: List<DialogueLine> = emptyList(),
)

/** 整句作答判定结果 */
data class AnswerJudgeResult(
    val ok: Boolean = false,
    /** 通过/不通过都给一句鼓励语（英文页面走英文鼓励） */
    val praise: String = "",
    /** 不通过时是期望句原文；通过时为空 */
    val correct: String = "",
)

/**
 * AI 英语对话陪练 —— 剧情生成 + 整句判定
 * （对齐 web `services/englishTalk.ts` + `server_cf/src/routes/chinese_practice.ts`
 * 的 `/llm/en-dialogue-setup` · `/llm/en-answer-judge`）。
 *
 * 契约要点（**以服务端为准**）：
 * - `setup` 请求体是 `{topic, words, sentences}`；**不传 `lang`** ⇒ 服务端默认 `en`
 *   （同一个端点被「造句小助手」等复用，传 `lang:"zh"` 才走中文分支）。
 *   三者至少给一个，否则 **400 + detail**（"请至少提供一个词、句子或主题"）。
 * - `setup` 服务端有**同参缓存**（`sha256("en|主题|词|句")`，落在 `en_dialogue.json`），
 *   未命中才调 LLM，且带 `generateWithGuard` 最多 **3** 次重试自检
 *   （校验：chunks 拼接 == target、英文台词/目标句不得混中文、整段至少用到任一练习词、
 *   练习句全程至多出现一次、最后再让 LLM 评审整体质量）。
 *   全部失败 ⇒ **422 + detail**（"剧情生成未通过审核：…"）。
 * - `judge` 请求体是 `{target, said}`；失败是 **500 + detail**。判定对孩子宽松
 *   （漏掉 the/a/is 之类功能词、换个更简单的说法都算对）。
 * - 超时：web 分别给 90s / 60s。共享 OkHttp client 的 readTimeout 已是 180s ⇒ 无需派生 client。
 */
class EnglishTalkRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    /** 生成对话剧情；失败时 `exception.message` 是可直接展示给用户的中文 detail */
    suspend fun setup(
        topic: String,
        words: List<String>,
        sentences: List<String>,
    ): Result<DialogueScript> = withContext(Dispatchers.IO) {
        LlmHttp.guard {
            val body = JSONObject().apply {
                put("topic", topic)
                put("words", JSONArray(words))
                put("sentences", JSONArray(sentences))
            }
            val json = LlmHttp.postJson(client, "$serverBase/api/v1/llm/en-dialogue-setup", body)
            DialogueScript(
                title = json.optString("title", ""),
                lines = LlmHttp.objectList(json.optJSONArray("lines")) { o ->
                    DialogueLine(
                        ai = o.optString("ai", ""),
                        target = o.optString("target", ""),
                        hintWords = LlmHttp.stringList(o.optJSONArray("hint_words")),
                        // 服务端只在 chunks 非空时才写这个字段 ⇒ 缺省是空表，不是 null
                        chunks = LlmHttp.stringList(o.optJSONArray("chunks")),
                    )
                },
            )
        }
    }

    /** 判定孩子说的整句是否符合目标句语境 */
    suspend fun judge(target: String, said: String): Result<AnswerJudgeResult> =
        withContext(Dispatchers.IO) {
            LlmHttp.guard {
                val body = JSONObject().apply {
                    put("target", target)
                    put("said", said)
                }
                val json = LlmHttp.postJson(client, "$serverBase/api/v1/llm/en-answer-judge", body)
                AnswerJudgeResult(
                    // 服务端可能返回布尔或字符串 "true"，两种都认（与 web `j.ok === true || j.ok === "true"` 一致）
                    ok = json.optBoolean("ok", false) || json.optString("ok", "") == "true",
                    praise = json.optString("praise", ""),
                    correct = json.optString("correct", ""),
                )
            }
        }
}
