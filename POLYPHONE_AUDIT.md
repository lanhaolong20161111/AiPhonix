# AiPhonix 多音字审计报告

> 生成时间：2026-08-30 19:19　｜参照字典：`shared/data/polyphone_chars.json`（214 字 / 873 条词例）

## 判定口径（重要）

已存拼音**带变调**（如 `一定` 存 `yi2 ding4`，本调 `yi1` 在四声前变调），所以不能简单做字符串比对。本报告分三级：

| 级别 | 含义 | 处置 |
|---|---|---|
| **A 级** | 基音不同（如 `长` 该读 `zhang3` 却存 `chang2`） | 确定读错，必须修 |
| **B 级** | 基音相同、声调不同，且无法用变调/轻声解释 | 存疑，需人工核 |
| **C 级** | 多音字无词例支撑，按默认音推断 | 需补词例或人工确认 |

已自动豁免的声调差异：`一`/`不` 的变调、三声连读变调、轻声。

## 一、总览

| 数据源 | 条目数 | A 不可能读音 | B 词例冲突 | C 单字非常用音 | D 无词例支撑 | E 声调存疑 | 判定正确 |
|---|---|---|---|---|---|---|---|
| chinese_wordbank 单字 | 1849 | 0 | 0 | 6 | 180 | 12 | 3 |
| chinese_wordbank 词语 | 1251 | 0 | 0 | 0 | 71 | 5 | 69 |

| 无拼音内容（TTS 直读） | 条目数 | 含多音字条目 | 占比 | 累计多音字命中 |
|---|---|---|---|---|
| char_examples 词语（无拼音，TTS 直读） | 2898 | 705 | 24.3% | 755 |
| char_examples 例句（无拼音，TTS 直读） | 1449 | 1278 | 88.2% | 2726 |
| char_sentences 例句（无拼音，TTS 直读） | 729 | 706 | 96.8% | 2028 |

## 二、A 级：不可能读音

_存的基音不在该字读音集合内 —— 确定错误，必须修_

✅ 无。

## 三、B 级：词例冲突

_有词例明确该语境读音，却存了另一个 —— 高置信错误_

✅ 无。

## 四、C 级：单字非常用音

_单字卡用了非默认读音 —— 仅在该音专属词里才成立，疑似错误_

### chinese_wordbank 单字（6 处）

| 词/字 | 已存拼音 | 多音字 | 当前读音 | 字典给出 | 判定依据 |
|---|---|---|---|---|---|
| 似 | shi4 | 似 | **shi4** | si4 | 默认音 si4 |
| 佛 | fu2 | 佛 | **fu2** | fo2 | 默认音 fo2 |
| 匙 | shi5 | 匙 | **shi5** | chi2 | 默认音 chi2 |
| 泊 | po1 | 泊 | **po1** | bo2 | 默认音 bo2 |
| 爪 | zhao3 | 爪 | **zhao3** | zhua3 | 默认音 zhua3 |
| 长 | zhang3 | 长 | **zhang3** | chang2 | 默认音 chang2 |

## 五、D 级：无词例支撑

_该语境无词例，只能按默认音推断 —— 需补词例或抽查_

### chinese_wordbank 单字（180 处）

