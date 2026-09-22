package com.example.ai.data.aichinese

import android.util.Log
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** 题目中的一个句子及其关键信息标注 */
data class SentenceInfo(
    val text: String,
    val isKey: Boolean = false,
    val highlight: String = "",
)

/** 数量实体（线段图的一条线段）：谁 + 数值 + 单位 */
data class QuantityItem(
    val name: String,
    val value: Float?,       // 已知数值；未知（题目所求）为 null
    val unit: String = "",
)

/** 数量关系（线段图标注）：a 相对 b 的关系 */
data class QuantityRelation(
    val a: String,           // 主体（如 小红；total 时表示"一共"，可为空）
    val b: String,           // 基准（如 小明；total 时不使用）
    val type: String,        // more=多 / less=少 / times=是…倍 / total=求和（一共）
    val amount: Float = 0f,
    val parts: List<String> = emptyList(),  // total 时的分量名列表
)

/** 题目中的一个问题（面向问题倒推）：原文 + 目标量 + 依赖量 + 求解方向 */
data class QuestionItem(
    val text: String,            // 问题原文（如「足球有几个？」）
    val target: String = "",     // 要求解的量（实体名，尽量对应 quantities 的 name）
    val needs: List<String> = emptyList(),  // 回答此问需要先知道的量（可能依赖前一问的结果）
    val hint: String = "",       // 求解方向简述（不给答案，不剧透）
)

/** analyze 结果 */
data class AnalyzeResult(
    val topic: String,
    val sentences: List<SentenceInfo>,
    val totalKeyPoints: Int,
    val quantities: List<QuantityItem> = emptyList(),   // 线段图实体（LLM 提取，可能为空）
    val relations: List<QuantityRelation> = emptyList(), // 线段图关系标注（可能为空）
    val questions: List<QuestionItem> = emptyList(),      // 题目里的所有问题（面向问题倒推；可能为空）
)

// ── 思路评判结果 ──
data class EvaluateResult(
    val verdict: String,   // correct | partial | wrong
    val feedback: String,
    val suggestion: String,
)

/** 语文好词好句标注 */
data class ChineseHighlightItem(
    val text: String = "",
    val reason: String = "",
)

data class ChineseHighlightResult(
    val words: List<ChineseHighlightItem> = emptyList(),
    val sentences: List<ChineseHighlightItem> = emptyList(),
)

/** 文本问答结果（基于传入文本直接回答） */
data class TextAskResult(
    val answer: String = "",
    val keywords: List<String> = emptyList(),
    val sourceTitle: String = "",
)

/** 一个拼音音节部件（声母/介母/韵母/整体认读音节） */
data class PinyinPart(
    val text: String = "",
    val label: String = "",  // shengmu / jiemu / yunmu / zhengtiren
    val audio: String = "",  // 音频文件路径（如 声母/sh.mp3）
)

/** 背诵索引条目 */
data class PinyinWord(
    val hanzi: String = "",
    val pinyin: String = "",
    val parts: List<PinyinPart> = emptyList(),
)

/** 一关拼音练习：词语（汉字+拼音） */
data class PinyinLevel(
    val unit: String = "",
    val words: List<PinyinWord> = emptyList(),
)

/** 已识别课文/题目（进入语文页的大纲条目） */
data class MyImportItem(
    val id: Int = 0,
    val text: String = "",
    val topic: String = "",
    val payload: String = "",      // 解析结果 JSON（还原 analyzeResult）
    val createdAt: String = "",
)

/** 大纲具体条目（单元→课文→条目） */
data class OutlineItem(
    val id: Int = 0,
    val source: String = "",       // textbook / unit_knowledge
    val type: String = "",
    val title: String = "",
    val snippet: String = "",
)

/** 大纲：单元 → 课文 → 条目 */
data class OutlineLesson(
    val lesson: String = "",
    val items: List<OutlineItem> = emptyList(),
)

data class OutlineUnit(
    val unit: String = "",
    val lessons: List<OutlineLesson> = emptyList(),
)

/** 大纲条目详情（完整内容 + 原图路径） */
data class OutlineItemDetail(
    val source: String = "",
    val id: Int = 0,
    val unit: String = "",
    val lesson: String = "",
    val type: String = "",
    val page: String = "",
    val content: String = "",
    val imageBytes: ByteArray? = null,
)

// ── 分步解题的一步（倒推挑战的幕后数据）：目的 + 算式 + 中间结果 + 逻辑讲解 + 线段绘制指令 + 依据条件 */
data class SolutionStep(
    val purpose: String,       // 这一步想算什么（为什么算它）
    val formula: String = "",  // 算式文字（如「(340-240)÷(10-9)」）
    val result: String = "",   // 中间结果（数字字符串，或结论文字如「不能」）
    val resultUnit: String = "",
    val explain: String = "",  // 为什么这样算（数量关系逻辑，不说教）
    val draw: SolutionStepDraw? = null,  // 这一步要画的线段（LLM 指示）；结论步为 null
    val source: String = "",   // 这一步依据的关键条件（题目原句/摘要；结论步可为空）
)

