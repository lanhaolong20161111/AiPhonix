package com.example.ai.ui.aihomework

import com.example.ai.data.aihomework.AutoBrace
import com.example.ai.data.aihomework.AutoBuildResult
import com.example.ai.data.aihomework.BlockSuggestion
import com.example.ai.data.aihomework.BraceBlock
import com.example.ai.data.aihomework.BuildBlockItem
import com.example.ai.data.aihomework.BuilderBlock
import com.example.ai.data.aihomework.DynamicBlock
import com.example.ai.data.aihomework.MidPoint
import com.example.ai.data.aihomework.NodeCircleBlock
import com.example.ai.data.aihomework.PersonBlock
import com.example.ai.data.aihomework.SegmentBlock
import com.example.ai.data.aihomework.TextBlock
import com.example.ai.data.aihomework.ValueLabelBlock
import java.util.UUID
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 搭积木学习：画布纯函数逻辑（序列化/语义描述/移动/缩放/撤销栈）。
 * 全部无副作用，便于单元测试；UI 层只负责手势与绘制。
 */

fun newBlockId(): String = UUID.randomUUID().toString().take(8)

/** 内置积木创建（组件栏点击 → 加到画布） */
fun newSegmentBlock(dashed: Boolean = false): SegmentBlock = SegmentBlock(
    id = newBlockId(),
    dashed = dashed,
)

fun newBraceBlock(direction: String): BraceBlock = BraceBlock(
    id = newBlockId(),
    direction = direction,
)

fun newNodeCircleBlock(): NodeCircleBlock = NodeCircleBlock(id = newBlockId())

fun newValueLabelBlock(): ValueLabelBlock = ValueLabelBlock(id = newBlockId())

fun newTextBlock(): TextBlock = TextBlock(id = newBlockId())

/** 小人积木（可磁吸到线段端点） */
fun newPersonBlock(): PersonBlock = PersonBlock(id = newBlockId())

/** LLM 动态积木 → 画布积木（复制建议参数） */
fun newDynamicBlock(suggestion: BlockSuggestion): DynamicBlock = DynamicBlock(
    id = newBlockId(),
    type = suggestion.type,
    name = suggestion.name,
    params = suggestion.params,
    note = suggestion.usage,
)

/**
 * 新积木放置：与画布上【同类型】积木错开位置（默认位置依次向下排，每 7 个换一列），
 * 从源头避免新建组件重叠（重叠后难以选择/拖动）。
 */
fun placeNewBlock(block: BuilderBlock, others: List<BuilderBlock>): BuilderBlock {
    val sameType = others.count { it::class == block::class }
    if (sameType == 0) return block
    val col = sameType / 7
    val row = sameType % 7
    return block.withPos(
        (block.x + col * 0.15f).coerceIn(0f, 1f),
        (block.y + row * 0.11f).coerceIn(0f, 1f),
    )
}

/**
 * 小学常用单位换算表：类型 → (单位 → 相对该类型最小单位的倍率)。
 * 仅用于线段长度比例比较（同类型单位才比较长短）。
 */
private val UNIT_CONVERSIONS: Map<String, Map<String, Double>> = mapOf(
    "length" to mapOf(
        "毫米" to 1.0, "厘米" to 10.0, "分米" to 100.0, "米" to 1000.0,
        "千米" to 1_000_000.0, "公里" to 1_000_000.0,
        "mm" to 1.0, "cm" to 10.0, "dm" to 100.0, "m" to 1000.0, "km" to 1_000_000.0,
    ),
    "time" to mapOf(
        "秒" to 1.0, "分" to 60.0, "分钟" to 60.0, "时" to 3600.0, "小时" to 3600.0,
        "s" to 1.0, "min" to 60.0, "h" to 3600.0,
    ),
    "money" to mapOf(
        "分" to 1.0, "角" to 10.0, "元" to 100.0,
    ),
    "weight" to mapOf(
        "克" to 1.0, "千克" to 1000.0, "公斤" to 1000.0, "斤" to 500.0,
        "g" to 1.0, "kg" to 1000.0,
    ),
    "volume" to mapOf(
        "毫升" to 1.0, "升" to 1000.0, "ml" to 1.0, "l" to 1000.0,
    ),
)

