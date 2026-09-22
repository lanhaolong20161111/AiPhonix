package com.example.ai.data.audio

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 英文拼读着色开关（全局偏好）。
 *
 * 对齐 web `lib/phonicsPref.ts`：默认开（`true`），持久化到 `SharedPreferences`。
 * 模式照 `PronunciationStyleStore`：构造持有 `Context`（容器注入，ViewModel 不持 Context），
 * 暴露 `StateFlow<Boolean>` 供 Compose `collectAsStateWithLifecycle` 联动。
 *
 * ⚠️ 与 web 的差异：web 委托 `userPrefs`（登录态同步服务端、按账户隔离），Android 端
 * 暂无账户级同步，仅本机持久化（每日英语是离线优先页面）。
 */
class PhonicsColorStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("phonics_color", Context.MODE_PRIVATE)

    private val _enabled = MutableStateFlow(prefs.getBoolean(KEY_ENABLED, true))
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    /** 切换着色开关（默认开 → 关 / 关 → 开） */
    fun toggle() {
        val next = !_enabled.value
        prefs.edit().putBoolean(KEY_ENABLED, next).apply()
        _enabled.value = next
    }

    /** 显式设定（便于将来接入服务端同步后回写） */
    fun setEnabled(v: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, v).apply()
        _enabled.value = v
    }

    companion object {
        private const val KEY_ENABLED = "enabled"
    }
}
