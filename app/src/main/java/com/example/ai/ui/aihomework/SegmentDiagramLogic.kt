package com.example.ai.ui.aihomework

import com.example.ai.data.aihomework.QuantityItem
import com.example.ai.data.aihomework.QuantityRelation

// ── 线段图纯逻辑：关系归一化 + 链式数值推算 ──
// 与 Compose 无关，可独立单元测试（SegmentDiagram.kt 只负责画）。

/** 归一化后的关系视角：站在实体 q 上看，q 相对 base 是什么关系 */
internal data class RelView(
    val type: String,          // more / less / times / total
    val base: QuantityItem?,   // 基准实体（total 时为空）
    val amount: Float = 0f,
    val parts: List<QuantityItem> = emptyList(),  // total 分量
    val inverted: Boolean = false, // true = q 是关系中的 b（基准方），如"a 是 b 的 N 倍"里的 b
)

internal fun findItem(name: String, quantities: List<QuantityItem>): QuantityItem? =
    quantities.firstOrNull { it.name == name || it.name.contains(name) || name.contains(it.name) }

/** 找到当前实体 q 参与的第一个可绘制关系（more/less/times 优先于 total） */
internal fun firstRelFor(
    q: QuantityItem,
    quantities: List<QuantityItem>,
    relations: List<QuantityRelation>,
): RelView? {
    val found = mutableListOf<RelView>()
    for (r in relations) {
        val isA = q.name == r.a || q.name.contains(r.a) || r.a.contains(q.name)
        val isB = r.b.isNotBlank() && (q.name == r.b || q.name.contains(r.b) || r.b.contains(q.name))
        when (r.type) {
            "total" -> {
                if (isA && r.parts.isNotEmpty()) {
                    found.add(RelView("total", null, parts = r.parts.mapNotNull { findItem(it, quantities) }))
                }
            }
            "more", "less" -> {
                if (isA) {
                    found.add(RelView(r.type, findItem(r.b, quantities), r.amount))
                } else if (isB) {
                    // 倒转：a 比 q 多 N → q 比 a 少 N（画差值段在 a 行；q 是基准，不画差值）
                    found.add(RelView(if (r.type == "more") "less" else "more", findItem(r.a, quantities), r.amount, inverted = true))
                }
            }
            "times" -> {
                if (isA) {
                    found.add(RelView("times", findItem(r.b, quantities), r.amount))
                } else if (isB) {
                    // 倒转：a 是 q 的 N 倍 → q = a ÷ N
                    found.add(RelView("times", findItem(r.a, quantities), r.amount, inverted = true))
                }
            }
        }
    }
    return found.firstOrNull()
}

/** 求实体 q 的有效数值：优先原始 value，否则沿关系链递归推算（支持 前年→去年→今年 链式）。
 *  返回 null 表示无法推算（如 base 本身推算不出来）。 */
internal fun effectiveValue(
    q: QuantityItem,
    quantities: List<QuantityItem>,
    relations: List<QuantityRelation>,
    visited: Set<String> = emptySet(),
): Float? {
    q.value?.let { return it }
    if (q.name in visited) return null  // 防环（如 A=B、B=A 的异常关系）
    val rel = firstRelFor(q, quantities, relations) ?: return null
    val baseVal = rel.base?.let { effectiveValue(it, quantities, relations, visited + q.name) }
    return when (rel.type) {
        "total" -> {
            // 每个分量取有效值；必须全部分量都推得出才求和
            val vals = rel.parts.mapNotNull { effectiveValue(it, quantities, relations, visited + q.name) }
            if (vals.size == rel.parts.size && vals.isNotEmpty()) vals.sum() else null
        }
        "more" -> baseVal?.let { it + rel.amount }
        "less" -> baseVal?.let { (it - rel.amount).coerceAtLeast(0f) }
        "times" -> when {
            baseVal == null -> null
            rel.inverted -> baseVal / rel.amount
            else -> baseVal * rel.amount
        }
        else -> null
    }
}

/** 推算未知量 q 的值（兼容旧调用：委托给链式 effectiveValue） */
internal fun inferValue(q: QuantityItem, quantities: List<QuantityItem>, relations: List<QuantityRelation>): Float? =
    effectiveValue(q, quantities, relations)

/** 数值显示：整数不带小数，非整数保留一位 */
internal fun fmt(v: Float): String =
    if (v % 1f == 0f) v.toInt().toString() else String.format("%.1f", v)

/** 判断实体 q 是否"问题所求的差值"（如"贵的金额"）：值未知、名字暗示差值语义（贵/便宜/差/多出的），
 *  且不参与任何已知数值关系。这种差值单独一行，由"基准段 + 红色差值段"两段表达。 */