/**
 * 把两个线段的数量按单位换算到同一最小单位。
 * 返回 (a 归一化, b 归一化)；单位类型不同（如 元 vs 千克）返回 null，不比较。
 * 歧义单位（如 "分" 同时是时间和货币）：若两者都命中同一类型表则按该表换算，
 * 同单位（"分" vs "分"）任意表换算结果一致。
 */
internal fun convertToCommonUnit(
    unitA: String, valueA: Float, unitB: String, valueB: Float,
): Pair<Float, Float>? {
    val ua = unitA.trim()
    val ub = unitB.trim()
    if (ua == ub) return valueA to valueB // 同单位直接比较
    // 一方没填单位（如先填数值后填单位）→ 视为与另一方同单位，直接按数值比
    if (ua.isEmpty() || ub.isEmpty()) return valueA to valueB
    for (table in UNIT_CONVERSIONS.values) {
        val fa = table[ua]
        val fb = table[ub]
        if (fa != null && fb != null) {
            return (valueA * fa).toFloat() to (valueB * fb).toFloat()
        }
    }
    return null // 不同类型单位：不比
}

/**
 * 线段数值输入校验：空（未知量）或合法数字（整数/小数/负数）。
 */
fun isValidNumber(s: String): Boolean {
    val t = s.trim()
    if (t.isEmpty()) return true
    return Regex("^-?\\d+(\\.\\d+)?$").matches(t)
}

/**
 * 单位输入校验：空或仅中文字符/英文字母（如 米、厘米、kg、个、本）。
 * 非法：数字、标点、符号、空格等（如 "1米"、"米!"、"m 2"）。
 */
fun isValidUnit(s: String): Boolean {
    val t = s.trim()
    if (t.isEmpty()) return true
    return Regex("^[a-zA-Z\\u4e00-\\u9fa5]+$").matches(t)
}

/**
 * 同类型（可换算单位）且有数值的线段组：返回参考线段 + 各线段归一化数值。
 * 归一化基准 = 第一根有值线段的单位；空单位视为与参考同单位；不同类型单位不参与组。
 */
internal fun segmentGroup(blocks: List<BuilderBlock>): Pair<SegmentBlock, List<Pair<SegmentBlock, Float>>>? {
    val segs = blocks.filterIsInstance<SegmentBlock>()
        .filter { it.value.toFloatOrNull()?.let { v -> v > 0f } == true }
    if (segs.isEmpty()) return null
    val ref = segs.first()
    val refUnit = ref.unit.trim()
    val items = mutableListOf<Pair<SegmentBlock, Float>>()
    for (s in segs) {
        val v = s.value.toFloat()
        val norm = when {
            s.unit.trim() == refUnit || refUnit.isEmpty() || s.unit.isBlank() -> v
            else -> {
                // 换算到参考单位：v × factor(s) / factor(ref)
                val common = convertToCommonUnit(refUnit, 1f, s.unit, v) ?: continue
                common.second / common.first
            }
        }
        items.add(s to norm)
    }
    if (items.isEmpty()) return null
    return ref to items
}

/**
 * 大模型线段图初始指令 → 画布初始积木：
 * - 每个数量 → 线段（长度按数值比例、左端对齐、自上而下；未知量红色虚线中等长度）
 * - times 关系 → 主体线段分成 N 段（倍数）
 * - diff 差值 → 下方生成虚线差值线段（label=差值文本）
 * - brace 大括号 → 分量下方生成向下大括号（一共）
 */
