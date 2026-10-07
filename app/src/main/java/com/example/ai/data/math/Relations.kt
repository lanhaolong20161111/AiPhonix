package com.example.ai.data.math

import kotlin.random.Random

/**
 * 数量关系与交换 —— 规则引擎（零后端调用）。移植自
 * web 侧 `web/src/modules/math_relations/relations.ts`。
 *
 * ── 这一页要解决的真问题 ─────────────────────────────────────────
 * 孩子把「小明比小红多 3 个」和「小红比小明多 3 个」当成同一句话。
 * 他不是没算对差，而是没看出这两句话的主语换了 —— 数一个没动，
 * 变的只是「谁站在哪个角色上」。
 *
 * 所以本页把四类数量关系摆在一起，只演一件事：换个位置会怎样。
 *
 *   一共    3 ＋ 5 ＝ 8  ⇄  5 ＋ 3 ＝ 8           ⇒ 结论不变（加法交换律）
 *   比多少  7 比 4 多 3  ⇄  4 比 7 少 3          ⇒ 数没变，词翻了
 *   倍数    6 是 2 的 3 倍 ⇄ 2 是 6 的 1/3        ⇒ 关系翻了
 *   平均分  12÷3＝4（每份几个）⇄ 12÷4＝3（分成几份）⇒ 问的不是一件事
 *
 * ── 颜色该标什么：角色，不是大小 ─────────────────────────────────
 * 「按大小上色」（多的红、少的蓝）在这一页必然失效：交换前后 7 还是 7、
 * 4 还是 4，颜色一模一样，学生看不出发生过任何事。
 * 按角色上色才对：颜色挂在槽位上。交换时量在位移、槽位不动，
 * 于是两个色块对调 —— 学生看到的是「还是那 4 个，但它变成橙色的了」，
 * 一句话就懂：它的角色变了，所以结论变了。
 *
 * 由此得到全页唯一的一条纲：
 *   两边同色（对等）⇒ 能换；一青一橙（有方向）⇒ 换了就变。
 *
 * ── 为什么不用大模型出题 ─────────────────────────────────────────
 * 本题型是纯逻辑（关系句、算式、交换后果必须三者自洽）。
 * 规则引擎 = 0 延迟 + 0 成本 + 可离线 + 100% 正确，且每条结论都能写进单测。
 *
 * ★ 顶层名一律 Rl / rl / RL_ 前缀 —— 同包（data.math）里已有
 *   CompoundExpr 的 KIND_LABEL / RULES / MISTAKE_CASES / generateProblem、
 *   EqMove 的 EQ_ 系列、MulOne 的 MO_ 系列，裸名必撞（撞了报的是
 *   「Overload resolution ambiguity」且位置全在调用点，极难定位）。
 */

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 四类数量关系。★ 页面渲染按钮、引擎抽题都读 [RL_KIND_GROUPS]，页面绝不手写清单 */
enum class RlKind {
    /** 一共：两个部分合成总量 —— 对称，交换律成立 */
    TOTAL,

    /** 比多少：多 / 少 —— 有方向，交换主宾后词翻转 */
    COMPARE,

    /** 倍数：谁是谁的几倍 —— 有方向，交换主宾后关系翻转 */
    TIMES,

    /** 平均分：等分除 / 包含除 —— 有方向，交换后含义改变 */
    SHARE,
}

/**
 * ★ 角色 —— 颜色就挂在这上面。交换位置时角色不动，动的是量。
 * 这是本页最核心的一条设计：标「角色」才对，标「大小」必错。
 */
enum class RlRole {
    /** 对等的部分（一共的两个加数）—— 中性灰：两边同色 ⇒ 能换 */
    PART,

    /** 总量 / 差 / 倍数这类「合出来」的结果 —— 深色 */
    WHOLE,

    /** 基准量 / 1 倍量 / 每份数 —— 青绿：跟谁比的那一个 */
    BASE,

    /** 比较量 / 份数 —— 橙红：拿它去比的那一个 */
    CMP,
}

