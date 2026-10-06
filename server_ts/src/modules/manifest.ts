/**
 * 后端模块清单 —— server_ts 侧（本地 Node）。
 *
 * ⚠️ 与 `server_cf/src/modules/manifest.ts` 是**同构手工副本**，必须成对修改。
 * 差异是**有意保留**的（见 `tests/routeParity.test.ts` 的 ALLOWLIST）：
 *   server_ts 缺 daily-zh / daily-en / joy / generated-dict / ops / wordbook / radical；
 *   且把 server_cf 的单个 `asr` 拆成了 `asr_short` + `asr_stream`（Node 侧走 ws 升级）。
 *
 * ⚠️ **数组顺序 = 挂载顺序，不可随意调整**（原因见 server_cf 同文件的文件头警告）。
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
import importTemplatesRoutes from "../routes/import_templates.js"
import charImagesRoutes from "../routes/char_images.js"
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
import arkImageRoutes from "../routes/ark_image.js"
import freeLlmRoutes from "../routes/free_llm.js"
import appLlmRoutes from "../routes/app_llm.js"
import ttsRoutes from "../routes/tts.js"
import asrShortRoutes from "../routes/asrShort.js"
import asrStreamRoutes from "../routes/asrStream.js"
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
   */
  prefix: string
  /**
   * 是否属于「最小核心」—— **保留字段，当前一律未设置、对运行无任何影响**。
   * 只有真要拆「核心 Worker / 全量 Worker」时才需要填，且填之前必须先确认核心边界。
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
  { id: "import_templates", target: "api", prefix: "import-templates", handler: importTemplatesRoutes },
  { id: "char_images", target: "api", prefix: "char-images", handler: charImagesRoutes },
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
  { id: "ark_image", target: "app", prefix: "", handler: arkImageRoutes },
  { id: "free_llm", target: "app", prefix: "", handler: freeLlmRoutes },
  // App（小英）LLM 代理：与 server_cf 同构（路由文件逐字一致，前缀 "" 且内部自带完整路径）
  { id: "app_llm", target: "app", prefix: "", handler: appLlmRoutes },
  { id: "tts", target: "app", prefix: "", handler: ttsRoutes },
  { id: "asr_short", target: "app", prefix: "", handler: asrShortRoutes },
  { id: "asr_stream", target: "app", prefix: "", handler: asrStreamRoutes },
  { id: "soe", target: "app", prefix: "", handler: soeRoutes },
  { id: "subtitle_capture", target: "app", prefix: "", handler: subtitleCaptureRoutes },
  { id: "bili", target: "app", prefix: "", handler: biliRoutes },
  { id: "visits", target: "app", prefix: "", handler: visitsRoutes },
  { id: "prefs", target: "app", prefix: "", handler: prefsRoutes },
  { id: "video_issues", target: "app", prefix: "", handler: videoIssuesRoutes },
]
