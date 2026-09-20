/** AI Chat 路由 — /api/v1/ai-chat/ask（带画像多模态会话）+ /api/v1/llm/chat（纯文本）
 * 对齐 Python routes/ai_chat.py；会话历史存 ai_chat_sessions 表（断点续聊）
 */
import { Hono } from "hono"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { db } from "../db/index.js"
import { studentProfiles, aiChatSessions } from "../db/schema.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { getArk, MULTIMODAL_MODEL } from "../lib/ark.js"
import { chat as deepseekChat } from "../lib/deepseek.js"
import { DATA_DIR, getConfig } from "../env.js"
import { findFirstExisting } from "../lib/jsonfile.js"

const router = new Hono()
const MAX_MISTAKES = 15
const MAX_MASTERED = 10

/** 词库 JSON 候选（原写成 shared/web/public/... 实际不存在 → 查词一直是空，这里补齐真实位置） */
const WORD_BANK_CANDIDATES = [
  join(DATA_DIR, "chinese_wordbank.json"), // 挂载卷/运维替换
  join(DATA_DIR, "../../app/src/main/assets/chinese_wordbank.json"), // 本机 dev 原位置
  join(DATA_DIR, "../../web/public/chinese_wordbank.json"), // 前端 public 副本
  join(DATA_DIR, "../../server_ts/assets/chinese_wordbank.json"), // 容器镜像内自包含副本
]

