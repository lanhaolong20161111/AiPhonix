"""比较豆包的多音字列表与现有 polyphone_chars.json 的差异"""
import json
import re

# 豆包的多音字列表（从粘贴文本解析）
raw_text = r"""
与 yǔ  与其  与共
与 yù  参与  与会

且 qiě  而且  况且
且 jū  且兰  且月

丧 sàng  丧失  丧气
丧 sāng  丧事  丧礼

个 gè  个体  个别
个 gě  自个儿  个辈

中 zhōng  中间  中心
中 zhòng  中奖  中毒

为 wéi  为人  成为
为 wèi  因为  为了

丽 lì  美丽  华丽
丽 lí  高丽  丽水

么 me  什么  怎么
么 yāo  幺么  么小丑

乌 wū  乌鸦  乌云
乌 wù  乌拉  乌草

乐 lè  快乐  欢乐
乐 yuè  音乐  乐器

乘 chéng  乘车  乘法
乘 shèng  千乘  史乘

了 le  好了  走了
了 liǎo  了解  了结

亡 wáng  死亡  灭亡
亡 wú  亡赖  亡何

亲 qīn  亲人  亲切
亲 qìng  亲家  亲家母

什 shén  什么  没什么
什 shí  什锦  家什

仅 jǐn  不仅  仅仅
仅 jìn  仅卒  仅见

从 cóng  从前  跟从
从 zòng  从弟  从父

仔 zǐ  仔细  仔密
仔 zǎi  牛仔  打工仔

令 lìng  命令  口令
令 líng  令狐  令丘

任 rèn  任务  任何
任 rén  任县  任丘

会 huì  开会  会议
会 kuài  会计  财会

传 chuán  传说  传达
传 zhuàn  传记  自传

伯 bó  伯父  伯伯
伯 bǎi  大伯子  伯婆

似 sì  似乎  相似
似 shì  似的

体 tǐ  身体  体育
体 tī  体己  体己钱

佛 fó  佛像  佛教
佛 fú  仿佛  佛戾

作 zuò  工作  作业
作 zuō  作坊  作房

供 gōng  供应  提供
供 gòng  供词  供品

侧 cè  侧面  左侧
侧 zhāi  侧歪  侧棱

便 biàn  方便  便利
便 pián  便宜  大腹便便

信 xìn  相信  信用
信 shēn  信臣  信士

俩 liǎ  咱俩  俩人
俩 liǎng  伎俩  鬼蜮伎俩

倒 dǎo  倒下  摔倒
倒 dào  倒车  倒影

假 jiǎ  真假  假装
假 jià  放假  假期

傍 bàng  傍晚  依傍
傍 páng  傍通  傍午

六 liù  六个  六月
六 lù  六安  六合

共 gòng  共同  总共
共 gōng  共恭  共张

兴 xīng  兴奋  兴起
兴 xìng  高兴  兴趣

其 qí  其中  其实
其 jī  郦食其

内 nèi  内部  内外
内 nà  内纳  内交

冒 mào  冒险  感冒
冒 mò  冒顿

冲 chōng  冲动  冲击
冲 chòng  冲床  冲劲儿

凉 liáng  凉快  清凉
凉 liàng  凉一凉  凉晒

几 jǐ  几个  几何
几 jī  几乎  茶几

分 fēn  分开  分数
分 fèn  分外  成分

切 qiē  切菜  切开
切 qiè  一切  亲切

划 huá  划船  划算
划 huà  计划  划分

创 chuàng  创造  创新
创 chuāng  创伤  创口

别 bié  分别  别人
别 biè  别扭  别嘴

刷 shuā  刷牙  刷子
刷 shuà  刷白  刷利

刺 cì  刺激  刺猬
刺 cī  刺溜  刺啦

劲 jìn  使劲  干劲
劲 jìng  强劲  刚劲

勾 gōu  勾画  勾结
勾 gòu  勾当  勾当

化 huà  变化  文化
化 huā  化钱  化斋

匙 chí  汤匙  茶匙
匙 shi  钥匙

区 qū  地区  区别
区 ōu  姓区  区盖

华 huá  中华  华丽
华 huà  华山  华佗

单 dān  单位  简单
单 shàn  姓单  单县
单 chán  单于

南 nán  南方  南北
南 nā  南无

占 zhàn  占领  占用
占 zhān  占卜  占卦

卡 kǎ  卡片  卡车
卡 qiǎ  卡住  关卡

卷 juǎn  卷起  卷纸
卷 juàn  试卷  卷宗

厂 chǎng  工厂  厂房
厂 ān  庵厂  厂屋

压 yā  压力  压迫
压 yà  压根儿  压板

厦 shà  大厦  广厦
厦 xià  厦门

参 cān  参加  参观
参 shēn  人参  海参
参 cēn  参差

发 fā  发现  出发
发 fà  头发  毛发

句 jù  句子  语句
句 gōu  句践  句芒

只 zhī  一只  只身
只 zhǐ  只有  只是

召 zhào  召开  号召
召 shào  召陵  姓召

可 kě  可以  可能
可 kè  可汗

台 tái  台灯  平台
台 tāi  台州  天台

叶 yè  树叶  叶子
叶 xié  叶韵  叶和

号 hào  号码  记号
号 háo  号叫  哀号

合 hé  合作  合并
合 gě  合升  合勺

同 tóng  同学  相同
同 tòng  胡同

吐 tǔ  吞吐  吐痰
吐 tù  呕吐  吐血

吓 xià  吓人  吓唬
吓 hè  恐吓  威吓

吗 ma  好吗  是吗
吗 má  干吗
吗 mǎ  吗啡

吧 ba  好吧  走吧
吧 bā  酒吧  吧台

含 hán  包含  含义
含 hàn  含敛  含饭

吵 chǎo  吵架  吵闹
吵 chāo  吵吵

呀 ya  好呀  走呀
呀 yā  哎呀  咿呀

呆 dāi  发呆  呆板
呆 ái  呆痴  呆傻

员 yuán  员工  队员
员 yún  伍员
员 yùn  姓员

呢 ne  你呢  好呢
呢 ní  呢喃  呢绒

和 hé  和平  温和
和 hè  附和  唱和
和 huó  和面  和泥
和 huò  和药  和弄
和 hú  和牌

咱 zán  咱们  咱家
咱 zá  咱家

咽 yān  咽喉  咽头
咽 yàn  吞咽  咽下
咽 yè  呜咽  哽咽

哇 wā  哇哇叫  哇啦
哇 wa  好哇  走哇

哈 hā  哈哈  哈欠
哈 hǎ  哈达  哈巴
哈 hà  哈什蚂

哗 huá  喧哗  哗笑
哗 huā  哗啦  哗哗

哦 ó  哦，我懂了
哦 ò  哦，原来是这样
哦 é  吟哦

哩 lī  哩哩啦啦
哩 li  好哩  行哩

哪 nǎ  哪里  哪个
哪 na  加油哪
哪 né  哪吒

唉 āi  唉声叹气
唉 ài  唉，真可惜

啊 ā  啊，真美
啊 á  啊，你说什么
啊 ǎ  啊，怎么会
啊 à  啊，好吧
啊 a  好啊  走啊

啦 la  好啦  走啦
啦 lā  哗啦  啦啦队

喂 wèi  喂饭  喂养
喂 wéi  喂，你好

喇 lǎ  喇叭  喇嘛
喇 lá  哈喇子
喇 là  喇喇

喝 hē  喝水  喝茶
喝 hè  喝彩  喝令
喝 yè  喝嘶

喷 pēn  喷水  喷泉
喷 pèn  喷香  喷红

嘛 ma  干嘛  好嘛
嘛 má  喇嘛

嚼 jiáo  嚼碎  嚼东西
嚼 jué  咀嚼  嚼用
嚼 jiào  倒嚼

圈 quān  圆圈  圈住
圈 juàn  羊圈  猪圈
圈 juān  圈起来  圈禁

地 dì  土地  地方
地 de  慢慢地  轻轻地

场 chǎng  场地  广场
场 cháng  场院  打场

坊 fāng  牌坊  街坊
坊 fáng  作坊  磨坊

壳 ké  贝壳  外壳
壳 qiào  地壳  甲壳

处 chù  到处  处所
处 chǔ  处理  相处

夏 xià  夏天  夏季
夏 jiǎ  夏楚  夏革

大 dà  大小  大家
大 dài  大夫  大王
大 tài  大夫（古）

夫 fū  夫人  丈夫
夫 fú  夫天地者  夫战

头 tóu  头发  头脑
头 tou  石头  木头

夹 jiā  夹子  夹杂
夹 jiá  夹袄  夹被
夹 gā  夹肢窝

奇 qí  奇怪  奇妙
奇 jī  奇数  奇偶

奔 bēn  奔跑  奔波
奔 bèn  投奔  奔头

女 nǚ  女孩  女生
女 rǔ  女红  女家

好 hǎo  好人  美好
好 hào  爱好  好奇

委 wěi  委员  委托
委 wēi  委蛇

婆 pó  外婆  婆婆
婆 pǒ  婆裟

子 zǐ  子女  子孙
子 zi  桌子  椅子

宁 níng  安宁  宁静
宁 nìng  宁可  宁愿

家 jiā  家人  家庭
家 jia  老人家
家 jie  整天家

宿 sù  住宿  宿舍
宿 xiǔ  一宿  两宿
宿 xiù  星宿  二十八宿

射 shè  射击  发射
射 yè  仆射
射 yì  射干

将 jiāng  将来  将要
将 jiàng  将领  大将
将 qiāng  将进酒

少 shǎo  多少  减少
少 shào  少年  少女

尺 chǐ  尺子  尺寸
尺 chě  工尺

尽 jìn  尽头  尽力
尽 jǐn  尽管  尽量

尾 wěi  尾巴  末尾
尾 yǐ  马尾儿  三尾儿

居 jū  居住  居民
居 jī  居奇  居积

岭 lǐng  山岭  岭南
岭 líng  岭巆

差 chà  差不多  差得远
差 chā  差别  差异
差 chāi  出差  差遣
差 cī  参差

巷 xiàng  小巷  巷子
巷 hàng  巷道

帚 zhǒu  扫帚  帚柄
帚 zhòu  帚星

席 xí  主席  席子
席 yí  席席

幅 fú  幅度  一幅画
幅 fù  幅裂  幅员

干 gān  干净  干枯
干 gàn  干活  干部

并 bìng  并且  合并
并 bīng  并州

广 guǎng  广大  广阔
广 ān  广同庵

应 yīng  应该  应当
应 yìng  答应  反应

底 dǐ  底部  底下
底 de  怎底

度 dù  温度  角度
度 duó  揣度  度德量力

弄 nòng  玩弄  摆弄
弄 lòng  弄堂  里弄

张 zhāng  张开  纸张
张 zhàng  张弓  张热

弹 dàn  子弹  炸弹
弹 tán  弹琴  弹跳

强 qiáng  强大  坚强
强 qiǎng  勉强  强迫
强 jiàng  倔强  强嘴

当 dāng  当时  当中
当 dàng  上当  恰当

待 dài  等待  招待
待 dāi  待一会儿  待着

得 dé  得到  获得
得 de  跑得快  做得好
得 děi  得亏  总得

怜 lián  可怜  怜惜
怜 líng  怜悧

思 sī  思想  思考
思 sāi  于思

悄 qiāo  悄悄  悄悄话
悄 qiǎo  悄然  悄声

戏 xì  游戏  戏剧
戏 hū  於戏

扁 biǎn  扁担  扁平
扁 piān  扁舟

扇 shàn  扇子  电扇
扇 shān  扇风  扇动

扎 zhā  扎针  扎营
扎 zhá  挣扎
扎 zā  扎辫子  扎裤脚

打 dǎ  打球  打击
打 dá  一打铅笔

扛 káng  扛枪  扛活
扛 gāng  扛鼎  扛抬

扫 sǎo  扫地  打扫
扫 sào  扫帚  扫把

扬 yáng  飘扬  飞扬
扬 yàng  扬汤止沸

把 bǎ  把握  把手
把 bà  刀把  话把儿

折 zhé  折断  打折
折 shé  折本  枝折花落
折 zhē  折腾  折跟头

抢 qiǎng  抢夺  争抢
抢 qiāng  抢呼欲绝
抢 chēng  抢攘

抹 mǒ  涂抹  抹杀
抹 mò  抹墙  抹不开
抹 mā  抹桌子  抹脸

拂 fú  吹拂  拂过
拂 bì  拂士  拂同弼

担 dān  担心  担当
担 dàn  重担  担子

拉 lā  拉手  拉车
拉 lá  拉口子  拉破
拉 lǎ  拉呱
拉 là  拉下  拉后腿

拌 bàn  搅拌  凉拌
拌 pàn  拌舍

招 zhāo  招手  招待
招 qiáo  招摇

拥 yōng  拥有  拥抱
拥 yǒng  拥塞

括 kuò  包括  概括
括 guā  挺括

拾 shí  拾起  收拾
拾 shè  拾级而上

接 jiē  接待  连接
接 jié  接物

提 tí  提高  提问
提 dī  提防  提溜
提 dǐ  投掷

搭 dā  搭车  搭桥
搭 da  勾搭

摩 mó  摩擦  按摩
摩 mā  摩平
摩 mò  摩厉

撑 chēng  支撑  撑伞
撑 zhǎng  撑涨

撒 sā  撒手  撒网
撒 sǎ  撒种  撒播

支 zhī  支持  分支
支 zhì  支支

教 jiào  教师  教育
教 jiāo  教书  教课

散 sàn  散步  散开
散 sǎn  散文  松散

数 shù  数学  数字
数 shǔ  数数  数落
数 shuò  数见不鲜

斗 dòu  战斗  斗争
斗 dǒu  北斗  漏斗

旁 páng  旁边  身旁
旁 bàng  旁午  旁通

旋 xuán  旋转  盘旋
旋 xuàn  旋风  旋子

术 shù  技术  美术
术 zhú  苍术  白术
术 shú  术秫

杆 gān  旗杆  杆子
杆 gǎn  笔杆  枪杆

杉 shān  水杉  杉树
杉 shā  杉木  杉篙

杠 gàng  杠铃  单杠
杠 gāng  杠房  杠夫

条 tiáo  条件  面条
条 tiāo  挑同条

来 lái  来到  未来
来 lài  劳来

板 bǎn  木板  黑板
板 pàn  板岸

架 jià  架子  书架
架 jiā  架住

柏 bǎi  柏树  松柏
柏 bó  柏林
柏 bò  黄柏

柜 guì  柜子  衣柜
柜 jǔ  柜柳

查 chá  检查  调查
查 zhā  姓查  查山

柴 chái  柴火  木柴
柴 zhài  柴篱  柴路

栖 qī  栖息  栖身
栖 xī  栖栖

校 xiào  学校  校园
校 jiào  校对  校订

格 gé  格子  格式
格 gē  格格

桐 tóng  梧桐  桐树
桐 tōng  桐桐

桦 huà  白桦  桦树
桦 huá  桦桦

椅 yǐ  椅子  桌椅
椅 yī  山桐子  椅桐

模 mó  模型  模仿
模 mú  模样  模具

正 zhèng  正确  正常
正 zhēng  正月

母 mǔ  母亲  母爱
母 wú  母氏

毒 dú  毒药  病毒
毒 dài  毒冒

毛 máo  毛发  羽毛
毛 má  毛躁

氏 shì  姓氏  氏族
氏 zhī  月氏  阏氏

汗 hàn  汗水  出汗
汗 hán  可汗

汤 tāng  米汤  汤药
汤 shāng  汤汤
汤 tàng  汤热

沙 shā  沙子  沙滩
沙 shà  沙一沙

没 méi  没有  没事
没 mò  淹没  沉没

沾 zhān  沾水  沾湿
沾 tiē  沾同贴

沿 yán  沿着  沿海
沿 yàn  沿边

泊 bó  停泊  漂泊
泊 pō  湖泊  血泊

泛 fàn  广泛  泛滥
泛 fá  泛同乏

泡 pào  水泡  泡泡
泡 pāo  眼泡  泡桐

泥 ní  泥土  泥巴
泥 nì  拘泥  泥古

泽 zé  光泽  沼泽
泽 shì  泽泽

洒 sǎ  洒水  洒落
洒 xǐ  洒同洗

洗 xǐ  洗手  清洗
洗 xiǎn  姓洗

洞 dòng  山洞  洞口
洞 tóng  洪洞

派 pài  派别  气派
派 pā  派司

浅 qiǎn  深浅  浅滩
浅 jiān  浅浅

浑 hún  浑浊  浑身
浑 hùn  浑同混

浪 làng  波浪  海浪
浪 láng  浪浪

浸 jìn  浸泡  沉浸
浸 qīn  浸渐

涌 yǒng  涌现  涌动
涌 chōng  涌同冲

涨 zhǎng  上涨  涨价
涨 zhàng  涨红  头昏脑涨

淋 lín  淋雨  淋湿
淋 lìn  淋盐  淋病

淡 dàn  淡水  冷淡
淡 tán  淡淡

渐 jiàn  渐渐  逐渐
渐 jiān  渐染  渐洳

渠 qú  水渠  渠道
渠 jù  渠渠

渴 kě  口渴  渴望
渴 hé  渴同涸

湿 shī  潮湿  湿润
湿 qì  湿湿

溜 liū  溜走  溜冰
溜 liù  一溜烟  水溜

滑 huá  光滑  滑动
滑 gǔ  滑乱

漂 piāo  漂流  漂浮
漂 piǎo  漂白  漂洗
漂 piào  漂亮

漏 lòu  漏水  漏雨
漏 lú  漏同庐

瀑 pù  瀑布
瀑 bào  瀑河

炮 pào  大炮  炮火
炮 páo  炮制  炮烙
炮 bāo  炮羊肉  炮干

炸 zhà  爆炸  炸弹
炸 zhá  炸油条  炸酱

熟 shú  熟悉  成熟
熟 shóu  熟了  熟透

熬 áo  熬夜  熬粥
熬 āo  熬菜  熬豆腐

燕 yàn  燕子  海燕
燕 yān  燕山  燕国

爪 zhǎo  爪牙  鹰爪
爪 zhuǎ  爪子  鸡爪

父 fù  父亲  父母
父 fǔ  渔父  田父

片 piàn  卡片  片段
片 piān  片子  相片儿

瓦 wǎ  瓦片  砖瓦
瓦 wà  瓦刀  瓦瓦

甚 shèn  甚至  甚好
甚 shén  甚么

疑 yí  怀疑  疑问
疑 nǐ  疑同拟

的 de  我的  好的
的 dí  的确 的当
的 dì  目的  标的
的 dī  的打的士

盖 gài  盖子  覆盖
盖 gě  姓盖

盛 shèng  盛开  盛大
盛 chéng  盛饭  盛水

相 xiāng  相信  互相
相 xiàng  相片  真相

省 shěng  省份  节省
省 xǐng  反省  省亲

看 kàn  看见  看书
看 kān  看守  看门

眯 mī  眯眼  眯着
眯 mí  眯乱  眯蒙

着 zhe  看着  走着
着 zhuó  穿着  着陆
着 zháo  着急  着火
着 zhāo  着数  高着

知 zhī  知道  知识
知 zhì  知同智

石 shí  石头  石子
石 dàn  一石米

研 yán  研究  钻研
研 yàn  研墨  研钵

碌 lù  忙碌  庸碌
碌 liù  碌碡

磨 mó  磨刀  折磨
磨 mò  磨坊  磨盘

票 piào  车票  电影票
票 piāo  票同飘

祭 jì  祭奠  祭祀
祭 zhài  姓祭

禁 jìn  禁止  禁令
禁 jīn  禁受  情不自禁

种 zhǒng  种子  种类
种 zhòng  种地  种树
种 chóng  姓种

秘 mì  秘密  神秘
秘 bì  秘鲁

称 chēng  称呼  称赞
称 chèn  称心  对称
称 chèng  秤同称

空 kōng  空气  天空
空 kòng  空地  空闲
空 kǒng  空同孔

竿 gān  竹竿  竿子
竿 gǎn  竿同杆

笼 lóng  笼子  鸟笼
笼 lǒng  笼罩  笼统

筑 zhù  建筑  修筑
筑 zhú  贵阳简称筑

答 dá  回答  答案
答 dā  答应  答理

箕 jī  簸箕  箕斗
箕 qí  箕子

粘 zhān  粘贴  粘连
粘 nián  粘稠  粘液

粥 zhōu  喝粥  稀粥
粥 yù  粥粥

糊 hú  糊涂  糊墙
糊 hù  糊弄  面糊
糊 hū  糊泥  糊上

系 xì  关系  系统
系 jì  系鞋带  系扣子

累 lèi  劳累  累人
累 lěi  积累  连累
累 léi  累赘  果实累累

繁 fán  繁华  繁忙
繁 pó  繁同婆

红 hóng  红色  红花
红 gōng  女红

约 yuē  大约  约定
约 yāo  约重量  约一约

纪 jì  纪念  纪律
纪 jǐ  姓纪

纹 wén  花纹  纹理
纹 wèn  纹同璺

织 zhī  纺织  织布
织 zhì  织同帜

经 jīng  经过  经常
经 jìng  经纱

结 jié  结束  打结
结 jiē  结实  结巴

绕 rào  围绕  绕路
绕 rǎo  绕同扰

给 gěi  送给  给你
给 jǐ  供给  给予

绿 lǜ  绿色  绿叶
绿 lù  绿林  鸭绿江

缝 féng  缝补  缝纫
缝 fèng  缝隙  裂缝

罢 bà  罢工  罢免
罢 ba  吃罢饭
罢 pí  罢同疲

羊 yáng  山羊  羊毛
羊 xiáng  羊同祥

肚 dù  肚子  肚皮
肚 dǔ  猪肚  羊肚

背 bèi  后背  背书
背 bēi  背包  背负

胖 pàng  肥胖  胖子
胖 pán  心宽体胖
胖 pàn  胖肆

胜 shèng  胜利  名胜
胜 shēng  胜同升

胳 gē  胳膊  胳臂
胳 gé  胳肢窝

能 néng  能力  能够
能 nài  能同耐

脚 jiǎo  脚步  山脚
脚 jué  脚同角

腊 là  腊月  腊肉
腊 xī  腊干  腊鱼

膀 bǎng  肩膀  翅膀
膀 páng  膀胱
膀 pāng  膀肿

臂 bì  手臂  臂力
臂 bei  胳臂

舍 shě  舍得  舍弃
舍 shè  宿舍  房舍

般 bān  一般  这般
般 bō  般若
般 pán  般桓

色 sè  颜色  色彩
色 shǎi  色子  掉色

艾 ài  艾草  方兴未艾
艾 yì  自怨自艾

节 jié  节日  节约
节 jiē  节骨眼  节子

芦 lú  芦苇  葫芦
芦 lǔ  芦同鲁

苔 tái  青苔  苔藓
苔 tāi  舌苔

茄 qié  茄子  番茄
茄 jiā  雪茄

荡 dàng  飘荡  荡漾
荡 tāng  荡荡

荫 yīn  树荫  绿荫
荫 yìn  荫庇  荫凉

荷 hé  荷花  荷叶
荷 hè  负荷  电荷

落 luò  落下  降落
落 lào  落枕  落价
落 là  落下  丢三落四

著 zhù  著名  著作
著 zhuó  著同着
著 zhe  著同着

蒙 méng  蒙蒙  启蒙
蒙 měng  蒙古  蒙古族
蒙 mēng  蒙人  蒙骗

薄 báo  薄饼  薄片
薄 bó  单薄  薄弱
薄 bò  薄荷

藏 cáng  躲藏  收藏
藏 zàng  宝藏  西藏

虎 hǔ  老虎  猛虎
虎 hù  虎不拉

虹 hóng  彩虹  霓虹灯
虹 jiàng  出虹了

虾 xiā  虾米  龙虾
虾 há  虾蟆

蚂 mǎ  蚂蚁  蚂蜂
蚂 mā  蚂螂
蚂 mà  蚂蚱

蛇 shé  毒蛇  蛇皮
蛇 yí  委蛇

血 xuè  血液  鲜血
血 xiě  流血  鸡血

行 xíng  行走  行动
行 háng  银行  行列
行 héng  道行

衣 yī  衣服  上衣
衣 yì  衣布衣

袜 wà  袜子  丝袜
袜 mò  袜同靺

被 bèi  被子  被动
被 pī  被同披

裂 liè  裂开  破裂
裂 liě  裂着怀

要 yào  重要  需要
要 yāo  要求  要挟

见 jiàn  看见  见面
见 xiàn  见同现

观 guān  观看  观察
观 guàn  道观  楼观

觉 jué  感觉  觉得
觉 jiào  睡觉  午觉

角 jiǎo  角落  牛角
角 jué  角色  角逐

解 jiě  解开  解答
解 jiè  解送  押解
解 xiè  解数  姓解

许 xǔ  许多  允许
许 hǔ  许许

论 lùn  讨论  议论
论 lún  论语

识 shí  认识  知识
识 zhì  标识  款识

详 xiáng  详细  端详
详 yáng  详同佯

语 yǔ  语文  语言
语 yù  不以语人

说 shuō  说话  说明
说 shuì  游说  说客
说 yuè  说同悦

读 dú  读书  阅读
读 dòu  句读

谁 shuí  谁的  是谁
谁 shéi  谁个

谷 gǔ  山谷  稻谷
谷 yù  吐谷浑

贴 tiē  贴画  粘贴
贴 tiě  贴子
贴 tiè  字帖同帖

费 fèi  花费  费用
费 bì  费同拂

赚 zhuàn  赚钱  赚了
赚 zuàn  赚骗

趣 qù  有趣  兴趣
趣 cù  趣同促

跑 pǎo  跑步  奔跑
跑 páo  跑槽

跳 tiào  跳高  跳远
跳 táo  跳同逃

踏 tà  踏步  踩踏
踏 tā  踏实

蹲 dūn  蹲下  蹲点
蹲 cún  蹲了腿

车 chē  汽车  火车
车 jū  车马炮

转 zhuǎn  转身  转让
转 zhuàn  转动  转圈
转 zhuǎi  转文

轴 zhóu  车轴  轴心
轴 zhòu  压轴

载 zǎi  记载  一年半载
载 zài  载重  装载

过 guò  过去  经过
过 guō  姓过

还 hái  还有  还是
还 huán  归还  还书

这 zhè  这里  这个
这 zhèi  这俩  这仨

追 zhuī  追赶  追求
追 duī  追琢

适 shì  合适  适应
适 kuò  适同栝

通 tōng  通过  交通
通 tòng  一通  打了三通

逢 féng  相逢  每逢
逢 péng  逢同蓬

那 nà  那里  那个
那 nǎ  那同哪
那 nèi  那个  那些
那 nā  姓那

郎 láng  新郎  郎中
郎 làng  屎壳郎

都 dōu  都是  都好
都 dū  首都  都市

采 cǎi  采摘  采花
采 cài  采同菜

重 zhòng  重量  重要
重 chóng  重复  重新

量 liàng  力量  数量
量 liáng  测量  量身高

钉 dīng  钉子  铁钉
钉 dìng  钉扣子  钉钉子

钢 gāng  钢铁  钢笔
钢 gàng  钢刀布  钢一下

钥 yào  钥匙
钥 yuè  锁钥

钻 zuān  钻研  钻探
钻 zuàn  钻石  电钻

铅 qiān  铅笔  铅球
铅 yán  铅山

铺 pū  铺开  铺路
铺 pù  店铺  铺子

长 cháng  长短  长度
长 zhǎng  长大  生长

间 jiān  中间  房间
间 jiàn  间隔  间接

闷 mèn  烦闷  纳闷
闷 mēn  闷热  闷头

阿 ā  阿姨  阿婆
阿 ē  阿胶  阿谀

陆 lù  陆地  大陆
陆 liù  陆同六

降 jiàng  降落  下降
降 xiáng  投降  降服

陶 táo  陶瓷  陶醉
陶 yáo  陶同窑

难 nán  困难  难过
难 nàn  灾难  遇难
难 nuó  难同挪

雀 què  麻雀  孔雀
雀 qiāo  雀子
雀 qiǎo  家雀儿

雨 yǔ  下雨  雨水
雨 yù  雨雪

雷 léi  雷雨  雷声
雷 lèi  雷同擂

露 lù  露水  暴露
露 lòu  露面  露馅

革 gé  革命  皮革
革 jí  革同急

颈 jǐng  颈部  颈椎
颈 gěng  脖颈子

频 pín  频繁  频率
频 bīn  频同濒

风 fēng  大风  风景
风 fěng  风同讽

食 shí  食物  食品
食 sì  食同饲
食 yì  郦食其

饮 yǐn  饮水  饮料
饮 yìn  饮马  饮牛

驮 tuó  驮着  驮运
驮 duò  驮子  驮轿

骑 qí  骑马  骑车
骑 jì  坐骑  千骑

骨 gǔ  骨头  骨骼
骨 gū  花骨朵  骨碌

鲜 xiān  新鲜  鲜花
鲜 xiǎn  鲜见  鲜为人知

麻 má  麻烦  芝麻
麻 mā  麻溜  麻麻烦烦

齐 qí  整齐  齐全
齐 jì  齐同剂

龟 guī  乌龟  海龟
龟 jūn  龟裂
龟 qiū  龟兹
"""

