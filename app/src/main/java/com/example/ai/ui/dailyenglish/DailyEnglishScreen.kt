package com.example.ai.ui.dailyenglish

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.example.ai.data.dailyen.EnSentencePair
import com.example.ai.data.model.PhonemeScore
import com.example.ai.data.model.WordScore
import com.example.ai.data.ocr.OcrPlatform
import com.example.ai.ui.ocr.OcrAlbumBg as AlbumBg
import com.example.ai.ui.ocr.OcrAlbumFg as AlbumFg
import com.example.ai.ui.ocr.OcrCameraBg as CameraBg
import com.example.ai.ui.ocr.OcrCameraFg as CameraFg
import com.example.ai.ui.ocr.OcrErrBg as ErrBg
import com.example.ai.ui.ocr.OcrErrRed as ErrRed
import com.example.ai.ui.ocr.OcrIconChip as IconChip
import com.example.ai.ui.ocr.OcrOkBg as OkBg
import com.example.ai.ui.ocr.OcrOkGreen as OkGreen
import com.example.ai.ui.ocr.OcrPickSheet
import com.example.ai.data.phonics.localTipText
import com.example.ai.ui.common.PhonicsText
import com.example.ai.ui.common.PhonicsTipSymColor
import com.example.ai.ui.common.PhonicsToggle
import com.example.ai.util.SoeDisplay
import java.io.File

// ── 语义色（项目约定：绿=好 / 红=差 / 蓝=进行中；正文一律纯黑） ──
private val Black = Color(0xFF000000)
private val HintGray = Color(0xFF6B7280)
private val GoodGreen = Color(0xFF2E7D32)
private val MidGold = Color(0xFFB8860B)
private val BadRed = Color(0xFFB71C1C)
private val MissGray = Color(0xFF9E9E9E)
private val PlayingBlue = Color(0xFF90CAF9)
private val ChipBg = Color(0xFFEFF6FF)
private val ChipText = Color(0xFF1E3A8A)
private val ImageBg = Color(0xFFF1F5F9)

/**
 * 每日一练·英语 —— 对齐 web `DailyEnglishPage`：
 * 单词卡（图 / 发音 / 评测 / 中文释义 / LLM 造 2 例句各带发音评测与翻译）
 * + 句子卡（图 / 发音 / 评测 / 中文翻译 / 常用中文场景）。
 *
 * ⚠️ 拼读着色 + 发音要领已移植（见 [DailyEnglishViewModel] KDoc）：单词/例句/句子用
 * `PhonicsText` 上色，顶栏 `PhonicsToggle` 控制全局开关；评测明细对 low/bad 类音素展示
 * 本地要领 + 🔈 朗读。设置面板的**拍照/相册 OCR 自动填入已移植**（单图，对齐 web 的 `pickFile`）。
 *
 * 评测结果按**被测文本**存在 `soeOutcomes` 里（单词卡查 `words[i]`，例句行查例句英文），
 * 与 web 每张卡/每行各自持有 `useSoeScore` 一份 state 的效果等价。
 */
