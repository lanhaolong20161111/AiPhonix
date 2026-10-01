package com.example.ai.data.math

import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random

/**
 * 三年级上「把两个分步算式合并成综合算式」—— 纯逻辑引擎（确定性）
 *
 * 教学法（人教版三年级上册 混合运算）：合并三步法「找 → 换 → 查」
 *   ① 找：找出两个算式里相同的那一个数（第一个算式的结果，出现在第二个算式里）
 *   ② 换：用第一个算式整体替换第二个算式里的那个数
 *   ③ 查：检查运算顺序 —— 原式要先算的部分，换进去后是否还先算？不是则必须补小括号
 *
 * 括号判据（核心考点）：
 *   ·「加减在后」：合并后乘除会抢在加减前面算，但原来加减是先算的，必加括号
 *   ·「乘除在前」：合并后乘除本来就先算，与原来顺序一致，不加括号
 *
 * 为什么不用大模型生成：本题型是纯逻辑（两式必须数值自洽），LLM 有算错/结构不成立的风险，
 * 且每次练习都要等网络。规则引擎 = 0 延迟 + 0 成本 + 100% 正确。
 *
 * 移植自 web/src/lib/compoundExpr.ts（逐行对照，行为必须一致）。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 题型：按「第一个算式在第二个算式里的位置」分层 */
enum class CompoundKind {
    /** 先加减后乘除 —— 必加括号（第一阶段最典型） */
    ADDSUB_THEN_MULDIV,

    /** 先乘除后加减 —— 不加括号 */
    MULDIV_THEN_ADDSUB,

    /** 第一个算式的结果是被除数（除法在右）—— 必加括号 */
    AS_DIVIDEND,

    /** 第一个算式的结果是减数 —— 必加括号 */
    AS_SUBTRAHEND,
}

/** 一个操作数：要么是数字，要么是「引用上一步结果的占位」 */
data class StepOperand(
    /** 显示文本（数字） */
    val text: String,
    /** 若这是第一个算式的结果占位，记它的编号（1 起） */
    val fromStep: Int? = null,
)

/** 一步算式：a op b = result */
data class StepLine(
    val a: StepOperand,
    val op: String,
    val b: StepOperand,
    val result: Int,
)

/** 内嵌括号片段：在综合算式中某一段要被括号包起来（含头不含尾） */
data class ParenSpan(val start: Int, val end: Int)

enum class TokenType { NUM, OP, PAREN }

/** 运算符优先级：MD 乘除 | AS 加减 */
enum class OpPrec { MD, AS }

data class ExprToken(
    val text: String,
    val type: TokenType,
    /** 该 token 是否来自第一个算式（替换进来的部分）—— 用于动画高亮 */
    val fromFirst: Boolean = false,
    /** 该 token 对应的运算符优先级（仅 OP 有值） */
    val prec: OpPrec? = null,
)

/** 合并后的综合算式：tokens 数组便于逐 token 着色/高亮 */
data class MergedExpr(
    val tokens: List<ExprToken>,
    /** 需要补的括号区间（可能为空 = 不需要括号） */
    val parens: List<ParenSpan>,
    val value: Int,
)

/** 「找」这一步的数据 */
data class MergeFind(val value: Int, val inFirst: String, val inSecond: String)

/** 「查」这一步的结论 */
data class MergeCheck(val needParen: Boolean, val reason: String)

/** 「找→换→查」三步的逐步讲解数据 */
data class MergeSteps(val find: MergeFind, val substitute: String, val check: MergeCheck)

/** 一道完整练习题 */
data class CompoundProblem(
    val id: String,
    val kind: CompoundKind,
    /** 分步算式（① ②） */
    val steps: List<StepLine>,
    /** 正确的综合算式 */
    val merged: MergedExpr,
    /** 合并过程讲解 */
    val how: MergeSteps,
    /** 一句话考点提示 */
    val hint: String,
    val answer: Int,
)

/** 易错点类型（用于「警示」区） */
enum class MistakeKind { MISSING_PAREN, EXTRA_PAREN, WRONG_ORDER, LEFT_TO_RIGHT }

