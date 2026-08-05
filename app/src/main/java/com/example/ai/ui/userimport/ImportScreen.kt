package com.example.ai.ui.userimport

import androidx.compose.foundation.clickable
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.userimport.CandidateStatus
import com.example.ai.data.userimport.ImportCandidate
import com.example.ai.data.userimport.ImportTemplate
import com.example.ai.data.userimport.TemplateParam
import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import android.widget.Toast
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(
    viewModel: ImportViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    // 系统返回键：PROMPT/CONFIRM 是子阶段（ViewModel 内部状态，不在导航栈），
    // 按返回应回到模板选择页而非直接退出整个导入中心；SELECT/DONE 阶段才退出。
    BackHandler(enabled = state.phase == ImportPhase.PROMPT || state.phase == ImportPhase.CONFIRM) {
        viewModel.backToSelect()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("导入学习内容") },
                navigationIcon = {
                    TextButton(onClick = {
                        if (state.phase == ImportPhase.PROMPT || state.phase == ImportPhase.CONFIRM) {
                            viewModel.backToSelect()
                        } else {
                            onBack()
                        }
                    }) { Text("← 返回") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            when (state.phase) {
                ImportPhase.SELECT -> TemplateSelectSection(state, viewModel)
                ImportPhase.PROMPT -> PromptSection(state, viewModel, onCopy = {
                    state.generatedPrompt?.let { prompt ->
                        clipboard.setText(AnnotatedString(prompt))
                        Toast.makeText(context, "提示词已复制，去粘贴给你的 LLM 吧", Toast.LENGTH_SHORT).show()
                    }
                })
                ImportPhase.CONFIRM -> ConfirmSection(state, viewModel)
                ImportPhase.DONE -> DoneSection(state, viewModel)
            }
        }
    }
}

// ── 阶段 1：选择模板 ──

@Composable
private fun TemplateSelectSection(state: ImportUiState, viewModel: ImportViewModel) {
    if (state.loading) {
        Text("加载模板中…", style = MaterialTheme.typography.bodyLarge)
        return
    }
    state.error?.let {
        Text("⚠️ $it", color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = viewModel::loadTemplates) { Text("重试") }
        return
    }
    val textTemplates = state.templates.filter { it.group == "text" }
    val imageTemplates = state.templates.filter { it.group == "image" }

    Text("📄 文本粘贴", fontWeight = FontWeight.Bold, fontSize = 17.sp)
    Text(
        "把课本/试卷内容粘贴进来，生成提示词让 LLM 提取",
        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(8.dp))
    textTemplates.forEach { TemplateCard(it) { viewModel.selectTemplate(it) } }

    Spacer(Modifier.height(16.dp))
    Text("📷 图片识别", fontWeight = FontWeight.Bold, fontSize = 17.sp)
    Text(
        "拍照教辅，把提示词和图片一起发给 LLM 识别",
        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(8.dp))
    imageTemplates.forEach { TemplateCard(it) { viewModel.selectTemplate(it) } }
}