/** LLM 给出的线段绘制指令：label/value/unit/color/note */
data class SolutionStepDraw(
    val label: String = "",   // 线段名（如 汽车速度）
    val value: String = "",   // 数值字符串
    val unit: String = "",
    val color: String = "",   // blue/red/green/black
    val note: String = "",    // 一句话说明画这条线表示什么
)

/** 排版块内的一行：图片上同一水平线的文字 + 缩进级别 */
data class TextBlockLine(
    val text: String = "",
    val indent: Int = 0,  // 0=顶格 1≈两汉字 2≈四汉字
)

/** 识别出的一个排版块（标题/正文/题号/选项 + 对齐），用于按图片排版展示 */
data class TextBlock(
    val type: String = "body",  // title / heading / body / question / option / note
    val text: String = "",
    val align: String = "left", // left / center / right
    val lines: List<TextBlockLine> = emptyList(), // 视觉行（逐字点读按行渲染）
    val polyphones: Map<String, String> = emptyMap(), // 多音字 → 正确拼音（带声调），用于 TTS
)

/** 识题结果：完整文本 + 拆分后的题目列表（多题逐题）+ 排版块（LLM 记录，可能为空） */
data class ParseImageResult(
    val text: String,
    val questions: List<String>,
    val blocks: List<TextBlock> = emptyList(),
    val pageBounds: FloatArray? = null, // [left, top, right, bottom] 0~1000 相对坐标；null=无（页面占满）
)

// ── 认读画像：字被点击发音次数 ──

/** 单个字 + 点击次数 */
data class CharClickStatItem(
    val char: String = "",
    val count: Int = 0,
)

/** 认读画像统计：点击越多 → 越不会认读（items 按次数降序） */
data class CharClickStats(
    val totalChars: Int = 0,
    val totalClicks: Int = 0,
    val items: List<CharClickStatItem> = emptyList(),
)

// ── 闯关：大模型现场生成分步引导 ──

/** 闯关的一步（客户端可见：问题 + 选项，不含答案） */
data class QuestStepData(
    val index: Int = 0,
    val type: String = "",
    val question: String = "",
    val options: List<String> = emptyList(),
)

/** 闯关开始结果 */
data class QuestStartResult(
    val sessionId: Int = 0,
    val totalSteps: Int = 0,
    val steps: List<QuestStepData> = emptyList(),
)

/** 闯关历史条目（含对错与回溯用 checkpoint_id） */
data class QuestHistoryItem(
    val checkpointId: String = "",
    val stepIndex: Int = 0,
    val totalSteps: Int = 0,
    val lastAnswer: String = "",
    val lastCorrect: Boolean = false,
    val subUsed: Boolean = false,
    val answerCount: Int = 0,
)

/** 可续闯的会话摘要 */
data class QuestSessionSummary(
    val sessionId: Int = 0,
    val question: String = "",
    val currentStep: Int = 0,
    val totalSteps: Int = 0,
    val createdAt: String = "",
)

/** 掌握报告 */
data class QuestReportItem(
    val index: Int = 0,
    val type: String = "",
    val question: String = "",
    val attempts: Int = 0,
    val wrong: Int = 0,
    val subUsed: Int = 0,
    val passed: Boolean = false,
)

data class QuestReport(
    val totalSteps: Int = 0,
    val attempts: Int = 0,
    val passedSteps: Int = 0,
    val done: Boolean = false,
    val summary: String = "",
    val wrongSteps: List<QuestReportItem> = emptyList(),
)

/** 闯关作答结果 */
data class QuestAnswerResult(
    val correct: Boolean = false,
    val done: Boolean = false,
    val feedback: String = "",
    val conceptExplain: String = "",
    val subQuestion: QuestStepData? = null, // 答错降解出的简化子问题
    val subBackToOriginal: Boolean = false, // 子问题答对 → 回到原题
    val currentStep: Int = 0,
    val totalSteps: Int = 0,
    val nextStep: QuestStepData? = null,
)

/**
 * AI 作业（数学应用题）仓库：识题 / 关键信息 / 思路评判 / 存导入。
 * 对应服务端 ai-homework 三接口与 user-imports/batch（kind=problem）。
 */