/** 带超时的 Promise 包装：超时抛 timedOut 标记错误（对齐 PY asyncio.wait_for TimeoutError → 504） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error("超时") as Error & { timedOut?: boolean }
      e.timedOut = true
      reject(e)
    }, ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

const MODULE_LABEL: Record<string, string> = { chinese: "语文", math: "数学", english: "英语" }
const SYSTEM_BY_MODULE: Record<string, string> = {
  chinese: "你是一位温柔、耐心的小学语文老师。请用简体中文、用小学生能懂的话回答问题，适当鼓励，可以举例。",
  math: "你是一位小学（低年级）数学老师。请用简体中文、简单易懂的方式讲解数学题，可以板书思路、一步步引导，多鼓励。",
  english: "你是一位儿童英语老师。请用简体中文为主、适当夹带英文，用 6-12 岁孩子能懂的方式讲解英语，注意发音和简单词句。",
}

interface Profile {
  session_count: number
  last_content: string
  mistakes: string[]
  mastered: string[]
}

function loadProfile(userId: number, module: string): Profile {
  try {
    const row = db.select().from(studentProfiles).where(and(eq(studentProfiles.userId, userId), eq(studentProfiles.module, module))).get()
    if (!row) return { session_count: 0, last_content: "", mistakes: [], mastered: [] }
    let mistakes: string[] = []
    let mastered: string[] = []
    try { mistakes = JSON.parse(row.mistakes || "[]") } catch { mistakes = [] }
    try { mastered = JSON.parse(row.mastered || "[]") } catch { mastered = [] }
    return { session_count: row.sessionCount, last_content: row.lastContent, mistakes, mastered }
  } catch {
    return { session_count: 0, last_content: "", mistakes: [], mastered: [] }
  }
}

function saveProfile(userId: number, module: string, profile: Profile): void {
  const existing = db.select().from(studentProfiles).where(and(eq(studentProfiles.userId, userId), eq(studentProfiles.module, module))).get()
  const now = new Date().toISOString()
  if (existing) {
    db.update(studentProfiles)
      .set({ sessionCount: profile.session_count, lastContent: profile.last_content.slice(0, 200), mistakes: JSON.stringify(profile.mistakes), mastered: JSON.stringify(profile.mastered), updatedAt: now })
      .where(eq(studentProfiles.id, existing.id))
      .run()
  } else {
    db.insert(studentProfiles)
      .values({ userId, module, sessionCount: profile.session_count, lastContent: profile.last_content.slice(0, 200), mistakes: JSON.stringify(profile.mistakes), mastered: JSON.stringify(profile.mastered), updatedAt: now })
      .run()
  }
}

function mergeProfile(profile: Profile, message: string, newMistakes: string[], newMastered: string[]): Profile {
  const mistakes = [...new Set([...profile.mistakes, ...newMistakes])].slice(-MAX_MISTAKES)
  const mastered = [...new Set([...profile.mastered, ...newMastered])].slice(-MAX_MASTERED)
  return { session_count: profile.session_count + 1, last_content: message.slice(0, 200), mistakes, mastered }
}

function profilePrompt(profile: Profile): string {
  if (!profile || profile.session_count === 0) return ""
  const lines: string[] = []
  if (profile.mistakes.length) lines.push(`易错：${profile.mistakes.slice(0, 8).join("、")}`)
  if (profile.mastered.length) lines.push(`掌握：${profile.mastered.slice(0, 6).join("、")}`)
  if (lines.length) lines.push(`共对话 ${profile.session_count} 轮`)
  return lines.join("；")
}

function parseProfileTags(reply: string): [string, string[], string[]] {
  const m = reply.match(/【画像】\s*([\s\S]*)$/)
  if (!m) return [reply, [], []]
  const tag = m[1]
  const clean = reply.slice(0, m.index).trim()
  const mistakes: string[] = []
  const mastered: string[] = []
  const errMatch = tag.match(/易错[:：]\s*(.+)/)
  const masMatch = tag.match(/掌握[:：]\s*(.+)/)
  if (errMatch) mistakes.push(...errMatch[1].split(/[；;、，,]/).map((x) => x.trim()).filter(Boolean).slice(0, 4))
  if (masMatch) mastered.push(...masMatch[1].split(/[；;、，,]/).map((x) => x.trim()).filter(Boolean).slice(0, 4))
  return [clean, mistakes, mastered]
}

function parseToolTags(reply: string): [string, string, string] {
  let speak = ""
  let word = ""
  for (const m of reply.matchAll(/【朗读】\s*([^\n【】]+)/g)) speak = (speak + " " + m[1].trim()).trim()
  for (const m of reply.matchAll(/【查词】\s*([^\n【】]+)/g)) word = m[1].trim()
  const clean = reply.replace(/【(朗读|查词)】[^\n]*\n?/g, "").trim()
  return [clean, speak, word]
}

function lookupWord(q: string): string {
  try {
    const path = findFirstExisting(WORD_BANK_CANDIDATES)
    if (!path) return ""
    const data = JSON.parse(readFileSync(path, "utf-8"))
    const hits: string[] = []
    for (const w of data.words ?? []) {
      if (q && String(w.text ?? "").includes(q)) {
        hits.push(w.pinyin ? `${w.text}（${w.pinyin}）` : String(w.text))
        if (hits.length >= 5) break
      }
    }
    return hits.join("；")
  } catch {
    return ""
  }
}

function autoSpeakText(reply: string, wordQ: string): string {
  if (wordQ && wordQ.trim()) return wordQ.trim()
  if (!reply) return ""
  const first = reply.split(/[。！？!?\n]+/)[0].trim()
  const cleaned = first.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^[\s#\-·0-9.]+/, "")
  if (!cleaned) return ""
  return cleaned.slice(0, 40)
}

function resolveUploadPath(imageUrl: string): string {
  const name = imageUrl.split("/").pop() || ""
  if (!name || name.includes("..") || name.includes("/")) return ""
  const path = join(DATA_DIR, "uploads", name)
  return existsSync(path) ? path : ""
}

// ── 会话读写（SQLite ai_chat_sessions 表，对齐 PY _load_chat_messages/_touch_chat_session） ──

interface ChatMsg {
  role: string
  content: string
}

function loadChatMessages(sessionId: string, userId: number): { module: string | null; messages: ChatMsg[] } {
  try {
    const row = db
      .select()
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.sessionId, sessionId), eq(aiChatSessions.userId, userId)))
      .get()
    if (!row) return { module: null, messages: [] }
    let msgs: ChatMsg[] = []
    try {
      msgs = JSON.parse(row.messages || "[]")
    } catch {
      msgs = []
    }
    return { module: row.module || null, messages: msgs }
  } catch (e) {
    console.warn(`[ai-chat] 读会话失败 session=${sessionId}: ${(e as Error).message}`)
    return { module: null, messages: [] }
  }
}

function touchChatSession(sessionId: string, userId: number, module: string, messages: ChatMsg[]): void {
  try {
    const now = new Date().toISOString()
    const payload = JSON.stringify(messages.slice(-30)) // 最多保留 30 条（对齐 PY）
    const existing = db
      .select()
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.sessionId, sessionId), eq(aiChatSessions.userId, userId)))
      .get()
    if (existing) {
      db.update(aiChatSessions)
        .set({ module, messages: payload, updatedAt: now })
        .where(eq(aiChatSessions.id, existing.id))
        .run()
    } else {
      db.insert(aiChatSessions)
        .values({ sessionId, userId, module, messages: payload, createdAt: now, updatedAt: now })
        .run()
    }
  } catch (e) {
    console.warn(`[ai-chat] 保存会话失败 session=${sessionId}: ${(e as Error).message}`)
  }
}

// POST /api/v1/ai-chat/ask
router.post("/ai-chat/ask", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const message = String(body?.message ?? "").trim()
  const imageUrl = String(body?.image_url ?? "").trim()
  let module = String(body?.module ?? "chinese")
  if (!MODULE_LABEL[module]) module = "chinese"
  const sessionId = String(body?.session_id ?? "").trim() || `ai_${user!.id}_${module}_${randomUUID().slice(0, 10)}`

  // 0) 会话：读历史消息（断点续聊），恢复 module；无会话则用请求携带的 history 兜底
  const sess = loadChatMessages(sessionId, user!.id)
  if (sess.module) module = sess.module
  const historyMessages: ChatMsg[] = sess.messages.length
    ? sess.messages
    : (Array.isArray(body?.history)
        ? (body.history as unknown[])
            .map((h: unknown) => ({
              role: String((h as { role?: string })?.role ?? ""),
              content: String((h as { content?: string })?.content ?? ""),
            }))
            .filter((h: ChatMsg) => h.content)
        : [])

  const historyLines = historyMessages.slice(-10).map((m) => `${m.role === "user" ? "学生" : "老师"}：${m.content}`)
  const context = historyLines.join("\n")
  const userPrompt = context ? `${context}\n学生：${message}` : `学生：${message}`

  // 画像
  const profile = loadProfile(user!.id, module)
  const profileText = profilePrompt(profile)

  let system = SYSTEM_BY_MODULE[module] || SYSTEM_BY_MODULE.chinese
  if (profileText) system += `\n\n【该学生的历史画像】\n${profileText}\n请结合画像个性化解答：巩固易错点、可适当进阶、避免重复已掌握的低阶问题。`
  if (imageUrl) system += "\n\n【本轮附带一张图片】请先看图，再结合学生的问题/对话给出讲解。"
  system += `\n\n【输出约定】在回答末尾若能识别学生的薄弱点或掌握点，另起一行按格式输出（没有可不输出）：\n【画像】易错：知识点1；掌握：知识点2\n若回答涉及需要发音/朗读的内容，请在回答中单独输出一行：【朗读】要朗读的文本（10 字以内最佳）。\n若学生问到某个词语的意思/拼音/用法，可在回答末尾输出一行：【查词】词语。`

  let raw = ""
  const imagePath = imageUrl ? resolveUploadPath(imageUrl) : ""
  if (imagePath) {
    // 多模态 90s 超时 → 504（对齐 PY asyncio.wait_for timeout=90）
    try {
      raw = await withTimeout(
        getArk().chat({ prompt: userPrompt, system_prompt: system, image_paths: [imagePath], max_tokens: 1024, model_override: MULTIMODAL_MODEL }),
        90000
      )
    } catch (e) {
      const err = e as Error & { timedOut?: boolean }
      if (err.timedOut) return c.json({ detail: "AI 响应超时，请稍后重试" }, 504)
      console.warn(`ai_chat 多模态调用失败（module=${module}）: ${err.message}`)
      return c.json({ detail: `AI 调用失败：${err.message}` }, 502)
    }
  } else {
    try {
      raw = await deepseekChat(system, userPrompt, 1024, `ai_chat_${module}`)
    } catch (e) {
      const anyE = e as { budget?: boolean }
      if (anyE.budget) throw e
      raw = ""
    }
  }

  // 解析
  const [cleanReply, newMistakes, newMastered] = parseProfileTags(raw)
  const [replyText, speakTextRaw, wordQ] = parseToolTags(cleanReply)
  const reply = replyText.trim() || "（AI 暂时没有回应，请再试一次）"
  const wordInfo = wordQ ? lookupWord(wordQ) : ""
  const speakText = speakTextRaw.trim() || autoSpeakText(reply, wordQ)

  // 回写画像 + 会话
  const updated = mergeProfile(profile, message || "（看图）", newMistakes, newMastered)
  saveProfile(user!.id, module, updated)
  const newMessages = [...historyMessages, { role: "user", content: message || "（图片）" }, { role: "assistant", content: reply }]
  touchChatSession(sessionId, user!.id, module, newMessages)

  return c.json({ reply, session_id: sessionId, tts_url: speakText, word_info: wordInfo })
})

// POST /api/v1/llm/chat（旧路径纯文本问答，无画像；对齐 PY routes/llm.py：无鉴权、prompt 自定义、quiz 4096）
router.post("/llm/chat", async (c) => {
  const body = await c.req.json().catch(() => null)
  const message = String(body?.message ?? "").trim()
  const mode = String(body?.mode ?? "")
  if (!message) return c.json({ detail: "消息不能为空" }, 422)

  const cfg = getConfig()
  const customPrompt = String(body?.prompt ?? "").trim()
  let system = customPrompt
  if (!system) {
    const promptMap: Record<string, string> = {
      chinese: cfg.llm_prompts.chinese_teaching,
      quiz: cfg.llm_prompts.quiz_generate,
      english: cfg.llm_prompts.english_teaching,
    }
    system = promptMap[mode] ?? cfg.llm_prompts.default
  }
  const maxTokens = mode === "quiz" ? 4096 : 2048

  try {
    const reply = await deepseekChat(system, message, maxTokens, mode || "chat")
    return c.json({ reply })
  } catch (e) {
    const anyE = e as { budget?: boolean }
    if (anyE.budget) throw e // 预算守卫 → 全局 429
    return c.json({ detail: `LLM 调用失败: ${(e as Error).message}` }, 500)
  }
})

export default router