/** 一个「错误 vs 正确」对比示例 */
data class MistakeCase(
    val kind: MistakeKind,
    /** 分区标题，如「漏加括号」 */
    val title: String,
    val wrong: String,
    val right: String,
    /** 错在哪（一句话） */
    val why: String,
    /** 怎么避免（口诀） */
    val tip: String,
    /** ★ 卡片配图（MathIcons 的键）—— 一幅图顶一句解释 */
    val icon: String,
)

/** 口诀卡的一个小节 */
data class RuleBlock(val title: String, val icon: String, val lines: List<String>)

// ────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────

/**
 * 整数闭区间随机 —— **精确复刻 JS 的 rnd(min, max)**：min + floor(random * (max - min + 1))。
 *
 * 注意 max < min 时 JS 的跨度是 0，floor 后恒为 0 ⇒ **返回 min**（不抛错）。
 * 生成器里存在 rnd(2, r - 1) 这类「r 很小时 max < min」的调用，若换成 Kotlin 的
 * nextInt(min, max) 会直接抛 IllegalArgumentException —— 行为必须照抄。
 */
internal fun rndInclusive(min: Int, max: Int, random: Random): Int {
    val span = max - min + 1
    if (span <= 0) return min
    return min + random.nextInt(span)
}

/** 是否乘除运算符 */
internal fun isMulDiv(op: String): Boolean = op == "×" || op == "÷"

/** 运算符优先级 */
internal fun precOf(op: String): OpPrec = if (isMulDiv(op)) OpPrec.MD else OpPrec.AS

/** 安全除法：保证整除，否则返回 null */
internal fun safeDiv(a: Int, b: Int): Int? {
    if (b == 0) return null
    return if (a % b == 0) a / b else null
}

/** 把一步算式构建为 StepLine。[refWhich] 哪个操作数来自上一步的得数（"a" / "b" / null） */
private fun mk(a: Int, op: String, b: Int, result: Int, refWhich: String? = null): StepLine =
    StepLine(
        a = if (refWhich == "a") StepOperand(a.toString(), 1) else StepOperand(a.toString()),
        op = op,
        b = if (refWhich == "b") StepOperand(b.toString(), 1) else StepOperand(b.toString()),
        result = result,
    )

private fun tok(text: String, type: TokenType, fromFirst: Boolean = false, prec: OpPrec? = null) =
    ExprToken(text, type, fromFirst, prec)

/** 把第一步算式展开为 tokens（标记 fromFirst = true，用于动画高亮） */
private fun exprTokensFromStep0(s: StepLine): List<ExprToken> = listOf(
    tok(s.a.text, TokenType.NUM, fromFirst = true),
    tok(s.op, TokenType.OP, fromFirst = true, prec = precOf(s.op)),
    tok(s.b.text, TokenType.NUM, fromFirst = true),
)

/** 给 tokens 套上括号（返回带括号的 token 序列） */
private fun wrapTokens(inner: List<ExprToken>): List<ExprToken> =
    listOf(tok("(", TokenType.PAREN)) + inner + listOf(tok(")", TokenType.PAREN))

/** tokens → 文本 */
fun tokensToText(tokens: List<ExprToken>): String = tokens.joinToString(" ") { it.text }

/** 无括号的裸式文本（用于「换」这一步的展示） */
fun bareText(s: StepLine): String = "${s.a.text} ${s.op} ${s.b.text}"

// ────────────────────────────────────────────────────────────
// 求值（用于「巧合题」拦截 + 被单测用作交叉裁判之一）
// ────────────────────────────────────────────────────────────

/**
 * 按 token 求值（标准优先级 + 括号）—— 递归下降实现。
 * 抛 [IllegalArgumentException] 表示 token 序列不合法。
 */