@Composable
private fun TemplateCard(template: ImportTemplate, onClick: () -> Unit) {
    OutlinedCard(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(template.name, fontWeight = FontWeight.Bold)
            Text(
                template.description,
                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── 图片类模板：拍照区（系统相机 + 多张 + 一键分享） ──

@Composable
private fun PhotoSection(
    photoUris: List<String>,
    prompt: String?,
    onAddPhoto: (String) -> Unit,
    onRemovePhoto: (String) -> Unit,
) {
    val context = LocalContext.current
    var pendingFile by remember { mutableStateOf<File?>(null) }

    // 兜底恢复：上次拍照 App 被杀/中断时，cache 里残留的照片文件补进相册
    LaunchedEffect(Unit) {
        val dir = File(context.cacheDir, "import_photos")
        val files = dir.listFiles()?.filter { it.isFile }?.sortedBy { it.name } ?: emptyList()
        files.forEach { f ->
            val uri = copyToGallery(context, f)
            f.delete()
            if (uri != null) onAddPhoto(uri.toString())
        }
    }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        pendingFile?.let { file ->
            if (ok) {
                // 拍照成功：从 App cache 复制到系统相册（ColorOS 相机写不了外部 Uri，写 FileProvider 兼容最好）
                val uri = copyToGallery(context, file)
                file.delete()
                if (uri != null) {
                    onAddPhoto(uri.toString())
                } else {
                    Toast.makeText(context, "照片保存到相册失败，请重试", Toast.LENGTH_SHORT).show()
                }
            } else {
                // 用户取消：删掉 cache 临时文件
                file.delete()
            }
        }
        pendingFile = null
    }

    // API 26-28 写相册需要存储权限；29+ 免权限
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            pendingFile?.let { takePicture.launch(cameraUri(context, it)) }
        } else {
            Toast.makeText(context, "需要存储权限才能保存照片", Toast.LENGTH_SHORT).show()
            pendingFile = null
        }
    }

    fun launchCamera() {
        val file = createCameraFile(context) ?: return
        pendingFile = file
        if (Build.VERSION.SDK_INT < 29 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            permissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            takePicture.launch(cameraUri(context, file))
        }
    }

    Spacer(Modifier.height(12.dp))
    OutlinedButton(onClick = { launchCamera() }, modifier = Modifier.fillMaxWidth()) {
        Text(if (photoUris.isEmpty()) "📷 拍照（可连续拍多张）" else "📷 继续拍照")
    }

    if (photoUris.isNotEmpty()) {
        Spacer(Modifier.height(8.dp))
        Text(
            "已拍 ${photoUris.size} 张（自动存入相册）",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            photoUris.forEach { uriStr ->
                Box {
                    AsyncImage(
                        model = uriStr,
                        contentDescription = "已拍照片",
                        modifier = Modifier
                            .size(72.dp)
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop,
                    )
                    // 右上角删除（连相册文件一起删）
                    IconButton(
                        onClick = {
                            try {
                                context.contentResolver.delete(Uri.parse(uriStr), null, null)
                            } catch (_: Exception) {
                            }
                            onRemovePhoto(uriStr)
                        },
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .size(24.dp),
                    ) {
                        Text("✕", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        // 提示词 + 照片一起打包分享（ACTION_SEND_MULTIPLE：EXTRA_TEXT 提示词 + EXTRA_STREAM 多图）
        Button(
            onClick = {
                val uris = photoUris.map { Uri.parse(it) }
                val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                    type = "image/*"
                    putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
                    putExtra(Intent.EXTRA_TEXT, prompt ?: "")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                context.startActivity(Intent.createChooser(intent, "把提示词和照片发给 LLM"))
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("📤 把提示词 + ${photoUris.size} 张照片发给 LLM")
        }
    }
}

/** 在 App cache 创建拍照临时文件（相机写 FileProvider uri，兼容性最好） */
private fun createCameraFile(context: Context): File? {
    return try {
        val dir = File(context.cacheDir, "import_photos").apply { mkdirs() }
        File(dir, "ai_import_${System.currentTimeMillis()}.jpg")
    } catch (_: Exception) {
        null
    }
}

/** 拍照输出目标：FileProvider content Uri */
private fun cameraUri(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

/** 把拍照临时文件复制进系统相册 Pictures/ai_import，返回相册 content Uri */
private fun copyToGallery(context: Context, file: File): Uri? {
    if (!file.exists() || file.length() == 0L) return null
    val name = "ai_import_${System.currentTimeMillis()}.jpg"
    val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, name)
        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        if (Build.VERSION.SDK_INT >= 29) {
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/ai_import")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        } else {
            put(
                MediaStore.Images.Media.DATA,
                "${Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES).absolutePath}/$name",
            )
        }
    }
    val uri = try {
        context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
    } catch (_: Exception) {
        null
    } ?: return null
    return try {
        context.contentResolver.openOutputStream(uri)?.use { out ->
            file.inputStream().use { it.copyTo(out) }
        } ?: throw IllegalStateException("no output stream")
        if (Build.VERSION.SDK_INT >= 29) {
            context.contentResolver.update(
                uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null,
            )
        }
        uri
    } catch (_: Exception) {
        try {
            context.contentResolver.delete(uri, null, null)
        } catch (_: Exception) {
        }
        null
    }
}

// ── 阶段 2：参数 + 提示词 ──

@Composable
private fun PromptSection(
    state: ImportUiState,
    viewModel: ImportViewModel,
    onCopy: () -> Unit,
) {
    val template = state.selectedTemplate ?: return

    Text(template.name, fontWeight = FontWeight.Bold, fontSize = 18.sp)
    Spacer(Modifier.height(8.dp))

    // 参数槽位
    template.params.forEach { param ->
        ParamRow(param, state.paramValues[param.key].orEmpty()) { value ->
            viewModel.setParam(param.key, value)
        }
    }

    // 图片类：直接调用系统相机拍照（可多张），拍完把提示词+照片一起发给 LLM
    if (template.inputType == "image") {
        PhotoSection(
            photoUris = state.photoUris,
            prompt = state.generatedPrompt,
            onAddPhoto = viewModel::addPhoto,
            onRemovePhoto = viewModel::removePhoto,
        )
    }

    // 文本类：原文输入
    if (template.inputType == "text") {
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.inputText,
            onValueChange = viewModel::setInputText,
            label = { Text("粘贴原文（课本/试卷内容）") },
            modifier = Modifier.fillMaxWidth().height(140.dp),
            textStyle = MaterialTheme.typography.bodySmall,
        )
    }

    Spacer(Modifier.height(12.dp))
    Button(
        onClick = viewModel::generatePrompt,
        enabled = state.generatedPrompt == null,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(if (template.inputType == "image") "生成提示词（含图片说明）" else "生成提示词")
    }

    // 提示词展示
    state.generatedPrompt?.let { prompt ->
        Spacer(Modifier.height(12.dp))
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                Text("📋 提示词（复制后发给你的 LLM）", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                if (template.inputType == "image") {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "💡 打开支持图片的 LLM（如豆包/ChatGPT），把下面提示词和图片一起发过去",
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.primary,
                    )
                }
                template.privacyNotice.takeIf { it.isNotBlank() }?.let { notice ->
                    Spacer(Modifier.height(6.dp))
                    Text(
                        notice,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.error,
                        fontWeight = FontWeight.Medium,
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    prompt,
                    fontSize = 12.sp,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(160.dp)
                        .verticalScroll(rememberScrollState()),
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = viewModel::generateWithFreeLLM,
                    enabled = !state.freeGenerating,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.tertiary,
                        contentColor = MaterialTheme.colorScheme.onTertiary,
                    ),
                ) {
                    if (state.freeGenerating) {
                        CircularProgressIndicator(
                            Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onTertiary,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("AI 生成中…")
                    } else {
                        Text("✨ AI 一键生成（火山引擎送 token）")
                    }
                }
                state.error?.let { err ->
                    Spacer(Modifier.height(6.dp))
                    Text("⚠️ $err", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                }
                if (template.inputType == "image") {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "已拍 ${state.photoUris.size} 张照片将随提示词一起发送；也可复制提示词去你自己的 LLM",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Button(onClick = onCopy, modifier = Modifier.fillMaxWidth()) {
                    Text("复制提示词")
                }
            }
        }
    }

    // LLM 结果粘贴
    if (state.generatedPrompt != null) {
        Spacer(Modifier.height(16.dp))
        Text("🔄 第 2 步：粘贴 LLM 返回的结果", fontWeight = FontWeight.Bold, fontSize = 15.sp)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = state.llmResult,
            onValueChange = viewModel::setLlmResult,
            label = { Text("把 LLM 输出的 JSON 粘贴到这里") },
            modifier = Modifier.fillMaxWidth().height(150.dp),
            textStyle = MaterialTheme.typography.bodySmall,
        )
        state.parseError?.let {
            Spacer(Modifier.height(4.dp))
            Text("⚠️ $it", fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(8.dp))
        Button(onClick = viewModel::parseLlmResult, modifier = Modifier.fillMaxWidth()) {
            Text("解析并核对")
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun ParamRow(param: TemplateParam, value: String, onValue: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(param.label, fontSize = 14.sp)
        if (param.type == "number") {
            OutlinedTextField(
                value = value,
                onValueChange = onValue,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        } else {
            // select：下拉框（选项多时比按钮组省空间）
            var expanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(
                expanded = expanded,
                onExpandedChange = { expanded = it },
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            ) {
                OutlinedTextField(
                    value = value,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = true,
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                    modifier = Modifier
                        .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                        .fillMaxWidth(),
                )
                ExposedDropdownMenu(
                    expanded = expanded,
                    onDismissRequest = { expanded = false },
                ) {
                    param.options.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(option, fontSize = 14.sp) },
                            onClick = {
                                onValue(option)
                                expanded = false
                            },
                        )
                    }
                }
            }
        }
    }
}

// ── 阶段 3：确认 ──

@Composable
private fun ConfirmSection(state: ImportUiState, viewModel: ImportViewModel) {
    val selected = remember {
        mutableStateOf(
            state.candidates.filter { it.status == CandidateStatus.NEW }.map { it.text }.toMutableSet()
        )
    }

    Text("确认导入（${state.candidates.size} 条）", fontWeight = FontWeight.Bold, fontSize = 17.sp)
    Text(
        "已存在/有问题的条目默认不勾选，可点选强制导入",
        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(8.dp))

    state.candidates.forEach { c ->
        CandidateRow(c, isChecked = c.text in selected.value) { checked ->
            if (checked) selected.value.add(c.text) else selected.value.remove(c.text)
        }
        HorizontalDivider(Modifier.padding(vertical = 2.dp))
    }

    Spacer(Modifier.height(16.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = {
            viewModel.setLlmResult("")
            viewModel.backToSelect()
        }, modifier = Modifier.weight(1f)) {
            Text("放弃")
        }
        Button(
            onClick = { viewModel.saveSelected(selected.value) },
            modifier = Modifier.weight(2f),
        ) {
            Text("保存导入")
        }
    }
}

@Composable
private fun CandidateRow(candidate: ImportCandidate, isChecked: Boolean, onChecked: (Boolean) -> Unit) {
    val canCheck = candidate.status != CandidateStatus.INVALID
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Checkbox(
            checked = isChecked,
            onCheckedChange = { onChecked(it) },
            enabled = canCheck,
        )
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    candidate.text.ifBlank { "（空）" },
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                )
                Spacer(Modifier.width(8.dp))
                StatusBadge(candidate.status)
            }
            if (candidate.pinyin.isNotBlank()) {
                Text(candidate.pinyin, fontSize = 13.sp, color = MaterialTheme.colorScheme.primary)
            }
            if (candidate.meaning.isNotBlank()) {
                Text(candidate.meaning, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (candidate.reason.isNotBlank()) {
                Text(
                    candidate.reason,
                    fontSize = 12.sp,
                    color = if (candidate.status == CandidateStatus.INVALID) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.tertiary,
                )
            }
        }
    }
}

@Composable
private fun StatusBadge(status: CandidateStatus) {
    val (label, color) = when (status) {
        CandidateStatus.NEW -> "新" to MaterialTheme.colorScheme.primary
        CandidateStatus.DUPLICATE -> "已存在" to MaterialTheme.colorScheme.tertiary
        CandidateStatus.INVALID -> "无效" to MaterialTheme.colorScheme.error
    }
    Surface(shape = MaterialTheme.shapes.small, color = color.copy(alpha = 0.15f)) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            fontSize = 11.sp,
            color = color,
        )
    }
}

// ── 阶段 4：完成 ──

@Composable
private fun DoneSection(state: ImportUiState, viewModel: ImportViewModel) {
    Text("✅ 导入完成", fontWeight = FontWeight.Bold, fontSize = 18.sp)
    Spacer(Modifier.height(8.dp))
    state.savedMessage?.let {
        Text(it, fontSize = 14.sp)
    }
    Spacer(Modifier.height(16.dp))
    Button(onClick = viewModel::finish, modifier = Modifier.fillMaxWidth()) {
        Text("继续导入")
    }
}
