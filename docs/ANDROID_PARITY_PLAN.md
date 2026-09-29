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
| `Report` / ReportScreen | ⚠️ **不是** web 家长周报 | Android 的 `ReportScreen` 读 `/api/v1/practice/stats` + `/api/v1/practice/history`（App 自己的旧「学习报告」：练习次数/累计练习/总正确率/最近练习）；web `/module/parent_report` 是**家长周报**，数据源完全不同 ⇒ **两者不可互相替代**，见下方「剩余缺口」 |

### Web 有 / Android 缺失（本次补全清单）

| # | web 路由 / 页面 | Android 缺失 | 依赖 | 难度 |
|---|---|---|---|---|
| 1 | `/module/ai_english`（AI 英语识图） | ✅ AiEnglishScreen | 复用 ai-chinese parse-image `mode=english` + chat | 高 |
| 2 | `/module/ai_parse_result`（AI 识别结果页） | ⚠️ **结构差异（有意）**：Android 输入+结果**同屏**，不做独立结果页；blocks 渲染/问答/高亮已在，历史保存与恢复已具备 | web 独立结果页含 blocks 渲染/问答/高亮/历史 | 高（已覆盖） |
| 3 | `/module/ai_history`（AI 历史会话） | ✅ AiHistoryScreen + AiHistoryDetailScreen | localStorage 历史（web `aiHistory.ts`） | 中 |
| 4 | `/module/soe_history`（评测历史） | ✅ SoeHistoryScreen | `POST /soe/records` | 中 |
| 5 | `/module/pinyin-index` + `/module/pinyin/:id`（拼音表） | ✅ PinyinIndexScreen / PinyinDetailScreen | 静态数据 `web/src/data/pinyinTable.ts` 移植 assets + `/pinyin-audio` | 低 |
| 6 | `/module/wordbook`（生词本） | ✅ WordbookScreen | 词库/生词本接口 | 中 |
| 7 | `/module/memory_joy`（记忆快乐本） | ✅ MemoryJoyScreen | `/joy/list` + `/joy/:id` | 中 |
| 8 | `/module/char_map`（汉字地图） | ✅ CharMapScreen | char-images 全量 + feedback | 中 |
| 9 | `/module/diary`（成长日记） | ✅ DiaryScreen | 本地存储 + `/llm/chat` | 中 |
| 10 | `/module/radical_game`（偏旁魔法屋） | ✅ RadicalGameScreen | 静态字族 + `/radical/song|riddles` | 中 |
| 11 | `/module/speech_compose`（AI 对话学语文） | ✅ SpeechComposeScreen | chat + TTS + 文章分句 | 中 |
| 12 | `/module/ai_english_talk`（AI 英语对话） | ✅ EnglishTalkScreen | chat + TTS + 跟读阶梯 + ASR 判定 | 中 |
| 13 | `/module/courseware_manager`（课件库） | ✅ CoursewareScreen | 课件上传/管理接口 | 中 |
| 14 | `/module/daily_chinese` / `daily_english`（每日语文/英语） | ✅ DailyChineseScreen / DailyEnglishScreen | 每日内容接口/静态 | 中 |
| 15 | `/module/math_compound_expr`（综合算式动画） | ✅ MathCompoundExprScreen | **纯前端动画 + 本地规则引擎（零后端）** | 高 |
| 16 | `/module/subtitle_capture`（字幕采集） | ✅ SubtitleCaptureScreen | 视频帧选取 + OCR（Android 用 `MediaMetadataRetriever` + `Bitmap.createBitmap` 裁剪） | 高 |
| 17 | `/module/parent_report`（**家长周报**） | ✅ ParentReportScreen（入口在评测历史页，对齐 web） | `/soe/records`(200) + `/char-images/feedback` 的 **`stats`** + `/wordbook/list` | 中 |
| 18 | `/register`（注册页） | ✅ LoginScreen 已含注册（登录/注册 `FilterChip` 切换 + 注册额外字段 + `viewModel.register()`） | auth | 低（已结案） |
| 19 | `/module/sentence_practice`（造句练习） | ✅ SentenceComposeScreen | `AiChatRepository.ask("chinese")` + 每日语文句型 | 中 |

## 3. 实施批次（每批可独立构建验证）

