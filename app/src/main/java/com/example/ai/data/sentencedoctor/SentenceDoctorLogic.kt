package com.example.ai.data.sentencedoctor

/**
 * 句子小医生 · 纯函数引擎（不碰任何 Android API，可直接 JVM 单测）
 *
 * 从 web 的 `modules/sentence_doctor/marks.ts` + `tags.ts` + `index.tsx` 里的派生逻辑逐条搬过来：
 * 判对四态、拼句子、病灶坐标、标记切分、提示语位置反推。
 *
 * ── 为什么值得单独一个文件 ─────────────────────────────────────────
 * 这些在 web 里都是「运行时行为」，在 Android 侧变成**可断言的静态事实**：
 * 35 处病灶的坐标能不能把原句重建回订正句、19 句的提示语推得对不对 ——
 * 全都能在单测里一次钉死，比在真机上逐题点一遍快得多，也不会漏。
 *
 * ── 一句话里的三个坐标系 ───────────────────────────────────────────
 *   · 原句坐标：`text` 的下标（病灶框都落在这一套上）
 *   · 空位坐标：`slots` 的下标（标点题用；与 parts 交错，parts.size + 1 个）
 *   · 段坐标：`parts` 的下标（提示语高亮用）
 */

// ══════════════════════════════════════════════════════════════════════
//  标点册：判对与拼句
// ══════════════════════════════════════════════════════════════════════

/**
 * 空位的四态（**刻意不是「对/错」两态**）
 *
 * 一个空位常常要写两个标点（「：“」= 冒号 + 前引号）。孩子先点冒号时，既不算对也不算错，
 * 只是「还没写完」—— 所以要有中性态，否则第一下就报红，把正在操作的正常过程判成错误。
 */
internal enum class SdSlotState { EMPTY, TYPING, OK, WRONG }

/**
 * 四态判定：空 / 待续（是某个标准答案的前缀）/ 对 / 错。
 *
 * `ok` 里的备选写法同样算对（如「？”」也接受「。”」）。
 */
internal fun sdSlotStateOf(value: String, slot: SdPunctSlot): SdSlotState {
    if (value.isEmpty()) return SdSlotState.EMPTY
    val all = listOf(slot.a) + slot.ok
    if (all.contains(value)) return SdSlotState.OK
    if (all.any { it.length > value.length && it.startsWith(value) }) return SdSlotState.TYPING
    return SdSlotState.WRONG
}

/** 把「孩子填成什么样」拼成一句话（用于「🔊 读一读」）；`vals` 与 slots 等长 */
internal fun sdComposeSentence(item: SdPunctItem, vals: List<String>): String {
    val sb = StringBuilder(vals.getOrElse(0) { "" })
    item.parts.forEachIndexed { i, part ->
        sb.append(part).append(vals.getOrElse(i + 1) { "" })
    }
    return sb.toString()
}

/** 按标准答案拼出的整句（`data.test.ts` 里的同口径 model） */
internal fun sdModelSentence(item: SdPunctItem): String =
    sdComposeSentence(item, item.slots.map { it?.a ?: "" })

/** 这一句的标点全填对了吗（无标点的空位恒算对） */
internal fun sdPunctItemSolved(item: SdPunctItem, vals: List<String>): Boolean =
    item.slots.withIndex().all { (j, s) -> s == null || sdSlotStateOf(vals.getOrElse(j) { "" }, s) == SdSlotState.OK }

/** 这一处的刀与病因都选对了吗 */
internal fun sdSpotSolved(spot: SdFixSpot, tool: SdTool?, pick: Int): Boolean =
    tool == spot.tool && pick == spot.answer

/** 整句病灶全治好了吗 */
internal fun sdFixCaseSolved(item: SdFixCase, tools: List<SdTool?>, picks: List<Int>): Boolean =
    item.spots.withIndex().all { (j, s) -> sdSpotSolved(s, tools.getOrNull(j), picks.getOrElse(j) { -1 }) }

/** 病句册的 `intro` / `why` 里带 markdown 粗体标记，渲染前去掉（对齐 web 的 `.replace(/ 星号星号 /g, "")`） */
internal fun sdStripBold(s: String): String = s.replace("**", "")

// ══════════════════════════════════════════════════════════════════════
//  病句册：病灶坐标
// ══════════════════════════════════════════════════════════════════════

/** 一处病灶在原句里的三处坐标（**都是原句坐标**，不是订正后的） */
internal data class SdMarkSpan(
    /** cut 的区间 [start, end)；没有 cut 时 null */
    val cut: Pair<Int, Int>?,
    /** with 的区间；没有 with 时 null */
    val with: Pair<Int, Int>?,
    /** put 要补在哪个字符之前；null = 按 cut 原位（无 cut 则句末） */
    val at: Int?,
)

/**
 * 找**唯一一次**出现；找不到或出现多次都返回 -1。
 *
 * 页面据此降级：**宁可不画，不画错**（重复出现的片段没法确定框哪一个）。
 */
