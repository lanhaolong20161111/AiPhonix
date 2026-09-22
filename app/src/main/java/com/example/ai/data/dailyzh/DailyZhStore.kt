package com.example.ai.data.dailyzh

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** 每日一练·语文的今日配置（字段与 web `DailyZhConfig` 一致） */
data class DailyZhConfig(
    val chars: String = "",
    val words: String = "",
    val sentences: String = "",
    val essayTopic: String = "",
    val updatedAt: String = "",
)

/**
 * 本地镜像（web `readLocalMirror` / `writeLocalMirror` 的等价物）。
 *
 * 作用与 web 一致：① 未登录时的唯一来源；② 已登录时作为联网失败兜底 + 首屏快速渲染。
 * 存储用 SharedPreferences（配置文件很小，且项目内 `TrainingPlanStore`/`PronunciationStyleStore` 已是此惯例）。
 * key 沿用 web localStorage 的名字，便于对照排查。
 */
class DailyZhStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("daily_zh_prefs", Context.MODE_PRIVATE)

    /** 读本地镜像；坏 JSON / 缺字段都回退空配置（与 web 的 `catch { 忽略 }` 同语义） */
    fun read(): DailyZhConfig {
        val raw = prefs.getString(KEY_CONFIG, null) ?: return DailyZhConfig()
        return try {
            val p = JSONObject(raw)
            DailyZhConfig(
                chars = p.optString("chars", ""),
                words = p.optString("words", ""),
                sentences = p.optString("sentences", ""),
                essayTopic = p.optString("essayTopic", ""),
                updatedAt = p.optString("updatedAt", ""),
            )
        } catch (e: Exception) {
            DailyZhConfig()
        }
    }

    fun write(cfg: DailyZhConfig) {
        val json = JSONObject().apply {
            put("chars", cfg.chars)
            put("words", cfg.words)
            put("sentences", cfg.sentences)
            put("essayTopic", cfg.essayTopic)
            put("updatedAt", cfg.updatedAt)
        }.toString()
        prefs.edit().putString(KEY_CONFIG, json).apply()
    }

    private companion object {
        /** 与 web localStorage key 同名，便于对照 */
        const val KEY_CONFIG = "daily_chinese_config"
    }
}
