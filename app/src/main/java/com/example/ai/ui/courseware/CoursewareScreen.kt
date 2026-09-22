package com.example.ai.ui.courseware

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.example.ai.data.courseware.CoursewareItem
import com.example.ai.data.courseware.CoursewareModule
import com.example.ai.data.courseware.readPickedImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Black = Color(0xFF000000)
private val BadText = Color(0xFFB71C1C)

/**
 * 课件库（家长端）——对齐 web `CoursewareManagerPage`：
 * 三个科目 tab 各列其课件图；上传可多选（每张图以原文件名为标题，去掉扩展名）；可删除。
 */
@Composable
fun CoursewareScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val viewModel: CoursewareViewModel = viewModel { CoursewareViewModel() }
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    var pendingDelete by remember { mutableStateOf<CoursewareItem?>(null) }

    // 多选图片（对齐 web 的 multiple input）
    val pickImages = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            // 读字节是本地 IO（不是网络），放在 data 层 helper 里，避免 VM 持有 ContentResolver
            val picked = withContext(Dispatchers.IO) {
                uris.mapNotNull { readPickedImage(context.contentResolver, it) }
            }
            if (picked.isEmpty()) {
                viewModel.reportError("上传失败：无法读取所选图片，请重新选择")
                return@launch
            }
            if (picked.size < uris.size) {
                viewModel.reportError("有 ${uris.size - picked.size} 张图片读取失败，已跳过")
            }
            viewModel.upload(picked)
        }
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
            Text("📚 课件库", style = MaterialTheme.typography.titleLarge, color = Black)
        }
        Spacer(Modifier.height(4.dp))
        // 文案与 web 逐字一致
        Text("按科目上传/管理课件图片，学科页「课件」按钮可选用。", fontSize = 13.sp, color = Black)
        Spacer(Modifier.height(10.dp))

        // 科目 tab
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CoursewareModule.entries.forEach { m ->
                FilterChip(
                    selected = state.module == m,
                    onClick = { viewModel.switchModule(m) },
                    label = { Text("${m.icon} ${m.label}", color = Black) },
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        // 上传（可多选）
        Button(
            onClick = { pickImages.launch("image/*") },
            enabled = !state.uploading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                when {
                    !state.uploading -> "📤 上传课件图片（可多选）"
                    state.uploadTotal > 1 -> "上传中…（${state.uploadDone}/${state.uploadTotal}）"
                    else -> "上传中…"
                },
                fontSize = 15.sp,
                modifier = Modifier.padding(vertical = 4.dp),
            )
        }
        Spacer(Modifier.height(8.dp))

        if (state.error.isNotBlank()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    state.error,
                    fontSize = 13.sp,
                    color = BadText,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "✕",
                    fontSize = 13.sp,
                    color = Black,
                    modifier = Modifier.clickable { viewModel.dismissError() }.padding(4.dp),
                )
            }
            Spacer(Modifier.height(6.dp))
        }

        when {
            state.loading -> Text("加载中…", fontSize = 13.sp, color = Black)

            state.empty -> {
                // 与 web 一致的空态：📭 + 「{科目}」还没有课件
                Box(Modifier.fillMaxWidth().padding(top = 24.dp), contentAlignment = Alignment.Center) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    ) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(28.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text("📭", fontSize = 36.sp)
                            Spacer(Modifier.height(8.dp))
                            Text("「${state.module.label}」还没有课件", fontSize = 14.sp, color = Black)
                        }
                    }
                }
            }

            else -> {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    // key 用 id：同一科目内唯一（跨科目切换时列表整体替换，不会冲突）
                    items(state.items, key = { it.id }) { item ->
                        CoursewareCell(
                            item = item,
                            imageUrl = viewModel.imageUrl(item.fileName),
                            onDelete = { pendingDelete = item },
                        )
                    }
                }
            }
        }
    }

    // web 用 window.confirm，Android 用 AlertDialog
    pendingDelete?.let { target ->
        val name = target.title.ifBlank { target.fileName }
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除课件", color = Black) },
            text = { Text("删除课件「$name」？", color = Black) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.delete(target)
                    pendingDelete = null
                }) { Text("删除", color = BadText) }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("取消", color = Black) }
            },
        )
    }
}

/** 一张课件：缩略图 + 标题 + 🗑 */
@Composable
private fun CoursewareCell(
    item: CoursewareItem,
    imageUrl: String,
    onDelete: () -> Unit,
) {
    val displayName = item.title.ifBlank { item.fileName }
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column {
            // 图片直链不鉴权（服务端策略：<img src> 带不了 Authorization），Coil 直接取
            AsyncImage(
                model = imageUrl,
                contentDescription = displayName,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFFF1F5F9)),
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    displayName,
                    fontSize = 13.sp,
                    color = Black,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "🗑",
                    fontSize = 15.sp,
                    color = Black,
                    modifier = Modifier
                        .clickable(onClick = onDelete)
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
    }
}