fun evalTokens(tokens: List<ExprToken>): Int {
    var pos = 0
    fun peek(): ExprToken? = if (pos < tokens.size) tokens[pos] else null
    fun eat(): ExprToken = tokens[pos++]

    // ⚠️ 局部函数不能前向引用（Kotlin 与 JS 的差异，JS 的函数声明会提升）：
    //    parseFactor 需要回调 parseExpr，而 parseExpr 又要用 parseTerm/parseFactor，
    //    所以用 lateinit var 的 lambda 承接最外层那个函数。
    lateinit var parseExpr: () -> Int

    fun parseFactor(): Int {
        val t = peek() ?: throw IllegalArgumentException("意外的算式结束")
        if (t.text == "(") {
            eat()
            val v = parseExpr()
            eat() // ")"
            return v
        }
        eat()
        return t.text.toIntOrNull() ?: throw IllegalArgumentException("不是数字：${t.text}")
    }

    fun parseTerm(): Int {
        var left = parseFactor()
        while (true) {
            val p = peek() ?: break
            if (p.type != TokenType.OP || !isMulDiv(p.text)) break
            val op = eat().text
            val right = parseFactor()
            left = if (op == "×") left * right else left / right
        }
        return left
    }

    parseExpr = {
        var left = parseTerm()
        while (true) {
            val p = peek() ?: break
            if (p.type != TokenType.OP || (p.text != "+" && p.text != "-")) break
            val op = eat().text
            val right = parseTerm()
            left = if (op == "+") left + right else left - right
        }
        left
    }

    val v = parseExpr()
    if (pos != tokens.size) throw IllegalArgumentException("token 未消费完")
    return v
}

/**
 * 拦截「巧合题」：判定需括号、但不加括号答案竟一样（如 4×(14+7) 与 4×14+7 都是 63）。
 * 这类题无法体现「必须加括号」的教学意图（学生漏了括号也会"算对"），必须丢弃。
 */
private fun isCoincidental(tokens: List<ExprToken>, needParen: Boolean, value: Int): Boolean {
    if (!needParen) return false
    val bare = tokens.filter { it.type != TokenType.PAREN }
    if (bare.size == tokens.size) return false
    return try {
        evalTokens(bare) == value
    } catch (_: Exception) {
        false
    }
}

private class BuildSpec(
    val mergedTokens: () -> List<ExprToken>,
    val needParen: Boolean,
    val value: Int,
    val hint: String,
)

private val problemSeq = AtomicInteger(0)

private fun buildProblem(
    kind: CompoundKind,
    steps: List<StepLine>,
    spec: BuildSpec,
): CompoundProblem? {
    val tokens = spec.mergedTokens()
    val parens = mutableListOf<ParenSpan>()
    if (spec.needParen) {
        val open = tokens.indexOfFirst { it.text == "(" }
        val close = tokens.indexOfFirst { it.text == ")" }
        if (open < 0 || close <= open) return null
        parens.add(ParenSpan(open, close + 1))
    }
    // 巧合题（漏括号也"对"）在教学上无意义，直接丢弃，由外层重新生成
    if (isCoincidental(tokens, spec.needParen, spec.value)) return null

    val firstResult = steps[0].result
    val mergedText = tokensToText(tokens)
    // 去掉括号与多余空格（JS 侧是 replace 正则，这里等价实现）
    val bareSub = mergedText
        .replace("(", "")
        .replace(")", "")
        .split(' ')
        .filter { it.isNotEmpty() }
        .joinToString(" ")

    val seq = problemSeq.incrementAndGet()
    return CompoundProblem(
        id = "${kind.name}-$seq-${System.currentTimeMillis().toString(36)}",
        kind = kind,
        steps = steps,
        merged = MergedExpr(tokens, parens, spec.value),
        how = MergeSteps(
            find = MergeFind(
                value = firstResult,
                inFirst = "${bareText(steps[0])} = $firstResult",
                inSecond = bareText(steps[1]),
            ),
            substitute = bareSub,
            check = MergeCheck(
                needParen = spec.needParen,
                reason = if (spec.needParen) {
                    "按规矩先轮到的不是原来那步，必须补小括号"
                } else {
                    "按规矩先轮到的正是原来那步，不用加括号"
                },
            ),
        ),
        hint = spec.hint,
        answer = spec.value,
    )
}

