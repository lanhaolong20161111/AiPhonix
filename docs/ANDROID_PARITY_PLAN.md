# Android ↔ Web 功能对齐计划（ANDROID_PARITY_PLAN）

> 生成：2026-09-21。目标：把 `AiPhonix/app/`（Kotlin + Jetpack Compose，Navigation 3）功能补全对齐 `AiPhonix/web/`（React + Vite）。
> 约束：只改 `AiPhonix/app/` 目录；遵守 `AiPhonix/AGENTS.md` Android 规范（分层架构 / UDF / collectAsStateWithLifecycle / 纯黑文字 / 语义色 绿0xFF2E7D32 红0xFFB71C1C 蓝0xFF90CAF9 等）。

---

## 1. 背景

- Android `app/` 于 2026-09-10 停更存档（`f7843b7 chore(app): 同步 Android 端历史改动（模块已停更，仅存档）`）。
- Web 端持续演进，新增大量模块（AI 英语、生词本、记忆快乐本、汉字地图、成长日记、偏旁魔法屋、AI 对话学语文、AI 英语对话、课件库、每日语文/英语、综合算式动画、字幕采集、家长报告、评测历史、拼音表、AI 历史会话等）。
- 本次任务：把 Android 缺失模块补齐，构建通过（`gradlew assembleDebug`），可安装验证。

## 2. 现状盘点

### Android 已有（对照 web 路由，`web/src/routes.tsx`）

| Android（NavKey / Screen） | 对应 web 路由 | 状态 |
|---|---|---|
| `Login` / LoginScreen | `/login` | ✅ 已有（注册入口在 LoginScreen 内，web 独立 RegisterPage，待核对） |
| `Home` / HomeScreen | `/home` | ✅ 已有（任务驱动；web 是固定宫格+今日任务，待加固定工具区） |
| `Recognition` / RecognitionScreen | `/module/recognition` | ✅ 已有 |
| `Dictation` / DictationScreen | `/module/dictation` | ✅ 已有 |
| `WordPractice` / WordPracticeScreen | `/module/word_practice` | ✅ 已有 |
| `EnglishLearning` / EnglishLearningScreen | `/module/english_learning` | ✅ 已有 |
| `LetterIndex` / LetterIndexScreen | `/module/letters` | ✅ 已有 |
| `Letter(char)` / LetterScreen | `/module/letter/:char` | ✅ 已有 |
| `Phonics(phonemeIndex)` / PhonicsScreen | `/module/phoneme/:symbol`（web 音素详情） | ✅ 已有（web 是独立详情页，Android 在 Phonics 内横滑） |
| `PhonemeIndex` / PhonemeIndexScreen | `/module/phoneme-index` | ✅ 已有 |
| `Practice(wordId)` / PronunciationScreen | `/module/pronounce/:wordId` | ✅ 已有 |
| `CharImageRecognition` / `CharImageGradeSelection` / `CharImageList` | `/module/char_image` + practice | ✅ 已有 |
| `VocabularyPractice` / `SentencePractice` | `/module/char_image/practice?type=英词/英句` | ✅ 已有 |
| `OralWriting` / OralWritingScreen | `/module/oral_writing` | ✅ 已有 |
| `DailyPractice` / DailyPracticeScreen | `/module/daily_practice` | ✅ 已有（web 的 `daily_chinese` / `daily_english` 子页已由 `DailyChinese` / `DailyEnglish` 对齐） |
| `ImportCenter` / `MyImports` / `MyLearning` / `QuizPractice` / `SentenceReading` / `ArticleList` / `ArticleReading` / `ArticleQuiz` | web 已删除「我的学习」系 | ✅ Android 保留（web 曾移除，不回退 Android） |
| `AiPractice` / `AiPracticeChat` / AiPracticeScreen | `/module/ai_practice` + chat | ✅ 已有 |
| `AiHomework` / AiHomeworkScreen | `/module/ai_homework` | ✅ 已有 |
| `AiChinese` / AiChineseScreen | `/module/ai_chinese` | ✅ 已有（输入+结果同屏，web 是输入页+独立结果页） |
| `VideoPractice` / VideoPracticeScreen | `/module/video_practice` | ✅ 已有 |
| `Quiz(videoName, srtPath)` / QuizScreen | 视频考卷 | ✅ 已有 |
| `PinyinExercise` / PinyinScreen | `/pinyin`（拼音练习） | ✅ 已有 |
| `Murmur` / MurmurScreen | `/module/murmur` | ✅ 已有 |
| `Account` / `FeedbackList(status)` | web 家长报告/评测历史相关 | ✅ 已有（错题本/掌握/待确认） |
| `ParentSettings` / ParentSettingsScreen | web SettingsSheet + 家长设置 | ✅ 已有 |
| `Report` / ReportScreen | `/module/parent_report`（家长报告） | ⚠️ 占位/待核对（web 有完整家长报告） |

