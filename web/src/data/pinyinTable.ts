/** 拼音表数据 — 声母/韵母/整体认读音节，每个音素配例字（点击可发音）
 *  音频路径规则（与 server_py /pinyin-audio 对应）：
 *   - 声母：  声母/{b}.mp3
 *   - 韵母：  韵母/{a}.mp3        （ü 写作 v）
 *   - 整体认读：整体认读音节/{zhi}.mp3
 */

export type PinyinCategory = "shengmu" | "yunmu" | "zhengti"

export interface PinyinItem {
  /** 唯一标识（用于路由/detail） */
  id: string
  /** 声母/韵母/整体认读的符号（韵母 ü 用 v 存，显示转 ü） */
  symbol: string
  /** 显示符号（含 ü 转换） */
  label: string
  /** 音频文件名（相对 pinyin-audio） */
  audio: string
  /** 例字：{字, 拼音(带声调), 完整音频文件名} */
  examples: { char: string; pinyin: string; audio: string }[]
  /** 口诀/提示（可选） */
  tip?: string
}

/** 声母（23） */
export const SHENGMU: PinyinItem[] = [
  { id: "b", symbol: "b", label: "b", audio: "声母/b.mp3", examples: [
    { char: "爸", pinyin: "bà", audio: "声母/b.mp3" }, { char: "波", pinyin: "bō", audio: "声母/b.mp3" },
    { char: "笔", pinyin: "bǐ", audio: "声母/b.mp3" }, { char: "白", pinyin: "bái", audio: "声母/b.mp3" },
  ], tip: "双唇紧闭，然后放开" },
  { id: "p", symbol: "p", label: "p", audio: "声母/p.mp3", examples: [
    { char: "爬", pinyin: "pá", audio: "声母/p.mp3" }, { char: "皮", pinyin: "pí", audio: "声母/p.mp3" },
    { char: "扑", pinyin: "pū", audio: "声母/p.mp3" }, { char: "坡", pinyin: "pō", audio: "声母/p.mp3" },
  ] },
  { id: "m", symbol: "m", label: "m", audio: "声母/m.mp3", examples: [
    { char: "妈", pinyin: "mā", audio: "声母/m.mp3" }, { char: "米", pinyin: "mǐ", audio: "声母/m.mp3" },
    { char: "木", pinyin: "mù", audio: "声母/m.mp3" }, { char: "猫", pinyin: "māo", audio: "声母/m.mp3" },
  ] },
  { id: "f", symbol: "f", label: "f", audio: "声母/f.mp3", examples: [
    { char: "发", pinyin: "fā", audio: "声母/f.mp3" }, { char: "风", pinyin: "fēng", audio: "声母/f.mp3" },
    { char: "饭", pinyin: "fàn", audio: "声母/f.mp3" }, { char: "飞", pinyin: "fēi", audio: "声母/f.mp3" },
  ] },
  { id: "d", symbol: "d", label: "d", audio: "声母/d.mp3", examples: [
    { char: "大", pinyin: "dà", audio: "声母/d.mp3" }, { char: "读", pinyin: "dú", audio: "声母/d.mp3" },
    { char: "地", pinyin: "dì", audio: "声母/d.mp3" }, { char: "灯", pinyin: "dēng", audio: "声母/d.mp3" },
  ] },
  { id: "t", symbol: "t", label: "t", audio: "声母/t.mp3", examples: [
    { char: "他", pinyin: "tā", audio: "声母/t.mp3" }, { char: "天", pinyin: "tiān", audio: "声母/t.mp3" },
    { char: "土", pinyin: "tǔ", audio: "声母/t.mp3" }, { char: "跳", pinyin: "tiào", audio: "声母/t.mp3" },
  ] },
  { id: "n", symbol: "n", label: "n", audio: "声母/n.mp3", examples: [
    { char: "你", pinyin: "nǐ", audio: "声母/n.mp3" }, { char: "牛", pinyin: "niú", audio: "声母/n.mp3" },
    { char: "鸟", pinyin: "niǎo", audio: "声母/n.mp3" }, { char: "脑", pinyin: "nǎo", audio: "声母/n.mp3" },
  ] },
  { id: "l", symbol: "l", label: "l", audio: "声母/l.mp3", examples: [
    { char: "力", pinyin: "lì", audio: "声母/l.mp3" }, { char: "六", pinyin: "liù", audio: "声母/l.mp3" },
    { char: "来", pinyin: "lái", audio: "声母/l.mp3" }, { char: "龙", pinyin: "lóng", audio: "声母/l.mp3" },
  ] },
  { id: "g", symbol: "g", label: "g", audio: "声母/g.mp3", examples: [
    { char: "哥", pinyin: "gē", audio: "声母/g.mp3" }, { char: "瓜", pinyin: "guā", audio: "声母/g.mp3" },
    { char: "高", pinyin: "gāo", audio: "声母/g.mp3" }, { char: "果", pinyin: "guǒ", audio: "声母/g.mp3" },
  ] },
  { id: "k", symbol: "k", label: "k", audio: "声母/k.mp3", examples: [
    { char: "哭", pinyin: "kū", audio: "声母/k.mp3" }, { char: "看", pinyin: "kàn", audio: "声母/k.mp3" },
    { char: "快", pinyin: "kuài", audio: "声母/k.mp3" }, { char: "口", pinyin: "kǒu", audio: "声母/k.mp3" },
  ] },
  { id: "h", symbol: "h", label: "h", audio: "声母/h.mp3", examples: [
    { char: "花", pinyin: "huā", audio: "声母/h.mp3" }, { char: "河", pinyin: "hé", audio: "声母/h.mp3" },
    { char: "红", pinyin: "hóng", audio: "声母/h.mp3" }, { char: "火", pinyin: "huǒ", audio: "声母/h.mp3" },
  ] },
  { id: "j", symbol: "j", label: "j", audio: "声母/j.mp3", examples: [
    { char: "鸡", pinyin: "jī", audio: "声母/j.mp3" }, { char: "家", pinyin: "jiā", audio: "声母/j.mp3" },
    { char: "九", pinyin: "jiǔ", audio: "声母/j.mp3" }, { char: "见", pinyin: "jiàn", audio: "声母/j.mp3" },
  ] },
  { id: "q", symbol: "q", label: "q", audio: "声母/q.mp3", examples: [
    { char: "七", pinyin: "qī", audio: "声母/q.mp3" }, { char: "去", pinyin: "qù", audio: "声母/q.mp3" },
    { char: "球", pinyin: "qiú", audio: "声母/q.mp3" }, { char: "桥", pinyin: "qiáo", audio: "声母/q.mp3" },
  ] },
  { id: "x", symbol: "x", label: "x", audio: "声母/x.mp3", examples: [
    { char: "西", pinyin: "xī", audio: "声母/x.mp3" }, { char: "下", pinyin: "xià", audio: "声母/x.mp3" },
    { char: "小", pinyin: "xiǎo", audio: "声母/x.mp3" }, { char: "星", pinyin: "xīng", audio: "声母/x.mp3" },
  ] },
  { id: "zh", symbol: "zh", label: "zh", audio: "声母/zh.mp3", examples: [
    { char: "纸", pinyin: "zhǐ", audio: "声母/zh.mp3" }, { char: "钟", pinyin: "zhōng", audio: "声母/zh.mp3" },
    { char: "住", pinyin: "zhù", audio: "声母/zh.mp3" }, { char: "桌", pinyin: "zhuō", audio: "声母/zh.mp3" },
  ], tip: "舌尖翘起，抵住上颚" },
  { id: "ch", symbol: "ch", label: "ch", audio: "声母/ch.mp3", examples: [
    { char: "吃", pinyin: "chī", audio: "声母/ch.mp3" }, { char: "车", pinyin: "chē", audio: "声母/ch.mp3" },
    { char: "长", pinyin: "cháng", audio: "声母/ch.mp3" }, { char: "虫", pinyin: "chóng", audio: "声母/ch.mp3" },
  ] },
  { id: "sh", symbol: "sh", label: "sh", audio: "声母/sh.mp3", examples: [
    { char: "书", pinyin: "shū", audio: "声母/sh.mp3" }, { char: "山", pinyin: "shān", audio: "声母/sh.mp3" },
    { char: "水", pinyin: "shuǐ", audio: "声母/sh.mp3" }, { char: "十", pinyin: "shí", audio: "声母/sh.mp3" },
  ] },
  { id: "r", symbol: "r", label: "r", audio: "声母/r.mp3", examples: [
    { char: "日", pinyin: "rì", audio: "声母/r.mp3" }, { char: "人", pinyin: "rén", audio: "声母/r.mp3" },
    { char: "热", pinyin: "rè", audio: "声母/r.mp3" }, { char: "让", pinyin: "ràng", audio: "声母/r.mp3" },
  ] },
  { id: "z", symbol: "z", label: "z", audio: "声母/z.mp3", examples: [
    { char: "字", pinyin: "zì", audio: "声母/z.mp3" }, { char: "早", pinyin: "zǎo", audio: "声母/z.mp3" },
    { char: "在", pinyin: "zài", audio: "声母/z.mp3" }, { char: "坐", pinyin: "zuò", audio: "声母/z.mp3" },
  ] },
  { id: "c", symbol: "c", label: "c", audio: "声母/c.mp3", examples: [
    { char: "草", pinyin: "cǎo", audio: "声母/c.mp3" }, { char: "菜", pinyin: "cài", audio: "声母/c.mp3" },
    { char: "从", pinyin: "cóng", audio: "声母/c.mp3" }, { char: "猜", pinyin: "cāi", audio: "声母/c.mp3" },
  ] },
  { id: "s", symbol: "s", label: "s", audio: "声母/s.mp3", examples: [
    { char: "四", pinyin: "sì", audio: "声母/s.mp3" }, { char: "三", pinyin: "sān", audio: "声母/s.mp3" },
    { char: "送", pinyin: "sòng", audio: "声母/s.mp3" }, { char: "岁", pinyin: "suì", audio: "声母/s.mp3" },
  ] },
  { id: "y", symbol: "y", label: "y", audio: "声母/y.mp3", examples: [
    { char: "一", pinyin: "yī", audio: "声母/y.mp3" }, { char: "鱼", pinyin: "yú", audio: "声母/y.mp3" },
    { char: "云", pinyin: "yún", audio: "声母/y.mp3" }, { char: "雨", pinyin: "yǔ", audio: "声母/y.mp3" },
  ] },
  { id: "w", symbol: "w", label: "w", audio: "声母/w.mp3", examples: [
    { char: "五", pinyin: "wǔ", audio: "声母/w.mp3" }, { char: "王", pinyin: "wáng", audio: "声母/w.mp3" },
    { char: "我", pinyin: "wǒ", audio: "声母/w.mp3" }, { char: "问", pinyin: "wèn", audio: "声母/w.mp3" },
  ] },
]