> **进度（2026-09-22）**：批次 A（5/5）、批次 B（5/5）、批次 C（前半 4 + 后半 4）+ 家长周报（收官补齐）已全部完成
> （提交 `438d749` / `e418127` / `10b58fa` / `d491cf5` / `c0663cf` + `381585c` / `1670771` / `9850006` / 本轮）。
> `assembleDebug` BUILD SUCCESSFUL；`testDebugUnitTest` **374 用例 / 0 失败**（28 个测试类）。
> 已完成：拼音表、AI 历史、AI 英语、评测历史（A）；生词本、记忆快乐本、汉字地图、成长日记、偏旁魔法屋（B）；
> 课件库、每日语文、每日英语、造句练习（C 前半）+ 生词本「点读自动收录」接线（B 遗留）；
> **AI 对话学语文、AI 英语对话、综合算式动画、字幕采集（C 后半 4 个）**；**家长周报**。
> ✅ **21/21 个 web 模块全部移植完成**，收官核对结论见下方 §3.5。

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
- 🔴 **char-images 的类型过滤曾是失效的**：服务端 `char_images.ts` 读的是 **`type`**，而 web `services/charImages.ts` 与 Android `CharImageViewModel` 都在传 **`type_`** ⇒ 参数被静默忽略。生产实测：`type=认` → **816** 条，`type_=认` → **3028** 条（全量）。后果是「识字表 / 写字表 / 词语表」三个列表显示的是同一份混合内容。
  - ✅ **两端均已修复且已上线**（2026-09-22 复核：Android `CharImageViewModel` 两处 `type_=` → `type=`；web 源码自入库起即为 `qs.set("type", params.type_)`，修复已随 `index-PBqBgbjv.js` 构建上线——线上 charImages chunk 与本地 dist 字节一致、生产 entry 哈希相同，线上 API 实测 `type=认`→816 / `type=词`→729 / `type_=`→3028 全量）。
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
- ~~**每日英语缺 2 项 web 能力**~~ **已在本轮补齐**：phonics 音形着色 + 发音要领（见下方「批次 C 收官后补齐」小节）。
- **设置面板「拍照 OCR 自动填入」已完成**：每日语文（多图框选 + 拼音清洗）、每日英语（单图整页）均已移植 `OcrPickSheet` 系；前置依赖「字幕采集」区域裁剪早已具备。
- **造句练习的 `wrongChars` 照抄了 web 的古怪行为**：用学生原句的 `wrongs` 去 `includes` 检查 **AI 点评文本**里的每个字（web 如此，Android 保持一致；已在注释里标注）。
- **`LocalDate.now()` vs 服务端东八区**：web 用 `cstDate()`，Android 用设备本地日期 —— 在 UTC+8 设备（目标用户）上一致，已在注释写明。

### 批次 C 后半（本次会话）
18. **AI 对话学语文** ✅（详见下方小节）
19. **AI 英语对话** ✅（详见下方小节）
20. **综合算式动画** ✅（详见下方小节）
> 21. 字幕采集（SubtitleCapture，视频帧框选 + 区域 OCR —— 也是每日语文/英语「拍照识别填入」的前置依赖）✅（详见下方小节）
> 22. 家长周报（ParentReport，`/module/parent_report`）✅（收官补齐，详见 **§3.5**）

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
- **设置面板无拍照 OCR（与 web 一致，非 parity gap）**：web 端 `SpeechComposePage` 原本**就没有**拍照 OCR，所以 Android 也不做；这与「每日语文/每日英语/AI 英语对话」三处的 OCR（web 有、Android 已移植）是两回事，别误当成遗漏去补。

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

- ~~**「自己说」降级为「录一段 → 识别 → 判定」**~~ **已在本轮补齐**：自由模式改走 WebSocket 流式 ASR（`data/asr/StreamingAsrClient` ⇔ `/asr/stream` + `data/audio/StreamingPcmRecorder` 边录边发，hook 等价物 `ui/englishtalk/EnglishTurnAsr`），对齐 web `useEnglishTurn` 的 MID_TEXT/FIN_TEXT 口径与 pause/resume 生命周期。
- ~~**放弃 3 项依赖流式 ASR 的能力**~~ **已全部补齐**：① 逐词实时上屏（saidText+interimText+电平条）；② **6 秒静音自动挂阶梯**（`startGuided`：整句提示行 + EchoLadder 单词阶梯，复用 `EchoLadderState`）；③ 提示记录面板（`TalkHintRow` 列表 + 🔊 重听走 `playTts`，录音中自动暂停/恢复 ASR）。静音判定（300ms 轮询、能量阈值 0.02、首静默 6s、停顿 2s）在 `PauseWatch`（时钟可注入，已单测）。
- **不做「未作答自动给提示」的三级 hint**：web 也只做「停顿 → 提示下一个词」与「首静默 → 挂阶梯」，无三级 hint，本条本来就不是 gap。
- ⚠️ 与 web 的**有意差异**：提示行单词翻译没有 web 的「本地课标词库同步查」快路径（Android 无这份词库），一律走 `/daily-en/word-info`（面板首行显示晚一拍）。
- **「📷 拍照识词」已完成**：设置面板顶部的「拍照识词（推荐）」入口卡 → 整页 OCR（`/ai-chinese/parse-image` + `mode=english`）→ `EnVocabExtract` 抽词句（纯函数 + 单测）→ 勾选导入「练习单词 / 练习句子」。对齐 web `EnVocabPhotoSheet`。

  ⚠️ 与 web 的有意差异：识别阶段只有「处理图片 / 识别中」两档，`UPLOADING` 这一档在 Android 不可达（`parseImage` 一次 await 到底，无中间回调）；文案保持一致。
- **`EN_WORD_RE` 照抄 web 的三处反直觉行为**：连字符 `-` **不在**字符类内（`well-known` 切成 `well` + `known`）；数字切开（`world4u` → `world` + `u`）；非 ASCII 字母切开（`café` → `caf`）—— 与 `WordbookAutoCollector` 的英文词正则**不同**，不可互换。

#### 20. 综合算式动画 ✅（`/module/math_compound_expr`）

