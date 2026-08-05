package com.example.ai.data.training

import android.util.Log
import com.example.ai.di.ServiceModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * 训练任务包的服务端同步（V2 方向 3：服务端下发配置 + 方向 2：真实完成度回传）。
 *
 * - [pullPlan]：登录后/启动时拉取配置，**服务端为准**整体替换本地（家长是配置所有者）
 * - [pushPlan]：家长保存配置后推送
 * - [reportProgress]：学生打卡后上报真实完成度（同任务同日幂等 upsert）
 *
 * 复用 NetworkModule.httpClient（自动附 JWT + 401 刷新）；全部静默容错（断网/401 不打断学生使用）。
 */
class TrainingPlanSync(
    private val httpClient: OkHttpClient,
    private val planStore: TrainingPlanStore,
) {

    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json".toMediaType()

    /** 拉取服务端配置并整体替换本地。无网/未配置/未登录时静默返回。 */
    suspend fun pullPlan() = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url("${ServiceModule.serverBase}/api/v1/training/plan")
                .get()
                .build()
            httpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    if (resp.code != 401) Log.w(TAG, "pullPlan: HTTP ${resp.code}")
                    return@withContext
                }
                val planJson = JSONObject(resp.body?.string().orEmpty()).optString("plan")
                if (planJson.isBlank() || planJson == "null") return@withContext
                val plan = json.decodeFromString<TrainingPlan>(planJson)
                // 合并而非整体替换：服务端决定"练什么"，本地已完成的打卡态不被覆盖
                planStore.mergeFromServer(plan)
                Log.i(TAG, "pullPlan: 已从服务端合并任务配置（${plan.items.size} 项）")
            }
        } catch (e: Exception) {
            Log.w(TAG, "pullPlan 失败: ${e.message}") // 断网等，本地配置照常可用
        }
    }

    /** 推送当前配置到服务端（家长保存后调用）。返回是否成功。 */
    suspend fun pushPlan(plan: TrainingPlan): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = json.encodeToString(TrainingPlan.serializer(), plan).toRequestBody(mediaType)
            val req = Request.Builder()
                .url("${ServiceModule.serverBase}/api/v1/training/plan")
                .put(body)
                .build()
            httpClient.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    Log.i(TAG, "pushPlan: 配置已同步到服务端")
                    true
                } else {
                    Log.w(TAG, "pushPlan: HTTP ${resp.code}")
                    false
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "pushPlan 失败: ${e.message}")
            false
        }
    }

    /** 上报真实完成度（打卡后调用；同任务同日幂等，服务端 upsert）。 */
    suspend fun reportProgress(item: PlanItem, result: PlanResult): Boolean = withContext(Dispatchers.IO) {
        try {
            val payload = JSONObject().apply {
                put("plan_item_id", item.id)
                put("feature", item.feature)
                put("count", result.count)
                if (result.correct != null) put("correct", result.correct)
                if (result.score != null) put("score", result.score)
                put("duration_ms", result.durationMs)
                put("done_at", result.doneAt)
                put("metrics", JSONObject(json.encodeToString(PlanResult.serializer(), result)))
            }.toString()
            val req = Request.Builder()
                .url("${ServiceModule.serverBase}/api/v1/training/progress")
                .post(payload.toRequestBody(mediaType))
                .build()
            httpClient.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    Log.i(TAG, "reportProgress: ${item.feature} 完成度已上报")
                    true
                } else {
                    Log.w(TAG, "reportProgress: HTTP ${resp.code}")
                    false
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "reportProgress 失败: ${e.message}")
            false
        }
    }

    private companion object {
        const val TAG = "TrainingPlanSync"
    }
}