/** ★ 交换的后果 —— 全页就讲这张表 */
enum class RlSwapEffect {
    /** 结论完全不变（一共：加法交换律） */
    KEEP,

    /** 数值不变、词翻转（比多少：多 ⇄ 少） */
    FLIP_WORD,

    /** 关系翻转（倍数：n 倍 ⇄ 1/n） */
    FLIP_RATE,

    /** 含义改变（平均分：份数 ⇄ 每份数） */
    FLIP_MEANING,
}

/** 易错点类型 */
enum class RlMistakeKind { SAY_WRONG, REVERSE, FACTOR_CONFUSE, SENSE_MIX, OVER_SWAP, DIFF_VS_TIMES }

/** 图上「几个点」的排布；前 value 个点亮，点一律**从左上角起算** */
data class RlShape(val rows: Int, val cols: Int)

/** 一个量：谁、多少、什么单位、怎么摆 */
data class RlQuantity(val who: String, val value: Int, val unit: String, val shape: RlShape)

/** 一句关系句 + 要拿出来对照的那一小段 */
data class RlLine(val text: String, val key: String)

/** 平均分专属：同一个总数，两种分法的排布 */
data class RlShareGrid(val total: Int, val before: RlShape, val after: RlShape)

/** 两态算式 —— 供单测**独立重算**（不要去读 nums，那就是自证） */
data class RlEq(val before: String, val after: String)

/** 两态的数值快照 —— 用来断言「数一个没动、角色却换了」 */
data class RlNums(val before: Pair<Int, Int>, val after: Pair<Int, Int>)

/** 第三个数（总量 / 差 / 倍数 / 总数） */
data class RlResult(val label: String, val value: Int, val unit: String, val role: RlRole)

/** 倍数的第二级交换：换因数（乘法交换律）⇒ 这一级不变 */
data class RlFactorSwap(val n: Int, val b: Int, val value: Int, val text: String)

/** 平均分：同一个算式的两种含义 */
data class RlShareSenses(val divide: String, val contain: String)

/** 一步一填的一步 */
data class RlSolveStep(
    val key: String,
    val label: String,
    val ask: String,
    val options: List<String>,
    val answer: String,
    val tip: String,
)

data class RlProblem(
    val id: String,
    val kind: RlKind,
    /** ★ 槽位角色（交换时**不动** —— 颜色挂在这里） */
    val slotRole: Pair<RlRole, RlRole>,
    /** 交换前站在左 / 右槽位的两个量 */
    val left: RlQuantity,
    val right: RlQuantity,
    /** 关系句：交换前 / 交换后 */
    val before: RlLine,
    val after: RlLine,
    val effect: RlSwapEffect,
    /** 交换后到底变了什么（一句话点破） */
    val reveal: String,
    /** 两态算式 —— 供单测独立重算 */
    val eq: RlEq,
    /** 交换后**没变**的那个东西 */
    val invariant: String,
    val result: RlResult,
    val nums: RlNums,
    val factorSwap: RlFactorSwap? = null,
    val shareSenses: RlShareSenses? = null,
    val shareGrid: RlShareGrid? = null,
    /** 一步一填的步骤（由本道题派生，页面不另写数学） */
    val solveSteps: List<RlSolveStep>,
)

data class RlMistakeCase(
    val kind: RlMistakeKind,
    val title: String,
    val wrong: String,
    val right: String,
    val why: String,
    val tip: String,
    val icon: String,
)

/** 题型清单的一项。`dir == true` ⇒ 一青一橙，换了会变 */
data class RlKindGroup(val key: RlKind, val title: String, val desc: String, val icon: String, val dir: Boolean)

/** 四类对照表的一行 */
data class RlSwapRow(
    val kind: RlKind,
    val title: String,
    val icon: String,
    /** 交换前 / 后 的关键片段 */
    val before: String,
    val after: String,
    val effect: RlSwapEffect,
    /** 一句话 */
    val note: String,
)

data class RlRuleCard(val title: String, val body: String, val icon: String)

data class RlEffectLabel(val label: String, val changed: Boolean)

