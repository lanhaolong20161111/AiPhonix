package com.example.ai.ui.aichinese

import com.example.ai.data.aichinese.TextBlock
import com.example.ai.data.aichinese.TextBlockLine
import com.example.ai.util.decodePageCrop

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import java.io.File

/** AI 作业主页：拍照/相册 → 识别并解析关键信息 → 保存并进入练习 */
@Composable
fun AiChineseScreen(
    viewModel: AiChineseViewModel,
    onBack: () -> Unit,
    onOpenCharStats: () -> Unit = {},
) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        viewModel.initTts(context)
        viewModel.loadResumableSessions()
    }

    // 页面离开组合（返回键）时立即停止朗读与录音（比 onCleared 更早触发）
    DisposableEffect(Unit) {
        onDispose { viewModel.cancelSpeaking() }
    }

    // 拍照：直接读 cache 文件识题（不写相册，免存储权限）
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

    // 麦克风权限（录音前先申请，授权后自动开始录音）
    var pendingRecordSentence by remember { mutableStateOf<String?>(null) }
    val recordPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingRecordSentence?.let { s ->
            if (granted) {
                viewModel.toggleParagraphRecord(s)
            } else {
                Toast.makeText(context, "需要麦克风权限才能录音", Toast.LENGTH_SHORT).show()
            }
        }
        pendingRecordSentence = null
    }

    // 点击段落麦克风：有权限直接评测录音；无权限先申请（申请成功自动开始）
    fun onMicClickParagraph(text: String) {
        if (state.isSpeaking) return // 朗读中不可录音（与现有互斥一致）
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            viewModel.toggleParagraphRecord(text)
        } else {
            pendingRecordSentence = text
            recordPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // 原题照片：点击放大全屏查看（本题图片，上图下文）
    var showFullPhoto by remember { mutableStateOf(false) }
    // 原图旋转角度：缩略图与全屏放大共享（全屏查看后记住旋转位置，不再每次重转）
    var photoRotation by remember { mutableStateOf(0f) }

    // 保存成功提示
    LaunchedEffect(state.saved) {
        if (state.saved) {
            Toast.makeText(context, "已保存到「我的学习」", Toast.LENGTH_SHORT).show()
            viewModel.clearSaved()
        }
    }

    // 相册选图（单张，免权限）
    val pickFromGallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let {
            try {
                context.contentResolver.openInputStream(it)?.use { s ->
                    viewModel.parseImage(s.readBytes())
                }
            } catch (e: Exception) {
                Toast.makeText(context, "读取图片失败: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "←",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clickable(onClick = onBack),
            )
            Text("📖 语文", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = viewModel::save, enabled = !state.saving) {
                Text(if (state.saving) "保存中…" else "💾 保存", style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = onOpenCharStats) {
                Text("📖 认读画像", style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "拍照或相册选图，AI 自动识别并解析",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF212121),
        )

        Spacer(Modifier.height(16.dp))

        // 输入方式（进入大纲条目复习时隐藏）
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(
                onClick = {
                    // 文件必须建在 FileProvider 配置的 cache/import_photos 下，否则 getUriForFile 抛异常闪退
                    val dir = File(context.cacheDir, "import_photos").apply { mkdirs() }
                    val file = File(dir, "aihw_photo_${System.currentTimeMillis()}.jpg")
                    pendingFile = file
                    takePicture.launch(cameraUri(context, file))
                },
                modifier = Modifier.weight(1f),
            ) { Text("📷 拍照") }
            OutlinedButton(
                onClick = { pickFromGallery.launch("image/*") },
                modifier = Modifier.weight(1f),
            ) { Text("🖼️ 相册") }
        }

        // 重新识别：同一张图跳过缓存强制 LLM 重跑（识别结果错/漏题时手动重试）
        if (state.hasCachedImage && !state.parsingImage) {
            TextButton(
                onClick = { viewModel.reparseImage() },
                modifier = Modifier.padding(top = 4.dp),
                enabled = !state.parsingImage,
            ) {
                Text("🔄 识别结果不对？重新识别（不走缓存）", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(4.dp))
        }

        Spacer(Modifier.height(8.dp))

        // 输入与识别区
        // 识别中提示
        if (state.parsingImage) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("正在识别题目图片...", style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(8.dp))
            }

            // 识别后自动解析提示
            if (state.analyzing) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("正在解析关键信息…", style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(8.dp))
            }

            // 提问框：检索知识库 → AI 回答（核心问答）
            OutlinedTextField(
                value = state.kbQuestion,
                onValueChange = viewModel::updateKbQuestion,
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                maxLines = 4,
                placeholder = { Text("问个问题，比如：日积月累里有哪些古诗？什么是比喻句？") },
            )
            Spacer(Modifier.height(6.dp))
            Button(
                onClick = viewModel::askKb,
                enabled = !state.askingKb && state.kbQuestion.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.askingKb) "AI 正在检索回答…" else "❓ 提问（检索知识库）")
            }
            if (state.askingKb) {
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("正在检索课文/题库/知识库…", style = MaterialTheme.typography.bodySmall, color = Color(0xFF000000))
                }
            }
            state.kbAnswer?.let { a ->
                Spacer(Modifier.height(8.dp))
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF))) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        if (a.sourceTitle.isNotBlank()) {
                            Text(
                                "📄 依据：${a.sourceTitle}",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color(0xFF000000),
                            )
                            Spacer(Modifier.height(4.dp))
                        }
                        Text(
                            annotateKeywords(a.answer, a.keywords),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF000000),
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))

        // 语文文本按段落展示：每段逐字点读 + 段末 🎤 朗读评测
        if (state.inputText.isNotBlank()) {
            Spacer(Modifier.height(14.dp))
            Text(
                if (state.imageBlocks.isNotEmpty()) "已识别 ${state.imageBlocks.size} 块（按图片排版）" else "已识别 ${state.paragraphs.size} 段",
                style = MaterialTheme.typography.titleSmall,
            )
            // 原题照片（图文对照）：识别文字对应的整张原图，放在内容最上方做参考，点一下放大
            val photoBytes = state.imageBytes
            if (photoBytes != null) {
                Spacer(Modifier.height(8.dp))
                PhotoCard(
                    bytes = photoBytes,
                    pageBounds = state.imagePageBounds,
                    rotation = photoRotation,
                    onRotate = { photoRotation = (photoRotation + 90f) % 360f },
                    onClick = { showFullPhoto = true },
                )
                Spacer(Modifier.height(4.dp))
            }
            Spacer(Modifier.height(6.dp))
            // 读题引导卡：强调先读题，逐字点读
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD))) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                    Text(
                        "📖 第 1 步 · 读题",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF000000),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "用手指点每个字听发音；每段读完后点 🎤 朗读评测。",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF212121),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            // 好词好句图例
            if (state.highlightLoading) {
                Text("🌟 正在标注好词好句…", style = MaterialTheme.typography.bodySmall, color = Color(0xFF212121))
            } else if (state.chineseHighlight != null) {
                Text(
                    "🟢 绿色加粗 = 好词 · 淡绿底 = 好句（本年级学习重点）",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF212121),
                )
                Spacer(Modifier.height(2.dp))
            }
            // 段落展示：优先用识别时的排版块（标题居中/题号加粗/选项缩进），无排版块时按段落渲染
            val displayUnits = if (state.imageBlocks.isNotEmpty()) {
                state.imageBlocks
            } else {
                // fallback：把段落内的换行保留为视觉行（避免整段挤成一行，更接近原文排版）
                state.paragraphs.map { para ->
                    val rawLines = para.split('\n').map { it.trim() }.filter { it.isNotBlank() }
                    TextBlock(
                        type = "body",
                        text = para,
                        align = "left",
                        lines = if (rawLines.isEmpty()) listOf(TextBlockLine(text = para, indent = 0))
                            else rawLines.map { TextBlockLine(text = it, indent = 0) },
                    )
                }
            }
            displayUnits.forEach { block ->
                val para = block.text
                val hl = state.chineseHighlight
                val goodSentence = hl?.sentences?.firstOrNull { para.contains(it.text.trim()) }
                val isGoodSentence = goodSentence != null
                val isTitle = block.type == "title"
                val isHeading = block.type == "heading"
                val isQuestion = block.type == "question"
                val isOption = block.type == "option"
                val isNote = block.type == "note"
                val isPageNumber = para.trim().matches(Regex("\\d+"))
                // 块上方：标记生字按钮。标记模式下只保留当前块的操作（其他块按钮隐藏，聚焦当前块）
                val thisBlockMarking = state.markingBlock == para
                if (!isPageNumber && para.trim().isNotBlank() && (state.markingBlock == null || thisBlockMarking)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(
                            onClick = {
                                if (thisBlockMarking) viewModel.finishMarking()
                                else viewModel.startMarking(para)
                            },
                            enabled = !state.markingUploading,
                        ) {
                            Text(
                                if (thisBlockMarking) "✅ 完成上传（已选 ${state.blockMarkedChars.size} 字）"
                                else "🏷️ 标记不会的字",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = if (thisBlockMarking) Color(0xFF2E7D32) else Color(0xFF1565C0),
                            )
                        }
                        if (thisBlockMarking) {
                            TextButton(onClick = viewModel::cancelMarking) {
                                Text("取消", style = MaterialTheme.typography.labelMedium, color = Color(0xFFB71C1C))
                            }
                            if (state.markingUploading) {
                                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            }
                        }
                    }
                }
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = when {
                            isNote -> Color(0xFFFFF3D6) // 旁白/注脚/拓展等高亮米黄底
                            isGoodSentence -> Color(0xFFE8F5E9)
                            else -> Color(0xFFFFFFFF)
                        },
                    ),
                    border = when {
                        isNote -> BorderStroke(1.dp, Color(0xFFFFB300)) // 旁白高亮边框
                        isGoodSentence -> BorderStroke(1.dp, Color(0xFF66BB6A))
                        else -> BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                    },
                ) {
                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                        // 纯数字块视为页码（课本页码在页脚，非小标题，靠右显示）
                        val isPageNumber = para.trim().matches(Regex("\\d+"))
                        // 旁白（note）默认折叠：记录展开状态
                        val noteExpanded = remember(block) { mutableStateOf(!isNote) }
                        // 操作行：⭐好句顶格 + 块类型标签 + 🎤（朗读评测）
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (isGoodSentence) {
                                Text(
                                    "⭐ 好句",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFF2E7D32),
                                )
                                Spacer(Modifier.width(6.dp))
                            }
                            val typeLabel = when {
                                isTitle -> "📌 标题"
                                // 纯数字的 heading 是页码，不标"小标题"
                                isHeading && !isPageNumber -> "📖 小标题"
                                isQuestion -> "✏️ 题目"
                                isOption -> "☑ 选项"
                                isNote -> when {
                                    para.contains("【旁批") -> "📝 旁批"
                                    para.contains("【注脚") -> "📝 注脚"
                                    para.contains("【拓展") || para.contains("【贴士") -> "📝 拓展"
                                    para.contains("【手写批改") -> "✍️ 手写批改"
                                    para.contains("---分栏---") -> "── 分栏 ──"
                                    else -> "📝 提示"
                                }
                                else -> "" // 正文段不标注序号（与原文一致）
                            }
                            if (typeLabel.isNotEmpty()) {
                                Text(
                                    typeLabel,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFF212121),
                                )
                            }
                            Spacer(Modifier.weight(1f))
                            // 旁白（note）：显示展开/收起箭头，点击折叠切换
                            if (isNote) {
                                Text(
                                    if (noteExpanded.value) "▲ 收起" else "▼ 展开",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = Color(0xFFB26A00),
                                    modifier = Modifier
                                        .padding(start = 6.dp)
                                        .clickable { noteExpanded.value = !noteExpanded.value },
                                )
                            }
                            // 🔊 朗读整块（不记录单字认读画像——整块朗读不触发逐字点击）
                            if (!isPageNumber && para.trim().isNotBlank()) {
                                val thisBlockSpeaking = state.speakingChar == para
                                val thisBlockPreparing = thisBlockSpeaking && state.speakingPhase == "preparing"
                                val thisBlockPlaying = thisBlockSpeaking && state.speakingPhase == "playing"
                                Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(start = 8.dp)) {
                                    if (thisBlockPreparing) {
                                        // 准备中：转圈动画
                                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                    } else {
                                        Text(
                                            if (thisBlockPlaying) "🔊🔊" else "🔊",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = if (thisBlockPlaying) Color(0xFF1565C0) else if (state.isSpeaking) Color(0xFFBDBDBD) else Color.Unspecified,
                                            modifier = Modifier.clickable(enabled = !state.isSpeaking) { viewModel.speak(para) },
                                        )
                                    }
                                }
                            }
                            // 块级不再放🎤：朗读评测改为每句末尾一个🎤（整句评测）
                        }
                        if (isGoodSentence && goodSentence?.reason?.isNotBlank() == true) {
                            Text(
                                "⭐ ${goodSentence.reason}",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color(0xFF2E7D32),
                            )
                        }
                        // 旁白（note）内容：默认折叠，展开才显示
                        if (!isNote || noteExpanded.value) {
                        Spacer(Modifier.height(4.dp))
                        if (isTitle) {
                            // 标题：按图片排版居中加粗（不逐字点读）
                            Text(
                                para,
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF000000),
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = when (block.align) {
                                    "center" -> androidx.compose.ui.text.style.TextAlign.Center
                                    "right" -> androidx.compose.ui.text.style.TextAlign.Right
                                    else -> androidx.compose.ui.text.style.TextAlign.Start
                                },
                            )
                        } else {
                            // 逐字点读区：块内文字连成一条流，用单个 FlowRow 按屏幕宽度自然换行
                            // 首行按 indent 缩进（段落首行空两格），FlowRow 换行后自然顶格
                            val flowText = block.text.replace(Regex("\\s+"), "")
                            val firstIndent = (block.lines.firstOrNull()?.indent ?: 0)
                            val isCentered = block.align == "center" // 古诗等居中块
                            val flowWordRanges = remember(flowText, hl) {
                                buildList {
                                    hl?.words?.forEach { w ->
                                        val t = w.text.trim()
                                        if (t.length >= 2 && flowText.contains(t)) {
                                            var from = 0
                                            while (true) {
                                                val idx = flowText.indexOf(t, from)
                                                if (idx < 0) break
                                                add(idx until idx + t.length)
                                                from = idx + t.length
                                            }
                                        }
                                    }
                                }
                            }
                            // 居中块：按视觉行逐行渲染，每行整体居中（诗句排版）
                            if (isCentered && block.lines.size > 1) {
                                Column {
                                    block.lines.forEach { line ->
                                        val lineText = (line.text ?: "").replace(Regex("\\s+"), "")
                                        if (lineText.isEmpty()) return@forEach
                                        val lineRanges = remember(lineText, hl) {
                                            buildList {
                                                hl?.words?.forEach { w ->
                                                    val t = w.text.trim()
                                                    if (t.length >= 2 && lineText.contains(t)) {
                                                        var from = 0
                                                        while (true) {
                                                            val idx = lineText.indexOf(t, from)
                                                            if (idx < 0) break
                                                            add(idx until idx + t.length)
                                                            from = idx + t.length
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                                            @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                                            androidx.compose.foundation.layout.FlowRow(
                                                horizontalArrangement = Arrangement.spacedBy(2.dp),
                                                verticalArrangement = Arrangement.spacedBy(4.dp),
                                            ) {
                                                lineText.forEachIndexed { ci, ch ->
                                                    if (ch.isWhitespace()) {
                                                        Spacer(Modifier.width(8.dp))
                                                    } else {
                                                        val chStr = ch.toString()
                                                        val isGoodWord = lineRanges.any { ci in it }
                                                        val isPlaying = state.isSpeaking && state.speakingChar == chStr
                                                        val isMarked = thisBlockMarking && chStr in state.blockMarkedChars
                                                        Text(
                                                            chStr,
                                                            style = MaterialTheme.typography.titleMedium,
                                                            fontWeight = if (isGoodWord) FontWeight.Bold else FontWeight.Normal,
                                                            color = if (isGoodWord) Color(0xFF2E7D32) else Color(0xFF000000),
                                                            modifier = Modifier
                                                                .clip(RoundedCornerShape(4.dp))
                                                                .background(
                                                                    when {
                                                                        isMarked -> Color(0xFFFFCDD2) // 标记为"不会的"：红底
                                                                        isPlaying -> Color(0xFF90CAF9)
                                                                        else -> Color.Transparent
                                                                    }
                                                                )
                                                                .clickable {
                                                                    if (thisBlockMarking) viewModel.toggleMarkChar(chStr)
                                                                    else viewModel.speakChar(chStr, state.polyphones)
                                                                }
                                                                .padding(horizontal = 3.dp, vertical = 2.dp),
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } else {
                                Row(
                                    verticalAlignment = Alignment.Top,
                                    horizontalArrangement = when (block.align) {
                                        "center" -> Arrangement.Center
                                        "right" -> Arrangement.End
                                        else -> Arrangement.Start
                                    },
                                ) {
                                @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                                androidx.compose.foundation.layout.FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    // 首行缩进：块内第一行空两格（Spacer 只在首行生效，FlowRow 换行后顶格）
                                    if (firstIndent > 0) {
                                        Spacer(Modifier.width((firstIndent * 22).dp))
                                    }
                                    flowText.forEachIndexed { ci, ch ->
                                        if (ch.isWhitespace()) {
                                            Spacer(Modifier.width(8.dp))
                                        } else {
                                            val chStr = ch.toString()
                                            val isGoodWord = flowWordRanges.any { ci in it }
                                            val isPlaying = state.isSpeaking && state.speakingChar == chStr
                                            val isBold = isGoodWord || isHeading || isQuestion
                                            val isMarked = thisBlockMarking && chStr in state.blockMarkedChars
                                            Text(
                                                chStr,
                                                style = when {
                                                    isHeading || isQuestion -> MaterialTheme.typography.titleSmall
                                                    else -> MaterialTheme.typography.titleMedium
                                                },
                                                fontWeight = if (isBold) FontWeight.Bold else FontWeight.Normal,
                                                color = if (isGoodWord) Color(0xFF2E7D32) else Color(0xFF000000),
                                                modifier = Modifier
                                                    .clip(RoundedCornerShape(4.dp))
                                                    .background(
                                                        when {
                                                            isMarked -> Color(0xFFFFCDD2) // 标记为"不会的"：红底
                                                            isPlaying -> Color(0xFF90CAF9)
                                                            else -> Color.Transparent
                                                        }
                                                    )
                                                    .clickable {
                                                        if (thisBlockMarking) viewModel.toggleMarkChar(chStr)
                                                        else viewModel.speakChar(chStr, state.polyphones)
                                                    }
                                                    .padding(horizontal = 3.dp, vertical = 2.dp),
                                            )
                                        }
                                    }
                                }
                                // 块级 🎤：整段朗读评测（段落模式 eval_mode=2，≤120字/300s）
                                if (!isPageNumber && !isNote) {
                                    val isThisRecording = state.paragraphRecordingText == para
                                    val isThisEvaluating = state.paragraphEvaluatingText == para
                                    val micDisabled = state.isSpeaking ||
                                        (state.paragraphEvaluating && !isThisEvaluating) ||
                                        (state.paragraphRecordingText != null && !isThisRecording)
                                    Text(
                                        if (isThisRecording) "⏹" else "🎤",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = if (isThisRecording) Color(0xFFC62828) else if (micDisabled) Color(0xFFBDBDBD) else Color.Unspecified,
                                        modifier = Modifier
                                            .padding(start = 6.dp)
                                            .clickable(enabled = !micDisabled) { onMicClickParagraph(para) },
                                    )
                                }
                                }
                            if (state.paragraphRecordingText == para) {
                                Text("朗读中…", style = MaterialTheme.typography.labelSmall, color = Color(0xFFC62828))
                            } else if (state.paragraphEvaluatingText == para) {
                                Text("评测中…", style = MaterialTheme.typography.labelSmall, color = Color(0xFFB71C1C))
                            }
                            // 本块评测结果
                            state.paragraphScores[para]?.let { r ->
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    "🎯 ${r.totalScore} 分 · 准确 ${r.accuracyScore.toInt()} · 流利 ${r.fluencyScore.toInt()} · 完整 ${r.integrityScore.toInt()}",
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = when {
                                        r.totalScore >= 85 -> Color(0xFF2E7D32)
                                        r.totalScore >= 60 -> Color(0xFFF57C00)
                                        else -> Color(0xFFB71C1C)
                                    },
                                )
                                r.feedback?.takeIf { it.isNotBlank() }?.let { fb ->
                                    Text(fb, style = MaterialTheme.typography.bodySmall, color = Color(0xFF000000))
                                }
                            }
                            }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            // 文本问答：基于当前文本直接问 AI（无知识库检索，原文即上下文）
            if (state.askOpen) {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3D6))) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "💬 问本文（AI 只基于上面的原文回答）",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF000000),
                            )
                            Spacer(Modifier.weight(1f))
                            Text(
                                "✕",
                                style = MaterialTheme.typography.titleMedium,
                                color = Color(0xFF000000),
                                modifier = Modifier
                                    .padding(4.dp)
                                    .clickable { viewModel.closeAsk() },
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        OutlinedTextField(
                            value = state.askInput,
                            onValueChange = viewModel::updateAskInput,
                            modifier = Modifier.fillMaxWidth(),
                            minLines = 2,
                            maxLines = 3,
                            placeholder = { Text("问个问题，比如：这段话讲了什么？有哪些好词？") },
                        )
                        Spacer(Modifier.height(6.dp))
                        Row {
                            Button(
                                onClick = viewModel::askText,
                                enabled = !state.askingText && state.askInput.isNotBlank(),
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(if (state.askingText) "思考中…" else "发送")
                            }
                        }
                        if (state.askingText) {
                            Spacer(Modifier.height(6.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text("AI 正在结合原文回答…", style = MaterialTheme.typography.bodySmall, color = Color(0xFF000000))
                            }
                        }
                        state.askResult?.let { r ->
                            Spacer(Modifier.height(8.dp))
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF))) {
                                Column(modifier = Modifier.padding(10.dp)) {
                                    r.sourceTitle.takeIf { it.isNotBlank() }?.let {
                                        Text(
                                            "📄 依据：$it",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = Color(0xFF000000),
                                        )
                                        Spacer(Modifier.height(4.dp))
                                    }
                                    Text(
                                        annotateKeywords(r.answer, r.keywords),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = Color(0xFF000000),
                                    )
                                }
                            }
                        }
                    }
                }
            } else if (state.inputText.isNotBlank()) {
                OutlinedButton(
                    onClick = viewModel::openAsk,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("💬 问本文（AI 基于原文回答）") }
                Spacer(Modifier.height(4.dp))
            }
            Spacer(Modifier.height(12.dp))
            // 续闯上次未完成的闯关
            if (state.questResumable.isNotEmpty() && !state.questStarted) {
                state.questResumable.take(2).forEach { s ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp)
                            .clickable(enabled = !state.questLoading) { viewModel.continueQuest(s.sessionId) },
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1)),
                        border = BorderStroke(1.dp, Color(0xFFFFB300)),
                    ) {
                        Text(
                            "↩ 继续上次闯关（${s.question.lineSequence().firstOrNull()?.take(20) ?: "未完成"}）",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF000000),
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
            }
            // 闯关学习：大模型按本题现场出题引导
            Button(
                onClick = viewModel::startQuest,
                enabled = !state.questLoading && !state.questStarted,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.questLoading) "🎮 正在生成闯关计划…" else "🎮 闯关学习（AI 带你一步步解题）")
            }
            if (state.questStarted) {
                Spacer(Modifier.height(8.dp))
                QuestPanel(
                    state = state,
                    currentStep = viewModel.currentQuestStep(),
                    onAnswer = viewModel::answerQuest,
                    onNext = viewModel::nextQuestStep,
                    onRetry = viewModel::retryQuestStep,
                    onHistory = viewModel::toggleQuestHistory,
                    onReplay = viewModel::replayQuest,
                    onRetryErrors = viewModel::retryErrorsQuest,
                    onReport = viewModel::loadQuestReport,
                    onClose = viewModel::closeQuest,
                )
            }
        }

        if (state.error.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(state.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }

    // 全屏查看原题照片（点击图片卡触发）
    val fullPhotoBytes = state.imageBytes
    if (showFullPhoto && fullPhotoBytes != null) {
        FullPhotoDialog(
            bytes = fullPhotoBytes,
            pageBounds = state.imagePageBounds,
            rotation = photoRotation,
            onRotate = { photoRotation = (photoRotation + 90f) % 360f },
            onDismiss = { showFullPhoto = false },
        )
    }
}

