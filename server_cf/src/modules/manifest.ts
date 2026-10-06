/**
 * 后端模块清单 —— server_cf 侧（生产 Worker）。
 *
 * 目的：把原先散在 `index.ts` 里的「40 行 import + 20 行 api.route()」收敛成**一份有序数据**，
 * 让「有哪些模块」可被程序读取（而不是靠人肉读入口文件），从而：
 *   1. `index.ts` 只负责「按清单挂载」，不再承担清单本身；
 *   2. 双端 parity 门禁能按 **模块 id** 比对（见 server_ts/tests/routeParity.test.ts）。
 *
 * ⚠️ **数组顺序 = 挂载顺序，不可随意调整。**
 * Hono 的子应用 `route()` 会把子应用中间件合并进父应用，顺序决定合并结果与路由匹配优先级。
 * 历史事故（skill `aiphonix-backend-parity` §4）：`/llm` 前缀下挂 4 个子应用，
 * 其中某个用了无路径 `router.use(mw)`，把守卫泄漏成了 `/llm/*` 全匹配，学生端接口整片 403。
 *
 * ⚠️ **两端是同构的手工副本**（server_cf 不能在 pnpm 工作区里跨 junction 构建，
 * 故不是 `export * from server_ts`）。本文件与 `server_ts/src/modules/manifest.ts`
 * **必须成对修改** —— 门禁会红，但门禁只管端点集合，不管顺序，顺序仍靠人。
 */

import type { Hono } from "hono"

import authRoutes from "../routes/auth.js"
import usersRoutes from "../routes/users.js"
import userImportsRoutes from "../routes/user_imports.js"
import uploadsRoutes from "../routes/uploads.js"
import coursewareRoutes from "../routes/courseware.js"
import essaysRoutes from "../routes/essays.js"
import englishRoutes from "../routes/english.js"
import wordbankRoutes from "../routes/wordbank.js"
import chinesePracticeRoutes from "../routes/chinese_practice.js"
import practiceRoutes from "../routes/practice.js"
import practiceTrackerRoutes from "../routes/practice_tracker.js"
import trainingRoutes from "../routes/training.js"
import dailyZhRoutes from "../routes/daily_zh.js"
import dailyEnRoutes from "../routes/daily_en.js"
import generatedDictRoutes from "../routes/generatedDict.js"
import joyRoutes from "../routes/joy.js"
import importTemplatesRoutes from "../routes/import_templates.js"
import charImagesRoutes from "../routes/char_images.js"
import opsRoutes from "../routes/ops.js"
import pinyinAudioRoutes from "../routes/pinyin_audio.js"
import ipaAudioRoutes from "../routes/ipa_audio.js"
import quizRoutes from "../routes/quiz.js"
import wordSuggestionsRoutes from "../routes/word_suggestions.js"
import llmRoutes from "../routes/llm.js"
import chineseRoutes from "../routes/chinese.js"
import aiChineseRoutes from "../routes/ai_chinese.js"
import aiHomeworkRoutes from "../routes/ai_homework.js"
import aiPracticeRoutes from "../routes/ai_practice.js"
import aiChatRoutes from "../routes/ai_chat.js"
import asrRoutes from "../routes/asr.js"
import wordbookRoutes from "../routes/wordbook.js"
import radicalRoutes from "../routes/radical.js"
import arkImageRoutes from "../routes/ark_image.js"
import freeLlmRoutes from "../routes/free_llm.js"
import appLlmRoutes from "../routes/app_llm.js"
import ttsRoutes from "../routes/tts.js"
import soeRoutes from "../routes/soe.js"
import subtitleCaptureRoutes from "../routes/subtitleCapture.js"
import biliRoutes from "../routes/bili.js"
import visitsRoutes from "../routes/visits.js"
import prefsRoutes from "../routes/prefs.js"
import videoIssuesRoutes from "../routes/video_issues.js"

export interface BackendModule {
  /** 模块 id —— **两端共用同一命名**（路由文件名，下划线风格）。门禁按它比对。 */
  id: string
  /** 挂载目标：`api` = 挂进 `/api/v1` 子应用并按 prefix 分组；`app` = 直接挂到 `/api/v1`。 */
  target: "api" | "app"
  /**
   * 挂载前缀，**不带前导斜杠**；空串 = 直接挂 `/api/v1`
   * （路由文件内部已自带完整路径，如 ai_chinese 内部就是 `/ai-chinese/...`）。
   *
   * 多个模块可共用同一前缀（`practice` ×2、`llm` ×4）—— 这是有意为之，
   * 因为它们本来就是同一前缀下的不同子路径，且顺序敏感（见文件头警告）。
   */
  prefix: string
  /**
   * 是否属于「最小核心」—— **保留字段，当前一律未设置、对运行无任何影响**。
   * 只有真要拆「核心 Worker / 全量 Worker」时才需要填，且填之前必须先确认核心边界
   * （可机械化的判据：该模块是否调用生成式 AI ⇒ 是否会烧第三方额度）。
   */
  core?: boolean
  handler: Hono
}

