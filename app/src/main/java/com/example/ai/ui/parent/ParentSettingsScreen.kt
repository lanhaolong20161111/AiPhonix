package com.example.ai.ui.parent

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import com.example.ai.data.training.FeatureId
import com.example.ai.data.training.PlanItem
import com.example.ai.data.training.TrainingPlanStore

/** 家长区 PIN 门禁状态机 */
private sealed interface PinStep {
    data object Setup : PinStep    // 首次：设置 PIN
    data object Verify : PinStep   // 已有 PIN：验证
    data object Ready : PinStep    // 通过：进入任务编辑
}

/** 编辑中的任务项草稿（保留原完成状态） */
private data class DraftItem(val item: PlanItem)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ParentSettingsScreen(
    store: TrainingPlanStore,
    onBack: () -> Unit,
    onOpenImport: () -> Unit = {},
    onOpenMyImports: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var pinStep by remember { mutableStateOf(if (store.hasPin()) PinStep.Verify else PinStep.Setup) }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("家长设置") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Text("←", fontSize = 20.sp) }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (val step = pinStep) {
                is PinStep.Setup -> PinSetup(
                    store = store,
                    onDone = { pinStep = PinStep.Ready },
                )
                is PinStep.Verify -> PinVerify(
                    store = store,
                    onSuccess = { pinStep = PinStep.Ready },
                )
                is PinStep.Ready -> PlanEditor(
                    store = store,
                    onBack = onBack,
                    onOpenImport = onOpenImport,
                    onOpenMyImports = onOpenMyImports,
                )
            }
        }
    }
}

// ───────────────────────── PIN 门禁 ─────────────────────────

