package com.example.ai.data.zhteach

import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import com.example.ai.data.llm.LlmHttp

/** 一道教学题：提问 + 参考回答 + 本题考查的词/句 + 3 级提示（意思 → 例句 → 句型骨架） */
data class TeachItem(
    val q: String = "",
    val ref: String = "",
    val focus: String = "",
    val hints: List<String> = emptyList(),
)

/** 教学剧本 */
data class TeachScript(
    val title: String = "",
    val items: List<TeachItem> = emptyList(),
)

/** 文本作答判定结果 */
data class TeachJudgeResult(
    val ok: Boolean = false,
    val praise: String = "",
    /** 不对时是参考回答原文；对时为空 */
    val correct: String = "",
)

/**
 * AI 对话学语文 —— 教学剧本 + 作答判定（对齐 web `services/zhTeach.ts` +
 * `server_cf/src/routes/chinese_practice.ts` 的 `/llm/zh-teach-setup` · `/llm/zh-teach-judge`）。
 *
 * 契约要点：
 * - `setup` 服务端有**同参缓存**（`sha256("zhTeach|主题|词语|句子")`），命中直接回；未命中才调 LLM，
 *   且带 `generateWithGuard` 最多 4 次重试自检（要求每道题的 ref 覆盖全部考查词/句）。
 *   失败返回 **422 + detail**（"教学剧本生成未通过审核：…"）。
 * - `judge` 判定宽松（意思相近即算对）；失败是 **500 + detail**。
 * - 超时：web 分别给 90s / 60s。共享 OkHttp client 的 readTimeout 已是 180s ⇒ 无需派生 client。
 */
class ZhTeachRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    /** 生成教学剧本；失败时 `exception.message` 是可直接展示给用户的中文 detail */
    suspend fun setup(topic: String, words: List<String>, sentences: List<String>): Result<TeachScript> =
        withContext(Dispatchers.IO) {
            LlmHttp.guard {
                val body = JSONObject().apply {
                    put("topic", topic)
                    put("words", JSONArray(words))
                    put("sentences", JSONArray(sentences))
                }
                val json = LlmHttp.postJson(client, "$serverBase/api/v1/llm/zh-teach-setup", body)
                TeachScript(
                    title = json.optString("title", ""),
                    items = LlmHttp.objectList(json.optJSONArray("items")) { o ->
                        TeachItem(
                            q = o.optString("q", ""),
                            ref = o.optString("ref", ""),
                            focus = o.optString("focus", ""),
                            hints = LlmHttp.stringList(o.optJSONArray("hints")),
                        )
                    },
                )
            }
        }

    /** 判定孩子的文本回答 */
    suspend fun judge(q: String, ref: String, answer: String): Result<TeachJudgeResult> =
        withContext(Dispatchers.IO) {
            LlmHttp.guard {
                val body = JSONObject().apply {
                    put("q", q)
                    put("ref", ref)
                    put("answer", answer)
                }
                val json = LlmHttp.postJson(client, "$serverBase/api/v1/llm/zh-teach-judge", body)
                TeachJudgeResult(
                    // 服务端可能返回布尔或字符串 "true"，两种都认（与 web `j.ok === true || j.ok === "true"` 一致）
                    ok = json.optBoolean("ok", false) || json.optString("ok", "") == "true",
                    praise = json.optString("praise", ""),
                    correct = json.optString("correct", ""),
                )
            }
        }
}