// ────────────────────────────────────────────────────────────
// 题型生成器 —— 每个都返回「两步算式 + 正确综合式 + 讲解」
// ────────────────────────────────────────────────────────────

/**
 * 类型 1：先加减后乘除（**必加括号**）
 * 如：17 - 8 = 9, 36 ÷ 9 = 4  →  36 ÷ (17 - 8) = 4
 */
private fun genAddSubThenMulDiv(random: Random): CompoundProblem? {
    // 第一步：加减 → 得数 r（必须保证 a1 op1 b1 == r，故反推 b1）
    val r = rndInclusive(2, 9, random)
    val usePlus = random.nextDouble() < 0.5
    val a1: Int
    val b1: Int
    if (usePlus) {
        a1 = rndInclusive(2, r - 1, random) // b1 = r - a1 >= 1
        b1 = r - a1
    } else {
        a1 = rndInclusive(r + 1, r + 20, random) // b1 = a1 - r >= 1
        b1 = a1 - r
    }
    if (b1 < 1 || a1 == b1 || a1 + b1 > 30 || a1 > 40 || b1 > 30) return null
    val op1 = if (usePlus) "+" else "-"

    val steps0 = mk(a1, op1, b1, r)

    // 第二步：乘除，把 r 作为第二个操作数（a op b，b = r）—— 替换动作最直观
    return if (random.nextDouble() < 0.5) {
        val other = rndInclusive(2, 9, random)
        val total = other * r
        if (total > 99) return null
        val steps = listOf(steps0, mk(other, "×", r, total, "b"))
        buildProblem(
            CompoundKind.ADDSUB_THEN_MULDIV, steps,
            BuildSpec(
                mergedTokens = {
                    listOf(tok(other.toString(), TokenType.NUM), tok("×", TokenType.OP, prec = OpPrec.MD)) +
                        wrapTokens(exprTokensFromStep0(steps[0]))
                },
                needParen = true,
                value = total,
                hint = "乘除会抢在加减前算！得用小括号把加减括起来。",
            ),
        )
    } else {
        val k = rndInclusive(2, 9, random)
        val total = r * k
        if (total > 99) return null
        val steps = listOf(steps0, mk(total, "÷", r, k, "b"))
        buildProblem(
            CompoundKind.ADDSUB_THEN_MULDIV, steps,
            BuildSpec(
                mergedTokens = {
                    listOf(tok(total.toString(), TokenType.NUM), tok("÷", TokenType.OP, prec = OpPrec.MD)) +
                        wrapTokens(exprTokensFromStep0(steps[0]))
                },
                needParen = true,
                value = k,
                hint = "被除数是算式时，必须括起来，否则变成先除后算。",
            ),
        )
    }
}

/**
 * 类型 2：先乘除后加减（**不加括号**）
 * 如：3 × 9 = 27, 64 + 27 = 91  →  64 + 3 × 9 = 91
 */
private fun genMulDivThenAddSub(random: Random): CompoundProblem? {
    val a1: Int
    val b1: Int
    val r: Int
    val op1: String
    if (random.nextDouble() < 0.5) {
        a1 = rndInclusive(2, 9, random)
        b1 = rndInclusive(2, 9, random)
        r = a1 * b1
        op1 = "×"
    } else {
        b1 = rndInclusive(2, 9, random)
        r = rndInclusive(2, 9, random)
        a1 = b1 * r
        op1 = "÷"
    }
    if (r > 81 || a1 > 81) return null

    // 第二步：加减，r 作第二个操作数；other 不能等于 r（否则替换后分不清哪一个是它）
    val usePlus2 = random.nextDouble() < 0.5
    var other = rndInclusive(10, 60, random)
    if (other == r) other += 1
    val total = if (usePlus2) other + r else other - r
    if (total < 1 || total > 99) return null
    val op2 = if (usePlus2) "+" else "-"

    val steps = listOf(
        mk(a1, op1, b1, r),
        mk(other, op2, r, total, "b"),
    )
    return buildProblem(
        CompoundKind.MULDIV_THEN_ADDSUB, steps,
        BuildSpec(
            mergedTokens = {
                listOf(tok(other.toString(), TokenType.NUM), tok(op2, TokenType.OP, prec = OpPrec.AS)) +
                    exprTokensFromStep0(steps[0])
            },
            needParen = false,
            value = total,
            hint = "乘除本来就先算，直接代进去，括号多余。",
        ),
    )
}

