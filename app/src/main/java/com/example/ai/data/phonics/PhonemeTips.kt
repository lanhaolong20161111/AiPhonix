package com.example.ai.data.phonics

/**
 * 音素 → 中文「发音要领」提示表 —— 给评测低分的音素配一句可照着做的小技巧。
 *
 * 与 web `lib/phonicsTips.ts` 逐位移植（纯函数、无 Context）。web 的 `tip` 文案与
 * `tipSpeechText` 清洗逻辑完全一致；唯一的差异是 web 的 `localTipText(phone, style?)`
 * 的 `style` 参数在 Android 不需要（口型描述对英美通用），这里直接省略。
 */

enum class TipCategory { CONSONANT, VOWEL, DIPHTHONG, R_CONTROL, OTHER }

data class PhoneTip(
    /** 中文要领，一句话，可直接照着做 */
    val tip: String,
    /** 分类，用于 UI 上配图标/配色（可选展示） */
    val cat: TipCategory,
)

/** 音素码（大写，无重音数字）→ 要领 */
private val TIPS: Map<String, PhoneTip> = mapOf(
    // ══════════ 辅音：中文里没有的 / 易混的，先讲 ══════════
    "TH" to PhoneTip("舌尖轻轻伸到上下牙齿中间，送气，别读成 s 或 z", TipCategory.CONSONANT),
    "DH" to PhoneTip("舌尖轻轻伸到上下牙齿中间，声带要振动（像「这」的开头）", TipCategory.CONSONANT),
    "R" to PhoneTip("舌尖卷起但不碰上颚，嘴唇稍微收圆，别读成汉语的 r", TipCategory.CONSONANT),
    "L" to PhoneTip("舌尖顶住上牙床，让气从舌头两边出来", TipCategory.CONSONANT),
    "V" to PhoneTip("上牙轻咬下唇，声带振动（别读成 w）", TipCategory.CONSONANT),
    "F" to PhoneTip("上牙轻咬下唇，只送气不发声", TipCategory.CONSONANT),
    "W" to PhoneTip("嘴唇收圆向前突出，像吹气一样滑过去", TipCategory.CONSONANT),
    "SH" to PhoneTip("舌尖抬向上颚但不碰上，气从缝里擦出来，像「嘘」", TipCategory.CONSONANT),
    "ZH" to PhoneTip("像 sh 的口型，但要出声振动（像「日」的开头）", TipCategory.CONSONANT),
    "CH" to PhoneTip("像「吃」的开头，先堵住再送气冲开", TipCategory.CONSONANT),
    "JH" to PhoneTip("像「知」的开头，先堵住再摩擦出声", TipCategory.CONSONANT),
    "NG" to PhoneTip("舌根抬起抵住软腭，气从鼻子出来（像「嗯」的尾音）", TipCategory.CONSONANT),
    "N" to PhoneTip("舌尖顶住上牙床，气从鼻子出来", TipCategory.CONSONANT),
    "M" to PhoneTip("双唇闭合，气从鼻子出来", TipCategory.CONSONANT),
    "HH" to PhoneTip("像轻轻哈气，只出气、不发声", TipCategory.CONSONANT),
    "Y" to PhoneTip("像「耶」的开头，舌面抬向硬腭快速滑开", TipCategory.CONSONANT),
    "K" to PhoneTip("舌根抵住软腭，突然放开，送一口大气", TipCategory.CONSONANT),
    "G" to PhoneTip("舌根抵住软腭，突然放开，声带要振动", TipCategory.CONSONANT),
    "T" to PhoneTip("舌尖顶住上牙床，突然放开，送一口大气", TipCategory.CONSONANT),
    "D" to PhoneTip("舌尖顶住上牙床，突然放开，声带要振动", TipCategory.CONSONANT),
    "P" to PhoneTip("双唇闭合，突然放开，送一口大气", TipCategory.CONSONANT),
    "B" to PhoneTip("双唇闭合，突然放开，声带要振动", TipCategory.CONSONANT),
    "S" to PhoneTip("舌尖靠近上牙床留条缝，像蛇叫「嘶」，不振动声带", TipCategory.CONSONANT),
    "Z" to PhoneTip("像 s 的口型，但声带要振动（像蜜蜂嗡嗡）", TipCategory.CONSONANT),

    // ══════════ 元音 ══════════
    "IY" to PhoneTip("嘴角向两边拉开像微笑，声音拉长一点", TipCategory.VOWEL),
    "IH" to PhoneTip("比 iː 松一些、短一些，别把嘴角拉太开", TipCategory.VOWEL),
    "EH" to PhoneTip("嘴张开约一个指头宽，舌前部抬起来", TipCategory.VOWEL),
    "AE" to PhoneTip("下巴放低、嘴张大，像要咬一口苹果", TipCategory.VOWEL),
    "AH" to PhoneTip("嘴自然放松微微张开，短促有力", TipCategory.VOWEL),
    "AA" to PhoneTip("嘴张大，像看医生发「啊」，声音拉长", TipCategory.VOWEL),
    "AO" to PhoneTip("嘴唇收圆向前突出，像「哦」但更长", TipCategory.VOWEL),
    "UH" to PhoneTip("嘴微微收圆，短促、放松", TipCategory.VOWEL),
    "UW" to PhoneTip("嘴唇收成小圆向前突出，像吹口哨，声音拉长", TipCategory.VOWEL),

    // ══════════ 双元音：要「滑」过去 ══════════
    "AY" to PhoneTip("从「啊」滑向「衣」，前长后短，是一个音不是两个", TipCategory.DIPHTHONG),
    "EY" to PhoneTip("从「诶」滑向「衣」，中间不要断开", TipCategory.DIPHTHONG),
    "OW" to PhoneTip("从「哦」滑向「乌」，嘴唇由圆变拢", TipCategory.DIPHTHONG),
    "OY" to PhoneTip("从「哦」滑向「衣」，一口气连着滑", TipCategory.DIPHTHONG),
    "AW" to PhoneTip("从「啊」滑向「乌」，像被踩了一脚「哎哟」", TipCategory.DIPHTHONG),

    // ══════════ r 控制元音 / 卷舌 ══════════
    "ER" to PhoneTip("舌身中部抬起、舌尖轻卷，不碰到任何地方", TipCategory.R_CONTROL),
    "ER0" to PhoneTip("轻轻卷舌，声音很弱很短（多出现在词尾）", TipCategory.R_CONTROL),
    "IHR" to PhoneTip("从 ɪ 滑向卷舌，一口气连着", TipCategory.R_CONTROL),
    "EHR" to PhoneTip("从 e 滑向卷舌，像「哎」加卷舌", TipCategory.R_CONTROL),
    "UHR" to PhoneTip("从 ʊ 滑向卷舌，嘴唇别太圆", TipCategory.R_CONTROL),

    // ══════════ 弱读 / 特殊 ══════════
    "AH0" to PhoneTip("非重读音节的「ə」，嘴巴放松、轻轻带过就好", TipCategory.OTHER),
)

