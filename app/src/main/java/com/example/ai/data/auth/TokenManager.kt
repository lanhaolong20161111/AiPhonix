package com.example.ai.data.auth

import android.content.Context
import android.content.SharedPreferences

/**
 * Token 管理器 — 存储和读取 JWT Token
 */
object TokenManager {

    private const val PREFS_NAME = "ai_phonix_auth"
    private const val KEY_ACCESS_TOKEN = "access_token"
    private const val KEY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_USERNAME = "username"
    private const val KEY_NICKNAME = "nickname"
    private const val KEY_ROLE = "role"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    var accessToken: String
        get() = prefs.getString(KEY_ACCESS_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_ACCESS_TOKEN, value).apply()

    var refreshToken: String
        get() = prefs.getString(KEY_REFRESH_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_REFRESH_TOKEN, value).apply()

    var username: String
        get() = prefs.getString(KEY_USERNAME, "") ?: ""
        set(value) = prefs.edit().putString(KEY_USERNAME, value).apply()

    var nickname: String
        get() = prefs.getString(KEY_NICKNAME, "") ?: ""
        set(value) = prefs.edit().putString(KEY_NICKNAME, value).apply()

    var role: String
        get() = prefs.getString(KEY_ROLE, "") ?: ""
        set(value) = prefs.edit().putString(KEY_ROLE, value).apply()

    /** 是否已登录 */
    val isLoggedIn: Boolean get() = accessToken.isNotBlank()

    /** 清空所有 token（登出） */
    fun clear() {
        prefs.edit().clear().apply()
    }
}