@Composable
fun DailyEnglishScreen(
    viewModel: DailyEnglishViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val phonicsOn by viewModel.phonicsColor.collectAsStateWithLifecycle()

    // OCR 平台（相机临时文件 / 读 URI 字节）。页面内自建一份：只包了个 applicationContext，无状态。
    val ocrPlatform = remember(context) { OcrPlatform(context.applicationContext) }

    var pendingCameraFile by remember { mutableStateOf<File?>(null) }
    var pendingField by remember { mutableStateOf<DailyEnField?>(null) }

    // ⚠️ 两个 launcher 必须先声明：Kotlin 的局部函数不能前向引用后面才声明的局部变量
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = pendingCameraFile
        val field = pendingField
        pendingCameraFile = null
        pendingField = null
        if (!ok || file == null) {
            file?.delete()
            return@rememberLauncherForActivityResult
        }
        field?.let { viewModel.startOcr(it, listOf(Uri.fromFile(file))) }
    }

    // 相册：★ 与每日语文不同 —— web 这里是**不带 multiple** 的 input，
    // 所以用 GetContent（单图）而不是 GetMultipleContents。
    val albumLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val field = pendingField
        pendingField = null
        if (uri == null) return@rememberLauncherForActivityResult
        field?.let { viewModel.startOcr(it, listOf(uri)) }
    }

    fun startCamera(field: DailyEnField) {
        pendingField = field
        pendingCameraFile?.delete()
        val file = ocrPlatform.newCameraFile()
        pendingCameraFile = file
        runCatching { ocrPlatform.cameraUri(file) }.onSuccess { cameraLauncher.launch(it) }
    }

    // 面板关闭后清理相机临时文件
    LaunchedEffect(state.ocr.open) {
        if (!state.ocr.open) {
            pendingCameraFile?.delete()
            pendingCameraFile = null
        }
    }

    // 框选面板：整屏替代（与项目既有设置面板一致，避免弹层层级问题）
    if (state.ocr.open) {
        OcrPickSheet(
            state = state.ocr,
            session = viewModel.ocr,
            modifier = modifier.fillMaxSize(),
        )
        return
    }

    Column(modifier = modifier.fillMaxSize().padding(20.dp)) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("🏆 每日英语", style = MaterialTheme.typography.titleLarge, color = Black)
            Spacer(Modifier.weight(1f))
            PhonicsToggle(phonicsOn, viewModel::togglePhonicsColor)
            Spacer(Modifier.width(8.dp))
            Text(
                "⚙️",
                fontSize = 22.sp,
                color = Black,
                modifier = Modifier.clickable { viewModel.openSettings() }.padding(4.dp),
            )
        }
        Spacer(Modifier.height(4.dp))

        if (state.settingsOpen) {
            SettingsPanel(
                state = state,
                viewModel = viewModel,
                onPickCamera = { f -> startCamera(f) },
                onPickAlbum = { f ->
                    pendingField = f
                    albumLauncher.launch("image/*")
                },
            )
            return@Column
        }

        Text(state.todaySummary, fontSize = 13.sp, color = Black)
        if (state.prefillHint) {
            Spacer(Modifier.height(4.dp))
            Text(
                "已带入最近一次内容，修改后点「保存」即生效为今日配置（跨设备同步）",
                fontSize = 13.sp,
                color = MidGold,
            )
        }
        if (state.loading) {
            Spacer(Modifier.height(4.dp))
            Text("正在同步今日配置…", fontSize = 13.sp, color = HintGray)
        }
        Spacer(Modifier.height(12.dp))

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            items(state.words, key = { "w:$it" }) { word ->
                WordCard(
                    word = word,
                    cardState = state.wordCards[word],
                    phonicsOn = phonicsOn,
                    speakingText = state.speakingText,
                    recordingText = state.soeRecordingText,
                    evaluatingText = state.soeEvaluatingText,
                    outcomes = state.soeOutcomes,
                    errors = state.soeErrors,
                    viewModel = viewModel,
                    speakingTip = state.speakingTip,
                    onSpeak = viewModel::speak,
                    onStartSoe = viewModel::startSoe,
                    onStopSoe = viewModel::stopSoe,
                )
            }
            items(state.sentences, key = { "s:$it" }) { sentence ->
                SentenceCard(
                    sentence = sentence,
                    cardState = state.sentenceCards[sentence],
                    phonicsOn = phonicsOn,
                    speakingText = state.speakingText,
                    recordingText = state.soeRecordingText,
                    evaluatingText = state.soeEvaluatingText,
                    outcome = state.soeOutcomes[sentence],
                    error = state.soeErrors[sentence],
                    viewModel = viewModel,
                    speakingTip = state.speakingTip,
                    onSpeak = viewModel::speak,
                    onStartSoe = { viewModel.startSoe(it, sentenceMode = true) },
                    onStopSoe = viewModel::stopSoe,
                )
            }
        }
    }
}

// ── 单词卡 ──