/** 查询用的键归一化：大写 + 去掉尾随重音数字（ah0 → AH） */
private fun normKey(phone: String): String = phone.trim().uppercase().replace(Regex("""[012]$"""), "")

/**
 * 查某个音素的发音要领。查不到返回 `null`（调用方据此不渲染提示）。
 * 带 r 双元音的逗号写法（ih,r）→ IHR。
 */
fun phoneTip(phone: String): PhoneTip? {
    val key = normKey(phone)
    if (key.isEmpty()) return null
    val merged = key.replace(Regex(""",R$"""), "R")
    return TIPS[merged] ?: TIPS[key]
}

/** 该音素是否有本地要领（UI 用来决定要不要占位等 LLM） */
fun hasLocalTip(phone: String): Boolean = phoneTip(phone) != null

/** 本地版提示文本（只给要领，不含 IPA 前缀） */
fun localTipText(phone: String): String? = phoneTip(phone)?.tip

/** 本地表覆盖的音素个数（单测/自检用） */
const val LOCAL_TIP_COUNT: Int = 44

// ══════════════════════════════════════════════════════════════════
// 朗读文本（TTS）—— 把孤立的音素符号换成「这个音」，避免百度 TTS 读成字母名
// ══════════════════════════════════════════════════════════════════

/** 全部 Arpabet 音素码（大写）。用于识别提示文案里「孤立的音素符号」。 */
private val PHONE_CODES: Set<String> = setOf(
    "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW",
    "B", "CH", "D", "DH", "F", "G", "HH", "JH", "K", "L", "M", "N", "NG", "P", "R", "S", "SH",
    "T", "TH", "V", "W", "Y", "Z", "ZH",
)

/** 音素符号在文案里的替换词。孩子听「这个音」比听字母名有效。 */
private const val PHONE_SPOKEN = "这个音"

/**
 * 把提示文案处理成**适合朗读**的文本。
 *
 * 百度 TTS 遇到孤立字母会读字母名（"f" →「艾弗」、"r" →「阿尔」），而 LLM 生成的文案长
 * 这样：`读friend的f时，上牙轻轻咬下嘴唇再送气哦`。直接读会让孩子听到「读 friend 的 艾弗 时」。
 *
 * 处理规则（刻意保守，只改「确定是音素符号指代」的位置）：
 * ① 带定界符的 `/f/`、`[th]`、`（f）` → 这个音（定界符已表明是音素符号，最安全）；
 * ② LLM 固定句式 `的f时` / `的 r 时` / `的th要` → `的这个音时`（只在「的」后紧跟音素码、且
 *    音素码后紧跟中文时才动手；本地表 44 条全是纯中文，跑一遍结果不变，幂等）。
 */
fun tipSpeechText(tip: String, phones: List<String> = emptyList()): String {
    if (tip.isEmpty()) return ""
    val known = phones.map { it.trim().uppercase().replace(Regex("""[012]$"""), "") }.toSet()
    val isPhoneLike: (String) -> Boolean = { s ->
        val up = s.uppercase()
        known.contains(up) || PHONE_CODES.contains(up)
    }

    var out = tip
    // ① 带定界符的：/f/ 、[th] 、（f） 、(f) → 这个音。
    //   ⚠️ JVM 的 java.util.regex 与 JS 有两处差异：
    //   1) 类内未转义的 `[` 会被当成「嵌套字符类」开启（JS 是字面量），
    //      会一路吞到后面第一个 `]`，把中间的分组全吃掉 ⇒ 必须写成 `\[`。
    //   2) 类内 `]` 作首成员/转义行为不同 ⇒ 收尾定界符用「选择分支」而非字符类。
    out = out.replace(Regex("""[/\[（(]\s*([A-Za-z]{1,3})\s*(?:/|\\|]|）|\))""")) { m ->
        if (isPhoneLike(m.groupValues[1])) PHONE_SPOKEN else m.value
    }
    // ② LLM 固定句式：`的f时` / `的 r 时` / `的th要` → `的这个音时`
    out = out.replace(Regex("""的\s*([A-Za-z]{1,3})\s*(?=[\u4e00-\u9fff])""")) { m ->
        if (isPhoneLike(m.groupValues[1])) "的$PHONE_SPOKEN" else m.value
    }
    return out
}
