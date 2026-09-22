package com.example.ai

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

@Serializable data object Home : NavKey          // 首页
@Serializable data object EnglishLearning : NavKey // 英语学习主页
@Serializable data object LetterIndex : NavKey    // 字母网格索引
@Serializable data class Letter(val char: String = "a") : NavKey  // 字母学习
@Serializable data class Phonics(val phonemeIndex: Int) : NavKey        // 自然拼读
@Serializable data object PhonemeIndex : NavKey    // 音标总表
@Serializable data class Practice(val wordId: String) : NavKey    // 跟读录音
@Serializable data class Result(val wordId: String) : NavKey     // 纠音结果
@Serializable data object Report : NavKey          // 学习报告
@Serializable data object VideoPractice : NavKey // 视频跟读
@Serializable data class Quiz(val videoName: String, val srtPath: String) : NavKey // 视频考试

// 语文练习模块
@Serializable data object ChinesePractice : NavKey                // 语文练习主页
@Serializable data object Recognition : NavKey                    // 认字
@Serializable data object Dictation : NavKey                      // 默写
@Serializable data object WordPractice : NavKey                   // 词语

// 看图识字
@Serializable data object CharImageRecognition : NavKey              // 看图识字主页（年级选择）
@Serializable data class CharImageGradeSelection(
    val grade: String,
    val semester: String,
) : NavKey                                                           // 年级内类型选择（识字表/写字表/词语表）
@Serializable data class CharImageList(
    val grade: String,
    val semester: String,
    val type_: String = "",                                           // "认" / "写" / "词" / "英词" / "英句"
) : NavKey                                                           // 图片列表（过滤后）

// 英语学习 → 词汇/句子练习（直接复用 CharImageList 列表页）
@Serializable data object VocabularyPractice : NavKey                  // 词汇练习（英词）
@Serializable data object SentencePractice : NavKey                    // 句子练习（英句）

// 口述作文
@Serializable data object OralWriting : NavKey                       // 口述作文
@Serializable data object Login : NavKey                              // 登录

// 每日一练（语数英三板块，内容后续添加）
@Serializable data object DailyPractice : NavKey                      // 每日一练主页

// 导入中心（LLM 费用外移：提示词 → 用户 LLM → 粘贴回 → 本地加工）
@Serializable data object ImportCenter : NavKey                       // 导入学习内容
@Serializable data object MyImports : NavKey                           // 我的导入（查看/删除已导入内容）

// 导入数据训练（消费端：本地题库/句子跟读/我的学习聚合页）
@Serializable data object MyLearning : NavKey                          // 我的学习（聚合统计+训练入口）
@Serializable data object QuizPractice : NavKey                        // 本地题库练习（导入的题目）
@Serializable data object SentenceReading : NavKey                     // 句子跟读练习（导入的句子）

// 文章跟读（TTS 朗读 + 段落口述 + 读后问答）
@Serializable data object ArticleList : NavKey                         // 文章列表（导入的文章）
@Serializable data class ArticleReading(val articleKey: String, val title: String) : NavKey
@Serializable data class ArticleQuiz(val articleKey: String, val title: String) : NavKey

// 账户详情页（错题本/掌握情况/待确认/退出登录）
@Serializable data object Account : NavKey                            // 我的账户
@Serializable data class FeedbackList(val status: String) : NavKey    // 反馈详情列表（错题本/掌握/待确认）
@Serializable data object SoeHistory : NavKey                          // 评测历史（发音评测明细，对齐 web SoeHistoryPage）

// 家长设置（PIN 保护：家长动态决定学生首页的页面集合/今日任务）
@Serializable data object ParentSettings : NavKey                     // 家长设置

// AI 陪我练（LangGraph 多轮引导对话）
@Serializable data object AiPractice : NavKey                          // AI 陪我练主页（导入+历史）
@Serializable data class AiPracticeChat(
    val sessionId: Int,
    val content: String = "",
) : NavKey                                                             // 会话页（active 续聊 / done 只读）

// AI 作业（数学应用题：识题 → 关键信息提示 → ASR 思路评判）
@Serializable data object AiHomework : NavKey                          // AI 作业主页（拍照/相册/输入题目）
@Serializable data object AiChinese : NavKey                           // 语文（与数学同构的科目模块）
@Serializable data class AiHomeworkPractice(
    val question: String,
    val payload: String = "",
) : NavKey                                                             // 题目练习页（分句朗读/提示/讲思路）
@Serializable data object AiHomeworkCharStats : NavKey                 // 认读画像（字被点击发音次数）

// AI 英语（拍照/相册识别英语课文 mode=english + 文本多轮对话；对齐 web AiEnglishPage）
@Serializable data class AiEnglish(
    val resumeSessionId: String = "", // 非空 = 从历史恢复会话续聊
) : NavKey

// AI 历史会话（chinese/math/english 三桶本地存储；对齐 web AiHistoryPage）
@Serializable data object AiHistory : NavKey                            // AI 历史列表
@Serializable data class AiHistoryDetail(
    val module: String,
    val id: String,
) : NavKey                                                             // 历史详情（识别快照只读回看）

// 拼音练习（SOE 拼音评测：看拼音读，≥70 过关）
@Serializable data object PinyinExercise : NavKey                       // 拼音练习主页

// 拼音表（声母/韵母/整体认读音节 索引 + 详情，点读发声）
@Serializable data object PinyinIndex : NavKey                          // 拼音表索引
@Serializable data class PinyinDetail(val id: String) : NavKey          // 拼音详情（横向滑动）

// 碎碎念（自由表达 → AI 语法纠错 → 正确句子朗读+测评）
@Serializable data object Murmur : NavKey                                // 碎碎念主页

// ── 批次 B：识字与记录类模块（对齐 web） ──
@Serializable data object Wordbook : NavKey                             // 生词本（SRS 间隔重复复习 + 词表）
@Serializable data object MemoryJoy : NavKey                            // 记忆快乐本（当日字词编成文段，按日期分组）
@Serializable data object CharMap : NavKey                              // 汉字地图（全部字卡铺图，评价过的点亮）
@Serializable data object Diary : NavKey                                // 成长日记（本地记录 + AI 润色点评）
@Serializable data object RadicalGame : NavKey                          // 偏旁魔法屋（换偏旁识字：选字/选偏旁/字谜/儿歌）

// ── 批次 C：家长端与每日一练（对齐 web） ──
@Serializable data object Courseware : NavKey                           // 课件库（语/数/英课件图片上传与管理，家长端）
@Serializable data object DailyChinese : NavKey                         // 每日语文（家长设今日字词句/作文主题，4 个练习入口）
@Serializable data object DailyEnglish : NavKey                         // 每日英语（家长设今日单词/句子，单词卡+句子卡）
@Serializable data object SentenceCompose : NavKey                      // 造句练习（给词造句，AI 老师批改）
@Serializable data object SpeechCompose : NavKey                        // AI 对话学语文（一问一答 / 古诗 / 文章背诵跟读）
@Serializable data object AiEnglishTalk : NavKey                        // AI 英语对话（AI 给台词+回答 → 跟读阶梯 / 自己说 → ASR 判定）

// ── 动画学数学 ──
@Serializable data object MathCompoundExpr : NavKey                     // 三年级上综合算式动画（找→换→查，带飞入/位移教学动画）

// ── 视频 ──
@Serializable data object SubtitleCapture : NavKey                      // 字幕采集（框选影片字幕区 → 截屏存盘带时间戳 + 识图翻译纠错）

// 信息猎人（已删除：引导改由「闯关」模块大模型现场出题）
