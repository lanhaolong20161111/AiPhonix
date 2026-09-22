package com.example.ai.ui.aihistory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.AppContainer
import com.example.ai.data.aihistory.AiHistoryItem
import com.example.ai.data.tts.BaiduTtsCache
import kotlinx.coroutines.launch

private val Black = Color(0xFF000000)

/**
 * AI 历史详情（识别快照只读回看）：缩略图 + 排版块/全文，点行朗读（中文走百度 TTS，英文走系统 TTS）。
 */
@Composable
fun AiHistoryDetailScreen(
    module: String,
    itemId: String,
    container: AppContainer,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: AiHistoryDetailViewModel = viewModel { AiHistoryDetailViewModel(container.aiHistoryStore) },
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ttsCache = remember { BaiduTtsCache(context.applicationContext) }
    var item by remember { mutableStateOf<AiHistoryItem?>(null) }
    var loading by remember { mutableStateOf(true) }
    var speakingText by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(module, itemId) {
        item = viewModel.find(module, itemId)
        loading = false
    }

    val engine = container.ttsEngine

    fun speak(text: String) {
        if (text.isBlank()) return
        val hasChinese = text.any { it.code in 0x4E00..0x9FFF }
        speakingText = text
        scope.launch {
            try {
                if (hasChinese) ttsCache.play(text, "0") else engine.speak(text)
            } finally {
                speakingText = null
            }
        }
    }

    Column(modifier = modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clickable(onClick = onBack),
            )
            Text("历史回看", style = MaterialTheme.typography.titleLarge, color = Black)
        }
        Spacer(Modifier.height(8.dp))

        if (loading) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            return@Column
        }
        val it = item
        if (it == null) {
            Text("记录不存在或已删除", fontSize = 14.sp, color = Color(0xFFB71C1C))
            return@Column
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            if (it.turns.isNotEmpty()) {
                // 会话型：只读气泡
                Text("💬 对话回看（只读）", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Black)
                Spacer(Modifier.height(8.dp))
                it.turns.forEach { turn ->
                    val isUser = turn.role == "user"
                    Text(
                        (if (isUser) "我：" else "老师：") + turn.content,
                        fontSize = 14.sp,
                        color = Black,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 3.dp)
                            .clickable {
                                speak(turn.content)
                            },
                    )
                }
            } else {
                // 识别快照：排版块 / 全文
                if (it.blocks.isNotEmpty()) {
                    it.blocks.forEach { block ->
                        val isTitle = block.type == "title"
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = when {
                                    block.type == "note" -> Color(0xFFFFF3D6)
                                    isTitle -> Color(0xFFE8F5E9)
                                    else -> Color(0xFFFFFFFF)
                                },
                            ),
                            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        ) {
                            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                val lines = block.lines.ifEmpty {
                                    listOf(com.example.ai.data.aichinese.TextBlockLine(text = block.text, indent = 0))
                                }
                                lines.forEach { line ->
                                    Text(
                                        line.text,
                                        fontSize = if (isTitle) 17.sp else 15.sp,
                                        fontWeight = if (isTitle || block.type == "heading") FontWeight.Bold else FontWeight.Normal,
                                        color = Black,
                                        textAlign = if (isTitle || block.align == "center") TextAlign.Center else TextAlign.Start,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(start = (line.indent * 16).dp, top = 2.dp)
                                            .clickable { speak(line.text) },
                                    )
                                }
                            }
                        }
                    }
                } else {
                    it.text.split("\n").filter { l -> l.isNotBlank() }.forEach { line ->
                        Text(
                            line,
                            fontSize = 15.sp,
                            color = Black,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 3.dp)
                                .clickable { speak(line) },
                        )
                    }
                }
            }
            Spacer(Modifier.height(32.dp))
            if (speakingText != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("朗读中，点其他行切换…", fontSize = 12.sp, color = Black)
                }
            }
        }
    }
}