@Composable
private fun PinSetup(store: TrainingPlanStore, onDone: () -> Unit) {
    var first by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Text("🔐", fontSize = 48.sp)
        Spacer(Modifier.height(12.dp))
        Text("首次使用，请设置家长 PIN", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text("学生进入家长区需输入此 PIN", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(32.dp))
        PinField("设置 PIN（4~6 位数字）", first, { first = it }, error)
        Spacer(Modifier.height(12.dp))
        PinField("再次输入确认", confirm, { confirm = it })
        Spacer(Modifier.height(24.dp))
        Button(
            enabled = first.length in 4..6,
            onClick = {
                if (first != confirm) {
                    error = "两次输入不一致，请重试"
                } else {
                    store.setPin(first)
                    error = null
                    onDone()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("确定") }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }
    }
}

@Composable
private fun PinVerify(store: TrainingPlanStore, onSuccess: () -> Unit) {
    var input by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Text("🔐", fontSize = 48.sp)
        Spacer(Modifier.height(12.dp))
        Text("家长验证", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text("请输入家长 PIN 进入设置", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(32.dp))
        PinField("家长 PIN", input, { input = it }, error)
        Spacer(Modifier.height(24.dp))
        Button(
            enabled = input.length >= 4,
            onClick = {
                if (store.verifyPin(input)) {
                    error = null
                    onSuccess()
                } else {
                    input = ""
                    error = "PIN 不正确，请重试"
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("进入设置") }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }
    }
}

@Composable
private fun PinField(label: String, value: String, onChange: (String) -> Unit, error: String? = null) {
    OutlinedTextField(
        value = value,
        onValueChange = { onChange(it.filter { c -> c.isDigit() }.take(6)) },
        label = { Text(label) },
        singleLine = true,
        isError = error != null,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth(),
    )
}

// ───────────────────────── 任务编辑 ─────────────────────────

@Composable
private fun PlanEditor(
    store: TrainingPlanStore,
    onBack: () -> Unit,
    onOpenImport: () -> Unit = {},
    onOpenMyImports: () -> Unit = {},
) {
    val plan by store.plan.collectAsState()
    // 草稿：从当前计划初始化（保留完成状态；未创建任务则为空）
    // 只保留可训练项：导入/我的导入是家长管理功能，不进入学生任务
    // 显式类型标注：避免 remember(key) 返回协变投影导致 delegate setValue 无法解析
    var draft: List<DraftItem> by remember(plan?.id) {
        mutableStateOf<List<DraftItem>>(
            plan?.items?.map { DraftItem(it) }?.filter { it.item.featureId?.isTraining == true } ?: emptyList()
        )
    }

    val available = FeatureId.trainableEntries.filter { f -> draft.none { it.item.feature == f.id } }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column(Modifier.padding(top = 16.dp)) {
                Text("👨👩👧 学生首页只显示下面的训练任务", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    "已完成 ${draft.count { it.item.done }} / ${draft.size} 项",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }

        item {
            Text("📌 已选训练（${draft.size}）", fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }

        if (draft.isEmpty()) {
            item {
                Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
                    Text(
                        "还没有选择任何训练。\n从下方「添加训练」勾选后保存，学生首页就会出现任务。",
                        modifier = Modifier.padding(16.dp),
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        items(draft.size, key = { draft[it].item.id }) { idx ->
            val d = draft[idx]
            val feature = d.item.featureId
            if (feature != null) {
                DraftRow(
                    feature = feature,
                    item = d.item,
                    onRemove = { draft = draft.filterNot { it.item.id == d.item.id } },
                    onResetDone = { item ->
                        draft = draft.map { if (it.item.id == item.id) DraftItem(item.copy(done = false, doneAt = null)) else it }
                    },
                )
            }
        }

        item {
            Spacer(Modifier.height(4.dp))
            Text("➕ 添加训练", fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }

        if (available.isEmpty()) {
            item {
                Text("所有功能都已加入任务", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        items(available.size, key = { available[it].id }) { idx ->
            val feature = available[idx]
            Card(
                modifier = Modifier.fillMaxWidth().clickable {
                    draft = draft + DraftItem(TrainingPlanStore.newItem(feature))
                },
                colors = CardDefaults.outlinedCardColors(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(feature.emoji, fontSize = 26.sp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(feature.title, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(feature.subtitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text("＋", fontSize = 24.sp, color = MaterialTheme.colorScheme.primary)
                }
            }
        }

        item {
            Spacer(Modifier.height(8.dp))
            Text("📦 内容管理（家长）", fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text("导入和整理训练内容，不会出现在学生任务中", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        // 导入学习内容（固定入口）
        item {
            Card(
                modifier = Modifier.fillMaxWidth().clickable(onClick = onOpenImport),
                colors = CardDefaults.outlinedCardColors(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("📥", fontSize = 26.sp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("导入学习内容", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text("词汇 · 文章 · 句子 · 题目", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text("›", fontSize = 24.sp, color = MaterialTheme.colorScheme.primary)
                }
            }
        }

        // 我的导入（固定入口）
        item {
            Card(
                modifier = Modifier.fillMaxWidth().clickable(onClick = onOpenMyImports),
                colors = CardDefaults.outlinedCardColors(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("📋", fontSize = 26.sp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("我的导入", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text("查看 / 删除已导入内容", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text("›", fontSize = 24.sp, color = MaterialTheme.colorScheme.primary)
                }
            }
        }

        item {
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    store.savePlan(
                        title = "今日任务",
                        items = draft.map { it.item },
                    )
                    onBack()
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("保存并生效", fontSize = 16.sp, modifier = Modifier.padding(vertical = 6.dp)) }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    store.resetAll()
                    draft = draft.map { DraftItem(it.item.copy(done = false, doneAt = null)) }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("重置全部完成状态") }
            Spacer(Modifier.height(8.dp))
            Text(
                "💡 完成规则：学生从首页任务卡片进入页面并返回，即自动打卡。家长可在此重置。",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun DraftRow(
    feature: FeatureId,
    item: PlanItem,
    onRemove: () -> Unit,
    onResetDone: (PlanItem) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (item.done) MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.4f)
            else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(feature.emoji, fontSize = 26.sp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(feature.title, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(
                    if (item.done) "✅ 已完成" else "⏳ 待完成",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (item.done) {
                TextButton(onClick = { onResetDone(item) }) { Text("重置", fontSize = 12.sp) }
            }
            Text(
                "✕",
                fontSize = 18.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(onClick = onRemove)
                    .padding(6.dp),
            )
        }
    }
}
