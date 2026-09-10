package com.example.ai.ui.aihomework

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.ai.data.aihomework.QuestionItem
import com.example.ai.data.aihomework.QuantityItem
import com.example.ai.data.aihomework.QuantityRelation
import com.example.ai.data.aihomework.SentenceInfo
import com.example.ai.data.aihomework.SolutionStep
import java.util.Locale

// ── 本地校验纯函数（可单测） ──────────────────────────────

/**
 * 回答某问需要的量（来自 LLM needs；为空时退化为该问 target 本身，避免空引导）。
 */
internal fun needsFor(q: QuestionItem): List<String> {
    val needs = q.needs.map { it.trim() }.filter { it.isNotEmpty() }
    return if (needs.isNotEmpty()) needs else if (q.target.isNotBlank()) listOf(q.target) else emptyList()
}

/**
 * 期望答案：target 实体（含推算链）的数值；算不出返回 null（引导退化为自由作答）。
 */
internal fun expectedValueOf(
    target: String,
    quantities: List<QuantityItem>,
    relations: List<QuantityRelation>,
): Float? {
    if (target.isBlank()) return null
    val item = findItem(target, quantities) ?: return null
    return effectiveValue(item, quantities, relations)
}

/** 答案校验：绝对误差或相对误差任一达标即对（小学题允许小偏差） */
internal fun checkAnswer(user: String, expected: Float): Boolean {
    val v = user.trim().toFloatOrNull() ?: return false
    val abs = kotlin.math.abs(v - expected)
    return abs <= 0.01f || abs <= expected * 0.01f
}

/** 候选干扰项：其他问题的 needs + 实体名里不在本问 needs 的（最多 6 个，去重保序） */
internal fun distractorCandidates(
    q: QuestionItem,
    allQuestions: List<QuestionItem>,
    quantities: List<QuantityItem>,
): List<String> {
    val own = q.needs.toSet()
    val out = LinkedHashSet<String>()
    allQuestions.forEach { other ->
        if (other !== q) other.needs.forEach { n ->
            val t = n.trim()
            if (t.isNotEmpty() && t !in own && t != q.target) out.add(t)
        }
    }
    quantities.forEach { itm -> if (itm.name !in own && itm.name != q.target) out.add(itm.name) }
    return out.take(6)
}

/** 名称匹配（与 findItem 一致：双向包含，容忍「足球」vs「足球个数」） */
internal fun nameMatches(name: String, candidates: Iterable<String>): Boolean =
    candidates.any { it == name || it.contains(name) || name.contains(it) }

internal fun sourceSentenceFor(need: String, sentences: List<SentenceInfo>): String? =
    sentences.firstOrNull { s -> nameMatches(need, listOf(s.text)) || Regex("\\d+(\\.\\d+)?").containsMatchIn(s.text) && s.text.contains(need.take(2)) }
        ?.text

// ── 倒推引导 UI（状态机：需要什么 → 从哪来 → 怎么算 → 填答案） ──

private enum class GuidePhase { PickNeeds, SeeSource, SeeHint, EnterAnswer, Done }

private val GuideBlue = Color(0xFF1565C0)
private val GuideBg = Color(0xFFE8F0FE)
private val GuideOk = Color(0xFF2E7D32)
private val GuideWarn = Color(0xFFC62828)

/**
 * 面向问题的倒推引导卡片：从问题出发，一步步引导学生想清楚
 * ① 需要知道什么 → ② 从哪句话来 → ③ 怎么算 → ④ 算出答案。
 * 纯本地状态机（hint 来自 analyze 的 LLM 提取，答案校验用本地链式推算），不额外调网络。
 */