**零后端**：出题与讲解全部在本地算，`web/src/lib/compoundExpr.ts` + `precedence.ts` 整份移植为
`data/math/CompoundExpr.kt` + `data/math/Precedence.kt`（纯 Kotlin，可单测）。

教学法「找 → 换 → 查」：

| 步 | 动画 | 学生该看懂的事 |
|---|---|---|
| ① 找 | 两式里相同的那个数同时高亮（琥珀），一条**斜虚线真正连到两个数上**（两端带圆点） | 先找到「同一个数」 |
| ② 换 | ★ **转移动画**：① 的算式成为一块幽灵，从得数位置**起飞 → 沿弧线抬起放大 → 落到 ② 那个数字的位置并原位顶掉它**；① 的得数随即变淡（已被取走）；② 卡的 `= 得数` 同时隐藏（那时式子还没验证完，写等号会误导） | 哪个算式替代了原先数字的位置 |
| ③ 查 | **三小步**：先不加括号展示 → 把「按规矩会第一个算到」的运算符标**红**（点名具体是哪个）→ ★ **括号从算式两侧飞入 → 落位 → 向内夹紧**，被抱住的那一段亮**紫边紫底** → 按正确顺序**逐项绿高亮** | 顺序变没变、为什么必须加括号 |
| 不用加括号时 | 括号飞进来**想夹 → 停一下 → 夹不住被弹回去消散** | 括号是多余的 |

- **出题引擎**：4 个题型生成器（先加减后乘除 / 先乘除后加减 / 得数做被除数 / 得数做减数）+ 按权重随机 + 批量去重。
  - **反推参数**（先定得数再推操作数），保证 `a op b === result` 恒成立；
  - **巧合题拦截**：需括号的题若「去掉括号答案竟一样」直接丢弃（否则漏括号也算对，讲不出为什么要加括号）；
  - 题面规范：排除重复加数、排除「替换哪个数分不清」的歧义题、数值卡在三年级范围。
- **优先级引擎**（页内可展开的「🔢 先算谁？」小块，也是「查」这一步的前提）：产物是**计算顺序轨迹** `planSteps()`，动画只照着轨迹播；`why` 三值直接映射三句讲解文案。
- **单测（本轮新增 21 例，2 个类）**：
  - `CompoundExprTest`（11 例）：1000 道随机**全量校验**（分步自身算对 / 第②步必须引用第①步得数 / 代入得数后结果对 / 综合式重新求值 == `answer` / 括号判据与「去括号会不会变值」一致 / 括号配对 / 数值规模 / 无重复加数 / **动画不变量：`fromFirst` 必须是连续整块且中间是运算符**）。
  - `PrecedenceTest`（10 例）：两组页内示例的**硬编码常量**裁判 + 括号内优先级 + `nextOpIndex` 两规矩 + `reduceAt` 拆无用括号 + 随机 3000 例**交叉验算** + 轨迹不变量。
  - ★ 求值用了**互相独立的裁判**：本文件手写的递归下降 ↔ `Precedence` 的逐步化简（另一份移植）——两个不同实现给出同一个整数，才把「生成的题是对的」从信仰变成证明。

##### 三个 Compose 侧的实现要点（与 web 的对应）

1. **幽灵飞行**：web 用 WAAPI 的 4 段 keyframes；Compose 侧改成**单一进度 0→1 + 手写分段插值**
   （`ghostPose(t, dx, dy)`），蓄力段用 `easeOutBack` 复刻 `cubic-bezier(.34,1.56,.64,1)` 的手感。
2. **括号「交接无接缝」**：真括号**始终占位**（`alpha 0`）⇒ 不跳版；替身飞到位后真身立刻显形，
   且**绝不能给括号加透明度过渡**（否则会出现「括号闪一下」的空档）。时间常量与 ViewModel 的落位时刻**同源**（都取自 `MathCompoundExprViewModel.companion`）。
3. **坐标测量**：所有元素统一报 `boundsInRoot()`，取值时**只减基准容器**（`CeGeom.relTo(anchor, key)`）——
   切勿把「stage 内的数」与「resultBox 内的数」混着减（两者根本不在同一容器里）。
4. **优先级小动画用定宽槽位**（数字 38dp / 运算符 30dp / 间隔 7dp）：宽度可预知 ⇒「三块并成一个数」只用宽度过渡，
   **不必量尺寸**，扫描条的目标位置也能直接由槽位宽度累加算出（web 那边是量出来的）。
   `clipToBounds` 的槽位高度必须留够（±9dp 判级位移 + 上下余量），否则位移会被自己裁掉。

##### 批次 C 后半 · 综合算式动画的已知差异（有意为之，非遗漏）

- **动画未做逐帧核验**：web 靠抓帧 + 坐标断言（`getBoundingClientRect` 比对落位坐标）验证；本机**无设备/模拟器**，
  Android 侧只到「构建通过 + 引擎单测绿」，动画观感由实机验证补。
