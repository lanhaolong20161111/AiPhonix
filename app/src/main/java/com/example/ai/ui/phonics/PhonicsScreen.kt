package com.example.ai.ui.phonics

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.AppContainer
import com.example.ai.PhonemeIndex
import com.example.ai.Practice
import com.example.ai.data.audio.IpaAudioPlayer

@Composable
fun PhonicsScreen(
    onNavigate: (Any) -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: PhonicsViewModel = viewModel { PhonicsViewModel(container.contentRepository) },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (state.isLoading) {
            CircularProgressIndicator()
            return
        }
        if (state.phonemes.isEmpty()) {
            Text("暂无音素数据", fontSize = 18.sp)
            return
        }

        val phoneme = state.phonemes[state.currentIndex]
        val totalCount = state.phonemes.size
        val currentNum = state.currentIndex + 1

        // 全部音标 + 选择横条
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("音素学习", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            TextButton(onClick = { onNavigate(PhonemeIndex) }) {
                Text("全部音标 →", fontSize = 14.sp)
            }
        }
        Spacer(Modifier.height(4.dp))

        // 顶部音素选择横条
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            state.phonemes.forEachIndexed { i, ph ->
                FilterChip(
                    selected = i == state.currentIndex,
                    onClick = { viewModel.selectPhoneme(i) },
                    label = { Text(ph.symbol, fontSize = 14.sp) },
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // 音素详情
        Text(
            "${categoryLabel(phoneme.category)}  ${currentNum}/${totalCount}",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = phoneme.symbol,
                fontSize = 48.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.width(16.dp))
            val context = androidx.compose.ui.platform.LocalContext.current
            val player = remember { IpaAudioPlayer(context) }
            DisposableEffect(Unit) { onDispose { player.stop() } }
            FilledIconButton(
                onClick = { player.play(phoneme.symbol) },
                modifier = Modifier.size(48.dp),
            ) {
                Text("▶", fontSize = 20.sp)
            }
        }

        Spacer(Modifier.height(16.dp))

        Spacer(Modifier.height(16.dp))

        // 练习单词
        if (state.words.isNotEmpty()) {
            Text("练习单词", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                state.words.take(3).forEach { word ->
                    OutlinedCard(
                        onClick = { onNavigate(Practice(word.text)) },
                        modifier = Modifier.weight(1f),
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp).fillMaxWidth(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(text = word.emoji ?: "📝", fontSize = 28.sp)
                            Text(text = word.text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        // 前后切换按钮
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            OutlinedButton(
                onClick = { viewModel.previousPhoneme() },
                enabled = state.currentIndex > 0,
            ) { Text("← 上一个") }

            if (state.words.isNotEmpty()) {
                Button(
                    onClick = { onNavigate(Practice(state.words[0].text)) },
                ) { Text("🎤 跟读评测") }
            }

            OutlinedButton(
                onClick = { viewModel.nextPhoneme() },
                enabled = state.currentIndex < totalCount - 1,
            ) { Text("下一个 →") }
        }
    }
}

private fun categoryLabel(category: com.example.ai.data.model.PhonemeCategory): String = when (category) {
    com.example.ai.data.model.PhonemeCategory.SHORT_VOWEL -> "短元音"
    com.example.ai.data.model.PhonemeCategory.LONG_VOWEL -> "长元音"
    com.example.ai.data.model.PhonemeCategory.DIPHTHONG -> "双元音"
    com.example.ai.data.model.PhonemeCategory.CONSONANT -> "辅音"
    com.example.ai.data.model.PhonemeCategory.FRICATIVE -> "摩擦音"
    com.example.ai.data.model.PhonemeCategory.NASAL -> "鼻音"
    com.example.ai.data.model.PhonemeCategory.PLOSIVE -> "爆破音"
}
