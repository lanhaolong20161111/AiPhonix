package com.example.ai.ui.login

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    viewModel: LoginViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    // 登录成功后回调
    LaunchedEffect(state.isLoggedIn) {
        if (state.isLoggedIn) onLoginSuccess()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(48.dp))

        // App 标题
        Text(
            "AiPhonix",
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            "AI 伴你学",
            fontSize = 16.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(48.dp))

        // 登录/注册 切换
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
        ) {
            FilterChip(
                selected = !state.isRegisterMode,
                onClick = { if (state.isRegisterMode) viewModel.toggleMode() },
                label = { Text("登录") }
            )
            Spacer(Modifier.width(12.dp))
            FilterChip(
                selected = state.isRegisterMode,
                onClick = { if (!state.isRegisterMode) viewModel.toggleMode() },
                label = { Text("注册") }
            )
        }

        Spacer(Modifier.height(24.dp))

        // 表单
        OutlinedTextField(
            value = state.username,
            onValueChange = viewModel::updateUsername,
            label = { Text("用户名") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        )

        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = state.password,
            onValueChange = viewModel::updatePassword,
            label = { Text("密码") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
        )

        // 注册额外字段
        if (state.isRegisterMode) {
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = state.nickname,
                onValueChange = viewModel::updateNickname,
                label = { Text("昵称 / 姓名 *") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = state.grade,
                onValueChange = viewModel::updateGrade,
                label = { Text("年级（可选）") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            )
        }

        Spacer(Modifier.height(8.dp))

        // 错误提示
        if (state.error != null) {
            Text(
                state.error!!,
                color = MaterialTheme.colorScheme.error,
                fontSize = 14.sp,
            )
        }

        Spacer(Modifier.height(16.dp))

        // 提交按钮
        Button(
            onClick = { if (state.isRegisterMode) viewModel.register() else viewModel.login() },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            enabled = !state.isLoading,
        ) {
            if (state.isLoading) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            } else {
                Text(if (state.isRegisterMode) "注册并登录" else "登录", fontSize = 16.sp)
            }
        }

        Spacer(Modifier.height(48.dp))
    }
}