- **`prefers-reduced-motion` 换成系统动画缩放**：读 `Settings.Global.ANIMATOR_DURATION_SCALE == 0` 时直接跳到完成态。
- **易错卡的「滚到才揭晓」用 LazyColumn 天然实现**：web 是 `IntersectionObserver`（进入 50% 视口后 1.1s 揭晓），
  Android 把整页做成单个 `LazyColumn`，卡片滚到才进入 composition ⇒ 等效，且不需要观察者。
- **括号「夹紧」的紫边用 `drawBehind` 画**（不改变任何布局尺寸）⇒ 比 web 的负 margin 方案更稳，落位坐标不会因夹紧而漂。

#### 21. 字幕采集 ✅（`/module/subtitle_capture`）

打开影片（本地文件 / 云端直链 / B站搜索）→ 在画面上**框选字幕区** → 在某个时间点**截那一帧** → 存盘（文件名带时间戳）+ 交 LLM 识图出「原文 / 翻译 / 纠错 / 讲解」→ 结果卡片可回看、可重测、可跟读评分；框选过的位置会作为**书签**打在进度条上，播放到书签附近**自动暂停**提醒复习。

**分层**（`data/subtitlecapture/` + `ui/subtitlecapture/`）

| 文件 | 职责 |
|---|---|
| `SubtitleCaptureModels.kt` | 全部数据类（`CaptureItem` / `SubtitleEval` / `EvalCardModel` / `SubtitleMark` / `RectMemory` / `LastMovie` / `BiliItem` / `CaptureRequest` / `MovieSource`） |
| `SubtitleCaptureLogic.kt` | **纯函数 object**：时间戳格式、画框坐标换算与 clamp、书签命中、近邻分组、测评卡片合并、影片名推导 —— 逐条对齐 web，可直接 JVM 单测 |
| `SubtitleCaptureStore.kt` | SharedPreferences（沿用 web 的 localStorage key 名）：画框记忆 / 书签 / 上次影片 |
| `SubtitleCaptureRepository.kt` | `/subtitle-capture/*` 六个接口（multipart 上传、JSON 重测、列表、删除、B站搜索） |
| `VideoFrameCropper.kt` | **唯一需要 `Context` 的**：`MediaMetadataRetriever` 取帧 + 旋转校正 + 裁剪 + PNG 压缩 |
| `ui/subtitlecapture/` | ViewModel（UDF，不持 `Context`）+ Screen（`ExoPlayer`/`PlayerView`、框选叠加层、进度条书签、结果卡片列表） |

##### ★ 抓帧：web 靠 canvas，Android 只能走 MediaMetadataRetriever

| web | Android | 说明 |
|---|---|---|
| `<video>` + `canvas.drawImage` | `getFrameAtTime(ms*1000, OPTION_CLOSEST)` + `Bitmap.createBitmap` 裁剪 | 必须 `OPTION_CLOSEST`：`OPTION_CLOSEST_SYNC` 只给关键帧，可能差好几秒，字幕早换句了 |
| `video.videoWidth/Height`（旋转后尺寸） | 同尺寸 **+ 手动 `Matrix.postRotate`** | 竖拍手机 `METADATA_KEY_VIDEO_ROTATION = 90`，不校正会裁错位置 |
| —— | 画框 clamp 到帧内 | `createBitmap` 越界会抛 `IllegalArgumentException` |
| —— | **不能抓控件** | `PlayerView` 底层是 `SurfaceView`，`View.draw(Canvas)` 抓不到画面 |
| 影片文件存 IndexedDB（重启自动续播） | 只存 SAF URI + `takePersistableUriPermission` | 不做持久化授权，重启后 URI 失效、静默播不出来 |
| B站用 `<iframe>` 嵌播放器 | `WebView` 载 B站播放页 | **两端都不能采集**（无帧数据），行为一致 |

##### ★ 逐条对齐的「神奇数字」（**不能统一**，各自有出处）

- 书签展示容差 **800ms（含边界 `<=`）** / 自动复习容差 **400ms（严格 `<`）** / `saveMark` 去重窗口 **300ms** / 服务端缓存命中窗口 **500ms** / 近邻截图分组 **1500ms**。
- 近邻分组是**只比相邻两项、不展开传递性**（`a~b`、`b~c` 成立不代表 `a~c` 一组）。
- `lastTime` 保留**原影片名**：web `saveLastTime` 即使当前片名不同也保留存着的名字 → Android 照抄，避免进度被写到另一个影片名下。
- ★ 路由**整段挂 `requireAuth()`**，**包括 `GET /file/:fileName`** ⇒ 截图直链必须 `Coil` 手动加 `Authorization` 头；web 靠 `api()` 的 fetch 自动带 token，`<img src>` 在 Android 会 401。

##### ★ 单测（本轮新增 19 例，1 个类）

`SubtitleCaptureLogicTest` —— 期望值**全部来自 `web/_subcap_probe.mjs`**（把 web 的 `fmt` / `restoreRectForMovie` / 近邻分组 / 书签命中 / `openUrl` 取名 / `mousemove` clamp 原样复制到 node 跑出来的，**不是**按语义推导）。这一步当场抓出一个真差异：`java.net.URL` 比 WHATWG `new URL()` 宽松（空格主机名 JS 抛错、JVM 静默接受）⇒ 改用严格的 `java.net.URI`。

