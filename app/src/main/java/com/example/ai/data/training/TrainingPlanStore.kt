package com.example.ai.data.training

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/**
 * 训练任务包本地存储 — files 目录 JSON（同 UserImportStore 先例）+ 家长 PIN（SharedPreferences）。
 *
 * - 计划本身：`files/training_plan.json`，构造时一次性同步加载进 [plan] StateFlow，
 *   后续改动通过内存更新 + 落盘，UI 用 collectAsState 响应。
 * - 家长 PIN：SHA-256 哈希存 SharedPreferences，家庭场景足够，不引入额外依赖。
 */
class TrainingPlanStore(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true }
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val planFile: File
        get() = File(context.filesDir, FILE_PLAN)

    private val _plan = MutableStateFlow(loadFromDisk())
    val plan: StateFlow<TrainingPlan?> = _plan

    // 读-改-写锁：mergeFromServer（IO 线程）与 markDoneWithResult（IO 线程）可能并发，
    // 防止交错时序回滚刚落盘的打卡态（Review 2026-08-04 Should-fix）。
    private val lock = Any()

    // ───────────────────────── 任务计划 ─────────────────────────

    private fun loadFromDisk(): TrainingPlan? {
        if (!planFile.exists()) return null
        return try {
            json.decodeFromString<TrainingPlanFile>(planFile.readText()).plan
        } catch (e: Exception) {
            null // 文件损坏 → 视为无任务，家长可重新创建
        }
    }

    /** 保存新任务包（生成新 id → 首页/导航整体刷新）。返回新计划。 */
    fun savePlan(title: String, items: List<PlanItem>): TrainingPlan = synchronized(lock) {
        val now = System.currentTimeMillis()
        val plan = TrainingPlan(
            id = UUID.randomUUID().toString(),
            title = title.ifBlank { "今日任务" },
            items = items,
            createdAt = now,
            updatedAt = now,
        )
        persist(plan)
        plan
    }

    /** 标记任务项完成（V2：仅当页面回传了真实结果才调用，见 [markDoneWithResult]）。 */
    fun markDone(itemId: String) = synchronized(lock) {
        val cur = _plan.value ?: return
        val updated = cur.copy(
            items = cur.items.map { if (it.id == itemId && !it.done) it.copy(done = true, doneAt = System.currentTimeMillis()) else it },
            updatedAt = System.currentTimeMillis(),
        )
        persist(updated)
    }

    /**
     * 标记任务项完成并记录真实练习结果（V2 打卡语义：有真实结果才算完成）。
     * 页面达成完成标准后回传 [PlanResult]，一并落盘供家长页展示。
     */
    fun markDoneWithResult(itemId: String, result: PlanResult) = synchronized(lock) {
        val cur = _plan.value ?: return
        val now = System.currentTimeMillis()
        val updated = cur.copy(
            items = cur.items.map {
                if (it.id == itemId) it.copy(done = true, doneAt = now, lastResult = result.copy(doneAt = now)) else it
            },
            updatedAt = now,
        )
        persist(updated)
    }

    /** 重置单个任务项完成状态（家长可重新安排）。同时清掉真实结果。 */
    fun resetItem(itemId: String) = synchronized(lock) {
        val cur = _plan.value ?: return
        val updated = cur.copy(
            items = cur.items.map { if (it.id == itemId && it.done) it.copy(done = false, doneAt = null, lastResult = null) else it },
            updatedAt = System.currentTimeMillis(),
        )
        persist(updated)
    }

    /** 重置全部完成状态（新的一天/新一轮训练）。同时清掉真实结果。 */
    fun resetAll() = synchronized(lock) {
        val cur = _plan.value ?: return
        persist(
            cur.copy(
                items = cur.items.map { if (it.done) it.copy(done = false, doneAt = null, lastResult = null) else it },
                updatedAt = System.currentTimeMillis(),
            )
        )
    }

    /** 用服务端拉取的配置整体替换本地（服务端为准，V2 方向 3 跨设备同步）。 */
    fun replacePlan(plan: TrainingPlan) = synchronized(lock) { persist(plan) }

    /**
     * 服务端配置合并到本地：以服务端 items 为准，但**保留本地已完成的打卡态**
     * （done/doneAt/lastResult 属于学生本日行为，不被家长端快照覆盖）。
     */
    fun mergeFromServer(server: TrainingPlan) = synchronized(lock) {
        val cur = _plan.value
        val localById = (cur?.items ?: emptyList()).associateBy { it.id }
        val merged = server.copy(
            items = server.items.map { s ->
                val local = localById[s.id]
                if (local != null && local.done) {
                    s.copy(done = true, doneAt = local.doneAt, lastResult = local.lastResult)
                } else {
                    s
                }
            },
        )
        persist(merged)
    }

    private fun persist(plan: TrainingPlan) {
        _plan.value = plan
        planFile.parentFile?.mkdirs()
        planFile.writeText(json.encodeToString(TrainingPlanFile.serializer(), TrainingPlanFile(plan)))
    }

    // ───────────────────────── 家长 PIN ─────────────────────────

    fun hasPin(): Boolean = prefs.contains(KEY_PIN_HASH)

    /** 设置/修改 PIN（4~6 位数字）。 */
    fun setPin(pin: String) {
        require(pin.length in 4..6 && pin.all { it.isDigit() }) { "PIN 需为 4~6 位数字" }
        prefs.edit().putString(KEY_PIN_HASH, sha256(pin)).apply()
    }

    fun verifyPin(pin: String): Boolean =
        prefs.getString(KEY_PIN_HASH, null)?.let { it == sha256(pin) } ?: false

    /** 修改 PIN：旧 PIN 正确才允许改。 */
    fun changePin(oldPin: String, newPin: String): Boolean {
        if (!verifyPin(oldPin)) return false
        setPin(newPin)
        return true
    }

    /** 打卡落盘在 IO 线程执行，避免阻塞主线程（文件小，仍按规范走 IO）。 */
    suspend fun markDoneAsync(itemId: String) = withContext(Dispatchers.IO) { markDone(itemId) }

    /** 带真实结果的打卡，落盘走 IO 线程。 */
    suspend fun markDoneWithResultAsync(itemId: String, result: PlanResult) =
        withContext(Dispatchers.IO) { markDoneWithResult(itemId, result) }

    private fun sha256(input: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(("aiphonix_training_parent#".toByteArray(Charsets.UTF_8) + input.toByteArray(Charsets.UTF_8)))
            .joinToString("") { "%02x".format(it) }

    companion object {
        private const val PREFS_NAME = "training_parent_prefs"
        private const val KEY_PIN_HASH = "pin_hash"
        private const val FILE_PLAN = "training_plan.json"

        fun newItem(featureId: FeatureId): PlanItem =
            PlanItem(id = UUID.randomUUID().toString(), feature = featureId.id)
    }
}
