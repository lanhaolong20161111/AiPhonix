package com.example.ai.data.math

/**
 * 「先算谁？」—— 运算优先级的**计算顺序**引擎（纯逻辑 · 确定性 · 可单测）
 *
 * 人教版三年级上「混合运算」的三条规矩：
 *   ① 有小括号 → 先算括号里面的（括号只改「里外」顺序，括号里的规矩不变）
 *   ② 没有括号 → 先乘除、后加减（跟运算符写在左边还是右边**无关**）
 *   ③ 同级运算 → 从左往右，一个一个算
 *
 * 为什么产物是「顺序」而不是「一个数」：
 *   这一节要教的是**谁先算**。动画必须照着一条确定的化简轨迹走 —— 每一步算哪个运算符、
 *   算完算式长什么样。所以引擎返回 [PStep] 轨迹，而不是求值结果。
 *
 * 单测用三个互相独立的裁判交叉验算轨迹终点：递归下降求值 / 逐步化简终点 / 手工常量，
 * 三个不同思路给出同一个整数，才把「轨迹一定对」从信仰变成证明。
 *
 * 移植自 web/src/lib/precedence.ts（逐行对照，行为必须一致）。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

data class PToken(
    val text: String,
    val type: TokenType,
    /** 该数字是**前一步算出来的**（渐进化简的产物）—— 动画给它一个「已算出」的底色 */
    val computed: Boolean = false,
)

/** 本步为什么先算它 */
enum class PWhy {
    /** 在括号里，括号里的先算 */
    PAREN,

    /** 同一层里级别不同，乘除压倒加减 */
    HIGHER,

    /** 同一层里级别相同，从左往右先碰到谁先算 */
    SAME_LEVEL,
}

/** 一步化简 */
data class PStep(
    /** 本步要算的运算符在 [before] 里的下标 */
    val index: Int,
    val op: String,
    /** 左右两个操作数（显示文本） */
    val left: String,
    val right: String,
    val value: Int,
    val why: PWhy,
    /** 同一层里除它以外的运算符（讲解用：「加号在左边也得等一等」） */
    val siblings: List<String>,
    val before: List<PToken>,
    val after: List<PToken>,
)

// ────────────────────────────────────────────────────────────
// token 构造
// ────────────────────────────────────────────────────────────

fun numTok(v: Int): PToken = PToken(v.toString(), TokenType.NUM)
fun numTok(v: String): PToken = PToken(v, TokenType.NUM)
fun opTok(op: String): PToken = PToken(op, TokenType.OP)
fun parenTok(ch: String): PToken = PToken(ch, TokenType.PAREN)

/** 是否乘除（优先级高的一级） */
fun isMd(op: String): Boolean = op == "×" || op == "÷"

/** 四则运算求值（除零同 JS 语义：整数除法会抛 ArithmeticException，本题型不会出现） */
fun applyOp(a: Int, op: String, b: Int): Int = when (op) {
    "+" -> a + b
    "-" -> a - b
    "×" -> a * b
    "÷" -> if (b == 0) throw ArithmeticException("除以零") else a / b
    else -> throw IllegalArgumentException("未知运算符：$op")
}

// ────────────────────────────────────────────────────────────
// 求值（递归下降 —— 与「逐步化简」互为交叉验证）
// ────────────────────────────────────────────────────────────