| 词/字 | 已存拼音 | 多音字 | 当前读音 | 默认音 |
|---|---|---|---|---|
| 丧 | sang4 | 丧 | sang4 | sang4 |
| 中 | zhong1 | 中 | zhong1 | zhong1 |
| 乐 | le4 | 乐 | le4 | le4 |
| 任 | ren4 | 任 | ren4 | ren4 |
| 会 | hui4 | 会 | hui4 | hui4 |
| 传 | chuan2 | 传 | chuan2 | chuan2 |
| 作 | zuo4 | 作 | zuo4 | zuo4 |
| 供 | gong1 | 供 | gong1 | gong1 |
| 便 | bian4 | 便 | bian4 | bian4 |
| 俩 | lia3 | 俩 | lia3 | lia3 |
| 假 | jia3 | 假 | jia3 | jia3 |
| 兴 | xing1 | 兴 | xing1 | xing1 |
| 冲 | chong1 | 冲 | chong1 | chong1 |
| 凉 | liang2 | 凉 | liang2 | liang2 |
| 几 | ji3 | 几 | ji3 | ji3 |
| 分 | fen1 | 分 | fen1 | fen1 |
| 切 | qie4 | 切 | qie4 | qie4 |
| 创 | chuang4 | 创 | chuang4 | chuang4 |
| 别 | bie2 | 别 | bie2 | bie2 |
| 刷 | shua1 | 刷 | shua1 | shua1 |
| 劲 | jin4 | 劲 | jin4 | jin4 |
| 勾 | gou1 | 勾 | gou1 | gou1 |
| 化 | hua4 | 化 | hua4 | hua4 |
| 华 | hua2 | 华 | hua2 | hua2 |
| 单 | dan1 | 单 | dan1 | dan1 |
| 占 | zhan4 | 占 | zhan4 | zhan4 |
| 卡 | ka3 | 卡 | ka3 | ka3 |
| 卷 | juan3 | 卷 | juan3 | juan3 |
| 压 | ya1 | 压 | ya1 | ya1 |
| 厦 | sha4 | 厦 | sha4 | sha4 |
| 参 | can1 | 参 | can1 | can1 |
| 发 | fa1 | 发 | fa1 | fa1 |
| 只 | zhi3 | 只 | zhi3 | zhi3 |
| 台 | tai2 | 台 | tai2 | tai2 |
| 号 | hao4 | 号 | hao4 | hao4 |
| 吐 | tu3 | 吐 | tu3 | tu3 |
| 吓 | xia4 | 吓 | xia4 | xia4 |
| 吗 | ma5 | 吗 | ma5 | ma5 |
| 吧 | ba5 | 吧 | ba5 | ba5 |
| 和 | he2 | 和 | he2 | he2 |
| 喝 | he1 | 喝 | he1 | he1 |
| 圈 | quan1 | 圈 | quan1 | quan1 |
| 场 | chang3 | 场 | chang3 | chang3 |
| 坊 | fang1 | 坊 | fang1 | fang1 |
| 壳 | ke2 | 壳 | ke2 | ke2 |
| 处 | chu4 | 处 | chu4 | chu4 |
| 大 | da4 | 大 | da4 | da4 |
| 夹 | jia1 | 夹 | jia1 | jia1 |
| 奇 | qi2 | 奇 | qi2 | qi2 |
| 奔 | ben1 | 奔 | ben1 | ben1 |
| 好 | hao3 | 好 | hao3 | hao3 |
| 宁 | ning2 | 宁 | ning2 | ning2 |
| 宿 | su4 | 宿 | su4 | su4 |
| 将 | jiang1 | 将 | jiang1 | jiang1 |
| 少 | shao3 | 少 | shao3 | shao3 |
| 尾 | wei3 | 尾 | wei3 | wei3 |
| 巷 | xiang4 | 巷 | xiang4 | xiang4 |
| 应 | ying1 | 应 | ying1 | ying1 |
| 度 | du4 | 度 | du4 | du4 |
| 弄 | nong4 | 弄 | nong4 | nong4 |

（仅列前 60 条，共 180 条）

### chinese_wordbank 词语（71 处）

