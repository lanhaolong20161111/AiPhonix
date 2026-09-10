package com.example.ai.data.aihomework

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

// ── 搭积木自动搭建：LLM 提取的线段图初始指令 ──

/** 一条数量线段：名称 + 数值（未知量 null）+ 单位 */
data class AutoSegment(
    val label: String,
    val value: Float?,       // 未知量 = null
    val unit: String = "",
    val isUnknown: Boolean = false,
)

/** 差值对比：a 比 b 多/少 */
data class AutoDiff(
    val a: String,
    val b: String,
    val text: String = "",  // 如「多6千克」
    val value: Float = 0f,
)

/** 倍数关系：a 是 b 的几倍 */
data class AutoTimes(val a: String, val b: String)

/** 底部大括号（一共/总数） */
data class AutoBrace(
    val label: String = "",
    val parts: List<String> = emptyList(),
)

/** 线段图初始搭建指令 */
data class AutoBuildResult(
    val segments: List<AutoSegment> = emptyList(),
    val relation: String = "none", // total/diff/times/none
    val diff: AutoDiff? = null,
    val times: AutoTimes? = null,
    val brace: AutoBrace? = null,
)

/** 分步解题的一步（倒推挑战的幕后数据）：目的 + 算式 + 中间结果 + 逻辑讲解 + 线段绘制指令 + 依据条件 */
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

