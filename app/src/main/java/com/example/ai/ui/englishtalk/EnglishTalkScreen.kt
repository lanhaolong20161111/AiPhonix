package com.example.ai.ui.englishtalk

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.example.ai.data.ocr.OcrPlatform
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.ui.common.EnglishWordTapText
import com.example.ai.ui.echo.EchoLadder
import com.example.ai.ui.ocr.EnVocabEntryCard
import com.example.ai.ui.ocr.EnVocabPhotoSheet
import com.example.ai.util.englishOnly
import java.io.File

/**
 * AI 英语对话陪练页（对齐 web `pages/AiEnglishTalkPage.tsx`）。
 *
 * 两种回答模式（默认「跟读」）：
 * - **跟读模式**：AI 直接给出该说的回答 → 领读 → 逐词跟读阶梯（≥70 分过关进下一级）。
 * - **自己回答**：WebSocket 流式 ASR（[EnglishTurnAsr]）—— 逐词实时上屏、停顿 2s 自动提示下一个词、
 *   6s 完全没出声自动挂整句单词阶梯、「💡 提示记录」面板；点「⏹ 结束」→ AI 判定 →
 *   通过表扬 / 不通过给正确句 + 意群阶梯。
 *
 * 页面本身不含业务逻辑，全部委托 [EnglishTalkViewModel]。
 *
 * @param viewModel 由 `Navigation.kt` 构造注入（需要 `ttsCache`）
 * @param onBack 返回
 */
