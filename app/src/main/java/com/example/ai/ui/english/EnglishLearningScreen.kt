package com.example.ai.ui.english

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation3.runtime.NavKey
import com.example.ai.AppContainer

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EnglishLearningScreen(
    onNavigate: (NavKey) -> Unit,
    onBack: () -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("英语学习") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(24.dp))

            Text("🇬🇧 选择学习模式", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(32.dp))

            // 26个英文字母
            OutlinedCard(
                onClick = { onNavigate(com.example.ai.LetterIndex) },
                modifier = Modifier.fillMaxWidth().height(100.dp),
            ) {
                Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("🔤", fontSize = 40.sp)
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text("26个英文字母", fontWeight = FontWeight.Bold, fontSize = 20.sp)
                            Text("学习字母的发音和书写", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // 练拼读
            OutlinedCard(
                onClick = { onNavigate(com.example.ai.Phonics(phonemeIndex = 0)) },
                modifier = Modifier.fillMaxWidth().height(100.dp),
            ) {
                Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("📖", fontSize = 40.sp)
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text("自然拼读", fontWeight = FontWeight.Bold, fontSize = 20.sp)
                            Text("通过拼读规则学习发音", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // 视频跟读
            OutlinedCard(
                onClick = { onNavigate(com.example.ai.VideoPractice) },
                modifier = Modifier.fillMaxWidth().height(100.dp),
            ) {
                Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("🎬", fontSize = 40.sp)
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text("视频跟读", fontWeight = FontWeight.Bold, fontSize = 20.sp)
                            Text("看动画视频模仿跟读", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}