### Web 有 / Android 缺失（本次补全清单）

| # | web 路由 / 页面 | Android 缺失 | 依赖 | 难度 |
|---|---|---|---|---|
| 1 | `/module/ai_english`（AI 英语识图） | ❌ AiEnglishScreen | 复用 ai-chinese parse-image `mode=english` + chat | 高 |
| 2 | `/module/ai_parse_result`（AI 识别结果页） | ❌ Android 输入+结果同屏 | web 独立结果页含 blocks 渲染/问答/高亮/历史 | 高（Android 已有大部分能力，需补「保存历史」与历史恢复） |
| 3 | `/module/ai_history`（AI 历史会话） | ❌ AiHistoryScreen | localStorage 历史（web `aiHistory.ts`） | 中 |
| 4 | `/module/soe_history`（评测历史） | ❌ SoeHistoryScreen | `POST /soe/records` | 中 |
| 5 | `/module/pinyin-index` + `/module/pinyin/:id`（拼音表） | ❌ PinyinIndexScreen / PinyinDetailScreen | 静态数据 `web/src/data/pinyinTable.ts` 移植 assets + `/pinyin-audio` | 低 |
| 6 | `/module/wordbook`（生词本） | ✅ WordbookScreen | 词库/生词本接口 | 中 |
| 7 | `/module/memory_joy`（记忆快乐本） | ✅ MemoryJoyScreen | `/joy/list` + `/joy/:id` | 中 |
| 8 | `/module/char_map`（汉字地图） | ✅ CharMapScreen | char-images 全量 + feedback | 中 |
| 9 | `/module/diary`（成长日记） | ✅ DiaryScreen | 本地存储 + `/llm/chat` | 中 |
| 10 | `/module/radical_game`（偏旁魔法屋） | ✅ RadicalGameScreen | 静态字族 + `/radical/song|riddles` | 中 |
| 11 | `/module/speech_compose`（AI 对话学语文） | ✅ SpeechComposeScreen | chat + TTS + 文章分句 | 中 |
| 12 | `/module/ai_english_talk`（AI 英语对话） | ✅ EnglishTalkScreen | chat + TTS + 跟读阶梯 + ASR 判定 | 中 |
| 13 | `/module/courseware_manager`（课件库） | ✅ CoursewareScreen | 课件上传/管理接口 | 中 |
| 14 | `/module/daily_chinese` / `daily_english`（每日语文/英语） | ✅ DailyChineseScreen / DailyEnglishScreen | 每日内容接口/静态 | 中 |
| 15 | `/module/math_compound_expr`（综合算式动画） | ❌ MathCompoundExprScreen | 纯前端动画（Compose 重写） | 高 |
| 16 | `/module/subtitle_capture`（字幕采集） | ❌ SubtitleCaptureScreen | 视频帧选取 + OCR（Android 用 MediaStore + BitmapRegionDecoder） | 高 |
| 17 | `/module/parent_report`（家长报告） | ⚠️ ReportScreen 需核对 | training/progress + 报告 | 中 |
| 18 | `/register`（注册页） | ⚠️ 核对 LoginScreen 是否含注册 | auth | 低 |
| 19 | `/module/sentence_practice`（造句练习） | ✅ SentenceComposeScreen | `AiChatRepository.ask("chinese")` + 每日语文句型 | 中 |

## 3. 实施批次（每批可独立构建验证）