/** 原题照片卡：等比缩略展示（支持旋转纠正横向照片），点击放大全屏查看。
 *  旋转状态由外部共享（与全屏查看一致，记住旋转位置）。 */
@Composable
private fun PhotoCard(
    bytes: ByteArray,
    pageBounds: FloatArray?,
    rotation: Float,
    onRotate: () -> Unit,
    onClick: () -> Unit,
) {
    val bitmap = remember(bytes, pageBounds) { decodePageCrop(bytes, pageBounds) } ?: return
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F5F5)),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "📷 原题照片（点一下放大看细节）",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF212121),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "↻",
                    style = MaterialTheme.typography.titleMedium,
                    color = Color(0xFF37474F),
                    modifier = Modifier
                        .padding(4.dp)
                        .clickable(onClick = onRotate),
                )
            }
            Spacer(Modifier.height(6.dp))
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "原题照片",
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(if (rotation % 180f == 0f) bitmap.width.toFloat() / bitmap.height.toFloat() else bitmap.height.toFloat() / bitmap.width.toFloat())
                    .graphicsLayer {
                        rotationZ = rotation
                    }
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClick = onClick),
            )
        }
    }
}

/** 全屏查看原题照片（点 ✕ 关闭；↻ 旋转纠正方向）。
 *  旋转状态由外部共享：与缩略图一致，记住上次旋转位置。 */
