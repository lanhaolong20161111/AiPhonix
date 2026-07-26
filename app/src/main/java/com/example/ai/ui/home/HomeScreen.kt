package com.example.ai.ui.home

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import com.example.ai.AppContainer

@Composable
fun HomeScreen(
    onNavigate: (NavKey) -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = viewModel<HomeViewModel> { HomeViewModel(container.contentRepository) },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(32.dp))
        Text("🌟 早上好！", fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("🔥 连续学习 ${state.streakDays} 天", fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(24.dp))

        // 英语学习入口
        OutlinedCard(
            onClick = { onNavigate(com.example.ai.EnglishLearning) },
            modifier = Modifier.fillMaxWidth().height(100.dp),
            colors = CardDefaults.outlinedCardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            )
        ) {
            Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("🇬🇧", fontSize = 40.sp)
                    Spacer(Modifier.width(16.dp))
                    Column {
                        Text("英语学习", fontWeight = FontWeight.Bold, fontSize = 22.sp)
                        Text("字母 · 拼读 · 视频跟读", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        // 语文练习入口
        OutlinedCard(
            onClick = { onNavigate(com.example.ai.ChinesePractice) },
            modifier = Modifier.fillMaxWidth().height(100.dp),
            colors = CardDefaults.outlinedCardColors(
                containerColor = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.3f)
            )
        ) {
            Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("📝", fontSize = 40.sp)
                    Spacer(Modifier.width(16.dp))
                    Column {
                        Text("语文练习", fontWeight = FontWeight.Bold, fontSize = 22.sp)
                        Text("认字 · 默写 · 词语", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