@Composable
private fun WordCard(
    word: String,
    cardState: WordCardState?,
    phonicsOn: Boolean,
    speakingText: String?,
    recordingText: String?,
    evaluatingText: String?,
    outcomes: Map<String, SoeOutcome>,
    errors: Map<String, String>,
    viewModel: DailyEnglishViewModel,
    speakingTip: String?,
    onSpeak: (String) -> Unit,
    onStartSoe: (String, Boolean) -> Unit,
    onStopSoe: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CardImage(url = cardState?.imageUrl, size = 76.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    PhonicsText(
                        word,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = Black,
                        enabled = phonicsOn,
                    )
                    val translation = cardState?.translation.orEmpty()
                    if (translation.isNotBlank()) {
                        Text(translation, fontSize = 14.sp, color = Black)
                    }
                    val meaning = cardState?.meaning.orEmpty()
                    if (meaning.isNotBlank()) {
                        Text(meaning, fontSize = 12.sp, color = HintGray)
                    }
                }
            }

            SpeakButton(text = word, speakingText = speakingText, onSpeak = onSpeak)

            // 单词本体（word 粒度）
            SoePanel(
                text = word,
                recordingText = recordingText,
                evaluatingText = evaluatingText,
                outcome = outcomes[word],
                error = errors[word],
                sentenceMode = false,
                viewModel = viewModel,
                speakingTip = speakingTip,
                onStartSoe = onStartSoe,
                onStopSoe = onStopSoe,
            )

            if (cardState?.loading == true) {
                Spacer(Modifier.height(8.dp))
                Text("正在生成例句…", fontSize = 12.sp, color = HintGray)
            }

            for (example in cardState?.examples.orEmpty()) {
                ExampleLine(
                    example = example,
                    phonicsOn = phonicsOn,
                    speakingText = speakingText,
                    recordingText = recordingText,
                    evaluatingText = evaluatingText,
                    // 例句是独立的被测文本 → 用它自己的 key 取结果（不是单词的）
                    outcome = outcomes[example.en],
                    error = errors[example.en],
                    viewModel = viewModel,
                    speakingTip = speakingTip,
                    onSpeak = onSpeak,
                    onStartSoe = onStartSoe,
                    onStopSoe = onStopSoe,
                )
            }
        }
    }
}

/** 例句行（web `EnSentenceLine`）：英文 + 🔊 + 中文翻译 + 自己的评测（句子粒度，可展开音素） */
@Composable
private fun ExampleLine(
    example: EnSentencePair,
    phonicsOn: Boolean,
    speakingText: String?,
    recordingText: String?,
    evaluatingText: String?,
    outcome: SoeOutcome?,
    error: String?,
    viewModel: DailyEnglishViewModel,
    speakingTip: String?,
    onSpeak: (String) -> Unit,
    onStartSoe: (String, Boolean) -> Unit,
    onStopSoe: () -> Unit,
) {
    Spacer(Modifier.height(10.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        PhonicsText(
            example.en,
            fontSize = 15.sp,
            color = Black,
            enabled = phonicsOn,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        SmallSpeakButton(text = example.en, speakingText = speakingText, onSpeak = onSpeak)
    }
    if (example.zh.isNotBlank()) {
        Text(example.zh, fontSize = 12.sp, color = HintGray)
    }
    SoePanel(
        text = example.en,
        recordingText = recordingText,
        evaluatingText = evaluatingText,
        outcome = outcome,
        error = error,
        sentenceMode = true,
        viewModel = viewModel,
        speakingTip = speakingTip,
        onStartSoe = onStartSoe,
        onStopSoe = onStopSoe,
    )
}

// ── 句子卡 ──

@Composable
private fun SentenceCard(
    sentence: String,
    cardState: SentenceCardState?,
    phonicsOn: Boolean,
    speakingText: String?,
    recordingText: String?,
    evaluatingText: String?,
    outcome: SoeOutcome?,
    error: String?,
    viewModel: DailyEnglishViewModel,
    speakingTip: String?,
    onSpeak: (String) -> Unit,
    onStartSoe: (String) -> Unit,
    onStopSoe: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CardImage(url = cardState?.imageUrl, size = 76.dp)
                Spacer(Modifier.width(12.dp))
                PhonicsText(
                    sentence,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = Black,
                    enabled = phonicsOn,
                    modifier = Modifier.weight(1f),
                )
            }

            SpeakButton(text = sentence, speakingText = speakingText, onSpeak = onSpeak)

            SoePanel(
                text = sentence,
                recordingText = recordingText,
                evaluatingText = evaluatingText,
                outcome = outcome,
                error = error,
                sentenceMode = true,
                viewModel = viewModel,
                speakingTip = speakingTip,
                onStartSoe = { t, _ -> onStartSoe(t) },
                onStopSoe = onStopSoe,
            )

            if (cardState?.loading == true) {
                Spacer(Modifier.height(8.dp))
                Text("正在生成翻译/场景…", fontSize = 12.sp, color = HintGray)
            }
            val translation = cardState?.translation.orEmpty()
            if (translation.isNotBlank()) {
                Text("翻译：$translation", fontSize = 13.sp, color = Black)
            }
            val scene = cardState?.scene.orEmpty()
            if (scene.isNotBlank()) {
                Text("常用场景：$scene", fontSize = 13.sp, color = HintGray)
            }
        }
    }
}