export const MODULES: readonly BackendModule[] = [
  // ── 挂进 /api/v1 子应用（按前缀分组）──
  { id: "auth", target: "api", prefix: "auth", handler: authRoutes },
  { id: "users", target: "api", prefix: "users", handler: usersRoutes },
  { id: "user_imports", target: "api", prefix: "user-imports", handler: userImportsRoutes },
  { id: "uploads", target: "api", prefix: "uploads", handler: uploadsRoutes },
  { id: "courseware", target: "api", prefix: "courseware", handler: coursewareRoutes },
  { id: "essays", target: "api", prefix: "essays", handler: essaysRoutes },
  { id: "english", target: "api", prefix: "english", handler: englishRoutes },
  { id: "wordbank", target: "api", prefix: "wordbank", handler: wordbankRoutes },
  { id: "practice", target: "api", prefix: "practice", handler: practiceRoutes },
  { id: "practice_tracker", target: "api", prefix: "practice", handler: practiceTrackerRoutes },
  { id: "training", target: "api", prefix: "training", handler: trainingRoutes },
  { id: "daily_zh", target: "api", prefix: "daily-zh", handler: dailyZhRoutes },
  { id: "daily_en", target: "api", prefix: "daily-en", handler: dailyEnRoutes },
  { id: "joy", target: "api", prefix: "joy", handler: joyRoutes },
  { id: "generated_dict", target: "api", prefix: "generated-dict", handler: generatedDictRoutes },
  { id: "import_templates", target: "api", prefix: "import-templates", handler: importTemplatesRoutes },
  { id: "char_images", target: "api", prefix: "char-images", handler: charImagesRoutes },
  { id: "ops", target: "api", prefix: "ops", handler: opsRoutes },
  { id: "pinyin_audio", target: "api", prefix: "pinyin-audio", handler: pinyinAudioRoutes },
  { id: "ipa_audio", target: "api", prefix: "ipa-audio", handler: ipaAudioRoutes },
  { id: "quiz", target: "api", prefix: "llm", handler: quizRoutes },
  { id: "word_suggestions", target: "api", prefix: "llm", handler: wordSuggestionsRoutes },
  { id: "llm", target: "api", prefix: "llm", handler: llmRoutes },
  { id: "chinese_practice", target: "api", prefix: "llm", handler: chinesePracticeRoutes },
  { id: "chinese", target: "api", prefix: "chinese", handler: chineseRoutes },

  // ── 直接挂 /api/v1（路由文件内部自带完整路径）──
  { id: "ai_chinese", target: "app", prefix: "", handler: aiChineseRoutes },
  { id: "ai_homework", target: "app", prefix: "", handler: aiHomeworkRoutes },
  { id: "ai_practice", target: "app", prefix: "", handler: aiPracticeRoutes },
  { id: "ai_chat", target: "app", prefix: "", handler: aiChatRoutes },
  { id: "asr", target: "app", prefix: "", handler: asrRoutes },
  { id: "wordbook", target: "app", prefix: "wordbook", handler: wordbookRoutes },
  { id: "radical", target: "app", prefix: "radical", handler: radicalRoutes },
  { id: "ark_image", target: "app", prefix: "", handler: arkImageRoutes },
  { id: "free_llm", target: "app", prefix: "", handler: freeLlmRoutes },
  // App（小英）LLM 代理：把 DeepSeek key 留在服务端，客户端只持有一个可作废的口令。
  // prefix="" 且路由文件内部自带完整路径（/app-llm/chat/completions），故不参与前缀分组。
  { id: "app_llm", target: "app", prefix: "", handler: appLlmRoutes },
  { id: "tts", target: "app", prefix: "", handler: ttsRoutes },
  { id: "soe", target: "app", prefix: "", handler: soeRoutes },
  { id: "subtitle_capture", target: "app", prefix: "", handler: subtitleCaptureRoutes },
  { id: "bili", target: "app", prefix: "", handler: biliRoutes },
  { id: "visits", target: "app", prefix: "", handler: visitsRoutes },
  { id: "prefs", target: "app", prefix: "", handler: prefsRoutes },
  { id: "video_issues", target: "app", prefix: "", handler: videoIssuesRoutes },
]