@Composable
private fun FullPhotoDialog(
    bytes: ByteArray,
    pageBounds: FloatArray?,
    rotation: Float,
    onRotate: () -> Unit,
    onDismiss: () -> Unit,
) {
    val bitmap = remember(bytes, pageBounds) { decodePageCrop(bytes, pageBounds) }
    Dialog(onDismissRequest = onDismiss) {
        Surface(color = Color.Black) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "📷 原题照片",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "↻ 旋转",
                        style = MaterialTheme.typography.labelLarge,
                        color = Color.White,
                        modifier = Modifier
                            .padding(8.dp)
                            .clickable(onClick = onRotate),
                    )
                    Text(
                        "✕",
                        style = MaterialTheme.typography.titleLarge,
                        color = Color.White,
                        modifier = Modifier
                            .padding(6.dp)
                            .clickable(onClick = onDismiss),
                    )
                }
                if (bitmap != null) {
                    // 双指捏合缩放 / 拖动平移 / 双击复位 / ↻ 旋转
                    var zoom by remember { mutableStateOf(1f) }
                    var pan by remember { mutableStateOf(Offset.Zero) }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .clipToBounds()
                            .pointerInput(Unit) {
                                detectTransformGestures { _, panChange, zoomChange, _ ->
                                    zoom = (zoom * zoomChange).coerceIn(1f, 6f)
                                    pan += panChange
                                }
                            }
                            .pointerInput(Unit) {
                                detectTapGestures(onDoubleTap = {
                                    zoom = 1f
                                    pan = Offset.Zero
                                })
                            },
                    ) {
                        Image(
                            bitmap = bitmap.asImageBitmap(),
                            contentDescription = "原题照片（双指缩放）",
                            modifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    rotationZ = rotation
                                    scaleX = zoom
                                    scaleY = zoom
                                    translationX = pan.x
                                    translationY = pan.y
                                },
                            contentScale = ContentScale.Fit,
                        )
                    }
                }
            }
        }
    }
}

