package com.example.ai.ui.dailychinese

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.ocr.OcrPlatform
import com.example.ai.ui.ocr.OcrAlbumBg as AlbumBg
import com.example.ai.ui.ocr.OcrAlbumFg as AlbumFg
import com.example.ai.ui.ocr.OcrCameraBg as CameraBg
import com.example.ai.ui.ocr.OcrCameraFg as CameraFg
import com.example.ai.ui.ocr.OcrDisabledBg as DisabledBg
import com.example.ai.ui.ocr.OcrErrBg as ErrBg
import com.example.ai.ui.ocr.OcrErrRed as ErrRed
import com.example.ai.ui.ocr.OcrIconChip as IconChip
import com.example.ai.ui.ocr.OcrInfoBg as InfoBg
import com.example.ai.ui.ocr.OcrInfoBlue as InfoBlue
import com.example.ai.ui.ocr.OcrOkBg as OkBg
import com.example.ai.ui.ocr.OcrOkGreen as OkGreen
import com.example.ai.ui.ocr.OcrPickSheet
import com.example.ai.ui.ocr.OcrSmallButton as SmallButton
import java.io.File

private val Black = Color(0xFF000000)
private val HintGray = Color(0xFF6B7280)
private val PrefillGold = Color(0xFFB8860B)
// ⚠️ 其余语义色与 📷/🖼️ 小控件已抽到 `ui/ocr/OcrImportButtons.kt`（三处设置面板共用），
//    这里用 `import ... as ...` 别名接回来，调用点无需改动。

/**
 * 每日语文 —— 对齐 web `DailyChinesePage`：
 * 4 个固定练习入口（练字/练词/练句/主题作文）+ ⚙️ 设置今日字词句作文主题（跨设备同步）。
 *
 * ✅ **设置面板已支持拍照/相册 OCR 自动填入**（对齐 web：每个字段一组 📷 / 🖼️ 按钮，
 * 多张图片排队逐张框选、按顺序合并；导入后直接落盘并尝试同步）。
 * 框选面板是 [OcrPickSheet]（web `OcrPickSheet` 的等价物），面板打开时整屏替代设置面板。
 *
 * ⚠️ 与 web 的差异（有意为之）：
 * - web 的 4 个入口指向 `/module/recognition`、`/module/word_practice`、`/module/sentence_practice`、
 *   `/module/oral_writing`；Android 对应 `Recognition`、`WordPractice`、`SentenceCompose`、`OralWriting`。
 * - 多图合并时 web 的 `joinOcrTexts` 用了双反斜杠（`/\\s+/`、`join("\\n")`）⇒ 多图导入词/句会插入
 *   **字面 `\n`**；Android 按意图实现（真实 JS 空白集切分 + 真换行）。详见 `OcrBoxLogic.joinOcrTexts`。
 */