/**
 * 类型 3：第一个算式的结果是**减数**（被减数固定）
 * 如：25 - 12 = 13, 40 - 13 = 27  →  40 - (25 - 12) = 27
 */
private fun genAsSubtrahend(random: Random): CompoundProblem? {
    val r = rndInclusive(3, 20, random)
    val usePlus1 = random.nextDouble() < 0.5
    val a1: Int
    val b1: Int
    if (usePlus1) {
        a1 = rndInclusive(2, r - 1, random)
        b1 = r - a1
    } else {
        a1 = rndInclusive(r + 1, r + 20, random)
        b1 = a1 - r
    }
    val op1 = if (usePlus1) "+" else "-"
    if (a1 < 2 || b1 < 1 || a1 == b1 || a1 > 60 || b1 > 60) return null

    // 第二步：被减数 - r = k；被减数不能等于 r（否则替换后分不清）
    val k = rndInclusive(2, 30, random)
    val minuend = k + r
    if (minuend > 99 || minuend == r) return null
    val steps = listOf(
        mk(a1, op1, b1, r),
        mk(minuend, "-", r, k, "b"),
    )
    return buildProblem(
        CompoundKind.AS_SUBTRAHEND, steps,
        BuildSpec(
            mergedTokens = {
                listOf(tok(minuend.toString(), TokenType.NUM), tok("-", TokenType.OP, prec = OpPrec.AS)) +
                    wrapTokens(exprTokensFromStep0(steps[0]))
            },
            needParen = true,
            value = k,
            hint = "减号后面是算式，必须括起来先算，否则从左往右算错。",
        ),
    )
}

/**
 * 类型 4：第一个算式的结果是**被除数**
 * 如：8 + 4 = 12, 12 ÷ 3 = 4  →  (8 + 4) ÷ 3 = 4
 */
private fun genAsDividend(random: Random): CompoundProblem? {
    val r = rndInclusive(6, 40, random)
    val usePlus1 = random.nextDouble() < 0.5
    val a1: Int
    val b1: Int
    if (usePlus1) {
        // 两个加数都 >= 2，r >= 4（rnd(6,40) 已保证）
        a1 = rndInclusive(2, r - 2, random)
        b1 = r - a1
    } else {
        a1 = rndInclusive(r + 2, r + 30, random)
        b1 = a1 - r
    }
    val op1 = if (usePlus1) "+" else "-"
    if (a1 < 2 || b1 < 2 || a1 == b1 || a1 > 80 || b1 > 60) return null

    val divisor = rndInclusive(2, 9, random)
    val k = safeDiv(r, divisor)
    if (k == null || k < 1 || r == divisor) return null
    val steps = listOf(
        mk(a1, op1, b1, r),
        mk(r, "÷", divisor, k, "a"),
    )
    return buildProblem(
        CompoundKind.AS_DIVIDEND, steps,
        BuildSpec(
            mergedTokens = {
                wrapTokens(exprTokensFromStep0(steps[0])) +
                    listOf(tok("÷", TokenType.OP, prec = OpPrec.MD), tok(divisor.toString(), TokenType.NUM))
            },
            needParen = true,
            value = k,
            hint = "被除数是加减算式时，先括起来算出它，再去除。",
        ),
    )
}

// ────────────────────────────────────────────────────────────
// 对外：生成题目
// ────────────────────────────────────────────────────────────

