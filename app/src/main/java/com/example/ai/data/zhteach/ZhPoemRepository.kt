package com.example.ai.data.zhteach

import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.net.URLEncoder

/** 古诗里单个字的释义 */
data class PoemChar(
    val c: String = "",
    /** 这个字在本句中的意思（≤12 字） */
    val m: String = "",
    /** 这个字在本句中的读音（字母+声调数字，如 xie2）；为空则不做注音锁读 */
    val p: String = "",
)

/** 古诗一句 */
data class PoemLine(
    val verse: String = "",
    val meaning: String = "",
    val chars: List<PoemChar> = emptyList(),
    /** 该句逐字拼音（空格分隔，与 verse 汉字一一对应）——用于锁定多音字读音 */
    val pinyin: String = "",
)

/** 古诗练习内容 */
data class PoemScript(
    val title: String = "",
    val summary: String = "",
    val lines: List<PoemLine> = emptyList(),
    /** 后端 LLM 讲解不可用时按原诗切句的兜底（无白话/字义） */
    val fallback: Boolean = false,
)

/** 古诗快速概括（开场等待专用） */
data class PoemSummary(
    val title: String = "",
    val summary: String = "",
    /** 全诗逐字拼音，用于锁住"整篇朗读"的多音字读音 */
    val pinyin: String = "",
)

/** 小学必背古诗库的一条命中 */
data class PoemSearchHit(
    val title: String = "",
    val dynasty: String = "",
    val author: String = "",
    val text: String = "",
)

/**
 * AI 对话学语文 —— 古诗练习（对齐 web `services/zhPoem.ts` +
 * `chinese_practice.ts` 的 `/llm/zh-poem-setup` · `/llm/zh-poem-summary` · GET `/llm/zh-poem-search`）。
 *
 * 契约要点：
 * - `setup` 服务端缓存键 `sha256("zhPoem|v2|原文")`（v2 才有逐句/逐字拼音），
 *   自检要求 `lines[].pinyin` 与 verse 汉字**严格一一对应**，多音字必须给对本诗语境读音。
 * - `summary` 出得快（1~3s），页面用它抢在"整篇朗读"前拿到全诗拼音；失败**不阻塞**（web 是 `.catch(() => null)`）。
 * - `search` 是**纯数据**（服务器内置 `data/primary_poems.ts`），不走 LLM，10s 超时。
 */
class ZhPoemRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    /** 生成古诗讲解（概括 + 逐句原文/白话 + 逐字释义） */
    suspend fun setup(poem: String): Result<PoemScript> = withContext(Dispatchers.IO) {
        ZhTeachHttp.guard {
            val body = JSONObject().apply { put("poem", poem) }
            val json = ZhTeachHttp.postJson(client, "$serverBase/api/v1/llm/zh-poem-setup", body)
            PoemScript(
                title = json.optString("title", ""),
                summary = json.optString("summary", ""),
                fallback = json.optBoolean("fallback", false),
                lines = ZhTeachHttp.objectList(json.optJSONArray("lines")) { o ->
                    PoemLine(
                        verse = o.optString("verse", ""),
                        meaning = o.optString("meaning", ""),
                        pinyin = o.optString("pinyin", ""),
                        chars = ZhTeachHttp.objectList(o.optJSONArray("chars")) { pc ->
                            PoemChar(
                                c = pc.optString("c", ""),
                                m = pc.optString("m", ""),
                                p = pc.optString("p", ""),
                            )
                        },
                    )
                },
            )
        }
    }

    /** 快速概括（题目 + 整体概括 + 全诗逐字拼音） */
    suspend fun summary(poem: String): Result<PoemSummary> = withContext(Dispatchers.IO) {
        ZhTeachHttp.guard {
            val body = JSONObject().apply { put("poem", poem) }
            val json = ZhTeachHttp.postJson(client, "$serverBase/api/v1/llm/zh-poem-summary", body)
            PoemSummary(
                title = json.optString("title", ""),
                summary = json.optString("summary", ""),
                pinyin = json.optString("pinyin", ""),
            )
        }
    }

    /** 搜小学古诗库（标题或作者）。**空 q 不发请求**（与 web 页面一致，直接返回空表） */
    suspend fun search(q: String): Result<List<PoemSearchHit>> = withContext(Dispatchers.IO) {
        val query = q.trim()
        if (query.isEmpty()) return@withContext Result.success(emptyList())
        ZhTeachHttp.guard {
            val url = "$serverBase/api/v1/llm/zh-poem-search?q=${URLEncoder.encode(query, "UTF-8")}"
            val json = ZhTeachHttp.getJson(client, url)
            ZhTeachHttp.objectList(json.optJSONArray("poems")) { o ->
                PoemSearchHit(
                    title = o.optString("title", ""),
                    dynasty = o.optString("dynasty", ""),
                    author = o.optString("author", ""),
                    text = o.optString("text", ""),
                )
            }
        }
    }
}