/** 识题结果：完整文本 + 拆分后的题目列表（多题逐题） */
data class ParseImageResult(
    val text: String,
    val questions: List<String>,
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
class AiHomeworkRepository(
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

    /** 知识库问答：问题 → 检索相关页面 → LLM 综合回答；失败返回空（返回 answer/keywords/来源） */
    suspend fun kbAsk(question: String): String = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().put("question", question).toString().toRequestBody(JSON)
            val request = Request.Builder()
                .url("$serverBase/api/v1/ai-chinese/kb-ask")
                .post(body)
                .auth()
                .build()
            val json = executeJson(request) ?: return@withContext ""
            json.optString("answer", "")
        } catch (e: Exception) {
            ""
        }
    }

    /** 拍照识题：图片字节 → 题目列表（服务端 Ark 多模态优先，自动回退 OCR；多题逐题返回）
     *  同一张图片（字节一致）内存缓存直接返回，不再走网络。
     *  @param forceRefresh true = 跳过内存缓存和服务端缓存，强制重新识别（结果覆盖缓存）。 */
    suspend fun parseImage(bytes: ByteArray, fileName: String = "photo.jpg", forceRefresh: Boolean = false): ParseImageResult = withContext(Dispatchers.IO) {
        val key = sha256(bytes)
        if (!forceRefresh) {
            parseImageCache[key]?.let { return@withContext it }
        }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, bytes.toRequestBody("image/jpeg".toMediaType()))
            .build()
        val url = if (forceRefresh) {
            "$serverBase/api/v1/ai-homework/parse-image?no_cache=true"
        } else {
            "$serverBase/api/v1/ai-homework/parse-image"
        }
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
        ParseImageResult(text = text, questions = questions).also {
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
            .url("$serverBase/api/v1/ai-homework/analyze")
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
            .url("$serverBase/api/v1/ai-homework/quest/start")
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
            .url("$serverBase/api/v1/ai-homework/quest/step")
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
            .url("$serverBase/api/v1/ai-homework/quest/history/$sessionId")
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
            .url("$serverBase/api/v1/ai-homework/quest/replay")
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
            .url("$serverBase/api/v1/ai-homework/quest/sessions")
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
            .url("$serverBase/api/v1/ai-homework/quest/continue")
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
            .url("$serverBase/api/v1/ai-homework/quest/retry-errors")
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
            .url("$serverBase/api/v1/ai-homework/quest/report/$sessionId")
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
                .url("$serverBase/api/v1/ai-homework/char-click")
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
            .url("$serverBase/api/v1/ai-homework/char-click/stats")
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
            .url("$serverBase/api/v1/ai-homework/evaluate")
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
            .url("$serverBase/api/v1/ai-homework/questions")
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
            .url("$serverBase/api/v1/ai-homework/steps")
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
                .url("$serverBase/api/v1/ai-homework/save-problem")
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

    /** 动态积木建议（搭积木学习）：按题目让 LLM 生成内置表达不了的新积木定义（倍数条/均分条…）
     *  失败或服务端未开启返回空列表（组件栏只显示内置积木，不阻塞使用）。 */
    suspend fun fetchBlockSuggestions(question: String): List<BlockSuggestion> = withContext(Dispatchers.IO) {
        val body = JSONObject().put("question", question).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-homework/blocks-suggest")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext emptyList()
        val arr = json.optJSONArray("blocks") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val type = o.optString("type", "").trim()
                if (type.isEmpty()) continue
                val name = o.optString("name", "").trim()
                if (name.isEmpty()) continue
                val params = buildMap {
                    val p = o.optJSONObject("params") ?: JSONObject()
                    val keys = p.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        put(k, p.optString(k, ""))
                    }
                }
                add(BlockSuggestion(
                    type = type,
                    name = name,
                    description = o.optString("description", "").trim(),
                    params = params,
                    usage = o.optString("usage", "").trim(),
                ))
            }
        }
    }

    /** 提交搭好的积木图给 LLM 审核（是否满足题目要求）；失败返回 null（UI 提示网络问题） */
    suspend fun submitBuildReview(question: String, blocks: List<BuildBlockItem>): BuildReviewResult? = withContext(Dispatchers.IO) {
        val items = JSONArray()
        for (b in blocks) {
            items.put(JSONObject().apply {
                put("kind", b.kind)
                put("label", b.label)
                put("value", b.value)
                put("unit", b.unit)
                put("color", b.color)
                put("direction", b.direction)
                put("type", b.type)
                put("note", b.note)
                put("segments", b.segments)
                put("times", b.times)
                put("extra", b.extra)
                put("extra_dir", b.extraDir)
            })
        }
        val body = JSONObject().apply {
            put("question", question)
            put("blocks", items)
        }.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-homework/build-review")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext null
        val issues = buildList {
            val arr = json.optJSONArray("issues") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(BuildReviewIssue(
                    message = o.optString("message", "").trim(),
                    fix = o.optString("fix", "").trim(),
                ))
            }
        }
        val suggestions = buildList {
            val arr = json.optJSONArray("suggestions") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val s = arr.optString(i, "").trim()
                if (s.isNotEmpty()) add(s)
            }
        }
        BuildReviewResult(
            passed = json.optBoolean("passed", false),
            feedback = json.optString("feedback", ""),
            issues = issues,
            suggestions = suggestions,
        )
    }

    /** 大模型提取线段图初始搭建指令（已知/未知量 + 关系 + 差值 + 大括号）；失败返回 null */
    suspend fun fetchAutoBuild(question: String): AutoBuildResult? = withContext(Dispatchers.IO) {        val body = JSONObject().put("question", question).toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("$serverBase/api/v1/ai-homework/build-auto")
            .post(body)
            .auth()
            .build()
        val json = executeJson(request) ?: return@withContext null
        val segments = buildList {
            val arr = json.optJSONArray("segments") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val label = o.optString("label", "").trim()
                if (label.isEmpty()) continue
                val value = if (o.isNull("value")) null else o.optDouble("value", Double.NaN)
                if (value != null && value.isNaN()) continue
                add(AutoSegment(
                    label = label,
                    value = value?.toFloat(),
                    unit = o.optString("unit", "").trim(),
                    isUnknown = o.optBoolean("is_unknown", false) || value == null,
                ))
            }
        }
        val diff = json.optJSONObject("diff")?.let { d ->
            AutoDiff(
                a = d.optString("a", "").trim(),
                b = d.optString("b", "").trim(),
                text = d.optString("text", "").trim(),
                value = d.optDouble("value", 0.0).toFloat(),
            )
        }
        val times = json.optJSONObject("times")?.let { t ->
            AutoTimes(
                a = t.optString("a", "").trim(),
                b = t.optString("b", "").trim(),
            )
        }
        val brace = json.optJSONObject("brace")?.let { br ->
            val parts = buildList {
                val parr = br.optJSONArray("parts") ?: JSONArray()
                for (i in 0 until parr.length()) {
                    val p = parr.optString(i, "").trim()
                    if (p.isNotEmpty()) add(p)
                }
            }
            AutoBrace(
                label = br.optString("label", "").trim(),
                parts = parts,
            )
        }
        AutoBuildResult(
            segments = segments,
            relation = json.optString("relation", "none"),
            diff = diff,
            times = times,
            brace = brace,
        )
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
                .url("$serverBase/api/v1/ai-homework/sentence-audio")
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
        return "$serverBase/api/v1/ai-homework/sentence-audio/$h"
    }

    /** 查询某句是否已有录音 */
    suspend fun sentenceAudioExists(sentence: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val h = MessageDigest.getInstance("MD5")
                .digest(sentence.trim().toByteArray())
                .joinToString("") { "%02x".format(it) }
            val request = Request.Builder()
                .url("$serverBase/api/v1/ai-homework/sentence-audio/$h/exists")
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