/** ★ 角色 → 颜色。青绿 = 基准，橙红 = 比较，灰 = 对等 / 结果。颜色一律 0xFFRRGGBB */
data class RlRoleMeta(val label: String, val hint: String, val fg: Long, val bg: Long, val dot: Long)

// ────────────────────────────────────────────────────────────
// 配色 / 文案表（页面直接取，绝不自己发明颜色）
// ────────────────────────────────────────────────────────────

val RL_ROLE_META: Map<RlRole, RlRoleMeta> = mapOf(
    RlRole.PART to RlRoleMeta("部分", "地位对等", 0xFF475569, 0xFFE2E8F0, 0xFF94A3B8),
    RlRole.WHOLE to RlRoleMeta("结果", "合出来的", 0xFF0F172A, 0xFFE2E8F0, 0xFF334155),
    RlRole.BASE to RlRoleMeta("基准", "跟谁比", 0xFF0F766E, 0xFFCCFBF1, 0xFF0D9488),
    RlRole.CMP to RlRoleMeta("比较", "拿它去比", 0xFFC2410C, 0xFFFFEDD5, 0xFFEA580C),
)

val RL_EFFECT_LABEL: Map<RlSwapEffect, RlEffectLabel> = mapOf(
    RlSwapEffect.KEEP to RlEffectLabel("不变", false),
    RlSwapEffect.FLIP_WORD to RlEffectLabel("词翻了", true),
    RlSwapEffect.FLIP_RATE to RlEffectLabel("关系翻了", true),
    RlSwapEffect.FLIP_MEANING to RlEffectLabel("问题变了", true),
)

val RL_KIND_GROUPS: List<RlKindGroup> = listOf(
    RlKindGroup(RlKind.TOTAL, "一共", "两边对等", "mergeTerms", false),
    RlKindGroup(RlKind.COMPARE, "比多少", "谁跟谁比", "moreLess", true),
    RlKindGroup(RlKind.TIMES, "倍数", "谁是谁的几倍", "timesCopies", true),
    RlKindGroup(RlKind.SHARE, "平均分", "分成几份", "shareEqual", true),
)

val RL_KIND_LABEL: Map<RlKind, String> = mapOf(
    RlKind.TOTAL to "一共",
    RlKind.COMPARE to "比多少",
    RlKind.TIMES to "倍数",
    RlKind.SHARE to "平均分",
)

/** 规律卡（口诀）—— 全页唯一的纲领 */
val RL_RULES: List<RlRuleCard> = listOf(
    RlRuleCard("① 颜色标的是角色", "不是谁多谁少", "swapRoles"),
    RlRuleCard("② 两边同色 ⇒ 能换", "对等，换了结论一样", "mergeTerms"),
    RlRuleCard("③ 一青一橙 ⇒ 换了就变", "有方向，角色一换说法就翻", "moreLess"),
    RlRuleCard("④ 数是位置搬，角色不搬", "数一个没变，变的是谁站哪儿", "timesCopies"),
)

/**
 * 易错示例（静态精选；每条都人工验算过）。
 * ★ `why` / `tip` 一律压在 18 字内 —— 卡片窄，超了就折行把 6 张卡撑得高矮不齐。
 */