fun autoBlocksFrom(r: AutoBuildResult): List<BuilderBlock> {
    val out = mutableListOf<BuilderBlock>()
    val byName = mutableMapOf<String, SegmentBlock>()
    val maxValue = r.segments.mapNotNull { it.value }.maxOrNull() ?: 0f
    r.segments.forEachIndexed { i, s ->
        if (s.label.isBlank()) return@forEachIndexed
        val w = if (s.value != null && maxValue > 0f) {
            (s.value!! / maxValue * 0.6f).coerceIn(0.12f, 0.6f)
        } else {
            0.45f // 未知量：中等长度
        }
        val seg = SegmentBlock(
            id = newBlockId(),
            x = 0.15f + w / 2f, // 左端对齐
            y = (0.12f + i * 0.13f).coerceAtMost(0.85f),
            w = w,
            label = s.label,
            value = if (s.value != null) fmtAutoNum(s.value!!) else "",
            unit = s.unit,
        )
        byName[s.label] = seg
        out.add(seg)
    }
    // times：a 是 b 的几倍 → 分段
    r.times?.let { t ->
        val a = byName[t.a.trim()]
        val b = byName[t.b.trim()]
        val av = a?.value?.toFloatOrNull()
        val bv = b?.value?.toFloatOrNull()
        if (a != null && av != null && bv != null && bv > 0f) {
            val n = (av / bv).roundToInt().coerceIn(2, 12)
            val idx = out.indexOfFirst { (it as? SegmentBlock)?.id == a.id }
            if (idx >= 0) out[idx] = (out[idx] as SegmentBlock).copy(times = n)
        }
    }
    // diff：差值虚线线段（放在数量线段下方）
    r.diff?.let { d ->
        if (d.value > 0f && d.text.isNotBlank()) {
            val yBase = 0.12f + r.segments.size * 0.13f
            out.add(
                SegmentBlock(
                    id = newBlockId(),
                    x = 0.35f,
                    y = yBase.coerceAtMost(0.85f),
                    w = 0.3f,
                    label = d.text,
                    value = fmtAutoNum(d.value),
                    unit = "",
                    dashed = true,
                ),
            )
        }
    }
    // brace：底部大括号（分量下方）
    r.brace?.let { br ->
        val parts = br.parts.map { it.trim() }.filter { byName.containsKey(it) }
        if (parts.isNotEmpty()) {
            val segs = parts.mapNotNull { byName[it] }
            val cx = segs.map { it.x }.average().toFloat().coerceIn(0.2f, 0.8f)
            val maxY = segs.maxOf { it.y }
            out.add(
                BraceBlock(
                    id = newBlockId(),
                    x = cx,
                    y = (maxY + 0.1f).coerceAtMost(0.92f),
                    w = 0.5f,
                    direction = "down",
                    label = br.label.ifBlank { "一共" },
                ),
            )
        }
    }
    return out
}

private fun fmtAutoNum(v: Float): String {
    val r = (v * 1000).roundToInt() / 1000f
    return if (r == r.toLong().toFloat()) r.toLong().toString() else r.toString()
}

/**
 * 线段长度全局等比缩放（无固定基准）：
 * 同类型（可换算单位）有数值的线段长度 = 比例系数 k × 归一化数值。
 * - 传入 k ≤ 0（初始/未知）→ 最长线段贴 0.9 画布宽，并返回该 k 供后续使用
 * - 传入 k（用户设定/拖手柄/两指缩放得到的）→ 保持该 k；长度 = k × 数值
 * - **增加段（extra）计入总长**：画布上限按「主段 + 绿色延长段」判断
 * - 任何线段不得超过画布（w ≤ 1）：超长时**仅本次显示**整体等比缩小，
 *   **不改写 k**——数值改小后比例自动恢复正常
 * - 返回 (新 blocks, k)；k 只在初始或用户主动缩放（拖手柄/两指）时更新
 * 未知量（value 空）、非线段积木、不同类型单位的线段不动。
 */
fun rescaleSegmentLengths(
    blocks: List<BuilderBlock>,
    kIn: Float = -1f,
): Pair<List<BuilderBlock>, Float> {
    val group = segmentGroup(blocks) ?: return blocks to kIn
    val items = group.second
    // 总长归一化 = value + extra（extra 与 value 同单位）
    val maxTotal = items.maxOf { (seg, norm) -> norm + seg.extra.coerceAtLeast(0f) }
    if (maxTotal <= 0f) return blocks to kIn
    val k = if (kIn > 0f) kIn else 0.9f / maxTotal
    // 超画布：仅本次显示缩放，k 保持不变（下次数值改小即恢复）
    val displayScale = if (k * maxTotal > 1f) 1f / (k * maxTotal) else 1f
    val wById = buildMap {
        for ((seg, norm) in items) put(seg.id, (k * norm * displayScale).coerceAtLeast(0.04f)) // 最小可见
    }
    val out = blocks.map { b ->
        if (b is SegmentBlock) {
            val nw = wById[b.id]
            if (nw != null && nw != b.w) b.copy(w = nw) else b
        } else {
            b
        }
    }
    return out to k
}

