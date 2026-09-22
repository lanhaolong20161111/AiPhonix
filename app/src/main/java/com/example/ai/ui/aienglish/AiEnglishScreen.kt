package com.example.ai.ui.aienglish

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.aichinese.TextBlock
import java.io.File

private val Black = Color(0xFF000000)
private val CorrectGreen = Color(0xFF2E7D32)

/**
 * AI 英语主页（对齐 web AiEnglishPage）：
 * 拍照/相册识别英语课文（mode=english），文本框直接提问（多轮会话，断点续聊）。
 */
@Composable
fun AiEnglishScreen(
    viewModel: AiEnglishViewModel,
    onBack: () -> Unit,
    onOpenHistory: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.initTts(context) }
    DisposableEffect(Unit) { onDispose { /* TTS 由 ViewModel.onCleared 统一停 */ } }

    // 拍照（cache 文件，不写相册免存储权限）
    var pendingFile by remember { mutableStateOf<File?>(null) }
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        pendingFile?.let { file ->
            if (ok) {
                try {
                    viewModel.parseImage(file.readBytes())
                } catch (e: Exception) {
                    Toast.makeText(context, "读取照片失败: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
            file.delete()
            pendingFile = null
        }
    }

    // 相册选图（免权限）
    val pickFromGallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { readUriAndParse(context, viewModel, it) }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("📚 AI 英语", style = MaterialTheme.typography.titleLarge, color = Black)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onOpenHistory) {
                Text("🗂 历史", style = MaterialTheme.typography.bodySmall, color = Black)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "拍照识别英语课文，或在框内输入问题，点「提问」让 AI 直接回答。",
            fontSize = 13.sp,
            color = Black,
        )

        Spacer(Modifier.height(16.dp))

        // 输入方式
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(
                onClick = {
                    val dir = File(context.cacheDir, "import_photos").apply { mkdirs() }
                    val file = File(dir, "aien_photo_${System.currentTimeMillis()}.jpg")
                    pendingFile = file
                    takePicture.launch(cameraUri(context, file))
                },
                modifier = Modifier.weight(1f),
            ) { Text("📷 拍照", color = Black) }
            OutlinedButton(
                onClick = { pickFromGallery.launch("image/*") },
                modifier = Modifier.weight(1f),
            ) { Text("🖼️ 相册", color = Black) }
            OutlinedButton(
                onClick = { viewModel.reparseImage() },
                enabled = state.hasCachedImage && !state.parsingImage,
                modifier = Modifier.weight(1f),
            ) { Text("🔄 重识", color = Black) }
        }

        Spacer(Modifier.height(10.dp))

        // 提问输入框
        OutlinedTextField(
            value = state.chatInput,
            onValueChange = viewModel::updateChatInput,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("输入问题（如：这句话是什么意思？）", fontSize = 14.sp) },
            minLines = 2,
            maxLines = 4,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(
                onClick = viewModel::ask,
                enabled = !state.asking && (state.chatInput.isNotBlank() || state.inputText.isNotBlank()),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1565C0)),
            ) {
                if (state.asking) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                    Spacer(Modifier.width(8.dp))
                }
                Text(if (state.asking) "思考中…" else "提问", color = Color.White)
            }
            Spacer(Modifier.width(10.dp))
            if (state.turns.isNotEmpty()) {
                TextButton(onClick = viewModel::newChat) {
                    Text("🆕 新对话", fontSize = 13.sp, color = Black)
                }
            }
        }

        if (state.error.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(state.error, fontSize = 13.sp, color = Color(0xFFB71C1C))
        }

        // 识别中提示
        if (state.parsingImage) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("AI 识别中，约需 30–60 秒，请稍候…", fontSize = 13.sp, color = Black)
            }
        }

        // 识别结果（按排版块展示，点单词朗读）
        if (state.blocks.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text("已识别 ${state.blocks.size} 块（点单词听发音）", fontSize = 13.sp, color = Black)
            Spacer(Modifier.height(6.dp))
            state.blocks.forEach { block ->
                EnglishBlockCard(block = block, onSpeakWord = viewModel::speakTappedWord)
            }
        }

        // 对话记录
        if (state.turns.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text("💬 对话", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Black)
            Spacer(Modifier.height(8.dp))
            state.turns.forEachIndexed { idx, turn ->
                ChatBubble(
                    turn = turn,
                    speaking = state.speakingText == turn.content,
                    onSpeak = { viewModel.speakTurn(turn) },
                )
                Spacer(Modifier.height(8.dp))
            }
        }

        Spacer(Modifier.height(40.dp))
    }
}