> **进度（2026-09-22）**：批次 A（5/5）、批次 B（5/5）、批次 C（4 + 1 模块）已全部完成（提交 `438d749` / `10b58fa`）；
> `assembleDebug` BUILD SUCCESSFUL；`testDebugUnitTest` **313 用例 / 0 失败**（24 个测试类）。
> 已完成：拼音表、AI 历史、AI 英语、评测历史（A）；生词本、记忆快乐本、汉字地图、成长日记、偏旁魔法屋（B）；
> 课件库、每日语文、每日英语、造句练习（C 前半）+ 生词本「点读自动收录」接线（B 遗留）；
> **AI 对话学语文、AI 英语对话（C 后半前 2 个）**。
> 剩余：**批次 C 后半 2 个模块**（综合算式动画、字幕采集）+ 2 项待核对。

### 批次 A（本次会话）✅ 全部完成
1. **拼音表** ✅：`PinyinIndexScreen` + `PinyinDetailScreen`；数据由脚本从 `pinyinTable.ts`/`pinyinMnemonic.ts` 生成 `data/pinyin/PinyinTableData.kt`（449 行，含 23 声母/26 韵母/16 整体认读，无转录误差）；符号音频走 `/api/v1/pinyin-audio`（`PinyinAudioPlayer`），例字走中文百度 TTS；首页新增固定入口卡片。
2. **AI 英语** ✅：`AiEnglishScreen` + `AiEnglishViewModel`；`AiChineseRepository.parseImage(mode="english")` 走英语专用提示词通道；新增 `data/aichat/AiChatRepository`（`POST /ai-chat/ask` + `GET /ai-chat/session` 断点续聊）；点英文单词经系统 TTS 发音；AI 陪练页新增「英语」入口卡片。
3. **AI 历史** ✅：`data/aihistory/AiHistoryStore`（本地 JSON，chinese/math/english 三桶×50 上限，缩略图 base64）+ `AiHistoryScreen`（模块切换/日期/摘要/删除）+ `AiHistoryDetailScreen`（只读回看 + 点行朗读）；AI 语文/数学识别后自动存快照，AI 英语会话自动存对话摘要；三个页面均有「🗂 历史」入口。
4. **评测历史** ✅：`data/soerecord/SoeRecordRepository`（`POST /soe/records` 查询 + `DELETE /soe/records/{id}` + `POST /soe/records/batch-delete`）+ `SoeHistoryScreen`（全选/批量删除/单条删除、展开明细：总分 + 单字/单词→每音素、句子→每字，颜色 ≥80 绿 / 60-79 黄 / <60 红，英文音素 ARPAbet→IPA）；入口在「我的账户 → 语音评测记录 → 查看全部评测明细」。
5. 首页固定「学习工具」区 ✅ 部分（已加拼音表；其余随各模块落地补）。

> ⚠️ 评测历史的「点击定位到该字」在 Android 暂未实现（web 跳 char_image/pronounce 带 focus 参数）——当前点击条目为展开明细。

### 批次 B（本次会话）✅ 全部完成
6. **生词本** ✅：`data/wordbook/WordbookRepository`（`/wordbook/list` · `/wordbook/review` · `/wordbook/rate` · `DELETE /wordbook/{id}`，另备 `add`/`addMany`）+ `ui/wordbook/`（复习/词表双 Tab、大字卡点读、认识/不认识打卡、词表朗读+删除）。朗读：英文走 `TtsEngine`、中文走 `BaiduTtsCache.play(text,"0")`。
   ✅ **「点读自动收录」已接线（批次 C 前半补齐）**：`WordbookAutoCollector`（`data/wordbook/WordbookAutoCollect.kt`）—— `isWordbookWorthy` 移植自 web `isWordbookWorthy`（纯 CJK 块 / 纯英文词才算），去重键 `${source}:${text}`（对齐 web `useRef<Set>`，**必须去重**：服务端 `add`/`add-many` 是 `onConflictDoUpdate` 会 `times + 1`）。
   已接：`AiChineseViewModel.speakChar`（`recog_chinese`）、`AiEnglishViewModel.speakTappedWord`（`recog_english`，**独立于 `speak`** —— 否则整段气泡也会被收进去）。