internal fun sdFindOnce(text: String, piece: String): Int {
    if (piece.isEmpty()) return -1
    val i = text.indexOf(piece)
    if (i < 0) return -1
    return if (text.indexOf(piece, i + 1) < 0) i else -1
}

/** 病灶 → 原句上的字符区间 */
internal fun sdLocateMark(text: String, mark: SdSpotMark): SdMarkSpan {
    val cutStr = mark.cut?.takeIf { it.isNotEmpty() }
    val withStr = mark.with?.takeIf { it.isNotEmpty() }
    val atStr = mark.at?.takeIf { it.isNotEmpty() }
    val ci = if (cutStr != null) sdFindOnce(text, cutStr) else -1
    val wi = if (withStr != null) sdFindOnce(text, withStr) else -1
    val ai = if (atStr != null) sdFindOnce(text, atStr) else -1
    return SdMarkSpan(
        cut = if (ci < 0 || cutStr == null) null else ci to (ci + cutStr.length),
        with = if (wi < 0 || withStr == null) null else wi to (wi + withStr.length),
        at = if (ai < 0) (if (cutStr != null) ci else null) else ai,
    )
}

/**
 * 把一句话的所有病灶按顺序「治」一遍 —— 页面不用它，**测试用**。
 *
 * 四种工具的动作各不相同，所以必须跟着 tool 走：
 * 光看 mark 分不出对调和移动（两者数据形状一样，只是「紧挨着」与「隔开一段」的区别）。
 *
 * 定位失败一律抛错而不是静默跳过 —— 静默跳过会让「重建 == fixed」这条不变量变成假通过。
 */
internal fun sdApplyMarks(item: SdFixCase): String {
    var out = item.text
    for (spot in item.spots) {
        val m = spot.mark
        val cut = m.cut
        val with = m.with
        if (cut != null && with != null) {
            val a = out.indexOf(cut)
            val b = out.indexOf(with)
            if (a < 0 || b < 0) error("定位失败：cut=$cut with=$with")
            out = if (spot.tool == SdTool.SWAP) {
                // 紧挨着的两处互换
                if (a < b) {
                    out.substring(0, a) + with + cut + out.substring(b + with.length)
                } else {
                    out.substring(0, b) + cut + with + out.substring(a + cut.length)
                }
            } else {
                // 移动：先把 cut 取下来，再整个插到 with 前面
                val rest = out.substring(0, a) + out.substring(a + cut.length)
                val t = rest.indexOf(with)
                if (t < 0) error("移动失败：with=$with")
                rest.substring(0, t) + cut + rest.substring(t)
            }
            continue
        }
        var hole: Int? = null
        if (cut != null) {
            val a = out.indexOf(cut)
            if (a < 0) error("定位失败：cut=$cut")
            if (out.indexOf(cut, a + 1) >= 0) error("cut 不唯一：$cut")
            out = out.substring(0, a) + out.substring(a + cut.length)
            hole = a
        }
        val put = m.put
        if (put != null) {
            val at = m.at?.let { out.indexOf(it) } ?: hole ?: out.length
            val insertAt = if (at < 0) out.length else at
            out = out.substring(0, insertAt) + put + out.substring(insertAt)
        }
    }
    return out
}

/** 病灶在原句里占用的字符区间（可能两处：cut 与 with）—— 用来判「两个病灶是不是打架了」 */
internal fun sdOccupiedRanges(text: String, spots: List<SdFixSpot>): List<List<Pair<Int, Int>>> =
    spots.map { s ->
        val g = sdLocateMark(text, s.mark)
        listOfNotNull(g.cut, g.with)
    }

/**
 * 一句话说清「这一处该怎么下笔」—— 显示在理由框里。
 *
 * 和原句上的红笔标记是同一件事的两种说法：**先写下来，再看画出来的**。
 * 只写不画，孩子不知道符号落在哪几个字上；只画不写，家长看不懂这笔画的是什么。
 */
internal fun sdDescribeMark(spot: SdFixSpot): String {
    val m = spot.mark
    return when (spot.tool) {
        SdTool.CORRECT -> "框住「${m.cut}」，在订正栏写上「${m.put}」"
        SdTool.DELETE -> "框住「${m.cut}」划掉"
        SdTool.ADD -> if (!m.cut.isNullOrEmpty()) {
            "框住「${m.cut}」，补上「${m.put}」"
        } else {
            "把「${m.put}」补在「${m.at}」前面"
        }
        SdTool.SWAP -> "「${m.cut}」和「${m.with}」紧挨着，互换位置"
        SdTool.MOVE -> "把「${m.cut}」整个挪到「${m.with}」前面"
    }
}

// ══════════════════════════════════════════════════════════════════════
//  原句上的红笔标记：切分
// ══════════════════════════════════════════════════════════════════════

/** 一处标记在原句上的角色：cut = 病灶本身；with = 对调/移动的另一半；at = 纯插入点（零宽） */
internal enum class SdMarkRole { CUT, WITH, AT }