@Composable
fun ReverseGuideCard(
    question: QuestionItem,
    index: Int,
    allQuestions: List<QuestionItem>,
    quantities: List<QuantityItem>,
    relations: List<QuantityRelation>,
    sentences: List<SentenceInfo>,
    steps: List<SolutionStep> = emptyList(),       // 分步解题链（LLM 生成；空 = 回退 hint 一句话模式）
    loadingSteps: Boolean = false,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val needs = remember(question) { needsFor(question) }
    val expected = remember(question, quantities, relations) {
        expectedValueOf(question.target, quantities, relations)
    }
    var phase by remember(question) { mutableStateOf(GuidePhase.PickNeeds) }
    var picked by remember(question) { mutableStateOf(setOf<String>()) }
    var feedback by remember(question) { mutableStateOf("") }
    var userAnswer by remember(question) { mutableStateOf("") }
    var tries by remember(question) { mutableStateOf(0) }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = GuideBg),
        border = BorderStroke(1.dp, GuideBlue.copy(alpha = 0.4f)),
    ) {
        Column(Modifier.padding(12.dp)) {
            // 标题行
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "🎯 第 ${index + 1} 问 · 倒推挑战",
                    style = MaterialTheme.typography.titleSmall,
                    color = GuideBlue,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "退出",
                    style = MaterialTheme.typography.bodySmall,
                    color = GuideBlue,
                    modifier = Modifier
                        .clickable(onClick = onExit)
                        .padding(4.dp),
                )
            }
            Spacer(Modifier.height(2.dp))
            Text(
                question.text,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(8.dp))

            when (phase) {
                GuidePhase.PickNeeds -> {
                    Text("先别急着算。要回答这个问题，需要先知道哪些量？", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(6.dp))
                    val candidates = remember(question) {
                        (needs + distractorCandidates(question, allQuestions, quantities)).distinct().take(8)
                    }
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        candidates.forEach { c ->
                            val on = c in picked
                            Surface(
                                onClick = { picked = if (on) picked - c else picked + c },
                                shape = RoundedCornerShape(14.dp),
                                color = if (on) GuideBlue else Color(0xFFFAFAFA),
                                border = BorderStroke(1.dp, if (on) GuideBlue else MaterialTheme.colorScheme.outlineVariant),
                            ) {
                                Text(
                                    c,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (on) Color.White else MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = {
                            val ok = needs.isNotEmpty() && needs.all { n -> nameMatches(n, picked) } &&
                                picked.size == needs.size
                            if (ok) {
                                phase = GuidePhase.SeeSource
                                feedback = ""
                            } else {
                                tries++
                                feedback = if (tries >= 2) {
                                    "提示：看看哪个量是题目已经告诉你的，哪个是问的？想想“要算出 ${question.target}，必须先知道什么”。"
                                } else {
                                    "还差一点哦。再想想：缺了哪个量，${question.target} 就算不出来？"
                                }
                            }
                        },
                        enabled = picked.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("确认我选好了") }
                    if (feedback.isNotEmpty()) {
                        Spacer(Modifier.height(6.dp))
                        Text(feedback, style = MaterialTheme.typography.bodySmall, color = GuideWarn)
                    }
                }

                GuidePhase.SeeSource -> {
                    Text("这些量从哪里来？", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    needs.forEach { n ->
                        val src = sourceSentenceFor(n, sentences)
                        Text("• $n", style = MaterialTheme.typography.bodyMedium, color = GuideBlue)
                        if (src != null) {
                            Text("　← “$src”", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            Text("　← 从题目条件里找（想想哪句话提到了它）", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Spacer(Modifier.height(4.dp))
                    }
                    Spacer(Modifier.height(4.dp))
                    Button(onClick = { phase = GuidePhase.SeeHint }, modifier = Modifier.fillMaxWidth()) {
                        Text("我知道了，下一步")
                    }
                }

                GuidePhase.SeeHint -> {
                    if (loadingSteps) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("AI 老师在拆解题步骤…", style = MaterialTheme.typography.bodySmall)
                        }
                    } else if (steps.isNotEmpty()) {
                        StepClimbGuide(steps = steps, onExit = onExit)
                    } else {
                        Text("那怎么算呢？", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            if (question.hint.isNotBlank()) "💡 " + question.hint else "先想想这些量之间是什么关系（多/少/倍/合起来），再用数量关系列算式。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "自己动笔算一算，别让 AI 替你算哦。",
                            style = MaterialTheme.typography.bodySmall,
                            color = GuideWarn,
                        )
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { phase = GuidePhase.EnterAnswer }, modifier = Modifier.fillMaxWidth()) {
                            Text("我算好了，填答案")
                        }
                    }
                }

                GuidePhase.EnterAnswer -> {
                    Text("你的答案是多少？", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    OutlinedTextField(
                        value = userAnswer,
                        onValueChange = { userAnswer = it },
                        label = { Text("填数字（如 8）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = {
                            val expected = expected
                            if (expected != null && checkAnswer(userAnswer, expected)) {
                                phase = GuidePhase.Done
                                feedback = ""
                            } else {
                                tries++
                                feedback = if (expected == null) {
                                    "AI 老师还没算出标准答案，先按你的思路算，算完对照关系图再检查一遍。"
                                } else {
                                    "再检查一下你的算式哦。想想：${question.hint}"
                                }
                            }
                        },
                        enabled = userAnswer.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("提交答案") }
                    if (feedback.isNotEmpty()) {
                        Spacer(Modifier.height(6.dp))
                        Text(feedback, style = MaterialTheme.typography.bodySmall, color = GuideWarn)
                    }
                }

                GuidePhase.Done -> {
                    Text(
                        "✅ 答对了！思路清楚，继续加油！",
                        style = MaterialTheme.typography.bodyLarge,
                        color = GuideOk,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        if (index + 1 < allQuestions.size)
                            "下一问会用到现在的结果，记得记住 ${question.target} 是多少。"
                        else "这道题的所有问题都挑战完了，真棒！",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    Row {
                        OutlinedButton(onClick = onExit, modifier = Modifier.weight(1f)) { Text("关闭引导") }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = onExit, modifier = Modifier.weight(1f)) {
                            Text(if (index + 1 < allQuestions.size) "挑战下一问" else "完成 🎉")
                        }
                    }
                }
            }
        }
    }
}

/** 分步闯关引导：每一步先让学生算中间结果，对了才展开算式与逻辑讲解 */
@Composable
private fun StepClimbGuide(
    steps: List<SolutionStep>,
    onExit: () -> Unit,
) {
    var stepIndex by remember(steps) { mutableStateOf(0) }
    var input by remember(steps) { mutableStateOf("") }
    var revealed by remember(steps) { mutableStateOf(false) }
    var tries by remember(steps) { mutableStateOf(0) }
    var done by remember(steps) { mutableStateOf(false) }
    var completed by remember(steps) { mutableStateOf(listOf<SolutionStep>()) }

    if (done) {
        Text(
            "🎉 闯关成功！整道题从头到尾都是你自己算出来的！",
            style = MaterialTheme.typography.bodyLarge,
            color = GuideOk,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "整道题从头到尾都是你自己算出来的！",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        Spacer(Modifier.height(8.dp))
        Button(onClick = onExit, modifier = Modifier.fillMaxWidth()) { Text("完成 🎉") }
        return
    }

    val step = steps[stepIndex]
    val numeric = step.result.toFloatOrNull()  // 数字步需要学生填中间结果；结论文字步直接展示讲解
    val isLast = stepIndex == steps.lastIndex

    // 进度条：第几关
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "第 ${stepIndex + 1}/${steps.size} 关",
            style = MaterialTheme.typography.labelMedium,
            color = GuideBlue,
        )
        Spacer(Modifier.width(8.dp))
        LinearProgressIndicator(
            progress = { (stepIndex + (if (revealed) 1f else 0f)) / steps.size },
            modifier = Modifier.weight(1f).height(6.dp),
            color = GuideBlue,
            trackColor = GuideBlue.copy(alpha = 0.15f),
        )
    }
    Spacer(Modifier.height(8.dp))

    if (numeric != null) {
        // 数字步：先让学生自己算
        Text(
            "这一关要先算出：${step.purpose}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        if (revealed) {
            // 闯关成功：展开算式与逻辑讲解，并实时画出这条线段
            Text(
                "算式：${step.formula} = $input${step.resultUnit}",
                style = MaterialTheme.typography.bodyMedium,
                color = GuideBlue,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "为什么这样算：${step.explain}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(6.dp))
                Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    stepIndex++
                    input = ""
                    revealed = false
                    tries = 0
                    if (stepIndex >= steps.size) done = true
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (isLast) "看完啦" else "下一关") }
        } else {
            // 未闯过：让学生填中间结果
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                label = { Text("这一步的结果是？（${step.resultUnit.ifBlank { "数字" }}）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    if (checkAnswer(input, numeric)) {
                        revealed = true
                        completed = completed + step
                        tries = 0
                    } else {
                        tries++
                    }
                },
                enabled = input.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("提交") }
            if (tries == 1) {
                Spacer(Modifier.height(6.dp))
                Text("不对哦，再检查一下这一步该用什么数量关系。", style = MaterialTheme.typography.bodySmall, color = GuideWarn)
            } else if (tries >= 2) {
                Spacer(Modifier.height(6.dp))
                Text("提示：${step.explain}", style = MaterialTheme.typography.bodySmall, color = GuideWarn)
            }
        }
    } else {
        // 结论文字步：展示目的 + 判断依据；进入即解锁画入线段图
        LaunchedEffect(stepIndex) {
            if (completed.none { it.purpose == step.purpose && it.result == step.result }) {
                completed = completed + step
            }
        }
        Text(
            "最后一关：${step.purpose}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "依据：${step.explain}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "结论：${step.result}",
            style = MaterialTheme.typography.bodyLarge,
            color = GuideBlue,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = {
                if (isLast) done = true
                else {
                    stepIndex++
                    input = ""
                    revealed = false
                    tries = 0
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (isLast) "完成 🎉" else "下一关") }
    }
}

/** 答案数字本地格式化辅助（与图内一致） */
private fun fmtNum(v: Float): String =
    if (v == kotlin.math.floor(v) && !v.isInfinite()) String.format(Locale.US, "%.0f", v) else String.format(Locale.US, "%.1f", v)
