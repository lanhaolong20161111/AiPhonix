package com.example.ai.data.audio

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** 音素发音风格：美式 / 英式 */
enum class PronunciationStyle {
    US, UK
}

/**
 * 音素发音风格存储。
 *
 * 美式音频: assets/ipa/{symbol}.aac（原始）
 * 英式音频: assets/ipa_uk/{symbol}.mp3（新东方英式国际音标卡，48 个）
 * 英式缺失的组合音（kw/ks/ju 等）自动回退美式。
 *
 * 当前固定英式（美式/英式切换 UI 已移除，2026-08-07）。
 * setStyle 与 SharedPreferences 持久化保留，便于后续恢复切换功能。
 */
class PronunciationStyleStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("pron_style", Context.MODE_PRIVATE)

    private val _style = MutableStateFlow(PronunciationStyle.UK)
    val style: StateFlow<PronunciationStyle> = _style.asStateFlow()

    fun setStyle(newStyle: PronunciationStyle) {
        prefs.edit().putString(KEY_STYLE, newStyle.name).apply()
        _style.value = newStyle
    }

    companion object {
        private const val KEY_STYLE = "style"
    }
}
