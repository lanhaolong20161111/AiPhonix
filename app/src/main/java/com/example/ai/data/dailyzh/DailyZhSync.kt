package com.example.ai.data.dailyzh

import com.example.ai.data.auth.TokenManager

/**
 * 今日语文配置的「服务端优先 + 本地镜像兜底」读取（对齐 web `loadDailyZhSynced`）：
 * 已登录 → 拉服务端（今日 config，无则最近一次 last），结果**回写镜像**；
 * 未登录 / 联网失败 → 直接用镜像。
 *
 * 抽出来是因为「每日语文」与「造句练习」两页都要读同一份配置，
 * web 也把它收敛成了 `loadDailyZhSynced()` 一个入口（避免两页各写一套回退逻辑导致行为不一致）。
 */
class DailyZhSync(
    private val store: DailyZhStore,
    private val repository: DailyZhRepository = DailyZhRepository(),
) {
    suspend fun load(): DailyZhConfig {
        if (TokenManager.accessToken.isBlank()) return store.read()
        val res = repository.fetch() ?: return store.read()
        val next = res.config ?: res.last ?: store.read()
        store.write(next)
        return next
    }
}
