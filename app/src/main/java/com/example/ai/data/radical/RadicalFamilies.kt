package com.example.ai.data.radical

// 本文件由 scripts/gen_radical_families.mjs 自动生成 —— 勿手改。
// 数据源：web/src/data/radicalFamilies.ts（改数据请改 web 那份后重新生成）

/** 字族里的一个字：形旁（偏旁）管意思，声旁管读音 */
data class RadicalItem(
    val char: String,
    val pinyin: String,
    val radical: String,          // 形旁符号
    val radicalName: String,      // 偏旁名称（如「三点水」）
    val radicalMeaning: String,   // 形旁含义提示（如「和水有关」）
    val word: String,             // 例词（必含 char）
    val exception: String = "", // 读音与声旁差远时的例外说明
)

/** 一个声旁字族（同一声旁 + 不同形旁） */
data class RadicalFamily(
    val base: String,             // 声旁基础字
    val pinyin: String,
    val items: List<RadicalItem>,
)

/** 全部字族（顺序 = web 的 RADICAL_FAMILIES 顺序） */
object RadicalFamilies {
    val ALL: List<RadicalFamily> = listOf(
        RadicalFamily(
            base = "青",
            pinyin = "qīng",
            items = listOf(
                RadicalItem("清", "qīng", "氵", "三点水", "和水有关", "清水"),
                RadicalItem("情", "qíng", "忄", "竖心旁", "和心情有关", "心情"),
                RadicalItem("晴", "qíng", "日", "日字旁", "和太阳有关", "晴天"),
                RadicalItem("请", "qǐng", "讠", "言字旁", "和说话有关", "请客"),
                RadicalItem("睛", "jīng", "目", "目字旁", "和眼睛有关", "眼睛", "读音变成 jīng，是例外，要单独记"),
            ),
        ),
        RadicalFamily(
            base = "包",
            pinyin = "bāo",
            items = listOf(
                RadicalItem("抱", "bào", "扌", "提手旁", "和手有关", "拥抱"),
                RadicalItem("饱", "bǎo", "饣", "食字旁", "和吃饭有关", "吃饱"),
                RadicalItem("泡", "pào", "氵", "三点水", "和水有关", "水泡"),
                RadicalItem("炮", "pào", "火", "火字旁", "和火有关", "火炮"),
                RadicalItem("跑", "pǎo", "足", "足字旁", "和脚有关", "跑步"),
            ),
        ),
        RadicalFamily(
            base = "苗",
            pinyin = "miáo",
            items = listOf(
                RadicalItem("描", "miáo", "扌", "提手旁", "和手有关", "描画"),
                RadicalItem("猫", "māo", "犭", "反犬旁", "和动物有关", "小猫", "读音变成 māo，是例外，要单独记"),
                RadicalItem("瞄", "miáo", "目", "目字旁", "和眼睛有关", "瞄准"),
                RadicalItem("庙", "miào", "广", "广字头", "和房屋有关（偏旁在上）", "庙宇", "读音变成 miào，是例外"),
            ),
        ),
        RadicalFamily(
            base = "马",
            pinyin = "mǎ",
            items = listOf(
                RadicalItem("妈", "mā", "女", "女字旁", "和女性有关", "妈妈"),
                RadicalItem("吗", "ma", "口", "口字旁", "和说话语气有关", "好吗"),
                RadicalItem("蚂", "mǎ", "虫", "虫字旁", "和昆虫有关", "蚂蚁"),
            ),
        ),
        RadicalFamily(
            base = "巴",
            pinyin = "bā",
            items = listOf(
                RadicalItem("吧", "ba", "口", "口字旁", "和说话语气有关", "好吧"),
                RadicalItem("把", "bǎ", "扌", "提手旁", "和手有关", "把手"),
                RadicalItem("爸", "bà", "父", "父字头", "和父亲有关（偏旁在上）", "爸爸"),
                RadicalItem("芭", "bā", "艹", "草字头", "和植物有关", "芭蕾"),
            ),
        ),
        RadicalFamily(
            base = "方",
            pinyin = "fāng",
            items = listOf(
                RadicalItem("房", "fáng", "户", "户字头", "和房屋有关（偏旁在上）", "房子"),
                RadicalItem("访", "fǎng", "讠", "言字旁", "和说话有关", "访问"),
                RadicalItem("芳", "fāng", "艹", "草字头", "和植物有关", "芳草"),
                RadicalItem("放", "fàng", "攵", "反文旁", "常表示动作", "放学"),
            ),
        ),
        RadicalFamily(
            base = "生",
            pinyin = "shēng",
            items = listOf(
                RadicalItem("星", "xīng", "日", "日字旁", "和太阳天空有关", "星星", "读音变成 xīng，是例外，要单独记"),
                RadicalItem("性", "xìng", "忄", "竖心旁", "和心情本性有关", "性格"),
                RadicalItem("姓", "xìng", "女", "女字旁", "和女性有关", "姓名"),
            ),
        ),
        RadicalFamily(
            base = "白",
            pinyin = "bái",
            items = listOf(
                RadicalItem("拍", "pāi", "扌", "提手旁", "和手有关", "拍手"),
                RadicalItem("怕", "pà", "忄", "竖心旁", "和心情有关", "害怕"),
                RadicalItem("泊", "bó", "氵", "三点水", "和水有关", "停泊", "读音变成 bó，是例外"),
                RadicalItem("柏", "bǎi", "木", "木字旁", "和树木有关", "柏树"),
            ),
        ),
        RadicalFamily(
            base = "羊",
            pinyin = "yáng",
            items = listOf(
                RadicalItem("洋", "yáng", "氵", "三点水", "和水有关", "海洋"),
                RadicalItem("样", "yàng", "木", "木字旁", "和树木有关", "样子"),
                RadicalItem("痒", "yǎng", "疒", "病字旁", "和疾病有关", "挠痒"),
            ),
        ),
        RadicalFamily(
            base = "也",
            pinyin = "yě",
            items = listOf(
                RadicalItem("他", "tā", "亻", "单人旁", "和人有关", "他们"),
                RadicalItem("她", "tā", "女", "女字旁", "和女性有关", "她们"),
                RadicalItem("池", "chí", "氵", "三点水", "和水有关", "池塘"),
                RadicalItem("地", "dì", "土", "提土旁", "和土地有关", "土地", "读音变成 dì，和「也」差很远，是例外，要单独记"),
            ),
        ),
        RadicalFamily(
            base = "米",
            pinyin = "mǐ",
            items = listOf(
                RadicalItem("迷", "mí", "辶", "走之底", "和行走有关（偏旁包在下面）", "迷路"),
                RadicalItem("眯", "mī", "目", "目字旁", "和眼睛有关", "眯眼"),
                RadicalItem("咪", "mī", "口", "口字旁", "和说话有关", "猫咪"),
                RadicalItem("谜", "mí", "讠", "言字旁", "和说话有关", "谜语"),
            ),
        ),
        RadicalFamily(
            base = "分",
            pinyin = "fēn",
            items = listOf(
                RadicalItem("份", "fèn", "亻", "单人旁", "和人有关", "一份"),
                RadicalItem("粉", "fěn", "米", "米字旁", "和米粮有关", "粉色"),
                RadicalItem("芬", "fēn", "艹", "草字头", "和植物有关", "芬芳"),
                RadicalItem("纷", "fēn", "纟", "绞丝旁", "和丝线有关", "纷飞"),
            ),
        ),
        RadicalFamily(
            base = "果",
            pinyin = "guǒ",
            items = listOf(
                RadicalItem("课", "kè", "讠", "言字旁", "和说话有关", "上课"),
                RadicalItem("棵", "kē", "木", "木字旁", "和树木有关", "一棵树"),
                RadicalItem("颗", "kē", "页", "页字旁", "和头部有关", "一颗糖"),
            ),
        ),
        RadicalFamily(
            base = "圭",
            pinyin = "guī",
            items = listOf(
                RadicalItem("娃", "wá", "女", "女字旁", "和女性有关", "娃娃"),
                RadicalItem("蛙", "wā", "虫", "虫字旁", "和动物有关", "青蛙", "读音变成 wā，是例外"),
                RadicalItem("洼", "wā", "氵", "三点水", "和水有关", "水洼", "读音变成 wā，是例外"),
                RadicalItem("挂", "guà", "扌", "提手旁", "和手有关", "挂衣服"),
                RadicalItem("桂", "guì", "木", "木字旁", "和树木有关", "桂花"),
            ),
        ),
        RadicalFamily(
            base = "元",
            pinyin = "yuán",
            items = listOf(
                RadicalItem("远", "yuǎn", "辶", "走之底", "和行走有关", "远方"),
                RadicalItem("园", "yuán", "囗", "围字框", "和围起来的地方有关", "花园"),
                RadicalItem("玩", "wán", "王", "王字旁", "和玉有关", "玩耍", "读音变成 wán，是例外"),
                RadicalItem("完", "wán", "宀", "宝盖头", "和房屋有关", "完成", "读音变成 wán，是例外"),
                RadicalItem("院", "yuàn", "阝", "双耳旁", "和地方有关", "院子"),
            ),
        ),
        RadicalFamily(
            base = "相",
            pinyin = "xiāng",
            items = listOf(
                RadicalItem("想", "xiǎng", "心", "心字底", "和思考有关（偏旁在下）", "想法"),
                RadicalItem("箱", "xiāng", "竹", "竹字头", "和竹子有关（偏旁在上）", "箱子"),
                RadicalItem("霜", "shuāng", "雨", "雨字头", "和天气有关（偏旁在上）", "霜降", "读音变成 shuāng，是例外"),
            ),
        ),
        RadicalFamily(
            base = "里",
            pinyin = "lǐ",
            items = listOf(
                RadicalItem("理", "lǐ", "王", "王字旁", "和玉有关", "道理"),
                RadicalItem("鲤", "lǐ", "鱼", "鱼字旁", "和鱼有关", "鲤鱼"),
                RadicalItem("狸", "lí", "犭", "反犬旁", "和动物有关", "狐狸", "读音变成 lí，是例外"),
                RadicalItem("埋", "mái", "土", "提土旁", "和土地有关", "埋进土里", "读音变成 mái，是例外"),
            ),
        ),
        RadicalFamily(
            base = "丁",
            pinyin = "dīng",
            items = listOf(
                RadicalItem("灯", "dēng", "火", "火字旁", "和火有关", "台灯", "读音变成 dēng，是例外"),
                RadicalItem("钉", "dīng", "钅", "金字旁", "和金属有关", "钉子"),
                RadicalItem("订", "dìng", "讠", "言字旁", "和说话有关", "订正", "读音变成 dìng，是例外"),
                RadicalItem("盯", "dīng", "目", "目字旁", "和眼睛有关", "盯着"),
                RadicalItem("顶", "dǐng", "页", "页字旁", "和头部有关", "山顶", "读音变成 dǐng，是例外"),
            ),
        ),
        RadicalFamily(
            base = "工",
            pinyin = "gōng",
            items = listOf(
                RadicalItem("江", "jiāng", "氵", "三点水", "和水有关", "长江"),
                RadicalItem("红", "hóng", "纟", "绞丝旁", "和丝线有关", "红色"),
                RadicalItem("空", "kōng", "穴", "穴宝盖", "和孔洞有关", "天空", "读音变成 kōng，是例外"),
                RadicalItem("功", "gōng", "力", "力字旁", "和力气有关", "用功"),
                RadicalItem("虹", "hóng", "虫", "虫字旁", "和动物有关", "彩虹", "读音变成 hóng，是例外"),
            ),
        ),
        RadicalFamily(
            base = "干",
            pinyin = "gān",
            items = listOf(
                RadicalItem("赶", "gǎn", "走", "走字旁", "和行走有关", "赶路", "读音变成 gǎn，是例外"),
                RadicalItem("汗", "hàn", "氵", "三点水", "和水有关", "流汗"),
                RadicalItem("杆", "gān", "木", "木字旁", "和树木有关", "旗杆"),
                RadicalItem("肝", "gān", "月", "月字旁", "和身体有关", "肝脏"),
                RadicalItem("旱", "hàn", "日", "日字旁", "和太阳天气有关", "干旱", "读音变成 hàn，是例外"),
            ),
        ),
        RadicalFamily(
            base = "各",
            pinyin = "gè",
            items = listOf(
                RadicalItem("客", "kè", "宀", "宝盖头", "和房屋有关", "客人"),
                RadicalItem("格", "gé", "木", "木字旁", "和树木有关", "格子"),
                RadicalItem("路", "lù", "足", "足字旁", "和脚有关", "马路", "读音变成 lù，是例外"),
                RadicalItem("骆", "luò", "马", "马字旁", "和马有关", "骆驼", "读音变成 luò，是例外"),
            ),
        ),
        RadicalFamily(
            base = "皮",
            pinyin = "pí",
            items = listOf(
                RadicalItem("波", "bō", "氵", "三点水", "和水有关", "波浪", "读音变成 bō，是例外"),
                RadicalItem("坡", "pō", "土", "提土旁", "和土地有关", "山坡", "读音变成 pō，是例外"),
                RadicalItem("破", "pò", "石", "石字旁", "和石头有关", "破坏", "读音变成 pò，是例外"),
                RadicalItem("披", "pī", "扌", "提手旁", "和手有关", "披上"),
                RadicalItem("疲", "pí", "疒", "病字旁", "和疾病有关", "疲劳"),
            ),
        ),
        RadicalFamily(
            base = "采",
            pinyin = "cǎi",
            items = listOf(
                RadicalItem("彩", "cǎi", "彡", "三撇", "和颜色花纹有关", "彩虹"),
                RadicalItem("菜", "cài", "艹", "草字头", "和植物有关", "青菜"),
                RadicalItem("踩", "cǎi", "足", "足字旁", "和脚有关", "踩水"),
            ),
        ),
        RadicalFamily(
            base = "奇",
            pinyin = "qí",
            items = listOf(
                RadicalItem("骑", "qí", "马", "马字旁", "和马有关", "骑车"),
                RadicalItem("椅", "yǐ", "木", "木字旁", "和树木有关", "椅子", "读音变成 yǐ，是例外"),
                RadicalItem("寄", "jì", "宀", "宝盖头", "和房屋有关", "寄信", "读音变成 jì，是例外"),
            ),
        ),
        RadicalFamily(
            base = "直",
            pinyin = "zhí",
            items = listOf(
                RadicalItem("值", "zhí", "亻", "单人旁", "和人有关", "值日"),
                RadicalItem("植", "zhí", "木", "木字旁", "和树木有关", "植树"),
                RadicalItem("置", "zhì", "罒", "四字头", "和网有关（偏旁在上）", "安置", "读音变成 zhì，是例外"),
            ),
        ),
        RadicalFamily(
            base = "平",
            pinyin = "píng",
            items = listOf(
                RadicalItem("评", "píng", "讠", "言字旁", "和说话有关", "评价"),
                RadicalItem("苹", "píng", "艹", "草字头", "和植物有关", "苹果"),
                RadicalItem("坪", "píng", "土", "提土旁", "和土地有关", "草坪"),
            ),
        ),
        RadicalFamily(
            base = "京",
            pinyin = "jīng",
            items = listOf(
                RadicalItem("惊", "jīng", "忄", "竖心旁", "和心情有关", "吃惊"),
                RadicalItem("凉", "liáng", "冫", "两点水", "和冰寒冷有关", "凉水", "读音变成 liáng，是例外"),
                RadicalItem("谅", "liàng", "讠", "言字旁", "和说话有关", "原谅", "读音变成 liàng，是例外"),
                RadicalItem("景", "jǐng", "日", "日字旁", "和太阳有关", "风景", "读音变成 jǐng，是例外"),
            ),
        ),
        RadicalFamily(
            base = "古",
            pinyin = "gǔ",
            items = listOf(
                RadicalItem("故", "gù", "攵", "反文旁", "常表示动作", "故事"),
                RadicalItem("姑", "gū", "女", "女字旁", "和女性有关", "姑娘"),
                RadicalItem("苦", "kǔ", "艹", "草字头", "和植物有关", "吃苦", "读音变成 kǔ，是例外"),
                RadicalItem("固", "gù", "囗", "围字框", "和围起来的地方有关", "坚固"),
            ),
        ),
        RadicalFamily(
            base = "中",
            pinyin = "zhōng",
            items = listOf(
                RadicalItem("种", "zhòng", "禾", "禾字旁", "和庄稼有关", "种树"),
                RadicalItem("钟", "zhōng", "钅", "金字旁", "和金属有关", "时钟"),
                RadicalItem("忠", "zhōng", "心", "心字底", "和心情有关（偏旁在下）", "忠心"),
                RadicalItem("冲", "chōng", "冫", "两点水", "和冰寒冷有关", "冲水", "读音变成 chōng，是例外"),
            ),
        ),
        RadicalFamily(
            base = "门",
            pinyin = "mén",
            items = listOf(
                RadicalItem("们", "men", "亻", "单人旁", "和人有关", "我们"),
                RadicalItem("闷", "mēn", "心", "心字底", "和心情有关（偏旁在下）", "闷热", "读音变成 mēn，是例外"),
                RadicalItem("问", "wèn", "口", "口字旁", "和说话有关", "问题", "读音变成 wèn，是例外"),
                RadicalItem("间", "jiān", "日", "日字旁", "和太阳有关", "中间", "读音变成 jiān，是例外"),
            ),
        ),
        RadicalFamily(
            base = "乍",
            pinyin = "zhà",
            items = listOf(
                RadicalItem("作", "zuò", "亻", "单人旁", "和人有关", "作业"),
                RadicalItem("昨", "zuó", "日", "日字旁", "和时间有关", "昨天", "读音变成 zuó，是例外"),
                RadicalItem("炸", "zhà", "火", "火字旁", "和火有关", "炸鸡"),
            ),
        ),
        RadicalFamily(
            base = "台",
            pinyin = "tái",
            items = listOf(
                RadicalItem("抬", "tái", "扌", "提手旁", "和手有关", "抬头"),
                RadicalItem("苔", "tái", "艹", "草字头", "和植物有关", "苔藓"),
                RadicalItem("治", "zhì", "氵", "三点水", "和水有关", "治病", "读音变成 zhì，是例外"),
                RadicalItem("始", "shǐ", "女", "女字旁", "和女性有关", "开始", "读音变成 shǐ，是例外"),
            ),
        ),
        RadicalFamily(
            base = "同",
            pinyin = "tóng",
            items = listOf(
                RadicalItem("桐", "tóng", "木", "木字旁", "和树木有关", "梧桐"),
                RadicalItem("铜", "tóng", "钅", "金字旁", "和金属有关", "铜钱"),
                RadicalItem("筒", "tǒng", "竹", "竹字头", "和竹子有关", "竹筒", "读音变成 tǒng，是例外"),
                RadicalItem("洞", "dòng", "氵", "三点水", "和水有关", "山洞", "读音变成 dòng，是例外"),
            ),
        ),
        RadicalFamily(
            base = "艮",
            pinyin = "gèn",
            items = listOf(
                RadicalItem("跟", "gēn", "足", "足字旁", "和脚有关", "跟随"),
                RadicalItem("根", "gēn", "木", "木字旁", "和树木有关", "树根"),
                RadicalItem("恨", "hèn", "忄", "竖心旁", "和心情有关", "痛恨", "读音变成 hèn，是例外"),
                RadicalItem("眼", "yǎn", "目", "目字旁", "和眼睛有关", "眼睛", "读音变成 yǎn，是例外"),
            ),
        ),
    )

    /** 全部字（去重前 = 各字族 items 之和） */
    val ALL_CHARS: List<String> = ALL.flatMap { f -> f.items.map { it.char } }

    /** 全部偏旁（去重） */
    val ALL_RADICALS: List<String> = ALL.flatMap { f -> f.items.map { it.radical } }.distinct()
}
