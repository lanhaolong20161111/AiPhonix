/** 小学必背古诗库（部编版小学语文 1~6 年级 + 传统必背 75 首扩充，共 108 首）
 *  供 /llm/zh-poem-search 标题/作者搜索：孩子在「AI 和你对话学语文」输入诗题（或作者）即可一键填入原文。
 *  text 为练习用原文（含标点，一句一行），不收录教材节选以外的长诗全文（如《长歌行》全篇收录，《古朗月行》只收节选段并标注）。
 */

export interface PrimaryPoem {
  title: string
  dynasty: string
  author: string
  text: string
}

export const PRIMARY_POEMS: PrimaryPoem[] = [
  // ── 汉魏六朝 ──
  { title: "江南", dynasty: "汉", author: "汉乐府", text: "江南可采莲，莲叶何田田。\n鱼戏莲叶间。鱼戏莲叶东，鱼戏莲叶西，鱼戏莲叶南，鱼戏莲叶北。" },
  { title: "长歌行", dynasty: "汉", author: "汉乐府", text: "青青园中葵，朝露待日晞。\n阳春布德泽，万物生光辉。\n常恐秋节至，焜黄华叶衰。\n百川东到海，何时复西归？\n少壮不努力，老大徒伤悲。" },
  { title: "七步诗", dynasty: "三国", author: "曹植", text: "煮豆持作羹，漉菽以为汁。\n萁在釜下燃，豆在釜中泣。\n本自同根生，相煎何太急？" },
  { title: "敕勒歌", dynasty: "南北朝", author: "北朝民歌", text: "敕勒川，阴山下。\n天似穹庐，笼盖四野。\n天苍苍，野茫茫，风吹草低见牛羊。" },
  // ── 唐 ──
  { title: "咏鹅", dynasty: "唐", author: "骆宾王", text: "鹅，鹅，鹅，曲项向天歌。\n白毛浮绿水，红掌拨清波。" },
  { title: "风", dynasty: "唐", author: "李峤", text: "解落三秋叶，能开二月花。\n过江千尺浪，入竹万竿斜。" },
  { title: "咏柳", dynasty: "唐", author: "贺知章", text: "碧玉妆成一树高，万条垂下绿丝绦。\n不知细叶谁裁出，二月春风似剪刀。" },
  { title: "回乡偶书", dynasty: "唐", author: "贺知章", text: "少小离家老大回，乡音无改鬓毛衰。\n儿童相见不相识，笑问客从何处来。" },
  { title: "凉州词", dynasty: "唐", author: "王之涣", text: "黄河远上白云间，一片孤城万仞山。\n羌笛何须怨杨柳，春风不度玉门关。" },
  { title: "登鹳雀楼", dynasty: "唐", author: "王之涣", text: "白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。" },
  { title: "春晓", dynasty: "唐", author: "孟浩然", text: "春眠不觉晓，处处闻啼鸟。\n夜来风雨声，花落知多少。" },
  { title: "宿建德江", dynasty: "唐", author: "孟浩然", text: "移舟泊烟渚，日暮客愁新。\n野旷天低树，江清月近人。" },
  { title: "凉州词（葡萄美酒）", dynasty: "唐", author: "王翰", text: "葡萄美酒夜光杯，欲饮琵琶马上催。\n醉卧沙场君莫笑，古来征战几人回。" },
  { title: "出塞", dynasty: "唐", author: "王昌龄", text: "秦时明月汉时关，万里长征人未还。\n但使龙城飞将在，不教胡马度阴山。" },
  { title: "从军行", dynasty: "唐", author: "王昌龄", text: "青海长云暗雪山，孤城遥望玉门关。\n黄沙百战穿金甲，不破楼兰终不还。" },
  { title: "芙蓉楼送辛渐", dynasty: "唐", author: "王昌龄", text: "寒雨连江夜入吴，平明送客楚山孤。\n洛阳亲友如相问，一片冰心在玉壶。" },
  { title: "鹿柴", dynasty: "唐", author: "王维", text: "空山不见人，但闻人语响。\n返景入深林，复照青苔上。" },
  { title: "竹里馆", dynasty: "唐", author: "王维", text: "独坐幽篁里，弹琴复长啸。\n深林人不知，明月来相照。" },
  { title: "鸟鸣涧", dynasty: "唐", author: "王维", text: "人闲桂花落，夜静春山空。\n月出惊山鸟，时鸣春涧中。" },
  { title: "送元二使安西", dynasty: "唐", author: "王维", text: "渭城朝雨浥轻尘，客舍青青柳色新。\n劝君更尽一杯酒，西出阳关无故人。" },
  { title: "九月九日忆山东兄弟", dynasty: "唐", author: "王维", text: "独在异乡为异客，每逢佳节倍思亲。\n遥知兄弟登高处，遍插茱萸少一人。" },
  { title: "静夜思", dynasty: "唐", author: "李白", text: "床前明月光，疑是地上霜。\n举头望明月，低头思故乡。" },
  { title: "古朗月行（节选）", dynasty: "唐", author: "李白", text: "小时不识月，呼作白玉盘。\n又疑瑶台镜，飞在青云端。" },
  { title: "望庐山瀑布", dynasty: "唐", author: "李白", text: "日照香炉生紫烟，遥看瀑布挂前川。\n飞流直下三千尺，疑是银河落九天。" },
  { title: "赠汪伦", dynasty: "唐", author: "李白", text: "李白乘舟将欲行，忽闻岸上踏歌声。\n桃花潭水深千尺，不及汪伦送我情。" },
  { title: "黄鹤楼送孟浩然之广陵", dynasty: "唐", author: "李白", text: "故人西辞黄鹤楼，烟花三月下扬州。\n孤帆远影碧空尽，唯见长江天际流。" },
  { title: "早发白帝城", dynasty: "唐", author: "李白", text: "朝辞白帝彩云间，千里江陵一日还。\n两岸猿声啼不住，轻舟已过万重山。" },
  { title: "望天门山", dynasty: "唐", author: "李白", text: "天门中断楚江开，碧水东流至此回。\n两岸青山相对出，孤帆一片日边来。" },
  { title: "独坐敬亭山", dynasty: "唐", author: "李白", text: "众鸟高飞尽，孤云独去闲。\n相看两不厌，只有敬亭山。" },
  { title: "峨眉山月歌", dynasty: "唐", author: "李白", text: "峨眉山月半轮秋，影入平羌江水流。\n夜发清溪向三峡，思君不见下渝州。" },
  { title: "别董大", dynasty: "唐", author: "高适", text: "千里黄云白日曛，北风吹雁雪纷纷。\n莫愁前路无知己，天下谁人不识君。" },
  { title: "绝句（两个黄鹂）", dynasty: "唐", author: "杜甫", text: "两个黄鹂鸣翠柳，一行白鹭上青天。\n窗含西岭千秋雪，门泊东吴万里船。" },
  { title: "绝句（迟日江山）", dynasty: "唐", author: "杜甫", text: "迟日江山丽，春风花草香。\n泥融飞燕子，沙暖睡鸳鸯。" },
  { title: "春夜喜雨", dynasty: "唐", author: "杜甫", text: "好雨知时节，当春乃发生。\n随风潜入夜，润物细无声。\n野径云俱黑，江船火独明。\n晓看红湿处，花重锦官城。" },
  { title: "江畔独步寻花", dynasty: "唐", author: "杜甫", text: "黄四娘家花满蹊，千朵万朵压枝低。\n留连戏蝶时时舞，自在娇莺恰恰啼。" },
  { title: "江南逢李龟年", dynasty: "唐", author: "杜甫", text: "岐王宅里寻常见，崔九堂前几度闻。\n正是江南好风景，落花时节又逢君。" },
  { title: "闻官军收河南河北", dynasty: "唐", author: "杜甫", text: "剑外忽传收蓟北，初闻涕泪满衣裳。\n却看妻子愁何在，漫卷诗书喜欲狂。\n白日放歌须纵酒，青春作伴好还乡。\n即从巴峡穿巫峡，便下襄阳向洛阳。" },
  { title: "枫桥夜泊", dynasty: "唐", author: "张继", text: "月落乌啼霜满天，江枫渔火对愁眠。\n姑苏城外寒山寺，夜半钟声到客船。" },
  { title: "滁州西涧", dynasty: "唐", author: "韦应物", text: "独怜幽草涧边生，上有黄鹂深树鸣。\n春潮带雨晚来急，野渡无人舟自横。" },
  { title: "游子吟", dynasty: "唐", author: "孟郊", text: "慈母手中线，游子身上衣。\n临行密密缝，意恐迟迟归。\n谁言寸草心，报得三春晖。" },
  { title: "早春呈水部张十八员外", dynasty: "唐", author: "韩愈", text: "天街小雨润如酥，草色遥看近却无。\n最是一年春好处，绝胜烟柳满皇都。" },
  { title: "渔歌子", dynasty: "唐", author: "张志和", text: "西塞山前白鹭飞，桃花流水鳜鱼肥。\n青箬笠，绿蓑衣，斜风细雨不须归。" },
  { title: "塞下曲", dynasty: "唐", author: "卢纶", text: "月黑雁飞高，单于夜遁逃。\n欲将轻骑逐，大雪满弓刀。" },
  { title: "望洞庭", dynasty: "唐", author: "刘禹锡", text: "湖光秋月两相和，潭面无风镜未磨。\n遥望洞庭山水翠，白银盘里一青螺。" },
  { title: "浪淘沙", dynasty: "唐", author: "刘禹锡", text: "九曲黄河万里沙，浪淘风簸自天涯。\n如今直上银河去，同到牵牛织女家。" },
  { title: "赋得古原草送别", dynasty: "唐", author: "白居易", text: "离离原上草，一岁一枯荣。\n野火烧不尽，春风吹又生。\n远芳侵古道，晴翠接荒城。\n又送王孙去，萋萋满别情。" },
  { title: "池上", dynasty: "唐", author: "白居易", text: "小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。" },
  { title: "忆江南", dynasty: "唐", author: "白居易", text: "江南好，风景旧曾谙。\n日出江花红胜火，春来江水绿如蓝。能不忆江南？" },
  { title: "小儿垂钓", dynasty: "唐", author: "胡令能", text: "蓬头稚子学垂纶，侧坐莓苔草映身。\n路人借问遥招手，怕得鱼惊不应人。" },
  { title: "悯农（春种一粒粟）", dynasty: "唐", author: "李绅", text: "春种一粒粟，秋收万颗子。\n四海无闲田，农夫犹饿死。" },
  { title: "悯农（锄禾日当午）", dynasty: "唐", author: "李绅", text: "锄禾日当午，汗滴禾下土。\n谁知盘中餐，粒粒皆辛苦。" },
  { title: "江雪", dynasty: "唐", author: "柳宗元", text: "千山鸟飞绝，万径人踪灭。\n孤舟蓑笠翁，独钓寒江雪。" },
  { title: "寻隐者不遇", dynasty: "唐", author: "贾岛", text: "松下问童子，言师采药去。\n只在此山中，云深不知处。" },
  { title: "山行", dynasty: "唐", author: "杜牧", text: "远上寒山石径斜，白云生处有人家。\n停车坐爱枫林晚，霜叶红于二月花。" },
  { title: "清明", dynasty: "唐", author: "杜牧", text: "清明时节雨纷纷，路上行人欲断魂。\n借问酒家何处有？牧童遥指杏花村。" },
  { title: "江南春", dynasty: "唐", author: "杜牧", text: "千里莺啼绿映红，水村山郭酒旗风。\n南朝四百八十寺，多少楼台烟雨中。" },
  { title: "蜂", dynasty: "唐", author: "罗隐", text: "不论平地与山尖，无限风光尽被占。\n采得百花成蜜后，为谁辛苦为谁甜。" },
  // ── 宋 ──
  { title: "江上渔者", dynasty: "宋", author: "范仲淹", text: "江上往来人，但爱鲈鱼美。\n君看一叶舟，出没风波里。" },
  { title: "元日", dynasty: "宋", author: "王安石", text: "爆竹声中一岁除，春风送暖入屠苏。\n千门万户曈曈日，总把新桃换旧符。" },
  { title: "泊船瓜洲", dynasty: "宋", author: "王安石", text: "京口瓜洲一水间，钟山只隔数重山。\n春风又绿江南岸，明月何时照我还。" },
  { title: "书湖阴先生壁", dynasty: "宋", author: "王安石", text: "茅檐长扫净无苔，花木成畦手自栽。\n一水护田将绿绕，两山排闼送青来。" },
  { title: "六月二十七日望湖楼醉书", dynasty: "宋", author: "苏轼", text: "黑云翻墨未遮山，白雨跳珠乱入船。\n卷地风来忽吹散，望湖楼下水如天。" },
  { title: "饮湖上初晴后雨", dynasty: "宋", author: "苏轼", text: "水光潋滟晴方好，山色空蒙雨亦奇。\n欲把西湖比西子，淡妆浓抹总相宜。" },
  { title: "惠崇春江晚景", dynasty: "宋", author: "苏轼", text: "竹外桃花三两枝，春江水暖鸭先知。\n蒌蒿满地芦芽短，正是河豚欲上时。" },
  { title: "题西林壁", dynasty: "宋", author: "苏轼", text: "横看成岭侧成峰，远近高低各不同。\n不识庐山真面目，只缘身在此山中。" },
  { title: "夏日绝句", dynasty: "宋", author: "李清照", text: "生当作人杰，死亦为鬼雄。\n至今思项羽，不肯过江东。" },
  { title: "三衢道中", dynasty: "宋", author: "曾几", text: "梅子黄时日日晴，小溪泛尽却山行。\n绿阴不减来时路，添得黄鹂四五声。" },
  { title: "示儿", dynasty: "宋", author: "陆游", text: "死去元知万事空，但悲不见九州同。\n王师北定中原日，家祭无忘告乃翁。" },
  { title: "秋夜将晓出篱门迎凉有感", dynasty: "宋", author: "陆游", text: "三万里河东入海，五千仞岳上摩天。\n遗民泪尽胡尘里，南望王师又一年。" },
  { title: "四时田园杂兴（昼出耘田）", dynasty: "宋", author: "范成大", text: "昼出耘田夜绩麻，村庄儿女各当家。\n童孙未解供耕织，也傍桑阴学种瓜。" },
  { title: "四时田园杂兴（梅子金黄）", dynasty: "宋", author: "范成大", text: "梅子金黄杏子肥，麦花雪白菜花稀。\n日长篱落无人过，惟有蜻蜓蛱蝶飞。" },
  { title: "小池", dynasty: "宋", author: "杨万里", text: "泉眼无声惜细流，树阴照水爱晴柔。\n小荷才露尖尖角，早有蜻蜓立上头。" },
  { title: "晓出净慈寺送林子方", dynasty: "宋", author: "杨万里", text: "毕竟西湖六月中，风光不与四时同。\n接天莲叶无穷碧，映日荷花别样红。" },
  { title: "稚子弄冰", dynasty: "宋", author: "杨万里", text: "稚子金盆脱晓冰，彩丝穿取当银钲。\n敲成玉磬穿林响，忽作玻璃碎地声。" },
  { title: "舟过安仁", dynasty: "宋", author: "杨万里", text: "一叶渔船两小童，收篙停棹坐船中。\n怪生无雨都张伞，不是遮头是使风。" },
  { title: "春日", dynasty: "宋", author: "朱熹", text: "胜日寻芳泗水滨，无边光景一时新。\n等闲识得东风面，万紫千红总是春。" },
  { title: "观书有感", dynasty: "宋", author: "朱熹", text: "半亩方塘一鉴开，天光云影共徘徊。\n问渠那得清如许？为有源头活水来。" },
  { title: "题临安邸", dynasty: "宋", author: "林升", text: "山外青山楼外楼，西湖歌舞几时休？\n暖风熏得游人醉，直把杭州作汴州。" },
  { title: "游园不值", dynasty: "宋", author: "叶绍翁", text: "应怜屐齿印苍苔，小扣柴扉久不开。\n春色满园关不住，一枝红杏出墙来。" },
  { title: "乡村四月", dynasty: "宋", author: "翁卷", text: "绿遍山原白满川，子规声里雨如烟。\n乡村四月闲人少，才了蚕桑又插田。" },
  { title: "牧童", dynasty: "宋", author: "吕岩", text: "草铺横野六七里，笛弄晚风三四声。\n归来饱饭黄昏后，不脱蓑衣卧月明。" },
  { title: "清平乐·村居", dynasty: "宋", author: "辛弃疾", text: "茅檐低小，溪上青青草。醉里吴音相媚好，白发谁家翁媪？\n大儿锄豆溪东，中儿正织鸡笼。最喜小儿亡赖，溪头卧剥莲蓬。" },
  // ── 元明清 ──
  { title: "墨梅", dynasty: "元", author: "王冕", text: "吾家洗砚池头树，朵朵花开淡墨痕。\n不要人夸好颜色，只留清气满乾坤。" },
  { title: "石灰吟", dynasty: "明", author: "于谦", text: "千锤万凿出深山，烈火焚烧若等闲。\n粉骨碎身浑不怕，要留清白在人间。" },
  { title: "竹石", dynasty: "清", author: "郑燮", text: "咬定青山不放松，立根原在破岩中。\n千磨万击还坚劲，任尔东西南北风。" },
  { title: "所见", dynasty: "清", author: "袁枚", text: "牧童骑黄牛，歌声振林樾。\n意欲捕鸣蝉，忽然闭口立。" },
  { title: "村居", dynasty: "清", author: "高鼎", text: "草长莺飞二月天，拂堤杨柳醉春烟。\n儿童散学归来早，忙趁东风放纸鸢。" },
  { title: "己亥杂诗", dynasty: "清", author: "龚自珍", text: "九州生气恃风雷，万马齐喑究可哀。\n我劝天公重抖擞，不拘一格降人才。" },
  // ── 补录：部编版常考但此前遗漏（2026-09-10 补） ──
  { title: "画", dynasty: "唐", author: "王维", text: "远看山有色，近听水无声。\n春去花还在，人来鸟不惊。" },
  { title: "梅花", dynasty: "宋", author: "王安石", text: "墙角数枝梅，凌寒独自开。\n遥知不是雪，为有暗香来。" },
  { title: "夜宿山寺", dynasty: "唐", author: "李白", text: "危楼高百尺，手可摘星辰。\n不敢高声语，恐惊天上人。" },
  { title: "夜书所见", dynasty: "宋", author: "叶绍翁", text: "萧萧梧叶送寒声，江上秋风动客情。\n知有儿童挑促织，夜深篱落一灯明。" },
  { title: "舟夜书所见", dynasty: "清", author: "查慎行", text: "月黑见渔灯，孤光一点萤。\n微微风簇浪，散作满河星。" },
  { title: "赠刘景文", dynasty: "宋", author: "苏轼", text: "荷尽已无擎雨盖，菊残犹有傲霜枝。\n一年好景君须记，正是橙黄橘绿时。" },
  { title: "采莲曲", dynasty: "唐", author: "王昌龄", text: "荷叶罗裙一色裁，芙蓉向脸两边开。\n乱入池中看不见，闻歌始觉有人来。" },
  { title: "乞巧", dynasty: "唐", author: "林杰", text: "七夕今宵看碧霄，牵牛织女渡河桥。\n家家乞巧望秋月，穿尽红丝几万条。" },
  { title: "嫦娥", dynasty: "唐", author: "李商隐", text: "云母屏风烛影深，长河渐落晓星沉。\n嫦娥应悔偷灵药，碧海青天夜夜心。" },
  { title: "暮江吟", dynasty: "唐", author: "白居易", text: "一道残阳铺水中，半江瑟瑟半江红。\n可怜九月初三夜，露似真珠月似弓。" },
  { title: "雪梅", dynasty: "宋", author: "卢梅坡", text: "梅雪争春未肯降，骚人搁笔费评章。\n梅须逊雪三分白，雪却输梅一段香。" },
  { title: "宿新市徐公店", dynasty: "宋", author: "杨万里", text: "篱落疏疏一径深，树头新绿未成阴。\n儿童急走追黄蝶，飞入菜花无处寻。" },
  { title: "寒食", dynasty: "唐", author: "韩翃", text: "春城无处不飞花，寒食东风御柳斜。\n日暮汉宫传蜡烛，轻烟散入五侯家。" },
  { title: "十五夜望月", dynasty: "唐", author: "王建", text: "中庭地白树栖鸦，冷露无声湿桂花。\n今夜月明人尽望，不知秋思落谁家。" },
  { title: "马诗", dynasty: "唐", author: "李贺", text: "大漠沙如雪，燕山月似钩。\n何当金络脑，快走踏清秋。" },
  { title: "采薇（节选）", dynasty: "先秦", author: "《诗经》", text: "昔我往矣，杨柳依依。\n今我来思，雨雪霏霏。" },
  { title: "山居秋暝", dynasty: "唐", author: "王维", text: "空山新雨后，天气晚来秋。\n明月松间照，清泉石上流。\n竹喧归浣女，莲动下渔舟。\n随意春芳歇，王孙自可留。" },
  { title: "村晚", dynasty: "宋", author: "雷震", text: "草满池塘水满陂，山衔落日浸寒漪。\n牧童归去横牛背，短笛无腔信口吹。" },
  { title: "长相思", dynasty: "清", author: "纳兰性德", text: "山一程，水一程，身向榆关那畔行。夜深千帐灯。\n风一更，雪一更，聒碎乡心梦不成。故园无此声。" },
  { title: "清平乐·春归何处", dynasty: "宋", author: "黄庭坚", text: "春归何处？寂寞无行路。若有人知春去处，唤取归来同住。\n春无踪迹谁知？除非问取黄鹂。百啭无人能解，因风飞过蔷薇。" },
]