##### 批次 C 后半 · 字幕采集的已知差异（有意为之，非遗漏）

- **云端直链截图不需要 CORS**：web 受浏览器同源策略限制（截图失败 = 未开 CORS），Android 原生请求无此限制 —— 这是**能力提升**，但提示文案沿用了 web 的说法，实机上若看到该句可以直接忽略。
- **八向缩放手柄不做负偏移**：web 用「10px 圆点 + 负偏移压住框线」，Compose 里超出父边界的子元素收不到手势 ⇒ 就地贴边放在框内（视觉略靠内，但一定可拖）。
- **进度条书签点与 Slider 轨道有几 dp 偏差**：web 是绝对定位的 div，Compose 侧受 `Slider` 内建 padding 影响。
- **自动复习用「状态驱动」而非事件通道**：VM 只把 `pendingAutoPauseTs` 挂状态，Screen 观察到后**先 `player.pause()` 再 `consumeAutoPause()`**（顺序不能反，否则朗读会被继续播放打断）。
- **B站内嵌预览不能采集**：与 web 一致（web 的 iframe 同样拿不到帧）。

## 3.5 移植现状结论（2026-09-22 收官核对）

**已移植 21 / 21 个 web 模块 —— 全部完成** ✅。差距表 #1–#19 全部 ✅；#2 是结构差异（Android 输入+结果同屏，能力已覆盖）。

> **2026-09-29 追加**：web 侧后来又新增了「等式变变变」（路由键 `module/math_equation_move`，见 `web/src/routes.tsx:120`），Android 已同步移植（见下方「批次 C 收官后新增：等式变变变」）。此后若 web 再新增模块，需先 `grep -n 'path: "module/' web/src/routes.tsx` 对一遍清单（⚠️ 路由键**不带前导斜杠**、且新页未必按序追加），不要只看本文档的旧表。

### ✅ 家长周报（`/module/parent_report`）—— 已补齐（原本是唯一真缺口）

web `ParentReportPage.tsx`（149 行）是一份**给家长看的近 7 天周报**（打印友好）：

| 区块 | 口径 |
|---|---|
| 四张卡 | 本周发音评测次数 / 本周平均分（无分显示 `—`）/ 已点亮字词 = `fbStats.correct` / 生词本收藏 = `words.length` |
| 📅 每日评测次数 | 近 7 天柱状图（**今天在最右**），柱高 = `count / maxCount`（`maxCount` 至少 1） |
| 📖 识字状态 | 认识(绿) / 不确定(橙) / 还不会(红) |
| 🎯 需要多练的词 | 近 30 天、按 `ref_text`（**去空白 + 截前 8 字**）分组取**最低分**，筛 `< 80`，**升序**取前 8 |
| 页脚 | 生成时间 + AiPhonix |

- 本周平均分 = 近 7 天里 `suggested_score > 0` 的记录求平均（四舍五入）；逐日平均分同法，无分为 `null`。
- 数据源 3 个，**Android 都有对应仓储**：`/soe/records` → `SoeRecordRepository.fetchRecords(200)` ／ `/wordbook/list` → `WordbookRepository.list()` ／
  `/char-images/feedback`(`limit 100000`) 的 **`stats: {correct, wrong, unsure, unmarked}`** —— 原先 `CharMapRepository.feedbackStatus()` **只取 `items`、把 `stats` 丢了**，已**新增** `feedbackWithStats(userId)`（非破坏性，`feedbackStatus` 改为委托它，两处共用同一次请求）。
- ★ **没动 `ReportScreen`**：它是 `entry<Report>` 里本 App 自己的「学习报告」（读 `/api/v1/practice/stats`），与 web 家长周报**不是同一功能**；家长周报按**新模块**落地为 `ParentReportScreen` + 新 NavKey `ParentReport`，入口放在**评测历史页**（与 web `SoeHistoryPage` 的「📈 家长周报」按钮位置一致）。

**实现（`data/parentreport/` + `ui/parentreport/`）**

| 文件 | 职责 |
|---|---|
| `ParentReportLogic.kt` | **纯函数引擎**：`days7` / `weekCount` / `weekAvg` / `weakWords`（可 JVM 单测） |
| `ParentReportRepository.kt` | 只做**聚合**：`supervisorScope` + 三路 `async` 并发；部分失败降级为空、三路全失败才置 `failed` |
| `ui/parentreport/ParentReportViewModel.kt` | UDF；全部派生量（`maxCount` / `weekAvgText` / `generatedAt`）在此算好 |
| `ui/parentreport/ParentReportScreen.kt` | 2×2 统计卡 / 7 天柱状图 / 识字状态 / 需多练的词 / 页脚；配色逐条取 web `App.css` 的 `.report-*` |

- **单测 21 例（新增 1 类）`ParentReportLogicTest`**：期望值来自把 web 原逻辑复制到 node 跑的探针（`TZ=Asia/Shanghai`，含空集场景）。
- ★ **两条 web 行为必须保留**（看着像 bug，实为口径）：
  1. **日期 key 用设备本地时区，记录侧却拿 `created_at` 前 10 字符（UTC 日期）比** ⇒ 在 UTC+8 上，本地 00:00–08:00 产生的记录会归到**前一天**那一列（已用单测钉死：本地 22 日 00:10 的记录落在 21 日列）。
  2. **「需多练」的 30 天 cutoff 是 `toISOString()` 的 UTC 日期**，与 ① 的本地 key **不同源**（已测：`08-23T00:00Z` 入选、`08-22T23:59Z` 出局）。