class AiChineseRepository(
    private val serverBase: String = ServiceModule.serverBase,
    private val client: OkHttpClient = NetworkModule.httpClient,
) {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    // 内存缓存：同一张图片 / 同一道题不重复请求（服务端也有磁盘缓存兜底）
    private val parseImageCache = LinkedHashMap<String, ParseImageResult>()
    private val analyzeCache = LinkedHashMap<String, AnalyzeResult>()

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun Request.Builder.auth(): Request.Builder = apply {
        val token = TokenManager.accessToken
        if (token.isNotBlank()) header("Authorization", "Bearer $token")
    }

    /** 拍照识题：图片字节 → 题目列表（服务端 Ark 多模态优先，自动回退 OCR；多题逐题返回）
     *  同一张图片（字节一致）内存缓存直接返回，不再走网络。
     *  @param forceRefresh true = 跳过内存缓存和服务端缓存，强制重新识别（结果覆盖缓存）。
     *  @param mode 识别学科模式（如 "english"：服务端跳过多音字/中文去噪，用英语专用提示词）。 */
    suspend fun parseImage(bytes: ByteArray, fileName: String = "photo.jpg", forceRefresh: Boolean = false, mode: String = ""): ParseImageResult = withContext(Dispatchers.IO) {
        val key = sha256(bytes + mode.toByteArray(Charsets.UTF_8))
        if (!forceRefresh) {
            parseImageCache[key]?.let { return@withContext it }
        }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, bytes.toRequestBody("image/jpeg".toMediaType()))
            .build()
        val params = buildList {
            if (forceRefresh) add("no_cache=true")
            if (mode.isNotBlank()) add("mode=$mode")
        }
        val query = if (params.isEmpty()) "" else "?" + params.joinToString("&")
        val url = "$serverBase/api/v1/ai-chinese/parse-image$query"
        val request = Request.Builder()
            .url(url)
            .post(body)
            .auth()
            .build()
        val json = executeJson(request)
            ?: throw java.io.IOException("无法连接服务器或响应超时（识别较慢请耐心等待），请检查网络后重试: $serverBase")
        val text = json.optString("text", "")
        val arr = json.optJSONArray("questions")
        val questions = if (arr != null && arr.length() > 0) {
            (0 until arr.length()).map { arr.optString(it, "") }.filter { it.isNotBlank() }
        } else if (text.isNotBlank()) {
            listOf(text)
        } else {
            emptyList()
        }
                val blocks = buildList {
                    val bArr = json.optJSONArray("blocks") ?: JSONArray()
                    for (i in 0 until bArr.length()) {
                        val o = bArr.optJSONObject(i) ?: continue
                        val t = o.optString("text", "").trim()
                        if (t.isEmpty()) continue
                        val lines = buildList {
                            val lArr = o.optJSONArray("lines") ?: JSONArray()
                            for (j in 0 until lArr.length()) {
                                val lo = lArr.optJSONObject(j) ?: continue
                                val lt = lo.optString("text", "").trim()
                                if (lt.isEmpty()) continue
                                add(TextBlockLine(
                                    text = lt,
                                    indent = lo.optInt("indent", 0),
                                ))
                            }
                        }
                        val polyphones = buildMap {
                            val pObj = o.optJSONObject("polyphones") ?: JSONObject()
                            val it = pObj.keys()
                            while (it.hasNext()) {
                                val k = it.next()
                                val v = pObj.optString(k, "").trim()
                                if (k.length == 1 && v.isNotEmpty()) put(k, v)
                            }
                        }
                        add(TextBlock(
                            type = o.optString("type", "body"),
                            text = t,
                            align = o.optString("align", "left"),
                            lines = lines,
                            polyphones = polyphones,
                        ))
                    }
                }
        val pageBounds = json.optJSONObject("page_bounds")?.let { pb ->
            val l = pb.optDouble("left", 0.0)
            val t = pb.optDouble("top", 0.0)
            val r = pb.optDouble("right", 1000.0)
            val b = pb.optDouble("bottom", 1000.0)
            if (l < 0 || t < 0 || r > 1000 || b > 1000 || r <= l || b <= t) null
            else floatArrayOf(l.toFloat(), t.toFloat(), r.toFloat(), b.toFloat())
        }
        ParseImageResult(text = text, questions = questions, blocks = blocks, pageBounds = pageBounds).also {
            parseImageCache[key] = it
            if (parseImageCache.size > 30) parseImageCache.remove(parseImageCache.keys.first())
        }
    }

    /** 题目 → 句子切分 + 关键信息标注 + 数量关系（线段图）
     *  同一道题（文本一致）内存缓存直接返回，不再走网络。
     *  @param forceRefresh true = 跳过内存缓存与服务端缓存，强制 LLM 重跑（人工模板提交后验证效果） */
    suspend fun analyze(question: String, forceRefresh: Boolean = false): AnalyzeResult = withContext(Dispatchers.IO) {
        val key = sha256(question.toByteArray(Charsets.UTF_8))
        if (!forceRefresh) {
            analyzeCache[key]?.let { return@withContext it }
        }
        val body = JSONObject().apply {
            put("question", question)
            put("force_refresh", forceRefresh)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/analyze")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext AnalyzeResult("", emptyList(), 0)
        val arr = json.optJSONArray("sentences") ?: JSONArray()
        val sentences = (0 until arr.length()).map { i ->
            val o = arr.optJSONObject(i) ?: JSONObject()
            SentenceInfo(
                text = o.optString("text", ""),
                isKey = o.optBoolean("is_key", false),
                highlight = o.optString("highlight", ""),
            )
        }
        // 数量实体（线段图）：value 为 null（JSON null）表示未知量
        val quantities = buildList {
            val qarr = json.optJSONArray("quantities") ?: JSONArray()
            for (i in 0 until qarr.length()) {
                val o = qarr.optJSONObject(i) ?: continue
                val name = o.optString("name", "").trim()
                if (name.isEmpty()) continue
                val value = if (o.isNull("value")) null else o.optDouble("value", Double.NaN)
                if (value != null && value.isNaN()) continue
                add(QuantityItem(name = name, value = value?.toFloat(), unit = o.optString("unit", "")))
            }
        }
        // 数量关系
        val relations = buildList {
            val rarr = json.optJSONArray("relations") ?: JSONArray()
            for (i in 0 until rarr.length()) {
                val o = rarr.optJSONObject(i) ?: continue
                val a = o.optString("a", "").trim()
                val b = o.optString("b", "").trim()
                val type = o.optString("type", "")
                if (type !in setOf("more", "less", "times", "total")) continue
                if (type == "total") {
                    val parts = buildList {
                        val parr = o.optJSONArray("parts") ?: JSONArray()
                        for (j in 0 until parr.length()) {
                            val p = parr.optString(j, "").trim()
                            if (p.isNotEmpty()) add(p)
                        }
                    }
                    if (parts.isEmpty()) continue
                    add(QuantityRelation(a = a, b = b, type = type, amount = 0f, parts = parts))
                    continue
                }
                if (a.isEmpty() || b.isEmpty()) continue
                val amount = o.optDouble("amount", 0.0)
                add(QuantityRelation(a = a, b = b, type = type, amount = amount.toFloat()))
            }
        }
        // 题目里的所有问题（面向问题倒推）：text/target/needs/hint
        val questions = buildList {
            val qarr = json.optJSONArray("questions") ?: JSONArray()
            for (i in 0 until qarr.length()) {
                val o = qarr.optJSONObject(i) ?: continue
                val text = o.optString("text", "").trim()
                if (text.isEmpty()) continue
                val needs = buildList {
                    val narr = o.optJSONArray("needs") ?: JSONArray()
                    for (j in 0 until narr.length()) {
                        val n = narr.optString(j, "").trim()
                        if (n.isNotEmpty()) add(n)
                    }
                }
                add(QuestionItem(
                    text = text,
                    target = o.optString("target", "").trim(),
                    needs = needs,
                    hint = o.optString("hint", "").trim(),
                ))
            }
        }
        AnalyzeResult(
            topic = json.optString("topic", ""),
            sentences = sentences,
            totalKeyPoints = json.optInt("total_key_points", 0),
            quantities = quantities,
            relations = relations,
            questions = questions,
        ).also {
            analyzeCache[key] = it
            if (analyzeCache.size > 30) analyzeCache.remove(analyzeCache.keys.first())
        }
    }

    /** 闯关开始：LLM 现场生成分步计划；返回的步骤不含答案 */
    suspend fun startQuest(question: String): QuestStartResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("question", question).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/quest/start")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext QuestStartResult()
        val arr = json.optJSONArray("steps") ?: JSONArray()
        QuestStartResult(
            sessionId = json.optInt("session_id", 0),
            totalSteps = json.optInt("total_steps", 0),
            steps = buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val opts = buildList {
                        val oarr = o.optJSONArray("options") ?: JSONArray()
                        for (j in 0 until oarr.length()) add(oarr.optString(j, ""))
                    }
                    add(QuestStepData(
                        index = o.optInt("index", 0),
                        type = o.optString("type", ""),
                        question = o.optString("question", ""),
                        options = opts,
                    ))
                }
            },
        )
    }

    /** 闯关作答：返回对错 + 引导（答错 LLM 现场生成）/ 概念解释 / 下一步 */
    suspend fun answerQuest(sessionId: Int, answerIndex: Int): QuestAnswerResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("session_id", sessionId)
            put("answer_index", answerIndex)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/quest/step")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext QuestAnswerResult()
        val next = json.optJSONObject("next_step")
        val sub = json.optJSONObject("sub_question")
        QuestAnswerResult(
            correct = json.optBoolean("correct", false),
            done = json.optBoolean("done", false),
            feedback = json.optString("feedback", ""),
            conceptExplain = json.optString("concept_explain", ""),
            subQuestion = sub?.let { o ->
                val opts = buildList {
                    val oarr = o.optJSONArray("options") ?: JSONArray()
                    for (j in 0 until oarr.length()) add(oarr.optString(j, ""))
                }
                QuestStepData(
                    index = o.optInt("index", 0),
                    type = o.optString("type", ""),
                    question = o.optString("question", ""),
                    options = opts,
                )
            },
            subBackToOriginal = json.optBoolean("sub_back_to_original", false),
            currentStep = json.optInt("current_step", 0),
            totalSteps = json.optInt("total_steps", 0),
            nextStep = next?.let { o ->
                val opts = buildList {
                    val oarr = o.optJSONArray("options") ?: JSONArray()
                    for (j in 0 until oarr.length()) add(oarr.optString(j, ""))
                }
                QuestStepData(
                    index = o.optInt("index", 0),
                    type = o.optString("type", ""),
                    question = o.optString("question", ""),
                    options = opts,
                )
            },
        )
    }

    /** 闯关会话历史（含对错 + 回溯用 checkpoint_id） */
    suspend fun fetchQuestHistory(sessionId: Int): List<QuestHistoryItem> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/quest/history/$sessionId")
            .get()
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyList()
        val arr = json.optJSONArray("items") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(QuestHistoryItem(
                    checkpointId = o.optString("checkpoint_id", ""),
                    stepIndex = o.optInt("step_index", 0),
                    totalSteps = o.optInt("total_steps", 0),
                    lastAnswer = o.optString("last_answer", ""),
                    lastCorrect = o.optBoolean("last_correct", false),
                    subUsed = o.optBoolean("sub_used", false),
                    answerCount = o.optInt("answer_count", 0),
                ))
            }
        }
    }

    /** 回溯到指定 checkpoint（选错时刻）重做；返回该步问题 */
    suspend fun replayQuest(sessionId: Int, checkpointId: String): QuestAnswerResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("session_id", sessionId)
            put("checkpoint_id", checkpointId)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/quest/replay")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext QuestAnswerResult()
        val next = json.optJSONObject("next_step")
        QuestAnswerResult(
            correct = json.optBoolean("correct", false),
            done = json.optBoolean("done", false),
            feedback = json.optString("feedback", ""),
            currentStep = json.optInt("current_step", 0),
            totalSteps = json.optInt("total_steps", 0),
            nextStep = next?.let { o ->
                val opts = buildList {
                    val oarr = o.optJSONArray("options") ?: JSONArray()
                    for (j in 0 until oarr.length()) add(oarr.optString(j, ""))
                }
                QuestStepData(
                    index = o.optInt("index", 0),
                    type = o.optString("type", ""),
                    question = o.optString("question", ""),
                    options = opts,
                )
            },
        )
    }

    /** 最近未完成的闯关会话（继续上次闯关） */
    suspend fun fetchResumableSessions(): List<QuestSessionSummary> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/quest/sessions")
            .get()
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyList()
        val arr = json.optJSONArray("items") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(QuestSessionSummary(
                    sessionId = o.optInt("session_id", 0),
                    question = o.optString("question", ""),
                    currentStep = o.optInt("current_step", 0),
                    totalSteps = o.optInt("total_steps", 0),
                    createdAt = o.optString("created_at", ""),
                ))
            }
        }
    }

    /** 续闯：恢复到该会话当前步 */
    suspend fun continueQuest(sessionId: Int): QuestAnswerResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("session_id", sessionId).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/quest/continue")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext QuestAnswerResult()
        val next = json.optJSONObject("next_step")
        QuestAnswerResult(
            done = json.optBoolean("done", false),
            feedback = json.optString("feedback", ""),
            currentStep = json.optInt("current_step", 0),
            totalSteps = json.optInt("total_steps", 0),
            nextStep = next?.let { o ->
                val opts = buildList {
                    val oarr = o.optJSONArray("options") ?: JSONArray()
                    for (j in 0 until oarr.length()) add(oarr.optString(j, ""))
                }
                QuestStepData(index = o.optInt("index", 0), type = o.optString("type", ""), question = o.optString("question", ""), options = opts)
            },
        )
    }

    /** 错题回练：生成只含答错步骤的新会话 */
    suspend fun retryErrorsQuest(sessionId: Int): QuestStartResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("session_id", sessionId).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/quest/retry-errors")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext QuestStartResult()
        val arr = json.optJSONArray("steps") ?: JSONArray()
        QuestStartResult(
            sessionId = json.optInt("session_id", 0),
            totalSteps = json.optInt("total_steps", 0),
            steps = buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val opts = buildList {
                        val oarr = o.optJSONArray("options") ?: JSONArray()
                        for (j in 0 until oarr.length()) add(oarr.optString(j, ""))
                    }
                    add(QuestStepData(index = o.optInt("index", 0), type = o.optString("type", ""), question = o.optString("question", ""), options = opts))
                }
            },
        )
    }

    /** 掌握报告 */
    suspend fun fetchQuestReport(sessionId: Int): QuestReport = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/quest/report/$sessionId")
            .get()
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext QuestReport()
        val wrong = buildList {
            val arr = json.optJSONArray("wrong_steps") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(QuestReportItem(
                    index = o.optInt("index", 0),
                    type = o.optString("type", ""),
                    question = o.optString("question", ""),
                    attempts = o.optInt("attempts", 0),
                    wrong = o.optInt("wrong", 0),
                    subUsed = o.optInt("sub_used", 0),
                    passed = o.optBoolean("passed", false),
                ))
            }
        }
        QuestReport(
            totalSteps = json.optInt("total_steps", 0),
            attempts = json.optInt("attempts", 0),
            passedSteps = json.optInt("passed_steps", 0),
            done = json.optBoolean("done", false),
            summary = json.optString("summary", ""),
            wrongSteps = wrong,
        )
    }

    /** 上报点击发音的字（批量）：服务端按 (用户, 字) 累加，用于刻画认读画像。
     *  失败静默忽略（不影响朗读体验）。 */
    suspend fun recordCharClicks(chars: List<String>): Boolean = withContext(Dispatchers.IO) {
        if (chars.isEmpty()) return@withContext true
        try {
            val arr = JSONArray()
            chars.take(50).forEach { arr.put(it) }
            val body = JSONObject().put("chars", arr).toString().toRequestBody(JSON)
            val request = Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/char-click")
                .post(body)
                .auth()
                .build()
            val json = executeJson(request) ?: return@withContext false
            "ok" == json.optString("status", "")
        } catch (e: Exception) {
            Log.w(TAG, "char-click 上报失败: ${e.message}")
            false
        }
    }

    /** 认读画像：该学生点击发音次数降序（排前面的字越不会认读） */
    suspend fun fetchCharClickStats(): CharClickStats = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/char-click/stats")
            .get()
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext CharClickStats()
        val arr = json.optJSONArray("items") ?: JSONArray()
        CharClickStats(
            totalChars = json.optInt("total_chars", 0),
            totalClicks = json.optInt("total_clicks", 0),
            items = buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    add(CharClickStatItem(
                        char = o.optString("char", ""),
                        count = o.optInt("count", 0),
                    ))
                }
            },
        )
    }

    /** 思路评判（verdict: correct/partial/wrong） */
    suspend fun evaluate(question: String, answer: String): EvaluateResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("question", question)
            put("answer", answer)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/evaluate")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext EvaluateResult("partial", "网络开小差了，请稍后重试", "")
        EvaluateResult(
            verdict = json.optString("verdict", "partial"),
            feedback = json.optString("feedback", ""),
            suggestion = json.optString("suggestion", ""),
        )
    }

    /** 问题列表（轻量异步补充）：analyze 只做核心分析，questions 单独调用（3-5s），失败返回空 */
    suspend fun fetchQuestions(question: String): List<QuestionItem> = withContext(Dispatchers.IO) {
        val body = JSONObject().put("question", question).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/questions")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyList()
        val arr = json.optJSONArray("questions") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val text = o.optString("text", "").trim()
                if (text.isEmpty()) continue
                val needs = buildList {
                    val narr = o.optJSONArray("needs") ?: JSONArray()
                    for (j in 0 until narr.length()) {
                        val n = narr.optString(j, "").trim()
                        if (n.isNotEmpty()) add(n)
                    }
                }
                add(QuestionItem(
                    text = text,
                    target = o.optString("target", "").trim(),
                    needs = needs,
                    hint = o.optString("hint", "").trim(),
                ))
            }
        }
    }

    /** 分步解题链（倒推挑战幕后数据）：按需调用，失败返回空列表（客户端回退 hint 模式） */
    suspend fun fetchSteps(question: String, target: String = ""): List<SolutionStep> = withContext(Dispatchers.IO) {        val body = JSONObject().apply {
            put("question", question)
            put("target", target)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/steps")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyList()
        val arr = json.optJSONArray("steps") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val purpose = o.optString("purpose", "").trim()
                if (purpose.isEmpty()) continue
                val drawObj = o.optJSONObject("draw")
                val draw = if (drawObj != null) SolutionStepDraw(
                    label = drawObj.optString("label", "").trim(),
                    value = drawObj.optString("value", "").trim(),
                    unit = drawObj.optString("unit", "").trim(),
                    color = drawObj.optString("color", "").trim(),
                    note = drawObj.optString("note", "").trim(),
                ) else null
                add(SolutionStep(
                    purpose = purpose,
                    formula = o.optString("formula", "").trim(),
                    result = o.optString("result", "").trim(),
                    resultUnit = o.optString("result_unit", "").trim(),
                    explain = o.optString("explain", "").trim(),
                    draw = draw,
                    source = o.optString("source", "").trim().ifEmpty { o.optString("from", "").trim() },
                ))
            }
        }
    }

    /** 保存题目到「我的导入」（kind=problem，payload 存结构化句子 JSON） */
    suspend fun saveProblem(question: String, payloadJson: String): Boolean = withContext(Dispatchers.IO) {        val item = JSONObject().apply {
            put("kind", "problem")
            put("text", question)
            put("pinyin", "")
            put("meaning", "")
            put("tags", JSONArray())
            put("payload", payloadJson)
            put("status", "active")
        }
        val body = JSONObject().put("items", JSONArray().put(item)).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/user-imports/batch")
            .post(body)
            .auth()
            .build()
        executeJson(request)?.optString("status", "") == "ok"
    }

    /** 保存一道题到「我的学习」：原图（可选）+ 识别文字 + 解析内容（multipart）；成功返回 true */
    suspend fun saveProblemWithImage(question: String, payloadJson: String, imageBytes: ByteArray?): Boolean = withContext(Dispatchers.IO) {
        try {
            val mb = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("question", question)
                .addFormDataPart("payload", payloadJson)
            if (imageBytes != null) {
                mb.addFormDataPart("file", "problem.jpg", imageBytes.toRequestBody("image/jpeg".toMediaType()))
            }
            val request = Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/save-problem")
                .post(mb.build())
                .auth()
                .build()
            val json = executeJson(request) ?: return@withContext false
            "ok" == json.optString("status", "")
        } catch (e: Exception) {
            Log.w(TAG, "save-problem 失败: ${e.message}")
            false
        }
    }

    /** 批量标记不会认的生字（幂等 upsert）；成功返回 true */
    suspend fun markUnknownChars(chars: List<String>, lesson: String = ""): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().apply {
                put("chars", JSONArray(chars))
                put("lesson", lesson)
            }.toString().toRequestBody(JSON)
            val request = Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/mark-unknown-chars")
                .post(body)
                .auth()
                .build()
            val json = executeJson(request) ?: return@withContext false
            "ok" == json.optString("status", "")
        } catch (e: Exception) {
            Log.w(TAG, "mark-unknown-chars 失败: ${e.message}")
            false
        }
    }

    /** 该学生标记的所有不会认的生字；失败返回空 */
    suspend fun fetchUnknownChars(): List<String> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/unknown-chars")
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyList()
        val arr = json.optJSONArray("chars") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val c = arr.optString(i, "").trim()
                if (c.isNotEmpty()) add(c)
            }
        }
    }

    /** 进入语文页：当前用户已识别的课文/题目大纲（倒序）；失败返回空 */
    suspend fun fetchMyImports(): List<MyImportItem> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/my-imports")
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyList()
        val arr = json.optJSONArray("items") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(MyImportItem(
                    id = o.optInt("id", 0),
                    text = o.optString("text", ""),
                    topic = o.optString("topic", ""),
                    payload = o.optString("payload", ""),
                    createdAt = o.optString("created_at", ""),
                ))
            }
        }
    }

    /** 已识别记录原图字节（校验归属）；无图或失败返回 null */
    suspend fun fetchMyImportImage(id: Int): ByteArray? = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/problem-image/$id")
                .auth()
                .build()
            client.newCall(request).execute().use { resp ->
                if (resp.isSuccessful) resp.body?.bytes() else {
                    Log.w(TAG, "problem-image 失败: ${resp.code}")
                    null
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "problem-image 异常: ${e.message}")
            null
        }
    }

    /** 语文页进入大纲：单元→课文→条目；失败返回空 */
    suspend fun fetchOutline(): List<OutlineUnit> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/outline")
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyList()
        val units = buildList {
            val uArr = json.optJSONArray("units") ?: JSONArray()
            for (i in 0 until uArr.length()) {
                val uo = uArr.optJSONObject(i) ?: continue
                val lessons = buildList {
                    val lArr = uo.optJSONArray("lessons") ?: JSONArray()
                    for (j in 0 until lArr.length()) {
                        val lo = lArr.optJSONObject(j) ?: continue
                        val items = buildList {
                            val iArr = lo.optJSONArray("items") ?: JSONArray()
                            for (k in 0 until iArr.length()) {
                                val io = iArr.optJSONObject(k) ?: continue
                                add(OutlineItem(
                                    id = io.optInt("id", 0),
                                    source = io.optString("source", ""),
                                    type = io.optString("type", ""),
                                    title = io.optString("title", ""),
                                    snippet = io.optString("snippet", ""),
                                ))
                            }
                        }
                        add(OutlineLesson(lesson = lo.optString("lesson", ""), items = items))
                    }
                }
                add(OutlineUnit(unit = uo.optString("unit", ""), lessons = lessons))
            }
        }
        units
    }

    /** 大纲条目详情：完整内容 + 原图；失败返回空 */
    suspend fun fetchOutlineItem(source: String, itemId: Int): OutlineItemDetail = withContext(Dispatchers.IO) {
        val json = executeJson(
            Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/outline-item?source=$source&item_id=$itemId")
                .auth()
                .build()
        ) ?: return@withContext OutlineItemDetail()
        val imageBytes = try {
            val imgReq = Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/outline-image/$source/$itemId")
                .auth()
                .build()
            client.newCall(imgReq).execute().use { resp ->
                if (resp.isSuccessful) resp.body?.bytes() else null
            }
        } catch (e: Exception) {
            Log.w(TAG, "outline-image 异常: ${e.message}")
            null
        }
        OutlineItemDetail(
            source = json.optString("source", ""),
            id = json.optInt("id", 0),
            unit = json.optString("unit", ""),
            lesson = json.optString("lesson", ""),
            type = json.optString("type", ""),
            page = json.optString("page", ""),
            content = json.optString("content", ""),
            imageBytes = imageBytes,
        )
    }

    /** 拼音音频文件 URL（服务端 /pinyin-audio 端点） */
    fun pinyinAudioUrl(filePath: String): String = "$serverBase/api/v1/pinyin-audio?file=${java.net.URLEncoder.encode(filePath, "UTF-8")}"

    /** 获取一关拼音练习（词语+带声调拼音）；失败返回空 */
    suspend fun fetchPinyinLevel(unit: String = "", count: Int = 5): PinyinLevel = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("unit", unit)
            put("count", count)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/pinyin-level")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext PinyinLevel()
        val words = buildList {
            val arr = json.optJSONArray("words") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val h = o.optString("hanzi", "").trim()
                val p = o.optString("pinyin", "").trim()
                if (h.isNotEmpty() && p.isNotEmpty()) {
                    val parts = buildList {
                        val parr = o.optJSONArray("parts") ?: JSONArray()
                        for (j in 0 until parr.length()) {
                            val po = parr.optJSONObject(j) ?: continue
                            val pt = po.optString("text", "").trim()
                            if (pt.isNotEmpty()) add(PinyinPart(text = pt, label = po.optString("label", ""), audio = po.optString("audio", "")))
                        }
                    }
                    add(PinyinWord(hanzi = h, pinyin = p, parts = parts))
                }
            }
        }
        PinyinLevel(unit = json.optString("unit", ""), words = words)
    }

    /** 知识库问答：问题 → 检索相关页面 → LLM 综合回答；失败返回空 */
    suspend fun kbAsk(question: String): TextAskResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("question", question).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/kb-ask")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext TextAskResult()
        val keywords = buildList {
            val arr = json.optJSONArray("keywords") ?: JSONArray()
            for (i in 0 until arr.length()) add(arr.optString(i, ""))
        }
        TextAskResult(
            answer = json.optString("answer", ""),
            keywords = keywords,
            sourceTitle = json.optString("source_title", ""),
        )
    }

    /** 文本问答：基于传入文本直接回答（无检索规划）；失败返回空 */
    suspend fun textAsk(context: String, question: String, title: String = ""): TextAskResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("context", context)
            put("question", question)
            put("title", title)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/text-ask")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext TextAskResult()
        val keywords = buildList {
            val arr = json.optJSONArray("keywords") ?: JSONArray()
            for (i in 0 until arr.length()) add(arr.optString(i, ""))
        }
        TextAskResult(
            answer = json.optString("answer", ""),
            keywords = keywords,
            sourceTitle = json.optString("source_title", ""),
        )
    }

    /** 多音字标注：LLM 找多音字并给出当前上下文正确拼音，供 TTS 逐字点读注音；失败返回空 */
    suspend fun fetchPolyphones(text: String): Map<String, String> = withContext(Dispatchers.IO) {
        val body = JSONObject().put("text", text).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/polyphones")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyMap()
        val out = mutableMapOf<String, String>()
        val p = json.optJSONObject("polyphones") ?: JSONObject()
        val it = p.keys()
        while (it.hasNext()) {
            val k = it.next()
            val v = p.optString(k, "").trim()
            if (k.length == 1 && v.isNotEmpty()) out[k] = v
        }
        out
    }

    /** 语文好词好句标注（按本年级学习重点）；失败返回空 */
    suspend fun fetchChineseHighlight(text: String): ChineseHighlightResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("text", text).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-chinese/highlight")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext ChineseHighlightResult()
        fun items(key: String): List<ChineseHighlightItem> {
            val arr = json.optJSONArray(key) ?: JSONArray()
            return buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val t = o.optString("text", "").trim()
                    if (t.isNotEmpty()) add(ChineseHighlightItem(text = t, reason = o.optString("reason", "").trim()))
                }
            }
        }
        ChineseHighlightResult(words = items("words"), sentences = items("sentences"))
    }

    private fun executeJson(request: Request): JSONObject? {
        return try {
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "HTTP ${resp.code}: ${resp.body?.string()?.take(200)}")
                    null
                } else {
                    val s = resp.body?.string() ?: return@use null
                    JSONObject(s)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "请求异常: ${e.message}")
            null
        }
    }

    // ── 学生句子朗读录音 ──
    /** 上传某句的朗读录音（multipart）；成功返回 true */
    suspend fun uploadSentenceAudio(sentence: String, file: File): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("sentence", sentence)
                .addFormDataPart("file", "record.m4a", file.asRequestBody("audio/mp4".toMediaType()))
                .build()
            val request = Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/sentence-audio")
                .post(body)
                .auth()
                .build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "上传录音失败: ${resp.code} ${resp.body?.string()?.take(200)}")
                    false
                } else {
                    true
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "上传录音异常: ${e.message}")
            false
        }
    }

    /** 某句录音的播放地址（按句子文本哈希） */
    fun sentenceAudioUrl(sentence: String): String {
        val h = MessageDigest.getInstance("MD5")
            .digest(sentence.trim().toByteArray())
            .joinToString("") { "%02x".format(it) }
        return "$serverBase/api/v1/ai-chinese/sentence-audio/$h"
    }

    /** 查询某句是否已有录音 */
    suspend fun sentenceAudioExists(sentence: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val h = MessageDigest.getInstance("MD5")
                .digest(sentence.trim().toByteArray())
                .joinToString("") { "%02x".format(it) }
            val request = Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/sentence-audio/$h/exists")
                .get()
                .auth()
                .build()
            executeJson(request)?.optBoolean("exists", false) == true
        } catch (e: Exception) {
            false
        }
    }

    private companion object {
        const val TAG = "AiHomeworkRepo"
    }
}