/** 移动：dx/dy 为归一化增量（UI 将像素增量除以画布尺寸后传入），边界收拢到 0..1 */
fun moveBlock(block: BuilderBlock, dx: Float, dy: Float): BuilderBlock =
    block.withPos((block.x + dx).coerceIn(0f, 1f), (block.y + dy).coerceIn(0f, 1f))

/**
 * 磁吸：拖动中的积木与画布上【同类型】积木靠近时自动对齐。
 * 线段/文本/数值/大括号(上下) = 水平跨度类：**仅两端点磁吸**（拖动块左/右端 vs 目标块左/右端，
 * x、y 都接近才吸附，端点对齐端点；中点/整条线不吸附）；
 * 大括号(左右) = 垂直跨度类：仅上下端点磁吸；
 * 节点圆 = 点类：圆心 x/y 对齐。
 * 阈值 thresholdPx 转归一化比较；没有够近的候选返回原积木（不吸附）。
 */
fun snapBlock(
    block: BuilderBlock,
    others: List<BuilderBlock>,
    canvasW: Float,
    canvasH: Float,
    thresholdPx: Float,
): BuilderBlock {
    if (canvasW <= 0f || canvasH <= 0f) return block
    val tx = thresholdPx / canvasW
    val ty = thresholdPx / canvasH
    // 小人：磁吸到【所有线段】的左右端点（不是同类型磁吸）
    if (block is PersonBlock) return snapPersonToSegment(block, others, tx, ty)
    val candidates = others.filter { it.id != block.id && it::class == block::class }
    if (candidates.isEmpty()) return block
    return when {
        block is NodeCircleBlock -> snapPointAlign(block, candidates, tx, ty)
        block is BraceBlock && block.direction in setOf("left", "right") ->
            snapVerticalSpan(block, candidates, tx, ty)
        else -> snapHorizontalSpan(block, candidates, tx, ty)
    }
}

/** 小人磁吸：靠近任意线段左/右端点（视觉端点，含倍数/延长段）时吸附到端点 */
private fun snapPersonToSegment(
    person: PersonBlock,
    others: List<BuilderBlock>,
    tx: Float,
    ty: Float,
): BuilderBlock {
    var best = Float.MAX_VALUE
    var result: BuilderBlock? = null
    for (b in others) {
        if (b !is SegmentBlock) continue
        val left = b.x - segmentVisualWidth(b) / 2f
        val right = b.x + segmentVisualWidth(b) / 2f
        for (ex in listOf(left, right)) {
            val dx = abs(person.x - ex)
            if (dx < 0.003f) continue // 已重合：不吸（可自由拖开）
            if (dx >= tx) continue
            val dy = abs(person.y - b.y)
            if (dy >= ty) continue
            val dist = dx + dy
            if (dist < best) {
                best = dist
                result = person.withPos(ex.coerceIn(0f, 1f), b.y)
            }
        }
    }
    return result ?: person
}

private fun snapHorizontalSpan(block: BuilderBlock, candidates: List<BuilderBlock>, tx: Float, ty: Float): BuilderBlock {
    // 仅两端点磁吸：拖动块左/右端 vs 目标块左/右端，x、y 都接近才吸附（取最近的一组）。
    // 跳过已完全重合的端点（dx 极小）——否则重叠中的线段永远被吸住无法拖开。
    var best = Float.MAX_VALUE
    var result: BuilderBlock? = null
    val myLeft = block.x - block.w / 2f
    val myRight = block.x + block.w / 2f
    for (c in candidates) {
        val cLeft = c.x - c.w / 2f
        val cRight = c.x + c.w / 2f
        for ((mx, targetX) in listOf(myLeft to cLeft, myLeft to cRight, myRight to cLeft, myRight to cRight)) {
            val dx = abs(mx - targetX)
            if (dx < 0.003f) continue // 已重合：不吸（可自由拖开）
            if (dx >= tx) continue
            val dy = abs(block.y - c.y)
            if (dy >= ty) continue
            val dist = dx + dy
            if (dist < best) {
                best = dist
                result = block.withPos((block.x - (mx - targetX)).coerceIn(0f, 1f), c.y)
            }
        }
    }
    return result ?: block
}