# 解析豆包列表
doubao = {}  # {字: [(读音, [词1, 词2]), ...]}
lines = raw_text.strip().split('\n')
current_char = None
for line in lines:
    line = line.strip()
    if not line:
        current_char = None
        continue
    parts = line.split()
    if len(parts) >= 3:
        char = parts[0]
        py = parts[1]
        words = parts[2:] if len(parts) > 2 else []
        if char not in doubao:
            doubao[char] = []
        doubao[char].append((py, words))
        current_char = char

print(f'豆包多音字: {len(doubao)} 个')

# 加载现有的 polyphone_chars.json
with open('AiPhonix/server/data/polyphone_chars.json', 'r', encoding='utf-8') as f:
    existing = json.load(f)
existing_chars = existing.get('chars', {})

print(f'现有 polyphone 数据: {len(existing_chars)} 个')
print()

# 1. 豆包有但现有数据没有的字
missing_chars = set(doubao.keys()) - set(existing_chars.keys())
print(f'=== 豆包有、现有数据缺失的字 ({len(missing_chars)} 个) ===')
for ch in sorted(missing_chars):
    prons = ' / '.join([f'{p}({",".join(w)})' for p, w in doubao[ch]])
    print(f'  {ch}: {prons}')
print()

# 2. 两边都有但读音不同的字
print(f'=== 共同覆盖但读音缺失的字 ===')
for ch in sorted(set(doubao.keys()) & set(existing_chars.keys())):
    db_prons = set(p for p, w in doubao[ch])
    ex_prons = set(existing_chars[ch].get('pronunciations', []))
    # 去除声调比较base形式
    db_bases = set(p.rstrip('012345') for p in db_prons)
    ex_bases = set(p.rstrip('012345') for p in ex_prons)
    missing = db_bases - ex_bases
    extra = ex_bases - db_bases
    if missing:
        db_detail = ' / '.join([f'{p}({",".join(w)})' for p, w in doubao[ch] if p.rstrip('012345') in missing])
        print(f'  {ch}: 现有缺 {missing}  [豆包: {db_detail}]')
    if extra:
        print(f'  {ch}: 现有多 {extra} (豆包无)')

print()
print('=== 汇总 ===')
print(f'豆包共 {len(doubao)} 字')
print(f'现有共 {len(existing_chars)} 字')
print(f'共同覆盖: {len(set(doubao.keys()) & set(existing_chars.keys()))} 字')
print(f'豆包有现有无: {len(missing_chars)} 字(需补充)')
