package com.example.ai.ui.pronunciation

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.example.ai.AppContainer
import com.example.ai.data.audio.IpaAudioPlayer
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.ui.components.StarRating
import com.example.ai.ui.components.PhonemeHeatmap
import coil.compose.AsyncImagePainter
import coil.compose.SubcomposeAsyncImage
import coil.compose.SubcomposeAsyncImageContent

@Composable
fun PronunciationScreen(
    wordText: String,
    onBack: () -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: PronunciationViewModel = androidx.lifecycle.viewmodel.compose.viewModel { PronunciationViewModel(container.contentRepository, container.speechRepository, container.ttsEngine, container.wordImageRepository, container.pronunciationStyleStore) },
) {
    LaunchedEffect(wordText) { viewModel.loadWord(wordText) }

    // 发音风格变化时重新加载（英式/美式标注切换）
    val style by container.pronunciationStyleStore.style.collectAsStateWithLifecycle()
    LaunchedEffect(style) { viewModel.loadWord(wordText) }

    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    // TTS 全局朗读状态：朗读中禁用"播放发音"（防重复播放）
    val ttsSpeaking by container.ttsEngine.isSpeaking.collectAsStateWithLifecycle()

    val ipaPlayer = remember { container.ipaAudioPlayer() }
    DisposableEffect(Unit) { onDispose { ipaPlayer.stop() } }

    // 运行时录音权限
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            viewModel.startEvaluation()
        } else {
            Toast.makeText(context, "需要录音权限才能跟读练习哦！", Toast.LENGTH_LONG).show()
        }
    }

    val onStartEval: () -> Unit = {
        when {
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED -> viewModel.startEvaluation()
            else -> permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    Box(modifier = modifier.fillMaxSize().padding(16.dp)) {
        // 错误提示
        if (state.error != null) {
            Snackbar(modifier = Modifier.align(Alignment.BottomCenter)) {
                Text(state.error ?: "")
            }
        }

        when (state.step) {
            PronunciationStep.IDLE,
            PronunciationStep.PLAYING -> IdleContent(
                word = state.word,
                wordImageUrl = state.wordImageUrl,
                phonemeToPhonicsIndex = state.phonemeToPhonicsIndex,
                ttsSpeaking = ttsSpeaking,
                onStart = onStartEval,
                onPlaySound = { viewModel.playTts() },
                onPlayPhoneme = { ipaPlayer.play(it) },
                state = state,
            )
            PronunciationStep.ASSESSING -> AssessingContent(onStop = { viewModel.stopEvaluation() })
            PronunciationStep.RESULT -> ResultContent(state.result, state.wordImageUrl, onRetry = { viewModel.reset() }, onBack = onBack, ipaPlayer = ipaPlayer)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun IdleContent(
    word: com.example.ai.data.model.Word?,
    wordImageUrl: String?,
    phonemeToPhonicsIndex: Map<String, Int>,
    ttsSpeaking: Boolean,
    onStart: () -> Unit,
    onPlaySound: () -> Unit,
    onPlayPhoneme: (String) -> Unit,  // 点击音素播放发音
    state: PronunciationUiState,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (word != null) {
            if (wordImageUrl != null) {
                // 数据库单词图片（加载失败回退 emoji）
                SubcomposeAsyncImage(
                    model = wordImageUrl,
                    contentDescription = word.text,
                    modifier = Modifier.fillMaxWidth().height(180.dp),
                    contentScale = ContentScale.Fit,
                ) {
                    when (painter.state) {
                        is AsyncImagePainter.State.Loading -> {
                            Box(Modifier.height(120.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator()
                            }
                        }
                        is AsyncImagePainter.State.Error -> {
                            Box(Modifier.height(120.dp), contentAlignment = Alignment.Center) {
                                Text(text = word.emoji ?: "🖼️", fontSize = 64.sp)
                            }
                        }
                        else -> SubcomposeAsyncImageContent()
                    }
                }
            } else {
                Text(
                    text = word.emoji ?: "",
                    fontSize = 64.sp,
                )
            }
            Spacer(Modifier.height(16.dp))
            Text(
                text = word.text,
                fontSize = 48.sp,
                fontWeight = FontWeight.Bold,
            )
            // 音素 chips（有 displayPhonemes 时显示为可点击 chip，否则显示原始 IPA）
            if (state.displayPhonemes.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.Start,
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) {
                    state.displayPhonemes.forEach { ph ->
                        val index = phonemeToPhonicsIndex[ph] ?: -1
                        PhonemeChip(
                            phoneme = ph,
                            enabled = index >= 0,
                            onClick = { if (index >= 0) onPlayPhoneme(ph) },
                        )
                    }
                }
            } else {
                Text(
                    text = word.ipa,
                    fontSize = 20.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onPlaySound, enabled = !ttsSpeaking) {
                Text("🔊 播放发音", fontSize = 14.sp)
            }
            Spacer(Modifier.height(16.dp))
            Button(onClick = onStart, modifier = Modifier.height(64.dp).width(200.dp)) {
                Text("🎤 开始跟读", fontSize = 20.sp)
            }
        }
    }
}

@Composable
private fun AssessingContent(onStop: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        WaveformAnimation()
        Spacer(Modifier.height(24.dp))
        Text("🎤 录音 + 评测中...", fontSize = 20.sp, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(8.dp))
        Text("说完后点击停止", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(16.dp))
        FilledTonalButton(onClick = onStop, modifier = Modifier.height(56.dp).width(160.dp)) {
            Text("⏹ 停止", fontSize = 18.sp)
        }
    }
}

@Composable
private fun ResultContent(
    result: com.example.ai.data.model.PronunciationResult?,
    wordImageUrl: String?,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    ipaPlayer: com.example.ai.data.audio.IpaAudioPlayer,
) {
    if (result == null) return

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(16.dp))
        if (wordImageUrl != null) {
            SubcomposeAsyncImage(
                model = wordImageUrl,
                contentDescription = result.word.text,
                modifier = Modifier.fillMaxWidth().height(140.dp),
                contentScale = ContentScale.Fit,
            ) {
                when (painter.state) {
                    is AsyncImagePainter.State.Loading -> {
                        Box(Modifier.height(100.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                    is AsyncImagePainter.State.Error -> {
                        Box(Modifier.height(100.dp), contentAlignment = Alignment.Center) {
                            Text(text = result.word.emoji ?: "🖼️", fontSize = 48.sp)
                        }
                    }
                    else -> SubcomposeAsyncImageContent()
                }
            }
        } else {
            Text(text = result.word.emoji ?: "", fontSize = 48.sp)
        }
        Text(text = result.word.text, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))

        StarRating(score = result.totalScore)

        Spacer(Modifier.height(24.dp))

        Text("音素分析", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Spacer(Modifier.height(8.dp))
        PhonemeHeatmap(phonemeScores = result.phonemeScores, onPlayPhoneme = { ipaPlayer.play(it) })

        Spacer(Modifier.height(16.dp))
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = result.feedback ?: "",
                modifier = Modifier.padding(16.dp),
                fontSize = 16.sp,
            )
        }

        Spacer(Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            OutlinedButton(onClick = onBack) { Text("← 返回") }
            Button(onClick = onRetry) { Text("🔄 再练一次") }
        }
    }
}

@Composable
fun WaveformAnimation(modifier: Modifier = Modifier) {
    val infiniteTransition = rememberInfiniteTransition(label = "wave")
    val phase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 2f * Math.PI.toFloat(),
        animationSpec = infiniteRepeatable(tween(800, easing = LinearEasing), RepeatMode.Restart),
        label = "phase",
    )

    Canvas(modifier = modifier.fillMaxWidth().height(80.dp)) {
        val w = size.width
        val h = size.height
        val path = Path()
        path.moveTo(0f, h / 2)
        for (x in 0..size.width.toInt() step 4) {
            val xf = x.toFloat()
            val y = h / 2 + kotlin.math.sin((xf / w * 4 * Math.PI).toFloat() + phase) * (h / 3)
            path.lineTo(xf, y)
        }
        drawPath(path, color = Color(0xFF4CAF50), style = Stroke(width = 3f))
    }
}

@Composable
private fun PhonemeChip(
    phoneme: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val bg = if (enabled) MaterialTheme.colorScheme.primaryContainer
             else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (enabled) MaterialTheme.colorScheme.onPrimaryContainer
             else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = bg,
        modifier = Modifier
            .padding(horizontal = 4.dp, vertical = 2.dp)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
    ) {
        Text(
            text = phoneme,
            fontSize = 20.sp,
            color = fg,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}
