package com.example.ai.data.pinyin

/**
 * 拼音表数据 — 声母/韵母/整体认读音节，每个音素配例字（点击可发音）。
 * 由 web/src/data/pinyinTable.ts + pinyinMnemonic.ts 自动生成（勿手改）。
 *
 * 音频路径规则（服务端 /api/v1/pinyin-audio 对应）：
 *  - 声母：  声母/{b}.mp3
 *  - 韵母：  韵母/{a}.mp3        （ü 写作 v）
 *  - 整体认读：整体认读音节/{zhi}.mp3
 */

/** 例字：字 + 拼音(带声调) + 完整音频文件名 */
data class PinyinExample(val char: String, val pinyin: String, val audio: String)

/** 一个拼音项（声母 / 韵母 / 整体认读音节） */
data class PinyinTableItem(
    val id: String,
    val symbol: String,
    val label: String,
    val audio: String,
    val examples: List<PinyinExample>,
    val tip: String = "",
)

/** 拼音类别 */
enum class PinyinCategory(val title: String) {
    SHENGMU("声母"),
    YUNMU("韵母"),
    ZHENGTI("整体认读音节"),
}

/** 拼音表静态数据（单例） */
object PinyinTableData {
    val shengmu: List<PinyinTableItem> = listOf(
        PinyinTableItem("b", "b", "b", "声母/b.mp3", listOf(
            PinyinExample("爸", "bà", "声母/b.mp3"),
            PinyinExample("波", "bō", "声母/b.mp3"),
            PinyinExample("笔", "bǐ", "声母/b.mp3"),
            PinyinExample("白", "bái", "声母/b.mp3")
        ), tip = "双唇紧闭，然后放开"),
        PinyinTableItem("p", "p", "p", "声母/p.mp3", listOf(
            PinyinExample("爬", "pá", "声母/p.mp3"),
            PinyinExample("皮", "pí", "声母/p.mp3"),
            PinyinExample("扑", "pū", "声母/p.mp3"),
            PinyinExample("坡", "pō", "声母/p.mp3")
        )),
        PinyinTableItem("m", "m", "m", "声母/m.mp3", listOf(
            PinyinExample("妈", "mā", "声母/m.mp3"),
            PinyinExample("米", "mǐ", "声母/m.mp3"),
            PinyinExample("木", "mù", "声母/m.mp3"),
            PinyinExample("猫", "māo", "声母/m.mp3")
        )),
        PinyinTableItem("f", "f", "f", "声母/f.mp3", listOf(
            PinyinExample("发", "fā", "声母/f.mp3"),
            PinyinExample("风", "fēng", "声母/f.mp3"),
            PinyinExample("饭", "fàn", "声母/f.mp3"),
            PinyinExample("飞", "fēi", "声母/f.mp3")
        )),
        PinyinTableItem("d", "d", "d", "声母/d.mp3", listOf(
            PinyinExample("大", "dà", "声母/d.mp3"),
            PinyinExample("读", "dú", "声母/d.mp3"),
            PinyinExample("地", "dì", "声母/d.mp3"),
            PinyinExample("灯", "dēng", "声母/d.mp3")
        )),
        PinyinTableItem("t", "t", "t", "声母/t.mp3", listOf(
            PinyinExample("他", "tā", "声母/t.mp3"),
            PinyinExample("天", "tiān", "声母/t.mp3"),
            PinyinExample("土", "tǔ", "声母/t.mp3"),
            PinyinExample("跳", "tiào", "声母/t.mp3")
        )),
        PinyinTableItem("n", "n", "n", "声母/n.mp3", listOf(
            PinyinExample("你", "nǐ", "声母/n.mp3"),
            PinyinExample("牛", "niú", "声母/n.mp3"),
            PinyinExample("鸟", "niǎo", "声母/n.mp3"),
            PinyinExample("脑", "nǎo", "声母/n.mp3")
        )),
        PinyinTableItem("l", "l", "l", "声母/l.mp3", listOf(
            PinyinExample("力", "lì", "声母/l.mp3"),
            PinyinExample("六", "liù", "声母/l.mp3"),
            PinyinExample("来", "lái", "声母/l.mp3"),
            PinyinExample("龙", "lóng", "声母/l.mp3")
        )),
        PinyinTableItem("g", "g", "g", "声母/g.mp3", listOf(
            PinyinExample("哥", "gē", "声母/g.mp3"),
            PinyinExample("瓜", "guā", "声母/g.mp3"),
            PinyinExample("高", "gāo", "声母/g.mp3"),
            PinyinExample("果", "guǒ", "声母/g.mp3")
        )),
        PinyinTableItem("k", "k", "k", "声母/k.mp3", listOf(
            PinyinExample("哭", "kū", "声母/k.mp3"),
            PinyinExample("看", "kàn", "声母/k.mp3"),
            PinyinExample("快", "kuài", "声母/k.mp3"),
            PinyinExample("口", "kǒu", "声母/k.mp3")
        )),
        PinyinTableItem("h", "h", "h", "声母/h.mp3", listOf(
            PinyinExample("花", "huā", "声母/h.mp3"),
            PinyinExample("河", "hé", "声母/h.mp3"),
            PinyinExample("红", "hóng", "声母/h.mp3"),
            PinyinExample("火", "huǒ", "声母/h.mp3")
        )),
        PinyinTableItem("j", "j", "j", "声母/j.mp3", listOf(
            PinyinExample("鸡", "jī", "声母/j.mp3"),
            PinyinExample("家", "jiā", "声母/j.mp3"),
            PinyinExample("九", "jiǔ", "声母/j.mp3"),
            PinyinExample("见", "jiàn", "声母/j.mp3")
        )),
        PinyinTableItem("q", "q", "q", "声母/q.mp3", listOf(
            PinyinExample("七", "qī", "声母/q.mp3"),
            PinyinExample("去", "qù", "声母/q.mp3"),
            PinyinExample("球", "qiú", "声母/q.mp3"),
            PinyinExample("桥", "qiáo", "声母/q.mp3")
        )),
        PinyinTableItem("x", "x", "x", "声母/x.mp3", listOf(
            PinyinExample("西", "xī", "声母/x.mp3"),
            PinyinExample("下", "xià", "声母/x.mp3"),
            PinyinExample("小", "xiǎo", "声母/x.mp3"),
            PinyinExample("星", "xīng", "声母/x.mp3")
        )),
        PinyinTableItem("zh", "zh", "zh", "声母/zh.mp3", listOf(
            PinyinExample("纸", "zhǐ", "声母/zh.mp3"),
            PinyinExample("钟", "zhōng", "声母/zh.mp3"),
            PinyinExample("住", "zhù", "声母/zh.mp3"),
            PinyinExample("桌", "zhuō", "声母/zh.mp3")
        ), tip = "舌尖翘起，抵住上颚"),
        PinyinTableItem("ch", "ch", "ch", "声母/ch.mp3", listOf(
            PinyinExample("吃", "chī", "声母/ch.mp3"),
            PinyinExample("车", "chē", "声母/ch.mp3"),
            PinyinExample("长", "cháng", "声母/ch.mp3"),
            PinyinExample("虫", "chóng", "声母/ch.mp3")
        )),
        PinyinTableItem("sh", "sh", "sh", "声母/sh.mp3", listOf(
            PinyinExample("书", "shū", "声母/sh.mp3"),
            PinyinExample("山", "shān", "声母/sh.mp3"),
            PinyinExample("水", "shuǐ", "声母/sh.mp3"),
            PinyinExample("十", "shí", "声母/sh.mp3")
        )),
        PinyinTableItem("r", "r", "r", "声母/r.mp3", listOf(
            PinyinExample("日", "rì", "声母/r.mp3"),
            PinyinExample("人", "rén", "声母/r.mp3"),
            PinyinExample("热", "rè", "声母/r.mp3"),
            PinyinExample("让", "ràng", "声母/r.mp3")
        )),
        PinyinTableItem("z", "z", "z", "声母/z.mp3", listOf(
            PinyinExample("字", "zì", "声母/z.mp3"),
            PinyinExample("早", "zǎo", "声母/z.mp3"),
            PinyinExample("在", "zài", "声母/z.mp3"),
            PinyinExample("坐", "zuò", "声母/z.mp3")
        )),
        PinyinTableItem("c", "c", "c", "声母/c.mp3", listOf(
            PinyinExample("草", "cǎo", "声母/c.mp3"),
            PinyinExample("菜", "cài", "声母/c.mp3"),
            PinyinExample("从", "cóng", "声母/c.mp3"),
            PinyinExample("猜", "cāi", "声母/c.mp3")
        )),
        PinyinTableItem("s", "s", "s", "声母/s.mp3", listOf(
            PinyinExample("四", "sì", "声母/s.mp3"),
            PinyinExample("三", "sān", "声母/s.mp3"),
            PinyinExample("送", "sòng", "声母/s.mp3"),
            PinyinExample("岁", "suì", "声母/s.mp3")
        )),
        PinyinTableItem("y", "y", "y", "声母/y.mp3", listOf(
            PinyinExample("一", "yī", "声母/y.mp3"),
            PinyinExample("鱼", "yú", "声母/y.mp3"),
            PinyinExample("云", "yún", "声母/y.mp3"),
            PinyinExample("雨", "yǔ", "声母/y.mp3")
        )),
        PinyinTableItem("w", "w", "w", "声母/w.mp3", listOf(
            PinyinExample("五", "wǔ", "声母/w.mp3"),
            PinyinExample("王", "wáng", "声母/w.mp3"),
            PinyinExample("我", "wǒ", "声母/w.mp3"),
            PinyinExample("问", "wèn", "声母/w.mp3")
        ))
    )

