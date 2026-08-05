package com.example.ai.ui.login

import android.app.Application
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.AndroidViewModel
import com.example.ai.data.auth.TokenManager
import com.example.ai.di.NetworkModule
import com.example.ai.di.ServiceModule
import com.google.gson.Gson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
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
        Thread {
            try {
                val url = "$serverBase/api/v1/auth/login"
                val body = gson.toJson(mapOf(
                    "username" to s.username,
                    "password" to s.password,
                ))
                val resp = client.newCall(Request.Builder().url(url)
                    .post(body.toRequestBody(JSON)).build()).execute()
                val bodyString = resp.body?.string() ?: ""
                mainHandler.post {
                    try {
                        if (!resp.isSuccessful) {
                            val msg = parseError(bodyString)
                            _uiState.value = _uiState.value.copy(isLoading = false, error = msg)
                            return@post
                        }
                        val json = gson.fromJson(bodyString, Map::class.java)
                        if (json != null) {
                            saveTokens(json, s.username)
                            _uiState.value = _uiState.value.copy(isLoading = false, isLoggedIn = true)
                        } else {
                            _uiState.value = _uiState.value.copy(isLoading = false, error = "登录失败：响应格式错误")
                        }
                    } catch (e: Exception) {
                        val msg = e::class.simpleName ?: "未知异常"
                        _uiState.value = _uiState.value.copy(isLoading = false, error = "处理响应出错: $msg")
                    }
                }
            } catch (e: Exception) {
                mainHandler.post {
                    val msg = if (!e.message.isNullOrBlank()) e.message else e::class.simpleName ?: "未知错误"
                    _uiState.value = _uiState.value.copy(isLoading = false, error = "网络错误: $msg")
                }
            }
        }.start()
    }

    fun register() {
        val s = _uiState.value
        if (s.username.isBlank() || s.password.isBlank() || s.nickname.isBlank()) {
            _uiState.value = s.copy(error = "请填写所有必填项")
            return
        }
        _uiState.value = s.copy(isLoading = true, error = null)
        Thread {
            try {
                val url = "$serverBase/api/v1/auth/register"
                val body = gson.toJson(mapOf(
                    "username" to s.username,
                    "password" to s.password,
                    "nickname" to s.nickname,
                    "grade" to s.grade,
                ))
                val resp = client.newCall(Request.Builder().url(url)
                    .post(body.toRequestBody(JSON)).build()).execute()
                val bodyString = resp.body?.string() ?: ""
                mainHandler.post {
                    try {
                        if (!resp.isSuccessful) {
                            val msg = parseError(bodyString)
                            _uiState.value = _uiState.value.copy(isLoading = false, error = msg)
                            return@post
                        }
                        val json = gson.fromJson(bodyString, Map::class.java)
                        if (json != null) {
                            saveTokens(json, s.username)
                            _uiState.value = _uiState.value.copy(isLoading = false, isLoggedIn = true)
                        } else {
                            _uiState.value = _uiState.value.copy(isLoading = false, error = "注册失败：响应格式错误")
                        }
                    } catch (e: Exception) {
                        val msg = e::class.simpleName ?: "未知异常"
                        _uiState.value = _uiState.value.copy(isLoading = false, error = "处理响应出错: $msg")
                    }
                }
            } catch (e: Exception) {
                mainHandler.post {
                    val msg = if (!e.message.isNullOrBlank()) e.message else e::class.simpleName ?: "未知错误"
                    _uiState.value = _uiState.value.copy(isLoading = false, error = "网络错误: $msg")
                }
            }
        }.start()
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
        TokenManager.userId = (json["user_id"] as? Number)?.toInt() ?: 0
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