private fun snapVerticalSpan(block: BuilderBlock, candidates: List<BuilderBlock>, tx: Float, ty: Float): BuilderBlock {
    // 仅上下端点磁吸（左右开口大括号）：拖动块上/下端 vs 目标块上/下端
    var best = Float.MAX_VALUE
    var result: BuilderBlock? = null
    val myTop = block.y - block.w / 2f
    val myBottom = block.y + block.w / 2f
    for (c in candidates) {
        val cTop = c.y - c.w / 2f
        val cBottom = c.y + c.w / 2f
        for ((my, targetY) in listOf(myTop to cTop, myTop to cBottom, myBottom to cTop, myBottom to cBottom)) {
            val dy = abs(my - targetY)
            if (dy < 0.003f) continue // 已重合：不吸
            if (dy >= ty) continue
            val dx = abs(block.x - c.x)
            if (dx >= tx) continue
            val dist = dx + dy
            if (dist < best) {
                best = dist
                result = block.withPos(c.x, (block.y - (my - targetY)).coerceIn(0f, 1f))
            }
        }
    }
    return result ?: block
}

private fun snapPointAlign(block: BuilderBlock, candidates: List<BuilderBlock>, tx: Float, ty: Float): BuilderBlock {
    var x = block.x
    var y = block.y
    var bestX = tx
    var newX = block.x
    for (c in candidates) {
        val d = abs(c.x - block.x)
        if (d < 0.003f) continue // 已重合：不吸
        if (d < bestX) { bestX = d; newX = c.x }
    }
    var bestY = ty
    var newY = block.y
    for (c in candidates) {
        val d = abs(c.y - block.y)
        if (d < 0.003f) continue // 已重合：不吸
        if (d < bestY) { bestY = d; newY = c.y }
    }
    return block.withPos(newX.coerceIn(0f, 1f), newY.coerceIn(0f, 1f))
}

/** 调节长短：w 为归一化跨度（大括号两端距离/线段长度/文本宽度），收拢到 [0.08, 1] */
fun resizeBlock(block: BuilderBlock, newW: Float): BuilderBlock =
    block.withWidth(newW.coerceIn(0.08f, 1f))

/** 画布积木 → 提交服务端审核的条目（kind 映射 + 语义描述 note，LLM 审核依据） */
fun toBuildItems(blocks: List<BuilderBlock>): List<BuildBlockItem> = blocks.map { b ->
    when (b) {
        is SegmentBlock -> BuildBlockItem(
            kind = if (b.dashed) "dashed_segment" else "segment",
            label = b.label,
            value = b.value,
            unit = b.unit,
            color = b.color,
            segments = b.segments,
            times = b.times,
            extra = b.extra,
            extraDir = b.extraDir,
            note = when {
                b.dashed -> "虚线线段「${b.label}」${fmtValue(b.value, b.unit)}（差值/关系标注）"
                b.times > 1 ->
                    "倍线段「${b.label}」：${b.times} 段等长复制拼接（${b.times} 倍关系，每段 = 总量÷${b.times}）"
                b.segments > 1 -> {
                    val v = b.value.toFloatOrNull()
                    if (v != null && v > 0f) {
                        // 整数用整数除法算商/余（避免浮点误差）
                        val vInt = v.toLong()
                        val isInt = v == vInt.toFloat()
                        val segLen = if (isInt) (vInt / b.segments).toFloat() else v / b.segments
                        val rem = if (isInt) (vInt % b.segments).toFloat() else v - segLen * b.segments
                        if (rem > 0.001f) {
                            "线段「${b.label}」${fmtValue(b.value, b.unit)}" +
                                "（平均分成 ${b.segments} 份每份 ${fmtNum(segLen)}，余 ${fmtNum(rem)}${b.unit.trim()} 用橙色段表示）"
                        } else {
                            "线段「${b.label}」${fmtValue(b.value, b.unit)}（平均分成 ${b.segments} 份，总量不变）"
                        }
                    } else {
                        "线段「${b.label}」${fmtValue(b.value, b.unit)}（平均分成 ${b.segments} 份，总量不变）"
                    }
                }
                b.value.isBlank() -> "未知量线段「${b.label}」（题目所求）"
                else -> {
                    val base = "线段「${b.label}」${fmtValue(b.value, b.unit)}（已知量）" +
                        if (b.extra > 0f) {
                            val dir = if (b.extraDir == "left") "向左" else "向右"
                            "；另${dir}增加 ${fmtExtra(b.extra, b.unit)}（绿色虚线延长段）"
                        } else ""
                    base + endpointNote(b)
                }
            },        )
        is ValueLabelBlock -> BuildBlockItem(
            kind = "value_label", label = b.text, color = b.color,
            note = "数值标签「${b.text}」",
        )
        is NodeCircleBlock -> BuildBlockItem(
            kind = "node_circle", label = b.name, color = b.color,
            note = if (b.unknown) "未知量节点圆「${b.name}」（题目所求）" else "已知量节点圆「${b.name}」",
        )
        is TextBlock -> BuildBlockItem(
            kind = "text", label = b.text, color = b.color,
            note = "自由文本「${b.text}」",
        )
        is PersonBlock -> BuildBlockItem(
            kind = "person", label = b.name, color = b.color,
            note = if (b.name.isBlank()) "小人（表示一个人，通常放在线段端点表示谁的量）"
            else "小人「${b.name}」（表示这个人，通常放在线段端点表示谁的量）",
        )
        is BraceBlock -> BuildBlockItem(
            kind = "brace", label = b.label, color = b.color, direction = b.direction,
            note = "大括号开口${braceDirectionLabel(b.direction)}「${b.label.ifBlank { "" }}」（框住跨度内几个量，表示这些量合并/一共）",
        )
        is DynamicBlock -> BuildBlockItem(
            kind = "dynamic", label = b.name, color = b.defaultColor, type = b.type,
            note = dynamicSemantic(b),
        )
    }
}

