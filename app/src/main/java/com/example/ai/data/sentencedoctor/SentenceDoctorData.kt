package com.example.ai.data.sentencedoctor

/**
 * 句子小医生 · 练习内容（Web → Android 一字不改搬过来的）
 *
 * ⚠️ **本文件由脚本生成，不要手改** —— 内容真源在
 *    `web/src/modules/sentence_doctor/data.ts`（廖敏老师自制练习册《提示语及修改病句专项练习》：
 *    上半册《识破标点的幻术》4 关 19 句、下半册《医治句子的疾病》6 关 30 句 35 处病灶）。
 *    生成脚本：`web/tools/gen_sentence_doctor_data.ts`
 *    （跑法：在仓库根 `./web/node_modules/.bin/tsx web/tools/gen_sentence_doctor_data.ts`）。
 *
 * 为什么内容与逻辑分家：一句话 = 文本片段（parts）+ 空位（slots），空位自带标准答案与理由；
 * 页面只负责「点、判、讲」。
 *
 * ⚠️ 标点答案里前引号是 "“"、后引号是 "”" —— 两者是不同字符。
 *    「提示语在中间」那种句子里两处都用逗号，唯一的区别就是引号朝向。
 */

internal const val SD_OQ = "“"   // 中文前引号
internal const val SD_CQ = "”"   // 中文后引号

/** 空位在句子里的角色 —— 决定「✨ 提示」怎么点它 */
internal enum class SdSlotKind { TAG, OPEN, IN, CLOSE, MID, END, NARR }

/** 五把手术刀。`whenTo` 是课本给的使用时机（符号卡的 tooltip 与说明行） */
internal enum class SdTool(val label: String, val whenTo: String) {
    CORRECT("改正", "字写错、词用错、搭配不上"),
    ADD("增补", "少了字、少了成分"),
    DELETE("删除", "重复啰嗦、前后矛盾、归类错"),
    SWAP("对调", "紧挨着的两处位置颠倒"),
    MOVE("移动", "隔开的一段要挪到别处");
}

internal data class SdPunctKey(val c: String, val label: String)

internal data class SdPunctSlot(
    /** 标准答案（按顺序拼出来的标点串，可能两个字符，如「：」+ 前引号） */
    val a: String,
    /** 同样算对的其它写法 */
    val ok: List<String>,
    val kind: SdSlotKind,
    /** 为什么这么填 */
    val why: String,
)

internal data class SdPunctItem(
    /** 文本片段；相邻两段之间（以及首、尾）各有一个空位 */
    val parts: List<String>,
    /** 长度 = parts.size + 1；null = 这里本来就没有标点（不是练习点） */
    val slots: List<SdPunctSlot?>,
    /** ✨ 提示：不直接给答案，只说该往哪儿看 */
    val tip: String,
)

internal data class SdPunctLevel(
    val key: String,
    val name: String,
    /** 通关口诀 */
    val rule: String,
    val items: List<SdPunctItem>,
)

/** 一处病灶在**原句里的位置** —— 用来把修改符号直接画在原句上（位置不靠 diff 猜，见 web 注释） */
internal data class SdSpotMark(
    /** 原句里要划掉／框住的那段（对调、移动时是「源」） */
    val cut: String? = null,
    /** 写上去的新文字（改正、增补） */
    val put: String? = null,
    /** put 补在哪个字之前（增补）；省略 = 就补在 cut 原来的位置 */
    val at: String? = null,
    /** 与 cut 配对的那一段（对调 = 互换的另一半；移动 = 挪到它前面） */
    val with: String? = null,
)

internal data class SdFixSpot(
    val tool: SdTool,
    /** 诊断候选（把病因说成孩子能懂的话） */
    val options: List<String>,
    /** 正确项下标 */
    val answer: Int,
    /** 为什么 */
    val why: String,
    val mark: SdSpotMark,
)

internal data class SdFixCase(
    val text: String,
    /** 一处或多处病灶，按顺序作答 */
    val spots: List<SdFixSpot>,
    /** 订正后的整句（参考答案） */
    val fixed: String,
)

internal data class SdFixLevel(
    val key: String,
    val name: String,
    /** 本关说明（✨ 提示用） */
    val intro: String,
    val items: List<SdFixCase>,
)

/** 空位可选的标点牌（点一下追加到空位里，可叠两个，如「：」+ 前引号） */
internal val SD_PUNCT_KEYS: List<SdPunctKey> = listOf(
    SdPunctKey("，", "逗号"),
    SdPunctKey("。", "句号"),
    SdPunctKey("？", "问号"),
    SdPunctKey("！", "叹号"),
    SdPunctKey("：", "冒号"),
    SdPunctKey("“", "前引号"),
    SdPunctKey("”", "后引号"),
)

/** 空位角色 → 提示语（✨ 提示里逐空点一下，但不给答案） */
internal val SD_SLOT_HINT: Map<SdSlotKind, String> = mapOf(
    SdSlotKind.TAG to "提示语在前 → 它后面是「冒号 + 前引号」两个标点",
    SdSlotKind.OPEN to "话的开头 → 先写前引号，把话「打开」",
    SdSlotKind.IN to "话还没说完，中间的停顿 → 逗号",
    SdSlotKind.CLOSE to "话的末尾 → 先写句末标点（。！？），再写后引号",
    SdSlotKind.MID to "提示语在中间 → 它后面是「逗号 + 前引号」",
    SdSlotKind.END to "全句结束 → 句号",
    SdSlotKind.NARR to "提示语后面还有叙述要讲 → 中间用逗号",
)