// ── 公共小块 ──

/** 词/句图片（web `daily-en-img`）：没有就显示 🖼️ 占位（与 web 一致，不塌陷布局） */
@Composable
private fun CardImage(url: String?, size: Dp) {
    val shape = RoundedCornerShape(10.dp)
    if (url.isNullOrBlank()) {
        Box(
            modifier = Modifier.size(size).clip(shape).background(ImageBg),
            contentAlignment = Alignment.Center,
        ) { Text("🖼️", fontSize = 22.sp) }
    } else {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(size).clip(shape).background(ImageBg),
        )
    }
}

@Composable
private fun SpeakButton(text: String, speakingText: String?, onSpeak: (String) -> Unit) {
    Spacer(Modifier.height(8.dp))
    Button(
        onClick = { onSpeak(text) },
        enabled = speakingText == null,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (speakingText == text) PlayingBlue else MaterialTheme.colorScheme.primary,
            contentColor = if (speakingText == text) Black else Color.White,
        ),
    ) { Text("🔊 发音", fontSize = 14.sp) }
}

@Composable
private fun SmallSpeakButton(text: String, speakingText: String?, onSpeak: (String) -> Unit) {
    Text(
        "🔊",
        fontSize = 16.sp,
        color = if (speakingText == text) PlayingBlue else Black,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .clickable(enabled = speakingText == null) { onSpeak(text) }
            .padding(4.dp),
    )
}

/**
 * 发音评测区（web `SoeButton` + `SoeDetail`）。
 *
 * [sentenceMode] 决定腾讯 `eval_mode`（单词 "0" / 句子 "1"），与 web 传的
 * `scene="word"/"sentence"` 完全等价（服务端 `resolveEvalMode()` 的映射逐位相同）。
 */
@Composable
private fun SoePanel(
    text: String,
    recordingText: String?,
    evaluatingText: String?,
    outcome: SoeOutcome?,
    error: String?,
    sentenceMode: Boolean,
    viewModel: DailyEnglishViewModel,
    speakingTip: String?,
    onStartSoe: (String, Boolean) -> Unit,
    onStopSoe: () -> Unit,
) {
    val recording = recordingText == text
    val evaluating = evaluatingText == text
    val busy = recordingText != null || evaluatingText != null

    Spacer(Modifier.height(8.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Button(
            onClick = { if (recording) onStopSoe() else onStartSoe(text, sentenceMode) },
            enabled = !evaluating && (recording || !busy),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (recording) Color(0xFFFEE2E2) else Color(0xFFECEFF1),
                contentColor = if (recording) BadRed else Black,
            ),
        ) {
            Text(
                when {
                    recording -> "⏹ 停止并评分"
                    evaluating -> "评分中…"
                    else -> "🎤 评测发音"
                },
                fontSize = 13.sp,
            )
        }
        if (outcome != null) {
            Spacer(Modifier.width(10.dp))
            Text(
                "得分 ${outcome.score}",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = scoreColor(outcome.score.toFloat(), 0),
            )
        }
        if (!error.isNullOrBlank()) {
            Spacer(Modifier.width(10.dp))
            Text(error, fontSize = 12.sp, color = BadRed)
        }
    }

    if (outcome != null) {
        SoeDetailView(
            outcome = outcome,
            sentenceMode = sentenceMode,
            viewModel = viewModel,
            speakingTip = speakingTip,
        )
    }
}

/**
 * 评测明细（web `SoeDetail` 的等价物）：
 * - 单词模式（只有 1 个词）→ 逐**音素**得分 + 「词：x · 单词分 N」
 * - 句子模式（多词）→ 逐**词**得分；点词展开该词音素
 *
 * 与 web 一致：拿不到明细就什么都不渲染（不糊一个空框）。
 */