@Composable
fun DailyChineseScreen(
    viewModel: DailyChineseViewModel,
    onBack: () -> Unit,
    onOpenRecognition: () -> Unit = {},
    onOpenWordPractice: () -> Unit = {},
    onOpenSentenceCompose: () -> Unit = {},
    onOpenOralWriting: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // OCR 平台（相机临时文件 / 读 URI 字节）。页面内自建一份：只包了个 applicationContext，无状态。
    val ocrPlatform = remember(context) { OcrPlatform(context.applicationContext) }

    // 拍照：先建 FileProvider 临时文件，回调里再交给 ViewModel
    var pendingCameraFile by remember { mutableStateOf<File?>(null) }
    var pendingField by remember { mutableStateOf<DailyZhField?>(null) }
    var pendingAppend by remember { mutableStateOf(false) }

    // ⚠️ 两个 launcher 必须先声明：Kotlin 的局部函数不能前向引用后面才声明的局部变量，
    //    而 startCamera 里要用 cameraLauncher。
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = pendingCameraFile
        val field = pendingField
        val append = pendingAppend
        pendingCameraFile = null
        pendingField = null
        pendingAppend = false
        if (!ok || file == null) {
            file?.delete()
            return@rememberLauncherForActivityResult
        }
        val uri = Uri.fromFile(file)
        if (append) viewModel.continueOcr(listOf(uri)) else field?.let { viewModel.startOcr(it, listOf(uri)) }
    }

    // 相册：web 是 multiple（可多选），逐张框选后按顺序合并
    val albumLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        val field = pendingField
        val append = pendingAppend
        pendingField = null
        pendingAppend = false
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        if (append) viewModel.continueOcr(uris) else field?.let { viewModel.startOcr(it, uris) }
    }

    fun startCamera(field: DailyZhField?, append: Boolean) {
        pendingField = field
        pendingAppend = append
        // 上一张临时照片用不到了就删掉（缓存目录里别堆积）
        pendingCameraFile?.delete()
        val file = ocrPlatform.newCameraFile()
        pendingCameraFile = file
        runCatching { ocrPlatform.cameraUri(file) }.onSuccess { uri ->
            cameraLauncher.launch(uri)
        }
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
            Text("🏆 每日语文", style = MaterialTheme.typography.titleLarge, color = Black)
            Spacer(Modifier.weight(1f))
            Text(
                "⚙️",
                fontSize = 22.sp,
                color = Black,
                modifier = Modifier
                    .clickable { viewModel.openSettings() }
                    .padding(4.dp),
            )
        }
        Spacer(Modifier.height(4.dp))

        if (state.settingsOpen) {
            SettingsPanel(
                state = state,
                viewModel = viewModel,
                onPickCamera = { f -> startCamera(f, append = false) },
                onPickAlbum = { f ->
                    pendingField = f
                    pendingAppend = false
                    albumLauncher.launch("image/*")
                },
                onContinueCamera = { startCamera(null, append = true) },
                onContinueAlbum = {
                    pendingField = null
                    pendingAppend = true
                    albumLauncher.launch("image/*")
                },
            )
            return@Column
        }

        // 今日摘要（与 web todaySummary 同文案）
        Text(state.todaySummary, fontSize = 13.sp, color = Black)
        if (state.prefillHint) {
            Spacer(Modifier.height(4.dp))
            Text(
                "已带入最近一次内容，修改后点「保存」即生效为今日配置（跨设备同步）",
                fontSize = 13.sp,
                color = PrefillGold,
            )
        }
        if (state.loading) {
            Spacer(Modifier.height(4.dp))
            Text("正在同步今日配置…", fontSize = 13.sp, color = HintGray)
        }
        Spacer(Modifier.height(12.dp))

        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.verticalScroll(rememberScrollState()),
        ) {
            EntryCard(
                emoji = "🔤",
                title = "练字",
                subtitle = "看图认汉字，跟读发音",
                badge = if (state.charsTotal > 0) "今日 ${state.charsTotal} 字" else "",
                onClick = onOpenRecognition,
            )
            EntryCard(
                emoji = "📚",
                title = "练词",
                subtitle = "词语跟读与辨析",
                badge = if (state.wordsTotal > 0) "今日 ${state.wordsTotal} 词" else "",
                onClick = onOpenWordPractice,
            )
            EntryCard(
                emoji = "✏️",
                title = "练句",
                subtitle = "给词造句，AI 老师批改",
                badge = if (state.sentencesTotal > 0) "今日 ${state.sentencesTotal} 条" else "",
                onClick = onOpenSentenceCompose,
            )
            EntryCard(
                emoji = "🖊️",
                title = "主题作文",
                subtitle = "按主题口述/写作，AI 评分润色",
                badge = state.cfg.essayTopic.trim().take(8),
                onClick = onOpenOralWriting,
            )
        }
    }
}

/** 一个练习入口卡（web `.english-mode-card` 的等价物） */
@Composable
private fun EntryCard(
    emoji: String,
    title: String,
    subtitle: String,
    badge: String,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(emoji, fontSize = 24.sp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (badge.isBlank()) title else "$title · $badge",
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = Black,
                )
                Text(subtitle, fontSize = 12.sp, color = HintGray)
            }
            Text("›", fontSize = 22.sp, color = Black)
        }
    }
}