7. **记忆快乐本** ✅：`data/joy/JoyRepository`（`/joy/list` + `DELETE /joy/{id}`，均需 JWT）+ `highlightJoyText` 的 Kotlin 移植；`ui/memoryjoy/`（按日期分组、文段逐字点读、当日字词 chip 点读、整段朗读、删除）。逐字发音走**服务端单字音频库** `/tts/char/{字}`（与 web 一致不传 pinyin）。
8. **汉字地图** ✅：`data/charmap/CharMapRepository`（全量字卡 + 本人 feedback 状态）+ `ui/charmap/`（`LazyVerticalGrid` 按年级铺图、进度条、格子按状态着色 —— 与 web `.charmap-cell.*` **同色**）。点格子进入该字字卡列表。
9. **成长日记** ✅：`data/diary/DiaryStore`（本地 `filesDir/diary_entries.json`，日期倒序、每天一条、临时文件 rename 原子写）+ `DiaryRepository`（`/llm/chat` mode=chinese，提示词与 web 逐字一致）+ `ui/diary/`（今日输入、润色+点评、时间线、删除确认）。
10. **偏旁魔法屋** ✅：`data/radical/RadicalFamilies.kt` **由脚本 `scripts/gen_radical_families.mjs` 从 web `radicalFamilies.ts` 自动生成**（34 字族 / 134 字 / 45 偏旁，零转录误差）；`RadicalRepository`（`/radical/song` + `/radical/riddles`）+ `ui/radical/`（select/song/quiz/done 四阶段、三种题型、小豆反应池）。

#### 批次 B 顺手修掉的真实 bug
- 🔴 **char-images 的类型过滤一直是失效的**：服务端 `char_images.ts` 读的是 **`type`**，而 web `services/charImages.ts` 与 Android `CharImageViewModel` 都在传 **`type_`** ⇒ 参数被静默忽略。生产实测：`type=认` → **816** 条，`type_=认` → **3028** 条（全量）。后果是「识字表 / 写字表 / 词语表」三个列表显示的是同一份混合内容。
  - Android 侧已修（`CharImageViewModel` 两处 `type_=` → `type=`）。
  - ⚠️ **web 侧尚未修**（`web/src/services/charImages.ts` 的 `qs.set("type_", ...)` 要改成 `qs.set("type", ...)`），需单独一次 web 构建+部署。
- 📌 **web `CharMapPage` 的 `TYPE_LABEL` 是过期词表**：写的是 `字/词/句`，但生产数据实际是 **认/写/词/英词/英句**（3028 条实测分布：认 816 / 写 748 / 词 729 / 英词 533 / 英句 202）⇒ web 上「认」「写」两个类型会原样显示、`字/句` 两个映射是死条目。Android 已按真实词表建标签，并**直接复用同一词表**（`type` 值可原样透传给 `CharImageList.type_`）。

#### 已知与 web 的差异（有意为之，非遗漏）
- **汉字地图的状态取「最新」**：服务端 feedback 唯一键是 `(user, char, grade, semester, type)`，一个字跨年级/类型会存多行。web 是「倒序遍历后写覆盖」= 取**最旧**那条（笔误）；Android 按意图取**最新**。
- **汉字地图点击不定位到该字**：web 跳转带 `focus=字`，Android `CharImageList` 无 focus 参数（与批次 A 评测历史同一限制）。
- **生词本朗读不锁多音字读音**：web `speak(text,{pinyin})` 会锁读音；Android 走 `BaiduTtsCache`。偏旁魔法屋的单字读音**已锁**（走 `/tts/char/{字}?pinyin=xxx`）。
- **AI 字谜加载态**：web 在谜面到达前页面是空白，Android 显示「AI 老师正在出字谜…」。

### 批次 C 前半（本次会话）✅ 全部完成
11. **课件库** ✅：`data/courseware/CoursewareRepository`（`GET /courseware?module=&limit=&offset=` · `POST /courseware/upload`(multipart) · `DELETE /courseware/{id}`，图片直链 `/courseware/file/:name` **不鉴权**，直接交 Coil）+ `data/courseware/PickedImage`（Screen 读字节、把纯数据交 VM —— VM 不持有 `Context`）+ `ui/courseware/`（三科目 `FilterChip`、`LazyVerticalGrid` 双列、多选图 `GetMultipleContents`、`AlertDialog` 替代 web `confirm()`）。
   上传**串行**逐张（与 web `for (const f of files)` 一致），任一张失败即中断并把服务端 `detail`（如「图片超过 20MB 限制」）显示出来；等值判断：本地先按 `MAX_FILE_MB = 20` 拦一次。