/** 韵母（39，ü 用 v 存，显示转 ü） */
export const YUNMU: PinyinItem[] = [
  { id: "a", symbol: "a", label: "a", audio: "韵母/a.mp3", examples: [
    { char: "阿", pinyin: "ā", audio: "单韵母声调/a1.mp3" }, { char: "爸", pinyin: "bà", audio: "单韵母声调/a4.mp3" },
    { char: "马", pinyin: "mǎ", audio: "单韵母声调/a3.mp3" }, { char: "大", pinyin: "dà", audio: "单韵母声调/a4.mp3" },
  ] },
  { id: "o", symbol: "o", label: "o", audio: "韵母/o.mp3", examples: [
    { char: "哦", pinyin: "ō", audio: "单韵母声调/o1.mp3" }, { char: "播", pinyin: "bō", audio: "单韵母声调/o1.mp3" },
    { char: "波", pinyin: "bō", audio: "单韵母声调/o1.mp3" }, { char: "坐", pinyin: "zuò", audio: "单韵母声调/o4.mp3" },
  ] },
  { id: "e", symbol: "e", label: "e", audio: "韵母/e.mp3", examples: [
    { char: "鹅", pinyin: "é", audio: "单韵母声调/e2.mp3" }, { char: "河", pinyin: "hé", audio: "单韵母声调/e2.mp3" },
    { char: "车", pinyin: "chē", audio: "单韵母声调/e1.mp3" }, { char: "喝", pinyin: "hē", audio: "单韵母声调/e1.mp3" },
  ] },
  { id: "i", symbol: "i", label: "i", audio: "韵母/i.mp3", examples: [
    { char: "衣", pinyin: "yī", audio: "单韵母声调/i1.mp3" }, { char: "米", pinyin: "mǐ", audio: "单韵母声调/i3.mp3" },
    { char: "地", pinyin: "dì", audio: "单韵母声调/i4.mp3" }, { char: "七", pinyin: "qī", audio: "单韵母声调/i1.mp3" },
  ] },
  { id: "u", symbol: "u", label: "u", audio: "韵母/u.mp3", examples: [
    { char: "乌", pinyin: "wū", audio: "单韵母声调/u1.mp3" }, { char: "读", pinyin: "dú", audio: "单韵母声调/u2.mp3" },
    { char: "土", pinyin: "tǔ", audio: "单韵母声调/u3.mp3" }, { char: "路", pinyin: "lù", audio: "单韵母声调/u4.mp3" },
  ] },
  { id: "v", symbol: "v", label: "ü", audio: "韵母/v.mp3", examples: [
    { char: "鱼", pinyin: "yú", audio: "单韵母声调/v2.mp3" }, { char: "雨", pinyin: "yǔ", audio: "单韵母声调/v3.mp3" },
    { char: "女", pinyin: "nǚ", audio: "单韵母声调/v3.mp3" }, { char: "绿", pinyin: "lǜ", audio: "单韵母声调/v4.mp3" },
  ], tip: "双唇收圆，像吹口哨" },
  { id: "ai", symbol: "ai", label: "ai", audio: "韵母/ai.mp3", examples: [
    { char: "爱", pinyin: "ài", audio: "复韵母声调/ai4.mp3" }, { char: "白", pinyin: "bái", audio: "复韵母声调/ai2.mp3" },
    { char: "来", pinyin: "lái", audio: "复韵母声调/ai2.mp3" }, { char: "海", pinyin: "hǎi", audio: "复韵母声调/ai3.mp3" },
  ] },
  { id: "ei", symbol: "ei", label: "ei", audio: "韵母/ei.mp3", examples: [
    { char: "诶", pinyin: "ēi", audio: "复韵母声调/ei1.mp3" }, { char: "杯", pinyin: "bēi", audio: "复韵母声调/ei1.mp3" },
    { char: "飞", pinyin: "fēi", audio: "复韵母声调/ei1.mp3" }, { char: "妹", pinyin: "mèi", audio: "复韵母声调/ei4.mp3" },
  ] },
  { id: "ui", symbol: "ui", label: "ui", audio: "韵母/ui.mp3", examples: [
    { char: "微", pinyin: "wēi", audio: "复韵母声调/ui1.mp3" }, { char: "回", pinyin: "huí", audio: "复韵母声调/ui2.mp3" },
    { char: "水", pinyin: "shuǐ", audio: "复韵母声调/ui3.mp3" }, { char: "对", pinyin: "duì", audio: "复韵母声调/ui4.mp3" },
  ] },
  { id: "ao", symbol: "ao", label: "ao", audio: "韵母/ao.mp3", examples: [
    { char: "熬", pinyin: "áo", audio: "复韵母声调/ao2.mp3" }, { char: "猫", pinyin: "māo", audio: "复韵母声调/ao1.mp3" },
    { char: "跑", pinyin: "pǎo", audio: "复韵母声调/ao3.mp3" }, { char: "高", pinyin: "gāo", audio: "复韵母声调/ao1.mp3" },
  ] },
  { id: "ou", symbol: "ou", label: "ou", audio: "韵母/ou.mp3", examples: [
    { char: "欧", pinyin: "ōu", audio: "复韵母声调/ou1.mp3" }, { char: "头", pinyin: "tóu", audio: "复韵母声调/ou2.mp3" },
    { char: "口", pinyin: "kǒu", audio: "复韵母声调/ou3.mp3" }, { char: "走", pinyin: "zǒu", audio: "复韵母声调/ou3.mp3" },
  ] },
  { id: "iu", symbol: "iu", label: "iu", audio: "韵母/iu.mp3", examples: [
    { char: "优", pinyin: "yōu", audio: "复韵母声调/iu1.mp3" }, { char: "六", pinyin: "liù", audio: "复韵母声调/iu4.mp3" },
    { char: "球", pinyin: "qiú", audio: "复韵母声调/iu2.mp3" }, { char: "牛", pinyin: "niú", audio: "复韵母声调/iu2.mp3" },
  ] },
  { id: "ie", symbol: "ie", label: "ie", audio: "韵母/ie.mp3", examples: [
    { char: "爷", pinyin: "yé", audio: "复韵母声调/ie2.mp3" }, { char: "姐", pinyin: "jiě", audio: "复韵母声调/ie3.mp3" },
    { char: "写", pinyin: "xiě", audio: "复韵母声调/ie3.mp3" }, { char: "夜", pinyin: "yè", audio: "复韵母声调/ie4.mp3" },
  ] },
  { id: "ve", symbol: "ve", label: "üe", audio: "韵母/ve.mp3", examples: [
    { char: "约", pinyin: "yuē", audio: "复韵母声调/ve1.mp3" }, { char: "学", pinyin: "xué", audio: "复韵母声调/ve2.mp3" },
    { char: "月", pinyin: "yuè", audio: "复韵母声调/ve4.mp3" }, { char: "雪", pinyin: "xuě", audio: "复韵母声调/ve3.mp3" },
  ] },
  { id: "er", symbol: "er", label: "er", audio: "韵母/er.mp3", examples: [
    { char: "二", pinyin: "èr", audio: "复韵母声调/er4.mp3" }, { char: "儿", pinyin: "ér", audio: "复韵母声调/er2.mp3" },
    { char: "耳", pinyin: "ěr", audio: "复韵母声调/er3.mp3" }, { char: "而", pinyin: "ér", audio: "复韵母声调/er2.mp3" },
  ], tip: "卷舌音，舌尖向上卷" },
  { id: "an", symbol: "an", label: "an", audio: "韵母/an.mp3", examples: [
    { char: "安", pinyin: "ān", audio: "鼻韵母声调/an1.mp3" }, { char: "班", pinyin: "bān", audio: "鼻韵母声调/an1.mp3" },
    { char: "看", pinyin: "kàn", audio: "鼻韵母声调/an4.mp3" }, { char: "山", pinyin: "shān", audio: "鼻韵母声调/an1.mp3" },
  ] },
  { id: "en", symbol: "en", label: "en", audio: "韵母/en.mp3", examples: [
    { char: "恩", pinyin: "ēn", audio: "鼻韵母声调/en1.mp3" }, { char: "本", pinyin: "běn", audio: "鼻韵母声调/en3.mp3" },
    { char: "人", pinyin: "rén", audio: "鼻韵母声调/en2.mp3" }, { char: "门", pinyin: "mén", audio: "鼻韵母声调/en2.mp3" },
  ] },
  { id: "in", symbol: "in", label: "in", audio: "韵母/in.mp3", examples: [
    { char: "因", pinyin: "yīn", audio: "鼻韵母声调/in1.mp3" }, { char: "音", pinyin: "yīn", audio: "整体认读声调/yin1.mp3" },
    { char: "近", pinyin: "jìn", audio: "鼻韵母声调/in4.mp3" }, { char: "信", pinyin: "xìn", audio: "鼻韵母声调/in4.mp3" },
  ] },
  { id: "un", symbol: "un", label: "un", audio: "韵母/un.mp3", examples: [
    { char: "温", pinyin: "wēn", audio: "鼻韵母声调/un1.mp3" }, { char: "春", pinyin: "chūn", audio: "鼻韵母声调/un1.mp3" },
    { char: "轮", pinyin: "lún", audio: "鼻韵母声调/un2.mp3" }, { char: "问", pinyin: "wèn", audio: "鼻韵母声调/un4.mp3" },
  ] },
  { id: "vn", symbol: "vn", label: "ün", audio: "韵母/vn.mp3", examples: [
    { char: "云", pinyin: "yún", audio: "鼻韵母声调/vn2.mp3" }, { char: "军", pinyin: "jūn", audio: "鼻韵母声调/vn1.mp3" },
    { char: "群", pinyin: "qún", audio: "鼻韵母声调/vn2.mp3" }, { char: "运", pinyin: "yùn", audio: "鼻韵母声调/vn4.mp3" },
  ] },
  { id: "ang", symbol: "ang", label: "ang", audio: "韵母/ang.mp3", examples: [
    { char: "昂", pinyin: "áng", audio: "鼻韵母声调/ang2.mp3" }, { char: "方", pinyin: "fāng", audio: "鼻韵母声调/ang1.mp3" },
    { char: "房", pinyin: "fáng", audio: "鼻韵母声调/ang2.mp3" }, { char: "长", pinyin: "cháng", audio: "鼻韵母声调/ang2.mp3" },
  ] },
  { id: "eng", symbol: "eng", label: "eng", audio: "韵母/eng.mp3", examples: [
    { char: "灯", pinyin: "dēng", audio: "鼻韵母声调/eng1.mp3" }, { char: "风", pinyin: "fēng", audio: "鼻韵母声调/eng1.mp3" },
    { char: "朋", pinyin: "péng", audio: "鼻韵母声调/eng2.mp3" }, { char: "更", pinyin: "gèng", audio: "鼻韵母声调/eng4.mp3" },
  ] },
  { id: "ing", symbol: "ing", label: "ing", audio: "韵母/ing.mp3", examples: [
    { char: "英", pinyin: "yīng", audio: "整体认读声调/ying1.mp3" }, { char: "星", pinyin: "xīng", audio: "鼻韵母声调/ing1.mp3" },
    { char: "明", pinyin: "míng", audio: "鼻韵母声调/ing2.mp3" }, { char: "听", pinyin: "tīng", audio: "鼻韵母声调/ing1.mp3" },
  ] },
  { id: "ong", symbol: "ong", label: "ong", audio: "韵母/ong.mp3", examples: [
    { char: "红", pinyin: "hóng", audio: "鼻韵母声调/ong2.mp3" }, { char: "龙", pinyin: "lóng", audio: "鼻韵母声调/ong2.mp3" },
    { char: "中", pinyin: "zhōng", audio: "鼻韵母声调/ong1.mp3" }, { char: "同", pinyin: "tóng", audio: "鼻韵母声调/ong2.mp3" },
  ] },
  { id: "ian", symbol: "ian", label: "ian", audio: "特殊韵母声调/ian1.mp3", examples: [
    { char: "边", pinyin: "biān", audio: "特殊韵母声调/ian1.mp3" }, { char: "天", pinyin: "tiān", audio: "特殊韵母声调/ian1.mp3" },
    { char: "见", pinyin: "jiàn", audio: "特殊韵母声调/ian4.mp3" }, { char: "点", pinyin: "diǎn", audio: "特殊韵母声调/ian3.mp3" },
  ] },
  { id: "uan", symbol: "uan", label: "uan", audio: "特殊韵母声调/uan1.mp3", examples: [
    { char: "弯", pinyin: "wān", audio: "特殊韵母声调/uan1.mp3" }, { char: "团", pinyin: "tuán", audio: "特殊韵母声调/uan2.mp3" },
    { char: "欢", pinyin: "huān", audio: "特殊韵母声调/uan1.mp3" }, { char: "宽", pinyin: "kuān", audio: "特殊韵母声调/uan1.mp3" },
  ] },
]