/** ⚙️ 今日语文内容设置面板（web settings-sheet 的等价物：整屏替代，避免弹层层级问题） */
@Composable
private fun SettingsPanel(
    state: DailyChineseUiState,
    viewModel: DailyChineseViewModel,
    onPickCamera: (DailyZhField) -> Unit,
    onPickAlbum: (DailyZhField) -> Unit,
    onContinueCamera: () -> Unit,
    onContinueAlbum: () -> Unit,
) {
    val buttonsEnabled = !state.ocrQueueBusy
    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("⚙️ 今日语文内容", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Black)
            Spacer(Modifier.weight(1f))
            Text(
                "✕",
                fontSize = 18.sp,
                color = Black,
                modifier = Modifier
                    .clickable { viewModel.closeSettings() }
                    .padding(4.dp),
            )
        }
        Spacer(Modifier.height(8.dp))

        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
        ) {
            if (state.ocrMsg.isNotBlank()) {
                Text(
                    state.ocrMsg,
                    fontSize = 12.sp,
                    color = if (state.ocrMsg.startsWith("❌")) ErrRed else OkGreen,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (state.ocrMsg.startsWith("❌")) ErrBg else OkBg)
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                )
            }
            if (state.showOcrContinue) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(InfoBg)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    Text(
                        "还要导入下一张？每次选一张即可，系统会按追加顺序合并。",
                        fontSize = 12.sp,
                        color = InfoBlue,
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SmallButton("🖼️ 继续选一张", onClick = onContinueAlbum, enabled = buttonsEnabled)
                        SmallButton("📷 继续拍一张", onClick = onContinueCamera, enabled = buttonsEnabled)
                    }
                }
            }

            DraftField(
                label = "🔤 今天练的字",
                hint = "用逗号/空格分隔，如：日 月 水 火",
                value = state.draft.chars,
                onChange = { viewModel.onDraftChange(DailyZhField.CHARS, it) },
                buttonsEnabled = buttonsEnabled,
                onCamera = { onPickCamera(DailyZhField.CHARS) },
                onAlbum = { onPickAlbum(DailyZhField.CHARS) },
            )
            DraftField(
                label = "📚 今天练的词",
                hint = "如：春天，朋友，认真",
                value = state.draft.words,
                onChange = { viewModel.onDraftChange(DailyZhField.WORDS, it) },
                buttonsEnabled = buttonsEnabled,
                onCamera = { onPickCamera(DailyZhField.WORDS) },
                onAlbum = { onPickAlbum(DailyZhField.WORDS) },
            )
            DraftField(
                label = "✏️ 今天练的句子/句型",
                hint = "如：用「因为…所以…」造句；用「有的…有的…」写一段话",
                value = state.draft.sentences,
                onChange = { viewModel.onDraftChange(DailyZhField.SENTENCES, it) },
                buttonsEnabled = buttonsEnabled,
                onCamera = { onPickCamera(DailyZhField.SENTENCES) },
                onAlbum = { onPickAlbum(DailyZhField.SENTENCES) },
            )
            DraftField(
                label = "🖊️ 作文主题",
                hint = "如：我的好朋友 / 难忘的一天",
                value = state.draft.essayTopic,
                onChange = { viewModel.onDraftChange(DailyZhField.ESSAY_TOPIC, it) },
            )
            if (state.showOcrContinue) {
                Text(
                    "已完成本次导入；如还有下一张图片，点击该字段的 📷 可继续拍照追加，系统会在字段内按顺序保留空格/换行。",
                    fontSize = 12.sp,
                    color = HintGray,
                )
            }
            Text(
                "💡 拍照识别会自动去掉拼音；孩子只能练到词库里有的字词（摘要里的「词库命中」是提示）。",
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
    buttonsEnabled: Boolean = true,
    onCamera: (() -> Unit)? = null,
    onAlbum: (() -> Unit)? = null,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Black, modifier = Modifier.weight(1f))
            if (onCamera != null) {
                IconChip(
                    text = if (buttonsEnabled) "📷" else "⏳",
                    bg = if (buttonsEnabled) CameraBg else DisabledBg,
                    fg = if (buttonsEnabled) CameraFg else HintGray,
                    enabled = buttonsEnabled,
                    onClick = onCamera,
                )
                Spacer(Modifier.width(4.dp))
            }
            if (onAlbum != null) {
                IconChip(
                    text = "🖼️",
                    bg = if (buttonsEnabled) AlbumBg else DisabledBg,
                    fg = if (buttonsEnabled) AlbumFg else HintGray,
                    enabled = buttonsEnabled,
                    onClick = onAlbum,
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(hint, fontSize = 13.sp, color = HintGray) },
            minLines = 2,
            maxLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