/** 索引 → 生成器 的静态表保证顺序一致，避免「指定题型却生成别的题型」 */
private val GENERATORS: List<Pair<CompoundKind, (Random) -> CompoundProblem?>> = listOf(
    CompoundKind.ADDSUB_THEN_MULDIV to ::genAddSubThenMulDiv,
    CompoundKind.MULDIV_THEN_ADDSUB to ::genMulDivThenAddSub,
    CompoundKind.AS_SUBTRAHEND to ::genAsSubtrahend,
    CompoundKind.AS_DIVIDEND to ::genAsDividend,
)

/** 各题型权重（三年级上以「先加减后乘除」为重难点，权重最高）—— 下标即题型 */
private val WEIGHTS = intArrayOf(4, 3, 2, 2)

/**
 * 生成一道题。
 * @param kinds 限定题型（不传 = 按权重随机）
 */
fun generateProblem(kinds: List<CompoundKind>? = null, random: Random = Random.Default): CompoundProblem? {
    // 指定题型：直接取对应生成器（多次尝试，躲开内部 return null 的苛刻条件）
    if (!kinds.isNullOrEmpty()) {
        repeat(200) {
            val k = kinds[rndInclusive(0, kinds.size - 1, random)]
            val gen = GENERATORS.firstOrNull { it.first == k }?.second
            val p = gen?.invoke(random)
            if (p != null) return p
        }
        return null
    }

    // 未指定：按权重随机
    val total = GENERATORS.indices.sumOf { WEIGHTS.getOrElse(it) { 1 } }
    repeat(200) {
        var t = random.nextDouble() * total
        var idx = GENERATORS.size - 1
        for (j in GENERATORS.indices) {
            t -= WEIGHTS.getOrElse(j) { 1 }
            if (t <= 0) {
                idx = j
                break
            }
        }
        val p = GENERATORS[idx].second(random)
        if (p != null) return p
    }
    return null
}

/** 批量生成 n 道不重复的题（生成不出足够多时按实际数量返回） */
fun generateProblems(
    n: Int,
    kinds: List<CompoundKind>? = null,
    random: Random = Random.Default,
): List<CompoundProblem> {
    val out = ArrayList<CompoundProblem>(n)
    val seen = HashSet<String>()
    var i = 0
    while (i < n * 25 && out.size < n) {
        i++
        val p = generateProblem(kinds, random) ?: continue
        val sig = tokensToText(p.merged.tokens)
        if (!seen.add(sig)) continue
        out.add(p)
    }
    return out
}

// ────────────────────────────────────────────────────────────
// 易错示例（静态精选，教学法归纳；数值均已人工验算）
// ────────────────────────────────────────────────────────────