12. **每日语文** ✅：`data/dailyzh/`（`DailyZhStore` 本地镜像 + `DailyZhRepository` + `DailyTextSplit` 三套切分口径 + `DailyZhSync`）+ `ui/dailychinese/`（4 个练习入口 + ⚙️ 设置面板 4 个字段，摘要行与 web `todaySummary` **逐字一致**，含「词库命中 M」）。
   词库命中用 `WordBankRepository.countCharsByTexts` / `countWordsByTexts`（**新增**）；「能不能认」= 识字**或**识写（对齐 web `isRecogChar`，**不含「写字」**）。
13. **每日英语** ✅：`data/dailyen/`（`DailyEnStore` + `DailyEnRepository`：`/daily-en`(`GET`/`PUT`) · `/daily-en/word-info` · `/daily-en/sentence-info` · `/daily-en/image` · `/daily-en/file/:filename`）+ `ui/dailyenglish/`（单词卡：图/释义/例句；句子卡：图/翻译/常用场景；两卡都有 🔊 发音 + 🎤 评测）。切分直接复用 `DailyTextSplit.words` / `.sentences`（与 web `splitWords`/`splitSentences` 逐字同口径）。
14. **造句练习** ✅：`ui/sentencecompose/`（选句页 → 练习页；三级回退取词：今日句型随机 → 生词本 `reviewQueue()` 随机 → 内置 `FALLBACK_WORDS`，与 web 逐字一致）+ `AiChatRepository.AiChatAskResult` 增加 `wrongs`（非破坏性：`correction.wrongs` 数组，既有调用方零影响）。
15. **生词本自动收录接线** ✅（批次 B 遗留）见上面第 6 条。
16. **批 C 前半顺手补的公共能力**（都在 `app/`）：
    - `util/SoeDisplay.kt`：移植 web `lib/soeDisplay.ts`（`isMissing` / `formatScore` / `scoreClass` / `restoreWordCase`）——**漏读是 `MatchTag=2` 或负分，不是 0 分**，直接渲染会出现「-1 分」。附 5 条单测（期望值全部来自跑 web 真实现的探针）。
    - `WordScore` 增加 `phoneInfos`、`PhonemeScore` 增加 `rawAccuracy` / `matchTag`（都有默认值 ⇒ 既有调用方零影响）。腾讯 SOE **句子模式也返回 `phone_infos`** ⇒ 句子卡支持点单词展开音素（对齐 web `SoeDetail` 的 `expandable`）。
17. **首页「学习工具」区** ✅ 新增「🏆 每日语文」「🏆 每日英语」两张卡（`onOpenDailyChinese` / `onOpenDailyEnglish`）。

#### 批次 C 前半的已知差异（有意为之，非遗漏）
- **每日英语缺 3 项 web 能力**：① phonics 音形着色（Android 无 phonics 规则库）；② 「发音要领」（web 是本地 `lib/phonicsTips.ts` 打底 + LLM `/daily-en/phone-tips` 补充，Android 没有本地表，只调 LLM 补不出该效果）；③ 设置面板的拍照 OCR 自动填入（区域 OCR 随「字幕采集」一起做）。
- **每日语文 / 每日英语的设置面板都只有手动输入**（同上，OCR 是前置依赖）。
- **造句练习的 `wrongChars` 照抄了 web 的古怪行为**：用学生原句的 `wrongs` 去 `includes` 检查 **AI 点评文本**里的每个字（web 如此，Android 保持一致；已在注释里标注）。
- **`LocalDate.now()` vs 服务端东八区**：web 用 `cstDate()`，Android 用设备本地日期 —— 在 UTC+8 设备（目标用户）上一致，已在注释写明。

### 批次 C 后半（本次会话）
18. **AI 对话学语文** ✅（详见下方小节）
19. **AI 英语对话** ✅（详见下方小节）
20. 综合算式动画（MathCompoundExpr，Compose 重写飞入/转移动画）—— 待做
21. 字幕采集（SubtitleCapture，视频帧框选 + 区域 OCR —— 也是每日语文/英语「拍照识别填入」的前置依赖）—— 待做

#### 18. AI 对话学语文 ✅（`/module/speech_compose`）
一个页面装三套练习，由「开始学」时的填写内容分流（顺序与 web 一致：文章 → 古诗 → 词语/句子）。