| 词/字 | 已存拼音 | 多音字 | 当前读音 | 默认音 |
|---|---|---|---|---|
| 一本正经 | yi1 ben3 zheng4 jing1 | 正 | zheng4 | zheng4 |
| 中华 | zhong1 hua2 | 中 | zhong1 | zhong1 |
| 中秋 | zhong1 qiu1 | 中 | zhong1 | zhong1 |
| 为难 | wei2 nan2 | 为 | wei2 | wei2 |
| 为难 | wei2 nan2 | 难 | nan2 | nan2 |
| 主要 | zhu3 yao4 | 要 | yao4 | yao4 |
| 争分夺秒 | zheng1 fen1 duo2 miao3 | 分 | fen1 | fen1 |
| 五角星 | wu3 jiao3 xing1 | 角 | jiao3 | jiao3 |
| 传说 | chuan2 shuo1 | 说 | shuo1 | shuo1 |
| 出色 | chu1 se4 | 色 | se4 | se4 |
| 号召 | hao4 zhao4 | 号 | hao4 | hao4 |
| 各种各样 | ge4 zhong3 ge4 yang4 | 种 | zhong3 | zhong3 |
| 启发 | qi3 fa1 | 发 | fa1 | fa1 |
| 哈哈大笑 | ha1 ha1 da4 xiao4 | 大 | da4 | da4 |
| 外祖父 | wai4 zu3 fu4 | 父 | fu4 | fu4 |
| 大叔 | da4 shu1 | 大 | da4 | da4 |
| 大吃一惊 | da4 chi1 yi1 jing1 | 大 | da4 | da4 |
| 大自然 | da4 zi4 ran2 | 大 | da4 | da4 |
| 大象 | da4 xiang4 | 大 | da4 | da4 |
| 奥秘 | ao4 mi4 | 秘 | mi4 | mi4 |
| 好奇 | hao4 qi2 | 奇 | qi2 | qi2 |
| 季节 | ji4 jie2 | 节 | jie2 | jie2 |
| 安居乐业 | an1 ju1 le4 ye4 | 乐 | le4 | le4 |
| 尽情 | jin4 qing2 | 尽 | jin4 | jin4 |
| 岩石 | yan2 shi2 | 石 | shi2 | shi2 |
| 彩色 | cai3 se4 | 色 | se4 | se4 |
| 惊奇 | jing1 qi2 | 奇 | qi2 | qi2 |
| 成群结队 | cheng2 qun2 jie2 dui4 | 结 | jie2 | jie2 |
| 手术台 | shou3 shu4 tai2 | 术 | shu4 | shu4 |
| 手术台 | shou3 shu4 tai2 | 台 | tai2 | tai2 |
| 打响 | da3 xiang3 | 打 | da3 | da3 |
| 打扫 | da3 sao3 | 打 | da3 | da3 |
| 提供 | ti2 gong1 | 提 | ti2 | ti2 |
| 教室 | jiao4 shi4 | 教 | jiao4 | jiao4 |
| 散发 | san4 fa4 | 散 | san4 | san4 |
| 新奇 | xin1 qi2 | 奇 | qi2 | qi2 |
| 旅行 | lv3 xing2 | 行 | xing2 | xing2 |
| 无尽 | wu2 jin4 | 尽 | jin4 | jin4 |
| 景色 | jing3 se4 | 色 | se4 | se4 |
| 正巧 | zheng4 qiao3 | 正 | zheng4 | zheng4 |
| 步行 | bu4 xing2 | 行 | xing2 | xing2 |
| 消化 | xiao1 hua4 | 化 | hua4 | hua4 |
| 清明节 | qing1 ming2 jie2 | 节 | jie2 | jie2 |
| 特别 | te4 bie2 | 别 | bie2 | bie2 |
| 环节 | huan2 jie2 | 节 | jie2 | jie2 |
| 甲骨文 | jia3 gu3 wen2 | 骨 | gu3 | gu3 |
| 碧空如洗 | bi4 kong1 ru2 xi3 | 空 | kong1 | kong1 |
| 碧绿 | bi4 lv4 | 绿 | lv4 | lv4 |
| 空间站 | kong1 jian1 zhan4 | 空 | kong1 | kong1 |
| 空间站 | kong1 jian1 zhan4 | 间 | jian1 | jian1 |
| 绿色 | lv4 se4 | 色 | se4 | se4 |
| 翠绿 | cui4 lv4 | 绿 | lv4 | lv4 |
| 萌发 | meng2 fa1 | 发 | fa1 | fa1 |
| 落叶 | luo4 ye4 | 落 | luo4 | luo4 |
| 血丝 | xue4 si1 | 血 | xue4 | xue4 |
| 要好 | yao4 hao3 | 要 | yao4 | yao4 |
| 要好 | yao4 hao3 | 好 | hao3 | hao3 |
| 要是 | yao4 shi4 | 要 | yao4 | yao4 |
| 车轴 | che1 zhou2 | 车 | che1 | che1 |
| 转眼 | zhuan3 yan3 | 转 | zhuan3 | zhuan3 |

（仅列前 60 条，共 71 条）

## 六、E 级：声调存疑

_基音相同、声调不同且非变调 —— 需人工核（实测多为字典 primary 不准）_

### chinese_wordbank 单字（12 处）

| 词/字 | 已存拼音 | 多音字 | 当前读音 | 字典给出 | 判定依据 |
|---|---|---|---|---|---|
| 为 | wei4 | 为 | **wei4** | wei2 | 默认音 |
| 倒 | dao4 | 倒 | **dao4** | dao3 | 默认音 |
| 划 | hua4 | 划 | **hua4** | hua2 | 默认音 |
| 咽 | yan4 | 咽 | **yan4** | yan1 | 默认音 |
| 尽 | jin3 | 尽 | **jin3** | jin4 | 默认音 |
| 差 | cha4 | 差 | **cha4** | cha1 | 默认音 |
| 干 | gan4 | 干 | **gan4** | gan1 | 默认音 |
| 挣 | zheng1 | 挣 | **zheng1** | zheng4 | 默认音 |
| 曲 | qu1 | 曲 | **qu1** | qu3 | 默认音 |
| 缝 | feng4 | 缝 | **feng4** | feng2 | 默认音 |
| 舍 | she3 | 舍 | **she3** | she4 | 默认音 |
| 铺 | pu4 | 铺 | **pu4** | pu1 | 默认音 |

### chinese_wordbank 词语（5 处）