    val yunmu: List<PinyinTableItem> = listOf(
        PinyinTableItem("a", "a", "a", "韵母/a.mp3", listOf(
            PinyinExample("阿", "ā", "单韵母声调/a1.mp3"),
            PinyinExample("爸", "bà", "单韵母声调/a4.mp3"),
            PinyinExample("马", "mǎ", "单韵母声调/a3.mp3"),
            PinyinExample("大", "dà", "单韵母声调/a4.mp3")
        )),
        PinyinTableItem("o", "o", "o", "韵母/o.mp3", listOf(
            PinyinExample("哦", "ō", "单韵母声调/o1.mp3"),
            PinyinExample("播", "bō", "单韵母声调/o1.mp3"),
            PinyinExample("波", "bō", "单韵母声调/o1.mp3"),
            PinyinExample("坐", "zuò", "单韵母声调/o4.mp3")
        )),
        PinyinTableItem("e", "e", "e", "韵母/e.mp3", listOf(
            PinyinExample("鹅", "é", "单韵母声调/e2.mp3"),
            PinyinExample("河", "hé", "单韵母声调/e2.mp3"),
            PinyinExample("车", "chē", "单韵母声调/e1.mp3"),
            PinyinExample("喝", "hē", "单韵母声调/e1.mp3")
        )),
        PinyinTableItem("i", "i", "i", "韵母/i.mp3", listOf(
            PinyinExample("衣", "yī", "单韵母声调/i1.mp3"),
            PinyinExample("米", "mǐ", "单韵母声调/i3.mp3"),
            PinyinExample("地", "dì", "单韵母声调/i4.mp3"),
            PinyinExample("七", "qī", "单韵母声调/i1.mp3")
        )),
        PinyinTableItem("u", "u", "u", "韵母/u.mp3", listOf(
            PinyinExample("乌", "wū", "单韵母声调/u1.mp3"),
            PinyinExample("读", "dú", "单韵母声调/u2.mp3"),
            PinyinExample("土", "tǔ", "单韵母声调/u3.mp3"),
            PinyinExample("路", "lù", "单韵母声调/u4.mp3")
        )),
        PinyinTableItem("v", "v", "ü", "韵母/v.mp3", listOf(
            PinyinExample("鱼", "yú", "单韵母声调/v2.mp3"),
            PinyinExample("雨", "yǔ", "单韵母声调/v3.mp3"),
            PinyinExample("女", "nǚ", "单韵母声调/v3.mp3"),
            PinyinExample("绿", "lǜ", "单韵母声调/v4.mp3")
        ), tip = "双唇收圆，像吹口哨"),
        PinyinTableItem("ai", "ai", "ai", "韵母/ai.mp3", listOf(
            PinyinExample("爱", "ài", "复韵母声调/ai4.mp3"),
            PinyinExample("白", "bái", "复韵母声调/ai2.mp3"),
            PinyinExample("来", "lái", "复韵母声调/ai2.mp3"),
            PinyinExample("海", "hǎi", "复韵母声调/ai3.mp3")
        )),
        PinyinTableItem("ei", "ei", "ei", "韵母/ei.mp3", listOf(
            PinyinExample("诶", "ēi", "复韵母声调/ei1.mp3"),
            PinyinExample("杯", "bēi", "复韵母声调/ei1.mp3"),
            PinyinExample("飞", "fēi", "复韵母声调/ei1.mp3"),
            PinyinExample("妹", "mèi", "复韵母声调/ei4.mp3")
        )),
        PinyinTableItem("ui", "ui", "ui", "韵母/ui.mp3", listOf(
            PinyinExample("微", "wēi", "复韵母声调/ui1.mp3"),
            PinyinExample("回", "huí", "复韵母声调/ui2.mp3"),
            PinyinExample("水", "shuǐ", "复韵母声调/ui3.mp3"),
            PinyinExample("对", "duì", "复韵母声调/ui4.mp3")
        )),
        PinyinTableItem("ao", "ao", "ao", "韵母/ao.mp3", listOf(
            PinyinExample("熬", "áo", "复韵母声调/ao2.mp3"),
            PinyinExample("猫", "māo", "复韵母声调/ao1.mp3"),
            PinyinExample("跑", "pǎo", "复韵母声调/ao3.mp3"),
            PinyinExample("高", "gāo", "复韵母声调/ao1.mp3")
        )),
        PinyinTableItem("ou", "ou", "ou", "韵母/ou.mp3", listOf(
            PinyinExample("欧", "ōu", "复韵母声调/ou1.mp3"),
            PinyinExample("头", "tóu", "复韵母声调/ou2.mp3"),
            PinyinExample("口", "kǒu", "复韵母声调/ou3.mp3"),
            PinyinExample("走", "zǒu", "复韵母声调/ou3.mp3")
        )),
        PinyinTableItem("iu", "iu", "iu", "韵母/iu.mp3", listOf(
            PinyinExample("优", "yōu", "复韵母声调/iu1.mp3"),
            PinyinExample("六", "liù", "复韵母声调/iu4.mp3"),
            PinyinExample("球", "qiú", "复韵母声调/iu2.mp3"),
            PinyinExample("牛", "niú", "复韵母声调/iu2.mp3")
        )),
        PinyinTableItem("ie", "ie", "ie", "韵母/ie.mp3", listOf(
            PinyinExample("爷", "yé", "复韵母声调/ie2.mp3"),
            PinyinExample("姐", "jiě", "复韵母声调/ie3.mp3"),
            PinyinExample("写", "xiě", "复韵母声调/ie3.mp3"),
            PinyinExample("夜", "yè", "复韵母声调/ie4.mp3")
        )),
        PinyinTableItem("ve", "ve", "üe", "韵母/ve.mp3", listOf(
            PinyinExample("约", "yuē", "复韵母声调/ve1.mp3"),
            PinyinExample("学", "xué", "复韵母声调/ve2.mp3"),
            PinyinExample("月", "yuè", "复韵母声调/ve4.mp3"),
            PinyinExample("雪", "xuě", "复韵母声调/ve3.mp3")
        )),
        PinyinTableItem("er", "er", "er", "韵母/er.mp3", listOf(
            PinyinExample("二", "èr", "复韵母声调/er4.mp3"),
            PinyinExample("儿", "ér", "复韵母声调/er2.mp3"),
            PinyinExample("耳", "ěr", "复韵母声调/er3.mp3"),
            PinyinExample("而", "ér", "复韵母声调/er2.mp3")
        ), tip = "卷舌音，舌尖向上卷"),
        PinyinTableItem("an", "an", "an", "韵母/an.mp3", listOf(
            PinyinExample("安", "ān", "鼻韵母声调/an1.mp3"),
            PinyinExample("班", "bān", "鼻韵母声调/an1.mp3"),
            PinyinExample("看", "kàn", "鼻韵母声调/an4.mp3"),
            PinyinExample("山", "shān", "鼻韵母声调/an1.mp3")
        )),
        PinyinTableItem("en", "en", "en", "韵母/en.mp3", listOf(
            PinyinExample("恩", "ēn", "鼻韵母声调/en1.mp3"),
            PinyinExample("本", "běn", "鼻韵母声调/en3.mp3"),
            PinyinExample("人", "rén", "鼻韵母声调/en2.mp3"),
            PinyinExample("门", "mén", "鼻韵母声调/en2.mp3")
        )),
        PinyinTableItem("in", "in", "in", "韵母/in.mp3", listOf(
            PinyinExample("因", "yīn", "鼻韵母声调/in1.mp3"),
            PinyinExample("音", "yīn", "整体认读声调/yin1.mp3"),
            PinyinExample("近", "jìn", "鼻韵母声调/in4.mp3"),
            PinyinExample("信", "xìn", "鼻韵母声调/in4.mp3")
        )),
        PinyinTableItem("un", "un", "un", "韵母/un.mp3", listOf(
            PinyinExample("温", "wēn", "鼻韵母声调/un1.mp3"),
            PinyinExample("春", "chūn", "鼻韵母声调/un1.mp3"),
            PinyinExample("轮", "lún", "鼻韵母声调/un2.mp3"),
            PinyinExample("问", "wèn", "鼻韵母声调/un4.mp3")
        )),
        PinyinTableItem("vn", "vn", "ün", "韵母/vn.mp3", listOf(
            PinyinExample("云", "yún", "鼻韵母声调/vn2.mp3"),
            PinyinExample("军", "jūn", "鼻韵母声调/vn1.mp3"),
            PinyinExample("群", "qún", "鼻韵母声调/vn2.mp3"),
            PinyinExample("运", "yùn", "鼻韵母声调/vn4.mp3")
        )),
        PinyinTableItem("ang", "ang", "ang", "韵母/ang.mp3", listOf(
            PinyinExample("昂", "áng", "鼻韵母声调/ang2.mp3"),
            PinyinExample("方", "fāng", "鼻韵母声调/ang1.mp3"),
            PinyinExample("房", "fáng", "鼻韵母声调/ang2.mp3"),
            PinyinExample("长", "cháng", "鼻韵母声调/ang2.mp3")
        )),
        PinyinTableItem("eng", "eng", "eng", "韵母/eng.mp3", listOf(
            PinyinExample("灯", "dēng", "鼻韵母声调/eng1.mp3"),
            PinyinExample("风", "fēng", "鼻韵母声调/eng1.mp3"),
            PinyinExample("朋", "péng", "鼻韵母声调/eng2.mp3"),
            PinyinExample("更", "gèng", "鼻韵母声调/eng4.mp3")
        )),
        PinyinTableItem("ing", "ing", "ing", "韵母/ing.mp3", listOf(
            PinyinExample("英", "yīng", "整体认读声调/ying1.mp3"),
            PinyinExample("星", "xīng", "鼻韵母声调/ing1.mp3"),
            PinyinExample("明", "míng", "鼻韵母声调/ing2.mp3"),
            PinyinExample("听", "tīng", "鼻韵母声调/ing1.mp3")
        )),
        PinyinTableItem("ong", "ong", "ong", "韵母/ong.mp3", listOf(
            PinyinExample("红", "hóng", "鼻韵母声调/ong2.mp3"),
            PinyinExample("龙", "lóng", "鼻韵母声调/ong2.mp3"),
            PinyinExample("中", "zhōng", "鼻韵母声调/ong1.mp3"),
            PinyinExample("同", "tóng", "鼻韵母声调/ong2.mp3")
        )),
        PinyinTableItem("ian", "ian", "ian", "特殊韵母声调/ian1.mp3", listOf(
            PinyinExample("边", "biān", "特殊韵母声调/ian1.mp3"),
            PinyinExample("天", "tiān", "特殊韵母声调/ian1.mp3"),
            PinyinExample("见", "jiàn", "特殊韵母声调/ian4.mp3"),
            PinyinExample("点", "diǎn", "特殊韵母声调/ian3.mp3")
        )),
        PinyinTableItem("uan", "uan", "uan", "特殊韵母声调/uan1.mp3", listOf(
            PinyinExample("弯", "wān", "特殊韵母声调/uan1.mp3"),
            PinyinExample("团", "tuán", "特殊韵母声调/uan2.mp3"),
            PinyinExample("欢", "huān", "特殊韵母声调/uan1.mp3"),
            PinyinExample("宽", "kuān", "特殊韵母声调/uan1.mp3")
        ))
    )