| 模式 | 触发 | 流程 |
|---|---|---|
| **词语/句子教学** | 只填主题/词/句 | `POST /llm/zh-teach-setup` 生成逐题剧本 → 一问一答；**6 秒未作答自动逐级给提示（意思 → 例句 → 句型骨架，最多 3 级）** → 文本作答 → `POST /llm/zh-teach-judge`；错则朗读参考回答并可跟读测评 |
| **古诗** | 填了「要练的古诗」 | 本地 `PoemSplit` **立即**切句 → 开场朗读整篇 + 概括 → 逐句「原文 → 白话」→ 逐句跟读测评；`POST /llm/zh-poem-setup` 后台补逐句白话/逐字释义 |
| **文章背诵** | 填了「要练的文章」 | 本地 `ArticleSplit.splitSentences` **立即**切句 → 逐句领读 + 跟读测评；`POST /llm/article-recite` 后台补每句背诵缩写 |

- 数据层：`data/zhteach/`（`ZhTeachRepository` / `ZhPoemRepository` / `ZhReciteRepository` + 共用的 `ZhTeachHttp`）。
- 跟读测评：复用 `AudioRecorder` + `ScoreClient.evaluate(engine = "16k_zh")`，**过关线 70**（对齐 web `EchoLadder` 的 `PASS = 70`，**不是**句子练习页的 80）。
- 新增公用能力（都在 `app/`）：
  - `data/zhteach/PoemSplit`：古诗切句（按 `，。！？；：` 断、标点归前句）。
  - `data/tts/TtsAnnotate.annotateTts`：**多音字注音**（移植 web `lib/ttsPinyin.ts`）—— 产出 `字(xie2)` 形式的 tex 交给 `/tts/synthesize`。实测确认语法，`字(无声调)`/`字(zhòng)`/`{字^拼音}` **都无效**（拼音会被当字面念出来）。古诗朗读因此能读对「石径斜」的 `xie2`。
  - `BaiduTtsCache.playRemoteAndWait`：**可等待**的远程播放（原 `playRemote` 无完成回调，无法串行「先读字再读义」）。

#### 批次 C 后半 · AI 对话学语文的已知差异（有意为之，非遗漏）
- **中文音色取值不同**：web 用 `speaker="6221"`、古诗 `"3"`；Android 沿用本项目中文模块的既有约定 `"0"`（老师）/ `"3"`（度逍遥）。
- **不做「预取下一句音频」**：web 有 `warm()` 只下载不播放；Android 的 TTS 缓存没有该入口，故只在点击时合成（影响首次点击等待感，不影响正确性）。
- **`polyphoneOnly: true` 分支未实现**：web 的精细模式依赖 `data/polyphoneChars` 多音字表，Android 暂无该表（古诗走的是 `polyphoneOnly: false` 分支，不受影响）。
- **设置面板无拍照 OCR**：与每日语文/英语同一限制，前置依赖「字幕采集」。

#### 19. AI 英语对话 ✅（`/module/ai_english_talk`）

家长（或学生）填「主题 + 练习单词 + 练习句子」→ `POST /llm/en-dialogue-setup` 生成一份**多轮英文剧本**（每轮有 AI 台词、该说的回答、意群切分）→ 逐轮练习。

| 回答模式 | 触发 | 流程 |
|---|---|---|
| **跟读**（默认） | 进入即用 | AI 领读整句回答 → **逐词扩长阶梯**（第 1 遍读第 1 个词、第 2 遍读前 2 个词……）→ 每级 ≥70 分进下一级 → 整句读完进下一轮 |
| **自己说** | 点「🎤 我想自己说」 | 录音 → `POST /asr/short` 识别 → `POST /llm/en-answer-judge` 判定 → 通过给表扬；不通过给正确句 + 可展开**意群阶梯**（片段 → 扩长 → 整句）跟读修复 |