/** 上半册：提示语标点 */
internal val SD_PUNCT_LEVELS: List<SdPunctLevel> = listOf(
    SdPunctLevel(
        key = "p1",
        name = "第一关 · 提示语在前",
        rule = "提示语在前面，冒号引号紧相连",
        items = listOf(
            SdPunctItem(
                parts = listOf("老屋说", "好了", "我到了倒下的时候了"),
                slots = listOf(
                    null,
                    SdPunctSlot(
                        a = "：“",
                        ok = emptyList(),
                        kind = SdSlotKind.TAG,
                        why = "「老屋说」是提示语，它在前面。提示语后面先写冒号，再紧跟着写上引号（「：“」）。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = emptyList(),
                        kind = SdSlotKind.IN,
                        why = "「好了」是这句话里的小停顿，话还没说完，用逗号。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "话到这里说完了，先写句末的句号，再补上后引号（「。”」）。",
                    ),
                ),
                tip = "先找提示语：「老屋说」。它后面写什么？话又是从哪儿开头、到哪儿结束？",
            ),
            SdPunctItem(
                parts = listOf("蜗牛难过地告诉陶陶", "太糟了", "你完全走反了方向"),
                slots = listOf(
                    null,
                    SdPunctSlot(
                        a = "：“",
                        ok = emptyList(),
                        kind = SdSlotKind.TAG,
                        why = "提示语「蜗牛难过地告诉陶陶」在最前面，后面要用冒号加前引号。提示语里带上「难过地」更好——情绪写在提示语里，说的话才不显得突然。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = emptyList(),
                        kind = SdSlotKind.IN,
                        why = "「太糟了」是话里的一个短句，后面还有话要说，用逗号停一下。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "「你完全走反了方向」说完了，用句号收尾，再补后引号。",
                    ),
                ),
                tip = "提示语可以很长（「蜗牛难过地告诉陶陶」），但它仍然是提示语，后面照样是冒号加前引号。",
            ),
            SdPunctItem(
                parts = listOf("我问老板", "这本书多少钱"),
                slots = listOf(
                    null,
                    SdPunctSlot(
                        a = "：“",
                        ok = emptyList(),
                        kind = SdSlotKind.TAG,
                        why = "提示语在前面，冒号加前引号紧相连。",
                    ),
                    SdPunctSlot(
                        a = "？”",
                        ok = listOf("。”"),
                        kind = SdSlotKind.CLOSE,
                        why = "这是一句问话，末尾用问号（「？”」）——问号写在后引号里面，因为它是「话」的一部分。",
                    ),
                ),
                tip = "「问」字已经告诉你了：这是问话，末尾该用哪个标点？",
            ),
            SdPunctItem(
                parts = listOf("老师问", "同学们", "听明白了吗"),
                slots = listOf(
                    null,
                    SdPunctSlot(
                        a = "：“",
                        ok = emptyList(),
                        kind = SdSlotKind.TAG,
                        why = "提示语「老师问」在前面，后面写冒号加前引号。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = emptyList(),
                        kind = SdSlotKind.IN,
                        why = "「同学们」是称呼，喊完要停一下，用逗号。",
                    ),
                    SdPunctSlot(
                        a = "？”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "问话结束，问号加后引号。",
                    ),
                ),
                tip = "「同学们」是在喊人，喊完的话要不要停一下？",
            ),
            SdPunctItem(
                parts = listOf("同学们激动地欢呼", "我们是第一名"),
                slots = listOf(
                    null,
                    SdPunctSlot(
                        a = "：“",
                        ok = emptyList(),
                        kind = SdSlotKind.TAG,
                        why = "提示语在前面，冒号加前引号。",
                    ),
                    SdPunctSlot(
                        a = "！”",
                        ok = listOf("。”"),
                        kind = SdSlotKind.CLOSE,
                        why = "「激动地欢呼」说明语气很强烈，句末用叹号更能读出那股高兴劲儿。",
                    ),
                ),
                tip = "看看提示语里的词——「激动地欢呼」，这样的语气该用什么标点？",
            ),
        ),
    ),
    SdPunctLevel(
        key = "p2",
        name = "第二关 · 提示语在后",
        rule = "提示语在后面，只写引号在前面",
        items = listOf(
            SdPunctItem(
                parts = listOf("非常感谢你给我指路", "说完", "陶陶慢慢掉头往回走"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "话在最前面，所以句子一开头就是前引号。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "「非常感谢你给我指路」说完了，句号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = listOf("。"),
                        kind = SdSlotKind.NARR,
                        why = "「说完」是提示语，它后面还有一句叙述没讲完，中间的停顿用逗号。",
                    ),
                    SdPunctSlot(
                        a = "。",
                        ok = emptyList(),
                        kind = SdSlotKind.END,
                        why = "「陶陶慢慢掉头往回走」是全句最后一句，用句号收尾。",
                    ),
                ),
                tip = "这句话里有两次「收尾」：一次是话说完（要带后引号），一次是全句结束。别混在一起。",
            ),
            SdPunctItem(
                parts = listOf("可是", "后天就要举行婚礼了呀", "蜗牛几乎带着哭腔说"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "提示语在后面，所以话的开头直接写前引号。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = emptyList(),
                        kind = SdSlotKind.IN,
                        why = "「可是」是话里的一个大喘气，后面还有话，用逗号。",
                    ),
                    SdPunctSlot(
                        a = "！”",
                        ok = listOf("。”"),
                        kind = SdSlotKind.CLOSE,
                        why = "「呀」和「带着哭腔」都在提示语气强烈、很着急，句末用叹号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "。",
                        ok = emptyList(),
                        kind = SdSlotKind.END,
                        why = "提示语「蜗牛几乎带着哭腔说」讲完了，全句用句号。",
                    ),
                ),
                tip = "「呀」「带着哭腔」都是在给你递暗号——这句话是什么语气？",
            ),
            SdPunctItem(
                parts = listOf("只要一步一步坚持走", "我会准时赶到的", "陶陶说"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "话在前面，开头写前引号。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = emptyList(),
                        kind = SdSlotKind.IN,
                        why = "「只要一步一步坚持走」是半句话，后面还有「结果」，用逗号连起来。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "话说完，句号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "。",
                        ok = emptyList(),
                        kind = SdSlotKind.END,
                        why = "提示语在句尾，全句结束用句号。",
                    ),
                ),
                tip = "「只要……我会……」是连在一起的一句话，中间的停顿用逗号。",
            ),
            SdPunctItem(
                parts = listOf("我觉得很难", "小狗对小公鸡说道"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "提示语在后面，前面只写引号（不用冒号）。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "话说完，句号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "。",
                        ok = emptyList(),
                        kind = SdSlotKind.END,
                        why = "提示语「小狗对小公鸡说道」在后面，全句结束用句号。",
                    ),
                ),
                tip = "这题最容易忘的是：提示语在后面时，它后面**不再**写冒号。",
            ),
            SdPunctItem(
                parts = listOf("我来检查一下你们的背诵情况", "老师站在讲台上说"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "话在前面，开头写前引号。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "老师的话说完了，句号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "。",
                        ok = emptyList(),
                        kind = SdSlotKind.END,
                        why = "提示语收尾，全句用句号。",
                    ),
                ),
                tip = "提示语长得像一句叙述（「老师站在讲台上说」），但它后面照样用句号收尾。",
            ),
        ),
    ),
    SdPunctLevel(
        key = "p3",
        name = "第三关 · 提示语在中",
        rule = "提示语在中间，逗号引号串一串",
        items = listOf(
            SdPunctItem(
                parts = listOf("别灰心", "老师说", "下次你一定能做得更好"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "前半句也是「话」，开头要写前引号。",
                    ),
                    SdPunctSlot(
                        a = "，”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "前半句的话到这儿断了一下，先逗号再后引号——把引号合上。",
                    ),
                    SdPunctSlot(
                        a = "，“",
                        ok = emptyList(),
                        kind = SdSlotKind.MID,
                        why = "提示语「老师说」说完了，后面的话要说下去，所以先逗号、再重新打开前引号。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "后半句说完，句号加后引号。",
                    ),
                ),
                tip = "这句话被切成两半，所以引号要「关一次、再开一次」。数一数，一共要几个引号？",
            ),
            SdPunctItem(
                parts = listOf("你先去吧", "他说", "我现在没有时间"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "话的开头，写前引号。",
                    ),
                    SdPunctSlot(
                        a = "，”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "前半句断在这里，逗号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "，“",
                        ok = emptyList(),
                        kind = SdSlotKind.MID,
                        why = "提示语「他说」后面要继续说，逗号加前引号。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "话说完，句号加后引号。",
                    ),
                ),
                tip = "提示语在中间时，它**前面**和**后面**用的都是逗号——「逗号引号串一串」。",
            ),
            SdPunctItem(
                parts = listOf("你给我站住", "爸爸大喊", "你个小兔崽子"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "话的开头，写前引号。",
                    ),
                    SdPunctSlot(
                        a = "！”",
                        ok = listOf("。”"),
                        kind = SdSlotKind.CLOSE,
                        why = "「爸爸大喊」——喊出来的话语气很冲，前半句末尾用叹号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "，“",
                        ok = emptyList(),
                        kind = SdSlotKind.MID,
                        why = "提示语说完，后面接着喊，逗号加前引号。",
                    ),
                    SdPunctSlot(
                        a = "！”",
                        ok = listOf("。”"),
                        kind = SdSlotKind.CLOSE,
                        why = "后半句也是喊出来的，叹号加后引号。",
                    ),
                ),
                tip = "前后两半都是「喊」出来的——叹号要用几次？引号要关开几次？",
            ),
            SdPunctItem(
                parts = listOf("原来是这样", "狐狸说道", "你这是给我设了一个圈套啊"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "话的开头，写前引号。",
                    ),
                    SdPunctSlot(
                        a = "！”",
                        ok = listOf("。”"),
                        kind = SdSlotKind.CLOSE,
                        why = "狐狸突然明白了，「原来是这样」是恍然大悟，叹号或句号都可以，但要先写标点再写后引号。",
                    ),
                    SdPunctSlot(
                        a = "，“",
                        ok = emptyList(),
                        kind = SdSlotKind.MID,
                        why = "提示语「狐狸说道」在中间，后面接着说，逗号加前引号。",
                    ),
                    SdPunctSlot(
                        a = "！”",
                        ok = listOf("。”"),
                        kind = SdSlotKind.CLOSE,
                        why = "「啊」在句尾，语气强烈，叹号加后引号。",
                    ),
                ),
                tip = "「啊」字结尾，语气强不强？还有别忘了先把标点写出来，再写后引号。",
            ),
            SdPunctItem(
                parts = listOf("你怎么啦", "妈妈问", "为什么这么伤心"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "话的开头，写前引号。",
                    ),
                    SdPunctSlot(
                        a = "？”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "前半句是在问，问号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "，“",
                        ok = emptyList(),
                        kind = SdSlotKind.MID,
                        why = "提示语「妈妈问」后面还有话，逗号加前引号。",
                    ),
                    SdPunctSlot(
                        a = "？”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "后半句也是问话，问号加后引号。",
                    ),
                ),
                tip = "这一句问了两次，所以问号也要用两次；中间那句话是提示语，别把提示语也放进引号里。",
            ),
        ),
    ),
    SdPunctLevel(
        key = "p4",
        name = "第四关 · 混合战",
        rule = "先找提示语，再看它在哪儿 —— 前：冒号引号；后：只写引号；中：逗号引号串一串",
        items = listOf(
            SdPunctItem(
                parts = listOf("小公鸡说", "不要紧", "第一次能这样就很不错了"),
                slots = listOf(
                    null,
                    SdPunctSlot(
                        a = "：“",
                        ok = emptyList(),
                        kind = SdSlotKind.TAG,
                        why = "提示语「小公鸡说」在前面 → 冒号加前引号。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = emptyList(),
                        kind = SdSlotKind.IN,
                        why = "「不要紧」后面还要安慰他，用逗号。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "话说完，句号加后引号。",
                    ),
                ),
                tip = "先给这句话「定性」：提示语在前、在后，还是在中间？",
            ),
            SdPunctItem(
                parts = listOf("不要紧", "第一次能这样就很不错了", "小公鸡说"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "提示语在后面 → 话的开头直接写前引号，不用冒号。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = emptyList(),
                        kind = SdSlotKind.IN,
                        why = "「不要紧」和后面是连着说的，中间用逗号。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "话说完，句号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "。",
                        ok = emptyList(),
                        kind = SdSlotKind.END,
                        why = "提示语收尾，全句句号。",
                    ),
                ),
                tip = "和上一句是同一句话、同样的内容，只把提示语挪到了后面。标点跟着变了吗？",
            ),
            SdPunctItem(
                parts = listOf("不要紧", "小公鸡说", "第一次能这样就很不错了"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "话的开头，写前引号。",
                    ),
                    SdPunctSlot(
                        a = "，”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "前半句先断一下，逗号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "，“",
                        ok = emptyList(),
                        kind = SdSlotKind.MID,
                        why = "提示语在中间，后面继续说 → 逗号加前引号。",
                    ),
                    SdPunctSlot(
                        a = "。”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "话说完，句号加后引号。",
                    ),
                ),
                tip = "三句一模一样的字，提示语换了三个位置——这一句的提示语在哪儿？",
            ),
            SdPunctItem(
                parts = listOf("题目都做完啦", "你做对了多少呢", "老师问"),
                slots = listOf(
                    SdPunctSlot(
                        a = "“",
                        ok = emptyList(),
                        kind = SdSlotKind.OPEN,
                        why = "提示语在后面，话的开头写前引号。",
                    ),
                    SdPunctSlot(
                        a = "，",
                        ok = emptyList(),
                        kind = SdSlotKind.IN,
                        why = "「题目都做完啦」是话里的头一句，后面还有问话，用逗号。",
                    ),
                    SdPunctSlot(
                        a = "？”",
                        ok = emptyList(),
                        kind = SdSlotKind.CLOSE,
                        why = "「呢」是问话，问号加后引号。",
                    ),
                    SdPunctSlot(
                        a = "。",
                        ok = emptyList(),
                        kind = SdSlotKind.END,
                        why = "提示语在最后，全句用句号。",
                    ),
                ),
                tip = "话里有两个小句：一句是感叹，一句是提问。它们各自该用哪个标点？",
            ),
        ),
    ),
)

