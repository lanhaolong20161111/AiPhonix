package com.example.ai.data.training

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.ConcurrentHashMap

/**
 * 页面真实练习结果的暂存区（V2 方向 2 的核心通道）。
 *
 * 数据流：页面练习中实时 [record]（幂等覆盖，key=planItemId）→ 学生返回首页 →
 * Navigation 打卡逻辑 [consume] 取走。**只有取到结果才标记完成**（有真实结果才算完成）。
 *
 * 纯内存态：结果只在"页面 → 返回首页"窗口内有效，进程被杀未返回则不完成，符合语义。
 * 线程安全：record 可能来自任意 ViewModel 线程，用 ConcurrentHashMap。
 */
class SessionResultStore {

    private val results = ConcurrentHashMap<String, PlanResult>()
    private val _changed = MutableStateFlow(0) // 简单变更信号（仅供调试/测试）

    /** 页面达成/更新完成度时调用（幂等覆盖）。 */
    fun record(planItemId: String, result: PlanResult) {
        results[planItemId] = result
        _changed.value += 1
    }

    /** 打卡时取走结果（取走后清除，防止同一天重复消费）。 */
    fun consume(planItemId: String): PlanResult? {
        val r = results.remove(planItemId)
        if (r != null) _changed.value += 1
        return r
    }

    /** 当前暂存的所有结果（调试/测试用）。 */
    fun snapshot(): Map<String, PlanResult> = results.toMap()

    fun clear() {
        results.clear()
        _changed.value += 1
    }

    val changeSignal: StateFlow<Int> = _changed
}