/** 一处要画在原句上的框（start == end 表示零宽的插入点） */
internal data class SdMarkBox(
    val start: Int,
    val end: Int,
    val tool: SdTool,
    val role: SdMarkRole,
    val put: String?,
) {
    /**
     * 要不要给这几个字套方框。
     *
     * 与 web 逐字一致：`改正` / `删除` 一律套框；其余工具只有 `cut` 那一处套框，
     * `with`（对调/移动的目标位）**不套框** —— 它上面挂的是分叉或编号牌，套了框就成「两处都要改」的误读。
     */
    val boxed: Boolean get() = tool == SdTool.CORRECT || tool == SdTool.DELETE || role == SdMarkRole.CUT
}

/** 原句切分后的一段：要么是纯文字，要么是带标记框的字 */
internal data class SdSentencePiece(val text: String, val box: SdMarkBox?)

/**
 * 把原句按病灶切成「红笔标记 + 普通文字」交错的一串。
 *
 * ★ 位置全部来自 `SdSpotMark` 的显式声明，**不跑 diff 猜**：一遇到「对调 / 移动」，
 *   LCS 会有并列最优路径，机器猜出来的位置会**看起来对、其实错**（web `data.ts` 里有详细论证）。
 *   正确性由单测的「把每一处 mark 依次作用到 text 上 == fixed」兜底 —— 写错一个字，测试立刻红。
 */
internal fun sdSentencePieces(
    text: String,
    marks: List<Pair<SdTool, SdSpotMark>>,
): List<SdSentencePiece> {
    val boxes = ArrayList<SdMarkBox>()
    for ((tool, mark) in marks) {
        val g = sdLocateMark(text, mark)
        g.cut?.let { boxes.add(SdMarkBox(it.first, it.second, tool, SdMarkRole.CUT, mark.put)) }
        g.with?.let { boxes.add(SdMarkBox(it.first, it.second, tool, SdMarkRole.WITH, mark.put)) }
        if (g.cut == null && g.with == null && g.at != null) {
            boxes.add(SdMarkBox(g.at, g.at, tool, SdMarkRole.AT, mark.put))
        }
    }
    boxes.sortWith(compareBy({ it.start }, { it.end }))

    val out = ArrayList<SdSentencePiece>()
    var cur = 0
    for (b in boxes) {
        if (b.start > cur) out.add(SdSentencePiece(text.substring(cur, b.start), null))
        out.add(SdSentencePiece(text.substring(b.start, b.end), b))
        cur = b.end
    }
    if (cur < text.length) out.add(SdSentencePiece(text.substring(cur), null))
    return out
}

// ══════════════════════════════════════════════════════════════════════
//  标点册：提示语位置（派生量）
// ══════════════════════════════════════════════════════════════════════

/** 提示语相对「话」的位置 */
internal enum class SdTagPos(val label: String) {
    FRONT("提示语在前"),
    MID("提示语在中"),
    BACK("提示语在后"),
}

/**
 * 提示语的**段下标**（parts 的索引）；推不出来时 -1。
 *
 * 不另加数据：19 句的 parts 是「按空位切开」的碎片，提示语恰好总是完整的一段，
 * 所以哪一段是提示语，可以从**紧跟在它后面的那个空位的角色**看出来 ——
 *   · tag  提示语在前   → 提示语 = 它前一段
 *   · mid  提示语在中   → 提示语 = 它前一段
 *   · narr 提示语后面还有叙述（提示语在后）→ 提示语 = 它前一段
 *   · 都不出现时（提示语在最后、后面直接收尾）→ 提示语 = 倒数第二段
 *
 * ⚠️ 只用于**点亮**（孩子主动点「提示语在哪儿」时才高亮），
 *    不许拿它去判对错 ——「找出提示语」本来就是要练的那件事。
 */
internal fun sdTagPartIndexOf(item: SdPunctItem): Int {
    item.slots.forEachIndexed { si, s ->
        if (s != null && (s.kind == SdSlotKind.TAG || s.kind == SdSlotKind.MID || s.kind == SdSlotKind.NARR)) {
            return si - 1
        }
    }
    val last = item.slots.size - 1
    if (last > 0 && item.slots[last]?.kind == SdSlotKind.END) return last - 1
    return -1
}

/**
 * 提示语在「话」的前面 / 中间 / 后面。
 *
 * 判据是**跟引号的关系**，不是它落在句子的第几段：第二关第一句
 * 「“非常感谢你给我指路。”说完，陶陶慢慢掉头往回走。」里，提示语「说完」
 * 虽然在句子中间，但对「话」来说它在**后面** —— 这一关练的就是这件事。
 */
internal fun sdTagPositionOf(item: SdPunctItem): SdTagPos? {
    val ti = sdTagPartIndexOf(item)
    if (ti < 0) return null
    // 只看第 ti 段之前的空位（含紧贴它的第 ti 个）里有没有「合上引号」
    val closedBefore = item.slots.take(ti + 1).any { it?.kind == SdSlotKind.CLOSE }
    if (!closedBefore) return SdTagPos.FRONT
    val moreAfter = item.slots.drop(ti + 1).any { it?.kind == SdSlotKind.CLOSE || it?.kind == SdSlotKind.MID }
    return if (moreAfter) SdTagPos.MID else SdTagPos.BACK
}
