package com.example.ai.ui.letter

import android.media.MediaPlayer
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.AppContainer
import com.example.ai.Practice

@Composable
fun LetterScreen(
    char: String,
    onNavigate: (Any) -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: LetterViewModel = viewModel { LetterViewModel(container.contentRepository) },
) {
    LaunchedEffect(char) { viewModel.loadLetter(char) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val letter = state.letter ?: return

        Text(
            text = "${letter.uppercase} ${letter.lowercase}",
            fontSize = 64.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(text = letter.ipaName, fontSize = 24.sp, color = MaterialTheme.colorScheme.primary)

        Spacer(Modifier.height(12.dp))

        // 字母发音播放按钮
        val context = LocalContext.current
        var isPlaying by remember { mutableStateOf(false) }
        val alphaPlayer = remember {
            object {
                private var mp: MediaPlayer? = null
                fun play(c: String) {
                    stop()
                    val upper = c.uppercase()
                    val idx = String.format("%02d", upper[0] - 'A' + 1)
                    val file = "alphabet/${upper}_${idx}.mp3"
                    try {
                        val afd = context.assets.openFd(file)
                        mp = MediaPlayer().apply {
                            setDataSource(afd)
                            setOnCompletionListener { isPlaying = false; release(); mp = null }
                            setOnErrorListener { _, _, _ -> isPlaying = false; mp?.release(); mp = null; true }
                            prepare()
                            start()
                        }
                        afd.close()
                        isPlaying = true
                    } catch (e: Exception) { isPlaying = false }
                }
                fun stop() {
                    mp?.let { try { if (it.isPlaying) it.stop(); it.release() } catch (_: Exception) {} }
                    mp = null
                    isPlaying = false
                }
            }
        }
        DisposableEffect(char) { onDispose { alphaPlayer.stop() } }

        FilledTonalButton(
            onClick = { alphaPlayer.play(char) },
            enabled = !isPlaying,
        ) {
            Text(if (isPlaying) "▶ 播放中…" else "▶ 听发音")
        }

        Spacer(Modifier.height(24.dp))

        Spacer(Modifier.height(24.dp))
        Text("练习单词", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Spacer(Modifier.height(12.dp))

        state.words.take(3).forEach { word ->
            OutlinedCard(
                onClick = { onNavigate(Practice(word.text)) },
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            ) {
                Row(
                    modifier = Modifier.padding(16.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(text = word.emoji ?: "📝", fontSize = 28.sp)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(text = word.text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            Text(text = word.ipa, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Text("🎤", fontSize = 20.sp)
                }
            }
        }
    }
}