@Composable
private fun SoeDetailView(
    outcome: SoeOutcome,
    sentenceMode: Boolean,
    viewModel: DailyEnglishViewModel,
    speakingTip: String?,
) {
    val words = outcome.wordScores
    if (words.isEmpty()) return

    // ── 单词模式：逐音素 ──
    if (words.size == 1) {
        val w = words[0]
        val phones = w.phoneInfos
        if (phones.isEmpty()) {
            // 引擎本来就给不出音素、且没漏读 → 不渲染（web 同）
            if (SoeDisplay.formatScore(w.pronAccuracy, w.matchTag) != "未读") return
            DetailTitle("音素得分")
            Text("未检测到发音，请靠近麦克风再读一次", fontSize = 12.sp, color = HintGray)
            return
        }
        DetailTitle("音素得分")
        PhoneChips(phones, viewModel = viewModel, speakingTip = speakingTip)
        Text(
            "词：${w.word} · 单词分 ${SoeDisplay.formatScore(w.pronAccuracy, w.matchTag)}",
            fontSize = 12.sp,
            color = HintGray,
        )
        if (phones.all { SoeDisplay.isMissing(it.rawAccuracy, it.matchTag) }) {
            Text("没听到发音，靠近麦克风再读一次试试", fontSize = 12.sp, color = HintGray)
        }
        return
    }

    // ── 句子模式：逐词；点词展开该词音素 ──
    var openIdx by remember { mutableStateOf<Int?>(null) }
    DetailTitle(if (sentenceMode) "单词得分　点单词看音素" else "单词得分")
    for ((i, w) in words.withIndex()) {
        val canOpen = w.phoneInfos.isNotEmpty()
        val open = openIdx == i
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .then(if (canOpen) Modifier.clickable { openIdx = if (open) null else i } else Modifier)
                .padding(vertical = 3.dp),
        ) {
            Text(w.word, fontSize = 14.sp, color = Black, modifier = Modifier.weight(1f))
            Text(
                SoeDisplay.formatScore(w.pronAccuracy, w.matchTag),
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = scoreColor(w.pronAccuracy, w.matchTag),
            )
            if (canOpen) {
                Text(if (open) "  ▴" else "  ▾", fontSize = 12.sp, color = HintGray)
            }
        }
        if (open) PhoneChips(w.phoneInfos, viewModel = viewModel, speakingTip = speakingTip)
    }
}

@Composable
private fun DetailTitle(text: String) {
    Spacer(Modifier.height(6.dp))
    Text(text, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Black)
}

/**
 * 音素胶囊列表（web `PhoneChips` 的等价物）：符号 + 分数，漏读标红；
 * 下方对 **bad 类（低分但非漏读）** 音素展示本地发音要领（[localTipText]）+ 🔈 朗读，
 * 与 web `SoeDetail` 一致（miss 类不提示，避免「没读到」还凑字面要领）。
 */
@Composable
private fun PhoneChips(
    phones: List<PhonemeScore>,
    viewModel: DailyEnglishViewModel,
    speakingTip: String?,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            for (p in phones) {
                val miss = SoeDisplay.isMissing(p.rawAccuracy, p.matchTag)
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .padding(end = 8.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (miss) Color(0xFFFBE9E7) else ChipBg)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(p.phoneme, fontSize = 14.sp, color = if (miss) BadRed else ChipText)
                    Text(
                        SoeDisplay.formatScore(p.rawAccuracy, p.matchTag),
                        fontSize = 11.sp,
                        color = scoreColor(p.rawAccuracy, p.matchTag),
                    )
                }
            }
        }
        // 低分音素的本地发音要领（只对 bad 类，miss 不提示）
        for (p in phones) {
            val tip = localTipText(p.phoneme) ?: continue
            if (SoeDisplay.scoreClass(p.rawAccuracy, p.matchTag) != SoeDisplay.ScoreClass.BAD) continue
            PhonemeTipRow(
                phone = p.phoneme,
                tip = tip,
                speaking = speakingTip == tip,
                onSpeak = { viewModel.speakPhonemeTip(tip, p.phoneme) },
            )
        }
    }
}

