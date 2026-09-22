package com.example.ai.data.zhteach

import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import com.example.ai.data.llm.LlmHttp

/**
 * AI 对话学语文 —— 文章背诵框架（缩写）生成（对齐 web `services/zhRecite.ts` +
 * `chinese_practice.ts` 的 `/llm/article-recite`）。
 *
 * 契约要点：句子由**前端本地切好**后传入（见 [ArticleSplit.splitSentences]），
 * 本接口只回 `{items:[{text,short}]}`；缩写后台生成、回来后再用 [ArticleSplit.mergeShorts] 原地合并。
 * 空数组**不发请求**（web 直接返回 `[]`）。
 */
class ZhReciteRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    /** 为每句生成极简背诵提示；失败返回 failure（调用方应静默降级：无提示也能继续练） */
    suspend fun setup(sentences: List<String>): Result<List<ArticleLine>> = withContext(Dispatchers.IO) {
        if (sentences.isEmpty()) return@withContext Result.success(emptyList())
        LlmHttp.guard {
            val body = JSONObject().apply { put("sentences", JSONArray(sentences)) }
            val json = LlmHttp.postJson(client, "$serverBase/api/v1/llm/article-recite", body)
            LlmHttp.objectList(json.optJSONArray("items")) { o ->
                ArticleLine(
                    text = o.optString("text", ""),
                    short = o.optString("short", ""),
                )
            }
        }
    }
}