    val zhengti: List<PinyinTableItem> = listOf(
        PinyinTableItem("zhi", "zhi", "zhi", "整体认读音节/zhi.mp3", listOf(
            PinyinExample("知", "zhī", "整体认读声调/zhi1.mp3"),
            PinyinExample("只", "zhǐ", "整体认读声调/zhi3.mp3"),
            PinyinExample("纸", "zhǐ", "整体认读声调/zhi3.mp3"),
            PinyinExample("指", "zhǐ", "整体认读声调/zhi3.mp3")
        )),
        PinyinTableItem("chi", "chi", "chi", "整体认读音节/chi.mp3", listOf(
            PinyinExample("吃", "chī", "整体认读声调/chi1.mp3"),
            PinyinExample("迟", "chí", "整体认读声调/chi2.mp3"),
            PinyinExample("尺", "chǐ", "整体认读声调/chi3.mp3"),
            PinyinExample("齿", "chǐ", "整体认读声调/chi3.mp3")
        )),
        PinyinTableItem("shi", "shi", "shi", "整体认读音节/shi.mp3", listOf(
            PinyinExample("十", "shí", "整体认读声调/shi2.mp3"),
            PinyinExample("石", "shí", "整体认读声调/shi2.mp3"),
            PinyinExample("是", "shì", "整体认读声调/shi4.mp3"),
            PinyinExample("事", "shì", "整体认读声调/shi4.mp3")
        )),
        PinyinTableItem("ri", "ri", "ri", "整体认读音节/ri.mp3", listOf(
            PinyinExample("日", "rì", "整体认读声调/ri4.mp3"),
            PinyinExample("热", "rè", "复韵母声调/er4.mp3")
        )),
        PinyinTableItem("zi", "zi", "zi", "整体认读音节/zi.mp3", listOf(
            PinyinExample("字", "zì", "整体认读声调/zi4.mp3"),
            PinyinExample("子", "zǐ", "整体认读声调/zi3.mp3"),
            PinyinExample("自", "zì", "整体认读声调/zi4.mp3"),
            PinyinExample("紫", "zǐ", "整体认读声调/zi3.mp3")
        )),
        PinyinTableItem("ci", "ci", "ci", "整体认读音节/ci.mp3", listOf(
            PinyinExample("词", "cí", "整体认读声调/ci2.mp3"),
            PinyinExample("此", "cǐ", "整体认读声调/ci3.mp3"),
            PinyinExample("刺", "cì", "整体认读声调/ci4.mp3"),
            PinyinExample("次", "cì", "整体认读声调/ci4.mp3")
        )),
        PinyinTableItem("si", "si", "si", "整体认读音节/si.mp3", listOf(
            PinyinExample("四", "sì", "整体认读声调/si4.mp3"),
            PinyinExample("丝", "sī", "整体认读声调/si1.mp3"),
            PinyinExample("死", "sǐ", "整体认读声调/si3.mp3"),
            PinyinExample("思", "sī", "整体认读声调/si1.mp3")
        )),
        PinyinTableItem("yi", "yi", "yi", "整体认读音节/yi.mp3", listOf(
            PinyinExample("一", "yī", "单韵母声调/i1.mp3"),
            PinyinExample("医", "yī", "单韵母声调/i1.mp3"),
            PinyinExample("以", "yǐ", "单韵母声调/i3.mp3"),
            PinyinExample("意", "yì", "单韵母声调/i4.mp3")
        )),
        PinyinTableItem("wu", "wu", "wu", "整体认读音节/wu.mp3", listOf(
            PinyinExample("五", "wǔ", "整体认读声调/wu3.mp3"),
            PinyinExample("无", "wú", "整体认读声调/wu2.mp3"),
            PinyinExample("物", "wù", "整体认读声调/wu4.mp3"),
            PinyinExample("屋", "wū", "整体认读声调/wu1.mp3")
        )),
        PinyinTableItem("yu", "yu", "yu", "整体认读音节/yu.mp3", listOf(
            PinyinExample("鱼", "yú", "整体认读声调/yu2.mp3"),
            PinyinExample("雨", "yǔ", "整体认读声调/yu3.mp3"),
            PinyinExample("玉", "yù", "整体认读声调/yu4.mp3"),
            PinyinExample("于", "yú", "整体认读声调/yu2.mp3")
        )),
        PinyinTableItem("ye", "ye", "ye", "整体认读音节/ye.mp3", listOf(
            PinyinExample("爷", "yé", "整体认读声调/ye2.mp3"),
            PinyinExample("叶", "yè", "整体认读声调/ye4.mp3"),
            PinyinExample("夜", "yè", "整体认读声调/ye4.mp3"),
            PinyinExample("也", "yě", "整体认读声调/ye3.mp3")
        )),
        PinyinTableItem("yue", "yue", "yue", "整体认读音节/yue.mp3", listOf(
            PinyinExample("月", "yuè", "整体认读声调/yue4.mp3"),
            PinyinExample("越", "yuè", "整体认读声调/yue4.mp3"),
            PinyinExample("约", "yuē", "整体认读声调/yue1.mp3"),
            PinyinExample("乐", "yuè", "整体认读声调/yue4.mp3")
        )),
        PinyinTableItem("yuan", "yuan", "yuan", "整体认读音节/yuan.mp3", listOf(
            PinyinExample("圆", "yuán", "整体认读声调/yuan2.mp3"),
            PinyinExample("远", "yuǎn", "整体认读声调/yuan3.mp3"),
            PinyinExample("院", "yuàn", "整体认读声调/yuan4.mp3"),
            PinyinExample("员", "yuán", "整体认读声调/yuan2.mp3")
        )),
        PinyinTableItem("yin", "yin", "yin", "整体认读音节/yin.mp3", listOf(
            PinyinExample("因", "yīn", "整体认读声调/yin1.mp3"),
            PinyinExample("音", "yīn", "整体认读声调/yin1.mp3"),
            PinyinExample("银", "yín", "整体认读声调/yin2.mp3"),
            PinyinExample("印", "yìn", "整体认读声调/yin4.mp3")
        )),
        PinyinTableItem("yun", "yun", "yun", "整体认读音节/yun.mp3", listOf(
            PinyinExample("云", "yún", "整体认读声调/yun2.mp3"),
            PinyinExample("运", "yùn", "整体认读声调/yun4.mp3"),
            PinyinExample("晕", "yūn", "整体认读声调/yun1.mp3"),
            PinyinExample("韵", "yùn", "整体认读声调/yun4.mp3")
        )),
        PinyinTableItem("ying", "ying", "ying", "整体认读音节/ying.mp3", listOf(
            PinyinExample("英", "yīng", "整体认读声调/ying1.mp3"),
            PinyinExample("应", "yīng", "整体认读声调/ying1.mp3"),
            PinyinExample("影", "yǐng", "整体认读声调/ying3.mp3"),
            PinyinExample("硬", "yìng", "整体认读声调/ying4.mp3")
        ))
    )