- 数据层：`data/englishtalk/EnglishTalkRepository`（`/llm/en-dialogue-setup` · `/llm/en-answer-judge`）、`data/asr/AsrRepository`（`/asr/short`）、翻译复用 `data/dailyen/DailyEnRepository`（`/daily-en/sentence-info` · `/word-info`）。
- 新增公用能力（都在 `app/`，可被后续模块复用）：
  - `ui/echo/EchoLadderState`（**纯状态机**）+ `ui/echo/EchoLadder`（纯展示组件）：移植 web `EchoLadder` 的逐词/意群阶梯。`PASS = 70`；第 2 级起连错 2 次**降级**到失败单位做「小步」，小步过关**回原级**；`level == 1` 永不降级。附 13 条单测。
  - `util/EnText.kt`：`splitEnWords` / `englishOnly` / `normEnWord` / `fallbackChunks` / `soeScene` / `evalModeForScene` / `parsePracticeWords` / `parsePracticeSentences` / `jsTrim` （JS 语义的空白与裁剪，含 NBSP / 全角空格 / BOM）。附 16 条单测。
  - `ui/common/EnglishWordTapText`：英文文本逐词可点读（点词查 `/daily-en/word-info` 朗读 + 高亮）。
  - `data/llm/LlmHttp`：由原 `data/zhteach/ZhTeachHttp` **提升+改名**为 `/llm/` 前缀通用 HTTP 层（Auth / 对象解析 / 错误抽取 / 取消透传），三个语文仓储同步改名。
- 中英朗读统一走注入的 `BaiduTtsCache`：服务端 `lib/baiduTts.ts` 对英文文本**自动换音色**（`4193` 度泽言·自然英文），前端不必区分语言；「先英文后中文」严格串行（`play` 是全局互斥的）。
- 实测确认：`/llm/en-dialogue-setup` **不传 `lang`**（默认 en）；`/llm/en-answer-judge` 通过时 `correct` 为空。`/asr/short` 无鉴权，`raw.length < 1600` 或无识别结果都返回 **422**（归一成 `Result.success("")`，与「请求失败」分开）。

#### 批次 C 后半 · AI 英语对话的已知差异（有意为之，非遗漏）

- **「自己说」降级为「录一段 → 识别 → 判定」**：web 用 WebSocket 流式 ASR（`/asr/stream`）做实时逐词上屏，Android 无该通道 ⇒ 录音结束才拿到整段文本。
- **放弃 3 项依赖流式 ASR 的能力**：① 逐词实时提示；② **6 秒静音自动挂阶梯**；③ 提示记录面板。
- **不做「未作答自动给提示」的三级 hint**（同上一项，依赖流式 ASR 的静音检测）。
- **设置面板无拍照 OCR**：与每日语文/英语同一限制，前置依赖「字幕采集」。
- **`EN_WORD_RE` 照抄 web 的三处反直觉行为**：连字符 `-` **不在**字符类内（`well-known` 切成 `well` + `known`）；数字切开（`world4u` → `world` + `u`）；非 ASCII 字母切开（`café` → `caf`）—— 与 `WordbookAutoCollector` 的英文词正则**不同**，不可互换。

## 4. 实现约定（每新增模块）

- **NavKey**：`NavigationKeys.kt` 加 `@Serializable data object/class`；`Navigation.kt` 注册 `entry<>`；`HomeScreen.toNavKey()` 或固定入口接入首页。
- **分层**：`data/<module>/<Module>Repository.kt`（OkHttp + TokenManager，`withContext(Dispatchers.IO)`）→ ViewModel（`MutableStateFlow` 私有 + `StateFlow` 公开，`stateIn(WhileSubscribed(5000))` 或手动 copy）→ Screen（`collectAsStateWithLifecycle`）。
- **UI**：文字默认纯黑 `Color(0xFF000000)`；强调色仅 绿`0xFF2E7D32` / 红`0xFFB71C1C` / 播放中浅蓝`0xFF90CAF9`；交互元素加 `contentDescription`。
- **音频**：TTS 走 `BaiduTtsCache`/`TtsEngine`（互斥、可取消）；拼音/音素走 `PinyinAudioPlayer`/`IpaAudioPlayer`。
- **网络**：统一 `NetworkModule.httpClient` + `ServiceModule.serverBase`；Auth 头用 `TokenManager`。
- **禁止**：UI 层直接调 LLM；Activity 生命周期写业务；AudioRecord 非单线程；DAO 直连。

## 5. 验证

- `.\gradlew.bat assembleDebug` 通过（本机无设备/模拟器，安装验证由用户手机完成）。
- 每批完成提交一次（`AiPhonix` 仓库，只含 `app/` 改动）。

## 6. 文档同步

- 本计划随实施进度更新（勾选已完成项）。
- 最终把关键进展追加到 `AiPhonix/PROJECT_MEMORY.md`。