| 词/字 | 已存拼音 | 多音字 | 当前读音 | 字典给出 | 判定依据 |
|---|---|---|---|---|---|
| 为什么 | wei4 shen2 me5 | 为 | **wei4** | wei2 | 默认音 |
| 倒映 | dao4 ying4 | 倒 | **dao4** | dao3 | 默认音 |
| 妥当 | tuo3 dang4 | 当 | **dang4** | dang1 | 默认音 |
| 恋恋不舍 | lian4 lian4 bu4 she3 | 舍 | **she3** | she4 | 默认音 |
| 枝干 | zhi1 gan4 | 干 | **gan4** | gan1 | 默认音 |


## 七、TTS 风险：无拼音的例句/词语

这些内容**完全没有拼音字段**，展示时不显示拼音、朗读时由百度 TTS 自行判断读音。TTS 对多音字有一定判断力但不保证正确，以下为含多音字的条目。

### 高频风险多音字 TOP 20

| # | 多音字 | 出现次数 | 全部读音 | 默认音 |
|---|---|---|---|---|
| 1 | 的 | 986 | de/di2/di4 | de |
| 2 | 了 | 578 | le/liao3 | le |
| 3 | 要 | 232 | yao1/yao4 | yao4 |
| 4 | 大 | 228 | da4/dai4 | da4 |
| 5 | 好 | 216 | hao3/hao4 | hao3 |
| 6 | 着 | 168 | zhao2/zhe/zhuo2 | zhe |
| 7 | 得 | 121 | de/de2/dei3 | de2 |
| 8 | 看 | 101 | kan1/kan4 | kan4 |
| 9 | 都 | 98 | dou1/du1 | dou1 |
| 10 | 把 | 95 | ba3/ba4 | ba3 |
| 11 | 会 | 81 | hui4/kuai4 | hui4 |
| 12 | 给 | 71 | gei3/ji3 | gei3 |
| 13 | 和 | 71 | he2/he4/hu2/huo2/huo4 | he2 |
| 14 | 长 | 69 | chang2/zhang3 | chang2 |
| 15 | 教 | 68 | jiao1/jiao4 | jiao4 |
| 16 | 作 | 65 | zuo1/zuo4 | zuo4 |
| 17 | 中 | 60 | zhong1/zhong4 | zhong1 |
| 18 | 车 | 59 | che1/ju1 | che1 |
| 19 | 色 | 56 | se4/shai3 | se4 |
| 20 | 打 | 50 | da2/da3 | da3 |

### 例句抽样（char_sentences，含多音字最多的前 25 句）

| 例句 | 含多音字 |
|---|---|
| 出发前，妈妈把行李都收拾妥当了。 | 了、发、当、把、拾、行、都 |
| 小鸟掉的那片羽毛颜色真的特别好看。 | 别、好、片、的、看、色、那 |
| 海边有好多奇形怪状的大岩石和小贝壳。 | 和、壳、大、奇、好、的、石 |
| 这道数学题的难度不大，我很快就算出答案了。 | 了、大、度、数、的、答、难 |
| 这场激烈的战斗打响了，战士们都勇敢地冲向前。 | 了、冲、场、打、斗、的、都 |
| 儿童节那天，校园里到处都是欢乐的笑声。 | 乐、处、校、的、节、那、都 |
| 田里的禾苗喝饱了雨水，长得绿油油的。 | 了、喝、得、的、绿、长 |
| 小红主动把座位让给了抱着宝宝的阿姨。 | 了、把、的、着、给、阿 |
| 我们把教室打扫得干干净净，桌椅摆得很整齐。 | 干、得、打、扫、把、教 |
| 任何困难都吓不倒勇敢的孩子。 | 任、倒、吓、的、都、难 |
| 这棵大树的枝干细细的，上面长满了嫩绿叶子。 | 了、大、干、的、绿、长 |
| 外祖父在院子里种了好多好看的月季花。 | 了、好、父、的、看、种 |
| 教室里静悄悄的大家都在认真写作业。 | 作、大、悄、教、的、都 |
| 动物园里的梅花鹿头上长着好看的鹿角。 | 好、的、看、着、角、长 |
| 远处的大海和天空连成了水平线。 | 了、和、处、大、的、空 |
| 校园里的花坛盛开着五颜六色的鲜花。 | 校、的、盛、着、色、鲜 |
| 台上的歌手唱得真好听，大家都鼓掌。 | 台、大、好、得、的、都 |
| 大自然藏着好多有趣的奥秘。 | 大、好、的、着、秘、藏 |
| 明天就要去动物园玩了，我兴奋得睡不着觉。 | 了、兴、得、着、要、觉 |
| 运动会的比赛打响了，同学们都在为选手加油。 | 为、了、会、打、的、都 |
| 考试快要结束了，同学们争分夺秒地检查试卷。 | 了、分、卷、查、结、要 |
| 公园里的花朵开得五颜六色，特别好看。 | 别、好、得、的、看、色 |
| 我把布娃娃当作自己的好朋友，天天陪着它。 | 作、好、当、把、的、着 |
| 我在菜叶上发现了一只胖乎乎的绿虫子。 | 了、发、只、的、绿、胖 |
| 看门的大叔总是笑眯眯地和我们打招呼。 | 和、大、打、的、看 |