val RL_MISTAKE_CASES: List<RlMistakeCase> = listOf(
    RlMistakeCase(
        RlMistakeKind.SAY_WRONG, "换了主语，词没跟着换",
        "4 比 7 多 3", "4 比 7 少 3（7 比 4 才是多 3）",
        "主语换了，多和少跟着换", "先看主语，再定多还是少", "moreLess",
    ),
    RlMistakeCase(
        RlMistakeKind.REVERSE, "「谁是谁的几倍」说反了",
        "2 是 6 的 3 倍", "6 是 2 的 3 倍（2 是 6 的 1/3）",
        "6 里才有 3 个 2", "反过来不到 1 倍", "timesCopies",
    ),
    RlMistakeCase(
        RlMistakeKind.FACTOR_CONFUSE, "以为「倍」怎么换都会变",
        "2 的 3 倍 ≠ 3 的 2 倍", "2 的 3 倍 ＝ 3 的 2 倍 ＝ 6",
        "换因数不变，换主宾才变", "乘法交换律允许换因数", "swapRoles",
    ),
    RlMistakeCase(
        RlMistakeKind.SENSE_MIX, "两种「平均分」混成一件事",
        "12 ÷ 3 和 12 ÷ 4 都在问每份几个", "12÷3 求每份几个；12÷4 求分成几份",
        "除以份数得每份数", "先看问的是份数还是每份", "shareEqual",
    ),
    RlMistakeCase(
        RlMistakeKind.OVER_SWAP, "以为换位置会把总数也换了",
        "3 + 5 和 5 + 3 结果不一样", "3 ＋ 5 ＝ 5 ＋ 3 ＝ 8",
        "两边对等，换位置和不变", "同色就能换，换了不变", "mergeTerms",
    ),
    RlMistakeCase(
        RlMistakeKind.DIFF_VS_TIMES, "把「多几」当成「是几倍」",
        "7 是 4 的 3 倍", "7 比 4 多 3；7 是 4 的 1 倍多",
        "「多 3」是差，「3 倍」是乘", "多几看差，几倍看乘", "moreLess",
    ),
)

/** 四类对照（页面「一条纲」那张表） */
val RL_SWAP_TABLE: List<RlSwapRow> = listOf(
    RlSwapRow(RlKind.TOTAL, "一共", "mergeTerms", "3 ＋ 5 ＝ 8", "5 ＋ 3 ＝ 8", RlSwapEffect.KEEP, "两边同色，换了不变"),
    RlSwapRow(RlKind.COMPARE, "比多少", "moreLess", "7 比 4 多 3", "4 比 7 少 3", RlSwapEffect.FLIP_WORD, "数没变，词翻了"),
    RlSwapRow(RlKind.TIMES, "倍数", "timesCopies", "6 是 2 的 3 倍", "2 是 6 的 1/3", RlSwapEffect.FLIP_RATE, "主宾一换，关系就翻"),
    // ★ 两格只留算式，「每份几个 / 分成几份」放进 note：单元格窄，
    //   带上括号里的 6 个全角字必折行、还把这一行撑高（4 行高度不齐很难看）。
    RlSwapRow(RlKind.SHARE, "平均分", "shareEqual", "12÷3＝4", "12÷4＝3", RlSwapEffect.FLIP_MEANING, "同一个 12，问每份还是份数"),
)

// ────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────

/**
 * ★ 复刻 JS 的 `min + floor(random * (max - min + 1))`。
 * ⚠️ 不能直接写 `random.nextInt(min, max + 1)`：JS 那条在**跨度 ≤ 0 时返回 min**，
 *    而 Kotlin 的 nextInt 会抛 IllegalArgumentException（只在特定随机值下出现，极难复现）。
 */
internal fun rlRndInclusive(min: Int, max: Int, random: Random): Int {
    val span = max - min + 1
    if (span <= 0) return min
    return min + random.nextInt(span)
}

private fun <T> rlPick(xs: List<T>, random: Random): T = xs[rlRndInclusive(0, xs.size - 1, random)]

private val RL_NAMES: List<String> = listOf("小明", "小红", "小刚", "小丽", "冬冬", "丫丫")

/** 从池里取两个不同的名字 */
private fun rlTwoNames(random: Random): Pair<String, String> {
    val a = rlPick(RL_NAMES, random)
    var b = rlPick(RL_NAMES, random)
    for (i in 0 until 20) {
        if (b != a) break
        b = rlPick(RL_NAMES, random)
    }
    return a to b
}

private val RL_SEQ = java.util.concurrent.atomic.AtomicInteger(0)

private fun rlNextId(kind: RlKind): String =
    "${kind.name.lowercase()}-${RL_SEQ.incrementAndGet()}-${java.lang.Long.toString(System.currentTimeMillis(), 36)}"