- `weakWords` 三条细节：`ref_text` 去空白用 **JS 空白集**（`util/removeJsWhitespace`，含全角空格/NBSP/BOM）再截前 8 字；同组取**最低分**；同分按**首次出现顺序**（`LinkedHashMap` + 稳定 `sortedBy`）。
- `suggested_score` 是数据库 `real` ⇒ 显示加 `util/jsNumber`（复刻 JS `String(number)`，否则 `85f` 会打成 `"85.0"`，与 web 的 `85` 不一致）。
- **与 web 的唯一显示差异**：三路数据全失败时显示「⚠️ 统计数据加载失败（断网）」，而 web 会显示一片 0（避免家长误以为孩子这周没练）。

### 批次 C 收官后补齐：每日英语 phonics 着色 + 发音要领（本轮）

把 web `DailyEnglishPage` 的「音形着色 + 低分音素发音要领」三件套逐位移植到 Android：

- **规则引擎** `data/phonics/PhonicsSegmenter.kt`：逐位移植 web `lib/phonics.ts`（确定性规则，带 4000 条 LRU 式缓存）。七类 `PhonicType`（VOWEL_SINGLE/LONG/TEAM、DIGRAPH、SILENT、CONSONANT、OTHER，只 consonant/other 可合并）。关键口径：**块数优先于标签**、例外词表优先于规则、magic-e 先占位后定色（防 `house`/`please`/`choose` 顺序 bug）、组合按长度降序（`tch`>`ch`）、词尾长元音族、`-tion` 软音、屈折 e（`wanted` 的 e 是真元音）、成音节 l（`-le`）、不发音字母族（kn/wr/sign/lamb/-alk/gu-/-que）。
- **例外词表** `data/phonics/PhonicsExceptions.kt`：66 条与 web 逐字一致。⚠️ 码表**大小写敏感**：`v`=vowel-single、`V`=vowel-long（`who` 的 `o` 是 `v` 即 single——探针实证过，别按语义猜）。
- **发音要领** `data/phonics/PhonemeTips.kt`：44 条本地表 + `phoneTip` 归一化查找（大写 + 去尾重音数字 `ah0`→`AH`、逗号 r 合并 `ih,r`→`IHR`；`ah0` 命中 **VOWEL** 类的 `AH`，不是 `AH0` 的 OTHER）+ `tipSpeechText` 两处正则清洗（定界符 `/f/`/`[th]`、句式 `的f时` → "这个音"，防百度 TTS 把孤立字母读成字母名）。
- **全局开关** `data/audio/PhonicsColorStore.kt`：SharedPreferences + StateFlow（默认开），模板照 `PronunciationStyleStore`；`AppContainer` 注入。
- **UI** `ui/common/PhonicsText.kt`：`PhonicsText`（七类配色对齐 web `App.css` 浅色主题，SILENT 加虚线下划线）+ `PhonicsToggle`。`DailyEnglishScreen` 接线：单词卡/例句/句子三处文本着色、顶栏开关、`PhoneChips` 对 **bad 类（非 miss）**音素渲染本地要领 + 🔈 朗读（`ViewModel.speakPhonemeTip`，状态 `speakingTip` 切 🔊/🔈）。
- **单测** 13 例全绿（Segmenter 8 + Tips 5），期望值全部来自跑 web 真实现的探针（`tsx` 跑 `segmentPhonics`/`phoneTip`/`tipSpeechText`，探针用毕即删）。
- ★ **JVM 正则移植陷阱**（连踩三轮才定位）：`java.util.regex` **支持嵌套字符类**——类内未转义的 `[` 会被当成「嵌套类」开启、一路吞到下一个 `]`，把中间的分组全部吃掉，报错位置（`Unmatched closing ')'`）极具误导性（JS 不支持嵌套类，`[` 在类内是字面量）⇒ 移植 JS 正则时类内 `[` 必须转义 `\[`；且 JVM 对 `]` 作类成员的解析与 JS 不同 ⇒ 定界符集合改用「选择分支」`(?:/|\\|]|）|\))`。教训：**JS 正则逐字照抄到 Kotlin 必挂，逐构造在 JVM 实测后再落码**。

### 批次 C 收官后新增：等式变变变（动画学数学 第 2 页｜2026-09-29）

> **2026-09-29 追加（本批次）**：出题引擎扩到 **13 题型**、动作模型扩到 **4 种**（move / swap / combine / flip），新增「首项显形」动画与 5 选项练习卡，单测 16 → **27 例**。web 侧同一批改动已重建并 CF 上线（入口 `index-B-L1pf7k.js`）。

**等式变变变**（`/module/math_equation_move`）—— **零后端**：`web/src/lib/equationMove.ts` → `data/math/EqMove.kt`，`web/src/pages/EquationMovePage.tsx` → `ui/eqmove/`（VM + Screen）。NavKey `EqMove`，首页「🧮 动画学数学」小节第 2 张卡。