/** 整体认读音节（16） */
export const ZHENGTI: PinyinItem[] = [
  { id: "zhi", symbol: "zhi", label: "zhi", audio: "整体认读音节/zhi.mp3", examples: [
    { char: "知", pinyin: "zhī", audio: "整体认读声调/zhi1.mp3" }, { char: "只", pinyin: "zhǐ", audio: "整体认读声调/zhi3.mp3" },
    { char: "纸", pinyin: "zhǐ", audio: "整体认读声调/zhi3.mp3" }, { char: "指", pinyin: "zhǐ", audio: "整体认读声调/zhi3.mp3" },
  ] },
  { id: "chi", symbol: "chi", label: "chi", audio: "整体认读音节/chi.mp3", examples: [
    { char: "吃", pinyin: "chī", audio: "整体认读声调/chi1.mp3" }, { char: "迟", pinyin: "chí", audio: "整体认读声调/chi2.mp3" },
    { char: "尺", pinyin: "chǐ", audio: "整体认读声调/chi3.mp3" }, { char: "齿", pinyin: "chǐ", audio: "整体认读声调/chi3.mp3" },
  ] },
  { id: "shi", symbol: "shi", label: "shi", audio: "整体认读音节/shi.mp3", examples: [
    { char: "十", pinyin: "shí", audio: "整体认读声调/shi2.mp3" }, { char: "石", pinyin: "shí", audio: "整体认读声调/shi2.mp3" },
    { char: "是", pinyin: "shì", audio: "整体认读声调/shi4.mp3" }, { char: "事", pinyin: "shì", audio: "整体认读声调/shi4.mp3" },
  ] },
  { id: "ri", symbol: "ri", label: "ri", audio: "整体认读音节/ri.mp3", examples: [
    { char: "日", pinyin: "rì", audio: "整体认读声调/ri4.mp3" }, { char: "热", pinyin: "rè", audio: "复韵母声调/er4.mp3" },
  ] },
  { id: "zi", symbol: "zi", label: "zi", audio: "整体认读音节/zi.mp3", examples: [
    { char: "字", pinyin: "zì", audio: "整体认读声调/zi4.mp3" }, { char: "子", pinyin: "zǐ", audio: "整体认读声调/zi3.mp3" },
    { char: "自", pinyin: "zì", audio: "整体认读声调/zi4.mp3" }, { char: "紫", pinyin: "zǐ", audio: "整体认读声调/zi3.mp3" },
  ] },
  { id: "ci", symbol: "ci", label: "ci", audio: "整体认读音节/ci.mp3", examples: [
    { char: "词", pinyin: "cí", audio: "整体认读声调/ci2.mp3" }, { char: "此", pinyin: "cǐ", audio: "整体认读声调/ci3.mp3" },
    { char: "刺", pinyin: "cì", audio: "整体认读声调/ci4.mp3" }, { char: "次", pinyin: "cì", audio: "整体认读声调/ci4.mp3" },
  ] },
  { id: "si", symbol: "si", label: "si", audio: "整体认读音节/si.mp3", examples: [
    { char: "四", pinyin: "sì", audio: "整体认读声调/si4.mp3" }, { char: "丝", pinyin: "sī", audio: "整体认读声调/si1.mp3" },
    { char: "死", pinyin: "sǐ", audio: "整体认读声调/si3.mp3" }, { char: "思", pinyin: "sī", audio: "整体认读声调/si1.mp3" },
  ] },
  { id: "yi", symbol: "yi", label: "yi", audio: "整体认读音节/yi.mp3", examples: [
    { char: "一", pinyin: "yī", audio: "单韵母声调/i1.mp3" }, { char: "医", pinyin: "yī", audio: "单韵母声调/i1.mp3" },
    { char: "以", pinyin: "yǐ", audio: "单韵母声调/i3.mp3" }, { char: "意", pinyin: "yì", audio: "单韵母声调/i4.mp3" },
  ] },
  { id: "wu", symbol: "wu", label: "wu", audio: "整体认读音节/wu.mp3", examples: [
    { char: "五", pinyin: "wǔ", audio: "整体认读声调/wu3.mp3" }, { char: "无", pinyin: "wú", audio: "整体认读声调/wu2.mp3" },
    { char: "物", pinyin: "wù", audio: "整体认读声调/wu4.mp3" }, { char: "屋", pinyin: "wū", audio: "整体认读声调/wu1.mp3" },
  ] },
  { id: "yu", symbol: "yu", label: "yu", audio: "整体认读音节/yu.mp3", examples: [
    { char: "鱼", pinyin: "yú", audio: "整体认读声调/yu2.mp3" }, { char: "雨", pinyin: "yǔ", audio: "整体认读声调/yu3.mp3" },
    { char: "玉", pinyin: "yù", audio: "整体认读声调/yu4.mp3" }, { char: "于", pinyin: "yú", audio: "整体认读声调/yu2.mp3" },
  ] },
  { id: "ye", symbol: "ye", label: "ye", audio: "整体认读音节/ye.mp3", examples: [
    { char: "爷", pinyin: "yé", audio: "整体认读声调/ye2.mp3" }, { char: "叶", pinyin: "yè", audio: "整体认读声调/ye4.mp3" },
    { char: "夜", pinyin: "yè", audio: "整体认读声调/ye4.mp3" }, { char: "也", pinyin: "yě", audio: "整体认读声调/ye3.mp3" },
  ] },
  { id: "yue", symbol: "yue", label: "yue", audio: "整体认读音节/yue.mp3", examples: [
    { char: "月", pinyin: "yuè", audio: "整体认读声调/yue4.mp3" }, { char: "越", pinyin: "yuè", audio: "整体认读声调/yue4.mp3" },
    { char: "约", pinyin: "yuē", audio: "整体认读声调/yue1.mp3" }, { char: "乐", pinyin: "yuè", audio: "整体认读声调/yue4.mp3" },
  ] },
  { id: "yuan", symbol: "yuan", label: "yuan", audio: "整体认读音节/yuan.mp3", examples: [
    { char: "圆", pinyin: "yuán", audio: "整体认读声调/yuan2.mp3" }, { char: "远", pinyin: "yuǎn", audio: "整体认读声调/yuan3.mp3" },
    { char: "院", pinyin: "yuàn", audio: "整体认读声调/yuan4.mp3" }, { char: "员", pinyin: "yuán", audio: "整体认读声调/yuan2.mp3" },
  ] },
  { id: "yin", symbol: "yin", label: "yin", audio: "整体认读音节/yin.mp3", examples: [
    { char: "因", pinyin: "yīn", audio: "整体认读声调/yin1.mp3" }, { char: "音", pinyin: "yīn", audio: "整体认读声调/yin1.mp3" },
    { char: "银", pinyin: "yín", audio: "整体认读声调/yin2.mp3" }, { char: "印", pinyin: "yìn", audio: "整体认读声调/yin4.mp3" },
  ] },
  { id: "yun", symbol: "yun", label: "yun", audio: "整体认读音节/yun.mp3", examples: [
    { char: "云", pinyin: "yún", audio: "整体认读声调/yun2.mp3" }, { char: "运", pinyin: "yùn", audio: "整体认读声调/yun4.mp3" },
    { char: "晕", pinyin: "yūn", audio: "整体认读声调/yun1.mp3" }, { char: "韵", pinyin: "yùn", audio: "整体认读声调/yun4.mp3" },
  ] },
  { id: "ying", symbol: "ying", label: "ying", audio: "整体认读音节/ying.mp3", examples: [
    { char: "英", pinyin: "yīng", audio: "整体认读声调/ying1.mp3" }, { char: "应", pinyin: "yīng", audio: "整体认读声调/ying1.mp3" },
    { char: "影", pinyin: "yǐng", audio: "整体认读声调/ying3.mp3" }, { char: "硬", pinyin: "yìng", audio: "整体认读声调/ying4.mp3" },
  ] },
]

/** 类别中文名 */
export const PINYIN_CATEGORY_NAMES: Record<PinyinCategory, string> = {
  shengmu: "声母",
  yunmu: "韵母",
  zhengti: "整体认读音节",
}

/** 展平所有拼音项（用于详情页横向滑动） */
export function getAllPinyinItems(): { category: PinyinCategory; item: PinyinItem }[] {
  const list: { category: PinyinCategory; item: PinyinItem }[] = []
  for (const it of SHENGMU) list.push({ category: "shengmu", item: it })
  for (const it of YUNMU) if (!(it as { skip?: boolean }).skip) list.push({ category: "yunmu", item: it })
  for (const it of ZHENGTI) list.push({ category: "zhengti", item: it })
  return list
}