private fun dynamicSemantic(b: DynamicBlock): String {
    val base = when (b.type) {
        "multi-segment" -> "分 ${b.segments} 段等长的结构（倍数/均分关系，每段表示一份）"
        "line" -> "连线/箭头"
        "rect" -> "矩形框（把几个量圈起来）"
        "circle" -> "圆"
        "text" -> "文本标注"
        "brace" -> "大括号"
        else -> "自定义结构（${b.type}）"
    }
    val usage = b.note.takeIf { it.isNotBlank() }?.let { "；用途：$it" } ?: ""
    return "动态积木「${b.name}」：$base$usage"
}

private fun braceDirectionLabel(direction: String): String = when (direction) {
    "up" -> "向上"; "left" -> "向左"; "right" -> "向右"; else -> "向下"
}

private fun fmtValue(value: String, unit: String): String =
    if (value.isBlank()) "" else "= $value$unit"

/** 端点名称补充描述：左端点：X，右端点：Y，中间端点（红点）+ 各小段数量 */
private fun endpointNote(b: SegmentBlock): String {
    val parts = mutableListOf<String>()
    if (b.leftLabel.isNotBlank()) parts.add("左端点：${b.leftLabel}")
    if (b.rightLabel.isNotBlank()) parts.add("右端点：${b.rightLabel}")
    if (b.midPoints.isNotEmpty()) {
        val pts = b.midPoints.mapNotNull { p ->
            p.pos.toFloatOrNull()?.let { it to p.label }
        }.filter { it.first > 0f }.sortedBy { it.first }
        if (pts.isNotEmpty()) {
            parts.add("中间端点：${pts.joinToString("、") { "「${it.second}」距左端 ${fmtNum(it.first)}" }}")
            // 各小段数量
            val v = b.value.toFloatOrNull()
            if (v != null && v > 0f) {
                val bounds = listOf(0f) + pts.map { it.first } + listOf(v)
                val segs = (0 until bounds.size - 1).map { i -> bounds[i + 1] - bounds[i] }
                parts.add("各段数量：${segs.joinToString("、") { fmtNum(it) }}${b.unit.trim()}")
            }
        }
    }
    return if (parts.isEmpty()) "" else "；" + parts.joinToString("，")
}

private fun fmtNum(v: Float): String {
    val r = (v * 1000).roundToInt() / 1000f // 千分位取整，消除浮点误差
    return if (r == r.toLong().toFloat()) r.toLong().toString() else r.toString()
}

/**
 * 解析中间端点输入："10=第一次, 30=第二次"（逗号/分号分隔，= 或 : 连接位置与名称）。
 * 返回 null = 格式非法。
 */