教学法「找 → 飞 → 落 → 算」：① 要搬走的那一整块脉动高亮 → ② ★ 越过**等号分界线**（上下两段虚线 + 「等号 = 分界」标签），**跨线那一瞬符号翻牌** + 竖线闪光 → ③ 落在对侧末尾、源侧原位**只变灰划掉不删除** → ④ 算出结果并把答案**代回原式**验算 ✓。★ **四条动作线**：**move**（跨线搬运、必翻符号）、**swap**（同侧换位、符号一点不动）、**combine**（同侧合并同类项）、**flip**（两边整体对调）。🔴 **只有 move 有「落位槽」**，另外三种**一个字节都不跨等号线** ⇒ 必须走 FLIP 那条路，绝不能进幽灵飞越（否则「同侧换位不变号」会被画成「整块飞过等号」，**教学上正好教反**）。

| 层 | 文件 | 说明 |
|---|---|---|
| 引擎 | `data/math/EqMove.kt` | 纯 Kotlin：**13 题型**（基础 7 + 首项显形 / 未知数在右 / 一边三项 / 两边都有 x / 两步）+ **4 种动作模型**（`move` / `swap` / `combine` / `flip`）+ 加权池随机 + **随机 6 题**练习生成 + 静态口诀/易错/对比练习资料 |
| VM | `ui/eqmove/EqMoveViewModel.kt` | `EqPhase`（IDLE/FIND/FLY/LAND/SLIDE/SOLVE/DONE）+ 确定性事件表（`T_FIND/T_FLY/T_LAND/T_SOLVE/T_SLIDE`，Screen 同源取用）；随机 6 题与计分也在这里 |
| Screen | `ui/eqmove/EqMoveScreen.kt` | 单 `LazyColumn`；幽灵飞越翻牌 / 等号分界线 / 落位槽 / 同侧滑动 FLIP / 练习区 |

- **引擎单测 27 例（新增 1 类）`EqMoveTest`** ⇒ 全量 **471 用例 / 0 失败 / 35 类**（此前 444 / 34）。★ 两个**互相独立**的裁判：逐项序列求值 ↔ **渲染成文本再解析求值**。★ `checkProblem` 按 `a.type` 分支校验四种动作各自的守恒律（MOVE 翻符号 / SWAP 不动符号 / COMBINE 项数 −1 / FLIP 左右对调）。
- 🔴 **顶层命名必须加 `Eq` / `eq` / `EQ_` 前缀**：与 `CompoundExpr.kt`、`Precedence.kt` **同包**（`com.example.ai.data.math`），Kotlin 顶层声明同包不能重名；那边已有 `KIND_LABEL` / `RULES` / `MISTAKE_CASES` / `rndInclusive` / `generateProblem`。`Precedence.kt` 用 `P` / `Pr` / `PR_` 前缀避让，本页沿用同一惯例。
- ⚠️ **同侧交换的断言别按「显示形态」拼串比较**：首项不写符号是显示约定。`5 + x` 是 `[(null,"5"),(+, "x")]`、`x + 5` 是 `[(null,"x"),(+, "5")]`，用 `"${op?.sym ?: ""}${value}"` 排序后会得到两个不同的列表。正确口径：整体求值不变 + 第二项符号仍是 `+` + 逐项「语义符号 + 值」比较。
- ★ **翻牌时刻不能写死**：幽灵在哪个进度跨过等号线取决于**实测几何**（源项中心 ↔ 等号线 ↔ 落位槽）⇒ 由 Screen 在飞行动画跑到 `cross` 时回调 `viewModel.onGhostCrossed()`（VM 只管状态，Screen 管几何与动画）。
- 与 web 逐条对齐：落位槽**从动画一开始就 alpha 0 占位**（宽度不变 ⇒ 落点像素级准确）、源侧项**变灰 + 划掉但不删除**、同侧交换用 **FLIP 且上下错开**（否则两项半路叠成一个「x5」）。★ **combine 后文本变了**（`3x`/`-2x` → `x`）⇒ 找不到旧位就安静收场、只留紫色高亮，**与 web 同款行为**（`EquationMovePage.tsx:361`）。
- 🔴 **FLIP 的位置上报 key 必须带侧别前缀**：`geom.report("$valuePrefix${term.value}")` 存的是 `lval-8`，查表若写成 `prevSide[term.value]`（少前缀）⇒ **全部落空**、`?: return@forEachIndexed` **静默提前返回**，同侧滑动「看着实现了、其实从未动过」（本轮真实 bug）。web 侧靠 `.eq-side-${side}` 选择器把查询限定在一侧内，文本 key 才敢不带前缀（`EquationMovePage.tsx:348-361`）—— Compose 没有 DOM 选择器可依托，前缀必须落在 key 上。

#### 等式变变变的已知差异（有意为之，非遗漏）
- **动画未做逐帧核验**：本机无设备/模拟器 ⇒ 只到「APK 构建通过 + 全量单测绿」，观感由实机验证补。
- `prefers-reduced-motion` 换成系统动画缩放（`ANIMATOR_DURATION_SCALE == 0` ⇒ 直接跳完成态）。
- 易错卡「滚到才揭晓」用 LazyColumn 天然实现（等效 web 的 `IntersectionObserver`）。
- 题型选择排成 3 行 / chips 排成 2 行（web 是 flex-wrap，窄屏 320 会顶出横向滚动）。

