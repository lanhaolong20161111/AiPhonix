package com.example.ai.data.training

/**
 * 当前训练会话上下文 — 学生从首页点任务卡片进入页面时由 HomeScreen 设置，
 * 返回首页打卡后由 Navigation 清空。
 *
 * 页面 ViewModel 需要 planItemId 时从 [itemId] 读取（如认字页 finish 后上报结果）。
 * 用 object 单例避免给 9 个路由签名都加 planItemId 参数（V1 进入页面时未传）。
 */
object ActiveTrainingSession {
    @Volatile
    var itemId: String? = null

    @Volatile
    var featureId: FeatureId? = null

    fun start(itemId: String, featureId: FeatureId?) {
        this.itemId = itemId
        this.featureId = featureId
    }

    fun clear() {
        itemId = null
        featureId = null
    }
}