fun parseMidPoints(input: String): List<MidPoint>? {
    val t = input.trim()
    if (t.isEmpty()) return emptyList()
    val out = mutableListOf<MidPoint>()
    val groups = t.split(Regex("[;,，；]"))
    for (g in groups) {
        val s = g.trim()
        if (s.isEmpty()) continue
        val parts = s.split(Regex("[=:]"))
        if (parts.size < 1 || parts.size > 2) return null
        val pos = parts[0].trim()
        if (!isValidNumber(pos) || pos.toFloatOrNull()?.let { it < 0f } == true) return null
        val label = if (parts.size == 2) parts[1].trim() else ""
        if (label.isEmpty()) return null
        out.add(MidPoint(label = label, pos = pos))
    }
    if (out.isEmpty()) return null
    return out
}

/** 格式化中间端点为可编辑文本："10=第一次; 30=第二次" */
fun formatMidPoints(points: List<MidPoint>): String =
    points.joinToString("; ") { "${it.pos}=${it.label}" }

/**
 * 根据拖拽位置计算中间端点：
 * draftX 为画布归一化横坐标（0..1），mainWidth 为主段视觉宽（归一化，含 times 拼接）。
 * 从左端拖出 → pos = value × 相对位置；从右端拖出 → pos = value × (1 - 相对位置)。
 * 返回 MidPoint（label = 距离文本，如 "30米"）；非法返回 null。
 */
fun midPointFromDraft(
    seg: SegmentBlock,
    draftX: Float,
    fromRight: Boolean,
    mainWidth: Float,
): MidPoint? {
    val v = seg.value.toFloatOrNull() ?: return null
    if (v <= 0f || mainWidth <= 0f) return null
    val relX = ((draftX - (seg.x - mainWidth / 2f)) / mainWidth).coerceIn(0f, 1f)
    val pos = if (fromRight) v * (1f - relX) else v * relX
    if (pos <= 0f) return null
    val num = fmtNum(pos)
    return MidPoint(label = "$num${seg.unit.trim()}", pos = num)
}

internal fun fmtExtra(extra: Float, unit: String): String {
    val text = if (extra == extra.toLong().toFloat()) extra.toLong().toString() else extra.toString()
    return "$text${unit.trim()}"
}

/** 最上面的线段（y 最小；并列取列表靠前），作为对齐边界参照 */
internal fun topmostSegment(blocks: List<BuilderBlock>): SegmentBlock? =
    blocks.filterIsInstance<SegmentBlock>().minByOrNull { it.y }

/** 线段视觉总长（含倍数拼接与绿色延长段；extra 与 value 同单位假设） */
internal fun segmentVisualWidth(b: SegmentBlock): Float {
    val base = if (b.times > 1) b.w * b.times else b.w
    val v = b.value.toFloatOrNull()
    val extraW = if (b.extra > 0f && v != null && v > 0f) base * (b.extra / v) else 0f
    return base + extraW
}

/** 左对齐：所有线段左端对齐到【最上面线段】的左端（边界线不动） */
fun alignSegmentsLeft(blocks: List<BuilderBlock>): List<BuilderBlock> {
    val ref = topmostSegment(blocks) ?: return blocks
    val refLeft = ref.x - segmentVisualWidth(ref) / 2f
    return blocks.map { b ->
        if (b is SegmentBlock && b.id != ref.id) {
            b.copy(x = (refLeft + segmentVisualWidth(b) / 2f).coerceIn(0f, 1f))
        } else {
            b
        }
    }
}

/** 右对齐：所有线段右端对齐到【最上面线段】的右端（边界线不动） */
fun alignSegmentsRight(blocks: List<BuilderBlock>): List<BuilderBlock> {
    val ref = topmostSegment(blocks) ?: return blocks
    val refRight = ref.x + segmentVisualWidth(ref) / 2f
    return blocks.map { b ->
        if (b is SegmentBlock && b.id != ref.id) {
            b.copy(x = (refRight - segmentVisualWidth(b) / 2f).coerceIn(0f, 1f))
        } else {
            b
        }
    }
}

/** 撤销栈：push 在每次变更前快照，undo 恢复上一份 */
data class UndoStack(
    val history: List<List<BuilderBlock>> = emptyList(),
) {
    fun push(blocks: List<BuilderBlock>): UndoStack =
        copy(history = (history + listOf(blocks)).takeLast(30))

    fun undo(current: List<BuilderBlock>): Pair<List<BuilderBlock>, UndoStack> =
        if (history.isEmpty()) current to this
        else history.last() to copy(history = history.dropLast(1))

    fun clear(): UndoStack = copy(history = emptyList())
}