fun evalExpr(tokens: List<PToken>): Int {
    var pos = 0
    fun peek(): PToken? = if (pos < tokens.size) tokens[pos] else null
    fun eat(): PToken = tokens[pos++]

    // ⚠️ 局部函数不能前向引用（Kotlin 与 JS 的差异）：parseFactor 要回调 parseExpr
    lateinit var parseExpr: () -> Int

    fun parseFactor(): Int {
        val t = peek() ?: throw IllegalArgumentException("意外的算式结束")
        if (t.text == "(") {
            eat()
            val v = parseExpr()
            val close = eat()
            if (close.text != ")") throw IllegalArgumentException("括号不配对")
            return v
        }
        eat()
        return t.text.toIntOrNull() ?: throw IllegalArgumentException("不是数字：${t.text}")
    }

    fun parseTerm(): Int {
        var left = parseFactor()
        while (true) {
            val p = peek() ?: break
            if (p.type != TokenType.OP || !isMd(p.text)) break
            val op = eat().text
            left = applyOp(left, op, parseFactor())
        }
        return left
    }

    parseExpr = {
        var left = parseTerm()
        while (true) {
            val p = peek() ?: break
            if (p.type != TokenType.OP || (p.text != "+" && p.text != "-")) break
            val op = eat().text
            left = applyOp(left, op, parseTerm())
        }
        left
    }

    val v = parseExpr()
    if (pos != tokens.size) throw IllegalArgumentException("token 未消费完")
    return v
}

// ────────────────────────────────────────────────────────────
// 顺序判定
// ────────────────────────────────────────────────────────────

/** 最内层括号组（返回 "(" 与 ")" 的下标）；没有括号则 null */
fun innermostGroup(tokens: List<PToken>): Pair<Int, Int>? {
    var open = -1
    var depth = 0
    for (i in tokens.indices) {
        val t = tokens[i]
        if (t.type != TokenType.PAREN) continue
        if (t.text == "(") {
            if (open < 0) open = i
            depth += 1
            continue
        }
        depth -= 1
        if (depth == 0 && open >= 0) {
            // 这一组里还嵌着更内层的括号，往里面钻
            val inner = innermostGroup(tokens.subList(open + 1, i))
            if (inner != null) return (open + 1 + inner.first) to (open + 1 + inner.second)
            return open to i
        }
    }
    return null
}

/** 当前层（= 最内层括号组之内，或整个算式）的运算符下标 */
fun opsAtLevel(tokens: List<PToken>, g: Pair<Int, Int>?): List<Int> {
    val from = if (g != null) g.first + 1 else 0
    val to = if (g != null) g.second else tokens.size
    val out = mutableListOf<Int>()
    for (i in from until to) if (tokens[i].type == TokenType.OP) out.add(i)
    return out
}

/**
 * 下一个该算的运算符下标（-1 = 已经没有运算符了）。
 * 判定顺序：① 最内层括号里的 ② 其中级别最高的（乘除压倒加减）③ 同级取最左。
 */
fun nextOpIndex(tokens: List<PToken>): Int {
    val g = innermostGroup(tokens)
    val ops = opsAtLevel(tokens, g)
    if (ops.isEmpty()) return -1
    val md = ops.filter { isMd(tokens[it].text) }
    return if (md.isNotEmpty()) md[0] else ops[0]
}

/** 单层括号若只包着一个数就拆掉：( 36 ) → 36 */
private fun collapseParens(tokens: List<PToken>): List<PToken> {
    val out = mutableListOf<PToken>()
    var i = 0
    while (i < tokens.size) {
        if (tokens[i].text == "(" &&
            tokens.getOrNull(i + 1)?.type == TokenType.NUM &&
            tokens.getOrNull(i + 2)?.text == ")"
        ) {
            out.add(tokens[i + 1])
            i += 3
            continue
        }
        out.add(tokens[i])
        i += 1
    }
    return out
}

/** 在 i 处化简一步：把 (i-1, i, i+1) 三个 token 换成一个数 */
fun reduceAt(tokens: List<PToken>, i: Int): List<PToken> {
    val left = tokens.getOrNull(i - 1)
    val right = tokens.getOrNull(i + 1)
    if (left == null || right == null || left.type != TokenType.NUM || right.type != TokenType.NUM) {
        throw IllegalArgumentException("运算符两侧不是数字，无法化简")
    }
    val v = applyOp(left.text.toInt(), tokens[i].text, right.text.toInt())
    val next = PToken(v.toString(), TokenType.NUM, computed = true)
    return collapseParens(tokens.subList(0, i - 1) + next + tokens.subList(i + 2, tokens.size))
}