    /** 展平所有项（详情页横向滑动顺序：声母 → 韵母 → 整体认读） */
    val all: List<Pair<PinyinCategory, PinyinTableItem>> = buildList {
        shengmu.forEach { add(PinyinCategory.SHENGMU to it) }
        yunmu.forEach { add(PinyinCategory.YUNMU to it) }
        zhengti.forEach { add(PinyinCategory.ZHENGTI to it) }
    }

    /** 助记字：类别 → (id → 助记字) */
    val mnemonics: Map<PinyinCategory, Map<String, String>> = mapOf(
        PinyinCategory.SHENGMU to mapOf("b" to "波", "p" to "泼", "m" to "摸", "f" to "佛", "d" to "的", "t" to "特", "n" to "呢", "l" to "了", "g" to "哥", "k" to "蝌", "h" to "喝", "j" to "鸡", "q" to "七", "x" to "西", "zh" to "知", "ch" to "吃", "sh" to "师", "r" to "日", "z" to "资", "c" to "疵", "s" to "思", "y" to "一", "w" to "乌"),
        PinyinCategory.YUNMU to mapOf("a" to "啊", "o" to "哦", "e" to "鹅", "i" to "一", "u" to "乌", "v" to "淤", "ai" to "哀", "ei" to "诶", "ui" to "威", "ao" to "凹", "ou" to "鸥", "iu" to "优", "ie" to "椰", "ve" to "约", "er" to "耳", "an" to "安", "en" to "恩", "in" to "因", "un" to "温", "vn" to "晕", "ian" to "烟", "uan" to "弯", "van" to "渊", "ang" to "昂", "eng" to "嗯", "ing" to "英", "ong" to "翁"),
        PinyinCategory.ZHENGTI to mapOf("zhi" to "知", "chi" to "吃", "shi" to "师", "ri" to "日", "zi" to "资", "ci" to "疵", "si" to "思", "yi" to "一", "wu" to "乌", "yu" to "淤", "ye" to "椰", "yue" to "约", "yuan" to "渊", "yin" to "因", "yun" to "晕", "ying" to "英"),
    )

    /** 取某音素的助记字（无则空串） */
    fun mnemonic(category: PinyinCategory, id: String): String =
        mnemonics[category]?.get(id) ?: ""
}
