package com.example.ai.ui.phonics

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.example.ai.data.model.Phoneme
import com.example.ai.data.model.PhonemeCategory
import com.example.ai.data.audio.PronunciationStyle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun PhonicsScreen(
    initialPhonemeIndex: Int = 0,
    onNavigate: (Any) -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: PhonicsViewModel = viewModel(key = "Phonics_$initialPhonemeIndex") {
        PhonicsViewModel(container.contentRepository, initialPhonemeIndex)
    },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    if (state.isLoading) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }
    if (state.phonemes.isEmpty()) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("暂无音素数据", fontSize = 18.sp)
        }
        return
    }

    val pagerState = rememberPagerState(
        initialPage = state.currentIndex,
        pageCount = { state.phonemes.size },
    )
    val scope = rememberCoroutineScope()

    // 滑动 → ViewModel 同步当前页（FilterChip 高亮跟随）
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.currentPage }.collect { page ->
            viewModel.selectPhoneme(page)
        }
    }

    // ── 下滑提示状态：切页时重置，5 秒后消失 ──
    var showHint by remember { mutableStateOf(true) }
    LaunchedEffect(pagerState.currentPage) {
        showHint = true
        delay(5000)
        showHint = false
    }

    Box(modifier = modifier.fillMaxSize()) {

        Column(
            modifier = Modifier.matchParentSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {

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
                        onClick = { scope.launch { pagerState.animateScrollToPage(i) } },
                        label = { Text(ph.symbol, fontSize = 14.sp) },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))

            // 详情区：左右滑动切换音素
            HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxWidth().weight(1f),
            ) { page ->
                val phoneme = state.phonemes.getOrNull(page) ?: return@HorizontalPager
                PhonemeDetail(
                    phoneme = phoneme,
                    page = page,
                    totalCount = state.phonemes.size,
                    exampleWords = phoneme.exampleWords,
                    englishWords = state.englishWordsMap[phoneme.symbol].orEmpty(),
                    onNavigate = onNavigate,
                    container = container,
                )
            }
        }

        // ── 下滑提示（切页重置，5 秒自动消失）──
        AnimatedVisibility(
            visible = showHint,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
        ) {
            Text(
                "↓ 下滑查看更多",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}

@Composable
private fun PhonemeDetail(
    phoneme: Phoneme,
    page: Int,
    totalCount: Int,
    exampleWords: List<String>,
    englishWords: List<com.example.ai.data.model.EnglishWord>,
    onNavigate: (Any) -> Unit,
    container: AppContainer,
) {
    // 发音风格（英式/美式）：单词音标标注按风格显示
    val style by container.pronunciationStyleStore.style.collectAsStateWithLifecycle()
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // 音素详情
        Text(
            "${categoryLabel(phoneme.category)}  ${page + 1}/${totalCount}",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = phoneme.symbol,
                    fontSize = 48.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.width(16.dp))
                val context = androidx.compose.ui.platform.LocalContext.current
                val player = remember { container.ipaAudioPlayer() }
                DisposableEffect(Unit) { onDispose { player.stop() } }
                FilledIconButton(
                    onClick = { player.play(phoneme.symbol) },
                    modifier = Modifier.size(48.dp),
                ) {
                    Text("▶", fontSize = 20.sp)
                }
            }
            if (phoneme.mnemonic.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    text = phoneme.mnemonic,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        Spacer(Modifier.height(16.dp))

        // 练习单词（来自本音标的 5 个示例词）
        if (exampleWords.isNotEmpty()) {
            Text("练习单词", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Spacer(Modifier.height(8.dp))
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                exampleWords.forEach { word ->
                    OutlinedCard(
                        onClick = { onNavigate(Practice(word)) },
                        modifier = Modifier.width(140.dp),
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp).fillMaxWidth(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(text = word, fontWeight = FontWeight.Bold,
                                fontSize = 16.sp, textAlign = TextAlign.Center)
                        }
                    }
                }
            }
        }

        // ── 三年级上英语词汇 ──
        if (englishWords.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text("三年级上词汇", fontWeight = FontWeight.Bold, fontSize = 15.sp,
                color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                englishWords.forEach { ew ->
                    SuggestionChip(
                        onClick = { onNavigate(Practice(ew.word)) },
                        label = {
                            Text(
                                "${ew.emoji} ${ew.word} ${if (style == com.example.ai.data.audio.PronunciationStyle.UK && ew.ipaUk.isNotEmpty()) ew.ipaUk else ew.phonetic}",
                                fontSize = 12.sp,
                            )
                        },
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))
    }
}

private fun categoryLabel(category: PhonemeCategory): String = when (category) {
    PhonemeCategory.SHORT_VOWEL -> "短元音"
    PhonemeCategory.LONG_VOWEL -> "长元音"
    PhonemeCategory.DIPHTHONG -> "双元音"
    PhonemeCategory.CONSONANT -> "辅音"
    PhonemeCategory.FRICATIVE -> "摩擦音"
    PhonemeCategory.NASAL -> "鼻音"
    PhonemeCategory.PLOSIVE -> "爆破音"
}