/**
 * 把整个算式摊成一条**化简轨迹**：每一步算哪个运算符、依据是哪条规矩、算完长什么样。
 * 轨迹终点必然是「只剩一个数」，且那个数等于算式的结果。
 */
fun planSteps(tokens: List<PToken>): List<PStep> {
    val steps = mutableListOf<PStep>()
    var cur = tokens.map { it.copy() }
    // 兜底：正常算式最多化简 (token 数 / 2) 次
    for (guard in 0 until tokens.size + 4) {
        val index = nextOpIndex(cur)
        if (index < 0) break
        val g = innermostGroup(cur)
        val ops = opsAtLevel(cur, g)
        val md = ops.filter { isMd(cur[it].text) }
        val inside = g != null && index > g.first && index < g.second

        val why = when {
            inside -> PWhy.PAREN
            md.isNotEmpty() && md.size < ops.size -> PWhy.HIGHER
            else -> PWhy.SAME_LEVEL
        }

        val after = reduceAt(cur, index)
        // 结果值直接由左右操作数算出，**不要**回头读 after[index-1]：
        // reduceAt 里的 collapseParens 可能把结果之前的 token 抹掉、让下标整体左移
        val value = applyOp(
            cur[index - 1].text.toInt(),
            cur[index].text,
            cur[index + 1].text.toInt(),
        )
        steps.add(
            PStep(
                index = index,
                op = cur[index].text,
                left = cur[index - 1].text,
                right = cur[index + 1].text,
                value = value,
                why = why,
                siblings = ops.filter { it != index }.map { cur[it].text },
                before = cur,
                after = after,
            ),
        )
        cur = after
    }
    return steps
}

/** 轨迹终点（只剩下一个数时的值）；轨迹为空则抛出 */
fun finalValue(steps: List<PStep>): Int {
    val last = steps.lastOrNull() ?: throw IllegalArgumentException("轨迹为空")
    val rest = last.after
    if (rest.size != 1 || rest[0].type != TokenType.NUM) {
        throw IllegalArgumentException("轨迹没有化简到只剩一个数")
    }
    return rest[0].text.toInt()
}

// ────────────────────────────────────────────────────────────
// 页内小动画用的两组示例（数值均已人工验算，单测会断言引擎算出来必须等于它）
// ────────────────────────────────────────────────────────────

data class PrDemoCase(
    val key: String,
    /** 切换按钮上的文字 */
    val chip: String,
    /** 这一组要讲的规矩 */
    val label: String,
    val tokens: List<PToken>,
    /** 正确答案（人工验算的常量） */
    val answer: Int,
    /** 常见的错法 */
    val wrong: String,
    val wrongWhy: String,
)

val PR_DEMO_CASES: List<PrDemoCase> = listOf(
    PrDemoCase(
        key = "diff",
        chip = "不同级 4 + 6 × 3",
        label = "不同级 —— 先乘除，后加减",
        tokens = listOf(numTok(4), opTok("+"), numTok(6), opTok("×"), numTok(3)),
        answer = 22,
        wrong = "(4 + 6) × 3 = 30",
        wrongWhy = "加号写在左边就先算它？不行 —— 只要旁边有乘除，加减就得让路。",
    ),
    PrDemoCase(
        key = "same",
        chip = "同级 24 - 13 + 18",
        label = "同级 —— 从左往右，先碰到谁先算",
        tokens = listOf(numTok(24), opTok("-"), numTok(13), opTok("+"), numTok(18)),
        answer = 29,
        wrong = "24 - (13 + 18) = -7",
        wrongWhy = "减法不比加法厉害，加减是一家人；同级就按从左到右的顺序来。",
    ),
)