internal fun isDerivedDiffQuantity(
    q: QuantityItem,
    relations: List<QuantityRelation>,
): Boolean {
    if (q.value != null) return false  // 已知量不是差值
    // 名字暗示"差值"语义
    val diffHints = listOf("贵", "便宜", "相差", "差", "多出", "少出", "多余", "剩余差")
    val nameHintsDiff = diffHints.any { q.name.contains(it) }
    if (!nameHintsDiff) return false
    // 参与的关系里，不能有把它当已知基准/主体的（times/非零 more/less/total）——否则它有独立意义
    for (r in relations) {
        val isA = q.name == r.a || q.name.contains(r.a) || r.a.contains(q.name)
        val isB = r.b.isNotBlank() && (q.name == r.b || q.name.contains(r.b) || r.b.contains(q.name))
        if (isA || isB) {
            if (r.type == "times" || r.type == "total" || r.amount != 0f) return false
        }
    }
    return true
}

/** 计算差值实体 q 的"基准段长度"与"红色差值段长度"：
 *  找 q 名字对应的那个 amount=0 的 more/less 关系（如"成人票比儿童票贵多少"），
 *  基准段 = 关系里 b（儿童票）的有效值；差值段 = a（成人票）有效值 - b 有效值。
 *  返回 Pair(基准值, 差值)，推算不出来返回 null。 */
internal fun diffSegmentValues(
    q: QuantityItem,
    quantities: List<QuantityItem>,
    relations: List<QuantityRelation>,
): Pair<Float, Float>? {
    if (!isDerivedDiffQuantity(q, relations)) return null
    // 找 q 名字对应的差值关系：名字含"贵/便宜/差" → more/less 且 amount=0
    val isMoreSemantic = q.name.contains("贵") || q.name.contains("多出") || q.name.contains("相差")
    for (r in relations) {
        if ((r.type == "more" || r.type == "less") && r.amount == 0f) {
            val baseQ = findItem(r.b, quantities) ?: continue
            val subjectQ = findItem(r.a, quantities) ?: continue
            val baseVal = effectiveValue(baseQ, quantities, relations) ?: continue
            val subjectVal = effectiveValue(subjectQ, quantities, relations) ?: continue
            val diff = subjectVal - baseVal
            if (diff <= 0f) continue
            // 语义校验：贵 → more；便宜/少 → less
            if (isMoreSemantic && r.type != "more") continue
            if (!isMoreSemantic && r.type != "less") continue
            return baseVal to diff
        }
    }
    return null
}

// ── 关系说明：把结构化 relations 转成自然语言（供线段图下方"关系说明"列表显示） ──

/** 单位取值：优先基准 b，其次主体 a（more/less 描述需要单位） */
private fun relUnit(r: QuantityRelation, quantities: List<QuantityItem>): String =
    (findItem(r.b, quantities) ?: findItem(r.a, quantities))?.unit.orEmpty()

/** 把一条数量关系转成自然语言（如 "牛奶是牛角包的2倍"、"剩下的钱比妈妈的钱少5元"、"一共 = 牛奶 + 牛角包"）。
 *  amount=0 的 more/less 是"求差值"型问题，转成问句（如 "成人票比儿童票多多少？"）。
 *  结构不完整（缺主体/基准/分量）返回 null。 */
internal fun describeRelation(
    r: QuantityRelation,
    quantities: List<QuantityItem>,
): String? {
    return when (r.type) {
        "times" -> {
            if (r.a.isBlank() || r.b.isBlank() || r.amount <= 0f) null
            else "${r.a}是${r.b}的${fmt(r.amount)}倍"
        }
        "more", "less" -> {
            if (r.a.isBlank() || r.b.isBlank()) null
            else {
                val unit = relUnit(r, quantities)
                if (r.amount == 0f) {
                    // 求差值型问题：不写死数值
                    "${r.a}比${r.b}${if (r.type == "more") "多" else "少"}多少？"
                } else {
                    "${r.a}比${r.b}${if (r.type == "more") "多" else "少"}${fmt(r.amount)}${unit}"
                }
            }
        }
        "total" -> {
            if (r.parts.isEmpty()) null
            else "${r.a} = ${r.parts.joinToString(" + ")}"
        }
        else -> null
    }
}

/** 所有关系的自然语言描述列表（保持 relations 顺序，跳过转不出来的） */
internal fun describeRelations(
    relations: List<QuantityRelation>,
    quantities: List<QuantityItem>,
): List<String> = relations.mapNotNull { describeRelation(it, quantities) }