private fun readUriAndParse(context: Context, viewModel: AiEnglishViewModel, uri: Uri) {
    try {
        context.contentResolver.openInputStream(uri)?.use { s ->
            viewModel.parseImage(s.readBytes())
        }
    } catch (e: Exception) {
        Toast.makeText(context, "读取图片失败: ${e.message}", Toast.LENGTH_SHORT).show()
    }
}

private fun cameraUri(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

/** 识别块卡片：标题居中加粗，正文点词朗读 */
@Composable
private fun EnglishBlockCard(block: TextBlock, onSpeakWord: (String) -> Unit) {
    val isTitle = block.type == "title"
    val isHeading = block.type == "heading"
    val isNote = block.type == "note"
    Card(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        colors = CardDefaults.cardColors(
            containerColor = when {
                isNote -> Color(0xFFFFF3D6)
                isTitle -> Color(0xFFE8F5E9)
                else -> Color(0xFFFFFFFF)
            },
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (block.lines.isNotEmpty()) {
                block.lines.forEach { line ->
                    TappableLine(
                        text = line.text,
                        bold = isTitle || isHeading,
                        fontSize = if (isTitle) 18.sp else 16.sp,
                        centered = isTitle || block.align == "center",
                        indentDp = (line.indent * 16).dp,
                        onSpeakWord = onSpeakWord,
                    )
                }
            } else {
                TappableLine(
                    text = block.text,
                    bold = isTitle || isHeading,
                    fontSize = if (isTitle) 18.sp else 16.sp,
                    centered = isTitle || block.align == "center",
                    indentDp = 0.dp,
                    onSpeakWord = onSpeakWord,
                )
            }
        }
    }
}

/** 一行文本：点某个单词 → 朗读该词（英文） */
@Composable
private fun TappableLine(
    text: String,
    bold: Boolean,
    fontSize: androidx.compose.ui.unit.TextUnit,
    centered: Boolean,
    indentDp: androidx.compose.ui.unit.Dp,
    onSpeakWord: (String) -> Unit,
) {
    if (text.isBlank()) return
    var layoutResult by remember(text) { mutableStateOf<TextLayoutResult?>(null) }
    Text(
        text = text,
        fontSize = fontSize,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        color = Black,
        textAlign = if (centered) TextAlign.Center else TextAlign.Start,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = indentDp, top = 2.dp)
            .pointerInput(text) {
                detectTapGestures { pos ->
                    val lr = layoutResult ?: return@detectTapGestures
                    val offset = lr.getOffsetForPosition(pos)
                    val word = wordAt(text, offset)
                    if (word.isNotBlank()) onSpeakWord(word)
                }
            },
        onTextLayout = { layoutResult = it },
    )
}

/** 取点击位置所在的英文单词（去掉首尾标点） */
private fun wordAt(text: String, offset: Int): String {
    if (text.isEmpty()) return ""
    val idx = offset.coerceIn(0, text.length - 1)
    var start = idx
    while (start > 0 && !text[start - 1].isWhitespace()) start--
    var end = idx
    while (end < text.length && !text[end].isWhitespace()) end++
    return text.substring(start, end).filter { it.isLetter() || it == '\'' || it == '-' || it == '’' }
}

/** 一条对话气泡 */
@Composable
private fun ChatBubble(turn: AiEnglishTurn, speaking: Boolean, onSpeak: () -> Unit) {
    val isUser = turn.role == "user"
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = if (isUser) Color(0xFFE3F2FD) else Color(0xFFF1F8E9),
            border = BorderStroke(1.dp, Color(0xFFE0E0E0)),
            modifier = Modifier.fillMaxWidth(0.92f),
        ) {
            Column(modifier = Modifier.padding(10.dp)) {
                Text(
                    turn.content,
                    fontSize = 15.sp,
                    color = Black,
                )
                // user 气泡：显示 AI 改错
                if (isUser && turn.correction.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text("✅ 改正：${turn.correction}", fontSize = 13.sp, color = CorrectGreen)
                }
                // assistant 气泡：查词 + 朗读
                if (!isUser) {
                    if (turn.wordInfo.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text("📖 ${turn.wordInfo}", fontSize = 13.sp, color = Black)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        if (speaking) "⏹ 朗读中…" else "🔊 朗读",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF1565C0),
                        modifier = Modifier.clickable(onClick = onSpeak),
                    )
                }
            }
        }
    }
}
