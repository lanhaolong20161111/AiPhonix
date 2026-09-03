/** 换偏旁识字 · 字族数据 — 声旁管读音，形旁管意思（手工核对的常用字族） */

export interface RadicalItem {
  /** 完整字 */
  char: string
  pinyin: string
  /** 形旁（偏旁符号） */
  radical: string
  /** 偏旁名称 */
  radicalName: string
  /** 形旁含义提示 */
  radicalMeaning: string
  /** 示例词（须包含 char） */
  word: string
  /** 读音例外标注（读音和声旁差远时提示） */
  exception?: string
}

export interface RadicalFamily {
  /** 声旁基础字 */
  base: string
  pinyin: string
  items: RadicalItem[]
}

export const RADICAL_FAMILIES: RadicalFamily[] = [
  {
    base: "青",
    pinyin: "qīng",
    items: [
      { char: "清", pinyin: "qīng", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "清水" },
      { char: "情", pinyin: "qíng", radical: "忄", radicalName: "竖心旁", radicalMeaning: "和心情有关", word: "心情" },
      { char: "晴", pinyin: "qíng", radical: "日", radicalName: "日字旁", radicalMeaning: "和太阳有关", word: "晴天" },
      { char: "请", pinyin: "qǐng", radical: "讠", radicalName: "言字旁", radicalMeaning: "和说话有关", word: "请客" },
      { char: "睛", pinyin: "jīng", radical: "目", radicalName: "目字旁", radicalMeaning: "和眼睛有关", word: "眼睛", exception: "读音变成 jīng，是例外，要单独记" },
    ],
  },
  {
    base: "包",
    pinyin: "bāo",
    items: [
      { char: "抱", pinyin: "bào", radical: "扌", radicalName: "提手旁", radicalMeaning: "和手有关", word: "拥抱" },
      { char: "饱", pinyin: "bǎo", radical: "饣", radicalName: "食字旁", radicalMeaning: "和吃饭有关", word: "吃饱" },
      { char: "泡", pinyin: "pào", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "水泡" },
      { char: "炮", pinyin: "pào", radical: "火", radicalName: "火字旁", radicalMeaning: "和火有关", word: "火炮" },
      { char: "跑", pinyin: "pǎo", radical: "足", radicalName: "足字旁", radicalMeaning: "和脚有关", word: "跑步" },
    ],
  },
  {
    base: "苗",
    pinyin: "miáo",
    items: [
      { char: "描", pinyin: "miáo", radical: "扌", radicalName: "提手旁", radicalMeaning: "和手有关", word: "描画" },
      { char: "猫", pinyin: "māo", radical: "犭", radicalName: "反犬旁", radicalMeaning: "和动物有关", word: "小猫", exception: "读音变成 māo，是例外，要单独记" },
      { char: "瞄", pinyin: "miáo", radical: "目", radicalName: "目字旁", radicalMeaning: "和眼睛有关", word: "瞄准" },
      { char: "庙", pinyin: "miào", radical: "广", radicalName: "广字头", radicalMeaning: "和房屋有关（偏旁在上）", word: "庙宇", exception: "读音变成 miào，是例外" },
    ],
  },
  {
    base: "马",
    pinyin: "mǎ",
    items: [
      { char: "妈", pinyin: "mā", radical: "女", radicalName: "女字旁", radicalMeaning: "和女性有关", word: "妈妈" },
      { char: "吗", pinyin: "ma", radical: "口", radicalName: "口字旁", radicalMeaning: "和说话语气有关", word: "好吗" },
      { char: "蚂", pinyin: "mǎ", radical: "虫", radicalName: "虫字旁", radicalMeaning: "和昆虫有关", word: "蚂蚁" },
    ],
  },
  {
    base: "巴",
    pinyin: "bā",
    items: [
      { char: "吧", pinyin: "ba", radical: "口", radicalName: "口字旁", radicalMeaning: "和说话语气有关", word: "好吧" },
      { char: "把", pinyin: "bǎ", radical: "扌", radicalName: "提手旁", radicalMeaning: "和手有关", word: "把手" },
      { char: "爸", pinyin: "bà", radical: "父", radicalName: "父字头", radicalMeaning: "和父亲有关（偏旁在上）", word: "爸爸" },
      { char: "芭", pinyin: "bā", radical: "艹", radicalName: "草字头", radicalMeaning: "和植物有关", word: "芭蕾" },
    ],
  },
  {
    base: "方",
    pinyin: "fāng",
    items: [
      { char: "房", pinyin: "fáng", radical: "户", radicalName: "户字头", radicalMeaning: "和房屋有关（偏旁在上）", word: "房子" },
      { char: "访", pinyin: "fǎng", radical: "讠", radicalName: "言字旁", radicalMeaning: "和说话有关", word: "访问" },
      { char: "芳", pinyin: "fāng", radical: "艹", radicalName: "草字头", radicalMeaning: "和植物有关", word: "芳草" },
      { char: "放", pinyin: "fàng", radical: "攵", radicalName: "反文旁", radicalMeaning: "常表示动作", word: "放学" },
    ],
  },
  {
    base: "生",
    pinyin: "shēng",
    items: [
      { char: "星", pinyin: "xīng", radical: "日", radicalName: "日字旁", radicalMeaning: "和太阳天空有关", word: "星星", exception: "读音变成 xīng，是例外，要单独记" },
      { char: "性", pinyin: "xìng", radical: "忄", radicalName: "竖心旁", radicalMeaning: "和心情本性有关", word: "性格" },
      { char: "姓", pinyin: "xìng", radical: "女", radicalName: "女字旁", radicalMeaning: "和女性有关", word: "姓名" },
    ],
  },
  {
    base: "白",
    pinyin: "bái",
    items: [
      { char: "拍", pinyin: "pāi", radical: "扌", radicalName: "提手旁", radicalMeaning: "和手有关", word: "拍手" },
      { char: "怕", pinyin: "pà", radical: "忄", radicalName: "竖心旁", radicalMeaning: "和心情有关", word: "害怕" },
      { char: "泊", pinyin: "bó", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "停泊", exception: "读音变成 bó，是例外" },
      { char: "柏", pinyin: "bǎi", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "柏树" },
    ],
  },
  {
    base: "羊",
    pinyin: "yáng",
    items: [
      { char: "洋", pinyin: "yáng", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "海洋" },
      { char: "样", pinyin: "yàng", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "样子" },
      { char: "痒", pinyin: "yǎng", radical: "疒", radicalName: "病字旁", radicalMeaning: "和疾病有关", word: "挠痒" },
    ],
  },
  {
    base: "也",
    pinyin: "yě",
    items: [
      { char: "他", pinyin: "tā", radical: "亻", radicalName: "单人旁", radicalMeaning: "和人有关", word: "他们" },
      { char: "她", pinyin: "tā", radical: "女", radicalName: "女字旁", radicalMeaning: "和女性有关", word: "她们" },
      { char: "池", pinyin: "chí", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "池塘" },
      { char: "地", pinyin: "dì", radical: "土", radicalName: "提土旁", radicalMeaning: "和土地有关", word: "土地", exception: "读音变成 dì，和「也」差很远，是例外，要单独记" },
    ],
  },
  {
    base: "米",
    pinyin: "mǐ",
    items: [
      { char: "迷", pinyin: "mí", radical: "辶", radicalName: "走之底", radicalMeaning: "和行走有关（偏旁包在下面）", word: "迷路" },
      { char: "眯", pinyin: "mī", radical: "目", radicalName: "目字旁", radicalMeaning: "和眼睛有关", word: "眯眼" },
      { char: "咪", pinyin: "mī", radical: "口", radicalName: "口字旁", radicalMeaning: "和说话有关", word: "猫咪" },
      { char: "谜", pinyin: "mí", radical: "讠", radicalName: "言字旁", radicalMeaning: "和说话有关", word: "谜语" },
    ],
  },
  {
    base: "分",
    pinyin: "fēn",
    items: [
      { char: "份", pinyin: "fèn", radical: "亻", radicalName: "单人旁", radicalMeaning: "和人有关", word: "一份" },
      { char: "粉", pinyin: "fěn", radical: "米", radicalName: "米字旁", radicalMeaning: "和米粮有关", word: "粉色" },
      { char: "芬", pinyin: "fēn", radical: "艹", radicalName: "草字头", radicalMeaning: "和植物有关", word: "芬芳" },
      { char: "纷", pinyin: "fēn", radical: "纟", radicalName: "绞丝旁", radicalMeaning: "和丝线有关", word: "纷飞" },
    ],
  },
  {
    base: "果",
    pinyin: "guǒ",
    items: [
      { char: "课", pinyin: "kè", radical: "讠", radicalName: "言字旁", radicalMeaning: "和说话有关", word: "上课" },
      { char: "棵", pinyin: "kē", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "一棵树" },
      { char: "颗", pinyin: "kē", radical: "页", radicalName: "页字旁", radicalMeaning: "和头部有关", word: "一颗糖" },
    ],
  },
  {
    base: "圭",
    pinyin: "guī",
    items: [
      { char: "娃", pinyin: "wá", radical: "女", radicalName: "女字旁", radicalMeaning: "和女性有关", word: "娃娃" },
      { char: "蛙", pinyin: "wā", radical: "虫", radicalName: "虫字旁", radicalMeaning: "和动物有关", word: "青蛙", exception: "读音变成 wā，是例外" },
      { char: "洼", pinyin: "wā", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "水洼", exception: "读音变成 wā，是例外" },
      { char: "挂", pinyin: "guà", radical: "扌", radicalName: "提手旁", radicalMeaning: "和手有关", word: "挂衣服" },
      { char: "桂", pinyin: "guì", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "桂花" },
    ],
  },
  {
    base: "元",
    pinyin: "yuán",
    items: [
      { char: "远", pinyin: "yuǎn", radical: "辶", radicalName: "走之底", radicalMeaning: "和行走有关", word: "远方" },
      { char: "园", pinyin: "yuán", radical: "囗", radicalName: "围字框", radicalMeaning: "和围起来的地方有关", word: "花园" },
      { char: "玩", pinyin: "wán", radical: "王", radicalName: "王字旁", radicalMeaning: "和玉有关", word: "玩耍", exception: "读音变成 wán，是例外" },
      { char: "完", pinyin: "wán", radical: "宀", radicalName: "宝盖头", radicalMeaning: "和房屋有关", word: "完成", exception: "读音变成 wán，是例外" },
      { char: "院", pinyin: "yuàn", radical: "阝", radicalName: "双耳旁", radicalMeaning: "和地方有关", word: "院子" },
    ],
  },
  {
    base: "相",
    pinyin: "xiāng",
    items: [
      { char: "想", pinyin: "xiǎng", radical: "心", radicalName: "心字底", radicalMeaning: "和思考有关（偏旁在下）", word: "想法" },
      { char: "箱", pinyin: "xiāng", radical: "竹", radicalName: "竹字头", radicalMeaning: "和竹子有关（偏旁在上）", word: "箱子" },
      { char: "霜", pinyin: "shuāng", radical: "雨", radicalName: "雨字头", radicalMeaning: "和天气有关（偏旁在上）", word: "霜降", exception: "读音变成 shuāng，是例外" },
    ],
  },
  {
    base: "里",
    pinyin: "lǐ",
    items: [
      { char: "理", pinyin: "lǐ", radical: "王", radicalName: "王字旁", radicalMeaning: "和玉有关", word: "道理" },
      { char: "鲤", pinyin: "lǐ", radical: "鱼", radicalName: "鱼字旁", radicalMeaning: "和鱼有关", word: "鲤鱼" },
      { char: "狸", pinyin: "lí", radical: "犭", radicalName: "反犬旁", radicalMeaning: "和动物有关", word: "狐狸", exception: "读音变成 lí，是例外" },
      { char: "埋", pinyin: "mái", radical: "土", radicalName: "提土旁", radicalMeaning: "和土地有关", word: "埋进土里", exception: "读音变成 mái，是例外" },
    ],
  },
  {
    base: "丁",
    pinyin: "dīng",
    items: [
      { char: "灯", pinyin: "dēng", radical: "火", radicalName: "火字旁", radicalMeaning: "和火有关", word: "台灯", exception: "读音变成 dēng，是例外" },
      { char: "钉", pinyin: "dīng", radical: "钅", radicalName: "金字旁", radicalMeaning: "和金属有关", word: "钉子" },
      { char: "订", pinyin: "dìng", radical: "讠", radicalName: "言字旁", radicalMeaning: "和说话有关", word: "订正", exception: "读音变成 dìng，是例外" },
      { char: "盯", pinyin: "dīng", radical: "目", radicalName: "目字旁", radicalMeaning: "和眼睛有关", word: "盯着" },
      { char: "顶", pinyin: "dǐng", radical: "页", radicalName: "页字旁", radicalMeaning: "和头部有关", word: "山顶", exception: "读音变成 dǐng，是例外" },
    ],
  },
  {
    base: "工",
    pinyin: "gōng",
    items: [
      { char: "江", pinyin: "jiāng", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "长江" },
      { char: "红", pinyin: "hóng", radical: "纟", radicalName: "绞丝旁", radicalMeaning: "和丝线有关", word: "红色" },
      { char: "空", pinyin: "kōng", radical: "穴", radicalName: "穴宝盖", radicalMeaning: "和孔洞有关", word: "天空", exception: "读音变成 kōng，是例外" },
      { char: "功", pinyin: "gōng", radical: "力", radicalName: "力字旁", radicalMeaning: "和力气有关", word: "用功" },
      { char: "虹", pinyin: "hóng", radical: "虫", radicalName: "虫字旁", radicalMeaning: "和动物有关", word: "彩虹", exception: "读音变成 hóng，是例外" },
    ],
  },
  {
    base: "干",
    pinyin: "gān",
    items: [
      { char: "赶", pinyin: "gǎn", radical: "走", radicalName: "走字旁", radicalMeaning: "和行走有关", word: "赶路", exception: "读音变成 gǎn，是例外" },
      { char: "汗", pinyin: "hàn", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "流汗" },
      { char: "杆", pinyin: "gān", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "旗杆" },
      { char: "肝", pinyin: "gān", radical: "月", radicalName: "月字旁", radicalMeaning: "和身体有关", word: "肝脏" },
      { char: "旱", pinyin: "hàn", radical: "日", radicalName: "日字旁", radicalMeaning: "和太阳天气有关", word: "干旱", exception: "读音变成 hàn，是例外" },
    ],
  },
  {
    base: "各",
    pinyin: "gè",
    items: [
      { char: "客", pinyin: "kè", radical: "宀", radicalName: "宝盖头", radicalMeaning: "和房屋有关", word: "客人" },
      { char: "格", pinyin: "gé", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "格子" },
      { char: "路", pinyin: "lù", radical: "足", radicalName: "足字旁", radicalMeaning: "和脚有关", word: "马路", exception: "读音变成 lù，是例外" },
      { char: "骆", pinyin: "luò", radical: "马", radicalName: "马字旁", radicalMeaning: "和马有关", word: "骆驼", exception: "读音变成 luò，是例外" },
    ],
  },
  {
    base: "皮",
    pinyin: "pí",
    items: [
      { char: "波", pinyin: "bō", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "波浪", exception: "读音变成 bō，是例外" },
      { char: "坡", pinyin: "pō", radical: "土", radicalName: "提土旁", radicalMeaning: "和土地有关", word: "山坡", exception: "读音变成 pō，是例外" },
      { char: "破", pinyin: "pò", radical: "石", radicalName: "石字旁", radicalMeaning: "和石头有关", word: "破坏", exception: "读音变成 pò，是例外" },
      { char: "披", pinyin: "pī", radical: "扌", radicalName: "提手旁", radicalMeaning: "和手有关", word: "披上" },
      { char: "疲", pinyin: "pí", radical: "疒", radicalName: "病字旁", radicalMeaning: "和疾病有关", word: "疲劳" },
    ],
  },
  {
    base: "采",
    pinyin: "cǎi",
    items: [
      { char: "彩", pinyin: "cǎi", radical: "彡", radicalName: "三撇", radicalMeaning: "和颜色花纹有关", word: "彩虹" },
      { char: "菜", pinyin: "cài", radical: "艹", radicalName: "草字头", radicalMeaning: "和植物有关", word: "青菜" },
      { char: "踩", pinyin: "cǎi", radical: "足", radicalName: "足字旁", radicalMeaning: "和脚有关", word: "踩水" },
    ],
  },
  {
    base: "奇",
    pinyin: "qí",
    items: [
      { char: "骑", pinyin: "qí", radical: "马", radicalName: "马字旁", radicalMeaning: "和马有关", word: "骑车" },
      { char: "椅", pinyin: "yǐ", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "椅子", exception: "读音变成 yǐ，是例外" },
      { char: "寄", pinyin: "jì", radical: "宀", radicalName: "宝盖头", radicalMeaning: "和房屋有关", word: "寄信", exception: "读音变成 jì，是例外" },
    ],
  },
  {
    base: "直",
    pinyin: "zhí",
    items: [
      { char: "值", pinyin: "zhí", radical: "亻", radicalName: "单人旁", radicalMeaning: "和人有关", word: "值日" },
      { char: "植", pinyin: "zhí", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "植树" },
      { char: "置", pinyin: "zhì", radical: "罒", radicalName: "四字头", radicalMeaning: "和网有关（偏旁在上）", word: "安置", exception: "读音变成 zhì，是例外" },
    ],
  },
  {
    base: "平",
    pinyin: "píng",
    items: [
      { char: "评", pinyin: "píng", radical: "讠", radicalName: "言字旁", radicalMeaning: "和说话有关", word: "评价" },
      { char: "苹", pinyin: "píng", radical: "艹", radicalName: "草字头", radicalMeaning: "和植物有关", word: "苹果" },
      { char: "坪", pinyin: "píng", radical: "土", radicalName: "提土旁", radicalMeaning: "和土地有关", word: "草坪" },
    ],
  },
  {
    base: "京",
    pinyin: "jīng",
    items: [
      { char: "惊", pinyin: "jīng", radical: "忄", radicalName: "竖心旁", radicalMeaning: "和心情有关", word: "吃惊" },
      { char: "凉", pinyin: "liáng", radical: "冫", radicalName: "两点水", radicalMeaning: "和冰寒冷有关", word: "凉水", exception: "读音变成 liáng，是例外" },
      { char: "谅", pinyin: "liàng", radical: "讠", radicalName: "言字旁", radicalMeaning: "和说话有关", word: "原谅", exception: "读音变成 liàng，是例外" },
      { char: "景", pinyin: "jǐng", radical: "日", radicalName: "日字旁", radicalMeaning: "和太阳有关", word: "风景", exception: "读音变成 jǐng，是例外" },
    ],
  },
  {
    base: "古",
    pinyin: "gǔ",
    items: [
      { char: "故", pinyin: "gù", radical: "攵", radicalName: "反文旁", radicalMeaning: "常表示动作", word: "故事" },
      { char: "姑", pinyin: "gū", radical: "女", radicalName: "女字旁", radicalMeaning: "和女性有关", word: "姑娘" },
      { char: "苦", pinyin: "kǔ", radical: "艹", radicalName: "草字头", radicalMeaning: "和植物有关", word: "吃苦", exception: "读音变成 kǔ，是例外" },
      { char: "固", pinyin: "gù", radical: "囗", radicalName: "围字框", radicalMeaning: "和围起来的地方有关", word: "坚固" },
    ],
  },
  {
    base: "中",
    pinyin: "zhōng",
    items: [
      { char: "种", pinyin: "zhòng", radical: "禾", radicalName: "禾字旁", radicalMeaning: "和庄稼有关", word: "种树" },
      { char: "钟", pinyin: "zhōng", radical: "钅", radicalName: "金字旁", radicalMeaning: "和金属有关", word: "时钟" },
      { char: "忠", pinyin: "zhōng", radical: "心", radicalName: "心字底", radicalMeaning: "和心情有关（偏旁在下）", word: "忠心" },
      { char: "冲", pinyin: "chōng", radical: "冫", radicalName: "两点水", radicalMeaning: "和冰寒冷有关", word: "冲水", exception: "读音变成 chōng，是例外" },
    ],
  },
  {
    base: "门",
    pinyin: "mén",
    items: [
      { char: "们", pinyin: "men", radical: "亻", radicalName: "单人旁", radicalMeaning: "和人有关", word: "我们" },
      { char: "闷", pinyin: "mēn", radical: "心", radicalName: "心字底", radicalMeaning: "和心情有关（偏旁在下）", word: "闷热", exception: "读音变成 mēn，是例外" },
      { char: "问", pinyin: "wèn", radical: "口", radicalName: "口字旁", radicalMeaning: "和说话有关", word: "问题", exception: "读音变成 wèn，是例外" },
      { char: "间", pinyin: "jiān", radical: "日", radicalName: "日字旁", radicalMeaning: "和太阳有关", word: "中间", exception: "读音变成 jiān，是例外" },
    ],
  },
  {
    base: "乍",
    pinyin: "zhà",
    items: [
      { char: "作", pinyin: "zuò", radical: "亻", radicalName: "单人旁", radicalMeaning: "和人有关", word: "作业" },
      { char: "昨", pinyin: "zuó", radical: "日", radicalName: "日字旁", radicalMeaning: "和时间有关", word: "昨天", exception: "读音变成 zuó，是例外" },
      { char: "炸", pinyin: "zhà", radical: "火", radicalName: "火字旁", radicalMeaning: "和火有关", word: "炸鸡" },
    ],
  },
  {
    base: "台",
    pinyin: "tái",
    items: [
      { char: "抬", pinyin: "tái", radical: "扌", radicalName: "提手旁", radicalMeaning: "和手有关", word: "抬头" },
      { char: "苔", pinyin: "tái", radical: "艹", radicalName: "草字头", radicalMeaning: "和植物有关", word: "苔藓" },
      { char: "治", pinyin: "zhì", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "治病", exception: "读音变成 zhì，是例外" },
      { char: "始", pinyin: "shǐ", radical: "女", radicalName: "女字旁", radicalMeaning: "和女性有关", word: "开始", exception: "读音变成 shǐ，是例外" },
    ],
  },
  {
    base: "同",
    pinyin: "tóng",
    items: [
      { char: "桐", pinyin: "tóng", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "梧桐" },
      { char: "铜", pinyin: "tóng", radical: "钅", radicalName: "金字旁", radicalMeaning: "和金属有关", word: "铜钱" },
      { char: "筒", pinyin: "tǒng", radical: "竹", radicalName: "竹字头", radicalMeaning: "和竹子有关", word: "竹筒", exception: "读音变成 tǒng，是例外" },
      { char: "洞", pinyin: "dòng", radical: "氵", radicalName: "三点水", radicalMeaning: "和水有关", word: "山洞", exception: "读音变成 dòng，是例外" },
    ],
  },
  {
    base: "艮",
    pinyin: "gèn",
    items: [
      { char: "跟", pinyin: "gēn", radical: "足", radicalName: "足字旁", radicalMeaning: "和脚有关", word: "跟随" },
      { char: "根", pinyin: "gēn", radical: "木", radicalName: "木字旁", radicalMeaning: "和树木有关", word: "树根" },
      { char: "恨", pinyin: "hèn", radical: "忄", radicalName: "竖心旁", radicalMeaning: "和心情有关", word: "痛恨", exception: "读音变成 hèn，是例外" },
      { char: "眼", pinyin: "yǎn", radical: "目", radicalName: "目字旁", radicalMeaning: "和眼睛有关", word: "眼睛", exception: "读音变成 yǎn，是例外" },
    ],
  },
]