val MISTAKE_CASES: List<MistakeCase> = listOf(
    MistakeCase(
        kind = MistakeKind.MISSING_PAREN,
        title = "漏加括号（最常见）",
        icon = "paren",
        wrong = "20 - 15 × 6 = 20 - 90 = -70",
        right = "(20 - 15) × 6 = 5 × 6 = 30",
        why = "原式要先算 20 - 15，写成综合算式后乘除会抢在前头，答案全错。",
        tip = "先加减、后乘除，括号不能省！",
    ),
    MistakeCase(
        kind = MistakeKind.MISSING_PAREN,
        title = "减号后面漏括号",
        icon = "paren",
        wrong = "83 - 27 ÷ 8 = 83 - 27 ÷ 8（除不尽，做不下去）",
        right = "(83 - 27) ÷ 8 = 56 ÷ 8 = 7",
        why = "27 是 83 减出来的，要整体参与除法；不括起来就变成 83 减 27÷8。",
        tip = "减号 / 除号后面是算式，加括号。",
    ),
    MistakeCase(
        kind = MistakeKind.EXTRA_PAREN,
        title = "多加括号（也扣分）",
        icon = "parenSlash",
        wrong = "5 × (63 ÷ 7) = 45（虽然答案对，但没必要）",
        right = "5 × 63 ÷ 7 = 5 × 9 = 45",
        why = "乘除同级，从左往右本来就先算 63 ÷ 7 —— 括号多余。",
        tip = "同级运算从左往右，不加括号。",
    ),
    MistakeCase(
        kind = MistakeKind.EXTRA_PAREN,
        title = "把乘除顺序搞反",
        icon = "parenSlash",
        wrong = "(5 × 63) ÷ 7 = 315 ÷ 7 = 45",
        right = "5 × 63 ÷ 7 = 45",
        why = "答案碰巧一样，但 (5×63) 改了运算顺序，不是题目要的「先算 63÷7」。",
        tip = "该先算哪个就放对位置，别乱加括号。",
    ),
    MistakeCase(
        kind = MistakeKind.LEFT_TO_RIGHT,
        title = "同级运算跳步抢算",
        icon = "ltrSteps",
        wrong = "24 - 13 + 18 误算成 24 - (13 + 18) = -7",
        right = "24 - 13 + 18 = 11 + 18 = 29",
        why = "加减同级，要从左往右挨着算，不能挑后面的先算。",
        tip = "同级运算：从左往右，一个一个来。",
    ),
    MistakeCase(
        kind = MistakeKind.WRONG_ORDER,
        title = "异级顺序弄反",
        icon = "timesDiv",
        wrong = "4 + 6 × 3 误算成 (4 + 6) × 3 = 30",
        right = "4 + 6 × 3 = 4 + 18 = 22",
        why = "有乘除又有加减，要先算乘除；题里没括号就不能自己加。",
        tip = "先乘除、后加减；想改顺序才用小括号。",
    ),
    MistakeCase(
        kind = MistakeKind.LEFT_TO_RIGHT,
        title = "括号里也要看优先级",
        icon = "ltrSteps",
        wrong = "(12 + 8 × 3) ÷ 4 误算成 (20 × 3) ÷ 4 = 15",
        right = "(12 + 8 × 3) ÷ 4 = (12 + 24) ÷ 4 = 9",
        why = "括号里照样「先乘除后加减」，8×3 要先算，不能一路从左往右。",
        tip = "括号只改里外顺序，括号里的规矩不变。",
    ),
)

/** 按类型取易错示例 */
fun mistakeCasesOf(kind: MistakeKind): List<MistakeCase> = MISTAKE_CASES.filter { it.kind == kind }

// ────────────────────────────────────────────────────────────
// 口诀 / 常考点
// ────────────────────────────────────────────────────────────

val RULES: List<RuleBlock> = listOf(
    RuleBlock(
        title = "① 找 —— 找相同的那个数",
        icon = "lookup",
        lines = listOf("两个算式里相同的数，就是第一步的得数"),
    ),
    RuleBlock(
        title = "② 换 —— 把得数换成整段算式",
        icon = "substitute",
        lines = listOf("第二步里那个数，换成第一步的整个算式"),
    ),
    RuleBlock(
        title = "③ 查 —— 比一比运算顺序",
        icon = "checkMark",
        lines = listOf("顺序变了就补小括号"),
    ),
    RuleBlock(
        title = "要不要加括号？",
        icon = "paren",
        lines = listOf("先加减、后乘除，加括号", "得数做被除数 / 减数，加括号", "其余，不加"),
    ),
)

/** 题型 → 中文名 */
val KIND_LABEL: Map<CompoundKind, String> = mapOf(
    CompoundKind.ADDSUB_THEN_MULDIV to "先加减，后乘除",
    CompoundKind.MULDIV_THEN_ADDSUB to "先乘除，后加减",
    CompoundKind.AS_DIVIDEND to "得数做被除数",
    CompoundKind.AS_SUBTRAHEND to "得数做减数",
)

/** ★ 题型图标（MathIcons 的键）—— 提示行左边画一个，一幅图顶一句话 */
val KIND_ICON: Map<CompoundKind, String> = mapOf(
    CompoundKind.ADDSUB_THEN_MULDIV to "paren",
    CompoundKind.MULDIV_THEN_ADDSUB to "parenSlash",
    CompoundKind.AS_DIVIDEND to "paren",
    CompoundKind.AS_SUBTRAHEND to "paren",
)