/**
 * 选项去重 —— ★ 陷阱项**可能与正确答案撞车**（如比多少里 差 == 小数 时，
 * 「多 3 个」既是错答又是另一个错答），也可能彼此相同。
 * 直接拼 List 会让同一句话出现两次，学生一眼就看出答案 ⇒ 必须过滤。
 * 实测就是这么被 web 侧单测抓到的。
 */
internal fun rlOpts(answer: String, vararg traps: String): List<String> {
    val out = mutableListOf(answer)
    for (t in traps) if (!out.contains(t)) out.add(t)
    return out
}

// ────────────────────────────────────────────────────────────
// 四个生成器 —— 一律「先定结果，再反推操作数」
// ────────────────────────────────────────────────────────────

/** 一共：a ＋ b ＝ total。两个部分**同色**（对等）⇒ 交换后什么也不变 */
private fun rlGenTotal(random: Random): RlProblem? {
    val a = rlRndInclusive(2, 9, random)
    val b = rlRndInclusive(2, 9, random)
    // 教材感：两个加数不一样（3 ＋ 3 数学上没错，但不像例题）
    if (a == b) return null
    val total = a + b
    val (wa, wb) = rlTwoNames(random)
    val cols = maxOf(a, b)

    val before = RlLine("$wa $a 个 ＋ $wb $b 个 ＝ 一共 $total 个", "一共 $total 个")
    val after = RlLine("$wb $b 个 ＋ $wa $a 个 ＝ 一共 $total 个", "一共 $total 个")

    return RlProblem(
        id = rlNextId(RlKind.TOTAL),
        kind = RlKind.TOTAL,
        // ★ 两个部分同角色 ⇒ 同色 ⇒ 交换后视觉上什么都不变
        slotRole = RlRole.PART to RlRole.PART,
        left = RlQuantity(wa, a, "个", RlShape(1, cols)),
        right = RlQuantity(wb, b, "个", RlShape(1, cols)),
        before = before,
        after = after,
        effect = RlSwapEffect.KEEP,
        reveal = "换了位置，一共还是 $total 个",
        eq = RlEq("$a ＋ $b ＝ $total", "$b ＋ $a ＝ $total"),
        invariant = "两堆还是那些，一个没多一个没少",
        result = RlResult("一共", total, "个", RlRole.WHOLE),
        nums = RlNums(a to b, b to a),
        solveSteps = listOf(
            RlSolveStep(
                key = "effect", label = "先猜一猜",
                ask = "把两堆换个位置，一共会变吗？",
                options = listOf("不变", "会变"), answer = "不变",
                tip = "两边地位一样，换了也是同一堆",
            ),
            RlSolveStep(
                key = "say", label = "再算一算",
                ask = "换完之后，一共是多少？",
                options = rlOpts(total.toString(), maxOf(a, b).toString(), (total + 1).toString()),
                answer = total.toString(),
                tip = "加法换位置，和不变",
            ),
        ),
    )
}

/** 比多少：M － m ＝ d。交换主宾 ⇒ 数值不变，**词从「多」翻成「少」** */
private fun rlGenCompare(random: Random): RlProblem? {
    val m = rlRndInclusive(2, 9, random)
    val d = rlRndInclusive(2, 9, random)
    val big = m + d
    // ★ 上限 18 是**版面对齐**的需要：点阵一行 big 个点，再长就装不进槽位
    if (big > 18) return null
    val (wBig, wSmall) = rlTwoNames(random)

    val before = RlLine("${wBig}比${wSmall}多 $d 个", "多 $d 个")
    val after = RlLine("${wSmall}比${wBig}少 $d 个", "少 $d 个")

    return RlProblem(
        id = rlNextId(RlKind.COMPARE),
        kind = RlKind.COMPARE,
        // 左槽 = 句子的主语（比较量，橙红）｜右槽 = 跟谁比（基准量，青绿）
        slotRole = RlRole.CMP to RlRole.BASE,
        left = RlQuantity(wBig, big, "个", RlShape(1, big)),
        right = RlQuantity(wSmall, m, "个", RlShape(1, big)),
        before = before,
        after = after,
        effect = RlSwapEffect.FLIP_WORD,
        reveal = "$big 和 $m 一个没动，说法却从「多」翻成了「少」",
        eq = RlEq("$big － $m ＝ $d", "$big － $m ＝ $d"),
        invariant = "两个数没变，差也没变 —— 变的只是「谁跟谁比」",
        result = RlResult("相差", d, "个", RlRole.WHOLE),
        nums = RlNums(big to m, m to big),
        solveSteps = listOf(
            RlSolveStep(
                key = "effect", label = "先猜一猜",
                ask = "把两个人换个位置，说法会变吗？",
                options = listOf("会变", "不变"), answer = "会变",
                tip = "一青一橙，说明两边不一样",
            ),
            RlSolveStep(
                key = "say", label = "再想一想",
                ask = "换成「${wSmall}比${wBig}……」该怎么说？",
                options = rlOpts("少 $d 个", "多 $d 个", "少 $big 个"),
                answer = "少 $d 个",
                tip = "主语换成小的那个，词就得翻过来",
            ),
        ),
    )
}