/** 下半册：修改病句（7 处 `intro` / `why` 里带 markdown 粗体 `**`，渲染前用 sdStripBold 去掉） */
internal val SD_FIX_LEVELS: List<SdFixLevel> = listOf(
    SdFixLevel(
        key = "f1",
        name = "改正刀 · 病变坏死",
        intro = "这一组句子「器官坏了」——用错了词、搭配不上。请用**改正手术刀**，把坏掉的词换下来。",
        items = listOf(
            SdFixCase(
                text = "小明苦苦思念了一个小时，终于答出了这道题目。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「思念」用错了，应该换成「思索」",
                            "少了一个字，要补上",
                            "「一个小时」多余，要删掉",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「思念」是想念远方的亲人、朋友、家乡，不能用来「想题目」。这里要表示反复地想，应该用「思索」（也可以说「思考」「琢磨」）。",
                        mark = SdSpotMark(cut = "思念", put = "思索"),
                    ),
                ),
                fixed = "小明苦苦思索了一个小时，终于答出了这道题目。",
            ),
            SdFixCase(
                text = "在秋姑娘的呼唤中，小草苏醒了，从土里探出了头。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「秋姑娘」和后面的景象矛盾，应改成「春姑娘」",
                            "「小草」前面少了「一株」",
                            "「探出了头」重复，要删掉",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「苏醒」「从土里探出头」是春天小草的样子；秋天的小草已经枯黄了。前面改成「春姑娘」，整句才前后一致。",
                        mark = SdSpotMark(cut = "秋", put = "春"),
                    ),
                ),
                fixed = "在春姑娘的呼唤中，小草苏醒了，从土里探出了头。",
            ),
            SdFixCase(
                text = "我多么愿望能够养一只自己喜欢的小动物啊！",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「愿望」是名词，不能当动词用，应改成「希望」",
                            "「多么」多余，要删掉",
                            "「一只」用错了，要换",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「愿望」是名词（「我有一个愿望」）。这里要表示「很想」，是个动词 → 换成「希望」。",
                        mark = SdSpotMark(cut = "愿望", put = "希望"),
                    ),
                ),
                fixed = "我多么希望能够养一只自己喜欢的小动物啊！",
            ),
            SdFixCase(
                text = "同学们非常爱护时间，都在争分夺秒地学习。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「爱护」和「时间」搭配不上，应改成「珍惜」",
                            "「非常」多余，要删掉",
                            "「争分夺秒」用错了",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「爱护」对着的是具体的人和东西（爱护公物、爱护眼睛）；对「时间」要说「珍惜」。",
                        mark = SdSpotMark(cut = "爱护", put = "珍惜"),
                    ),
                ),
                fixed = "同学们非常珍惜时间，都在争分夺秒地学习。",
            ),
            SdFixCase(
                text = "经过一个学期的努力，他改进了自己的缺点。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「改进」和「缺点」搭配不上，应改成「改正」",
                            "「一个学期」多余，要删掉",
                            "少了一个「很」，要补上",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「改进」是把事情、方法做得更好（改进技术、改进方法）；「缺点」要用「改正」。",
                        mark = SdSpotMark(cut = "改进", put = "改正"),
                    ),
                ),
                fixed = "经过一个学期的努力，他改正了自己的缺点。",
            ),
        ),
    ),
    SdFixLevel(
        key = "f2",
        name = "增补刀 · 部位残缺",
        intro = "这一组句子「缺了零件」——少主语、少谓语。请用**增补手术刀**，把缺的部件补上去。",
        items = listOf(
            SdFixCase(
                text = "在这次单元测试中，获得了满分。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "不知道是谁获得了满分，缺主语，要补「他」",
                            "「满分」后面少了「！」",
                            "「这次」多余，要删掉",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「在……中」只是交代时间和范围，「获得了满分」前面没有主语——谁获得的？补上「他」（也可以是「我」「小明」）。",
                        mark = SdSpotMark(put = "他", at = "获得了满分"),
                    ),
                ),
                fixed = "在这次单元测试中，他获得了满分。",
            ),
            SdFixCase(
                text = "今年的阅兵仪式，留下了深刻的印象。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "没说清给谁留下了印象，要补「给我」",
                            "「今年」多余，要删掉",
                            "「阅兵仪式」用词不当",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「留下了深刻的印象」要说明「给谁留下」。补上「给我」，句子才完整。",
                        mark = SdSpotMark(put = "给我", at = "留下了深刻的印象"),
                    ),
                ),
                fixed = "今年的阅兵仪式，给我留下了深刻的印象。",
            ),
            SdFixCase(
                text = "在老师的指导下，端正了学习态度。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "谁端正了学习态度？缺主语，要补「他」",
                            "「学习态度」多余，要删掉",
                            "「在……下」这个说法用错了",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "和上面是同一种病：「端正了学习态度」前面藏掉了主语。补上「他」（或「我」「同学们」）。",
                        mark = SdSpotMark(put = "他", at = "端正了学习态度"),
                    ),
                ),
                fixed = "在老师的指导下，他端正了学习态度。",
            ),
            SdFixCase(
                text = "在文化公园，我们看到了美丽的花灯，美妙的音乐。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "「看到」不能搭配「音乐」，要补「听到了」",
                            "「美丽」多余，要删掉",
                            "「花灯」用词不当",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「看到」只能管住「花灯」，管不了「音乐」——音乐是耳朵听出来的。在「美妙的音乐」前补上「听到了」。",
                        mark = SdSpotMark(put = "听到了", at = "美妙的音乐"),
                    ),
                ),
                fixed = "在文化公园，我们看到了美丽的花灯，听到了美妙的音乐。",
            ),
            SdFixCase(
                text = "妈妈穿着一件白色的上衣，一顶红色的帽子。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "「穿着一顶帽子」不通，要补「戴着」",
                            "「白色」多余，要删掉",
                            "「上衣」用词不当",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「穿」只能管「上衣」，帽子是「戴」的。补上「戴着」，帽子才有着落。",
                        mark = SdSpotMark(put = "戴着", at = "一顶红色的帽子"),
                    ),
                ),
                fixed = "妈妈穿着一件白色的上衣，戴着一顶红色的帽子。",
            ),
        ),
    ),
    SdFixLevel(
        key = "f3",
        name = "删除刀 · 增生肿瘤",
        intro = "这一组句子「长了多余的东西」——重复、啰嗦、自相矛盾。请用**删除手术刀**，把多余的切掉。",
        items = listOf(
            SdFixCase(
                text = "《花的学校》的作者是印度作家泰戈尔写的。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「是……写的」两套说法混在一起，要删「写的」",
                            "「印度」多余，要删掉",
                            "少了一个「的」，要补上",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「……的作者是泰戈尔」和「……是泰戈尔写的」两种说法叠在一起了。留下一种就行：删掉「写的」（也可以改删「的作者」）。",
                        mark = SdSpotMark(cut = "写的"),
                    ),
                ),
                fixed = "《花的学校》的作者是印度作家泰戈尔。",
            ),
            SdFixCase(
                text = "暑假期间，他偶尔每天去游泳馆游泳。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「偶尔」和「每天」自相矛盾，要删「偶尔」",
                            "「游泳馆」重复，要删掉",
                            "少了一个「都」，要补上",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「偶尔」是有时候，「每天」是天天——两个意思撞在一起，句子自己跟自己打架。删掉「偶尔」，留下「每天」。",
                        mark = SdSpotMark(cut = "偶尔"),
                    ),
                ),
                fixed = "暑假期间，他每天去游泳馆游泳。",
            ),
            SdFixCase(
                text = "小区门口新开了一家卖汽水、果汁和饮料的小店。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「饮料」已经包含汽水和果汁，重复了，要删「和饮料」",
                            "「新」多余，要删掉",
                            "少了一个「的」，要补上",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「饮料」是大类，里面本来就有汽水、果汁。大类和例子不能并排站在一起，删掉「和饮料」。",
                        mark = SdSpotMark(cut = "和饮料"),
                    ),
                ),
                fixed = "小区门口新开了一家卖汽水、果汁的小店。",
            ),
            SdFixCase(
                text = "清明节、端午节、元旦节和中秋节都是我国的传统节日。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「元旦节」不是传统节日，要删掉",
                            "「我国」多余，要删掉",
                            "少了一个「都」，要补上",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "元旦是公历新年，不是我国的老传统节日，混在队伍里就不对了。删掉「元旦节」。",
                        mark = SdSpotMark(cut = "、元旦节"),
                    ),
                ),
                fixed = "清明节、端午节和中秋节都是我国的传统节日。",
            ),
            SdFixCase(
                text = "作文写好以后，我们要学会把不正确的错别字改正过来。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「不正确的」和「错别字」意思重复，要删「不正确的」",
                            "「我们」多余，要删掉",
                            "「学会」用词不当",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「错别字」本身就是写错的字，前面再加「不正确的」就重复了。删掉「不正确的」。",
                        mark = SdSpotMark(cut = "不正确的"),
                    ),
                ),
                fixed = "作文写好以后，我们要学会把错别字改正过来。",
            ),
        ),
    ),
    SdFixLevel(
        key = "f4",
        name = "病症不明 · 自己诊断",
        intro = "这一组不告诉你是什么病。先自己看、自己诊断，再决定用哪把刀——改正、增补、删除都可能用上。",
        items = listOf(
            SdFixCase(
                text = "虽然夜已经深了，但老师还在认真地为我们批改。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "「批改」后面少了宾语，要补「作业」",
                            "「虽然……但……」关联词用错了",
                            "「认真地」多余，要删掉",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「批改」是及物动词，后面必须有对象——批改什么？补上「作业」（或「作文」「试卷」）。",
                        mark = SdSpotMark(put = "作业", at = "。"),
                    ),
                ),
                fixed = "虽然夜已经深了，但老师还在认真地为我们批改作业。",
            ),
            SdFixCase(
                text = "下课铃一响，同学们快速飞快地走出教室。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「快速」和「飞快」意思重复，要删一个",
                            "少了一个「地」，要补上",
                            "「下课铃」用词不当",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「快速」和「飞快」说的是同一件事，两个修饰语挤在一起。删掉一个，留「飞快地」。",
                        mark = SdSpotMark(cut = "快速"),
                    ),
                ),
                fixed = "下课铃一响，同学们飞快地走出教室。",
            ),
            SdFixCase(
                text = "秋天来了，田野里一片翠绿，像一幅金灿灿的油画。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「翠绿」和「金灿灿」矛盾，应改成「金黄」",
                            "「油画」用词不当",
                            "少了一个「的」，要补上",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "秋天的田野是金黄的；既然说「金灿灿的油画」，前面就不能是「翠绿」。把「翠绿」改成「金黄」，前后就一致了。",
                        mark = SdSpotMark(cut = "翠绿", put = "金黄"),
                    ),
                ),
                fixed = "秋天来了，田野里一片金黄，像一幅金灿灿的油画。",
            ),
            SdFixCase(
                text = "《望洞庭》这首诗的作者是刘禹锡写的。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「是……写的」重复啰嗦，要删「写的」",
                            "「这首诗」多余，要删掉",
                            "「刘禹锡」写错了，要改",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "和《花的学校》那句是同一类病：「……的作者是刘禹锡」和「……是刘禹锡写的」叠在一起了。删掉「写的」。",
                        mark = SdSpotMark(cut = "写的"),
                    ),
                ),
                fixed = "《望洞庭》这首诗的作者是刘禹锡。",
            ),
            SdFixCase(
                text = "一走进公园，我就看到了美丽的鲜花和淡淡的花香。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "「看到」不能搭配「花香」，要补「闻到了」",
                            "「美丽」多余，要删掉",
                            "「一走进」用错了",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "花香是闻出来的，不是看出来的。在「淡淡的花香」前面补上「闻到了」。",
                        mark = SdSpotMark(cut = "和", put = "，闻到了"),
                    ),
                ),
                fixed = "一走进公园，我就看到了美丽的鲜花，闻到了淡淡的花香。",
            ),
            SdFixCase(
                text = "菜园里种着许多蔬菜，有黄瓜、茄子、豆角、草莓等。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「草莓」不是蔬菜，要删掉",
                            "「许多」多余，要删掉",
                            "少了一个「的」，要补上",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "草莓是水果，不是蔬菜，混在蔬菜队伍里就错了。删掉「、草莓」。",
                        mark = SdSpotMark(cut = "、草莓"),
                    ),
                ),
                fixed = "菜园里种着许多蔬菜，有黄瓜、茄子、豆角等。",
            ),
            SdFixCase(
                text = "演员们精彩的表演赢得了观众们热闹的掌声。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「热闹」和「掌声」搭配不上，应改成「热烈」",
                            "「精彩」多余，要删掉",
                            "「观众们」用词不当",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「热闹」说的是场面吵吵嚷嚷；掌声要用「热烈」。把「热闹」改成「热烈」。",
                        mark = SdSpotMark(cut = "热闹", put = "热烈"),
                    ),
                ),
                fixed = "演员们精彩的表演赢得了观众们热烈的掌声。",
            ),
            SdFixCase(
                text = "秋天的岳麓山，是一个美丽的季节。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「岳麓山」不是「季节」，前面和后面配不上",
                            "「岳麓山」写错了，要改字",
                            "「美丽」多余，要删掉",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「岳麓山」是一座山，不能说它是「季节」。改成「岳麓山的秋天，是一个美丽的季节」，或者把后面改成「是一个美丽的地方」。",
                        mark = SdSpotMark(cut = "秋天的岳麓山", put = "岳麓山的秋天"),
                    ),
                ),
                fixed = "岳麓山的秋天，是一个美丽的季节。",
            ),
            SdFixCase(
                text = "经过治疗，小明的病已经恢复了健康。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「病」不能「恢复健康」，应改成「身体」",
                            "「经过治疗」多余，要删掉",
                            "少了一个「很」，要补上",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「病」是那件事，「恢复健康」说的是人。改成「小明的身体已经恢复了健康」（也可以说「小明的病已经好了」）。",
                        mark = SdSpotMark(cut = "病", put = "身体"),
                    ),
                ),
                fixed = "经过治疗，小明的身体已经恢复了健康。",
            ),
            SdFixCase(
                text = "昨天刮了一天的大风和大雨。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "「刮」不能搭配「大雨」，要补「下了一天」",
                            "「昨天」多余，要删掉",
                            "「一天」用错了",
                            "句子没毛病",
                        ),
                        answer = 0,
                        why = "「刮」只能搭配「大风」，「大雨」是「下」的。把「和」换成逗号，再补上「下了一天」。",
                        mark = SdSpotMark(cut = "和", put = "，下了一天的"),
                    ),
                ),
                fixed = "昨天刮了一天的大风，下了一天的大雨。",
            ),
        ),
    ),
    SdFixLevel(
        key = "f5",
        name = "重症病句 · 一句话多处",
        intro = "这些句子全身都是病，一句话里有好几处。一处一处来，每处都要先说病因、再选手术刀。",
        items = listOf(
            SdFixCase(
                text = "在童话世界里，动物、小草、植物和人一样拥有喜怒哀乐。它们大多生活得很快乐，因为遇到困难，也会互相帮助。通过阅读那些充满想象力又有趣的故事，我的生活变得不再多姿多彩。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「小草」属于植物，和「植物」并列重复了，要删「小草」",
                            "「喜怒哀乐」用词不当，要换一个",
                            "少了一个「都」，要补上",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "「小草」就是植物，和「植物」摆在一起是「大类和例子并排」，重复了。删掉「小草」，改成「动物、植物和人」。",
                        mark = SdSpotMark(cut = "小草、"),
                    ),
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「因为」用错了，前后不是因果关系，要删掉",
                            "「生活得很快乐」少了一个「都」",
                            "「互相帮助」多余，要删掉",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "「遇到困难，也会互相帮助」和前面不是因果关系，用「因为」把两句硬拴在一起就错了。删掉「因为」。",
                        mark = SdSpotMark(cut = "因为"),
                    ),
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「不再多姿多彩」意思反了，要删掉「不再」",
                            "「通过」多余，要删掉",
                            "「那些」用词不当",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "前面说读故事是件好事，后面却说生活「变得不再多姿多彩」，意思正好拧反了。把「不再」删掉：「我的生活变得多姿多彩」。",
                        mark = SdSpotMark(cut = "不再"),
                    ),
                ),
                fixed = "在童话世界里，动物、植物和人一样拥有喜怒哀乐。它们大多生活得很快乐，遇到困难，也会互相帮助。通过阅读那些充满想象力又有趣的故事，我的生活变得多姿多彩。",
            ),
            SdFixCase(
                text = "今天早晨，我在上学路上不小心不慎重弄丢了从学校图书馆的《格林童话》。如有拾到者，请与我联系，非常感谢！",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「不小心」和「不慎重」意思重复，要删一个",
                            "「今天早晨」多余，要删掉",
                            "「上学路上」用错了",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "「不小心」和「不慎重」说的是一回事，两个叠在一起啰嗦。删掉「不慎重」，留下「不小心」。",
                        mark = SdSpotMark(cut = "不慎重"),
                    ),
                    SdFixSpot(
                        tool = SdTool.ADD,
                        options = listOf(
                            "「从学校图书馆的《格林童话》」说不通，要补「借的」",
                            "「弄丢了」后面少了一个「了」",
                            "「学校图书馆」用词不当",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "「弄丢了从学校图书馆的《格林童话》」——丢的是书，不是图书馆，中间缺了「借的」这个环节。补上「借的」：弄丢了从学校图书馆借的《格林童话》。",
                        mark = SdSpotMark(cut = "的", put = "借的"),
                    ),
                ),
                fixed = "今天早晨，我在上学路上不小心弄丢了从学校图书馆借的《格林童话》。如有拾到者，请与我联系，非常感谢！",
            ),
            SdFixCase(
                text = "昨天晚上，下了一整天的鹅毛大雪。早晨，我起床一看，大地上、房顶上、建筑上和树上都盖上了一层厚厚的白雪。因为路上覆盖着积雪，所以汽车开得很快，都像乌龟一样前行。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「晚上」和「一整天」矛盾，要删「晚上」",
                            "「鹅毛大雪」用词不当",
                            "少了一个「的」，要补上",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "「晚上」只是夜里，和「一整天」对不上——不可能又只是晚上又下了一整天。删掉「晚上」：「昨天，下了一整天的鹅毛大雪」。",
                        mark = SdSpotMark(cut = "晚上"),
                    ),
                    SdFixSpot(
                        tool = SdTool.DELETE,
                        options = listOf(
                            "「房顶」属于「建筑」，重复了，要删「建筑上和」",
                            "「厚厚的」多余，要删掉",
                            "少了一个「都」，要补上",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "房子的顶就是建筑的一部分，「房顶上、建筑上」并列就重复了。删掉「建筑上和」，改成「大地上、房顶上和树上」。",
                        mark = SdSpotMark(cut = "、建筑上"),
                    ),
                    SdFixSpot(
                        tool = SdTool.CORRECT,
                        options = listOf(
                            "「开得很快」和「像乌龟一样」矛盾，要改成「很慢」",
                            "「因为……所以……」关联词用错了",
                            "「厚厚的」多余，要删掉",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "雪太厚，车该开得慢；「像乌龟一样前行」也是慢。前面却说「开得很快」，自己打自己。把「很快」改成「很慢」。",
                        mark = SdSpotMark(cut = "很快", put = "很慢"),
                    ),
                ),
                fixed = "昨天，下了一整天的鹅毛大雪。早晨，我起床一看，大地上、房顶上和树上都盖上了一层厚厚的白雪。因为路上覆盖着积雪，所以汽车开得很慢，都像乌龟一样前行。",
            ),
        ),
    ),
    SdFixLevel(
        key = "f6",
        name = "对调与移动 · 位置错乱",
        intro = "这一关的字没错、词也不缺，只是**站错了位置**。紧挨着的两处互换用**对调刀**；隔开了一段、要整个挪到别处，用**移动刀**。",
        items = listOf(
            SdFixCase(
                text = "我养了螃蟹一只，它眼睛、嘴巴都不怎么显眼。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.SWAP,
                        options = listOf(
                            "「螃蟹」和「一只」紧挨着，位置颠倒了，要让它们互换",
                            "「一只」是多余的，要删掉",
                            "「养了」用词不当，要换一个词",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "「螃蟹一只」把数量词「一只」放到中心词「螃蟹」后面去了，读着别扭。两个词**紧挨着**，用对调号互换 → 「一只螃蟹」。（课本原句）",
                        mark = SdSpotMark(cut = "螃蟹", with = "一只"),
                    ),
                ),
                fixed = "我养了一只螃蟹，它眼睛、嘴巴都不怎么显眼。",
            ),
            SdFixCase(
                text = "有一次，我轻轻点了它一下用一根小棍。",
                spots = listOf(
                    SdFixSpot(
                        tool = SdTool.MOVE,
                        options = listOf(
                            "「用一根小棍」该整个挪到「轻轻点了它一下」前面去",
                            "「轻轻」多余，要删掉",
                            "「点了它一下」该挪到句子的最后",
                            "这一处没毛病",
                        ),
                        answer = 0,
                        why = "「用一根小棍」是在说明「**怎么**点的」，它跟要修饰的动作**隔开**了一段——这就不能用对调号了，得用移动号把它整个挪过去 → 「我用一根小棍轻轻点了它一下」。（课本原句）",
                        mark = SdSpotMark(cut = "用一根小棍", with = "轻轻点了它一下"),
                    ),
                ),
                fixed = "有一次，我用一根小棍轻轻点了它一下。",
            ),
        ),
    ),
)
