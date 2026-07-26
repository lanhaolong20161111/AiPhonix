package com.example.ai.ui.chinesepractice

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecognitionScreen(
    viewModel: RecognitionViewModel,
    onPlayTts: (String) -> Unit,
    onStartRecording: (String) -> Unit,  // refText
    onStopRecording: () -> Unit,
    onBack: () -> Unit
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // 设置 TTS 回调
    LaunchedEffect(Unit) { viewModel.onPlayTts = onPlayTts }

    // 输入框焦点跳转
    val focusInit = remember { FocusRequester() }
    val focusMedial = remember { FocusRequester() }
    val focusFinal = remember { FocusRequester() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("认字练习") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        if (state.loading && state.items.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(8.dp))
                    Text(state.message)
                }
            }
            return@Scaffold
        }

        if (state.items.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(state.message.ifEmpty { "字库为空" })
            }
            return@Scaffold
        }

        if (state.finished) {
            ResultScreen(
                title = "认字练习完成！",
                results = state.results,
                totalItems = state.items.size,
                onBack = onBack,
                modifier = Modifier.padding(padding)
            )
            return@Scaffold
        }

        val current = state.items[state.currentIndex]
        val currentChar = current.text

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp)
                .imePadding()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // 进度
            Text(
                text = "第 ${state.currentIndex + 1}/${state.items.size} 题",
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(24.dp))

            // 大字展示
            Box(
                modifier = Modifier
                    .size(160.dp)
                    .background(
                        MaterialTheme.colorScheme.primaryContainer,
                        RoundedCornerShape(24.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = currentChar,
                    fontSize = 72.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }

            // 年级标签
            val gradeTag = current.tags.firstOrNull { it.contains("年级") } ?: ""
            if (gradeTag.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = gradeTag,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 多音字词语上下文提示
            if (state.wordContext.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                val ctx = state.wordContext
                val ch = currentChar
                val parts = ctx.split(ch)
                Text(
                    text = if (parts.size >= 2) "来自：${parts[0]}$ch${parts[1]}"
                           else "来自：$ctx",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            Spacer(Modifier.height(16.dp))

            // 拼音输入：彩色方框直接输入
            if (state.isCorrect != true) {
                val isOverall = current.let { c ->
                    c.pinyin?.replace(Regex("[0-9]"), "") in setOf(
                        "zhi","chi","shi","ri","zi","ci","si",
                        "yi","wu","yu","ye","yue","yuan","yin","yun","ying"
                    )
                } ?: false

                if (isOverall) {
                    // 整体认读音节：黄色输入框
                    OutlinedTextField(
                        value = state.userFinal,
                        onValueChange = { viewModel.updateFinal(it) },
                        placeholder = { Text("输入拼音") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { viewModel.submitPinyin() }),
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focusFinal)
                            .background(Color(0xFFFFF176).copy(alpha = 0.2f), RoundedCornerShape(8.dp))
                    )
                } else {
                    val zeroInit = current.let { c ->
                        val raw = c.pinyin?.replace(Regex("[0-9]"), "") ?: ""
                        raw.none { INITIALS.any { raw.startsWith(it) } }
                    } ?: false

                    // y/w 开头零声母（非整体认读）→ 显示介母+韵母，不显示声母框
                    val ywInit = current.let { c ->
                        val raw = c.pinyin?.replace(Regex("[0-9]"), "") ?: ""
                        val whole = setOf("zhi","chi","shi","ri","zi","ci","si",
                            "yi","wu","yu","ye","yue","yuan","yin","yun","ying")
                        raw !in whole && (raw.startsWith("y") || raw.startsWith("w"))
                    } ?: false

                    if (zeroInit) {
                        // 零声母（只有韵母）：单个绿色框
                        OutlinedTextField(
                            value = state.userFinal,
                            onValueChange = { viewModel.updateFinal(it) },
                            placeholder = { Text("拼音", color = Color(0xFF66BB6A)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { viewModel.submitPinyin() }),
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(focusFinal)
                                .background(Color(0xFF66BB6A).copy(alpha = 0.2f), RoundedCornerShape(8.dp))
                        )
                    } else {
                        // 提前计算介母判断，供各字段使用（小学标准规则）
                        val iMed = setOf("iong", "iang", "iao", "ian", "ia")
                        val uMed = setOf("uang", "uai", "uan", "uo", "ua")
                        val vMed = setOf("van", "vong")
                        val hasMedial = current.let { c ->
                            val raw = c.pinyin?.replace(Regex("[0-9]"), "") ?: ""
                            val init = INITIALS.firstOrNull { raw.startsWith(it) }
                            val rest = if (init != null) raw.removePrefix(init) else raw
                            when (rest.firstOrNull()) {
                                'i' -> iMed.any { rest.startsWith(it) }
                                'u' -> uMed.any { rest.startsWith(it) }
                                'v' -> vMed.any { rest.startsWith(it) }
                                else -> false
                            }
                        } ?: false

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                        // 声母框（蓝色）
                        OutlinedTextField(
                            value = state.userInitial,
                            onValueChange = { viewModel.updateInitial(it) },
                            placeholder = { Text("声母", color = Color(0xFF42A5F5)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                            keyboardActions = KeyboardActions(onNext = {
                                if (hasMedial) focusMedial.requestFocus()
                                else focusFinal.requestFocus()
                            }),
                            modifier = Modifier
                                .weight(1f)
                                .focusRequester(focusInit)
                                .background(Color(0xFF42A5F5).copy(alpha = 0.2f), RoundedCornerShape(8.dp))
                        )
                        // 介母框（白色，仅在有介母时显示）
                        if (hasMedial) {
                            OutlinedTextField(
                                value = state.userMedial,
                                onValueChange = { viewModel.updateMedial(it) },
                                placeholder = { Text("介母", color = Color.Gray) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusFinal.requestFocus() }),
                                modifier = Modifier
                                    .weight(0.6f)
                                    .focusRequester(focusMedial)
                                    .background(Color.White.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                            )
                        }

                        OutlinedTextField(
                            value = state.userFinal,
                            onValueChange = { viewModel.updateFinal(it) },
                            placeholder = { Text("韵母", color = Color(0xFF66BB6A)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { viewModel.submitPinyin() }),
                            modifier = Modifier
                                .weight(1f)
                                .focusRequester(focusFinal)
                                .background(Color(0xFF66BB6A).copy(alpha = 0.2f), RoundedCornerShape(8.dp))
                        )  // 韵母框结束
                    }  // 结束 Row
                }  // 结束非零声母分支
            }  // 结束非整体认读分支

                Spacer(Modifier.height(8.dp))

                // 声调选择
                Text("选择声调:", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
                    val tones = listOf(1 to "̄", 2 to "ˊ", 3 to "̌", 4 to "ˋ", 5 to "轻声")
                    for ((num, label) in tones) {
                        FilterChip(
                            selected = state.userTone == num,
                            onClick = { viewModel.updateTone(if (state.userTone == num) 0 else num) },
                            label = { Text(label, fontSize = 13.sp) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = Color(0xFFFF9800).copy(alpha = 0.3f)
                            )
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
            }

            // 提交/重试/朗读按钮行
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 发音按钮
                if (state.isCorrect != true) {
                    Button(
                        onClick = { onPlayTts(state.ttsHint.ifEmpty { currentChar }) },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.secondary
                        )
                    ) {
                        Text("🔊 听发音", fontSize = 14.sp)
                    }

                    // 录音评测按钮
                    if (state.isRecording) {
                        Button(
                            onClick = { onStopRecording() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error
                            )
                        ) {
                            Text("⏹ 停止", fontSize = 14.sp)
                        }
                    } else {
                        Button(
                            onClick = { onStartRecording(currentChar) },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.tertiary
                            )
                        ) {
                            Text("🎤 读字", fontSize = 14.sp)
                        }
                    }
                }

                val allFilled = if (!state.pinyinPassed) {
                    val rawPinyin = current.pinyin?.replace(Regex("[0-9]"), "") ?: ""
                    val isOverall = rawPinyin in setOf("zhi","chi","shi","ri","zi","ci","si","yi","wu","yu","ye","yue","yuan","yin","yun","ying")
                    val hasInit = INITIALS.any { rawPinyin.startsWith(it) }
                    val zeroInit = !isOverall && !hasInit
                    val m = if (!isOverall && hasInit) {
                        val init = INITIALS.first { rawPinyin.startsWith(it) }
                        val rest = rawPinyin.removePrefix(init)
                        val iMed = setOf("iong", "iang", "iao", "ian", "ia")
                        val uMed = setOf("uang", "uai", "uan", "uo", "ua")
                        val vMed = setOf("van", "vong")
                        when (rest.firstOrNull()) {
                            'i' -> iMed.any { rest.startsWith(it) }
                            'u' -> uMed.any { rest.startsWith(it) }
                            'v' -> vMed.any { rest.startsWith(it) }
                            else -> false
                        }
                    } else false

                    val initialOk = isOverall || zeroInit || state.userInitial.isNotBlank()
                    val medialOk = !m || state.userMedial.isNotBlank()
                    val finalOk = state.userFinal.isNotBlank()
                    val toneOk = state.userTone != 0
                    initialOk && medialOk && finalOk && toneOk
                } else false

                // 提交按钮 — 通过后隐藏
                if (!state.pinyinPassed) {
                    Button(
                        onClick = { viewModel.submitPinyin() },
                        enabled = allFilled && !state.pinyinPassed
                    ) {
                        Text("提交", fontSize = 14.sp)
                    }
                }

                if (state.pinyinErrorCount > 0) {
                    Button(
                        onClick = { viewModel.retry() },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Text("重新填写", fontSize = 14.sp)
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            // 错误计数
            if (state.pinyinErrorCount > 0 && state.isCorrect != true) {
                Text(
                    text = "❌ ${state.pinyinErrorCount}/${RecognitionViewModel.Companion.MAX_ERRORS}",
                    fontSize = 16.sp,
                    color = MaterialTheme.colorScheme.error
                )
            }

            // 消息提示（仅在无结果反馈时显示，避免重复）
            if (state.message.isNotEmpty() && state.isCorrect == null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = state.message,
                    fontSize = 14.sp,
                    color = when {
                        state.message.contains("失败") -> MaterialTheme.colorScheme.error
                        state.message.contains("得分") -> Color(0xFF4CAF50)
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            }

            // 结果反馈
            if (state.isCorrect != null) {
                Spacer(Modifier.height(12.dp))
                if (state.isCorrect == true) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "✅ 正确！",
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF4CAF50)
                        )
                        if (state.message.isNotEmpty()) {
                            Text(
                                text = state.message,
                                fontSize = 14.sp,
                                color = Color(0xFF4CAF50)
                            )
                        }
                    }
                } else if (state.pinyinPassed && !state.pronunciationPassed) {
                    // 拼音已对，读音未达标
                    Text(
                        text = "📢 ${state.message.ifEmpty { "读音不达标" }}",
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.error
                    )
                } else if (state.pronunciationPassed && !state.pinyinPassed) {
                    // 读音已达标，拼音未对
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "🎤 读音达标",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF4CAF50).copy(alpha = 0.8f)
                        )
                        Text(
                            text = state.message.ifEmpty { "还需填写正确拼音" },
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = state.message.ifEmpty { "❌ 答错了，再试一次" },
                            fontSize = 16.sp,
                            color = MaterialTheme.colorScheme.error
                        )
                        if (state.message.isNotEmpty()) {
                            Text(
                                text = state.message,
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }

            // 提示按钮（3次错误后激活）
            if (state.hintActivated && !state.showHint && state.isCorrect != true) {
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = { viewModel.showHint() },
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.tertiary
                    )
                ) {
                    Text("💡 提示", fontSize = 16.sp)
                }
            }

            // 提示内容
            if (state.showHint && state.hintContent != null) {
                Spacer(Modifier.height(12.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer
                    )
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        val hint = state.hintContent!!
                        Text("相关词语:", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(8.dp))
                        if (hint.words.isNotEmpty()) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                hint.words.forEach { word ->
                                    SuggestionChip(
                                        onClick = { onPlayTts(word) },
                                        label = { Text(word, fontSize = 16.sp, fontWeight = FontWeight.Bold) },
                                        icon = { Text("🔊", fontSize = 14.sp) }
                                    )
                                }
                            }
                        } else {
                            Text("暂无联想词语", fontSize = 14.sp)
                        }
                        Spacer(Modifier.height(4.dp))
                        Text("点击词语听发音", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            Spacer(Modifier.weight(1f))

            // 下一题按钮 — 两项都通过或错误次数超限
            if (state.pinyinPassed && state.pronunciationPassed || state.pinyinErrorCount >= RecognitionViewModel.Companion.MAX_ERRORS) {
                Button(
                    onClick = { viewModel.nextQuestion() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary
                    )
                ) {
                    Text(
                        if (state.currentIndex + 1 >= state.items.size) "完成" else "下一题 →",
                        fontSize = 18.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun ResultScreen(
    title: String,
    results: List<QuestionResult>,
    totalItems: Int,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val correctCount = results.count { it.isCorrect }
    val hintCount = results.count { it.usedHint }

    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(title, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))

        Text(
            text = "总分: $correctCount / $totalItems",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = if (correctCount == totalItems) Color(0xFF4CAF50)
            else MaterialTheme.colorScheme.primary
        )
        Spacer(Modifier.height(8.dp))
        Text("使用提示: $hintCount 次", fontSize = 16.sp)

        Spacer(Modifier.height(24.dp))

        // 错题列表
        val wrongItems = results.filter { !it.isCorrect }
        if (wrongItems.isNotEmpty()) {
            Text("错题回顾:", fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                wrongItems.forEach { r ->
                    Text(
                        text = "  ${r.char}  (答错 ${r.errorCount} 次)",
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        }

        Spacer(Modifier.height(32.dp))
        Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("返回", fontSize = 18.sp)
        }
    }
}

/** 彩色拼音方框 */
@Composable
private fun PinyinBox(text: String, color: Color) {
    if (text.isBlank()) return
    Box(
        modifier = Modifier
            .padding(2.dp)
            .background(color.copy(alpha = 0.3f), RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        Text(
            text = text,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = color.copy(alpha = 0.9f)
        )
    }
}

/** 简易拼音解析（客户端用，不依赖服务端） */
private data class SimplePinyin(
    val initial: String = "",
    val final: String = "",
    val display: String = "",
    val isOverall: Boolean = false,
)

private val INITIALS = listOf("zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
    "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w")
private val WHOLE = setOf("zhi", "chi", "shi", "ri", "zi", "ci", "si",
    "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying")

private fun parsePinyinSimple(input: String): SimplePinyin {
    val s = input.trim().lowercase().replace(Regex("[0-9]"), "")
    if (s.isEmpty()) return SimplePinyin()

    if (s in WHOLE) return SimplePinyin(display = s, isOverall = true)

    for (init in INITIALS) {
        if (s.startsWith(init)) {
            val fin = s.removePrefix(init)
            if (fin.isNotEmpty()) {
                return SimplePinyin(initial = init, final = fin, display = input)
            }
        }
    }
    // 零声母
    return SimplePinyin(initial = "", final = s, display = input)
}