/** 单条发音要领：音素符号小标签 + 中文要领 + 🔈 朗读（朗读中切 🔊） */
@Composable
private fun PhonemeTipRow(phone: String, tip: String, speaking: Boolean, onSpeak: () -> Unit) {
    Spacer(Modifier.height(4.dp))
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFFFF7ED))
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Text(
            phone,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = PhonicsTipSymColor,
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(Color(0xFFFFE8CC))
                .padding(horizontal = 6.dp, vertical = 2.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(tip, fontSize = 12.sp, color = Black, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(4.dp))
        Text(
            if (speaking) "🔊" else "🔈",
            fontSize = 14.sp,
            color = if (speaking) PlayingBlue else Black,
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .clickable { onSpeak() }
                .padding(4.dp),
        )
    }
}

private fun scoreColor(accuracy: Float, matchTag: Int): Color =
    when (SoeDisplay.scoreClass(accuracy, matchTag)) {
        SoeDisplay.ScoreClass.GOOD -> GoodGreen
        SoeDisplay.ScoreClass.OK -> MidGold
        SoeDisplay.ScoreClass.BAD -> BadRed
        SoeDisplay.ScoreClass.MISS -> MissGray
    }

// ── ⚙️ 设置面板（web settings-sheet 的等价物：整屏替代，避免弹层层级问题） ──

@Composable
private fun SettingsPanel(
    state: DailyEnglishUiState,
    viewModel: DailyEnglishViewModel,
    onPickCamera: (DailyEnField) -> Unit,
    onPickAlbum: (DailyEnField) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("⚙️ 今日英语内容", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Black)
            Spacer(Modifier.weight(1f))
            Text(
                "✕",
                fontSize = 18.sp,
                color = Black,
                modifier = Modifier.clickable { viewModel.closeSettings() }.padding(4.dp),
            )
        }
        Spacer(Modifier.height(8.dp))

        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
        ) {
            // OCR 导入结果横幅（web `ocrMsg`；❌ 红底绿底按前缀区分）
            if (state.ocrMsg.isNotBlank()) {
                val isErr = state.ocrMsg.startsWith("❌")
                Text(
                    state.ocrMsg,
                    fontSize = 12.sp,
                    color = if (isErr) ErrRed else OkGreen,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (isErr) ErrBg else OkBg)
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                )
            }

            DraftField(
                label = "🔤 今天练的单词",
                hint = "用逗号/空格分隔，如：apple, cat, dog, red",
                value = state.draft.words,
                onChange = { viewModel.onDraftChange(DailyEnField.WORDS, it) },
                onCamera = { onPickCamera(DailyEnField.WORDS) },
                onAlbum = { onPickAlbum(DailyEnField.WORDS) },
            )
            DraftField(
                label = "✏️ 今天练的句子",
                hint = "用分号/换行分隔，如：I like apples.; She is a student.",
                value = state.draft.sentences,
                onChange = { viewModel.onDraftChange(DailyEnField.SENTENCES, it) },
                onCamera = { onPickCamera(DailyEnField.SENTENCES) },
                onAlbum = { onPickAlbum(DailyEnField.SENTENCES) },
            )
            Text(
                "💡 支持拍照/相册识别自动填入（一次一张，识别结果直接替换该字段）；" +
                    "单词与句子都会自动联网生成中文释义/翻译与例句。",
                fontSize = 12.sp,
                color = HintGray,
            )
            Spacer(Modifier.height(4.dp))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = { viewModel.closeSettings() },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFECEFF1), contentColor = Black),
                modifier = Modifier.weight(1f),
            ) { Text("取消", fontSize = 15.sp) }
            Button(
                onClick = { viewModel.save() },
                enabled = !state.saving,
                modifier = Modifier.weight(1f),
            ) { Text(if (state.saving) "保存中…" else "保存", fontSize = 15.sp) }
        }
    }
}

@Composable
private fun DraftField(
    label: String,
    hint: String,
    value: String,
    onChange: (String) -> Unit,
    onCamera: (() -> Unit)? = null,
    onAlbum: (() -> Unit)? = null,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Black, modifier = Modifier.weight(1f))
            if (onCamera != null) {
                IconChip(text = "📷", bg = CameraBg, fg = CameraFg, enabled = true, onClick = onCamera)
                Spacer(Modifier.width(4.dp))
            }
            if (onAlbum != null) {
                IconChip(text = "🖼️", bg = AlbumBg, fg = AlbumFg, enabled = true, onClick = onAlbum)
            }
        }
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(hint, fontSize = 13.sp, color = HintGray) },
            minLines = 2,
            maxLines = 5,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
