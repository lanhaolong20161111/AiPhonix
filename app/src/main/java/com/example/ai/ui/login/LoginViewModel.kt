package com.example.ai.ui.login

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class LoginUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val isLoggedIn: Boolean = false,
    val username: String = "",
    val password: String = "",
    val nickname: String = "",
    val grade: String = "",
    val isRegisterMode: Boolean = false,
)

class LoginViewModel(application: Application) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState

    private val client = NetworkModule.httpClient
    private val gson = Gson()
    private val JSON = "application/json; charset=utf-8".toMediaType()
    private val serverBase = ServiceModule.serverBase
    private val TAG = "LoginVM"

    init {
        // 检查是否已登录
        if (TokenManager.isLoggedIn) {
            _uiState.value = _uiState.value.copy(isLoggedIn = true)
        }
    }

    fun updateUsername(v: String) { _uiState.value = _uiState.value.copy(username = v, error = null) }
    fun updatePassword(v: String) { _uiState.value = _uiState.value.copy(password = v, error = null) }
    fun updateNickname(v: String) { _uiState.value = _uiState.value.copy(nickname = v, error = null) }
    fun updateGrade(v: String) { _uiState.value = _uiState.value.copy(grade = v, error = null) }
    fun toggleMode() { _uiState.value = _uiState.value.copy(isRegisterMode = !_uiState.value.isRegisterMode, error = null) }

    fun login() {
        val s = _uiState.value
        if (s.username.isBlank() || s.password.isBlank()) {
            _uiState.value = s.copy(error = "请输入用户名和密码")
            return
        }
        _uiState.value = s.copy(isLoading = true, error = null)
        viewModelScope.launch {
            try {
                val url = "$serverBase/api/v1/auth/login"
                val body = gson.toJson(mapOf(
                    "username" to s.username,
                    "password" to s.password,
                ))
                val resp = withContext(Dispatchers.IO) {
                    client.newCall(Request.Builder().url(url)
                        .post(body.toRequestBody(JSON)).build()).execute()
                }
                if (!resp.isSuccessful) {
                    val msg = resp.body?.string()?.let { parseError(it) } ?: "登录失败"
                    _uiState.value = _uiState.value.copy(isLoading = false, error = msg)
                    return@launch
                }
                val json = resp.body?.string()?.let { gson.fromJson(it, Map::class.java) } ?: return@launch
                saveTokens(json, s.username)
                _uiState.value = _uiState.value.copy(isLoading = false, isLoggedIn = true)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "网络错误: ${e.message}")
            }
        }
    }

    fun register() {
        val s = _uiState.value
        if (s.username.isBlank() || s.password.isBlank() || s.nickname.isBlank()) {
            _uiState.value = s.copy(error = "请填写所有必填项")
            return
        }
        _uiState.value = s.copy(isLoading = true, error = null)
        viewModelScope.launch {
            try {
                val url = "$serverBase/api/v1/auth/register"
                val body = gson.toJson(mapOf(
                    "username" to s.username,
                    "password" to s.password,
                    "nickname" to s.nickname,
                    "grade" to s.grade,
                ))
                val resp = withContext(Dispatchers.IO) {
                    client.newCall(Request.Builder().url(url)
                        .post(body.toRequestBody(JSON)).build()).execute()
                }
                if (!resp.isSuccessful) {
                    val msg = resp.body?.string()?.let { parseError(it) } ?: "注册失败"
                    _uiState.value = _uiState.value.copy(isLoading = false, error = msg)
                    return@launch
                }
                val json = resp.body?.string()?.let { gson.fromJson(it, Map::class.java) } ?: return@launch
                saveTokens(json, s.username)
                _uiState.value = _uiState.value.copy(isLoading = false, isLoggedIn = true)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "网络错误: ${e.message}")
            }
        }
    }

    fun logout() {
        TokenManager.clear()
        _uiState.value = LoginUiState()
    }

    private fun saveTokens(json: Map<*, *>, username: String) {
        val access = json["access_token"] as? String ?: return
        val refresh = json["refresh_token"] as? String ?: ""
        TokenManager.accessToken = access
        TokenManager.refreshToken = refresh
        TokenManager.username = username
        // 尝试获取 nickname
        if (json.containsKey("nickname")) {
            TokenManager.nickname = json["nickname"] as? String ?: ""
        } else {
            TokenManager.nickname = username
        }
    }

    private fun parseError(body: String): String {
        return try {
            val json = gson.fromJson(body, Map::class.java)
            (json["detail"] as? String) ?: "请求失败"
        } catch (_: Exception) { "请求失败" }
    }
}