/** 倍数：M ＝ b × n。交换主宾 ⇒ 从 n 倍掉到 1/n；但换**因数**不变（乘法交换律） */
private fun rlGenTimes(random: Random): RlProblem? {
    val b = rlRndInclusive(2, 9, random)
    val n = rlRndInclusive(2, 5, random)
    val big = b * n
    if (big > 45 || n == 1 || big == b) return null
    val (wBig, wSmall) = rlTwoNames(random)

    val before = RlLine("${wBig}是${wSmall}的 $n 倍", "$n 倍")
    val after = RlLine("${wSmall}是${wBig}的 1/$n（不到 1 倍）", "1/$n")

    return RlProblem(
        id = rlNextId(RlKind.TIMES),
        kind = RlKind.TIMES,
        // 左槽 = 比较量（橙红）｜右槽 = 1 倍量（基准，青绿）
        slotRole = RlRole.CMP to RlRole.BASE,
        // 1 倍量 = 一行 b 个；比较量 = n 行 b 个（一眼看出「3 个这样的 1 份」）
        left = RlQuantity(wBig, big, "个", RlShape(n, b)),
        right = RlQuantity(wSmall, b, "个", RlShape(1, b)),
        before = before,
        after = after,
        effect = RlSwapEffect.FLIP_RATE,
        reveal = "同一个 $big 和 $b，换个说法就从 $n 倍掉到 1/$n",
        eq = RlEq("$b × $n ＝ $big", "$b × $n ＝ $big"),
        invariant = "$big 和 $b 都没变，乘积也没变",
        result = RlResult("倍数", n, "倍", RlRole.WHOLE),
        nums = RlNums(big to b, b to big),
        factorSwap = RlFactorSwap(n, b, big, "$b 的 $n 倍 ＝ $n 的 $b 倍 ＝ $big"),
        solveSteps = listOf(
            RlSolveStep(
                key = "effect", label = "先猜一猜",
                ask = "把主宾换个位置，结论会变吗？",
                options = listOf("会变", "不变"), answer = "会变",
                tip = "问「谁是谁的几倍」，主宾不能乱换",
            ),
            RlSolveStep(
                key = "say", label = "再想一想",
                ask = "换成「${wSmall}是${wBig}的……」，是几倍？",
                options = rlOpts("1/$n", "$n 倍", "$b 倍", "1/$big"),
                answer = "1/$n",
                tip = "反过来就不到 1 倍了",
            ),
            RlSolveStep(
                key = "factor", label = "⚠️ 换个地方换",
                ask = "那「$b 的 $n 倍」和「$n 的 $b 倍」呢？",
                options = listOf("一样，都是 $big", "不一样"),
                answer = "一样，都是 $big",
                tip = "换因数可以，乘法交换律",
            ),
        ),
    )
}