@Composable
fun EnglishTalkScreen(
    viewModel: EnglishTalkViewModel = viewModel(),
    onBack: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    // 本地持一份 OcrPlatform 仅用于「相机临时文件」（与每日语文同套路；VM 另有自己的引用只读字节）
    val ocrPlatform = remember(context) { OcrPlatform(context.applicationContext) }
    var pendingCameraFile by remember { mutableStateOf<File?>(null) }

    // 离开页面立刻停止朗读（并释放全局播放锁）
    DisposableEffect(Unit) {
        onDispose {
            pendingCameraFile?.delete()
            BaiduTtsCache.stopAll()
        }
    }

    // 相机：拍完直接打开识词弹层
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = pendingCameraFile
        pendingCameraFile = null
        if (!ok || file == null) {
            file?.delete()
            return@rememberLauncherForActivityResult
        }
        viewModel.startPhotoVocab(Uri.fromFile(file))
    }
    // 相册：单张（整页识别，与 web 一致）
    val albumLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) viewModel.startPhotoVocab(uri)
    }

    // 「📷 拍照识词」弹层：整屏替代（与设置面板同套路，避开弹层层级问题）
    if (state.photo.open) {
        EnVocabPhotoSheet(state = state.photo, session = viewModel.photo, modifier = Modifier.fillMaxSize())
        return
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color.White)
            .verticalScroll(rememberScrollState()),
    ) {
        TopBar(
            title = if (state.started) "🗣 ${state.title}" else "🗣 AI 英语对话",
            turnLabel = if (state.started) state.turnLabel else "",
            onBack = onBack,
        )
        Column(Modifier.padding(horizontal = 12.dp).padding(bottom = 24.dp)) {
            if (!state.started) {
                SetupSection(
                    state = state,
                    viewModel = viewModel,
                    onCamera = {
                        // 建临时文件（FileProvider 要求），失败不打开相机
                        pendingCameraFile?.delete()
                        val file = ocrPlatform.newCameraFile()
                        pendingCameraFile = file
                        runCatching { ocrPlatform.cameraUri(file) }
                            .onSuccess { uri -> cameraLauncher.launch(uri) }
                            .onFailure { pendingCameraFile = null }
                    },
                    onAlbum = { albumLauncher.launch("image/*") },
                )
            } else {
                TalkSection(state = state, viewModel = viewModel)
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════
// 顶栏
// ══════════════════════════════════════════════════════════════

@Composable
private fun TopBar(title: String, turnLabel: String, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onBack, modifier = Modifier.width(48.dp)) {
            Text("←", fontSize = 20.sp, color = Black)
        }
        Text(
            text = title,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Black,
            modifier = Modifier.weight(1f),
        )
        if (turnLabel.isNotBlank()) {
            Text(turnLabel, fontSize = 13.sp, color = Grey)
        }
    }
}

// ══════════════════════════════════════════════════════════════
// 设置页
// ══════════════════════════════════════════════════════════════

@Composable
private fun SetupSection(
    state: EnglishTalkUiState,
    viewModel: EnglishTalkViewModel,
    onCamera: () -> Unit,
    onAlbum: () -> Unit,
) {
    Card {
        // 「📷 拍照识词」入口卡（对齐 web 置顶的 EnVocabPhotoSheet 入口）
        EnVocabEntryCard(
            preparing = state.preparingPhoto,
            msg = state.vocabMsg,
            warn = state.vocabWarn,
            onCamera = onCamera,
            onAlbum = onAlbum,
        )
        Spacer(Modifier.height(12.dp))

        Text(
            "也可以直接手写练习词句（场景可不填，AI 会自己挑合适的）。",
            fontSize = 13.sp,
            color = Grey,
        )

        FieldLabel("主题 / 场景（可选，不填 AI 自动决定）")
        OutlinedTextField(
            value = state.topic,
            onValueChange = viewModel::setTopic,
            placeholder = { Text("如：在公园 / 去动物园 / 我的家人", fontSize = 14.sp, color = Grey) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )

        FieldLabel("练习单词（逗号或空格分隔）")
        OutlinedTextField(
            value = state.wordsText,
            onValueChange = viewModel::setWordsText,
            placeholder = { Text("如：apple, park, happy, run", fontSize = 14.sp, color = Grey) },
            minLines = 2,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )

        FieldLabel("练习句子（每行一句，可选）")
        OutlinedTextField(
            value = state.sentencesText,
            onValueChange = viewModel::setSentencesText,
            placeholder = { Text("如：I like apples.\nCan I run in the park?", fontSize = 14.sp, color = Grey) },
            minLines = 3,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )

        if (state.setupError.isNotBlank()) {
            Text(state.setupError, fontSize = 13.sp, color = ErrorColor, modifier = Modifier.padding(top = 8.dp))
        }

        Button(
            onClick = viewModel::startScript,
            enabled = !state.settingUp,
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Text(
                text = when {
                    state.settingUp -> "AI 出题中…"
                    state.wordsCount > 0 || state.sentencesCount > 0 ->
                        "✨ 用这 ${state.wordsCount} 个词 / ${state.sentencesCount} 句开始对话"
                    else -> "✨ 开始对话"
                },
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

// ══════════════════════════════════════════════════════════════
// 对话页
// ══════════════════════════════════════════════════════════════

@Composable
private fun TalkSection(state: EnglishTalkUiState, viewModel: EnglishTalkViewModel) {
    // ── AI 台词气泡 ──
    Card(bg = AiBubbleBg) {
        Text(
            "🤖 AI · ${state.topic.ifBlank { "对话" }}",
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = Grey,
        )
        Spacer(Modifier.height(6.dp))
        val aiEn = englishOnly(state.aiText)
        if (aiEn.isNotBlank()) {
            EnglishWordTapText(
                text = aiEn,
                onWordTap = viewModel::speakWord,
                speakingWord = state.speakingWord,
                fontSize = 19.sp,
            )
        }
        Row(Modifier.padding(top = 8.dp)) {
            SmallButton("🔊 再读", enabled = !state.rolling, onClick = viewModel::reReadAi)
        }
        if (state.lineZh.isNotBlank()) {
            Text(state.lineZh, fontSize = 14.sp, color = Grey, modifier = Modifier.padding(top = 6.dp))
        }
    }

    // ── 回答区 ──
    Card {
        if (state.answerMode == TalkAnswerMode.ECHO) {
            EchoSection(state = state, viewModel = viewModel)
        } else {
            FreeSection(state = state, viewModel = viewModel)
        }
    }

    // ── 💡 提示记录（逐词/整句提示逐行保留，每行可重听；web talk-hints） ──
    HintRowsPanel(state = state, viewModel = viewModel)

    // ── 下一轮 / 完成 ──
    if (state.canAdvance) {
        Button(
            onClick = viewModel::nextTurn,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        ) {
            Text(
                text = if (state.isLastTurn) "🎉 完成，再来一次" else "下一轮 →",
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/** 跟读模式：AI 直接给回答 + 逐词跟读阶梯 */
@Composable
private fun EchoSection(state: EnglishTalkUiState, viewModel: EnglishTalkViewModel) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            "💬 该这样回答（AI 直接给，你跟着读）",
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            color = Black,
            modifier = Modifier.weight(1f),
        )
        SmallButton("🎤 我想自己说", enabled = !state.rolling, onClick = viewModel::switchToFree)
    }

    val targetEn = englishOnly(state.targetText)
    if (targetEn.isNotBlank()) {
        Box(Modifier.padding(top = 6.dp)) {
            EnglishWordTapText(
                text = targetEn,
                onWordTap = viewModel::speakWord,
                speakingWord = state.speakingWord,
                fontSize = 20.sp,
            )
        }
    }
    if (state.answerZh.isNotBlank()) {
        Text(state.answerZh, fontSize = 14.sp, color = Grey, modifier = Modifier.padding(top = 6.dp))
    }

    Text(
        "跟着 AI 一句一句读：第 1 遍只读第 1 个单词，第 2 遍读前 2 个单词，第 3 遍读前 3 个……" +
            "一直读到整句读完。每遍读准（≥70 分）就自动进下一遍。",
        fontSize = 13.sp,
        color = Grey,
        modifier = Modifier.padding(top = 8.dp),
    )

    val ladder = state.ladder
    when {
        ladder != null && ladder.done -> {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = OkBg,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) {
                Text(
                    "✅ 整句跟读完成！点下方进入下一轮",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = OkColor,
                    modifier = Modifier.padding(10.dp),
                )
            }
        }
        ladder != null -> EchoLadder(
            modifier = Modifier.padding(top = 8.dp),
            view = ladder,
            reading = state.rolling,
            recording = state.recording,
            evaluating = state.evaluating,
            score = state.ladderScore,
            failCount = state.ladderFailCount,
            error = state.ladderError,
            onReadAgain = viewModel::readLadderAgain,
            onToggleRecord = viewModel::toggleLadderRecord,
            onSkip = viewModel::skipLadder,
        )
        else -> Text(
            "🔊 AI 正在领读整句回答，请先听…",
            fontSize = 13.sp,
            color = Blue,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}

/** 自己回答模式：流式 ASR（逐词实时上屏 + 停顿逐词提示 + 6s 静默挂阶梯）→ 判定 */
@Composable
private fun FreeSection(state: EnglishTalkUiState, viewModel: EnglishTalkViewModel) {
    Text(
        "听清 AI 的问题后，点「🎤 开始录音」说出你的回答。说完了点红色「⏹ 结束」，AI 来评分。",
        fontSize = 13.sp,
        color = Grey,
    )
    Row(Modifier.padding(top = 8.dp)) {
        SmallButton(
            "🧗 回到跟读模式",
            enabled = state.phase == TalkPhase.IDLE || state.phase == TalkPhase.RECORDING,
            onClick = viewModel::switchToEcho,
        )
    }

    // 实时文本区：已说文本（FIN_TEXT 定稿累积）+ 临时文本（MID_TEXT，未定稿）
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = HintBg,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    ) {
        Row(Modifier.padding(10.dp)) {
            if (state.saidText.isBlank() && state.interimText.isBlank() && state.phase != TalkPhase.RECORDING) {
                Text("（还没说）", fontSize = 16.sp, color = Grey)
            } else {
                Text(state.saidText, fontSize = 16.sp, color = Black)
                if (state.interimText.isNotBlank()) {
                    Text(
                        state.interimText,
                        fontSize = 15.sp,
                        color = Grey,
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
        }
    }

    when (state.phase) {
        TalkPhase.RECORDING -> StatusText("● 录音中… 说完了点下方红色结束", OkColor)
        TalkPhase.HINTING -> StatusText("🔊 提示中，请听提示词…", Blue)
        TalkPhase.READING -> StatusText("🔊 朗读中… 录音已暂停", Blue)
        TalkPhase.JUDGING -> StatusText("🤔 AI 在听你回答…", Blue)
        TalkPhase.IDLE -> Unit
    }

    if (state.phase == TalkPhase.RECORDING) {
        // 电平条（web speech-level：宽度 4%~100%）
        val pct = (state.asrLevel.coerceIn(0f, 1f) * 100).coerceAtLeast(4f)
        Surface(
            shape = RoundedCornerShape(4.dp),
            color = HintBg,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp).height(6.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(4.dp),
                color = OkColor,
                modifier = Modifier.fillMaxWidth(pct / 100f).height(6.dp),
            ) {}
        }
    }

    if (state.errText.isNotBlank()) {
        Text(state.errText, fontSize = 13.sp, color = ErrorColor, modifier = Modifier.padding(top = 6.dp))
    }
    if (state.asrError.isNotBlank()) {
        Text(state.asrError, fontSize = 13.sp, color = ErrorColor, modifier = Modifier.padding(top = 6.dp))
    }

    Spacer(Modifier.height(10.dp))
    val recordLabel: String
    val recordEnabled: Boolean
    val recordColor: Color
    when {
        state.phase == TalkPhase.RECORDING -> {
            recordLabel = "⏹ 结束"; recordEnabled = true; recordColor = ErrorColor
        }
        state.phase == TalkPhase.HINTING -> {
            recordLabel = "🔊 提示中…"; recordEnabled = false; recordColor = DisabledBg
        }
        state.phase == TalkPhase.READING -> {
            recordLabel = "🔊 朗读中…"; recordEnabled = false; recordColor = DisabledBg
        }
        state.phase == TalkPhase.JUDGING -> {
            recordLabel = "🤔 判定中…"; recordEnabled = false; recordColor = DisabledBg
        }
        state.canStartRecording -> {
            recordLabel = "🎤 开始录音"; recordEnabled = true; recordColor = OkColor
        }
        else -> {
            recordLabel = "🎤 开始录音"; recordEnabled = false; recordColor = DisabledBg
        }
    }
    Button(
        onClick = {
            if (state.phase == TalkPhase.RECORDING) viewModel.stopRecording() else viewModel.startRecording()
        },
        enabled = recordEnabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = recordColor,
            contentColor = Color.White,
            disabledContainerColor = DisabledBg,
            disabledContentColor = Grey,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(recordLabel, fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }

    // ── 判定反馈 ──
    val fb = state.feedback
    if (fb != null) {
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = if (fb.ok) OkBg else NoBg,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        ) {
            Column(Modifier.padding(10.dp)) {
                if (fb.said.isNotBlank()) {
                    val dot = if (Regex("[.!?]$").containsMatchIn(fb.said.trim())) "" else "."
                    Text("你说：${fb.said}$dot", fontSize = 14.sp, color = Black)
                }
                Text(
                    text = if (fb.ok) "✅ ${fb.praise}" else fb.praise,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (fb.ok) OkColor else Black,
                    modifier = Modifier.padding(top = 4.dp),
                )
                if (!fb.ok && fb.correct.isNotBlank()) {
                    Text(
                        "正确说法：",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Black,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Row {
                        SmallButton("🔊 再读", enabled = state.phase == TalkPhase.IDLE, onClick = viewModel::reReadCorrect)
                    }
                    EnglishWordTapText(
                        text = fb.correct,
                        onWordTap = viewModel::speakWord,
                        speakingWord = state.speakingWord,
                        fontSize = 18.sp,
                    )
                    if (state.correctZh.isNotBlank()) {
                        Text(state.correctZh, fontSize = 14.sp, color = Grey, modifier = Modifier.padding(top = 4.dp))
                    }
                    // 错句修复：意群阶梯（片段 → 扩长 → 整句）
                    if (state.fixLadderOpen && state.ladder != null) {
                        EchoLadder(
                            modifier = Modifier.padding(top = 8.dp),
                            view = state.ladder,
                            reading = state.rolling,
                            recording = state.recording,
                            evaluating = state.evaluating,
                            score = state.ladderScore,
                            failCount = state.ladderFailCount,
                            error = state.ladderError,
                            onReadAgain = viewModel::readLadderAgain,
                            onToggleRecord = viewModel::toggleLadderRecord,
                            onSkip = viewModel::skipLadder,
                        )
                    } else if (!state.fixLadderOpen) {
                        Button(
                            onClick = viewModel::openFixLadder,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SecondaryBg,
                                contentColor = Black,
                            ),
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        ) { Text("🧗 跟读练习（从片段到整句）", fontSize = 14.sp) }
                    }
                }
            }
        }
    }

    // ── 6s 无话引导：整句单词阶梯测评（自由模式；跟读模式的阶梯在上面回答区里） ──
    if (state.guidedLadderOpen && state.ladder != null) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = Color.White,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp)
                .border(1.dp, CardBorder, RoundedCornerShape(12.dp)),
        ) {
            Column(Modifier.padding(14.dp)) {
                if (state.ladder.done) {
                    Text(
                        "✅ 整句过关！点下方进入下一轮",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = OkColor,
                    )
                } else {
                    EchoLadder(
                        view = state.ladder,
                        reading = state.rolling,
                        recording = state.recording,
                        evaluating = state.evaluating,
                        score = state.ladderScore,
                        failCount = state.ladderFailCount,
                        error = state.ladderError,
                        onReadAgain = viewModel::readLadderAgain,
                        onToggleRecord = viewModel::toggleLadderRecord,
                        onSkip = viewModel::skipLadder,
                    )
                }
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════
// 小组件
// ══════════════════════════════════════════════════════════════

/** 「💡 提示记录」面板（逐行保留，每行可重听；web talk-hints） */
@Composable
private fun HintRowsPanel(state: EnglishTalkUiState, viewModel: EnglishTalkViewModel) {
    if (state.hintRows.isEmpty()) return
    Card {
        Text(
            "💡 提示记录",
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            color = Black,
        )
        for ((i, h) in state.hintRows.withIndex()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            ) {
                Text(
                    "${i + 1}",
                    fontSize = 13.sp,
                    color = Grey,
                    modifier = Modifier.width(20.dp),
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        if (h.full) "（整句）${h.text}" else h.text,
                        fontSize = 14.sp,
                        color = Black,
                    )
                    if (h.zh.isNotBlank()) {
                        Text(h.zh, fontSize = 12.sp, color = Grey)
                    }
                }
                SmallButton("🔊", enabled = true, onClick = { viewModel.playTts(h.text) })
            }
        }
    }
}

@Composable
private fun Card(bg: Color = Color.White, content: @Composable () -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = bg,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .border(1.dp, CardBorder, RoundedCornerShape(12.dp)),
    ) {
        Column(Modifier.padding(14.dp)) { content() }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(
        text,
        fontSize = 14.sp,
        fontWeight = FontWeight.Bold,
        color = Black,
        modifier = Modifier.padding(top = 10.dp),
    )
}

/** 小号次要按钮（web `btn-secondary btn-sm`） */
@Composable
private fun SmallButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = SecondaryBg,
            contentColor = Black,
            disabledContainerColor = DisabledBg,
            disabledContentColor = Grey,
        ),
    ) { Text(label, fontSize = 13.sp, textAlign = TextAlign.Center) }
}

@Composable
private fun StatusText(text: String, color: Color) {
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = color, modifier = Modifier.padding(top = 6.dp))
}

// ── 配色（语义色：绿=过关/进行 / 红=重试/错误 / 蓝=提示；文字纯黑）──
private val Black = Color(0xFF000000)
private val Grey = Color(0xFF536471)
private val OkColor = Color(0xFF2E7D32)
private val ErrorColor = Color(0xFFB71C1C)
private val Blue = Color(0xFF1565C0)
private val AiBubbleBg = Color(0xFFF7F9FB)
private val CardBorder = Color(0xFFE2E8F0)
private val SecondaryBg = Color(0xFFEFF6FF)
private val HintBg = Color(0xFFF1F5F9)
private val OkBg = Color(0xFFE8F5E9)
private val NoBg = Color(0xFFFFEBEE)
private val DisabledBg = Color(0xFFEDF2F7)
