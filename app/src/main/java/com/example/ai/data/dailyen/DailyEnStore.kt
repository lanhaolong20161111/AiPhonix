package com.example.ai.data.dailyen

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** 每日一练·英语的今日配置（字段与 web `DailyEnConfig` 一致） */
data class DailyEnConfig(
    val words: String = "",
    val sentences: String = "",
    val updatedAt: String = "",
)

/**
 * 本地镜像（web `readLocalMirror` / `writeLocalMirror` 的等价物）。
 *
 * 作用与 web 一致：① 未登录时的唯一来源；② 已登录时作为联网失败兜底 + 首屏快速渲染。
 * key 沿用 web localStorage 的名字（`daily_english_config`），便于对照排查。
 */
class DailyEnStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("daily_en_prefs", Context.MODE_PRIVATE)

    /** 读本地镜像；坏 JSON / 缺字段都回退空配置（与 web 的 `catch { 忽略 }` 同语义） */
    fun read(): DailyEnConfig {
        val raw = prefs.getString(KEY_CONFIG, null) ?: return DailyEnConfig()
        return try {
            val p = JSONObject(raw)
            DailyEnConfig(
                words = p.optString("words", ""),
                sentences = p.optString("sentences", ""),
                updatedAt = p.optString("updatedAt", ""),
            )
        } catch (e: Exception) {
            DailyEnConfig()
        }
    }

    fun write(cfg: DailyEnConfig) {
        val json = JSONObject().apply {
            put("words", cfg.words)
            put("sentences", cfg.sentences)
            put("updatedAt", cfg.updatedAt)
        }.toString()
        prefs.edit().putString(KEY_CONFIG, json).apply()
    }

    private companion object {
        /** 与 web localStorage key 同名，便于对照 */
        const val KEY_CONFIG = "daily_english_config"
    }
}