/** 平均分：T ＝ k × p。交换「份数」与「每份数」⇒ 同一个 T，**问的不是一件事** */
private fun rlGenShare(random: Random): RlProblem? {
    val k = rlRndInclusive(2, 6, random)
    val p = rlRndInclusive(2, 9, random)
    val t = k * p
    // k == p 时两种分法长得一模一样，看不出区别 ⇒ 丢弃
    if (t > 36 || k == p) return null

    val before = RlLine("$t 个平均分成 $k 份，每份 $p 个", "每份 $p 个")
    val after = RlLine("$t 个，每份 $p 个，能分成 $k 份", "分成 $k 份")

    return RlProblem(
        id = rlNextId(RlKind.SHARE),
        kind = RlKind.SHARE,
        // 左槽 = 份数（橙红）｜右槽 = 每份数（青绿）
        slotRole = RlRole.CMP to RlRole.BASE,
        left = RlQuantity("份数", k, "份", RlShape(1, k)),
        right = RlQuantity("每份", p, "个", RlShape(1, p)),
        before = before,
        after = after,
        effect = RlSwapEffect.FLIP_MEANING,
        reveal = "同一个 $t，问「分成几份」还是问「每份几个」，是两个问题",
        eq = RlEq("$t ÷ $k ＝ $p", "$t ÷ $p ＝ $k"),
        invariant = "$t 个一个没多、一个没少",
        result = RlResult("总数", t, "个", RlRole.WHOLE),
        nums = RlNums(k to p, p to k),
        shareGrid = RlShareGrid(t, RlShape(k, p), RlShape(p, k)),
        shareSenses = RlShareSenses(
            "$t ÷ $k ＝ $p　求每份几个",
            "$t ÷ $p ＝ $k　求分成几份",
        ),
        solveSteps = listOf(
            RlSolveStep(
                key = "effect", label = "先猜一猜",
                ask = "把「几份」和「每份几个」换个位置，同一件事吗？",
                options = listOf("不是一件事", "是同一件事"), answer = "不是一件事",
                tip = "一个求每份数，一个求份数",
            ),
            RlSolveStep(
                key = "say", label = "再想一想",
                ask = "$t ÷ $p 问的是什么？",
                options = rlOpts("能分成几份", "每份几个", "一共几个", "剩下几个"),
                answer = "能分成几份",
                tip = "除以每份数，得份数",
            ),
        ),
    )
}

// ────────────────────────────────────────────────────────────
// 对外：出题
// ────────────────────────────────────────────────────────────

/** ⚠️ 顺序即索引，必须与 [RL_REL_KINDS] 严格一致 */
private val RL_GENERATORS: List<Pair<RlKind, (Random) -> RlProblem?>> = listOf(
    RlKind.TOTAL to ::rlGenTotal,
    RlKind.COMPARE to ::rlGenCompare,
    RlKind.TIMES to ::rlGenTimes,
    RlKind.SHARE to ::rlGenShare,
)

val RL_REL_KINDS: List<RlKind> = RL_GENERATORS.map { it.first }

/**
 * 生成一道题。
 * @param kind 指定题型（null = 四类等权随机）
 */
fun rlGenerateProblem(kind: RlKind? = null, random: Random = Random.Default): RlProblem? {
    // 指定题型：直接取对应生成器（多次尝试，躲开内部 return null 的苛刻条件）
    if (kind != null) {
        val g = RL_GENERATORS.firstOrNull { it.first == kind }?.second ?: return null
        repeat(200) { val p = g(random); if (p != null) return p }
        return null
    }
    // 未指定：四类等权随机
    repeat(200) {
        val p = RL_GENERATORS[rlRndInclusive(0, RL_GENERATORS.size - 1, random)].second(random)
        if (p != null) return p
    }
    return null
}

/** 批量生成 n 道（按「关系句」去重；生成不出足够多时按实际数量返回） */
fun rlGenerateProblems(n: Int, kind: RlKind? = null, random: Random = Random.Default): List<RlProblem> {
    val out = mutableListOf<RlProblem>()
    val seen = mutableSetOf<String>()
    for (i in 0 until n * 40) {
        if (out.size >= n) break
        val p = rlGenerateProblem(kind, random) ?: continue
        val sig = "${p.kind.name}|${p.before.text}"
        if (!seen.add(sig)) continue
        out.add(p)
    }
    return out
}
