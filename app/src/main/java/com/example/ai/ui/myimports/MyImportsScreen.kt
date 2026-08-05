package com.example.ai.ui.myimports

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import com.example.ai.data.userimport.UserImportItem
import java.text.SimpleDateFormat
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Date
import java.util.Locale

/**
 * 我的导入 — 按类型分组展示本地已导入内容（生字/词语/句子/文章/题目/答案），
 * 支持删除。空态引导去导入中心。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyImportsScreen(
    viewModel: MyImportsViewModel,
    onBack: () -> Unit,
    onNavigateImport: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val items by viewModel.items.collectAsStateWithLifecycle()
    val deleteMessage by viewModel.deleteMessage.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var selectedItem by remember { mutableStateOf<UserImportItem?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("我的导入") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        if (items.isEmpty()) {
            EmptyState(onNavigateImport, Modifier.padding(padding))
        } else {
            val grouped = MyImportsViewModel.KIND_ORDER
                .mapNotNull { kind -> items.filter { it.kind == kind }.takeIf { it.isNotEmpty() }?.let { kind to it } }
            LazyColumn(
                modifier = modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(grouped, key = { it.first }) { (kind, kindItems) ->
                    ImportGroupSection(
                        kind = kind,
                        items = kindItems,
                        onRemove = viewModel::remove,
                        onItemClick = { selectedItem = it },
                    )
                }
            }
        }
    }

    // 条目详情弹窗
    selectedItem?.let { item ->
        ImportItemDetailDialog(item, onDismiss = { selectedItem = null })
    }

    // 删除同步失败提示（本地已删，服务端未删）
    deleteMessage?.let { msg ->
        LaunchedEffect(msg) {
            viewModel.clearDeleteMessage()
            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
        }
    }
}

@Composable
private fun ImportGroupSection(
    kind: String,
    items: List<UserImportItem>,
    onRemove: (String) -> Unit,
    onItemClick: (UserImportItem) -> Unit,
) {
    Column {
        Text(
            text = "📂 ${MyImportsViewModel.kindLabel(kind)}（${items.size}）",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        items.forEach { item ->
            ImportItemCard(item, onRemove, onClick = { onItemClick(item) })
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ImportItemCard(item: UserImportItem, onRemove: (String) -> Unit, onClick: () -> Unit) {
    OutlinedCard(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Text(
                    text = item.text,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { onRemove(item.id) }) {
                    Text("🗑️", fontSize = 18.sp)
                }
            }
            if (item.pinyin.isNotBlank()) {
                Text(
                    text = "拼音：${item.pinyin}",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (item.meaning.isNotBlank()) {
                Text(
                    text = "释义：${item.meaning}",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (item.tags.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    item.tags.take(4).forEach { tag ->
                        AssistChip(onClick = {}, label = { Text(tag, fontSize = 12.sp) })
                    }
                }
            }
            if (item.sourceTemplate.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "来源：${MyImportsViewModel.templateLabel(item.sourceTemplate)}",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "导入于 ${formatTime(item.createdAt)}",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}

@Composable
private fun EmptyState(onNavigateImport: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("📭", fontSize = 56.sp)
            Spacer(Modifier.height(12.dp))
            Text("还没有导入内容", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                "去导入词汇 / 生字 / 文章 / 句子，\n同步练习时会自动合并进来",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))
            Button(onClick = onNavigateImport) { Text("去导入") }
        }
    }
}

/** 条目详情弹窗：卡片显示不全的完整信息 + payload 明细 */
@Composable
private fun ImportItemDetailDialog(item: UserImportItem, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
        title = { Text("📄 ${MyImportsViewModel.kindLabel(item.kind)} 详情") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(item.text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                if (item.pinyin.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text("拼音：${item.pinyin}", fontSize = 14.sp)
                }
                if (item.meaning.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text("释义：${item.meaning}", fontSize = 14.sp)
                }
                if (item.tags.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Text("标签：${item.tags.joinToString("、")}", fontSize = 14.sp)
                }
                if (item.sourceTemplate.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "来源：${MyImportsViewModel.templateLabel(item.sourceTemplate)}",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "导入于 ${formatTime(item.createdAt)}",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.outline,
                )
                val detailLines = payloadDetail(item.payload)
                if (detailLines.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(10.dp))
                    detailLines.forEach { line ->
                        Text(line, fontSize = 14.sp)
                        Spacer(Modifier.height(4.dp))
                    }
                }
            }
        },
    )
}

/** 把 payload JSON 转成可读的行（文章全文 / 题目明细 / 原样兜底） */
private fun payloadDetail(payload: String): List<String> {
    if (payload.isBlank()) return emptyList()
    return try {
        val el = Json.parseToJsonElement(payload)
        when (el) {
            is JsonObject -> {
                val lines = mutableListOf<String>()
                val prim = { key: String ->
                    (el[key] as? JsonPrimitive)?.let { if (it.isString) it.content else it.content }
                }
                val title = prim("title")
                val content = prim("content")
                if (!title.isNullOrBlank()) lines.add("标题：$title")
                if (!content.isNullOrBlank()) lines.add("正文：\n$content")
                (el["paragraphs"] as? JsonArray)?.forEachIndexed { i, p ->
                    val text = (p as? JsonPrimitive)?.content ?: return@forEachIndexed
                    lines.add("段落 ${i + 1}：$text")
                }
                // 剩余字段平铺（元信息：pos/phonetic/example/summary/theme/grammar/… 数组也显示）
                el.forEach { (k, v) ->
                    if (k == "title" || k == "content" || k == "paragraphs") return@forEach
                    when (v) {
                        is JsonPrimitive -> lines.add("$k：${v.content}")
                        is JsonArray -> lines.add(
                            "$k：" + v.joinToString("、") { (it as? JsonPrimitive)?.content ?: it.toString() }
                        )
                        is JsonObject -> lines.add("$k：$v")
                    }
                }
                if (lines.isEmpty()) listOf(el.toString()) else lines
            }
            is JsonArray -> {
                val lines = mutableListOf<String>()
                var allObjects = true
                el.forEachIndexed { i, elem ->
                    val q = elem as? JsonObject
                    if (q == null) {
                        allObjects = false
                        return@forEachIndexed
                    }
                    val head = StringBuilder("【${i + 1}】")
                    (q["type"] as? JsonPrimitive)?.let { head.append("[${it.content}] ") }
                    (q["stem"] as? JsonPrimitive)?.let { head.append(it.content) }
                    lines.add(head.toString().trimEnd())
                    (q["options"] as? JsonArray)?.takeIf { it.isNotEmpty() }?.let { arr ->
                        lines.add("选项：" + arr.joinToString("、") { (it as? JsonPrimitive)?.content ?: it.toString() })
                    }
                    (q["answer"] as? JsonPrimitive)?.let { lines.add("答案：${it.content}") }
                    (q["explanation"] as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }?.let {
                        lines.add("解析：$it")
                    }
                }
                if (allObjects && lines.isNotEmpty()) lines else listOf(el.toString())
            }
            is JsonPrimitive -> listOf(el.content)
            else -> listOf(el.toString())
        }
    } catch (_: Exception) {
        listOf(payload)
    }
}

private fun formatTime(millis: Long): String =
    SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(millis))