### 有意保留的能力降级（非遗漏，别当 bug 修）

- ~~**每日英语缺 2 项**~~ **已补齐**（本轮）：phonics 音形着色（`data/phonics/` 规则引擎逐位移植 web `lib/phonics.ts` + 66 条例外表）、「发音要领」（44 条本地 `phonicsTips` 表 + `tipSpeechText` TTS 清洗）；每日英语三处文本着色 + 顶栏开关 + 评测明细低分音素要领卡均已接线。
- ~~**AI 英语对话缺流式 ASR 相关 3 项**~~ **已补齐**（本轮）：逐词实时上屏 / 6 秒静音自动挂阶梯 / 提示记录面板（见「批次 C 后半 · AI 英语对话」小节）。
- **「拍照 OCR 自动填入」已全部落地**：每日语文（多图框选 + 拼音清洗）、每日英语（单图整页）、AI 英语对话（整页识词抽句）三处设置面板均已移植，对应 `OcrPickSheet` / `EnVocabPhotoSheet` 系 + `EnVocabExtract` 抽词规则。AI 对话学语文（web 本就无 OCR）是**唯一**不做的一处，不是 parity gap。
- 结构差异（有意）：AI 识别结果页输入+结果同屏；汉字地图状态取「最新」（web 取最旧是笔误）；生词本朗读不锁多音字；评测历史/汉字地图点击不定位到具体字。
- B站内嵌预览两端都不能采集（web 是 iframe、Android 是 WebView，都拿不到帧）。

### 非 app 范围（web 侧待修）

- ~~`web/src/services/charImages.ts` 的 `qs.set("type_", …)` → `qs.set("type", …)`~~ **已闭环（2026-09-22）**：web 源码实际一直是 `qs.set("type", params.type_)`（自 `64c6899` 入库起），修复已随 `index-PBqBgbjv.js` 上线；线上 API 复测 `type=认`→816 / `type_=认`→3028，前端请求走的是正确参数。此前「web 侧未修」的记录是过时结论。

## 4. 实现约定（每新增模块）

- **NavKey**：`NavigationKeys.kt` 加 `@Serializable data object/class`；`Navigation.kt` 注册 `entry<>`；`HomeScreen.toNavKey()` 或固定入口接入首页。
- **分层**：`data/<module>/<Module>Repository.kt`（OkHttp + TokenManager，`withContext(Dispatchers.IO)`）→ ViewModel（`MutableStateFlow` 私有 + `StateFlow` 公开，`stateIn(WhileSubscribed(5000))` 或手动 copy）→ Screen（`collectAsStateWithLifecycle`）。
- **UI**：文字默认纯黑 `Color(0xFF000000)`；强调色仅 绿`0xFF2E7D32` / 红`0xFFB71C1C` / 播放中浅蓝`0xFF90CAF9`；交互元素加 `contentDescription`。
- **音频**：TTS 走 `BaiduTtsCache`/`TtsEngine`（互斥、可取消）；拼音/音素走 `PinyinAudioPlayer`/`IpaAudioPlayer`。
- **网络**：统一 `NetworkModule.httpClient` + `ServiceModule.serverBase`；Auth 头用 `TokenManager`。
- **禁止**：UI 层直接调 LLM；Activity 生命周期写业务；AudioRecord 非单线程；DAO 直连。

## 5. 验证

本机跑 Gradle 需要显式给 `JAVA_HOME`（`JAVA_HOME` 默认是空的）：

```bash
cd AiPhonix
export JAVA_HOME="C:/Program Files/Java/jdk-21.0.11"
./gradlew :app:assembleDebug --console=plain          # 冷启动约 14 min（首次全量 dex）
./gradlew :app:testDebugUnitTest --console=plain      # 全量单测
```

- **最近一次门禁（2026-09-29，13 题型 / 4 动作批次）**：`assembleDebug` ✅；全量单测 **471 用例 / 0 失败 / 0 错误 / 0 跳过，35 个测试类**（`app/build/test-results/testDebugUnitTest/*.xml` 汇总）。
- 只跑新增模块的引擎单测可提速：`./gradlew :app:testDebugUnitTest --tests "com.example.ai.data.math.EqMoveTest"` ⇒ **算法文件先配单测跑通再写 UI**，别把错误带进 Screen（Screen 报错定位成本远高于引擎）。
- 本机无设备/模拟器 ⇒ 安装与动画观感由用户手机验证。
- 每批完成提交一次（`AiPhonix` 仓库，**只 `git add app/ docs/ PROJECT_MEMORY.md`**，绝不 `git add -A`）。
- ⚠️ 本机 Gradle 提示 `14 busy and N stopped Daemons could not be reused` 属正常（历史遗留 daemon 多），不影响构建结果。

## 6. 文档同步

- 本计划随实施进度更新（勾选已完成项）。
- 最终把关键进展追加到 `AiPhonix/PROJECT_MEMORY.md`。