## 八、关键结论：`primary` 默认音不可作为语境判据

审计中 E 级（声调存疑）的**词语**条目逐条人工核对后，**全部是字典错、数据对**：

| 词语 | 已存拼音 | 多音字 | 字典 primary | 人工核实 |
|---|---|---|---|---|
| 为什么 | wei4 | 为 | wei2 | wèi（数据正确） |
| 倒映 | dao4 | 倒 | dao3 | dào（数据正确） |
| 妥当 | dang4 | 当 | dang1 | dàng（数据正确） |
| 恋恋不舍 | she3 | 舍 | she4 | shě（数据正确） |
| 枝干 | gan4 | 干 | gan1 | gàn（数据正确） |

**含义**：`polyphone_chars.json` 的 `primary` 是脱离语境的「最常用音」，一旦进入真实词语就会失效（实测 5/5 全错）。任何方案都**不能**用它做运行时判断，只能当最后兜底。正确的判据必须是**词级（乃至短语级）语境**。

## 九、多音字处理方案


### 第 1 层 · 数据层：给无拼音内容补拼音（治本，覆盖面最大）

**问题**：`char_examples`（1449 字 × 2 词 + 1 句）与 `char_sentences`（729 句）完全没有拼音字段，
含多音字比例高达 88%~97%，展示无拼音、朗读全靠 TTS 猜。

**做法**：离线批量生成逐字拼音，落盘为结构化 JSON。

- 先用 server_cf 已有的 `pinyin-pro` 依赖（词典模式）自动过一遍；
- 不确定的多音字再交给 LLM 批量标注 —— 项目已有现成资产可复用：
  `/ai-chinese/polyphones` 接口 + `prompts.ts` 里的多音字 prompt 模板；
- 建议产物：
  - `web/public/char_sentences_pinyin.json`：`{"春天": "chun1 tian1 dao4 le5, ..."}`
  - `web/public/char_examples_pinyin.json`：**逐字音节数组**（便于前端按字渲染、单独标红多音字）
- 成本：约 5000 条，一次离线跑 + 少量 LLM 费用；照 `gen_char_sentences.py` 的模式做断点续传。

### 第 2 层 · 运行时：语境查表，`primary` 只做兜底

**问题**：`primary` 脱离语境，实测 5/5 错（见第八节）。

**做法**：建词级反查表，查询优先级严格分层。

- 新建 `polyphone_words.json`：以 `chinese_wordbank` 的 1251 词 + 字典 873 条词例为种子，
  做成 `词 → 逐字读音` 的反查表；
- 查询优先级：**整词命中 → 词内含词例 → 句内短语命中 → `primary` 兜底**；
- 走 `primary` 兜底时**打埋点日志**，持续反哺词典，越用越准。

### 第 3 层 · TTS：强制注音，别让 TTS 自由发挥

**问题**：百度 TTS 对多音字有判断力但不保证正确。

**做法**：所有朗读入口统一用百度的 `{字^拼音}` 语法锁定读音。

- 现状：`useBlockSpeaking.speakChar` 已支持该语法，但**只在 AI 语文页用**；
- 推广到：例句朗读、词语朗读、字卡朗读 —— 凡已有正确拼音的地方都注入；
- 优化：不必整句逐字标注，**只标多音字**即可，控制请求体积。

### 优先级建议

| 顺序 | 事项 | 理由 |
|---|---|---|
| **1** | 第 3 层：把**已有**正确拼音注入 TTS | 单字/词语拼音本就正确，改动最小、零数据成本、立刻生效 |
| **2** | 第 1 层：补例句拼音 | 覆盖 88%~97% 的风险面，是真正的治本项 |
| **3** | 第 2 层：沉淀词级词典 | 随第 1、2 步的数据积累自然长出来，不必单独先做 |

> 一句话：**已有拼音的地方先喂给 TTS（立刻止血），没有拼音的地方先补拼音（治本），
> 字典只当兜底、不当判据。**

