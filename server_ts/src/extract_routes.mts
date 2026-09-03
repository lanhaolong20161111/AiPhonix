import { Hono } from "hono"
import authRoutes from "./routes/auth.js"
import usersRoutes from "./routes/users.js"
import userImportsRoutes from "./routes/user_imports.js"
import uploadsRoutes from "./routes/uploads.js"
import essaysRoutes from "./routes/essays.js"
import englishRoutes from "./routes/english.js"
import wordbankRoutes from "./routes/wordbank.js"
import chinesePracticeRoutes from "./routes/chinese_practice.js"
import practiceRoutes from "./routes/practice.js"
import practiceTrackerRoutes from "./routes/practice_tracker.js"
import trainingRoutes from "./routes/training.js"
import importTemplatesRoutes from "./routes/import_templates.js"
import charImagesRoutes from "./routes/char_images.js"
import pinyinAudioRoutes from "./routes/pinyin_audio.js"
import ipaAudioRoutes from "./routes/ipa_audio.js"
import quizRoutes from "./routes/quiz.js"
import wordSuggestionsRoutes from "./routes/word_suggestions.js"
import llmRoutes from "./routes/llm.js"
import arkImageRoutes from "./routes/ark_image.js"
import freeLlmRoutes from "./routes/free_llm.js"
import aiPracticeRoutes from "./routes/ai_practice.js"
import chineseRoutes from "./routes/chinese.js"
import aiChineseRoutes from "./routes/ai_chinese.js"
import aiHomeworkRoutes from "./routes/ai_homework.js"
import aiChatRoutes from "./routes/ai_chat.js"
import ttsRoutes from "./routes/tts.js"
import devAgentRoutes from "./routes/dev_agent.js"
import soeRoutes from "./routes/soe.js"
import subtitleCaptureRoutes from "./routes/subtitleCapture.js"

const api = new Hono()
api.route("/auth", authRoutes)
api.route("/users", usersRoutes)
api.route("/user-imports", userImportsRoutes)
api.route("/uploads", uploadsRoutes)
api.route("/essays", essaysRoutes)
api.route("/english", englishRoutes)
api.route("/wordbank", wordbankRoutes)
api.route("/practice", practiceRoutes)
api.route("/practice", practiceTrackerRoutes)
api.route("/training", trainingRoutes)
api.route("/import-templates", importTemplatesRoutes)
api.route("/char-images", charImagesRoutes)
api.route("/pinyin-audio", pinyinAudioRoutes)
api.route("/ipa-audio", ipaAudioRoutes)
api.route("/llm", quizRoutes)
api.route("/llm", wordSuggestionsRoutes)
api.route("/llm", llmRoutes)
api.route("/llm", chinesePracticeRoutes)
api.route("/chinese", chineseRoutes)
const app = new Hono()
app.route("/api/v1", api)
app.route("/api/v1", aiChineseRoutes)
app.route("/api/v1", aiHomeworkRoutes)
app.route("/api/v1", aiPracticeRoutes)
app.route("/api/v1", aiChatRoutes)
app.route("/api/v1", arkImageRoutes)
app.route("/api/v1", freeLlmRoutes)
app.route("/api/v1", ttsRoutes)
app.route("/api/v1", devAgentRoutes)
app.route("/api/v1", soeRoutes)
app.route("/api/v1", subtitleCaptureRoutes)

import { writeFileSync } from "node:fs"
function collect(app: any, acc: string[] = []) {
  const rs = app.routes
  if (Array.isArray(rs)) {
    for (const r of rs) {
      if (r && r.path && r.method) acc.push(`${r.method} ${r.path}`)
      if (r.subApp) collect(r.subApp, acc)
    }
  }
  return acc
}
const all = collect(app).sort()
writeFileSync("C:\\Users\\lhl20\\Desktop\\android_cli_demos\\ts_routes.txt", all.join("\n") + "\n")
console.log("TOTAL", all.length)