private fun cameraUri(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

private fun questTypeIcon(type: String): String = when (type) {
    "concept" -> "💡"
    "understand" -> "📖"
    "extract" -> "🔍"
    "relation" -> "🧩"
    "formula" -> "✏️"
    "summary" -> "🎉"
    else -> "❓"
}

/** 把回答中的关键字加粗 + 绿色，便于学生抓住重点 */
private fun annotateKeywords(answer: String, keywords: List<String>): AnnotatedString {
    val terms = keywords.map { it.trim() }.filter { it.length >= 2 }
    if (terms.isEmpty()) return AnnotatedString(answer)
    return buildAnnotatedString {
        var from = 0
        while (from < answer.length) {
            var hit: Pair<Int, String>? = null
            for (t in terms) {
                val idx = answer.indexOf(t, from)
                if (idx >= 0 && (hit == null || idx < hit.first)) hit = idx to t
            }
            val next = hit ?: break
            append(answer.substring(from, next.first))
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Color(0xFF2E7D32))) {
                append(next.second)
            }
            from = next.first + next.second.length
        }
        if (from < answer.length) append(answer.substring(from))
    }
}

/** 闯关面板：进度 + 问题卡 + 选项 + 反馈 + 记录/回溯 + 错题回练 + 掌握报告 */
@Composable
private fun QuestPanel(
    state: AiChineseUiState,
    currentStep: com.example.ai.data.aichinese.QuestStepData?,
    onAnswer: (Int) -> Unit,
    onNext: () -> Unit,
    onRetry: () -> Unit,
    onHistory: () -> Unit,
    onReplay: (String) -> Unit,
    onRetryErrors: () -> Unit,
    onReport: () -> Unit,
    onClose: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F8E9)),
        border = BorderStroke(1.dp, Color(0xFFA5D6A7)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // 进度 + 记录 + 关闭
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "🎮 闯关（${state.questCurrentIndex + 1}/${state.questTotal}）",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "📜",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.clickable(onClick = onHistory).padding(4.dp),
                )
                Text(
                    "✕",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.clickable(onClick = onClose).padding(4.dp),
                )
            }
            Spacer(Modifier.height(4.dp))

            if (state.questDone) {
                // 完成
                Text("🎉 闯关成功！", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(4.dp))
                Text(
                    "你已经能一步步自己解出这类题了。",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(8.dp))
                Row {
                    Button(onClick = onRetryErrors, enabled = !state.questRetrying, modifier = Modifier.weight(1f)) {
                        Text(if (state.questRetrying) "生成中…" else "🔁 错题回练")
                    }
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = onReport, modifier = Modifier.weight(1f)) { Text("📊 掌握报告") }
                }
                Spacer(Modifier.height(8.dp))
                Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("完成，关闭闯关") }
                return@Card
            }

            // ── 记录面板：每步作答 + 回溯 + 报告 + 错题回练 ──
            if (state.questShowHistory) {
                Text("📜 闯关记录", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                if (state.questHistoryLoading) {
                    Text("加载中…", style = MaterialTheme.typography.bodySmall)
                } else if (state.questHistory.isEmpty()) {
                    Text("还没有作答记录。", style = MaterialTheme.typography.bodySmall, color = Color(0xFF37474F))
                } else {
                    state.questHistory.forEach { h ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "第${h.stepIndex + 1}步",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.width(44.dp),
                            )
                            Text(
                                if (h.lastCorrect) "✓" else "✗",
                                style = MaterialTheme.typography.labelLarge,
                                color = if (h.lastCorrect) Color(0xFF2E7D32) else Color(0xFFB71C1C),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                h.lastAnswer.take(16) + if (h.answerCount > 1) "（${h.answerCount}次）" else "",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color(0xFF000000),
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (!h.lastCorrect) {
                                TextButton(onClick = { onReplay(h.checkpointId) }) { Text("↩ 重做") }
                            }
                        }
                    }
                    // 掌握报告
                    Spacer(Modifier.height(6.dp))
                    Button(onClick = onReport, modifier = Modifier.fillMaxWidth()) { Text("📊 掌握报告") }
                    // 错题回练
                    Spacer(Modifier.height(6.dp))
                    OutlinedButton(onClick = onRetryErrors, enabled = !state.questRetrying, modifier = Modifier.fillMaxWidth()) {
                        Text(if (state.questRetrying) "生成中…" else "🔁 错题回练（答错步骤重做）")
                    }
                }
                // 报告内容
                state.questReport?.let { rep ->
                    Spacer(Modifier.height(10.dp))
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD))) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(
                                "📊 掌握报告（通过 ${rep.passedSteps}/${rep.totalSteps} 步 · 共答 ${rep.attempts} 次）",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF000000),
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(rep.summary, style = MaterialTheme.typography.bodyMedium, color = Color(0xFF000000))
                            if (rep.wrongSteps.isNotEmpty()) {
                                Spacer(Modifier.height(4.dp))
                                rep.wrongSteps.forEach { w ->
                                    Text(
                                        "✗ 第${w.index + 1}步：${w.question.take(28)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color(0xFF000000),
                                    )
                                }
                            }
                        }
                    }
                }
                return@Card
            }

            // 回溯提示
            if (state.questReplayHint.isNotEmpty()) {
                Text(
                    state.questReplayHint,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF2E7D32),
                )
                Spacer(Modifier.height(4.dp))
            }

            val step = currentStep
            if (step == null) {
                Text("闯关已结束", style = MaterialTheme.typography.bodyMedium)
                return@Card
            }

            // ── 子问题模式：答错后降解出的更简单问题 ──
            val sub = state.questSubQuestion
            if (sub != null) {
                if (state.questFeedback.isNotEmpty()) {
                    Text(
                        state.questFeedback,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFB71C1C),
                    )
                    Spacer(Modifier.height(6.dp))
                }
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1))) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        Text(
                            "💡 更简单的问法：${sub.question}",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF000000),
                        )
                        Spacer(Modifier.height(8.dp))
                        @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                        androidx.compose.foundation.layout.FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            sub.options.forEachIndexed { i, opt ->
                                Card(
                                    modifier = Modifier.clickable(enabled = !state.questAnswering) { onAnswer(i) },
                                    colors = CardDefaults.cardColors(containerColor = if (state.questAnswering) Color(0xFFE0E0E0) else Color(0xFFFFFFFF)),
                                    border = BorderStroke(1.dp, Color(0xFFFFB300)),
                                ) {
                                    Text(
                                        opt,
                                        style = MaterialTheme.typography.bodyMedium,
                                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                                    )
                                }
                            }
                        }
                    }
                }
                return@Card
            }

            // ── 子问题答对 → 回到原题 ──
            if (state.questSubBackToOriginal) {
                Text(
                    state.questFeedback.ifBlank { "很好！现在回到原来的问题再试一次。" },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF2E7D32),
                )
                Spacer(Modifier.height(8.dp))
                Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) { Text("回到原题再试 →") }
                return@Card
            }

            // 问题
            Text(
                "${questTypeIcon(step.type)} ${step.question}",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF000000),
            )
            Spacer(Modifier.height(8.dp))

            if (!state.questAnswered) {
                // 选项
                @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                androidx.compose.foundation.layout.FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    step.options.forEachIndexed { i, opt ->
                        Card(
                            modifier = Modifier.clickable(enabled = !state.questAnswering) { onAnswer(i) },
                            colors = CardDefaults.cardColors(containerColor = if (state.questAnswering) Color(0xFFE0E0E0) else Color(0xFFFFFFFF)),
                            border = BorderStroke(1.dp, Color(0xFF66BB6A)),
                        ) {
                            Text(
                                opt,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            } else {
                // 反馈区
                val feedbackColor = when {
                    state.questCorrect -> Color(0xFF2E7D32)
                    state.questConceptExplain.isNotEmpty() -> Color(0xFF0D47A1)
                    else -> Color(0xFFB71C1C)
                }
                if (state.questConceptExplain.isNotEmpty()) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD))) {
                        Text(
                            "💡 概念讲解：${state.questConceptExplain}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF000000),
                            modifier = Modifier.padding(10.dp),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                }
                if (state.questFeedback.isNotEmpty()) {
                    Text(
                        state.questFeedback,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = feedbackColor,
                    )
                    Spacer(Modifier.height(8.dp))
                }
                if (state.questCorrect || state.questConceptExplain.isNotEmpty()) {
                    Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) { Text("下一步 →") }
                } else {
                    Row {
                        Button(onClick = onRetry, modifier = Modifier.weight(1f)) { Text("再试一次") }
                    }
                }
            }
        }
    }
}
