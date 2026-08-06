package com.example.ai.ui.phonemeindex

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.AppContainer
import com.example.ai.Phonics
import com.example.ai.data.audio.IpaAudioPlayer
import com.example.ai.data.model.Phoneme
import com.example.ai.data.model.PhonemeCategory

@Composable
fun PhonemeIndexScreen(
    onNavigate: (Any) -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: PhonemeIndexViewModel = viewModel { PhonemeIndexViewModel(container.contentRepository) },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    val player = remember { container.ipaAudioPlayer() }
    DisposableEffect(Unit) { onDispose { player.stop() } }

    Column(modifier = modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Text(
            text = "国际音标总表",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
        )
        Text(
            text = "点击 ▶ 听发音  ·  点击符号看详情",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp),
        )

        if (state.isLoading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            state.grouped.forEach { (category, phonemes) ->
                item {
                    CategoryHeader(category)
                }
                item {
                    PhonemeGrid(
                        phonemes = phonemes,
                        onPlay = { player.play(it.symbol) },
                        onClick = { ph ->
                            val index = state.phonemeIndexMap[ph.symbol] ?: -1
                            if (index >= 0) onNavigate(Phonics(phonemeIndex = index))
                        },
                    )
                }
            }
            // 底部间距
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun CategoryHeader(category: PhonemeCategory) {
    val label = when (category) {
        PhonemeCategory.SHORT_VOWEL -> "短元音 (Short Vowels)"
        PhonemeCategory.LONG_VOWEL -> "长元音 (Long Vowels)"
        PhonemeCategory.DIPHTHONG -> "双元音 (Diphthongs)"
        PhonemeCategory.PLOSIVE -> "爆破音 (Plosives)"
        PhonemeCategory.FRICATIVE -> "摩擦音 (Fricatives)"
        PhonemeCategory.NASAL -> "鼻音 (Nasals)"
        PhonemeCategory.CONSONANT -> "辅音 (Consonants)"
    }
    val color = when (category) {
        PhonemeCategory.SHORT_VOWEL -> Color(0xFFE91E63)
        PhonemeCategory.LONG_VOWEL -> Color(0xFF9C27B0)
        PhonemeCategory.DIPHTHONG -> Color(0xFFFF9800)
        PhonemeCategory.PLOSIVE -> Color(0xFF4CAF50)
        PhonemeCategory.FRICATIVE -> Color(0xFF2196F3)
        PhonemeCategory.NASAL -> Color(0xFF00BCD4)
        PhonemeCategory.CONSONANT -> Color(0xFF607D8B)
    }
    Text(
        text = label,
        fontSize = 16.sp,
        fontWeight = FontWeight.Bold,
        color = color,
        modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
    )
}

@Composable
private fun PhonemeGrid(
    phonemes: List<Phoneme>,
    onPlay: (Phoneme) -> Unit,
    onClick: (Phoneme) -> Unit,
) {
    // 每行 6 个，两行排满
    val chunked = phonemes.chunked(6)

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        chunked.forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.forEach { ph ->
                    PhonemeCell(
                        phoneme = ph,
                        onPlay = { onPlay(ph) },
                        onClick = { onClick(ph) },
                        modifier = Modifier.weight(1f),
                    )
                }
                // 补空白保持对齐
                repeat(6 - row.size) {
                    Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun PhonemeCell(
    phoneme: Phoneme,
    onPlay: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        tonalElevation = 1.dp,
        modifier = modifier.height(if (phoneme.mnemonic.isNotEmpty()) 68.dp else 56.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier
                    .fillMaxSize()
                    .clickable(onClick = onClick),
            ) {
                Text(
                    text = phoneme.symbol,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                if (phoneme.mnemonic.isNotEmpty()) {
                    Text(
                        text = phoneme.mnemonic,
                        fontSize = 11.sp,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // 播放按钮 - 右下角小图标
            IconButton(
                onClick = onPlay,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .size(22.dp),
            ) {
                Text("▶", fontSize = 10.sp)
            }
        }
    }
}
