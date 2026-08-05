package com.example.ai.data.training

import kotlinx.serialization.Serializable

/**
 * 训练任务项 — 家长从 [FeatureCatalog] 勾选一个功能组成一项针对性训练。
 *
 * @param feature FeatureId.id
 * @param done 学生是否已完成本次训练（V2 语义：只有页面回传了真实结果才置 true）
 * @param lastResult 最近一次真实练习结果（页面完成度回传，家长页可展示）
 */
@Serializable
data class PlanItem(
    val id: String,
    val feature: String,
    val done: Boolean = false,
    val doneAt: Long? = null,
    val lastResult: PlanResult? = null,
) {
    val featureId: FeatureId? get() = FeatureId.fromId(feature)
}

/**
 * 真实练习结果 — 页面达成"完成标准"时回传（V2 方向 2）。
 *
 * @param count 练习量（题数/字数/句数）
 * @param correct 正确数（无对错概念的页面为 null）
 * @param score 平均评分（如视频跟读 SOE 分数，无则 null）
 * @param durationMs 练习耗时
 * @param doneAt 完成时间戳
 */
@Serializable
data class PlanResult(
    val count: Int = 0,
    val correct: Int? = null,
    val score: Double? = null,
    val durationMs: Long = 0,
    val doneAt: Long = 0,
)

/**
 * 训练任务包 — 家长动态决定的页面集合。
 *
 * @param id 每次保存都会生成新 id，用于通知客户端（首页/导航）整体刷新
 */
@Serializable
data class TrainingPlan(
    val id: String,
    val title: String,
    val items: List<PlanItem>,
    val createdAt: Long,
    val updatedAt: Long,
) {
    val doneCount: Int get() = items.count { it.done }
    fun hasFeature(featureId: FeatureId): Boolean = items.any { it.feature == featureId.id }
}

/** 磁盘文件外壳：plan 为 null 表示家长还未创建任务 */
@Serializable
data class TrainingPlanFile(val plan: TrainingPlan? = null)