/** 归一化：去空白，便于标题模糊匹配 */
export function normalizePoemTitle(s: string): string {
  return s.replace(/\s+/g, "").replace(/[《》〔〕「」]/g, "")
}

/** 按诗题/作者关键词搜索古诗；q 为空返回空数组。
 * 优先级：标题完全相等 > 标题包含 > 作者包含（≥2字）> 首句包含（≥4字）> 全文包含（≥4字）。
 * ⚠️ 反查（首句/全文）要求 key ≥4 字，避免「山行」这类短题命中别的诗正文里恰好出现的同字串
 *    （如《三衢道中》"小溪泛尽却山行"）；同时不再用「query 含标题」的反向匹配，
 *    避免「夜书所见」被拆成「所见」误配（正解应先精确命中《夜书所见》）。 */
export function searchPrimaryPoems(q: string, limit = 8): PrimaryPoem[] {
  const key = normalizePoemTitle(q)
  if (!key) return []
  const scored: { p: PrimaryPoem; score: number }[] = []
  for (const p of PRIMARY_POEMS) {
    const t = normalizePoemTitle(p.title)
    const author = normalizePoemTitle(p.author)
    const first = normalizePoemTitle(p.text.split("\n")[0] ?? "")
    let score = 0
    if (t === key) score = 100
    else if (t.includes(key)) score = 80 - Math.min(t.length - key.length, 30)
    else if (key.length >= 2 && author.includes(key)) score = 70
    else if (key.length >= 4 && first.includes(key)) score = 60
    else if (key.length >= 4 && normalizePoemTitle(p.text).includes(key)) score = 40
    if (score > 0) scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.p)
}
